/* models.js — Photorealistic procedural 3D models using PBR materials. */

const Std = (p) => new THREE.MeshStandardMaterial(p);

class ModelBuilder {
  constructor() {
    this._texCache = {};
    this._initShared();
  }

  _initShared() {
    // Shared wheel parts
    this.wheelGeo    = new THREE.CylinderGeometry(0.038, 0.038, 0.022, 12);
    this.hubGeo      = new THREE.CylinderGeometry(0.016, 0.016, 0.024, 8);
    this.wheelMat    = Std({ color: 0x111111, roughness: 0.85, metalness: 0.1 });
    this.hubMat      = Std({ color: 0x999999, roughness: 0.3,  metalness: 0.8 });
    this.glassMat    = Std({ color: 0x9ad4f5, roughness: 0.05, metalness: 0.08, transparent: true, opacity: 0.52 });

    // Shared tree parts (re-used across all trees)
    this.treeGeoMed  = new THREE.SphereGeometry(1, 8, 6);
    this.treeGeoSm   = new THREE.SphereGeometry(1, 6, 5);
    this.trunkGeo    = new THREE.CylinderGeometry(0.030, 0.052, 1, 8);
    this.trunkMats   = [
      Std({ color: 0x5c3d1a, roughness: 0.95, metalness: 0 }),
      Std({ color: 0x6b4a22, roughness: 0.95, metalness: 0 }),
      Std({ color: 0x4a2f12, roughness: 0.95, metalness: 0 }),
    ];
    this.canopyMats  = [
      [Std({ color: 0x2d7022, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x245e1c, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x3a8028, roughness: 0.95, metalness: 0 })],
      [Std({ color: 0x1e5f1a, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x2a6820, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x358a28, roughness: 0.95, metalness: 0 })],
      [Std({ color: 0x355e28, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x2a5520, roughness: 0.95, metalness: 0 }),
       Std({ color: 0x4a7535, roughness: 0.95, metalness: 0 })],
    ];

    // Shared lamp parts
    this.lampPoleMat  = Std({ color: 0x6e6e72, roughness: 0.35, metalness: 0.80 });
    this.lampBulbMat  = Std({ color: 0xffeebb, roughness: 0.08, metalness: 0, emissive: new THREE.Color(0.08, 0.065, 0.015) });
    this.lampPoleGeo  = new THREE.CylinderGeometry(0.013, 0.019, 0.60, 7);
    this.lampHeadGeo  = new THREE.CylinderGeometry(0.028, 0.022, 0.038, 8);
    this.lampBulbGeo  = new THREE.SphereGeometry(0.019, 7, 5);
    this.lampArmGeo   = new THREE.CylinderGeometry(0.007, 0.007, 0.13, 5);

    // Shared traffic-light parts (materials shared → one global signal cycle)
    this.tlPoleMat   = Std({ color: 0x555555, roughness: 0.35, metalness: 0.75 });
    this.tlHouseMat  = Std({ color: 0x111111, roughness: 0.50, metalness: 0.30 });
    this.tlRedMat    = Std({ color: 0xff2200, roughness: 0.18, metalness: 0, emissive: new THREE.Color(0.35, 0, 0) });
    this.tlYellowMat = Std({ color: 0xffaa00, roughness: 0.18, metalness: 0, emissive: new THREE.Color(0.05, 0.04, 0) });
    this.tlGreenMat  = Std({ color: 0x00cc22, roughness: 0.18, metalness: 0, emissive: new THREE.Color(0, 0.05, 0.01) });
    this.tlPoleGeo   = new THREE.CylinderGeometry(0.010, 0.015, 0.38, 6);
    this.tlBoxGeo    = new THREE.BoxGeometry(0.028, 0.086, 0.024);
    this.tlLensGeo   = new THREE.SphereGeometry(0.008, 6, 4);

    // Every geometry that is re-used across many objects. The renderer must
    // never dispose() these when a tile is removed, or it corrupts siblings.
    this.sharedGeos = new Set([
      this.wheelGeo, this.hubGeo, this.treeGeoMed, this.treeGeoSm, this.trunkGeo,
      this.lampPoleGeo, this.lampHeadGeo, this.lampBulbGeo, this.lampArmGeo,
      this.tlPoleGeo, this.tlBoxGeo, this.tlLensGeo,
    ]);

    // Architecture kit (footprints, rooftop detail, facade material library)
    this._initArch();
  }

  // ─────────────────────────────────────────────────────────────────────
  //  Architecture system — shared instanced geometry + cached PBR facades.
  //  Buildings are massed from a tiny set of unit geometries (scaled per
  //  instance) so the whole skyline costs almost no extra geometry, and they
  //  are skinned with baked window-grid textures that carry an emissive
  //  "night map" so individual windows glow after dark.
  // ─────────────────────────────────────────────────────────────────────
  _initArch() {
    // Unit geometries — scaled per mesh, never disposed (shared set).
    this.kit = {
      box:     new THREE.BoxGeometry(1, 1, 1),
      cyl:     new THREE.CylinderGeometry(1, 1, 1, 12),
      cyl8:    new THREE.CylinderGeometry(1, 1, 1, 8),
      antenna: new THREE.CylinderGeometry(0.05, 0.12, 1, 5),
      dish:    new THREE.SphereGeometry(0.5, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
      cone:    new THREE.ConeGeometry(0.5, 1, 10),
    };
    for (const k in this.kit) this.sharedGeos.add(this.kit[k]);

    // Shared structural / rooftop / detail materials (reused city-wide → no churn).
    this.matConc       = Std({ map: this._concreteTex(), color: 0xc2c4c6, roughness: 0.82, metalness: 0.04 });
    this.matRoofDeck   = Std({ color: 0x3a3d42, roughness: 0.88, metalness: 0.10 });
    this.matRoofMetal  = Std({ color: 0x9398a0, roughness: 0.55, metalness: 0.55 });
    this.matVent       = Std({ color: 0xb6babe, roughness: 0.5, metalness: 0.6 });
    this.matTank       = Std({ color: 0x99a0a6, roughness: 0.5, metalness: 0.4 });
    this.matStoreGlass = Std({ color: 0x0c1c28, roughness: 0.05, metalness: 0.6, emissive: new THREE.Color(0x040a10) });
    this.matCanopy     = Std({ color: 0x2b333d, roughness: 0.5, metalness: 0.3 });
    this.matBalcony    = Std({ color: 0xd2d5d9, roughness: 0.6, metalness: 0.1 });
    this.matBalGlass   = Std({ color: 0x9ec6da, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.42 });
    this.matPodium     = Std({ color: 0x39434f, roughness: 0.5, metalness: 0.22 });
    this.matDoor       = Std({ color: 0x12202c, roughness: 0.18, metalness: 0.5 });
    this.matSpire      = Std({ color: 0xc8ccd0, roughness: 0.3, metalness: 0.65 });
    this.matPipe       = Std({ color: 0x7d8389, roughness: 0.55, metalness: 0.5 });
    this.matHelipad    = Std({ color: 0x2a2d31, roughness: 0.85, metalness: 0.05 });
    this.matHeliMark   = Std({ color: 0xf2c200, roughness: 0.6, metalness: 0, emissive: new THREE.Color(0x251c00) });
    this.matSolar      = Std({ color: 0x16263f, roughness: 0.22, metalness: 0.55 });
    this.matDeck       = Std({ color: 0x223040, roughness: 0.12, metalness: 0.3, transparent: true, opacity: 0.6 });

    // Construction-site materials.
    this.matSiteConc   = Std({ color: 0x9a988e, roughness: 0.95, metalness: 0.02 });
    this.matRebar      = Std({ color: 0x8a8d92, roughness: 0.6, metalness: 0.5 });
    this.matScaffold   = Std({ color: 0xc9a227, roughness: 0.5, metalness: 0.45 });
    this.matCrane      = Std({ color: 0xe0a020, roughness: 0.45, metalness: 0.5 });
    this.matFence      = Std({ color: 0xd8661a, roughness: 0.7, metalness: 0.1 });
    this.matSiteWrap   = Std({ color: 0x5a6470, roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0.5 });

    // Self-lit shop signage (a small palette, picked per building).
    this.signMats = [
      Std({ color: 0xff5566, roughness: 0.4, emissive: new THREE.Color(0x551018) }),
      Std({ color: 0x44ccff, roughness: 0.4, emissive: new THREE.Color(0x06303f) }),
      Std({ color: 0xffcc44, roughness: 0.4, emissive: new THREE.Color(0x3a2c06) }),
      Std({ color: 0x66ff99, roughness: 0.4, emissive: new THREE.Color(0x0a3a1c) }),
      Std({ color: 0xcc88ff, roughness: 0.4, emissive: new THREE.Color(0x2a1244) }),
    ];

    // Detached-house materials (reused).
    this.matHouseBrick = Std({ map: this._brickTex(), roughness: 0.85, metalness: 0 });
    this.matHouseSlate = Std({ map: this._slateRoofTex(), roughness: 0.9, metalness: 0 });
    this.matHouseTrim  = Std({ color: 0xeeeae2, roughness: 0.72, metalness: 0 });
    this.matHouseDoor  = Std({ color: 0x5a2e10, roughness: 0.85, metalness: 0.05 });

    // Industrial materials (reused).
    this.matIndWall = Std({ map: this._corrugatedTex(), roughness: 0.8, metalness: 0.12 });
    this.matIndRoof = Std({ map: this._corrugatedTex(), color: 0x8a8d84, roughness: 0.82, metalness: 0.08 });

    this._facCache = {};
  }

  // Deterministic per-tile hash + small PRNG seeded from it.
  _hash(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return h >>> 0;
  }
  _rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
  }

