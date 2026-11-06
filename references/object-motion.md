# object-motion — разлёт, сборка, вращение, смена ракурса, hero-объект

Моушн объектов, а не страницы: предмет разбирается, собирается, вращается и доводит до нужной стороны. Каждый приём отвечает на вопрос «что читатель узнаёт из движения».

| Приём | Показывает | Когда НЕ надо |
|---|---|---|
| разлёт/сборка | из чего состоит решение: шесть узлов в сборе читаются как одно тело | когда узлы — просто список: разлёт декоративен |
| взрыв-схема с коннекторами | структуру и порядок сборки (что к чему крепится) | если связей нет и линии придётся «дорисовывать» |
| вращение объекта | что предмет можно осмотреть со всех сторон | для плоского логотипа и иконки |
| смена ракурса как навигация | четыре стороны одного решения: состав / цена / срок / границы | если сторон больше четырёх — лучше табы |
| hero-объект | главный аргумент страницы в одном объекте | если объект не несёт аргумента: получится «украшение в центре» |

## 1. Разлёт и сборка

Позы задаются состоянием (класс), а не JS-циклом: замер, откат и reduced-motion получаются бесплатно.

```html
<div class="stage" id="s-asm">
  <span class="assembly-note">сборка</span>
  <div class="assembly">
    <div class="part" data-p="1"><span class="k">модель</span><i class="h a"></i></div>
    <div class="part" data-p="2"><span class="k">правила</span><i class="h"></i></div>
    <div class="part" data-p="3"><span class="k">данные</span><i class="h"></i></div>
    <div class="part" data-p="4"><span class="k">память</span><i class="h"></i></div>
    <div class="part" data-p="5"><span class="k">инструменты</span><i class="h a"></i></div>
    <div class="part" data-p="6"><span class="k">отчёт</span><i class="h"></i></div>
  </div>
</div>
<div class="ctl">
  <button data-state="exploded">Разобрать</button>
  <button data-state="assembled" aria-pressed="true">Собрать</button>
</div>
```

```css
.assembly{display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; padding:16px; height:100%}
.part{border:1px solid var(--line); border-radius:var(--r-sm); background:rgba(255,255,255,.035);
  transition:transform 520ms cubic-bezier(.16,1,.3,1), opacity 520ms var(--ease); will-change:transform}
.exploded .part[data-p="1"]{transform:translate(-46px,-34px) rotate(-7deg)}
.exploded .part[data-p="2"]{transform:translate(0,-52px)}
.exploded .part[data-p="3"]{transform:translate(46px,-34px) rotate(7deg)}
.exploded .part[data-p="4"]{transform:translate(-46px,34px) rotate(7deg)}
.exploded .part[data-p="5"]{transform:translate(0,52px)}
.exploded .part[data-p="6"]{transform:translate(46px,34px) rotate(-7deg)}
@media (prefers-reduced-motion:reduce){ .part{transition:none} }
```

Правила: смещения симметричны относительно центра (глаз читает «разъехались от одного тела»), поворот 5–8° — не 20°, иначе части выглядят упавшими; длительность 480–560 мс, easing `cubic-bezier(.16,1,.3,1)`; stagger не нужен — все части расходятся одновременно, это одно тело. Взрыв-схема с коннекторами: линии-волосинки рисуются на самих узлах (`border` или отдельные SVG-хайрлайны), а не подписью «соединяется с».

Контрольные состояния: подпись (`сборка`/`разлёт`) меняется вместе с позой — иначе состояние читается только по памяти.

## 2. Вращение и смена ракурса (hero-объект)

Четыре грани = четыре тезиса. Поворот — это переход между разделами, поэтому он заканчивается **точно на грани**, а не «примерно у 90°».

```html
<div class="stage orbit" id="s-orbit">
  <div class="orbit-stage">
    <div class="orbit-axis"></div>
    <div class="orbit-body">
      <div class="face f1">что внутри<br>6 узлов</div>
      <div class="face f2">цена<br>по запросу</div>
      <div class="face f3">срок<br>5–9 дней</div>
      <div class="face f4">чего не делает<br>не пишет первым</div>
    </div>
  </div>
</div>
```

