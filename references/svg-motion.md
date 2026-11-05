# svg-motion — линия, трасса, морфинг, маски

Что показывает каждый приём (без этого не берём):

| Приём | Показывает | Когда НЕ применять |
|---|---|---|
| line-draw | порядок шагов процесса: линия идёт от узла к узлу | на декоративной рамке и «обводке логотипа» — это уже не информация |
| path-tracing по скроллу | что поток непрерывный и длина его зависит от просмотра | если секция короткая: трасса дорисуется раньше, чем её увидят |
| морфинг формы | смену состояния одной сущности (карточка → щит → капля) | если фигуры не связаны смыслом: подмена картинки читается как глюк |
| маски и reveal | границу раскрытия (что именно появляется) | вместо содержательного reveal — просто «красиво проявилось» |

## 1. line-draw: WAAPI, а не `@keyframes`

Анимацию линии делаем через Web Animations API — её можно поставить на нужное время и **проверить** (под headless CSS-клок не идёт, см. `verify-motion.md`).

```html
<svg viewBox="0 0 420 200" class="flow" role="img" aria-label="Поток: сбор данных, правила, отчёт">
  <path class="wire rail" d="M20 168 H400"/>
  <path class="trace" d="M92 96 C120 96 128 168 150 168"/>
  <path class="trace" d="M232 96 C258 96 268 168 292 168"/>
  <rect class="node" x="24" y="66" width="76" height="42" rx="10"/>
  <rect class="node" x="126" y="132" width="112" height="46" rx="10"/>
  <circle class="pulse" cx="396" cy="168" r="4"/>
  <text x="34" y="92">сбор</text>
</svg>
```

```css
.stage svg{display:block; width:100%; height:100%; overflow:visible}
.flow path.trace{fill:none; stroke:var(--accent); stroke-width:2; stroke-linecap:round;
  stroke-dasharray:var(--len,600); stroke-dashoffset:var(--len,600)}
.flow .node{fill:rgba(22,28,48,.9); stroke:var(--line)}
.flow .pulse{fill:var(--accent); opacity:0}
.flow .pulse.on{opacity:1; transition:opacity 400ms var(--ease) 900ms}
html:not(.js) .flow path.trace{stroke-dashoffset:0}        /* без JS линия нарисована: контент не зависит от анимации */
@media (prefers-reduced-motion:reduce){ .flow path.trace{stroke-dashoffset:0} }
```

```js
function drawPaths(stage, reduce){
  var anims = [];
  [].forEach.call(stage.querySelectorAll('path.trace'), function(p){
    var len = Math.ceil(p.getTotalLength()) + 1;           // +1: округление вниз оставляет волосок незакрытым
    p.style.setProperty('--len', len);
    if (reduce) { p.style.strokeDashoffset = '0px'; return; }
    var a = p.animate([{strokeDashoffset: len+'px'}, {strokeDashoffset:'0px'}],
      {duration:1200, easing:'cubic-bezier(.22,1,.36,1)', fill:'both'});
    a.pause();                                            // ждём появления в кадре
    anims.push(a);
  });
  return function(){ anims.forEach(function(a){ a.play(); }); };   // триггер: in-view или кнопка
}
```

`getTotalLength()` возвращает длину один раз на кадр — при `resize` пересчитай. Stagger между коннекторами — 100–140 мс, не больше: длинная лестница читается как медленная загрузка.

**Ловушка, проверенная прогоном:** селектор триггера. Если класс `svg-in` стоит на том же элементе, что `.flow`, то `.svg-in .flow path` не матчится никогда (нужен `.flow.svg-in path`). Симптом — `animation-name: none` при «правильном» CSS; ищется через CDP `CSS.getMatchedStylesForNode`, а не глазами.

## 2. path-tracing по скроллу (`animation-timeline: view()`)

Прогресс привязан к положению секции в окне, JS не нужен:

```css
.stage.flow{overflow:visible; view-timeline-name:--flow}   /* таймлайн на контейнере с настоящим боксом */
@supports (animation-timeline: view()){
  .flow.svg-in path.rail{animation:draw linear both; animation-timeline:--flow;
    animation-range:entry 5% cover 55%}
}
.flow.svg-in path.rail{animation:draw 1200ms var(--ease) forwards}   /* фолбэк без поддержки */
@keyframes draw{to{stroke-dashoffset:0}}
```

Три грабли, каждая стоила прогона:

