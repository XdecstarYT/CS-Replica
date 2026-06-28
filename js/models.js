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
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_RES, level);
    const windowMats = [];

    if (level === 1) {
      const brickMat = Std({ map: this._brickTex(), roughness: 0.85, metalness: 0 });
      const slateMat = Std({ map: this._slateRoofTex(), roughness: 0.90, metalness: 0 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

      const roofGeo = this._gabledRoofGeo(fw, fw, h * 0.55, 0.045);
      const roof = new THREE.Mesh(roofGeo, slateMat);
      roof.position.y = h; roof.castShadow = true; group.add(roof);

      // Chimney
      const chimMat = Std({ map: this._brickTex(), roughness: 0.88, metalness: 0 });
      const chim = new THREE.Mesh(new THREE.BoxGeometry(0.065,0.26,0.065), chimMat);
      chim.position.set(fw*0.24, h+0.10, fw*0.18); group.add(chim);
      const capMat = Std({ color: 0x444444, roughness: 0.60, metalness: 0.15 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.080,0.018,0.080), capMat);
      cap.position.set(fw*0.24, h+0.24, fw*0.18); group.add(cap);

      // Porch
      const concMat = Std({ map: this._concreteTex(), roughness: 0.80, metalness: 0 });
      const porch = new THREE.Mesh(new THREE.BoxGeometry(fw*0.55,0.022,0.14), concMat);
      porch.position.set(0, 0.011, fw*0.5+0.07); group.add(porch);
      const postMat = Std({ color: 0xeeeeee, roughness: 0.75, metalness: 0 });
      for (const px of [-fw*0.19, fw*0.19]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,h*0.60,7), postMat);
        post.position.set(px, h*0.30, fw*0.5+0.12); group.add(post);
      }
      // Door
      const doorMat = Std({ color: 0x5a2e10, roughness: 0.85, metalness: 0.05 });
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.066,0.12,0.010), doorMat);
      door.position.set(0, 0.060, fw*0.5+0.005); group.add(door);

      // Window glow mats
      windowMats.push(brickMat);

    } else {
      const brickMat = Std({ map: this._brickTex(), roughness: 0.85, metalness: 0 });
      const concMat  = Std({ map: this._concreteTex(), roughness: 0.78, metalness: 0 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h/2; body.castShadow = body.receiveShadow = true; group.add(body);

      // Floor bands
      const bandMat = Std({ color: 0xaaaaaa, roughness: 0.72, metalness: 0 });
      for (let fy = 0.24; fy < h - 0.05; fy += 0.24) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(fw+0.030,0.020,fw+0.030), bandMat);
        band.position.y = fy; group.add(band);
      }

      // Cornice
      const cor = new THREE.Mesh(new THREE.BoxGeometry(fw+0.055,0.040,fw+0.055), concMat);
      cor.position.y = h+0.020; group.add(cor);
      const par = new THREE.Mesh(new THREE.BoxGeometry(fw+0.015,0.065,fw+0.015), Std({ color: 0xcccccc, roughness: 0.75, metalness: 0 }));
      par.position.y = h+0.072; group.add(par);

      // Balconies
      const balMat = Std({ color: 0xcccccc, roughness: 0.70, metalness: 0.05 });
      const floors = level === 2 ? 2 : 4;
      for (let fl = 1; fl <= floors; fl++) {
        const fy = (h / (floors + 1)) * fl;
        const bal = new THREE.Mesh(new THREE.BoxGeometry(fw*0.38,0.025,0.11), balMat);
        bal.position.set(fw*0.48+0.055, fy, 0); group.add(bal);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(fw*0.38,0.008,0.006), balMat);
        rail.position.set(fw*0.48+0.055, fy+0.068, 0.052); group.add(rail);
      }

      if (level === 3) {
        const wtMat = Std({ color: 0x8a7a5a, roughness: 0.88, metalness: 0.05 });
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09,0.09,0.20,9), wtMat);
        tank.position.set(-fw*0.28, h+0.16, fw*0.27); group.add(tank);
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.010,0.010,0.15,5), wtMat);
          leg.position.set(-fw*0.28+Math.cos(ang)*0.09, h+0.075, fw*0.27+Math.sin(ang)*0.09); group.add(leg);
        }
      }
      windowMats.push(brickMat);
    }

    group._windowMats = windowMats;
    return group;
  }

  // ─────── Commercial buildings ───────

  buildCommercial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_COM, level);
    const windowMats = [];

    if (level === 1) {
      const wallMat = Std({ color: 0x5888d0, roughness: 0.55, metalness: 0.10 });
      const glassMat = Std({ color: 0xaaddff, roughness: 0.04, metalness: 0.08, transparent: true, opacity: 0.62 });
      const awMat = Std({ color: 0xcc4444, roughness: 0.85, metalness: 0 });
      const signMat = Std({ color: 0xffee44, roughness: 0.40, metalness: 0, emissive: new THREE.Color(0.06, 0.055, 0) });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw,h,fw), wallMat);
      body.position.y = h/2; body.castShadow = body.receiveShadow = true; group.add(body);
      const sf = new THREE.Mesh(new THREE.BoxGeometry(fw*0.78,h*0.52,0.010), glassMat);
      sf.position.set(0, h*0.28, fw*0.5+0.005); group.add(sf);
      const aw = new THREE.Mesh(new THREE.BoxGeometry(fw*0.88,0.018,0.16), awMat);
      aw.rotation.x = -0.28; aw.position.set(0, h*0.68, fw*0.5+0.05); group.add(aw);
      const sign = new THREE.Mesh(new THREE.BoxGeometry(fw*0.64,0.072,0.028), signMat);
      sign.position.set(0, h*0.83, fw*0.5+0.018); group.add(sign);
      windowMats.push(glassMat, signMat);

    } else if (level === 2) {
      const glassTex = this._glassCurtainTex(6, 9);
      const glassMat = Std({ map: glassTex, roughness: 0.08, metalness: 0.12 });
      const podMat   = Std({ color: 0x3a5080, roughness: 0.60, metalness: 0.12 });

      const podH = h * 0.22;
      const pod  = new THREE.Mesh(new THREE.BoxGeometry(fw*1.06,podH,fw*1.06), podMat);
      pod.position.y = podH/2; pod.castShadow = pod.receiveShadow = true; group.add(pod);
      const towerH = h - podH;
      const tower  = new THREE.Mesh(new THREE.BoxGeometry(fw,towerH,fw), glassMat);
      tower.position.y = podH+towerH/2; tower.castShadow = tower.receiveShadow = true; group.add(tower);

      const bandMat = Std({ color: 0x224466, roughness: 0.50, metalness: 0.20 });
      for (let fy = podH + h*0.18; fy < h - 0.04; fy += h*0.18) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(fw+0.024,0.016,fw+0.024), bandMat);
        band.position.y = fy; group.add(band);
      }
      const mphMat = Std({ color: 0x777777, roughness: 0.50, metalness: 0.25 });
      const mph = new THREE.Mesh(new THREE.BoxGeometry(fw*0.42,0.14,fw*0.42), mphMat);
      mph.position.set(0, h+0.07, 0); group.add(mph);
      windowMats.push(glassMat);

    } else {
      const glassTex = this._glassCurtainTex(8, 14);
      const glassMat = Std({ map: glassTex, roughness: 0.06, metalness: 0.14 });
      const concMat  = Std({ color: 0x334455, roughness: 0.55, metalness: 0.15 });

      const tiers = [{ w: fw, th: h*0.48 }, { w: fw*0.70, th: h*0.30 }, { w: fw*0.44, th: h*0.22 }];
      let yOff = 0;
      for (const tier of tiers) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(tier.w,tier.th,tier.w), glassMat);
        m.position.y = yOff+tier.th/2; m.castShadow = m.receiveShadow = true; group.add(m);
        if (yOff > 0) {
          const ledge = new THREE.Mesh(new THREE.BoxGeometry(tier.w+0.06,0.025,tier.w+0.06), concMat);
          ledge.position.y = yOff+0.012; group.add(ledge);
        }
        yOff += tier.th;
      }

      const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9 });
      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(tiers[2].w*0.4,0.022,7,28), ledMat);
      ledRing.rotation.x = Math.PI/2; ledRing.position.y = yOff-0.04; group.add(ledRing);
      group._ledRingMat = ledMat;

      const spireMat = Std({ color: 0xcccccc, roughness: 0.30, metalness: 0.60 });
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.012,0.038,h*0.30,8), spireMat);
      spire.position.y = yOff+h*0.15; group.add(spire);

      const crownMat = Std({ color: 0x88ccff, roughness: 0.04, metalness: 0.10, transparent: true, opacity: 0.65 });
      const crown = new THREE.Mesh(new THREE.SphereGeometry(tiers[2].w*0.32,10,8), crownMat);
      crown.position.y = yOff; group.add(crown);

      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022,6,4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      beacon._isBeacon = true; beacon.position.y = yOff+h*0.30+0.002; group.add(beacon);
      group._beacon = beacon;
      windowMats.push(glassMat);
    }

    group._windowMats = windowMats;
    return group;
  }

  // ─────── Industrial buildings ───────

  buildIndustrial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_IND, level);
    const windowMats = [];

    const metalMat = Std({ map: this._corrugatedTex(), roughness: 0.80, metalness: 0.12 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw,h,fw), metalMat);
    body.position.y = h/2; body.castShadow = body.receiveShadow = true; group.add(body);

    const roofGeo = this._gabledRoofGeo(fw, fw, fw*0.26, 0.04);
    const roofMat = Std({ map: this._corrugatedTex(), roughness: 0.82, metalness: 0.08, color: 0x888880 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = h; roof.castShadow = true; group.add(roof);

    const skyMat = Std({ color: 0x9ad4f5, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.55 });
    const sky = new THREE.Mesh(new THREE.BoxGeometry(fw*0.18,0.010,fw*0.70), skyMat);
    sky.position.set(0, h+fw*0.24, 0); group.add(sky);

    const dockMat = Std({ color: 0x2a2a2a, roughness: 0.90, metalness: 0 });
    const dock = new THREE.Mesh(new THREE.BoxGeometry(fw*0.34,h*0.42,0.055), dockMat);
    dock.position.set(0, h*0.21, fw*0.5+0.028); group.add(dock);
    const frameMat = Std({ color: 0xffee44, roughness: 0.50, metalness: 0.10, emissive: new THREE.Color(0.03,0.03,0) });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(fw*0.36,0.014,0.022), frameMat);
    frame.position.set(0, h*0.42+0.007, fw*0.5+0.028); group.add(frame);

    if (level >= 2) {
      const stackMat = Std({ color: 0x888880, roughness: 0.70, metalness: 0.10 });
      const ringMat  = Std({ color: 0xdd2222, roughness: 0.50, metalness: 0.15 });
      const count = level === 3 ? 3 : 1;
      for (let s = 0; s < count; s++) {
        const sx = -fw*0.24 + s*fw*0.24;
        const sh = h*(0.65 + rng*0.28);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.046,0.066,sh,10), stackMat);
        stack.position.set(sx, h+sh/2, -fw*0.22); stack.castShadow = true; group.add(stack);
        for (let r = 0; r < 3; r++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.060,0.011,6,12), ringMat);
          ring.rotation.x = Math.PI/2; ring.position.set(sx, h+sh*(0.25+r*0.28), -fw*0.22); group.add(ring);
        }
        const smokeMat = Std({ color: 0x555550, roughness: 1.0, metalness: 0, transparent: true, opacity: 0.30 });
        const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.07,7,5), smokeMat);
        smoke.position.set(sx, h+sh+0.08, -fw*0.22); group.add(smoke);
      }
    }

    if (level === 3) {
      const craneMat = Std({ color: 0xdd9900, roughness: 0.45, metalness: 0.45 });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(fw*0.9,0.030,0.040), craneMat);
      beam.position.set(0, h-0.06, 0); group.add(beam);
      for (const bx of [-fw*0.35, fw*0.35]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,h-0.06,7), craneMat);
        col.position.set(bx, (h-0.06)/2, 0); group.add(col);
      }
    }

    windowMats.push(metalMat);
    group._windowMats = windowMats;
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
    const base = { [TILE.ZONE_RES]:[0,0.40,1.00,1.90],[TILE.ZONE_COM]:[0,0.50,1.30,3.20],[TILE.ZONE_IND]:[0,0.55,0.95,1.50] };
    const vary = { [TILE.ZONE_RES]:[0,0.10,0.35,0.80],[TILE.ZONE_COM]:[0,0.10,0.50,1.80],[TILE.ZONE_IND]:[0,0.15,0.25,0.40] };
    return base[zone][level] + vary[zone][level] * rng;
  }

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }
}
