"use strict";
(function() {
  const tag = document.getElementById("buildTag");
  if (tag) tag.textContent = "SOBREVIVE · LÍNEA DE FUEGO · MOTOR 3D ACTIVO ✓ (build humanoides-IA)";
  console.log("%c[LÍNEA DE FUEGO] game.js (Three.js, enemigos humanoides, IA) cargado correctamente.", "color:#7c8f5c;font-weight:bold;font-size:13px;");
})();
const gameCanvas = document.getElementById("game");
const minimapCanvas = document.getElementById("minimap");
const mmArrow = document.getElementById("mmArrow");
const hitFlashEl = document.getElementById("hitFlash");
const SW = 1280, SH = 720;
const WALL_HEIGHT = 230;
const CEILING_HEIGHT = WALL_HEIGHT + 40;
const EYE_HEIGHT = 70;
const MOUSE_SENS = .0022;
let renderer, scene, camera, mmCtx = null;
let boot3DFailed = false;
const quality = {
  pr: 1,
  min: .6,
  max: 1,
  acc: 0,
  frames: 0,
  lastDrop: -1e9
};
let frameCount = 0;
function initThree() {
  const dpr = window.devicePixelRatio || 1;
  quality.max = clamp(dpr, 1, 1.5);
  quality.pr = Math.min(1, quality.max);
  renderer = new THREE.WebGLRenderer({
    canvas: gameCanvas,
    antialias: true,
    powerPreference: "high-performance"
  });
  renderer.setPixelRatio(quality.pr);
  renderer.setSize(SW, SH, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.outputEncoding = THREE.sRGBEncoding;
  const mmScale = Math.min(dpr, 2);
  minimapCanvas.width = Math.round(150 * mmScale);
  minimapCanvas.height = Math.round(150 * mmScale);
  mmCtx = minimapCanvas.getContext("2d");
  scene = new THREE.Scene;
  camera = new THREE.PerspectiveCamera(75, SW / SH, 1, 6e3);
  camera.rotation.order = "YXZ";
  scene.add(camera);
}
function updateQuality(dt) {
  if (STATE !== "PLAYING" || document.hidden) {
    quality.acc = 0;
    quality.frames = 0;
    return;
  }
  quality.acc += dt;
  quality.frames++;
  if (quality.acc < 2) return;
  const avg = quality.acc / quality.frames;
  quality.acc = 0;
  quality.frames = 0;
  const now = performance.now();
  let next = quality.pr;
  if (avg > 1 / 50 && quality.pr > quality.min) {
    next = Math.max(quality.min, quality.pr - .15);
    quality.lastDrop = now;
  } else if (avg < 1 / 57 && quality.pr < quality.max && now - quality.lastDrop > 1e4) {
    next = Math.min(quality.max, quality.pr + .1);
  }
  if (Math.abs(next - quality.pr) > .001) {
    quality.pr = next;
    renderer.setPixelRatio(next);
    renderer.setSize(SW, SH, false);
  }
}
const sharedMatCache = {};
function basicMat(color) {
  if (!sharedMatCache[color]) {
    sharedMatCache[color] = new THREE.MeshBasicMaterial({
      color: color
    });
    sharedMatCache[color].userData.shared = true;
  }
  return sharedMatCache[color];
}
function concatGeometries(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const merged = new THREE.BufferGeometry;
  for (const [name, size] of [ [ "position", 3 ], [ "normal", 3 ], [ "uv", 2 ] ]) {
    const arr = new Float32Array(total * size);
    let off = 0;
    for (const g of geos) {
      const a = g.attributes[name];
      const n = g.attributes.position.count * size;
      if (a) arr.set(a.array.length === n ? a.array : a.array.subarray(0, n), off);
      off += n;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}
function bakedGeometry(geo, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (matrix) g.applyMatrix4(matrix);
  return g;
}
function mergeStaticChildren(group) {
  const meshes = group.children.filter(o => o.isMesh);
  if (meshes.length < 2) return group;
  const buckets = new Map;
  for (const m of meshes) {
    m.updateMatrix();
    let b = buckets.get(m.material);
    if (!b) {
      b = {
        geos: [],
        cast: false,
        receive: false
      };
      buckets.set(m.material, b);
    }
    b.geos.push(bakedGeometry(m.geometry, m.matrix));
    b.cast = b.cast || m.castShadow;
    b.receive = b.receive || m.receiveShadow;
    group.remove(m);
  }
  const oldGeos = new Set(meshes.map(m => m.geometry));
  for (const g of oldGeos) g.dispose();
  for (const [mat, b] of buckets) {
    const mesh = new THREE.Mesh(concatGeometries(b.geos), mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.receive;
    for (const g of b.geos) g.dispose();
    group.add(mesh);
  }
  return group;
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}
function dist(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}
function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function rect(x, y, w, h) {
  return {
    x: x,
    y: y,
    w: w,
    h: h
  };
}
function yawFromAngle(a) {
  return -(a + Math.PI / 2);
}
function rayHit(ox, oy, dx, dy, maxDist, sx1, sy1, sx2, sy2) {
  const ex = ox + dx * maxDist, ey = oy + dy * maxDist;
  const d = (ex - ox) * (sy2 - sy1) - (ey - oy) * (sx2 - sx1);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((sx1 - ox) * (sy2 - sy1) - (sy1 - oy) * (sx2 - sx1)) / d;
  const u = ((sx1 - ox) * (ey - oy) - (sy1 - oy) * (ex - ox)) / d;
  if (t < 0 || t > 1) return null;
  if (u < 0 || u > 1) return null;
  return t * maxDist;
}
function circleRectPush(c, r) {
  const cx = clamp(c.x, r.x, r.x + r.w);
  const cy = clamp(c.y, r.y, r.y + r.h);
  const dx = c.x - cx, dy = c.y - cy;
  const d = Math.hypot(dx, dy);
  if (d < c.radius && d > 1e-4) {
    const push = c.radius - d;
    c.x += dx / d * push;
    c.y += dy / d * push;
    return true;
  }
  if (d === 0) {
    c.x += c.radius;
    return true;
  }
  return false;
}
function rectToSegments(r) {
  const {x: x, y: y, w: w, h: h} = r;
  return [ {
    x1: x,
    y1: y,
    x2: x + w,
    y2: y
  }, {
    x1: x + w,
    y1: y,
    x2: x + w,
    y2: y + h
  }, {
    x1: x + w,
    y1: y + h,
    x2: x,
    y2: y + h
  }, {
    x1: x,
    y1: y + h,
    x2: x,
    y2: y
  } ];
}
function hasLOS(x1, y1, x2, y2, segs) {
  const d = dist(x1, y1, x2, y2);
  if (d < 1) return true;
  const dx = (x2 - x1) / d, dy = (y2 - y1) / d;
  for (const s of segs) {
    const t = rayHit(x1, y1, dx, dy, d, s.x1, s.y1, s.x2, s.y2);
    if (t !== null && t < d - 4) return false;
  }
  return true;
}
function makeTexture(draw, w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const tctx = c.getContext("2d");
  draw(tctx, w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (renderer) tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}
function floorTexture(base) {
  return makeTexture((tctx, w, h) => {
    tctx.fillStyle = base;
    tctx.fillRect(0, 0, w, h);
    tctx.strokeStyle = "rgba(0,0,0,0.25)";
    tctx.lineWidth = 10;
    for (let x = 0; x <= w; x += 128) {
      tctx.beginPath();
      tctx.moveTo(x, 0);
      tctx.lineTo(x, h);
      tctx.stroke();
    }
    for (let y = 0; y <= h; y += 128) {
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.lineTo(w, y);
      tctx.stroke();
    }
    tctx.fillStyle = "rgba(0,0,0,0.06)";
    for (let i = 0; i < 22; i++) {
      tctx.beginPath();
      tctx.arc(Math.random() * w, Math.random() * h, rand(8, 28), 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let i = 0; i < 900; i++) tctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }, 512, 512);
}
let contactShadowTexCache = null;
function contactShadowTexture() {
  if (contactShadowTexCache) return contactShadowTexCache;
  contactShadowTexCache = makeTexture((tctx, w, h) => {
    const g = tctx.createRadialGradient(w / 2, h / 2, w * .14, w / 2, h / 2, w / 2);
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(.65, "rgba(0,0,0,0.2)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, w, h);
  }, 128, 128);
  return contactShadowTexCache;
}
function wallTexture(base) {
  return makeTexture((tctx, w, h) => {
    tctx.fillStyle = base;
    tctx.fillRect(0, 0, w, h);
    tctx.strokeStyle = "rgba(0,0,0,0.35)";
    tctx.lineWidth = 12;
    for (let y = 0; y <= h; y += 96) {
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.lineTo(w, y);
      tctx.stroke();
    }
    for (let x = 0; x <= w; x += 192) {
      for (let row = 0; row < h / 96; row++) {
        const off = row % 2 * 96;
        tctx.beginPath();
        tctx.moveTo((x + off) % w, row * 96);
        tctx.lineTo((x + off) % w, row * 96 + 96);
        tctx.stroke();
      }
    }
    tctx.fillStyle = "rgba(0,0,0,0.05)";
    for (let i = 0; i < 16; i++) {
      tctx.fillRect(Math.random() * w, Math.random() * h, rand(2, 5), rand(30, 90));
    }
    tctx.fillStyle = "rgba(255,255,255,0.04)";
    for (let i = 0; i < 600; i++) tctx.fillRect(Math.random() * w, Math.random() * h, 3, 1);
  }, 512, 512);
}
let audioCtx = null;
let noiseBuffer = null;
function ensureAudio() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext);
    } catch (err) {
      audioCtx = null;
    }
  } else if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
  return audioCtx;
}
function getNoiseBuffer(ctx) {
  if (noiseBuffer) return noiseBuffer;
  const len = Math.floor(ctx.sampleRate * .4);
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}
const SHOT_SFX = {
  pistol: {
    dur: .11,
    freq: 1500,
    vol: .5
  },
  smg: {
    dur: .09,
    freq: 1700,
    vol: .42
  },
  rifle: {
    dur: .13,
    freq: 1200,
    vol: .55
  },
  shotgun: {
    dur: .22,
    freq: 700,
    vol: .68
  },
  sniper: {
    dur: .34,
    freq: 500,
    vol: .8
  }
};
function playShot(weaponKey, volMul) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const cfg = SHOT_SFX[weaponKey] || SHOT_SFX.pistol;
  const vm = volMul == null ? 1 : volMul;
  const t0 = ctx.currentTime;
  const crack = ctx.createBufferSource();
  crack.buffer = getNoiseBuffer(ctx);
  const crackHp = ctx.createBiquadFilter();
  crackHp.type = "highpass";
  crackHp.frequency.value = 2600;
  const crackGain = ctx.createGain();
  crackGain.gain.setValueAtTime(cfg.vol * .95 * vm, t0);
  crackGain.gain.exponentialRampToValueAtTime(.001, t0 + .025);
  crack.connect(crackHp);
  crackHp.connect(crackGain);
  crackGain.connect(ctx.destination);
  crack.start(t0);
  crack.stop(t0 + .03);
  const noise = ctx.createBufferSource();
  noise.buffer = getNoiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = cfg.freq;
  bp.Q.value = .65;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = cfg.freq * 2.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(cfg.vol * vm, t0 + .003);
  gain.gain.exponentialRampToValueAtTime(.001, t0 + cfg.dur);
  noise.connect(bp);
  bp.connect(lp);
  lp.connect(gain);
  gain.connect(ctx.destination);
  noise.start(t0);
  noise.stop(t0 + cfg.dur + .02);
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(cfg.freq * .3, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + cfg.dur * .9);
  const og = ctx.createGain();
  og.gain.setValueAtTime(cfg.vol * .6 * vm, t0);
  og.gain.exponentialRampToValueAtTime(.001, t0 + cfg.dur * .8);
  osc.connect(og);
  og.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + cfg.dur);
  const delay = ctx.createDelay();
  delay.delayTime.value = .065;
  const feedback = ctx.createGain();
  feedback.gain.value = .24;
  const echoGain = ctx.createGain();
  echoGain.gain.value = .4 * vm;
  gain.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(echoGain);
  echoGain.connect(ctx.destination);
}
function playHitThud(critical) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(critical ? 620 : 340, t0);
  osc.frequency.exponentialRampToValueAtTime(80, t0 + .09);
  const g = ctx.createGain();
  g.gain.setValueAtTime(critical ? .32 : .2, t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + .1);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + .12);
}
function playReload() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  for (let i = 0; i < 2; i++) {
    const t = t0 + i * .09;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(i === 0 ? 260 : 340, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.18, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .06);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + .07);
  }
}
function playDeath(volMul) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(45, t0 + .35);
  const g = ctx.createGain();
  g.gain.setValueAtTime(.22 * (volMul == null ? 1 : volMul), t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + .4);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + .42);
}
const WEAPONS = {
  pistol: {
    name: "PISTOLA",
    magSize: 12,
    fireRate: .22,
    dmg: 16,
    spread: .045,
    bulletSpeed: 1450,
    reloadTime: .9,
    pellets: 1,
    color: 2302755
  },
  smg: {
    name: "SUBFUSIL",
    magSize: 32,
    fireRate: .07,
    dmg: 8,
    spread: .09,
    bulletSpeed: 1400,
    reloadTime: 1.3,
    pellets: 1,
    color: 2829864
  },
  rifle: {
    name: "FUSIL",
    magSize: 30,
    fireRate: .11,
    dmg: 13,
    spread: .05,
    bulletSpeed: 1550,
    reloadTime: 1.6,
    pellets: 1,
    color: 2302751
  },
  shotgun: {
    name: "ESCOPETA",
    magSize: 6,
    fireRate: .62,
    dmg: 9,
    spread: .22,
    bulletSpeed: 1150,
    reloadTime: 1.9,
    pellets: 6,
    color: 1973786
  },
  sniper: {
    name: "FRANCOTIRADOR",
    magSize: 5,
    fireRate: .85,
    dmg: 62,
    spread: .008,
    bulletSpeed: 2e3,
    reloadTime: 2.1,
    pellets: 1,
    color: 3027759
  },
  knife: {
    name: "CUCHILLO",
    magSize: 0,
    fireRate: .45,
    dmg: 38,
    spread: 0,
    bulletSpeed: 0,
    reloadTime: 0,
    pellets: 0,
    color: 1842204
  }
};
const WOOD_COLOR = 7029795;
function hexCss(n) {
  return "#" + n.toString(16).padStart(6, "0");
}
const gunTexCache = {};
function gunPanelTexture(colorNum) {
  if (gunTexCache[colorNum]) return gunTexCache[colorNum];
  const base = hexCss(colorNum);
  const tex = makeTexture((tctx, w, h) => {
    tctx.fillStyle = base;
    tctx.fillRect(0, 0, w, h);
    tctx.strokeStyle = "rgba(255,255,255,0.07)";
    tctx.lineWidth = 1;
    for (let y = 1; y < h; y += 3) {
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.lineTo(w, y);
      tctx.stroke();
    }
    tctx.strokeStyle = "rgba(0,0,0,0.45)";
    tctx.lineWidth = 2;
    tctx.strokeRect(3, 3, w - 6, h - 6);
    tctx.beginPath();
    tctx.moveTo(0, h * .34);
    tctx.lineTo(w, h * .34);
    tctx.stroke();
    tctx.beginPath();
    tctx.moveTo(0, h * .68);
    tctx.lineTo(w, h * .68);
    tctx.stroke();
    tctx.fillStyle = "rgba(0,0,0,0.55)";
    for (let i = 0; i < 5; i++) {
      tctx.beginPath();
      tctx.arc(6 + i * (w - 12) / 4, h * .5, 1.5, 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 40; i++) tctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }, 64, 64);
  gunTexCache[colorNum] = tex;
  return tex;
}
const woodTexCache = {};
function woodPanelTexture(colorNum) {
  const c = colorNum || WOOD_COLOR;
  if (woodTexCache[c]) return woodTexCache[c];
  const base = hexCss(c);
  const tex = makeTexture((tctx, w, h) => {
    tctx.fillStyle = base;
    tctx.fillRect(0, 0, w, h);
    tctx.strokeStyle = "rgba(35,18,8,0.4)";
    tctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const y = (i + .5) * (h / 9) + rand(-2, 2);
      tctx.beginPath();
      tctx.moveTo(0, y);
      tctx.bezierCurveTo(w * .3, y + rand(-3, 3), w * .7, y + rand(-3, 3), w, y + rand(-2, 2));
      tctx.stroke();
    }
    tctx.fillStyle = "rgba(0,0,0,0.08)";
    for (let i = 0; i < 50; i++) tctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }, 64, 64);
  woodTexCache[c] = tex;
  return tex;
}
function gunMat(colorNum, roughness, metalness) {
  return new THREE.MeshStandardMaterial({
    map: gunPanelTexture(colorNum),
    color: 16777215,
    roughness: roughness != null ? roughness : .5,
    metalness: metalness != null ? metalness : .5
  });
}
function woodMat(colorNum) {
  return new THREE.MeshStandardMaterial({
    map: woodPanelTexture(colorNum),
    color: 16777215,
    roughness: .78,
    metalness: .04
  });
}
function buildCurvedMagazine(mat, segLen, width, depth, segments, totalBend, taper) {
  const group = new THREE.Group;
  let y = 0, z = 0, angle = 0;
  const bend = totalBend / segments;
  for (let i = 0; i < segments; i++) {
    angle += bend;
    const segW = width * (1 - (taper || 0) * (i / segments));
    const seg = new THREE.Mesh(new THREE.BoxGeometry(segW, segLen, depth), mat);
    const midY = y - Math.cos(angle) * (segLen / 2);
    const midZ = z - Math.sin(angle) * (segLen / 2);
    seg.position.set(0, midY, midZ);
    seg.rotation.x = angle;
    group.add(seg);
    y -= Math.cos(angle) * segLen;
    z -= Math.sin(angle) * segLen;
  }
  return group;
}
function buildGlock() {
  const group = new THREE.Group;
  const metal = gunMat(WEAPONS.pistol.color, .4, .65);
  const dark = gunMat(1052688, .4, .5);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(6.2, 6.4, 20), metal);
  slide.position.set(0, 0, -1);
  const muzzle = new THREE.Mesh(new THREE.BoxGeometry(5.4, 5.6, 2.4), dark);
  muzzle.position.set(0, 0, -11.6);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(6.8, 13, 9), dark);
  frame.position.set(0, -8.2, 4);
  frame.rotation.x = -.16;
  const trigGuard = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 9), dark);
  trigGuard.position.set(0, -14.2, 3.5);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(5, 8, 6.4), dark);
  mag.position.set(0, -18, 5.5);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(5.4, 1.6, 2.2), dark);
  rearSight.position.set(0, 3.8, 8);
  const frontSight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 1.6), dark);
  frontSight.position.set(0, 3.6, -10);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4, 1.1), dark);
  trigger.position.set(0, -11.2, 1.2);
  const slideRelease = new THREE.Mesh(new THREE.BoxGeometry(1, 1.4, 3.2), dark);
  slideRelease.position.set(-3.7, -2, 3);
  const magBase = new THREE.Mesh(new THREE.BoxGeometry(6, 1.6, 7.2), dark);
  magBase.position.set(0, -21.8, 5.5);
  group.add(slide, muzzle, frame, trigGuard, mag, rearSight, frontSight, trigger, slideRelease, magBase);
  group.userData.muzzleZ = -12.8;
  return group;
}
function buildMP5() {
  const group = new THREE.Group;
  const metal = gunMat(WEAPONS.smg.color, .5, .55);
  const dark = gunMat(1053200, .5, .4);
  const receiver = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 20, 10), metal);
  receiver.rotation.x = Math.PI / 2;
  receiver.position.set(0, 0, 2);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(8, 8, 13), dark);
  handguard.position.set(0, -.5, -13);
  const barrelTip = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 6, 8), dark);
  barrelTip.rotation.x = Math.PI / 2;
  barrelTip.position.set(0, 0, -21);
  const frontRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, .7, 6, 10), dark);
  frontRing.position.set(0, 3.6, -19);
  const rearDrum = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 3, 10), dark);
  rearDrum.rotation.z = Math.PI / 2;
  rearDrum.position.set(0, 5, 9);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(6, 14, 7), dark);
  grip.position.set(0, -9, 5);
  grip.rotation.x = -.18;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(5, 17, 7), dark);
  mag.position.set(0, -16, 2);
  mag.rotation.x = .12;
  const stockBar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 15), dark);
  stockBar.position.set(0, 1, 17);
  const stockPad = new THREE.Mesh(new THREE.BoxGeometry(2.6, 9, 3), dark);
  stockPad.position.set(0, 1, 24);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4, 1.1), dark);
  trigger.position.set(0, -6, 6.5);
  group.add(receiver, handguard, barrelTip, frontRing, rearDrum, grip, mag, stockBar, stockPad, trigger);
  group.userData.muzzleZ = -24;
  return group;
}
function buildM4() {
  const group = new THREE.Group;
  const dark = gunMat(WEAPONS.rifle.color, .45, .55);
  const rail = gunMat(789514, .4, .5);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(6.6, 7, 22), dark);
  receiver.position.set(0, 0, 3);
  const upperRail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 26), rail);
  upperRail.position.set(0, 4.6, -6);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 24, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, .5, -22);
  const handguard = new THREE.Mesh(new THREE.BoxGeometry(6.2, 6.2, 20), rail);
  handguard.position.set(0, 0, -20);
  const frontSightBlock = new THREE.Mesh(new THREE.BoxGeometry(3, 6, 3), dark);
  frontSightBlock.position.set(0, 3.4, -32);
  const frontPost = new THREE.Mesh(new THREE.BoxGeometry(1, 2.4, 1), dark);
  frontPost.position.set(0, 7, -32);
  const rearSight = new THREE.Mesh(new THREE.BoxGeometry(3.4, 3, 4), dark);
  rearSight.position.set(0, 5.6, 8);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(6, 13, 6.6), dark);
  grip.position.set(0, -9, 7);
  grip.rotation.x = -.2;
  const stockTube = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3, 12), dark);
  stockTube.position.set(0, .5, 20);
  const stockButt = new THREE.Mesh(new THREE.BoxGeometry(4.6, 8, 5), dark);
  stockButt.position.set(0, 0, 27);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(4.6, 17, 6.6), dark);
  mag.position.set(0, -14.5, 4);
  mag.rotation.x = .05;
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4, 1.1), dark);
  trigger.position.set(0, -4.8, 5.5);
  group.add(receiver, upperRail, barrel, handguard, frontSightBlock, frontPost, rearSight, grip, stockTube, stockButt, mag, trigger);
  group.userData.muzzleZ = -34;
  return group;
}
function buildPumpShotgun() {
  const group = new THREE.Group;
  const metal = gunMat(WEAPONS.shotgun.color, .45, .55);
  const dark = gunMat(1184272, .45, .4);
  const wood = woodMat();
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(7.6, 8, 14), metal);
  receiver.position.set(0, 0, 8);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 30, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 2.6, -14);
  const magTube = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 26, 8), dark);
  magTube.rotation.x = Math.PI / 2;
  magTube.position.set(0, -1.4, -12);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(6.6, 6.6, 11), wood);
  pump.position.set(0, -1.4, -15);
  const bead = new THREE.Mesh(new THREE.SphereGeometry(1, 6, 6), dark);
  bead.position.set(0, 4.4, -29);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(6.4, 13, 7.4), wood);
  grip.position.set(0, -9, 11);
  grip.rotation.x = -.2;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(5.6, 8, 20), wood);
  stock.position.set(0, 1, 24);
  stock.rotation.x = .08;
  const triggerGuard = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.4, 8), dark);
  triggerGuard.position.set(0, -6.8, 9);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(1.3, 3.6, 1.1), dark);
  trigger.position.set(0, -5.4, 9);
  group.add(receiver, barrel, magTube, pump, bead, grip, stock, triggerGuard, trigger);
  group.userData.muzzleZ = -29;
  return group;
}
function buildSniperRifle() {
  const group = new THREE.Group;
  const metal = gunMat(WEAPONS.sniper.color, .4, .6);
  const dark = gunMat(1052688, .4, .5);
  const receiver = new THREE.Mesh(new THREE.BoxGeometry(8, 9, 30), metal);
  receiver.position.set(0, 0, 6);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 40, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0, -26);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(6, 9, 26), dark);
  stock.position.set(0, -1, 30);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(6, 13, 7), dark);
  grip.position.set(0, -9, 15);
  grip.rotation.x = -.2;
  const mag = new THREE.Mesh(new THREE.BoxGeometry(4.6, 8, 6), dark);
  mag.position.set(0, -6, 8);
  const scopeBody = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 20, 10), new THREE.MeshStandardMaterial({
    color: 789516,
    roughness: .3,
    metalness: .6
  }));
  scopeBody.rotation.x = Math.PI / 2;
  scopeBody.position.set(0, 8.5, -2);
  const lensMat = new THREE.MeshStandardMaterial({
    color: 5951712,
    emissive: 1725792,
    roughness: .2,
    metalness: .1
  });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.1, .6, 10), lensMat);
  lens.rotation.x = Math.PI / 2;
  lens.position.set(0, 8.5, -12);
  const mount = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 14), dark);
  mount.position.set(0, 4.6, -2);
  const bipod = new THREE.Mesh(new THREE.BoxGeometry(1.6, 12, 1.6), dark);
  bipod.position.set(0, -7, -18);
  const trigger = new THREE.Mesh(new THREE.BoxGeometry(1.3, 4, 1.1), dark);
  trigger.position.set(0, -4.6, 12);
  const boltHandle = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 8, 8), metal);
  boltHandle.rotation.z = Math.PI / 2;
  boltHandle.position.set(5.5, 1, 10);
  const boltKnob = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), metal);
  boltKnob.position.set(9.5, 1, 10);
  group.add(receiver, barrel, stock, grip, mag, scopeBody, lens, mount, bipod, trigger, boltHandle, boltKnob);
  group.userData.muzzleZ = -46;
  return group;
}
function buildKnife() {
  const group = new THREE.Group;
  const steel = new THREE.MeshStandardMaterial({
    color: 12896974,
    roughness: .18,
    metalness: .9
  });
  const darkSteel = new THREE.MeshStandardMaterial({
    color: 2302752,
    roughness: .45,
    metalness: .6
  });
  const gripMat = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(4867376),
    color: 16777215,
    roughness: .85,
    metalness: .1
  });
  const bladeMain = new THREE.Mesh(new THREE.BoxGeometry(3.6, .8, 13), steel);
  bladeMain.position.set(0, 0, -7.5);
  group.add(bladeMain);
  const bladeTip = new THREE.Mesh(new THREE.BoxGeometry(2, .7, 6), steel);
  bladeTip.position.set(0, 0, -17);
  group.add(bladeTip);
  const spine = new THREE.Mesh(new THREE.BoxGeometry(.5, 1, 12), darkSteel);
  spine.position.set(1.15, 0, -7.5);
  group.add(spine);
  for (let i = 0; i < 4; i++) {
    const tooth = new THREE.Mesh(new THREE.ConeGeometry(.55, 1.3, 4), darkSteel);
    tooth.rotation.z = Math.PI / 2;
    tooth.position.set(1.15, .55, -1.5 - i * 1.4);
    group.add(tooth);
  }
  const guard = new THREE.Mesh(new THREE.BoxGeometry(8, 1.8, 1.8), darkSteel);
  guard.position.set(0, 0, 0);
  group.add(guard);
  const handle = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.6, 11, 8), gripMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, 0, 6.5);
  group.add(handle);
  for (let i = 0; i < 3; i++) {
    const ridge = new THREE.Mesh(new THREE.TorusGeometry(1.75, .3, 6, 10), darkSteel);
    ridge.rotation.y = Math.PI / 2;
    ridge.position.set(0, 0, 3.5 + i * 3);
    group.add(ridge);
  }
  const pommel = new THREE.Mesh(new THREE.CylinderGeometry(2, 2, 1.8, 8), darkSteel);
  pommel.rotation.x = Math.PI / 2;
  pommel.position.set(0, 0, 12.6);
  group.add(pommel);
  const lanyard = new THREE.Mesh(new THREE.TorusGeometry(1.1, .35, 6, 10), darkSteel);
  lanyard.position.set(0, 0, 14);
  group.add(lanyard);
  group.userData.muzzleZ = -23;
  return group;
}
function buildGunMesh(key) {
  let group;
  if (key === "pistol") group = buildGlock(); else if (key === "smg") group = buildMP5(); else if (key === "rifle") group = buildM4(); else if (key === "shotgun") group = buildPumpShotgun(); else if (key === "knife") group = buildKnife(); else group = buildSniperRifle();
  return mergeStaticChildren(group);
}
const ENEMY_TYPES = {
  grunt: {
    hp: 34,
    speed: 95,
    radius: 15,
    dmg: 7,
    range: 620,
    sight: 760,
    fov: 1.15,
    fireRate: .9,
    spread: .12,
    bulletSpeed: 760,
    burst: 1,
    score: 10,
    color: 4869946,
    scale: 1,
    heldWeapon: "rifle"
  },
  heavy: {
    hp: 70,
    speed: 60,
    radius: 19,
    dmg: 10,
    range: 560,
    sight: 680,
    fov: 1,
    fireRate: 1.3,
    spread: .16,
    bulletSpeed: 680,
    burst: 3,
    score: 20,
    color: 3815982,
    scale: 1.28,
    heldWeapon: "shotgun"
  },
  scout: {
    hp: 20,
    speed: 205,
    radius: 12,
    dmg: 13,
    range: 0,
    sight: 850,
    fov: 1.4,
    fireRate: 0,
    spread: 0,
    bulletSpeed: 0,
    burst: 0,
    score: 14,
    color: 5916208,
    scale: .82,
    melee: true,
    atkCd: .75,
    heldWeapon: "knife"
  },
  sharp: {
    hp: 38,
    speed: 42,
    radius: 15,
    dmg: 24,
    range: 1100,
    sight: 1300,
    fov: 1.05,
    fireRate: 2.1,
    spread: .02,
    bulletSpeed: 1800,
    burst: 1,
    score: 26,
    color: 3159342,
    scale: 1,
    keepsDistance: true,
    heldWeapon: "sniper"
  },
  miniboss: {
    hp: 140,
    speed: 72,
    radius: 20,
    dmg: 16,
    range: 620,
    sight: 780,
    fov: 1.3,
    fireRate: .75,
    spread: .08,
    bulletSpeed: 800,
    burst: 2,
    score: 60,
    color: 5909024,
    scale: 1.42,
    heldWeapon: "rifle",
    guaranteedBoost: true
  },
  boss: {
    hp: 460,
    speed: 58,
    radius: 30,
    dmg: 18,
    range: 700,
    sight: 900,
    fov: 1.7,
    fireRate: .42,
    spread: .13,
    bulletSpeed: 800,
    burst: 5,
    score: 260,
    color: 5906207,
    scale: 2.05,
    heldWeapon: "rifle"
  }
};
function buildHumanoid(type) {
  const t = ENEMY_TYPES[type];
  const jacketMat = new THREE.MeshLambertMaterial({
    color: t.color
  });
  const maskMat = new THREE.MeshLambertMaterial({
    color: 1512979
  });
  const pantsMat = new THREE.MeshLambertMaterial({
    color: 2368543
  });
  const group = new THREE.Group;
  const legW = 8, legH = 30, legD = 8, hipY = 30;
  function leg(x) {
    const pivot = new THREE.Group;
    pivot.position.set(x, hipY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(legW, legH, legD), pantsMat);
    mesh.position.y = -legH / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const leftLeg = leg(-6), rightLeg = leg(6);
  const torso = new THREE.Mesh(new THREE.BoxGeometry(22, 28, 13), jacketMat);
  torso.position.y = hipY + 14;
  torso.castShadow = true;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(23, 16, 14), maskMat);
  vest.position.y = hipY + 20;
  vest.castShadow = true;
  const armW = 7, armH = 26, armD = 7, shoulderY = hipY + 28;
  function arm(x) {
    const pivot = new THREE.Group;
    pivot.position.set(x, shoulderY, 0);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(armW, armH, armD), jacketMat);
    mesh.position.y = -armH / 2;
    mesh.castShadow = true;
    pivot.add(mesh);
    return pivot;
  }
  const leftArm = arm(-14.5), rightArm = arm(14.5);
  leftArm.rotation.x = 1.25;
  rightArm.rotation.x = 1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 16), maskMat);
  head.position.y = shoulderY + 9;
  head.castShadow = true;
  const hood = new THREE.Mesh(new THREE.BoxGeometry(18.5, 9, 18.5), jacketMat);
  hood.position.set(0, head.position.y + 6.4, -.5);
  hood.rotation.x = .16;
  hood.castShadow = true;
  const eyeSlit = new THREE.Mesh(new THREE.BoxGeometry(15.4, 2.4, 1.5), new THREE.MeshLambertMaterial({
    color: 657928
  }));
  eyeSlit.position.set(0, head.position.y + 1, -8.1);
  group.add(leftLeg, rightLeg, torso, vest, leftArm, rightArm, head, hood, eyeSlit);
  if (type === "boss" || type === "miniboss") {
    const padMat = new THREE.MeshLambertMaterial({
      color: type === "boss" ? 2756624 : 2364946
    });
    const padSize = type === "boss" ? [ 10, 8, 16 ] : [ 8, 6, 13 ];
    const padL = new THREE.Mesh(new THREE.BoxGeometry(...padSize), padMat);
    padL.position.set(type === "boss" ? -16 : -13, shoulderY + 4, 0);
    const padR = padL.clone();
    padR.position.x = -padL.position.x;
    group.add(padL, padR);
  }
  let gun = null;
  if (t.heldWeapon) {
    gun = buildGunMesh(t.heldWeapon);
    if (t.heldWeapon === "knife") {
      gun.position.set(11, shoulderY - 5, -19);
      gun.rotation.set(.25, .3, 0);
    } else {
      gun.position.set(7, shoulderY - 10, -23);
      gun.rotation.x = .1;
    }
    group.add(gun);
  }
  mergeStaticChildren(group);
  group.userData = {
    leftLeg: leftLeg,
    rightLeg: rightLeg,
    leftArm: leftArm,
    rightArm: rightArm,
    gun: gun,
    gunBaseY: gun ? gun.position.y : 0,
    shirtMat: jacketMat,
    flashMats: [ jacketMat, maskMat, pantsMat ]
  };
  group.scale.setScalar(t.scale);
  return group;
}
function buildPickupMesh(p) {
  const group = new THREE.Group;
  if (p.type === "health") {
    const mat = new THREE.MeshLambertMaterial({
      color: 12729147,
      emissive: 4853776
    });
    const a = new THREE.Mesh(new THREE.BoxGeometry(18, 6, 6), mat);
    const b = new THREE.Mesh(new THREE.BoxGeometry(6, 6, 18), mat);
    group.add(a, b);
    group.position.y = 26;
  } else if (p.type === "ammo") {
    const crateMat = new THREE.MeshStandardMaterial({
      map: gunPanelTexture(3813408),
      color: 16777215,
      roughness: .7,
      metalness: .35
    });
    const crate = new THREE.Mesh(new THREE.BoxGeometry(17, 11, 21), crateMat);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(18, 2.4, 22), crateMat);
    lid.position.y = 6.7;
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 15246141,
      roughness: .5,
      metalness: .1
    });
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(17.4, 2.2, 21.4), stripeMat);
    const latchMat = new THREE.MeshStandardMaterial({
      color: 1381136,
      roughness: .4,
      metalness: .6
    });
    const latchL = new THREE.Mesh(new THREE.BoxGeometry(3, 3, 2), latchMat);
    latchL.position.set(-5, 2, 10.6);
    const latchR = latchL.clone();
    latchR.position.x = 5;
    group.add(crate, lid, stripe, latchL, latchR);
    const roundMat = new THREE.MeshStandardMaterial({
      color: 14262858,
      roughness: .3,
      metalness: .75
    });
    for (let i = 0; i < 4; i++) {
      const round = new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, 6, 6), roundMat);
      round.rotation.z = Math.PI / 2;
      round.position.set(-6 + i * 4, 8.4, rand(-2, 2));
      group.add(round);
    }
    group.position.y = 16;
  } else if (p.type === "weapon") {
    const gun = buildGunMesh(p.weapon);
    gun.rotation.z = Math.PI / 2.4;
    gun.scale.setScalar(1.1);
    group.add(gun);
    group.position.y = 18;
  } else if (p.type === "boost") {
    const boostColors = {
      speed: 5951712,
      damage: 14703162,
      precision: 7004250,
      firerate: 16107610,
      armor: 12106946
    };
    const c = boostColors[p.boostKind] || 5951712;
    const mat = new THREE.MeshLambertMaterial({
      color: c,
      emissive: c,
      emissiveIntensity: .6
    });
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(14, 0), mat);
    group.add(gem);
    group.position.y = 34;
  }
  mergeStaticChildren(group);
  group.traverse(o => {
    if (o.isMesh) o.castShadow = true;
  });
  return group;
}
function buildLampFixture(color) {
  const group = new THREE.Group;
  const housingMat = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(1710615),
    color: 16777215,
    roughness: .55,
    metalness: .55
  });
  const housing = new THREE.Mesh(new THREE.CylinderGeometry(8, 14, 11, 12), housingMat);
  group.add(housing);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(14.6, 14.6, 1.4, 12), housingMat);
  rim.position.y = -5.2;
  group.add(rim);
  const lensMat = new THREE.MeshBasicMaterial({
    color: color
  });
  const lens = new THREE.Mesh(new THREE.CylinderGeometry(11.5, 11.5, 1, 12), lensMat);
  lens.position.y = -6;
  group.add(lens);
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 18, 6), housingMat);
  rod.position.y = 10;
  group.add(rod);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 3, 8), housingMat);
  cap.position.y = 19;
  group.add(cap);
  mergeStaticChildren(group);
  group.userData.lensMat = lensMat;
  return group;
}
const PLAT = 112;
const RAIL_DOWN = -44;
const SHAFT_DEPTH = 440;
const BEACON_COLOR = 16757575;
let gratingTexCache = null, hazardTexCache = null, shaftTexCache = null, columnTexCache = null;
function gratingTexture() {
  if (gratingTexCache) return gratingTexCache;
  gratingTexCache = makeTexture((c, w, h) => {
    c.fillStyle = "#3d3f3a";
    c.fillRect(0, 0, w, h);
    const cell = 16;
    c.fillStyle = "#121311";
    for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) c.fillRect(x + 3, y + 3, cell - 6, cell - 6);
    c.fillStyle = "rgba(255,255,255,0.06)";
    for (let y = 0; y < h; y += cell) c.fillRect(0, y, w, 1);
    c.fillStyle = "rgba(0,0,0,0.22)";
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.arc(Math.random() * w, Math.random() * h, rand(6, 16), 0, Math.PI * 2);
      c.fill();
    }
  }, 128, 128);
  gratingTexCache.repeat.set(4, 4);
  return gratingTexCache;
}
function hazardTexture() {
  if (hazardTexCache) return hazardTexCache;
  hazardTexCache = makeTexture((c, w, h) => {
    c.fillStyle = "#e8a33d";
    c.fillRect(0, 0, w, h);
    c.fillStyle = "#151109";
    const stripeW = w / 4;
    for (let i = -2; i < 6; i++) {
      c.beginPath();
      c.moveTo(i * stripeW, 0);
      c.lineTo(i * stripeW + stripeW * .5, 0);
      c.lineTo(i * stripeW + stripeW * .5 + h, h);
      c.lineTo(i * stripeW + h, h);
      c.closePath();
      c.fill();
    }
  }, 64, 64);
  hazardTexCache.repeat.set(7, 1);
  return hazardTexCache;
}
function shaftTexture() {
  if (!shaftTexCache) shaftTexCache = wallTexture("#262a26");
  return shaftTexCache;
}
function columnTexture() {
  if (columnTexCache) return columnTexCache;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, "rgba(255,255,255,0)");
  gr.addColorStop(.55, "rgba(255,255,255,0.3)");
  gr.addColorStop(1, "rgba(255,255,255,1)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 128);
  columnTexCache = new THREE.CanvasTexture(c);
  return columnTexCache;
}
function buildElevator(isExit) {
  const root = new THREE.Group;
  const half = PLAT / 2;
  const metal = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(3355443),
    color: 16777215,
    roughness: .5,
    metalness: .6
  });
  const deckMat = new THREE.MeshStandardMaterial({
    map: gratingTexture(),
    color: 16777215,
    roughness: .7,
    metalness: .5
  });
  const hazardMat = new THREE.MeshStandardMaterial({
    map: hazardTexture(),
    color: 16777215,
    roughness: .6,
    metalness: .2
  });
  const platform = new THREE.Group;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(PLAT, 6, PLAT), deckMat);
  deck.position.y = -1.5;
  deck.receiveShadow = true;
  platform.add(deck);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(PLAT - 4, 14, PLAT - 4), metal);
  frame.position.y = -11.5;
  platform.add(frame);
  for (const s of [ -1, 1 ]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(PLAT, 1.2, 8), hazardMat);
    a.position.set(0, 2, s * (half - 4));
    a.receiveShadow = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, PLAT - 16), hazardMat);
    b.position.set(s * (half - 4), 2, 0);
    b.receiveShadow = true;
    platform.add(a, b);
  }
  const postH = 46;
  const corners = [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ];
  for (const [cx, cz] of corners) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.8, postH, 8), metal);
    post.position.set(cx * (half - 5), postH / 2, cz * (half - 5));
    platform.add(post);
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 4, 10), basicMat(7029264));
    housing.position.set(cx * (half - 5), postH + 2, cz * (half - 5));
    platform.add(housing);
  }
  mergeStaticChildren(platform);
  const rails = new THREE.Group;
  for (const y of [ 22, 40 ]) {
    for (const s of [ -1, 1 ]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(PLAT - 10, 2.2, 2.2), metal);
      a.position.set(0, y, s * (half - 5));
      const b = new THREE.Mesh(new THREE.BoxGeometry(2.2, 2.2, PLAT - 10), metal);
      b.position.set(s * (half - 5), y, 0);
      rails.add(a, b);
    }
  }
  mergeStaticChildren(rails);
  rails.position.y = isExit ? RAIL_DOWN : 0;
  platform.add(rails);
  const spinners = [];
  for (const [cx, cz] of corners) {
    const spinner = new THREE.Group;
    spinner.position.set(cx * (half - 5), postH + 6.5, cz * (half - 5));
    const beam = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.6, 15), basicMat(BEACON_COLOR));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(2.3, 8, 6), basicMat(16769184));
    spinner.add(beam, bulb);
    spinner.rotation.y = (cx + cz) * .8;
    platform.add(spinner);
    spinners.push(spinner);
  }
  const light = new THREE.PointLight(BEACON_COLOR, 1.4, 320, 2);
  light.position.set(0, 62, 0);
  platform.add(light);
  root.add(platform);
  const shaft = new THREE.Group;
  const shaftMat = new THREE.MeshLambertMaterial({
    map: shaftTexture()
  });
  const t = 12, inner = half + 1;
  const dir = isExit ? -1 : 1;
  const base = isExit ? -.5 : CEILING_HEIGHT + .5;
  const wallY = base + dir * SHAFT_DEPTH / 2;
  for (const s of [ -1, 1 ]) {
    const wa = new THREE.BoxGeometry(PLAT + 2 + t * 2, SHAFT_DEPTH, t);
    scaleBoxUVs(wa, PLAT + 2 + t * 2, SHAFT_DEPTH, t, 60);
    const ma = new THREE.Mesh(wa, shaftMat);
    ma.position.set(0, wallY, s * (inner + t / 2));
    const wb = new THREE.BoxGeometry(t, SHAFT_DEPTH, PLAT + 2);
    scaleBoxUVs(wb, t, SHAFT_DEPTH, PLAT + 2, 60);
    const mb = new THREE.Mesh(wb, shaftMat);
    mb.position.set(s * (inner + t / 2), wallY, 0);
    shaft.add(ma, mb);
  }
  const bottom = new THREE.Mesh(new THREE.BoxGeometry(PLAT + 2, 4, PLAT + 2), shaftMat);
  bottom.position.y = base + dir * SHAFT_DEPTH;
  shaft.add(bottom);
  const stripMat = basicMat(14254635);
  for (let d = 36; d < SHAFT_DEPTH; d += 56) {
    const y = base + dir * d;
    for (const s of [ -1, 1 ]) {
      const a = new THREE.Mesh(new THREE.BoxGeometry(PLAT - 24, 2, 1), stripMat);
      a.position.set(0, y, s * (inner - .6));
      const b = new THREE.Mesh(new THREE.BoxGeometry(1, 2, PLAT - 24), stripMat);
      b.position.set(s * (inner - .6), y, 0);
      shaft.add(a, b);
    }
  }
  mergeStaticChildren(shaft);
  root.add(shaft);
  let column = null, ring = null;
  if (isExit) {
    column = new THREE.Mesh(new THREE.CylinderGeometry(half * .78, half * .92, CEILING_HEIGHT, 28, 1, true), new THREE.MeshBasicMaterial({
      color: BEACON_COLOR,
      map: columnTexture(),
      transparent: true,
      opacity: .5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false
    }));
    column.position.y = CEILING_HEIGHT / 2;
    column.renderOrder = 2;
    root.add(column);
    ring = new THREE.Mesh(new THREE.RingGeometry(half + 5, half + 15, 40), new THREE.MeshBasicMaterial({
      color: BEACON_COLOR,
      transparent: true,
      opacity: .6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      fog: false
    }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 1;
    ring.renderOrder = 2;
    root.add(ring);
  }
  root.userData = {
    platform: platform,
    rails: rails,
    spinners: spinners,
    light: light,
    column: column,
    ring: ring,
    colFade: 1,
    active: true
  };
  return root;
}
let elevators = [];
let arrivalElevator = null, exitElevator = null;
function updateElevatorFx(dt) {
  const t = performance.now() / 1e3;
  for (const el of elevators) {
    const u = el.userData;
    if (u.active) for (const s of u.spinners) s.rotation.y += dt * 7;
    if (u.light) u.light.intensity = u.active ? 1.25 + Math.sin(t * 14) * .35 : .45;
    if (u.column) {
      const p = .5 + .5 * Math.sin(t * 3);
      u.column.material.opacity = u.colFade * (.32 + .25 * p);
      u.ring.material.opacity = u.colFade * (.35 + .45 * p);
      u.ring.scale.setScalar(1 + .05 * p);
      u.column.visible = u.ring.visible = u.colFade > .01;
    }
  }
}
function spawnExitElevator() {
  exitElevator = buildElevator(true);
  exitElevator.position.set(exitPos.x, 0, exitPos.y);
  if (arrivalElevator && arrivalElevator.userData.light) {
    const l = arrivalElevator.userData.light;
    l.parent.remove(l);
    arrivalElevator.userData.light = null;
  }
  scene.add(exitElevator);
  zoneMeshes.push(exitElevator);
  elevators.push(exitElevator);
}
const ZONE_LIGHTING = [ {
  main: 16756834,
  alt: 16764815,
  alarm: 16726570,
  sky: 7035464,
  ground: 3812384,
  hemi: .22,
  ceil: 9075302
}, {
  main: 13624063,
  alt: 11060479,
  alarm: 16752704,
  sky: 5660782,
  ground: 2765622,
  hemi: .22,
  ceil: 8226192
}, {
  main: 10420182,
  alt: 7331024,
  alarm: 16726570,
  sky: 4086357,
  ground: 1910313,
  hemi: .2,
  ceil: 7309956
}, {
  main: 16734780,
  alt: 16752736,
  alarm: 16719904,
  sky: 6173748,
  ground: 3348765,
  hemi: .2,
  ceil: 9071206
} ];
const LAMP_LIGHT_Y = CEILING_HEIGHT - 32;
const LAMP_RANGE = 600;
const SPOT_SHARE = .75;
const CONE_H = CEILING_HEIGHT - 26;
let lampRigs = [];
let shadowSpot = null, shadowLamp = null, pendingLamp = null, shadowW = 0;
let ceilingTexCache = null, coneTexCache = null, poolTexCache = null, dotTexCache = null, glowTexCache = null;
function radialTexture(size, stops) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}
function poolTexture() {
  if (!poolTexCache) poolTexCache = radialTexture(128, [ [ 0, "rgba(255,255,255,0.9)" ], [ .35, "rgba(255,255,255,0.45)" ], [ .7, "rgba(255,255,255,0.12)" ], [ 1, "rgba(255,255,255,0)" ] ]);
  return poolTexCache;
}
function dotTexture() {
  if (!dotTexCache) dotTexCache = radialTexture(32, [ [ 0, "rgba(255,255,255,1)" ], [ .4, "rgba(255,255,255,0.5)" ], [ 1, "rgba(255,255,255,0)" ] ]);
  return dotTexCache;
}
function glowTexture() {
  if (!glowTexCache) glowTexCache = radialTexture(64, [ [ 0, "rgba(255,255,255,1)" ], [ .2, "rgba(255,255,255,0.7)" ], [ .5, "rgba(255,255,255,0.18)" ], [ 1, "rgba(255,255,255,0)" ] ]);
  return glowTexCache;
}
function coneTexture() {
  if (coneTexCache) return coneTexCache;
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(.35, "rgba(255,255,255,0.45)");
  gr.addColorStop(.8, "rgba(255,255,255,0.08)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 4, 128);
  coneTexCache = new THREE.CanvasTexture(c);
  return coneTexCache;
}
function ceilingTexture() {
  if (ceilingTexCache) return ceilingTexCache;
  ceilingTexCache = makeTexture((c, w, h) => {
    c.fillStyle = "#7a7c78";
    c.fillRect(0, 0, w, h);
    const rib = 16;
    for (let x = 0; x < w; x += rib) {
      const g = c.createLinearGradient(x, 0, x + rib, 0);
      g.addColorStop(0, "rgba(0,0,0,0.45)");
      g.addColorStop(.3, "rgba(0,0,0,0.05)");
      g.addColorStop(.5, "rgba(255,255,255,0.14)");
      g.addColorStop(.7, "rgba(0,0,0,0.05)");
      g.addColorStop(1, "rgba(0,0,0,0.45)");
      c.fillStyle = g;
      c.fillRect(x, 0, rib, h);
    }
    for (let y = 0; y < h; y += 128) {
      c.fillStyle = "rgba(0,0,0,0.6)";
      c.fillRect(0, y, w, 4);
      c.fillStyle = "rgba(255,255,255,0.08)";
      c.fillRect(0, y + 4, w, 1);
      c.fillStyle = "rgba(210,205,190,0.3)";
      for (let x = 0; x < w; x += rib) c.fillRect(x + 7, y + 8, 2, 2);
    }
    for (let i = 0; i < 14; i++) {
      const x = Math.random() * w, y = Math.random() * h, r = rand(14, 46);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(10,8,5,0.35)");
      g.addColorStop(1, "rgba(10,8,5,0)");
      c.fillStyle = g;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    c.fillStyle = "rgba(90,50,20,0.16)";
    for (let i = 0; i < 9; i++) c.fillRect(Math.random() * w, Math.random() * h, rand(2, 4), rand(20, 70));
  }, 256, 256);
  return ceilingTexCache;
}
function flickerFactor(L, t) {
  if (!L.flicker) return 1;
  const n = Math.sin(t * 2.3 + L.phase) + Math.sin(t * 5.7 + L.phase * 1.3) * .6 + Math.sin(t * 13.1 + L.phase * .7) * .4;
  if (n > 1.35) return Math.sin(t * 90) > 0 ? .08 : .65;
  if (n > 1.05) return .5;
  return 1;
}
function buildLampRig(x, z, color, intensity, flicker) {
  const objs = [];
  const light = new THREE.PointLight(color, intensity, LAMP_RANGE, 1.6);
  light.position.set(x, LAMP_LIGHT_Y, z);
  objs.push(light);
  const fixture = buildLampFixture(color);
  fixture.position.set(x, CEILING_HEIGHT - 20, z);
  objs.push(fixture);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(11, 165, CONE_H, 28, 1, true), new THREE.MeshBasicMaterial({
    color: color,
    map: coneTexture(),
    transparent: true,
    opacity: .07,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide
  }));
  cone.position.set(x, CONE_H / 2, z);
  cone.renderOrder = 3;
  objs.push(cone);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(230, 40), new THREE.MeshBasicMaterial({
    color: color,
    map: poolTexture(),
    transparent: true,
    opacity: .16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  }));
  pool.rotation.x = -Math.PI / 2;
  pool.position.set(x, .4, z);
  pool.renderOrder = 2;
  objs.push(pool);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture(),
    color: color,
    transparent: true,
    opacity: .85,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  halo.position.set(x, CEILING_HEIGHT - 28, z);
  halo.scale.set(64, 64, 1);
  halo.renderOrder = 3;
  objs.push(halo);
  const N = 42;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const y = rand(10, CONE_H - 20);
    const r = (11 + (165 - 11) * (1 - y / CONE_H)) * Math.sqrt(Math.random()) * .85;
    const a = rand(0, Math.PI * 2);
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const dustGeo = new THREE.BufferGeometry;
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    color: color,
    map: dotTexture(),
    size: 2.6,
    transparent: true,
    opacity: .5,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  }));
  dust.position.set(x, 0, z);
  dust.renderOrder = 3;
  objs.push(dust);
  return {
    x: x,
    y: z,
    light: light,
    base: intensity,
    color: new THREE.Color(color),
    flicker: !!flicker,
    f: 1,
    d: 0,
    phase: rand(0, 100),
    cone: cone,
    pool: pool,
    halo: halo,
    dust: dust,
    lensMat: fixture.userData.lensMat,
    lensBase: new THREE.Color(color),
    objs: objs
  };
}
function placeShadowSpot(L) {
  shadowSpot.color.copy(L.color);
  shadowSpot.position.set(L.x, LAMP_LIGHT_Y, L.y);
  shadowSpot.target.position.set(L.x, 0, L.y);
  shadowSpot.target.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
}
function updateLamps(dt) {
  if (!shadowSpot) return;
  if (!lampRigs.length) {
    shadowSpot.intensity = 0;
    return;
  }
  const t = performance.now() / 1e3;
  let best = null, bd = Infinity;
  for (const L of lampRigs) {
    L.f = flickerFactor(L, t);
    L.d = Math.hypot(L.x - player.x, L.y - player.y);
    if (L.d < bd) {
      bd = L.d;
      best = L;
    }
    L.cone.material.opacity = .1 * L.f;
    L.pool.material.opacity = .2 * L.f;
    L.halo.material.opacity = .85 * L.f;
    if (L.lensMat) L.lensMat.color.copy(L.lensBase).multiplyScalar(.2 + .8 * L.f);
    L.dust.rotation.y += dt * .05;
    L.dust.position.y = Math.sin(t * .35 + L.phase) * 6;
  }
  if (!shadowLamp || lampRigs.indexOf(shadowLamp) === -1) {
    shadowLamp = best;
    pendingLamp = null;
    shadowW = 0;
    placeShadowSpot(best);
  } else if (!pendingLamp && best !== shadowLamp && bd < shadowLamp.d - 70) {
    pendingLamp = best;
  }
  if (pendingLamp) {
    shadowW = Math.max(0, shadowW - dt / .3);
    if (shadowW === 0) {
      shadowLamp = pendingLamp;
      pendingLamp = null;
      placeShadowSpot(shadowLamp);
    }
  } else {
    shadowW = Math.min(1, shadowW + dt / .35);
  }
  for (const L of lampRigs) L.light.intensity = L.base * L.f * (L === shadowLamp ? 1 - SPOT_SHARE * shadowW : 1);
  shadowSpot.intensity = shadowLamp.base * shadowLamp.f * SPOT_SHARE * shadowW * 1.3;
}
function buildCeilingDetails(z, hx0, hx1, hz0, hz1) {
  const g = new THREE.Group;
  const pipeMat = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(3815478),
    color: 16777215,
    roughness: .45,
    metalness: .7
  });
  const ductMat = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(5988450),
    color: 16777215,
    roughness: .55,
    metalness: .55
  });
  const pad = 14;
  const spans = (a0, a1, h0, h1, crosses) => {
    if (!crosses) return [ [ a0, a1 ] ];
    const out = [];
    if (h0 - pad > a0) out.push([ a0, h0 - pad ]);
    if (h1 + pad < a1) out.push([ h1 + pad, a1 ]);
    return out;
  };
  const pipeY = CEILING_HEIGHT - 30;
  for (const pz of [ z.worldH * .36, z.worldH * .36 + 15, z.worldH * .66 ]) {
    const crosses = pz > hz0 - pad && pz < hz1 + pad;
    for (const [a, b] of spans(0, z.worldW, hx0, hx1, crosses)) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 4.5, b - a, 10, 1, true), pipeMat);
      m.rotation.z = Math.PI / 2;
      m.position.set((a + b) / 2, pipeY, pz);
      g.add(m);
    }
    for (let x = 70; x < z.worldW; x += 140) {
      if (crosses && x > hx0 - pad && x < hx1 + pad) continue;
      const hanger = new THREE.Mesh(new THREE.BoxGeometry(1.6, 26, 1.6), pipeMat);
      hanger.position.set(x, CEILING_HEIGHT - 15, pz);
      const clamp1 = new THREE.Mesh(new THREE.BoxGeometry(3, 11, 11), pipeMat);
      clamp1.position.set(x, pipeY, pz);
      g.add(hanger, clamp1);
    }
  }
  const dx = z.worldW * .62;
  const ductCross = dx > hx0 - pad - 20 && dx < hx1 + pad + 20;
  const ductY = CEILING_HEIGHT - 32;
  for (const [a, b] of spans(0, z.worldH, hz0, hz1, ductCross)) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(36, 14, b - a), ductMat);
    m.position.set(dx, ductY, (a + b) / 2);
    g.add(m);
    for (let zz = a + 30; zz < b - 10; zz += 60) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(39, 15, 3), ductMat);
      rib.position.set(dx, ductY, zz);
      g.add(rib);
    }
  }
  return mergeStaticChildren(g);
}
function boundary(w, h, t) {
  return [ rect(0, 0, w, t), rect(0, h - t, w, t), rect(0, 0, t, h), rect(w - t, 0, t, h) ];
}
function enemyDef(type, x, y) {
  return {
    type: type,
    x: x,
    y: y
  };
}
function pk(type, x, y, weapon) {
  return {
    type: type,
    x: x,
    y: y,
    weapon: weapon
  };
}
const ZONES = [ {
  name: "MUELLE DE CARGA",
  worldW: 2e3,
  worldH: 1400,
  playerStart: {
    x: 130,
    y: 1280
  },
  exitPos: {
    x: 1870,
    y: 110
  },
  tint: "#241d15",
  floorColor: "#3a3226",
  wallColor: "#4a4030",
  obstacles: [ ...boundary(2e3, 1400, 40), rect(300, 950, 180, 120), rect(640, 1e3, 150, 100), rect(960, 880, 210, 120), rect(1320, 950, 170, 110), rect(1660, 850, 190, 120), rect(500, 630, 200, 90), rect(920, 560, 230, 90), rect(1380, 620, 200, 90), rect(230, 320, 170, 100), rect(700, 260, 170, 100), rect(1150, 300, 200, 100), rect(1620, 280, 190, 100), rect(880, 60, 40, 320), rect(1180, 720, 40, 320) ],
  enemies: [ enemyDef("grunt", 700, 1050), enemyDef("grunt", 1400, 980), enemyDef("grunt", 1050, 480), enemyDef("heavy", 1750, 650), enemyDef("heavy", 400, 500), enemyDef("scout", 950, 1150), enemyDef("scout", 1550, 400), enemyDef("sharp", 1750, 200), enemyDef("miniboss", 1500, 480) ],
  pickups: [ pk("health", 500, 1150), pk("health", 1500, 700), pk("ammo", 900, 750), pk("ammo", 1600, 950), pk("weapon", 780, 850, "smg"), pk("weapon", 1400, 380, "shotgun"), pk("boost", 1100, 1050) ]
}, {
  name: "PATIO INDUSTRIAL",
  worldW: 2400,
  worldH: 1600,
  playerStart: {
    x: 140,
    y: 1470
  },
  exitPos: {
    x: 2260,
    y: 130
  },
  tint: "#1c1f21",
  floorColor: "#2c2f2a",
  wallColor: "#3c4038",
  obstacles: [ ...boundary(2400, 1600, 40), rect(300, 1150, 220, 140), rect(700, 1250, 180, 110), rect(1050, 1100, 220, 140), rect(1450, 1200, 200, 120), rect(1850, 1100, 220, 140), rect(2150, 1250, 160, 110), rect(400, 780, 200, 100), rect(800, 700, 240, 100), rect(1250, 780, 220, 100), rect(1700, 700, 240, 100), rect(2100, 780, 180, 100), rect(250, 350, 180, 110), rect(650, 280, 200, 110), rect(1100, 350, 220, 110), rect(1550, 280, 200, 110), rect(1980, 350, 200, 110), rect(1e3, 60, 40, 360), rect(1400, 980, 40, 360) ],
  enemies: [ enemyDef("grunt", 500, 1300), enemyDef("grunt", 1250, 1300), enemyDef("grunt", 1900, 1300), enemyDef("grunt", 900, 620), enemyDef("heavy", 1600, 850), enemyDef("heavy", 350, 900), enemyDef("heavy", 2050, 550), enemyDef("scout", 1100, 1e3), enemyDef("scout", 1750, 450), enemyDef("scout", 600, 450), enemyDef("sharp", 2200, 250), enemyDef("sharp", 400, 220), enemyDef("miniboss", 1200, 600) ],
  pickups: [ pk("health", 600, 1e3), pk("health", 1800, 950), pk("health", 1200, 250), pk("ammo", 950, 950), pk("ammo", 1650, 500), pk("ammo", 450, 550), pk("weapon", 1300, 900, "rifle"), pk("weapon", 2e3, 950, "sniper"), pk("boost", 1400, 550), pk("boost", 750, 1350) ]
}, {
  name: "COMPLEJO SUBTERRÁNEO",
  worldW: 2600,
  worldH: 1800,
  playerStart: {
    x: 140,
    y: 1660
  },
  exitPos: {
    x: 2460,
    y: 140
  },
  tint: "#131c1d",
  floorColor: "#20282a",
  wallColor: "#2f3a3c",
  obstacles: [ ...boundary(2600, 1800, 40), rect(300, 1300, 230, 150), rect(720, 1400, 190, 120), rect(1080, 1250, 230, 150), rect(1500, 1380, 210, 130), rect(1900, 1260, 230, 150), rect(2280, 1400, 170, 120), rect(350, 950, 210, 110), rect(760, 880, 250, 110), rect(1220, 960, 230, 110), rect(1680, 880, 250, 110), rect(2120, 960, 210, 110), rect(280, 550, 200, 120), rect(700, 480, 230, 120), rect(1150, 560, 230, 120), rect(1600, 480, 230, 120), rect(2050, 560, 220, 120), rect(350, 180, 190, 110), rect(800, 120, 220, 110), rect(1280, 180, 220, 110), rect(1750, 120, 220, 110), rect(2200, 180, 190, 110), rect(1150, 60, 40, 380), rect(1500, 1200, 40, 380), rect(600, 680, 40, 200), rect(1900, 700, 40, 200) ],
  enemies: [ enemyDef("grunt", 550, 1500), enemyDef("grunt", 1300, 1500), enemyDef("grunt", 2050, 1500), enemyDef("grunt", 850, 730), enemyDef("grunt", 1900, 730), enemyDef("heavy", 1650, 1080), enemyDef("heavy", 400, 1080), enemyDef("heavy", 2300, 350), enemyDef("heavy", 500, 320), enemyDef("scout", 1300, 700), enemyDef("scout", 2e3, 1100), enemyDef("scout", 700, 1150), enemyDef("scout", 1550, 300), enemyDef("sharp", 2400, 300), enemyDef("sharp", 300, 300), enemyDef("sharp", 1300, 900), enemyDef("miniboss", 1900, 1550) ],
  pickups: [ pk("health", 700, 1150), pk("health", 1900, 1150), pk("health", 1300, 350), pk("health", 500, 650), pk("ammo", 1050, 1100), pk("ammo", 1750, 350), pk("ammo", 400, 750), pk("ammo", 2100, 1050), pk("weapon", 1500, 750, "smg"), pk("weapon", 900, 300, "shotgun"), pk("weapon", 2050, 700, "sniper"), pk("weapon", 650, 1550, "rifle"), pk("boost", 1300, 1100), pk("boost", 2e3, 500), pk("boost", 500, 400) ]
}, {
  name: "NÚCLEO DEL COMPLEJO",
  worldW: 2100,
  worldH: 1500,
  boss: true,
  playerStart: {
    x: 130,
    y: 1370
  },
  exitPos: null,
  tint: "#241315",
  floorColor: "#3a2226",
  wallColor: "#4a2c30",
  obstacles: [ ...boundary(2100, 1500, 40), rect(350, 1050, 200, 120), rect(750, 1120, 180, 110), rect(1180, 1050, 200, 120), rect(1600, 1120, 220, 110), rect(280, 650, 190, 110), rect(720, 580, 220, 110), rect(1200, 650, 220, 110), rect(1650, 580, 200, 110), rect(400, 250, 200, 110), rect(850, 190, 220, 110), rect(1350, 250, 200, 110), rect(1020, 60, 40, 340) ],
  enemies: [ enemyDef("grunt", 600, 900), enemyDef("grunt", 1500, 900), enemyDef("heavy", 400, 450), enemyDef("heavy", 1700, 450), enemyDef("scout", 1050, 1200), enemyDef("sharp", 1900, 250), enemyDef("boss", 1050, 260) ],
  pickups: [ pk("health", 550, 1150), pk("health", 1550, 1150), pk("health", 1050, 700), pk("ammo", 850, 900), pk("ammo", 1250, 900), pk("ammo", 1050, 450), pk("weapon", 350, 700, "sniper"), pk("weapon", 1750, 700, "shotgun"), pk("boost", 1050, 950), pk("boost", 700, 450), pk("boost", 1400, 450) ]
} ];
let STATE = "MENU";
let zoneIndex = 0;
let world = {
  w: 2e3,
  h: 1400
};
let wallSegments = [];
let obstacles = [];
let enemies = [];
let bullets = [];
let pickups = [];
let particles = [];
let zoneMeshes = [];
let score = 0;
let bannerTimer = 0;
let camShake = 0;
let exitPos = null, exitSpawned = false, exitTriggered = false;
let camYOffset = 0;
let ext = null, arr = null;
let zoneStats = null;
function newZoneStats() {
  return {
    kills: 0,
    shots: 0,
    hits: 0,
    heads: 0,
    time: 0,
    scoreStart: score
  };
}
let muzzleFlash = 0, hitMarker = 0, critMarker = 0;
let sunLight, hemiLight;
const keys = {};
let mouseDown = false;
const player = {
  x: 130,
  y: 1280,
  angle: 0,
  pitch: 0,
  radius: 16,
  speed: 175,
  vx: 0,
  vy: 0,
  health: 100,
  maxHealth: 100,
  armor: 0,
  maxArmor: 60,
  stamina: 100,
  canSprint: true,
  alive: true,
  hitFlash: 0,
  weaponKey: "pistol",
  weapons: {
    pistol: {
      mag: 12,
      reserve: 36
    },
    knife: {
      mag: 0,
      reserve: 0
    }
  },
  slots: [ "pistol", null, "knife" ],
  activeSlotIdx: 0,
  aiming: false,
  inspecting: false,
  inspectT: 0,
  fireCd: 0,
  reloading: false,
  reloadT: 0,
  boosts: []
};
let gunViewGroup = null, gunLight = null;
function cw() {
  return player.weapons[player.weaponKey];
}
function maxReserve(key) {
  return WEAPONS[key].magSize * 4;
}
function hasBoost(type) {
  return player.boosts.some(b => b.type === type);
}
function damagePlayer(dmg) {
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, dmg);
    player.armor -= absorbed;
    dmg -= absorbed;
  }
  if (dmg > 0) player.health -= dmg;
}
let zoneTextures = [];
function clearZoneMeshes() {
  for (const m of zoneMeshes) {
    scene.remove(m);
    disposeObject3D(m);
  }
  zoneMeshes = [];
  for (const t of zoneTextures) t.dispose();
  zoneTextures = [];
}
function scaleBoxUVs(geo, w, h, d, tile) {
  const uv = geo.attributes.uv;
  const spans = [ [ d, h ], [ d, h ], [ w, d ], [ w, d ], [ w, h ], [ w, h ] ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const idx = f * 4 + i;
      uv.setXY(idx, uv.getX(idx) * spans[f][0] / tile, uv.getY(idx) * spans[f][1] / tile);
    }
  }
}
function createEnemyInstance(type, x, y) {
  const t = ENEMY_TYPES[type];
  const mesh = buildHumanoid(type);
  mesh.position.set(x, 0, y);
  scene.add(mesh);
  zoneMeshes.push(mesh);
  const patrolRadius = type === "sharp" ? rand(150, 230) : type === "scout" ? rand(90, 150) : rand(110, 190);
  return {
    ...t,
    type: type,
    x: x,
    y: y,
    angle: 0,
    hp: t.hp,
    maxHp: t.hp,
    alive: true,
    fireCd: rand(.2, 1.2),
    spawnFade: 1,
    mesh: mesh,
    walkT: rand(0, 10),
    state: "idle",
    homeX: x,
    homeY: y,
    lastSeenX: x,
    lastSeenY: y,
    awareTimer: 0,
    moveHeading: 0,
    flankOffset: rand(-1.15, 1.15),
    flankDir: Math.random() < .5 ? 1 : -1,
    strafeDir: Math.random() < .5 ? 1 : -1,
    strafeTimer: rand(1.5, 3.5),
    hitFlash: 0,
    flashMats: mesh.userData.flashMats,
    patrolPoints: buildPatrolRoute(x, y, patrolRadius),
    patrolIdx: 0,
    patrolPause: rand(0, 2),
    jukeSeed: rand(0, 100)
  };
}
function spawnReinforcements(x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = rand(0, Math.PI * 2);
    const nx = clamp(x + Math.cos(a) * 140, 30, world.w - 30);
    const ny = clamp(y + Math.sin(a) * 140, 30, world.h - 30);
    const inst = createEnemyInstance("grunt", nx, ny);
    inst.state = "aware";
    inst.lastSeenX = player.x;
    inst.lastSeenY = player.y;
    inst.awareTimer = 5;
    enemies.push(inst);
  }
}
function loadZone(idx, keepHealth) {
  const z = ZONES[idx];
  world.w = z.worldW;
  world.h = z.worldH;
  obstacles = z.obstacles;
  wallSegments = [];
  for (const o of obstacles) wallSegments.push(...rectToSegments(o));
  clearZoneMeshes();
  clearParticles();
  scene.background = new THREE.Color(z.tint);
  scene.fog = new THREE.Fog(new THREE.Color(z.tint), 260, Math.max(z.worldW, z.worldH) * .85);
  const floorGeo = new THREE.PlaneGeometry(z.worldW * 1.4, z.worldH * 1.4);
  const floorTex = floorTexture(z.floorColor);
  floorTex.repeat.set(z.worldW / 90, z.worldH / 90);
  const floor = new THREE.Mesh(floorGeo, new THREE.MeshLambertMaterial({
    map: floorTex
  }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(z.worldW / 2, 0, z.worldH / 2);
  floor.receiveShadow = true;
  scene.add(floor);
  zoneMeshes.push(floor);
  const wallTex = wallTexture(z.wallColor);
  const aoMat = new THREE.MeshBasicMaterial({
    map: contactShadowTexture(),
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4
  });
  const wallGeos = [], aoGeos = [];
  const aoPad = 24;
  for (const o of obstacles) {
    const w = o.w, h = o.h;
    const box = new THREE.BoxGeometry(w, WALL_HEIGHT, h);
    scaleBoxUVs(box, w, WALL_HEIGHT, h, 60);
    box.translate(o.x + w / 2, WALL_HEIGHT / 2, o.y + h / 2);
    wallGeos.push(bakedGeometry(box));
    box.dispose();
    const ao = new THREE.PlaneGeometry(w + aoPad * 2, h + aoPad * 2);
    ao.rotateX(-Math.PI / 2);
    ao.translate(o.x + w / 2, .25, o.y + h / 2);
    aoGeos.push(bakedGeometry(ao));
    ao.dispose();
  }
  const wallMesh = new THREE.Mesh(concatGeometries(wallGeos), new THREE.MeshLambertMaterial({
    map: wallTex
  }));
  wallMesh.castShadow = true;
  wallMesh.receiveShadow = true;
  scene.add(wallMesh);
  zoneMeshes.push(wallMesh);
  const aoMesh = new THREE.Mesh(concatGeometries(aoGeos), aoMat);
  aoMesh.renderOrder = 1;
  scene.add(aoMesh);
  zoneMeshes.push(aoMesh);
  for (const g of wallGeos) g.dispose();
  for (const g of aoGeos) g.dispose();
  const zl = ZONE_LIGHTING[idx % ZONE_LIGHTING.length];
  zoneTextures.push(floorTex, wallTex);
  const holeHalf = PLAT / 2 + 1;
  const hx0 = z.playerStart.x - holeHalf, hx1 = z.playerStart.x + holeHalf;
  const hz0 = z.playerStart.y - holeHalf, hz1 = z.playerStart.y + holeHalf;
  const cx0 = -z.worldW * .2, cx1 = z.worldW * 1.2, cz0 = -z.worldH * .2, cz1 = z.worldH * 1.2;
  const ceilPieces = [ [ cx0, hx0, cz0, cz1 ], [ hx1, cx1, cz0, cz1 ], [ hx0, hx1, cz0, hz0 ], [ hx0, hx1, hz1, cz1 ] ].map(([xa, xb, za, zb]) => {
    const g = new THREE.PlaneGeometry(xb - xa, zb - za);
    g.rotateX(Math.PI / 2);
    g.translate((xa + xb) / 2, CEILING_HEIGHT, (za + zb) / 2);
    const pos = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 160, pos.getZ(i) / 160);
    const ng = bakedGeometry(g);
    g.dispose();
    return ng;
  });
  const ceiling = new THREE.Mesh(concatGeometries(ceilPieces), new THREE.MeshLambertMaterial({
    map: ceilingTexture(),
    color: zl.ceil
  }));
  for (const g of ceilPieces) g.dispose();
  scene.add(ceiling);
  zoneMeshes.push(ceiling);
  const beamMat = new THREE.MeshStandardMaterial({
    map: gunPanelTexture(1512463),
    color: 16777215,
    roughness: .75,
    metalness: .35
  });
  const beamGap = 260;
  const beamGroup = new THREE.Group;
  const addBeam = (x0, x1, z0, z1) => {
    if (x1 - x0 < 1 || z1 - z0 < 1) return;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 22, z1 - z0), beamMat);
    beam.position.set((x0 + x1) / 2, CEILING_HEIGHT - 13, (z0 + z1) / 2);
    beam.castShadow = true;
    beamGroup.add(beam);
  };
  const gap = holeHalf + 6;
  for (let bx = beamGap / 2; bx < z.worldW; bx += beamGap) {
    if (Math.abs(bx - z.playerStart.x) < gap + 7) {
      addBeam(bx - 7, bx + 7, 0, z.playerStart.y - gap);
      addBeam(bx - 7, bx + 7, z.playerStart.y + gap, z.worldH);
    } else addBeam(bx - 7, bx + 7, 0, z.worldH);
  }
  for (let bz = beamGap / 2; bz < z.worldH; bz += beamGap) {
    if (Math.abs(bz - z.playerStart.y) < gap + 7) {
      addBeam(0, z.playerStart.x - gap, bz - 7, bz + 7);
      addBeam(z.playerStart.x + gap, z.worldW, bz - 7, bz + 7);
    } else addBeam(0, z.worldW, bz - 7, bz + 7);
  }
  const frameMat = new THREE.MeshStandardMaterial({
    map: hazardTexture(),
    color: 16777215,
    roughness: .6,
    metalness: .2
  });
  for (const s of [ -1, 1 ]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(holeHalf * 2 + 20, 6, 10), frameMat);
    a.position.set(z.playerStart.x, CEILING_HEIGHT - 3, z.playerStart.y + s * (holeHalf + 5));
    const b = new THREE.Mesh(new THREE.BoxGeometry(10, 6, holeHalf * 2), frameMat);
    b.position.set(z.playerStart.x + s * (holeHalf + 5), CEILING_HEIGHT - 3, z.playerStart.y);
    beamGroup.add(a, b);
  }
  mergeStaticChildren(beamGroup);
  scene.add(beamGroup);
  zoneMeshes.push(beamGroup);
  const details = buildCeilingDetails(z, hx0, hx1, hz0, hz1);
  scene.add(details);
  zoneMeshes.push(details);
  hemiLight.color.setHex(zl.sky);
  hemiLight.groundColor.setHex(zl.ground);
  hemiLight.intensity = zl.hemi;
  const sectorSpots = [ {
    fx: .22,
    fy: .28,
    color: zl.main,
    intensity: 2.3
  }, {
    fx: .78,
    fy: .3,
    color: zl.main,
    intensity: 2.2
  }, {
    fx: .5,
    fy: .58,
    color: zl.alt,
    intensity: 2.4
  }, {
    fx: .24,
    fy: .82,
    color: zl.main,
    intensity: 2.1
  }, {
    fx: .78,
    fy: .84,
    color: zl.alarm,
    intensity: 1.7,
    flicker: true
  } ];
  lampRigs = [];
  shadowLamp = null;
  pendingLamp = null;
  shadowW = 0;
  for (const sp of sectorSpots) {
    const rig = buildLampRig(sp.fx * z.worldW, sp.fy * z.worldH, sp.color, sp.intensity, sp.flicker);
    for (const o of rig.objs) {
      scene.add(o);
      zoneMeshes.push(o);
    }
    lampRigs.push(rig);
  }
  enemies = z.enemies.map(e => createEnemyInstance(e.type, e.x, e.y));
  pickups = z.pickups.map(p => {
    const spot = findClearSpot(p.x, p.y, 18);
    const inst = {
      ...p,
      x: spot.x,
      y: spot.y,
      collected: false,
      bob: rand(0, 6),
      boostKind: p.type === "boost" ? BOOST_KINDS[Math.floor(Math.random() * BOOST_KINDS.length)] : null
    };
    const mesh = buildPickupMesh(inst);
    mesh.position.x = spot.x;
    mesh.position.z = spot.y;
    scene.add(mesh);
    zoneMeshes.push(mesh);
    inst.mesh = mesh;
    inst.baseY = mesh.position.y;
    return inst;
  });
  nearbyPickup = null;
  setPrompt(null);
  for (const b of bullets) if (b.mesh) scene.remove(b.mesh);
  bullets = [];
  exitPos = z.exitPos;
  exitSpawned = false;
  exitTriggered = false;
  exitElevator = null;
  player.x = z.playerStart.x;
  player.y = z.playerStart.y;
  player.angle = 0;
  player.pitch = 0;
  player.alive = true;
  player.health = keepHealth ? Math.min(player.maxHealth, player.health) : player.maxHealth;
  if (!keepHealth) player.stamina = 100;
  arrivalElevator = buildElevator(false);
  arrivalElevator.position.set(z.playerStart.x, 0, z.playerStart.y);
  scene.add(arrivalElevator);
  zoneMeshes.push(arrivalElevator);
  elevators = [ arrivalElevator ];
  document.getElementById("hudZoneNum").textContent = String(idx + 1);
  document.getElementById("hudZoneName").textContent = z.name;
  zoneStats = newZoneStats();
  ext = null;
  arr = {
    t: 0,
    phase: "descend",
    bannerShown: false,
    clank: false
  };
  setArrivalHeight(ARRIVE_HEIGHT);
  STATE = "ARRIVE";
  playElevatorRumble(ARRIVE_DUR);
  refreshHUD();
}
const $ = id => document.getElementById(id);
function showScreen(id) {
  [ "menuScreen", "pauseScreen", "gameOverScreen", "victoryScreen" ].forEach(s => $(s).classList.add("hidden"));
  if (id) $(id).classList.remove("hidden");
}
function showBanner(text, sub) {
  $("bannerText").textContent = text;
  $("bannerSub").textContent = sub;
  $("banner").classList.remove("hidden");
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => $("banner").classList.add("hidden"), 1600);
}
function exitLockSafe() {
  try {
    if (document.pointerLockElement === gameCanvas) document.exitPointerLock();
  } catch (e) {}
}
function requestLockSafe() {
  try {
    gameCanvas.requestPointerLock();
  } catch (e) {}
}
function prewarmShaders() {
  if (!renderer || !scene || !camera) return;
  const temp = [];
  const cx = player.x + Math.cos(player.angle) * 150;
  const cz = player.y + Math.sin(player.angle) * 150;
  let ix = 0;
  const next = obj => {
    obj.position.set(cx + (ix % 6 - 2.5) * 40, EYE_HEIGHT + Math.floor(ix / 6) * 40, cz);
    scene.add(obj);
    temp.push(obj);
    ix++;
  };
  for (const kind of BOOST_KINDS) next(buildPickupMesh({
    type: "boost",
    boostKind: kind
  }));
  next(buildPickupMesh({
    type: "health"
  }));
  next(buildPickupMesh({
    type: "ammo"
  }));
  for (const wk of Object.keys(WEAPONS)) next(buildPickupMesh({
    type: "weapon",
    weapon: wk
  }));
  for (const type of Object.keys(ENEMY_TYPES)) next(buildHumanoid(type));
  next(new THREE.Mesh(impactParticleGeo, basicMat(16777215)));
  next(new THREE.Mesh(bulletGeo(true), basicMat(16773808)));
  next(new THREE.Mesh(bulletGeo(false), basicMat(16734778)));
  const exitPreview = buildElevator(true);
  exitPreview.userData.platform.remove(exitPreview.userData.light);
  next(exitPreview);
  const prevX = camera.position.x, prevY = camera.position.y, prevZ = camera.position.z;
  const prevRotX = camera.rotation.x, prevRotY = camera.rotation.y;
  camera.position.set(player.x, EYE_HEIGHT, player.y);
  camera.rotation.set(0, yawFromAngle(player.angle), 0);
  camera.updateMatrixWorld(true);
  try {
    renderer.shadowMap.needsUpdate = true;
    renderer.render(scene, camera);
    renderer.compile(scene, camera);
  } catch (err) {}
  renderer.shadowMap.needsUpdate = true;
  camera.position.set(prevX, prevY, prevZ);
  camera.rotation.set(prevRotX, prevRotY, 0);
  for (const m of temp) scene.remove(m);
}
function startGame() {
  if (boot3DFailed) return;
  ensureAudio();
  score = 0;
  zoneIndex = 0;
  ZONES.forEach(z => {
    delete z._cleared;
  });
  player.maxHealth = 100;
  player.health = 100;
  player.stamina = 100;
  player.armor = 0;
  player.weaponKey = "pistol";
  player.weapons = {
    pistol: {
      mag: WEAPONS.pistol.magSize,
      reserve: 36
    },
    knife: {
      mag: 0,
      reserve: 0
    }
  };
  player.slots = [ "pistol", null, "knife" ];
  player.activeSlotIdx = 0;
  player.aiming = false;
  player.inspecting = false;
  player.inspectT = 0;
  player.boosts = [];
  showScreen(null);
  hideZoneSummary();
  $("hud").classList.remove("hidden");
  loadZone(0, false);
  buildViewmodel();
  prewarmShaders();
  requestLockSafe();
}
function setPaused(p) {
  if (p) {
    STATE = "PAUSED";
    showScreen("pauseScreen");
    exitLockSafe();
    setAiming(false);
  } else {
    STATE = "PLAYING";
    showScreen(null);
    requestLockSafe();
  }
}
function showGameOver() {
  STATE = "GAMEOVER";
  exitLockSafe();
  setAiming(false);
  $("hud").classList.add("hidden");
  $("gameOverStats").textContent = `ZONA ALCANZADA: ${zoneIndex + 1} · PUNTOS: ${score}`;
  showScreen("gameOverScreen");
}
function showVictory() {
  STATE = "VICTORY";
  exitLockSafe();
  setAiming(false);
  $("hud").classList.add("hidden");
  $("victoryStats").textContent = `PUNTOS FINALES: ${score}`;
  showScreen("victoryScreen");
}
function backToMenu() {
  STATE = "MENU";
  setFade(0);
  hideZoneSummary();
  camYOffset = 0;
  exitLockSafe();
  setAiming(false);
  $("hud").classList.add("hidden");
  showScreen("menuScreen");
}
$("btnStart").addEventListener("click", startGame);
$("btnResume").addEventListener("click", () => setPaused(false));
$("btnQuitToMenu").addEventListener("click", backToMenu);
$("btnRetry").addEventListener("click", startGame);
$("btnRetryMenu").addEventListener("click", backToMenu);
$("btnPlayAgain").addEventListener("click", startGame);
$("btnVictoryMenu").addEventListener("click", backToMenu);
window.addEventListener("keydown", e => {
  keys[e.code] = true;
  if (STATE === "EXTRACT" && ext && ext.phase === "summary") ext.skip = true;
  if (e.code === "KeyR") tryReload();
  if (e.code === "KeyF") tryPickupItem();
  if (e.code === "Escape") {
    if (STATE === "PLAYING") setPaused(true); else if (STATE === "PAUSED") setPaused(false);
  }
  if (e.code === "Space") {
    tryShoot();
    e.preventDefault();
  }
  if (e.code === "Digit1") switchToSlot(0);
  if (e.code === "Digit2") switchToSlot(1);
  if (e.code === "Digit3") switchToSlot(2);
  if (e.code === "KeyY") tryInspect();
  if ([ "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space" ].includes(e.code)) e.preventDefault();
});
window.addEventListener("keyup", e => {
  keys[e.code] = false;
});
gameCanvas.addEventListener("click", () => {
  if (STATE === "PLAYING" && document.pointerLockElement !== gameCanvas) requestLockSafe();
});
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement !== gameCanvas && STATE === "PLAYING") setPaused(true);
});
document.addEventListener("mousemove", e => {
  if (document.pointerLockElement === gameCanvas) {
    player.angle = normAngle(player.angle + e.movementX * MOUSE_SENS);
    player.pitch = clamp(player.pitch - e.movementY * MOUSE_SENS, -1.35, 1.35);
  }
});
document.addEventListener("mousedown", e => {
  if (STATE === "EXTRACT" && ext && ext.phase === "summary") {
    ext.skip = true;
    return;
  }
  if (e.button === 0) mouseDown = true;
  if (e.button === 2 && STATE === "PLAYING" && player.alive) setAiming(true);
});
document.addEventListener("mouseup", e => {
  if (e.button === 0) mouseDown = false;
  if (e.button === 2) setAiming(false);
});
gameCanvas.addEventListener("contextmenu", e => e.preventDefault());
function switchToSlot(idx) {
  if (STATE !== "PLAYING" || !player.alive) return;
  const key = player.slots[idx];
  if (!key || player.activeSlotIdx === idx) return;
  player.activeSlotIdx = idx;
  player.weaponKey = key;
  player.reloading = false;
  player.inspecting = false;
  setAiming(false);
  buildViewmodel();
}
function tryInspect() {
  if (STATE !== "PLAYING" || !player.alive) return;
  if (player.inspecting || player.reloading || player.aiming) return;
  player.inspecting = true;
  player.inspectT = 0;
}
function setAiming(v) {
  if (v && (STATE !== "PLAYING" || !player.alive)) return;
  player.aiming = v;
  if (v) player.inspecting = false;
  if (gunViewGroup) gunViewGroup.visible = !v || player.weaponKey !== "sniper";
  const scope = $("scopeOverlay");
  const isSniper = player.weaponKey === "sniper";
  if (scope) scope.classList.toggle("hidden", !(v && isSniper));
  camera.fov = v ? isSniper ? 16 : 45 : 75;
  camera.updateProjectionMatrix();
}
function tryShoot() {
  if (STATE !== "PLAYING" || !player.alive) return;
  player.inspecting = false;
  if (player.weaponKey === "knife") {
    tryMeleeAttack();
    return;
  }
  const w = WEAPONS[player.weaponKey];
  const s = cw();
  if (player.reloading) return;
  if (player.fireCd > 0) return;
  if (s.mag <= 0) {
    tryReload();
    return;
  }
  s.mag--;
  if (zoneStats) zoneStats.shots += w.pellets || 1;
  const fireRateMul = hasBoost("firerate") ? .62 : 1;
  player.fireCd = w.fireRate * fireRateMul;
  camShake = Math.min(camShake + 1.2, 6);
  muzzleFlash = .08;
  alertNearbyEnemies(player.x, player.y, 640);
  playShot(player.weaponKey);
  const dmgMul = hasBoost("damage") ? 1.5 : 1;
  let spread = w.spread;
  if (player.aiming) spread *= .16;
  if (hasBoost("precision")) spread *= .4;
  const pellets = w.pellets || 1;
  for (let i = 0; i < pellets; i++) {
    const a = player.angle + rand(-spread, spread);
    const p = clamp(player.pitch + rand(-spread * .6, spread * .6), -1.35, 1.35);
    spawnBullet(player.x, player.y, EYE_HEIGHT, a, p, w.bulletSpeed, w.dmg * dmgMul, "player");
  }
}
function tryMeleeAttack() {
  if (player.fireCd > 0) return;
  player.fireCd = WEAPONS.knife.fireRate;
  if (zoneStats) zoneStats.shots++;
  camShake = Math.min(camShake + .8, 6);
  playHitThud(false);
  const range = 60;
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const dx = e.x - player.x, dy = e.y - player.y;
    const d = Math.hypot(dx, dy);
    if (d > range + e.radius) continue;
    const angTo = Math.atan2(dy, dx);
    if (Math.abs(normAngle(angTo - player.angle)) > .9) continue;
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  if (!best) return;
  if (zoneStats) zoneStats.hits++;
  const dmg = WEAPONS.knife.dmg * (hasBoost("damage") ? 1.5 : 1);
  const killed = best.hp - dmg <= 0;
  best.hp -= dmg;
  best.hitFlash = .18;
  hitMarker = .16;
  best.state = "aware";
  best.lastSeenX = player.x;
  best.lastSeenY = player.y;
  best.awareTimer = rand(3, 5);
  spawnImpactParticles(best.x, EYE_HEIGHT * .5 * (best.scale || 1), best.y, killed ? 2758418 : 11745578, killed ? 8 : 5, 100);
  if (killed) {
    score += best.score;
    if (best.guaranteedBoost) dropBoostPickup(best.x, best.y); else maybeDropPickup(best.x, best.y);
    killEnemy(best);
  }
}
function tryReload() {
  if (STATE !== "PLAYING" || !player.alive) return;
  if (player.weaponKey === "knife") return;
  player.inspecting = false;
  const w = WEAPONS[player.weaponKey];
  const s = cw();
  if (player.reloading || s.mag === w.magSize || s.reserve <= 0) return;
  player.reloading = true;
  player.reloadT = w.reloadTime;
  playReload();
}
const bulletGeos = {};
function bulletGeo(isPlayer) {
  const k = isPlayer ? "p" : "e";
  if (!bulletGeos[k]) bulletGeos[k] = new THREE.CylinderGeometry(.9, .9, isPlayer ? 13 : 10, 6);
  return bulletGeos[k];
}
function spawnBullet(x, y, h, angle, pitch, speed, dmg, owner) {
  const isPlayer = owner === "player";
  const horizSpeed = speed * Math.cos(pitch);
  const vh = speed * Math.sin(pitch);
  const dir = new THREE.Vector3(Math.cos(angle) * Math.cos(pitch), Math.sin(pitch), Math.sin(angle) * Math.cos(pitch));
  const mesh = new THREE.Mesh(bulletGeo(isPlayer), basicMat(isPlayer ? 16773808 : 16734778));
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  let visualStart = null;
  if (isPlayer && gunViewGroup) {
    gunViewGroup.updateMatrixWorld(true);
    const muzzle = gunViewGroup.localToWorld(new THREE.Vector3(0, 0, gunViewGroup.userData.muzzleZ || -20));
    visualStart = {
      x: muzzle.x,
      y: muzzle.y,
      z: muzzle.z
    };
    mesh.position.copy(muzzle);
  } else {
    mesh.position.set(x, h, y);
  }
  scene.add(mesh);
  bullets.push({
    x: x,
    y: y,
    h: h,
    vx: Math.cos(angle) * horizSpeed,
    vy: Math.sin(angle) * horizSpeed,
    vh: vh,
    dmg: dmg,
    owner: owner,
    radius: 4,
    life: 2.4,
    mesh: mesh,
    visualStart: visualStart,
    visualT: visualStart ? 0 : 1
  });
}
function update(dt) {
  if (camShake > 0) camShake = Math.max(0, camShake - dt * 10);
  if (muzzleFlash > 0) muzzleFlash = Math.max(0, muzzleFlash - dt);
  if (hitMarker > 0) hitMarker = Math.max(0, hitMarker - dt);
  if (critMarker > 0) critMarker = Math.max(0, critMarker - dt);
  if (STATE === "PLAYING" || STATE === "EXTRACT" || STATE === "ARRIVE" || STATE === "INTRO") updateElevatorFx(dt);
  if (STATE === "INTRO") {
    bannerTimer -= dt;
    if (bannerTimer <= 0) STATE = "PLAYING";
    return;
  }
  if (STATE === "EXTRACT") {
    updateExtraction(dt);
    updateParticles(dt);
    refreshHUD();
    return;
  }
  if (STATE === "ARRIVE") {
    updateArrival(dt);
    refreshHUD();
    return;
  }
  if (STATE !== "PLAYING") return;
  if (zoneStats) zoneStats.time += dt;
  updatePlayer(dt);
  updateEnemies(dt);
  updateBullets(dt);
  updatePickups(dt);
  updateParticles(dt);
  refreshHUD();
  if (player.health <= 0 && player.alive) {
    player.alive = false;
    setTimeout(() => {
      showGameOver();
    }, 450);
  }
  const remaining = enemies.filter(e => e.alive).length;
  if (remaining === 0 && player.alive) {
    const z = ZONES[zoneIndex];
    if (z.boss || zoneIndex >= ZONES.length - 1) {
      if (!z._cleared) {
        z._cleared = true;
        score += 100;
        showVictory();
      }
    } else if (!exitSpawned) {
      exitSpawned = true;
      score += 50 * (zoneIndex + 1);
      player.health = Math.min(player.maxHealth, player.health + 20);
      showBanner("ZONA DESPEJADA", "SUBE AL ASCENSOR DE EXTRACCIÓN");
      spawnExitElevator();
      playAlarmBeep(520, .25);
    }
  }
  if (exitSpawned && !exitTriggered && exitPos && player.alive) {
    if (Math.abs(player.x - exitPos.x) < PLAT / 2 - 10 && Math.abs(player.y - exitPos.y) < PLAT / 2 - 10) {
      startExtraction();
    }
  }
}
const BOARD_DUR = .95, DESCEND_DUR = 2.7, DESCEND_DEPTH = 390, SUMMARY_MIN = .9, SUMMARY_MAX = 6;
const ARRIVE_DUR = 2.8, ARRIVE_HEIGHT = CEILING_HEIGHT + 150, RAILS_LOWER_DUR = .5;
function easeInOut(k) {
  return k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
}
function setFade(v) {
  const el = $("transitionFade");
  if (!el) return;
  const op = clamp(v, 0, 1).toFixed(3);
  if (el._op !== op) {
    el._op = op;
    el.style.opacity = op;
  }
}
function startExtraction() {
  exitTriggered = true;
  STATE = "EXTRACT";
  mouseDown = false;
  setAiming(false);
  player.inspecting = false;
  player._moving = false;
  setPrompt(null);
  ext = {
    phase: "board",
    t: 0,
    fromX: player.x,
    fromY: player.y,
    beeps: 0,
    skip: false
  };
}
function updateExtraction(dt) {
  ext.t += dt;
  const u = exitElevator.userData;
  if (ext.phase === "board") {
    const k = easeInOut(clamp(ext.t / BOARD_DUR, 0, 1));
    player.x = ext.fromX + (exitPos.x - ext.fromX) * k;
    player.y = ext.fromY + (exitPos.y - ext.fromY) * k;
    u.rails.position.y = RAIL_DOWN * (1 - k);
    u.colFade = 1 - k;
    if (ext.beeps < 3 && ext.t >= ext.beeps * .28) {
      playAlarmBeep(880, .13);
      ext.beeps++;
    }
    if (ext.t >= BOARD_DUR) {
      ext.phase = "descend";
      ext.t = 0;
      camShake = Math.max(camShake, 2.5);
      playElevatorClank();
      playElevatorRumble(DESCEND_DUR);
    }
  } else if (ext.phase === "descend") {
    const k = clamp(ext.t / DESCEND_DUR, 0, 1);
    const y = -DESCEND_DEPTH * k * k;
    u.platform.position.y = y;
    camYOffset = y;
    camShake = Math.max(camShake, .55);
    setFade((k - .62) / .38);
    if (k >= 1) {
      ext.phase = "summary";
      ext.t = 0;
      camShake = 0;
      showZoneSummary();
    }
  } else if (ext.phase === "summary") {
    setFade(1);
    if (ext.t > SUMMARY_MAX || ext.t > SUMMARY_MIN && ext.skip) {
      hideZoneSummary();
      zoneIndex++;
      loadZone(zoneIndex, true);
    }
  }
}
function setArrivalHeight(y) {
  if (arrivalElevator) arrivalElevator.userData.platform.position.y = y;
  camYOffset = y;
}
function updateArrival(dt) {
  arr.t += dt;
  const u = arrivalElevator.userData;
  if (arr.phase === "descend") {
    const k = clamp(arr.t / ARRIVE_DUR, 0, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const h = ARRIVE_HEIGHT * (1 - e);
    setArrivalHeight(h);
    setFade(1 - arr.t / .7);
    camShake = Math.max(camShake, .35 * (1 - k));
    if (!arr.bannerShown && h < CEILING_HEIGHT - EYE_HEIGHT) {
      arr.bannerShown = true;
      const z = ZONES[zoneIndex];
      showBanner(`ZONA ${zoneIndex + 1}`, z.name);
    }
    if (k >= 1) {
      arr.phase = "lower";
      arr.t = 0;
      setArrivalHeight(0);
      camShake = 1.6;
      playElevatorClank();
    }
  } else if (arr.phase === "lower") {
    const k = clamp(arr.t / RAILS_LOWER_DUR, 0, 1);
    u.rails.position.y = RAIL_DOWN * easeInOut(k);
    if (k >= 1) {
      u.active = false;
      camYOffset = 0;
      arr = null;
      STATE = "PLAYING";
    }
  }
}
function formatTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return m + ":" + String(r).padStart(2, "0");
}
function showZoneSummary() {
  const z = ZONES[zoneIndex], nz = ZONES[zoneIndex + 1];
  const st = zoneStats || newZoneStats();
  $("zsTitle").textContent = `ZONA ${zoneIndex + 1} DESPEJADA`;
  $("zsZone").textContent = z.name;
  $("zsKills").textContent = String(st.kills);
  $("zsTime").textContent = formatTime(st.time);
  $("zsAcc").textContent = st.shots > 0 ? Math.round(st.hits / st.shots * 100) + "%" : "—";
  $("zsHeads").textContent = String(st.heads);
  $("zsScore").textContent = "+" + (score - st.scoreStart);
  $("zsNext").textContent = nz ? `DESCENDIENDO A ZONA ${zoneIndex + 2} — ${nz.name}` : "";
  const card = $("zoneSummary");
  card.classList.remove("hidden");
  card.classList.remove("show");
  void card.offsetWidth;
  card.classList.add("show");
}
function hideZoneSummary() {
  const card = $("zoneSummary");
  if (card) card.classList.add("hidden");
}
function playAlarmBeep(freq, dur) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.setValueAtTime(freq * .82, t0 + dur * .5);
  const g = ctx.createGain();
  g.gain.setValueAtTime(.0001, t0);
  g.gain.exponentialRampToValueAtTime(.13, t0 + .01);
  g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  osc.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + .02);
}
function playElevatorClank() {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = getNoiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 420;
  bp.Q.value = 2.5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(.5, t0);
  g.gain.exponentialRampToValueAtTime(.001, t0 + .3);
  src.connect(bp);
  bp.connect(g);
  g.connect(ctx.destination);
  src.start(t0);
  src.stop(t0 + .32);
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.exponentialRampToValueAtTime(48, t0 + .25);
  const og = ctx.createGain();
  og.gain.setValueAtTime(.3, t0);
  og.gain.exponentialRampToValueAtTime(.001, t0 + .28);
  osc.connect(og);
  og.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + .3);
}
function playElevatorRumble(dur) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(42, t0);
  osc.frequency.linearRampToValueAtTime(58, t0 + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 220;
  const g = ctx.createGain();
  g.gain.setValueAtTime(.0001, t0);
  g.gain.exponentialRampToValueAtTime(.16, t0 + .25);
  g.gain.setValueAtTime(.16, t0 + dur - .35);
  g.gain.exponentialRampToValueAtTime(.001, t0 + dur);
  osc.connect(lp);
  lp.connect(g);
  g.connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + .05);
}
function updatePlayer(dt) {
  if (!player.alive) return;
  const prevX = player.x, prevY = player.y;
  const fwd = {
    x: Math.cos(player.angle),
    y: Math.sin(player.angle)
  };
  const right = {
    x: Math.cos(player.angle + Math.PI / 2),
    y: Math.sin(player.angle + Math.PI / 2)
  };
  let mx = 0, my = 0;
  if (keys["KeyW"] || keys["ArrowUp"]) {
    mx += fwd.x;
    my += fwd.y;
  }
  if (keys["KeyS"] || keys["ArrowDown"]) {
    mx -= fwd.x;
    my -= fwd.y;
  }
  if (keys["KeyD"]) {
    mx += right.x;
    my += right.y;
  }
  if (keys["KeyA"]) {
    mx -= right.x;
    my -= right.y;
  }
  const len = Math.hypot(mx, my);
  const moving = len > .001;
  if (moving) {
    mx /= len;
    my /= len;
  }
  const wantsSprint = (keys["ShiftLeft"] || keys["ShiftRight"]) && moving;
  let sprinting = false;
  if (wantsSprint && player.canSprint && player.stamina > 0) {
    sprinting = true;
    player.stamina = Math.max(0, player.stamina - dt * 32);
    if (player.stamina <= 0) player.canSprint = false;
  } else {
    player.stamina = Math.min(100, player.stamina + dt * 16);
    if (player.stamina >= 30) player.canSprint = true;
  }
  let speed = player.speed * (sprinting ? 1.65 : 1);
  if (hasBoost("speed")) speed *= 1.4;
  if (player.aiming) speed *= .45;
  player.x += mx * speed * dt;
  player.y += my * speed * dt;
  player.x = clamp(player.x, 24, world.w - 24);
  player.y = clamp(player.y, 24, world.h - 24);
  for (const o of obstacles) circleRectPush(player, o);
  if (player.fireCd > 0) player.fireCd -= dt;
  if (player.hitFlash > 0) player.hitFlash -= dt;
  if (player.reloading) {
    player.reloadT -= dt;
    if (player.reloadT <= 0) {
      const w = WEAPONS[player.weaponKey];
      const s = cw();
      const need = w.magSize - s.mag;
      const take = Math.min(need, s.reserve);
      s.mag += take;
      s.reserve -= take;
      player.reloading = false;
    }
  }
  if (mouseDown || keys["Space"]) tryShoot();
  for (let i = player.boosts.length - 1; i >= 0; i--) {
    player.boosts[i].t -= dt;
    if (player.boosts[i].t <= 0) player.boosts.splice(i, 1);
  }
  player._moving = moving;
  player._sprinting = sprinting;
  player.vx = (player.x - prevX) / dt;
  player.vy = (player.y - prevY) / dt;
}
function clearLineDir(x, y, angle, checkDist, segs) {
  const dx = Math.cos(angle), dy = Math.sin(angle);
  for (const s of segs) {
    const t = rayHit(x, y, dx, dy, checkDist, s.x1, s.y1, s.x2, s.y2);
    if (t !== null) return false;
  }
  return true;
}
function pickMoveAngle(e, desiredAngle) {
  const checkDist = 60;
  if (clearLineDir(e.x, e.y, desiredAngle, checkDist, wallSegments)) return desiredAngle;
  for (const delta of [ .4, .8, 1.25, 1.7, 2.3 ]) {
    if (clearLineDir(e.x, e.y, desiredAngle + delta, checkDist, wallSegments)) return desiredAngle + delta;
    if (clearLineDir(e.x, e.y, desiredAngle - delta, checkDist, wallSegments)) return desiredAngle - delta;
  }
  return desiredAngle;
}
function steerToward(e, tx, ty, dt, speedMul) {
  const desired = Math.atan2(ty - e.y, tx - e.x);
  const a = pickMoveAngle(e, desired);
  if (e.moveHeading === undefined) e.moveHeading = a;
  const maxTurn = 7.5 * dt;
  let diff = normAngle(a - e.moveHeading);
  diff = clamp(diff, -maxTurn, maxTurn);
  e.moveHeading = normAngle(e.moveHeading + diff);
  e.x += Math.cos(e.moveHeading) * e.speed * (speedMul || 1) * dt;
  e.y += Math.sin(e.moveHeading) * e.speed * (speedMul || 1) * dt;
}
function alertNearbyEnemies(x, y, radius) {
  for (const e of enemies) {
    if (!e.alive || e.state === "aware") continue;
    if (dist(e.x, e.y, x, y) < radius) {
      e.state = "aware";
      e.lastSeenX = x;
      e.lastSeenY = y;
      e.awareTimer = rand(2.5, 4);
    }
  }
}
function pointBlocked(x, y, margin) {
  const m = margin || 12;
  for (const o of obstacles) {
    if (x > o.x - m && x < o.x + o.w + m && y > o.y - m && y < o.y + o.h + m) return true;
  }
  return false;
}
function findClearSpot(x, y, margin) {
  if (!pointBlocked(x, y, margin)) return {
    x: x,
    y: y
  };
  for (let r = 20; r <= 140; r += 20) {
    for (let a = 0; a < Math.PI * 2; a += Math.PI / 6) {
      const nx = clamp(x + Math.cos(a) * r, 20, world.w - 20);
      const ny = clamp(y + Math.sin(a) * r, 20, world.h - 20);
      if (!pointBlocked(nx, ny, margin)) return {
        x: nx,
        y: ny
      };
    }
  }
  return {
    x: x,
    y: y
  };
}
function buildPatrolRoute(cx, cy, radius) {
  const count = 2 + Math.floor(Math.random() * 2);
  const pts = [ {
    x: cx,
    y: cy
  } ];
  let lastAngle = rand(0, Math.PI * 2);
  for (let i = 0; i < count; i++) {
    lastAngle += Math.PI * 2 / count * rand(.7, 1.3);
    let x, y, tries = 0;
    do {
      const r = rand(radius * .45, radius);
      x = clamp(cx + Math.cos(lastAngle) * r, 30, world.w - 30);
      y = clamp(cy + Math.sin(lastAngle) * r, 30, world.h - 30);
      tries++;
    } while (pointBlocked(x, y) && tries < 6);
    pts.push({
      x: x,
      y: y
    });
  }
  return pts;
}
function idlePatrol(e, dt) {
  if (!e.patrolPoints || e.patrolPoints.length === 0) return;
  if (e.patrolPause > 0) {
    e.patrolPause -= dt;
    return;
  }
  const target = e.patrolPoints[e.patrolIdx];
  if (dist(e.x, e.y, target.x, target.y) < 16) {
    e.patrolIdx = (e.patrolIdx + 1) % e.patrolPoints.length;
    e.patrolPause = rand(.35, 1);
    return;
  }
  steerToward(e, target.x, target.y, dt, .62);
}
function updateHitFlash(e, dt) {
  if (e.hitFlash > 0 && e.flashMats) {
    e.hitFlash = Math.max(0, e.hitFlash - dt * 3.2);
    const t = e.hitFlash / .18;
    for (const m of e.flashMats) m.emissive.setRGB(t, t * .12, t * .08);
  }
}
function killEnemy(e) {
  e.alive = false;
  if (zoneStats) zoneStats.kills++;
  e.dying = true;
  e.deathT = 0;
  e.deathDur = rand(.45, .65);
  e.deathAngleDone = 0;
  e.deathTotalAngle = rand(Math.PI * .46, Math.PI * .56);
  const fdx = e.x - player.x, fdy = e.y - player.y;
  const flen = Math.hypot(fdx, fdy) || 1;
  const dirx = fdx / flen, dirz = fdy / flen;
  e.deathAxis = new THREE.Vector3(-dirz, 0, dirx);
  playDeath(clamp(1 - flen / 900, .15, 1));
}
function updateEnemyDeath(e, dt) {
  updateHitFlash(e, dt);
  const remaining = e.deathTotalAngle - e.deathAngleDone;
  if (remaining <= 8e-4) {
    e.dying = false;
    return;
  }
  const step = Math.min(remaining, e.deathTotalAngle / e.deathDur * dt);
  e.mesh.rotateOnWorldAxis(e.deathAxis, step);
  e.deathAngleDone += step;
}
function updateEnemies(dt) {
  for (const e of enemies) {
    if (!e.alive) {
      if (e.dying) updateEnemyDeath(e, dt);
      continue;
    }
    if (e.spawnFade > 0) e.spawnFade = Math.max(0, e.spawnFade - dt * 2);
    const prevX = e.x, prevY = e.y;
    const d = dist(e.x, e.y, player.x, player.y);
    const angToPlayer = Math.atan2(player.y - e.y, player.x - e.x);
    const angDiff = Math.abs(normAngle(angToPlayer - e.angle));
    const inFov = d < 130 || angDiff < (e.fov || 1.2);
    const los = player.alive && inFov && hasLOS(e.x, e.y, player.x, player.y, wallSegments);
    if (e.type === "boss" && !e.enraged && e.hp < e.maxHp * .5) {
      e.enraged = true;
      e.speed *= 1.3;
      e.fireRate *= .65;
      e.spread *= .6;
      e.burst = (e.burst || 1) + 2;
      spawnReinforcements(e.x, e.y, 2);
    }
    if (e.type === "boss" && !e.enraged2 && e.hp < e.maxHp * .2) {
      e.enraged2 = true;
      e.speed *= 1.2;
      e.fireRate *= .75;
      e.barrageReady = true;
      spawnReinforcements(e.x, e.y, 3);
    }
    if (e.barrageReady && e.barrageCd == null) e.barrageCd = rand(2, 3.5);
    if (e.barrageReady && e.barrageCd > 0) e.barrageCd -= dt;
    if (e.barrageReady && e.barrageCd <= 0 && los && d < e.range * 1.3) {
      e.barrageCd = rand(6, 8.5);
      e.barrageWindup = .55;
      e.hitFlash = .58;
    }
    if (e.barrageWindup > 0) {
      e.barrageWindup -= dt;
      e.angle = Math.atan2(player.y - e.y, player.x - e.x);
      if (e.barrageWindup <= 0) {
        const baseA = Math.atan2(player.y - e.y, player.x - e.x);
        const pellets = 9;
        for (let i = 0; i < pellets; i++) {
          const a = baseA + (i - (pellets - 1) / 2) * .11;
          spawnBullet(e.x + Math.cos(a) * (e.radius + 4), e.y + Math.sin(a) * (e.radius + 4), EYE_HEIGHT * .5 * (e.scale || 1), a, 0, e.bulletSpeed, e.dmg * .6, "enemy");
        }
        playShot(e.heldWeapon, clamp(1 - d / 900, .1, 1) * .7);
        camShake = Math.min(camShake + 1, 8);
      }
    }
    if (los && d < e.sight) {
      e.state = "aware";
      e.lastSeenX = player.x;
      e.lastSeenY = player.y;
      e.awareTimer = 3;
    } else if (e.state === "aware") {
      e.awareTimer -= dt;
      if (e.awareTimer <= 0) e.state = "idle";
    }
    if (los && d < e.sight) e.angle = Math.atan2(player.y - e.y, player.x - e.x);
    if (e.state === "idle") {
      idlePatrol(e, dt);
    } else if (e.melee) {
      const baseA = Math.atan2(player.y - e.y, player.x - e.x);
      const contactRange = e.radius + player.radius + 6;
      if (player.alive && d >= contactRange) {
        const juke = Math.sin(performance.now() / 260 + e.jukeSeed) * .5;
        steerToward(e, e.x + Math.cos(baseA + juke) * 40, e.y + Math.sin(baseA + juke) * 40, dt, 1);
      }
      if (player.alive && d < contactRange) {
        e.angle = baseA;
        if (e.fireCd <= 0) {
          damagePlayer(e.dmg);
          player.hitFlash = .25;
          camShake = Math.min(camShake + 3, 8);
          e.fireCd = e.atkCd || .8;
        }
      } else if (los) {
        e.angle = baseA;
      }
    } else if (e.keepsDistance) {
      if (los && d < e.sight) {
        if (d > e.range * .9) steerToward(e, player.x, player.y, dt, .55); else if (d < e.range * .5) steerToward(e, e.x - (player.x - e.x), e.y - (player.y - e.y), dt, .4); else {
          e.strafeTimer -= dt;
          if (e.strafeTimer <= 0) {
            e.strafeDir *= -1;
            e.strafeTimer = rand(1.5, 3.5);
          }
          const sideA = e.angle + Math.PI / 2 * e.strafeDir;
          steerToward(e, e.x + Math.cos(sideA) * 50, e.y + Math.sin(sideA) * 50, dt, .45);
        }
        if (e.fireCd <= 0 && d < e.range) {
          e.fireCd = e.fireRate * rand(.85, 1.15);
          fireEnemyBullet(e);
        }
      } else {
        steerToward(e, e.lastSeenX, e.lastSeenY, dt, .5);
      }
    } else {
      if (e.barrageWindup > 0) {} else if (los && d < e.range) {
        e.flankOffset = normAngle(e.flankOffset + dt * .18 * e.flankDir);
        const standDist = e.range * .6;
        const targetA = e.angle + e.flankOffset;
        const tx = player.x - Math.cos(targetA) * standDist;
        const ty = player.y - Math.sin(targetA) * standDist;
        if (dist(e.x, e.y, tx, ty) > 26) steerToward(e, tx, ty, dt, .7);
        if (e.fireCd <= 0) {
          e.fireCd = e.fireRate * rand(.85, 1.15);
          const shots = e.burst || 1;
          for (let s = 0; s < shots; s++) fireEnemyBullet(e);
        }
      } else if (los && d < e.sight) {
        steerToward(e, player.x, player.y, dt, .85);
      } else {
        if (dist(e.x, e.y, e.lastSeenX, e.lastSeenY) > 20) steerToward(e, e.lastSeenX, e.lastSeenY, dt, .7);
      }
    }
    for (const o of obstacles) circleRectPush(e, o);
    for (const o2 of enemies) {
      if (o2 === e || !o2.alive) continue;
      const dd = dist(e.x, e.y, o2.x, o2.y);
      const minD = e.radius + o2.radius + 4;
      if (dd > 0 && dd < minD) {
        const push = (minD - dd) / 2;
        const ax = (e.x - o2.x) / dd, ay = (e.y - o2.y) / dd;
        e.x += ax * push;
        e.y += ay * push;
      }
    }
    if (player.alive) {
      const pdx = e.x - player.x, pdy = e.y - player.y;
      const pdd = Math.hypot(pdx, pdy);
      const minPD = e.radius + player.radius;
      if (pdd > 0 && pdd < minPD) {
        const push = minPD - pdd;
        e.x += pdx / pdd * push;
        e.y += pdy / pdd * push;
      } else if (pdd === 0) {
        e.x += minPD;
      }
    }
    e.x = clamp(e.x, 20, world.w - 20);
    e.y = clamp(e.y, 20, world.h - 20);
    e.fireCd -= dt;
    const moved = dist(prevX, prevY, e.x, e.y) > .05;
    if (moved && !(los && d < e.sight)) {
      e.angle = Math.atan2(e.y - prevY, e.x - prevX);
    }
    updateHitFlash(e, dt);
    e.walkT += dt * (moved ? 8 : 2.2);
    const u = e.mesh.userData;
    const amp = moved ? .7 : .12;
    u.leftLeg.rotation.x = Math.sin(e.walkT) * amp;
    u.rightLeg.rotation.x = -Math.sin(e.walkT) * amp;
    u.leftArm.rotation.x = 1.25 + Math.sin(e.walkT + Math.PI) * amp * .12;
    u.rightArm.rotation.x = 1 + Math.sin(e.walkT) * amp * .1;
    if (u.gun) {
      u.gun.position.y = u.gunBaseY + Math.sin(e.walkT) * amp * .4;
      u.gun.rotation.z = Math.sin(e.walkT) * amp * .05;
    }
    e.mesh.position.set(e.x, 0, e.y);
    e.mesh.rotation.y = yawFromAngle(e.angle);
    e.mesh.visible = e.alive;
  }
}
function fireEnemyBullet(e) {
  const d = Math.max(dist(e.x, e.y, player.x, player.y), 1);
  const t = clamp(d / e.bulletSpeed, 0, 1.1);
  const leadX = player.x + (player.vx || 0) * t * .8;
  const leadY = player.y + (player.vy || 0) * t * .8;
  const baseAngle = Math.atan2(leadY - e.y, leadX - e.x);
  const a = baseAngle + rand(-e.spread, e.spread);
  spawnBullet(e.x + Math.cos(a) * (e.radius + 4), e.y + Math.sin(a) * (e.radius + 4), EYE_HEIGHT * .5 * (e.scale || 1), a, 0, e.bulletSpeed, e.dmg, "enemy");
  playShot(e.heldWeapon, clamp(1 - d / 900, .1, 1) * .55);
}
const impactParticleGeo = new THREE.BoxGeometry(2, 2, 2);
const MAX_PARTICLES = 160;
function spawnImpactParticles(x, y, z, colorHex, count, speed) {
  const mat = basicMat(colorHex);
  count = Math.min(count, MAX_PARTICLES - particles.length);
  for (let i = 0; i < count; i++) {
    const m = new THREE.Mesh(impactParticleGeo, mat);
    m.position.set(x, y, z);
    scene.add(m);
    const a = rand(0, Math.PI * 2);
    const el = rand(.15, .95);
    const sp = speed * rand(.4, 1);
    const maxLife = rand(.25, .45);
    particles.push({
      mesh: m,
      vx: Math.cos(a) * Math.cos(el) * sp,
      vy: Math.sin(el) * sp,
      vz: Math.sin(a) * Math.cos(el) * sp,
      life: maxLife,
      maxLife: maxLife
    });
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      scene.remove(p.mesh);
      particles[i] = particles[particles.length - 1];
      particles.pop();
      continue;
    }
    p.vy -= 260 * dt;
    p.mesh.position.x += p.vx * dt;
    p.mesh.position.y += p.vy * dt;
    p.mesh.position.z += p.vz * dt;
    if (p.mesh.position.y < 0) {
      p.mesh.position.y = 0;
      p.vy *= -.3;
      p.vx *= .7;
      p.vz *= .7;
    }
    const k = p.life / p.maxLife;
    p.mesh.scale.setScalar(Math.max(.05, k));
  }
}
function clearParticles() {
  for (const p of particles) scene.remove(p.mesh);
  particles = [];
}
function updateBullets(dt) {
  for (const b of bullets) {
    if (b.dead) continue;
    const px = b.x, py = b.y, ph = b.h;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.h += b.vh * dt;
    b.life -= dt;
    if (b.life <= 0 || b.x < 0 || b.x > world.w || b.y < 0 || b.y > world.h) {
      b.dead = true;
      continue;
    }
    if (b.h < 0 || b.h > CEILING_HEIGHT - 6) {
      const targetH = b.h < 0 ? 0 : CEILING_HEIGHT;
      const t = clamp((targetH - ph) / (b.h - ph || 1), 0, 1);
      spawnImpactParticles(px + (b.x - px) * t, targetH, py + (b.y - py) * t, 9075290, 4, 70);
      b.dead = true;
      continue;
    }
    const segDist = Math.hypot(b.x - px, b.y - py) || 1;
    const ndx = (b.x - px) / segDist, ndy = (b.y - py) / segDist;
    for (const s of wallSegments) {
      const t = rayHit(px, py, ndx, ndy, segDist, s.x1, s.y1, s.x2, s.y2);
      if (t !== null) {
        spawnImpactParticles(px + ndx * t, b.h, py + ndy * t, 14272928, 4, 80);
        b.dead = true;
        break;
      }
    }
    if (b.dead) continue;
    if (b.owner === "player") {
      for (const e of enemies) {
        if (!e.alive) continue;
        if (dist(b.x, b.y, e.x, e.y) < e.radius + b.radius) {
          const s = e.scale || 1;
          if (b.h > 96 * s || b.h < -6) continue;
          const zone = b.h >= 58 * s ? "head" : b.h >= 30 * s ? "vest" : "legs";
          const zoneMul = zone === "head" ? 2.2 : zone === "vest" ? .55 : 1;
          const dmg = b.dmg * zoneMul;
          const killed = e.hp - dmg <= 0;
          e.hp -= dmg;
          b.dead = true;
          hitMarker = .16;
          if (zone === "head") critMarker = .24;
          if (zoneStats) {
            zoneStats.hits++;
            if (zone === "head") zoneStats.heads++;
          }
          e.hitFlash = .18;
          if (!killed) {
            e.state = "aware";
            e.lastSeenX = player.x;
            e.lastSeenY = player.y;
            e.awareTimer = rand(3, 5);
          }
          const klen = Math.hypot(b.vx, b.vy) || 1;
          e.x += b.vx / klen * (killed ? 5 : 3);
          e.y += b.vy / klen * (killed ? 5 : 3);
          camShake = Math.min(camShake + (killed ? 1.4 : .5), 8);
          spawnImpactParticles(b.x, b.h, b.y, killed ? 2758418 : zone === "head" ? 16764778 : 11745578, killed ? 8 : 5, killed ? 140 : 95);
          playHitThud(zone === "head" || killed);
          if (killed) {
            score += e.score;
            if (e.guaranteedBoost) dropBoostPickup(e.x, e.y); else maybeDropPickup(e.x, e.y);
            killEnemy(e);
          }
          break;
        }
      }
    } else if (b.owner === "enemy" && player.alive) {
      if (dist(b.x, b.y, player.x, player.y) < player.radius + b.radius) {
        damagePlayer(b.dmg);
        b.dead = true;
        player.hitFlash = .25;
        camShake = Math.min(camShake + 3, 8);
      }
    }
    if (!b.dead) {
      if (b.visualT < 1) {
        b.visualT = Math.min(1, b.visualT + dt / .05);
        b.mesh.position.set(b.visualStart.x + (b.x - b.visualStart.x) * b.visualT, b.visualStart.y + (b.h - b.visualStart.y) * b.visualT, b.visualStart.z + (b.y - b.visualStart.z) * b.visualT);
      } else {
        b.mesh.position.set(b.x, b.h, b.y);
      }
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) {
    if (bullets[i].dead) {
      scene.remove(bullets[i].mesh);
      bullets.splice(i, 1);
    }
  }
}
function maybeDropPickup(x, y) {
  const roll = Math.random();
  let type = null;
  if (roll < .14) type = "ammo"; else if (roll < .22) type = "health";
  if (!type) return;
  const spot = findClearSpot(x, y, 18);
  const inst = {
    type: type,
    x: spot.x,
    y: spot.y,
    collected: false,
    bob: 0,
    boostKind: null
  };
  const mesh = buildPickupMesh(inst);
  mesh.position.x = spot.x;
  mesh.position.z = spot.y;
  scene.add(mesh);
  zoneMeshes.push(mesh);
  inst.mesh = mesh;
  inst.baseY = mesh.position.y;
  pickups.push(inst);
}
const BOOST_KINDS = [ "speed", "damage", "precision", "firerate", "armor" ];
function dropBoostPickup(x, y) {
  const kind = BOOST_KINDS[Math.floor(Math.random() * BOOST_KINDS.length)];
  const spot = findClearSpot(x, y, 18);
  const inst = {
    type: "boost",
    x: spot.x,
    y: spot.y,
    collected: false,
    bob: rand(0, 6),
    boostKind: kind
  };
  const mesh = buildPickupMesh(inst);
  mesh.position.x = spot.x;
  mesh.position.z = spot.y;
  scene.add(mesh);
  zoneMeshes.push(mesh);
  inst.mesh = mesh;
  inst.baseY = mesh.position.y;
  pickups.push(inst);
}
let nearbyPickup = null;
const AUTO_PICKUP_RADIUS = 30;
const WEAPON_PICKUP_RADIUS = 26;
const BOOST_NAMES = {
  speed: "VELOCIDAD",
  damage: "DAÑO",
  precision: "PRECISIÓN",
  firerate: "CADENCIA",
  armor: "CHALECO ANTIBALAS"
};
function boostFullLabel(kind) {
  return "IMPULSO DE " + (BOOST_NAMES[kind] || kind.toUpperCase());
}
function pickupLabel(p) {
  if (p.type === "health") return "BOTIQUÍN";
  if (p.type === "ammo") return "MUNICIÓN";
  if (p.type === "weapon") return WEAPONS[p.weapon].name;
  if (p.type === "boost") return boostFullLabel(p.boostKind);
  return "OBJETO";
}
function updatePickups(dt) {
  nearbyPickup = null;
  let bestD = Infinity;
  let blockedHint = null;
  let anyCollected = false;
  for (const p of pickups) {
    if (p.collected) continue;
    p.bob += dt * 3;
    p.mesh.rotation.y += dt * 1.4;
    p.mesh.position.y = p.baseY + Math.sin(p.bob) * 4;
    if (!player.alive) continue;
    const dx = p.x - player.x, dy = p.y - player.y;
    if (p.type === "weapon") {
      const d = Math.hypot(dx, dy);
      if (d < player.radius + WEAPON_PICKUP_RADIUS && d < bestD) {
        bestD = d;
        nearbyPickup = p;
      }
      continue;
    }
    const r = player.radius + AUTO_PICKUP_RADIUS;
    if (dx * dx + dy * dy < r * r) {
      if (applyConsumablePickup(p)) {
        collectPickup(p);
        anyCollected = true;
      } else if (!blockedHint) {
        blockedHint = p.type === "health" ? "SALUD AL MÁXIMO" : p.type === "ammo" ? "MUNICIÓN AL MÁXIMO" : "CHALECO AL MÁXIMO";
      }
    }
  }
  if (anyCollected) pickups = pickups.filter(p => !p.collected);
  let promptText = null;
  if (STATE === "PLAYING") {
    if (nearbyPickup) promptText = "PULSA F · RECOGER " + pickupLabel(nearbyPickup); else if (blockedHint) promptText = blockedHint;
  }
  setPrompt(promptText);
}
let lastPromptText = null;
function setPrompt(text) {
  if (text === lastPromptText) return;
  lastPromptText = text;
  const prompt = $("pickupPrompt");
  if (!prompt) return;
  if (text) {
    prompt.textContent = text;
    prompt.classList.remove("hidden");
  } else {
    prompt.classList.add("hidden");
  }
}
function giveAmmo() {
  const order = [ player.weaponKey, ...player.slots ];
  const seen = new Set;
  for (const k of order) {
    if (!k || k === "knife" || seen.has(k) || !player.weapons[k]) continue;
    seen.add(k);
    const s = player.weapons[k];
    const mr = maxReserve(k);
    if (s.reserve < mr) {
      const gained = Math.min(mr - s.reserve, WEAPONS[k].magSize * 2);
      s.reserve += gained;
      return {
        key: k,
        gained: gained
      };
    }
  }
  return null;
}
function applyConsumablePickup(p) {
  if (p.type === "health") {
    if (player.health >= player.maxHealth) return false;
    const before = player.health;
    player.health = Math.min(player.maxHealth, player.health + 30);
    score += 2;
    showPickupToast("+" + Math.round(player.health - before) + " SALUD", "health");
    return true;
  }
  if (p.type === "ammo") {
    const res = giveAmmo();
    if (!res) return false;
    score += 2;
    showPickupToast("+" + res.gained + " MUNICIÓN · " + WEAPONS[res.key].name, "ammo");
    return true;
  }
  if (p.type === "boost") {
    if (p.boostKind === "armor") {
      if (player.armor >= player.maxArmor) return false;
      player.armor = Math.min(player.maxArmor, player.armor + 30);
      showPickupToast("+30 CHALECO", "boost");
    } else {
      player.boosts.push({
        type: p.boostKind,
        t: rand(30, 70)
      });
      showPickupToast(boostFullLabel(p.boostKind), "boost");
    }
    score += 5;
    return true;
  }
  return false;
}
function collectPickup(p) {
  p.collected = true;
  scene.remove(p.mesh);
  playPickupSound(p.type);
}
function showPickupToast(text, kind) {
  const el = $("pickupToast");
  if (!el) return;
  el.textContent = text;
  el.className = "toast-" + kind;
  void el.offsetWidth;
  el.classList.add("show");
}
function playPickupSound(type) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const notes = type === "health" ? [ 520, 780 ] : type === "ammo" ? [ 330, 440 ] : type === "weapon" ? [ 260, 390 ] : [ 660, 990 ];
  notes.forEach((f, i) => {
    const t = t0 + i * .07;
    const osc = ctx.createOscillator();
    osc.type = type === "ammo" || type === "weapon" ? "square" : "triangle";
    osc.frequency.setValueAtTime(f, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.12, t);
    g.gain.exponentialRampToValueAtTime(.001, t + .09);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + .1);
  });
}
function dropWeaponOnGround(weaponKeyToDrop, x, y) {
  const spot = findClearSpot(x, y, 18);
  const inst = {
    type: "weapon",
    weapon: weaponKeyToDrop,
    x: spot.x,
    y: spot.y,
    collected: false,
    bob: rand(0, 6)
  };
  const mesh = buildPickupMesh(inst);
  mesh.position.x = spot.x;
  mesh.position.z = spot.y;
  scene.add(mesh);
  zoneMeshes.push(mesh);
  inst.mesh = mesh;
  inst.baseY = mesh.position.y;
  pickups.push(inst);
}
function pickupWeapon(weaponKeyPicked) {
  if (player.slots.includes(weaponKeyPicked)) {
    const mr = maxReserve(weaponKeyPicked);
    player.weapons[weaponKeyPicked].reserve = Math.min(mr, player.weapons[weaponKeyPicked].reserve + WEAPONS[weaponKeyPicked].magSize);
    return;
  }
  const emptyIdx = player.slots.findIndex(s => s === null);
  if (emptyIdx !== -1) {
    player.slots[emptyIdx] = weaponKeyPicked;
    player.weapons[weaponKeyPicked] = {
      mag: WEAPONS[weaponKeyPicked].magSize,
      reserve: WEAPONS[weaponKeyPicked].magSize * 2
    };
    player.activeSlotIdx = emptyIdx;
    player.weaponKey = weaponKeyPicked;
    buildViewmodel();
    return;
  }
  const replacedIdx = player.activeSlotIdx === 2 ? 0 : player.activeSlotIdx;
  const replacedKey = player.slots[replacedIdx];
  dropWeaponOnGround(replacedKey, player.x, player.y);
  delete player.weapons[replacedKey];
  player.slots[replacedIdx] = weaponKeyPicked;
  player.weapons[weaponKeyPicked] = {
    mag: WEAPONS[weaponKeyPicked].magSize,
    reserve: WEAPONS[weaponKeyPicked].magSize * 2
  };
  player.activeSlotIdx = replacedIdx;
  player.weaponKey = weaponKeyPicked;
  buildViewmodel();
}
function tryPickupItem() {
  if (STATE !== "PLAYING" || !player.alive || !nearbyPickup) return;
  const p = nearbyPickup;
  if (p.type !== "weapon") return;
  collectPickup(p);
  pickups = pickups.filter(q => q !== p);
  pickupWeapon(p.weapon);
  score += 15;
  showPickupToast(WEAPONS[p.weapon].name, "weapon");
  nearbyPickup = null;
  setPrompt(null);
}
function disposeObject3D(obj) {
  obj.traverse(o => {
    if (o.isSprite) {
      if (o.material && !o.material.userData.shared) o.material.dispose();
      return;
    }
    if (o.isMesh || o.isPoints) {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [ o.material ];
      for (const m of mats) {
        if (m && !m.userData.shared) m.dispose();
      }
    }
  });
}
function buildViewmodel() {
  if (gunViewGroup) {
    camera.remove(gunViewGroup);
    if (gunLight) gunViewGroup.remove(gunLight);
    disposeObject3D(gunViewGroup);
  }
  gunViewGroup = buildGunMesh(player.weaponKey);
  gunViewGroup.scale.setScalar(player.weaponKey === "knife" ? .7 : 1);
  gunViewGroup.position.set(16, -16, -28);
  gunViewGroup.rotation.y = player.weaponKey === "knife" ? 0 : Math.PI;
  if (!gunLight) {
    gunLight = new THREE.PointLight(16107610, 0, 60);
  }
  gunViewGroup.add(gunLight);
  gunLight.position.set(0, 4, gunViewGroup.userData.muzzleZ || -30);
  camera.add(gunViewGroup);
}
function updateCameraAndViewmodel(dt) {
  let sx = 0, sy2 = 0, sz = 0;
  if (camShake > 0) {
    const ts = performance.now() / 1e3;
    sx = camShake * (Math.sin(ts * 41.3) * .6 + Math.sin(ts * 67.9 + 1.7) * .4);
    sy2 = camShake * (Math.sin(ts * 47.1 + .5) * .6 + Math.sin(ts * 73.3 + 2.9) * .4);
    sz = camShake * (Math.sin(ts * 43.7 + 4.1) * .6 + Math.sin(ts * 59.3 + .9) * .4);
  }
  camera.position.set(player.x + sx, EYE_HEIGHT + camYOffset + sy2, player.y + sz);
  camera.rotation.y = yawFromAngle(player.angle);
  camera.rotation.x = player.pitch;
  camera.rotation.z = 0;
  if (gunViewGroup) {
    const t = performance.now() / 1e3;
    const baseYaw = player.weaponKey === "knife" ? 0 : Math.PI;
    if (player.inspecting) {
      player.inspectT += dt;
      const dur = 1.7;
      if (player.inspectT >= dur) {
        player.inspecting = false;
        gunViewGroup.rotation.set(0, baseYaw, 0);
      } else {
        const p = player.inspectT / dur;
        const ease = Math.sin(p * Math.PI);
        if (player.weaponKey === "knife") {
          gunViewGroup.position.set(2, -6 - ease * 2, -18);
          gunViewGroup.rotation.set(.12 * Math.sin(p * Math.PI * 4), baseYaw + p * Math.PI * 4, .08 * Math.sin(p * Math.PI * 6));
        } else {
          gunViewGroup.position.set(4, -6 - ease * 2, -20);
          gunViewGroup.rotation.set(.25 * Math.sin(p * Math.PI * 2), baseYaw + ease * 1.1, .18 * Math.sin(p * Math.PI * 3));
        }
      }
    } else {
      const moving = player._moving && STATE === "PLAYING";
      const rate = player._sprinting ? 13 : 8;
      const bobY = moving ? Math.sin(t * rate) * 2.2 : Math.sin(t * 1.6) * .6;
      const bobX = moving ? Math.cos(t * rate * .5) * 1.6 : 0;
      const kick = player.fireCd > 0 ? player.fireCd / WEAPONS[player.weaponKey].fireRate * 6 : 0;
      if (player.weaponKey === "knife") {
        const swingT = player.fireCd > 0 ? player.fireCd / WEAPONS.knife.fireRate : 0;
        const swing = Math.sin(swingT * Math.PI);
        gunViewGroup.position.set(11 + bobX - swing * 7, -13 + bobY, -22 - swing * 11);
        gunViewGroup.rotation.set(.6 - swing * .35, baseYaw + .1 - swing * .6, .12);
      } else {
        gunViewGroup.position.set(16 + bobX, -16 + bobY, -28 + kick);
        gunViewGroup.rotation.set(0, baseYaw, 0);
      }
    }
    if (gunLight) gunLight.intensity = muzzleFlash > 0 ? 3.2 : 0;
  }
  if (hitFlashEl) {
    const op = (clamp(player.hitFlash / .25, 0, 1) * .35).toFixed(3);
    if (hitFlashEl._op !== op) {
      hitFlashEl._op = op;
      hitFlashEl.style.opacity = op;
    }
  }
}
const MM_RANGE = 520;
const MM_PICKUP_COLORS = {
  health: "#e06a6a",
  ammo: "#e8c35a",
  weapon: "#dcd7c9",
  boost: "#5ad0e0"
};
function updateMinimap() {
  if (!mmCtx) return;
  const W = minimapCanvas.width, H = minimapCanvas.height;
  const s = W / (MM_RANGE * 2);
  const c = mmCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.save();
  c.beginPath();
  c.arc(W / 2, H / 2, W / 2, 0, Math.PI * 2);
  c.clip();
  c.fillStyle = "rgba(14,18,12,0.6)";
  c.fillRect(0, 0, W, H);
  c.setTransform(s, 0, 0, s, W / 2 - player.x * s, H / 2 - player.y * s);
  const x0 = player.x - MM_RANGE, x1 = player.x + MM_RANGE, y0 = player.y - MM_RANGE, y1 = player.y + MM_RANGE;
  c.fillStyle = "#6e6650";
  for (const o of obstacles) {
    if (o.x > x1 || o.x + o.w < x0 || o.y > y1 || o.y + o.h < y0) continue;
    c.fillRect(o.x, o.y, o.w, o.h);
  }
  const pulse = .5 + .5 * Math.sin(performance.now() / 180);
  if (exitSpawned && exitPos) {
    c.fillStyle = "#e8a33d";
    c.fillRect(exitPos.x - PLAT / 2, exitPos.y - PLAT / 2, PLAT, PLAT);
    c.strokeStyle = `rgba(255,190,90,${.35 + .65 * pulse})`;
    c.lineWidth = 14;
    c.beginPath();
    c.arc(exitPos.x, exitPos.y, PLAT * .75 + pulse * 40, 0, Math.PI * 2);
    c.stroke();
  }
  for (const p of pickups) {
    if (p.collected) continue;
    c.fillStyle = MM_PICKUP_COLORS[p.type] || "#fff";
    c.fillRect(p.x - 10, p.y - 10, 20, 20);
  }
  c.fillStyle = "#e04545";
  for (const e of enemies) {
    if (!e.alive || e.state !== "aware") continue;
    c.beginPath();
    c.arc(e.x, e.y, Math.max(14, e.radius), 0, Math.PI * 2);
    c.fill();
  }
  c.restore();
  if (exitSpawned && exitPos && !exitTriggered) {
    const dx = exitPos.x - player.x, dy = exitPos.y - player.y;
    if (Math.hypot(dx, dy) > MM_RANGE * .85) {
      const a = Math.atan2(dy, dx);
      const r = W / 2 - W * .07;
      c.save();
      c.translate(W / 2 + Math.cos(a) * r, H / 2 + Math.sin(a) * r);
      c.rotate(a);
      const sz = W * .06;
      c.fillStyle = `rgba(232,163,61,${.55 + .45 * pulse})`;
      c.beginPath();
      c.moveTo(sz, 0);
      c.lineTo(-sz * .7, sz * .75);
      c.lineTo(-sz * .7, -sz * .75);
      c.closePath();
      c.fill();
      c.restore();
    }
  }
  if (mmArrow) mmArrow.style.transform = `translate(-50%,-50%) rotate(${player.angle + Math.PI / 2}rad)`;
}
function render(dt) {
  frameCount++;
  updateQuality(dt);
  updateLamps(dt);
  updateCameraAndViewmodel(dt);
  if (frameCount % 2 === 0) renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  if (frameCount % 2 === 1) updateMinimap();
}
const hudCache = {};
const hudEls = {};
function hudEl(id) {
  if (!(id in hudEls)) hudEls[id] = document.getElementById(id);
  return hudEls[id];
}
function hudText(id, v) {
  const key = "t:" + id;
  if (hudCache[key] === v) return;
  hudCache[key] = v;
  const el = hudEl(id);
  if (el) el.textContent = v;
}
function hudWidth(id, frac) {
  const v = (clamp(frac, 0, 1) * 100).toFixed(1) + "%";
  const key = "w:" + id;
  if (hudCache[key] === v) return;
  hudCache[key] = v;
  const el = hudEl(id);
  if (el) el.style.width = v;
}
function hudHidden(id, hidden) {
  const key = "h:" + id;
  if (hudCache[key] === hidden) return;
  hudCache[key] = hidden;
  const el = hudEl(id);
  if (el) el.classList.toggle("hidden", hidden);
}
function hudClass(id, cls, on) {
  const key = "c:" + id + ":" + cls;
  if (hudCache[key] === on) return;
  hudCache[key] = on;
  const el = hudEl(id);
  if (el) el.classList.toggle(cls, on);
}
function refreshHUD() {
  let remaining = 0, bossEnemy = null;
  for (const e of enemies) {
    if (!e.alive) continue;
    remaining++;
    if (e.type === "boss") bossEnemy = e;
  }
  hudText("hudEnemies", String(remaining));
  hudText("hudScore", String(score));
  hudWidth("hpBar", player.health / player.maxHealth);
  hudWidth("stamBar", player.stamina / 100);
  hudHidden("armorWrap", player.armor <= 0);
  hudWidth("armorBar", player.armor / player.maxArmor);
  const w = WEAPONS[player.weaponKey];
  const s = cw();
  const isKnife = player.weaponKey === "knife";
  hudText("weaponName", w.name);
  hudText("ammoMag", isKnife ? "—" : String(s.mag));
  hudText("ammoReserve", isKnife ? "" : String(s.reserve));
  hudHidden("reloadTag", !player.reloading);
  const slotsKey = player.slots.join(",") + "|" + player.activeSlotIdx;
  const slotsEl = hudEl("weaponSlots");
  if (slotsEl && hudCache.slots !== slotsKey) {
    hudCache.slots = slotsKey;
    slotsEl.innerHTML = "";
    player.slots.forEach((key, idx) => {
      const span = document.createElement("span");
      span.textContent = idx + 1 + ":" + (key ? WEAPONS[key].name.slice(0, 3) : "---");
      if (idx === player.activeSlotIdx) span.classList.add("active");
      slotsEl.appendChild(span);
    });
  }
  hudText("boostTag", player.boosts.map(b => (BOOST_NAMES[b.type] || b.type) + " " + b.t.toFixed(1) + "s").join(" · "));
  hudHidden("boostTag", player.boosts.length === 0);
  hudClass("crosshair", "hit", hitMarker > 0 && critMarker <= 0);
  hudClass("crosshair", "crit", critMarker > 0);
  hudHidden("bossHealthWrap", !bossEnemy);
  if (bossEnemy) hudWidth("bossHpBar", bossEnemy.hp / bossEnemy.maxHp);
}
function showEngineError(msg) {
  boot3DFailed = true;
  const brief = document.querySelector("#menuScreen .brief");
  if (brief) brief.textContent = msg;
  const err = $("engineError");
  if (err) {
    err.textContent = msg;
    err.classList.remove("hidden");
  }
  const btn = $("btnStart");
  if (btn) btn.disabled = true;
}
function boot() {
  if (typeof THREE === "undefined") {
    showEngineError("No se pudo cargar el motor 3D (Three.js) desde internet. Revisa tu conexión y recarga la página. Si el problema persiste, comprueba que tu navegador no esté bloqueando scripts externos.");
    return;
  }
  try {
    initThree();
    hemiLight = new THREE.HemisphereLight(9083560, 921100, .22);
    scene.add(hemiLight);
    sunLight = new THREE.DirectionalLight(14477554, .07);
    sunLight.position.set(120, 500, 80);
    scene.add(sunLight);
    shadowSpot = new THREE.SpotLight(16777215, 0, LAMP_RANGE, 1.1, .6, 1.6);
    shadowSpot.castShadow = true;
    shadowSpot.shadow.mapSize.set(1024, 1024);
    shadowSpot.shadow.camera.near = 6;
    shadowSpot.shadow.camera.far = LAMP_RANGE;
    shadowSpot.shadow.bias = -4e-4;
    shadowSpot.shadow.normalBias = .6;
    scene.add(shadowSpot);
    scene.add(shadowSpot.target);
    buildViewmodel();
  } catch (err) {
    console.error("Error inicializando el motor 3D:", err);
    showEngineError("Error inicializando el motor 3D: " + (err && err.message ? err.message : err) + ". Revisa la consola del navegador (F12) para más detalle.");
    return;
  }
  let lastTime = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = (now - lastTime) / 1e3;
    lastTime = now;
    dt = Math.min(dt, .05);
    try {
      update(dt);
      render(dt);
    } catch (err) {
      console.error("Error en el bucle de juego:", err);
    }
  }
  requestAnimationFrame(loop);
}
boot();
