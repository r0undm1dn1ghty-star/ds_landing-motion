# generative-effects — шейдеры, зерно, дизеринг, halftone, частицы

Что показывает каждый эффект (без ответа — не брать):

| Эффект | Показывает | Когда НЕ надо |
|---|---|---|
| halftone | плотность материала: печатная точка вместо гладкого тона | там, где нужна читаемость мелкого текста (точка съедает штрих) |
| дизеринг Байера | «печатный» порядок полутона, честную бедность палитры | на фотографиях лиц и продукта: лицо становится грязью |
| зерно | что поверхность — материал, а не заливка | на светлом фоне и на мелком тексте |
| частицы | движение среды («через систему идут данные») | как замену аргументу: пустую секцию фон не спасёт |

Один GPU-момент на секцию, 2–3 на страницу. Фон под контент — canvas поверх фона, `pointer-events:none`, `aria-hidden="true"`.

## 1. Каскад путей и честный шильдик

Три пути на один эффект: WebGPU → WebGL2 → canvas 2d. Пользователь видит, какой живёт, потому что разница в картинке — это разница в качестве, и врать про неё нельзя.

```js
function boot(api){
  badge.textContent = api.tier + ' · ' + (api.tier === 'canvas 2d'
    ? 'halftone/дизеринг без GPU' : 'halftone + дизеринг Байера + зерно');
  printApi = api;
}
if (DS_FLAGS.tier === 'canvas2d') { boot(printCanvas2D(cv, art)); }
else if (DS_FLAGS.tier === 'webgl2') { var gl = printWebGL2(cv, art); gl.ok ? boot(gl) : boot(printCanvas2D(cv, art)); }
else { printWebGPU(cv, art, function(){                       // default: сначала WebGPU
  var gl = printWebGL2(cv, art); gl.ok ? boot(gl) : boot(printCanvas2D(cv, art));
}); }
```

`?tier=webgl2|canvas2d` — не только для прогона: им удобно проверить фолбэк на живом пользователе, не выключая GPU в браузере.

## 2. WebGL2: halftone + дизеринг Байера + зерно

Один фрагментный шейдер на весь экран (`drawArrays(TRIANGLES,0,3)` без буферов: позиция из `gl_VertexID`), источник — canvas с плоской картинкой.

```glsl
#version 300 es
precision highp float;
uniform sampler2D u_tex; uniform float u_time, u_mode; uniform vec2 u_res; uniform vec3 u_ink, u_bg;
out vec4 outColor;
const float BAYER[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453123); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 src = texture(u_tex, vec2(uv.x, 1.0-uv.y)).rgb;      // UNPACK_FLIP_Y уже переворачивает текстуру
  float l = dot(src, vec3(.2126,.7152,.0722));
  vec3 col;
  if (u_mode < 1.5) {                                        // halftone: точка на блок 7px
    vec2 g = fract(uv*u_res/7.0) - 0.5;
    float r = sqrt(clamp(1.0-l,0.0,1.0))*0.62;
    col = mix(u_bg, u_ink, 1.0 - smoothstep(max(r-0.14,0.0), r+0.001, length(g)));
  } else if (u_mode < 2.5) {                                 // дизеринг 4×4
    float t = (BAYER[int(mod(gl_FragCoord.y,4.0))*4 + int(mod(gl_FragCoord.x,4.0))] + 0.5)/16.0;
    col = (l*1.35 > t) ? u_bg : u_ink;
  } else {                                                   // зерно поверх тона
    float g = hash(floor(gl_FragCoord.xy*0.9) + floor(u_time*3.0));
    col = mix(u_bg, u_ink, clamp(l*1.45-0.1,0.0,1.0)) + (g-0.5)*0.13;
  }
  outColor = vec4(col, 1.0);
}
```

```js
var gl = canvas.getContext('webgl2', {antialias:false, preserveDrawingBuffer:true, alpha:false});
gl.useProgram(prog); gl.bindTexture(gl.TEXTURE_2D, textureFrom(gl, artwork));
gl.uniform1i(u.tex, 0); gl.uniform2f(u.res, canvas.width, canvas.height);
gl.uniform3f(u.ink, .482,.769,.659); gl.uniform3f(u.bg, .067,.082,.141);   // accent / deep из токенов
function draw(t){ gl.viewport(0,0,canvas.width,canvas.height);
  gl.uniform1f(u.mode, mode); gl.uniform1f(u.time, (t||0)/1000); gl.drawArrays(gl.TRIANGLES,0,3); }
```

