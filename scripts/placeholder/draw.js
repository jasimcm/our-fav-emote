// Draws the placeholder character's clips frame by frame on a transparent canvas.
// Used by scripts/make-placeholders.cjs. Runs in a hidden Electron window.

const W = 360, H = 480, CX = 180, GROUND = 468, FPS = 24;
const ANKLE_Y = GROUND - 12;
const THIGH = 108, SHIN = 108, UPPER_ARM = 76, FOREARM = 72;
const STRIDE = 45; // half stride in px; stance foot travels 2*STRIDE in half a cycle
const CYCLE_S = 1; // one full walk cycle (two steps) per second
const WALK_SPEED = (4 * STRIDE) / CYCLE_S; // px/sec at clip resolution

const C = {
  skin: '#c68a5e', skinShade: '#a8704a', hair: '#1d1916', beard: '#2d241f',
  shirt: '#d0262c', shirtShade: '#9e1b20', pants: '#2f3e5c', pantsShade: '#222d45',
  shoe: '#3b2619', bottle: 'rgba(140,205,250,.9)', water: '#3d9be0', cap: '#1d5fa8', z: '#5b6b8c',
};

const TAU = Math.PI * 2;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, t)));
/** 0 -> 1 -> 0 envelope for one-shot clips: ramps in over `inT`, out over the last `outT`. */
const envelope = (t, inT = 0.2, outT = 0.2) => (t < inT ? ease(t / inT) : t > 1 - outT ? ease((1 - t) / outT) : 1);

function limb(ctx, pts, width, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
}

/** Two-bone IK: joint between root and end. `pick(a, b)` chooses which of the two solutions. */
function ik(root, end, a, b, pick) {
  const dx = end[0] - root[0], dy = end[1] - root[1];
  const d = Math.min(Math.hypot(dx, dy), a + b - 0.01);
  const base = Math.atan2(dy, dx);
  const A = Math.acos(Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d))));
  const j1 = [root[0] + a * Math.cos(base - A), root[1] + a * Math.sin(base - A)];
  const j2 = [root[0] + a * Math.cos(base + A), root[1] + a * Math.sin(base + A)];
  return pick(j1, j2);
}

function ellipse(ctx, x, y, rx, ry, color, rot = 0) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

// ---------------------------------------------------------------- profile walk (faces right)
function footPos(p) {
  p = ((p % 1) + 1) % 1;
  if (p < 0.5) return [STRIDE - 4 * STRIDE * p, 0]; // stance: planted, slides back at walk speed
  const q = (p - 0.5) / 0.5;
  return [-STRIDE + 2 * STRIDE * ease(q), -26 * Math.sin(Math.PI * q)]; // swing: lift and bring forward
}

function shoe(ctx, ankle, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(ankle[0] - 10, ankle[1] - 4, 36, 14, 6);
  ctx.fill();
}

