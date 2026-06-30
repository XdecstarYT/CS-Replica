/* models_babylon.js — procedural city models for the Babylon.js renderer.
 *
 * Mirrors the role of the Three.js ModelBuilder but produces Babylon meshes.
 * Buildings are massed by level with baked day + night facade textures (lit
 * windows glow after dark), tiered setbacks and rooftop detail; vehicles are
 * the same realistic body styles; plus citizens, services, roads and trees.
 *
 * Each building's static parts are merged into a single mesh per material so a
 * dense downtown stays cheap to draw. Window/facade materials are collected so
 * the renderer can ramp their emissive glow across the day/night cycle.
 */

(function () {
const B = (typeof BABYLON !== 'undefined') ? BABYLON : null;

function hexColor(hex) {
  if (typeof hex === 'number') return B.Color3.FromHexString('#' + hex.toString(16).padStart(6, '0'));
  return B.Color3.FromHexString(hex);
}

class ModelBuilderB {
  constructor(scene) {
    this.scene = scene;
    this._texCache = {};
    this.facadeMats = [];        // all window-bearing mats (renderer ramps emissive)
    this.lampMats = [];          // street-lamp bulb mats
    this._matCache = {};
    this._initShared();
  }

  // ── shared materials ──
  _mat(name, opts) {
    const m = new B.StandardMaterial(name, this.scene);
    if (opts.diffuse != null) m.diffuseColor = hexColor(opts.diffuse);
    if (opts.emissive != null) m.emissiveColor = hexColor(opts.emissive);
    if (opts.spec != null) m.specularColor = hexColor(opts.spec);
    else m.specularColor = new B.Color3(0.04, 0.04, 0.05);
    if (opts.specPower != null) m.specularPower = opts.specPower;
    if (opts.alpha != null) m.alpha = opts.alpha;
    if (opts.backFaceCulling === false) m.backFaceCulling = false;
    m.freeze && opts.freeze !== false && null;   // keep dynamic (day/night)
    return m;
  }

  _initShared() {
    this.matConc   = this._mat('conc',  { diffuse: 0x9a9ea6, spec: 0x0a0a0a });
    this.matRoof   = this._mat('roof',  { diffuse: 0x3a3f47, spec: 0x111111 });
    this.matRoofMetal = this._mat('roofm', { diffuse: 0x6a7078, spec: 0x222222, specPower: 32 });
    this.matMetal  = this._mat('metal', { diffuse: 0x8a9099, spec: 0x333333, specPower: 48 });
    this.matDark   = this._mat('dark',  { diffuse: 0x14161a, spec: 0x0a0a0a });
    this.matGlassHero = this._mat('glassH', { diffuse: 0x2b4a60, emissive: 0x0a1822, spec: 0x99bbdd, specPower: 64 });

    // vehicle shared
    this.wheelMat = this._mat('wheel', { diffuse: 0x0e0e10 });
    this.hubMat   = this._mat('hub',   { diffuse: 0x9aa0a8, spec: 0x666666, specPower: 64 });
    this.glassMat = this._mat('vglass',{ diffuse: 0x95c4e0, emissive: 0x06101a, spec: 0x88aacc, specPower: 64, alpha: 0.55 });
    this.trimMat  = this._mat('vtrim', { diffuse: 0x14161a });
    this.chromeMat= this._mat('vchrome',{ diffuse: 0xb8bcc4, spec: 0x888888, specPower: 80 });

    // citizen palettes
    this.skinMats = [0xffddbb, 0xffcc99, 0xcc9966, 0xf0a070, 0xd4a07a].map((c, i) => this._mat('skin' + i, { diffuse: c }));
    this.shirtMats = [0x3355aa, 0xaa3333, 0x228833, 0x884400, 0x553388, 0x2277aa].map((c, i) => this._mat('shirt' + i, { diffuse: c }));
    this.pantMats = [0x223355, 0x332211, 0x112233, 0x111111].map((c, i) => this._mat('pant' + i, { diffuse: c }));

    // tree
    this.trunkMat = this._mat('trunk', { diffuse: 0x5c3d1a });
    this.leafMats = [0x2d7022, 0x245e1c, 0x3a8028].map((c, i) => this._mat('leaf' + i, { diffuse: c }));

    // lamp + traffic signal (renderer animates emissive)
    this.lampPoleMat = this._mat('lpole', { diffuse: 0x6e6e72, spec: 0x444444, specPower: 32 });
    this.lampBulbMat = this._mat('lbulb', { diffuse: 0xffeebb, emissive: 0x110d04 });
    this.lampMats.push(this.lampBulbMat);
  }

  _hash(x, y) { let h = ((x * 374761393 + y * 668265263) ^ 0x5bd1e995) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h; }
  _rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

  box(name, w, h, d, mat) {
    const m = B.MeshBuilder.CreateBox(name, { width: w, height: h, depth: d }, this.scene);
    if (mat) m.material = mat;
    return m;
  }

  // ── baked facade material (day diffuse + night emissive window grid) ──
  _facadeMat(key, cfg) {
    if (this._matCache[key]) return this._matCache[key];
    const S = 256;
    const wall = cfg.wall, glass = cfg.glass, frame = cfg.frame;
    const cols = cfg.cols, rows = cfg.rows;

    // Day texture
    const dt = new B.DynamicTexture('fac_' + key, { width: S, height: S }, this.scene, true);
    const c = dt.getContext();
    c.fillStyle = wall; c.fillRect(0, 0, S, S);
    const mx = S * 0.06, my = S * 0.06;
    const cw = (S - mx * 2) / cols, ch = (S - my * 2) / rows;
    const gw = cw * 0.7, gh = ch * 0.66;
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      const x = mx + col * cw + (cw - gw) / 2, y = my + r * ch + (ch - gh) / 2;
      c.fillStyle = frame; c.fillRect(x - 2, y - 2, gw + 4, gh + 4);
      c.fillStyle = glass; c.fillRect(x, y, gw, gh);
    }
    dt.update();

    // Night emissive texture — random lit windows on black
    const nt = new B.DynamicTexture('facN_' + key, { width: S, height: S }, this.scene, true);
    const cn = nt.getContext();
    cn.fillStyle = '#000000'; cn.fillRect(0, 0, S, S);
    const rng = this._rng(cfg.seed || 1234);
    for (let r = 0; r < rows; r++) for (let col = 0; col < cols; col++) {
      if (rng() > 0.5) continue;
      const x = mx + col * cw + (cw - gw) / 2, y = my + r * ch + (ch - gh) / 2;
      const warm = rng();
      cn.fillStyle = warm > 0.5 ? '#ffd9a0' : '#bfe0ff';
      cn.fillRect(x, y, gw, gh);
    }
    nt.update();

    const m = new B.StandardMaterial('facm_' + key, this.scene);
    m.diffuseTexture = dt;
    m.emissiveTexture = nt;
    m.emissiveColor = new B.Color3(0, 0, 0);   // ramped at night by renderer
    m.specularColor = new B.Color3(0.18, 0.2, 0.22);
    m.specularPower = 48;
    m._isFacade = true;
    this.facadeMats.push(m);
    this._matCache[key] = m;
    return m;
  }

  _zoneFacade(zone, level, hash) {
    const P = {
      res2: [
        { cols: 4, rows: 5, wall: '#b9a48a', glass: '#8fa6ad', frame: '#6a5640' },
        { cols: 4, rows: 5, wall: '#a7b0a4', glass: '#90a8b0', frame: '#55604f' },
        { cols: 4, rows: 5, wall: '#a07a5e', glass: '#7c8e90', frame: '#5a4632' },
      ],
      res3: [
        { cols: 5, rows: 10, wall: '#9aa6b0', glass: '#8fb0bd', frame: '#4c5660' },
        { cols: 6, rows: 12, wall: '#b6ab9a', glass: '#9bb6bd', frame: '#5c5040' },
        { cols: 5, rows: 11, wall: '#2a3640', glass: '#6f9aad', frame: '#162028' },
      ],
      com2: [
        { cols: 5, rows: 7, wall: '#6b7178', glass: '#a8c6da', frame: '#3a4048' },
        { cols: 5, rows: 7, wall: '#7a818a', glass: '#9bb8cc', frame: '#414850' },
        { cols: 5, rows: 6, wall: '#cabfa8', glass: '#94a2a2', frame: '#897e66' },
      ],
      com3: [
        { cols: 5, rows: 13, wall: '#16202c', glass: '#3f6076', frame: '#0b1420' },
        { cols: 5, rows: 13, wall: '#1b2733', glass: '#4a6b82', frame: '#0d1822' },
        { cols: 6, rows: 15, wall: '#202c30', glass: '#577a86', frame: '#101a1c' },
        { cols: 6, rows: 14, wall: '#c7bda8', glass: '#8f9c9e', frame: '#857c68' },
      ],
      ind: [
        { cols: 4, rows: 3, wall: '#7b7d80', glass: '#9fb6c2', frame: '#3c3f44' },
      ],
    };
    const tag = zone === TILE.ZONE_RES ? (level >= 3 ? 'res3' : 'res2')
              : zone === TILE.ZONE_COM ? (level >= 3 ? 'com3' : 'com2')
              : 'ind';
    const opts = P[tag];
    const vi = hash % opts.length;
    const o = opts[vi];
    return this._facadeMat(`${tag}_${vi}`, { cols: o.cols, rows: o.rows, seed: 101 + vi * 37 + level * 7, wall: o.wall, glass: o.glass, frame: o.frame });
  }

  _bldH(zone, level, rng) {
    const base = { [TILE.ZONE_RES]: [0, 0.42, 1.40, 3.40, 5.60], [TILE.ZONE_COM]: [0, 0.55, 2.00, 6.00, 9.50], [TILE.ZONE_IND]: [0, 0.60, 1.00, 1.60, 2.30] };
    const vary = { [TILE.ZONE_RES]: [0, 0.12, 0.50, 1.60, 2.20], [TILE.ZONE_COM]: [0, 0.15, 0.80, 3.00, 4.50], [TILE.ZONE_IND]: [0, 0.15, 0.30, 0.50, 0.70] };
    const lv = Math.min(level, 4);
    return base[zone][lv] + vary[zone][lv] * rng();
  }

  // Merge an array of meshes into one (disposes sources). Returns merged mesh.
  _merge(name, parts) {
    const valid = parts.filter(p => p);
    if (!valid.length) return null;
    if (valid.length === 1) { valid[0].name = name; return valid[0]; }
    const merged = B.Mesh.MergeMeshes(valid, true, true, undefined, false, true);
    if (merged) merged.name = name;
    return merged || valid[0];
  }

  // ── Buildings ──────────────────────────────────────────────────────────
  // Returns { root, facadeMat } — root is a TransformNode positioned by renderer.
  buildBuilding(zone, level, x, y, T) {
    const root = new B.TransformNode('bld', this.scene);
    const hash = this._hash(x, y);
    const rng = this._rng(hash);
    const fw = T * 0.82;
    const fac = this._zoneFacade(zone, level, hash);
    const h = this._bldH(zone, level, rng);

    const opaque = [];   // merged with facade
    const extra = [];    // separate-material parts (roof, metal, glass crown)

    if (zone === TILE.ZONE_RES && level === 1) {
      // little house
      const body = this.box('h', fw * 0.8, 0.32, fw * 0.8, fac); body.position.y = 0.16; opaque.push(body);
      const roof = B.MeshBuilder.CreateCylinder('rf', { diameter: fw * 1.0, height: 0.26, tessellation: 4 }, this.scene);
      roof.rotation.y = Math.PI / 4; roof.position.y = 0.32 + 0.13; roof.material = this.matRoof; extra.push(roof);
    } else {
      // main mass
      const baseH = (level >= 3) ? h * 0.55 : h;
      const body = this.box('b', fw, baseH, fw, fac); body.position.y = baseH / 2; opaque.push(body);
      this._relief(opaque, fw, baseH, fac, level);
      this._parapet(extra, fw, baseH);

      if (level >= 3) {
        // setback tower(s)
        const midW = fw * 0.74, midH = h * 0.30;
        const mid = this.box('b2', midW, midH, midW, fac); mid.position.y = baseH + midH / 2; opaque.push(mid);
        const topW = fw * 0.5, topH = h * 0.15;
        const top = this.box('b3', topW, topH, topW, fac); top.position.y = baseH + midH + topH / 2; opaque.push(top);
        this._parapet(extra, midW, baseH + midH);
        // hero crown for tall commercial
        if (zone === TILE.ZONE_COM && level === 4) this._crown(extra, root, topW, baseH + midH + topH, rng);
        else this._rooftop(extra, topW, baseH + midH + topH, rng);
      } else {
        this._rooftop(extra, fw, baseH, rng);
      }
    }

    const mergedFac = this._merge('bldFac', opaque);
    if (mergedFac) { mergedFac.parent = root; mergedFac.material = fac; mergedFac.receiveShadows = true; }
    // group extra by material via simple merge of all (keep their own materials → can't merge across mats)
    for (const e of extra) { e.parent = root; }
    root._mergedExtra = extra;
    return { root, facadeMat: fac };
  }

  _relief(parts, w, h, mat, level) {
    if (level < 2) return;
    const t = w * 0.06;
    // corner pilasters
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const p = this.box('pil', t, h, t, mat);
      p.position.set(sx * (w / 2 - t / 2), h / 2, sz * (w / 2 - t / 2));
      parts.push(p);
    }
  }

  _parapet(extra, w, y) {
    const t = 0.03;
    const cornice = this.box('corn', w * 1.04, 0.06, w * 1.04, this.matConc);
    cornice.position.y = y + 0.03; extra.push(cornice);
  }

  _rooftop(extra, w, y, rng) {
    const units = 1 + (rng() * 2 | 0);
    for (let i = 0; i < units; i++) {
      const uw = w * (0.16 + rng() * 0.16);
      const u = this.box('hvac', uw, 0.06 + rng() * 0.05, uw, this.matRoofMetal);
      u.position.set((rng() - 0.5) * w * 0.5, y + 0.04, (rng() - 0.5) * w * 0.5);
      extra.push(u);
    }
  }

  _crown(extra, root, w, y, rng) {
    // observation band + LED ring + spire
    const band = this.box('deck', w * 1.08, 0.10, w * 1.08, this.matGlassHero);
    band.position.y = y + 0.05; extra.push(band);
    const ringMat = new B.StandardMaterial('led', this.scene);
    ringMat.emissiveColor = new B.Color3(0, 0.7, 1.0);
    ringMat.diffuseColor = new B.Color3(0, 0.1, 0.2);
    const ring = B.MeshBuilder.CreateTorus('ring', { diameter: w * 0.9, thickness: 0.04, tessellation: 16 }, this.scene);
    ring.position.y = y + 0.16; ring.material = ringMat; ring.parent = root; root._ledRing = ringMat;
    const spire = B.MeshBuilder.CreateCylinder('spire', { diameterTop: 0.01, diameterBottom: 0.06, height: w * 1.4, tessellation: 6 }, this.scene);
    spire.position.y = y + w * 0.7; spire.material = this.matMetal; extra.push(spire);
    // aviation beacon
    const beaconMat = new B.StandardMaterial('beacon', this.scene);
    beaconMat.emissiveColor = new B.Color3(1, 0, 0);
    const beacon = B.MeshBuilder.CreateSphere('bcn', { diameter: 0.07, segments: 6 }, this.scene);
    beacon.position.y = y + w * 1.4; beacon.material = beaconMat; beacon.parent = root; root._beacon = beaconMat;
  }

  // ── Construction site ──
  buildConstructionSite(zone, T, target, stage, hash) {
    const root = new B.TransformNode('site', this.scene);
    const rng = this._rng(hash >>> 0);
    const fw = T * 0.82;
    const finalH = this._bldH(zone, target, rng);
    // foundation pad
    const pad = this.box('pad', fw, 0.08, fw, this.matConc); pad.position.y = 0.04; pad.parent = root;
    // rising frame to current height
    const curH = Math.max(0.1, finalH * stage);
    const floors = Math.max(1, Math.round(curH / 0.4));
    for (let f = 0; f <= floors; f++) {
      const slab = this.box('slab', fw * 0.9, 0.03, fw * 0.9, this.matConc);
      slab.position.y = Math.min(curH, f * 0.4); slab.parent = root;
    }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const col = this.box('col', 0.05, curH, 0.05, this.matMetal);
      col.position.set(sx * fw * 0.42, curH / 2, sz * fw * 0.42); col.parent = root;
    }
    // crane
    if (stage < 0.9) {
      const cmast = this.box('cmast', 0.06, finalH + 0.6, 0.06, this.matRoofMetal);
      cmast.position.set(fw * 0.5, (finalH + 0.6) / 2, fw * 0.5); cmast.parent = root;
      const jib = this.box('jib', 0.8, 0.05, 0.05, this.matRoofMetal);
      jib.position.set(fw * 0.5, finalH + 0.55, fw * 0.5); jib.parent = root; root._crane = jib;
    }
    return root;
  }

  // ── Services ──
  buildService(svc, T) {
    const root = new B.TransformNode('svc', this.scene);
    const color = svc ? svc.color : '#888888';
    const id = svc && svc.id;
    const h = 0.6;
    const wall = this._mat('svcw_' + id, { diffuse: 0xeef1f4 });
    const accent = this._mat('svca_' + id, { diffuse: hexToInt(color), emissive: shade(color, 0.06) });
    const body = this.box('sb', T * 0.82, h, T * 0.82, wall); body.position.y = h / 2; body.parent = root;
    const band = this.box('sband', T * 0.86, 0.1, T * 0.86, accent); band.position.y = h - 0.05; band.parent = root;
    if (id === 'park') {
      body.dispose(); band.dispose();
      const lawn = this._mat('lawn', { diffuse: 0x4caf50 });
      const g = this.box('lawn', T * 0.9, 0.05, T * 0.9, lawn); g.position.y = 0.025; g.parent = root;
      for (let i = 0; i < 3; i++) { const t = this.buildTree(i); t.parent = root; t.position.set((i - 1) * 0.25, 0, (i % 2 - 0.5) * 0.25); }
    } else if (id === 'power') {
      for (const sx of [-0.18, 0, 0.18]) { const st = B.MeshBuilder.CreateCylinder('stk', { diameter: 0.1, height: 0.34, tessellation: 8 }, this.scene); st.material = this.matMetal; st.position.set(sx, h + 0.17, -0.18); st.parent = root; }
    } else if (id === 'water') {
      const tank = B.MeshBuilder.CreateCylinder('tank', { diameter: 0.32, height: 0.2, tessellation: 12 }, this.scene); tank.material = accent; tank.position.y = h + 0.2; tank.parent = root;
    } else if (id === 'wind') {
      const tw = B.MeshBuilder.CreateCylinder('wt', { diameter: 0.05, height: 0.7, tessellation: 8 }, this.scene); tw.material = wall; tw.position.y = h + 0.35; tw.parent = root;
      const hub = new B.TransformNode('hub', this.scene); hub.position.set(0, h + 0.68, 0.03); hub.parent = root; root._turbine = hub;
      for (let i = 0; i < 3; i++) { const bl = this.box('bl', 0.03, 0.3, 0.02, wall); bl.position.y = 0.15; const arm = new B.TransformNode('arm', this.scene); arm.rotation.z = i * Math.PI * 2 / 3; bl.parent = arm; arm.parent = hub; }
    } else {
      const dome = B.MeshBuilder.CreateSphere('dome', { diameter: 0.24, segments: 8 }, this.scene); dome.material = accent; dome.position.y = h + 0.12; dome.parent = root;
    }
    return root;
  }

  // ── Trees ──
  buildTree(i) {
    const root = new B.TransformNode('tree', this.scene);
    const trunk = B.MeshBuilder.CreateCylinder('tr', { diameterTop: 0.04, diameterBottom: 0.06, height: 0.22, tessellation: 6 }, this.scene);
    trunk.material = this.trunkMat; trunk.position.y = 0.11; trunk.parent = root;
    const leaf = B.MeshBuilder.CreateSphere('lf', { diameter: 0.28, segments: 6 }, this.scene);
    leaf.material = this.leafMats[i % this.leafMats.length]; leaf.position.y = 0.30; leaf.scaling.y = 0.85; leaf.parent = root;
    return root;
  }

  // ── Vehicles (realistic styles, merged per vehicle) ──
  vehicleColors = [0xf2f2f4, 0xe8e8ea, 0x111418, 0x1c1f24, 0xb01818, 0xc0392b, 0x143d7a, 0x2563a8, 0x1f6b3a, 0x4a5560, 0x6b7280, 0x8a8f98, 0xb8860b, 0xc97f1a, 0x7a3b8c, 0x0e7c86];
  _vehicleMix = [0, 0, 0, 1, 1, 2, 2, 2, 3, 4, 5, 7, 0, 1, 2, 6];

  buildVehicle(index) {
    const type = this._vehicleMix[index % this._vehicleMix.length];
    const color = this.vehicleColors[index % this.vehicleColors.length];
    const bodyMat = (type === 6) ? this._mat('busC' + (index % 2), { diffuse: index % 2 ? 0x2b6cb0 : 0xc23b22, spec: 0x222, specPower: 32 })
                  : (type === 7) ? this._mat('taxiC', { diffuse: 0xf4c20d, spec: 0x222, specPower: 48 })
                  : this._mat('carC' + index, { diffuse: color, spec: 0x333, specPower: 48 });
    const parts = [], glass = [];
    const P = (w, h, d, x, y, z, mat) => { const m = this.box('p', w, h, d, mat); m.position.set(x || 0, y || 0, z || 0); (mat === this.glassMat ? glass : parts).push(m); return m; };

    if (type === 0 || type === 7) {        // sedan / taxi
      P(0.120, 0.034, 0.234, 0, 0.050, 0, bodyMat);
      P(0.128, 0.026, 0.214, 0, 0.066, 0, bodyMat);
      P(0.112, 0.040, 0.108, 0, 0.090, -0.006, bodyMat);
      P(0.114, 0.034, 0.100, 0, 0.094, -0.006, this.glassMat);
      if (type === 7) { const s = this.box('sign', 0.034, 0.014, 0.02, this.trimMat); s.position.set(0, 0.120, -0.006); parts.push(s); }
    } else if (type === 1) {               // SUV
      P(0.130, 0.056, 0.244, 0, 0.064, 0, bodyMat);
      P(0.122, 0.046, 0.150, 0, 0.106, -0.006, bodyMat);
      P(0.124, 0.040, 0.142, 0, 0.108, -0.006, this.glassMat);
    } else if (type === 2) {               // hatch
      P(0.116, 0.038, 0.190, 0, 0.052, 0, bodyMat);
      P(0.108, 0.044, 0.110, 0, 0.086, -0.018, bodyMat);
      P(0.110, 0.038, 0.102, 0, 0.090, -0.018, this.glassMat);
    } else if (type === 3) {               // pickup
      P(0.126, 0.052, 0.124, 0, 0.062, 0.052, bodyMat);
      P(0.116, 0.044, 0.092, 0, 0.100, 0.058, bodyMat);
      P(0.118, 0.038, 0.084, 0, 0.102, 0.058, this.glassMat);
      P(0.126, 0.030, 0.118, 0, 0.050, -0.050, bodyMat);
    } else if (type === 4) {               // sports
      P(0.122, 0.028, 0.236, 0, 0.044, 0, bodyMat);
      P(0.100, 0.026, 0.092, 0, 0.078, -0.014, this.glassMat);
    } else if (type === 5) {               // van
      P(0.128, 0.092, 0.250, 0, 0.086, -0.004, bodyMat);
      P(0.118, 0.052, 0.04, 0, 0.096, 0.118, this.glassMat);
    } else if (type === 6) {               // bus
      P(0.140, 0.110, 0.340, 0, 0.100, 0, bodyMat);
      P(0.130, 0.044, 0.30, 0.071, 0.118, 0, this.glassMat);
      P(0.130, 0.044, 0.30, -0.071, 0.118, 0, this.glassMat);
    }

    // wheels
    const wcfg = [
      { fx: 0.066, rz: 0.072, y: 0.036, s: 1.0 }, { fx: 0.070, rz: 0.078, y: 0.042, s: 1.18 },
      { fx: 0.064, rz: 0.058, y: 0.034, s: 0.95 }, { fx: 0.068, rz: 0.082, y: 0.040, s: 1.15 },
      { fx: 0.068, rz: 0.072, y: 0.030, s: 0.92 }, { fx: 0.066, rz: 0.086, y: 0.044, s: 1.12 },
      { fx: 0.072, rz: 0.118, y: 0.050, s: 1.45 }, { fx: 0.066, rz: 0.072, y: 0.036, s: 1.0 },
    ][type];
    for (const wz of [-wcfg.rz, wcfg.rz]) for (const sx of [-wcfg.fx, wcfg.fx]) {
      const w = B.MeshBuilder.CreateCylinder('wh', { diameter: 0.076 * wcfg.s, height: 0.022, tessellation: 10 }, this.scene);
      w.rotation.z = Math.PI / 2; w.position.set(sx, wcfg.y, wz); w.material = this.wheelMat; parts.push(w);
    }
    // lights (emissive — also used for night)
    if (type !== 6) {
      const hl = this._mat('hl', { diffuse: 0xfffbe8, emissive: 0x453f2a });
      const tl = this._mat('tl', { diffuse: 0xd81818, emissive: 0x350000 });
      const fz = [0.106, 0.112, 0.090, 0.118, 0.104, 0.118, 0, 0.106][type], by = [0.052, 0.062, 0.05, 0.058, 0.044, 0.066, 0, 0.052][type];
      for (const sx of [-0.046, 0.046]) {
        const a = this.box('hl', 0.02, 0.011, 0.006, hl); a.position.set(sx, by, fz); parts.push(a);
        const b = this.box('tl', 0.022, 0.013, 0.006, tl); b.position.set(sx, by, -fz); parts.push(b);
      }
    }

    const merged = B.Mesh.MergeMeshes([...parts], true, true, undefined, false, true) || parts[0];
    merged.name = 'veh';
    // attach glass as child (transparent kept separate)
    if (glass.length) {
      const gm = B.Mesh.MergeMeshes([...glass], true, true, undefined, false, true);
      if (gm) { gm.name = 'vglass'; gm.parent = merged; }
    }
    merged._bodyMat = bodyMat;
    merged.isVehicle = true;
    return merged;
  }

  // ── Citizen ──
  buildCitizen(index) {
    const root = new B.TransformNode('cit', this.scene);
    const skin = this.skinMats[index % this.skinMats.length];
    const shirt = this.shirtMats[(index * 3 + 1) % this.shirtMats.length];
    const pant = this.pantMats[index % this.pantMats.length];
    const legs = this.box('legs', 0.03, 0.05, 0.025, pant); legs.position.y = 0.025; legs.parent = root;
    const torso = this.box('torso', 0.04, 0.055, 0.028, shirt); torso.position.y = 0.075; torso.parent = root;
    const head = B.MeshBuilder.CreateSphere('head', { diameter: 0.032, segments: 6 }, this.scene); head.material = skin; head.position.y = 0.118; head.parent = root;
    return root;
  }

  // ── Street lamp ──
  buildStreetLamp() {
    const root = new B.TransformNode('lamp', this.scene);
    const pole = B.MeshBuilder.CreateCylinder('lp', { diameterTop: 0.026, diameterBottom: 0.038, height: 0.6, tessellation: 6 }, this.scene);
    pole.material = this.lampPoleMat; pole.position.y = 0.3; pole.parent = root;
    const bulb = B.MeshBuilder.CreateSphere('lb', { diameter: 0.05, segments: 6 }, this.scene);
    bulb.material = this.lampBulbMat; bulb.position.set(0.1, 0.58, 0); bulb.parent = root;
    return root;
  }
}

function hexToInt(c) { return parseInt(String(c).replace('#', ''), 16); }
function shade(c, f) { const n = hexToInt(c); const r = ((n >> 16) & 255) * f, g = ((n >> 8) & 255) * f, b = (n & 255) * f; return (r << 16) | (g << 8) | b; }

window.ModelBuilderB = ModelBuilderB;
})();