Две грабли GLSL: `smoothstep(edge0, edge1, x)` с `edge0 > edge1` даёт неопределённый результат на части драйверов — пиши `1.0 - smoothstep(max(r-0.14,0.0), r+0.001, d)`; `const float BAYER[16]` с динамическим индексом работает в ES 3.00 (в ES 1.00 — нет, там нужен `mediump`-костыль через `texture`-lookup или целочисленную математику).

## 3. WebGPU-ветка (raw WGSL, без npm-бейка)

Полноэкранный треугольник + тот же набор режимов. Внутри офлайн-страницы бейк не нужен: нет модулей и `fetch` — нет и причины ломаться на `file://`.

```wgsl
struct U { res: vec2f, time: f32, mode: f32 };
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var tex: texture_2d<f32>;
struct VOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var p = array<vec2f,3>(vec2f(-1.,-1.), vec2f(3.,-1.), vec2f(-1.,3.));
  var o: VOut; o.pos = vec4f(p[i], 0., 1.);
  o.uv = vec2f((p[i].x+1.)*.5, (1.-p[i].y)*.5); return o;
}
fn hash(p: vec2f) -> f32 { return fract(sin(dot(p, vec2f(127.1,311.7)))*43758.5453123); }
@fragment fn fs(f: VOut) -> @location(0) vec4f {
  var bayer = array<f32,16>(0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  let src = textureSample(tex, samp, f.uv).rgb;
  let l = dot(src, vec3f(.2126,.7152,.0722));
  let ink = vec3f(.482,.769,.659); let bg = vec3f(.067,.082,.141);
  var col = bg;
  if (u.mode < 1.5) {
    let g = fract(f.pos.xy/7.0) - vec2f(0.5);
    let r = sqrt(clamp(1.0-l, 0.0, 1.0))*.62;
    col = mix(bg, ink, 1.0 - smoothstep(max(r-.14,0.0), r+.001, length(g)));
  } else if (u.mode < 2.5) {
    let ix = u32(f.pos.x) % 4u; let iy = u32(f.pos.y) % 4u;
    let t = (bayer[iy*4u+ix] + .5)/16.0;
    col = select(ink, bg, l*1.35 > t);
  } else {
    let g = (hash(floor(f.pos.xy*.9) + floor(u.time*3.0)) - .5)*.13;
    col = mix(bg, ink, clamp(l*1.45-.1, 0., 1.)) + vec3f(g);
  }
  return vec4f(col, 1.0);
}
```

```js
// гварды: адаптер, device, таймаут 1200 мс и один вызов onFail
try {
  navigator.gpu.requestAdapter().then(function(ad){ if(!ad) throw new Error('нет адаптера'); return ad.requestDevice(); })
    .then(function(device){
      var ctx = canvas.getContext('webgpu'); var fmt = navigator.gpu.getPreferredCanvasFormat();
      ctx.configure({device, format:fmt, alphaMode:'premultiplied'});
      // pipeline (layout:'auto', targets:[{format:fmt}]), uniform-буфер 16 байт, copyExternalImageToTexture, bindGroup
    }).catch(function(){ if (!settled) { settled = true; clearTimeout(guard); onFail(); } });
} catch (e) { onFail(); }
```

**Честно про проверку:** эта ветка в headless-прогоне не поднимается — `requestAdapter()` не завершается под `--virtual-time-budget` (проверено: ни `then`, ни `catch`, ни страж-таймаут не срабатывают). Поэтому в прогоне путь фиксируется `?tier=webgl2`, а WebGPU проверяется в реальном браузере; шильдик и `report.printChain` показывают, что случилось. Не выдавай эту ветку за проверенную, пока не увидел шильдик `webgpu` своими глазами.

## 4. canvas 2d: тот же эффект без GPU

Обязательный фолбэк. Halftone — блоками 6×6 по `ImageData`; дизеринг — по матрице Байера; зерно — второй canvas в `overlay`.

