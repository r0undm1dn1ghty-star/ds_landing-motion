# object-to-3d — плоская картинка становится объёмом

Пять приёмов, от самого дешёвого к самому дорогому. Каждый начинается с фразы «он показывает X»: без неё приём не берётся.

| Приём | Показывает | Цена |
|---|---|---|
| Слои на `translateZ` | порядок планов панели: фон, тело, цифра | 0 библиотек, 20 строк CSS+JS |
| Sprite-вращение (turntable) | объект можно осмотреть — это вещь, а не картинка | 1 PNG-лист кадров |
| Параллакс-слои | разделение планов сцены и движение среды | 2–4 alpha-слоя |
| Дисплейсмент по карте высот (WebGL2) | где у плоского кадра уходит глубина, что стоит ближе | ~120 строк, без библиотек |

**Когда не надо:** для схем, скриншотов интерфейса, текста и плоских иллюстраций. Глубины в них нет — рельеф станет грязью. Если картинка не изображает объём, любой fake-3D читается как «приклеили эффект».

## 1. Слои на `translateZ` (fake-3D без шейдера)

```css
.stage{perspective:900px; display:grid; place-items:center}
.card{position:relative; width:78%; height:72%; transform-style:preserve-3d;
  transform:rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg));
  transition:transform 260ms cubic-bezier(.22,1,.36,1)}   /* кубик покоя: один токен движения */
.card .plate{position:absolute; inset:0; border-radius:var(--r-sm);
  border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.04)}
.back {transform:translateZ(-56px) scale(.94); opacity:.5}
.mid  {transform:translateZ(-8px)}
.front{transform:translateZ(58px); background:rgba(22,28,48,.9)}
.spec {position:absolute; inset:0; transform:translateZ(60px); pointer-events:none;
  background:radial-gradient(340px 200px at var(--sx,70%) var(--sy,30%),rgba(255,255,255,.16),transparent 70%)}
@media (prefers-reduced-motion:reduce){ .card{transform:none; transition:none} }
```

```js
var stage = document.querySelector('.stage'), card = stage.querySelector('.card');
var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function set(rx, ry, sx, sy){
  card.style.setProperty('--rx', rx.toFixed(2)+'deg');
  card.style.setProperty('--ry', ry.toFixed(2)+'deg');
  stage.style.setProperty('--sx', sx+'%'); stage.style.setProperty('--sy', sy+'%');
}
if (!reduce){
  stage.addEventListener('pointermove', function(e){
    var r = stage.getBoundingClientRect();
    var nx = (e.clientX-r.left)/r.width*2-1, ny = (e.clientY-r.top)/r.height*2-1;
    set(-ny*11, nx*15, (nx*.5+.5)*100, (ny*.5+.5)*100);   // угол ±15°, не больше: текст на z≠0 размывается
  });
  stage.addEventListener('pointerleave', function(){ set(0,0,70,30); });
}
```

Правила: текст держать на `z = 0` (на 58px он уже мыло), радиус 10–14px как в системе, hover-эффекты не нужны — глубина и так видна. Слоёв три-четыре; пять и больше читаются как расклейка.

## 2. Sprite-вращение (turntable)

Кадры: 24–36 предрендеров в один ряд, шаг ≤15° (при 12 кадрах рывок виден). Либо от генератора (в демо — процедурный рендер куба в 36 кадров на canvas, см. `demo/effects.js::DS.turntable`), либо PNG-лист из пайплайна.

```css
.tt-sprite{width:176px; height:176px; background-repeat:no-repeat; background-size:auto 100%;
  background-position-x:calc(var(--frame,0) * -176px)}   /* -176px = ширина кадра */
@media (prefers-reduced-motion:reduce){
  .tt-sprite{background-position-x:calc(var(--frame-fixed,12) * -176px)}  /* один выразительный ракурс */
}
```