1. **`<svg>` по умолчанию `overflow:hidden`** — тогда ближайшим скролл-контейнером становится сама `svg`, и `view()` не двигается никогда. Лечится `svg{overflow:visible}` **и** `overflow:visible` на всех скролл-предках.
2. **У горизонтальной линии бокс нулевой высоты** — таймлайн, взятый «по элементу» (`animation-timeline: view()`), схлопывает диапазон. Вешай именованный таймлайн на контейнер секции (`view-timeline-name`), а с пути ссылайся (`animation-timeline:--flow`).
3. Диапазон `entry 5% cover 55%` осмысленен только если секция выше вьюпорта; на мобиле сузь (`entry 10% cover 40%`), иначе трасса дорисовывается за один кадр.

## 3. Морфинг формы

Интерполировать можно только контуры с **одинаковой структурой команд** (те же `M` + 4×`C` + `Z`). Два способа:

```html
<!-- SMIL: работает во всех браузерах, включая отключённый JS-анимационный слой -->
<path class="morph-path" d="M 40,20 C 24,20 20,26 20,42 C 20,94 24,100 40,100
                              C 176,100 180,94 180,42 C 180,26 176,20 160,20 Z"/>
```

```js
var anim = document.createElementNS('http://www.w3.org/2000/svg','animate');
anim.setAttribute('attributeName','d');
anim.setAttribute('dur','560ms');
anim.setAttribute('fill','freeze');
anim.setAttribute('calcMode','spline');
anim.setAttribute('keySplines','.22 1 .36 1');   // ease-out, без bounce
anim.setAttribute('keyTimes','0;1');
path.appendChild(anim);
function morphTo(to){
  anim.setAttribute('from', path.getAttribute('d'));
  anim.setAttribute('to', to);
  anim.setAttribute('begin','indefinite');
  anim.beginElement();                            // SMIL не стартует сам: begin перезапускает анимацию
  anim.setAttribute('from', to);
}
```

```js
// WAAPI: то же самое, проверил в Chrome — computed `d` интерполируется, анимация видна в getAnimations()
path.animate([{d: fromShape}, {d: toShape}], {duration:560, easing:'cubic-bezier(.22,1,.36,1)', fill:'forwards'});
```

Проверено: SMIL меняет отрисованную форму (`getBBox()` 160×80 → 160×94 при том, что в атрибуте остаётся исходный `d` — SMIL анимирует значение, а не атрибут), WAAPI-вариант тоже проходит. Если контуры разной структуры — интерполяция не запустится: приводи оба к одному набору команд или подменяй форму кроссфейдом (200 мс) и признай это честно.

## 4. Маски и reveal

```css
/* per-line reveal: маска строки, движение только transform */
.q-line{display:block; overflow:hidden}
.q-line span{display:block; transform:translateY(100%); transition:transform .6s var(--ease)}
.quote.in .q-line:nth-child(1) span{transform:translateY(0); transition-delay:.1s}
.quote.in .q-line:nth-child(2) span{transform:translateY(0); transition-delay:.25s}
/* reveal картинки снизу */
.reveal{clip-path:inset(0 0 100% 0)}
.reveal.in{clip-path:inset(0 0 0 0); transition:clip-path 900ms var(--ease)}
/* маска градиентом вместо второй картинки */
.veil{-webkit-mask-image:radial-gradient(70% 70% at 50% 40%,#000 55%,transparent 100%);
  mask-image:radial-gradient(70% 70% at 50% 40%,#000 55%,transparent 100%)}
```

`clip-path` и `mask` анимируются в compositor (Chrome/Firefox), но поддерживаются браузерами неравномерно: проверяй кадром, а не «должно работать». Reveal не должен держать контент скрытым: скрывает только класс, который ставит JS, плюс таймаут-фолбэк ~2.5 с (IntersectionObserver не срабатывает для того, что ниже первого экрана, в фоне и в троттлинге).

## Что мерить

`getTotalLength()` по каждому пути; `getComputedStyle(path).strokeDashoffset` до и после сика (`getAnimations().forEach(a => a.finish())`) — в демо `98px → 0px`; `getBBox()` до/после морфинга; `strokeDashoffset` трассы до и после `scrollTo` (**читать с задержкой 300+ мс**: прогресс прокруточного таймлайна пересчитывается в следующем кадре — в демо `381px → 0px`).

## Что не брать из соседей

Обводку-«неон» по контуру, бегущие пунктиры по логотипу и SVG-констелляции с точками-узлами Виктор отклонял как нейросеточность (`discovery-landing-authoring/references/motion-and-parallax.md`, раздел «Отказанная эстетика»). Трасса обязана нести поток, а не украшать заголовок.