  _shade(hex, amt) {
    const n = typeof hex === 'number' ? hex : parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
    const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
    const b = Math.max(0, Math.min(255, (n & 255) + amt));
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  // A scaled, positioned instance of a shared kit geometry.
  _kmesh(geo, mat, sx, sy, sz, x, y, z, shadow) {
    const m = new THREE.Mesh(geo, mat);
    m.scale.set(sx, sy, sz);
    m.position.set(x || 0, y || 0, z || 0);
    if (shadow !== false) m.castShadow = true;
    m.receiveShadow = true;
    return m;
  }

  // Build (and cache) a PBR facade material: a baked window grid with frames,
  // glass reflections and a matching emissive map so windows light up at night.
  _facadeMat(key, cfg) {
    if (this._facCache[key]) return this._facCache[key];
    const { cols, rows, wall, glass, frame, style } = cfg;
    const S = 256;
    const dayC = document.createElement('canvas'); dayC.width = dayC.height = S;
    const ngtC = document.createElement('canvas'); ngtC.width = ngtC.height = S;
    const d = dayC.getContext('2d'), n = ngtC.getContext('2d');
    const rnd = this._rng(cfg.seed || 7);

    // Wall base + subtle grime so flat surfaces read as a real material.
    d.fillStyle = wall; d.fillRect(0, 0, S, S);
    for (let i = 0; i < 1400; i++) { d.fillStyle = `rgba(0,0,0,${rnd() * 0.05})`; d.fillRect(rnd() * S, rnd() * S, 2, 2); }
    n.fillStyle = '#000000'; n.fillRect(0, 0, S, S);

    const cw = S / cols, ch = S / rows;
    const ins = Math.max(2, Math.min(cw, ch) * 0.18);
    const litChance = style === 'glass' ? 0.58 : style === 'office' ? 0.52 : style === 'stone' ? 0.46 : 0.4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = c * cw + ins, wy = r * ch + ins, ww = cw - ins * 2, wh = ch - ins * 2;
        // recess shadow around the opening
        d.fillStyle = 'rgba(0,0,0,0.30)'; d.fillRect(wx - 1.5, wy - 1.5, ww + 3, wh + 3);
        // glass with a vertical sky→ground gradient
        const g = d.createLinearGradient(0, wy, 0, wy + wh);
        g.addColorStop(0, this._shade(glass, 26));
        g.addColorStop(0.45, glass);
        g.addColorStop(1, this._shade(glass, -20));
        d.fillStyle = g; d.fillRect(wx, wy, ww, wh);
        // diagonal specular reflection
        d.fillStyle = 'rgba(255,255,255,0.13)';
        d.beginPath(); d.moveTo(wx, wy + wh); d.lineTo(wx + ww * 0.55, wy); d.lineTo(wx + ww, wy); d.lineTo(wx, wy + wh); d.closePath(); d.fill();
        // frame + central mullion
        d.strokeStyle = frame; d.lineWidth = Math.max(1, ins * 0.6); d.strokeRect(wx, wy, ww, wh);
        if (style === 'office' || style === 'glass') { d.fillStyle = frame; d.fillRect(wx + ww / 2 - 0.6, wy, 1.2, wh); }
        if (style === 'resi' || style === 'stone') { d.fillStyle = this._shade(wall, 20); d.fillRect(wx - 1, wy + wh, ww + 2, Math.max(1.5, ins * 0.5)); }
        if (style === 'stone') { d.fillStyle = this._shade(wall, -22); d.fillRect(wx - 1, wy - Math.max(1.5, ins * 0.4), ww + 2, Math.max(1.5, ins * 0.4)); } // stone lintel
        // night occupancy
        if (rnd() < litChance) {
          const b = 0.55 + rnd() * 0.45;
          const rr = 255 * b, gg = (212 + rnd() * 34) * b, bb = (148 + rnd() * 52) * b;
          n.fillStyle = `rgb(${rr | 0},${gg | 0},${bb | 0})`;
          n.fillRect(wx, wy, ww, wh);
        }
      }
    }
    // horizontal floor shadow lines for depth
    d.strokeStyle = 'rgba(0,0,0,0.22)'; d.lineWidth = 1;
    for (let r = 1; r < rows; r++) { d.beginPath(); d.moveTo(0, r * ch); d.lineTo(S, r * ch); d.stroke(); }

