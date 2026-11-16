/* =========================================================
   WATERCOIN — interactions & scroll choreography
   GSAP + ScrollTrigger + Lenis (self-hosted in assets/vendor).
   ========================================================= */

// ---- the three public links. Empty CA / BUY_URL would fall back to "coming soon" ----
const CONFIG = {
  CA: 'FV23gQJYmnqSZtEkVCzVAzwS5YmSQcp7UuYSLVepump',     // $WATER contract address (same value as EXPECTED.mint in api/_lib/meter-core.js)
  X_URL: 'https://x.com/watercoinpf_',                   // official X profile
  BUY_URL: 'https://pump.fun/coin/FV23gQJYmnqSZtEkVCzVAzwS5YmSQcp7UuYSLVepump'
};

(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* =======================================================
     Links, CA, toast (work even without the animation libs)
     ======================================================= */
  const toastEl = $('.toast');
  let toastT = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  for (const a of $$('[data-x-link]')) {
    if (CONFIG.X_URL) { a.href = CONFIG.X_URL; a.target = '_blank'; a.rel = 'noopener'; }
    else a.addEventListener('click', e => { e.preventDefault(); toast('Our X goes live with the launch. Stay thirsty.'); });
  }
  for (const a of $$('[data-buy-link]')) {
    if (CONFIG.BUY_URL) { a.href = CONFIG.BUY_URL; a.target = '_blank'; a.rel = 'noopener'; const i = a.querySelector('i'); if (i) i.remove(); }
    else a.addEventListener('click', e => { e.preventDefault(); toast('$WATER is not live yet. The CA drops here first.'); });
  }
  if (CONFIG.CA) {
    for (const el of $$('[data-ca]')) el.textContent = CONFIG.CA;
    const pt = $('[data-ca-pill-text]'); if (pt) pt.textContent = CONFIG.CA.slice(0, 4) + '…' + CONFIG.CA.slice(-4);
  }
  async function copyCA() {
    if (!CONFIG.CA) return toast('CA coming soon. Only trust this site and our X.');
    try { await navigator.clipboard.writeText(CONFIG.CA); toast('Contract address copied 💧'); }
    catch { toast(CONFIG.CA); }
  }
  for (const b of $$('[data-copy-ca], [data-ca-pill]')) b.addEventListener('click', copyCA);
  for (const y of $$('[data-year]')) y.textContent = new Date().getFullYear();

  /* =======================================================
     Wave engine: every path[data-wave] becomes a living water line.
     data-w width, data-y baseline (can change live), data-a amplitude,
     data-l wavelength, data-s speed (rad/s, sign = direction), data-h bottom, data-p phase.
     ======================================================= */
  let slosh = 0; // extra amplitude from scroll speed
  const waves = $$('[data-wave]').map(el => {
    const d = el.dataset;
    return { el, w: +d.w, a: +d.a, l: +d.l, s: +d.s, h: +d.h, p: +(d.p || 0), vis: true, edge: !!el.closest('.edge, .footer-waves') };
  });
  function wavePath(o, t) {
    const y = parseFloat(o.el.dataset.y);
    const seg = Math.max(24, Math.min(160, Math.ceil(o.w / o.l * 22)));
    const amp = o.a * (o.edge ? 1 + slosh : 1);
    const k = Math.PI * 2 / o.l, ph = o.p + t * o.s;
    let d = `M0 ${o.h}L0 ${(y + amp * Math.sin(ph)).toFixed(2)}`;
    for (let i = 1; i <= seg; i++) {
      const x = o.w * i / seg;
      // two harmonics so it never looks like a perfect sine
      const yy = y + amp * Math.sin(x * k + ph) + amp * .28 * Math.sin(x * k * 2.3 - ph * 1.3);
      d += `L${x.toFixed(1)} ${yy.toFixed(2)}`;
    }
    return d + `L${o.w} ${o.h}Z`;
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => {
      for (const e of entries) for (const o of waves) if (o.el.ownerSVGElement === e.target) o.vis = e.isIntersecting;
    }, { rootMargin: '120px' });
    new Set(waves.map(o => o.el.ownerSVGElement)).forEach(svg => svg && io.observe(svg));
  }
  function drawWaves(t) {
    for (const o of waves) if (o.vis) o.el.setAttribute('d', wavePath(o, t));
  }
  drawWaves(0);

  /* =======================================================
     Bubbles: a few rising through the whole page
     ======================================================= */
  const bc = $('#bubbles'), bx = bc.getContext('2d');
  let bubbles = [], bw = 0, bh = 0, bdpr = 1;
  function sizeBubbles() {
    bdpr = Math.min(devicePixelRatio || 1, 2);
    bw = innerWidth; bh = innerHeight;
    bc.width = bw * bdpr; bc.height = bh * bdpr;
    bx.setTransform(bdpr, 0, 0, bdpr, 0, 0);
    const n = reduce ? 0 : (bw < 760 ? 10 : 22);
    bubbles = Array.from({ length: n }, () => newBubble(true));
  }
  function newBubble(anywhere) {
    const r = 2 + Math.random() * Math.random() * 9;
    return { x: Math.random() * bw, y: anywhere ? Math.random() * bh : bh + r + Math.random() * 80, r, v: 18 + r * 7 + Math.random() * 20, ph: Math.random() * 6.28, f: .6 + Math.random() * 1.4 };
  }
  let lastBT = 0, scrollVel = 0;
  function drawBubbles(t) {
    const dt = Math.min(.05, (t - lastBT) / 1000 || 0); lastBT = t;
    bx.clearRect(0, 0, bw, bh);
    bx.lineWidth = 1.3;
    for (let i = 0; i < bubbles.length; i++) {
      const b = bubbles[i];
      b.y -= (b.v + scrollVel * .06) * dt;
      const x = b.x + Math.sin(t / 1000 * b.f + b.ph) * (4 + b.r);
      if (b.y < -20 || b.y > bh + 140) { bubbles[i] = newBubble(false); continue; }
      bx.beginPath(); bx.arc(x, b.y, b.r, 0, Math.PI * 2);
      bx.strokeStyle = 'rgba(255,255,255,.55)'; bx.stroke();
      bx.beginPath(); bx.arc(x - b.r * .35, b.y - b.r * .35, b.r * .25, 0, Math.PI * 2);
      bx.fillStyle = 'rgba(255,255,255,.6)'; bx.fill();
    }
  }
  bc.style.mixBlendMode = 'difference';
  bc.style.opacity = '.55';
  sizeBubbles();
  addEventListener('resize', sizeBubbles);

  /* =======================================================
     Cursor + magnetic buttons
     ======================================================= */
  const cursor = $('.cursor-wrap');
  let mx = innerWidth / 2, my = innerHeight / 2;
  if (fine) {
    addEventListener('pointermove', e => { mx = e.clientX; my = e.clientY; cursor.style.opacity = 1; }, { passive: true });
    addEventListener('pointerdown', () => cursor.classList.add('is-down'));
    addEventListener('pointerup', () => cursor.classList.remove('is-down'));
    document.addEventListener('pointerover', e => cursor.classList.toggle('is-hover', !!e.target.closest('a, button, [data-hover]')));
    document.documentElement.addEventListener('pointerleave', () => { cursor.style.opacity = 0; });
    for (const m of $$('.magnetic')) {
      m.addEventListener('pointermove', e => {
        const r = m.getBoundingClientRect();
        m.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * .25}px, ${(e.clientY - r.top - r.height / 2) * .35}px)`;
      });
      m.addEventListener('pointerleave', () => { m.style.transform = ''; });
      m.style.transition = 'transform .5s cubic-bezier(.16,1,.3,1), color .4s, border-color .4s, background .4s';
    }
  }
  // a liquid cursor: a chain of drops fused by an SVG goo filter
  const blobs = $$('.cursor-wrap circle').map((el, i) => ({ el, x: mx, y: my, r: +el.getAttribute('r'), r0: +el.getAttribute('r'), k: .32 - i * .045 }));
  function moveCursor() {
    const hover = cursor.classList.contains('is-hover'), down = cursor.classList.contains('is-down');
    let px = mx, py = my;
    blobs.forEach((b, i) => {
      b.x += (px - b.x) * b.k; b.y += (py - b.y) * b.k;
      const target = i === 0 ? (down ? b.r0 * .6 : hover ? b.r0 * 2.6 : b.r0) : (hover ? b.r0 * .5 : b.r0);
      b.r += (target - b.r) * .18;
      b.el.setAttribute('cx', b.x.toFixed(1)); b.el.setAttribute('cy', b.y.toFixed(1)); b.el.setAttribute('r', b.r.toFixed(2));
      px = b.x; py = b.y;
    });
  }

  /* =======================================================
     Shared frame loop (waves, bubbles, cursor)
     ======================================================= */
  function tick(t) {
    const s = t / 1000;
    slosh += (clamp(Math.abs(scrollVel) / 1800, 0, 1.6) - slosh) * .06;
    drawWaves(reduce ? 0 : s);
    if (!reduce) drawBubbles(t);
    if (fine) moveCursor();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  /* =======================================================
     Without GSAP: show everything and stop here
     ======================================================= */
  if (!window.gsap || !window.ScrollTrigger) {
    window.__wcBooted = true;
    window.__wcRescue && window.__wcRescue();
    if (window.__waterSplash) window.__waterSplash();
    return;
  }

  const { gsap, ScrollTrigger } = window;
  gsap.registerPlugin(ScrollTrigger);
  window.__wcBooted = true;

  /* ---------- smooth scroll ---------- */
  let lenis = null;
  if (window.Lenis && !reduce) {
    lenis = new Lenis({ lerp: .1, smoothWheel: true });
    lenis.on('scroll', e => { ScrollTrigger.update(); scrollVel = e.velocity * 60; });
    gsap.ticker.add(t => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  } else {
    let lastY = scrollY, lastT = performance.now();
    addEventListener('scroll', () => { const n = performance.now(); scrollVel = (scrollY - lastY) / Math.max(1, n - lastT) * 1000; lastY = scrollY; lastT = n; }, { passive: true });
  }
  setInterval(() => { scrollVel *= .8; }, 100);
  for (const a of $$('[data-scroll]')) a.addEventListener('click', e => {
    const id = a.getAttribute('href');
    if (!id || !id.startsWith('#')) return;
    const el = id === '#top' ? document.body : $(id);
    if (!el) return;
    e.preventDefault();
    if (lenis) lenis.scrollTo(el, { duration: 1.6 }); else el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
  });

  /* ---------- split headings ---------- */
  function splitWords(root) {
    const walk = node => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(part => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(' ')); return; }
            const o = document.createElement('span'); o.className = 'sw';
            const i = document.createElement('span'); i.textContent = part;
            o.appendChild(i); frag.appendChild(o);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      }
    };
    walk(root);
    return $$('.sw > span', root);
  }
  const displace = $('#liquidText feDisplacementMap');
  for (const h of $$('[data-split]')) {
    const words = splitWords(h);
    gsap.set(words, { yPercent: 115 });
    ScrollTrigger.create({
      trigger: h, start: 'top 85%', once: true,
      onEnter: () => {
        gsap.to(words, { yPercent: 0, duration: 1.1, ease: 'expo.out', stagger: .05 });
        // the heading surfaces through water: a displacement that calms down
        if (reduce || !displace) return;
        h.style.filter = 'url(#liquidText)';
        const o = { s: 70 };
        gsap.to(o, {
          s: 0, duration: 1.9, ease: 'power3.out',
          onUpdate: () => displace.setAttribute('scale', o.s.toFixed(1)),
          onComplete: () => { h.style.filter = ''; }
        });
      }
    });
  }

  /* ---------- preloader → hero ---------- */
  const pl = $('.preloader'), plCount = $('.pl-count span');
  const plWaves = $$('.pl-drop [data-wave]');
  const counter = { v: 0 };
  const fontsReady = document.fonts ? document.fonts.ready : Promise.resolve();
  const intro = gsap.timeline({ paused: true });
  intro
    .to(counter, {
      v: 100, duration: reduce ? .2 : 1.7, ease: 'power2.inOut',
      onUpdate: () => {
        plCount.textContent = String(Math.round(counter.v)).padStart(3, '0');
        const y = 262 - (262 - 14) * counter.v / 100;
        for (const w of plWaves) w.dataset.y = y.toFixed(1);
      }
    })
    .to('.pl-inner', { scale: .9, opacity: 0, duration: .5, ease: 'power2.in' }, '+=.1')
    .to('.pl-flood', { y: () => -(innerHeight + 160), duration: 1.1, ease: 'power3.inOut' }, '<')
    .add(() => {
      document.body.classList.remove('is-loading');
      if (window.__waterSplash) window.__waterSplash();
    }, '-=.35')
    .set(pl, { display: 'none' })
    .from('.nav > *', { y: -30, opacity: 0, duration: .9, ease: 'expo.out', stagger: .08 }, '-=.3')
    .from('.eyebrow, .hero-bottom > *', { y: 40, opacity: 0, duration: 1, ease: 'expo.out', stagger: .08 }, '<')
    .from('.hero-title .w', { yPercent: 40, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: .08 }, '<')
    .add(() => { if (lenis) lenis.start(); ScrollTrigger.refresh(); });
  Promise.race([fontsReady, new Promise(r => setTimeout(r, 2500))]).then(() => intro.play());

  /* ---------- nav colour + depth gauge ---------- */
  const nav = $('.nav');
  const themed = $$('[data-theme]');
  const depthFill = $('.depth-fill'), depthVal = $('[data-depth]');
  function navTheme() {
    const y = 44;
    for (const s of themed) {
      const r = s.getBoundingClientRect();
      if (r.top <= y && r.bottom > y) { nav.classList.toggle('on-cream', s.dataset.theme === 'cream'); break; }
    }
  }
  ScrollTrigger.create({
    start: 0, end: 'max',
    onUpdate: self => {
      depthFill.style.transform = `scaleY(${self.progress})`;
      depthVal.textContent = Math.round(self.progress * 120);
      navTheme();
    }
  });
  setInterval(navTheme, 300); // also catches jumps where pins re-layout after the scroll event

  /* ---------- hero parallax ---------- */
  gsap.to('.hero-bottom, .hero-top', { yPercent: -30, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

  /* ---------- wave marquee (textPath) ---------- */
  const marquees = $$('[data-marquee]').map(tp => {
    const unit = tp.getComputedTextLength() / 3;
    return { tp, unit, dir: +tp.dataset.marquee, off: 0 };
  });
  gsap.ticker.add((time, dt) => {
    const boost = 1 + clamp(Math.abs(scrollVel) / 400, 0, 6);
    for (const m of marquees) {
      if (!m.unit) continue;
      m.off = (m.off + dt * .06 * boost) % m.unit;
      m.tp.setAttribute('startOffset', (m.dir > 0 ? -m.off : -m.unit + m.off).toFixed(1));
    }
  });

  /* ---------- story: words fill in as you scroll ---------- */
  const story = $('[data-words]');
  if (story) {
    const wrap = node => {
      for (const n of [...node.childNodes]) {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(p => {
            if (!p) return;
            if (/^\s+$/.test(p)) frag.appendChild(document.createTextNode(' '));
            else { const s = document.createElement('span'); s.className = 'wd'; s.textContent = p; frag.appendChild(s); }
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1) wrap(n);
      }
    };
    wrap(story);
    const words = $$('.wd', story);
    ScrollTrigger.create({
      trigger: story, start: 'top 80%', end: 'bottom 45%', scrub: true,
      onUpdate: self => { const n = Math.round(self.progress * words.length); words.forEach((w, i) => w.classList.toggle('on', i < n)); }
    });
  }
  gsap.from('.chapter, .ch-arrow', { y: 80, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: .12, scrollTrigger: { trigger: '.chapters', start: 'top 80%' } });

  /* ---------- drop by drop: droplets fuse as you scroll ---------- */
  const dropsSec = $('.drops');
  if (dropsSec) {
    const lines = $$('.dr-line', dropsSec);
    gsap.set(lines.slice(1), { autoAlpha: 0, y: 50 });
    let cur = 0;
    const showLine = i => {
      if (i === cur) return;
      const down = i > cur;
      gsap.to(lines[cur], { autoAlpha: 0, y: down ? -50 : 50, duration: .45, ease: 'power2.in', overwrite: true });
      gsap.fromTo(lines[i], { autoAlpha: 0, y: down ? 50 : -50 }, { autoAlpha: 1, y: 0, duration: .8, ease: 'expo.out', overwrite: true });
      cur = i;
    };
    gsap.from('.dr-foot span', { y: 30, opacity: 0, duration: 1, ease: 'expo.out', stagger: .1, scrollTrigger: { trigger: dropsSec, start: 'top 40%' } });
    ScrollTrigger.create({
      trigger: dropsSec, start: 'top top', end: () => '+=' + innerHeight * 2.4, pin: true, scrub: true,
      onUpdate: self => {
        if (window.__drops) window.__drops.set(self.progress * 1.15);
        showLine(self.progress < .3 ? 0 : self.progress < .62 ? 1 : 2);
      }
    });
  }

  /* ---------- the thirst index (pinned) ---------- */
  const thirst = $('.thirst');
  if (thirst) {
    const stats = $$('.stat', thirst);
    const idxEl = $('.th-index b', thirst);
    const glassWaves = $$('[data-glass]', thirst);
    const cap = $('[data-glass-cap]', thirst);
    const fmt = (v, to, suffix) => {
      if (to >= 1e9) return (v / 1e9).toFixed(1) + '<em class="unit"> billion</em>';
      if (to >= 1e6) return Math.round(v / 1e6).toLocaleString('en-US') + '<em class="unit"> million</em>';
      return Math.round(v) + (suffix ? `<em class="unit">${suffix}</em>` : '');
    };
    const showNum = (el, v) => { const st = el.closest('.stat'); el.innerHTML = fmt(v, +st.dataset.to, st.dataset.suffix); };
    let active = -1;
    const counters = stats.map(() => ({ v: 0 }));
    function activate(i) {
      if (i === active) return;
      const down = active < i; active = i;
      idxEl.textContent = String(i + 1).padStart(2, '0');
      stats.forEach((s, k) => {
        gsap.killTweensOf(s);
        if (k === i) {
          gsap.fromTo(s, { autoAlpha: 0, y: down ? 60 : -60 }, { autoAlpha: 1, y: 0, duration: .7, ease: 'expo.out' });
          const n = $('.n', s), c = counters[k];
          gsap.killTweensOf(c);
          c.v = 0;
          gsap.to(c, { v: +s.dataset.to, duration: reduce ? .01 : 1.4, ease: 'expo.out', onUpdate: () => showNum(n, c.v) });
        } else {
          gsap.to(s, { autoAlpha: 0, y: down ? -60 : 60, duration: .35, ease: 'power2.in' });
        }
      });
    }
    stats.forEach(s => showNum($('.n', s), 0));
    gsap.set(stats, { autoAlpha: 0 });
    ScrollTrigger.create({
      trigger: thirst, start: 'top top', end: () => '+=' + innerHeight * 3.2, pin: true, scrub: true,
      onUpdate: self => {
        activate(clamp(Math.floor(self.progress * stats.length), 0, stats.length - 1));
        const y = 60 + (372 - 60) * self.progress; // the glass drains
        for (const w of glassWaves) w.dataset.y = y.toFixed(1);
        cap.textContent = self.progress > .97 ? 'Empty. Time to refill' : `Glass ${Math.round((1 - self.progress) * 100)}% full`;
      }
    });
    if (ScrollTrigger.getAll().slice(-1)[0].progress === 0) activate(0);
  }

  /* ---------- how it works: horizontal pipe ---------- */
  const how = $('.how');
  if (how) {
    const track = $('.how-track', how);
    const water = $('.pipe-water', how), dropEl = $('.pipe-drop', how), labels = $$('.pipe-labels span', how);
    const dist = () => Math.max(0, track.scrollWidth - innerWidth);
    gsap.to(track, {
      x: () => -dist(), ease: 'none',
      scrollTrigger: {
        trigger: how, start: 'top top', end: () => '+=' + dist(), pin: '.how-pin', scrub: .6, invalidateOnRefresh: true,
        onUpdate: self => {
          const p = self.progress;
          water.style.transform = `scaleX(${p})`;
          dropEl.style.left = `${p * 100}%`;
          labels.forEach((l, i) => l.classList.toggle('on', p >= i / (labels.length - 1) - .02));
        }
      }
    });
  }

  /* ---------- the well (pinned scene) ---------- */
  const well = $('.well');
  if (well) {
    const heads = $$('.wl-head', well);
    const cDepth = $('.c-depth', well), cCans = $('.c-cans', well);
    const cansW = $$('.can-water', well);
    const depth = { v: 0 }, filled = { v: 0 };
    gsap.set('.well .bore', { scaleY: 0, transformOrigin: '50% 0%' });
    gsap.set(cansW, { scaleY: 0, transformOrigin: '50% 100%' });
    gsap.set(heads.slice(1), { autoAlpha: 0, y: 40 });
    const swap = (a, b) => gsap.timeline()
      .to(heads[a], { autoAlpha: 0, y: -40, duration: .4 })
      .fromTo(heads[b], { autoAlpha: 0, y: 40 }, { autoAlpha: 1, y: 0, duration: .4 }, '<.1');

    const tl = gsap.timeline({
      defaults: { ease: 'none' },
      scrollTrigger: { trigger: well, start: 'top top', end: () => '+=' + innerHeight * 3, pin: true, scrub: .8 }
    });
    tl.add(swap(0, 1), .4)
      .to('.well .drill', { y: 296, duration: 3, ease: 'power1.in' }, .3)
      .to('.well .bore', { scaleY: 1, duration: 3, ease: 'power1.in' }, .3)
      .to(depth, { v: 60, duration: 3, ease: 'power1.in', onUpdate: () => { cDepth.textContent = Math.round(depth.v); } }, .3)
      .add(swap(1, 2), 3.1)
      .to('.well .splash', { opacity: 1, scale: 1.6, y: -10, transformOrigin: '50% 100%', duration: .5 }, 3.3)
      .to('.well .splash', { opacity: 0, duration: .5 }, 3.8)
      .to('.well .aquifer rect', { fill: '#3A64FF', duration: .5 }, 3.3)
      .to('.well .drill, .well .rig', { opacity: 0, y: '-=40', duration: .6 }, 3.6)
      .to('.well .pipe-rise', { y: -404, duration: 1.4, ease: 'power2.out' }, 3.8)
      .to('.well .pump', { opacity: 1, duration: .5 }, 4.6)
      .add(swap(2, 3), 4.8)
      .to('.well .stream', { opacity: 1, duration: .2 }, 5)
      .to('.well .pump-handle', { rotate: 18, duration: .25, repeat: 7, yoyo: true, ease: 'sine.inOut' }, 5)
      .to(cansW, { scaleY: 1, duration: .45, stagger: .4, ease: 'power1.out' }, 5.1)
      .to(filled, { v: 5, duration: 2.05, onUpdate: () => { cCans.textContent = Math.floor(filled.v); } }, 5.1);
  }

  /* ---------- token + roadmap entrances ---------- */
  gsap.from('.ca-card', { y: 100, rotate: 3, opacity: 0, duration: 1.3, ease: 'expo.out', scrollTrigger: { trigger: '.token-grid', start: 'top 75%' } });
  gsap.from('.facts > div', { y: 40, opacity: 0, duration: .9, ease: 'expo.out', stagger: .08, scrollTrigger: { trigger: '.facts', start: 'top 85%' } });

  const tubes = $$('.tube-card');
  tubes.forEach((card, i) => {
    const w = $('[data-tube]', card);
    const level = +card.dataset.level, o = { v: 0 };
    gsap.from(card, { y: 80, opacity: 0, duration: 1.1, ease: 'expo.out', delay: i * .08, scrollTrigger: { trigger: '.rm-grid', start: 'top 80%' } });
    gsap.to(o, {
      v: level, duration: 2.2, ease: 'power3.out', delay: .3 + i * .18,
      scrollTrigger: { trigger: '.rm-grid', start: 'top 70%' },
      onUpdate: () => { w.dataset.y = (290 - 270 * o.v).toFixed(1); }
    });
  });

  /* ---------- footer banner: rises out of the water, tilts toward the cursor ---------- */
  const bannerCard = $('.banner-card'), bannerWave = $('[data-banner]');
  if (bannerCard) {
    const lvl = { v: 0 };
    gsap.to(lvl, {
      v: 1, ease: 'none',
      scrollTrigger: { trigger: '.banner-stage', start: 'top bottom', end: 'bottom 70%', scrub: true },
      onUpdate: () => { bannerWave.dataset.y = (440 - 330 * lvl.v).toFixed(1); }
    });
    gsap.from(bannerCard, { y: 120, rotateX: 18, opacity: 0, duration: 1.4, ease: 'expo.out', scrollTrigger: { trigger: '.banner-stage', start: 'top 85%' } });
    if (fine) {
      bannerCard.addEventListener('pointermove', e => {
        const r = bannerCard.getBoundingClientRect();
        gsap.to(bannerCard, { rotateY: ((e.clientX - r.left) / r.width - .5) * 10, rotateX: -((e.clientY - r.top) / r.height - .5) * 10, duration: .6, ease: 'power3.out' });
      });
      bannerCard.addEventListener('pointerleave', () => gsap.to(bannerCard, { rotateX: 0, rotateY: 0, duration: .8, ease: 'expo.out' }));
    }
  }

  addEventListener('load', () => ScrollTrigger.refresh());
})();
