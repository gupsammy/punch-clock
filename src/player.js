import * as THREE from 'three';
import { SpringSet, clamp } from './spring.js';
import { toonMat, inked, GEO, placeSegment } from './materials.js';

// First-person body: the camera rig and your two gloves.
// Glove positions are in camera space, so they stay framed whatever the camera does.

export const CAM_BASE = new THREE.Vector3(0, 1.62, 1.2);
export const LOOK_AT = new THREE.Vector3(0, 1.42, -0.6);

const GUARD = { lx: -0.23, ly: -0.3, lz: -0.6, rx: 0.23, ry: -0.3, rz: -0.6, lr: 0.25, rr: -0.25 };

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.rig = new THREE.Group();          // world placement + dodge offsets
    this.rig.position.copy(CAM_BASE);
    this.rig.add(camera);
    camera.position.set(0, 0, 0);
    this.cam = new SpringSet({ x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, fov: 0 }, 220, 22);
    this.g = new SpringSet(GUARD, 300, 24);
    this.trauma = 0;
    this.shakeMul = 1;
    this.look = new THREE.Vector3().copy(LOOK_AT);
    this.lookTarget = new THREE.Vector3().copy(LOOK_AT);
    this.lookOverride = null;
    this.baseFov = 58;
    this.charge = 0;

    const gloveMat = this.gloveMat = toonMat('#ff2a3d', { emissive: 0x000000 });
    const tape = toonMat('#f2efe8');
    const skin = toonMat('#c98d6a');
    this.gloves = {};
    for (const side of ['L', 'R']) {
      const s = side === 'L' ? -1 : 1;
      const grp = new THREE.Group();
      const main = inked(GEO.sphere, side === 'L' ? gloveMat : gloveMat, 0.006);
      main.scale.set(0.095, 0.09, 0.118);
      grp.add(main);
      const knuckle = inked(GEO.sphere, gloveMat, 0.005);
      knuckle.scale.set(0.082, 0.064, 0.072); knuckle.position.set(0, 0.035, -0.05);
      grp.add(knuckle);
      const thumb = inked(GEO.sphereLo, gloveMat, 0.005);
      thumb.scale.set(0.045, 0.04, 0.06); thumb.position.set(-s * 0.08, 0.02, -0.02);
      grp.add(thumb);
      const cuff = inked(GEO.cyl, tape, 0.005);
      cuff.scale.set(0.072, 0.1, 0.072); cuff.rotation.x = Math.PI / 2; cuff.position.z = 0.12;
      grp.add(cuff);
      const arm = inked(GEO.cyl, skin, 0.006);
      camera.add(grp); camera.add(arm);
      this.gloves[side] = { grp, arm };
    }
    this.state = 'idle';
    this.squash = { L: 0, R: 0 };
    this._a = new THREE.Vector3(); this._b = new THREE.Vector3();
  }

  reset() {
    this.cam.snapAll({ x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, fov: 0 });
    this.g.snapAll(GUARD);
    this.trauma = 0;
    this.lookOverride = null;
    this.charge = 0;
  }

  // Menu/intro framing: the rig glides to a free camera spot and the gloves hide.
  setMenu(pos, look, snap = false) {
    this.menu = pos ? { pos: pos.clone(), look: look.clone() } : null;
    for (const k in this.gloves) { this.gloves[k].grp.visible = this.gloves[k].arm.visible = !pos; }
    if (pos && snap) { this.rig.position.copy(pos); this.look.copy(look); }
  }

  addTrauma(x) { this.trauma = Math.min(1, this.trauma + x * this.shakeMul); }

  guard() { this.g.set(GUARD, 300, 24); }

  // extend a glove; the resolved outcome decides the rebound later
  punch(side, heavy = false) {
    const s = side === 'L' ? -1 : 1;
    const t = side === 'L'
      ? { lx: -0.04, ly: 0.02, lz: -1.28, lr: -0.2 }
      : { rx: 0.03, ry: 0.03, rz: -1.32, rr: 0.2 };
    this.g.set(t, heavy ? 520 : 700, 30);
    this.cam.kick('yaw', -s * 0.5);
    this.cam.kick('z', -0.4);
    this.cam.kick('roll', s * 0.4);
  }

  rebound(side, kind) {
    const k = side === 'L' ? 'l' : 'r';
    if (kind === 'block') { this.g.kick(k + 'z', 5); this.g.kick(k + 'x', side === 'L' ? -2 : 2); this.squash[side] = 0.5; }
    if (kind === 'hit') { this.g.kick(k + 'z', 2); this.g.kick(k + 'y', 1.5); this.squash[side] = 1; }
  }

  haymakerWind() {
    this.g.set({ rx: 0.38, ry: -0.48, rz: -0.3, rr: 0.8, lx: -0.12, ly: -0.2, lz: -0.55 }, 160, 14);
    this.cam.set({ z: 0.18, roll: -0.08, yaw: 0.06, fov: 6 }, 90, 12);
  }
  haymakerStrike() {
    this.g.set({ rx: -0.02, ry: 0.06, rz: -1.35, rr: 0.3 }, 700, 28);
    this.cam.set({ z: -0.2, roll: 0.12, yaw: -0.1, fov: -8 }, 400, 22);
  }

  dodge(dir) {
    const s = dir === 'left' ? -1 : 1;
    this.cam.set({ x: s * 0.52, y: -0.1, roll: -s * 0.2, yaw: -s * 0.08, z: 0.05, pitch: 0 }, 420, 30);
    this.g.set({ lx: -0.2 - s * 0.04, rx: 0.2 - s * 0.04, ly: -0.22, ry: -0.22, lz: -0.46, rz: -0.46 }, 300, 26);
  }
  duck() {
    this.cam.set({ y: -0.42, pitch: 0.08, z: 0.05, x: 0, roll: 0, yaw: 0 }, 420, 30);
    this.g.set({ ly: -0.14, ry: -0.14, lz: -0.44, rz: -0.44, lx: -0.14, rx: 0.14 }, 300, 26);
  }
  center() {
    this.cam.set({ x: 0, y: 0, z: 0, roll: 0, yaw: 0, pitch: 0, fov: 0 }, 260, 24);
    this.guard();
  }

  hurt(strength, fromSide) {
    const s = fromSide === 'L' ? 1 : fromSide === 'R' ? -1 : 0;
    this.cam.kick('z', 3 * strength);
    this.cam.kick('pitch', -1.4 * strength);
    this.cam.kick('roll', s * 1.8 * strength + (Math.random() - 0.5));
    this.cam.kick('yaw', s * 1.2 * strength);
    this.cam.kick('x', s * 1.2 * strength);
    this.g.kick('ly', -3); this.g.kick('ry', -3);
    this.addTrauma(0.35 + strength * 0.5);
  }

  knockedDown() {
    this.cam.set({ y: -1.25, roll: 1.1, pitch: 0.55, x: 0.15, z: 0.4, yaw: 0.2 }, 60, 9);
    this.g.set({ ly: -0.9, ry: -0.9, lz: -0.3, rz: -0.3 }, 60, 9);
  }

  // gloves fall out of frame so a KO shot belongs to the opponent
  drop() {
    this.g.set({ ly: -0.95, ry: -0.95, lz: -0.5, rz: -0.5, lx: -0.35, rx: 0.35 }, 50, 9);
  }

  victory() {
    this.g.set({ lx: -0.3, ly: 0.35, lz: -0.6, rx: 0.3, ry: 0.35, rz: -0.6, lr: 0.6, rr: -0.6 }, 120, 10);
  }

  update(dt, t) {
    this.cam.update(dt);
    this.g.update(dt);
    const C = (k) => this.cam.get(k);
    // idle breathing
    const breath = Math.sin(t * 2.1) * 0.006;
    if (this.menu) {
      this.rig.position.lerp(this.menu.pos, 1 - Math.exp(-2.2 * dt));
      this.look.lerp(this.menu.look, 1 - Math.exp(-3 * dt));
    } else {
      this.rig.position.set(CAM_BASE.x + C('x'), CAM_BASE.y + C('y') + breath, CAM_BASE.z + C('z'));
      // look at the target, then layer roll/pitch/yaw and shake on top
      this.look.lerp(this.lookOverride || this.lookTarget, 1 - Math.exp(-8 * dt));
    }
    // Group.lookAt aims +z at the target; the child camera looks down -z, so turn around
    this.rig.lookAt(this.look);
    this.rig.rotateY(Math.PI);
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const sh = this.trauma * this.trauma;
    const n = (f, o) => Math.sin(t * f + o) * 0.5 + Math.sin(t * f * 2.3 + o * 1.7) * 0.5;
    this.camera.rotation.set(
      C('pitch') + sh * 0.09 * n(37, 1),
      C('yaw') + sh * 0.09 * n(41, 2),
      C('roll') + sh * 0.12 * n(29, 3),
    );
    this.camera.position.set(sh * 0.04 * n(53, 4), sh * 0.04 * n(47, 5), 0);
    const fov = this.baseFov + C('fov');
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }

    // gloves + forearms entering from the bottom corners
    const G = (k) => this.g.get(k);
    const bob = Math.sin(t * 5.2) * 0.008;
    for (const side of ['L', 'R']) {
      const k = side === 'L' ? 'l' : 'r';
      const s = side === 'L' ? -1 : 1;
      const { grp, arm } = this.gloves[side];
      grp.position.set(G(k + 'x'), G(k + 'y') + bob * s, G(k + 'z'));
      // glove flattens against the face and holds it through the hit-stop
      const q = this.squash[side];
      grp.scale.set(1 + q * 0.22, 1 + q * 0.22, 1 - q * 0.32);
      this.squash[side] = Math.max(0, q - dt * 9);
      this._a.set(s * 0.42, -0.72, 0.05);
      this._b.set(0, -0.02, 0.1).add(grp.position);
      placeSegment(arm, this._a, this._b, 0.06);
      // cuff (+z) faces the forearm base, knuckles point away from it
      this.camera.updateMatrixWorld();
      grp.lookAt(this._a.set(s * 0.42, -0.72, 0.05).applyMatrix4(this.camera.matrixWorld));
      grp.rotateZ(G(k + 'r'));
    }
    this.gloveMat.emissive.setRGB(1, 0.35, 0.1).multiplyScalar(this.charge * (0.8 + 0.2 * Math.sin(t * 30)));
  }
}