function walkFrame(ctx, p) {
  const hip = [CX - 6, 251 + 4 * Math.cos(2 * TAU * p)];
  const shoulder = [hip[0] + 10, hip[1] - 146];
  const knee = (h, f) => ik(h, f, THIGH, SHIN, (a, b) => (a[0] > b[0] ? a : b)); // knees bend forward
  const elbow = (s, h) => ik(s, h, UPPER_ARM, FOREARM, (a, b) => (a[0] < b[0] ? a : b)); // elbows bend back

  const legs = [p, p + 0.5].map((ph) => {
    const [fx, fy] = footPos(ph);
    const ankle = [hip[0] + fx, ANKLE_Y + fy];
    return { ankle, knee: knee(hip, ankle) };
  });
  const arm = (phase) => {
    const swing = 0.42 * Math.cos(TAU * phase);
    const hand = [shoulder[0] + 140 * Math.sin(-swing) + 10, shoulder[1] + 140 * Math.cos(swing) - 6];
    return { hand, elbow: elbow(shoulder, hand) };
  };
  const nearArm = arm(p), farArm = arm(p + 0.5);

  // far side (shaded)
  limb(ctx, [shoulder, farArm.elbow, farArm.hand], 20, C.shirtShade);
  ellipse(ctx, farArm.hand[0], farArm.hand[1], 9, 9, C.skinShade);
  limb(ctx, [hip, legs[1].knee, legs[1].ankle], 30, C.pantsShade);
  shoe(ctx, legs[1].ankle, '#2a1b12');
  // near leg
  limb(ctx, [hip, legs[0].knee, legs[0].ankle], 30, C.pants);
  shoe(ctx, legs[0].ankle, C.shoe);
  // torso
  ctx.fillStyle = C.shirt;
  ctx.beginPath();
  ctx.moveTo(hip[0] - 26, hip[1] + 8);
  ctx.quadraticCurveTo(hip[0] - 32, hip[1] - 70, shoulder[0] - 26, shoulder[1] - 4);
  ctx.quadraticCurveTo(shoulder[0], shoulder[1] - 16, shoulder[0] + 24, shoulder[1] - 2);
  ctx.quadraticCurveTo(hip[0] + 36, hip[1] - 70, hip[0] + 28, hip[1] + 8);
  ctx.closePath();
  ctx.fill();
  // head (profile)
  const head = [shoulder[0] + 6, shoulder[1] - 48];
  ctx.fillStyle = C.skin;
  ctx.fillRect(head[0] - 9, head[1] + 20, 18, 18);
  ellipse(ctx, head[0], head[1], 29, 32, C.skin);
  ellipse(ctx, head[0] + 28, head[1] + 4, 6, 7, C.skin); // nose
  ctx.fillStyle = C.hair;
  ctx.beginPath();
  ctx.ellipse(head[0] - 3, head[1] - 10, 30, 25, 0, Math.PI * 0.95, TAU * 0.97);
  ctx.fill();
  ellipse(ctx, head[0] - 4, head[1] + 2, 6, 9, C.skinShade); // ear
  ctx.fillStyle = C.beard;
  ctx.beginPath();
  ctx.moveTo(head[0] - 6, head[1] + 4);
  ctx.quadraticCurveTo(head[0] - 2, head[1] + 38, head[0] + 18, head[1] + 34);
  ctx.quadraticCurveTo(head[0] + 30, head[1] + 26, head[0] + 28, head[1] + 14);
  ctx.quadraticCurveTo(head[0] + 12, head[1] + 20, head[0] - 6, head[1] + 4);
  ctx.fill();
  ellipse(ctx, head[0] + 16, head[1] - 4, 3, 3.4, C.hair); // eye
  // near arm
  limb(ctx, [shoulder, nearArm.elbow, nearArm.hand], 21, C.shirt);
  ellipse(ctx, nearArm.hand[0], nearArm.hand[1], 9.5, 9.5, C.skin);
}

// ---------------------------------------------------------------- front-facing poses
const IDLE_POSE = {
  dx: 0, dy: 0, tilt: 0, sit: 0, eyes: 'open', mouth: 'smile',
  handL: [-48, 146], handR: [48, 146], // relative to shoulder center
  bottle: null, extra: null,
};

