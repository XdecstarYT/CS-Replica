/* render3d_babylon.js — Babylon.js city renderer (drop-in for the Three.js one).
 *
 * Exposes the same public surface the rest of the game relies on:
 *   methods : draw, updateTile, syncBuildings, rebuildAll, setGrid, setOverlay,
 *             updateOverlay, setHover, markTile, clearMark, screenToTile, panTo,
 *             _positionCamera, resize
 *   props   : canvas, construction, weatherSys, timeOfDay, overlayMode, models,
 *             camTarget {.x/.z/.set}, camDist, camPolar, camAzimuth
 *
 * The game runs its own requestAnimationFrame loop and calls draw() each frame,
 * so this renderer does NOT start engine.runRenderLoop — draw() renders a frame.
 */

class Renderer3D {
  constructor(canvas, grid) {
    const B = BABYLON;
    this.B = B;
    this.canvas = canvas;
    this.grid = grid;
    this.T = 1.0;

    this.engine = new B.Engine(canvas, true, { preserveDrawingBuffer: true, stencil: true, antialias: true, powerPreference: 'high-performance' }, false);
    // Render at ~device-independent resolution (NOT 2×/3×) so phones stay fast.
    // A little above CSS pixels keeps it crisp without melting the GPU.
    const dpr = window.devicePixelRatio || 1;
    this._targetScale = (dpr > 2) ? dpr / 1.5 : 1;     // ≈1.3–2× cap
    this.engine.setHardwareScalingLevel(this._targetScale);
    this.scene = new B.Scene(this.engine);
    this.scene.clearColor = B.Color4.FromHexString('#87ceebff');
    this.scene.ambientColor = new B.Color3(0.4, 0.45, 0.55);
    this.scene.fogMode = B.Scene.FOGMODE_EXP2;
    this.scene.fogDensity = 0.011;
    this.scene.fogColor = new B.Color3(0.53, 0.81, 0.92);
    // PERFORMANCE: never auto-pick the scene on pointer-move. Without this,
    // Babylon ray-casts against every mesh on each move event, which makes
    // dragging the camera crawl in a dense city. We do our own ray/plane pick.
    this.scene.skipPointerMovePicking = true;
    this.scene.constantlyUpdateMeshUnderPointer = false;

    // ── Camera (manual spherical placement; input3d drives the params) ──
    this.camTarget = new B.Vector3(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this.camDist = 22; this.camPolar = 1.0; this.camAzimuth = 0.7;
    this.camera = new B.UniversalCamera('cam', new B.Vector3(0, 20, -20), this.scene);
    this.camera.fov = 50 * Math.PI / 180;
    this.camera.minZ = 0.1; this.camera.maxZ = 400;
    this._positionCamera();

    this._setupLights();
    this._setupPostFX();
    this.models = new ModelBuilderB(this.scene);
    this._buildSky();
    this._buildGround();
    this._buildOverlay();
    this._buildWeather();

    // ── State ──
    this.tileMeshes = new Map();          // "x,y" -> [nodes]
    this.vehiclePool = [];
    this.citizenPool = [];
    this.accidentPool = [];
    this.timeOfDay = 0.35;
    this.nightFactor = 0;
    this.overlayMode = null;
    this.construction = null;
    this.weatherSys = null;
    this._bldSig = null;

    this._initHover();
    this._buildWater();
    this.rebuildAll();
    this.resize();
    // Robust resize on every viewport change mobile browsers can throw at us.
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
    if (window.visualViewport) window.visualViewport.addEventListener('resize', onResize);
  }

  // ─────────────────────── Setup ───────────────────────
  _setupLights() {
    const B = this.B;
    this.hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), this.scene);
    this.hemi.diffuse = new B.Color3(0.62, 0.78, 0.95);
    this.hemi.groundColor = new B.Color3(0.22, 0.30, 0.18);
    this.hemi.intensity = 0.65;

    this.sun = new B.DirectionalLight('sun', new B.Vector3(-0.5, -1, -0.4), this.scene);
    this.sun.position = new B.Vector3(this.camTarget.x + 40, 80, this.camTarget.z - 30);
    this.sun.intensity = 2.1;
    this.sun.diffuse = new B.Color3(1.0, 0.94, 0.80);
    this.sun.specular = new B.Color3(1, 0.96, 0.85);

