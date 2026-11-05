# Настоящий 3D-объект на странице

Источник приёма — набор `frankenstein-animator` (Claude), живой шаблон и его числа проверены в headless Chromium. Здесь — перенос в наш канон.

## Когда это НЕ нарушает запрет на тяжеловесы

В SKILL.md запрет звучит как «не тащить Three.js/GSAP ради того, что делают `preserve-3d`, WAAPI и `stroke-dashoffset`». Настоящая модель — законное исключение: если нужен **реальный GLB с освещением, материалом и вращением**, платформа этого не даёт, и Three.js здесь правильный выбор. Но сначала проверь дешёвый путь:

- нужно только «крутить модель» → хватает веб-компонента `<model-viewer>` (Google; лицензию ветить). Не франкенштейнить то, что делает один тег.
- нужно «объём из плоской картинки» → это `references/object-to-3d.md`, Three.js не нужен вообще.

## Контурный свет: Fresnel как эмиссия

Формула (мощность = толщина кромки):

```
rim = (1 - saturate(n · v))^power * strength
```
где `n` — нормаль, `v` — направление на камеру. Реализация — инъекция в шейдер материала:

```js
mat.onBeforeCompile = (sh) => {
  sh.uniforms.uRimColor = rim.color; sh.uniforms.uRimPower = rim.power; sh.uniforms.uRimStrength = rim.strength;
  sh.fragmentShader = sh.fragmentShader
    .replace('void main() {', 'uniform vec3 uRimColor;\nuniform float uRimPower;\nuniform float uRimStrength;\nvoid main() {')
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n' +
      'float rimF = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), uRimPower);\n' +
      'totalEmissiveRadiance += uRimColor * rimF * uRimStrength;');
};
mat.customProgramCacheKey = () => 'frank-rim';   // обязательно, иначе программа переиспользуется чужой
mat.needsUpdate = true;
```

Рабочие значения: `power 3` (тоньше кромка при большем), `strength 1.6`, `rim` цвета акцента.

**Материалы:** патчатся только `MeshStandardMaterial` (и наследующий `MeshPhysicalMaterial`). `MeshBasicMaterial` и кастомные шейдеры кромку НЕ получат — это ограничение, а не баг.

## Свет: два сзади, один еле-еле спереди

- два цветных `DirectionalLight` СЗАДИ субъекта (в шаблоне: голубой `3.0` слева-сзади, розовый `2.4` справа-сзади);
- слабый белый key спереди (`0.6`);
- `scene.environmentIntensity = 0.25` — студийное отражение приглушено, иначе кромка тонет.

Без двух контровых источников Fresnel нечего подсвечивать: кромка светится тем, что за ней.

## Вписать модель в кадр (нормализация по габариту)

```js
const box = new THREE.Box3().setFromObject(obj);
const size = box.getSize(new THREE.Vector3()).length() || 1;   // диагональ bbox
const center = box.getCenter(new THREE.Vector3());
const k = 2.4 / size;                       // диагональ -> 2.4 условных единицы
obj.scale.multiplyScalar(k);
obj.position.copy(center).multiplyScalar(-k);                  // центрируем в начале координат
```
Формула работает для любой модели — не подгонять масштаб руками под каждый файл.

**Портретный экран** (главная ловушка): горизонтальный FOV сжимается вместе с аспектом, и модель обрезается по бокам. Лечится отводом камеры:
```js
const fit = 4.2 / Math.min(1, camera.aspect);   // D >= 4.2 / min(1, aspect)
controls.maxDistance = Math.max(9, fit * 1.6);
camera.position.setLength(fit);
```
Эти метрики были зелёными, пока модель на телефоне стояла обрезанной — поймал только глаз по скриншоту. Всегда смотреть скриншот мобильной ширины.

## Управление

`OrbitControls`: `enableDamping = true`, `dampingFactor = 0.06`, `enablePan = false`, `minDistance = 2`, `maxDistance = 9`, `autoRotate = true`, `autoRotateSpeed = 1.2`. Автоповорот **замолкает при касании** и возвращается через **3.5 с** покоя — не выключается навсегда и не дёргается под курсором.

Пиксель-рейтио: `Math.min(devicePixelRatio, 2)`. Выше — платишь за пиксели, которых не видно.

## Честно о производительности

Замер в песочнице (софтверный GL, без GPU) дал ~16 с/кадр — **это ничего не говорит о реальном устройстве**. Реальный fps на телефоне и поведение Safari/Firefox остаются НЕПРОВЕРЕННЫМИ, и так и надо писать в отдаче.

## Лицензии — отдельный контур

**Модели и текстуры — это ассеты, и у них своя лицензия.** GLB с Sketchfab под CC-BY требует атрибуции; NC — вообще не для коммерческого использования. Ветить каждый файл отдельно от кода. Безопасный дефолт — процедурная геометрия (`TorusKnotGeometry` и подобное): ничьих прав, ноль вопросов.