function frontFrame(ctx, pose) {
  const o = { ...IDLE_POSE, ...pose };
  const sitDrop = o.sit * 92;
  const hip = [CX + o.dx, 251 + o.dy + sitDrop];
  const sc = [hip[0], hip[1] - 146]; // shoulder center
  const sL = [sc[0] - 38, sc[1] + 6], sR = [sc[0] + 38, sc[1] + 6];
  const outward = (side) => (a, b) => (side * a[0] > side * b[0] ? a : b);

  // legs
  for (const side of [-1, 1]) {
    const h = [hip[0] + side * 16, hip[1]];
    const standAnkle = [CX + side * 20, ANKLE_Y];
    const sitAnkle = [CX - side * 18, ANKLE_Y]; // crossed legs
    const ankle = [lerp(standAnkle[0], sitAnkle[0], o.sit), ANKLE_Y];
    const knee = o.sit > 0.5
      ? [h[0] + side * lerp(10, 66, o.sit), lerp(h[1] + 100, GROUND - 26, o.sit)]
      : mix(h, ankle, 0.5).map((v, i) => v + (i === 0 ? side * 3 : 0)); // standing: nearly straight legs
    limb(ctx, [h, knee, ankle], 30, side < 0 ? C.pantsShade : C.pants);
    ellipse(ctx, ankle[0] + side * 6, ankle[1] + 4, 17, 9, C.shoe);
  }

  // torso
  ctx.fillStyle = C.shirt;
  ctx.beginPath();
  ctx.moveTo(hip[0] - 34, hip[1] + 10);
  ctx.quadraticCurveTo(hip[0] - 40, hip[1] - 60, sL[0] - 6, sL[1] - 2);
  ctx.quadraticCurveTo(sc[0], sc[1] - 12, sR[0] + 6, sR[1] - 2);
  ctx.quadraticCurveTo(hip[0] + 40, hip[1] - 60, hip[0] + 34, hip[1] + 10);
  ctx.closePath();
  ctx.fill();
  limb(ctx, [[sc[0] - 13, sc[1] - 4], [sc[0], sc[1] + 14], [sc[0] + 13, sc[1] - 4]], 4, C.shirtShade);
  limb(ctx, [[sc[0], sc[1] + 14], [hip[0], hip[1] + 6]], 2, C.shirtShade);
  for (let i = 0; i < 4; i++) ellipse(ctx, sc[0], sc[1] + 34 + i * 30, 2.2, 2.2, '#f4eee6');

  // head
  ctx.save();
  ctx.translate(sc[0], sc[1] - 8);
  ctx.rotate(o.tilt);
  drawFace(ctx, o);
  ctx.restore();

  // arms (drawn last so hands can reach the face)
  for (const [side, s, rel] of [[-1, sL, o.handL], [1, sR, o.handR]]) {
    const hand = [sc[0] + rel[0], sc[1] + rel[1]];
    const elbow = ik(s, hand, UPPER_ARM, FOREARM, outward(side));
    limb(ctx, [s, elbow, hand], 21, side < 0 ? C.shirtShade : C.shirt);
    if (side === 1 && o.bottle != null) drawBottle(ctx, hand, o.bottle);
    ellipse(ctx, hand[0], hand[1], 10, 10, C.skin);
  }
  if (o.extra) o.extra(ctx, sc);
}

function drawFace(ctx, o) {
  // origin = neck top; head center 40px above
  const hy = -40;
  ctx.fillStyle = C.skin;
  ctx.fillRect(-9, hy + 20, 18, 22);
  ellipse(ctx, -29, hy + 4, 5, 9, C.skinShade);
  ellipse(ctx, 29, hy + 4, 5, 9, C.skinShade);
  ellipse(ctx, 0, hy, 28, 33, C.skin);
  // hair
  ctx.fillStyle = C.hair;
  ctx.beginPath();
  ctx.ellipse(0, hy - 8, 30, 27, 0, Math.PI * 1.02, TAU * 0.985);
  ctx.quadraticCurveTo(0, hy - 18, -29, hy - 4);
  ctx.fill();
  // beard
  ctx.fillStyle = C.beard;
  ctx.beginPath();
  ctx.moveTo(-27, hy + 4);
  ctx.quadraticCurveTo(-24, hy + 40, 0, hy + 40);
  ctx.quadraticCurveTo(24, hy + 40, 27, hy + 4);
  ctx.quadraticCurveTo(14, hy + 22, 0, hy + 20);
  ctx.quadraticCurveTo(-14, hy + 22, -27, hy + 4);
  ctx.fill();
  limb(ctx, [[-12, hy + 14], [0, hy + 11], [12, hy + 14]], 5, C.beard); // moustache
  // brows
  const browY = o.eyes === 'wide' ? hy - 16 : hy - 12;
  limb(ctx, [[-16, browY], [-6, browY - 2]], 3, C.hair);
  limb(ctx, [[6, browY - 2], [16, browY]], 3, C.hair);
  // eyes
  for (const ex of [-11, 11]) {
    if (o.eyes === 'closed') limb(ctx, [[ex - 5, hy - 2], [ex, hy], [ex + 5, hy - 2]], 2.5, C.hair);
    else if (o.eyes === 'happy') limb(ctx, [[ex - 5, hy], [ex, hy - 4], [ex + 5, hy]], 2.5, C.hair);
    else ellipse(ctx, ex, hy - 2, o.eyes === 'wide' ? 4 : 3, o.eyes === 'wide' ? 4.5 : 3.6, C.hair);
  }
  // mouth
  if (o.mouth === 'open') {
    ctx.fillStyle = '#5a1f1b';
    ctx.beginPath();
    ctx.ellipse(0, hy + 21, 9, 7, 0, 0, Math.PI);
    ctx.fill();
  } else if (o.mouth === 'o') {
    ellipse(ctx, 0, hy + 22, 5, 6, '#5a1f1b');
  } else if (o.mouth === 'flat') {
    limb(ctx, [[-6, hy + 21], [6, hy + 21]], 2.5, '#f2e6dc');
  } else {
    limb(ctx, [[-8, hy + 19], [0, hy + 23], [8, hy + 19]], 2.5, '#f2e6dc');
  }
}

