#!/usr/bin/env python3
"""ds_landing-motion — прогон демо с числами.

Что делает: открывает demo/index.html в headless Chrome, читает из страницы узел #probe
(её пишет сам демо-скрипт), повторяет прогон в режимах фолбэка и reduce, снимает кадры,
считает статистику пикселей по областям и контраст токенов, проверяет мобильное
переполнение через iframe-обёртку. Печатает таблицу и гейт приёмки.

Запуск:  python demo/measure.py [--shot-dir DIR] [--json FILE] [--keep]
Требует только stdlib + Pillow (для статистики кадров; без него кадры всё равно снимаются).
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
PAGE = os.path.join(HERE, "index.html")
CHROME_CANDIDATES = [
    os.environ.get("CHROME"),
    r"C:/Program Files/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    r"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    r"C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
]

TOKENS = {
    "bg": "#111524", "card": "#161c30", "ink": "#eef2f9", "body": "#b8c3d6",
    "meta": "#8893a8", "faint": "#7a85a0", "accent": "#7bc4a8",
    "btn": "#1f7a4d", "btn_text": "#f2fbf5",
}


def find_chrome():
    for c in CHROME_CANDIDATES:
        if c and os.path.exists(c):
            return c
    raise SystemExit("chrome/edge не найден; задай CHROME=<путь к exe>")


def run_chrome(chrome, url, out_html, profile, extra=None, budget=9000, size=(1440, 900), to=180):
    cmd = [chrome, "--headless=new", "--no-sandbox", "--user-data-dir=" + profile,
           "--window-size=%d,%d" % size, "--virtual-time-budget=%d" % budget,
           "--allow-file-access-from-files", "--dump-dom", url]
    if extra:
        cmd[1:1] = extra
    t0 = time.time()
    with open(out_html, "w", encoding="utf-8", errors="replace") as fh:
        p = subprocess.run(cmd, stdout=fh, stderr=subprocess.DEVNULL, timeout=to)
    return time.time() - t0, p.returncode


def shot(chrome, url, out_png, profile, size, budget=9000, to=180):
    cmd = [chrome, "--headless=new", "--no-sandbox", "--user-data-dir=" + profile,
           "--window-size=%d,%d" % size, "--virtual-time-budget=%d" % budget,
           "--screenshot=" + out_png.replace("\\", "/"), url]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=to)
    return os.path.exists(out_png) and os.path.getsize(out_png) or 0


def probe_json(html_path):
    txt = open(html_path, encoding="utf-8", errors="replace").read()
    m = re.search(r'<div id="probe"[^>]*>(.*?)</div>', txt, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except Exception as e:
        return {"_parse_error": str(e), "_raw": m.group(1)[:400]}


def dig(d, *keys):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


# ---------- контраст ----------
def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _lum(hexv):
    h = hexv.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b):
    la, lb = _lum(a), _lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return round((hi + 0.05) / (lo + 0.05), 2)


# ---------- кадры ----------
def png_stats(path, rects):
    """общая статистика кадра + статистика по областям секций (CSS-пиксели)"""
    out = {"file": os.path.basename(path), "bytes": os.path.getsize(path)}
    try:
        from PIL import Image, ImageStat
    except Exception:
        out["error"] = "Pillow недоступен — статистика кадра не снята"
        return out
    im = Image.open(path).convert("RGB")
    out["size"] = im.size
    g = im.convert("L")
    stat = ImageStat.Stat(g)
    out["mean"] = round(stat.mean[0], 1)
    out["std"] = round(stat.stddev[0], 1)
    out["nonblank"] = round(sum(1 for p in g.getdata() if p > 8) / (im.size[0] * im.size[1]), 4)
    regions = {}
    for name, r in (rects or {}).items():
        try:
            x, y, w, h = [int(round(v)) for v in r]
            if w < 4 or h < 4 or y + h > im.size[1] or x + w > im.size[0]:
                continue
            crop = g.crop((x, y, x + w, y + h))
            st = ImageStat.Stat(crop)
            regions[name] = {"mean": round(st.mean[0], 1), "std": round(st.stddev[0], 1)}
        except Exception:
            pass
    out["regions"] = regions
    return out


def ink_by_region(path, rects, floor=2.0):
    """Доля пикселей, заметно светлее фона области. Ловит «работает по числам, пусто на экране»:
    позиция спрайта меняется, а пикселей нет. Возвращает {имя: доля%} и список пустых."""
    out, empty = {}, []
    try:
        from PIL import Image
    except Exception:
        return out, empty
    im = Image.open(path).convert("L")
    for name, r in (rects or {}).items():
        try:
            x, y, w, h = [int(round(v)) for v in r]
            if w < 8 or h < 8 or y + h > im.size[1] or x + w > im.size[0]:
                continue
            hist = im.crop((x, y, x + w, y + h)).histogram()
            dark = min(i for i, v in enumerate(hist) if v)
            frac = sum(hist[dark + 26:]) / (w * h) * 100
            out[name] = round(frac, 2)
            if frac < floor:
                empty.append(name)
        except Exception:
            pass
    return out, empty


def mobile_probe(chrome, profile, scratch, shots, page_name="index.html",
                 query="?static=1&final=1&tier=webgl2", shot_name="mobile-390.png"):
    """мобильная раскладка: ширина задаётся iframe, а не --window-size (иначе вьюпорт врёт)"""
    wrap = os.path.join(HERE, "_probe-mobile.html")
    html = """<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>mobile-probe</title>