```css
.stage.orbit{perspective:1000px; display:grid; place-items:center; touch-action:none}
.orbit-stage{position:relative; width:210px; height:210px; transform-style:preserve-3d;
  transform:rotateX(var(--ox,-14deg)) rotateY(var(--oy,22deg))}
.orbit-body{position:absolute; inset:0; transform-style:preserve-3d; transform:rotateY(calc(var(--spin,0) * 1deg))}
.face{position:absolute; left:50%; top:50%; width:118px; height:118px; margin:-59px 0 0 -59px;
  border:1px solid var(--line); border-radius:var(--r-sm); display:grid; place-items:center; text-align:center}
.face.f1{transform:rotateY(0deg)   translateZ(59px)}   /* 59px = половина ширины грани: грани смыкаются в призму */
.face.f2{transform:rotateY(90deg)  translateZ(59px)}
.face.f3{transform:rotateY(180deg) translateZ(59px)}
.face.f4{transform:rotateY(270deg) translateZ(59px)}
```

```js
var spin = 22, target = 22, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
function apply(){ body.style.setProperty('--spin', spin); }
function rotateTo(deg, dur){
  if (reduce) { spin = deg; apply(); return; }
  var from = spin, t0 = performance.now();
  (function step(now){
    var p = Math.min(1, (now - t0)/dur);
    spin = from + (deg - from) * (1 - Math.pow(1 - p, 4));   // ease-out-quart, никакой пружины
    apply();
    if (p < 1) requestAnimationFrame(step);
  })(performance.now());
}
[].forEach.call(document.querySelectorAll('[data-face]'), function(b){
  b.addEventListener('click', function(){
    var f = +b.getAttribute('data-face') * 90;
    while (f < spin) f += 360;                     // всегда вперёд: назад читается как отмена
    rotateTo(f, 620);
  });
});
// перетаскивание мышью — свободное вращение, без инерции: предмет на странице, а не в игре
```

Ключевые числа: `perspective` 900–1100px, грани 110–140px, `translateZ` = половина грани; смещение оси `rotateX(-14deg)` — иначе сцена читается как плоская; длительность довода 600–650 мс (маркетинговый уровень, не UI-уровень). Обратный путь (`while (f < spin) f += 360`) гарантирует вращение в одну сторону — «откат назад» читается как ошибка.

## 3. Хореография hero-объекта

Порядок: (1) появление — `scale(.96)` + `opacity:0`, 240 мс ease-out (не `scale(0)`); (2) пауза 150–250 мс, чтобы финальное состояние успели прочитать; (3) реакция на курсор — только внутри `@media (hover:hover) and (pointer:fine)`; (4) в reduce — сразу финальная поза, объект на грани 0.

```css
.hero-obj{opacity:1; transform:none; transition:opacity 240ms var(--ease), transform 240ms var(--ease)}
@starting-style{ .hero-obj{opacity:0; transform:scale(.96)} }   /* вход без JS */
@media (prefers-reduced-motion:reduce){ .hero-obj{transition:none; transform:none; opacity:1} }
```

Момент движения — один на секцию. Если на странице есть hero-объект, остальные секции не получают такой же entrance: одно движение на систему.

## Что мерить

Позы разлёта и сбора как числа `{dx, dy, rot}` из `matrix(a,b,c,d,e,f)`; **читать с `el.style.transition='none'`** — иначе переход вернёт стартовую позу (под headless клок анимаций не идёт). Поворот: состояние `spin` до/после и `getComputedStyle(body).transform` = `matrix3d(...)`. В демо: `spin 22° → 90°`, матрица меняется, позы «в сборе» `[{0,0,0},…]` против «в разлёте» `[{-46,-34,-7},{0,-52,0},{46,-34,7}]`.