function drawBottle(ctx, hand, tilt) {
  ctx.save();
  ctx.translate(hand[0], hand[1]);
  ctx.rotate(tilt);
  ctx.fillStyle = C.bottle;
  ctx.beginPath();
  ctx.roundRect(-9, -34, 18, 52, 6);
  ctx.fill();
  ctx.fillStyle = C.water;
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.roundRect(-9, -14, 18, 32, 5);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.fillStyle = C.cap;
  ctx.fillRect(-5, -42, 10, 9);
  ctx.restore();
}

const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const breathe = (t, cycles = 1) => 1.5 * Math.sin(TAU * cycles * t);

// ---------------------------------------------------------------- clips
const CLIPS = {
  walk_right: { frames: FPS * CYCLE_S, draw: (ctx, t) => walkFrame(ctx, t) },
  walk_left: {
    frames: FPS * CYCLE_S,
    draw: (ctx, t) => { ctx.translate(W, 0); ctx.scale(-1, 1); walkFrame(ctx, t); },
  },
  // looping "still" states run at 12fps: half the decode cost, and breathing doesn't need more
  idle: {
    frames: 24, fps: 12,
    draw: (ctx, t) => frontFrame(ctx, {
      dy: breathe(t), dx: 1.5 * Math.sin(TAU * t),
      eyes: t > 0.62 && t < 0.68 ? 'closed' : 'open',
      handL: [-48, 146 - breathe(t)], handR: [48, 146 - breathe(t)],
    }),
  },
  wave: {
    frames: 48,
    draw: (ctx, t) => {
      const e = envelope(t);
      frontFrame(ctx, {
        eyes: 'happy', tilt: -0.06 * e,
        handR: mix([48, 146], [94 + 20 * Math.sin(TAU * 3 * t), -78], e),
      });
    },
  },
  drink_water: {
    frames: 72,
    draw: (ctx, t) => {
      const e = envelope(t, 0.3, 0.25);
      frontFrame(ctx, {
        tilt: -0.18 * e, eyes: e > 0.8 ? 'closed' : 'open', mouth: e > 0.8 ? 'o' : 'smile',
        handR: mix([48, 146], [22, -36], e), bottle: lerp(0, -2.2, e),
      });
    },
  },
  point: {
    frames: 40,
    draw: (ctx, t) => {
      const e = envelope(t, 0.25, 0.2);
      frontFrame(ctx, { tilt: 0.08 * e, mouth: 'open', handR: mix([48, 146], [150, -60], e) });
    },
  },
  sit: {
    frames: 24, fps: 12,
    draw: (ctx, t) => frontFrame(ctx, {
      sit: 1, dy: breathe(t),
      handL: [-62, 170], handR: [62, 170],
    }),
  },
  sleep: {
    frames: 36, fps: 12,
    draw: (ctx, t) => frontFrame(ctx, {
      sit: 1, dy: 2 * Math.sin(TAU * t), tilt: 0.32, eyes: 'closed', mouth: 'flat',
      handL: [-30, 150], handR: [30, 150],
      extra: (c, sc) => {
        c.fillStyle = C.z;
        c.font = 'bold 22px system-ui, sans-serif';
        for (let i = 0; i < 3; i++) {
          const k = (t + i / 3) % 1;
          c.globalAlpha = Math.sin(Math.PI * k);
          c.fillText('z', sc[0] + 40 + 30 * k, sc[1] - 90 - 70 * k);
        }
        c.globalAlpha = 1;
      },
    }),
  },
  laugh: {
    frames: 40,
    draw: (ctx, t) => {
      const e = envelope(t, 0.15, 0.2);
      const shake = 4 * Math.sin(TAU * 6 * t) * e;
      frontFrame(ctx, {
        dy: shake, tilt: -0.1 * e, eyes: 'happy', mouth: 'open',
        handL: mix([-48, 146], [-26, 112], e), handR: mix([48, 146], [26, 112], e),
      });
    },
  },
  think: {
    frames: 48,
    draw: (ctx, t) => {
      const e = envelope(t, 0.25, 0.25);
      frontFrame(ctx, {
        tilt: 0.12 * e, mouth: 'flat',
        handR: mix([48, 146], [10, -14], e), handL: mix([-48, 146], [24, 76], e),
        extra: (c, sc) => {
          c.globalAlpha = e;
          for (let i = 0; i < 3; i++) ellipse(c, sc[0] + 46 + i * 16, sc[1] - 92 - i * 18, 4 + i * 2, 4 + i * 2, '#9aa3b5');
          c.globalAlpha = 1;
        },
      });
    },
  },
  surprised: {
    frames: 24,
    draw: (ctx, t) => {
      const e = envelope(t, 0.15, 0.35);
      frontFrame(ctx, {
        dy: -10 * Math.sin(Math.PI * Math.min(1, t * 1.6)), eyes: 'wide', mouth: 'o',
        handL: mix([-48, 146], [-84, -76], e), handR: mix([48, 146], [84, -76], e),
      });
    },
  },
};

