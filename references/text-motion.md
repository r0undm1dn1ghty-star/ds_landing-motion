# Текст в движении: 24 контракта (sakura animate-text)

Дистиллят каталога `ayoubix16/sakura-animate-text` (MIT), спеки целиком: `personal_kb/03_information/01_product_management/06_design_skills/sakura-animate-text/assets/specs/*.json`. Каждый контракт — переносимая JSON-спека: цель (per-character/per-word/per-line/whole), вход, выход, swap. Все кривые из нашего канона — сигнатурный easing каталога `cubic-bezier(.22,1,.36,1)` совпадает с токеном проекта.

## Правила текста (из 60fps-канала)

1. **Текст длиннее заголовка не двигается.** Двигаются состояния вокруг него; параграфам — только reveal/fade.
2. **Заголовок получает движение, body-текст нет.** Один текстовый эффект на страницу — cascade эффектов на тексте это вода.
3. **Числа считаются** (count-up/fill), а не появляются готовыми.
4. Всё через WAAPI/CSS `transform`/`opacity`/`filter: blur` — детерминированно, сик через `element.getAnimations().forEach(a => a.currentTime = t)`.
5. Split по словам/буквам — через `aria-label` на целом заголовке и `aria-hidden` на спанах: скринридер читает фразу, а не буквы.
6. `will-change: transform` НЕ вешать на контейнер с масштабируемым текстом — растеризация мылит буквы (гоча sakura).
7. **Буквы в спанах рвут слова при переносе.** Каждая буква — отдельный `inline-block`, и браузер ломает строку между любыми двумя буквами: на узком экране заголовок распадается на «оди/чер». Сначала слово, потом буквы: `<span class="word" style="white-space:nowrap"><span class="ch">о</span>…</span>`, между словами — обычный пробел. Без этого дефект виден только на мобильной ширине и проскакивает приёмку на 1440.
8. **Переносы проверять на настоящем 375–390px.** `chrome --headless --window-size=390` рендерит окно ~504px и показывает несуществующие обрывы: мерить внутри `<iframe style="width:390px">` (scrollWidth против clientWidth) и снимать кадр из этой же обёртки.

## Каталог (точные числа из спек)