    const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.anisotropy = 8; return t; };
    const rough = style === 'glass' ? 0.12 : style === 'office' ? 0.42 : 0.7;
    const metal = style === 'glass' ? 0.35 : style === 'office' ? 0.18 : 0.05;
    const mat = Std({ map: mk(dayC), emissiveMap: mk(ngtC), emissive: new THREE.Color(0, 0, 0), roughness: rough, metalness: metal });
    this._facCache[key] = mat;
    return mat;
  }

  // Pick a facade material for a zone/level, varied by tile hash. Each
  // tag bundles several architectural styles (glass / office / stone / brick
  // / warm + cool residential) so neighbouring buildings rarely match — the
  // skyline reads like a real mixed-era downtown.
  _zoneFacade(zone, level, hash) {
    const P = {
      // Residential mid-rise: warm render, cool render, brick walk-up.
      res2: [
        { style: 'resi',  cols: 4, rows: 5, wall: '#b9a48a', glass: '#8fa6ad', frame: '#6a5640' },
        { style: 'resi',  cols: 4, rows: 5, wall: '#a7b0a4', glass: '#90a8b0', frame: '#55604f' },
        { style: 'stone', cols: 4, rows: 5, wall: '#a07a5e', glass: '#7c8e90', frame: '#5a4632' },
      ],
      // Residential towers: Hong-Kong-dense cool, Singapore-clean, warm render.
      res3: [
        { style: 'resi',  cols: 5, rows: 10, wall: '#9aa6b0', glass: '#8fb0bd', frame: '#4c5660' },
        { style: 'resi',  cols: 6, rows: 12, wall: '#b6ab9a', glass: '#9bb6bd', frame: '#5c5040' },
        { style: 'glass', cols: 5, rows: 11, wall: '#2a3640', glass: '#6f9aad', frame: '#162028' },
      ],
      // Commercial mid: clean office, and a London-stone chambers block.
      com2: [
        { style: 'office', cols: 5, rows: 7, wall: '#6b7178', glass: '#a8c6da', frame: '#3a4048' },
        { style: 'office', cols: 5, rows: 7, wall: '#7a818a', glass: '#9bb8cc', frame: '#414850' },
        { style: 'stone',  cols: 5, rows: 6, wall: '#cabfa8', glass: '#94a2a2', frame: '#897e66' },
      ],
      // Commercial high: dark-glass, teal-glass, and limestone art-deco.
      com3: [
        { style: 'glass', cols: 5, rows: 13, wall: '#16202c', glass: '#3f6076', frame: '#0b1420' },
        { style: 'glass', cols: 5, rows: 13, wall: '#1b2733', glass: '#4a6b82', frame: '#0d1822' },
        { style: 'glass', cols: 6, rows: 15, wall: '#202c30', glass: '#577a86', frame: '#101a1c' },
        { style: 'stone', cols: 6, rows: 14, wall: '#c7bda8', glass: '#8f9c9e', frame: '#857c68' },
      ],
      ind: [
        { style: 'office', cols: 4, rows: 3, wall: '#7b7d80', glass: '#9fb6c2', frame: '#3c3f44' },
      ],
    };
    const tag = zone === TILE.ZONE_RES ? (level >= 3 ? 'res3' : 'res2')
              : zone === TILE.ZONE_COM ? (level >= 3 ? 'com3' : 'com2')
              : 'ind';
    const opts = P[tag];
    const vi = hash % opts.length;
    const o = opts[vi];
    return this._facadeMat(`${tag}_${vi}`, { cols: o.cols, rows: o.rows, style: o.style, seed: 101 + vi * 37, wall: o.wall, glass: o.glass, frame: o.frame });
  }

  // ── Rooftop & ground-floor kit ──────────────────────────────────────────
  _capRoof(group, w, d, y) {
    group.add(this._kmesh(this.kit.box, this.matRoofDeck, w * 1.01, 0.03, d * 1.01, 0, y + 0.015, 0, false));
    const t = 0.028, ph = 0.06;
    const seg = (sw, sd, x, z) => group.add(this._kmesh(this.kit.box, this.matConc, sw, ph, sd, x, y + ph / 2, z, false));
    seg(w + 0.02, t, 0, d / 2); seg(w + 0.02, t, 0, -d / 2);
    seg(t, d + 0.02, w / 2, 0); seg(t, d + 0.02, -w / 2, 0);
  }

  _rooftop(group, w, d, y, hash, big) {
    const R = this._rng(hash ^ 0x9e3779b9);
    const span = (s) => (R() - 0.5) * s;
    // HVAC units
    const units = 1 + (R() * 3 | 0);
    for (let i = 0; i < units; i++) {
      const uw = 0.09 + R() * 0.10, ud = 0.09 + R() * 0.10, uh = 0.04 + R() * 0.05;
      const px = span(w * 0.6), pz = span(d * 0.6);
      group.add(this._kmesh(this.kit.box, this.matRoofMetal, uw, uh, ud, px, y + uh / 2, pz));
      group.add(this._kmesh(this.kit.box, this.matRoofDeck, uw * 0.7, 0.012, ud * 0.7, px, y + uh + 0.006, pz, false));
    }
    // vents
    for (let i = 0; i < 2; i++) { const vr = 0.016 + R() * 0.014; group.add(this._kmesh(this.kit.cyl8, this.matVent, vr, 0.05 + R() * 0.05, vr, span(w * 0.7), y + 0.04, span(d * 0.7))); }
    // water tank
    if (R() > 0.45) { const tr = 0.045 + R() * 0.03; group.add(this._kmesh(this.kit.cyl, this.matTank, tr, 0.09 + R() * 0.05, tr, span(w * 0.5), y + 0.06, span(d * 0.5))); }
    // mechanical penthouse
    if (R() > 0.4) { const pw = w * (0.28 + R() * 0.2), pd = d * (0.28 + R() * 0.2), ph = 0.07 + R() * 0.06; group.add(this._kmesh(this.kit.box, this.matConc, pw, ph, pd, span(w * 0.2), y + ph / 2, span(d * 0.2))); }
    // solar array (tilted panels)
    if (R() > 0.55) {
      const arr = 2 + (R() * 2 | 0);
      const baseZ = -d * 0.22;
      for (let s = 0; s < arr; s++) {
        const p = this._kmesh(this.kit.box, this.matSolar, w * 0.5, 0.006, 0.05, span(w * 0.15), y + 0.03, baseZ + s * 0.07, false);
        p.rotation.x = -0.5; group.add(p);
      }
    }
    if (big) {
      if (R() > 0.5) group.add(this._kmesh(this.kit.antenna, this.matVent, 0.5, 0.18 + R() * 0.18, 0.5, span(w * 0.4), y + 0.12, span(d * 0.4)));
      if (R() > 0.6) { const m = this._kmesh(this.kit.dish, this.matRoofMetal, 0.075, 0.075, 0.075, span(w * 0.4), y + 0.05, span(d * 0.4)); m.rotation.x = -0.7; group.add(m); }
    }
  }

  _helipad(group, w, d, y) {
    group.add(this._kmesh(this.kit.cyl, this.matHelipad, w * 0.34, 0.012, d * 0.34, 0, y + 0.006, 0, false));
    group.add(this._kmesh(this.kit.box, this.matHeliMark, w * 0.22, 0.006, 0.03, 0, y + 0.014, 0, false));
    group.add(this._kmesh(this.kit.box, this.matHeliMark, 0.03, 0.006, d * 0.14, 0, y + 0.014, 0, false));
  }

  _entrance(group, w, fz, hash) {
    // recessed door + flat canopy at the street face (fz = +z front)
    group.add(this._kmesh(this.kit.box, this.matDoor, w * 0.34, 0.16, 0.02, 0, 0.08, fz + 0.006, false));
    group.add(this._kmesh(this.kit.box, this.matCanopy, w * 0.44, 0.015, 0.09, 0, 0.18, fz + 0.045, false));
  }

  _storefront(group, w, h, fz, hash) {
    const baseH = Math.min(0.2, h * 0.42);
    group.add(this._kmesh(this.kit.box, this.matStoreGlass, w * 0.92, baseH, 0.02, 0, baseH / 2 + 0.01, fz + 0.006, false));
    // entrance + awning canopy
    group.add(this._kmesh(this.kit.box, this.matCanopy, w * 0.96, 0.015, 0.1, 0, baseH + 0.04, fz + 0.055, false));
    // illuminated sign band above the shopfront
    group.add(this._kmesh(this.kit.box, this.signMats[hash % this.signMats.length], w * 0.6, 0.06, 0.018, 0, baseH + 0.12, fz + 0.02, false));
  }

  _balconies(group, w, d, top, floors, fz) {
    for (let f = 1; f <= floors; f++) {
      const fy = (top / (floors + 1)) * f;
      group.add(this._kmesh(this.kit.box, this.matBalcony, w * 0.42, 0.02, 0.1, 0, fy, fz + 0.05, false));
      group.add(this._kmesh(this.kit.box, this.matBalGlass, w * 0.42, 0.05, 0.006, 0, fy + 0.035, fz + 0.1, false));
    }
  }

  // ─────── Canvas textures ───────

  _tex(key, fn) {
    if (this._texCache[key]) return this._texCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    fn(c.getContext('2d'), 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = 8;
    this._texCache[key] = t;
    return t;
  }

  _asphaltTex() {
    return this._tex('asphalt', (ctx, w, h) => {
      ctx.fillStyle = '#1e242e';
      ctx.fillRect(0, 0, w, h);
      // coarse aggregate
      for (let i = 0; i < 8000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const b = 28 + Math.floor(Math.random() * 24);
        ctx.fillStyle = `rgb(${b},${b},${b + 3})`;
        ctx.fillRect(x, y, 1 + Math.random() * 3, 1 + Math.random() * 3);
      }
      // fine noise overlay
      for (let i = 0; i < 5000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const b = 18 + Math.floor(Math.random() * 12);
        ctx.fillStyle = `rgba(${b},${b},${b},0.5)`;
        ctx.fillRect(x, y, 1, 1);
      }
      // hairline cracks
      ctx.strokeStyle = 'rgba(10,10,15,0.55)';
      ctx.lineWidth = 0.8;
      for (let k = 0; k < 6; k++) {
        const sx = Math.random() * w, sy = Math.random() * h;
        ctx.beginPath(); ctx.moveTo(sx, sy);
        let cx = sx, cy = sy;
        for (let s = 0; s < 5; s++) {
          cx += (Math.random() - 0.5) * 60; cy += (Math.random() - 0.5) * 60;
          ctx.lineTo(cx, cy);
        }
        ctx.stroke();
      }
    });
  }

  _brickTex() {
    return this._tex('brick', (ctx, w, h) => {
      // mortar base
      ctx.fillStyle = '#5a3820';
      ctx.fillRect(0, 0, w, h);
      const bw = 52, bh = 22, gap = 5;
      for (let row = 0; row * (bh + gap) < h; row++) {
        const ox = row % 2 === 0 ? 0 : (bw + gap) / 2;
        for (let col = -1; col * (bw + gap) < w + bw; col++) {
          const seed = Math.abs(col * 13 + row * 17) % 32;
          const hue = 12 + (seed % 6) - 3;
          const sat = 42 + (seed % 14);
          const lum = 30 + (seed % 14);
          const bx = ox + col * (bw + gap), by = row * (bh + gap);
          ctx.fillStyle = `hsl(${hue},${sat}%,${lum}%)`;
          ctx.fillRect(bx + 1, by + 1, bw - 1, bh - 1);
          // highlight edge (top-left)
          ctx.fillStyle = `hsl(${hue},${sat - 8}%,${lum + 7}%)`;
          ctx.fillRect(bx + 1, by + 1, bw - 1, 3);
          ctx.fillRect(bx + 1, by + 1, 3, bh - 1);
          // shadow edge (bottom-right)
          ctx.fillStyle = `hsl(${hue},${sat}%,${lum - 10}%)`;
          ctx.fillRect(bx + 1, by + bh - 3, bw - 1, 3);
          ctx.fillRect(bx + bw - 4, by + 1, 3, bh - 1);
          // surface grain flecks
          for (let k = 0; k < 5; k++) {
            const fx = bx + 3 + Math.random() * (bw - 6);
            const fy = by + 3 + Math.random() * (bh - 6);
            const fl = lum + Math.floor(Math.random() * 10) - 5;
            ctx.fillStyle = `hsl(${hue},${sat - 10}%,${fl}%)`;
            ctx.fillRect(fx, fy, 2, 2);
          }
        }
      }
      // deep mortar lines
      ctx.strokeStyle = '#2e1508';
      ctx.lineWidth = gap;
      for (let row = 0; row * (bh + gap) < h + gap; row++) {
        const my = row * (bh + gap);
        ctx.beginPath(); ctx.moveTo(0, my); ctx.lineTo(w, my); ctx.stroke();
      }
    });
  }

  _glassCurtainTex(cols, rows) {
    return this._tex(`glass_${cols}_${rows}`, (ctx, w, h) => {
      ctx.fillStyle = '#080f22';
      ctx.fillRect(0, 0, w, h);
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = Math.random() > 0.18;
          const hue = 196 + c * 7 + r * 2;
          const lum = lit ? 24 + (r % 6) * 4 : 6;
          const bx = c * cw + 2, by = r * ch + 2, bw2 = cw - 4, bh2 = ch - 4;
          // base window colour
          ctx.fillStyle = lit ? `hsl(${hue},60%,${lum}%)` : '#060e1c';
          ctx.fillRect(bx, by, bw2, bh2);
          if (lit) {
            // sky reflection band
            ctx.fillStyle = 'rgba(120,180,255,0.18)';
            ctx.fillRect(bx, by, bw2, Math.max(3, bh2 * 0.28));
            // warm interior glow at bottom
            ctx.fillStyle = 'rgba(255,200,130,0.10)';
            ctx.fillRect(bx, by + bh2 - Math.max(3, bh2 * 0.2), bw2, Math.max(3, bh2 * 0.2));
            // specular glint top-left corner
            ctx.fillStyle = 'rgba(200,230,255,0.38)';
            ctx.fillRect(bx, by, Math.max(2, bw2 * 0.18), Math.max(2, bh2 * 0.12));
          }
        }
      }
      // frame mullions
      ctx.strokeStyle = '#030a18';
      ctx.lineWidth = 3;
      for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r*ch); ctx.lineTo(w, r*ch); ctx.stroke(); }
      for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c*cw, 0); ctx.lineTo(c*cw, h); ctx.stroke(); }
      // thin highlight on mullions
      ctx.strokeStyle = 'rgba(100,150,220,0.15)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c*cw + 1, 0); ctx.lineTo(c*cw + 1, h); ctx.stroke(); }
    });
  }

  _corrugatedTex() {
    return this._tex('corrugated', (ctx, w, h) => {
      ctx.fillStyle = '#524838';
      ctx.fillRect(0, 0, w, h);
      // corrugation ribs
      for (let i = 0; i < w; i += 8) {
        const t = Math.sin((i / w) * Math.PI * 34) * 0.5 + 0.5;
        ctx.fillStyle = `hsl(33,18%,${24 + t * 18}%)`;
        ctx.fillRect(i, 0, 8, h);
      }
      // horizontal seam lines
      ctx.strokeStyle = 'rgba(20,14,8,0.55)';
      ctx.lineWidth = 2;
      for (let y = 64; y < h; y += 64) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      // rivet dots
      ctx.fillStyle = '#2e2416';
      for (let y = 32; y < h; y += 64) {
        for (let x = 12; x < w; x += 28) {
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      // rust streaks running down from rivets
      ctx.fillStyle = 'rgba(140,60,20,0.30)';
      for (let x = 12; x < w; x += 56) {
        for (let y = 32; y < h - 20; y += 64) {
          ctx.fillRect(x - 2, y, 4, 28 + Math.random() * 30);
        }
      }
      // surface scratches
      ctx.strokeStyle = 'rgba(200,180,150,0.12)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 8; k++) {
        const sx = Math.random() * w;
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx + (Math.random()-0.5)*20, h); ctx.stroke();
      }
    });
  }

  _aiPanelTex() {
    return this._tex('aipanel', (ctx, w, h) => {
      ctx.fillStyle = '#030912';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#001888';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 18; i++) {
        const y = (i / 18) * h;
        ctx.beginPath(); ctx.moveTo(0, y);
        ctx.lineTo(w * 0.22, y); ctx.lineTo(w * 0.22 + 14, y + 12); ctx.lineTo(w, y + 12); ctx.stroke();
      }
      for (let r = 0; r < 10; r++) for (let c = 0; c < 8; c++) {
        const on = Math.random() > 0.35;
        ctx.fillStyle = on ? (r % 3 === 0 ? '#00ffcc' : '#0088ff') : '#000c1a';
        ctx.beginPath(); ctx.arc(20 + c * 60, 18 + r * 46, 6, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  _slateRoofTex() {
    return this._tex('slate', (ctx, w, h) => {
      ctx.fillStyle = '#2e2424';
      ctx.fillRect(0, 0, w, h);
      const sh = 30, sw = 42;
      for (let row = 0; row < Math.ceil(h / sh); row++) {
        const ox = row % 2 === 0 ? 0 : sw / 2;
        for (let col = -1; col < Math.ceil(w / sw) + 1; col++) {
          const seed = Math.abs(col * 5 + row * 11) % 16;
          const l = 18 + seed % 12;
          ctx.fillStyle = `hsl(0,8%,${l}%)`;
          ctx.fillRect(ox + col * sw + 1, row * sh + 1, sw - 2, sh - 2);
          // highlight along top edge
          ctx.fillStyle = `hsl(0,6%,${l + 6}%)`;
          ctx.fillRect(ox + col * sw + 1, row * sh + 1, sw - 2, 3);
        }
      }
    });
  }

  _concreteTex() {
    return this._tex('concrete', (ctx, w, h) => {
      ctx.fillStyle = '#72706a';
      ctx.fillRect(0, 0, w, h);
      // coarse pebble noise
      for (let i = 0; i < 10000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        const v = 95 + Math.floor(Math.random() * 35);
        ctx.fillStyle = `rgba(${v},${v},${v - 3},0.7)`;
        ctx.fillRect(x, y, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5);
      }
      // formwork panel lines
      ctx.strokeStyle = 'rgba(40,38,34,0.35)';
      ctx.lineWidth = 1.5;
      for (let y = 80; y < h; y += 80) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      for (let x = 120; x < w; x += 120) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    });
  }

  _grassTex() {
    return this._tex('grass', (ctx, w, h) => {
      // base soil
      ctx.fillStyle = '#253d18';
      ctx.fillRect(0, 0, w, h);
      // dirt patches
      for (let k = 0; k < 8; k++) {
        const px = Math.random() * w, py = Math.random() * h;
        const pr = 20 + Math.random() * 40;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, pr);
        grd.addColorStop(0, 'rgba(80,52,24,0.55)');
        grd.addColorStop(1, 'rgba(80,52,24,0)');
        ctx.fillStyle = grd; ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
      }
      // coarse grass tufts — 3 shades
      const palette = ['#1e5014','#2a6018','#34741e','#3a8224','#285616','#4a8830'];
      for (let i = 0; i < 7000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
        ctx.fillRect(x, y, 2, 3 + Math.random() * 5);
      }
      // fine bright highlights
      for (let i = 0; i < 2000; i++) {
        const x = Math.random() * w, y = Math.random() * h;
        ctx.fillStyle = 'rgba(120,200,60,0.12)';
        ctx.fillRect(x, y, 1, 2);
      }
    });
  }

  // ─────── Custom geometry helpers ───────

  _gabledRoofGeo(fw, fd, peakH, overhang = 0.04) {
    const hw = fw / 2 + overhang, hd = fd / 2 + overhang;
    const pos = new Float32Array([
      -hw, 0, -hd,  hw, 0, -hd,  hw, 0,  hd, -hw, 0,  hd,
        0, peakH, -hd,   0, peakH,  hd,
    ]);
    const idx = [ 0,4,1, 3,2,5, 0,3,5, 0,5,4, 1,4,5, 1,5,2 ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ─────── Tree ───────

  buildTree(variant, scale) {
    const s = (scale || 1.0);
    const v = variant % 3;
    const group = new THREE.Group();

    const trunk = new THREE.Mesh(this.trunkGeo, this.trunkMats[v]);
    trunk.scale.set(s, s * (0.38 + v * 0.04), s);
    trunk.position.y = s * (0.19 + v * 0.02);
    trunk.castShadow = true;
    group.add(trunk);

    const cols = this.canopyMats[v];
    const main = new THREE.Mesh(this.treeGeoMed, cols[0]);
    main.scale.set(s * 0.30, s * 0.24, s * 0.30);
    main.position.y = s * (0.58 + v * 0.04);
    main.castShadow = true;
    group.add(main);

    const numSubs = 4 + v;
    for (let i = 0; i < numSubs; i++) {
      const ang = (i / numSubs) * Math.PI * 2 + v * 0.9;
      const r   = s * (0.16 + (i % 3) * 0.03);
      const sub = new THREE.Mesh(this.treeGeoSm, cols[(i + 1) % 3]);
      sub.scale.set(r, r * 0.70, r);
      sub.position.set(Math.cos(ang) * s * 0.20, s * (0.55 + Math.sin(i * 1.4) * 0.05), Math.sin(ang) * s * 0.20);
      sub.castShadow = true;
      group.add(sub);
    }
    return group;
  }

  // ─────── Park ───────

  buildPark(T, rng) {
    const group = new THREE.Group();
    const fw = T * 0.90;

    const grassMat = Std({ map: this._grassTex(), roughness: 0.95, metalness: 0 });
    const ground = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.020, fw), grassMat);
    ground.position.y = 0.010; ground.receiveShadow = true; group.add(ground);

    // Cruciform path
    const pathMat = Std({ color: 0xc0aa80, roughness: 0.85, metalness: 0 });
    const pH = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.024, fw * 0.13), pathMat);
    pH.position.y = 0.012; group.add(pH);
    const pV = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.13, 0.024, fw), pathMat);
    pV.position.y = 0.012; group.add(pV);

    // Fountain
    const stoneMat = Std({ color: 0xaaaaaa, roughness: 0.55, metalness: 0.10 });
    const basin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.17, 0.06, 14), stoneMat);
    basin.position.y = 0.030; group.add(basin);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 22), stoneMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.062; group.add(rim);
    const waterMat = Std({ color: 0x2288bb, roughness: 0.05, metalness: 0.08, transparent: true, opacity: 0.80 });
    const water = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.008, 14), waterMat);
    water.position.y = 0.061; group.add(water);
    const jetMat = Std({ color: 0x99ccee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.60 });
    const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.022, 0.24, 8), jetMat);
    jet.position.y = 0.18; group.add(jet);
    const spray = new THREE.Mesh(new THREE.SphereGeometry(0.042, 7, 5), jetMat);
    spray.position.y = 0.31; group.add(spray);

    // Corner trees
    const corners = [[-fw*0.33, fw*0.33],[fw*0.33, fw*0.33],[-fw*0.33,-fw*0.33],[fw*0.33,-fw*0.33]];
    for (let i = 0; i < corners.length; i++) {
      const tree = this.buildTree((i + Math.floor(rng * 3)) % 3, 0.52);
      tree.position.set(corners[i][0], 0.020, corners[i][1]);
      group.add(tree);
    }

    // Benches
    const woodMat = Std({ color: 0x7a4a1e, roughness: 0.90, metalness: 0 });
    const ironMat = Std({ color: 0x333333, roughness: 0.40, metalness: 0.75 });
    for (const [bz, ry] of [[fw*0.28, 0], [-fw*0.28, Math.PI]]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.010, 0.048), woodMat);
      seat.position.set(0, 0.044, bz); seat.rotation.y = ry; group.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.044, 0.008), woodMat);
      back.position.set(0, 0.065, bz + (ry ? 0.022 : -0.022)); back.rotation.y = ry; group.add(back);
      for (const lx of [-0.07, 0.07]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.038, 0.038), ironMat);
        leg.position.set(lx, 0.025, bz); leg.rotation.y = ry; group.add(leg);
      }
    }

    // Lamp posts inside park
    for (const [lx, lz] of [[-fw*0.28, 0],[fw*0.28, 0],[0, -fw*0.28],[0, fw*0.28]]) {
      const lamp = this._buildLampGroup();
      lamp.scale.setScalar(0.7);
      lamp.position.set(lx, 0.020, lz);
      group.add(lamp);
    }

    return group;
  }

  // ─────── Street lamp ───────

  buildStreetLamp() {
    const group = this._buildLampGroup();
    return group;
  }

  _buildLampGroup() {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(this.lampPoleGeo, this.lampPoleMat);
    pole.position.y = 0.30; pole.castShadow = true; group.add(pole);
    const arm = new THREE.Mesh(this.lampArmGeo, this.lampPoleMat);
    arm.rotation.z = Math.PI / 2; arm.position.set(0.065, 0.585, 0); group.add(arm);
    const head = new THREE.Mesh(this.lampHeadGeo, this.lampPoleMat);
    head.position.set(0.125, 0.573, 0); group.add(head);
    const bulb = new THREE.Mesh(this.lampBulbGeo, this.lampBulbMat);
    bulb.position.set(0.125, 0.556, 0); group.add(bulb);
    return group;
  }

  // ─────── Traffic light ───────

  buildTrafficLight() {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(this.tlPoleGeo, this.tlPoleMat);
    pole.position.y = 0.19; group.add(pole);
    const box  = new THREE.Mesh(this.tlBoxGeo, this.tlHouseMat);
    box.position.set(0, 0.387, 0); group.add(box);

    const lenses = [
      { mat: this.tlRedMat,    y: 0.416 },
      { mat: this.tlYellowMat, y: 0.387 },
      { mat: this.tlGreenMat,  y: 0.358 },
    ];
    for (const { mat, y } of lenses) {
      const l = new THREE.Mesh(this.tlLensGeo, mat);
      l.position.set(0, y, 0.013); group.add(l);
    }
    return group;
  }

  // ─────── Vehicle builders ───────

  vehicleColors = [0xd4cdc0, 0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xf0f0ee, 0x2c3e50, 0xe67e22, 0x16a085, 0xd35400, 0x1abc9c];

  buildVehicle(index) {
    const type = index % 5;
    const color = this.vehicleColors[index % this.vehicleColors.length];
    const group = new THREE.Group();
    const bodyMat = Std({ color, roughness: 0.25, metalness: 0.35 });

    if (type === 0) this._buildSedan(group, bodyMat);
    else if (type === 1) this._buildSUV(group, bodyMat);
    else if (type === 2) this._buildVan(group, bodyMat);
    else if (type === 3) this._buildPickup(group, bodyMat);
    else this._buildSports(group, bodyMat);

    this._addWheels(group, type);
    this._addCarLights(group, type);
    return group;
  }

  _addWheels(group, type) {
    const o = [
      { fx: 0.070, rz: 0.064, y: 0.037 },
      { fx: 0.074, rz: 0.069, y: 0.041 },
      { fx: 0.064, rz: 0.088, y: 0.037 },
      { fx: 0.070, rz: 0.078, y: 0.038 },
      { fx: 0.070, rz: 0.060, y: 0.033 },
    ][type];
    for (const [wx, wy, wz] of [[-o.fx, o.y, o.rz],[o.fx, o.y, o.rz],[-o.fx, o.y, -o.rz],[o.fx, o.y, -o.rz]]) {
      const w = new THREE.Mesh(this.wheelGeo, this.wheelMat);
      w.rotation.z = Math.PI / 2; w.position.set(wx, wy, wz); group.add(w);
      const hub = new THREE.Mesh(this.hubGeo, this.hubMat);
      hub.rotation.z = Math.PI / 2; hub.position.set(wx + (wx < 0 ? -0.013 : 0.013), wy, wz); group.add(hub);
    }
  }

  _addCarLights(group, type) {
    const hlMat = Std({ color: 0xffffee, roughness: 0.05, metalness: 0, emissive: new THREE.Color(0.5, 0.5, 0.3) });
    const tlMat = Std({ color: 0xff1800, roughness: 0.08, metalness: 0, emissive: new THREE.Color(0.4, 0.0, 0.0) });
    const lgeo = new THREE.BoxGeometry(0.017, 0.010, 0.007);
    const fz = [0.075, 0.088, 0.098, 0.070, 0.074][type];
    for (const sx of [-0.051, 0.051]) {
      const hl = new THREE.Mesh(lgeo, hlMat); hl.position.set(sx, 0.054, fz); group.add(hl);
      const tl = new THREE.Mesh(lgeo, tlMat); tl.position.set(sx, 0.054, -fz); group.add(tl);
    }
  }

  // Helper: build a mesh and place it. (Object3D.position is read-only, so it
  // must be set via .set(), never via Object.assign.)
  _part(geo, mat, x, y, z, rx, ry, rz) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x || 0, y || 0, z || 0);
    if (rx || ry || rz) mesh.rotation.set(rx || 0, ry || 0, rz || 0);
    mesh.castShadow = true;
    return mesh;
  }

  _buildSedan(g, m) {
    g.add(this._part(new THREE.BoxGeometry(0.130,0.048,0.220), m, 0,0.058,0));
    g.add(this._part(new THREE.BoxGeometry(0.102,0.040,0.110), this.glassMat, 0,0.104,-0.012));
    const hoodMat = Std({ color: m.color.getHex(), roughness: 0.25, metalness: 0.35 });
    g.add(this._part(new THREE.BoxGeometry(0.130,0.012,0.058), hoodMat, 0,0.074,0.098, 0.22,0,0));
  }

  _buildSUV(g, m) {
    g.add(this._part(new THREE.BoxGeometry(0.140,0.062,0.240), m, 0,0.066,0));
    g.add(this._part(new THREE.BoxGeometry(0.122,0.050,0.142), this.glassMat, 0,0.116,-0.008));
    const rackMat = Std({ color: 0x444444, roughness: 0.5, metalness: 0.6 });
    g.add(this._part(new THREE.BoxGeometry(0.110,0.007,0.120), rackMat, 0,0.143,-0.010));
  }

  _buildVan(g, m) {
    g.add(this._part(new THREE.BoxGeometry(0.130,0.098,0.240), m, 0,0.074,0));
    g.add(this._part(new THREE.BoxGeometry(0.112,0.056,0.010), this.glassMat, 0,0.088,0.118));
  }

  _buildPickup(g, m) {
    g.add(this._part(new THREE.BoxGeometry(0.130,0.060,0.120), m, 0,0.062,0.042));
    g.add(this._part(new THREE.BoxGeometry(0.112,0.044,0.098), this.glassMat, 0,0.108,0.042));
    g.add(this._part(new THREE.BoxGeometry(0.130,0.028,0.118), m, 0,0.046,-0.072));
  }

  _buildSports(g, m) {
    g.add(this._part(new THREE.BoxGeometry(0.122,0.036,0.218), m, 0,0.048,0));
    g.add(this._part(new THREE.BoxGeometry(0.092,0.030,0.088), this.glassMat, 0,0.079,-0.010));
    const spoilerMat = Std({ color: 0x111111, roughness: 0.5, metalness: 0.4 });
    g.add(this._part(new THREE.BoxGeometry(0.100,0.011,0.016), spoilerMat, 0,0.070,-0.100));
  }

  // ─────── Citizen builder ───────

  buildCitizen(index) {
    const isAI = index % 4 === 0;
    const skinPalette = [0xffddbb,0xffcc99,0xcc9966,0xf0a070,0x88aacc,0xd4a07a];
    const shirtPalette = [0x3355aa,0xaa3333,0x228833,0x884400,0x553388,0x2277aa,0x888800,0x226688];
    const pantsPalette = [0x223355,0x332211,0x112233,0x334422,0x111111];
    const skin  = isAI ? 0x88ccff : skinPalette[index % skinPalette.length];
    const shirt = shirtPalette[(index * 3 + 1) % shirtPalette.length];
    const pants = pantsPalette[(index * 7 + 2) % pantsPalette.length];

    const group = new THREE.Group();
    const skinMat  = Std({ color: skin,  roughness: 0.85, metalness: 0 });
    const shirtMat = Std({ color: shirt, roughness: 0.80, metalness: 0, emissive: isAI ? new THREE.Color(0x000a22) : new THREE.Color(0) });
    const legMat   = Std({ color: pants, roughness: 0.82, metalness: 0 });
    const shoeMat  = Std({ color: 0x1a1008, roughness: 0.75, metalness: 0 });

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.019, 9, 7), skinMat);
    head.position.y = 0.080; group.add(head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.007,0.009,0.012,6), skinMat);
    neck.position.y = 0.063; group.add(neck);

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.014,0.036,8), shirtMat);
    torso.position.y = 0.050; group.add(torso);

    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.013,0.011,0.014,8), legMat);
    hips.position.y = 0.030; group.add(hips);

    const leftThigh  = new THREE.Mesh(new THREE.CylinderGeometry(0.008,0.007,0.018,7), legMat);
    leftThigh.position.set(-0.009,0.018,0);
    const rightThigh = leftThigh.clone(); rightThigh.position.set(0.009,0.018,0);
    group.add(leftThigh, rightThigh);

    const leftShin  = new THREE.Mesh(new THREE.CylinderGeometry(0.006,0.005,0.016,6), legMat);
    leftShin.position.set(-0.009,0.007,0);
    const rightShin = leftShin.clone(); rightShin.position.set(0.009,0.007,0);
    group.add(leftShin, rightShin);

    const footGeo = new THREE.BoxGeometry(0.010,0.006,0.016);
    const lf = new THREE.Mesh(footGeo, shoeMat); lf.position.set(-0.009,0.003,0.004); group.add(lf);
    const rf = new THREE.Mesh(footGeo, shoeMat); rf.position.set(0.009,0.003,0.004); group.add(rf);

    const leftArm  = new THREE.Mesh(new THREE.CylinderGeometry(0.005,0.005,0.024,6), shirtMat);
    leftArm.position.set(-0.020,0.050,0); leftArm.rotation.z = 0.18;
    const rightArm = leftArm.clone(); rightArm.position.set(0.020,0.050,0); rightArm.rotation.z = -0.18;
    group.add(leftArm, rightArm);

    const leftForearm  = new THREE.Mesh(new THREE.CylinderGeometry(0.004,0.004,0.020,5), skinMat);
    leftForearm.position.set(-0.024,0.036,0); leftForearm.rotation.z = 0.25;
    const rightForearm = leftForearm.clone(); rightForearm.position.set(0.024,0.036,0); rightForearm.rotation.z = -0.25;
    group.add(leftForearm, rightForearm);

    if (isAI) {
      const haloMat = new THREE.MeshBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.82 });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.025,0.003,6,20), haloMat);
      halo.rotation.x = Math.PI / 2; halo.position.y = 0.106; group.add(halo);
      group._haloMat = haloMat;
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
      for (const ex of [-0.007, 0.007]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.003,5,4), eyeMat);
        eye.position.set(ex, 0.081, 0.018); group.add(eye);
      }
    }

    group._leftLeg = leftThigh; group._rightLeg = rightThigh;
    group._leftLegL = leftShin; group._rightLegL = rightShin;
    group._leftArm = leftArm; group._rightArm = rightArm;
    group._leftForearm = leftForearm; group._rightForearm = rightForearm;
    return group;
  }

  // ─────── Residential buildings ───────

  buildResidential(x, y, T, level, rng) {
    const group = new THREE.Group();
    const hash = this._hash(x, y);
    if (level === 1) { this._house(group, T, hash); group._windowMats = [this.matHouseBrick]; return group; }

    const fw = T * 0.82;
    const h  = this._bldH(x, y, TILE.ZONE_RES, level);
    const fz = fw / 2;
    const fac = this._zoneFacade(TILE.ZONE_RES, level, hash);
    const shape = hash % 4;

    if (level === 2) {
      // Mid-rise apartment block — footprint varies (box / L / slab).
      if (shape === 0) {
        // L-shape: main wing + side wing
        group.add(this._kmesh(this.kit.box, fac, fw, h, fw * 0.6, -fw * 0.12, h / 2, fz - fw * 0.3));
        group.add(this._kmesh(this.kit.box, fac, fw * 0.55, h, fw * 0.5, fw * 0.32, h / 2, -fw * 0.2));
        this._capRoof(group, fw, fw * 0.6, h); this._capRoof(group, fw * 0.55, fw * 0.5, h);
      } else if (shape === 1) {
        // slab
        group.add(this._kmesh(this.kit.box, fac, fw, h, fw * 0.62, 0, h / 2, 0));
        this._capRoof(group, fw, fw * 0.62, h);
      } else if (shape === 2) {
        // U-shape around a rear courtyard (back wing + two side wings)
        const wing = fw * 0.3;
        group.add(this._kmesh(this.kit.box, fac, fw, h, wing, 0, h / 2, -fz + wing / 2));
        group.add(this._kmesh(this.kit.box, fac, wing, h, fw * 0.74, -fz + wing / 2, h / 2, fw * 0.06));
        group.add(this._kmesh(this.kit.box, fac, wing, h, fw * 0.74, fz - wing / 2, h / 2, fw * 0.06));
        this._capRoof(group, fw, wing, h);
        this._capRoof(group, wing, fw * 0.74, h); this._capRoof(group, wing, fw * 0.74, h);
      } else {
        group.add(this._kmesh(this.kit.box, fac, fw, h, fw, 0, h / 2, 0));
        this._capRoof(group, fw, fw, h);
      }
      this._balconies(group, fw, fw, h, 2, fz);
      this._rooftop(group, fw, fw, h, hash, false);
      this._entrance(group, fw, fz, hash);

    } else {
      // Apartment tower — stacked setbacks for a real high-rise silhouette.
      let cw = fw, cd = fw, y0 = 0;
      const tiers = 2 + (hash % 2);
      for (let t = 0; t < tiers; t++) {
        const th = t === 0 ? h * 0.5 : (h * 0.5 / (tiers - 1));
        group.add(this._kmesh(this.kit.box, fac, cw, th, cd, 0, y0 + th / 2, 0));
        if (t > 0) group.add(this._kmesh(this.kit.box, this.matConc, cw + 0.05, 0.025, cd + 0.05, 0, y0 + 0.012, 0, false));
        y0 += th; cw *= 0.82; cd *= 0.82;
      }
      this._capRoof(group, cw, cd, y0);
      this._balconies(group, fw, fw, h * 0.5, 3, fz);
      this._rooftop(group, cw, cd, y0, hash, true);
      this._entrance(group, fw, fz, hash);
    }

    group._windowMats = [fac];
    return group;
  }

  // Detached house with gabled roof, chimney, porch and door.
  _house(group, T, hash) {
    const fw = T * 0.78;
    const h = 0.4 + (this._rng(hash)() * 0.12);
    const body = this._kmesh(this.kit.box, this.matHouseBrick, fw, h, fw, 0, h / 2, 0);
    group.add(body);
    const roof = new THREE.Mesh(this._gabledRoofGeo(fw, fw, h * 0.55, 0.045), this.matHouseSlate);
    roof.position.y = h; roof.castShadow = true; group.add(roof);
    // chimney
    group.add(this._kmesh(this.kit.box, this.matHouseBrick, 0.065, 0.26, 0.065, fw * 0.24, h + 0.10, fw * 0.18));
    group.add(this._kmesh(this.kit.box, this.matRoofDeck, 0.08, 0.018, 0.08, fw * 0.24, h + 0.24, fw * 0.18, false));
    // porch + posts + door
    group.add(this._kmesh(this.kit.box, this.matConc, fw * 0.55, 0.022, 0.14, 0, 0.011, fw * 0.5 + 0.07, false));
    for (const px of [-fw * 0.19, fw * 0.19]) group.add(this._kmesh(this.kit.cyl, this.matHouseTrim, 0.016, h * 0.6, 0.016, px, h * 0.3, fw * 0.5 + 0.12, false));
    group.add(this._kmesh(this.kit.box, this.matHouseDoor, 0.066, 0.12, 0.01, 0, 0.06, fw * 0.5 + 0.006, false));
  }

  // ─────── Commercial buildings ───────

  buildCommercial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const hash = this._hash(x, y);
    const fw = T * 0.82;
    const h  = this._bldH(x, y, TILE.ZONE_COM, level);
    const fz = fw / 2;

    if (level === 1) {
      // Two-storey retail block with a glazed shopfront and lit signage.
      const fac = this._zoneFacade(TILE.ZONE_COM, 2, hash);
      group.add(this._kmesh(this.kit.box, fac, fw, h, fw, 0, h / 2, 0));
      this._capRoof(group, fw, fw, h);
      this._storefront(group, fw, h, fz, hash);
      // awning over the shopfront
      const aw = this._kmesh(this.kit.box, this.signMats[(hash >> 2) % this.signMats.length], fw * 0.88, 0.016, 0.16, 0, h * 0.5, fz + 0.06, false);
      aw.rotation.x = -0.28; group.add(aw);
      this._rooftop(group, fw, fw, h, hash, false);
      group._windowMats = [fac];
      return group;
    }

    const fac = this._zoneFacade(TILE.ZONE_COM, level, hash);

    if (level === 2) {
      // Podium + office tower.
      const podH = Math.min(0.28, h * 0.22);
      group.add(this._kmesh(this.kit.box, this.matPodium, fw * 1.08, podH, fw * 1.08, 0, podH / 2, 0));
      const towerH = h - podH;
      const slim = (hash & 1) ? 0.86 : 1.0;
      group.add(this._kmesh(this.kit.box, fac, fw * slim, towerH, fw, 0, podH + towerH / 2, 0));
      this._capRoof(group, fw * slim, fw, h);
      this._rooftop(group, fw * slim, fw, h, hash, true);
      this._storefront(group, fw, podH, fz, hash);
      group._windowMats = [fac];
      return group;
    }

    // ── Level 3: signature skyscraper ──
    // Rare tiles become hero landmarks (supertall, observation deck, crown).
    if (hash % 9 === 0) { this._heroTower(group, fw, h, hash, fac); this._storefront(group, fw, 0.3, fz, hash); group._windowMats = [fac]; return group; }

    const style3 = hash % 3; // 0 art-deco · 1 modern setback · 2 curved round-glass
    if (style3 === 2) {
      // Curved round-glass tower (Dubai / Melbourne style), gently tapered.
      const podH = Math.min(0.3, h * 0.16);
      group.add(this._kmesh(this.kit.box, this.matPodium, fw * 1.08, podH, fw * 1.08, 0, podH / 2, 0));
      const seg = h - podH, rad = fw * 0.5;
      const lowerH = seg * 0.62, upperH = seg * 0.38;
      group.add(this._kmesh(this.kit.cyl, fac, rad, lowerH, rad, 0, podH + lowerH / 2, 0));
      group.add(this._kmesh(this.kit.cyl, this.matConc, rad + 0.02, 0.022, rad + 0.02, 0, podH + lowerH + 0.011, 0, false));
      group.add(this._kmesh(this.kit.cyl, fac, rad * 0.82, upperH, rad * 0.82, 0, podH + lowerH + upperH / 2, 0));
      const topY = podH + lowerH + upperH;
      group.add(this._kmesh(this.kit.cyl, this.matRoofDeck, rad * 0.84, 0.02, rad * 0.84, 0, topY + 0.01, 0, false));
      group.add(this._kmesh(this.kit.cyl, this.matConc, rad * 0.34, 0.09, rad * 0.34, 0, topY + 0.05, 0));
      group.add(this._kmesh(this.kit.antenna, this.matSpire, 0.6, h * 0.14, 0.6, 0, topY + h * 0.07, 0));
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      beacon._isBeacon = true; beacon.position.y = topY + h * 0.14 + 0.01; group.add(beacon);
      group._beacon = beacon;
      this._storefront(group, fw, podH, fz, hash);
      group._windowMats = [fac];
      return group;
    }
    const decoStyle = (style3 === 0);
    if (decoStyle) {
      // Art-deco stepped tower with a crown.
      const tiers = [{ w: fw, th: h * 0.50 }, { w: fw * 0.74, th: h * 0.30 }, { w: fw * 0.5, th: h * 0.20 }];
      let yOff = 0;
      for (let ti = 0; ti < tiers.length; ti++) {
        const tier = tiers[ti];
        group.add(this._kmesh(this.kit.box, fac, tier.w, tier.th, tier.w, 0, yOff + tier.th / 2, 0));
        if (yOff > 0) group.add(this._kmesh(this.kit.box, this.matConc, tier.w + 0.06, 0.028, tier.w + 0.06, 0, yOff + 0.014, 0, false));
        yOff += tier.th;
      }
      const topW = tiers[2].w;
      const spire = this._kmesh(this.kit.cyl8, this.matSpire, 0.02, h * 0.3, 0.02, 0, yOff + h * 0.15, 0);
      group.add(spire);
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9 });
      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(topW * 0.4, 0.022, 7, 26), ledMat);
      ledRing.rotation.x = Math.PI / 2; ledRing.position.y = yOff - 0.03; group.add(ledRing);
      group._ledRingMat = ledMat;
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      beacon._isBeacon = true; beacon.position.y = yOff + h * 0.3 + 0.01; group.add(beacon);
      group._beacon = beacon;
      this._rooftop(group, topW, topW, yOff, hash, false);
    } else {
      // Modern slender glass tower with podium, helipad and antenna mast.
      const podH = Math.min(0.3, h * 0.16);
      group.add(this._kmesh(this.kit.box, this.matPodium, fw * 1.1, podH, fw * 1.1, 0, podH / 2, 0));
      let cw = fw, cd = fw * ((hash & 1) ? 0.78 : 0.92), y0 = podH;
      const tiers = 2 + (hash % 2);
      for (let t = 0; t < tiers; t++) {
        const th = (h - podH) / tiers;
        group.add(this._kmesh(this.kit.box, fac, cw, th, cd, 0, y0 + th / 2, 0));
        if (t > 0) group.add(this._kmesh(this.kit.box, this.matConc, cw + 0.04, 0.022, cd + 0.04, 0, y0 + 0.011, 0, false));
        y0 += th; cw *= 0.88; cd *= 0.88;
      }
      this._capRoof(group, cw, cd, y0);
      const hasMast = (hash & 4) === 0;
      if ((hash & 2) && !hasMast) this._helipad(group, cw, cd, y0);
      if (hasMast) {
        // antenna mast + aviation beacon
        group.add(this._kmesh(this.kit.antenna, this.matSpire, 0.6, h * 0.16, 0.6, 0, y0 + h * 0.08, 0));
        const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
        beacon._isBeacon = true; beacon.position.y = y0 + h * 0.16 + 0.01; group.add(beacon);
        group._beacon = beacon;
      }
      this._rooftop(group, cw, cd, y0, hash, false);
    }
    this._storefront(group, fw, 0.26, fz, hash);
    group._windowMats = [fac];
    return group;
  }

  // A landmark supertall: tapered multi-setback shaft, a mid-height glazed
  // observation deck, an illuminated animated crown and spire. Towers over its
  // neighbours so it reads as a true city centrepiece.
  _heroTower(group, fw, h, hash, fac) {
    const H = h * 1.7;
    const podH = Math.min(0.4, H * 0.08);
    group.add(this._kmesh(this.kit.box, this.matPodium, fw * 1.2, podH, fw * 1.2, 0, podH / 2, 0));
    const tiers = 5;
    let cw = fw * 1.02, cd = fw * 1.02, y0 = podH;
    const shaftH = H - podH;
    for (let t = 0; t < tiers; t++) {
      const th = shaftH / tiers;
      group.add(this._kmesh(this.kit.box, fac, cw, th, cd, 0, y0 + th / 2, 0));
      group.add(this._kmesh(this.kit.box, this.matConc, cw + 0.05, 0.024, cd + 0.05, 0, y0 + 0.012, 0, false));
      if (t === tiers - 2) { // observation deck — cantilevered glazed band + rail
        group.add(this._kmesh(this.kit.box, this.matDeck, cw + 0.12, th * 0.4, cd + 0.12, 0, y0 + th * 0.5, 0, false));
        group.add(this._kmesh(this.kit.box, this.matSpire, cw + 0.14, 0.02, cd + 0.14, 0, y0 + th * 0.72, 0, false));
      }
      y0 += th; cw *= 0.86; cd *= 0.86;
    }
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9 });
    const ledRing = new THREE.Mesh(new THREE.TorusGeometry(cw * 0.6, 0.02, 8, 28), ledMat);
    ledRing.rotation.x = Math.PI / 2; ledRing.position.y = y0 + 0.02; group.add(ledRing);
    group._ledRingMat = ledMat;
    group.add(this._kmesh(this.kit.cyl8, this.matSpire, 0.018, H * 0.18, 0.018, 0, y0 + H * 0.09, 0));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.024, 7, 5), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
    beacon._isBeacon = true; beacon.position.y = y0 + H * 0.18 + 0.01; group.add(beacon);
    group._beacon = beacon;
    this._rooftop(group, cw, cd, y0, hash, false);
  }

  // ─────── Construction site (multi-stage) ───────

  // Representative final height for a zone/level (no per-tile noise).
  _approxHeight(zone, level) {
    const base = { [TILE.ZONE_RES]: [0, 0.42, 1.40, 3.40], [TILE.ZONE_COM]: [0, 0.55, 2.00, 6.00], [TILE.ZONE_IND]: [0, 0.60, 1.00, 1.60] };
    const vary = { [TILE.ZONE_RES]: [0, 0.12, 0.50, 1.60], [TILE.ZONE_COM]: [0, 0.15, 0.80, 3.00], [TILE.ZONE_IND]: [0, 0.15, 0.30, 0.50] };
    return base[zone][level] + vary[zone][level] * 0.5;
  }

  // A live construction site: a structural frame that rises with progress,
  // wrapped in scaffolding, served by an animated tower crane. `stage` is 0..1.
  buildConstructionSite(zone, T, target, stage, hash) {
    const group = new THREE.Group();
    const R = this._rng(hash ^ 0x51ed2701);
    const fw = T * 0.82;
    const Hfull = this._approxHeight(zone, target);
    // Structure rises through the framing phase, finishing in the last 15%.
    const grow = Math.min(1, stage / 0.85);
    const builtH = Math.max(0.1, Hfull * grow);

    // Foundation pad + footing
    group.add(this._kmesh(this.kit.box, this.matSiteConc, fw * 1.06, 0.05, fw * 1.06, 0, 0.025, 0, false));
    group.add(this._kmesh(this.kit.box, this.matRoofDeck, fw * 1.12, 0.02, fw * 1.12, 0, 0.01, 0, false));

    // Hazard fencing while the site is open at ground level
    if (stage < 0.55) this._siteFence(group, fw);

    if (stage < 0.18) {
      // Site preparation: excavation pit + earth-moving vehicle, no frame yet.
      group.add(this._kmesh(this.kit.box, this.matRoofDeck, fw * 0.7, 0.04, fw * 0.7, 0, 0.04, 0, false));
      const dozer = this._siteVehicle(hash);
      dozer.position.set((R() - 0.5) * fw * 0.3, 0.02, fw * 0.18);
      dozer.rotation.y = R() * Math.PI;
      group.add(dozer);
    } else {
      // Structural frame: corner columns + floor slabs up to the built height.
      for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        group.add(this._kmesh(this.kit.cyl8, this.matRebar, 0.02, builtH, 0.02, sx * fw * 0.42, builtH / 2, sz * fw * 0.42));
      }
      const floors = Math.max(1, Math.round(builtH / 0.34));
      for (let f = 1; f <= floors; f++) {
        const fy = f * (builtH / floors);
        group.add(this._kmesh(this.kit.box, this.matSiteConc, fw * 0.9, 0.03, fw * 0.9, 0, fy, 0, false));
      }
      // Core
      group.add(this._kmesh(this.kit.box, this.matSiteConc, fw * 0.3, builtH, fw * 0.3, 0, builtH / 2, 0, false));

      // Partial facade climbing from the base once we hit the cladding phase.
      if (stage > 0.7) {
        const fac = this._zoneFacade(zone, target, hash);
        const clad = builtH * Math.min(1, (stage - 0.7) / 0.3);
        group.add(this._kmesh(this.kit.box, fac, fw, Math.max(0.1, clad), fw, 0, clad / 2, 0));
        group._windowMats = [fac];
        // shrink-wrap sheeting on the still-bare upper floors
        if (clad < builtH - 0.05) group.add(this._kmesh(this.kit.box, this.matSiteWrap, fw * 1.01, builtH - clad, fw * 1.01, 0, clad + (builtH - clad) / 2, 0, false));
      } else if (stage > 0.35) {
        // bare-frame sheeting wrap
        group.add(this._kmesh(this.kit.box, this.matSiteWrap, fw * 1.01, builtH, fw * 1.01, 0, builtH / 2, 0, false));
      }

      // Scaffolding lattice around the perimeter
      this._scaffold(group, fw, builtH);
    }

    // Tower crane beside the structure (animated jib)
    this._crane(group, fw, Math.max(Hfull, builtH) + 0.3, hash);

    return group;
  }

  _siteFence(group, fw) {
    const h = 0.08, e = fw * 0.58;
    for (const [sw, sd, x, z] of [[e * 2, 0.012, 0, e], [e * 2, 0.012, 0, -e], [0.012, e * 2, e, 0], [0.012, e * 2, -e, 0]]) {
      group.add(this._kmesh(this.kit.box, this.matFence, sw, h, sd, x, h / 2, z, false));
    }
  }

  _scaffold(group, fw, h) {
    const m = this.matScaffold, e = fw * 0.52;
    // vertical poles at the four mid-edges + corners
    const posts = [[-e, -e], [e, -e], [-e, e], [e, e], [0, e], [0, -e], [e, 0], [-e, 0]];
    for (const [x, z] of posts) group.add(this._kmesh(this.kit.cyl8, m, 0.008, h, 0.008, x, h / 2, z, false));
    // horizontal rails every ~0.4 up the front and sides
    const rings = Math.max(1, Math.round(h / 0.4));
    for (let r = 1; r <= rings; r++) {
      const ry = r * (h / (rings + 1));
      group.add(this._kmesh(this.kit.box, m, e * 2, 0.006, 0.006, 0, ry, e, false));
      group.add(this._kmesh(this.kit.box, m, e * 2, 0.006, 0.006, 0, ry, -e, false));
      group.add(this._kmesh(this.kit.box, m, 0.006, 0.006, e * 2, e, ry, 0, false));
      group.add(this._kmesh(this.kit.box, m, 0.006, 0.006, e * 2, -e, ry, 0, false));
    }
  }

  _crane(group, fw, topH, hash) {
    const m = this.matCrane;
    const bx = fw * 0.6, bz = -fw * 0.5;
    const mastH = topH + 0.4;
    // mast (lattice approximated by a slim box) + base
    group.add(this._kmesh(this.kit.box, this.matRoofDeck, 0.1, 0.04, 0.1, bx, 0.02, bz, false));
    group.add(this._kmesh(this.kit.box, m, 0.035, mastH, 0.035, bx, mastH / 2, bz, false));
    // slewing jib group (animated by the renderer)
    const jib = new THREE.Group();
    jib.position.set(bx, mastH, bz);
    jib.add(this._kmesh(this.kit.box, m, 0.85, 0.03, 0.03, 0.3, 0, 0, false));   // working jib
    jib.add(this._kmesh(this.kit.box, m, 0.26, 0.03, 0.03, -0.12, 0, 0, false)); // counter jib
    jib.add(this._kmesh(this.kit.box, this.matRoofDeck, 0.08, 0.07, 0.08, -0.2, 0, 0, false)); // counterweight
    jib.add(this._kmesh(this.kit.box, m, 0.05, 0.06, 0.05, 0, 0.05, 0, false));  // cab
    jib.add(this._kmesh(this.kit.box, m, 0.005, 0.28, 0.005, 0.6, -0.14, 0, false)); // hoist cable
    jib.add(this._kmesh(this.kit.box, this.matRebar, 0.03, 0.03, 0.03, 0.6, -0.29, 0, false)); // hook block
    group.add(jib);
    group._craneJib = jib;
    // aviation beacon on the mast top (blinks via renderer)
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
    beacon._isBeacon = true; beacon.position.set(bx, mastH + 0.03, bz); group.add(beacon);
    group._beacon = beacon;
  }

  // A small earth-mover (bulldozer-ish) for site-prep stages.
  _siteVehicle(hash) {
    const g = new THREE.Group();
    const body = Std({ color: 0xf2b400, roughness: 0.5, metalness: 0.4 });
    g.add(this._kmesh(this.kit.box, body, 0.12, 0.05, 0.16, 0, 0.06, 0, false));
    g.add(this._kmesh(this.kit.box, body, 0.08, 0.045, 0.07, 0, 0.105, -0.02, false)); // cab
    g.add(this._kmesh(this.kit.box, this.matRebar, 0.14, 0.05, 0.015, 0, 0.05, 0.1, false)); // blade
    for (const sx of [-0.06, 0.06]) g.add(this._kmesh(this.kit.box, this.matRoofDeck, 0.03, 0.05, 0.16, sx, 0.03, 0, false)); // tracks
    return g;
  }

  // ─────── Industrial buildings ───────

  buildIndustrial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const hash = this._hash(x, y);
    const R = this._rng(hash);
    const fw = T * 0.84;
    const h  = this._bldH(x, y, TILE.ZONE_IND, level);
    const fz = fw / 2;

    // Main shed
    group.add(this._kmesh(this.kit.box, this.matIndWall, fw, h, fw, 0, h / 2, 0));
    const roof = new THREE.Mesh(this._gabledRoofGeo(fw, fw, fw * 0.22, 0.04), this.matIndRoof);
    roof.position.y = h; roof.castShadow = true; group.add(roof);
    // skylight strip
    group.add(this._kmesh(this.kit.box, this.matBalGlass, fw * 0.16, 0.01, fw * 0.7, 0, h + fw * 0.2, 0, false));

    // Office annex with real windows at the street face
    const ofac = this._zoneFacade(TILE.ZONE_IND, 1, hash);
    const oh = h * 0.6, ow = fw * 0.42;
    group.add(this._kmesh(this.kit.box, ofac, ow, oh, fw * 0.3, fw * 0.26, oh / 2, fz - fw * 0.18));
    this._capRoof(group, ow, fw * 0.3, oh);

    // Loading dock + lit door frame
    group.add(this._kmesh(this.kit.box, this.matDoor, fw * 0.34, h * 0.42, 0.05, -fw * 0.12, h * 0.21, fz + 0.026, false));
    group.add(this._kmesh(this.kit.box, this.signMats[2], fw * 0.36, 0.014, 0.02, -fw * 0.12, h * 0.42, fz + 0.026, false));

    // Roof vents
    for (let i = 0; i < 3; i++) { const vr = 0.02 + R() * 0.015; group.add(this._kmesh(this.kit.cyl8, this.matVent, vr, 0.06, vr, (R() - 0.5) * fw * 0.6, h + 0.05, (R() - 0.5) * fw * 0.4)); }

    if (level >= 2) {
      // Storage silos
      const silos = level === 3 ? 3 : 2;
      for (let s = 0; s < silos; s++) {
        const sr = 0.07 + R() * 0.02, sh = h * (0.7 + R() * 0.4);
        const sx = -fw * 0.3 + s * fw * 0.26;
        group.add(this._kmesh(this.kit.cyl, this.matTank, sr, sh, sr, sx, sh / 2, -fw * 0.34));
        group.add(this._kmesh(this.kit.cone, this.matRoofMetal, sr * 2, sr, sr * 2, sx, sh + sr / 2, -fw * 0.34, false));
      }
      // Smokestacks with hazard rings
      const stacks = level === 3 ? 2 : 1;
      const ringMat = Std({ color: 0xdd2222, roughness: 0.5, metalness: 0.15 });
      for (let s = 0; s < stacks; s++) {
        const sx = fw * 0.2 - s * fw * 0.2, sh = h * (0.8 + R() * 0.3);
        group.add(this._kmesh(this.kit.cyl, this.matRoofMetal, 0.05, sh, 0.05, sx, h + sh / 2, -fw * 0.2));
        for (let r = 0; r < 3; r++) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.011, 6, 12), ringMat); ring.rotation.x = Math.PI / 2; ring.position.set(sx, h + sh * (0.3 + r * 0.28), -fw * 0.2); group.add(ring); }
      }
      // Pipe rack along one side
      const pipe = this._kmesh(this.kit.cyl8, this.matPipe, 0.025, fw * 0.7, 0.025, -fz - 0.02, h * 0.4, 0);
      pipe.rotation.x = Math.PI / 2; group.add(pipe);
    }

    if (level === 3) {
      // Gantry crane over the yard
      const craneMat = Std({ color: 0xdd9900, roughness: 0.45, metalness: 0.45 });
      group.add(this._kmesh(this.kit.box, craneMat, fw * 0.9, 0.03, 0.04, 0, h - 0.06, 0, false));
      for (const bx of [-fw * 0.35, fw * 0.35]) group.add(this._kmesh(this.kit.cyl8, craneMat, 0.018, h - 0.06, 0.018, bx, (h - 0.06) / 2, 0));
    }

    group._windowMats = [ofac];
    return group;
  }

  // ─────── Hospital service ───────

  buildHospital(T) {
    const group = new THREE.Group();
    const fw = T * 0.88;

    const wallMat = Std({ color: 0xf0eeea, roughness: 0.75, metalness: 0 });
    const winMat  = Std({ color: 0x88aacc, roughness: 0.08, metalness: 0.10, transparent: true, opacity: 0.65 });
    const redMat  = Std({ color: 0xdd1111, roughness: 0.50, metalness: 0.10, emissive: new THREE.Color(0.08,0,0) });

    // Main building
    const h = 0.95;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), wallMat);
    body.position.y = h/2; body.castShadow = body.receiveShadow = true; group.add(body);

    // Wing extensions
    for (const [wx, ww, wd] of [[fw*0.58, fw*0.30, fw*0.55],[-fw*0.58, fw*0.30, fw*0.55]]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(ww, h*0.65, wd), wallMat);
      wing.position.set(wx, h*0.325, 0); wing.castShadow = wing.receiveShadow = true; group.add(wing);
    }

    // Red cross on facade
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(fw*0.32,0.08,0.015), redMat);
    crossH.position.set(0, h*0.72, fw*0.5+0.008); group.add(crossH);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.08,fw*0.20,0.015), redMat);
    crossV.position.set(0, h*0.72, fw*0.5+0.008); group.add(crossV);

    // Entrance canopy
    const canMat = Std({ color: 0x4488cc, roughness: 0.50, metalness: 0.20 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(fw*0.42,0.020,0.22), canMat);
    canopy.position.set(0, h*0.38, fw*0.5+0.11); group.add(canopy);
    for (const px of [-fw*0.15, fw*0.15]) {
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.022,0.022,h*0.38,7), Std({ color: 0xaaaaaa, roughness: 0.40, metalness: 0.50 }));
      col.position.set(px, h*0.19, fw*0.5+0.18); group.add(col);
    }

    // Windows
    for (let row = 0; row < 3; row++) {
      for (let col = -2; col <= 2; col++) {
        const win = new THREE.Mesh(new THREE.BoxGeometry(0.07,0.09,0.010), winMat);
        win.position.set(col*0.15, 0.22+row*0.28, fw*0.5+0.005); group.add(win);
      }
    }

    // Helipad on roof
    const padMat = Std({ color: 0x888888, roughness: 0.80, metalness: 0 });
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(fw*0.22,fw*0.22,0.018,12), padMat);
    pad.position.set(0, h+0.009, 0); group.add(pad);
    const hMat = Std({ color: 0xffffff, roughness: 0.60, metalness: 0, emissive: new THREE.Color(0.04,0.04,0.04) });
    const hbar = new THREE.Mesh(new THREE.BoxGeometry(fw*0.28,0.008,0.035), hMat);
    hbar.position.set(0, h+0.022, 0); group.add(hbar);
    const vbar = new THREE.Mesh(new THREE.BoxGeometry(0.035,0.008,fw*0.14), hMat);
    vbar.position.set(0, h+0.022, 0); group.add(vbar);

    group._windowMats = [winMat];
    return group;
  }

  // ─────── AI service buildings ───────

  buildAIDatacenter(T) {
    const group = new THREE.Group();
    const fw = T * 0.88, h = 0.80;

    const bodyMat = Std({ map: this._aiPanelTex(), roughness: 0.45, metalness: 0.25 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw,h,fw), bodyMat);
    body.position.y = h/2; body.castShadow = body.receiveShadow = true; group.add(body);

    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.95 });
    const eH = new THREE.BoxGeometry(fw+0.008,0.013,0.013);
    const eZ = new THREE.BoxGeometry(0.013,0.013,fw);
    for (const [y2,dz] of [[h*0.25,fw/2],[h*0.5,fw/2],[h*0.75,fw/2],[h*0.25,-fw/2],[h*0.5,-fw/2],[h*0.75,-fw/2]]) {
      const s = new THREE.Mesh(eH, ledMat); s.position.set(0,y2,dz); group.add(s);
    }
    for (const [y2,dx] of [[h*0.25,fw/2],[h*0.5,fw/2],[h*0.75,fw/2],[h*0.25,-fw/2],[h*0.5,-fw/2],[h*0.75,-fw/2]]) {
      const s = new THREE.Mesh(eZ, ledMat); s.position.set(dx,y2,0); group.add(s);
    }
    group._ledMat = ledMat;

    const ctMat  = Std({ color: 0x444455, roughness: 0.55, metalness: 0.20 });
    const vapMat = Std({ color: 0xdde8ee, roughness: 1.0, metalness: 0, transparent: true, opacity: 0.28 });
    for (const [cx,cz] of [[-fw*0.27,-fw*0.27],[fw*0.27,-fw*0.27],[-fw*0.27,fw*0.27]]) {
      const ct  = new THREE.Mesh(new THREE.CylinderGeometry(0.085,0.115,0.38,10), ctMat);
      ct.position.set(cx,h+0.19,cz); group.add(ct);
      const vap = new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.085,0.32,9), vapMat);
      vap.position.set(cx,h+0.54,cz); group.add(vap);
    }
    const dishMat = Std({ color: 0x9999aa, roughness: 0.40, metalness: 0.35 });
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.10,9,6,0,Math.PI*2,0,Math.PI*0.5), dishMat);
    dish.rotation.x = -Math.PI*0.38; dish.position.set(fw*0.30,h+0.14,fw*0.22); group.add(dish);

    return group;
  }

  buildAIHub(T) {
    const group = new THREE.Group();
    const fw = T * 0.80;

    const baseMat = Std({ color: 0x050c22, roughness: 0.30, metalness: 0.55 });
    const base = new THREE.Mesh(new THREE.BoxGeometry(fw,0.38,fw), baseMat);
    base.position.y = 0.19; base.castShadow = base.receiveShadow = true; group.add(base);

    const collarMat = Std({ color: 0x0033cc, roughness: 0.25, metalness: 0.45, emissive: new THREE.Color(0x000833) });
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(fw*0.50,fw*0.50,0.055,8), collarMat);
    collar.position.y = 0.41; group.add(collar);

    const towerH = 1.65 + fw*0.4;
    const glassTex = this._glassCurtainTex(4, 16);
    const towerMat = Std({ map: glassTex, color: 0x0d1e40, roughness: 0.06, metalness: 0.15, transparent: true, opacity: 0.92 });
    const pts = [
      new THREE.Vector2(fw*0.38,0), new THREE.Vector2(fw*0.34,towerH*0.30),
      new THREE.Vector2(fw*0.24,towerH*0.60), new THREE.Vector2(fw*0.14,towerH*0.82),
      new THREE.Vector2(fw*0.048,towerH),
    ];
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 8), towerMat);
    tower.position.y = 0.44; tower.castShadow = true; group.add(tower);

    const ringMat  = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.85 });
    const ring  = new THREE.Mesh(new THREE.TorusGeometry(fw*0.28,0.030,8,30), ringMat);
    ring.rotation.x = Math.PI/2; ring.position.y = 0.44+towerH*0.50; group.add(ring);
    group._ringMat = ringMat;

    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.60 });
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(fw*0.18,0.018,6,22), ring2Mat);
    ring2.rotation.x = Math.PI/2; ring2.position.y = 0.44+towerH*0.72; group.add(ring2);
    group._ring2Mat = ring2Mat;

    const antMat = Std({ color: 0xaaaaaa, roughness: 0.40, metalness: 0.60 });
    const topY = 0.44 + towerH;
    for (let i = 0; i < 4; i++) {
      const ang = (i/4)*Math.PI*2;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.007,0.013,0.30,5), antMat);
      ant.position.set(Math.cos(ang)*0.05, topY+0.15, Math.sin(ang)*0.05); group.add(ant);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022,6,4), new THREE.MeshBasicMaterial({ color: 0x00ffaa }));
    beacon._isBeacon = true; beacon.position.y = topY+0.32; group.add(beacon);
    group._beacon = beacon;

    return group;
  }

  // ─────── Helpers ───────

  _bldH(x, y, zone, level) {
    const rng = this._tileRng(x, y);
    // Heights in world units (1 unit = 1 tile). Level-3 commercial reaches
    // skyscraper proportions so the downtown core dominates the skyline.
    const base = { [TILE.ZONE_RES]:[0,0.42,1.40,3.40],[TILE.ZONE_COM]:[0,0.55,2.00,6.00],[TILE.ZONE_IND]:[0,0.60,1.00,1.60] };
    const vary = { [TILE.ZONE_RES]:[0,0.12,0.50,1.60],[TILE.ZONE_COM]:[0,0.15,0.80,3.00],[TILE.ZONE_IND]:[0,0.15,0.30,0.50] };
    return base[zone][level] + vary[zone][level] * rng;
  }

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }
}