```js
var FRAMES = 36, STEP = 176;
var host = document.querySelector('.tt-sprite');
var frame = 0, dragging = false, lastX = 0;
var stage = host.parentNode;
function setFrame(f){
  frame = ((f % FRAMES) + FRAMES) % FRAMES;           // зацикливание без Math.abs-дыр
  host.style.setProperty('--frame', frame);
}
setFrame(0);
stage.addEventListener('pointerdown', function(e){ dragging = true; lastX = e.clientX; stage.setPointerCapture(e.pointerId); });
stage.addEventListener('pointermove', function(e){
  if (!dragging) return;
  var d = e.clientX - lastX;
  if (Math.abs(d) < 4) return;                        // порог: иначе дрожание руки крутит объект
  setFrame(frame + Math.round(d/4)); lastX = e.clientX;
});
stage.addEventListener('pointerup', function(){ dragging = false; });
stage.addEventListener('wheel', function(e){ e.preventDefault(); setFrame(frame + (e.deltaY>0?1:-1)); }, {passive:false});
```

Лист 36×176 = 6336px шириной: `background-position-x` меняется на целое число кадров, поэтому подмена PNG-листа на свой — одна строка. Ленивый старт: `new Image().src = sheet` до первой отрисовки, иначе первые кадры мигают.

## 3. Параллакс-слои

Слои берутся из alpha-PNG или режутся маской, а не «на глаз»:

```css
.scene{position:relative; overflow:hidden}
.layer{position:absolute; inset:-6%; will-change:transform}
.layer.bg  {z-index:1; filter:blur(6px); transform:translate3d(calc(var(--mx)*-14px), calc(var(--my)*-10px),0) scale(1.12)}
.layer.far {z-index:2; transform:translate3d(calc(var(--mx)*-30px), calc(var(--my)*-22px),0)}
.layer.text{z-index:3; transform:translate3d(calc(var(--mx)*-10px), calc(var(--my)*-6px),0)}  /* заголовок МЕЖДУ слоями */
.layer.hero{z-index:5; transform:translate3d(calc(var(--mx)*34px), calc(var(--my)*24px),0)}
.layer.near{z-index:6; transform:translate3d(calc(var(--mx)*54px), calc(var(--my)*36px),0)}  /* встречное направление */
```

```js
var scene = document.querySelector('.scene'), target = {x:0,y:0}, cur = {x:0,y:0}, raf = null;
scene.addEventListener('pointermove', function(e){
  var r = scene.getBoundingClientRect();
  target.x = (e.clientX-r.left)/r.width*2-1; target.y = (e.clientY-r.top)/r.height*2-1;
  if (!raf && !reduce) raf = requestAnimationFrame(tick);
});
function tick(){
  cur.x += (target.x-cur.x)*0.12; cur.y += (target.y-cur.y)*0.12;   // lerp 0.12
  scene.style.setProperty('--mx', cur.x.toFixed(3));
  scene.style.setProperty('--my', cur.y.toFixed(3));
  raf = (Math.abs(target.x-cur.x) > 0.001 || Math.abs(target.y-cur.y) > 0.001) ? requestAnimationFrame(tick) : null;
}
```

`will-change` — только на слоях, которые двигаются, и не на весь контейнер. RAF останавливается при простое, при `prefers-reduced-motion: reduce` переменные обнуляются и слои стоят.

## 4. Дисплейсмент по карте высот (WebGL2, без библиотек)

Тот же приём, что делает Blender «для бедных»: плоская текстура + карта высот → сетка с рельефом. Геометрия строится **без вершинных буферов** — позиция выводится из `gl_VertexID`, поэтому нет ни загрузки моделей, ни библиотек.

