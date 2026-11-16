/* =========================================================
   Watercoin Reservoir (client)
   Standalone on purpose: it doesn't depend on GSAP, ScrollTrigger or Lenis, so the tracker
   keeps working even if the animation layer fails to load.
   All accounting happens server-side in /api/meter; this file only displays it.
   ========================================================= */
(() => {
  'use strict';
  const API = '/api/meter';
  const REFRESH_MS = 30000;
  const TIMEOUT_MS = 12000;
  // targets for the tank; the third one is Foodcoin's total, the record to beat
  const GOALS = [
    { usd: 10000, name: 'First splash' },
    { usd: 35000, name: 'Halfway to $FOOD' },
    { usd: 70000, name: 'Beat Foodcoin' },
    { usd: 150000, name: 'Double down' },
    { usd: 500000, name: 'Flood' }
  ];

  const $ = (s, c = document) => c.querySelector(s);
  const card = $('.res-card');
  if (!card) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const els = {
    live: $('[data-m-live]'), status: $('[data-m-status]'), receipts: $('[data-m-receipts]'), fees: $('[data-m-fees]'),
    last: $('[data-m-last]'), ca: $('[data-m-ca]'), updated: $('[data-m-updated]'), lock: $('[data-m-lock]'),
    tVault: $('[data-t-vault]'), tVaultLink: $('[data-t-vault-link]'), tPending: $('[data-t-pending]'),
    tPendingLink: $('[data-t-pending-link]'), tSent: $('[data-t-sent]'), tSentLink: $('[data-t-sent-link]'), tCrank: $('[data-t-crank]'),
    goalName: $('[data-goal-name]'), goalPct: $('[data-goal-pct]'), tankWaves: [...document.querySelectorAll('[data-tank]')]
  };

  /* ---------- rolling odometer ---------- */
  function makeOdometer(el) {
    let n = 0, slots = [], commas = [];
    function build(digits) {
      el.innerHTML = ''; slots = []; commas = [];
      for (let k = digits - 1; k >= 0; k--) {
        const wrap = document.createElement('span'); wrap.className = 'odo-d';
        const strip = document.createElement('span'); strip.className = 'odo-s';
        strip.innerHTML = '01234567890'.split('').map(d => `<span>${d}</span>`).join('');
        wrap.appendChild(strip); el.appendChild(wrap);
        slots.push({ wrap, strip, k });
        if (k > 0 && k % 3 === 0) { const c = document.createElement('span'); c.className = 'odo-c'; c.textContent = ','; el.appendChild(c); commas.push({ c, k }); }
      }
    }
    function set(f) {
      f = Math.max(0, f);
      const len = String(Math.floor(f)).length;
      if (len > n) { n = len; build(n); }
      for (const s of slots) {
        const p = 10 ** s.k, base = Math.floor(f / p) % 10, lower = f % p;
        const frac = lower > p - 1 ? lower - (p - 1) : 0;
        s.strip.style.transform = `translateY(${-(base + frac)}em)`;
        s.wrap.classList.toggle('lead', s.k >= len && s.k > 0);
      }
      for (const { c, k } of commas) c.classList.toggle('lead', k >= len);
      el.setAttribute('aria-label', '$' + Math.floor(f).toLocaleString('en-US') + ' settled to WaterAid America');
    }
    return { set };
  }
  const odo = makeOdometer($('[data-odo]'));
  odo.set(0);

  /* ---------- tank: settled water in front, incoming (not yet donated) water behind it, lighter ----------
     The wave engine in main.js reads data-y. */
  const TANK_EMPTY = 392, TANK_FULL = 34;
  const tankFront = document.querySelector('.tank-front'), tankBack = document.querySelector('.tank-back');
  const clamp01 = x => Math.max(0, Math.min(1, x));
  const lv = { front: 0, back: 0 }, lvShown = { front: 0, back: 0 };
  let tankAnim = 0;
  function tankTo(front, back = front) {
    lv.front = clamp01(front); lv.back = Math.max(lv.front, clamp01(back));
    if (!inView) return;
    cancelAnimationFrame(tankAnim);
    const from = { ...lvShown }, t0 = performance.now(), dur = reduce ? 1 : 2200;
    const yOf = l => (TANK_EMPTY - (TANK_EMPTY - TANK_FULL) * l).toFixed(2);
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      lvShown.front = from.front + (lv.front - from.front) * e;
      lvShown.back = from.back + (lv.back - from.back) * e;
      if (tankFront) tankFront.dataset.y = yOf(lvShown.front);
      if (tankBack) tankBack.dataset.y = yOf(lvShown.back);
      if (k < 1) tankAnim = requestAnimationFrame(step);
    };
    tankAnim = requestAnimationFrame(step);
  }

  /* ---------- "pouring next": SOL collected but not donated yet ---------- */
  const pend = { wrap: $('[data-p-wrap]'), sol: $('[data-p-sol]'), usd: $('[data-p-usd]'), rate: $('[data-p-rate]'), foot: $('[data-p-foot]') };
  let pShown = 0, pTarget = null, pPrice = null, pAnim = 0;
  const fmtSol = x => x.toLocaleString('en-US', { minimumFractionDigits: x >= 1000 ? 1 : 3, maximumFractionDigits: x >= 1000 ? 1 : 3 });
  const fmtUsd = x => '$' + Math.round(x).toLocaleString('en-US');
  function paintPending(x) {
    pend.sol.textContent = fmtSol(x);
    pend.usd.textContent = pPrice ? fmtUsd(x * pPrice) : '—';
  }
  function pendingTo(solAmount, price) {
    pPrice = price || pPrice;
    const first = pTarget === null;
    pTarget = solAmount;
    pend.wrap.classList.toggle('is-empty', solAmount <= 0);
    if (!inView || reduce) { if (!inView && !first) return; pShown = solAmount; paintPending(solAmount); return; }
    cancelAnimationFrame(pAnim);
    const from = pShown, t0 = performance.now(), dur = from === 0 ? 2400 : 1400;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      pShown = from + (solAmount - from) * e;
      paintPending(pShown);
      if (k < 1) pAnim = requestAnimationFrame(step);
    };
    pAnim = requestAnimationFrame(step);
  }

  /* ---------- odometer tween (no GSAP): easeOutCubic ---------- */
  let shown = 0, target = 0, anim = 0, inView = false;
  function animateTo(v) {
    target = v;
    if (!inView) return;
    cancelAnimationFrame(anim);
    if (reduce) { shown = v; odo.set(v); return; }
    const from = shown, dur = from === 0 ? 2600 : 1500, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      shown = from + (v - from) * e;
      odo.set(shown);
      if (k < 1) anim = requestAnimationFrame(step); else shown = v;
    };
    anim = requestAnimationFrame(step);
  }
  new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !inView) { inView = true; animateTo(target); tankTo(lv.front, lv.back); if (pTarget !== null) pendingTo(pTarget); }
  }, { threshold: 0.2 }).observe(card);

  function pop(text) {
    if (reduce) return;
    const p = document.createElement('div');
    p.className = 'res-pop'; p.textContent = text;
    $('.res-main').appendChild(p);
    p.animate([{ transform: 'translateY(30px) scale(.6)', opacity: 0 }, { transform: 'translateY(-50px) scale(1)', opacity: 1, offset: .3 },
      { transform: 'translateY(-50px) scale(1)', opacity: 1, offset: .75 }, { transform: 'translateY(-100px) scale(1)', opacity: 0 }],
      { duration: 2600, easing: 'cubic-bezier(.16,1,.3,1)' }).onfinish = () => p.remove();
  }

  /* ---------- formatting ---------- */
  const usdE6 = v => {
    const n = Number(BigInt(v)) / 1e6;
    return '$' + n.toLocaleString('en-US', { minimumFractionDigits: n < 1000 ? 2 : 0, maximumFractionDigits: n < 1000 ? 2 : 0 });
  };
  const sol = lam => (Number(BigInt(lam)) / 1e9).toLocaleString('en-US', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + ' SOL';
  const ago = iso => {
    const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
    if (s < 90) return s + 's ago'; if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago'; return Math.floor(s / 86400) + 'd ago';
  };
  const short = a => a.slice(0, 4) + '…' + a.slice(-4);
  const setLink = (a, href) => { if (href) { a.href = href; a.classList.remove('off'); } else a.classList.add('off'); };
  const setLive = (cls, text) => { els.live.classList.remove('is-idle', 'is-error', 'is-pre'); if (cls) els.live.classList.add(cls); els.status.textContent = text; };

  function setGoal(usd, incomingUsd = 0) {
    const g = GOALS.find(x => usd < x.usd) || GOALS[GOALS.length - 1];
    const pct = Math.min(100, usd / g.usd * 100), inPct = Math.max(0, Math.min(100 - pct, incomingUsd / g.usd * 100));
    const f = p => (p < 10 && p > 0 ? p.toFixed(1) : Math.floor(p));
    els.goalName.textContent = g.name;
    els.goalPct.textContent = `${f(pct)}% of $${g.usd.toLocaleString('en-US')}` + (inPct >= .1 ? ` · +${f(inPct)}% on the way` : '');
    // keep a visible splash in the tank even at zero, so it never looks broken
    const front = Math.max(.035, pct / 100);
    tankTo(front, front + inPct / 100);
  }

  /* ---------- render ---------- */
  let last = null;
  function renderPrelaunch() {
    setLive('is-pre', 'Awaiting launch');
    els.ca.textContent = 'Coming soon'; els.ca.removeAttribute('href');
    for (const k of ['receipts', 'fees', 'last']) els[k].textContent = '—';
    els.tVault.textContent = '—'; els.tPending.textContent = '—'; els.tSent.textContent = '$0';
    els.updated.textContent = 'The reservoir opens the moment $WATER launches';
    animateTo(0);
    setGoal(0);
    pend.sol.textContent = '—'; pend.usd.textContent = '—';
  }

  function render(d) {
    last = d;
    if (d.prelaunch) return renderPrelaunch();
    const s = d.settled, p = d.pending;
    els.ca.textContent = short(d.mint);
    els.ca.href = 'https://solscan.io/token/' + d.mint;

    // not donated yet = unclaimed creator fees (bonding curve + PumpSwap) + SOL already in the donation pipe
    const price = d.price && d.price.solUsd;
    let pendingSol = null;
    if (p) pendingSol = Number(BigInt(p.creatorVaultLamports) + BigInt(p.ammVaultLamports) + BigInt(p.donation ? p.donation.pendingLamports : '0')) / 1e9;
    else if (d.onchain === 'not_created') pendingSol = 0;
    if (pendingSol !== null) {
      pendingTo(pendingSol, price);
      pend.rate.textContent = price ? `at $${price.toFixed(2)} per SOL · estimate, not yet donated` : 'USD estimate unavailable right now';
      pend.foot.textContent = d.onchain === 'not_created'
        ? 'Opens with the first trade. Creator rewards collect here before they are sent to WaterAid America.'
        : 'Collected from trading, waiting to be claimed, converted to USDC and paid to WaterAid America. It joins the total above once it settles.';
    } else { pend.sol.textContent = '—'; pend.usd.textContent = '—'; }
    const incomingUsd = pendingSol && price ? pendingSol * price : 0;

    if (s) {
      const usd = Math.floor(Number(BigInt(s.netUsdE6)) / 1e6);
      if (shown > 0 && usd > target) pop('+$' + (usd - target).toLocaleString('en-US'));
      animateTo(usd);
      setGoal(Number(BigInt(s.netUsdE6)) / 1e6, incomingUsd);
      els.receipts.textContent = Number(s.receipts).toLocaleString('en-US');
      els.fees.textContent = usdE6(s.feeUsdE6);
      els.last.textContent = s.lastSettlement ? ago(s.lastSettlement.at) : 'None yet';
      els.tSent.textContent = usdE6(s.netUsdE6);
      setLink(els.tSentLink, s.lastSettlement && 'https://solscan.io/tx/' + s.lastSettlement.tx);
      els.tCrank.textContent = s.lastSettlement
        ? `USDC received on-chain. Last settlement ${ago(s.lastSettlement.at)}`
        : 'USDC received on-chain. This is what the reservoir counts';
    } else {
      for (const k of ['receipts', 'fees', 'last', 'tSent']) els[k].textContent = 'unavailable';
    }

    if (p) {
      els.tVault.textContent = sol(BigInt(p.creatorVaultLamports) + BigInt(p.ammVaultLamports));
      els.tPending.textContent = p.donation ? sol(p.donation.pendingLamports) : sol('0');
      setLink(els.tVaultLink, p.accounts && 'https://solscan.io/account/' + (BigInt(p.ammVaultLamports) > 0n ? p.accounts.pumpswapVault : p.accounts.creatorVault));
      setLink(els.tPendingLink, p.donation && 'https://solscan.io/account/' + p.donation.address);
      if (p.locked && s) {
        const gross = BigInt(s.grossUsdE6), fee = BigInt(s.feeUsdE6);
        const pct = gross > 0n ? Math.round(Number(fee * 10000n / gross) / 100) : null;
        els.lock.hidden = false;
        els.lock.textContent = `🔒 ${Math.round(p.shareBps / 100)}% of creator fees → donate.gg → WaterAid America · locked forever`
          + (pct !== null ? ` · donate.gg's ${pct}% processing fee is deducted before settlement` : '');
      }
    } else if (d.onchain === 'not_created') {
      // the chain answered: this mint is not trading yet, so there is nothing in the vaults
      els.tVault.textContent = sol('0'); els.tPending.textContent = sol('0');
      setLink(els.tVaultLink, null); setLink(els.tPendingLink, null);
    } else {
      els.tVault.textContent = 'unavailable'; els.tPending.textContent = 'unavailable';
    }

    const stale = (s && s.stale) || !s;
    if (!s) setLive('is-error', 'Unavailable');
    else if (stale) setLive('is-idle', 'Cached');
    else if (d.onchain === 'not_created' && Number(s.receipts) === 0) setLive('is-pre', 'Ready · waiting for first trade');
    else setLive(null, 'Live · settled data');
    updateStatusLine();
  }

  function updateStatusLine() {
    if (!last || last.prelaunch) return;
    const s = last.settled;
    if (!s || !s.fetchedAt) { els.updated.textContent = 'Settled data unavailable right now. Retrying'; return; }
    const parts = [`Settled data ${s.stale ? 'cached, last confirmed' : 'updated'} ${ago(s.fetchedAt)}`];
    if (last.onchain === 'not_created') parts.push('vaults open with the first trade');
    else if (last.errors && last.errors.chain) parts.push('vault balances unavailable');
    els.updated.textContent = parts.join(' · ');
  }
  setInterval(updateStatusLine, 15000);

  /* ---------- polling ---------- */
  let busy = false;
  async function load() {
    if (busy || document.hidden) return;
    busy = true;
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(API, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      render(await r.json());
    } catch (e) {
      if (last) { setLive('is-idle', 'Cached'); updateStatusLine(); }
      else { renderPrelaunch(); setLive('is-error', 'Offline'); els.updated.textContent = 'The reservoir is unreachable right now. Retrying'; }
    } finally { clearTimeout(timer); busy = false; }
  }
  load();
  setInterval(load, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  addEventListener('online', load);
})();
