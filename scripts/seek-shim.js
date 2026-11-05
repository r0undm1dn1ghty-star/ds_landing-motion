/* Virtual clock for deterministic frame capture. Load BEFORE any donor script.
 * Forward-only seeking. See references/seams.md for what is / isn't covered. */
(function (g) {
  'use strict';
  var T = 0;                 // virtual time, ms
  var fps = 30;
  var nextId = 1;
  var queue = new Map();     // rAF callbacks
  var EPOCH = 1735689600000; // fixed "now": 2025-01-01T00:00:00Z
  var seed = 123456789;

  function mulberry32() {
    seed = (seed + 0x6D2B79F5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  g.performance.now = function () { return T; };
  Date.now = function () { return EPOCH + T; };
  Math.random = mulberry32;
  g.requestAnimationFrame = function (cb) { var id = nextId++; queue.set(id, cb); return id; };
  g.cancelAnimationFrame = function (id) { queue.delete(id); };

  function flush() {
    var q = queue; queue = new Map();
    q.forEach(function (cb) { cb(T); });
  }
  function syncCss() {
    if (typeof document === 'undefined' || !document.getAnimations) return;
    document.getAnimations().forEach(function (a) { a.pause(); a.currentTime = T; });
  }

  g.__setFps = function (f) { fps = f; };
  g.__setSeed = function (s) { seed = s | 0; };
  g.__now = function () { return T; };
  g.__seek = function (tSec) {
    var target = Math.round(tSec * 1e6) / 1e3;            // ms, 1 ns resolution
    if (target < T - 1e-9) throw new Error('backward seek unsupported: ' + target + ' < ' + T);
    var step = 1000 / fps;
    while (T + step < target - 1e-6) { T += step; flush(); } // substep so delta-based libs integrate
    T = target; flush(); syncCss();
    return T;
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
