'use strict';

(function () {
  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${clamp(a, 0, 1)})`;
  }

  // ---------------------------------------------------------------------------
  // Settings (saved on this device only)
  // ---------------------------------------------------------------------------
  const SPEEDS = { slow: 0.6, normal: 1, fast: 1.5 };
  const STORE_KEY = 'kitten-play-settings';

  function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch (e) { s = {}; }
    return {
      speed: Object.prototype.hasOwnProperty.call(SPEEDS, s.speed) ? s.speed : 'normal',
      count: Number.isInteger(s.count) ? clamp(s.count, 1, 5) : 3,
      sound: typeof s.sound === 'boolean' ? s.sound : true,
    };
  }
  const settings = loadSettings();
  function saveSettings() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* private mode */ }
  }

  // ---------------------------------------------------------------------------
  // Canvas and sizing
  // ---------------------------------------------------------------------------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const menu = document.getElementById('menu');
  let W = 0, H = 0, DPR = 1, U = 1;
  let bgCanvas = null, bgFor = null;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    U = Math.min(W, H) / 800; // 1.0 on a typical iPad in portrait
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    bgCanvas = null;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------------------------------------------------------------------------
  // Creature types. Colours favour yellow, lime, white and blue: cats see
  // these well and see red as a dull grey.
  // ---------------------------------------------------------------------------
  const TYPES = {
    fish: {
      size: 165, speed: 150, turn: 0.9, sound: 'bubble',
      colors: [['#ffe000', '#ff8a00'], ['#b6ff00', '#00a86b'], ['#ff8a00', '#ffe000'], ['#1f4dff', '#ffe000'], ['#ff4fd8', '#ffe000']],
      draw: drawFish, behave: behaveFish,
    },
    mouse: {
      size: 130, speed: 330, turn: 0.7, sound: 'squeak',
      colors: [['#eeeef4', '#ff9fb8'], ['#b9b9c6', '#ff9fb8'], ['#8d8d9c', '#ffb3c6'], ['#f7f3ea', '#ff9fb8']],
      draw: drawMouse, behave: behaveMouse,
    },
    ladybug: {
      size: 92, speed: 85, turn: 1.6, sound: 'chirp',
      colors: [['#ff2d2d', '#111111'], ['#ffd400', '#111111'], ['#2d7dff', '#111111'], ['#ff7a00', '#111111']],
      draw: drawLadybug, behave: behaveLadybug,
    },
    butterfly: {
      size: 160, speed: 150, turn: 1.0, sound: 'chirp',
      colors: [['#2d7dff', '#ffd400'], ['#ffd400', '#2d7dff'], ['#00d0ff', '#ffffff'], ['#ff5fd2', '#ffd400'], ['#ffffff', '#2d7dff']],
      draw: drawButterfly, behave: behaveButterfly,
    },
    laser: {
      size: 28, speed: 700, turn: 0, sound: 'ping',
      colors: [['#ff1a1a', '#ffffff']],
      draw: drawLaser, behave: null,
    },
  };

  // Each scene has a painted background image. The code-drawn background is
  // the fallback if the image has not loaded.
  const SCENES = {
    fish: { types: ['fish'], img: 'bg/water.jpg', bg: drawWaterBg, overlay: drawWaterOverlay, ambient: 'bubbles' },
    mice: { types: ['mouse'], img: 'bg/wood.jpg', bg: drawWoodBg, ambient: 'squeaks' },
    ladybugs: { types: ['ladybug'], img: 'bg/leaves.jpg', bg: drawLeafBg },
    butterflies: { types: ['butterfly'], img: 'bg/meadow.jpg', bg: drawMeadowBg },
    laser: { types: ['laser'], img: 'bg/rug.jpg', bg: drawRugBg, maxCount: 2 },
    mix: { types: ['fish', 'mouse', 'ladybug', 'butterfly'], img: 'bg/playmat.jpg', bg: drawPlaymatBg },
  };

  const bgImages = {};
  for (const key of Object.keys(SCENES)) {
    const im = new Image();
    im.onload = () => { if (sceneKey === key) bgCanvas = null; };
    im.src = SCENES[key].img;
    bgImages[key] = im;
  }

  // Scale the image to cover the screen in either orientation.
  function drawCover(g, im, w, h) {
    const s = Math.max(w / im.naturalWidth, h / im.naturalHeight);
    const dw = im.naturalWidth * s, dh = im.naturalHeight * s;
    g.drawImage(im, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  // ---------------------------------------------------------------------------
  // Game state
  // ---------------------------------------------------------------------------
  let state = 'menu';
  let sceneKey = null, scene = null;
  let creatures = [], effects = [], spawnQueue = [];
  let catches = 0, time = 0, last = 0, ambientTimer = 0;

  function targetCount() {
    return Math.min(settings.count, scene.maxCount || 5);
  }

  function makeCreature(type) {
    const def = TYPES[type];
    const [c1, c2] = pick(def.colors);
    const c = {
      type, def, c1, c2,
      size: def.size * U * rand(0.85, 1.15),
      x: 0, y: 0, heading: 0, speed: 0, targetSpeed: 0,
      phase: rand(0, TAU), seed: rand(0, TAU), age: 0, life: rand(10, 22),
      turn: 0, turnTarget: 0, turnTimer: 0,
      flee: 0, fleeAngle: 0, burst: 0,
      mode: 'go', modeTimer: rand(0.4, 1.2),
      entering: true, exiting: false, exitAngle: 0,
      tx: 0, ty: 0, alpha: 1, dartSpeed: 0, dead: false,
    };
    if (type === 'laser') initLaser(c); else placeAtEdge(c);
    return c;
  }

  // New creatures swim in from a random edge toward a point on screen.
  function placeAtEdge(c) {
    const m = c.size * 1.2;
    const edge = (Math.random() * 4) | 0;
    if (edge === 0) { c.x = rand(0, W); c.y = -m; }
    else if (edge === 1) { c.x = W + m; c.y = rand(0, H); }
    else if (edge === 2) { c.x = rand(0, W); c.y = H + m; }
    else { c.x = -m; c.y = rand(0, H); }
    c.tx = rand(W * 0.2, W * 0.8);
    c.ty = rand(H * 0.2, H * 0.8);
    c.heading = Math.atan2(c.ty - c.y, c.tx - c.x);
    c.speed = c.def.speed * U * SPEEDS[settings.speed];
  }

  const isInside = (c, pad) => c.x > pad && c.x < W - pad && c.y > pad && c.y < H - pad;
  const isGone = (c) => {
    const m = c.size * 1.5;
    return c.x < -m || c.x > W + m || c.y < -m || c.y > H + m;
  };

  // Head for the nearest edge and leave the screen.
  function startExit(c) {
    c.exiting = true;
    const dl = c.x, dr = W - c.x, dtp = c.y, db = H - c.y;
    const m = Math.min(dl, dr, dtp, db);
    c.exitAngle = m === dl ? Math.PI : m === dr ? 0 : m === dtp ? -Math.PI / 2 : Math.PI / 2;
  }

  function scheduleSpawn(delay) { spawnQueue.push(delay); }

  // ---------------------------------------------------------------------------
  // Behaviours. Each returns extra steering (radians per second).
  // ---------------------------------------------------------------------------
  function behaveFish(c, dt, base) {
    c.targetSpeed = base * (0.75 + 0.35 * Math.sin(c.age * 0.8 + c.seed));
    if (c.burst <= 0 && Math.random() < dt * 0.12) c.burst = rand(0.4, 0.8);
    if (c.burst > 0) c.targetSpeed = base * 2.2;
    // Loose schooling: line up with nearby fish, keep a little space.
    let ax = 0, ay = 0, n = 0, sx = 0, sy = 0;
    const R = c.size * 3, Rs = c.size * 0.9;
    for (const o of creatures) {
      if (o === c || o.type !== 'fish' || o.dead) continue;
      const dx = o.x - c.x, dy = o.y - c.y, d2 = dx * dx + dy * dy;
      if (d2 < R * R) { ax += Math.cos(o.heading); ay += Math.sin(o.heading); n++; }
      if (d2 < Rs * Rs) { sx -= dx; sy -= dy; }
    }
    let steer = 0;
    if (n) steer += wrapAngle(Math.atan2(ay, ax) - c.heading) * 0.5;
    if (sx || sy) steer += wrapAngle(Math.atan2(sy, sx) - c.heading) * 1.2;
    return steer;
  }

  // Mice scurry, stop to sniff, then dart off in a new direction.
  function behaveMouse(c, dt, base) {
    c.modeTimer -= dt;
    if (c.modeTimer <= 0) {
      if (c.mode === 'go') { c.mode = 'stop'; c.modeTimer = rand(0.3, 1.4); }
      else { c.mode = 'go'; c.modeTimer = rand(0.4, 1.3); c.heading = wrapAngle(c.heading + rand(-1.4, 1.4)); }
    }
    c.targetSpeed = c.mode === 'go' ? base : 0;
    return 0;
  }

  // Ladybugs crawl slowly with lots of small turns and the odd pause.
  function behaveLadybug(c, dt, base) {
    c.modeTimer -= dt;
    if (c.modeTimer <= 0) {
      if (c.mode === 'go') { c.mode = 'stop'; c.modeTimer = rand(0.5, 1.5); }
      else { c.mode = 'go'; c.modeTimer = rand(1.5, 4); }
    }
    c.targetSpeed = c.mode === 'go' ? base : 0;
    return 0;
  }

  // Butterflies flutter along a looping path.
  function behaveButterfly(c, dt, base) {
    c.targetSpeed = base * (0.85 + 0.3 * Math.sin(c.age * 1.3 + c.seed));
    return Math.sin(c.age * 2.1 + c.seed) * 1.3;
  }

  // The laser dot jumps between spots, holds still with a tiny jitter, then darts again.
  function initLaser(c) {
    c.x = rand(W * 0.15, W * 0.85);
    c.y = rand(H * 0.15, H * 0.85);
    c.alpha = 0;
    c.entering = false;
    c.mode = 'hold';
    c.modeTimer = rand(0.3, 0.8);
  }

  // Inner play area for the laser, so it never sticks to an edge.
  function laserPoint(x, y) {
    const m = Math.min(W, H) * 0.1;
    return [clamp(x, m, W - m), clamp(y, m, H - m)];
  }

  function laserNewTarget(c, base) {
    const m = Math.min(W, H) * 0.1;
    if (Math.random() < 0.5) {
      const a = rand(0, TAU), r = rand(60, 220) * U;
      [c.tx, c.ty] = laserPoint(c.x + Math.cos(a) * r, c.y + Math.sin(a) * r);
    } else {
      c.tx = rand(m, W - m);
      c.ty = rand(m, H - m);
    }
    c.mode = 'dart';
    c.dartSpeed = base * rand(0.5, 1.3);
    c.modeTimer = 3;
  }

  function updateLaser(c, dt, base) {
    c.alpha = Math.min(1, c.alpha + dt * 3);
    c.modeTimer -= dt;
    if (c.mode === 'hold') {
      c.x += rand(-1, 1) * 1.5 * U;
      c.y += rand(-1, 1) * 1.5 * U;
      if (c.modeTimer <= 0) {
        if (c.age > c.life && !c.exiting) {
          // Run off the edge of the screen and vanish.
          startExit(c);
          const far = Math.max(W, H);
          c.tx = c.x + Math.cos(c.exitAngle) * far;
          c.ty = c.y + Math.sin(c.exitAngle) * far;
          c.mode = 'dart';
          c.dartSpeed = base;
          c.modeTimer = 5;
        } else {
          laserNewTarget(c, base);
        }
      }
    } else {
      const dx = c.tx - c.x, dy = c.ty - c.y, d = Math.hypot(dx, dy);
      if (d < c.dartSpeed * dt || c.modeTimer <= 0) {
        c.x = c.tx; c.y = c.ty;
        c.mode = 'hold';
        c.modeTimer = Math.random() < 0.3 ? rand(0.8, 1.8) : rand(0.15, 0.6);
      } else {
        c.x += (dx / d) * c.dartSpeed * dt;
        c.y += (dy / d) * c.dartSpeed * dt;
        c.heading = Math.atan2(dy, dx);
      }
    }
    c.phase += dt;
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function updateCreature(c, dt) {
    c.age += dt;
    const base = c.def.speed * U * SPEEDS[settings.speed];
    if (c.type === 'laser') { updateLaser(c, dt, base); return; }

    let steer = c.def.behave(c, dt, base) || 0;
    if (c.burst > 0) c.burst -= dt;

    // Smooth random wandering.
    c.turnTimer -= dt;
    if (c.turnTimer <= 0) { c.turnTarget = rand(-1, 1) * c.def.turn; c.turnTimer = rand(0.4, 1.6); }
    c.turn += (c.turnTarget - c.turn) * Math.min(1, dt * 3);
    steer += c.turn;

    if (c.entering) {
      steer = wrapAngle(Math.atan2(c.ty - c.y, c.tx - c.x) - c.heading) * 2.5;
      if (isInside(c, c.size * 0.6)) c.entering = false;
    } else if (c.exiting) {
      steer += wrapAngle(c.exitAngle - c.heading) * 2.5;
    } else {
      // Keep away from the edges until it is time to leave.
      const pad = Math.min(W, H) * 0.12 + c.size * 0.5;
      if (!isInside(c, pad)) {
        steer += wrapAngle(Math.atan2(H / 2 - c.y, W / 2 - c.x) - c.heading) * 2.2;
      }
      if (c.age > c.life) startExit(c);
    }

    if (c.flee > 0) {
      c.flee -= dt;
      steer = wrapAngle(c.fleeAngle - c.heading) * 7;
    }

    const moving = c.speed > base * 0.15;
    c.heading = wrapAngle(c.heading + steer * dt * (moving ? 1 : 0.5));

    let target = c.targetSpeed;
    if (c.flee > 0) target = Math.max(target, base * 2.6);
    if (c.exiting) target = Math.max(target, base * 1.2);
    if (c.entering) target = Math.max(target, base * 0.8);
    c.speed += (target - c.speed) * Math.min(1, dt * (c.type === 'mouse' ? 9 : 3));

    c.x += Math.cos(c.heading) * c.speed * dt;
    c.y += Math.sin(c.heading) * c.speed * dt;
    c.phase += dt * (3 + c.speed / (U * 25));
  }

  function update(dt) {
    time += dt;

    for (const c of creatures) updateCreature(c, dt);

    // Anything that has left the screen comes back later from another edge.
    const kept = [];
    for (const c of creatures) {
      if (!c.entering && isGone(c)) scheduleSpawn(rand(0.5, 2.5));
      else kept.push(c);
    }
    creatures = kept;

    const pending = [];
    for (let t of spawnQueue) {
      t -= dt;
      if (t <= 0) {
        if (creatures.length < targetCount()) creatures.push(makeCreature(pick(scene.types)));
      } else {
        pending.push(t);
      }
    }
    spawnQueue = pending;

    for (const e of effects) {
      e.t += dt;
      if (e.k === 'spark') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        const drag = Math.pow(0.04, dt);
        e.vx *= drag;
        e.vy *= drag;
      }
    }
    effects = effects.filter((e) => e.t < e.d);

    if (exitHold) {
      const p = pointers.get(exitHold.id);
      if (p && p.x < CORNER && p.y < CORNER) {
        exitHold.t += dt;
        if (exitHold.t >= EXIT_SECONDS) goMenu();
      } else {
        exitHold = null;
      }
    }

    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      if (scene.ambient === 'bubbles') { sfx.ambientBubble(); ambientTimer = rand(0.6, 2.2); }
      else if (scene.ambient === 'squeaks') { sfx.ambientSqueak(); ambientTimer = rand(5, 11); }
      else ambientTimer = 5;
    }
  }

  // ---------------------------------------------------------------------------
  // Input: every finger or paw is tracked, so several can hit at once.
  // ---------------------------------------------------------------------------
  const pointers = new Map();
  const CORNER = 90;
  const EXIT_SECONDS = 3;
  let exitHold = null;

  function touchAt(px, py, isDown) {
    let hit = false;
    for (const c of creatures) {
      if (c.dead || c.alpha < 0.3) continue;
      // Generous hit area: paws are not precise.
      const hr = Math.max(c.size * 0.75, 48 * U);
      const dx = c.x - px, dy = c.y - py, d2 = dx * dx + dy * dy;
      if (d2 <= hr * hr) {
        catchCreature(c);
        hit = true;
      } else if (isDown && d2 <= hr * hr * 9) {
        scare(c, px, py);
      }
    }
    if (hit) creatures = creatures.filter((c) => !c.dead);
  }

  // A near miss makes the creature dart away, which keeps the chase going.
  function scare(c, px, py) {
    const away = Math.atan2(c.y - py, c.x - px);
    if (c.type === 'laser') {
      const r = rand(250, 450) * U;
      [c.tx, c.ty] = laserPoint(c.x + Math.cos(away) * r, c.y + Math.sin(away) * r);
      // If the escape lands near the paw (pinned by an edge), jump somewhere else.
      if (Math.hypot(c.tx - px, c.ty - py) < 200 * U) {
        c.tx = W - c.tx;
        c.ty = H - c.ty;
      }
      c.mode = 'dart';
      c.dartSpeed = c.def.speed * U * SPEEDS[settings.speed] * 1.6;
      c.modeTimer = 2;
      return;
    }
    c.flee = 0.5;
    c.fleeAngle = away + rand(-0.4, 0.4);
    if (c.type === 'mouse') { c.mode = 'go'; c.modeTimer = rand(0.6, 1.2); }
  }

  function catchCreature(c) {
    c.dead = true;
    catches++;
    burst(c.x, c.y, c.c1, c.size);
    sfx.catch(c.def.sound);
    scheduleSpawn(rand(1, 2));
  }

  function onDown(e) {
    if (state !== 'play') return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (e.clientX < CORNER && e.clientY < CORNER) exitHold = { id: e.pointerId, t: 0 };
    touchAt(e.clientX, e.clientY, true);
  }
  function onMove(e) {
    if (state !== 'play' || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    const p = pointers.get(e.pointerId);
    p.x = e.clientX;
    p.y = e.clientY;
    touchAt(p.x, p.y, false);
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    if (exitHold && exitHold.id === e.pointerId) exitHold = null;
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onUp);

  // Block zoom, magnifier, callouts and scroll bounce while playing.
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('touchmove', (e) => { if (state === 'play') e.preventDefault(); }, { passive: false });
  document.addEventListener('gesturestart', (e) => e.preventDefault());
  document.addEventListener('dblclick', (e) => e.preventDefault());
  document.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------------------------------------------------------------------------
  // Catch effects: bright flash, expanding rings and a burst of sparkles.
  // ---------------------------------------------------------------------------
  function burst(x, y, color, size) {
    const s = Math.max(size, 60 * U);
    effects.push({ k: 'flash', x, y, t: 0, d: 0.5, r: s * 2.6, color });
    effects.push({ k: 'ring', x, y, t: 0, d: 0.7, r: s * 3.2, color: '#ffffff' });
    effects.push({ k: 'ring', x, y, t: -0.08, d: 0.7, r: s * 2.4, color });
    const cols = [color, '#ffffff', '#fff36b', '#7cf7ff', '#ff8af0'];
    for (let i = 0; i < 26; i++) {
      const a = rand(0, TAU), v = rand(150, 520) * U;
      effects.push({
        k: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        t: 0, d: rand(0.45, 0.9), r: rand(4, 11) * U, color: pick(cols),
      });
    }
  }

  function drawEffects() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const e of effects) {
      if (e.t < 0) continue;
      const p = e.t / e.d;
      if (e.k === 'flash') {
        const r = e.r * (0.35 + 0.65 * easeOut(p));
        const a = 1 - p;
        const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r);
        g.addColorStop(0, `rgba(255,255,255,${a})`);
        g.addColorStop(0.35, rgba(e.color, a * 0.9));
        g.addColorStop(1, rgba(e.color, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(e.x, e.y, r, 0, TAU);
        ctx.fill();
      } else if (e.k === 'ring') {
        ctx.strokeStyle = rgba(e.color, 1 - p);
        ctx.lineWidth = (1 - p) * 14 * U + 2;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * easeOut(p), 0, TAU);
        ctx.stroke();
      } else {
        ctx.fillStyle = rgba(e.color, 1 - p);
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * (1 - p * 0.5), 0, TAU);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Creature drawing (top-down). Each faces +x and is drawn around 0,0.
  // ---------------------------------------------------------------------------
  function drawFish(g, c) {
    const L = c.size, w = L * 0.2;
    const tail = Math.sin(c.phase) * 0.45, fin = Math.sin(c.phase * 1.3) * 0.5;

    g.save();
    g.translate(-L * 0.3, 0);
    g.rotate(tail);
    g.fillStyle = c.c2;
    g.beginPath();
    g.moveTo(L * 0.04, 0);
    g.lineTo(-L * 0.24, -w * 1.2);
    g.quadraticCurveTo(-L * 0.15, 0, -L * 0.24, w * 1.2);
    g.closePath();
    g.fill();
    g.restore();

    g.fillStyle = c.c2;
    for (const s of [-1, 1]) {
      g.save();
      g.translate(L * 0.06, s * w * 0.85);
      g.rotate(s * (0.6 + fin * 0.4));
      g.beginPath();
      g.ellipse(-L * 0.06, 0, L * 0.09, L * 0.035, 0, 0, TAU);
      g.fill();
      g.restore();
    }

    g.fillStyle = c.c1;
    g.beginPath();
    g.ellipse(0, 0, L * 0.36, w, 0, 0, TAU);
    g.fill();

    g.save();
    g.beginPath();
    g.ellipse(0, 0, L * 0.36, w, 0, 0, TAU);
    g.clip();
    g.fillStyle = c.c2;
    g.globalAlpha *= 0.85;
    g.fillRect(-L * 0.02, -w, L * 0.08, w * 2);
    g.fillRect(L * 0.16, -w, L * 0.04, w * 2);
    g.restore();

    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath();
    g.ellipse(L * 0.05, -w * 0.1, L * 0.2, w * 0.35, 0, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = Math.max(1.5, L * 0.015);
    g.beginPath();
    g.ellipse(0, 0, L * 0.36, w, 0, 0, TAU);
    g.stroke();

    for (const s of [-1, 1]) {
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(L * 0.24, s * w * 0.55, L * 0.045, 0, TAU);
      g.fill();
      g.fillStyle = '#111111';
      g.beginPath();
      g.arc(L * 0.255, s * w * 0.55, L * 0.025, 0, TAU);
      g.fill();
    }
  }

  function drawMouse(g, c) {
    const L = c.size;

    g.strokeStyle = c.c2;
    g.lineWidth = L * 0.035;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-L * 0.28, 0);
    for (let i = 1; i <= 10; i++) {
      g.lineTo(-L * 0.28 - i * L * 0.055, Math.sin(i * 0.6 - c.phase * 1.2) * L * 0.08 * (i / 10));
    }
    g.stroke();

    g.fillStyle = c.c2;
    const step = c.speed > 5 ? Math.sin(c.phase * 2) * L * 0.04 : 0;
    for (const s of [-1, 1]) {
      g.beginPath();
      g.ellipse(L * 0.12 + step * s, s * L * 0.17, L * 0.04, L * 0.025, 0, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(-L * 0.14 - step * s, s * L * 0.18, L * 0.045, L * 0.028, 0, 0, TAU);
      g.fill();
    }

    g.fillStyle = c.c1;
    g.beginPath();
    g.ellipse(-L * 0.02, 0, L * 0.3, L * 0.19, 0, 0, TAU);
    g.fill();
    g.beginPath();
    g.ellipse(L * 0.27, 0, L * 0.16, L * 0.12, 0, 0, TAU);
    g.fill();

    for (const s of [-1, 1]) {
      g.fillStyle = c.c1;
      g.beginPath();
      g.arc(L * 0.2, s * L * 0.13, L * 0.085, 0, TAU);
      g.fill();
      g.fillStyle = c.c2;
      g.beginPath();
      g.arc(L * 0.2, s * L * 0.13, L * 0.05, 0, TAU);
      g.fill();
    }

    g.strokeStyle = 'rgba(0,0,0,0.2)';
    g.lineWidth = Math.max(1.5, L * 0.012);
    g.beginPath();
    g.ellipse(-L * 0.02, 0, L * 0.3, L * 0.19, 0, 0, TAU);
    g.stroke();

    g.fillStyle = '#111111';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(L * 0.33, s * L * 0.055, L * 0.022, 0, TAU);
      g.fill();
    }
    g.fillStyle = '#ff6f91';
    g.beginPath();
    g.arc(L * 0.43, 0, L * 0.03, 0, TAU);
    g.fill();

    g.strokeStyle = 'rgba(60,60,60,0.6)';
    g.lineWidth = Math.max(1, L * 0.008);
    const wig = Math.sin(c.phase * 3) * 0.1;
    for (const s of [-1, 1]) {
      for (const k of [-0.25, 0, 0.25]) {
        const a = s * (1.2 + k + wig);
        g.beginPath();
        g.moveTo(L * 0.41, s * L * 0.02);
        g.lineTo(L * 0.41 + Math.cos(a) * L * 0.16, s * L * 0.02 + Math.sin(a) * L * 0.16);
        g.stroke();
      }
    }
  }

  function drawLadybug(g, c) {
    const L = c.size, R = L * 0.42;
    const legs = c.speed > 2 ? Math.sin(c.phase * 3) * 0.35 : 0;

    g.strokeStyle = '#111111';
    g.lineWidth = Math.max(1.5, L * 0.03);
    g.lineCap = 'round';
    for (const s of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const bx = L * (0.15 - i * 0.17);
        const a = s * (Math.PI / 2 + (i - 1) * 0.5 + (i % 2 ? legs : -legs));
        g.beginPath();
        g.moveTo(bx, 0);
        g.lineTo(bx + Math.cos(a) * R * 1.25, Math.sin(a) * R * 1.25);
        g.stroke();
      }
    }

    g.fillStyle = '#111111';
    g.beginPath();
    g.arc(R * 0.85, 0, R * 0.45, 0, TAU);
    g.fill();
    g.fillStyle = '#ffffff';
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(R * 1.05, s * R * 0.22, R * 0.09, 0, TAU);
      g.fill();
    }

    g.fillStyle = c.c1;
    g.beginPath();
    g.arc(-R * 0.05, 0, R, 0, TAU);
    g.fill();

    g.strokeStyle = '#111111';
    g.lineWidth = Math.max(1.5, L * 0.025);
    g.beginPath();
    g.moveTo(R * 0.95, 0);
    g.lineTo(-R * 1.05, 0);
    g.stroke();

    g.fillStyle = '#111111';
    const spots = [[0.45, 0.45, 0.2], [-0.2, 0.55, 0.18], [-0.6, 0.3, 0.15], [0.1, 0.2, 0.13]];
    for (const [sx, sy, sr] of spots) {
      for (const s of [-1, 1]) {
        g.beginPath();
        g.arc(R * sx - R * 0.05, s * R * sy, R * sr, 0, TAU);
        g.fill();
      }
    }

    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.ellipse(R * 0.2, -R * 0.45, R * 0.25, R * 0.12, -0.4, 0, TAU);
    g.fill();
  }

  function drawButterfly(g, c) {
    const L = c.size;
    const flap = 0.2 + 0.8 * Math.abs(Math.cos(c.phase * 1.6));

    g.save();
    g.scale(1, flap);
    for (const s of [-1, 1]) {
      g.fillStyle = c.c1;
      g.beginPath();
      g.ellipse(L * 0.1, s * L * 0.24, L * 0.2, L * 0.22, s * 0.35, 0, TAU);
      g.fill();
      g.beginPath();
      g.ellipse(-L * 0.13, s * L * 0.19, L * 0.15, L * 0.16, -s * 0.4, 0, TAU);
      g.fill();
      g.fillStyle = c.c2;
      g.beginPath();
      g.arc(L * 0.13, s * L * 0.27, L * 0.07, 0, TAU);
      g.fill();
      g.beginPath();
      g.arc(-L * 0.14, s * L * 0.2, L * 0.045, 0, TAU);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.lineWidth = Math.max(1.5, L * 0.015);
      g.beginPath();
      g.ellipse(L * 0.1, s * L * 0.24, L * 0.2, L * 0.22, s * 0.35, 0, TAU);
      g.stroke();
    }
    g.restore();

    g.fillStyle = '#2a1a3a';
    g.beginPath();
    g.ellipse(0, 0, L * 0.24, L * 0.045, 0, 0, TAU);
    g.fill();
    g.strokeStyle = '#2a1a3a';
    g.lineWidth = Math.max(1.2, L * 0.012);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(L * 0.22, 0);
      g.quadraticCurveTo(L * 0.32, s * L * 0.04, L * 0.36, s * L * 0.11);
      g.stroke();
      g.beginPath();
      g.arc(L * 0.36, s * L * 0.11, L * 0.018, 0, TAU);
      g.fillStyle = '#2a1a3a';
      g.fill();
    }
  }

  function drawLaser(g, c) {
    const R = c.size * (1 + 0.08 * Math.sin(c.phase * 20));
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, R * 2.2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.12, 'rgba(255,240,240,1)');
    gr.addColorStop(0.28, 'rgba(255,30,30,0.95)');
    gr.addColorStop(0.6, 'rgba(255,0,0,0.35)');
    gr.addColorStop(1, 'rgba(255,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(0, 0, R * 2.2, 0, TAU);
    g.fill();
  }

  function drawCreature(c) {
    ctx.save();
    ctx.globalAlpha = c.alpha;
    ctx.translate(c.x, c.y);
    if (c.type !== 'laser') {
      // Soft shadow on the floor below. Butterflies fly higher.
      const off = c.type === 'butterfly' ? c.size * 0.35 : c.size * 0.09;
      ctx.save();
      ctx.translate(off * 0.6, off);
      ctx.rotate(c.heading);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 0, c.size * 0.42, c.size * (c.type === 'ladybug' ? 0.42 : 0.2), 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(c.heading);
    c.def.draw(ctx, c);
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Backgrounds (drawn once per scene and screen size, then reused)
  // ---------------------------------------------------------------------------
  function vignette(g, w, h, color) {
    const r = Math.hypot(w, h) / 2;
    const gr = g.createRadialGradient(w / 2, h / 2, r * 0.45, w / 2, h / 2, r);
    gr.addColorStop(0, 'rgba(0,0,0,0)');
    gr.addColorStop(1, color);
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
  }

  function leafShape(g, x, y, len, wid, angle, fill) {
    g.save();
    g.translate(x, y);
    g.rotate(angle);
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(-len / 2, 0);
    g.quadraticCurveTo(0, -wid, len / 2, 0);
    g.quadraticCurveTo(0, wid, -len / 2, 0);
    g.fill();
    g.restore();
  }

  function drawWaterBg(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#14c8ff');
    gr.addColorStop(0.5, '#0a8fe8');
    gr.addColorStop(1, '#0b5fd6');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);

    const pebbles = ['#ffd36b', '#ff9b6b', '#ffffff', '#9bffcf', '#ff8ad8'];
    g.globalAlpha = 0.22;
    for (let i = 0; i < 80; i++) {
      g.fillStyle = pick(pebbles);
      g.beginPath();
      g.ellipse(rand(0, w), rand(0, h), rand(6, 16) * U, rand(5, 12) * U, rand(0, TAU), 0, TAU);
      g.fill();
    }
    g.globalAlpha = 0.5;
    for (let k = 0; k < 5; k++) {
      const side = k % 4;
      const cx = side === 0 ? rand(0, w * 0.15) : side === 1 ? rand(w * 0.85, w) : rand(0, w);
      const cy = side === 2 ? rand(0, h * 0.12) : side === 3 ? rand(h * 0.88, h) : rand(0, h);
      for (let j = 0; j < 8; j++) {
        const a = rand(0, TAU), len = rand(60, 130) * U;
        leafShape(g, cx + Math.cos(a) * len / 2, cy + Math.sin(a) * len / 2, len, len * 0.22, a, pick(['#2fe08a', '#1fc46e', '#7dff9a']));
      }
    }
    g.globalAlpha = 1;
    vignette(g, w, h, 'rgba(0,30,90,0.35)');
  }

  let caustics = [];
  function drawWaterOverlay() {
    if (!caustics.length) {
      for (let i = 0; i < 14; i++) {
        caustics.push({ x: Math.random(), y: Math.random(), r: rand(90, 200), sx: rand(0.2, 0.5), sy: rand(0.2, 0.5), p: rand(0, TAU) });
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const k of caustics) {
      const x = k.x * W + Math.sin(time * k.sx + k.p) * 60 * U;
      const y = k.y * H + Math.cos(time * k.sy + k.p) * 60 * U;
      const r = k.r * U * (1 + 0.15 * Math.sin(time * 1.3 + k.p));
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(180,255,255,0.13)');
      gr.addColorStop(1, 'rgba(180,255,255,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
  }

  function drawWoodBg(g, w, h) {
    const plank = 90 * U;
    const shades = ['#f4ad55', '#ea9a3f', '#f7b866', '#eea347'];
    for (let y = 0, i = 0; y < h; y += plank, i++) {
      g.fillStyle = shades[i % shades.length];
      g.fillRect(0, y, w, plank);
      g.fillStyle = 'rgba(150,80,20,0.35)';
      g.fillRect(0, y, w, Math.max(2, 3 * U));
      const off = (i % 2) * rand(150, 300) * U;
      for (let x = off; x < w; x += rand(300, 500) * U) g.fillRect(x, y, Math.max(2, 3 * U), plank);
    }
    g.strokeStyle = 'rgba(160,90,30,0.15)';
    g.lineWidth = Math.max(1, 2 * U);
    for (let i = 0; i < 120; i++) {
      const x = rand(0, w), y = rand(0, h), len = rand(80, 260) * U;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y + rand(-6, 6) * U, x + len * 0.7, y + rand(-6, 6) * U, x + len, y);
      g.stroke();
    }
    vignette(g, w, h, 'rgba(90,40,0,0.3)');
  }

  function drawLeafBg(g, w, h) {
    g.fillStyle = '#8be04a';
    g.fillRect(0, 0, w, h);
    const greens = ['#6fcf3a', '#9ef05a', '#5bbf2f', '#7ad94a'];
    for (let i = 0; i < 14; i++) {
      const x = rand(0, w), y = rand(0, h), len = rand(300, 600) * U, a = rand(0, TAU);
      leafShape(g, x, y, len, len * 0.35, a, pick(greens));
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.strokeStyle = 'rgba(220,255,180,0.45)';
      g.lineWidth = Math.max(2, 4 * U);
      g.beginPath();
      g.moveTo(-len / 2, 0);
      g.lineTo(len / 2, 0);
      g.stroke();
      g.lineWidth = Math.max(1, 2 * U);
      for (let k = -3; k <= 3; k++) {
        if (!k) continue;
        const bx = k * len * 0.11;
        for (const s of [-1, 1]) {
          g.beginPath();
          g.moveTo(bx, 0);
          g.lineTo(bx + len * 0.08, s * len * 0.11);
          g.stroke();
        }
      }
      g.restore();
    }
    vignette(g, w, h, 'rgba(20,70,0,0.3)');
  }

  function drawMeadowBg(g, w, h) {
    const gr = g.createLinearGradient(0, 0, 0, h);
    gr.addColorStop(0, '#72d95c');
    gr.addColorStop(1, '#45b84f');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(30,110,30,0.35)';
    g.lineWidth = Math.max(1, 2 * U);
    for (let i = 0; i < 400; i++) {
      const x = rand(0, w), y = rand(0, h), a = rand(-0.5, 0.5) - Math.PI / 2, l = rand(8, 20) * U;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    const petals = ['#ffffff', '#ff8ad8', '#c58aff', '#ff6b6b'];
    for (let i = 0; i < 70; i++) {
      const x = rand(0, w), y = rand(0, h), r = rand(7, 13) * U, col = pick(petals), rot = rand(0, TAU);
      g.fillStyle = col;
      for (let p = 0; p < 5; p++) {
        const a = rot + (p * TAU) / 5;
        g.beginPath();
        g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, r * 0.7, 0, TAU);
        g.fill();
      }
      g.fillStyle = '#ffb000';
      g.beginPath();
      g.arc(x, y, r * 0.55, 0, TAU);
      g.fill();
    }
    vignette(g, w, h, 'rgba(0,60,0,0.3)');
  }

  function drawRugBg(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#2f2068');
    gr.addColorStop(1, '#160f3a');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,0.05)';
    g.lineWidth = Math.max(1, 2 * U);
    const step = 70 * U;
    for (let x = -h; x < w + h; x += step) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + h, h);
      g.stroke();
      g.beginPath();
      g.moveTo(x, h);
      g.lineTo(x + h, 0);
      g.stroke();
    }
    vignette(g, w, h, 'rgba(0,0,0,0.45)');
  }

  function drawPlaymatBg(g, w, h) {
    const gr = g.createLinearGradient(0, 0, w, h);
    gr.addColorStop(0, '#7b5cff');
    gr.addColorStop(1, '#2fb8ff');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    const dots = ['rgba(255,255,255,0.12)', 'rgba(255,220,0,0.14)', 'rgba(255,120,220,0.14)'];
    for (let i = 0; i < 26; i++) {
      g.fillStyle = pick(dots);
      g.beginPath();
      g.arc(rand(0, w), rand(0, h), rand(40, 140) * U, 0, TAU);
      g.fill();
    }
    vignette(g, w, h, 'rgba(20,0,60,0.3)');
  }

  function getBg() {
    if (!bgCanvas || bgFor !== sceneKey) {
      bgCanvas = document.createElement('canvas');
      bgCanvas.width = canvas.width;
      bgCanvas.height = canvas.height;
      const g = bgCanvas.getContext('2d');
      g.scale(DPR, DPR);
      const im = bgImages[sceneKey];
      if (im && im.complete && im.naturalWidth) {
        drawCover(g, im, W, H);
        vignette(g, W, H, 'rgba(0,0,0,0.18)');
      } else {
        scene.bg(g, W, H);
      }
      bgFor = sceneKey;
    }
    return bgCanvas;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(getBg(), 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    if (scene.overlay) scene.overlay();
    for (const c of creatures) drawCreature(c);
    drawEffects();

    // Faint corner marker so people remember where the exit is.
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(28, 28, 10, 0, TAU);
    ctx.fill();

    if (exitHold && exitHold.t > 0.3) {
      const p = Math.min(1, exitHold.t / EXIT_SECONDS);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(46, 46, 28, -Math.PI / 2, -Math.PI / 2 + p * TAU);
      ctx.stroke();
    }

    // Catch counter for the humans.
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '800 26px ui-rounded, system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(catches), W - 22, 18);
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (state !== 'play') { last = now; return; }
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    update(dt);
    if (state === 'play') render();
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------------
  // Sound (generated in code, no audio files)
  // ---------------------------------------------------------------------------
  let actx = null, master = null;

  function initAudio() {
    try {
      if (!actx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 0.6;
        master.connect(actx.destination);
      }
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
  }

  function tone(type, f0, f1, dur, vol, delay) {
    if (!actx || !settings.sound) return;
    const t = actx.currentTime + (delay || 0);
    const o = actx.createOscillator();
    const gn = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn);
    gn.connect(master);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  const sfx = {
    catch(kind) {
      if (kind === 'bubble') {
        tone('sine', 300, 900, 0.12, 0.35);
        tone('sine', 1800, 2600, 0.1, 0.12, 0.06);
      } else if (kind === 'squeak') {
        tone('triangle', 2600, 3400, 0.08, 0.2);
        tone('triangle', 3300, 2400, 0.09, 0.18, 0.09);
      } else if (kind === 'chirp') {
        tone('sine', 2000, 3200, 0.07, 0.22);
        tone('sine', 2200, 3500, 0.07, 0.2, 0.1);
      } else {
        tone('sine', 1300, 600, 0.15, 0.25);
        tone('sine', 2400, 3000, 0.08, 0.1, 0.08);
      }
    },
    ambientBubble() { tone('sine', rand(200, 380), rand(500, 800), 0.08, 0.05); },
    ambientSqueak() { tone('triangle', rand(2800, 3300), rand(3400, 3900), 0.06, 0.06); },
  };

  // ---------------------------------------------------------------------------
  // Keep the screen awake while playing
  // ---------------------------------------------------------------------------
  let wakeLock = null;
  async function requestWake() {
    try {
      if ('wakeLock' in navigator && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  function releaseWake() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state === 'play') requestWake();
  });

  // ---------------------------------------------------------------------------
  // Menu
  // ---------------------------------------------------------------------------
  function startGame(key) {
    initAudio();
    sceneKey = key;
    scene = SCENES[key];
    creatures = [];
    effects = [];
    spawnQueue = [];
    caustics = [];
    catches = 0;
    time = 0;
    ambientTimer = 1;
    bgCanvas = null;
    pointers.clear();
    exitHold = null;
    for (let i = 0; i < targetCount(); i++) scheduleSpawn(0.2 + i * 0.7);
    menu.hidden = true;
    canvas.hidden = false;
    resize();
    state = 'play';
    last = performance.now();
    requestWake();
  }

  function goMenu() {
    state = 'menu';
    pointers.clear();
    exitHold = null;
    canvas.hidden = true;
    menu.hidden = false;
    releaseWake();
  }

  document.querySelectorAll('.tile').forEach((b) => {
    b.addEventListener('click', () => startGame(b.dataset.mode));
  });

  const speedButtons = document.querySelectorAll('#speed button');
  const countEl = document.getElementById('count');
  const soundBtn = document.getElementById('sound');

  function refreshSettingsUI() {
    speedButtons.forEach((b) => b.classList.toggle('on', b.dataset.v === settings.speed));
    countEl.textContent = String(settings.count);
    soundBtn.textContent = settings.sound ? 'On' : 'Off';
    soundBtn.classList.toggle('off', !settings.sound);
  }

  speedButtons.forEach((b) => b.addEventListener('click', () => {
    settings.speed = b.dataset.v;
    saveSettings();
    refreshSettingsUI();
  }));
  document.getElementById('minus').addEventListener('click', () => {
    settings.count = clamp(settings.count - 1, 1, 5);
    saveSettings();
    refreshSettingsUI();
  });
  document.getElementById('plus').addEventListener('click', () => {
    settings.count = clamp(settings.count + 1, 1, 5);
    saveSettings();
    refreshSettingsUI();
  });
  soundBtn.addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    refreshSettingsUI();
    if (settings.sound) { initAudio(); sfx.catch('chirp'); }
  });
  refreshSettingsUI();

  // Tile pictures use the same drawing code as the game.
  function drawIcons() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    document.querySelectorAll('canvas.icon').forEach((cv) => {
      const w = 140, h = 100;
      cv.width = w * dpr;
      cv.height = h * dpr;
      const g = cv.getContext('2d');
      g.scale(dpr, dpr);
      const kind = cv.dataset.icon;
      const sample = (type, size, x, y, rot) => {
        const def = TYPES[type];
        const [c1, c2] = def.colors[0];
        const c = { type, def, c1, c2, size, speed: 0, phase: 0.6, age: 0 };
        g.save();
        g.translate(x, y);
        g.rotate(rot);
        def.draw(g, c);
        g.restore();
      };
      if (kind === 'mix') {
        sample('fish', 80, 48, 38, -0.3);
        sample('mouse', 70, 92, 68, 2.6);
      } else if (kind === 'laser') {
        sample('laser', 20, 70, 50, 0);
      } else if (kind === 'ladybug') {
        sample('ladybug', 80, 70, 50, -0.5);
      } else {
        sample(kind, 110, 70, 50, -0.4);
      }
    });
  }
  drawIcons();

  // ---------------------------------------------------------------------------
  // Offline support
  // ---------------------------------------------------------------------------
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline mode unavailable */ });
    });
  }

  // Read-only hook used by the automated browser tests.
  window.__kittenPlay = {
    get state() { return state; },
    get scene() { return sceneKey; },
    get creatures() { return creatures.map((c) => ({ type: c.type, x: c.x, y: c.y, size: c.size, alpha: c.alpha, entering: c.entering })); },
    get catches() { return catches; },
    get effects() { return effects.length; },
  };
})();
