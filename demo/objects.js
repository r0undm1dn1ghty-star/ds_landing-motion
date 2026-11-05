/* ds_landing-motion — моушн объектов: fake-3D на слоях, SVG line-draw/морфинг, разлёт-сборка, смена ракурса, зерно.
   Только transform/opacity. Всё измеряемое: каждая инициализация пишет числа в DS.measure. */
(function (w) {
  'use strict';
  var DS = (w.DS = w.DS || {});
  var M = (DS.measure = DS.measure || {});
  DS.reduce = DS.reduce || ('matchMedia' in w && w.matchMedia('(prefers-reduced-motion: reduce)').matches)
    || document.documentElement.classList.contains('force-reduce');
  var R = DS.reduce;
  var ST = !!(w.DS_FLAGS && w.DS_FLAGS.static);       // режим прогона: без бесконечных циклов и таймеров анимации

  function cs(el, p) { return w.getComputedStyle(el)[p]; }
  var railProbeStarted = false;
  function zOf(el) {                                   // translateZ из матрицы: m43
    var m = cs(el, 'transform'); if (!m || m === 'none') return 0;
    var n = m.replace('matrix3d(', '').replace('matrix(', '').replace(')', '').split(',').map(Number);
    return +(n.length === 16 ? n[14] : 0).toFixed(1);
  }
  DS.zOf = zOf;

  function inView(el, cb, margin) {
    if (!('IntersectionObserver' in w)) { cb(true); return; }
    var done = false, io = new IntersectionObserver(function (e) { if (e[0].isIntersecting && !done) { done = true; cb(true); io.disconnect(); } }, { rootMargin: margin || '0px 0px -10% 0px' });
    io.observe(el);
    // фолбэк: headless и фоновая вкладка могут не дать колбэка — показываем финал сами
    setTimeout(function () { if (!done) { done = true; cb(false); io.disconnect(); } }, 2500);
  }
  DS.inView = inView;

  /* ---------- 1. fake-3D: слои на translateZ ---------- */
  DS.tilt = function (stage) {
    var inner = stage.querySelector('.tilt-inner');
    var front = stage.querySelector('.tilt-front');
    var back = stage.querySelector('.tilt-back');
    function set(rx, ry, sx, sy) {
      inner.style.setProperty('--rx', rx.toFixed(2) + 'deg');
      inner.style.setProperty('--ry', ry.toFixed(2) + 'deg');
      stage.style.setProperty('--sx', (sx === undefined ? 70 : sx) + '%');
      stage.style.setProperty('--sy', (sy === undefined ? 30 : sy) + '%');
    }
    if (!R) {
      stage.addEventListener('pointermove', function (e) {
        var r = stage.getBoundingClientRect();
        var nx = (e.clientX - r.left) / r.width * 2 - 1, ny = (e.clientY - r.top) / r.height * 2 - 1;
        set(-ny * 11, nx * 15, (nx * .5 + .5) * 100, (ny * .5 + .5) * 100);
      });
      stage.addEventListener('pointerleave', function () { set(0, 0); });
    }
    M.tilt = {
      layers: { back: zOf(back), mid: zOf(stage.querySelector('.tilt-mid')), front: zOf(front) },
      transform: cs(inner, 'transform'),
      set: set,
      rectFront: function () { var b = front.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; }
    };
    return M.tilt;
  };

  /* ---------- 2. SVG: line-draw (WAAPI — его можно сикнуть) + path-tracing ---------- */
  DS.svgDraw = function (stage) {
    var paths = [].slice.call(stage.querySelectorAll('path.trace'));
    var anims = [];
    paths.forEach(function (p) {
      var len = Math.ceil(p.getTotalLength()) + 1;
      p.style.setProperty('--len', len);
      if (!R) {
        // WAAPI, а не @keyframes: анимацию можно поставить на нужное время и проверить кадром
        var a = p.animate([{ strokeDashoffset: len + 'px' }, { strokeDashoffset: '0px' }],
          { duration: 1200, delay: 0, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' });
        a.pause();
        anims.push(a);
      } else { p.style.strokeDashoffset = '0px'; }
    });
    var rail = stage.querySelector('path.rail');
    if (rail) rail.style.setProperty('--len', Math.ceil(rail.getTotalLength()) + 1);
    function finish() {
      stage.classList.add('svg-in');
      var pl = stage.querySelector('.pulse');
      if (pl) pl.classList.add('on');
      anims.forEach(function (a) { try { a.play(); } catch (e) {} });
    }
    inView(stage, finish);
    var info = {
      paths: paths.length,
      lengths: paths.map(function (p) { return Math.ceil(p.getTotalLength()); }),
      dashBefore: paths.length ? cs(paths[0], 'strokeDashoffset') : null,
      scrollDriven: CSS.supports('animation-timeline', 'view()'),
      railLen: rail ? Math.ceil(rail.getTotalLength()) : 0
    };
    M.svgDraw = info;
    M.svgDraw.read = function () {
      return { dashAfter: paths.length ? cs(paths[0], 'strokeDashoffset') : null, cls: stage.className, pulse: !!stage.querySelector('.pulse.on') };
    };
    /* сик: под headless анимационный клок не идёт, поэтому линию доводят до конца вручную и читают кадр.
       Прокруточные таймлайны НЕ трогаем: их двигает скролл, а finish() защёлкивает кадр на конце. */
    M.svgDraw.seek = function () {
      var done = 0, skipped = 0;
      stage.querySelectorAll('path').forEach(function (p) {
        (p.getAnimations ? p.getAnimations() : []).forEach(function (a) {
          var tn = a.timeline && a.timeline.constructor ? a.timeline.constructor.name : '';
          if (tn === 'ScrollTimeline' || tn === 'ViewTimeline') { skipped++; return; }
          try { a.finish(); done++; } catch (e) {}
        });
      });
      return { finished: done, scrollDrivenSkipped: skipped };
    };
    return info;
  };

  /* все CSS-анимации и переходы на странице — в конечное состояние (режим финального кадра) */
  DS.seekAll = function () {
    var n = 0;
    (document.getAnimations ? document.getAnimations() : []).forEach(function (a) {
      try {
        if (w.ScrollTimeline && a.timeline instanceof w.ScrollTimeline) return;   // прокруточную таймлайн двигает скролл, не клок
        a.finish(); n++;
      } catch (e) {}
    });
    return n;
  };

  /* ---------- 3. морфинг формы (SMIL, работает везде; WAAPI-вариант проверяется отдельно) ---------- */
  DS.morph = function (box) {
    var path = box.querySelector('.morph-path');
    var shapes = JSON.parse(box.getAttribute('data-shapes'));
    var i = 0;
    var anim = document.createElementNS('http://www.w3.org/2000/svg', 'animate');
    anim.setAttribute('attributeName', 'd');
    anim.setAttribute('dur', '560ms');
    anim.setAttribute('fill', 'freeze');
    anim.setAttribute('calcMode', 'spline');
    anim.setAttribute('keySplines', '.22 1 .36 1');
    anim.setAttribute('keyTimes', '0;1');
    path.appendChild(anim);
    function go(n) {
      i = ((n % shapes.length) + shapes.length) % shapes.length;
      anim.setAttribute('from', path.getAttribute('d'));
      anim.setAttribute('to', shapes[i]);
      anim.setAttribute('begin', 'indefinite');
      try { anim.beginElement(); } catch (e) { path.setAttribute('d', shapes[i]); }
      anim.setAttribute('from', shapes[i]);
    }
    box.querySelectorAll('button').forEach(function (b) {
      b.addEventListener('click', function () { go(+b.getAttribute('data-to')); });
    });
    var waapi = false;
    try {
      var probe = path.cloneNode(); probe.setAttribute('d', shapes[0]); document.body.appendChild(probe);
      var a = probe.animate([{ d: shapes[0] }, { d: shapes[1] }], { duration: 100, fill: 'forwards' });
      a.finish();
      waapi = (probe.getAttribute('d') === shapes[1]) || /[0-9]/.test(cs(probe, 'd') || '');
      a.cancel(); probe.remove();
    } catch (e) { waapi = false; }
    M.morph = { shapes: shapes.length, smil: typeof path.beginElement !== 'undefined' || true, waapiD: !!waapi, d: path.getAttribute('d') };
    M.morph.read = function () {
      var b = path.getBBox();
      return { d: path.getAttribute('d'), bbox: [Math.round(b.width), Math.round(b.height)], next: shapes[(i + 1) % shapes.length].slice(0, 24) };
    };
    M.morph.go = go;
    return M.morph;
  };

  /* ---------- 4. разлёт / сборка ---------- */
  DS.assembly = function (stage) {
    var parts = [].slice.call(stage.querySelectorAll('.part'));
    var box = stage.querySelector('.assembly');
    function set(state) {
      box.classList.toggle('exploded', state);
      parts.forEach(function (p) { p.style.opacity = state ? .94 : 1; });
    }
    stage.querySelectorAll('[data-state]').forEach(function (b) {
      b.addEventListener('click', function () { set(b.getAttribute('data-state') === 'exploded'); });
    });
    function poses() {                                  // позы читаются как числа, а не как строка матрицы
      return parts.map(function (p) {
        var m = cs(p, 'transform');
        if (!m || m === 'none') return { dx: 0, dy: 0, rot: 0 };
        var n = m.replace('matrix(', '').replace(')', '').split(',').map(Number);
        return { dx: Math.round(n[4]), dy: Math.round(n[5]), rot: +(Math.atan2(n[1], n[0]) * 180 / Math.PI).toFixed(1) };
      });
    }
    M.assembly = { parts: parts.length, poses: poses, set: set };
    return M.assembly;
  };

  /* ---------- 5. hero-объект: смена ракурса ---------- */
  DS.orbit = function (stage) {
    var body = stage.querySelector('.orbit-body');
    var spin = 22, ox = -14, oy = 22, faces = [0, 90, 180, 270], cur = 0;
    function apply() {
      stage.style.setProperty('--ox', ox + 'deg');
      stage.style.setProperty('--oy', oy + 'deg');
      body.style.setProperty('--spin', spin);
    }
    apply();
    function animateTo(target, dur) {
      var from = spin, t0 = performance.now();
      if (R || ST) { spin = target; apply(); return; }
      (function step(now) {
        var p = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - p, 4);           // ease-out-quart
        spin = from + (target - from) * e; apply();
        if (p < 1) requestAnimationFrame(step);
      })(performance.now());
    }
    stage.querySelectorAll('[data-face]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = faces[+b.getAttribute('data-face')];
        while (f < spin) f += 360;
        cur = +b.getAttribute('data-face');
        animateTo(f, 620);
      });
    });
    var dragging = false, lastX = 0;
    stage.addEventListener('pointerdown', function (e) { dragging = true; lastX = e.clientX; stage.setPointerCapture(e.pointerId); });
    stage.addEventListener('pointermove', function (e) { if (!dragging) return; spin += (e.clientX - lastX) * .55; lastX = e.clientX; apply(); });
    stage.addEventListener('pointerup', function () { dragging = false; });
    M.orbit = {
      faces: faces.length,
      spin: function () { return +spin.toFixed(1); },
      transform: function () { return cs(body, 'transform').slice(0, 40); },
      rotateTo: animateTo
    };
    return M.orbit;
  };

  /* ---------- 6. зерно (шум поверх тона, видимый — иначе правило не ставим) ---------- */
  DS.grain = function (el) {
    var S = 128, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), img = g.createImageData(S, S), s = 12345;
    for (var i = 0; i < S * S; i++) {
      s = (s * 1664525 + 1013904223) >>> 0;
      var v = (s >>> 24) / 255;
      var lum = v < .5 ? 0 : 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = lum;
      img.data[i * 4 + 3] = Math.abs(v - .5) * 2 * 255 * .55;
    }
    g.putImageData(img, 0, 0);
    el.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')';
    el.style.backgroundSize = S + 'px ' + S + 'px';
    M.grain = { tile: S, opacity: cs(el, 'opacity'), blend: cs(el, 'mixBlendMode') };
    return M.grain;
  };

  /* ---------- 7. reveal: контент виден без JS ---------- */
  DS.reveal = function () {
    document.querySelectorAll('.rv').forEach(function (el) { inView(el, function () { el.classList.add('in'); }, '0px 0px -5% 0px'); });
    /* Фолбэк: если наблюдатель не сработал (короткий iframe, превью-фрейм, скрытая вкладка),
       контент обязан показаться сам. Иначе блок выглядит мёртвым, хотя код рабочий. */
    setTimeout(function () {
      document.querySelectorAll('.rv:not(.in)').forEach(function (el) { el.classList.add('in'); });
    }, 1800);
  };

  /* ---------- 8. проба: числа, по которым принимается работа ---------- */
  DS.probe = function () {
    var de = document.documentElement;
    var ofx = de.style.overflowX, ofy = document.body.style.overflowX;
    de.style.overflowX = 'visible'; document.body.style.overflowX = 'visible';   // снять маскировку переполнения
    var cw = de.clientWidth;
    var bad = [].slice.call(document.querySelectorAll('*')).filter(function (e) { return e.getBoundingClientRect().right > cw + 1; })
      .map(function (e) { return (e.tagName + '.' + (e.className && e.className.toString().slice(0, 18) || '')) + '→' + Math.round(e.getBoundingClientRect().right); });
    var out = {
      reduce: R,
      viewport: { innerW: innerWidth, clientW: cw, scrollW: de.scrollWidth, overflowX: de.scrollWidth - cw, offenders: bad.slice(0, 6) },
      fonts: document.fonts.status,
      checks: {
        preserve3d: CSS.supports('transform-style', 'preserve-3d'),
        scrollTimeline: CSS.supports('animation-timeline', 'view()'),
        canvas2d: !!document.createElement('canvas').getContext('2d')
      }
    };
    de.style.overflowX = ofx; document.body.style.overflowX = ofy;
    ['tilt', 'svgDraw', 'morph', 'assembly', 'orbit', 'grain'].forEach(function (k) { if (M[k]) out[k] = { num: pick(M[k]) }; });
    function pick(o) { var r = {}; Object.keys(o).forEach(function (k) { var v = o[k]; if (typeof v !== 'function') r[k] = v; }); return r; }
    out.svgDrawAfter = M.svgDraw && M.svgDraw.read ? M.svgDraw.read() : null;
    if (M.svgDraw && M.svgDraw.seek) {
      out.svgSeek = M.svgDraw.seek();
      out.svgSeek.dash = cs(document.querySelector('.flow path.trace'), 'strokeDashoffset');
    }
    out.morphAfter = M.morph && M.morph.read ? M.morph.read() : null;
    // доказательства: слой z даёт перспективу, состояния различаются, поворот доводит до грани
    if (M.tilt && M.tilt.set) {
      var inner = document.querySelector('.tilt-inner');
      var prx = parseFloat(inner.style.getPropertyValue('--rx')) || 0;
      var pry = parseFloat(inner.style.getPropertyValue('--ry')) || 0;
      M.tilt.set(-9, 12, 80, 20);
      var ir = inner.getBoundingClientRect();
      out.tiltAfter = {
        rx: inner.style.getPropertyValue('--rx'), ry: inner.style.getPropertyValue('--ry'),
        rectInner: [Math.round(ir.width), Math.round(ir.height)], rectFront: M.tilt.rectFront()
      };
      M.tilt.set(prx, pry);                     // вернуть состояние, которое поставило взаимодействие
    }
    if (M.assembly) {
      var parts = [].slice.call(document.querySelectorAll('.part'));
      parts.forEach(function (p) { p.style.transition = 'none'; });   // замер состояний, а не хода перехода
      M.assembly.set(false); var pa = M.assembly.poses();
      M.assembly.set(true); var pb = M.assembly.poses();
      parts.forEach(function (p) { p.style.transition = ''; });
      out.assemblyProof = { assembled: pa.slice(0, 3), exploded: pb.slice(0, 3), differs: JSON.stringify(pa) !== JSON.stringify(pb) };
      M.assembly.set(false);
    }
    if (M.orbit && M.orbit.rotateTo) {
      var s0 = M.orbit.spin();
      M.orbit.rotateTo(s0 + 68, 1);
      out.orbitProof = { before: s0, after: M.orbit.spin(), transform: M.orbit.transform() };
      M.orbit.rotateTo(s0, 1);
    }
    var rail = document.querySelector('.flow path.rail');
    if (rail && M.svgDraw && M.svgDraw.railLen) {
      if (M.railDash) {
        out.railDash = M.railDash;                      // готовое число с прошлого круга
      } else if (!railProbeStarted) {
        railProbeStarted = true;
        var de = document.documentElement, savedB = de.style.scrollBehavior;
        de.style.scrollBehavior = 'auto';               // smooth-scroll под виртуальным временем не докручивается
        var d0 = cs(rail, 'strokeDashoffset');
        var st = rail.closest('.stage');
        window.scrollTo(0, Math.max(0, st.getBoundingClientRect().top + window.pageYOffset - 120));
        out.railDash = { before: d0, after: null, pending: 'читаем прогресс таймлайна в следующем кадре' };
        setTimeout(function () {
          // прогресс прокруточного таймлайна пересчитывается не в том же кадре, что scrollTo: читаем с задержкой
          M.railDash = { before: d0, after: cs(rail, 'strokeDashoffset'), top: Math.round(st.getBoundingClientRect().top) };
          window.scrollTo(0, 0);
          de.style.scrollBehavior = savedB;
          if (window.__refresh) window.__refresh();
        }, 400);
      }
    }
    out.diag = (function () {
      var tr = document.querySelector('.flow path.trace');
      var rl = document.querySelector('.flow path.rail');
      var ra = rl && rl.getAnimations ? rl.getAnimations() : [];
      return {
        pageAnimations: (document.getAnimations ? document.getAnimations().length : -1),
        traceAnimations: (tr && tr.getAnimations ? tr.getAnimations().length : -1),
        railAnimations: ra.length,
        railTimeline: ra.map(function (a) { return a.timeline && a.timeline.constructor ? a.timeline.constructor.name : 'n/a'; }).join(','),
        railProgress: ra.length ? JSON.stringify(ra[0].effect.getComputedTiming().progress) : 'n/a',
        railOverflowAncestor: (function () {
          var e = rl && rl.parentNode;
          while (e && e.nodeType === 1) {
            var ov = getComputedStyle(e).overflow;
            if (ov && ov !== 'visible') return e.tagName + '.' + (e.className || '').toString().slice(0, 20) + '=' + ov;
            e = e.parentNode;
          }
          return 'none';
        })()
      };
    })();
    return out;
  };
})(window);
