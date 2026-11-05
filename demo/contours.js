/* Contour lines by marching squares + seeded value noise. No dependencies.
 * Corner bits: tl=1 tr=2 br=4 bl=8. Edges: 0=top 1=right 2=bottom 3=left. */
(function (root) {
  'use strict';
  var TABLE = [[], [[3,0]], [[0,1]], [[3,1]], [[1,2]], null, [[0,2]], [[3,2]],
               [[3,2]], [[0,2]], null, [[1,2]], [[3,1]], [[0,1]], [[3,0]], []];

  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeNoise(seed) {
    var N = 256, rnd = mulberry32(seed), g = new Float32Array(N * N);
    for (var i = 0; i < g.length; i++) g[i] = rnd();
    function at(x, y) { return g[((y & 255) * N) + (x & 255)]; }
    function s(t) { return t * t * (3 - 2 * t); }
    return function (x, y) {
      var xi = Math.floor(x), yi = Math.floor(y), fx = s(x - xi), fy = s(y - yi);
      var a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
      return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
    };
  }
  function fbm(noise, x, y, oct) {
    var v = 0, amp = 0.5, f = 1, norm = 0;
    for (var o = 0; o < oct; o++) { v += amp * noise(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
    return v / norm;                                   // 0..1
  }
  /* field(x,y)->number sampled on a (cols+1)x(rows+1) grid over [0,w]x[0,h]. Returns segments [x1,y1,x2,y2,...] */
  function contourSegments(field, w, h, cols, rows, level) {
    var dx = w / cols, dy = h / rows, vals = new Float32Array((cols + 1) * (rows + 1)), i, j;
    for (j = 0; j <= rows; j++) for (i = 0; i <= cols; i++) vals[j * (cols + 1) + i] = field(i * dx, j * dy);
    var out = [];
    function lerp(a, b, t) { return a + (b - a) * t; }
    for (j = 0; j < rows; j++) for (i = 0; i < cols; i++) {
      var tl = vals[j * (cols + 1) + i], tr = vals[j * (cols + 1) + i + 1];
      var bl = vals[(j + 1) * (cols + 1) + i], br = vals[(j + 1) * (cols + 1) + i + 1];
      var c = (tl >= level ? 1 : 0) | (tr >= level ? 2 : 0) | (br >= level ? 4 : 0) | (bl >= level ? 8 : 0);
      var segs = TABLE[c];
      if (segs === null) {                              // saddle: resolve with the cell-center average
        var inside = (tl + tr + br + bl) / 4 >= level;
        segs = c === 5 ? (inside ? [[0,1],[3,2]] : [[3,0],[1,2]]) : (inside ? [[3,0],[1,2]] : [[0,1],[3,2]]);
      }
      var x0 = i * dx, y0 = j * dy;
      var pts = [
        [lerp(x0, x0 + dx, (level - tl) / (tr - tl)), y0],                    // top
        [x0 + dx, lerp(y0, y0 + dy, (level - tr) / (br - tr))],               // right
        [lerp(x0, x0 + dx, (level - bl) / (br - bl)), y0 + dy],               // bottom
        [x0, lerp(y0, y0 + dy, (level - tl) / (bl - tl))]                     // left
      ];
      for (var k = 0; k < segs.length; k++) {
        var p = pts[segs[k][0]], q = pts[segs[k][1]]; out.push(p[0], p[1], q[0], q[1]);
      }
    }
    return out;
  }
  function segmentsToPath(seg, digits) {
    var d = [], f = Math.pow(10, digits == null ? 1 : digits);
    for (var i = 0; i < seg.length; i += 4)
      d.push('M' + Math.round(seg[i] * f) / f + ' ' + Math.round(seg[i+1] * f) / f +
             'L' + Math.round(seg[i+2] * f) / f + ' ' + Math.round(seg[i+3] * f) / f);
    return d.join('');
  }
  var api = {mulberry32: mulberry32, makeNoise: makeNoise, fbm: fbm,
             contourSegments: contourSegments, segmentsToPath: segmentsToPath};
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Contours = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
