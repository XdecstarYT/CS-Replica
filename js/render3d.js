/* render3d.js — Three.js 3D city renderer (PBR).
 * Original work. No proprietary assets. */

class Renderer3D {
  constructor(canvas, grid) {
    this.canvas = canvas;
    this.grid = grid;
    this.T = 1.0; // 1 world unit per tile

    // ---- Scene ----
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x87ceeb, 0.011);

    // ---- Camera ----
    this.camera = new THREE.PerspectiveCamera(50, canvas.clientWidth / canvas.clientHeight || 1, 0.1, 240);
    this.camTarget = new THREE.Vector3(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this.camDist = 22;
    this.camPolar = 1.0;        // ~57° from vertical
    this.camAzimuth = 0.7;
    this._positionCamera();

    // ---- Renderer ----
    this.wgl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.wgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.wgl.shadowMap.enabled = true;
    this.wgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.wgl.toneMapping = THREE.ACESFilmicToneMapping;
    this.wgl.toneMappingExposure = 1.1;
    this.wgl.outputColorSpace = THREE.SRGBColorSpace;

    // ---- Models (built early; textures used by ground/road) ----
    this.models = new ModelBuilder();

    // ---- Lights / sky / ground ----
    this._setupLights();
    this._buildEnvironment();   // PMREM sky reflections for glass + car paint
    this._buildSkyDome();
    this._buildGround();
    this._buildStars();
    this._buildClouds();
    this._initMaterials();
    this._buildOverlay();

    // ---- State ----
    this.tileMeshes = new Map();   // key "x,y" -> Mesh|Mesh[]|Group
    this.levelCache = new Uint8Array(grid.w * grid.h).fill(255);
    this.vehiclePool  = [];
    this.citizenPool  = [];
    this.accidentPool = [];        // pooled crash markers (cones + smoke)
    this.timeOfDay = 0.35;
    this.nightFactor = 0;
    this.overlayMode = null;
    this.construction = null;       // set by Game; drives staged build-site visuals
    this._bldSig = null;            // per-tile visual signature cache (built level / construction stage)
    this._winDirty = true;
    this._lastWin = -1;
    this.weatherSys = null;        // set by Game; drives sky/fog/precipitation
    this._buildWeather();
    this.raycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    // ---- Hover ----
    this._initHoverMesh();
    this._initSuggestMarker();

    // ---- Build scene from grid ----
    this._buildWater();
    this.rebuildAll();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ─────────────────────── Setup helpers ───────────────────────

  // Image-based lighting: a soft sky→ground gradient turned into a prefiltered
  // environment map. Every PBR material picks it up automatically — glass towers
  // gain real sky reflections and car paint reads as glossy clear-coat.
  _buildEnvironment() {
    try {
      const pmrem = new THREE.PMREMGenerator(this.wgl);
      const c = document.createElement('canvas'); c.width = 256; c.height = 128;
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, 128);
      g.addColorStop(0.00, '#b9dcff');   // zenith
      g.addColorStop(0.46, '#dcebf7');   // horizon haze
      g.addColorStop(0.52, '#aeb6bd');   // ground line
      g.addColorStop(1.00, '#6c7177');   // ground bounce
      ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 128);
      // a soft sun spot for a believable highlight
      const sun = ctx.createRadialGradient(190, 34, 2, 190, 34, 34);
      sun.addColorStop(0, 'rgba(255,250,235,0.95)'); sun.addColorStop(1, 'rgba(255,250,235,0)');
      ctx.fillStyle = sun; ctx.fillRect(150, 0, 90, 70);
      const tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const rt = pmrem.fromEquirectangular(tex);
      this.scene.environment = rt.texture;
      this._envMap = rt.texture;
      tex.dispose(); pmrem.dispose();
    } catch (e) { /* environment optional — scene still renders */ }
  }

  _setupLights() {
    // Hemisphere — sky blue top, warm green ground bounce for physically plausible fill
    this.hemiLight = new THREE.HemisphereLight(0x9ed8ff, 0x3a5c30, 0.6);
    this.scene.add(this.hemiLight);

    // Sun — main directional PBR light with high-quality shadow
    this.sunLight = new THREE.DirectionalLight(0xfff0d0, 2.4);
    this.sunLight.castShadow = true;
    const sc = this.sunLight.shadow.camera;
    const sh = 50;
    sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh;
    sc.near = 0.5; sc.far = 240;
    this.sunLight.shadow.mapSize.set(3072, 3072);
    this.sunLight.shadow.bias = -0.0003;
    this.sunLight.shadow.normalBias = 0.018;
    this.sunLight.shadow.radius = 1.5;  // PCF soft shadow
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Moon — cool blue-violet fill at night
    this.moonLight = new THREE.DirectionalLight(0x5568e8, 0);
    this.scene.add(this.moonLight);

    // Warm bounce fill from the opposite side (no shadows) for soft wraparound shading
    this.fillLight = new THREE.DirectionalLight(0xffd4a0, 0.28);
    this.scene.add(this.fillLight);

    // City ambient — cool dark blue floor so nothing is pure black
    this.ambLight = new THREE.AmbientLight(0x2a3f5a, 0.5);
    this.scene.add(this.ambLight);

    // Point light for warm city centre glow at night (dim during day)
    const gw = this.grid.w, gh = this.grid.h, T = this.T;
    this.cityGlowLight = new THREE.PointLight(0xff8844, 0, 80);
    this.cityGlowLight.position.set(gw * T / 2, 8, gh * T / 2);
    this.cityGlowLight.decay = 1.5;
    this.scene.add(this.cityGlowLight);
  }

  // ── Procedural sky dome with atmospheric gradient shader ──
  _buildSkyDome() {
    const vertexShader = `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`;
    const fragmentShader = `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunDir;
      uniform float uSunIntensity;
      varying vec3 vWorldPos;
      void main() {
        vec3 dir = normalize(vWorldPos - vec3(${this.grid.w * 0.5}, 0.0, ${this.grid.h * 0.5}));
        float h = clamp(dir.y, -1.0, 1.0);
        // Sky gradient: zenith → horizon
        vec3 sky = mix(uHorizon, uZenith, clamp(h * 2.0, 0.0, 1.0));
        // Below horizon: ground haze
        if (h < 0.0) sky = mix(uGround, uHorizon, clamp(1.0 + h * 6.0, 0.0, 1.0));
        // Sun disc + corona
        float sunDot = dot(dir, normalize(uSunDir));
        float corona = pow(max(0.0, sunDot), 140.0) * uSunIntensity;
        float glow   = pow(max(0.0, sunDot), 12.0) * 0.25 * uSunIntensity;
        sky += vec3(1.0, 0.85, 0.55) * corona + vec3(1.0, 0.6, 0.2) * glow;
        gl_FragColor = vec4(sky, 1.0);
      }`;
    const gw = this.grid.w, gh = this.grid.h;
    this._skyUniforms = {
      uZenith:       { value: new THREE.Color(0x1a3a6e) },
      uHorizon:      { value: new THREE.Color(0x87ceeb) },
      uGround:       { value: new THREE.Color(0x2a3a28) },
      uSunDir:       { value: new THREE.Vector3(0, 1, 0) },
      uSunIntensity: { value: 1.0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this._skyUniforms, vertexShader, fragmentShader,
      side: THREE.BackSide, depthWrite: false,
    });
    const skyGeo = new THREE.SphereGeometry(180, 32, 20);
    this.skyDome = new THREE.Mesh(skyGeo, skyMat);
    this.skyDome.position.set(gw * this.T / 2, 0, gh * this.T / 2);
    this.skyDome.renderOrder = -10;
    this.scene.add(this.skyDome);
  }

  _buildGround() {
    const gw = this.grid.w, gh = this.grid.h, T = this.T;
    const tex = this.models._grassTex();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(gw * 0.55, gh * 0.55);
    const geo = new THREE.PlaneGeometry(gw * T, gh * T, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.96, metalness: 0.0, color: 0xdfeede });
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
    this.waterMat = new THREE.MeshStandardMaterial({
      color: 0x1262a0, roughness: 0.04, metalness: 0.55,
      emissive: new THREE.Color(0x001830), transparent: true, opacity: 0.88,
      envMapIntensity: 1.4,
    });
    this.waterMesh = new THREE.Mesh(geo, this.waterMat);
    this.waterMesh.receiveShadow = true;
    this.scene.add(this.waterMesh);
  }

  _buildStars() {
    const positions = [];
    const cx = this.camTarget.x, cz = this.camTarget.z;
    for (let i = 0; i < 600; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45; // upper hemisphere
      const r = 135;
      positions.push(cx + Math.cos(theta) * Math.sin(phi) * r, Math.cos(phi) * r + 5, cz + Math.sin(theta) * Math.sin(phi) * r);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0 });
    this.starPoints = new THREE.Points(geo, this.starMat);
    this.scene.add(this.starPoints);
  }

  _buildClouds() {
    this.clouds = [];
    this.cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1.0, metalness: 0.0,
      transparent: true, opacity: 0.85, emissive: new THREE.Color(0x0a0f18),
    });
    const gw = this.grid.w, gh = this.grid.h;
    this.cloudSpan = gw + 40;
    const puffGeo = new THREE.SphereGeometry(1, 7, 6);
    this.sharedCloudGeo = puffGeo;
    for (let i = 0; i < 16; i++) {
      const group = new THREE.Group();
      const puffs = 4 + (Math.random() * 4 | 0);
      const scale = 1.6 + Math.random() * 2.4;
      for (let p = 0; p < puffs; p++) {
        const puff = new THREE.Mesh(puffGeo, this.cloudMat);
        puff.scale.set(
          scale * (0.6 + Math.random() * 0.7),
          scale * (0.32 + Math.random() * 0.18),
          scale * (0.6 + Math.random() * 0.7)
        );
        puff.position.set((Math.random() - 0.5) * scale * 2.4, (Math.random() - 0.5) * scale * 0.4, (Math.random() - 0.5) * scale * 2.4);
        group.add(puff);
      }
      group.position.set(
        Math.random() * this.cloudSpan - 20,
        17 + Math.random() * 12,
        Math.random() * (gh + 20) - 10
      );
      group.renderOrder = -1;
      this.scene.add(group);
      this.clouds.push({ group, speed: 0.18 + Math.random() * 0.35, baseZ: group.position.z });
    }
  }

  // ─────────────────────── Weather (precipitation) ───────────────────────
  _buildWeather() {
    // A single recycled point cloud handles rain & snow. Particles fall within
    // a moving box centred on the camera target; cheap and scales independently
    // of city size.
    const N = 1400;
    this._precipCount = N;
    const pos = new Float32Array(N * 3);
    this._precipVel = new Float32Array(N);     // fall speed per particle
    this._precipBox = 46;                       // half-extent of the spawn box
    for (let i = 0; i < N; i++) {
      pos[i * 3]     = (Math.random() - 0.5) * this._precipBox * 2;
      pos[i * 3 + 1] = Math.random() * 30;
      pos[i * 3 + 2] = (Math.random() - 0.5) * this._precipBox * 2;
      this._precipVel[i] = 0.5 + Math.random() * 0.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this._precipGeo = geo;
    this._precipMat = new THREE.PointsMaterial({
      color: 0xaecbff, size: 0.10, transparent: true, opacity: 0.0,
      depthWrite: false, sizeAttenuation: true,
    });
    this._precip = new THREE.Points(geo, this._precipMat);
    this._precip.frustumCulled = false;
    this._precip.visible = false;
    this._precip.renderOrder = 5;
    this.scene.add(this._precip);
  }

  _updateWeather(d) {
    const sys = this.weatherSys;
    if (!sys || !this._precip) return;
    const info = sys.info();
    const kind = info.current;
    const intensity = info.intensity;
    const isRain = kind === 'rain' || kind === 'storm';
    const isSnow = kind === 'snow';
    const active = isRain || isSnow;

    // Precipitation particles
    this._precip.visible = active;
    if (active) {
      const cx = this.camTarget.x, cz = this.camTarget.z;
      const pos = this._precipGeo.attributes.position.array;
      const box = this._precipBox;
      const fall = (isSnow ? 0.10 : 0.55) * (0.6 + intensity);
      const drift = isSnow ? 0.06 : 0.0;
      for (let i = 0; i < this._precipCount; i++) {
        let y = pos[i * 3 + 1] - fall * this._precipVel[i];
        if (y < 0) {
          y = 26 + Math.random() * 6;
          pos[i * 3]     = (Math.random() - 0.5) * box * 2;
          pos[i * 3 + 2] = (Math.random() - 0.5) * box * 2;
        }
        pos[i * 3 + 1] = y;
        if (drift) pos[i * 3] += Math.sin((y + i) * 0.6) * drift;
      }
      // keep the field following the camera
      this._precip.position.set(cx, 0, cz);
      this._precipGeo.attributes.position.needsUpdate = true;
      this._precipMat.color.setHex(isSnow ? 0xffffff : 0xaecbff);
      this._precipMat.size = isSnow ? 0.16 : 0.09;
      this._precipMat.opacity = (isSnow ? 0.85 : 0.5) * Math.min(1, 0.4 + intensity);
    }

    // Sky / fog / light modulation by weather (multiplicative on day/night)
    const w = info.weather;
    const overcast = (w.cloud || 0) * intensity;
    if (overcast > 0.01) {
      // desaturate & darken sky toward storm-grey
      const grey = new THREE.Color(0x5a6472);
      this.scene.background.lerp(grey, overcast * 0.6 * d);
      this.scene.fog.color.lerp(grey, overcast * 0.6 * d);
    }
    // Fog thickens with rain/snow/fog weather
    const extraFog = (w.fog || 0) * 0.02 * intensity + (w.precip || 0) * 0.006 * intensity;
    this.scene.fog.density = 0.011 + extraFog;
    // Dim the sun under heavy cloud
    if (overcast > 0.01) this.sunLight.intensity *= (1 - overcast * 0.5);
  }

  _initMaterials() {
    const m = this.models;
    const asphalt = m._asphaltTex();
    asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;

    this.mats = {
      road: new THREE.MeshStandardMaterial({ map: asphalt, color: 0x6b6f78, roughness: 0.92, metalness: 0.04 }),
      roadMark: new THREE.MeshStandardMaterial({ color: 0xe8d24a, roughness: 0.5, metalness: 0, emissive: new THREE.Color(0x1a1400) }),
      roadEdge: new THREE.MeshStandardMaterial({ color: 0x9aa0ac, roughness: 0.7, metalness: 0.05 }),

      // Hover
      hoverOk: new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.45 }),
      hoverBad: new THREE.MeshBasicMaterial({ color: 0xf87171, transparent: true, opacity: 0.45 }),
    };
  }

  _buildOverlay() {
    const g = this.grid, T = this.T;
    const c = document.createElement('canvas');
    c.width = g.w; c.height = g.h;
    this._overlayCanvas = c;
    this._overlayCtx = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    this._overlayTex = tex;
    const geo = new THREE.PlaneGeometry(g.w * T, g.h * T);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.6, depthWrite: false });
    this.overlayMesh = new THREE.Mesh(geo, mat);
    this.overlayMesh.rotation.x = -Math.PI / 2;
    this.overlayMesh.position.set(g.w * T / 2, 0.08, g.h * T / 2);
    this.overlayMesh.visible = false;
    this.overlayMesh.renderOrder = 5;
    this.scene.add(this.overlayMesh);
  }

  _initHoverMesh() {
    const geo = new THREE.BoxGeometry(this.T * 0.97, 0.08, this.T * 0.97);
    this.hoverMesh = new THREE.Mesh(geo, this.mats.hoverOk);
    this.hoverMesh.visible = false;
    this.scene.add(this.hoverMesh);
  }

  // A glowing beacon ARIA drops on a tile it recommends.
  _initSuggestMarker() {
    const grp = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({ color: 0x38ffe0, transparent: true, opacity: 0.45, depthWrite: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(this.T * 0.16, this.T * 0.30, 3.2, 14, 1, true), beamMat);
    beam.position.y = 1.6; grp.add(beam);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38ffe0, transparent: true, opacity: 0.9, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(this.T * 0.40, 0.03, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; grp.add(ring);
    grp.visible = false;
    this.scene.add(grp);
    this.suggestMarker = grp;
    this._suggestBeam = beam; this._suggestRing = ring;
    this._markUntil = 0;
  }

  markTile(x, y) {
    if (!this.grid.inBounds(x, y)) return;
    this.suggestMarker.position.set((x + 0.5) * this.T, 0, (y + 0.5) * this.T);
    this.suggestMarker.visible = true;
    this._markUntil = performance.now() + 9000;
    this.panTo(x, y);
  }

  clearMark() { this.suggestMarker.visible = false; }

  panTo(x, y) {
    this.camTarget.x = (x + 0.5) * this.T;
    this.camTarget.z = (y + 0.5) * this.T;
    this._positionCamera();
  }

  _animateMarker() {
    if (!this.suggestMarker.visible) return;
    if (performance.now() > this._markUntil) { this.suggestMarker.visible = false; return; }
    const tm = performance.now() / 1000;
    const s = 1 + Math.sin(tm * 4) * 0.12;
    this._suggestRing.scale.set(s, s, s);
    this.suggestMarker.rotation.y = tm * 0.8;
    this._suggestBeam.material.opacity = 0.30 + Math.abs(Math.sin(tm * 3)) * 0.25;
  }

  // ─────────────────────── Tile RNG (deterministic per position) ───────────────────────

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }

  // ─────────────────────── Tile mesh builders ───────────────────────

  _removeTile(key) {
    const old = this.tileMeshes.get(key);
    if (!old) return;
    const shared = this.models.sharedGeos;
    const list = Array.isArray(old) ? old : [old];
    for (const m of list) {
      m.traverse(o => { if (o.geometry && !shared.has(o.geometry)) o.geometry.dispose(); });
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
    const cx = x * T + T / 2, cz = y * T + T / 2;

    // Road under construction (tile is still grass until paving finishes).
    const rproj = this.construction && this.construction.roadAt(i);
    if (rproj) {
      const site = this.models.buildRoadSite(T, rproj.stage, this.models._hash(x, y));
      site.position.set(cx, 0, cz);
      this.scene.add(site);
      this.tileMeshes.set(key, site);
      return;
    }

    if (t === TILE.GRASS || t === TILE.WATER) return;

    if (t === TILE.ROAD) {
      const meshes = this._buildRoad(x, y, cx, cz, T);
      meshes.forEach(mm => this.scene.add(mm));
      this.tileMeshes.set(key, meshes);
      return;
    }

    if (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) {
      const built = g.built ? g.built[i] : g.level[i];
      const proj = this.construction && this.construction.projectAt(i);
      let mesh;
      if (proj && proj.stage < 1) {
        mesh = this.models.buildConstructionSite(t, T, proj.target, proj.stage, this.models._hash(x, y));
        mesh.position.set(cx, 0, cz);
      } else if (built === 0) {
        mesh = this._buildZoneMarker(cx, cz, T, t);
      } else {
        mesh = this._buildBuilding(x, y, cx, cz, T, t, built);
      }
      mesh._zoneLevel = built;
      this.scene.add(mesh);
      this.tileMeshes.set(key, mesh);
      this._winDirty = true;
      return;
    }

    if (t === TILE.SERVICE) {
      const svc = SERVICE_BY_ID[g.service[i]];
      const mesh = this._buildService(x, y, cx, cz, T, svc);
      this.scene.add(mesh);
      this.tileMeshes.set(key, mesh);
      this._winDirty = true;
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
    let roadNbrs = 0;
    for (const [ddx, ddz] of dirs) {
      const nx = x + ddx, nz = y + ddz;
      if (!g.inBounds(nx, nz) || g.type[g.idx(nx, nz)] !== TILE.ROAD) continue;
      roadNbrs++;
      const lw = ddx === 0 ? 0.04 : T * 0.35;
      const lh = 0.06;
      const ld = ddz === 0 ? 0.04 : T * 0.35;
      const ln = new THREE.Mesh(new THREE.BoxGeometry(lw, lh, ld), this.mats.roadMark);
      ln.position.set(cx + ddx * T * 0.22, 0.03, cz + ddz * T * 0.22);
      meshes.push(ln);
    }

    // Street lamp — every other tile, on the +x/+z corner, arm angled to centre.
    if (((x + y) & 1) === 0) {
      const lamp = this.models.buildStreetLamp();
      lamp.position.set(cx + T * 0.40, 0.02, cz + T * 0.40);
      lamp.rotation.y = Math.PI * 0.75;
      meshes.push(lamp);
    }

    // Traffic light at intersections (3+ connected roads).
    if (roadNbrs >= 3) {
      const tl = this.models.buildTrafficLight();
      tl.position.set(cx - T * 0.40, 0.02, cz - T * 0.40);
      tl.rotation.y = -Math.PI * 0.25;
      meshes.push(tl);
    }
    return meshes;
  }

  _buildZoneMarker(cx, cz, T, zone) {
    const color = zone === TILE.ZONE_RES ? 0x1f3d27 : zone === TILE.ZONE_COM ? 0x142a42 : 0x3a2e0a;
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, transparent: true, opacity: 0.78 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(T * 0.95, 0.03, T * 0.95), mat);
    m.position.set(cx, 0.015, cz);
    return m;
  }

  _buildBuilding(x, y, cx, cz, T, zone, level) {
    const rng = this._tileRng(x, y);
    let group;
    if (zone === TILE.ZONE_RES)      group = this.models.buildResidential(x, y, T, level, rng);
    else if (zone === TILE.ZONE_COM) group = this.models.buildCommercial(x, y, T, level, rng);
    else                             group = this.models.buildIndustrial(x, y, T, level, rng);
    this._mergeStatic(group);        // batch static meshes by material → far fewer draw calls
    group.position.set(cx, 0, cz);
    group._zoneLevel = level;
    return group;
  }

  // Performance: merge a building's many static MeshStandard children into one
  // mesh per material (transforms baked in), collapsing ~30–50 draw calls per
  // building to a handful. Animated/self-lit parts (beacons, LED rings on
  // MeshBasic materials, nested groups) are left untouched, and the facade
  // material reference is preserved so night-window glow still works.
  _mergeStatic(group) {
    try {
      const byMat = new Map();
      const remove = [];
      for (const ch of group.children) {
        if (!ch.isMesh) continue;                                   // skip nested groups
        const m = ch.material;
        if (!m || !m.isMeshStandardMaterial) continue;              // keep basic-mat (beacon/LED/halo)
        if (ch === group._beacon || ch === group._windTurbine) continue;
        if (!ch.geometry || !ch.geometry.attributes || !ch.geometry.attributes.position) continue;
        let arr = byMat.get(m); if (!arr) { arr = []; byMat.set(m, arr); }
        ch.updateMatrix();
        const src = ch.geometry.index ? ch.geometry.toNonIndexed() : ch.geometry.clone();
        src.applyMatrix4(ch.matrix);
        arr.push(src);
        remove.push(ch);
      }
      if (byMat.size === 0) return;
      for (const ch of remove) {
        group.remove(ch);
        if (ch.geometry && !this.models.sharedGeos.has(ch.geometry)) ch.geometry.dispose();
      }
      for (const [mat, geos] of byMat) {
        const merged = this._concatGeos(geos);
        geos.forEach(g => g.dispose());
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
      }
    } catch (e) { /* on any failure leave the group unmerged — correctness over speed */ }
  }

  // Concatenate non-indexed BufferGeometries (position/normal/uv) into one.
  _concatGeos(geos) {
    let total = 0;
    for (const g of geos) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    let v = 0;
    for (const g of geos) {
      const c = g.attributes.position.count;
      pos.set(g.attributes.position.array, v * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, v * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, v * 2);
      v += c;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }

  _buildService(x, y, cx, cz, T, svc) {
    const id = svc && svc.id;
    let group;
    if (id === 'datacenter')   group = this.models.buildAIDatacenter(T);
    else if (id === 'aihub')   group = this.models.buildAIHub(T);
    else if (id === 'hospital')group = this.models.buildHospital(T);
    else if (id === 'park')    group = this.models.buildPark(T, this._tileRng(x, y));
    else                       group = this._buildServiceClassic(T, svc);
    group.position.set(cx, 0, cz);
    return group;
  }

  _buildServiceClassic(T, svc) {
    const color = svc ? parseInt(svc.color.replace('#', ''), 16) : 0x888888;
    const id = svc && svc.id;
    const group = new THREE.Group();
    const h = 0.62;
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.7, metalness: 0.05 });
    const accentMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2, emissive: new THREE.Color(color).multiplyScalar(0.06) });
    const winMat = new THREE.MeshStandardMaterial({ color: 0x9ad4f5, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.6 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(T * 0.82, h, T * 0.82), wallMat);
    body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

    // Coloured fascia band identifies the service
    const band = new THREE.Mesh(new THREE.BoxGeometry(T * 0.86, 0.10, T * 0.86), accentMat);
    band.position.y = h - 0.05; group.add(band);

    // Front window strip
    const win = new THREE.Mesh(new THREE.BoxGeometry(T * 0.6, h * 0.4, 0.01), winMat);
    win.position.set(0, h * 0.38, T * 0.41 + 0.004); group.add(win);

    // Per-service rooftop flair
    if (id === 'power') {
      const stackMat = new THREE.MeshStandardMaterial({ color: 0x999088, roughness: 0.7, metalness: 0.1 });
      for (const sx of [-0.18, 0.0, 0.18]) {
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.34, 8), stackMat);
        stack.position.set(sx, h + 0.17, -0.18); stack.castShadow = true; group.add(stack);
      }
    } else if (id === 'wind') {
      const towerMat = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, metalness: 0.2 });
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.03, 0.7, 8), towerMat);
      tower.position.set(0, h + 0.35, 0); group.add(tower);
      const hub = new THREE.Group(); hub.position.set(0, h + 0.68, 0.03);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.30, 0.05), towerMat);
        blade.position.y = 0.15; blade.geometry.translate(0, 0, 0);
        const arm = new THREE.Group(); arm.rotation.z = i * Math.PI * 2 / 3; arm.add(blade); hub.add(arm);
      }
      group.add(hub); group._windTurbine = hub;
    } else if (id === 'water') {
      const tankMat = new THREE.MeshStandardMaterial({ color: 0x6fb7e0, roughness: 0.35, metalness: 0.2 });
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.2, 12), tankMat);
      tank.position.set(0, h + 0.34, 0); tank.castShadow = true; group.add(tank);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.1, 12), tankMat);
      cap.position.set(0, h + 0.49, 0); group.add(cap);
      for (let i = 0; i < 4; i++) {
        const ang = i * Math.PI / 2;
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.24, 5), tankMat);
        leg.position.set(Math.cos(ang) * 0.11, h + 0.12, Math.sin(ang) * 0.11); group.add(leg);
      }
    } else if (id === 'police' || id === 'fire') {
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshBasicMaterial({ color: id === 'fire' ? 0xff2200 : 0x2266ff }));
      beacon._isBeacon = true; beacon.position.set(0, h + 0.12, 0); group.add(beacon);
      group._beacon = beacon;
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), accentMat);
      mast.position.set(0.3, h + 0.08, -0.3); group.add(mast);
    } else if (id === 'school') {
      const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a4b2a, roughness: 0.85, metalness: 0 });
      const roof = new THREE.Mesh(this.models._gabledRoofGeo(T * 0.86, T * 0.86, 0.26, 0.04), roofMat);
      roof.position.y = h; roof.castShadow = true; group.add(roof);
      const flag = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 4), accentMat);
      flag.position.set(0.28, h + 0.28, 0.28); group.add(flag);
    } else if (id === 'health') {
      const crossMat = new THREE.MeshStandardMaterial({ color: 0xdd1111, roughness: 0.5, metalness: 0.1, emissive: new THREE.Color(0.08, 0, 0) });
      const ch = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.012), crossMat);
      ch.position.set(0, h * 0.6, T * 0.41 + 0.01); group.add(ch);
      const cv = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.012), crossMat);
      cv.position.set(0, h * 0.6, T * 0.41 + 0.01); group.add(cv);
    } else {
      const domeMat = new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.2), roughness: 0.3, metalness: 0.2 });
      const dome = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), domeMat);
      dome.position.set(0, h + 0.12, 0); group.add(dome);
    }
    group._windowMats = [winMat];
    return group;
  }

  rebuildAll() {
    for (const [, v] of this.tileMeshes) {
      const list = Array.isArray(v) ? v : [v];
      for (const m of list) this.scene.remove(m);
    }
    this.tileMeshes.clear();
    this.levelCache.fill(255);

    const g = this.grid, c = this.construction;
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = g.idx(x, y), t = g.type[i];
        // Draw finished tiles, plus any road still under construction (grass tile).
        if ((t !== TILE.GRASS && t !== TILE.WATER) || (c && c.isRoadActive(i))) this.updateTile(x, y);
      }
    }
    this._snapshotSigs();   // signatures now match what was just drawn
    if (this._roadSig) this._roadSig.fill(-1);
    this._winDirty = true;
  }

  // A tile's visual signature: its finished built-level, or — while a
  // construction project is live — its target level + current build stage, so
  // sites are re-drawn only when they cross a stage boundary (cheap).
  _tileSig(i) {
    const g = this.grid;
    const built = g.built ? g.built[i] : g.level[i];
    const proj = this.construction && this.construction.projectAt(i);
    return (proj && proj.stage < 1)
      ? 1000 + proj.target * 10 + this.construction.stageIndex(proj.stage)
      : built;
  }

  // Record the current signatures without re-rendering (visuals assumed fresh,
  // e.g. right after rebuildAll).
  _snapshotSigs() {
    const g = this.grid;
    if (!this._bldSig || this._bldSig.length !== g.type.length) this._bldSig = new Int32Array(g.type.length);
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      this._bldSig[i] = (t === TILE.ZONE_RES || t === TILE.ZONE_COM || t === TILE.ZONE_IND) ? this._tileSig(i) : -999;
    }
  }

  // Call each simulation tick — rebuild only tiles whose visual state changed.
  syncBuildings() {
    const g = this.grid;
    if (!this._bldSig || this._bldSig.length !== g.type.length) { this._snapshotSigs(); return; }
    for (let i = 0; i < g.type.length; i++) {
      const t = g.type[i];
      if (t !== TILE.ZONE_RES && t !== TILE.ZONE_COM && t !== TILE.ZONE_IND) { this._bldSig[i] = -999; continue; }
      const sig = this._tileSig(i);
      if (this._bldSig[i] !== sig) {
        this._bldSig[i] = sig;
        this.updateTile(i % g.w, (i / g.w) | 0);
      }
    }
  }

  // Re-render road-works tiles whose paving stage advanced, and when a road
  // finishes, re-render it plus its road neighbours so lane markings connect.
  syncRoads() {
    const g = this.grid, c = this.construction;
    if (!c) return;
    if (!this._roadSig || this._roadSig.length !== g.type.length) this._roadSig = new Int32Array(g.type.length).fill(-1);
    // Active road-works: redraw on stage-bucket change.
    for (const [i, p] of c.roads) {
      const sig = 2000 + (c.stageIndex ? c.stageIndex(p.stage) : (p.stage * 4 | 0));
      if (this._roadSig[i] !== sig) { this._roadSig[i] = sig; this.updateTile(i % g.w, (i / g.w) | 0); }
    }
    // Tiles that finished paving this tick → become real roads + refresh neighbours.
    if (c._roadDone && c._roadDone.length) {
      for (const i of c._roadDone) {
        this._roadSig[i] = -1;
        const x = i % g.w, y = (i / g.w) | 0;
        this.updateTile(x, y);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, nz = y + dz;
          if (g.inBounds(nx, nz) && g.type[g.idx(nx, nz)] === TILE.ROAD) this.updateTile(nx, nz);
        }
      }
      c._roadDone.length = 0;
    }
  }

  // ─────────────────────── Heat-map overlay (drives AI visualisation) ───────────────────────

  setOverlay(mode, sim) {
    this.overlayMode = mode || null;
    this.overlayMesh.visible = !!this.overlayMode;
    if (this.overlayMode && sim) this.updateOverlay(sim);
  }

  updateOverlay(sim) {
    if (!this.overlayMode || !this.overlayMesh.visible) return;
    const g = this.grid, ctx = this._overlayCtx, mode = this.overlayMode;
    const f = sim.fields;
    ctx.clearRect(0, 0, g.w, g.h);
    for (let y = 0; y < g.h; y++) {
      for (let x = 0; x < g.w; x++) {
        const i = g.idx(x, y);
        let v = 0, col = null;
        if (mode === 'power')        { v = g.power[i] ? 1 : 0; col = [250, 204, 21]; }
        else if (mode === 'water')   { v = g.water[i] ? 1 : 0; col = [56, 189, 248]; }
        else if (mode === 'congestion') {
          if (g.type[i] === TILE.ROAD && g.congestion) {
            v = Math.min(1, g.congestion[i] * 1.1);
            col = [Math.round(80 + 175 * v), Math.round(200 * (1 - v) + 40), 50];   // green→red
          }
        }
        else if (mode === 'services'){ v = f ? Math.min(1, (f.safety[i] + f.health[i] + f.happy[i] + f.education[i]) / 2) : 0; col = [192, 132, 252]; }
        else if (mode === 'crime')   { if (g.pop[i] > 0 && f) { v = Math.max(0, 1 - Math.min(1, f.safety[i])); col = [220, 60, 60]; } }
        else if (mode === 'health')  { v = f ? Math.min(1, f.health[i]) : 0; col = [244, 114, 182]; }
        else if (mode === 'education'){ v = f ? Math.min(1, f.education[i]) : 0; col = [129, 140, 248]; }
        else if (mode === 'fire')    { const built = g.built ? g.built[i] : g.level[i]; if (built > 0 && f) { v = (built / 4) * Math.max(0.2, 1 - Math.min(1, f.safety[i])); col = [255, 120, 30]; } }
        else if (mode === 'resources') {
          const rk = g.resource ? g.resource[i] : 0;
          if (rk && typeof RESOURCE_META !== 'undefined' && RESOURCE_META[rk]) {
            const c = RESOURCE_META[rk].color; v = 0.85;
            col = [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
          }
        }
        else if (mode === 'pollution') {
          v = (f && f.pollution) ? Math.min(1, f.pollution[i] * 1.2) : 0;
          col = [Math.round(120 + 120 * v), Math.round(150 * (1 - v) + 40), 40];   // green→brown smog
        }
        else if (mode === 'landvalue') {
          v = g.land ? g.land[i] : 0;
          if (g.type[i] === TILE.WATER) v = 0;
          col = [Math.round(255 * (1 - v)), Math.round(200 * v + 40), 70];          // red poor → green rich
        }
        else if (mode === 'desirability') {
          const util = (g.power[i] ? 0.5 : 0) + (g.water[i] ? 0.5 : 0);
          const serv = f ? Math.min(1, (f.safety[i] + f.health[i] + f.happy[i] + f.education[i]) / 2) : 0;
          const poll = (f && f.pollution) ? f.pollution[i] : 0;
          v = Math.max(0, util * 0.6 + serv * 0.4 - poll * 0.5);
          const t = g.type[i];
          if (t === TILE.WATER) v = 0;
          // green = good, red = poor
          col = [Math.round(255 * (1 - v)), Math.round(200 * v + 40), 60];
        }
        if (v > 0.01 && col) {
          ctx.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${Math.min(0.9, 0.25 + v * 0.65)})`;
          // canvas y is flipped relative to plane orientation; plane rot maps directly
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
    this._overlayTex.needsUpdate = true;
  }

  // ─────────────────────── Camera ───────────────────────

  _positionCamera() {
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
    const n = this.nightFactor = (1 - Math.cos((t - 0.25) * Math.PI * 2)) / 2;
    const d = 1 - n;

    // Sun arc
    const sunAngle = (t - 0.25) * Math.PI * 2;
    const sunElev = Math.cos(sunAngle);
    const cx = this.camTarget.x, cz = this.camTarget.z;
    this.sunLight.position.set(cx + Math.sin(sunAngle) * 60, sunElev * 80, cz - 40);
    this.sunLight.target.position.set(cx, 0, cz);
    this.sunLight.intensity = Math.max(0, sunElev * 2.4);

    // Warm fill follows the sun, opposite side, weak
    this.fillLight.position.set(cx - Math.sin(sunAngle) * 50, 40, cz + 50);
    this.fillLight.intensity = Math.max(0, sunElev) * 0.30;

    // Moon
    this.moonLight.position.set(cx - Math.sin(sunAngle) * 60, -sunElev * 80 + 50, cz - 40);
    this.moonLight.intensity = Math.max(0, n * 0.4);

    this.ambLight.intensity = 0.08 + d * 0.35;
    this.hemiLight.intensity = 0.15 + d * 0.5;

    // Sky dome shader — drive uniforms per time of day
    if (this._skyUniforms) {
      // zenith: deep blue day → deep purple/navy night
      const zenithDay   = new THREE.Color(0x1a4c8f);
      const zenithDusk  = new THREE.Color(0x3d1a50);
      const zenithNight = new THREE.Color(0x050d1e);
      // horizon: sky blue day → orange dusk → dark blue night
      const horizDay    = new THREE.Color(0xa8d8f0);
      const horizDusk   = new THREE.Color(0xe8702a);
      const horizNight  = new THREE.Color(0x0e1a30);

      let zenith, horiz;
      if (n < 0.5) {
        const f = Math.sin(n * Math.PI) * 0.85;
        zenith = zenithDay.clone().lerp(zenithDusk, f);
        horiz  = horizDay.clone().lerp(horizDusk,  f);
      } else {
        const f = (n - 0.5) * 2;
        zenith = zenithDusk.clone().lerp(zenithNight, f);
        horiz  = horizDusk.clone().lerp(horizNight,  f);
      }
      this._skyUniforms.uZenith.value.copy(zenith);
      this._skyUniforms.uHorizon.value.copy(horiz);
      this._skyUniforms.uGround.value.setRGB(0.14 + d * 0.08, 0.18 + d * 0.08, 0.10 + d * 0.03);

      // Sun direction fed to shader for disc/glow
      const sx = Math.sin(sunAngle), sy = sunElev, sz = -0.6;
      const sl = Math.sqrt(sx*sx + sy*sy + sz*sz);
      this._skyUniforms.uSunDir.value.set(sx/sl, sy/sl, sz/sl);
      this._skyUniforms.uSunIntensity.value = Math.max(0, sunElev * 1.2);

      // Sync the plain background to mid-horizon color for canvas clear
      this.scene.background = horiz.clone().lerp(zenith, 0.3);
      // Fog matches near-horizon color
      this.scene.fog.color.copy(horiz).lerp(zenith, 0.1);
      this.scene.fog.density = 0.009 + n * 0.003;
    } else {
      const daySky = new THREE.Color(0x87ceeb);
      const duskSky = new THREE.Color(0xe8602a);
      const nightSky = new THREE.Color(0x070e22);
      let sky;
      if (n < 0.5) sky = daySky.lerp(duskSky, Math.sin(n * Math.PI) * 0.75);
      else sky = duskSky.clone().lerp(nightSky, (n - 0.5) * 2);
      this.scene.background = sky;
      this.scene.fog.color.copy(sky);
    }

    // Stars
    this.starMat.opacity = Math.max(0, (n - 0.55) * 2.5);

    // Weather overlay: precipitation + sky/fog/light modulation
    this._updateWeather(d);

    // Clouds drift, lit by sun/dusk colour + dim at night
    const tm = performance.now() / 1000;
    if (this.clouds) {
      const cloudLit = 0.22 + d * 0.78;
      // During sunset: clouds take on warm orange/pink tones
      const duskFactor = Math.max(0, Math.sin(n * Math.PI) * 0.8);
      const cr = cloudLit + duskFactor * 0.35;
      const cg = cloudLit + duskFactor * 0.12;
      const cb = cloudLit - duskFactor * 0.1;
      this.cloudMat.opacity = 0.25 + d * 0.60;
      this.cloudMat.color.setRGB(Math.min(1, cr), Math.min(1, cg), Math.min(1, cb));
      // Subtle emissive glow from city lights at night
      this.cloudMat.emissive.setRGB(n * 0.04, n * 0.025, n * 0.01);
      for (const c of this.clouds) {
        c.group.position.x += c.speed * 0.016;
        if (c.group.position.x > this.cloudSpan - 20) c.group.position.x = -20;
        // Altitude oscillation for more natural look
        c.group.position.y = c.group.position.y + Math.sin(tm * 0.08 + c.speed * 10) * 0.002;
      }
    }

    // Building window glow — per-instance _windowMats
    const wi = Math.max(0, Math.min(1, (n - 0.30) * 1.7));
    if (this._winDirty || Math.abs(wi - this._lastWin) > 0.01) {
      this._lastWin = wi; this._winDirty = false;
      const gr = 0.38 * wi, gg = 0.27 * wi, gb = 0.11 * wi;
      for (const [, v] of this.tileMeshes) {
        const grp = Array.isArray(v) ? null : v;
        if (!grp || !grp._windowMats) continue;
        for (const m2 of grp._windowMats) if (m2.emissive) m2.emissive.setRGB(gr, gg, gb);
      }
    }

    // Street-lamp glow (shared material → one update lights every lamp)
    const lampGlow = Math.max(0, Math.min(1, (n - 0.25) * 1.6));
    this.models.lampBulbMat.emissive.setRGB(lampGlow * 1.0, lampGlow * 0.82, lampGlow * 0.28);

    // Water shimmer — more dynamic ripple effect
    if (this.waterMat) {
      const w1 = Math.sin(tm * 1.3) * 0.04 + Math.sin(tm * 0.7) * 0.02;
      const w2 = Math.cos(tm * 0.9) * 0.02 + Math.sin(tm * 1.7) * 0.015;
      const br = 0.10 + d * 0.28 + w1 + w2;
      // At night: city light reflection on water
      const cityGlow = n * 0.06;
      this.waterMat.emissive.setRGB(br * 0.05 + cityGlow * 0.5, br * 0.20 + cityGlow * 0.4, br * 0.42 + cityGlow * 0.2);
      this.waterMat.roughness = 0.04 + Math.abs(w1) * 0.08;
    }

    // City glow point light — warm neon bloom at night
    if (this.cityGlowLight) {
      this.cityGlowLight.intensity = n * n * 1.8;
      this.cityGlowLight.color.setRGB(1.0, 0.55 + n * 0.1, 0.25);
    }

    // Tone mapping exposure — warmer at dusk, slightly dimmer at night for realism
    this.wgl.toneMappingExposure = 0.90 + d * 0.25 + Math.max(0, Math.sin(n * Math.PI) * 0.28) - n * 0.05;

    // Traffic-light signal cycle (shared materials → global synchronised cycle)
    const phase = tm % 6.0;
    const grn = phase < 2.6, yel = phase >= 2.6 && phase < 3.2;
    const md = this.models;
    md.tlRedMat.emissive.setRGB(!grn && !yel ? 0.75 : 0.04, 0, 0);
    md.tlYellowMat.emissive.setRGB(yel ? 0.75 : 0.05, yel ? 0.5 : 0.04, 0);
    md.tlGreenMat.emissive.setRGB(0, grn ? 0.75 : 0.05, grn ? 0.14 : 0.01);

    // Animated beacons + AI pulses + small mechanisms
    const beaconCol = (Math.sin(tm * 2.5) > 0.6) ? 0xff2200 : 0x220000;
    const ledG      = Math.max(0, 0.52 + Math.sin(tm * 2.3) * 0.48);
    const ring1Op   = Math.max(0.15, 0.55 + Math.sin(tm * 1.9) * 0.35);
    const ring2Op   = Math.max(0.10, 0.45 + Math.sin(tm * 2.7 + 1.2) * 0.35);
    const ledRingOp = Math.max(0.40, 0.75 + Math.sin(tm * 1.5) * 0.25);
    for (const [, v] of this.tileMeshes) {
      const grp = Array.isArray(v) ? null : v;
      if (!grp || !grp.isGroup) continue;
      if (grp._ledMat)      grp._ledMat.color.setRGB(0, ledG, 1.0);
      if (grp._ringMat)     grp._ringMat.opacity  = ring1Op;
      if (grp._ring2Mat)    grp._ring2Mat.opacity = ring2Op;
      if (grp._ledRingMat)  grp._ledRingMat.opacity = ledRingOp;
      if (grp._windTurbine) grp._windTurbine.rotation.z = tm * 1.4;
      if (grp._craneJib)    grp._craneJib.rotation.y = tm * 0.3;
      if (grp._beacon)      grp._beacon.material.color.setHex(beaconCol);
    }
  }

  // ─────────────────────── Traffic ───────────────────────

  _updateVehicles(traffic) {
    if (!traffic) return;
    const veh = traffic.vehicles, T = this.T;

    while (this.vehiclePool.length < veh.length) {
      const idx = this.vehiclePool.length;
      const g = this.models.buildVehicle(idx);
      g.castShadow = false;
      this.scene.add(g);
      this.vehiclePool.push(g);
    }
    for (let k = 0; k < this.vehiclePool.length; k++) this.vehiclePool[k].visible = k < veh.length;

    const n = this.nightFactor;
    const hi = Math.max(0, (n - 0.45) * 1.1);
    const flash = (performance.now() / 130) | 0;     // ~7.5Hz emergency strobe
    const blue = flash & 1;

    for (let k = 0; k < veh.length; k++) {
      const v = veh[k];
      const dx = v.nx - v.x, dz = v.ny - v.y;
      const wx = (v.x + dx * v.t + 0.5 - dz * 0.18) * T;
      const wz = (v.y + dz * v.t + 0.5 + dx * 0.18) * T;
      const g = this.vehiclePool[k];
      g.position.set(wx, 0.04, wz);
      if (dx !== 0 || dz !== 0) g.rotation.y = Math.atan2(-dx, -dz);

      if (v.emergency) {
        // strobing red/blue light bar on the whole body
        g.traverse(child => {
          if (!child.isMesh || !child.material || !child.material.emissive) return;
          if (blue) child.material.emissive.setRGB(0.05, 0.1, 0.9);
          else child.material.emissive.setRGB(0.9, 0.05, 0.05);
        });
        continue;
      }
      g.traverse(child => {
        if (!child.isMesh || !child.material) return;
        const mat = child.material;
        if (mat.color && mat.color.r > 0.8 && mat.color.g > 0.8 && mat.color.b > 0.8) {
          mat.emissive.setRGB(hi * 0.8, hi * 0.8, hi * 0.5);
        } else if (mat.color && mat.color.r > 0.7 && mat.color.g < 0.2) {
          mat.emissive.setRGB(hi * 0.6, 0, 0);
        }
      });
    }
  }

  // ─────────────────────── Accident markers ───────────────────────

  _buildAccidentMarker() {
    const grp = new THREE.Group();
    const coneGeo = new THREE.ConeGeometry(0.06, 0.16, 8);
    const coneMat = new THREE.MeshStandardMaterial({ color: 0xff7a18, roughness: 0.6, emissive: new THREE.Color(0x3a1500) });
    for (const ox of [-0.18, 0, 0.18]) {
      const c = new THREE.Mesh(coneGeo, coneMat);
      c.position.set(ox, 0.08, 0); grp.add(c);
    }
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 1, transparent: true, opacity: 0.4 });
    const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), smokeMat);
    smoke.position.set(0, 0.34, 0); grp._smoke = smoke; grp.add(smoke);
    return grp;
  }

  _updateAccidents(traffic) {
    if (!traffic) return;
    const acc = traffic.accidents || [], T = this.T;
    while (this.accidentPool.length < acc.length) {
      const m = this._buildAccidentMarker();
      this.scene.add(m); this.accidentPool.push(m);
    }
    for (let k = 0; k < this.accidentPool.length; k++) this.accidentPool[k].visible = k < acc.length;
    const tm = performance.now() / 1000;
    for (let k = 0; k < acc.length; k++) {
      const a = acc[k], m = this.accidentPool[k];
      m.position.set((a.x + 0.5) * T, 0, (a.y + 0.5) * T);
      if (m._smoke) { m._smoke.position.y = 0.30 + Math.sin(tm * 2 + k) * 0.05; m._smoke.material.opacity = 0.3 + Math.sin(tm * 3 + k) * 0.12; }
    }
  }

  // ─────────────────────── Citizens ───────────────────────

  _updateCitizens(citizens) {
    if (!citizens) return;
    const cits = citizens.citizens, T = this.T;
    const tm = performance.now() / 1000;

    while (this.citizenPool.length < cits.length) {
      const g = this.models.buildCitizen(this.citizenPool.length);
      this.scene.add(g);
      this.citizenPool.push(g);
    }
    for (let k = 0; k < this.citizenPool.length; k++) this.citizenPool[k].visible = k < cits.length;

    const haloOpacity = Math.max(0.1, 0.65 + Math.sin(tm * 2.8) * 0.30);

    for (let k = 0; k < cits.length; k++) {
      const c = cits[k];
      const dx = c.nx - c.x, dz = c.ny - c.y;
      const wx_c = (c.x + 0.5 + dx * c.t) * T;
      const wz_c = (c.y + 0.5 + dz * c.t) * T;
      const sidewalkDist = 0.30;
      const wx = wx_c + (-dz) * sidewalkDist * c.sidewalkSide;
      const wz = wz_c + ( dx) * sidewalkDist * c.sidewalkSide;

      const g = this.citizenPool[k];
      const phase = tm * c.speed * 7.5 + k * 2.399;
      const swing = Math.sin(phase) * 0.52;
      const bob   = Math.abs(Math.sin(phase * 0.5)) * 0.004;

      g.position.set(wx, 0.005 + bob, wz);
      if (dx !== 0 || dz !== 0) g.rotation.y = Math.atan2(-dx, -dz);

      if (g._leftLeg) {
        g._leftLeg.rotation.x  =  swing;
        g._rightLeg.rotation.x = -swing;
        if (g._leftLegL) {
          g._leftLegL.rotation.x  = Math.max(0, swing) * 0.7;
          g._rightLegL.rotation.x = Math.max(0, -swing) * 0.7;
        }
        g._leftArm.rotation.x  = -swing * 0.55;
        g._rightArm.rotation.x =  swing * 0.55;
        if (g._leftForearm) {
          g._leftForearm.rotation.x  = -swing * 0.3;
          g._rightForearm.rotation.x =  swing * 0.3;
        }
      }
      if (g._haloMat) g._haloMat.opacity = haloOpacity;
    }
  }

  // ─────────────────────── Main draw ───────────────────────

  draw(traffic, citizens) {
    this._updateDayNight();
    this._updateVehicles(traffic);
    this._updateAccidents(traffic);
    this._updateCitizens(citizens);
    this._animateMarker();
    this.wgl.render(this.scene, this.camera);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.wgl.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ─────────────────────── Grid swap ───────────────────────

  // Rebuild every world-sized object (ground, overlay) and recentre the sky /
  // glow after the grid's dimensions change (map expansion).
  _resizeWorld() {
    if (this.groundMesh) { this.scene.remove(this.groundMesh); this.groundMesh.geometry.dispose(); this.groundMesh = null; }
    this._buildGround();
    if (this.overlayMesh) { this.scene.remove(this.overlayMesh); this.overlayMesh.geometry.dispose(); this.overlayMesh = null; }
    this._buildOverlay();
    this.overlayMesh.visible = !!this.overlayMode;
    const cx = this.grid.w * this.T / 2, cz = this.grid.h * this.T / 2;
    if (this.skyDome) this.skyDome.position.set(cx, 0, cz);
    if (this.cityGlowLight) this.cityGlowLight.position.set(cx, 8, cz);
  }

  setGrid(grid) {
    this.grid = grid;
    this._resizeWorld();
    for (const [, v] of this.tileMeshes) {
      const list = Array.isArray(v) ? v : [v];
      list.forEach(m => this.scene.remove(m));
    }
    this.tileMeshes.clear();
    this.levelCache = new Uint8Array(grid.w * grid.h).fill(255);
    for (const g of this.vehiclePool)  this.scene.remove(g);
    for (const g of this.citizenPool) this.scene.remove(g);
    this.vehiclePool.length  = 0;
    this.citizenPool.length  = 0;
    this._buildWater();
    this.rebuildAll();
    this.camTarget.set(grid.w * this.T / 2, 0, grid.h * this.T / 2);
    this._positionCamera();
  }
}
