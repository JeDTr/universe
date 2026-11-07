// Procedural planet textures, generated on <canvas> by sampling 3D Perlin noise
// on the sphere surface (so there is no seam at the texture wrap).
import * as THREE from 'three';

// ---------- Perlin noise ----------
const P = new Uint8Array(512);
(() => {
  const p = [];
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = 1337;
  for (let i = 255; i > 0; i--) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) P[i] = p[i & 255];
})();

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
function grad(h, x, y, z) {
  h &= 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return (h & 1 ? -u : u) + (h & 2 ? -v : v);
}
export function noise(x, y, z) {
  let X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
  x -= X; y -= Y; z -= Z;
  X &= 255; Y &= 255; Z &= 255;
  const u = fade(x), v = fade(y), w = fade(z);
  const A = P[X] + Y, AA = P[A] + Z, AB = P[A + 1] + Z;
  const B = P[X + 1] + Y, BA = P[B] + Z, BB = P[B + 1] + Z;
  return lerp(
    lerp(lerp(grad(P[AA], x, y, z), grad(P[BA], x - 1, y, z), u),
         lerp(grad(P[AB], x, y - 1, z), grad(P[BB], x - 1, y - 1, z), u), v),
    lerp(lerp(grad(P[AA + 1], x, y, z - 1), grad(P[BA + 1], x - 1, y, z - 1), u),
         lerp(grad(P[AB + 1], x, y - 1, z - 1), grad(P[BB + 1], x - 1, y - 1, z - 1), u), v),
    w);
}
export function fbm(x, y, z, oct = 5) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) {
    s += a * noise(x * f, y * f, z * f);
    n += a; a *= 0.5; f *= 2.03;
  }
  return s / n;
}

// ---------- helpers ----------
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  return { c, ctx, img, d: img.data, flush() { ctx.putImageData(img, 0, 0); return c; } };
}

// Calls fn(x, y, z, lat, lon, idx) for every texel, with (x,y,z) on the unit sphere
// matching THREE.SphereGeometry's UV layout.
function forSphere(w, h, fn) {
  const cosLon = new Float32Array(w), sinLon = new Float32Array(w), lons = new Float32Array(w);
  for (let i = 0; i < w; i++) {
    const lon = ((i + 0.5) / w) * Math.PI * 2;
    lons[i] = lon; cosLon[i] = Math.cos(lon); sinLon[i] = Math.sin(lon);
  }
  for (let j = 0; j < h; j++) {
    const lat = Math.PI / 2 - ((j + 0.5) / h) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i < w; i++) {
      fn(-cosLon[i] * cl, sl, sinLon[i] * cl, lat, lons[i], (j * w + i) * 4);
    }
  }
}

function put(d, idx, r, g, b, a = 255) {
  d[idx] = r; d[idx + 1] = g; d[idx + 2] = b; d[idx + 3] = a;
}

function mix3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}
function sample(stops, t) {
  t = clamp(t) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2);
  return mix3(stops[i], stops[i + 1], t - i);
}

