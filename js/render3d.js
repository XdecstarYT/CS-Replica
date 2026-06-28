/* render3d.js — Three.js 3D city renderer.
 * Original work. No proprietary assets. */

class Renderer3D {
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.grid = grid;
    this.T = 1.0; // 1 world unit per tile

    // ---- Scene ----
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x87ceeb, 50, 110);

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight || 1, 0.1, 200);
    this.camTarget = new THREE.Vector3(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this.camDist = 22;
    this.camPolar = 1.0;        // ~57° from vertical
    this.camAzimuth = 0.7;
    this._positionCamera();

    // ---- Renderer ----
    this.wgl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.wgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.wgl.shadowMap.enabled = true;
    this.wgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.wgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.wgl.toneMappingExposure = 1.1;
    this.wgl.outputColorSpace = THREE.SRGBColorSpace;

    // ---- Lights ----
    this._setupLights();

    // ---- Ground ----
    this._buildGround();

    // ---- Stars ----
    this._buildStars();

    // ---- Materials ----
    this._initMaterials();

    // ---- State ----
    this.tileMeshes = new Map();   // key "x,y" -> Mesh|Mesh[]
    this.levelCache = new Uint8Array(grid.w * grid.h).fill(255);
    this.vehicleMeshes = [];
    this.vehicleGeo = new THREE.BoxGeometry(0.22, 0.09, 0.14);
    this.timeOfDay = 0.35;
    this.nightFactor = 0;
    this.raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ---- Hover ----
    this._initHoverMesh();

    // ---- Build scene from grid ----
    this._buildWater();
    this.rebuildAll();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ─────────────────────── Setup helpers ───────────────────────

  _setupLights() {
    // Hemisphere — sky colour blends with scene
    this.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x3a6640, 0.5);
    this.scene.add(this.hemiLight);

    // Sun — main directional light with shadows
    this.sunLight = new THREE.DirectionalLight(0xfff2cc, 2.2);
    this.sunLight.castShadow = true;
    const sc = this.sunLight.shadow.camera;
    const sh = 45;
    sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh;
    sc.near = 0.5; sc.far = 200;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.bias = -0.0005;
    this.scene.add(this.sunLight);

    // Moon — cool dim fill at night
    this.moonLight = new THREE.DirectionalLight(0x5060e0, 0);
    this.scene.add(this.moonLight);

    // Ambient fill so nothing is pure black
    this.ambLight = new THREE.AmbientLight(0x304060, 0.4);
    this.scene.add(this.ambLight);
  }

  _buildGround() {
    const gw = this.grid.w, gh = this.grid.h, T = this.T;
    // Checkerboard canvas texture — painted once, tiled
    const tc = document.createElement('canvas');
    tc.width = tc.height = 128;
    const tctx = tc.getContext('2d');
    for (let gy = 0; gy < 8; gy++) {
      for (let gx = 0; gx < 8; gx++) {
        tctx.fillStyle = (gx + gy) % 2 ? '#2a5232' : '#2d5535';
        tctx.fillRect(gx * 16, gy * 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(tc);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(gw * 0.5, gh * 0.5);
    const geo = new THREE.PlaneGeometry(gw * T, gh * T);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(gw * T / 2, -0.002, gh * T / 2);
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);
  }

  _buildWater() {
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); this.waterMesh = null; }
    const g = this.grid, T = this.T;
    const verts = [], idx = [];
    let b = 0;
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
      if (g.type[g.idx(x, y)] !== TILE.WATER) continue;
      const x0 = x * T, z0 = y * T;
      verts.push(x0, -0.06, z0, x0+T, -0.06, z0, x0+T, -0.06, z0+T, x0, -0.06, z0+T);
      idx.push(b, b+1, b+2, b, b+2, b+3); b += 4;
    }
    if (!verts.length) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    this.waterMat = new THREE.MeshPhongMaterial({ color: 0x1a5f80, emissive: new THREE.Color(0x001428), shininess: 120, specular: new THREE.Color(0x88ccff), transparent: true, opacity: 0.9 });
    this.waterMesh = new THREE.Mesh(geo, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);
  }

  _buildStars() {
    const positions = [];
    for (let i = 0; i < 500; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45; // upper hemisphere
      const r = 130;
      const cx = this.camTarget.x, cz = this.camTarget.z;
      positions.push(cx + Math.cos(theta) * Math.sin(phi) * r, Math.cos(phi) * r + 5, cz + Math.sin(theta) * Math.sin(phi) * r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0 });
    this.starPoints = new THREE.Points(geo, this.starMat);
    this.scene.add(this.starPoints);
  }

  _initMaterials() {
    const Ph = THREE.MeshPhongMaterial;
    const La = THREE.MeshLambertMaterial;

    this.mats = {
      road: new La({ color: 0x2e333e }),
      roadMark: new Ph({ color: 0xd4b800, emissive: new THREE.Color(0x1a0e00), shininess: 5 }),
      roadEdge: new La({ color: 0x555a66 }),

      // Residential - earthy greens, 3 levels
      res: [null,
        new Ph({ color: 0x5cba70, shininess: 12, emissive: new THREE.Color(0) }),
        new Ph({ color: 0x48a85c, shininess: 20, emissive: new THREE.Color(0) }),
        new Ph({ color: 0x35924a, shininess: 30, emissive: new THREE.Color(0) })],

      // Commercial - steel blues, glass-ish
      com: [null,
        new Ph({ color: 0x5090e8, shininess: 70, specular: new THREE.Color(0xaaccff), emissive: new THREE.Color(0) }),
        new Ph({ color: 0x3870d0, shininess: 100, specular: new THREE.Color(0xbbddff), emissive: new THREE.Color(0) }),
        new Ph({ color: 0x1e50b8, shininess: 140, specular: new THREE.Color(0xcceeFF), emissive: new THREE.Color(0) })],

      // Industrial - ochres and browns
      ind: [null,
        new Ph({ color: 0xd4942a, shininess: 8, emissive: new THREE.Color(0) }),
        new Ph({ color: 0xb87a18, shininess: 12, emissive: new THREE.Color(0) }),
        new Ph({ color: 0x9c6408, shininess: 16, emissive: new THREE.Color(0) })],

      // Hover
      hoverOk: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
      hoverBad: new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.45 }),
    };
  }

  _initHoverMesh() {
    const geo = new THREE.BoxGeometry(this.T * 0.97, 0.08, this.T * 0.97);
    this.hoverMesh = new THREE.Mesh(geo, this.mats.hoverOk);
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // ─────────────────────── Tile RNG (deterministic per position) ───────────────────────

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }

  _buildingHeight(x, y, zone, level) {
    const rng = this._tileRng(x, y);
    const base = {
      [TILE.ZONE_RES]: [0, 0.40, 1.00, 1.90],
      [TILE.ZONE_COM]: [0, 0.50, 1.30, 3.20],
      [TILE.ZONE_IND]: [0, 0.55, 0.95, 1.50],
    };
    const vary = {
      [TILE.ZONE_RES]: [0, 0.10, 0.35, 0.80],
      [TILE.ZONE_COM]: [0, 0.10, 0.50, 1.80],
      [TILE.ZONE_IND]: [0, 0.15, 0.25, 0.40],
    };
    return base[zone][level] + vary[zone][level] * rng;
  }

  // ─────────────────────── Tile mesh builders ───────────────────────

  _removeTile(key) {
    const old = this.tileMeshes.get(key);
    if (!old) return;
    const list = Array.isArray(old) ? old : [old];
    for (const m of list) {
      if (m.isGroup) { m.children.forEach(c => { c.geometry && c.geometry.dispose(); }); }
      else { m.geometry && m.geometry.dispose(); }
      this.scene.remove(m);
    }
    this.tileMeshes.delete(key);
  }

  updateTile(x, y) {
    const key = `${x},${y}`;
    this._removeTile(key);
    const g = this.grid, T = this.T;
    const i = g.idx(x, y);
    const t = g.type[i];
    if (t === TILE.GRASS || t === TILE.WATER) return;

    const cx = x * T + T / 2, cz = y * T + T / 2;

    if (t === TILE.ROAD) {
      const meshes = this._buildRoad(x, y, cx, cz, T);
      meshes.forEach(m => this.scene.add(m));
      this.tileMeshes.set(key, meshes);
      return;
    }

    if (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) {
      const lvl = g.level[i];
      let mesh;
      if (lvl === 0) {
        mesh = this._buildZoneMarker(cx, cz, T, t);
      } else {
        mesh = this._buildBuilding(x, y, cx, cz, T, t, lvl);
      }
      mesh._zoneLevel = lvl;
      this.scene.add(mesh);
      this.tileMeshes.set(key, mesh);
      return;
    }

    if (t === TILE.SERVICE) {
      const svc = SERVICE_BY_ID[g.service[i]];
      const mesh = this._buildService(cx, cz, T, svc);
      this.scene.add(mesh);
      this.tileMeshes.set(key, mesh);
    }
  }

  _buildRoad(x, y, cx, cz, T) {
    const g = this.grid;
    const meshes = [];
    // Surface
    const surf = new THREE.Mesh(new THREE.BoxGeometry(T, 0.04, T), this.mats.road);
    surf.position.set(cx, 0.02, cz);
    surf.receiveShadow = true;
    meshes.push(surf);

    // Kerbs / edge strips
    const edgeH = 0.05, edgeW = 0.05;
    for (const [dx, dz, scaleX, scaleZ] of [
      [0, -T*0.5+edgeW/2, T, edgeW], [0, T*0.5-edgeW/2, T, edgeW],
      [-T*0.5+edgeW/2, 0, edgeW, T], [T*0.5-edgeW/2, 0, edgeW, T]
    ]) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(scaleX, edgeH, scaleZ), this.mats.roadEdge);
      e.position.set(cx + dx, edgeH / 2 + 0.02, cz + dz);
      meshes.push(e);
    }

    // Lane markings toward connected road tiles
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    for (const [ddx, ddz] of dirs) {
      const nx = x + ddx, nz = y + ddz;
      if (!g.inBounds(nx, nz) || g.type[g.idx(nx, nz)] !== TILE.ROAD) continue;
      const lw = ddx === 0 ? 0.04 : T * 0.35;
      const lh = 0.06;
      const ld = ddz === 0 ? 0.04 : T * 0.35;
      const ln = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, ld), this.mats.roadMark);
      ln.position.set(cx + ddx * T * 0.22, 0.03, cz + ddz * T * 0.22);
      meshes.push(ln);
    }
    return meshes;
  }

  _buildZoneMarker(cx, cz, T, zone) {
    const color = zone === TILE.ZONE_RES ? 0x1f3d27 : zone === TILE.ZONE_COM ? 0x142a42 : 0x3a2e0a;
    const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.75 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(T * 0.95, 0.03, T * 0.95), mat);
    m.position.set(cx, 0.015, cz);
    return m;
  }

  _buildBuilding(x, y, cx, cz, T, zone, level) {
    const h = this._buildingHeight(x, y, zone, level);
    const mats = zone === TILE.ZONE_RES ? this.mats.res : zone === TILE.ZONE_COM ? this.mats.com : this.mats.ind;
    const mat = mats[level];
    const footprint = 0.86 - level * 0.03;
    const fw = T * footprint, fh = T * footprint;
    const group = new THREE.Group();

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fh), mat);
    body.position.y = h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Flat roof detail for taller buildings
    if (level >= 2) {
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.7, 0.06, fh * 0.7), roofMat);
      roof.position.y = h + 0.03;
      group.add(roof);
    }

    // Antennas / water towers on top for variety
    const rng = this._tileRng(x + 7, y + 3);
    if (level === 3 && rng > 0.5) {
      const antMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.5), antMat);
      ant.position.set(fw * 0.25, h + 0.25, fh * 0.25);
      group.add(ant);
      if (rng > 0.75) {
        const ant2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35), antMat);
        ant2.position.set(-fw * 0.25, h + 0.175, -fh * 0.2);
        group.add(ant2);
      }
    }

    group.position.set(cx, 0, cz);
    group._zoneLevel = level;
    return group;
  }

  _buildService(cx, cz, T, svc) {
    const color = svc ? parseInt(svc.color.replace('#', ''), 16) : 0x888888;
    const group = new THREE.Group();
    const h = 0.6;
    const mat = new THREE.MeshPhongMaterial({ color, shininess: 30 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(T * 0.84, h, T * 0.84), mat);
    body.position.y = h / 2;
    body.castShadow = true;
    group.add(body);

    // Small indicator dome
    const domeMat = new THREE.MeshPhongMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.3), shininess: 80 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), domeMat);
    dome.position.set(0, h + 0.12, 0);
    group.add(dome);

    group.position.set(cx, 0, cz);
    return group;
  }

  rebuildAll() {
    // Remove existing tile meshes
    for (const [, v] of this.tileMeshes) {
      const list = Array.isArray(v) ? v : [v];
      for (const m of list) this.scene.remove(m);
    }
    this.tileMeshes.clear();
    this.levelCache.fill(255);

    const g = this.grid;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const t = g.type[g.idx(x, y)];
        if (t !== TILE.GRASS && t !== TILE.WATER) this.updateTile(x, y);
      }
    }
  }

  // Call each simulation tick — rebuild only tiles whose level changed.
  syncBuildings() {
    const g = this.grid;
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t !== TILE.ZONE_RES && t !== TILE.ZONE_COM && t !== TILE.ZONE_IND) continue;
      const lvl = g.level[i];
      if (this.levelCache[i] !== lvl) {
        this.levelCache[i] = lvl;
        this.updateTile(i % g.w, (i / g.w) | 0);
      }
    }
  }

  // ─────────────────────── Camera ───────────────────────

  _positionCamera() {
    const maxXZ = Math.max(this.grid.w, this.grid.h) * this.T;
    this.camTarget.x = Math.max(0, Math.min(this.grid.w * this.T, this.camTarget.x));
    this.camTarget.z = Math.max(0, Math.min(this.grid.h * this.T, this.camTarget.z));
    this.camDist = Math.max(5, Math.min(90, this.camDist));
    this.camPolar = Math.max(0.35, Math.min(Math.PI / 2.1, this.camPolar));

    const r = this.camDist, phi = this.camPolar, theta = this.camAzimuth;
    this.camera.position.set(
      this.camTarget.x + r * Math.sin(phi) * Math.sin(theta),
      r * Math.cos(phi),
      this.camTarget.z + r * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this.camTarget);
  }

  screenToTile(sx, sy) {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((sx - rect.left) / rect.width) * 2 - 1;
    const ny = -((sy - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera({ x: nx, y: ny }, this.camera);
    const pt = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this._groundPlane, pt)) return null;
    return { tx: Math.floor(pt.x / this.T), ty: Math.floor(pt.z / this.T) };
  }

  // ─────────────────────── Hover ───────────────────────

  setHover(tile, valid) {
    if (!tile || !this.grid.inBounds(tile.tx, tile.ty)) {
      this.hoverMesh.visible = false;
      return;
    }
    this.hoverMesh.position.set((tile.tx + 0.5) * this.T, 0.04, (tile.ty + 0.5) * this.T);
    this.hoverMesh.material = valid ? this.mats.hoverOk : this.mats.hoverBad;
    this.hoverMesh.visible = true;
  }

  // ─────────────────────── Day / Night ───────────────────────

  _updateDayNight() {
    const t = this.timeOfDay;
    // 0.25 = noon, 0.75 = midnight
    const n = this.nightFactor = (1 - Math.cos((t - 0.25) * Math.PI * 2)) / 2;
    const d = 1 - n;

    // Sun arc
    const sunAngle = (t - 0.25) * Math.PI * 2;
    const sunElev = Math.cos(sunAngle); // 1 = noon, -1 = midnight
    const cx = this.camTarget.x, cz = this.camTarget.z;
    this.sunLight.position.set(cx + Math.sin(sunAngle) * 60, sunElev * 80, cz - 40);
    this.sunLight.intensity = Math.max(0, sunElev * 2.4);

    // Moon
    this.moonLight.position.set(cx - Math.sin(sunAngle) * 60, -sunElev * 80 + 50, cz - 40);
    this.moonLight.intensity = Math.max(0, n * 0.35);

    this.ambLight.intensity = 0.08 + d * 0.35;
    this.hemiLight.intensity = 0.15 + d * 0.45;

    // Sky colour: day → dusk orange → night navy
    const daySky = new THREE.Color(0x87ceeb);
    const duskSky = new THREE.Color(0xe8602a);
    const nightSky = new THREE.Color(0x070e22);
    let sky;
    if (n < 0.5) {
      sky = daySky.lerp(duskSky, Math.sin(n * Math.PI) * 0.75);
    } else {
      sky = duskSky.clone().lerp(nightSky, (n - 0.5) * 2);
    }
    this.scene.background = sky;
    this.scene.fog.color.copy(sky);

    // Stars fade in
    this.starMat.opacity = Math.max(0, (n - 0.55) * 2.5);

    // Building window glow — shared materials update all instances
    const wi = Math.max(0, (n - 0.35) * 1.8);
    const glowR = 1.0 * wi, glowG = 0.58 * wi, glowB = 0.15 * wi;
    for (const mats of [this.mats.res, this.mats.com, this.mats.ind]) {
      const mul = mats === this.mats.ind ? 0.5 : 1.0;
      for (let l = 1; l <= 3; l++) mats[l].emissive.setRGB(glowR * mul, glowG * mul, glowB * mul);
    }

    // Water shimmer
    if (this.waterMat) {
      const tm = performance.now() / 1000;
      const br = 0.12 + d * 0.22 + Math.sin(tm * 1.2) * 0.03;
      this.waterMat.emissive.setRGB(br * 0.05, br * 0.18, br * 0.38);
      this.waterMat.shininess = 80 + d * 60;
    }

    // Tone mapping exposure — slightly warmer at dusk
    this.wgl.toneMappingExposure = 0.95 + d * 0.2 + Math.max(0, Math.sin(n * Math.PI) * 0.25);
  }

  // ─────────────────────── Traffic ───────────────────────

  _updateVehicles(traffic) {
    if (!traffic) return;
    const veh = traffic.vehicles, T = this.T;

    while (this.vehicleMeshes.length > veh.length) {
      const m = this.vehicleMeshes.pop();
      this.scene.remove(m);
      m.geometry.dispose();
    }
    while (this.vehicleMeshes.length < veh.length) {
      const m = new THREE.Mesh(this.vehicleGeo, new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 40 }));
      m.castShadow = false;
      this.scene.add(m);
      this.vehicleMeshes.push(m);
    }

    const n = this.nightFactor;
    for (let k = 0; k < veh.length; k++) {
      const v = veh[k];
      const dx = v.nx - v.x, dz = v.ny - v.y;
      const wx = (v.x + dx * v.t + 0.5 - dz * 0.18) * T;
      const wz = (v.y + dz * v.t + 0.5 + dx * 0.18) * T;
      const m = this.vehicleMeshes[k];
      m.position.set(wx, 0.065, wz);
      if (dx !== 0 || dz !== 0) m.rotation.y = Math.atan2(-dx, -dz);
      m.material.color.set(v.color);
      // Headlights at night — warm emissive glow on vehicle body
      const hi = Math.max(0, (n - 0.45) * 0.9);
      m.material.emissive.setRGB(hi, hi * 0.85, hi * 0.4);
    }
  }

  // ─────────────────────── Main draw ───────────────────────

  draw(traffic) {
    this._updateDayNight();
    this._updateVehicles(traffic);
    this.wgl.render(this.scene, this.camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.wgl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ─────────────────────── Grid swap ───────────────────────

  setGrid(grid) {
    this.grid = grid;
    for (const [, v] of this.tileMeshes) {
      const list = Array.isArray(v) ? v : [v];
      list.forEach(m => this.scene.remove(m));
    }
    this.tileMeshes.clear();
    this.levelCache = new Uint8Array(grid.w * grid.h).fill(255);
    for (const m of this.vehicleMeshes) this.scene.remove(m);
    this.vehicleMeshes.length = 0;
    this._buildWater();
    this.rebuildAll();
    this.camTarget.set(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this._positionCamera();
  }
}
