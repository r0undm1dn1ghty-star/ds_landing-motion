/* ds_landing-motion — эффекты: дисплейсмент по карте глубин, печать (halftone/дизеринг/зерно), частицы, turntable.
   Без библиотек: WebGL2 / WebGPU / canvas 2d. Каждый путь пишет фактический шильдик. */
(function (w) {
  'use strict';
  var DS = (w.DS = w.DS || {});
  var PROBE = (w.DSProbe = w.DSProbe || {});
  var REDUCE = 'matchMedia' in w && w.matchMedia('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.classList.contains('force-reduce');

  /* ---------- 0. детерминированная «плоская картинка» (то, что на лендинге приходит PNG) ---------- */
  function rnd(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
  DS.flatArtwork = function (px) {
    px = px || 512;
    var c = document.createElement('canvas'); c.width = c.height = px;
    var g = c.getContext('2d');
    var sky = g.createLinearGradient(0, 0, 0, px);
    sky.addColorStop(0, '#1b2440'); sky.addColorStop(.55, '#111524'); sky.addColorStop(1, '#0d1120');
    g.fillStyle = sky; g.fillRect(0, 0, px, px);
    var sun = g.createRadialGradient(px * .72, px * .3, 0, px * .72, px * .3, px * .3);
    sun.addColorStop(0, 'rgba(123,196,168,.95)'); sun.addColorStop(.45, 'rgba(123,196,168,.22)'); sun.addColorStop(1, 'rgba(123,196,168,0)');
    g.fillStyle = sun; g.beginPath(); g.arc(px * .72, px * .3, px * .3, 0, 6.2832); g.fill();
    var r = rnd(7);
    for (var ridge = 0; ridge < 4; ridge++) {
      var base = px * (.52 + ridge * .1), amp = px * (.12 - ridge * .022), step = px / 26;
      g.beginPath(); g.moveTo(0, px);
      for (var x = 0; x <= px; x += step) g.lineTo(x, base + Math.sin(x / step * (1.1 + ridge * .3) + ridge * 2) * amp);
      g.lineTo(px, px); g.closePath();
      g.fillStyle = 'rgba(' + (10 + ridge * 5) + ',' + (14 + ridge * 6) + ',' + (28 + ridge * 9) + ',1)'; g.fill();
      g.strokeStyle = 'rgba(123,196,168,' + (.18 - ridge * .035) + ')'; g.lineWidth = 1; g.stroke();
    }
    g.globalAlpha = .3; g.strokeStyle = '#7bc4a8'; g.lineWidth = 1;
    for (var i = 0; i < 60; i++) { var y = px * .08 + i * px * .012; g.beginPath(); g.moveTo(px * .06, y); g.lineTo(px * (.06 + .12 * r()), y); g.stroke(); }
    g.globalAlpha = 1;
    return c;
  };

  /* ---------- mat4 ---------- */
  function m4() { return new Float32Array(16); }
  function mul(a, b) { var o = m4(); for (var i = 0; i < 4; i++) for (var j = 0; j < 4; j++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; }
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2), o = m4(); o[0] = t / asp; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; }
  function rotX(a) { var o = m4(), c = Math.cos(a), s = Math.sin(a); o[0] = 1; o[5] = c; o[6] = s; o[9] = -s; o[10] = c; o[15] = 1; return o; }
  function rotY(a) { var o = m4(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[5] = 1; o[8] = s; o[10] = c; o[15] = 1; return o; }
  function trans(x, y, z) { var o = m4(); o[0] = o[5] = o[10] = o[15] = 1; o[12] = x; o[13] = y; o[14] = z; return o; }
  DS.mat = { mul: mul, persp: persp, rotX: rotX, rotY: rotY, trans: trans };

  function compile(gl, type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('shader: ' + gl.getShaderInfoLog(s));
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    return p;
  }
  function textureFrom(gl, canvas) {
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function pixelStats(gl, W, H) {
    var buf = new Uint8Array(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    var n = W * H, sum = 0, sum2 = 0, i;
    for (i = 0; i < n; i++) { var l = (buf[i * 4] * .2126 + buf[i * 4 + 1] * .7152 + buf[i * 4 + 2] * .0722) / 255; sum += l; sum2 += l * l; }
    var mean = sum / n;
    return { mean: +mean.toFixed(4), std: +Math.sqrt(Math.max(0, sum2 / n - mean * mean)).toFixed(4), buf: buf };
  }
  function pixelDiff(a, b) {
    var s = 0, n = Math.min(a.length, b.length) / 4, mx = 0, changed = 0;
    for (var i = 0; i < n; i++) {
      var d = (Math.abs(a[i * 4] - b[i * 4]) + Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) + Math.abs(a[i * 4 + 2] - b[i * 4 + 2])) / 3;
      s += d; if (d > mx) mx = d; if (d > 12) changed++;
    }
    return +(s / (n * 255)).toFixed(4);
  }
  function pixelDiffStat(a, b) {
    var s = 0, n = Math.min(a.length, b.length) / 4, mx = 0, changed = 0;
    for (var i = 0; i < n; i++) {
      var d = (Math.abs(a[i * 4] - b[i * 4]) + Math.abs(a[i * 4 + 1] - b[i * 4 + 1]) + Math.abs(a[i * 4 + 2] - b[i * 4 + 2])) / 3;
      s += d; if (d > mx) mx = d; if (d > 12) changed++;
    }
    return { mean: +(s / n / 255).toFixed(4), max: +(mx / 255).toFixed(3), changedFrac: +(changed / n).toFixed(4) };
  }
  DS.pixelDiff = pixelDiff;
  DS.pixelDiffStat = pixelDiffStat;

  /* ---------- 1. дисплейсмент: плоская картинка + карта высот (яркость) → рельеф ---------- */
  var VS_DISP = [
    '#version 300 es', 'precision highp float;',
    'uniform mat4 u_mvp; uniform sampler2D u_tex; uniform float u_depth; uniform float u_texel; uniform float u_n; uniform float u_relief;',
    'uniform float u_lo; uniform float u_hi;',
    'out vec2 v_uv; out vec3 v_nrm;',
    'float lum(vec2 uv){ vec3 c = texture(u_tex, uv).rgb; return dot(c, vec3(.2126,.7152,.0722)); }',
    'float height(vec2 uv){ return clamp((lum(uv) - u_lo) / max(u_hi - u_lo, 0.001), 0.0, 1.0); }',
    'void main(){',
    '  float n = u_n;',
    '  float cell = floor(float(gl_VertexID) / 6.0);',
    '  float corner = float(gl_VertexID) - cell * 6.0;',
    '  float cx = mod(cell, n); float cy = floor(cell / n);',
    '  float ox = (corner == 1.0 || corner == 4.0 || corner == 5.0) ? 1.0 : 0.0;',
    '  float oy = (corner == 2.0 || corner == 3.0 || corner == 5.0) ? 1.0 : 0.0;',
    '  vec2 uv = (vec2(cx + ox, cy + oy)) / n;',
    '  float h = height(uv);',
    '  float hx = height(uv + vec2(u_texel, 0.0)); float hy = height(uv + vec2(0.0, u_texel));',
    '  vec3 nrm = normalize(vec3((h - hx) * u_relief, (h - hy) * u_relief, 1.0));',
    '  vec3 p = vec3(uv * 2.0 - 1.0, h * u_depth);',
    '  v_uv = uv; v_nrm = nrm;',
    '  gl_Position = u_mvp * vec4(p, 1.0);',
    '}'
  ].join('\n');
  var FS_DISP = [
    '#version 300 es', 'precision highp float;',
    'in vec2 v_uv; in vec3 v_nrm;',
    'uniform sampler2D u_tex; uniform vec3 u_accent; uniform vec3 u_light;',
    'out vec4 outColor;',
    'void main(){',
    '  vec3 base = texture(u_tex, v_uv).rgb;',
    '  vec3 nrm = normalize(v_nrm);',
    '  float d = max(dot(nrm, normalize(u_light)), 0.0);',
    '  float rim = pow(1.0 - clamp(nrm.z, 0.0, 1.0), 2.0);',
    '  vec3 col = base * (0.34 + 0.86 * d) + u_accent * rim * 0.7;',
    '  outColor = vec4(pow(col, vec3(0.95)), 1.0);',
    '}'
  ].join('\n');

  DS.displace = function (canvas, artwork) {
    var gl = canvas.getContext('webgl2', { antialias: true, preserveDrawingBuffer: true, alpha: false });
    if (!gl) return { ok: false, tier: 'canvas 2d', reason: 'нет webgl2' };
    if (gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) return { ok: false, tier: 'canvas 2d', reason: 'нет vertex texture fetch' };
    var prog;
    try { prog = program(gl, VS_DISP, FS_DISP); } catch (e) { return { ok: false, tier: 'canvas 2d', reason: String(e.message) }; }
    var dbg = gl.getExtension('WEBGL_debug_renderer_info');
    var st = { ok: true, tier: 'webgl2', renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'n/a' };
    var N = 128, verts = N * N * 6;
    var u = {
      mvp: gl.getUniformLocation(prog, 'u_mvp'), depth: gl.getUniformLocation(prog, 'u_depth'),
      texel: gl.getUniformLocation(prog, 'u_texel'), n: gl.getUniformLocation(prog, 'u_n'),
      relief: gl.getUniformLocation(prog, 'u_relief'), tex: gl.getUniformLocation(prog, 'u_tex'),
      accent: gl.getUniformLocation(prog, 'u_accent'), light: gl.getUniformLocation(prog, 'u_light'),
      lo: gl.getUniformLocation(prog, 'u_lo'), hi: gl.getUniformLocation(prog, 'u_hi')
    };
    gl.useProgram(prog);
    gl.bindTexture(gl.TEXTURE_2D, textureFrom(gl, artwork));
    gl.uniform1i(u.tex, 0);
    gl.uniform1f(u.n, N);
    gl.uniform1f(u.texel, 1 / artwork.width);
    gl.uniform3f(u.accent, .482, .769, .659);
    gl.uniform3f(u.light, .45, .72, .55);
    gl.uniform1f(u.lo, 0.03); gl.uniform1f(u.hi, 0.42);   // рабочий диапазон яркости → 0..1 по высоте
    var view = { tx: 0.10, ty: -0.06 };
    function draw(depth, relief) {
      var W = canvas.width, H = canvas.height;
      gl.viewport(0, 0, W, H);
      gl.clearColor(0.051, 0.067, 0.141, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      var vp = mul(persp(38 * Math.PI / 180, W / H, 0.1, 100), mul(trans(0, 0, -2.25), mul(rotX(view.ty), rotY(view.tx))));
      gl.uniformMatrix4fv(u.mvp, false, vp);
      gl.uniform1f(u.depth, depth); gl.uniform1f(u.relief, relief);
      gl.drawArrays(gl.TRIANGLES, 0, verts);
    }
    var last = null;
    function frame() { draw(0.5, 46); last = pixelStats(gl, canvas.width, canvas.height); }
    frame();
    st.draw = draw; st.stats = function () { return pixelStats(gl, canvas.width, canvas.height); };
    return st;
  };

  /* ---------- 2. печать: halftone + дизеринг + зерно (WebGL2) ---------- */
  var VS_QUAD = ['#version 300 es', 'void main(){ vec2 p = vec2((gl_VertexID==1)?3.0:-1.0, (gl_VertexID==2)?3.0:-1.0); gl_Position = vec4(p,0.0,1.0); }'].join('\n');
  var FS_PRINT = [
    '#version 300 es', 'precision highp float;',
    'uniform sampler2D u_tex; uniform float u_time; uniform float u_mode; uniform vec2 u_res;',
    'uniform vec3 u_ink; uniform vec3 u_bg;',
    'out vec4 outColor;',
    'const float BAYER[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);',
    'float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453123); }',
    'void main(){',
    '  vec2 uv = gl_FragCoord.xy / u_res;',
    '  vec3 src = texture(u_tex, vec2(uv.x, 1.0 - uv.y)).rgb;',
    '  float l = dot(src, vec3(.2126,.7152,.0722));',
    '  vec3 col;',
    '  if (u_mode < 1.5) {',
    '    vec2 g = fract(uv * u_res / 7.0) - 0.5;',
    '    float r = sqrt(clamp(1.0 - l, 0.0, 1.0)) * 0.62;',
    '    float d = 1.0 - smoothstep(max(r - 0.14, 0.0), r + 0.001, length(g));',
    '    col = mix(u_bg, u_ink, d);',
    '  } else if (u_mode < 2.5) {',
    '    float t = (BAYER[int(mod(gl_FragCoord.y,4.0)) * 4 + int(mod(gl_FragCoord.x,4.0))] + 0.5) / 16.0;',
    '    col = (l * 1.35 > t) ? u_bg : u_ink;',
    '  } else {',
    '    float g = hash(floor(gl_FragCoord.xy * 0.9) + floor(u_time * 3.0));',
    '    col = mix(u_bg, u_ink, clamp(l * 1.45 - 0.1, 0.0, 1.0)) + (g - 0.5) * 0.13;',
    '  }',
    '  outColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  DS.print = function (canvas, artwork) {
    var gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true, alpha: false });
    if (!gl) return { ok: false, tier: 'canvas 2d' };
    var prog;
    try { prog = program(gl, VS_QUAD, FS_PRINT); } catch (e) { return { ok: false, tier: 'canvas 2d', reason: String(e.message) }; }
    var u = { tex: gl.getUniformLocation(prog, 'u_tex'), time: gl.getUniformLocation(prog, 'u_time'), mode: gl.getUniformLocation(prog, 'u_mode'), res: gl.getUniformLocation(prog, 'u_res'), ink: gl.getUniformLocation(prog, 'u_ink'), bg: gl.getUniformLocation(prog, 'u_bg') };
    gl.useProgram(prog);
    gl.bindTexture(gl.TEXTURE_2D, textureFrom(gl, artwork));
    gl.uniform1i(u.tex, 0);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform3f(u.ink, .482, .769, .659);
    gl.uniform3f(u.bg, .067, .082, .141);
    var mode = 1;
    function draw(t) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform1f(u.mode, mode); gl.uniform1f(u.time, (t || 0) / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function set(m) { mode = m; draw(0); }
    set(1);
    return { ok: true, tier: 'webgl2', set: set, draw: draw, stats: function () { return pixelStats(gl, canvas.width, canvas.height); }, get mode() { return mode; } };
  };

  /* ---------- 3. печать без GPU: canvas 2d ---------- */
  DS.printCanvas2D = function (canvas, artwork) {
    var ctx = canvas.getContext('2d');
    var W = canvas.width, H = canvas.height;
    var src = document.createElement('canvas'); src.width = W; src.height = H;
    src.getContext('2d').drawImage(artwork, 0, 0, W, H);
    var data = src.getContext('2d').getImageData(0, 0, W, H).data;
    var BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    var ink = [123, 196, 168], bg = [17, 21, 36], mode = 1;
    function paint() {
      if (mode === 1) {                       // halftone: точка на блок 6×6, радиус от яркости
        ctx.fillStyle = 'rgb(' + bg.join(',') + ')'; ctx.fillRect(0, 0, W, H);
        var b = 6;
        for (var y = 0; y < H; y += b) for (var x = 0; x < W; x += b) {
          var px = data[((y + 3) * W + (x + 3)) * 4 + 1] / 255;
          var r = Math.sqrt(1 - px) * b * 0.62;
          ctx.fillStyle = 'rgba(' + ink.join(',') + ',' + (0.25 + 0.75 * (1 - px)).toFixed(3) + ')';
          ctx.beginPath(); ctx.arc(x + b / 2, y + b / 2, r, 0, 6.2832); ctx.fill();
        }
      } else if (mode === 2) {                // дизеринг Байера 4×4
        var img = ctx.createImageData(W, H);
        for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) {
          var o = (yy * W + xx) * 4, l = data[o + 1] / 255;
          var t = (BAYER[(yy % 4) * 4 + (xx % 4)] + 0.5) / 16;
          var on = l * 1.35 > t ? 1 : 0;
          img.data[o] = on ? ink[0] : bg[0]; img.data[o + 1] = on ? ink[1] : bg[1];
          img.data[o + 2] = on ? ink[2] : bg[2]; img.data[o + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      } else {                                // зерно поверх тона
        ctx.drawImage(src, 0, 0);
        var gi = ctx.createImageData(W, H);
        for (var k = 0; k < W * H; k++) {
          var g = (Math.random() - 0.5) * 34;
          gi.data[k * 4] = g; gi.data[k * 4 + 1] = g; gi.data[k * 4 + 2] = g; gi.data[k * 4 + 3] = 255;
        }
        var tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        tmp.getContext('2d').putImageData(gi, 0, 0);
        ctx.globalCompositeOperation = 'overlay'; ctx.drawImage(tmp, 0, 0); ctx.globalCompositeOperation = 'source-over';
      }
    }
    function set(m) { mode = m; paint(); }
    set(1);
    return { ok: true, tier: 'canvas 2d', set: set, draw: function (t) { if (mode === 3) paint(); }, stats: function () { return null; }, get mode() { return mode; } };
  };

  /* ---------- 4. WebGPU-ветка печати (raw WGSL, без бейка) ---------- */
  var WGSL = [
    'struct U { res: vec2f, time: f32, mode: f32 };',
    '@group(0) @binding(0) var<uniform> u: U;',
    '@group(0) @binding(1) var samp: sampler;',
    '@group(0) @binding(2) var tex: texture_2d<f32>;',
    'struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };',
    '@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {',
    '  var p = array<vec2f,3>(vec2f(-1.,-1.), vec2f(3.,-1.), vec2f(-1.,3.));',
    '  var o: VOut; o.pos = vec4f(p[i], 0., 1.);',
    '  o.uv = vec2f((p[i].x + 1.) * .5, (1. - p[i].y) * .5);',
    '  return o;',
    '}',
    'fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7))) * 43758.5453123); }',
    '@fragment fn fs(f: VOut) -> @location(0) vec4f {',
    '  var bayer = array<f32,16>(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);',
    '  let src = textureSample(tex, samp, f.uv).rgb;',
    '  let l = dot(src, vec3f(.2126,.7152,.0722));',
    '  let ink = vec3f(.482,.769,.659); let bg = vec3f(.067,.082,.141);',
    '  var col = bg;',
    '  if (u.mode < 1.5) {',
    '    let g = fract(f.pos.xy / 7.0) - vec2f(0.5);',
    '    let r = sqrt(clamp(1.0 - l, 0.0, 1.0)) * .62;',
    '    let d = 1.0 - smoothstep(max(r - .14, 0.0), r + .001, length(g));',
    '    col = mix(bg, ink, d);',
    '  } else if (u.mode < 2.5) {',
    '    let ix = u32(f.pos.x) % 4u; let iy = u32(f.pos.y) % 4u;',
    '    let t = (bayer[iy * 4u + ix] + .5) / 16.0;',
    '    col = select(ink, bg, l * 1.35 > t);',
    '  } else {',
    '    let g = (hash(floor(f.pos.xy * .9) + floor(u.time * 3.0)) - .5) * .13;',
    '    col = mix(bg, ink, clamp(l * 1.45 - .1, 0., 1.)) + vec3f(g);',
    '  }',
    '  return vec4f(col, 1.0);',
    '}'
  ].join('\n');

  DS.printWebGPU = function (canvas, artwork, onFail) {
    if (!navigator.gpu) { onFail(); return; }
    var settled = false;
    var guard = setTimeout(function () { if (!settled) onFail(); }, 1200);
    navigator.gpu.requestAdapter().then(function (ad) {
      if (!ad) throw new Error('нет адаптера');
      return ad.requestDevice();
    }).then(function (device) {
      settled = true; clearTimeout(guard);
      var ctx = canvas.getContext('webgpu');
      var fmt = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({ device: device, format: fmt, alphaMode: 'premultiplied' });
      var mod = device.createShaderModule({ code: WGSL });
      var pipe = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: mod, entryPoint: 'vs' },
        fragment: { module: mod, entryPoint: 'fs', targets: [{ format: fmt }] }
      });
      var ub = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var src = device.createTexture({ size: [artwork.width, artwork.height], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
      device.queue.copyExternalImageToTexture({ source: artwork }, { texture: src }, [artwork.width, artwork.height]);
      var bind = device.createBindGroup({
        layout: pipe.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: ub } },
          { binding: 1, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
          { binding: 2, resource: src.createView() }
        ]
      });
      var mode = 1;
      function draw(t) {
        device.queue.writeBuffer(ub, 0, new Float32Array([canvas.width, canvas.height, (t || 0) / 1000, mode]));
        var enc = device.createCommandEncoder();
        var pass = enc.beginRenderPass({ colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: 'clear', clearValue: { r: 0, g: 0, b: 0, a: 1 }, storeOp: 'store' }] });
        pass.setPipeline(pipe); pass.setBindGroup(0, bind); pass.draw(3); pass.end();
        device.queue.submit([enc.finish()]);
      }
      draw(0);
      DS.printApi = { ok: true, tier: 'webgpu', set: function (m) { mode = m; draw(0); }, draw: draw, stats: function () { return null; }, get mode() { return mode; } };
    }).catch(function () { if (!settled) { settled = true; clearTimeout(guard); onFail(); } });
  };

  /* ---------- 5. частицы (canvas 2d, потолок 30 fps, пауза вне вьюпорта) ---------- */
  DS.particles = function (canvas) {
    var ctx = canvas.getContext('2d'), N = 190, ps = [], running = true, last = 0, lastTs = 1200, staticMode = !!(w.DS_FLAGS && w.DS_FLAGS.static);
    var r = rnd(11);
    for (var i = 0; i < N; i++) ps.push({ x: r(), y: r(), v: .012 + r() * .05, s: 2.2 + r() * 4.4, a: .46 + r() * .5, h: r() });
    function size() { canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; }
    /* Смена width/height ОЧИЩАЕТ буфер. Если только переназначить размер, блок останется пустым
       на экране при живых числах в пробе. Поэтому ресайз всегда сопровождается перерисовкой. */
    function refit() { size(); paint(lastTs); }
    /* Позиция — ЧИСТАЯ ФУНКЦИЯ времени: ни накопления, ни Math.random. Поэтому кадр
       воспроизводим, а фоновая вкладка показывает то же, что активная.
       Плотность выше к середине: поток читается как поток, а не как пыль. */
    function paint(ts) {
      lastTs = ts;
      var W = canvas.width, H = canvas.height, t = ts / 1000;
      ctx.clearRect(0, 0, W, H);
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i];
        var ny = ((p.y - t * p.v) % 1 + 1) % 1;
        var x = p.x * W + Math.sin(t * .6 + p.h * 6.28) * 12, y = ny * H;
        var fade = 1 - Math.abs(ny - .5) * 0.85;
        ctx.beginPath(); ctx.arc(x, y, p.s, 0, 6.2832);
        ctx.fillStyle = 'rgba(123,196,168,' + (p.a * fade).toFixed(2) + ')'; ctx.fill();
      }
    }
    function draw(ts) {
      if (!running) return;
      requestAnimationFrame(draw);
      if (ts - last < 1000 / 30) return;      // 30 fps
      last = ts; paint(ts);
    }
    size();
    if (staticMode) paint(1200);              // режим прогона: один кадр, без бесконечного rAF
    else requestAnimationFrame(draw);
    if ('IntersectionObserver' in w) {
      new IntersectionObserver(function (e) { running = e[0].isIntersecting && !document.hidden; }, { threshold: .05 }).observe(canvas);
    }
    document.addEventListener('visibilitychange', function () { running = !document.hidden; });
    w.addEventListener('resize', refit);
    if ('ResizeObserver' in w) new ResizeObserver(refit).observe(canvas);
    return {
      tier: 'canvas 2d', count: N,
      sample: function () {
        var d = ctx.getImageData(0, 0, canvas.width, canvas.height).data, on = 0;
        for (var i = 3; i < d.length; i += 4) if (d[i] > 8) on++;
        return +(on / (canvas.width * canvas.height)).toFixed(4);
      }
    };
  };

  /* ---------- 6. turntable: процедурный спрайт-лист (36 кадров), объект можно вращать ---------- */
  DS.turntable = function (host) {
    var FRAMES = 36, F = 176, sheet = document.createElement('canvas');
    sheet.width = FRAMES * F; sheet.height = F;
    var sg = sheet.getContext('2d');
    var V = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
    var FACES = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [4, 0, 1, 5]];
    for (var f = 0; f < FRAMES; f++) {
      var a = f / FRAMES * Math.PI * 2;
      var pts = V.map(function (p) {
        var x = p[0] * Math.cos(a) - p[2] * Math.sin(a);
        var z = p[0] * Math.sin(a) + p[2] * Math.cos(a);
        var y = p[1] * Math.cos(-0.34) - z * Math.sin(-0.34);
        var zz = p[1] * Math.sin(-0.34) + z * Math.cos(-0.34);
        var s = 3.1 / (3.1 + zz * 0.9);
        return { x: F / 2 + x * F * 0.26 * s, y: F / 2 + y * F * 0.26 * s, z: zz };
      });
      var order = FACES.map(function (fc, idx) {
        var zs = (pts[fc[0]].z + pts[fc[1]].z + pts[fc[2]].z + pts[fc[3]].z) / 4;
        return { fc: fc, z: zs, idx: idx };
      }).sort(function (p, q) { return p.z - q.z; });
      order.forEach(function (o) {
        var fc = o.fc, lum = 0.34 + 0.5 * (o.idx % 3) / 2;
        sg.beginPath();
        sg.moveTo(pts[fc[0]].x, pts[fc[0]].y);
        for (var k = 1; k < 4; k++) sg.lineTo(pts[fc[k]].x, pts[fc[k]].y);
        sg.closePath();
        sg.fillStyle = 'rgba(' + Math.round(123 * lum) + ',' + Math.round(196 * lum) + ',' + Math.round(168 * lum) + ',.92)';
        sg.fill();
        sg.strokeStyle = 'rgba(238,242,249,.5)'; sg.lineWidth = 1; sg.stroke();
      });
      sg.fillStyle = 'rgba(238,242,249,.75)';
      sg.font = '500 10px ui-monospace, monospace';
      sg.fillText('°' + Math.round(f * 360 / FRAMES), 8, F - 10);
    }
    host.style.backgroundImage = 'url(' + sheet.toDataURL('image/png') + ')';
    var frame = 0, dragging = false, lastX = 0;
    function set(f2) {
      frame = ((f2 % FRAMES) + FRAMES) % FRAMES;
      host.style.setProperty('--frame', frame);
      host.style.setProperty('--frame-fixed', frame - (frame % 1));
    }
    set(0);
    host.parentNode.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; host.parentNode.setPointerCapture(e.pointerId); });
    host.parentNode.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var d = e.clientX - lastX;
      if (Math.abs(d) < 4) return;
      set(frame + Math.round(d / 4)); lastX = e.clientX;
    });
    host.parentNode.addEventListener('pointerup', function () { dragging = false; });
    host.parentNode.addEventListener('wheel', function (e) { e.preventDefault(); set(frame + (e.deltaY > 0 ? 1 : -1)); }, { passive: false });
    if (!REDUCE && !(w.DS_FLAGS && w.DS_FLAGS.static)) setInterval(function () { if (!dragging && !document.hidden) set(frame + 1); }, 2200);
    return { frames: FRAMES, sheetWidth: sheet.width, step: F, setFrame: set, get frame() { return frame; } };
  };

  DS.REDUCE = REDUCE;
})(window);