export function toTexture(c, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

// ---------- Earth ----------
export function earth(w = 2048) {
  const h = w / 2;
  const day = canvas(w, h), night = canvas(w, h), spec = canvas(w, h), clouds = canvas(w, h);
  const SEA = 0.035;
  forSphere(w, h, (x, y, z, lat, lon, idx) => {
    const wq = fbm(x * 1.4 + 3.1, y * 1.4, z * 1.4, 3) * 0.7;
    const n = fbm(x * 1.25 + wq + 11, y * 1.25 + wq, z * 1.25 - wq, 7);
    const alat = Math.abs(lat);
    let c, s = 0, L = 0;
    if (n < SEA) {
      const t = clamp((n + 0.3) / (SEA + 0.3));
      c = mix3([3, 14, 46], [18, 70, 125], t * t * t);
      s = 1;
    } else {
      const hgt = n - SEA;
      const det = fbm(x * 14, y * 14, z * 14, 3) * 0.5 + 0.5;
      const moist = fbm(x * 2.4 + 40, y * 2.4, z * 2.4, 4) - (Math.abs(alat - 0.42) < 0.2 ? 0.14 : 0) + (alat > 0.8 ? 0.1 : 0);
      const forest = mix3([28, 62, 26], [86, 104, 52], det);
      const desert = mix3([170, 136, 88], [214, 184, 132], det);
      c = mix3(desert, forest, smooth(-0.12, 0.02, moist));
      if (hgt > 0.12) c = mix3(c, [112, 98, 84], smooth(0.12, 0.22, hgt));
      if (hgt > 0.24) c = mix3(c, [230, 232, 236], smooth(0.24, 0.3, hgt));
      if (alat > 0.95) c = mix3(c, [120, 116, 100], smooth(0.95, 1.15, alat));
      // city lights
      const region = fbm(x * 6 + 5, y * 6, z * 6, 3);
      if (alat < 1.1 && region > 0.02 && hgt < 0.2) {
        const spot = noise(x * 170, y * 170, z * 170) + noise(x * 41, y * 41, z * 41) * 0.5;
        L = clamp((spot - 0.28) * 4) * smooth(0.03, 0.2, region) * 0.8 + smooth(0.12, 0.35, region) * 0.12 * det;
      }
    }
    const ice = 1.2 + fbm(x * 4, y * 4 + 7, z * 4, 3) * 0.3;
    if (alat > ice) { c = [234, 240, 246]; s = 0.1; L = 0; }
    put(day.d, idx, c[0], c[1], c[2]);
    put(spec.d, idx, s * 255, s * 255, s * 255);
    put(night.d, idx, 255 * L, 190 * L, 110 * L);

    const cw = fbm(x * 1.8 + 50, y * 1.8, z * 1.8, 3) * 1.6;
    const cn = fbm(x * 2.2 + 100 + cw, y * 4.2 + cw, z * 2.2 - cw, 6);
    const a = smooth(0.0, 0.32, cn + 0.04 * Math.cos(lat * 6));
    put(clouds.d, idx, 255, 255, 255, a * 245);
  });
  return { day: day.flush(), night: night.flush(), spec: spec.flush(), clouds: clouds.flush() };
}

// ---------- Rocky bodies ----------
function rocky(w, { base1, base2, dark, darkAmt = 0, caps = null, craters = 0.5, seed = 0 }) {
  const h = w / 2;
  const col = canvas(w, h), bump = canvas(w, h);
  forSphere(w, h, (x, y, z, lat, lon, idx) => {
    x += seed;
    const wq = fbm(x * 2 + 9, y * 2, z * 2, 3) * 0.6;
    const n = fbm(x * 1.8 + wq, y * 1.8 + wq, z * 1.8, 5);
    const det = fbm(x * 9, y * 9, z * 9, 4) * 0.5 + 0.5;
    const cr = 1 - Math.abs(noise(x * 22, y * 22, z * 22));
    const cr2 = 1 - Math.abs(noise(x * 55 + 3, y * 55, z * 55));
    const crater = (Math.pow(cr, 12) * 0.7 + Math.pow(cr2, 16) * 0.5) * craters;
    let c = mix3(base1, base2, det);
    const dk = smooth(0.03, 0.16, n) * darkAmt;
    c = mix3(c, dark, dk);
    c = c.map((v) => v * (1 + crater * 0.35));
    if (caps) {
      const edge = caps + fbm(x * 5, y * 5, z * 5, 3) * 0.12;
      if (Math.abs(lat) > edge) c = mix3(c, [236, 228, 220], smooth(edge, edge + 0.04, Math.abs(lat)));
    }
    put(col.d, idx, clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255));
    const b = clamp(0.5 + n * 0.6 + det * 0.25 + crater * 0.4 - dk * 0.2) * 255;
    put(bump.d, idx, b, b, b);
  });
  return { map: col.flush(), bump: bump.flush() };
}

export const mars = (w = 2048) =>
  rocky(w, { base1: [168, 78, 40], base2: [212, 124, 72], dark: [92, 48, 32], darkAmt: 0.85, caps: 1.32, craters: 0.35 });
export const moon = (w = 1024) =>
  rocky(w, { base1: [128, 126, 122], base2: [190, 188, 182], dark: [70, 70, 72], darkAmt: 0.9, craters: 1, seed: 20 });
export const mercury = (w = 1024) =>
  rocky(w, { base1: [118, 106, 96], base2: [176, 164, 150], dark: [88, 80, 74], darkAmt: 0.4, craters: 1.2, seed: 40 });

