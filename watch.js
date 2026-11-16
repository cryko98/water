/* =========================================================
   Watercoin explainer player.
   Muted ambient preview while the frame is on screen; one click restarts it with sound.
   Chapters seek, a water-coloured bar tracks progress. Independent of GSAP/Lenis.
   ========================================================= */
(() => {
  'use strict';
  const sec = document.getElementById('watch');
  if (!sec) return;
  const $ = s => sec.querySelector(s);
  const v = $('.wt-video'), frame = $('.wt-frame'), play = $('.wt-play'), mute = $('.wt-mute'),
    bar = $('.wt-bar span'), label = $('[data-wt-label]'), chapters = [...sec.querySelectorAll('.wt-chapters button')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sound = false, inView = false, raf = 0;

  function preview() {
    if (sound || reduce || !inView) return;
    v.muted = true; v.loop = true;
    if (v.preload !== 'auto') v.preload = 'auto';
    v.play().catch(() => {});
  }
  new IntersectionObserver(([e]) => {
    inView = e.isIntersecting;
    if (inView) preview(); else v.pause();
  }, { threshold: .35 }).observe(frame);
  // start fetching a little before the section arrives
  new IntersectionObserver(([e], o) => { if (e.isIntersecting) { v.preload = 'auto'; o.disconnect(); } }, { rootMargin: '600px' }).observe(frame);

  function syncMute() {
    mute.classList.toggle('is-muted', v.muted);
    mute.setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
  }
  function start(t = 0) {
    sound = true;
    sec.classList.add('is-playing');
    v.loop = false; v.muted = false;
    try { v.currentTime = t; } catch (e) {}
    v.play().catch(() => { v.muted = true; syncMute(); v.play().catch(() => {}); });
    mute.hidden = false; syncMute();
    loop();
  }
  function stop(again) {
    sound = false;
    sec.classList.remove('is-playing');
    mute.hidden = true;
    label.textContent = again ? 'Watch again' : 'Play with sound';
    preview();
  }
  function paint() {
    const d = v.duration || 46.6;
    bar.style.transform = `scaleX(${Math.min(1, v.currentTime / d).toFixed(4)})`;
    let a = -1;
    chapters.forEach((b, i) => { if (v.currentTime >= +b.dataset.t - .05) a = i; });
    chapters.forEach((b, i) => b.classList.toggle('on', sound && i === a));
  }
  function loop() { cancelAnimationFrame(raf); const f = () => { paint(); if (!v.paused) raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); }

  play.addEventListener('click', () => start(0));
  v.addEventListener('click', () => { if (!sound) return start(0); if (v.paused) { v.play(); loop(); } else v.pause(); });
  v.addEventListener('play', loop);
  v.addEventListener('timeupdate', paint);
  v.addEventListener('ended', () => { paint(); stop(true); });
  mute.addEventListener('click', () => { v.muted = !v.muted; syncMute(); });
  chapters.forEach(b => b.addEventListener('click', () => {
    const t = +b.dataset.t;
    if (!sound) start(t); else { v.currentTime = t; v.play(); loop(); }
  }));
  addEventListener('keydown', e => {
    if (!sound || !inView || e.target.closest('input, textarea, button, a')) return;
    if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); if (v.paused) { v.play(); loop(); } else v.pause(); }
    if (e.key === 'm') { v.muted = !v.muted; syncMute(); }
  });

  // "Watch the video" in the hero: scroll there, then play with sound (the click still counts as a user gesture)
  for (const a of document.querySelectorAll('[data-watch-cta]')) a.addEventListener('click', () => setTimeout(() => start(0), 1200));
})();
