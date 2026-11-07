import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import * as TX from './textures.js';
import { BODIES, MOON, SUN, AU_KM, LIGHT_KMS } from './data.js';

const $ = (s) => document.querySelector(s);
const DEG = Math.PI / 180;
const ROT_SCALE = 0.08; // slow down planet spin so it's pleasant to watch
const START_DATE = new Date();

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
$('#app').appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(innerWidth, innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'absolute', top: '0', left: '0', pointerEvents: 'none' });
$('#app').appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 20000);
scene.add(camera);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.9, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enabled = false;
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxDistance = 2500;

scene.add(new THREE.AmbientLight(0xffffff, 0.035));
const sunLight = new THREE.PointLight(0xfff4e0, 3.3, 0, 0);
scene.add(sunLight);

// ---------------------------------------------------------------- state
const state = {
  mode: 'mars',
  timeScale: 1,
  simDays: 0,
  fov: 45,
  yaw: 0,
  pitch: 0,
  focus: null,
  transition: null,
  lastFocusPos: new THREE.Vector3(),
  scanned: new Set(),
  scanProgress: 0,
  scanTarget: null,
};
const bodies = {}; // id -> body record
const keys = new Set();

// ---------------------------------------------------------------- shaders
const atmoVS = /* glsl */ `
  varying vec3 vNormalV; varying vec3 vNormalW; varying vec3 vPosW;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPosW = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;
const atmoFS = /* glsl */ `
  uniform vec3 uColor; uniform float uIntensity; uniform float uEdge;
  varying vec3 vNormalV; varying vec3 vNormalW; varying vec3 vPosW;
  void main() {
    float i = pow(smoothstep(0.0, uEdge, -vNormalV.z), 2.2);
    vec3 L = normalize(-vPosW);           // Sun is at the origin
    float sunF = smoothstep(-0.45, 0.6, dot(vNormalW, L));
    gl_FragColor = vec4(uColor * i * sunF * uIntensity, 1.0);
  }`;

function atmosphere(r, color, scale = 1.12, intensity = 1.4) {
  // visible "rim" band on back faces is between planet edge and atmo edge
  const edge = Math.sqrt(1 - 1 / (scale * scale));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: intensity }, uEdge: { value: edge } },
    vertexShader: atmoVS, fragmentShader: atmoFS,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(r * scale, 64, 48), mat);
}

function earthMaterial(t) {
  return new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: t.day }, nightMap: { value: t.night }, specMap: { value: t.spec },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D dayMap, nightMap, specMap;
      varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
      void main() {
        vec3 N = normalize(vN);
        vec3 L = normalize(-vPos);
        vec3 V = normalize(cameraPosition - vPos);
        float ndl = dot(N, L);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 night = texture2D(nightMap, vUv).rgb;
        float spec = texture2D(specMap, vUv).r;
        float dayF = smoothstep(-0.12, 0.22, ndl);
        vec3 col = day * max(ndl, 0.0) * 1.25 + day * 0.012;
        vec3 H = normalize(L + V);
        col += vec3(1.0, 0.92, 0.8) * pow(max(dot(N, H), 0.0), 60.0) * spec * smoothstep(0.0, 0.2, ndl) * 0.9;
        col += night * (1.0 - dayF) * 0.9;
        float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        col += vec3(0.25, 0.55, 1.0) * rim * dayF * 0.7;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

// ---------------------------------------------------------------- builders
function makeLabel(body) {
  const el = document.createElement('div');
  el.className = 'label';
  el.textContent = body.def.name;
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('click', (e) => { e.stopPropagation(); focusBody(body); });
  const obj = new CSS2DObject(el);
  obj.position.set(0, body.def.r * 1.15, 0);
  obj.center.set(0.5, 1);
  body.group.add(obj);
  body.label = obj;
}

function orbitLine(radius, color = 0x3a5a88, opacity = 0.35) {
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const a = (i / 256) * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(a) * radius, 0, -Math.sin(a) * radius));
  }
  const line = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(pts),
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
  return line;
}

const orbitLines = new THREE.Group();
scene.add(orbitLines);

function createBody(def, material, color) {
  const group = new THREE.Group();
  const tiltGroup = new THREE.Group();
  tiltGroup.rotation.z = def.tilt * DEG;
  group.add(tiltGroup);
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(def.r, 128, 96), material);
  tiltGroup.add(mesh);
  const body = { id: def.id, def, group, tiltGroup, mesh, color, spin: Math.random() * 6 };
  mesh.userData.body = body;
  makeLabel(body);
  bodies[def.id] = body;
  return body;
}

function stdMat(map, bump, bumpScale = 1) {
  return new THREE.MeshStandardMaterial({
    map, roughness: 1, metalness: 0, bumpMap: bump || null, bumpScale,
  });
}

function buildStars() {
  const make = (count, size, spread, opacityBoost) => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      let v = new THREE.Vector3().randomDirection();
      if (spread) {
        // concentrate some stars along a tilted "Milky Way" band
        v.y *= 0.12;
        v.normalize().applyAxisAngle(new THREE.Vector3(1, 0, 0.3).normalize(), 1.05);
      }
      v.multiplyScalar(6000 + Math.random() * 2000);
      pos.set([v.x, v.y, v.z], i * 3);
      const t = Math.random();
      c.setHSL(t < 0.2 ? 0.6 : t < 0.35 ? 0.08 : 0.12, t < 0.6 ? 0.25 : 0.6, (0.55 + Math.random() * 0.45) * opacityBoost);
      col.set([c.r, c.g, c.b], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({
      size, sizeAttenuation: false, vertexColors: true, depthWrite: false, transparent: true,
    }));
  };
  const stars = new THREE.Group();
  stars.add(make(9000, 1.2, false, 0.8));
  stars.add(make(900, 2.2, false, 1.0));
  stars.add(make(14000, 1.0, true, 0.6));
  scene.add(stars);
  return stars;
}

function buildAsteroids() {
  const count = 2600;
  const geo = new THREE.IcosahedronGeometry(0.35, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8a8178, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 168 + (Math.random() + Math.random() - 1) * 18;
    p.set(Math.cos(a) * r, (Math.random() - 0.5) * 5, -Math.sin(a) * r);
    q.setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6));
    const k = 0.3 + Math.random() ** 3 * 2.2;
    s.set(k, k * (0.6 + Math.random() * 0.6), k);
    mesh.setMatrixAt(i, m.compose(p, q, s));
  }
  scene.add(mesh);
  return mesh;
}

function buildShip() {
  const g = new THREE.Group();
  const hull = new THREE.MeshStandardMaterial({ color: 0xd9dee8, metalness: 0.55, roughness: 0.35, emissive: 0x1a2230 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xff6a3d, metalness: 0.3, roughness: 0.5, emissive: 0x301008 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.9, 16), hull);
  body.rotation.x = -Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 16), hull);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -0.6;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.025, 0.28), accent);
  wing.position.set(0, -0.02, 0.18);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.26, 0.24), accent);
  fin.position.set(0, 0.13, 0.3);
  const glass = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x66ccff, emissive: 0x1a6aa0, metalness: 0.2, roughness: 0.1 }),
  );
  glass.scale.set(1, 0.8, 1.8);
  glass.position.set(0, 0.07, -0.22);
  g.add(body, nose, wing, fin, glass);

  const glowTex = TX.toTexture(TX.glow(128, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(120,190,255,0.7)'], [1, 'rgba(40,90,255,0)']]));
  const flame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: new THREE.Color(1.0, 1.6, 2.8), blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  flame.position.z = 0.5;
  g.add(flame);
  const nav = (color, x) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    sp.position.set(x, -0.02, 0.2);
    sp.scale.setScalar(0.12);
    g.add(sp);
    return sp;
  };
  g.userData = { flame, navL: nav(new THREE.Color(4, 0.3, 0.3), -0.48), navR: nav(new THREE.Color(0.3, 4, 0.5), 0.48) };
  g.visible = false;
  scene.add(g);
  return g;
}

// ---------------------------------------------------------------- build world
const tick = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
let stars, asteroids, ship;
const shipVel = new THREE.Vector3();

async function build() {
  const steps = [
    ['Mặt Trời', async () => {
      const def = SUN;
      const map = TX.toTexture(TX.sun(1024));
      const mat = new THREE.MeshBasicMaterial({ map, color: new THREE.Color(2.2, 1.9, 1.5) });
      const b = createBody({ ...def, tilt: 7.25 }, mat, '#ffc24a');
      scene.add(b.group);
      const glowTex = TX.toTexture(TX.glow(256));
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: new THREE.Color(1.6, 1.3, 1.0), blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.scale.setScalar(def.r * 9);
      b.group.add(glow);
      const corona = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: new THREE.Color(0.35, 0.2, 0.08), blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      corona.scale.setScalar(def.r * 14);
      b.group.add(corona);
    }],
    ['Sao Thủy', async () => {
      const t = TX.mercury(1024);
      addPlanet('mercury', stdMat(TX.toTexture(t.map), TX.toTexture(t.bump, false), 1.5), '#a8a097');
    }],
    ['Sao Kim', async () => addPlanet('venus', stdMat(TX.toTexture(TX.venus(1024))), '#e5c58a')],
    ['Trái Đất', async () => {
      const t = TX.earth(2048);
      const tex = {
        day: TX.toTexture(t.day), night: TX.toTexture(t.night), spec: TX.toTexture(t.spec, false),
      };
      const b = addPlanet('earth', earthMaterial(tex), '#5aa0ff');
      const clouds = new THREE.Mesh(
        new THREE.SphereGeometry(b.def.r * 1.012, 128, 96),
        new THREE.MeshStandardMaterial({ map: TX.toTexture(t.clouds), transparent: true, depthWrite: false, roughness: 1 }),
      );
      b.tiltGroup.add(clouds);
      b.clouds = clouds;
    }],
    ['Mặt Trăng', async () => {
      const t = TX.moon(1024);
      const b = createBody(MOON, stdMat(TX.toTexture(t.map), TX.toTexture(t.bump, false), 1.2), '#c9c6bf');
      bodies.earth.group.add(b.group);
      const line = orbitLine(MOON.dist, 0x5577aa, 0.25);
      bodies.earth.group.add(line);
      b.orbitLine = line;
    }],
    ['Sao Hỏa', async () => {
      const t = TX.mars(2048);
      addPlanet('mars', stdMat(TX.toTexture(t.map), TX.toTexture(t.bump, false), 2), '#e0703f');
    }],
    ['Vành đai tiểu hành tinh', async () => { asteroids = buildAsteroids(); }],
    ['Sao Mộc', async () => addPlanet('jupiter', stdMat(TX.toTexture(TX.jupiter(1024))), '#d8b48a')],
    ['Sao Thổ', async () => {
      const b = addPlanet('saturn', stdMat(TX.toTexture(TX.saturn(1024))), '#e3cf9c');
      const inner = b.def.r * 1.25, outer = b.def.r * 2.3;
      const geo = new THREE.RingGeometry(inner, outer, 160, 1);
      const pos = geo.attributes.position, uv = geo.attributes.uv, v = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        uv.setXY(i, (v.length() - inner) / (outer - inner), 0.5);
      }
      const ring = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: TX.toTexture(TX.rings(1024)), side: THREE.DoubleSide, transparent: true, roughness: 1, depthWrite: false,
      }));
      ring.rotation.x = -Math.PI / 2;
      b.tiltGroup.add(ring);
    }],
    ['Sao Thiên Vương', async () => addPlanet('uranus', stdMat(TX.toTexture(TX.uranus(512))), '#9fe0e8')],
    ['Sao Hải Vương', async () => addPlanet('neptune', stdMat(TX.toTexture(TX.neptune(512))), '#5a84e6')],
    ['Bầu trời sao', async () => { stars = buildStars(); ship = buildShip(); }],
  ];
  for (let i = 0; i < steps.length; i++) {
    $('#loading-text').textContent = `Đang tạo ${steps[i][0]}…`;
    $('#loading-fill').style.width = `${(i / steps.length) * 100}%`;
    await tick();
    await steps[i][1]();
  }
  $('#loading-fill').style.width = '100%';
}

function addPlanet(id, material, color) {
  const def = BODIES.find((b) => b.id === id);
  const b = createBody(def, material, color);
  scene.add(b.group);
  if (def.atmo) {
    const scale = id === 'venus' ? 1.1 : id === 'earth' ? 1.07 : 1.06;
    const inten = id === 'mars' ? 0.6 : id === 'earth' ? 1.6 : 1.0;
    b.tiltGroup.add(atmosphere(def.r, def.atmo, scale, inten));
  }
  const line = orbitLine(def.dist);
  orbitLines.add(line);
  return b;
}

// ---------------------------------------------------------------- simulation
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3();

function updateBodies(dt) {
  const days = state.simDays;
  const spinRate = Math.min(state.timeScale, 5);
  for (const def of BODIES) {
    const b = bodies[def.id];
    const a = def.a0 * DEG + (days / def.period) * Math.PI * 2;
    b.group.position.set(Math.cos(a) * def.dist, 0, -Math.sin(a) * def.dist);
    b.spin += dt * spinRate * (Math.PI * 2 / def.rot) * ROT_SCALE;
    b.mesh.rotation.y = b.spin;
  }
  const e = bodies.earth;
  e.clouds.rotation.y = e.spin * 1.04 + days * 0.002;
  // Moon: orbit Earth, tidally locked
  const m = bodies.moon;
  const ma = (days / MOON.period) * Math.PI * 2 + 2.2;
  m.group.position.set(Math.cos(ma) * MOON.dist, Math.sin(ma) * MOON.dist * 0.09, -Math.sin(ma) * MOON.dist);
  m.mesh.rotation.y = ma + Math.PI;
  bodies.sun.mesh.rotation.y += dt * 0.02;
  asteroids.rotation.y = (days / 1700) * Math.PI * 2;
}

function worldPos(b, out = new THREE.Vector3()) {
  return b.group.getWorldPosition(out);
}

// Real-scale (circular orbit) position in AU, used for distance readouts.
function realPosAU(id) {
  const def = BODIES.find((b) => b.id === id);
  const a = def.a0 * DEG + (state.simDays / def.period) * Math.PI * 2;
  return new THREE.Vector2(Math.cos(a) * def.au, Math.sin(a) * def.au);
}
function realDistKm(idA, idB) {
  const toAU = (id) => (id === 'sun' ? new THREE.Vector2() : id === 'moon' ? realPosAU('earth') : realPosAU(id));
  if ((idA === 'moon' && idB === 'earth') || (idA === 'earth' && idB === 'moon')) return 384400;
  return toAU(idA).distanceTo(toAU(idB)) * AU_KM;
}
const fmtKm = (km) =>
  km > 1e9 ? `${(km / 1e9).toFixed(2)} tỷ km` : km > 1e6 ? `${(km / 1e6).toFixed(1)} triệu km` : `${Math.round(km).toLocaleString('vi-VN')} km`;
const fmtLight = (km) => {
  const s = km / LIGHT_KMS;
  return s < 60 ? `${s.toFixed(1)} giây` : s < 3600 ? `${(s / 60).toFixed(1)} phút` : `${(s / 3600).toFixed(1)} giờ`;
};

// ---------------------------------------------------------------- camera modes
const up = new THREE.Vector3(0, 1, 0);
const marsOffsetLocal = new THREE.Vector3(-0.42, -0.6, 1).normalize();

function updateMarsCam() {
  const mars = worldPos(bodies.mars, tmp);
  const earth = worldPos(bodies.earth, tmp2);
  const dir = tmp3.copy(earth).sub(mars).normalize();
  const right = new THREE.Vector3().crossVectors(dir, up).normalize();
  const up2 = new THREE.Vector3().crossVectors(right, dir);
  const D = bodies.mars.def.r * 2.7;
  const off = new THREE.Vector3()
    .addScaledVector(right, marsOffsetLocal.x)
    .addScaledVector(up2, marsOffsetLocal.y)
    .addScaledVector(dir, marsOffsetLocal.z)
    .multiplyScalar(D);
  camera.position.copy(mars).sub(off);
  camera.up.copy(up);
  camera.lookAt(earth);
  camera.rotateY(state.yaw);
  camera.rotateX(state.pitch);
  setFov(state.fov);
}

function setFov(f) {
  if (Math.abs(camera.fov - f) > 1e-3) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function focusBody(b) {
  if (state.mode !== 'orbit') setMode('orbit', false);
  state.focus = b;
  const p = worldPos(b);
  const dist = b.def.r * (b.id === 'saturn' ? 5.5 : b.id === 'sun' ? 4 : 5);
  const dir = camera.position.clone().sub(p);
  if (dir.lengthSq() < 1e-6) dir.set(0, 0.3, 1);
  dir.normalize();
  dir.y = Math.max(dir.y, 0.15);
  dir.normalize();
  const lookPoint = camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(dist));
  state.transition = { t: 0, fromPos: camera.position.clone(), fromTarget: lookPoint, offset: dir.multiplyScalar(dist) };
  controls.enabled = false;
  controls.minDistance = b.def.r * 1.4;
  refreshBodyList();
}

function updateOrbitCam(dt) {
  if (!state.focus) focusBody(bodies.earth);
  const p = worldPos(state.focus, tmp);
  setFov(45);
  const tr = state.transition;
  if (tr) {
    tr.t = Math.min(1, tr.t + dt / 1.6);
    const e = ease(tr.t);
    camera.position.lerpVectors(tr.fromPos, tmp2.copy(p).add(tr.offset), e);
    controls.target.lerpVectors(tr.fromTarget, p, e);
    camera.up.copy(up);
    camera.lookAt(controls.target);
    if (tr.t >= 1) {
      state.transition = null;
      controls.enabled = true;
    }
  } else {
    camera.position.add(tmp2.copy(p).sub(state.lastFocusPos));
    controls.target.copy(p);
    controls.update();
  }
  state.lastFocusPos.copy(p);
}

function resetShip() {
  const mars = worldPos(bodies.mars, new THREE.Vector3());
  const earth = worldPos(bodies.earth, new THREE.Vector3());
  const dir = earth.clone().sub(mars).normalize();
  ship.position.copy(mars).addScaledVector(dir, bodies.mars.def.r * 3).add(new THREE.Vector3(0, 1, 0));
  const m = new THREE.Matrix4().lookAt(ship.position, earth, up);
  ship.quaternion.setFromRotationMatrix(m);
  shipVel.set(0, 0, 0);
  camera.position.copy(ship.localToWorld(new THREE.Vector3(0, 0.85, 3.8)));
  camera.quaternion.copy(ship.quaternion);
}

const SCANNABLE = [...BODIES.map((b) => b.id), 'moon'];

function updateShip(dt) {
  const k = (c) => (keys.has(c) ? 1 : 0);
  const boost = keys.has('ShiftLeft') || keys.has('ShiftRight');
  // rotation (arrows / Q E)
  const rs = 1.4 * dt;
  ship.rotateY((k('ArrowLeft') - k('ArrowRight')) * rs);
  ship.rotateX((k('ArrowUp') - k('ArrowDown')) * rs);
  ship.rotateZ((k('KeyQ') - k('KeyE')) * rs * 1.4);

  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(ship.quaternion);
  const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(ship.quaternion);
  const thrust = k('KeyW') - k('KeyS');
  const acc = (boost ? 70 : 14) * dt;
  shipVel.addScaledVector(fwd, thrust * acc);
  shipVel.addScaledVector(right, (k('KeyD') - k('KeyA')) * acc * 0.6);
  shipVel.addScaledVector(upv, (k('KeyR') - k('KeyF')) * acc * 0.6);
  shipVel.multiplyScalar(Math.exp(-dt * (keys.has('KeyX') ? 3 : 0.5)));
  const max = boost ? 90 : 18;
  if (shipVel.length() > max) shipVel.setLength(THREE.MathUtils.lerp(shipVel.length(), max, 1 - Math.exp(-dt * 3)));
  ship.position.addScaledVector(shipVel, dt);

  // collisions + sun heat
  let warn = '';
  for (const b of Object.values(bodies)) {
    const p = worldPos(b, tmp);
    const minD = b.def.r * (b.id === 'sun' ? 1.4 : 1.08) + 0.4;
    const d = ship.position.distanceTo(p);
    if (b.id === 'sun' && d < b.def.r * 2.6) warn = 'CẢNH BÁO: NHIỆT ĐỘ QUÁ CAO';
    if (d < minD) {
      const n = tmp2.copy(ship.position).sub(p).normalize();
      ship.position.copy(p).addScaledVector(n, minD);
      const vn = shipVel.dot(n);
      if (vn < 0) shipVel.addScaledVector(n, -vn * 1.4);
    }
  }
  $('#warn').textContent = warn;

  // visuals
  const f = ship.userData.flame;
  const thrustVis = Math.max(thrust, 0) * (boost ? 1.8 : 1);
  f.scale.setScalar(0.12 + thrustVis * 0.16 + Math.random() * 0.03 * thrustVis);
  const blink = Math.sin(performance.now() / 180) > 0.6 ? 0.14 : 0.05;
  ship.userData.navL.scale.setScalar(blink);
  ship.userData.navR.scale.setScalar(blink);

  // chase camera
  const target = ship.localToWorld(tmp.set(0, 0.85, 3.8));
  camera.position.copy(target);
  camera.quaternion.slerp(ship.quaternion, 1 - Math.exp(-dt * 7));
  const speed = shipVel.length();
  setFov(THREE.MathUtils.lerp(camera.fov, 50 + Math.min(speed / 90, 1) * 22, 1 - Math.exp(-dt * 3)));

  updateScan(dt);
}

function updateScan(dt) {
  let best = null, bestD = Infinity;
  for (const id of SCANNABLE) {
    if (state.scanned.has(id)) continue;
    const b = bodies[id];
    const d = ship.position.distanceTo(worldPos(b, tmp)) - b.def.r;
    const range = b.def.r * 2.5 + 7;
    if (d < range && d < bestD) { best = b; bestD = d; }
  }
  const el = $('#scan');
  if (best !== state.scanTarget) { state.scanTarget = best; state.scanProgress = 0; }
  if (!best) { el.style.opacity = 0; return; }
  el.style.opacity = 1;
  if (keys.has('Space')) {
    state.scanProgress += dt / 1.8;
    $('#scan-text').textContent = `Đang quét ${best.def.name}…`;
    if (state.scanProgress >= 1) {
      state.scanned.add(best.id);
      best.label.element.classList.add('scanned');
      const n = state.scanned.size;
      toast(`<b>Đã quét ${best.def.name}!</b> (${n}/${SCANNABLE.length})<br>${best.def.fact}`);
      if (n === SCANNABLE.length) setTimeout(() => toast('<b>NHIỆM VỤ HOÀN THÀNH!</b><br>Bạn đã khảo sát toàn bộ hệ Mặt Trời.', 6000), 3200);
      refreshBodyList();
      state.scanTarget = null;
    }
  } else {
    state.scanProgress = Math.max(0, state.scanProgress - dt);
    $('#scan-text').innerHTML = `Trong tầm quét <b>${best.def.name}</b> — giữ <kbd>Space</kbd> để quét`;
  }
  $('#scan-fill').style.width = `${state.scanProgress * 100}%`;
}

function setMode(mode, autoFocus = true) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  controls.enabled = false;
  ship.visible = mode === 'ship';
  $('#ship-hud').classList.toggle('hidden', mode !== 'ship');
  bodies.mars.label.visible = mode !== 'mars';
  if (mode === 'ship') resetShip();
  if (mode === 'mars') { state.yaw = 0; state.pitch = 0; state.focus = null; }
  if (mode === 'orbit' && autoFocus) focusBody(state.focus || bodies.earth);
  if (mode !== 'orbit') state.focus = null;
  renderHelp();
  refreshBodyList();
}

// ---------------------------------------------------------------- UI
let toastTimer;
function toast(html, ms = 4500) {
  const el = $('#toast');
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function renderHelp() {
  const h = {
    mars: '<b>Kéo chuột</b> nhìn quanh · <b>Cuộn</b> zoom kính viễn vọng · <b>Nhấp</b> hành tinh để bay tới · <kbd>L</kbd> nhãn · <kbd>O</kbd> quỹ đạo',
    ship: '<kbd>W</kbd><kbd>S</kbd> đẩy · <kbd>A</kbd><kbd>D</kbd> trượt ngang · <kbd>R</kbd><kbd>F</kbd> lên/xuống · <b>Kéo chuột</b>/<kbd>←↑↓→</kbd> lái · <kbd>Q</kbd><kbd>E</kbd> lăn · <kbd>Shift</kbd> tăng tốc · <kbd>X</kbd> phanh · <kbd>Space</kbd> quét',
    orbit: '<b>Kéo</b> xoay · <b>Cuộn</b> zoom · <b>Chuột phải</b> dịch · <b>Nhấp</b> hành tinh/nhãn để chuyển · <kbd>L</kbd> nhãn · <kbd>O</kbd> quỹ đạo',
  };
  $('#help').innerHTML = h[state.mode];
}

const LIST = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'];
function refreshBodyList() {
  const ul = $('#body-list');
  ul.innerHTML = '';
  for (const id of LIST) {
    const b = bodies[id];
    const li = document.createElement('li');
    if (state.focus === b) li.className = 'focused';
    const scannable = SCANNABLE.includes(id);
    li.innerHTML = `<span><span class="dot" style="background:${b.color}"></span>${b.def.name}</span>` +
      (scannable ? `<span class="check ${state.scanned.has(id) ? '' : 'pending'}">${state.scanned.has(id) ? '✓' : '○'}</span>` : '');
    li.onclick = () => focusBody(b);
    ul.appendChild(li);
  }
  $('#mission-count').textContent = `· quét ${state.scanned.size}/${SCANNABLE.length}`;
}

let infoAcc = 0;
function updateInfo(dt) {
  infoAcc += dt;
  if (infoAcc < 0.2) return;
  infoAcc = 0;
  const d = new Date(START_DATE.getTime() + state.simDays * 86400000);
  $('#date').textContent = d.toLocaleDateString('vi-VN');
  const row = (k, v) => `<div class="row"><span>${k}</span><span>${v}</span></div>`;
  let html = '';
  if (state.mode === 'mars') {
    const km = realDistKm('mars', 'earth');
    html = `<h3>Nhìn từ quỹ đạo Sao Hỏa</h3><div class="fact">Chấm xanh ở giữa là Trái Đất — mọi người bạn từng biết đều ở đó.</div>` +
      row('Khoảng cách tới Trái Đất', fmtKm(km)) +
      row('Ánh sáng đi mất', fmtLight(km)) +
      row('Khoảng cách tới Mặt Trời', fmtKm(realDistKm('mars', 'sun'))) +
      row('Zoom kính viễn vọng', `${(45 / state.fov).toFixed(1)}×`);
  } else if (state.mode === 'orbit' && state.focus) {
    const b = state.focus;
    html = `<h3>${b.def.name}</h3><div class="fact">${b.def.fact}</div>`;
    if (b.id !== 'earth') {
      const km = realDistKm(b.id, 'earth');
      html += row('Cách Trái Đất', fmtKm(km)) + row('Ánh sáng đi mất', fmtLight(km));
    }
    if (b.def.period) html += row(b.id === 'moon' ? 'Quay quanh Trái Đất' : 'Một năm', `${b.def.period.toLocaleString('vi-VN')} ngày`);
    if (b.def.rot) html += row('Một ngày', `${Math.abs(b.def.rot * 24).toFixed(1)} giờ${b.def.rot < 0 ? ' (ngược)' : ''}`);
    if (SCANNABLE.includes(b.id)) html += row('Trạng thái quét', state.scanned.has(b.id) ? '✓ Đã quét' : 'Chưa quét');
  } else if (state.mode === 'ship') {
    const speed = shipVel.length();
    let near = null, nd = Infinity;
    for (const b of Object.values(bodies)) {
      const dd = ship.position.distanceTo(worldPos(b, tmp)) - b.def.r;
      if (dd < nd) { nd = dd; near = b; }
    }
    html = `<h3>Tàu thám hiểm</h3><div class="fact">Bay lại gần từng thiên thể và giữ Space để quét. Hoàn thành ${SCANNABLE.length} lượt quét!</div>` +
      row('Tốc độ', `${(speed * 4.99).toFixed(1)} c`) +
      row('Gần nhất', `${near.def.name} · ${nd.toFixed(1)} đv`) +
      row('Đã quét', `${state.scanned.size}/${SCANNABLE.length}`);
  }
  $('#info').innerHTML = html;
}

// ---------------------------------------------------------------- input
const raycaster = new THREE.Raycaster();
let drag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY };
});
addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.x = e.clientX; drag.y = e.clientY;
  if (state.mode === 'mars') {
    const s = 0.0035 * (state.fov / 45);
    state.yaw -= dx * s;
    state.pitch = THREE.MathUtils.clamp(state.pitch - dy * s, -1.3, 1.3);
  } else if (state.mode === 'ship') {
    ship.rotateY(-dx * 0.004);
    ship.rotateX(-dy * 0.004);
  }
});
addEventListener('pointerup', (e) => {
  if (drag && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4 && state.mode !== 'ship') {
    const ndc = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects(Object.values(bodies).map((b) => b.mesh))[0];
    if (hit) focusBody(hit.object.userData.body);
  }
  drag = null;
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (state.mode !== 'mars') return;
  e.preventDefault();
  state.fov = THREE.MathUtils.clamp(state.fov * Math.exp(e.deltaY * 0.0012), 3, 70);
}, { passive: false });
renderer.domElement.addEventListener('dblclick', () => {
  if (state.mode === 'mars') { state.yaw = 0; state.pitch = 0; state.fov = 45; }
});

addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (state.mode === 'ship' && e.code === 'Space') e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Digit1') setMode('mars');
  if (e.code === 'Digit2') setMode('ship');
  if (e.code === 'Digit3') setMode('orbit');
  if (e.code === 'KeyL') document.body.classList.toggle('labels-off');
  if (e.code === 'KeyO') {
    orbitLines.visible = !orbitLines.visible;
    bodies.moon.orbitLine.visible = orbitLines.visible;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => { setMode(b.dataset.mode); b.blur(); }));
document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => {
  state.timeScale = Number(b.dataset.speed);
  document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('active', x === b));
  b.blur();
}));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  labelRenderer.setSize(innerWidth, innerHeight);
});

// Hide a label when its body is behind another (nearer) body from the camera.
const _lp = new THREE.Vector3(), _bp = new THREE.Vector3(), _ray = new THREE.Ray();
function occludeLabels() {
  const all = Object.values(bodies);
  for (const b of all) {
    if (state.mode === 'mars' && b.id === 'mars') continue;
    worldPos(b, _lp);
    const d = camera.position.distanceTo(_lp);
    _ray.origin.copy(camera.position);
    _ray.direction.copy(_lp).sub(camera.position).normalize();
    let hidden = false;
    for (const o of all) {
      if (o === b) continue;
      worldPos(o, _bp);
      if (camera.position.distanceTo(_bp) >= d) continue;
      if (_ray.distanceSqToPoint(_bp) < o.def.r * o.def.r) { hidden = true; break; }
    }
    b.label.visible = !hidden;
  }
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  state.simDays += dt * state.timeScale;
  updateBodies(dt);
  if (state.mode === 'mars') updateMarsCam();
  else if (state.mode === 'orbit') updateOrbitCam(dt);
  else updateShip(dt);
  stars.position.copy(camera.position);
  occludeLabels();
  updateInfo(dt);
  composer.render();
  labelRenderer.render(scene, camera);
  requestAnimationFrame(frame);
}

await build();
setMode('mars');
updateBodies(0);
updateMarsCam();
$('#hud').classList.remove('hidden');
$('#loading').classList.add('done');
toast('Bạn đang ở quỹ đạo Sao Hỏa. <b>Cuộn chuột</b> để zoom kính viễn vọng về Trái Đất.', 6000);
clock.getDelta();
frame();