// ---------- Venus ----------
export function venus(w = 1024) {
  const h = w / 2;
  const col = canvas(w, h);
  forSphere(w, h, (x, y, z, lat, lon, idx) => {
    const wq = fbm(x * 2 + 4, y * 2, z * 2, 4) * 2.2;
    const n = fbm(x * 1.5 + wq, y * 3.5 + wq, z * 1.5, 5);
    const c = sample([[150, 108, 58], [214, 178, 112], [238, 214, 160]], n * 1.4 + 0.5);
    put(col.d, idx, c[0], c[1], c[2]);
  });
  return col.flush();
}

// ---------- Gas giants ----------
function gasGiant(w, stops, { freq = 18, turb = 2.5, storm = null, seed = 0 }) {
  const h = w / 2;
  const col = canvas(w, h);
  forSphere(w, h, (x, y, z, lat, lon, idx) => {
    x += seed;
    const tb = fbm(x * 3, y * 10, z * 3, 4) * turb;
    const band = 0.5 + 0.5 * Math.sin(lat * freq + tb);
    const fine = 0.5 + 0.5 * Math.sin(lat * freq * 2.7 + tb * 1.7 + 1.3);
    let c = sample(stops, band * 0.75 + fine * 0.25);
    if (storm) {
      let dl = lon - storm.lon;
      if (dl > Math.PI) dl -= Math.PI * 2;
      if (dl < -Math.PI) dl += Math.PI * 2;
      const e = (dl / storm.w) ** 2 + ((lat - storm.lat) / storm.h) ** 2;
      if (e < 1.6) {
        const swirl = fbm(dl * 6, (lat - storm.lat) * 12, 0.5, 3);
        c = mix3(c, storm.color, smooth(1.6, 0.3, e) * (0.85 + swirl * 0.4));
      }
    }
    put(col.d, idx, clamp(c[0], 0, 255), clamp(c[1], 0, 255), clamp(c[2], 0, 255));
  });
  return col.flush();
}

export const jupiter = (w = 1024) =>
  gasGiant(w, [[120, 78, 52], [182, 132, 92], [222, 198, 164], [240, 228, 206], [196, 150, 110]], {
    freq: 20, turb: 3,
    storm: { lat: -0.38, lon: 2.0, w: 0.22, h: 0.09, color: [190, 90, 60] },
  });
export const saturn = (w = 1024) =>
  gasGiant(w, [[178, 148, 100], [210, 186, 140], [232, 214, 170], [200, 170, 120]], { freq: 16, turb: 1.5, seed: 30 });
export const uranus = (w = 512) =>
  gasGiant(w, [[150, 205, 214], [172, 222, 228], [190, 232, 236]], { freq: 10, turb: 0.6, seed: 60 });
export const neptune = (w = 512) =>
  gasGiant(w, [[38, 70, 170], [58, 102, 206], [86, 134, 226], [52, 90, 190]], {
    freq: 12, turb: 1.4, seed: 80,
    storm: { lat: -0.35, lon: 4.0, w: 0.2, h: 0.08, color: [24, 40, 110] },
  });

// ---------- Sun ----------
export function sun(w = 1024) {
  const h = w / 2;
  const col = canvas(w, h);
  forSphere(w, h, (x, y, z, lat, lon, idx) => {
    const n = fbm(x * 5, y * 5, z * 5, 5);
    const g = 1 - Math.abs(noise(x * 40, y * 40, z * 40));
    const c = sample([[255, 110, 20], [255, 170, 50], [255, 225, 140]], n * 1.2 + 0.5 + g * 0.25);
    put(col.d, idx, c[0], c[1], c[2]);
  });
  return col.flush();
}

// ---------- Saturn rings (1D radial strip) ----------
export function rings(w = 1024) {
  const col = canvas(w, 4);
  for (let i = 0; i < w; i++) {
    const t = i / w;
    let a = 0.55 + 0.35 * Math.sin(t * 90) * Math.sin(t * 23 + 1) + noise(t * 60, 0.5, 0.5) * 0.5;
    a *= smooth(0.0, 0.08, t) * smooth(1.0, 0.9, t);
    if (t > 0.56 && t < 0.62) a *= 0.05; // Cassini division
    if (t < 0.18) a *= 0.35; // faint inner C ring
    const c = mix3([150, 128, 98], [228, 210, 176], 0.5 + noise(t * 40, 2.5, 1.5));
    for (let j = 0; j < 4; j++) put(col.d, (j * w + i) * 4, c[0], c[1], c[2], clamp(a) * 255);
  }
  return col.flush();
}

// ---------- Glow sprite ----------
export function glow(size = 256, stops = [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,220,160,0.6)'], [1, 'rgba(255,150,50,0)']]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
