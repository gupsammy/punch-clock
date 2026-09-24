import * as THREE from 'three';

// Shared look for every character: 4-band toon shading (cool shadows, warm light), a fresnel rim
// in the floor's neon colour, and an inverted-hull ink outline.

let gradientMap = null;
function getGradient() {
  if (gradientMap) return gradientMap;
  const data = new Uint8Array([
    62, 58, 86, 255,
    128, 122, 150, 255,
    206, 200, 204, 255,
    255, 247, 228, 255,
  ]);
  gradientMap = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

// One rim colour for the whole cast so a theme change recolours everyone.
export const rimUniforms = {
  rimColor: { value: new THREE.Color('#ff2e88') },
  rimColor2: { value: new THREE.Color('#22e5ff') },
  rimStrength: { value: 0.4 },
};

export function setRim(a, b) {
  rimUniforms.rimColor.value.set(a);
  rimUniforms.rimColor2.value.set(b);
}

const RAMP_RGB = THREE.ShaderChunk.gradientmap_pars_fragment.replace('texture2D( gradientMap, coord ).r', 'texture2D( gradientMap, coord ).rgb');

// flashUniform lets a fighter blink white on hit without touching colours.
export function toonMat(color, { map = null, transparent = false, flash = null, emissive = 0x000000 } = {}) {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: getGradient(), map, transparent, emissive });
  const flashU = flash || { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.rimColor = rimUniforms.rimColor;
    shader.uniforms.rimColor2 = rimUniforms.rimColor2;
    shader.uniforms.rimStrength = rimUniforms.rimStrength;
    shader.uniforms.flash = flashU;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWN;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      // three reads only the ramp's red channel; read all three so the bands carry their tint
      .replace('#include <gradientmap_pars_fragment>', RAMP_RGB)
      .replace('#include <common>', `#include <common>
uniform vec3 rimColor; uniform vec3 rimColor2; uniform float rimStrength; uniform float flash; varying vec3 vWN;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  vec3 vdir = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(normalize(normal), vdir), 0.0, 1.0), 3.4);
  // Left side of the world gets colour A, right side colour B, like two rim lights.
  vec3 rc = mix(rimColor, rimColor2, smoothstep(-0.4, 0.4, vWN.x));
  totalEmissiveRadiance += rc * fres * rimStrength;
  totalEmissiveRadiance += vec3(flash);
}`);
  };
  m.customProgramCacheKey = () => 'toonrim';
  return m;
}

const outlineMats = new Map();
export function outlineMat(thickness = 0.012, color = 0x07030b) {
  const key = thickness + ':' + color;
  if (outlineMats.has(key)) return outlineMats.get(key);
  const m = new THREE.ShaderMaterial({
    uniforms: { thickness: { value: thickness }, color: { value: new THREE.Color(color) } },
    vertexShader: `uniform float thickness;
void main(){
  // Extrude in view space so the line keeps its width under non-uniform scale.
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  mv.xyz += n * thickness;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 color; void main(){ gl_FragColor = vec4(color, 1.0); }`,
    side: THREE.BackSide,
  });
  outlineMats.set(key, m);
  return m;
}

// The hull extrudes along normals, so a hard edge (box corner, cylinder cap) splits it open.
// Its copy of the shape averages the normals of every vertex at the same spot, which closes the ink.
const hullGeos = new WeakMap();
function hullGeo(geo) {
  let h = hullGeos.get(geo);
  if (h) return h;
  h = geo.clone();
  const pos = h.attributes.position, nrm = h.attributes.normal;
  const sum = new Map(), key = (i) => `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
  for (let i = 0; i < pos.count; i++) {
    const k = key(i), v = sum.get(k) || [0, 0, 0];
    v[0] += nrm.getX(i); v[1] += nrm.getY(i); v[2] += nrm.getZ(i);
    sum.set(k, v);
  }
  for (let i = 0; i < pos.count; i++) {
    const [x, y, z] = sum.get(key(i)), l = Math.hypot(x, y, z) || 1;
    nrm.setXYZ(i, x / l, y / l, z / l);
  }
  h.userData.shared = !!geo.userData.shared;
  hullGeos.set(geo, h);
  return h;
}

// Mesh + outline hull as one object.
export function inked(geo, mat, thickness = 0.012) {
  const mesh = new THREE.Mesh(geo, mat);
  if (thickness > 0) {
    const hull = new THREE.Mesh(hullGeo(geo), outlineMat(thickness));
    hull.raycast = () => {};
    mesh.add(hull);
  }
  return mesh;
}

// Shared unit geometries; meshes scale them.
export const GEO = {
  sphere: new THREE.SphereGeometry(1, 28, 20),
  sphereLo: new THREE.SphereGeometry(1, 14, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 16, 1),
  cylTaper: new THREE.CylinderGeometry(0.8, 1, 1, 16, 1),
  box: new THREE.BoxGeometry(1, 1, 1),
  torus: new THREE.TorusGeometry(1, 0.12, 8, 24),
};

for (const g of Object.values(GEO)) g.userData.shared = true;

// A limb segment thicker at one end. Radii are relative (the larger is 1) so floor contact can treat
// it as a unit cylinder; placeSegment's radius is the thick end. +y (the top) is placeSegment's `b`.
const tapers = new Map();
export function taperGeo(r0, r1) {
  const m = Math.max(r0, r1), k = `${(r0 / m).toFixed(2)}:${(r1 / m).toFixed(2)}`;
  if (!tapers.has(k)) {
    const g = new THREE.CylinderGeometry(r1 / m, r0 / m, 1, 16, 1);
    g.userData.shared = true;
    g.userData.unit = 'cyl';
    tapers.set(k, g);
  }
  return tapers.get(k);
}

// A torso from a radius profile, bottom to top, fitted inside a unit cylinder (radius 1, y -0.5..0.5).
export function latheGeo(radii) {
  const m = Math.max(...radii), n = radii.length;
  const ctrl = radii.map((r, i) => new THREE.Vector2(r / m, -0.49 + (0.98 * i) / (n - 1)));
  const pts = [new THREE.Vector2(0, -0.5), ...new THREE.SplineCurve(ctrl).getPoints(22), new THREE.Vector2(0, 0.5)];
  for (const p of pts) p.x = Math.min(1, Math.max(0, p.x));
  const g = new THREE.LatheGeometry(pts, 28);
  g.computeVertexNormals();
  return g;
}

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
// Stretch a unit Y-aligned cylinder between two points.
export function placeSegment(mesh, a, b, radius) {
  _dir.subVectors(b, a);
  const len = _dir.length() || 1e-4;
  mesh.position.addVectors(a, b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(_up, _dir.multiplyScalar(1 / len));
  mesh.scale.set(radius, len, radius);
}