function renderClip(name) {
  const clip = CLIPS[name];
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const frames = [];
  for (let i = 0; i < clip.frames; i++) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    clip.draw(ctx, i / clip.frames);
    frames.push(canvas.toDataURL('image/png'));
  }
  return frames;
}

function renderIcon(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const s = size / 64;
  ctx.scale(s, s);
  ellipse(ctx, 32, 32, 31, 31, C.shirt);
  ctx.save();
  ctx.translate(32, 50);
  ctx.scale(0.62, 0.62);
  drawFace(ctx, { eyes: 'happy', mouth: 'smile' });
  ctx.restore();
  return canvas.toDataURL('image/png');
}

/** Black silhouette on transparent: macOS menu-bar "template" icon (the system tints it). */
function renderTrayTemplate(size) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.scale(size / 16, size / 16);
  ctx.fillStyle = '#000';
  ellipse(ctx, 8, 3.6, 2.4, 2.6, '#000'); // head
  ctx.beginPath();
  ctx.roundRect(4.6, 6.8, 6.8, 5.4, [2.4, 2.4, 1, 1]); // body
  ctx.fill();
  ctx.fillRect(5.6, 11.6, 1.9, 4); // legs
  ctx.fillRect(8.5, 11.6, 1.9, 4);
  return canvas.toDataURL('image/png');
}

const clipFps = (name) => CLIPS[name].fps ?? FPS;

window.placeholder = { renderClip, renderIcon, renderTrayTemplate, clipFps, clipNames: Object.keys(CLIPS), WALK_SPEED, W, H };