<style>body{margin:0;background:#111524;color:#eef2f9;font:12px ui-monospace,monospace}
iframe{display:block;width:390px;height:2600px;border:0}</style></head><body>
<div id="out">pending</div>
<iframe id="f" src="__PAGE__"></iframe>
<script>
setTimeout(function(){
  var f=document.getElementById('f'), d=f.contentDocument, wd=f.contentWindow, de=d.documentElement;
  var cw=de.clientWidth;
  var bad=[].slice.call(d.querySelectorAll('*')).filter(function(e){return e.getBoundingClientRect().right>cw+1;})
    .map(function(e){return (e.tagName+'.'+((e.className||'').toString().slice(0,16)))+'→'+Math.round(e.getBoundingClientRect().right);});
  var small=[].slice.call(d.querySelectorAll('p,span,li,td,figcaption,.measure,.what,.why,.cap,.mono,.num,footer')).filter(function(e){
    var fs=parseFloat(wd.getComputedStyle(e).fontSize); return fs>0 && fs<12.5 && e.textContent.trim().length>2;})
    .slice(0,5).map(function(e){return Math.round(parseFloat(wd.getComputedStyle(e).fontSize)*10)/10+'px:'+e.textContent.trim().slice(0,16);});
  document.getElementById('out').textContent='clientW='+cw+' scrollW='+de.scrollWidth+' ovf='+(de.scrollWidth-cw)
    +' innerW='+wd.innerWidth+' offenders='+JSON.stringify(bad.slice(0,5))
    +' smallText='+JSON.stringify(small);
},3600);
</script></body></html>"""
    html = html.replace("__PAGE__", page_name + query)
    with open(wrap, "w", encoding="utf-8") as fh:
        fh.write(html)
    try:
        res = run_chrome(chrome, "file:///" + wrap.replace("\\", "/"), os.path.join(scratch, "mobile.html"),
                         profile, size=(420, 2700), budget=9000)
        txt = open(os.path.join(scratch, "mobile.html"), encoding="utf-8", errors="replace").read()
        m = re.search(r'<div id="out"[^>]*>(.*?)</div>', txt, re.S)
        line = m.group(1).strip() if m else "no-out"
        shot(chrome, "file:///" + wrap.replace("\\", "/"), os.path.join(shots, shot_name),
             profile, (420, 2700))
        return {"probe": line, "seconds": round(res[0], 1)}
    finally:
        try:
            os.remove(wrap)
        except OSError:
            pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shot-dir", default=os.path.join(HERE, "_shots"))
    ap.add_argument("--json", default=None)
    ap.add_argument("--keep", action="store_true")
    ap.add_argument("--budget", type=int, default=9000)
    args = ap.parse_args()

    chrome = find_chrome()
    shots = os.path.abspath(args.shot_dir)
    os.makedirs(shots, exist_ok=True)
    scratch = tempfile.mkdtemp(prefix="dsm-")
    url_base = "file:///" + PAGE.replace("\\", "/")
    print("chrome : %s\npage   : %s\nscratch: %s\n" % (chrome, PAGE, scratch))

    scenarios = [
        ("webgl2", "?static=1&final=1&tier=webgl2"),
        ("canvas2d", "?static=1&final=1&tier=canvas2d"),
        ("reduce", "?static=1&final=1&tier=webgl2&reduce=1"),
        ("default", "?static=1&final=1"),
    ]
    probes = {}
    for name, q in scenarios:
        prof = os.path.join(scratch, "prof-" + name)
        h = os.path.join(scratch, "dom-%s.html" % name)
        sec, rc = run_chrome(chrome, url_base + q, h, prof, budget=args.budget)
        data = probe_json(h)
        probes[name] = data
        print("прогон %-9s %5.1fs rc=%s probe=%s" % (name, sec, rc, "ok" if data and "_parse_error" not in data else "FAIL"))

    main_p = probes.get("webgl2") or {}
    fb_p = probes.get("canvas2d") or {}
    rd_p = probes.get("reduce") or {}
    df_p = probes.get("default") or {}

    rects = dig(main_p, "report", "rects") or {}
    shots_list = []
    if main_p:
        prof = os.path.join(scratch, "prof-shot")
        sh = os.path.join(shots, "desktop-full.png")
        h = dig(main_p, "report", "doc", "scrollH") or 3600
        size = (1440, max(2400, min(int(h) + 40, 7000)))
        n = shot(chrome, url_base + "?static=1&final=1&tier=webgl2", sh, prof, size, budget=args.budget)
        shots_list.append(sh)
        sh2 = os.path.join(shots, "desktop-viewport.png")
        shot(chrome, url_base + "?static=1&final=1&tier=webgl2", sh2, os.path.join(scratch, "prof-shot2"), (1440, 900), budget=args.budget)
        shots_list.append(sh2)
        print("кадры  : %s" % ", ".join("%s (%d B)" % (os.path.basename(s), os.path.getsize(s)) for s in shots_list if os.path.exists(s)))

    px = dig(main_p, "report", "pixel") or {}
    print("\n== DOM / техпаспорт ==")
    vp = dig(main_p, "viewport") or {}
    print("  viewport          : innerW=%s clientW=%s scrollW=%s overflowX=%s offenders=%s" %
          (vp.get("innerW"), vp.get("clientW"), vp.get("scrollW"), vp.get("overflowX"), vp.get("offenders")))
    print("  среда             : reduce=%s fonts=%s checks=%s" % (main_p.get("reduce"), main_p.get("fonts"),
                                                                 json.dumps(main_p.get("checks"), ensure_ascii=False)))
    print("  дисплейсмент      : %s" % json.dumps(dig(main_p, "report", "displace"), ensure_ascii=False))
    print("  печать            : %s" % json.dumps(main_p.get("print"), ensure_ascii=False))
    print("  каскад tier       : default=%s (chain=%s) · canvas2d=%s" % (
        (df_p.get("print") or {}).get("tier"), json.dumps(dig(df_p, "report", "printChain"), ensure_ascii=False),
        (fb_p.get("print") or {}).get("tier")))

    print("\n== доказательства приёмов ==")
    proofs = [
        ("tilt (fake-3D)", "переменные --rx/--ry двигают матрицу: %s · слои z: %s · front>inner (перспектива): %s" % (
            dig(main_p, "report", "tiltProof", "varsDriveTransform"), json.dumps(dig(main_p, "tilt", "num", "layers")),
            (dig(main_p, "tiltAfter", "rectFront") or [0])[0] > (dig(main_p, "tiltAfter", "rectInner") or [0])[0])),
        ("turntable", "кадр 9 vs 21: %s / %s → отличается: %s · кадров %s" % (
            dig(main_p, "report", "ttProof", "frame9"), dig(main_p, "report", "ttProof", "frame21"),
            dig(main_p, "report", "ttProof", "differs"), dig(main_p, "report", "turntable", "frames"))),
        ("svg line-draw", "dashoffset до сика %s → после %s (сикнуто анимаций %s, прокруточных пропущено %s) · пульс %s" % (
            dig(main_p, "svgDrawAfter", "dashAfter"), dig(main_p, "svgSeek", "dash"),
            dig(main_p, "svgSeek", "finished"), dig(main_p, "svgSeek", "scrollDrivenSkipped"), dig(main_p, "svgDrawAfter", "pulse"))),
        ("svg трасса скроллом", "dashoffset до скролла %s → после %s (view()-таймлайн %s)" % (
            dig(main_p, "railDash", "before"), dig(main_p, "railDash", "after"), dig(main_p, "svgDraw", "num", "scrollDriven"))),
        ("морфинг формы", "bbox %s (у исходной карточки 160×80) · SMIL %s · WAAPI d %s" % (
            dig(main_p, "morphAfter", "bbox"), dig(main_p, "morph", "num", "smil"), dig(main_p, "morph", "num", "waapiD"))),
        ("разлёт/сборка", "позы различаются: %s · в сборе %s · в разлёте %s" % (
            dig(main_p, "assemblyProof", "differs"), json.dumps(dig(main_p, "assemblyProof", "assembled")),
            json.dumps(dig(main_p, "assemblyProof", "exploded")))),
        ("hero-объект", "spin %s° → %s° · %s" % (dig(main_p, "orbitProof", "before"), dig(main_p, "orbitProof", "after"),
                                                 dig(main_p, "orbitProof", "transform"))),
        ("частицы", "%s · %s шт · покрытие кадра %s" % (
            dig(main_p, "particles", "tier"), dig(main_p, "particles", "count"), dig(main_p, "particles", "coverage"))),
        ("reduce-ветка", "reduce=%s · трансформ панели %s · dashoffset трассы %s" % (
            rd_p.get("reduce"), dig(rd_p, "report", "tiltProof", "applied"), dig(rd_p, "svgSeek", "dash"))),
    ]
    for k, v in proofs:
        print("  %-20s: %s" % (k, v))

    print("\n== пиксель-замеры GPU (readPixels) ==")
    print("  дисплейсмент плоско/рельеф: mean %s → %s · diff %s" % (
        px.get("dispFlat"), px.get("dispRelief"), json.dumps(px.get("dispDiff"), ensure_ascii=False)))
    print("  halftone  : %s" % json.dumps(px.get("printHalftone"), ensure_ascii=False))
    print("  дизеринг  : %s" % json.dumps(px.get("printDither"), ensure_ascii=False))
    print("  зерно     : %s" % json.dumps(px.get("printGrain"), ensure_ascii=False))
    print("  halftone vs дизеринг: %s" % json.dumps(px.get("printModeDiff"), ensure_ascii=False))

    print("\n== кадры (PNG) ==")
    stats = []
    for s in shots_list:
        if os.path.exists(s):
            st = png_stats(s, rects)
            stats.append(st)
            print("  %-22s %sB %s px mean %s std %s непусто %s" % (
                st["file"], st["bytes"], st.get("size"), st.get("mean"), st.get("std"), st.get("nonblank")))
            for name, r in (st.get("regions") or {}).items():
                print("      область %-10s mean %-6s std %s" % (name, r["mean"], r["std"]))

    full_shot = os.path.join(shots, "desktop-full.png")
    ink, empty_blocks = ink_by_region(full_shot, rects, floor=2.0)
    if ink:
        print("\n== видимость блоков (доля пикселей выше фона) ==")
        for name, frac in sorted(ink.items(), key=lambda kv: kv[1]):
            print("  %-11s %6.2f%% %s" % (name, frac, "  ПУСТО" if frac < 2.0 else ""))
        print("  пустых блоков: %d%s" % (len(empty_blocks), (" — " + ", ".join(empty_blocks)) if empty_blocks else ""))

    print("\n== контраст токенов (WCAG) ==")
    pairs = [("ink на bg", TOKENS["ink"], TOKENS["bg"]), ("body на bg", TOKENS["body"], TOKENS["bg"]),
             ("meta на bg", TOKENS["meta"], TOKENS["bg"]), ("faint на bg", TOKENS["faint"], TOKENS["bg"]),
             ("accent на bg", TOKENS["accent"], TOKENS["bg"]), ("текст кнопки на btn", TOKENS["btn_text"], TOKENS["btn"]),
             ("body на card", TOKENS["body"], TOKENS["card"])]
    for label, a, b in pairs:
        print("  %-20s %5.2f:1%s" % (label, contrast(a, b), "  <4.5:1 — только линии/декор" if contrast(a, b) < 4.5 else ""))

    mob = mobile_probe(chrome, os.path.join(scratch, "prof-mobile"), scratch, shots)
    print("\n== мобильная проба (iframe 390) ==")
    print("  основное : %s" % mob["probe"])
    shots_list.append(os.path.join(shots, "mobile-390.png"))

    hr = dig(main_p, "report", "hair") or {}
    if hr:
        print("\n== приёмы 10-13 на самом лендинге ==")
        print("  контуры   : слоёв %s · уровней %s · сетка %s · сегментов %s · сборка %s мс" % (
            hr.get("layers"), hr.get("levels"), hr.get("grid"), hr.get("segments"), hr.get("buildMs")))
        print("  хайрлайн  : штрих %s (%s) · dpr %s · вылет слоя %s" % (
            hr.get("strokeWidthCss"), hr.get("vectorEffect"), hr.get("dpr"), json.dumps(hr.get("bleed"))))
        print("  параллакс : %s · растёт по глубине: %s" % (json.dumps(hr.get("offsets")), hr.get("monotonic")))
        print("  гравировка: %s" % json.dumps(dig(main_p, "report", "engrave"), ensure_ascii=False))
        print("  кадр A    : %s" % json.dumps(dig(main_p, "report", "scrub"), ensure_ascii=False))
        print("  кадр B    : %s" % json.dumps(dig(df_p, "report", "scrub"), ensure_ascii=False))
        print("  ритм      : %s" % json.dumps(dig(main_p, "report", "qa"), ensure_ascii=False))

    # ---------- гейт ----------
    checks = {
        "проба читается": bool(main_p) and "_parse_error" not in main_p,
        "нет переполнения по X": vp.get("overflowX") == 0 and not vp.get("offenders"),
        "дисплейсмент: рельеф меняет пиксели": bool(px.get("dispDiff")) and px["dispDiff"].get("changedFrac", 0) > 0.01,
        "печать: три режима дают разные кадры": bool(px.get("printModeDiff")) and px["printModeDiff"].get("changedFrac", 0) > 0.05,
        "line-draw доходит до нуля": dig(main_p, "svgSeek", "dash") == "0px",
        "трасса скроллом двигается": dig(main_p, "railDash", "before") != dig(main_p, "railDash", "after"),
        "морфинг меняет форму": dig(main_p, "morphAfter", "bbox") != [160, 80],
        "разлёт меняет позы": dig(main_p, "assemblyProof", "differs") is True,
        "поворот доходит до грани": dig(main_p, "orbitProof", "after") != dig(main_p, "orbitProof", "before"),
        "спрайт-лист шагает": dig(main_p, "report", "ttProof", "differs") is True,
        "переменные двигают панель": dig(main_p, "report", "tiltProof", "varsDriveTransform") is True,
        "фолбэк canvas2d поднимается": (fb_p.get("print") or {}).get("tier") == "canvas 2d",
        "reduce-ветка отдаёт финал": dig(rd_p, "report", "tiltProof", "applied") in ("none", "matrix(1, 0, 0, 1, 0, 0)"),
        "кадр снят": any(s.get("bytes", 0) > 20000 for s in stats),
        "мобильная проба снята": "ovf=0" in mob["probe"],
        # --- приёмы 10-13 на самом лендинге ---
        "10: контуры нарисованы": (dig(main_p, "report", "hair", "segments") or 0) > 1000,
        "10: штрих не масштабируется": dig(main_p, "report", "hair", "vectorEffect") == "non-scaling-stroke",
        "10: параллакс растёт по глубине": dig(main_p, "report", "hair", "monotonic") is True,
        "10: слой вылетает за вьюпорт": (dig(main_p, "report", "hair", "bleed", "leftDelta") or 0) <= -10,
        "11: гравировка считает линии": (dig(main_p, "report", "engrave", "segments") or 0) > 100,
        "12: кадр равен сам себе": dig(main_p, "report", "scrub", "sameFrameEqual") is True,
        "12: кадр отличается от соседнего": dig(main_p, "report", "scrub", "differsFromOther") is True,
        "12: кадр совпал между запусками": bool(dig(main_p, "report", "scrub", "h1")) and
            dig(main_p, "report", "scrub", "h1") == dig(df_p, "report", "scrub", "h1"),
        "13: прибор ритма отдаёт числа": (dig(main_p, "report", "qa", "median") or 0) > 0 and
            (dig(main_p, "report", "qa", "window") or 0) >= 60,
        "10-13: кадр секции снят": any(s.get("bytes", 0) > 20000 for s in stats if os.path.basename(s.get("file", "")) == "desktop-full.png"),
        "ни один блок не пустой": not empty_blocks,
    }
    print("\n== гейт приёмки ==")
    for k, v in checks.items():
        print("  [%s] %s" % ("ok" if v else "!!", k))
    bad = [k for k, v in checks.items() if not v]
    print("  ГЕЙТ: %s%s" % ("пройден" if not bad else "НЕ пройден: " + ", ".join(bad), ""))

    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"probes": probes, "shots": stats, "mobile": mob, "checks": checks,
                       "contrast": {label: contrast(a, b) for label, a, b in pairs},
                       "ink": ink, "emptyBlocks": empty_blocks}, fh, ensure_ascii=False, indent=1)
        print("json   : %s" % args.json)
    if not args.keep:
        for f in os.listdir(scratch):
            p = os.path.join(scratch, f)
            try:
                os.remove(p) if os.path.isfile(p) else None
            except OSError:
                pass
    print("кадры  : %s" % shots)
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
