/* =========================================================
   Watercoin "drops" scene: raymarched liquid (WebGL2).
   Scattered droplets drift together and fuse into one large drop as you scroll.
   Real refraction (in and out of the liquid), Beer-law absorption, chromatic dispersion,
   Fresnel reflections of a studio environment. main.js drives progress via window.__drops.
   ========================================================= */
(() => {
  'use strict';
  const canvas = document.getElementById('drops');
  if (!canvas) return;
  const section = canvas.closest('.drops');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false });
  if (!gl) { section.classList.add('no-gl'); return; }

  const N = 9;
  const VERT = `#version 300 es
  in vec2 p; out vec2 uv;
  void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

  const FRAG = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 o;
  uniform vec2 res; uniform float t; uniform float k; uniform vec2 mouse;
  uniform vec4 balls[${N}];
  uniform sampler2D bg;

  float smin(float a, float b, float k){ float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
  float map(vec3 p){
    float d = 1e5;
    for (int i = 0; i < ${N}; i++){
      vec4 b = balls[i];
      // a little surface tension wobble
      float w = .018 * sin(p.x * 7. + t * 2.1 + float(i)) * sin(p.y * 6. - t * 1.7);
      d = smin(d, length(p - b.xyz) - b.w + w, k);
    }
    return d;
  }
  vec3 nrm(vec3 p){
    vec2 e = vec2(.0012, 0.);
    return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
  }
  vec3 keyL = normalize(vec3(-.55, .7, .55));
  vec3 env(vec3 d){
    float y = d.y * .5 + .5;
    vec3 c = mix(vec3(.01, .03, .16), vec3(.06, .2, .92), smoothstep(.05, 1., y));
    c += vec3(1., .95, .78) * smoothstep(.82, .985, dot(d, keyL)) * 3.;          // key softbox (cream)
    c += vec3(.55, .7, 1.) * smoothstep(.9, .995, dot(d, normalize(vec3(.8, .15, .6)))) * 1.8; // cool rim
    c += vec3(1., .94, .77) * exp(-abs(d.y + .08) * 26.) * .35;                // horizon glint
    return c;
  }

  void main(){
    vec2 px = uv * res;
    vec2 p = (px - .5 * res) / res.y;
    vec3 ro = vec3(mouse * .25, 4.2);
    vec3 rd = normalize(vec3(p - mouse * .06, -1.75));
    vec3 back = texture(bg, uv).rgb;

    float tt = 0.; bool hit = false;
    for (int i = 0; i < 90; i++){
      float d = map(ro + rd * tt);
      if (d < .0008){ hit = true; break; }
      tt += d;
      if (tt > 9.) break;
    }
    if (!hit){
      o = vec4(back, 1.);
      return;
    }
    vec3 pos = ro + rd * tt;
    vec3 n = nrm(pos);
    float cosi = max(dot(-rd, n), 0.);
    float fres = .03 + .97 * pow(1. - cosi, 5.);
    vec3 refl = env(reflect(rd, n));

    // into the liquid, through it, and out the other side
    vec3 rdi = refract(rd, n, 1. / 1.333);
    vec3 pi = pos - n * .004; float ti = .01;
    for (int i = 0; i < 48; i++){
      float d = -map(pi + rdi * ti);
      if (d < .0008) break;
      ti += max(d, .006);
    }
    vec3 pe = pi + rdi * ti;
    vec3 ne = -nrm(pe);
    vec3 rdo = refract(rdi, ne, 1.333);
    if (dot(rdo, rdo) < .001) rdo = reflect(rdi, ne);

    // the world behind, bent by the drop (screen-space), split per wavelength
    vec2 o1 = (rdo.xy - rd.xy) * .42;
    vec3 refr;
    refr.r = texture(bg, uv + o1 * .94).r;
    refr.g = texture(bg, uv + o1 * 1.0).g;
    refr.b = texture(bg, uv + o1 * 1.08).b;
    refr = mix(refr, env(rdo), .22);
    refr *= exp(-vec3(.7, .3, .1) * ti * .45);       // water absorbs red first
    refr += vec3(.04, .12, .5) * (1. - exp(-ti * .8)) * .3;
    refr *= 1.35;

    vec3 col = mix(refr, refl, fres);
    // light focused through the drop lands on the far side (inner caustic) + a crisp rim
    col += vec3(1., .93, .74) * pow(max(dot(n, -keyL), 0.), 3.) * .38 * (1. - fres);
    col += vec3(.55, .72, 1.) * pow(1. - cosi, 2.5) * .45;
    vec3 h = normalize(keyL - rd);
    col += vec3(1., .97, .88) * pow(max(dot(n, h), 0.), 260.) * 2.4;
    col += vec3(.7, .8, 1.) * pow(max(dot(n, normalize(normalize(vec3(.8, .15, .6)) - rd)), 0.), 120.) * .6;
    // gentle tone map
    col = col / (1. + col * .18);
    o = vec4(col, 1.);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.bindAttribLocation(prog, 0, 'p');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (e) { console.warn('[drops] shader failed', e); section.classList.add('no-gl'); return; }
  const U = n => gl.getUniformLocation(prog, n);
  const u = { res: U('res'), t: U('t'), k: U('k'), mouse: U('mouse'), balls: U('balls'), bg: U('bg') };

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  /* ---------- the backdrop the drop refracts ---------- */
  const bgc = document.createElement('canvas'), bx = bgc.getContext('2d');
  const tex = gl.createTexture();
  function drawBackdrop() {
    const W = canvas.width, H = canvas.height;
    bgc.width = W; bgc.height = H;
    const g = bx.createRadialGradient(W * .5, H * .55, 0, W * .5, H * .55, Math.max(W, H) * .75);
    g.addColorStop(0, '#0E1C78'); g.addColorStop(.55, '#07104A'); g.addColorStop(1, '#050C3A');
    bx.fillStyle = g; bx.fillRect(0, 0, W, H);
    // fine water lines: the drop magnifies and bends them
    bx.strokeStyle = 'rgba(142,174,255,.16)';
    bx.lineWidth = Math.max(1, H / 900);
    const gap = H / 34;
    for (let y = gap / 2; y < H; y += gap) {
      bx.beginPath();
      for (let x = 0; x <= W; x += W / 60) {
        const yy = y + Math.sin(x / W * Math.PI * 4 + y * .02) * gap * .18;
        x === 0 ? bx.moveTo(x, yy) : bx.lineTo(x, yy);
      }
      bx.stroke();
    }
    // giant word behind the drops
    const fs = Math.min(W * .3, H * .62);
    bx.font = `italic 400 ${fs}px "Instrument Serif", Georgia, serif`;
    bx.textAlign = 'center'; bx.textBaseline = 'middle';
    bx.fillStyle = 'rgba(254,241,196,.10)';
    bx.fillText('drop by drop', W / 2, H * .52, W * .96);
    bx.font = `600 ${Math.round(H / 60)}px "JetBrains Mono", monospace`;
    bx.fillStyle = 'rgba(254,241,196,.28)';
    const label = '$WATER  ·  SOLANA  ·  WATERAID AMERICA  ·  ';
    let s = ''; while (bx.measureText(s).width < W * 1.2) s += label;
    bx.textAlign = 'left';
    bx.fillText(s, -W * .05, H * .9);
    bx.fillText(s, -W * .3, H * .1);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgc);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  }

  /* ---------- the droplets ---------- */
  // deterministic scatter so the layout is the same on every visit
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const drops = Array.from({ length: N }, (_, i) => {
    const a = i / N * Math.PI * 2 + rnd() * .6;
    const r = 1.5 + rnd() * 1.1;
    return {
      sx: Math.cos(a) * r * 1.35, sy: Math.sin(a) * r * .62, sz: -rnd() * 1.6 + .3,
      sr: .16 + rnd() * .2,
      // final cluster: tight around the centre so they fuse into one drop
      ex: (rnd() - .5) * .34, ey: (rnd() - .5) * .28 - .3, ez: (rnd() - .5) * .3,
      er: i === 0 ? .5 : .2 + rnd() * .12,
      ph: rnd() * 6.28, delay: rnd() * .35
    };
  });
  drops[0].sx = 0; drops[0].sy = .1; drops[0].sz = 0; drops[0].sr = .3; drops[0].delay = 0;

  let progress = 0, shown = 0;
  const ballData = new Float32Array(N * 4);
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

  function layout(time) {
    const asp = canvas.width / canvas.height;
    const spread = Math.min(1, asp / 1.6);
    const narrow = spread < 1 ? .38 + .62 * spread : 1; // portrait screens get a smaller drop
    for (let i = 0; i < N; i++) {
      const d = drops[i];
      const q = ease(Math.min(1, Math.max(0, (shown - d.delay * .5) / (.75 - d.delay * .3))));
      const bob = (1 - q * .7);
      const x = (d.sx * spread * (1 - q) + d.ex * q) + Math.sin(time * .6 + d.ph) * .08 * bob;
      const y = (d.sy * (1 - q) + d.ey * q) + Math.cos(time * .7 + d.ph * 1.3) * .09 * bob;
      const z = d.sz * (1 - q) + d.ez * q;
      const r = d.sr + (d.er - d.sr) * q;
      ballData.set([x, y, z, r * narrow], i * 4);
    }
    return (.1 + ease(Math.min(1, shown * 1.2)) * .4) * narrow; // smooth-union strength
  }

  /* ---------- sizing & loop ---------- */
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, coarse ? 1.25 : 1.6);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (w !== canvas.width || h !== canvas.height) { canvas.width = w; canvas.height = h; drawBackdrop(); }
  }
  let mx = 0, my = 0, tmx = 0, tmy = 0;
  section.addEventListener('pointermove', e => {
    const r = canvas.getBoundingClientRect();
    tmx = ((e.clientX - r.left) / r.width - .5) * 2;
    tmy = -((e.clientY - r.top) / r.height - .5) * 2;
  }, { passive: true });

  let visible = false, running = false, ready = false;
  function frame(now) {
    const time = reduce ? 0 : now / 1000;
    shown += (progress - shown) * .08;
    mx += (tmx - mx) * .05; my += (tmy - my) * .05;
    const k = layout(time);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(prog);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.t, time);
    gl.uniform1f(u.k, k);
    gl.uniform2f(u.mouse, mx, my);
    gl.uniform4fv(u.balls, ballData);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(u.bg, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function loop(now) {
    if (!visible || document.hidden) { running = false; return; }
    frame(now);
    requestAnimationFrame(loop);
  }
  function start() { if (ready && visible && !running) { running = true; requestAnimationFrame(loop); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); }, { rootMargin: '100px' }).observe(section);
  document.addEventListener('visibilitychange', start);
  addEventListener('resize', () => { resize(); });
  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); section.classList.add('no-gl'); visible = false; });

  window.__drops = { set(p) { progress = Math.max(0, Math.min(1, p)); } };
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    resize(); drawBackdrop(); ready = true; start();
  });
})();
