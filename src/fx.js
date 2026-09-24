import * as THREE from 'three';
import { toonMat, inked, GEO } from './materials.js';
import { rand } from './spring.js';

// Particles (one InstancedMesh per kind) + impact sprites + thrown props.

class Pool {
  constructor(scene, geo, mat, max, o = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (o.colors) this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3);
    scene.add(this.mesh);
    this.max = max;
    this.o = { gravity: 9.8, drag: 0.4, bounce: 0.35, flutter: 0, ...o };
    this.p = [];
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.sv = new THREE.Vector3();
    this.mesh.count = 0;
  }
  spawn(pos, vel, scale, life, color) {
    if (this.p.length >= this.max) this.p.shift();
    // the colour lives on the particle: slots shift down as older particles die
    this.p.push({ pos: pos.clone(), vel: vel.clone(), rot: new THREE.Vector3(rand(0, 6), rand(0, 6), rand(0, 6)),
      spin: new THREE.Vector3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), scale, life, age: 0, color: color ? color.clone() : null });
  }
  update(dt) {
    const o = this.o;
    for (let i = this.p.length - 1; i >= 0; i--) {
      const p = this.p[i];
      p.age += dt;
      if (p.age > p.life) { this.p.splice(i, 1); continue; }
      p.vel.y -= o.gravity * dt;
      p.vel.multiplyScalar(1 - o.drag * dt);
      if (o.flutter) { p.vel.x += Math.sin(p.age * 9 + i) * o.flutter * dt; p.vel.y = Math.max(p.vel.y, -0.9); }
      p.pos.addScaledVector(p.vel, dt);
      p.rot.addScaledVector(p.spin, dt);
      if (p.pos.y < 0.01 && Math.abs(p.pos.x) < 3.6 && Math.abs(p.pos.z) < 3.6) {
        p.pos.y = 0.01; p.vel.y = Math.abs(p.vel.y) * o.bounce; p.vel.x *= 0.7; p.vel.z *= 0.7; p.spin.multiplyScalar(0.6);
      }
    }
    for (let i = 0; i < this.p.length; i++) {
      const p = this.p[i];
      const fade = Math.min(1, (p.life - p.age) * 4);
      this.q.setFromEuler(this.e.set(p.rot.x, p.rot.y, p.rot.z));
      this.m.compose(p.pos, this.q, this.sv.copy(p.scale).multiplyScalar(fade));
      this.mesh.setMatrixAt(i, this.m);
      if (p.color && this.mesh.instanceColor) this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = this.p.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.p.length = 0; this.mesh.count = 0; }
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const burstTex = () => canvasTex(256, (g, s) => {
  g.translate(s / 2, s / 2);
  const spikes = 14;
  g.beginPath();
  for (let i = 0; i <= spikes * 2; i++) {
    const a = (i / (spikes * 2)) * Math.PI * 2;
    const r = i % 2 ? s * 0.2 : s * (0.38 + Math.random() * 0.1);
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath();
  g.fillStyle = '#fff6c0'; g.fill();
  g.lineWidth = 10; g.strokeStyle = '#ffffff'; g.stroke();
});
const ringTex = () => canvasTex(256, (g, s) => {
  g.strokeStyle = '#ffffff'; g.lineWidth = 14;
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, 7); g.stroke();
});
const starTex = () => canvasTex(128, (g, s) => {
  g.translate(s / 2, s / 2);
  g.beginPath();
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2; const r = i % 2 ? s * 0.18 : s * 0.44; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fillStyle = '#ffe23d'; g.fill(); g.lineWidth = 8; g.strokeStyle = '#1a0c12'; g.stroke();
});
// four-point lens glint for attack tells
const glintTex = () => canvasTex(256, (g, s) => {
  g.translate(s / 2, s / 2);
  const ray = (w, len) => {
    const grd = g.createLinearGradient(0, 0, len, 0);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, -w); g.lineTo(len, 0); g.lineTo(0, w); g.closePath(); g.fill();
  };
  for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2); ray(14, s * 0.5); g.restore(); }
  for (let i = 0; i < 4; i++) { g.save(); g.rotate(Math.PI / 4 + i * Math.PI / 2); ray(6, s * 0.22); g.restore(); }
  const c = g.createRadialGradient(0, 0, 0, 0, 0, s * 0.16);
  c.addColorStop(0, 'rgba(255,255,255,1)'); c.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = c; g.beginPath(); g.arc(0, 0, s * 0.16, 0, 7); g.fill();
});
const zTex = () => canvasTex(128, (g, s) => {
  g.font = '900 100px Impact, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 10; g.strokeStyle = '#1a0c12'; g.strokeText('Z', s / 2, s / 2); g.fillStyle = '#ffffff'; g.fillText('Z', s / 2, s / 2);
});

