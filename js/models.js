/* models.js — Detailed 3D model builders for vehicles, buildings, and AI services. */

class ModelBuilder {
  constructor() {
    this._texCache = {};
    this._initShared();
  }

  _initShared() {
    // Wheel geometry shared across all vehicles
    this.wheelGeo = new THREE.CylinderGeometry(0.038, 0.038, 0.022, 10);
    this.wheelMat = new THREE.MeshPhongMaterial({ color: 0x111111, shininess: 20 });
    this.hubMat   = new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 80 });
    this.hubGeo   = new THREE.CylinderGeometry(0.016, 0.016, 0.024, 8);
    this.glassMat = new THREE.MeshPhongMaterial({ color: 0x9ad4f5, transparent: true, opacity: 0.55, shininess: 140, specular: new THREE.Color(0xffffff) });
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
      ctx.fillStyle = '#a0522d';
      const bw = 32, bh = 14, gap = 3;
      for (let row = 0; row * (bh + gap) < h; row++) {
        const ox = row % 2 === 0 ? 0 : bw / 2;
        for (let col = -1; col * (bw + gap) < w; col++) {
          const x = ox + col * (bw + gap), y = row * (bh + gap);
          ctx.fillRect(x + 1, y + 1, bw - 1, bh - 1);
        }
      }
      // mortar lines
      ctx.strokeStyle = '#6b3a2a';
      ctx.lineWidth = gap;
      for (let row = 0; row * (bh + gap) < h; row++) {
        ctx.beginPath(); ctx.moveTo(0, row * (bh + gap)); ctx.lineTo(w, row * (bh + gap)); ctx.stroke();
      }
    });
  }

  _glassCurtainTex(cols, rows) {
    const key = `glass_${cols}_${rows}`;
    return this._tex(key, (ctx, w, h) => {
      ctx.fillStyle = '#1a3a5c';
      ctx.fillRect(0, 0, w, h);
      const cw = w / cols, ch = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = Math.random() > 0.25;
          ctx.fillStyle = lit ? `hsl(${200 + c * 3},60%,${35 + r % 3 * 5}%)` : '#0d1f36';
          ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, ch - 4);
          if (lit) {
            ctx.fillStyle = 'rgba(180,220,255,0.15)';
            ctx.fillRect(c * cw + 2, r * ch + 2, cw - 4, 4);
          }
        }
      }
      ctx.strokeStyle = '#0a1525';
      ctx.lineWidth = 3;
      for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * ch); ctx.lineTo(w, r * ch); ctx.stroke(); }
      for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cw, 0); ctx.lineTo(c * cw, h); ctx.stroke(); }
    });
  }

  _corrugatedTex() {
    return this._tex('corrugated', (ctx, w, h) => {
      ctx.fillStyle = '#8a7a5a';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < w; i += 8) {
        const t = Math.sin((i / w) * Math.PI * 32) * 0.5 + 0.5;
        ctx.fillStyle = `hsl(35,20%,${32 + t * 12}%)`;
        ctx.fillRect(i, 0, 8, h);
      }
      // horizontal rivets
      ctx.fillStyle = '#5a5040';
      for (let y = 16; y < h; y += 32) {
        for (let x = 8; x < w; x += 24) {
          ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
        }
      }
    });
  }

  _aiPanelTex() {
    return this._tex('aipanel', (ctx, w, h) => {
      ctx.fillStyle = '#050e20';
      ctx.fillRect(0, 0, w, h);
      // circuit traces
      ctx.strokeStyle = '#0044cc';
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 12; i++) {
        const y = (i / 12) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * 0.2, y);
        ctx.lineTo(w * 0.2 + 10, y + 10); ctx.lineTo(w, y + 10); ctx.stroke();
      }
      // LED dots
      for (let r = 0; r < 8; r++) for (let c = 0; c < 6; c++) {
        const on = Math.random() > 0.4;
        ctx.fillStyle = on ? '#00ffcc' : '#002233';
        ctx.beginPath(); ctx.arc(20 + c * 38, 16 + r * 30, 4, 0, Math.PI * 2); ctx.fill();
      }
    });
  }

  // ─────── Vehicle builder ───────

  vehicleColors = [0xd4cdc0, 0xc0392b, 0x2980b9, 0x27ae60, 0xf39c12, 0x8e44ad, 0xecf0f1, 0x2c3e50, 0xe67e22, 0x16a085];

  buildVehicle(index) {
    const type = index % 5; // 0=sedan,1=suv,2=van,3=pickup,4=sports
    const color = this.vehicleColors[index % this.vehicleColors.length];
    const group = new THREE.Group();

    const bodyMat = new THREE.MeshPhongMaterial({ color, shininess: 80, specular: new THREE.Color(0x444444) });

    if (type === 0) this._buildSedan(group, bodyMat);
    else if (type === 1) this._buildSUV(group, bodyMat);
    else if (type === 2) this._buildVan(group, bodyMat);
    else if (type === 3) this._buildPickup(group, bodyMat);
    else this._buildSports(group, bodyMat);

    this._addWheels(group, type);
    this._addLights(group, type);

    return group;
  }

  _addWheels(group, type) {
    const offsets = {
      0: { fx: 0.07, rz: 0.065, y: 0.038 },
      1: { fx: 0.075, rz: 0.07, y: 0.042 },
      2: { fx: 0.065, rz: 0.09, y: 0.038 },
      3: { fx: 0.07,  rz: 0.08, y: 0.038 },
      4: { fx: 0.07,  rz: 0.06, y: 0.034 },
    }[type];
    const { fx, rz, y } = offsets;
    const positions = [[-fx, y, rz], [fx, y, rz], [-fx, y, -rz], [fx, y, -rz]];
    for (const [wx, wy, wz] of positions) {
      const wheel = new THREE.Mesh(this.wheelGeo, this.wheelMat);
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(wx, wy, wz);
      group.add(wheel);
      const hub = new THREE.Mesh(this.hubGeo, this.hubMat);
      hub.rotation.z = Math.PI / 2;
      hub.position.set(wx + (wx < 0 ? -0.013 : 0.013), wy, wz);
      group.add(hub);
    }
  }

  _addLights(group, type) {
    // Headlights (front, white emissive)
    const hlMat = new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: new THREE.Color(0.6, 0.6, 0.4), shininess: 100 });
    const tlMat = new THREE.MeshPhongMaterial({ color: 0xff2200, emissive: new THREE.Color(0.4, 0.0, 0.0), shininess: 60 });
    const lgeo = new THREE.BoxGeometry(0.018, 0.012, 0.008);

    const fz = type === 2 ? 0.1 : type === 1 ? 0.09 : 0.075;
    const rz = -(type === 2 ? 0.1 : type === 1 ? 0.09 : 0.075);

    for (const sx of [-0.055, 0.055]) {
      const hl = new THREE.Mesh(lgeo, hlMat);
      hl.position.set(sx, 0.055, fz);
      group.add(hl);
      const tl = new THREE.Mesh(lgeo, tlMat);
      tl.position.set(sx, 0.055, rz);
      group.add(tl);
    }
  }

  _buildSedan(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.22), mat);
    body.position.y = 0.06;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.042, 0.11), this.glassMat);
    cabin.position.set(0, 0.106, -0.015);
    g.add(cabin);
  }

  _buildSUV(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.065, 0.24), mat);
    body.position.y = 0.068;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.14), this.glassMat);
    cabin.position.set(0, 0.118, -0.01);
    g.add(cabin);
  }

  _buildVan(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.10, 0.24), mat);
    body.position.y = 0.075;
    g.add(body);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.01), this.glassMat);
    windshield.position.set(0, 0.09, 0.115);
    g.add(windshield);
  }

  _buildPickup(g, mat) {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.06, 0.12), mat);
    cab.position.set(0, 0.065, 0.04);
    g.add(cab);
    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.12), mat);
    bed.position.set(0, 0.05, -0.07);
    g.add(bed);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.045, 0.10), this.glassMat);
    cabin.position.set(0, 0.11, 0.04);
    g.add(cabin);
  }

  _buildSports(g, mat) {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.038, 0.22), mat);
    body.position.y = 0.05;
    g.add(body);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.032, 0.09), this.glassMat);
    cabin.position.set(0, 0.082, -0.01);
    g.add(cabin);
    // spoiler
    const spoilerMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
    const spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.012, 0.018), spoilerMat);
    spoiler.position.set(0, 0.072, -0.1);
    g.add(spoiler);
  }

  // ─────── Residential buildings ───────

  buildResidential(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h = this._bldH(x, y, TILE.ZONE_RES, level);

    if (level === 1) {
      // House: brick body + pitched roof + chimney
      const brickMat = new THREE.MeshPhongMaterial({ map: this._brickTex(), shininess: 5 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      // Pitched roof
      const roofMat = new THREE.MeshPhongMaterial({ color: 0x8b3a3a, shininess: 4 });
      const roofGeo = new THREE.ConeGeometry(fw * 0.72, h * 0.45, 4);
      const roof = new THREE.Mesh(roofGeo, roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.position.y = h + h * 0.225;
      roof.castShadow = true;
      group.add(roof);

      // Chimney
      const chimMat = new THREE.MeshLambertMaterial({ color: 0x7a4a3a });
      const chim = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.06), chimMat);
      chim.position.set(fw * 0.25, h + 0.08, fw * 0.2);
      group.add(chim);

    } else {
      // Apartment block: brick texture body + flat roof + balconies
      const brickMat = new THREE.MeshPhongMaterial({ map: this._brickTex(), shininess: 8 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), brickMat);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      // Roof edge
      const roofMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
      const roof = new THREE.Mesh(new THREE.BoxGeometry(fw + 0.04, 0.04, fw + 0.04), roofMat);
      roof.position.y = h + 0.02;
      group.add(roof);

      // Balconies
      const balMat = new THREE.MeshLambertMaterial({ color: 0xcccccc });
      const floors = level === 2 ? 2 : 3;
      for (let fl = 1; fl <= floors; fl++) {
        const fy = (h / (floors + 1)) * fl;
        const bal = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.32, 0.03, 0.10), balMat);
        bal.position.set(fw * 0.5 + 0.05, fy, 0);
        group.add(bal);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.32, 0.08, 0.01), balMat);
        rail.position.set(fw * 0.5 + 0.05, fy + 0.055, 0.05);
        group.add(rail);
      }

      if (level === 3) {
        // Water tower on roof
        const wtMat = new THREE.MeshLambertMaterial({ color: 0x8a7a5a });
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.18, 8), wtMat);
        tank.position.set(-fw * 0.3, h + 0.09, fw * 0.3);
        group.add(tank);
        for (let i = 0; i < 4; i++) {
          const ang = (i / 4) * Math.PI * 2;
          const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.14), wtMat);
          leg.position.set(-fw * 0.3 + Math.cos(ang) * 0.07, h + 0.01, fw * 0.3 + Math.sin(ang) * 0.07);
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
    const h = this._bldH(x, y, TILE.ZONE_COM, level);

    if (level === 1) {
      // Ground-floor shop
      const shopMat = new THREE.MeshPhongMaterial({ color: 0x6090d8, shininess: 40 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), shopMat);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      // Awning
      const awMat = new THREE.MeshLambertMaterial({ color: 0xcc4444 });
      const aw = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.85, 0.02, 0.14), awMat);
      aw.rotation.x = -0.25;
      aw.position.set(0, h * 0.65, fw * 0.5 + 0.04);
      group.add(aw);

      // Sign board
      const signMat = new THREE.MeshPhongMaterial({ color: 0xffee44, emissive: new THREE.Color(0.08, 0.07, 0.0) });
      const sign = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.6, 0.07, 0.03), signMat);
      sign.position.set(0, h * 0.82, fw * 0.5 + 0.02);
      group.add(sign);

    } else if (level === 2) {
      // Mid-rise glass office
      const glassMat = new THREE.MeshPhongMaterial({ map: this._glassCurtainTex(6, 8), shininess: 120, specular: new THREE.Color(0x88aaff) });
      const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), glassMat);
      body.position.y = h / 2;
      body.castShadow = body.receiveShadow = true;
      group.add(body);

      // Roof AC units
      const acMat = new THREE.MeshLambertMaterial({ color: 0x999999 });
      for (let i = 0; i < 3; i++) {
        const ac = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, 0.12), acMat);
        ac.position.set(-fw * 0.25 + i * fw * 0.25, h + 0.03, -fw * 0.2);
        group.add(ac);
      }

    } else {
      // Level 3 — skyscraper with 3 setback tiers
      const glassMat = new THREE.MeshPhongMaterial({ map: this._glassCurtainTex(8, 12), shininess: 140, specular: new THREE.Color(0xaaccff) });
      const tiers = [
        { w: fw,        h: h * 0.50 },
        { w: fw * 0.72, h: h * 0.30 },
        { w: fw * 0.45, h: h * 0.20 },
      ];
      let yOff = 0;
      for (const tier of tiers) {
        const tierMesh = new THREE.Mesh(new THREE.BoxGeometry(tier.w, tier.h, tier.w), glassMat);
        tierMesh.position.y = yOff + tier.h / 2;
        tierMesh.castShadow = tierMesh.receiveShadow = true;
        group.add(tierMesh);
        yOff += tier.h;
      }

      // Spire
      const spireMat = new THREE.MeshPhongMaterial({ color: 0xbbbbbb, shininess: 60 });
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.04, h * 0.28, 8), spireMat);
      spire.position.y = yOff + h * 0.14;
      group.add(spire);

      // Blinking red beacon
      this._beacon = this._beacon || new THREE.MeshBasicMaterial({ color: 0xff2200 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff2200 }));
      beacon._isBeacon = true;
      beacon.position.y = yOff + h * 0.28;
      group.add(beacon);
    }
    return group;
  }

  // ─────── Industrial buildings ───────

  buildIndustrial(x, y, T, level, rng) {
    const group = new THREE.Group();
    const fw = T * (0.84 - level * 0.02);
    const h = this._bldH(x, y, TILE.ZONE_IND, level);

    const metalMat = new THREE.MeshPhongMaterial({ map: this._corrugatedTex(), shininess: 10 });

    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), metalMat);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    group.add(body);

    // Loading dock
    const dockMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const dock = new THREE.Mesh(new THREE.BoxGeometry(fw * 0.32, h * 0.4, 0.06), dockMat);
    dock.position.set(0, h * 0.2, fw * 0.5 + 0.03);
    group.add(dock);

    if (level >= 2) {
      // Smokestacks
      const stackMat = new THREE.MeshLambertMaterial({ color: 0x888880 });
      const ringMat  = new THREE.MeshLambertMaterial({ color: 0xdd2222 });
      const stacks = level === 3 ? 3 : 1;
      for (let s = 0; s < stacks; s++) {
        const sx = -fw * 0.25 + s * fw * 0.25;
        const sh = h * (0.6 + rng * 0.3);
        const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, sh, 10), stackMat);
        stack.position.set(sx, h + sh / 2, -fw * 0.2);
        stack.castShadow = true;
        group.add(stack);
        // Safety rings
        for (let r = 0; r < 3; r++) {
          const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 6, 12), ringMat);
          ring.rotation.x = Math.PI / 2;
          ring.position.set(sx, h + sh * (0.3 + r * 0.25), -fw * 0.2);
          group.add(ring);
        }
      }
    }
    return group;
  }

  // ─────── AI service buildings ───────

  buildAIDatacenter(T) {
    const group = new THREE.Group();
    const fw = T * 0.88;

    const bodyMat = new THREE.MeshPhongMaterial({ map: this._aiPanelTex(), shininess: 40, specular: new THREE.Color(0x003366) });
    const h = 0.75;
    const body = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fw), bodyMat);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    group.add(body);

    // Blue LED edge strip
    const ledMat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
    const edgeGeo = new THREE.BoxGeometry(fw + 0.01, 0.012, 0.012);
    for (const [dy, dz] of [[0, fw / 2], [0, -fw / 2]]) {
      const strip = new THREE.Mesh(edgeGeo, ledMat);
      strip.position.set(0, h * 0.5 + dy, dz);
      group.add(strip);
    }
    const edgeGeoZ = new THREE.BoxGeometry(0.012, 0.012, fw);
    for (const dx of [-fw / 2, fw / 2]) {
      const strip = new THREE.Mesh(edgeGeoZ, ledMat);
      strip.position.set(dx, h * 0.5, 0);
      group.add(strip);
    }

    // Cooling towers
    const ctMat = new THREE.MeshPhongMaterial({ color: 0x444455, shininess: 20 });
    const ctVapMat = new THREE.MeshPhongMaterial({ color: 0xddddee, transparent: true, opacity: 0.35 });
    for (const [cx, cz] of [[-fw * 0.28, -fw * 0.28], [fw * 0.28, -fw * 0.28]]) {
      const ct = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.35, 10), ctMat);
      ct.position.set(cx, h + 0.175, cz);
      group.add(ct);
      const vap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.09, 0.28, 8), ctVapMat);
      vap.position.set(cx, h + 0.49, cz);
      group.add(vap);
    }

    // Satellite dish
    const dishMat = new THREE.MeshPhongMaterial({ color: 0x9999aa, shininess: 60 });
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.10, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), dishMat);
    dish.rotation.x = -Math.PI * 0.4;
    dish.position.set(fw * 0.28, h + 0.12, fw * 0.2);
    group.add(dish);

    group._ledMat = ledMat;
    return group;
  }

  buildAIHub(T) {
    const group = new THREE.Group();
    const fw = T * 0.82;

    // Dark base
    const baseMat = new THREE.MeshPhongMaterial({ color: 0x060e24, shininess: 60, specular: new THREE.Color(0x0033aa) });
    const base = new THREE.Mesh(new THREE.BoxGeometry(fw, 0.35, fw), baseMat);
    base.position.y = 0.175;
    base.castShadow = base.receiveShadow = true;
    group.add(base);

    // Tapered glass tower — manual frustum-like shape using a lathe
    const towerMat = new THREE.MeshPhongMaterial({
      map: this._glassCurtainTex(4, 14),
      color: 0x112244,
      shininess: 160, specular: new THREE.Color(0x4488ff),
      transparent: true, opacity: 0.88
    });
    const towerH = 1.6 + fw * 0.4;
    const points = [
      new THREE.Vector2(fw * 0.36, 0),
      new THREE.Vector2(fw * 0.32, towerH * 0.5),
      new THREE.Vector2(fw * 0.15, towerH * 0.85),
      new THREE.Vector2(fw * 0.04, towerH),
    ];
    const towerGeo = new THREE.LatheGeometry(points, 8);
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.y = 0.35;
    tower.castShadow = true;
    group.add(tower);

    // Glowing blue ring around mid-tower
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, transparent: true, opacity: 0.85 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(fw * 0.3, 0.03, 8, 28), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.35 + towerH * 0.5;
    group.add(ring);
    group._ringMat = ringMat;

    // Antenna array at top
    const antMat = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const topY = 0.35 + towerH;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2;
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.014, 0.28, 5), antMat);
      ant.position.set(Math.cos(ang) * 0.055, topY + 0.14, Math.sin(ang) * 0.055);
      group.add(ant);
    }

    // Top beacon
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), new THREE.MeshBasicMaterial({ color: 0x00ffaa }));
    beacon._isBeacon = true;
    beacon.position.y = topY + 0.3;
    group.add(beacon);

    return group;
  }

  // ─────── Helpers ───────

  _bldH(x, y, zone, level) {
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

  _tileRng(x, y) {
    let h = ((x * 2654435761) ^ (y * 1111111111)) >>> 0;
    h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16;
    return (h >>> 0) / 0xFFFFFFFF;
  }
}
