#!/usr/bin/env python3
"""Numeric motion QA: frame-to-frame change energy, dead zones, spikes. Stdlib only.
  motion_qa.py in.mp4 [--dead-sec 0.75] [--spike 4.0] [--json]
Stills cannot show timing; this can. It reports facts, you judge intent:
 - dead zones: >= dead-sec of ~zero change (frozen / dead air)
 - spikes: energy > spike x median(nonzero)  (hard cuts, pops, or glitches)
 - last-quarter vs first-quarter energy ratio (does it run out of ideas?)"""
import argparse, json, statistics, subprocess, sys

ap = argparse.ArgumentParser()
ap.add_argument("video")
ap.add_argument("--dead-sec", type=float, default=0.75)
ap.add_argument("--spike", type=float, default=4.0)
ap.add_argument("--eps", type=float, default=0.05, help="mean abs diff (0-255) below which a frame is 'still'")
ap.add_argument("--json", action="store_true")
a = ap.parse_args()

W, H = 64, 36
fps = eval(subprocess.check_output(
    ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
     "-of", "default=nw=1:nk=1", a.video]).decode().strip())
raw = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", a.video, "-vf", f"scale={W}:{H},format=gray",
                      "-f", "rawvideo", "-"], capture_output=True, check=True).stdout
fs = W * H
frames = [raw[i:i + fs] for i in range(0, len(raw) - fs + 1, fs)]
n = len(frames)
if n < 2:
    sys.exit("need >= 2 frames")
e = [sum(abs(x - y) for x, y in zip(frames[i], frames[i + 1])) / fs for i in range(n - 1)]  # e[i]: i -> i+1

dead, run = [], None
for i, v in enumerate(e):
    if v < a.eps:
        run = run or [i, i]; run[1] = i
    elif run:
        dead.append(run); run = None
if run:
    dead.append(run)
min_len = int(round(a.dead_sec * fps))
dead = [(s / fps, (t + 1) / fps) for s, t in dead if (t - s + 1) >= min_len]

nz = [v for v in e if v >= a.eps]
med = statistics.median(nz) if nz else 0.0
spikes = [(round((i + 1) / fps, 3), round(v, 2)) for i, v in enumerate(e) if med and v > a.spike * med]
q = max(1, len(e) // 4)
first, last = statistics.mean(e[:q]), statistics.mean(e[-q:])
res = {"frames": n, "fps": round(fps, 3), "duration_s": round(n / fps, 3),
       "median_active_energy": round(med, 3),
       "dead_zones_s": [(round(s, 2), round(t, 2)) for s, t in dead],
       "spikes_at_s": spikes[:20], "last_vs_first_quarter": round(last / first, 2) if first else None}
if a.json:
    print(json.dumps(res, indent=2))
else:
    bars = " .:-=+*#%@"
    mx = max(e) or 1
    step = max(1, len(e) // 60)
    line = "".join(bars[min(9, int(9 * max(e[i:i + step]) / mx))] for i in range(0, len(e), step))
    print(f"{n} frames @ {fps:.2f}fps = {n / fps:.2f}s | median active energy {med:.2f}")
    print(f"energy: [{line}]")
    print("dead zones:", res["dead_zones_s"] or "none")
    print("spikes (s, energy):", spikes[:10] or "none")
    print("last/first quarter energy:", res["last_vs_first_quarter"])