export class FX {
  constructor(scene) {
    this.scene = scene;
    const basic = (c) => new THREE.MeshBasicMaterial({ color: c });
    this.sweat = new Pool(scene, GEO.sphereLo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#d8f4ff').multiplyScalar(1.6), toneMapped: false }), 120, { drag: 0.6 });
    this.teeth = new Pool(scene, GEO.box, toonMat('#fffaf0'), 40, { bounce: 0.45, drag: 0.2 });
    const paperGeo = new THREE.PlaneGeometry(1, 1.3);
    this.paper = new Pool(scene, paperGeo, new THREE.MeshToonMaterial({ color: '#f5f1e6', side: THREE.DoubleSide }), 80, { gravity: 2.2, drag: 1.8, flutter: 3, bounce: 0 });
    this.bills = new Pool(scene, new THREE.PlaneGeometry(1, 0.46), new THREE.MeshToonMaterial({ color: '#62c973', side: THREE.DoubleSide }), 120, { gravity: 2, drag: 1.8, flutter: 3, bounce: 0 });
    this.confetti = new Pool(scene, new THREE.PlaneGeometry(1, 0.6), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), 400, { gravity: 2.5, drag: 1.5, flutter: 2, bounce: 0, colors: true });
    this.sparks = new Pool(scene, GEO.box, new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffe9a8').multiplyScalar(3), toneMapped: false }), 80, { gravity: 3, drag: 3 });
    this.coins = new Pool(scene, new THREE.CylinderGeometry(1, 1, 0.2, 14), toonMat('#ffc233', { emissive: 0x3a2400 }), 60, { bounce: 0.4 });

    this.burstT = burstTex(); this.ringT = ringTex(); this.starT = starTex(); this.zT = zTex();
    this.sprites = [];
    this.stars = [];
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.starT, transparent: true, depthWrite: false }));
      s.scale.setScalar(0.09); s.visible = false; scene.add(s); this.stars.push(s);
    }
    this.starsOn = false;
    this.glintT = glintTex();
    this.tells = {};
    for (const h of ['L', 'R']) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintT, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      sp.renderOrder = 11; sp.visible = false;
      scene.add(sp);
      this.tells[h] = sp;
    }
    this.zs = [];
    this.projectiles = [];
    this.tmp = new THREE.Vector3();
    this.v = new THREE.Vector3();
    this.col = new THREE.Color();
  }

  burst(pos, size = 0.5, color = '#fff3b0', life = 0.16) {
    const mat = new THREE.SpriteMaterial({ map: this.burstT, color: new THREE.Color(color).multiplyScalar(2.2), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const s = new THREE.Sprite(mat);
    s.position.copy(pos); s.material.rotation = Math.random() * 6;
    s.renderOrder = 10;
    this.scene.add(s);
    this.sprites.push({ s, age: 0, life, size, grow: 1.6 });
    const r = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.ringT, color: new THREE.Color(color).multiplyScalar(1.5), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    r.position.copy(pos); r.renderOrder = 10;
    this.scene.add(r);
    this.sprites.push({ s: r, age: 0, life: life * 1.8, size: size * 0.6, grow: 3 });
  }

  impact(pos, strength, dirToCam) {
    this.burst(pos, 0.25 + strength * 0.45, strength > 0.7 ? '#ffd23f' : '#fff3b0');
    const n = Math.round(6 + strength * 16);
    for (let i = 0; i < n; i++) {
      this.v.set(rand(-1, 1), rand(-0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(rand(1.5, 4) * (0.5 + strength));
      this.v.addScaledVector(dirToCam, -1.5);
      this.sweat.spawn(pos, this.v, this.tmp.setScalar(rand(0.008, 0.02)), rand(0.4, 0.9));
    }
    for (let i = 0; i < n * 0.6; i++) {
      this.v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(rand(3, 7) * (0.4 + strength));
      this.sparks.spawn(pos, this.v, this.tmp.set(0.006, 0.006, rand(0.03, 0.08)), rand(0.1, 0.25));
    }
  }

  teethOut(pos, count = 2) {
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-1.2, 1.2), rand(1.5, 3.2), rand(-2.5, 0.5));
      this.teeth.spawn(pos, this.v, this.tmp.set(0.018, 0.026, 0.016), 3.5);
    }
  }

  paperBurst(pos, count = 12) {
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-2, 2), rand(0.5, 3), rand(-1, 2));
      this.paper.spawn(pos, this.v, this.tmp.setScalar(rand(0.1, 0.16)), rand(2, 3.5));
    }
  }

  cashRain(pos, count = 20, spread = 1) {
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-1.5, 1.5) * spread, rand(0.5, 2.5), rand(-1, 1.5));
      this.bills.spawn(this.tmp.copy(pos).add(this.v.clone().multiplyScalar(0.1)), this.v, new THREE.Vector3().setScalar(rand(0.1, 0.15)), rand(2.5, 4));
    }
  }

  coinsOut(pos, count = 10) {
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-2, 2), rand(1.5, 3.5), rand(-2, 1));
      this.coins.spawn(pos, this.v, this.tmp.set(0.03, 0.03, 0.03), 3);
    }
  }

  confettiBurst(pos, count = 160, palette = ['#ff2e88', '#22e5ff', '#ffd23f', '#ffffff']) {
    for (let i = 0; i < count; i++) {
      this.v.set(rand(-4, 4), rand(2, 7), rand(-3, 3));
      this.col.set(palette[i % palette.length]);
      this.confetti.spawn(pos, this.v, this.tmp.setScalar(rand(0.025, 0.045)), rand(3, 5), this.col);
    }
  }

  // Punch-Out style glint on the glove that is about to swing.
  setTell(hand, level, color, pos, t) {
    const sp = this.tells[hand];
    sp.visible = level > 0.05;
    if (!sp.visible) return;
    sp.position.copy(pos);
    sp.material.color.set(color).multiplyScalar(2.5);
    sp.material.opacity = Math.min(1, level * 1.3);
    sp.material.rotation = t * 2.5;
    // a glove swinging at the lens would otherwise grow into a white blob; cap its size on screen
    const near = this.cam ? Math.min(1, pos.distanceTo(this.cam.getWorldPosition(this.tmp)) / 1.5) : 1;
    sp.scale.setScalar((0.16 + level * 0.3 + Math.sin(t * 34) * 0.04 * level) * near);
  }

  dizzy(on) { this.starsOn = on; for (const s of this.stars) s.visible = on; }

  snore(headPos) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.zT, transparent: true, depthWrite: false }));
    s.position.copy(headPos).add(this.tmp.set(0.15, 0.2, 0));
    this.scene.add(s);
    this.zs.push({ s, age: 0 });
  }

  // Thrown props fly in an arc from `from` to `to` over `dur` seconds.
  projectile(type, from, to, dur) {
    const g = new THREE.Group();
    if (type === 'coffee') {
      const cup = inked(GEO.cylTaper, toonMat('#f4efe6'), 0.006); cup.scale.set(0.055, 0.13, 0.055); g.add(cup);
      const sleeve = inked(GEO.cyl, toonMat('#8a5a33'), 0.004); sleeve.scale.set(0.058, 0.05, 0.058); g.add(sleeve);
      const lid = inked(GEO.cyl, toonMat('#ffffff'), 0.004); lid.scale.set(0.058, 0.02, 0.058); lid.position.y = 0.07; g.add(lid);
    } else if (type === 'paper') {
      for (let i = 0; i < 4; i++) { const p = inked(GEO.box, toonMat('#f7f4ea'), 0.004); p.scale.set(0.21, 0.005, 0.28); p.position.y = i * 0.008; p.rotation.y = i * 0.1; g.add(p); }
      const stamp = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#ff2244' })); stamp.scale.set(0.14, 0.004, 0.05); stamp.position.y = 0.035; g.add(stamp);
    } else if (type === 'card') {
      const c = inked(GEO.box, toonMat('#ffffff'), 0.004); c.scale.set(0.09, 0.004, 0.05); g.add(c);
      const stripe = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#3dff7a' })); stripe.scale.set(0.09, 0.005, 0.01); stripe.position.z = -0.015; g.add(stripe);
      g.scale.setScalar(1.6);
    } else if (type === 'dentures') {
      const gum = inked(new THREE.TorusGeometry(0.06, 0.022, 8, 16, Math.PI), toonMat('#ff7b9c'), 0.005); gum.rotation.x = Math.PI / 2; g.add(gum);
      for (let i = 0; i < 8; i++) { const a = (i / 7) * Math.PI; const t = new THREE.Mesh(GEO.box, toonMat('#fffdf5')); t.scale.set(0.018, 0.022, 0.014); t.position.set(Math.cos(a) * 0.06, 0.018, Math.sin(a) * 0.06); g.add(t); }
      g.scale.setScalar(1.4);
    } else {
      // money bag
      const bag = inked(GEO.sphere, toonMat('#c7a26a'), 0.008); bag.scale.set(0.09, 0.1, 0.09); g.add(bag);
      const tie = inked(GEO.cyl, toonMat('#8c6a3c'), 0.005); tie.scale.set(0.03, 0.05, 0.03); tie.position.y = 0.1; g.add(tie);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), new THREE.MeshBasicMaterial({ map: canvasTex(64, (c) => { c.font = '900 56px Impact'; c.textAlign = 'center'; c.fillStyle = '#1f6b2a'; c.fillText('$', 32, 52); }), transparent: true }));
      sign.position.z = 0.091; g.add(sign);
    }
    g.position.copy(from);
    this.scene.add(g);
    const pr = { g, from: from.clone(), to: to.clone(), dur, t: 0, past: null, type };
    this.projectiles.push(pr);
    return {
      miss: (side) => { pr.past = new THREE.Vector3().subVectors(pr.to, pr.from).normalize().multiplyScalar(7); pr.past.x += side === 'left' ? 3 : side === 'right' ? -3 : 0; pr.past.y += side === 'duck' ? 1.5 : 0; },
      remove: () => { pr.t = 99; pr.past = null; },
    };
  }

  update(dt, t, headPos, realDt = dt) {
    for (const pool of [this.sweat, this.teeth, this.paper, this.bills, this.confetti, this.sparks, this.coins]) pool.update(dt);
    for (let i = this.sprites.length - 1; i >= 0; i--) {
      const sp = this.sprites[i];
      sp.age += realDt;
      const k = sp.age / sp.life;
      if (k >= 1) { this.scene.remove(sp.s); sp.s.material.dispose(); this.sprites.splice(i, 1); continue; }
      sp.s.scale.setScalar(sp.size * (0.6 + k * sp.grow));
      sp.s.material.opacity = 1 - k * k;
    }
    if (this.starsOn && headPos) {
      this.stars.forEach((s, i) => {
        const a = t * 5 + (i / 3) * Math.PI * 2;
        s.position.set(headPos.x + Math.cos(a) * 0.22, headPos.y + 0.2 + Math.sin(a * 2) * 0.02, headPos.z + Math.sin(a) * 0.22);
      });
    }
    for (let i = this.zs.length - 1; i >= 0; i--) {
      const z = this.zs[i];
      z.age += dt;
      z.s.position.y += dt * 0.25; z.s.position.x += Math.sin(z.age * 4) * dt * 0.1;
      z.s.scale.setScalar(0.06 + z.age * 0.06);
      z.s.material.opacity = Math.max(0, 1 - z.age / 1.6);
      if (z.age > 1.6) { this.scene.remove(z.s); z.s.material.dispose(); this.zs.splice(i, 1); }
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.t += dt;
      if (p.past) {
        p.g.position.addScaledVector(p.past, dt);
        p.g.rotation.x += dt * 12;
        if (p.t > p.dur + 0.6) { this.scene.remove(p.g); this.projectiles.splice(i, 1); }
        continue;
      }
      if (p.t >= p.dur) { this.scene.remove(p.g); this.projectiles.splice(i, 1); continue; }
      const k = p.t / p.dur;
      p.g.position.lerpVectors(p.from, p.to, k);
      p.g.position.y += Math.sin(k * Math.PI) * 0.35;
      p.g.rotation.x += dt * (p.type === 'card' ? 3 : 9);
      p.g.rotation.y += dt * (p.type === 'card' ? 25 : 4);
    }
  }

  clear() {
    for (const pool of [this.sweat, this.teeth, this.paper, this.bills, this.confetti, this.sparks, this.coins]) pool.clear();
    for (const p of this.projectiles) this.scene.remove(p.g);
    this.projectiles.length = 0;
    this.dizzy(false);
    this.tells.L.visible = this.tells.R.visible = false;
  }
}
