/* =========================================================
   Watercoin hero: an interactive water surface (WebGL2).
   A height-field ripple simulation runs on the GPU; the headline is drawn into a texture
   underneath the water so it refracts, catches caustic light and glints.
   The DOM <h1> stays in place (transparent) for layout, selection and screen readers.
   If WebGL2 or float render targets are unavailable, the page keeps the plain DOM headline.
   ========================================================= */
(() => {
  'use strict';
  const canvas = document.getElementById('water');
  if (!canvas) return;
  const hero = canvas.closest('.hero');
  const title = hero.querySelector('.hero-title');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;

  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) return;
  gl.getExtension('OES_texture_float_linear');

  /* ---------------- shaders ---------------- */
  const VERT = `#version 300 es
  in vec2 p; out vec2 uv;
  void main(){ uv = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;

  const DROP = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 o;
  uniform sampler2D s; uniform vec2 c; uniform float r; uniform float a; uniform float aspect;
  void main(){
    vec4 i = texture(s, uv);
    vec2 d = (uv - c) * vec2(aspect, 1.);
    float k = max(0., 1. - length(d) / r);
    k = .5 - cos(k * 3.14159265) * .5;
    i.r += k * a;
    o = i;
  }`;

  const STEP = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 o;
  uniform sampler2D s; uniform vec2 px; uniform float damp;
  void main(){
    vec4 i = texture(s, uv);
    float avg = (texture(s, uv - vec2(px.x, 0.)).r + texture(s, uv + vec2(px.x, 0.)).r +
                 texture(s, uv - vec2(0., px.y)).r + texture(s, uv + vec2(0., px.y)).r) * .25;
    i.g += (avg - i.r) * 2.;
    i.g *= damp;
    i.r += i.g;
    i.r *= .9995;
    o = i;
  }`;

  const RENDER = `#version 300 es
  precision highp float;
  in vec2 uv; out vec4 o;
  uniform sampler2D s; uniform sampler2D bg; uniform vec2 px; uniform float t; uniform float aspect;

  // warped interference net: bright filaments like light on a pool floor
  float caustic(vec2 p, float t){
    float v = 0.;
    vec2 q = p;
    for (int k = 0; k < 3; k++){
      float fk = float(k);
      q += .62 * vec2(sin(q.y * 1.35 + t * .55 + fk * 1.7), cos(q.x * 1.25 - t * .45 + fk * 2.3));
      v += 1. / (1. + 22. * abs(sin(q.x * 1.5) * sin(q.y * 1.5)));
    }
    return pow(v / 3., 2.4);
  }

  void main(){
    float h  = texture(s, uv).r;
    float hx = texture(s, uv + vec2(px.x, 0.)).r - texture(s, uv - vec2(px.x, 0.)).r;
    float hy = texture(s, uv + vec2(0., px.y)).r - texture(s, uv - vec2(0., px.y)).r;
    vec3 n = normalize(vec3(-hx, -hy, .09));

    vec2 ruv = uv + n.xy * .045;
    vec3 base = texture(bg, ruv).rgb;

    // caustic light, nudged by the ripples
    vec2 cp = (uv + n.xy * .04) * vec2(aspect, 1.) * 3.2;
    float c = caustic(cp, t * .7);
    vec3 col = base + vec3(.62, .74, 1.) * c * .16;

    // soft light shafts from above
    float ang = atan(uv.x - .35, 1.35 - uv.y);
    float shaft = pow(max(0., sin(ang * 11. + t * .18) * .5 + .5), 7.) * smoothstep(.0, .9, uv.y) * .10;
    col += vec3(.75, .82, 1.) * shaft;

    // specular glints on the moving surface
    vec3 L = normalize(vec3(-.45, .55, 1.));
    float spec = pow(max(dot(reflect(-L, n), vec3(0., 0., 1.)), 0.), 90.);
    col += vec3(1., .97, .88) * spec * .9;
    col += (hx + hy) * .55;

    // vignette toward deeper water at the bottom
    col *= mix(.78, 1.04, smoothstep(0., .85, uv.y));
    o = vec4(col, 1.);
  }`;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }
  function program(frag) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, frag));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }

  let P;
  try { P = { drop: program(DROP), step: program(STEP), render: program(RENDER) }; }
  catch (e) { console.warn('[water] shader setup failed', e); return; }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  /* ---------------- simulation targets ---------------- */
  let simW = 0, simH = 0, targets = [], cur = 0;
  function makeTarget(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    return ok ? { tex, fb } : null;
  }

  /* ---------------- background texture (gradient + headline) ---------------- */
  const bgCanvas = document.createElement('canvas');
  const bgCtx = bgCanvas.getContext('2d');
  const bgTex = gl.createTexture();

  function stretchKeyword(v) {
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return 'normal';
    const steps = [[62.5, 'ultra-condensed'], [75, 'extra-condensed'], [87.5, 'condensed'], [93.75, 'semi-condensed'], [100, 'normal'],
      [112.5, 'semi-expanded'], [125, 'expanded'], [150, 'extra-expanded'], [200, 'ultra-expanded']];
    return steps.reduce((a, b) => Math.abs(b[0] - n) < Math.abs(a[0] - n) ? b : a)[1];
  }

  function drawBackground() {
    const W = canvas.width, H = canvas.height;
    const sx = W / canvas.clientWidth, sy = H / canvas.clientHeight;
    bgCanvas.width = W; bgCanvas.height = H;
    const g = bgCtx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#2B52FF');
    g.addColorStop(.45, '#1339F4');
    g.addColorStop(1, '#0A22B8');
    bgCtx.fillStyle = g; bgCtx.fillRect(0, 0, W, H);
    // a few soft pools of light
    const glow = (x, y, r, a) => {
      const rg = bgCtx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, `rgba(142,174,255,${a})`); rg.addColorStop(1, 'rgba(142,174,255,0)');
      bgCtx.fillStyle = rg; bgCtx.fillRect(0, 0, W, H);
    };
    glow(W * .18, H * .12, W * .5, .35);
    glow(W * .9, H * .75, W * .35, .18);

    // headline, positioned exactly where the DOM puts it
    const hr = canvas.getBoundingClientRect();
    bgCtx.textBaseline = 'alphabetic';
    for (const w of title.querySelectorAll('.w')) {
      const cs = getComputedStyle(w);
      const r = w.getBoundingClientRect();
      const probe = w.querySelector('.bl') || w.appendChild(Object.assign(document.createElement('i'), { className: 'bl' }));
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      const baseline = probe.getBoundingClientRect().top;
      const size = parseFloat(cs.fontSize) * sx;
      bgCtx.font = `${cs.fontStyle} ${cs.fontWeight} ${size}px ${cs.fontFamily}`;
      if ('fontStretch' in bgCtx) bgCtx.fontStretch = stretchKeyword(cs.fontStretch);
      bgCtx.letterSpacing = (parseFloat(cs.letterSpacing) || 0) * sx + 'px';
      const text = w.firstChild.textContent;
      // shadow from the "floor" so the words read as sitting under the water
      bgCtx.fillStyle = 'rgba(5,12,58,.28)';
      bgCtx.fillText(text, (r.left - hr.left) * sx + 6 * sx, (baseline - hr.top) * sy + 10 * sy);
      bgCtx.fillStyle = '#FEF1C4';
      bgCtx.fillText(text, (r.left - hr.left) * sx, (baseline - hr.top) * sy);
    }

    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /* ---------------- sizing ---------------- */
  let aspect = 1;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, coarse ? 1.5 : 1.75);
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr)), h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (w === canvas.width && h === canvas.height && targets.length) { drawBackground(); return true; }
    canvas.width = w; canvas.height = h;
    aspect = w / h;
    const div = coarse ? 4 : 3;
    const nw = Math.max(64, Math.round(canvas.clientWidth / div)), nh = Math.max(64, Math.round(canvas.clientHeight / div));
    if (nw !== simW || nh !== simH) {
      for (const t of targets) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
      const a = makeTarget(nw, nh), b = makeTarget(nw, nh);
      if (!a || !b) return false;
      targets = [a, b]; simW = nw; simH = nh; cur = 0;
    }
    drawBackground();
    return true;
  }

  /* ---------------- passes ---------------- */
  function pass(prog, setUniforms) {
    const src = targets[cur], dst = targets[1 - cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
    gl.viewport(0, 0, simW, simH);
    gl.useProgram(prog.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.uniform1i(prog.u.s, 0);
    setUniforms(prog.u);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    cur = 1 - cur;
  }
  const drops = [];
  function drop(x, y, radius, strength) { if (drops.length < 24) drops.push([x, y, radius, strength]); }

  function frame(t) {
    for (const d of drops.splice(0)) pass(P.drop, u => {
      gl.uniform2f(u.c, d[0], d[1]); gl.uniform1f(u.r, d[2]); gl.uniform1f(u.a, d[3]); gl.uniform1f(u.aspect, aspect);
    });
    for (let i = 0; i < 2; i++) pass(P.step, u => { gl.uniform2f(u.px, 1 / simW, 1 / simH); gl.uniform1f(u.damp, .985); });

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(P.render.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, targets[cur].tex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bgTex);
    const u = P.render.u;
    gl.uniform1i(u.s, 0); gl.uniform1i(u.bg, 1);
    gl.uniform2f(u.px, 1 / simW, 1 / simH);
    gl.uniform1f(u.t, t / 1000);
    gl.uniform1f(u.aspect, aspect);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /* ---------------- interaction ---------------- */
  let lastX = -1, lastY = -1;
  const toUv = e => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, 1 - (e.clientY - r.top) / r.height];
  };
  hero.addEventListener('pointermove', e => {
    const [x, y] = toUv(e);
    const dx = x - lastX, dy = y - lastY;
    if (lastX < 0 || dx * dx + dy * dy > 0.00002) {
      drop(x, y, coarse ? .03 : .022, .028);
      lastX = x; lastY = y;
    }
  }, { passive: true });
  hero.addEventListener('pointerdown', e => {
    const [x, y] = toUv(e);
    drop(x, y, .06, -.5);
  }, { passive: true });

  // the rain: a light drizzle, now and then a heavier drop
  let nextRain = 0;
  function rain(t) {
    if (reduce || t < nextRain) return;
    const big = Math.random() < .12;
    drop(Math.random(), Math.random(), big ? .035 : .012, big ? .22 : .06);
    nextRain = t + 90 + Math.random() * 260;
  }

  /* ---------------- loop ---------------- */
  let visible = true, raf = 0, running = false;
  function loop(t) {
    raf = 0;
    if (!visible || document.hidden) { running = false; return; }
    rain(t);
    frame(t);
    raf = requestAnimationFrame(loop);
  }
  let ready = false;
  function start() { if (ready && !running) { running = true; raf = requestAnimationFrame(loop); } }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); }).observe(hero);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });

  let rt = 0;
  function onResize() { clearTimeout(rt); rt = setTimeout(() => { if (!resize()) teardown(); }, 120); }
  function teardown() { document.documentElement.classList.remove('gl-on'); canvas.style.display = 'none'; visible = false; }

  canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); teardown(); });

  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    if (!resize()) return teardown();
    document.documentElement.classList.add("gl-on");
    ready = true;
    addEventListener('resize', onResize);
    // the first splash, for the entrance
    window.__waterSplash = () => { drop(.32, .45, .09, -.9); drop(.7, .3, .06, -.6); };
    frame(performance.now());
    start();
  });
})();