| Контракт | Цель | Вход | Стаггер | From → To | Выход | Swap |
|---|---|---|---|---|---|---|
| `blur-out-up` | per-word | 560 | 28 | opacity=0 y=10 blur=6 → opacity=1 y=0 blur=0 | exit 480ms → opacity=0 y=-14 blur=8 | crossfade 170ms |
| `bottom-up-letters` | per-character | 400 | 88 | opacity=0 y=46 → opacity=1 y=0 | exit 280ms → opacity=0 y=-14 | sequential 0ms |
| `depth-parallax-words` | per-word | 700 | 70 | opacity=0 y=18 blur=3 scale=0.92 → opacity=1 y=0 blur=0 scale=1 | exit 500ms → opacity=0 y=-10 blur=2 scale=1.05 | crossfade 180ms |
| `fade-through` | whole | 420 | 0 | opacity=0 y=6 blur=2 scale=0.99 → opacity=1 y=0 blur=0 scale=1 | exit 260ms → opacity=0 y=-4 blur=0 scale=1 | crossfade 20ms |
| `focus-blur-resolve` | whole | 760 | 0 | opacity=0 y=14 blur=14 scale=1.01 → opacity=1 y=0 blur=0 scale=1 | exit 520ms → opacity=0 y=-10 blur=10 scale=1 | crossfade 160ms |
| `kinetic-center-build` | per-word | 360 | 0 | opacity=0 y=6 blur=3.5 scale=0.992 → opacity=1 y=0 blur=0 scale=1 | exit 260ms → opacity=0 y=-6 blur=2.5 | sequential 0ms |
| `line-by-line-slide` | per-line | 900 | 120 | opacity=0 x=-48 → opacity=1 x=0 | exit 600ms → opacity=0 x=48 | crossfade 0ms |
| `mask-reveal-up` | per-line | 760 | 90 | opacity=0 y=30 blur=6 → opacity=1 y=0 blur=0 | exit 520ms → opacity=0 y=-22 blur=6 | crossfade 210ms |
| `micro-scale-fade` | whole | 600 | 0 | opacity=0 scale=0.96 → opacity=1 scale=1 | exit 400ms → opacity=0 scale=0.96 | crossfade 0ms |
| `per-character-rise` | per-character | 700 | 24 | opacity=0 y=32 → opacity=1 y=0 | exit 420ms → opacity=0 y=-24 | crossfade 210ms |
| `per-word-crossfade` | per-word | 700 | 70 | opacity=0 y=8 → opacity=1 y=0 | exit 500ms → opacity=0 y=-6 | crossfade 170ms |
| `scale-down-fade` | whole | 520 | 0 | opacity=0 y=8 scale=1.04 → opacity=1 y=0 scale=1 | exit 380ms → opacity=0 y=-8 scale=0.94 | crossfade 130ms |
| `shared-axis-x` | whole | 500 | 0 | opacity=0 x=24 scale=0.98 → opacity=1 x=0 scale=1 | exit 360ms → opacity=0 x=-20 scale=0.98 | crossfade 120ms |
| `shared-axis-y` | per-word | 180 | 78 | opacity=0 y=0 scale=1 → opacity=1 y=0 scale=1 | exit 140ms → opacity=0 y=0 scale=1 | crossfade 0ms |
| `shared-axis-z` | whole | 520 | 0 | opacity=0 blur=2 scale=0.9 → opacity=1 blur=0 scale=1 | exit 360ms → opacity=0 blur=1 scale=1.06 | crossfade 100ms |
| `shimmer-sweep` | whole | 850 | 0 | opacity=0 x=-22 blur=8 → opacity=1 x=0 blur=0 | exit 650ms → opacity=0 x=22 blur=8 | crossfade 0ms |
| `short-slide-down` | per-word | 520 | 0 | opacity=0 y=-24 blur=2.4 scale=0.992 → opacity=1 y=0 blur=0 scale=1 | exit 320ms → opacity=0 y=10 blur=1.2 scale=1 | sequential 0ms |
| `short-slide-right` | per-word | 520 | 92 | opacity=1 x=-24 blur=1.2 → opacity=1 x=0 blur=0 | exit 320ms → opacity=0 x=12 blur=1 | sequential 0ms |
| `soft-blur-in` | per-character | 900 | 25 | opacity=0 y=16 blur=12 → opacity=1 y=0 blur=0 | exit 600ms → opacity=0 y=-16 blur=12 | crossfade 300ms |
| `spring-scale-in` | per-word | 360 | 95 | opacity=0 scale=0.7 → opacity=1 scale=1 | exit 200ms → opacity=0 scale=0.8 | crossfade 0ms |
| `stagger-from-center` | per-character | 620 | 22 | opacity=0 y=12 blur=3 → opacity=1 y=0 blur=0 | exit 420ms → opacity=0 y=-8 blur=3 | crossfade 150ms |
| `stagger-from-edges` | per-character | 620 | 22 | opacity=0 y=12 blur=3 → opacity=1 y=0 blur=0 | exit 420ms → opacity=0 y=-8 blur=3 | crossfade 150ms |
| `top-down-letters` | per-character | 400 | 88 | opacity=0 y=-46 → opacity=1 y=0 | exit 280ms → opacity=0 y=14 | sequential 0ms |
| `typewriter` | per-character | 240 | 46 | opacity=0 y=0 → opacity=1 y=0 | exit 260ms → opacity=0 y=-4 | crossfade 0ms |

## Как брать

1. Выбрать контракт по задаче (заголовок героя → `per-character-rise` / `mask-reveal-up`; смена состояния → `fade-through` / `shared-axis-*`; выход важнее входа → `blur-out-up` / `scale-down-fade`).
2. Взять спек JSON из KB-пути выше — там же `exit` и `swap`, если нужны.
3. Перевести в WAAPI/CSS с нашими токенами ease; стаггер и длительности не менять «по вкусу» — они выверены.
4. Прогнать через детерминизм-канон (`deterministic-motion.md`): тот же вход — тот же кадр.
5. Для per-character контрактов сразу собрать word-wrapper (правило 7): без него эффект ломает мобильную вёрстку, а на десктопе дефект не виден.
