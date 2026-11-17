// Fix Errors AI promo composition. Pure function of time: window.renderFrame(t) sets every element
// for second t, and window.CUES lists sound cues for tests/promo/audio.py.
// Open comp.html?format=16x9 or ?format=9x16 (add &t=12.3 to preview one moment).
// Structure follows the tabs-manager promo (intro → real footage scenes → privacy beat → outro).
(() => {
  const Q = new URLSearchParams(location.search);
  const V = Q.get('format') === '9x16';
  const W = V ? 1080 : 1920,
    H = V ? 1920 : 1080;
  const CLIPS = window.CLIPS;
  const LANG = window.LANG ?? 'en';
  const L = window.PROMO_TEXT[LANG] ?? window.PROMO_TEXT.en;
  const vbr = (text) => (V ? text : text.replace(/\n/g, ' '));
  const FRAMES = `../../../.artifacts/promo/${LANG}/raw/frames/`;
  const LOGO = window.LOGO; // from clips.js, written by prepare.mjs from harness.mjs LOGO / LOGO_SMALL
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  stage.style.width = `${W}px`;
  stage.style.height = `${H}px`;

  // --- Math -------------------------------------------------------------------------------
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    lin: (p) => p,
    outCubic: (p) => 1 - (1 - p) ** 3,
    inCubic: (p) => p ** 3,
    inOutCubic: (p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
    inOutQuint: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - (-2 * p + 2) ** 5 / 2),
    outExpo: (p) => (p >= 1 ? 1 : 1 - 2 ** (-10 * p)),
    spring: (p) => (p >= 1 ? 1 : 1 - Math.exp(-6.5 * p) * Math.cos(9.5 * p)),
  };
  const prog = (t, t0, t1, e = E.lin) => e(clamp((t - t0) / (t1 - t0)));
  const rnd = (seed) => () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const blur = (px) => (px > 0.05 ? `blur(${px.toFixed(2)}px)` : 'none');
  const rgba = (c, a) => `rgba(${c.map(Math.round).join(',')},${a})`;
  // Keyframes [[t, ...values]] → eased interpolation of the values at time t.
  const keyAt = (keys, t) => {
    if (t <= keys[0][0]) return keys[0].slice(1);
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const p = E.inOutCubic((t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]));
        return keys[i].slice(1).map((v, j) => lerp(keys[i - 1][j + 1], v, p));
      }
    }
    return keys.at(-1).slice(1);
  };

  // --- Sound cues -------------------------------------------------------------------------
  const CUES = [];
  const cue = (t, s, o = {}) => CUES.push({ t: +t.toFixed(4), s, ...o });

  // --- Text helpers -----------------------------------------------------------------------
  const words = (text) => {
    const out = [];
    const frag = document.createDocumentFragment();
    let accent = false;
    text.split('\n').forEach((line, li) => {
      if (li) frag.appendChild(document.createElement('br'));
      line.split(' ').forEach((word, wi) => {
        if (wi) frag.appendChild(document.createTextNode(' '));
        let w = word;
        if (w.startsWith('*')) (accent = true), (w = w.slice(1));
        const ends = w.endsWith('*');
        if (ends) w = w.slice(0, -1);
        const span = document.createElement(accent ? 'em' : 'span');
        span.className = 'w';
        span.textContent = w;
        frag.appendChild(span);
        out.push(span);
        if (ends) accent = false;
      });
    });
    return { frag, spans: out };
  };
  const el = (tag, cls, parent, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    parent?.appendChild(e);
    return e;
  };
  const animWords = (spans, t, tin, tout, o = {}) => {
    const st = o.stagger ?? 0.055,
      dur = o.dur ?? 0.85,
      rise = o.rise ?? 0.42,
      bl = o.blur ?? 14;
    spans.forEach((s, i) => {
      const pi = prog(t, tin + i * st, tin + i * st + dur, E.outExpo);
      const po = tout == null ? 0 : prog(t, tout + i * 0.025, tout + i * 0.025 + 0.45, E.inCubic);
      s.style.opacity = (Math.min(pi, 1 - po) * (o.alpha ?? 1)).toFixed(3);
      s.style.transform = `translateY(${((1 - pi) * rise - po * 0.25).toFixed(3)}em)`;
      s.style.filter = blur((1 - pi) * bl + po * 10);
    });
  };
  // The logo fills its square canvas; sizes of 32 px and below use the simplified variant.
  const iconBox = (parent, size, cls = 'icon') => {
    const box = el('div', cls, parent);
    box.style.width = box.style.height = `${size}px`;
    const img = el('img', '', box);
    img.src = size <= 32 ? LOGO.small : LOGO.full;
    Object.assign(img.style, { width: `${size}px`, height: `${size}px`, left: '0px', top: '0px' });
    return { box, img };
  };

  // --- Grain ------------------------------------------------------------------------------
  {
    const c = $('grain');
    c.width = W / 2;
    c.height = H / 2;
    c.style.width = `${W}px`;
    c.style.height = `${H}px`;
    const g = c.getContext('2d');
    const img = g.createImageData(c.width, c.height);
    const r = rnd(7);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 128 + (r() - 0.5) * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }

  // --- Timeline ---------------------------------------------------------------------------
  const T_POP0 = 0.2;
  const T_FIX0 = 1.95; // typos flip to their corrected spelling, left to right
  const T_IMPLODE = 2.75;
  const T_IMPACT = 3.3;
  const T_LOGO_OUT = 4.85;
  const T_DEV_IN = 5.05;
  const T_SCENE0 = 5.25;

  // Clip segments [from, to, speed] in clip seconds; cam keys [clipT, zoom, cx, cy] (16x9) and
  // focus keys [clipT, cx] for the narrower 9x16 crop.
  const SCENES = [
    {
      clip: 'fix', side: 'R', url: 'mail.example.com/drafts', capDelay: 0.75,
      segs: [[0.35, 2.95, 1.15], [2.95, 5.85, 1], [5.85, 8.0, 1.6], [8.0, 10.6, 1]],
      cam: [[0, 1, 480, 300], [3.05, 1, 480, 300], [3.9, 1.16, 640, 400], [5.75, 1.16, 640, 400], [6.4, 1.24, 700, 470], [8.45, 1.24, 700, 470], [9.4, 1.08, 560, 300]],
      focus: [[0, 520], [2.7, 520], [3.5, 640], [8.5, 640], [9.3, 560]],
    },
    {
      clip: 'review', side: 'L', url: 'mail.example.com/drafts',
      segs: [[0.4, 2.5, 1.2], [2.5, 6.1, 1.2], [6.1, 15.4, 1.8], [15.4, 18.1, 1.3], [18.1, 20.0, 1]],
      cam: [[0, 1, 480, 300], [3.6, 1, 480, 300], [4.6, 1.3, 760, 300], [17.6, 1.3, 760, 300], [18.7, 1.04, 480, 300]],
      focus: [[0, 520], [2.7, 520], [3.6, 640], [18.4, 640], [19.2, 560]],
    },
    {
      clip: 'reply', side: 'R', url: 'chat.example.com/client-demo',
      segs: [[0.4, 2.5, 1.2], [2.5, 4.9, 1], [4.9, 8.3, 1.25], [8.3, 9.6, 1], [9.6, 11.2, 1.5], [11.2, 13.4, 1]],
      cam: [[0, 1, 480, 300], [3.3, 1, 480, 300], [4.2, 1.28, 770, 420], [9.7, 1.28, 770, 420], [11.0, 1.12, 560, 440]],
      focus: [[0, 520], [2.7, 520], [3.5, 640], [11.0, 640], [11.8, 520]],
    },
    {
      clip: 'translit', side: 'L', url: 'chat.example.com/design',
      segs: [[0.35, 2.8, 1.2], [2.8, 7.9, 1]],
      cam: [[0, 1, 480, 300], [2.75, 1, 480, 300], [3.4, 1.15, 600, 420], [5.5, 1.15, 600, 420], [6.2, 1.22, 480, 470]],
      focus: [[0, 520], [2.6, 520], [3.4, 640], [5.5, 640], [6.3, 560]],
    },
    {
      clip: 'popup', side: 'R', url: 'Fix Errors AI', ext: true,
      segs: [[0.6, 8.6, 1.2]],
      cam: [[0, 1.0, 480, 300], [8.6, 1.06, 480, 290]],
      focus: [[0, 480]],
    },
  ];
  let cursorT = T_SCENE0;
  for (const sc of SCENES) {
    sc.c = CLIPS[sc.clip];
    const [eb, h, sub] = L.scenes[sc.clip];
    Object.assign(sc, { eb, h, sub });
    sc.dur = sc.segs.reduce((a, [x, y, s]) => a + (y - x) / s, 0);
    sc.start = cursorT;
    sc.end = cursorT + sc.dur;
    cursorT = sc.end;
  }
  const T_PRIV = cursorT + 0.1;
  const T_OUTRO = T_PRIV + 3.7;
  const DURATION = T_OUTRO + 5.0;

  const toClip = (sc, lt) => {
    let acc = 0;
    if (lt <= 0) return sc.segs[0][0] + lt * sc.segs[0][2];
    for (const [a, b, s] of sc.segs) {
      const d = (b - a) / s;
      if (lt <= acc + d) return a + (lt - acc) * s;
      acc += d;
    }
    const [, b, s] = sc.segs.at(-1);
    return b + (lt - acc) * s;
  };
  // Clip time → scene-local time; times cut out between segments snap to the next segment.
  const toLocal = (sc, ct) => {
    let acc = 0;
    for (const [a, b, s] of sc.segs) {
      if (ct < a) return acc;
      if (ct <= b) return acc + (ct - a) / s;
      acc += (b - a) / s;
    }
    return null;
  };
  const sceneAt = (t) => {
    for (let i = SCENES.length - 1; i >= 0; i--) if (t >= SCENES[i].start) return i;
    return 0;
  };

  // --- Layout -----------------------------------------------------------------------------
  const BAR = 34;
  const SW = V ? 640 : 960,
    SH = 600;
  const DW = SW,
    DH = SH + BAR;
  const HERO = V
    ? { R: { x: 540, y: 1225, s: 1000 / SW, ry: -4 }, L: { x: 540, y: 1225, s: 1000 / SW, ry: 4 } }
    : { R: { x: 1290, y: 560, s: 1.15, ry: -7 }, L: { x: 630, y: 560, s: 1.15, ry: 7 } };

  const devState = (t) => {
    const fl = { y: Math.sin(t * 0.9) * 5, ry: Math.sin(t * 0.55) * 1.2, rx: Math.sin(t * 0.7 + 1) * 0.8 };
    const i = sceneAt(t);
    let base = { ...HERO[SCENES[i].side] };
    for (let k = 1; k < SCENES.length; k++) {
      const B = SCENES[k].start;
      if (t > B - 0.55 && t < B + 0.55) {
        const from = HERO[SCENES[k - 1].side],
          to = HERO[SCENES[k].side];
        const p = prog(t, B - 0.55, B + 0.55, E.inOutCubic);
        const arc = Math.sin(Math.PI * p);
        const dir = Math.sign(to.x - from.x) || (k % 2 ? 1 : -1);
        base = {
          x: lerp(from.x, to.x, p),
          y: lerp(from.y, to.y, p) - arc * (V ? 16 : 10),
          s: lerp(from.s, to.s, p) * (1 - arc * (V ? 0.05 : 0.07)),
          ry: lerp(from.ry, to.ry, p) + arc * dir * (V ? 6 : 9),
        };
      }
    }
    const pin = prog(t, T_DEV_IN, T_DEV_IN + 1.2, E.spring);
    const pin2 = prog(t, T_DEV_IN, T_DEV_IN + 0.9, E.outExpo);
    const ex = prog(t, T_PRIV - 0.45, T_PRIV + 0.35, E.inCubic);
    return {
      x: base.x + (V ? 0 : ex * 40),
      y: base.y + fl.y + (1 - pin2) * 220 + ex * 60,
      s: base.s * lerp(0.82, 1, pin) * (1 - ex * 0.12),
      rx: fl.rx + (1 - pin2) * 18 + ex * 10,
      ry: base.ry + fl.ry,
      o: Math.min(prog(t, T_DEV_IN, T_DEV_IN + 0.35), 1 - ex),
      blur: (1 - pin2) * 14 + ex * 12,
    };
  };
  // Camera inside the screen: which part of the 960×600 page is shown, and how close.
  const camAt = (sc, ct) => {
    let [z, cx, cy] = keyAt(sc.cam, ct);
    if (V) {
      z = 1 + (z - 1) * 0.35;
      cx = keyAt(sc.focus, ct)[0];
    }
    const hw = SW / (2 * z),
      hh = SH / (2 * z);
    cx = clamp(cx, hw, 960 - hw);
    cy = clamp(cy, hh, 600 - hh);
    return { z, cx, cy, tx: SW / 2 - cx * z, ty: SH / 2 - cy * z };
  };

  // --- Background -------------------------------------------------------------------------
  const C1 = [96, 122, 196],
    C2 = [58, 132, 104];
  const b1 = $('b1'),
    b2 = $('b2'),
    b3 = $('b3');
  const drawBg = (t) => {
    const introGlow = prog(t, 0, 1.2) * (1 - prog(t, T_IMPLODE, T_IMPACT) * 0.7) + prog(t, T_IMPACT, T_IMPACT + 0.4) * 0.7;
    const k = Math.min(1, introGlow + prog(t, T_DEV_IN, T_DEV_IN + 1));
    const fade = 1 - prog(t, DURATION - 0.9, DURATION - 0.1);
    const S = Math.max(W, H);
    b1.style.cssText = `width:${S * 1.2}px;height:${S * 1.2}px;left:${W * 0.62 - S * 0.6 + Math.sin(t * 0.21) * 80}px;top:${-S * 0.78 + Math.cos(t * 0.17) * 60}px;background:radial-gradient(closest-side,${rgba(C1, 0.55 * k * fade)},transparent)`;
    b2.style.cssText = `width:${S}px;height:${S}px;left:${-S * 0.62 + Math.cos(t * 0.19) * 70}px;top:${H - S * 0.38 + Math.sin(t * 0.23) * 60}px;background:radial-gradient(closest-side,${rgba(C2, 0.42 * k * fade)},transparent)`;
    b3.style.cssText = `width:${S * 0.7}px;height:${S * 0.7}px;left:${W / 2 - S * 0.35 + Math.sin(t * 0.13) * 120}px;top:${H / 2 - S * 0.35 + Math.cos(t * 0.11) * 90}px;background:radial-gradient(closest-side,${rgba(C1, 0.12 * k * fade)},transparent)`;
    $('grid').style.opacity = (0.9 * k * fade).toFixed(3);
  };

  // --- Intro: typos everywhere, fixed, imploding into the logo ------------------------------
  const intro = $('intro');
  const R = rnd(42);
  const cx = W / 2,
    cy = V ? H * 0.46 : H * 0.48;
  const typos = L.typos.map(([bad, good], i) => {
    let x, y, tries = 0;
    do {
      x = -40 + R() * (W - 160);
      y = 30 + R() * (H - 100);
      tries++;
    } while (tries < 80 && ((x + 90 - cx) / (V ? 360 : 520)) ** 2 + ((y + 31 - cy) / (V ? 200 : 150)) ** 2 < 1);
    const e = el('div', 'typo', intro);
    const span = el('span', '', e);
    span.textContent = bad;
    const d = 0.62 + R() * 0.5;
    const u = i / (L.typos.length - 1);
    return { e, span, bad, good, x, y, d, rot: (R() - 0.5) * 8, a: T_POP0 + 2.0 * (1 - (1 - u) ** 1.7), drift: (R() - 0.5) * 30 };
  });
  typos.forEach((p, i) => {
    p.e.style.zIndex = Math.round(p.d * 100);
    p.fixAt = T_FIX0 + clamp((p.x + 90) / W) * 0.6;
    cue(p.a, 'pop', { g: 0.5 - 0.22 * (i / typos.length), p: (p.x + 90) / W - 0.5, pitch: 0.92 + ((i * 7) % 10) / 22 });
    if (i % 3 === 0) cue(p.fixAt, 'tick', { g: 0.32, p: (p.x + 90) / W - 0.5, pitch: 1.25 + (i % 5) * 0.05 });
  });
  const familiar = el('div', '', intro);
  familiar.id = 'familiar';
  const fam = words(L.familiar);
  familiar.appendChild(fam.frag);
  const ring = el('div', '', intro);
  ring.id = 'ring';
  const logo = el('div', '', intro);
  logo.id = 'logo';
  const ICON = V ? 210 : 150;
  const logoIcon = iconBox(logo, ICON);
  logoIcon.box.style.filter = 'drop-shadow(0 20px 50px #8fa9f055)';
  const logoName = el('div', 'name', logo);
  const ln = words('Fix Errors AI');
  logoName.appendChild(ln.frag);
  const logoTag = el('div', 'tag', logo);
  const lt = words(vbr(V ? 'Fix, rewrite and translate\nright where you type.' : L.tagline));
  logoTag.appendChild(lt.frag);
  logoName.style.fontSize = `${V ? 136 : 112}px`;
  logoName.style.marginTop = `${V ? 44 : 34}px`;
  logoTag.style.fontSize = `${V ? 42 : 34}px`;
  logoTag.style.marginTop = `${V ? 30 : 22}px`;
  logoTag.style.lineHeight = '1.3';

  cue(1.6, 'riser', { d: T_IMPACT - 1.6 });
  cue(T_IMPLODE, 'suck', { d: T_IMPACT - T_IMPLODE });
  cue(T_IMPACT, 'boom', { g: 1 });
  cue(T_IMPACT + 0.02, 'shimmer', { g: 0.7 });
  cue(T_LOGO_OUT - 0.05, 'whoosh', { d: 0.8, g: 0.5, p: 0 });
  cue(T_DEV_IN + 0.05, 'swoosh', { d: 1.0, g: 0.55, p: 0.2 });

  const drawIntro = (t) => {
    if (t > T_LOGO_OUT + 0.8) {
      intro.style.display = 'none';
      return;
    }
    intro.style.display = '';
    const imp = prog(t, T_IMPLODE, T_IMPACT - 0.03, (p) => p ** 2.6);
    for (const p of typos) {
      const a = prog(t, p.a, p.a + 0.55, E.spring);
      const ao = prog(t, p.a, p.a + 0.12);
      const fixed = t >= p.fixAt;
      if (p.span.textContent !== (fixed ? p.good : p.bad)) p.span.textContent = fixed ? p.good : p.bad;
      p.e.classList.toggle('fixed', fixed);
      const bump = fixed ? 1 + 0.12 * Math.sin(Math.PI * prog(t, p.fixAt, p.fixAt + 0.25)) : 1;
      let x = p.x + p.drift * t * 0.1,
        y = p.y - (t - p.a) * 10 * p.d + (1 - a) * 26;
      x = lerp(x, cx - 90, imp);
      y = lerp(y, cy - 31, imp);
      const s = p.d * lerp(0.55, 1, a) * (1 - imp * 0.92) * bump;
      p.e.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) rotate(${(p.rot * (1 + imp * 6)).toFixed(2)}deg) scale(${s.toFixed(3)})`;
      p.e.style.opacity = (ao * (0.45 + 0.55 * ((p.d - 0.62) / 0.5)) * (1 - prog(imp, 0.75, 1))).toFixed(3);
      p.e.style.filter = blur((p.d < 0.8 ? (0.8 - p.d) * 8 : 0) + imp * 4);
    }
    familiar.style.cssText = `left:0;width:${W}px;top:${cy - (V ? 70 : 62)}px;font-size:${V ? 100 : 124}px;z-index:200`;
    animWords(fam.spans, t, 0.95, T_IMPLODE - 0.1, { stagger: 0.12, rise: 0.3 });
    const li = prog(t, T_IMPACT - 0.04, T_IMPACT + 0.95, E.spring);
    const lo = prog(t, T_LOGO_OUT, T_LOGO_OUT + 0.6, E.inCubic);
    const top = cy - (V ? 360 : 280);
    logo.style.cssText = `left:0;width:${W}px;top:${top}px;z-index:300;transform:translateY(${(-lo * 70).toFixed(1)}px);opacity:${(1 - lo).toFixed(3)};filter:${blur(lo * 12)}`;
    logoIcon.box.style.opacity = prog(t, T_IMPACT - 0.04, T_IMPACT + 0.08).toFixed(3);
    logoIcon.box.style.transform = `scale(${li.toFixed(4)}) rotate(${((1 - li) * -14).toFixed(2)}deg)`;
    animWords(ln.spans, t, T_IMPACT + 0.3, null, { stagger: 0.09, rise: 0.35 });
    animWords(lt.spans, t, T_IMPACT + 0.7, null, { stagger: 0.035 });
    const rp = prog(t, T_IMPACT, T_IMPACT + 1.0, E.outCubic);
    const rs = ICON * (1 + rp * 4.5);
    ring.style.cssText = `left:${W / 2 - rs / 2}px;top:${top + ICON / 2 - rs / 2}px;width:${rs}px;height:${rs}px;opacity:${(t >= T_IMPACT ? (1 - rp) * 0.6 : 0).toFixed(3)};border-width:${(3 * (1 - rp) + 0.5).toFixed(2)}px;z-index:250`;
  };

  // --- Captions ---------------------------------------------------------------------------
  const caps = $('caps');
  const mkCap = (eb, h, sub, place) => {
    const c = el('div', 'cap', caps);
    const ebEl = el('div', 'eb', c);
    const ebW = words(eb);
    ebEl.appendChild(ebW.frag);
    const hEl = el('h2', '', c);
    const hW = words(h);
    hEl.appendChild(hW.frag);
    let subW = { spans: [] };
    if (sub) {
      const sEl = el('div', 'sub', c);
      subW = words(sub);
      sEl.appendChild(subW.frag);
      sEl.style.fontSize = `${V ? 31 : 26}px`;
      sEl.style.marginTop = `${V ? 24 : 28}px`;
      if (V) sEl.style.padding = '0 30px';
    }
    ebEl.style.fontSize = `${V ? 25 : 19}px`;
    ebEl.style.marginBottom = `${V ? 22 : 22}px`;
    hEl.style.fontSize = `${V ? 86 : 80}px`;
    Object.assign(c.style, place);
    return { c, eb: ebW.spans, h: hW.spans, sub: subW.spans };
  };
  const capPlace = (side) =>
    V
      ? { left: '50px', width: `${W - 100}px`, top: '230px', textAlign: 'center' }
      : side === 'R'
        ? { left: '120px', width: '560px', top: '540px', transform: 'translateY(-50%)' }
        : { left: '1250px', width: '580px', top: '540px', transform: 'translateY(-50%)' };
  for (const sc of SCENES) {
    sc.cap = mkCap(sc.eb, sc.h, sc.sub, capPlace(sc.side));
    sc.capIn = sc.start + (sc.capDelay ?? 0.2);
    sc.capOut = sc.end - 0.42;
  }
  const drawCaps = (t) => {
    for (const sc of SCENES) {
      const vis = t > sc.capIn - 0.1 && t < sc.capOut + 0.9;
      sc.cap.c.style.display = vis ? '' : 'none';
      if (!vis) continue;
      animWords(sc.cap.eb, t, sc.capIn, sc.capOut, { stagger: 0.03, rise: 0.6, blur: 8 });
      animWords(sc.cap.h, t, sc.capIn + 0.1, sc.capOut, { stagger: 0.07 });
      animWords(sc.cap.sub, t, sc.capIn + 0.45, sc.capOut, { stagger: 0.018, dur: 0.7, blur: 8, rise: 0.5 });
    }
  };

  // --- Device / footage -------------------------------------------------------------------
  const device = $('device'),
    cam = $('cam'),
    fa = $('fa'),
    fb = $('fb'),
    cursor = $('cursor'),
    ripple = $('ripple'),
    ripple2 = $('ripple2'),
    shine = $('shine'),
    frameline = $('frameline'),
    keys = $('keys'),
    url = $('url');
  device.style.width = `${DW}px`;
  device.style.height = `${DH}px`;
  device.style.transformOrigin = `${DW / 2}px ${DH / 2}px`;
  iconBox($('extIcon'), 18, 'mini');
  const clipFrame = (sc, lt) => {
    const ct = toClip(sc, lt);
    const i = clamp(Math.floor(ct * sc.c.fps), 0, sc.c.frames.length - 1);
    return FRAMES + sc.c.frames[i];
  };
  const cursorAt = (sc, ct) => {
    let prev = null,
      next = null;
    for (const e of sc.c.events) {
      if (e.type !== 'move' && e.type !== 'down' && e.type !== 'click') continue;
      if (e.t <= ct) prev = e;
      else {
        next = e;
        break;
      }
    }
    if (!prev) return { ...sc.c.cursorStart };
    if (!next || next.t - prev.t > 0.05) return { x: prev.x, y: prev.y };
    const p = (ct - prev.t) / (next.t - prev.t);
    return { x: lerp(prev.x, next.x, p), y: lerp(prev.y, next.y, p) };
  };
  const setSrc = async (img, src) => {
    if (img.dataset.src === src) return;
    img.dataset.src = src;
    img.src = src;
    try {
      await img.decode();
    } catch {}
  };

  // Shortcut overlays: "key:Alt+Shift+R" marks show the keys that open the panel.
  for (const sc of SCENES) {
    sc.keys = sc.c.marks
      .filter((m) => m.label.startsWith('key:'))
      .map((m) => ({ t: m.t, keys: m.label.slice(4).split('+') }));
  }
  const keyEls = {};
  const drawKeys = (sc, ct, lt) => {
    const k = sc.keys.find((k) => ct >= k.t - 0.05 && ct < k.t + 1.9);
    if (!k) {
      keys.style.opacity = 0;
      return;
    }
    const id = k.keys.join('+');
    if (keys.dataset.id !== id) {
      keys.dataset.id = id;
      keys.innerHTML = k.keys.map((x) => `<kbd>${x}</kbd>`).join('<b>+</b>');
      keyEls[id] = [...keys.querySelectorAll('kbd')];
    }
    const kl = toLocal(sc, k.t);
    const p = prog(lt, kl, kl + 0.5, E.spring);
    const o = Math.min(prog(lt, kl, kl + 0.12), 1 - prog(lt, kl + 1.1, kl + 1.4));
    keys.style.opacity = o.toFixed(3);
    keys.style.transform = `translateY(${((1 - p) * 18).toFixed(1)}px) scale(${(lerp(0.85, 1, p) * (V ? 0.62 : 1)).toFixed(3)})`;
    keys.style.transformOrigin = '0 100%';
    keyEls[id].forEach((kb, i) => {
      const press = Math.sin(Math.PI * prog(lt, kl + 0.15 + i * 0.09, kl + 0.35 + i * 0.09));
      kb.style.transform = `translateY(${(press * 3).toFixed(2)}px)`;
      kb.style.borderBottomWidth = `${(4 - press * 2.5).toFixed(2)}px`;
    });
  };

  // Cues from the real input events and marks.
  for (const sc of SCENES) {
    let wheelN = 0;
    const pan = sc.side === 'R' ? 0.25 : -0.25;
    for (const e of sc.c.events) {
      const l = toLocal(sc, e.t);
      if (l == null) continue;
      const T = sc.start + l;
      if (T > sc.end + 0.05 || T < sc.start) continue;
      const p = V ? 0 : pan + (e.x / 960 - 0.5) * 0.3;
      if (e.type === 'down') cue(T, 'click', { g: 0.85, p });
      else if (e.type === 'click') cue(T, 'clickup', { g: 0.45, p });
      else if (e.type === 'key') cue(T, 'key', { g: 0.5, p, pitch: 0.9 + ((e.key?.charCodeAt(0) ?? 3) % 7) / 25 });
      else if (e.type === 'wheel' && wheelN++ % 2 === 0) cue(T, 'tick', { g: 0.22, p, pitch: 1.4 });
    }
    for (const m of sc.c.marks) {
      const l = toLocal(sc, m.t);
      if (l == null) continue;
      const T = sc.start + l;
      if (m.label.startsWith('key:')) [0.15, 0.24, 0.33].forEach((d, i) => cue(T + d, 'key', { g: 0.75, p: 0, pitch: 0.85 + i * 0.07 }));
      else if (m.label === 'done' || m.label === 'applied') cue(T + 0.05, 'chime', { g: 0.32, p: 0.1, pitch: 1.5 });
      else if (m.label === 'working') cue(T, 'swish', { g: 0.3, p: 0.2 });
      else if (m.label.startsWith('action:')) cue(T + 0.05, 'pop', { g: 0.3, p: 0, pitch: 1.2 });
    }
  }
  SCENES.forEach((sc, k) => {
    if (k) cue(sc.start - 0.55, 'whoosh', { d: 1.1, g: 0.42, p: V ? 0 : Math.sign(HERO[sc.side].x - HERO[SCENES[k - 1].side].x) * 0.35 });
  });

  const drawDevice = async (t) => {
    if (t < T_DEV_IN || t > T_PRIV + 0.5) {
      device.style.display = 'none';
      return;
    }
    device.style.display = '';
    const st = devState(t);
    device.style.transform = `translate(${(st.x - DW / 2).toFixed(2)}px,${(st.y - DH / 2).toFixed(2)}px) perspective(2600px) rotateX(${st.rx.toFixed(3)}deg) rotateY(${st.ry.toFixed(3)}deg) scale(${st.s.toFixed(4)})`;
    device.style.opacity = st.o.toFixed(3);
    device.style.filter = blur(st.blur);
    frameline.style.borderRadius = $('screen').style.borderRadius = '0 0 14px 14px';
    device.style.borderRadius = '14px';
    frameline.style.borderRadius = '14px';
    frameline.style.boxShadow = `0 0 0 ${(1 / st.s).toFixed(3)}px rgba(255,255,255,0.16), 0 30px 80px rgba(0,0,0,0.55), 0 0 120px rgba(143,169,240,0.12)`;
    $('chrome').style.borderRadius = '14px 14px 0 0';

    const i = sceneAt(t);
    const sc = SCENES[i];
    const lt = t - sc.start;
    const ct = toClip(sc, lt);
    if (url.textContent !== sc.url) url.textContent = sc.url;
    // Footage with a short cross-dissolve at cuts.
    const XF = 0.16;
    const jobs = [setSrc(fa, clipFrame(sc, lt))];
    let other = null;
    if (i + 1 < SCENES.length && t > sc.end - XF) other = [SCENES[i + 1], t - SCENES[i + 1].start, prog(t, sc.end - XF, sc.end + XF)];
    if (i > 0 && t < sc.start + XF) other = [SCENES[i - 1], t - SCENES[i - 1].start, 1 - prog(t, sc.start - XF, sc.start + XF)];
    if (other) {
      jobs.push(setSrc(fb, clipFrame(other[0], other[1])));
      fb.style.opacity = other[2].toFixed(3);
      fb.style.display = '';
    } else fb.style.display = 'none';
    const c = camAt(sc, ct);
    cam.style.transform = `translate(${c.tx.toFixed(2)}px,${c.ty.toFixed(2)}px) scale(${c.z.toFixed(4)})`;
    shine.style.opacity = (Math.sin(Math.PI * prog(t, T_DEV_IN + 0.3, T_DEV_IN + 1.4)) * 0.9).toFixed(3);
    shine.style.transform = `translateX(${lerp(-SW * 0.6, SW * 0.6, prog(t, T_DEV_IN + 0.3, T_DEV_IN + 1.4, E.inOutCubic)).toFixed(1)}px)`;
    // Cursor: the real logged pointer path.
    const cp = cursorAt(sc, ct);
    const downs = sc.c.events.filter((e) => e.type === 'down' && e.t <= ct);
    const lastDown = downs.at(-1);
    const ups = sc.c.events.filter((e) => e.type === 'click' && e.t <= ct);
    const pressed = lastDown && (!ups.length || ups.at(-1).t < lastDown.t);
    const sinceUp = ups.length ? ct - ups.at(-1).t : 9;
    const press = pressed ? 1 : 1 - clamp(sinceUp / 0.14);
    const cs = ((1 - press * 0.16) * 1.15) / c.z;
    cursor.style.transform = `translate(${(cp.x - 2).toFixed(2)}px,${(cp.y - 2).toFixed(2)}px) scale(${cs.toFixed(3)})`;
    cursor.style.opacity = prog(t, T_DEV_IN + 0.5, T_DEV_IN + 0.8).toFixed(3);
    if (lastDown && ct - lastDown.t < 0.6) {
      const p = clamp((ct - lastDown.t) / 0.6);
      const e = E.outCubic(p);
      const k = 1 / c.z;
      ripple.style.transform = `translate(${lastDown.x}px,${lastDown.y}px) scale(${((0.25 + e * 0.9) * k).toFixed(3)})`;
      ripple.style.opacity = ((1 - p) * 0.7).toFixed(3);
      ripple.style.borderWidth = `${(2.4 * (1 - p) + 0.6).toFixed(2)}px`;
      ripple2.style.transform = `translate(${lastDown.x}px,${lastDown.y}px) scale(${((0.2 + e * 0.55) * k).toFixed(3)})`;
      ripple2.style.opacity = ((1 - p) * 0.2).toFixed(3);
    } else ripple.style.opacity = ripple2.style.opacity = 0;
    drawKeys(sc, ct, lt);
    await Promise.all(jobs);
  };

  // --- Privacy beat -----------------------------------------------------------------------
  const priv = $('privacy');
  const PL = L.privacy.map((txt) => {
    const d = el('div', 'line', priv);
    d.style.fontSize = `${V ? 132 : 124}px`;
    const w = words(txt);
    d.appendChild(w.frag);
    return { d, spans: w.spans };
  });
  const pNote = el('div', 'note', priv);
  pNote.style.fontSize = `${V ? 34 : 30}px`;
  pNote.style.marginTop = `${V ? 48 : 40}px`;
  if (V) pNote.style.padding = '0 60px';
  const pn = words(V ? L.privacyNote.replace(/\n/g, ' ') : L.privacyNote);
  pNote.appendChild(pn.frag);
  const PT = [0.25, 0.85, 1.45].map((d) => T_PRIV + d);
  PT.forEach((tt, i) => cue(tt, 'thump', { g: 0.8 - i * 0.05, pitch: 1 + i * 0.06 }));
  cue(T_PRIV + 2.0, 'tone', { g: 0.35 });
  cue(T_PRIV + 3.15, 'whoosh', { d: 0.9, g: 0.4, p: 0 });
  const drawPriv = (t) => {
    const vis = t > T_PRIV && t < T_OUTRO + 0.4;
    priv.style.display = vis ? '' : 'none';
    if (!vis) return;
    const out = T_PRIV + 3.25;
    PL.forEach((l, i) => {
      const dim = i < 2 ? prog(t, PT[i + 1], PT[i + 1] + 0.35) * 0.62 : 0;
      animWords(l.spans, t, PT[i], out, { stagger: 0.06, alpha: 1 - dim, rise: 0.5 });
    });
    animWords(pn.spans, t, T_PRIV + 2.0, out, { stagger: 0.02, dur: 0.7, blur: 8 });
  };

  // --- Outro ------------------------------------------------------------------------------
  const outro = $('outro');
  const OI = V ? 220 : 170;
  const oIcon = iconBox(outro, OI);
  oIcon.box.style.filter = 'drop-shadow(0 24px 60px #8fa9f066)';
  const oName = el('div', 'name', outro);
  oName.style.fontSize = `${V ? 132 : 116}px`;
  oName.style.marginTop = `${V ? 50 : 40}px`;
  const on = words('Fix Errors AI');
  oName.appendChild(on.frag);
  const oTag = el('div', 'tag', outro);
  oTag.style.fontSize = `${V ? 44 : 38}px`;
  oTag.style.marginTop = `${V ? 34 : 26}px`;
  const ot = words(vbr(L.outroTag));
  oTag.appendChild(ot.frag);
  const oMeta = el('div', 'meta', outro);
  oMeta.style.fontSize = `${V ? 23 : 20}px`;
  oMeta.style.marginTop = `${V ? 70 : 56}px`;
  const om = words(L.outroMeta);
  oMeta.appendChild(om.frag);
  cue(T_OUTRO + 0.08, 'boom', { g: 0.55 });
  cue(T_OUTRO + 0.12, 'chime', { g: 0.75 });
  const drawOutro = (t) => {
    const vis = t > T_OUTRO;
    outro.style.display = vis ? '' : 'none';
    if (!vis) return;
    const ip = prog(t, T_OUTRO + 0.05, T_OUTRO + 1.0, E.spring);
    oIcon.box.style.opacity = prog(t, T_OUTRO + 0.05, T_OUTRO + 0.2).toFixed(3);
    oIcon.box.style.transform = `scale(${ip.toFixed(4)}) rotate(${((1 - ip) * -12).toFixed(2)}deg)`;
    animWords(on.spans, t, T_OUTRO + 0.35, null, { stagger: 0.08, rise: 0.35 });
    animWords(ot.spans, t, T_OUTRO + 0.85, null, { stagger: 0.05 });
    animWords(om.spans, t, T_OUTRO + 1.35, null, { stagger: 0.03, blur: 6 });
    const f = prog(t, DURATION - 0.85, DURATION - 0.1, E.inCubic);
    outro.style.opacity = (1 - f).toFixed(3);
    outro.style.transform = `scale(${(1 - f * 0.03).toFixed(4)})`;
  };

  // --- Flash ------------------------------------------------------------------------------
  const flash = $('flash');
  const drawFlash = (t) => {
    const a = (1 - prog(t, T_IMPACT, T_IMPACT + 0.55, E.outCubic)) * (t >= T_IMPACT ? 0.32 : 0);
    flash.style.background = `radial-gradient(circle at 50% ${V ? 38 : 36}%, rgba(200,215,255,${a.toFixed(3)}), rgba(110,140,220,${(a * 0.4).toFixed(3)}) 45%, transparent 75%)`;
  };

  // --- Render -----------------------------------------------------------------------------
  window.DURATION = DURATION;
  window.SIZE = { W, H };
  CUES.sort((a, b) => a.t - b.t);
  window.CUES = CUES;
  window.MUSIC = { start: T_IMPACT, end: DURATION, impact: T_IMPACT, outro: T_OUTRO, priv: T_PRIV, scenes: SCENES.map((s) => s.start) };
  window.TIMELINE = { scenes: SCENES.map((s) => ({ clip: s.clip, start: +s.start.toFixed(2), end: +s.end.toFixed(2) })), priv: T_PRIV, outro: T_OUTRO };
  window.renderFrame = async (t) => {
    drawBg(t);
    drawIntro(t);
    drawCaps(t);
    drawPriv(t);
    drawOutro(t);
    drawFlash(t);
    await drawDevice(t);
  };
  window.READY = (async () => {
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll('img')].map((i) => i.decode().catch(() => {})));
    const t0 = parseFloat(Q.get('t') ?? '');
    if (!Number.isNaN(t0)) await window.renderFrame(t0);
    return true;
  })();
})();
