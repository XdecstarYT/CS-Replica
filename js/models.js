/* models.js — Detailed 3D model builders for vehicles, buildings, AI services, and citizens. */

class ModelBuilder {
  constructor() {
    this._texCache = {};
    this._initShared();
  }

  _initShared() {
    this.wheelGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.022, 12);
    this.wheelMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 30 });
    this.hubMat   = new THREE.MeshPhongMaterial({ color: 0x999999, shininess: 90 });
    this.hubGeo   = new THREE.CylinderGeometry(0.016, 0.016, 0.024, 8);
    this.glassMat = new THREE.MeshPhongMaterial({
      color: 0x9ad4f5, transparent: true, opacity: 0.52,
      shininess: 160, specular: new THREE.Color(0xffffff)
    });
  }

  // ─────── Canvas textures ───────

  _tex(key, fn) {
    if (this._texCache[key]) return this._texCache[key];
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    fn(c.getContext('2d'), c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    this._texCache[key] = t;
    return t;
  }

  _brickTex() {
    return this._tex('brick', (ctx, w, h) => {
      ctx.fillStyle = '#8b4513';
      ctx.fillRect(0, 0, w, h);
      const bw = 32, bh = 14, gap = 3;
      for (let row = 0; row * (bh + gap) < h; row++) {
        const ox = row % 2 === 0 ? 0 : bw / 2;
        for (let col = -1; col * (bw + gap) < w; col++) {
          ctx.fillStyle = `hsl(20,${50 + (col * 7 + row * 3) % 15}%,${36 + (col + row) % 5 * 3}%)`;
          ctx.fillRect(ox + col * (bw + gap) + 1, row * (bh + gap) + 1, bw - 1, bh - 1);
        }
      }
      ctx.strokeStyle = '#5a3020';
      ctx.lineWidth = gap;
      for (let row = 0; row * (bh + gap) < h + gap; row++) {
        ctx.beginPath(); ctx.moveTo(0, row * (bh + gap)); ctx.lineTo(w, row * (bh + gap)); ctx.stroke();
      }
    });
  }

  _glassCurtainTex(cols, rows) {
    const key = `glass_${cols}_${rows}`;
    return this._tex(key, (ctx, w, h) => {
      ctx.fillStyle = '#0e2240';
      ctx.fillRect(0, 0, w, h);
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = Math.random() > 0.22;
          ctx.fillStyle = lit ? `hsl(${205 + c * 4},55%,${32 + r % 4 * 4}%)` : '#081630';
          ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
          if (lit) {
            // window highlight
            ctx.fillStyle = 'rgba(160,210,255,0.18)';
            ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, 5);
          }
        }
      }
      // mullion grid
      ctx.strokeStyle = '#060f20';
      ctx.lineWidth = 3;
      for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(w, r * ch); ctx.stroke(); }
      for (let c2 = 0; c2 <= cols; c2++) { ctx.beginPath(); ctx.moveTo(c2 * cw, 0); ctx.lineTo(c2 * cw, h); ctx.stroke(); }
    });
  }

  _corrugatedTex() {
    return this._tex('corrugated', (ctx, w, h) => {
      ctx.fillStyle = '#6e6050';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 7) {
        const t = Math.sin((i / w) * Math.PI * 36) * 0.5 + 0.5;
        ctx.fillStyle = `hsl(35,18%,${30 + t * 14}%)`;
        ctx.fillRect(i, 0, 7, h);
      }
      ctx.fillStyle = '#4a4030';
      for (let y = 18; y < h; y += 36) {
        for (let x = 10; x < w; x += 24) {
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
  }

  _aiPanelTex() {
    return this._tex('aipanel', (ctx, w, h) => {
      ctx.fillStyle = '#040c1c';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#0033bb';
      ctx.lineWidth = 1.2;
      for (let i = 0; i < 14; i++) {
        const y = (i / 14) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * 0.22, y);
        ctx.lineTo(w * 0.22 + 10, y + 9); ctx.lineTo(w, y + 9); ctx.stroke();
      }
      for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
        const on = Math.random() > 0.38;
        ctx.fillStyle = on ? (r % 3 === 0 ? '#00ffcc' : '#0088ff') : '#001c2a';
        ctx.beginPath(); ctx.arc(18 + c * 40, 14 + r * 30, 4.5, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  _slateRoofTex() {
    return this._tex('slate', (ctx, w, h) => {
      ctx.fillStyle = '#4a3535';
      ctx.fillRect(0, 0, w, h);
      const sh = 20, sw = 28;
      for (let row = 0; row < Math.ceil(h / sh); row++) {
        const ox = row % 2 === 0 ? 0 : sw / 2;
        for (let col = -1; col < Math.ceil(w / sw) + 1; col++) {
          const x = ox + col * sw, y = row * sh;
          ctx.fillStyle = `hsl(0,${12 + (row + col) % 5 * 4}%,${26 + (col * 3 + row) % 8 * 2}%)`;
          ctx.fillRect(x + 1, y + 1, sw - 2, sh - 2);
        }
      }
    });
  }

  // ─────── Custom geometry helpers ───────

  // Triangular-prism gabled roof (ridge runs along Z axis)
  _gabledRoofGeo(fw, fd, peakH, overhang = 0.04) {
    const hw = fw / 2 + overhang, hd = fd / 2 + overhang;
    const pos = new Float32Array([
      -hw, 0, -hd, //0 back-left eave
       hw, 0, -hd, //1 back-right eave
       hw, 0,  hd, //2 front-right eave
      -hw, 0,  hd, //3 front-left eave
        0, peakH, -hd, //4 back ridge
        0, peakH,  hd, //5 front ridge
    ]);
    const idx = [
      0, 4, 1,   // back gable
      3, 2, 5,   // front gable
      0, 3, 5,  0, 5, 4,  // left slope
      1, 4, 5,  1, 5, 2,  // right slope
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  // ─────── Vehicle builders ───────

  vehicleColors = [0xd4cdc0, 0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xf0f0ee, 0x2c3e50, 0xe67e22, 0x16a085];

  buildVehicle(index) {
    const type = index % 5;
    const color = this.vehicleColors[index % this.vehicleColors.length];
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 100, specular: new THREE.Color(0x555555) });

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
    for (const [wx, wy, wz] of [[-o.fx, o.y, o.rz], [o.fx, o.y, o.rz], [-o.fx, o.y, -o.rz], [o.fx, o.y, -o.rz]]) {
      const w = new THREE.Mesh(this.wheelGeo, this.wheelMat);
      w.rotation.z = Math.PI / 2;
      w.position.set(wx, wy, wz);
      group.add(w);
      const hub = new THREE.Mesh(this.hubGeo, this.hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx + (wx < 0 ? -0.013 : 0.013), wy, wz);
      group.add(hub);
    }
  }

  _addCarLights(group, type) {
    const hlMat = new THREE.MeshPhongMaterial({ color: 0xffffee, emissive: new THREE.Color(0.5, 0.5, 0.3), shininess: 120 });
    const tlMat = new THREE.MeshPhongMaterial({ color: 0xff1800, emissive: new THREE.Color(0.4, 0.0, 0.0), shininess: 80 });
    const lgeo = new THREE.BoxGeometry(0.018, 0.011, 0.007);
    const fz = [0.075, 0.088, 0.098, 0.070, 0.074][type];
    const rz = -fz;
    for (const sx of [-0.052, 0.052]) {
      const hl = new THREE.Mesh(lgeo, hlMat); hl.position.set(sx, 0.054, fz); group.add(hl);
      const tl = new THREE.Mesh(lgeo, tlMat); tl.position.set(sx, 0.054, rz); group.add(tl);
    }
  }

  _buildSedan(g, mat) {
    // Low body + cabin hump
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.130, 0.048, 0.220), mat);
    body.position.y = 0.058; g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.102, 0.040, 0.110), this.glassMat);
    cabin.position.set(0, 0.104, -0.012); g.add(cabin);
    // hood / trunk slopes via thin angled slabs
    const slopeMat = new THREE.MeshPhongMaterial({ color: mat.color, shininess: 100, specular: new THREE.Color(0x555555) });
    const hood = new THREE.Mesh(new THREE.BoxGeometry(0.130, 0.012, 0.060), slopeMat);
    hood.rotation.x = 0.22; hood.position.set(0, 0.074, 0.100); g.add(hood);
  }

  _buildSUV(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.140, 0.062, 0.240), mat);
    body.position.y = 0.066; g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.050, 0.142), this.glassMat);
    cabin.position.set(0, 0.116, -0.008); g.add(cabin);
    // roof rack
    const rackMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const rack = new THREE.Mesh(new THREE.BoxGeometry(0.110, 0.007, 0.120), rackMat);
    rack.position.set(0, 0.142, -0.010); g.add(rack);
    for (const rx of [-0.048, 0.048]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.007, 0.120), rackMat);
      bar.position.set(rx, 0.146, -0.010); g.add(bar);
    }
  }

  _buildVan(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.130, 0.098, 0.240), mat);
    body.position.y = 0.074; g.add(body);
    const ws = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.056, 0.010), this.glassMat);
    ws.position.set(0, 0.088, 0.118); g.add(ws);
    // rear windows
    const rws = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.044, 0.010), this.glassMat);
    rws.position.set(0, 0.094, -0.118); g.add(rws);
  }

  _buildPickup(g, mat) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.130, 0.060, 0.120), mat);
    cab.position.set(0, 0.062, 0.042); g.add(cab);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.112, 0.044, 0.098), this.glassMat);
    cabin.position.set(0, 0.108, 0.042); g.add(cabin);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.130, 0.028, 0.118), mat);
    bed.position.set(0, 0.046, -0.072); g.add(bed);
    // bed walls
    const wMat = new THREE.MeshPhongMaterial({ color: mat.color, shininess: 60 });
    const bedSide = new THREE.Mesh(new THREE.BoxGeometry(0.007, 0.034, 0.118), wMat);
    for (const bx of [-0.062, 0.062]) { const bs = bedSide.clone(); bs.position.set(bx, 0.062, -0.072); g.add(bs); }
  }

  _buildSports(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.122, 0.036, 0.218), mat);
    body.position.y = 0.048; g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.092, 0.030, 0.088), this.glassMat);
    cabin.position.set(0, 0.079, -0.010); g.add(cabin);
    const spoilerMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.100, 0.011, 0.016), spoilerMat);
    spoiler.position.set(0, 0.070, -0.100); g.add(spoiler);
    // front splitter
    const splitter = new THREE.Mesh(new THREE.BoxGeometry(0.114, 0.006, 0.020), spoilerMat);
    splitter.position.set(0, 0.032, 0.108); g.add(splitter);
  }

  // ─────── Citizen builder ───────

  buildCitizen(index) {
    const isAI = index % 4 === 0;
    const skinPalette = [0xffddbb, 0xffcc99, 0xcc9966, 0xf0a070, 0x88aacc, 0xd4a07a];
    const shirtPalette = [0x3355aa, 0xaa3333, 0x228833, 0x884400, 0x553388, 0x2277aa, 0x888800, 0x226688];
    const pantsPalette = [0x223355, 0x332211, 0x112233, 0x334422, 0x111111];
    const skin  = isAI ? 0x88ccff : skinPalette[index % skinPalette.length];
    const shirt = shirtPalette[(index * 3 + 1) % shirtPalette.length];
    const pants = pantsPalette[(index * 7 + 2) % pantsPalette.length];

    const group = new THREE.Group();
    const skinMat  = new THREE.MeshPhongMaterial({ color: skin, shininess: 25 });
    const shirtMat = new THREE.MeshPhongMaterial({ color: shirt, shininess: 20, emissive: isAI ? new THREE.Color(0x000a22) : new THREE.Color(0) });
    const legMat   = new THREE.MeshPhongMaterial({ color: pants, shininess: 12 });
    const shoeMat  = new THREE.MeshPhongMaterial({ color: 0x1a1008, shininess: 35 });

    // Head (sphere)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.019, 9, 7), skinMat);
    head.position.y = 0.080; group.add(head);

    // Neck
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.009, 0.012, 6), skinMat);
    neck.position.y = 0.063; group.add(neck);

    // Torso — slightly tapered cylinder
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.036, 8), shirtMat);
    torso.position.y = 0.050; group.add(torso);

    // Hips
    const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.014, 8), legMat);
    hips.position.y = 0.030; group.add(hips);

    // Upper legs (thighs)
    const leftThigh  = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.007, 0.018, 7), legMat);
    leftThigh.position.set(-0.009, 0.018, 0);
    const rightThigh = leftThigh.clone();
    rightThigh.position.set(0.009, 0.018, 0);
    group.add(leftThigh, rightThigh);

    // Lower legs (shins)
    const leftShin  = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.005, 0.016, 6), legMat);
    leftShin.position.set(-0.009, 0.007, 0);
    const rightShin = leftShin.clone();
    rightShin.position.set(0.009, 0.007, 0);
    group.add(leftShin, rightShin);

    // Feet
    const footGeo = new THREE.BoxGeometry(0.010, 0.006, 0.016);
    const leftFoot  = new THREE.Mesh(footGeo, shoeMat); leftFoot.position.set(-0.009, 0.003, 0.004);
    const rightFoot = new THREE.Mesh(footGeo, shoeMat); rightFoot.position.set(0.009, 0.003, 0.004);
    group.add(leftFoot, rightFoot);

    // Upper arms
    const leftArm  = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.024, 6), shirtMat);
    leftArm.position.set(-0.020, 0.050, 0); leftArm.rotation.z = 0.18;
    const rightArm = leftArm.clone();
    rightArm.position.set(0.020, 0.050, 0); rightArm.rotation.z = -0.18;
    group.add(leftArm, rightArm);

    // Forearms
    const leftForearm  = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.020, 5), skinMat);
    leftForearm.position.set(-0.024, 0.036, 0); leftForearm.rotation.z = 0.25;
    const rightForearm = leftForearm.clone();
    rightForearm.position.set(0.024, 0.036, 0); rightForearm.rotation.z = -0.25;
    group.add(leftForearm, rightForearm);

    if (isAI) {
      // Floating holographic halo
      const haloMat = new THREE.MeshBasicMaterial({ color: 0x00ffee, transparent: true, opacity: 0.82 });
      const halo = new THREE.Mesh(new THREE.TorusGeometry(0.025, 0.003, 6, 20), haloMat);
      halo.rotation.x = Math.PI / 2;
      halo.position.y = 0.106;
      group.add(halo);
      group._haloMat = haloMat;

      // Glowing cyan eyes
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ffcc });
      for (const ex of [-0.007, 0.007]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.003, 5, 4), eyeMat);
        eye.position.set(ex, 0.081, 0.018);
        group.add(eye);
      }

      // Thin data line rising from head
      const lineMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.5 });
      const lineGeo = new THREE.CylinderGeometry(0.001, 0.001, 0.04, 4);
      const dataLine = new THREE.Mesh(lineGeo, lineMat);
      dataLine.position.y = 0.122;
      group.add(dataLine);
    }

    // Store animation targets
    group._leftLeg  = leftThigh;
    group._rightLeg = rightThigh;
    group._leftLegL  = leftShin;
    group._rightLegL = rightShin;
    group._leftArm  = leftArm;
    group._rightArm = rightArm;
    group._leftForearm  = leftForearm;
    group._rightForearm = rightForearm;

    return group;
  }

  // ─────── Residential buildings ───────

  buildResidential(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_RES, level);

    if (level === 1) {
      // Cottage — brick body + gabled slate roof + chimney + porch
      const brickMat = new THREE.MeshPhongMaterial({ map: this._brickTex(), shininess: 5 });
      const slateMat = new THREE.MeshPhongMaterial({ map: this._slateRoofTex(), shininess: 4 });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

      // Gabled roof
      const peakH = h * 0.55;
      const roofGeo = this._gabledRoofGeo(fw, fw, peakH, 0.045);
      const roof = new THREE.Mesh(roofGeo, slateMat);
      roof.position.y = h; roof.castShadow = true; group.add(roof);

      // Chimney with cap
      const chimMat = new THREE.MeshPhongMaterial({ map: this._brickTex(), shininess: 3 });
      const chim = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.26, 0.065), chimMat);
      chim.position.set(fw * 0.24, h + 0.10, fw * 0.18); group.add(chim);
      const capMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.080, 0.018, 0.080), capMat);
      cap.position.set(fw * 0.24, h + 0.24, fw * 0.18); group.add(cap);

      // Porch — slab + two posts
      const porchMat = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
      const porch = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.55, 0.022, 0.14), porchMat);
      porch.position.set(0, 0.011, fw * 0.5 + 0.07); group.add(porch);
      for (const px of [-fw * 0.20, fw * 0.20]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, h * 0.6, 7), porchMat);
        post.position.set(px, h * 0.3, fw * 0.5 + 0.12); group.add(post);
      }

      // Door
      const doorMat = new THREE.MeshPhongMaterial({ color: 0x6b3a1f, shininess: 25 });
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.066, 0.12, 0.010), doorMat);
      door.position.set(0, 0.06, fw * 0.5 + 0.005); group.add(door);

    } else {
      // Apartment block — brick body with floor banding, flat cornice roof, balconies
      const brickMat = new THREE.MeshPhongMaterial({ map: this._brickTex(), shininess: 8 });
      const concreteMat = new THREE.MeshLambertMaterial({ color: 0xbbbbbb });
      const balMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

      // Horizontal floor banding — breaks up the monolithic box look
      const bandGeo = new THREE.BoxGeometry(fw + 0.030, 0.020, fw + 0.030);
      const bandMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
      const floorStep = 0.24;
      for (let fy = floorStep; fy < h - 0.05; fy += floorStep) {
        const band = new THREE.Mesh(bandGeo, bandMat);
        band.position.y = fy; group.add(band);
      }

      // Cornice at top
      const cornice = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.055, 0.040, fw + 0.055), concreteMat);
      cornice.position.y = h + 0.020; group.add(cornice);

      // Parapet above cornice
      const parapet = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.015, 0.065, fw + 0.015), new THREE.MeshLambertMaterial({ color: 0xcccccc }));
      parapet.position.y = h + 0.072; group.add(parapet);

      // Balconies on front face
      const floors = level === 2 ? 2 : 4;
      const balDepth = 0.11;
      for (let fl = 1; fl <= floors; fl++) {
        const fy = (h / (floors + 1)) * fl;
        const bal = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.38, 0.025, balDepth), balMat);
        bal.position.set(fw * 0.48 + balDepth / 2, fy, 0); group.add(bal);
        // Railing
        for (const rz of [-0.14, 0.14]) {
          const post = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.060, 0.008), concreteMat);
          post.position.set(fw * 0.48 + balDepth / 2, fy + 0.040, rz); group.add(post);
        }
        const rail = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.38, 0.008, 0.006), concreteMat);
        rail.position.set(fw * 0.48 + balDepth / 2, fy + 0.068, balDepth / 2 - 0.003); group.add(rail);
      }

      if (level === 3) {
        // Water tower cluster on roof
        const wtMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.20, 9), wtMat);
        tank.position.set(-fw * 0.28, h + 0.16, fw * 0.27); group.add(tank);
        for (let i = 0; i < 5; i++) {
          const ang = (i / 5) * Math.PI * 2;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.15, 5), wtMat);
          leg.position.set(-fw * 0.28 + Math.cos(ang) * 0.09, h + 0.075, fw * 0.27 + Math.sin(ang) * 0.09);
          group.add(leg);
        }
      }
    }
    return group;
  }

  // ─────── Commercial buildings ───────

  buildCommercial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_COM, level);

    if (level === 1) {
      // Retail shop — colored render + full glass storefront + awning + sign
      const wallMat  = new THREE.MeshPhongMaterial({ color: 0x5888d0, shininess: 20 });
      const glassMat = new THREE.MeshPhongMaterial({ color: 0xaaddff, transparent: true, opacity: 0.60, shininess: 140 });
      const awMat    = new THREE.MeshLambertMaterial({ color: 0xcc4444 });
      const signMat  = new THREE.MeshPhongMaterial({ color: 0xffee44, emissive: new THREE.Color(0.08, 0.07, 0.0) });

      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), wallMat);
      body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

      // Full-width glass storefront (front only)
      const sf = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.78, h * 0.52, 0.010), glassMat);
      sf.position.set(0, h * 0.28, fw * 0.5 + 0.005); group.add(sf);

      // Awning
      const aw = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.88, 0.018, 0.16), awMat);
      aw.rotation.x = -0.28; aw.position.set(0, h * 0.68, fw * 0.5 + 0.05); group.add(aw);
      // Awning ribs
      for (const ax of [-fw * 0.28, 0, fw * 0.28]) {
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.010, 0.010, 0.17), awMat);
        rib.rotation.x = -0.28; rib.position.set(ax, h * 0.68, fw * 0.5 + 0.05); group.add(rib);
      }

      // Sign board
      const sign = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.64, 0.072, 0.028), signMat);
      sign.position.set(0, h * 0.83, fw * 0.5 + 0.018); group.add(sign);

    } else if (level === 2) {
      // Mid-rise office — podium base + glass tower
      const glassTex = this._glassCurtainTex(6, 9);
      const glassMat = new THREE.MeshPhongMaterial({ map: glassTex, shininess: 130, specular: new THREE.Color(0x88aaff) });
      const podiumMat = new THREE.MeshPhongMaterial({ color: 0x3a5080, shininess: 40 });

      const podH = h * 0.22;
      const podium = new THREE.Mesh(new THREE.BoxGeometry(fw * 1.06, podH, fw * 1.06), podiumMat);
      podium.position.y = podH / 2; podium.castShadow = podium.receiveShadow = true; group.add(podium);

      const towerH = h - podH;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(fw, towerH, fw), glassMat);
      tower.position.y = podH + towerH / 2; tower.castShadow = tower.receiveShadow = true; group.add(tower);

      // Floor bands on tower
      const bandMat = new THREE.MeshLambertMaterial({ color: 0x224466 });
      const bandStep = h * 0.18;
      for (let fy = podH + bandStep; fy < h - 0.04; fy += bandStep) {
        const band = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.024, 0.016, fw + 0.024), bandMat);
        band.position.y = fy; group.add(band);
      }

      // Rooftop mechanical penthouse
      const mphMat = new THREE.MeshLambertMaterial({ color: 0x777777 });
      const mph = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.42, 0.14, fw * 0.42), mphMat);
      mph.position.set(0, h + 0.07, 0); group.add(mph);
      // AC units
      const acMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
      for (let i = 0; i < 3; i++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(0.080, 0.055, 0.110), acMat);
        ac.position.set(-fw * 0.20 + i * fw * 0.20, h + 0.028, fw * 0.25); group.add(ac);
      }

    } else {
      // Level 3 — glass skyscraper with 3 setback tiers + LED crown + glass dome
      const glassTex = this._glassCurtainTex(8, 14);
      const glassMat = new THREE.MeshPhongMaterial({ map: glassTex, shininess: 150, specular: new THREE.Color(0xaaccff) });
      const concMat  = new THREE.MeshPhongMaterial({ color: 0x334455, shininess: 40 });

      const tiers = [
        { w: fw,        th: h * 0.48 },
        { w: fw * 0.70, th: h * 0.30 },
        { w: fw * 0.44, th: h * 0.22 },
      ];
      let yOff = 0;
      for (const tier of tiers) {
        const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(tier.w, tier.th, tier.w), glassMat);
        tierMesh.position.y = yOff + tier.th / 2;
        tierMesh.castShadow = tierMesh.receiveShadow = true; group.add(tierMesh);

        // Setback ledge
        if (yOff > 0) {
          const ledge = new THREE.Mesh(new THREE.BoxGeometry(tier.w + 0.06, 0.025, tier.w + 0.06), concMat);
          ledge.position.y = yOff + 0.012; group.add(ledge);
        }
        yOff += tier.th;
      }

      // LED ring at top tier (animated in render3d)
      const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.9 });
      const ledRing = new THREE.Mesh(new THREE.TorusGeometry(tiers[2].w * 0.4, 0.022, 7, 28), ledMat);
      ledRing.rotation.x = Math.PI / 2;
      ledRing.position.y = yOff - 0.04;
      group.add(ledRing);
      group._ledRingMat = ledMat;

      // Tapered spire
      const spireMat = new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 70 });
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.038, h * 0.30, 8), spireMat);
      spire.position.y = yOff + h * 0.15; group.add(spire);

      // Glass sphere crown
      const crownMat = new THREE.MeshPhongMaterial({ color: 0x88ccff, transparent: true, opacity: 0.65, shininess: 200 });
      const crown = new THREE.Mesh(new THREE.SphereGeometry(tiers[2].w * 0.32, 10, 8), crownMat);
      crown.position.y = yOff; group.add(crown);

      // Blinking red beacon at spire tip
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      beacon._isBeacon = true;
      beacon.position.y = yOff + h * 0.30 + 0.002;
      group.add(beacon);
    }
    return group;
  }

  // ─────── Industrial buildings ───────

  buildIndustrial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h  = this._bldH(x, y, TILE.ZONE_IND, level);

    const metalMat = new THREE.MeshPhongMaterial({ map: this._corrugatedTex(), shininess: 8 });
    const darkMat  = new THREE.MeshLambertMaterial({ color: 0x333330 });

    // Main body
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), metalMat);
    body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

    // Gabled roof — main feature that makes it look industrial, not boxy
    const roofH  = fw * 0.26;
    const roofGeo = this._gabledRoofGeo(fw, fw, roofH, 0.04);
    const roofMat = new THREE.MeshPhongMaterial({ map: this._corrugatedTex(), shininess: 4, color: 0x888880 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = h; roof.castShadow = true; group.add(roof);

    // Roof skylights (clear strips along ridge)
    const skyMat = new THREE.MeshPhongMaterial({ color: 0x9ad4f5, transparent: true, opacity: 0.55, shininess: 80 });
    const sky = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.18, 0.010, fw * 0.70), skyMat);
    sky.position.set(0, h + roofH * 0.55, 0); group.add(sky);

    // Loading dock bay
    const dockMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2a });
    const dock = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.34, h * 0.42, 0.055), dockMat);
    dock.position.set(0, h * 0.21, fw * 0.5 + 0.028); group.add(dock);
    // Dock door frame
    const frameMat = new THREE.MeshLambertMaterial({ color: 0xffee44 });
    const frameGeo = new THREE.BoxGeometry(fw * 0.36, 0.014, 0.022);
    const frameH = new THREE.Mesh(frameGeo, frameMat);
    frameH.position.set(0, h * 0.42 + 0.007, fw * 0.5 + 0.028); group.add(frameH);

    if (level >= 2) {
      // Smokestacks
      const stackMat = new THREE.MeshLambertMaterial({ color: 0x888880 });
      const ringMat  = new THREE.MeshLambertMaterial({ color: 0xdd2222 });
      const count = level === 3 ? 3 : 1;
      for (let s = 0; s < count; s++) {
        const sx = -fw * 0.24 + s * fw * 0.24;
        const sh = h * (0.65 + rng * 0.28);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.066, sh, 10), stackMat);
        stack.position.set(sx, h + sh / 2, -fw * 0.22); stack.castShadow = true; group.add(stack);
        // Rings
        for (let r = 0; r < 3; r++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.060, 0.011, 6, 12), ringMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(sx, h + sh * (0.25 + r * 0.28), -fw * 0.22); group.add(ring);
        }
        // Smoke puff at top
        const smokeMat = new THREE.MeshPhongMaterial({ color: 0x666660, transparent: true, opacity: 0.35 });
        const smoke = new THREE.Mesh(new THREE.SphereGeometry(0.07, 7, 5), smokeMat);
        smoke.position.set(sx, h + sh + 0.08, -fw * 0.22); group.add(smoke);
      }
    }

    // Overhead crane beam (level 3)
    if (level === 3) {
      const craneMat = new THREE.MeshLambertMaterial({ color: 0xdd9900 });
      const beam = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.9, 0.030, 0.040), craneMat);
      beam.position.set(0, h - 0.06, 0); group.add(beam);
      for (const bx of [-fw * 0.35, fw * 0.35]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, h - 0.06, 7), craneMat);
        col.position.set(bx, (h - 0.06) / 2, 0); group.add(col);
      }
    }

    return group;
  }

  // ─────── AI service buildings ───────

  buildAIDatacenter(T) {
    const group = new THREE.Group();
    const fw = T * 0.88;
    const h = 0.80;

    const bodyMat = new THREE.MeshPhongMaterial({ map: this._aiPanelTex(), shininess: 45, specular: new THREE.Color(0x003377) });
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), bodyMat);
    body.position.y = h / 2; body.castShadow = body.receiveShadow = true; group.add(body);

    // Blue LED edge strips (animated)
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff, transparent: true, opacity: 0.95 });
    const edgeH = new THREE.BoxGeometry(fw + 0.008, 0.013, 0.013);
    const edgeZ = new THREE.BoxGeometry(0.013, 0.013, fw);
    for (const [y2, dz] of [[h * 0.25, fw/2],[h * 0.5, fw/2],[h * 0.75, fw/2],[h * 0.25, -fw/2],[h * 0.5, -fw/2],[h * 0.75, -fw/2]]) {
      const strip = new THREE.Mesh(edgeH, ledMat); strip.position.set(0, y2, dz); group.add(strip);
    }
    for (const [y2, dx] of [[h * 0.25, fw/2],[h * 0.5, fw/2],[h * 0.75, fw/2],[h * 0.25, -fw/2],[h * 0.5, -fw/2],[h * 0.75, -fw/2]]) {
      const strip = new THREE.Mesh(edgeZ, ledMat); strip.position.set(dx, y2, 0); group.add(strip);
    }
    group._ledMat = ledMat;

    // Cooling towers with vapor
    const ctMat  = new THREE.MeshPhongMaterial({ color: 0x444455, shininess: 25 });
    const vapMat = new THREE.MeshPhongMaterial({ color: 0xdde8ee, transparent: true, opacity: 0.30 });
    for (const [cx, cz] of [[-fw * 0.27, -fw * 0.27], [fw * 0.27, -fw * 0.27], [-fw * 0.27, fw * 0.27]]) {
      const ct  = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.115, 0.38, 10), ctMat);
      ct.position.set(cx, h + 0.19, cz); group.add(ct);
      const vap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.085, 0.32, 9), vapMat);
      vap.position.set(cx, h + 0.54, cz); group.add(vap);
    }

    // Satellite dish
    const dishMat = new THREE.MeshPhongMaterial({ color: 0x9999aa, shininess: 65 });
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.10, 9, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), dishMat);
    dish.rotation.x = -Math.PI * 0.38;
    dish.position.set(fw * 0.30, h + 0.14, fw * 0.22); group.add(dish);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.010, 0.010, 0.18, 5), dishMat);
    arm.rotation.x = Math.PI * 0.45; arm.position.set(fw * 0.30, h + 0.10, fw * 0.20); group.add(arm);

    return group;
  }

  buildAIHub(T) {
    const group = new THREE.Group();
    const fw = T * 0.80;

    // Wide dark base
    const baseMat = new THREE.MeshPhongMaterial({ color: 0x050c22, shininess: 70, specular: new THREE.Color(0x002299) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.38, fw), baseMat);
    base.position.y = 0.19; base.castShadow = base.receiveShadow = true; group.add(base);

    // Octagonal collar ring above base
    const collarMat = new THREE.MeshPhongMaterial({ color: 0x0033cc, shininess: 80, emissive: new THREE.Color(0x000833) });
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(fw * 0.50, fw * 0.50, 0.055, 8), collarMat);
    collar.position.y = 0.41; group.add(collar);

    // Tapered glass tower via LatheGeometry (octagonal cross-section)
    const towerH = 1.65 + fw * 0.4;
    const glassTex = this._glassCurtainTex(4, 16);
    const towerMat = new THREE.MeshPhongMaterial({
      map: glassTex, color: 0x0d1e40, shininess: 180,
      specular: new THREE.Color(0x3366ff), transparent: true, opacity: 0.92
    });
    const pts = [
      new THREE.Vector2(fw * 0.38, 0),
      new THREE.Vector2(fw * 0.34, towerH * 0.30),
      new THREE.Vector2(fw * 0.24, towerH * 0.60),
      new THREE.Vector2(fw * 0.14, towerH * 0.82),
      new THREE.Vector2(fw * 0.048, towerH),
    ];
    const tower = new THREE.Mesh(new THREE.LatheGeometry(pts, 8), towerMat);
    tower.position.y = 0.44; tower.castShadow = true; group.add(tower);

    // Pulsing blue torus ring at mid-tower
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(fw * 0.28, 0.030, 8, 30), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.44 + towerH * 0.5; group.add(ring);
    group._ringMat = ringMat;

    // Second smaller ring
    const ring2Mat = new THREE.MeshBasicMaterial({ color: 0x00ccff, transparent: true, opacity: 0.60 });
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(fw * 0.18, 0.018, 6, 22), ring2Mat);
    ring2.rotation.x = Math.PI / 2;
    ring2.position.y = 0.44 + towerH * 0.72; group.add(ring2);
    group._ring2Mat = ring2Mat;

    // Antenna array at top
    const antMat = new THREE.MeshLambertMaterial({ color: 0xaaaaaa });
    const topY = 0.44 + towerH;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.013, 0.30, 5), antMat);
      ant.position.set(Math.cos(ang) * 0.05, topY + 0.15, Math.sin(ang) * 0.05); group.add(ant);
    }

    // Green beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.022, 6, 4), new THREE.MeshBasicMaterial({ color: 0x00ffaa }));
    beacon._isBeacon = true; beacon.position.y = topY + 0.32; group.add(beacon);

    return group;
  }

  // ─────── Helpers ───────

  _bldH(x, y, zone, level) {
    const rng = this._tileRng(x, y);
    const base = { [TILE.ZONE_RES]: [0, 0.40, 1.00, 1.90], [TILE.ZONE_COM]: [0, 0.50, 1.30, 3.20], [TILE.ZONE_IND]: [0, 0.55, 0.95, 1.50] };
    const vary = { [TILE.ZONE_RES]: [0, 0.10, 0.35, 0.80], [TILE.ZONE_COM]: [0, 0.10, 0.50, 1.80], [TILE.ZONE_IND]: [0, 0.15, 0.25, 0.40] };
    return base[zone][level] + vary[zone][level] * rng;
  }

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }
}
