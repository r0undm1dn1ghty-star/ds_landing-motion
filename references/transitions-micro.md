# Переходы и микро-взаимодействия: три яруса

Источники: `heymegabyte/claude-skills` (11-motion-and-interaction-system), `iart-ai/web-animation-skills` (page-transition, micro-interaction), `UI-UX-master-skill` (магнитные кнопки, marquee). Дистиллят под канон: только transform/opacity, ease токен `cubic-bezier(.22,1,.36,1)`, reduce обязателен.

## Три яруса (на одном_surface — никогда не смешивать)

| Ярус | Что | Длительность | Реализация |
|---|---|---|---|
| **1. Функциональный** | отклик на каждое действие: hover, focus, press, toggle | 100–200 мс | transform/opacity, `:active{scale(.97)}` |
| **2. Хореографический** | page transition, модалка, reveal секции | 300–500 мс | View Transitions / `@starting-style` / WAAPI |
| **3. Cinematic** | hero-параллакс, сигнатурный reveal, scroll-storytelling | ≥600 мс | scroll-timeline, один на страницу |

Пустое движение = слоп: каждое движение отвечает на одно из трёх — **feedback** (подтвердить действие), **continuity** (сохранить контекст пространства), **delight** (характер бренда). Что не отвечает ни на что — вырезать.

## View Transitions API

- SPA (same-document): `document.startViewTransition(() => updateDOM())`
- MPA (cross-document): `@view-transition { navigation: auto; }`
- На элемент: `view-transition-name: hero-image;` на живущем между состояниями узле
- Поддержка: Chrome 126+, Safari 18+, Firefox 144. Фолбэк честный: нет API — смена состояния мгновенная, без «эмуляции» перехода.
- Настройка через псевдоэлементы: `::view-transition-old(root), ::view-transition-new(root) { animation-duration: .3s; animation-timing-function: cubic-bezier(.4,0,.2,1) }`
- В reduce — переходы отключаются, смена мгновенная.

## Микро-взаимодействия (ярус 1)

- Отклик на жест ≤ 100 мс, иначе ощущение лага.
- Hover: сдвиг/подсветка/масштаб 1.02–1.04, не «дизайн-концепт».
- Press: `scale(.97)` + возврат.
- Toggle/чекбокс: morph состояния, не подмена.
- Toast/появление: вход из `translateY(8px)+opacity`, выход быстрее входа.
- Тач: hover-эффекты не являются носителем информации (на таче их нет) — состояние видно и без них.

## Магнитная кнопка

```css
.btn{transition:transform .18s var(--ease)}
```
```js
// радиус захвата ~120px, смещение до 6px, только fine pointer, не при reduce
btn.addEventListener('pointermove', (e) => {
  if (matchMedia('(pointer:fine)').matches && !reduce) {
    const r = btn.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width/2), dy = e.clientY - (r.top + r.height/2);
    const d = Math.hypot(dx, dy);
    if (d < 120) btn.style.transform = `translate(${dx*.12}px, ${dy*.12}px)`;
    else btn.style.transform = '';
  }
});
btn.addEventListener('pointerleave', () => btn.style.transform = '');
```
Смещение ≤6px и возврат через transition, не пружиной. На тач-устройствах — выключено.

## Marquee (бегущая строка логотипов/тегов)

- Дублировать контент дважды, вторая копия `aria-hidden="true"`.
- Анимация только `transform: translateX(-50%)`, linear, длительность по ширине контента (~20–30 s).
- Один marquee на страницу; пауза вне вьюпорта (`IntersectionObserver`) и при `document.hidden`.
- На reduce — статичный ряд без движения.

## Что брать откуда

- Page transition (SPA/MPA) — этот файл (View Transitions). Next.js App Router + AnimatePresence — паттерн из `iart-ai`, брать идею exit-фикса, не зависимость.
- Магнитные кнопки, marquee — этот файл.
- Всё, что хочет GSAP/Framer для этого — сначала проверить: не делается ли WAAPI/CSS. Тяжеловес — только по запрету №10 (исключение: настоящий GLB-3D).