    // Lighter shadows for mobile: 1024 map, PCF, refreshed every few frames
    // (the city is static and the sun moves slowly, so this is plenty).
    this.shadow = new B.ShadowGenerator(1024, this.sun);
    this.shadow.usePercentageCloserFiltering = true;
    this.shadow.filteringQuality = B.ShadowGenerator.QUALITY_LOW;
    this.shadow.darkness = 0.4;
    this.shadow.bias = 0.0015;
    const smap = this.shadow.getShadowMap();
    smap.refreshRate = B.RenderTargetTexture.REFRESHRATE_RENDER_ONEVERYTWOFRAMES;
    this._shadowList = smap.renderList;
  }

  // High-end post-processing: HDR pipeline with ACES tone mapping, bloom on the
  // glowing windows/LED crowns, FXAA+MSAA anti-aliasing, sharpen, vignette, plus
  // SSAO ambient occlusion for contact shadows between dense towers.
  _setupPostFX() {
    const B = this.B;
    try {
      const pl = new B.DefaultRenderingPipeline('hdr', true, this.scene, [this.camera]);
      pl.samples = 1;                         // rely on FXAA (MSAA is costly on mobile)
      pl.fxaaEnabled = true;
      pl.bloomEnabled = true;                 // cheap, big payoff on lit windows/crowns
      pl.bloomThreshold = 0.70;
      pl.bloomWeight = 0.5;
      pl.bloomKernel = 48;
      pl.bloomScale = 0.5;
      pl.imageProcessingEnabled = true;
      const ip = pl.imageProcessing;
      ip.toneMappingEnabled = true;
      ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.15;
      ip.contrast = 1.15;
      ip.vignetteEnabled = true;
      ip.vignetteWeight = 1.2;
      ip.vignetteColor = new B.Color4(0, 0, 0, 0);
      this.pipeline = pl;
      this._ip = ip;
    } catch (e) { /* pipeline optional — game still renders without it */ }
  }

  _buildSky() {
    const B = this.B;
    // Gradient sky via a large inverted sphere with a vertical-gradient texture.
    const dt = new B.DynamicTexture('skytex', { width: 8, height: 256 }, this.scene, false);
    this._skyTex = dt;
    this._paintSky(0.35);
    const mat = new B.StandardMaterial('skymat', this.scene);
    mat.backFaceCulling = false;
    mat.disableLighting = true;
    mat.emissiveTexture = dt;
    mat.diffuseColor = new B.Color3(0, 0, 0);
    this._skyMat = mat;
    const dome = B.MeshBuilder.CreateSphere('sky', { diameter: 360, segments: 16 }, this.scene);
    dome.material = mat;
    dome.infiniteDistance = true;
    dome.isPickable = false;
    dome.applyFog = false;
    this.skyDome = dome;
  }

  _paintSky(t) {
    const n = (1 - Math.cos((t - 0.25) * Math.PI * 2)) / 2;   // 0 day .. 1 night
    const ctx = this._skyTex.getContext();
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    const lerp = (a, b, f) => a.map((v, i) => Math.round(v + (b[i] - v) * f));
    const dayTop = [26, 76, 143], dayBot = [168, 216, 240];
    const duskTop = [61, 26, 80], duskBot = [232, 112, 42];
    const nightTop = [5, 13, 30], nightBot = [14, 26, 48];
    let top, bot;
    if (n < 0.5) { const f = Math.sin(n * Math.PI) * 0.85; top = lerp(dayTop, duskTop, f); bot = lerp(dayBot, duskBot, f); }
    else { const f = (n - 0.5) * 2; top = lerp(duskTop, nightTop, f); bot = lerp(duskBot, nightBot, f); }
    grad.addColorStop(0, `rgb(${top[0]},${top[1]},${top[2]})`);
    grad.addColorStop(1, `rgb(${bot[0]},${bot[1]},${bot[2]})`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 8, 256);
    this._skyTex.update();
    this._skyBot = bot;
  }

  _buildGround() {
    const B = this.B, g = this.grid;
    if (this.ground) { this.ground.dispose(); this.ground = null; }
    const mat = new B.StandardMaterial('groundmat', this.scene);
    if (!this._groundTex) {
      // Subtle baked grass/earth noise so the ground reads as terrain, not paint.
      const S = 256;
      const dt = new B.DynamicTexture('grass', { width: S, height: S }, this.scene, true);
      const c = dt.getContext();
      c.fillStyle = '#5a7048'; c.fillRect(0, 0, S, S);
      for (let i = 0; i < 4000; i++) {
        const x = Math.random() * S, y = Math.random() * S;
        const sh = 0.6 + Math.random() * 0.5;
        c.fillStyle = `rgba(${Math.round(74 * sh)},${Math.round(102 * sh)},${Math.round(60 * sh)},0.5)`;
        c.fillRect(x, y, 2, 2);
      }
      dt.update();
      dt.wrapU = dt.wrapV = B.Texture.WRAP_ADDRESSMODE;
      dt.uScale = dt.vScale = g.w / 4;
      this._groundTex = dt;
    }
    mat.diffuseTexture = this._groundTex;
    mat.specularColor = new B.Color3(0.02, 0.03, 0.02);
    const ground = B.MeshBuilder.CreateGround('ground', { width: g.w * this.T, height: g.h * this.T, subdivisions: 1 }, this.scene);
    ground.position.set(g.w * this.T / 2, -0.002, g.h * this.T / 2);
    ground.material = mat;
    ground.receiveShadows = true;
    this.ground = ground;
    this.groundMat = mat;
  }

  _buildWater() {
    const B = this.B, g = this.grid, T = this.T;
    if (this.water) { this.water.dispose(); this.water = null; }
    const pos = [], idx = [], nor = [], uv = [];
    let b = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.type[g.idx(x, y)] !== TILE.WATER) continue;
      const x0 = x * T, z0 = y * T;
      pos.push(x0, -0.05, z0, x0 + T, -0.05, z0, x0 + T, -0.05, z0 + T, x0, -0.05, z0 + T);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3); b += 4;
    }
    if (!pos.length) return;
    const mesh = new B.Mesh('water', this.scene);
    const vd = new B.VertexData(); vd.positions = pos; vd.indices = idx; vd.normals = nor; vd.uvs = uv;
    vd.applyToMesh(mesh);
    const mat = new B.StandardMaterial('watermat', this.scene);
    mat.diffuseColor = new B.Color3(0.07, 0.38, 0.62);
    mat.emissiveColor = new B.Color3(0.0, 0.08, 0.16);
    mat.specularColor = new B.Color3(0.6, 0.7, 0.8);
    mat.specularPower = 64; mat.alpha = 0.9;
    mesh.material = mat; mesh.receiveShadows = true;
    this.water = mesh; this.waterMat = mat;
  }

  _buildOverlay() {
    const B = this.B, g = this.grid;
    if (this.overlayMesh) { this.overlayMesh.dispose(); this.overlayMesh = null; }
    const dt = new B.DynamicTexture('ovl', { width: g.w, height: g.h }, this.scene, false);
    dt.hasAlpha = true;
    this._overlayTex = dt;
    const mat = new B.StandardMaterial('ovlmat', this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = new B.Color3(1, 1, 1);
    mat.diffuseTexture = dt; mat.diffuseTexture.hasAlpha = true;
    mat.useAlphaFromDiffuseTexture = true;
    mat.opacityTexture = dt;
    mat.backFaceCulling = false;
    const plane = B.MeshBuilder.CreateGround('ovlplane', { width: g.w * this.T, height: g.h * this.T }, this.scene);
    plane.position.set(g.w * this.T / 2, 0.08, g.h * this.T / 2);
    plane.material = mat; plane.isPickable = false; plane.setEnabled(false);
    this.overlayMesh = plane;
  }

  _buildWeather() {
    const B = this.B;
    const ps = new B.ParticleSystem('precip', 1200, this.scene);
    // tiny white square texture via dynamic texture
    const dt = new B.DynamicTexture('drop', { width: 4, height: 4 }, this.scene, false);
    const c = dt.getContext(); c.fillStyle = '#cfe0ff'; c.fillRect(0, 0, 4, 4); dt.update();
    ps.particleTexture = dt;
    ps.minSize = 0.02; ps.maxSize = 0.05;
    ps.minLifeTime = 0.6; ps.maxLifeTime = 1.2;
    ps.emitRate = 0;
    ps.gravity = new B.Vector3(0, -18, 0);
    ps.direction1 = new B.Vector3(-0.3, -1, -0.3);
    ps.direction2 = new B.Vector3(0.3, -1, 0.3);
    ps.minEmitBox = new B.Vector3(-20, 24, -20);
    ps.maxEmitBox = new B.Vector3(20, 26, 20);
    ps.color1 = new B.Color4(0.8, 0.88, 1, 0.7);
    ps.color2 = new B.Color4(0.7, 0.8, 1, 0.5);
    ps.emitter = this.camTarget.clone();
    ps.start();
    this._precip = ps;
  }

  _initHover() {
    const B = this.B;
    const mk = (hex) => { const m = new B.StandardMaterial('h', this.scene); m.emissiveColor = B.Color3.FromHexString(hex); m.alpha = 0.45; m.disableLighting = true; return m; };
    this.hoverOk = mk('#38bdf8'); this.hoverBad = mk('#f87171');
    const hb = B.MeshBuilder.CreateBox('hover', { width: this.T * 0.97, height: 0.08, depth: this.T * 0.97 }, this.scene);
    hb.material = this.hoverOk; hb.isPickable = false; hb.setEnabled(false);
    this.hoverMesh = hb;

    // suggest marker
    const sm = new B.TransformNode('suggest', this.scene);
    const ringMat = new B.StandardMaterial('smr', this.scene); ringMat.emissiveColor = new B.Color3(0.22, 1, 0.88); ringMat.disableLighting = true;
    const ring = B.MeshBuilder.CreateTorus('sr', { diameter: this.T * 0.8, thickness: 0.05, tessellation: 20 }, this.scene);
    ring.material = ringMat; ring.parent = sm; ring.position.y = 0.1;
    const beam = B.MeshBuilder.CreateCylinder('sbe', { diameterTop: 0.32, diameterBottom: 0.6, height: 3.2, tessellation: 12 }, this.scene);
    const beamMat = new B.StandardMaterial('smb', this.scene); beamMat.emissiveColor = new B.Color3(0.22, 1, 0.88); beamMat.alpha = 0.25; beamMat.disableLighting = true;
    beam.material = beamMat; beam.parent = sm; beam.position.y = 1.6;
    sm.setEnabled(false); this.suggestMarker = sm; this._markUntil = 0;
  }

  // ─────────────────────── Shadow helpers ───────────────────────
  _addShadow(node) {
    const meshes = node.getChildMeshes ? node.getChildMeshes(false) : [];
    if (node.getClassName && node.getClassName() === 'Mesh') meshes.push(node);
    for (const m of meshes) { if (this._shadowList.indexOf(m) < 0) this._shadowList.push(m); }
  }
  _removeShadow(node) {
    const meshes = node.getChildMeshes ? node.getChildMeshes(false) : [];
    if (node.getClassName && node.getClassName() === 'Mesh') meshes.push(node);
    for (const m of meshes) { const k = this._shadowList.indexOf(m); if (k >= 0) this._shadowList.splice(k, 1); }
  }

  // ─────────────────────── Tile RNG ───────────────────────
  _tileRng(x, y) { let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0; h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16; return (h >>> 0) / 0xFFFFFFFF; }

  // ─────────────────────── Tile build / remove ───────────────────────
  _removeTile(key) {
    const old = this.tileMeshes.get(key);
    if (!old) return;
    for (const node of old) { this._removeShadow(node); node.dispose(); }
    this.tileMeshes.delete(key);
  }

  updateTile(x, y) {
    const key = `${x},${y}`;
    this._removeTile(key);
    const B = this.B, g = this.grid, T = this.T, i = g.idx(x, y), t = g.type[i];
    if (t === TILE.GRASS || t === TILE.WATER) return;
    const cx = x * T + T / 2, cz = y * T + T / 2;
    const nodes = [];

    if (t === TILE.ROAD) {
      this._buildRoad(x, y, cx, cz, T, nodes);
    } else if (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) {
      const built = g.built ? g.built[i] : g.level[i];
      const proj = this.construction && this.construction.projectAt(i);
      if (proj && proj.stage < 1) {
        const site = this.models.buildConstructionSite(t, T, proj.target, proj.stage, this.models._hash(x, y));
        site.position.set(cx, 0, cz); nodes.push(site);
      } else if (built === 0) {
        const m = B.MeshBuilder.CreateBox('zmark', { width: T * 0.7, height: 0.04, depth: T * 0.7 }, this.scene);
        const mat = new B.StandardMaterial('zm', this.scene);
        mat.emissiveColor = t === TILE.ZONE_RES ? new B.Color3(0.1, 0.4, 0.15) : t === TILE.ZONE_COM ? new B.Color3(0.1, 0.3, 0.5) : new B.Color3(0.5, 0.4, 0.1);
        mat.alpha = 0.5; mat.disableLighting = true; m.material = mat;
        m.position.set(cx, 0.02, cz); m.isPickable = false; nodes.push(m);
      } else {
        const { root } = this.models.buildBuilding(t, built, x, y, T);
        root.position.set(cx, 0, cz); nodes.push(root); this._addShadow(root);
        // Static building → freeze world matrices (big perf win; it never moves).
        root.computeWorldMatrix(true);
        for (const m of root.getChildMeshes(false)) { m.computeWorldMatrix(true); m.freezeWorldMatrix(); m.isPickable = false; m.doNotSyncBoundingInfo = true; }
      }
    } else if (t === TILE.SERVICE) {
      const svc = SERVICE_BY_ID[g.service[i]];
      const node = this.models.buildService(svc, T);
      node.position.set(cx, 0, cz); nodes.push(node); this._addShadow(node);
    }

    if (nodes.length) this.tileMeshes.set(key, nodes);
  }

  _buildRoad(x, y, cx, cz, T, nodes) {
    const B = this.B, g = this.grid;
    if (!this._roadMat) {
      this._roadMat = new B.StandardMaterial('road', this.scene);
      this._roadMat.diffuseColor = new B.Color3(0.26, 0.27, 0.30);
      this._roadMat.specularColor = new B.Color3(0.02, 0.02, 0.02);
      this._markMat = new B.StandardMaterial('mark', this.scene);
      this._markMat.diffuseColor = new B.Color3(0.85, 0.78, 0.25);
      this._markMat.emissiveColor = new B.Color3(0.1, 0.08, 0);
    }
    const surf = B.MeshBuilder.CreateBox('rs', { width: T, height: 0.04, depth: T }, this.scene);
    surf.material = this._roadMat; surf.position.set(cx, 0.02, cz); surf.receiveShadows = true; nodes.push(surf);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    let roadNbrs = 0;
    for (const [ddx, ddz] of dirs) {
      const nx = x + ddx, nz = y + ddz;
      if (!g.inBounds(nx, nz) || g.type[g.idx(nx, nz)] !== TILE.ROAD) continue;
      roadNbrs++;
      const lw = ddx === 0 ? 0.04 : T * 0.3, ld = ddz === 0 ? 0.04 : T * 0.3;
      const ln = B.MeshBuilder.CreateBox('lm', { width: lw, height: 0.06, depth: ld }, this.scene);
      ln.material = this._markMat; ln.position.set(cx + ddx * T * 0.22, 0.03, cz + ddz * T * 0.22); ln.isPickable = false; nodes.push(ln);
    }
    if (((x + y) & 1) === 0) {
      const lamp = this.models.buildStreetLamp();
      lamp.position.set(cx + T * 0.4, 0.02, cz + T * 0.4); nodes.push(lamp);
    }
  }

  rebuildAll() {
    for (const [key] of [...this.tileMeshes]) this._removeTile(key);
    this.tileMeshes.clear();
    const g = this.grid;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const t = g.type[g.idx(x, y)];
      if (t !== TILE.GRASS && t !== TILE.WATER) this.updateTile(x, y);
    }
    this._snapshotSigs();
  }

  // ─────────────────────── Building sync ───────────────────────
  _tileSig(i) {
    const g = this.grid;
    const built = g.built ? g.built[i] : g.level[i];
    const proj = this.construction && this.construction.projectAt(i);
    return (proj && proj.stage < 1) ? 1000 + proj.target * 10 + this.construction.stageIndex(proj.stage) : built;
  }
  _snapshotSigs() {
    const g = this.grid;
    if (!this._bldSig || this._bldSig.length !== g.type.length) this._bldSig = new Int32Array(g.type.length);
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      this._bldSig[i] = (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) ? this._tileSig(i) : -999;
    }
  }
  syncBuildings() {
    const g = this.grid;
    if (!this._bldSig || this._bldSig.length !== g.type.length) { this._snapshotSigs(); return; }
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t !== TILE.ZONE_RES && t !== TILE.ZONE_COM && t !== TILE.ZONE_IND) { this._bldSig[i] = -999; continue; }
      const sig = this._tileSig(i);
      if (this._bldSig[i] !== sig) { this._bldSig[i] = sig; this.updateTile(i % g.w, (i / g.w) | 0); }
    }
  }

  // ─────────────────────── Overlay ───────────────────────
  setOverlay(mode, sim) {
    this.overlayMode = mode || null;
    this.overlayMesh.setEnabled(!!this.overlayMode);
    if (this.overlayMode && sim) this.updateOverlay(sim);
  }
  updateOverlay(sim) {
    if (!this.overlayMode || !this.overlayMesh.isEnabled()) return;
    const g = this.grid, ctx = this._overlayTex.getContext(), mode = this.overlayMode, f = sim.fields;
    ctx.clearRect(0, 0, g.w, g.h);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      const i = g.idx(x, y); let v = 0, col = null;
      if (mode === 'power') { v = g.power[i] ? 1 : 0; col = [250, 204, 21]; }
      else if (mode === 'water') { v = g.water[i] ? 1 : 0; col = [56, 189, 248]; }
      else if (mode === 'congestion') { if (g.type[i] === TILE.ROAD && g.congestion) { v = Math.min(1, g.congestion[i] * 1.1); col = [Math.round(80 + 175 * v), Math.round(200 * (1 - v) + 40), 50]; } }
      else if (mode === 'services') { v = f ? Math.min(1, (f.safety[i] + f.health[i] + f.happy[i] + f.education[i]) / 2) : 0; col = [192, 132, 252]; }
      else if (mode === 'desirability') { const util = (g.power[i] ? 0.5 : 0) + (g.water[i] ? 0.5 : 0); const serv = f ? Math.min(1, (f.safety[i] + f.health[i] + f.happy[i] + f.education[i]) / 2) : 0; v = util * 0.6 + serv * 0.4; if (g.type[i] === TILE.WATER) v = 0; col = [Math.round(255 * (1 - v)), Math.round(200 * v + 40), 60]; }
      if (v > 0.01 && col) { ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${Math.min(0.9, 0.25 + v * 0.65)})`; ctx.fillRect(x, y, 1, 1); }
    }
    this._overlayTex.update();
  }

  // ─────────────────────── Camera ───────────────────────
  _positionCamera() {
    const g = this.grid;
    this.camTarget.x = Math.max(0, Math.min(g.w * this.T, this.camTarget.x));
    this.camTarget.z = Math.max(0, Math.min(g.h * this.T, this.camTarget.z));
    this.camDist = Math.max(5, Math.min(120, this.camDist));
    this.camPolar = Math.max(0.35, Math.min(Math.PI / 2.1, this.camPolar));
    const r = this.camDist, phi = this.camPolar, th = this.camAzimuth;
    this.camera.position.set(
      this.camTarget.x + r * Math.sin(phi) * Math.sin(th),
      r * Math.cos(phi),
      this.camTarget.z + r * Math.sin(phi) * Math.cos(th)
    );
    this.camera.setTarget(this.camTarget);
  }

  screenToTile(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const px = sx - rect.left, py = sy - rect.top;
    const ray = this.scene.createPickingRay(px, py, this.B.Matrix.Identity(), this.camera);
    const plane = this.B.Plane.FromPositionAndNormal(new this.B.Vector3(0, 0, 0), new this.B.Vector3(0, 1, 0));
    const t = ray.intersectsPlane(plane);
    if (t == null) return null;
    const pt = ray.origin.add(ray.direction.scale(t));
    return { tx: Math.floor(pt.x / this.T), ty: Math.floor(pt.z / this.T) };
  }

  panTo(x, y) { this.camTarget.x = (x + 0.5) * this.T; this.camTarget.z = (y + 0.5) * this.T; this._positionCamera(); }

  // ─────────────────────── Hover / marker ───────────────────────
  setHover(tile, valid) {
    if (!tile || !this.grid.inBounds(tile.tx, tile.ty)) { this.hoverMesh.setEnabled(false); return; }
    this.hoverMesh.position.set((tile.tx + 0.5) * this.T, 0.04, (tile.ty + 0.5) * this.T);
    this.hoverMesh.material = valid ? this.hoverOk : this.hoverBad;
    this.hoverMesh.setEnabled(true);
  }
  markTile(x, y) {
    if (!this.grid.inBounds(x, y)) return;
    this.suggestMarker.position.set((x + 0.5) * this.T, 0, (y + 0.5) * this.T);
    this.suggestMarker.setEnabled(true);
    this._markUntil = performance.now() + 9000;
    this.panTo(x, y);
  }
  clearMark() { this.suggestMarker.setEnabled(false); }

  // ─────────────────────── Set grid (load / expand) ───────────────────────
  setGrid(grid) {
    this.grid = grid;
    for (const [key] of [...this.tileMeshes]) this._removeTile(key);
    this.tileMeshes.clear();
    for (const v of this.vehiclePool) v.dispose(); this.vehiclePool.length = 0;
    for (const c of this.citizenPool) c.dispose(); this.citizenPool.length = 0;
    this._buildGround();
    this._buildOverlay();
    this.overlayMesh.setEnabled(!!this.overlayMode);
    this._buildWater();
    if (this.skyDome) this.skyDome.position.set(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this.rebuildAll();
    this.camTarget.set(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this._positionCamera();
  }

  // ─────────────────────── Day / night ───────────────────────
  _updateDayNight() {
    const t = this.timeOfDay;
    const n = this.nightFactor = (1 - Math.cos((t - 0.25) * Math.PI * 2)) / 2;
    const d = 1 - n;
    const sunAngle = (t - 0.25) * Math.PI * 2;
    const sunElev = Math.cos(sunAngle);
    const cx = this.camTarget.x, cz = this.camTarget.z;
    // sun
    this.sun.direction = new this.B.Vector3(-Math.sin(sunAngle), -Math.max(0.15, sunElev), -0.4).normalize();
    this.sun.position.set(cx + Math.sin(sunAngle) * 60, Math.max(6, sunElev * 80), cz - 30);
    this.sun.intensity = Math.max(0.05, sunElev) * 2.2;
    this.hemi.intensity = 0.18 + d * 0.5;
    // sky + fog
    this._paintSky(t);
    if (this._skyBot) { this.scene.clearColor = new this.B.Color4(this._skyBot[0] / 255, this._skyBot[1] / 255, this._skyBot[2] / 255, 1); this.scene.fogColor = new this.B.Color3(this._skyBot[0] / 255, this._skyBot[1] / 255, this._skyBot[2] / 255); }
    this.scene.fogDensity = 0.009 + n * 0.004;
    // facade window glow
    const wi = Math.max(0, Math.min(1, (n - 0.3) * 1.7));
    const gr = 0.42 * wi, gg = 0.30 * wi, gb = 0.13 * wi;
    if (Math.abs(wi - (this._lastWi || -1)) > 0.01) {
      this._lastWi = wi;
      for (const m of this.models.facadeMats) m.emissiveColor.set(gr, gg, gb);
      const lamp = Math.max(0, Math.min(1, (n - 0.25) * 1.6));
      for (const m of this.models.lampMats) m.emissiveColor.set(lamp, lamp * 0.82, lamp * 0.28);
    }
    // water shimmer
    if (this.waterMat) { const tm = performance.now() / 1000; const br = 0.1 + d * 0.25 + Math.sin(tm * 1.3) * 0.03; this.waterMat.emissiveColor.set(br * 0.05 + n * 0.03, br * 0.2 + n * 0.025, br * 0.42 + n * 0.012); }
    // tone-mapping exposure: brighter by day, moodier (with stronger bloom) at night
    if (this._ip) this._ip.exposure = 1.18 - n * 0.34;
    if (this.pipeline) this.pipeline.bloomWeight = 0.45 + n * 0.45;
  }

  // ─────────────────────── Vehicles ───────────────────────
  _updateVehicles(traffic) {
    if (!traffic) return;
    const veh = traffic.vehicles, T = this.T;
    while (this.vehiclePool.length < veh.length) { this.vehiclePool.push(this.models.buildVehicle(this.vehiclePool.length)); }
    for (let k = 0; k < this.vehiclePool.length; k++) this.vehiclePool[k].setEnabled(k < veh.length);
    const flash = ((performance.now() / 130) | 0) & 1;
    for (let k = 0; k < veh.length; k++) {
      const v = veh[k], dx = v.nx - v.x, dz = v.ny - v.y;
      const wx = (v.x + dx * v.t + 0.5 - dz * 0.18) * T, wz = (v.y + dz * v.t + 0.5 + dx * 0.18) * T;
      const m = this.vehiclePool[k];
      m.position.set(wx, 0.04, wz);
      if (dx !== 0 || dz !== 0) m.rotation.y = Math.atan2(dx, dz);
      if (v.emergency && m._bodyMat) m._bodyMat.emissiveColor.set(flash ? 0.05 : 0.9, flash ? 0.1 : 0.05, flash ? 0.9 : 0.05);
    }
  }

  // ─────────────────────── Citizens ───────────────────────
  _updateCitizens(citizens) {
    if (!citizens) return;
    const cits = citizens.citizens, T = this.T;
    while (this.citizenPool.length < cits.length) this.citizenPool.push(this.models.buildCitizen(this.citizenPool.length));
    for (let k = 0; k < this.citizenPool.length; k++) this.citizenPool[k].setEnabled(k < cits.length);
    for (let k = 0; k < cits.length; k++) {
      const c = cits[k], node = this.citizenPool[k];
      node.position.set((c.x + 0.5) * T, 0, (c.y + 0.5) * T);
    }
  }

  // ─────────────────────── Weather ───────────────────────
  _updateWeather() {
    if (!this.weatherSys || !this._precip) return;
    const info = this.weatherSys.info ? this.weatherSys.info() : null;
    const kind = info ? info.current : 'clear';
    const active = kind === 'rain' || kind === 'storm' || kind === 'snow';
    this._precip.emitter.copyFrom ? this._precip.emitter.copyFrom(this.camTarget) : (this._precip.emitter = this.camTarget.clone());
    this._precip.emitRate = active ? (kind === 'storm' ? 900 : kind === 'snow' ? 300 : 600) : 0;
    if (kind === 'snow') { this._precip.gravity.y = -3; } else { this._precip.gravity.y = -18; }
  }

  // ─────────────────────── Frame ───────────────────────
  draw(traffic, citizens) {
    if (this.suggestMarker.isEnabled() && performance.now() > this._markUntil) this.suggestMarker.setEnabled(false);
    this._updateDayNight();
    this._updateVehicles(traffic);
    this._updateCitizens(citizens);
    this._updateWeather();
    // animate crane jibs / turbines / led rings
    const tm = performance.now() / 1000;
    for (const [, nodes] of this.tileMeshes) for (const node of nodes) {
      if (node._crane) node._crane.rotation.y = tm * 0.3;
      if (node._turbine) node._turbine.rotation.z = tm * 1.4;
      if (node._ledRing) node._ledRing.emissiveColor.set(0, Math.max(0, 0.5 + Math.sin(tm * 2) * 0.4), 1);
      if (node._beacon) node._beacon.emissiveColor.set(Math.sin(tm * 2.5) > 0.6 ? 1 : 0.1, 0, 0);
    }
    this.scene.render();
  }

  resize() { this.engine.resize(); }
}
