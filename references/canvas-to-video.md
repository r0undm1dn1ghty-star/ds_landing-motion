# Живая canvas-анимация → MP4/GIF (Telegram-луп)

Когда владелец смотрит анимированный артефакт и просит «сделай такую же гифку в телегу»: экспортировать НАДО ту же самую сцену, а не пересобирать её (см. SKILL.md, «Принятие задачи» п.4). Пайплайн — снять кадры детерминированно → собрать ffmpeg.

## 1. Сцена из кадра-функции

Одна переменная — время `t` в секундах, период лупа `P`. Никакого `Math.random`, никакого накопления по кадрам: `render(t)` обязана давать одинаковый кадр на одинаковом `t`.

Замыкание лупа без хвостов: всё время внутри — через фазу `ph = 2*PI*(t/P)`, все смещения шума через `sin(ph)`, а события (волна, вспышка) стартуют в `t=0` и гаснут ровно к `t=P` степенью (`Math.pow(1-u, 1.6)`). Тогда последний кадр сходится с первым по смыслу, а не по совпадению.

Внешние точки входа в страницу:

```js
window.__renderAt = function(t){ render(t) };   // ручной рендер кадра
window.__period = P;
var FIX = q.has('t') ? parseFloat(q.get('t')) : null;   // ?t=2.4 — статичный кадр
```

Режим `?t=` рисует кадр синхронно на загрузке. Это самый надёжный способ съёмки: не надо ждать rAF и не надо полагаться на то, что `window.__renderAt` уже определён.

## 2. Съёмка кадров

Канвас живёт в CSS-размере страницы, а `--screenshot` и `capture_screenshot()` отдают ВЬЮПОРТ. Пока они не совпадают, кадр получается неправильной пропорции (например 780×1688 вместо 2:3) — обложка перестаёт быть обложкой.

Рабочая связка (browser_exec):

```python
BASE='file:///.../index.html?fixed=1&t=%.3f'   # fixed=1 → канвас 1080x1620 независимо от layout
for i in range(N):
    goto_url(BASE % (i*P/N))
    time.sleep(0.30)
    cdp('Emulation.setDeviceMetricsOverride', width=1080, height=1620,
        deviceScaleFactor=1, mobile=False)      # override сбрасывается НАВИГАЦИЕЙ — ставить каждый раз
    js('window.dispatchEvent(new Event("resize"))')
    time.sleep(0.15)
    shutil.copy(capture_screenshot(), f'frames/f_{i:03d}.png')
```

Числа, проверенные на 1080×1620: 30 кадров ≈ 50–60 s, то есть ~1.8 s на кадр. 60 кадров — двумя батчами в пределах таймаута одного вызова.

Что НЕ делать:
- `chrome --headless --screenshot` в цикле через терминал — 60 запусков хрома упираются в таймаут и оставляют пустую папку.
- Ставить `Emulation.setDeviceMetricsOverride` один раз до навигации — следующий `goto_url` его сбрасывает, и все кадры после первого выходят другого размера.
- Полагаться на `window.__renderAt` сразу после `goto_url`: проверка `typeof` в первый момент отдаёт `undefined` — страница ещё грузится. Ждать load или идти через `?t=`.

## 3. Приёмка кадров ДО сборки

```python
from PIL import Image, ImageChops, ImageStat
sizes = {Image.open(p).size for p in frames}          # один размер на все кадры
uniq  = len({hashlib.md5(open(p,'rb').read()).hexdigest() for p in frames})  # uniq == N → анимация реально нарисовалась
seam  = ImageStat.Stat(ImageChops.difference(L(frames[-1]), L(frames[0]))).mean[0]  # шов лупа
step  = ImageStat.Stat(ImageChops.difference(L(frames[0]),  L(frames[1]))).mean[0]
```

`seam` в пределах 2–4 при `step` 1–2 — норма (мягкий переход). `uniq < N` означает, что часть кадров повторилась: сцена не зависит от `t` или съёмка сняла один и тот же кэш.

Текст в кадре проверять отдельно: яркие пиксели в зоне заголовка (`v > 140`) — 8–10 тыс. на кегле ~100 px. Ноль = типографика не отрендерилась (шрифт не загрузился).

### Структура постера без vision: полосы, ось, цвет

Когда глаза недоступны (vision отдаёт 401 / не принимает картинку), постер проверяется тремя числами — и эти числа ловят то, что не ловит ни один автогейт:

```python
im = Image.open(frame).convert('L'); W,H = im.size; px = im.load()
bands = [y for y in range(0,H,8) if sum(1 for x in range(0,W,3) if px[x,y] > 130) > 3]  # полосы текста
xs = [x for y in range(0,H,4) for x in range(0,W,2) if px[x,y] > 130]                  # bbox по X
```

- **Полосы = тип кадра.** Обложка/постер даёт 4–6 полос (автор, строки названия, смысл, дата); десятки полос = в кадр попала страница/лендинг, а не обложка (симптом «ты показываешь мне лендинг»).
- **Ось = центровка.** `(min(xs)+max(xs))//2` должно совпадать с `W//2` в пределах ±3 px. Расхождение >10 px = центровка не сработала (flex внутри grid-яруса забыл `align-items:center` или `text-align`).
- **Смена цвета — счётом пикселей, а не на глаз:** `sum(1 for c in region if all(abs(c[i]-t[i])<=14 for i in range(3)))` для целевого HEX. Тысячи пикселей = цвет применился; ноль = правка не дошла до рендера.

Любая правка CSS (вес, цвет, порядок блоков) требует ПЕРЕСЪЁМКИ всех кадров и пересборки: `rm frames/*.png` перед батчем. Иначе в ролик попадает смесь старой и новой версии — и это видно как «прыжок» на одном кадре лупа.

## 4. Сборка

```bash
# MP4 — основной формат для TG: автоплей, без звука, в разы легче гифки
ffmpeg -y -v error -framerate 10 -i frames/f_%03d.png \
  -vf "scale=720:1080:flags=lanczos" -c:v libx264 -pix_fmt yuv420p \
  -crf 20 -movflags +faststart out.mp4

# GIF — запас, только sierra2_4a (Bayer грязнит тёмное)
ffmpeg -y -v error -i out.mp4 -vf \
  "fps=10,scale=480:720:flags=lanczos,split[a][b];[a]palettegen=max_colors=192:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" out.gif
```

**FPS — это скорость, а не только плавность.** Кадры сняты по дизайн-времени (`t = i*P/N`). Если гнать 60 кадров периода 6 s со `-framerate 15`, ролик длится 4 s и вся сцена идёт в 1.5× быстрее задуманного. FPS = N/P: 60 кадров на 6 s = 10 fps. Проверять `ffprobe ... -show_entries stream=duration` — должно совпасть с `P`.

Ориентиры веса на тёмной дымке с зерном: 720×1080 / 6 s / 10 fps / crf 20 ≈ 0.5 МБ (MP4), 480×720 / 192 цвета ≈ 6 МБ (GIF). Оба влезают в Telegram; отдавать пару `MEDIA:` строк и в тексте рекомендовать MP4.

## 5. Проверка после сборки

```bash
ffprobe -v error -select_streams v:0 -show_entries stream=width,height,r_frame_rate,duration -of csv=p=0 out.mp4
python -c "from PIL import Image; im=Image.open('out.gif'); print(im.size, getattr(im,'n_frames',1))"
```

Ожидание: размер и длительность совпадают с задуманным, число кадров GIF = N. Расхождение по длительности — ошибка fps (см. выше), а не «ffmpeg глючит».