```js
var BAYER = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5], ink=[123,196,168], bg=[17,21,36];
function halftone(ctx, data, W, H){
  ctx.fillStyle='rgb('+bg.join(',')+')'; ctx.fillRect(0,0,W,H);
  var b=6;
  for (var y=0;y<H;y+=b) for (var x=0;x<W;x+=b){
    var px = data[((y+3)*W + (x+3))*4 + 1]/255;              // яркость по зелёному каналу — быстро и достаточно
    var r  = Math.sqrt(1-px)*b*0.62;
    ctx.fillStyle='rgba('+ink.join(',')+','+(0.25+0.75*(1-px)).toFixed(3)+')';
    ctx.beginPath(); ctx.arc(x+b/2, y+b/2, r, 0, 6.2832); ctx.fill();
  }
}
function dither(ctx, data, W, H){
  var img = ctx.createImageData(W,H);
  for (var y=0;y<H;y++) for (var x=0;x<W;x++){
    var o=(y*W+x)*4, l=data[o+1]/255, t=(BAYER[(y%4)*4+(x%4)]+0.5)/16, on = l*1.35 > t ? 1 : 0;
    img.data[o]=on?ink[0]:bg[0]; img.data[o+1]=on?ink[1]:bg[1]; img.data[o+2]=on?ink[2]:bg[2]; img.data[o+3]=255;
  }
  ctx.putImageData(img,0,0);
}
```

## 5. Зерно на CSS-слое

Готовый шум кладём картинкой, а не фильтром: `feTurbulence` при `opacity:.035` в `overlay` даёт отклонение меньше 1/255 (замер полосы: `min=max`, `std 0.0`) — это невидимо и правило не работает. Рабочее: canvas-шум 128×128 в data-URL, `opacity .06–.08`, `mix-blend-mode:overlay`, `pointer-events:none`, `z-index` из семантической шкалы.

```js
var S=128, c=document.createElement('canvas'); c.width=c.height=S;
var g=c.getContext('2d'), img=g.createImageData(S,S), s=12345;
for (var i=0;i<S*S;i++){
  s=(s*1664525+1013904223)>>>0; var v=(s>>>24)/255, lum = v<.5?0:255;
  img.data[i*4]=img.data[i*4+1]=img.data[i*4+2]=lum; img.data[i*4+3]=Math.abs(v-.5)*2*255*.55;
}
g.putImageData(img,0,0);
overlay.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
overlay.style.backgroundSize = S + 'px ' + S + 'px';
```

Зерно ставится только поверх средних тонов (на тёмной заливке overlay его съедает) — и проверяется числом: `std` полосы кадра должен быть выше 1–2 уровней, иначе правило убирать.

## 6. Частицы (canvas 2d, потому что фон обязан жить везде)

```js
var N=64, ps=[], running=true, last=0;
for (var i=0;i<N;i++) ps.push({x:r(), y:r(), v:.012+r()*.05, s:.6+r()*1.9, a:.14+r()*.5, h:r()});
function paint(ts){
  var W=canvas.width, H=canvas.height, t=ts/1000;
  ctx.clearRect(0,0,W,H);
  for (var i=0;i<N;i++){
    var p=ps[i];
    p.y -= p.v*.01; if (p.y < -.05) { p.y = 1.05; p.x = Math.random(); }
    ctx.beginPath();
    ctx.arc(p.x*W + Math.sin(t*.6 + p.h*6.28)*12, p.y*H, p.s, 0, 6.2832);
    ctx.fillStyle = 'rgba(123,196,168,'+p.a.toFixed(2)+')'; ctx.fill();
  }
}
function draw(ts){ if (!running) return; requestAnimationFrame(draw);
  if (ts-last < 1000/30) return; last = ts; paint(ts); }        // потолок 30 fps
requestAnimationFrame(draw);
new IntersectionObserver(function(e){ running = e[0].isIntersecting && !document.hidden; }, {threshold:.05}).observe(canvas);
document.addEventListener('visibilitychange', function(){ running = !document.hidden; });
window.addEventListener('resize', function(){ canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight; });
```

Размер канваса — CSS-пиксели (`canvas.width = clientWidth`), не `devicePixelRatio`. Второй полноэкранный цикл запускать только с потолком FPS и паузой вне вьюпорта; два полных цикла на слабом GPU роняют прокрутку страницы, и прогон начинает падать по таймауту.

## Что мерить

`gl.readPixels` (с `preserveDrawingBuffer`) по каждому режиму: mean/std и диф между режимами — в демо `halftone mean 0.582 / std 0.206`, `дизеринг 0.586 / 0.240`, `зерно 0.143 / 0.077`, `halftone vs дизеринг: 38 % пикселей изменено`; покрытие кадра частицами (`alpha > 8`: 0.99 %); `std` области кадра из PNG для зерна. Подробнее — `references/verify-motion.md`.

## На пределе бюджета

Если нужно больше, чем один кадр шейдера на секцию (WebGPU-поле, splat, постобработка), — это уже другой скилл: `vgpu` (API и команды), `webgpu-landing-effects` (bake-пайплайн, вес бандла, интеграция слоя в Discovery-лендинг, Node-рендер и readback).