```glsl
#version 300 es
precision highp float;
uniform mat4 u_mvp; uniform sampler2D u_tex; uniform float u_depth, u_texel, u_n, u_relief, u_lo, u_hi;
out vec2 v_uv; out vec3 v_nrm;
float lum(vec2 uv){ vec3 c = texture(u_tex, uv).rgb; return dot(c, vec3(.2126,.7152,.0722)); }
float height(vec2 uv){ return clamp((lum(uv)-u_lo)/max(u_hi-u_lo,0.001), 0.0, 1.0); }  // диапазон яркости → 0..1
void main(){
  float n = u_n;
  float cell = floor(float(gl_VertexID)/6.0);
  float corner = float(gl_VertexID) - cell*6.0;
  float ox = (corner==1.0||corner==4.0||corner==5.0) ? 1.0 : 0.0;
  float oy = (corner==2.0||corner==3.0||corner==5.0) ? 1.0 : 0.0;
  vec2 uv = (vec2(mod(cell,n)+ox, floor(cell/n)+oy))/n;
  float h = height(uv), hx = height(uv+vec2(u_texel,0.0)), hy = height(uv+vec2(0.0,u_texel));
  v_nrm = normalize(vec3((h-hx)*u_relief, (h-hy)*u_relief, 1.0));   // нормаль из центральных разностей
  v_uv = uv;
  gl_Position = u_mvp * vec4(vec3(uv*2.0-1.0, h*u_depth), 1.0);
}
```

```glsl
#version 300 es
precision highp float;
in vec2 v_uv; in vec3 v_nrm;
uniform sampler2D u_tex; uniform vec3 u_accent, u_light;
out vec4 outColor;
void main(){
  vec3 base = texture(u_tex, v_uv).rgb, nrm = normalize(v_nrm);
  float d = max(dot(nrm, normalize(u_light)), 0.0);
  float rim = pow(1.0 - clamp(nrm.z, 0.0, 1.0), 2.0);
  outColor = vec4(base*(0.34+0.86*d) + u_accent*rim*0.7, 1.0);
}
```

```js
var gl = canvas.getContext('webgl2', {antialias:true, preserveDrawingBuffer:true, alpha:false});
if (!gl || gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) < 1) return fallback();   // vertex texture fetch обязателен
// ... program(gl, VS, FS), uniforms: u_n=128, u_texel=1/texWidth, u_lo=0.03, u_hi=0.42,
//     u_accent=vec3(.482,.769,.659), u_light=vec3(.45,.72,.55), u_depth=0.5, u_relief=46
var verts = 128*128*6;
gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
// матрица: persp(fov 38°, aspect, .1, 100) * translate(0,0,-2.25) * rotateX(ty) * rotateY(tx)
function draw(depth, relief){
  gl.viewport(0,0,canvas.width,canvas.height);
  gl.clearColor(0.051,0.067,0.141,1); gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(u.mvp, false, mvp); gl.uniform1f(u.depth, depth); gl.uniform1f(u.relief, relief);
  gl.drawArrays(gl.TRIANGLES, 0, verts);
}
```

Обязательное:

- **Карта высот — не яркость «как есть».** Нормализуй рабочий диапазон (`u_lo`, `u_hi`): у ночного пейзажа яркость живёт в 0.03–0.42, и без нормализации рельеф получается почти плоским (проверено: диф 0.007 против 0.0225 после нормализации).
- Сила дисплейсмента — 0.4–0.5 при камере на 2.25; больше — силуэт разрывается.
- Кадр рисуй в CSS-размере (не в `devicePixelRatio`): фону хватает, а бюджет пикселей не удваивается.
- `preserveDrawingBuffer:true` нужен только если собираешься читать пиксели (`gl.readPixels`) для замера.
- Фолбэк обязателен и видим: нет `webgl2` или нет vertex texture fetch → canvas 2d с плоской картинкой и надписью «без рельефа».

## Что мерить

Из `references/verify-motion.md`: `readPixels` при `u_depth=0` и `u_depth=0.5` → mean/макс/доля изменённых пикселей (в демо 12.5 % > 12 уровней); `translateZ` из матрицы (`m43`); `rectFront > rectInner` как доказательство перспективы; `backgroundPositionX` на двух кадрах турнтейбла.

## Смежные приёмы

Полноценные 3D-сцены, Gaussian splats и splat-рендер — не этот скилл: см. `vgpu` (пакеты `@vgpu/*`, bake-пайплайн) и `webgpu-landing-effects` (интеграция GPU-слоя в Discovery-лендинг). Параллакс-хореография в видео — `hyperframes-keyframes`.
