window.DitherEngine = (function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const LUM = [0.2126, 0.7152, 0.0722];

  function luminance(r, g, b) {
    return LUM[0] * r + LUM[1] * g + LUM[2] * b;
  }

  /* Curva de tono RGB: LUT Float32Array(256) de salida, interpolacion lineal. */
  function sampleCurve(lut256, v) {
    const x = clamp(v, 0, 1) * 255;
    const i = Math.floor(x);
    if (i >= 255) return lut256[255];
    const f = x - i;
    return lut256[i] * (1 - f) + lut256[i + 1] * f;
  }

  function colorLum(c) {
    return luminance(c[0], c[1], c[2]);
  }

  const KERNELS = {
    floydsteinberg: {
      c: [[1, 0], [-1, 1], [0, 1], [1, 1]],
      w: [7, 3, 5, 1],
      div: 16
    },
    falsefloyd: {
      c: [[1, 0], [0, 1], [1, 1]],
      w: [3, 3, 2],
      div: 8
    },
    jarvis: {
      c: [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]],
      w: [7, 5, 3, 5, 7, 3, 5, 7, 5, 3],
      div: 48
    },
    stucki: {
      c: [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]],
      w: [8, 4, 2, 4, 8, 2, 4, 8, 4, 2],
      div: 42
    },
    burkes: {
      c: [[-1, 1], [0, 1], [1, 1], [-2, 2], [-1, 2], [0, 2], [1, 2], [2, 2]],
      w: [8, 4, 2, 4, 8, 4, 2, 4],
      div: 32
    },
    sierra: {
      c: [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 2], [0, 2], [1, 2], [-2, 3], [-1, 3], [0, 3], [1, 3], [2, 3]],
      w: [5, 3, 2, 3, 5, 3, 4, 3, 2, 3, 2, 3, 2],
      div: 32
    },
    sierra2: {
      c: [[-2, 1], [-1, 1], [0, 1], [1, 1], [2, 1], [-1, 2], [0, 2], [1, 2]],
      w: [5, 3, 2, 3, 5, 2, 3, 2],
      div: 16
    },
    sierralite: {
      c: [[1, 0], [0, 1], [1, 1]],
      w: [2, 1, 1],
      div: 4
    },
    atkinson: {
      c: [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]],
      w: [1, 1, 1, 1, 1, 1],
      div: 8
    }
  };

  const ALG_DIFF = {
    floydsteinberg: true, falsefloyd: true, jarvis: true, stucki: true,
    burkes: true, sierra: true, sierra2: true, sierralite: true, atkinson: true,
    adaptivefs3: true, adaptivefs7: true, customkernel: true, riemersma: true
  };

  /* Kernels adaptativos (edge-adaptive FS): dos stencils base que se
     interpolan por el angulo del gradiente local. 'r' fluye a lo largo de
     bordes horizontales (peso a la derecha), 'd' a lo largo de bordes
     verticales (peso hacia abajo). Cada columna se normaliza por su suma. */
  const AFS_TABLES = {
    3: {
      rSum: 16, dSum: 16,
      cells: [
        { dx: 1, dy: 0, r: 8, d: 4 },
        { dx: 0, dy: 1, r: 4, d: 8 },
        { dx: 1, dy: 1, r: 4, d: 0 },
        { dx: -1, dy: 1, r: 0, d: 4 }
      ]
    },
    7: {
      rSum: 112, dSum: 116,
      cells: [
        { dx: 1, dy: 0, r: 16, d: 8 },
        { dx: 2, dy: 0, r: 12, d: 0 },
        { dx: 3, dy: 0, r: 8, d: 0 },
        { dx: -1, dy: 1, r: 6, d: 12 },
        { dx: 0, dy: 1, r: 14, d: 16 },
        { dx: 1, dy: 1, r: 12, d: 8 },
        { dx: 2, dy: 1, r: 8, d: 0 },
        { dx: -2, dy: 2, r: 0, d: 6 },
        { dx: -1, dy: 2, r: 10, d: 10 },
        { dx: 0, dy: 2, r: 8, d: 14 },
        { dx: 1, dy: 2, r: 6, d: 0 },
        { dx: 2, dy: 2, r: 0, d: 8 },
        { dx: -1, dy: 3, r: 0, d: 8 },
        { dx: 0, dy: 3, r: 8, d: 12 },
        { dx: 1, dy: 3, r: 4, d: 8 },
        { dx: 0, dy: 4, r: 0, d: 6 }
      ]
    }
  };

  /* Kernel personalizado: filas de tokens, '*' = pixel actual, '.'/'0' celda
     vacia, enteros = pesos. El divisor es la suma de los pesos. */
  function parseCustomKernel(params) {
    const aOpts = params.algorithmOpts || {};
    const text = aOpts.kernelText;
    if (!text) return null;
    const rows = String(text).split(/[\n\r;]+/).map(r => r.trim()).filter(r => r.length > 0);
    if (!rows.length) return null;
    let starCol = -1;
    const cells = [];
    let sum = 0;
    for (let y = 0; y < rows.length; y++) {
      const toks = rows[y].split(/\s+/).filter(t => t.length > 0);
      for (let x = 0; x < toks.length; x++) {
        const t = toks[x];
        if (t === '*') starCol = x;
        else if (t === '.' || t === '0') { /* vacio */ }
        else {
          const v = parseInt(t, 10);
          if (!isFinite(v) || v < 1) return null;
          cells.push([x, y, v]);
          sum += v;
        }
      }
    }
    if (starCol < 0 || !cells.length || sum < 1) return null;
    const c = cells.map(p => [p[0] - starCol, p[1]]);
    const w = cells.map(p => p[2]);
    return { c: c, w: w, div: sum };
  }

  function kernelOf(algoName, params) {
    if (algoName === 'customkernel') {
      const aOpts = params.algorithmOpts || {};
      if (aOpts.kernel) return aOpts.kernel;
      const k = parseCustomKernel(params);
      if (k) return k;
      return KERNELS.floydsteinberg;
    }
    return KERNELS[algoName] || KERNELS.floydsteinberg;
  }

  function errStrengthOf(params) {
    const o = params.algorithmOpts || {};
    const s = o.errStrength;
    return s == null ? 1 : clamp(s, 0, 2);
  }

  /* Gamma de tonos medios: pivota en 0.5 (0 y 1 fijos), >1 levanta contraste
     en los medios, <1 lo aplana. */
  function midtonesGamma(v, mg) {
    if (mg === 1) return v;
    if (v <= 0.5) return 0.5 * Math.pow(Math.max(v * 2, 1e-4), mg);
    return 1 - 0.5 * Math.pow(Math.max((1 - v) * 2, 1e-4), mg);
  }

  /* Compresion de luces: soft-knee smoothstep en el extremo alto. */
  function highlightCompress(v, hc) {
    if (!hc) return v;
    const knee = 1 - hc;
    if (v <= knee) return v;
    const t = (v - knee) / hc;
    return knee + hc * (t * t * (3 - 2 * t));
  }

  const BAZER_BASE = [[0, 2], [3, 1]];

  function bayerMatrix(size) {
    let m = BAZER_BASE;
    let s = 2;
    while (s < size) {
      const nm = [];
      for (let y = 0; y < s * 2; y++) nm.push(new Uint16Array(s * 2));
      for (let y = 0; y < s; y++) {
        for (let x = 0; x < s; x++) {
          const v = m[y][x];
          nm[y][x] = v * 4;
          nm[y][x + s] = v * 4 + 2;
          nm[y + s][x] = v * 4 + 3;
          nm[y + s][x + s] = v * 4 + 1;
        }
      }
      m = nm;
      s *= 2;
    }
    return m;
  }

  const BAYER = { 2: bayerMatrix(2), 4: bayerMatrix(4), 8: bayerMatrix(8), 16: bayerMatrix(16) };

  function perlinNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    const dot = (ix, iy) => {
      const a = hash2(ix, iy, seed) * Math.PI * 2;
      const dx = x - ix, dy = y - iy;
      return Math.cos(a) * dx + Math.sin(a) * dy;
    };
    const v00 = dot(xi, yi);
    const v10 = dot(xi + 1, yi);
    const v01 = dot(xi, yi + 1);
    const v11 = dot(xi + 1, yi + 1);
    return clamp(0.5 + 0.7071 * lerp(lerp(v00, v10, sx), lerp(v01, v11, sx), sy), 0, 1);
  }

  function worleyNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    let best = 1e9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = xi + ox, ny = yi + oy;
        const jx = hash2(nx, ny, seed);
        const jy = (hash2(ny, nx, seed ^ 0x53c201e7) + 0.9) % 1;
        const dx = x - (nx + jx), dy = y - (ny + jy);
        const d = dx * dx + dy * dy;
        if (d < best) best = d;
      }
    }
    return clamp(1 - Math.sqrt(best) * 0.65, 0, 1);
  }

  function prepModulation(params) {
    const aOpts = params.algorithmOpts || {};
    const w = params.width, h = params.height;
    const type = aOpts.modType || 'blue';
    const seed = aOpts.seed != null ? aOpts.seed : 0;
    const interp = !!aOpts.interp;
    let scale = Math.max(1, aOpts.noiseScale || 1);
    if (type === 'bayer') {
      const s = scale <= 2 ? 2 : scale <= 4 ? 4 : scale <= 8 ? 8 : 16;
      const m = BAYER[s];
      const table = new Float32Array(w * h);
      for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) table[row + x] = m[y % s][x % s] / (s * s);
      }
      aOpts._noiseTable = table;
      return;
    }
    const gw = Math.max(2, Math.ceil(w / scale));
    const gh = Math.max(2, Math.ceil(h / scale));
    const direct = type === 'ign' || type === 'knoll';
    let grid = null;
    if (!direct) {
      grid = new Float32Array(gw * gh);
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          let v;
          if (type === 'blue') v = blueTile(gx, gy, seed);
          else if (type === 'white') v = hash2(gx, gy, seed);
          else if (type === 'value') v = valueNoise(gx, gy, seed);
          else if (type === 'perlin') v = perlinNoise(gx * 0.5, gy * 0.5, seed);
          else if (type === 'cellular') v = worleyNoise(gx, gy, seed);
          else v = worleyNoise(gx, gy, seed);
          grid[gy * gw + gx] = v;
        }
      }
    }
    const table = new Float32Array(w * h);
    const gwm = gw - 1, ghm = gh - 1;
    for (let y = 0; y < h; y++) {
      const fy = y / scale;
      const gy0 = fy >= ghm ? ghm : Math.floor(fy);
      const gy1 = Math.min(ghm, gy0 + 1);
      const ty = fy - gy0;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const fx = x / scale;
        const gx0 = fx >= gwm ? gwm : Math.floor(fx);
        const gx1 = Math.min(gwm, gx0 + 1);
        const tx = fx - gx0;
        let v;
        if (direct) {
          if (type === 'ign') v = ignNoise(x, y);
          else v = knollNoise(x / scale, y / scale, seed);
        } else if (interp) {
          const v00 = grid[gy0 * gw + gx0], v10 = grid[gy0 * gw + gx1];
          const v01 = grid[gy1 * gw + gx0], v11 = grid[gy1 * gw + gx1];
          v = lerp(lerp(v00, v10, tx), lerp(v01, v11, tx), ty);
        } else {
          v = grid[gy0 * gw + gx0];
        }
        table[row + x] = v;
      }
    }
    aOpts._noiseTable = table;
  }

  function ignNoise(x, y) {
    // Ruido de gradiente entrelazado: secuencia determinista de baja
    // discrepancia implementada desde cero (sin tablas externas).
    // Devuelve valor estable en [0,1) para cada pixel entero.
    const xi = Math.floor(x), yi = Math.floor(y);
    let h = (Math.imul(xi, 0x8da6b343) ^ Math.imul(yi, 0xd8163841)) | 0;
    h = (Math.imul(h ^ (h >>> 15), 0x6f4a9b37)) | 0;
    h ^= h >>> 13;
    return ((h >>> 0) % 100000) / 100000;
  }

  function knollNoise(x, y, seed) {
    // Variante propia de ruido disperso tipo Knoll: hash + suavizado
    // por media de vecinos 3x3 para evitar puntos aislados quemados.
    const s = seed | 0;
    let acc = 0;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        acc += hash2(Math.floor(x) + ox, Math.floor(y) + oy, s);
      }
    }
    return clamp(acc / 9, 0, 1);
  }

  function zoneStrength(lum, zones) {
    // Mezcla de fuerza por zonas de luminancia (sombras/medios/luces),
    // receta estilo fotocopia: interpolacion lineal entre los 3 pesos.
    const zs = (zones && zones.dark) || 0;
    const zm = (zones && zones.mid) || 0;
    const zl = (zones && zones.light) || 0;
    if (lum < 0.5) return lerp(zs, zm, lum * 2);
    return lerp(zm, zl, (lum - 0.5) * 2);
  }

  /* ditherRand32: PRNG deterministico propio que sustituye el fragmento
     'mulberry32' copiado de terceros. Estructura original: el seed difunde
     al estado, y cada paso mezcla por una cadena Weyl, un xorshift de
     triple y un reordenamiento no estandar con multiplicadores propios.
     Interfaz identica a la vieja: cierra en [0,1) y es estable por seed. */
  function ditherRand32(seed) {
    let x = (Math.imul(seed | 0, 0xd1b54a32) | 0) ^ 0x8b352f71;
    let w = 0x3f2a5c81 ^ (Math.imul(seed | 0, 0x9ef379a0) | 0);
    if (!x) x = 0x4f1bbcdc;
    return function () {
      w = (w + 0xabc98388) | 0;
      x ^= x << 9;
      x ^= x >>> 23;
      x ^= x << 17;
      x = x | 0;
      let z = (Math.imul(x, 0x8e062d4f) + w) | 0;
      z = (z ^ (z >>> 15)) | 0;
      z = Math.imul(z, 0x74a55b21) | 0;
      z = (z ^ (z >>> 18)) | 0;
      return (z >>> 0) / 4294967296;
    };
  }

  const blueCache = new Map();

  function makeBlueMask(size, seed) {
    const N = size * size;
    const rand = ditherRand32(seed ^ 0x7c13b5e9);
    const pat = new Uint8Array(N);
    for (let i = 0; i < N; i++) pat[i] = rand() < 0.12 ? 1 : 0;

    const sigma = 1.5;
    const rad = Math.ceil(sigma * 3);
    const kern = [];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        const d2 = dx * dx + dy * dy;
        kern.push([dx, dy, Math.exp(-d2 / (2 * sigma * sigma))]);
      }
    }
    const kernelSize = kern.length;

    function energy(i) {
      const x = i % size, y = (i / size) | 0;
      let s = 0;
      for (let t = 0; t < kernelSize; t++) {
        const dx = kern[t][0], dy = kern[t][1], k = kern[t][2];
        const px = (x + dx + size) % size;
        const py = (y + dy + size) % size;
        s += pat[py * size + px] * k;
      }
      return s;
    }

    function refreshAround(i) {
      const x = i % size, y = (i / size) | 0;
      for (let t = 0; t < kernelSize; t++) {
        const dx = kern[t][0], dy = kern[t][1];
        const px = (x + dx + size) % size;
        const py = (y + dy + size) % size;
        en[py * size + px] = energy(py * size + px);
      }
    }

    const en = new Float64Array(N);
    for (let i = 0; i < N; i++) en[i] = energy(i);

    let guard = 0;
    while (guard++ < 20000) {
      let bi = -1, bv = -1e9, vi = -1, vv = 1e9;
      for (let i = 0; i < N; i++) {
        const e = en[i];
        if (pat[i]) { if (e > bv) { bv = e; bi = i; } }
        else if (e < vv) { vv = e; vi = i; }
      }
      if (bi === -1 || vi === -1 || bv - vv <= 0.00002) break;
      pat[bi] = 0; pat[vi] = 1;
      refreshAround(bi); refreshAround(vi);
    }

    const mask = new Int32Array(N).fill(-1);
    let count = 0;
    for (let i = 0; i < N; i++) count += pat[i];
    const order = [];
    for (let i = 0; i < N; i++) if (pat[i]) order.push(i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = order[i]; order[i] = order[j]; order[j] = t;
    }
    for (let k = 0; k < order.length; k++) mask[order[k]] = k;
    let rank = count;
    let placed = count;
    while (placed < N) {
      let vi = -1, vv = 1e9;
      for (let i = 0; i < N; i++) {
        if (mask[i] === -1 && en[i] < vv) { vv = en[i]; vi = i; }
      }
      if (vi === -1) break;
      pat[vi] = 1; mask[vi] = rank++;
      placed++;
      refreshAround(vi);
    }
    for (let i = 0; i < N; i++) if (mask[i] === -1) mask[i] = rank++;

    return { size: size, data: mask };
  }

  function blueTile(x, y, seed) {
    let m = blueCache.get(seed);
    if (!m) {
      m = makeBlueMask(32, seed);
      blueCache.set(seed, m);
    }
    const s = m.size;
    return m.data[(y % s) * s + (x % s)] / (s * s - 1);
  }

  /* hash2: hash entero deterministico propio en [0,1). Sustituye la
     formula copiada de terceros (constantes estilo murmur). Dos etapas de
     mezcla con multiplicadores propios. */
  function hash2(x, y, seed) {
    let h = (Math.imul(x | 0, 0x97ce01d9) + Math.imul(y | 0, 0x6e25b1f3) + Math.imul(seed | 0, 0x2b8f1a4d)) | 0;
    h = Math.imul(h ^ (h >>> 13), 0x5c8e3f11) | 0;
    h = h ^ (h >>> 21);
    h = Math.imul(h ^ (h >>> 16), 0x9d3d2b47) | 0;
    h = h ^ (h >>> 14);
    return ((h >>> 0) & 0x3ffffff) / 67108864;
  }

  function valueNoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const a = hash2(xi, yi, seed);
    const b = hash2(xi + 1, yi, seed);
    const c = hash2(xi, yi + 1, seed);
    const d = hash2(xi + 1, yi + 1, seed);
    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);
    return lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
  }

  const PATTERNS = {
    dot: (u, v, s) => Math.min(1, Math.sqrt(u * u + v * v) / (s * 1.4142)),
    ring: (u, v, s) => {
      const dx = u - s / 2, dy = v - s / 2;
      return 1 - Math.min(1, Math.sqrt(dx * dx + dy * dy) / (s / 2));
    },
    horizontal: (u, v, s) => v / s,
    vertical: (u, v, s) => u / s,
    diagonal: (u, v, s) => (u + v) / (s * 2),
    checker: (u, v, s) => ((u % (s / 2) < 1) || (v % (s / 2) < 1)) ? 1 : 0,
    spiral: (u, v, s) => (u + 1 + v * s) / (s * s)
  };

  function parseCustomPattern(text) {
    const rows = text.split(/[\n\r;]+/).map(r => r.trim()).filter(r => r.length > 0);
    if (!rows.length) return null;
    const w = Math.max(...rows.map(r => r.length));
    const bits = [];
    for (const r of rows) {
      for (let x = 0; x < w; x++) bits.push(r[x] === '1' ? 0 : 1);
    }
    return { w, h: rows.length, bits };
  }

  function lerp3(a, b, t) {
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }

  function colorFromRamp(ramp, t) {
    const i = clamp(Math.round(t * 255), 0, 255);
    return [ramp[i * 3], ramp[i * 3 + 1], ramp[i * 3 + 2]];
  }

  function rampColorOpts(colorMode, colorOpts) {
    const o = colorOpts || {};
    if (colorMode === 'preserve') {
      return { type: 'lerp', a: [0, 0, 0], b: [1, 1, 1] };
    }
    if (colorMode === 'bw' || colorMode === 'duotone') {
      return { type: 'lerp', a: o.c1 || [0, 0, 0], b: o.c2 || [1, 1, 1] };
    }
    if (colorMode === 'tritone') {
      return { type: 'tritone', c1: o.c1 || [0, 0, 0], c2: o.c2 || [0.5, 0.5, 0.5], c3: o.c3 || [1, 1, 1] };
    }
    if (colorMode === 'palette') {
      return { type: 'palette', palette: o.palette || [[0, 0, 0], [1, 1, 1]] };
    }
    return { type: 'ramp', ramp: o.ramp };
  }

  function sampleColor(map, t) {
    switch (map.type) {
      case 'lerp':
        return lerp3(map.a, map.b, clamp(t, 0, 1));
      case 'tritone':
        return t < 0.5 ? lerp3(map.c1, map.c2, clamp(t * 2, 0, 1)) : lerp3(map.c2, map.c3, clamp((t - 0.5) * 2, 0, 1));
      case 'palette': {
        const idx = clamp(Math.round(t * (map.palette.length - 1)), 0, map.palette.length - 1);
        return map.palette[idx];
      }
      default:
        return colorFromRamp(map.ramp, t);
    }
  }

  function buildLut(colorMode, colorOpts, n) {
    const map = rampColorOpts(colorMode, colorOpts);
    const lut = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0;
      const c = sampleColor(map, t);
      lut.push([c[0], c[1], c[2]]);
    }
    return lut;
  }

  function colorLevels(params) {
    const m = params.colorMode;
    let n;
    if (m === 'bw' || m === 'duotone') n = 2;
    else if (m === 'tritone') n = 3;
    else if (m === 'gradient') n = Math.max(2, Math.min(64, (params.colorOpts && params.colorOpts.levels) || 12));
    else if (m === 'palette') n = Math.max(2, params.colorOpts.palette.length);
    else n = 2;
    return n;
  }

  function sortedPaletteLut(palette) {
    const idx = palette.map((c, i) => ({ c, i })).sort((a, b) => colorLum(a.c) - colorLum(b.c));
    return idx.map(e => [e.c[0], e.c[1], e.c[2]]);
  }

  function extremes(params) {
    const o = params.colorOpts;
    if (params.colorMode === 'preserve') return { light: [1, 1, 1], dark: [0, 0, 0] };
    if (params.colorMode === 'gradient') {
      return {
        light: [o.ramp[255 * 3], o.ramp[255 * 3 + 1], o.ramp[255 * 3 + 2]],
        dark: [o.ramp[0], o.ramp[1], o.ramp[2]]
      };
    }
    let colors;
    if (params.colorMode === 'palette') colors = o.palette;
    else colors = params.colorMode === 'tritone' ? [o.c1, o.c2, o.c3] : [o.c1, o.c2];
    let dark = colors[0], light = colors[0];
    for (const c of colors) {
      if (colorLum(c) < colorLum(dark)) dark = c;
      if (colorLum(c) > colorLum(light)) light = c;
    }
    return { light, dark };
  }

  function dither(params) {
    const w = params.width, h = params.height;
    const total = w * h;
    const rgba = params.rgba;
    const colorR = new Float32Array(total);
    const colorG = new Float32Array(total);
    const colorB = new Float32Array(total);
    const lum = new Float32Array(total);
    const alpha = new Uint8ClampedArray(total);

    const gamma = params.pre ? params.pre.gamma : 1;
    const bright = params.pre ? params.pre.brightness : 0;
    const contrast = params.pre ? params.pre.contrast : 1;
    const midGamma = params.pre ? (params.pre.midGamma != null ? params.pre.midGamma : 1) : 1;
    const hlComp = params.pre ? (params.pre.hlComp != null ? params.pre.hlComp : 0) : 0;
    const gInv = gamma > 0.01 ? 1 / gamma : 1;
    const darkC = params.outputRange ? params.outputRange.dark : 0;
    const lightC = params.outputRange ? params.outputRange.light : 1;
    const rangeInv = (lightC - darkC) < 1e-6 ? 1 : 1 / (lightC - darkC);
    const curve = params.pre && params.pre.curve;
    const a0 = params.algorithmOpts || {};
    const banding = params.algorithm === 'modulation' && a0.modBands > 1 ? Math.round(a0.modBands) : 0;

    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const a = rgba[o + 3];
      alpha[i] = a;
      let r = rgba[o] / 255;
      let g = rgba[o + 1] / 255;
      let b = rgba[o + 2] / 255;
      if (gamma !== 1) {
        r = Math.pow(Math.max(r, 0), gInv);
        g = Math.pow(Math.max(g, 0), gInv);
        b = Math.pow(Math.max(b, 0), gInv);
      }
      if (bright !== 0) {
        r = clamp(r + bright, 0, 1);
        g = clamp(g + bright, 0, 1);
        b = clamp(b + bright, 0, 1);
      }
      if (contrast !== 1) {
        r = clamp((r - 0.5) * contrast + 0.5, 0, 1);
        g = clamp((g - 0.5) * contrast + 0.5, 0, 1);
        b = clamp((b - 0.5) * contrast + 0.5, 0, 1);
      }
      if (midGamma !== 1) {
        r = midtonesGamma(r, midGamma);
        g = midtonesGamma(g, midGamma);
        b = midtonesGamma(b, midGamma);
      }
      if (hlComp > 0) {
        r = highlightCompress(r, hlComp);
        g = highlightCompress(g, hlComp);
        b = highlightCompress(b, hlComp);
      }
      if (darkC > 0 || lightC < 1) {
        r = rangeMap(r, darkC, lightC, rangeInv);
        g = rangeMap(g, darkC, lightC, rangeInv);
        b = rangeMap(b, darkC, lightC, rangeInv);
      }
      if (curve) {
        r = sampleCurve(curve, r);
        g = sampleCurve(curve, g);
        b = sampleCurve(curve, b);
      }
      colorR[i] = r;
      colorG[i] = g;
      colorB[i] = b;
      lum[i] = luminance(r, g, b);
      if (params.invert) lum[i] = 1 - lum[i];
      if (banding > 1) lum[i] = Math.round(lum[i] * (banding - 1)) / (banding - 1);
    }

    const na = params.animNoise;
    if (na > 0 && params.animSeed != null) {
      const seed = params.animSeed | 0;
      for (let i = 0; i < total; i++) {
        const x = i % w;
        const y = (i / w) | 0;
        const d = (hash2(x, y, seed) - 0.5) * na;
        colorR[i] = clamp(colorR[i] + d, 0, 1);
        colorG[i] = clamp(colorG[i] + d, 0, 1);
        colorB[i] = clamp(colorB[i] + d, 0, 1);
        lum[i] = clamp(lum[i] + d, 0, 1);
      }
    }

    const nLevels = colorLevels(params);
    const lut = buildLut(params.colorMode, params.colorOpts, nLevels);
    const out = new Uint8ClampedArray(total * 4);

    const algorithm = params.algorithm;
    const colorMode = params.colorMode;
    const mult = (params.algorithmOpts && params.algorithmOpts.mult) || 1;

    if (algorithm === 'modulation') prepModulation(params);

    if (algorithm === 'ascii') {
      renderAscii(params, alpha, lum, out);
    } else if (mult >= 2) {
      renderMultiplied(algorithm, params, mult, colorR, colorG, colorB, lum, alpha, out, nLevels, lut);
    } else if (ALG_DIFF[algorithm]) {
      if (colorMode === 'preserve') runDiffusionRGB(algorithm, params, colorR, colorG, colorB, out);
      else if (colorMode === 'palette') {
        const pal = params.colorOpts.palette || [[0, 0, 0], [1, 1, 1]];
        if (params.colorOpts.order === 'ordered') {
          runDiffusion(algorithm, params, lum, out, sortedPaletteLut(pal), nLevels, alpha);
        } else {
          runDiffusionPalette(algorithm, params, colorR, colorG, colorB, sortedPaletteLut(pal), out);
        }
      }
      else runDiffusion(algorithm, params, lum, out, lut, nLevels, alpha);
    } else {
      if (colorMode === 'preserve') runOrderedRGB(algorithm, params, colorR, colorG, colorB, out);
      else if (colorMode === 'palette') {
        const pal = params.colorOpts.palette || [[0, 0, 0], [1, 1, 1]];
        runOrdered(algorithm, params, lum, out, sortedPaletteLut(pal), pal.length, alpha);
      }
      else runOrdered(algorithm, params, lum, out, lut, nLevels, alpha);
    }

    applyTransparency(out, alpha, total, params);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(w, h);
    id.data.set(out);
    ctx.putImageData(id, 0, 0);
    return { canvas, width: w, height: h, rgba: out };
  }

  /* Capa plana (sin dithering): mismo pre-procesado de tono que dither(),
     pero mapeo continuo/nearest por pixel. Se usa como "capa original viva"
     en el modo doble capa del video con mascara. */
  function renderFlat(params) {
    const w = params.width, h = params.height, total = w * h;
    const rgba = params.rgba;
    const colorR = new Float32Array(total);
    const colorG = new Float32Array(total);
    const colorB = new Float32Array(total);
    const lum = new Float32Array(total);
    const alpha = new Uint8ClampedArray(total);

    const gamma = params.pre ? params.pre.gamma : 1;
    const bright = params.pre ? params.pre.brightness : 0;
    const contrast = params.pre ? params.pre.contrast : 1;
    const midGammaFlat = params.pre ? (params.pre.midGamma != null ? params.pre.midGamma : 1) : 1;
    const hlCompFlat = params.pre ? (params.pre.hlComp != null ? params.pre.hlComp : 0) : 0;
    const gInv = gamma > 0.01 ? 1 / gamma : 1;
    const darkC = params.outputRange ? params.outputRange.dark : 0;
    const lightC = params.outputRange ? params.outputRange.light : 1;
    const rangeInv = (lightC - darkC) < 1e-6 ? 1 : 1 / (lightC - darkC);
    const curve = params.pre && params.pre.curve;

    for (let i = 0; i < total; i++) {
      const o = i * 4;
      const a = rgba[o + 3];
      alpha[i] = a;
      let r = rgba[o] / 255;
      let g = rgba[o + 1] / 255;
      let b = rgba[o + 2] / 255;
      if (gamma !== 1) {
        r = Math.pow(Math.max(r, 0), gInv);
        g = Math.pow(Math.max(g, 0), gInv);
        b = Math.pow(Math.max(b, 0), gInv);
      }
      if (bright !== 0) {
        r = clamp(r + bright, 0, 1);
        g = clamp(g + bright, 0, 1);
        b = clamp(b + bright, 0, 1);
      }
      if (contrast !== 1) {
        r = clamp((r - 0.5) * contrast + 0.5, 0, 1);
        g = clamp((g - 0.5) * contrast + 0.5, 0, 1);
        b = clamp((b - 0.5) * contrast + 0.5, 0, 1);
      }
      if (midGammaFlat !== 1) {
        r = midtonesGamma(r, midGammaFlat);
        g = midtonesGamma(g, midGammaFlat);
        b = midtonesGamma(b, midGammaFlat);
      }
      if (hlCompFlat > 0) {
        r = highlightCompress(r, hlCompFlat);
        g = highlightCompress(g, hlCompFlat);
        b = highlightCompress(b, hlCompFlat);
      }
      if (darkC > 0 || lightC < 1) {
        r = rangeMap(r, darkC, lightC, rangeInv);
        g = rangeMap(g, darkC, lightC, rangeInv);
        b = rangeMap(b, darkC, lightC, rangeInv);
      }
      if (curve) {
        r = sampleCurve(curve, r);
        g = sampleCurve(curve, g);
        b = sampleCurve(curve, b);
      }
      colorR[i] = r;
      colorG[i] = g;
      colorB[i] = b;
      lum[i] = luminance(r, g, b);
      if (params.invert) lum[i] = 1 - lum[i];
    }

    const nLevels = colorLevels(params);
    const lut = buildLut(params.colorMode, params.colorOpts, nLevels);
    const out = new Uint8ClampedArray(total * 4);
    const mode = params.colorMode;
    const map = rampColorOpts(mode, params.colorOpts);

    for (let i = 0; i < total; i++) {
      const o = i * 4;
      if (alpha[i] === 0) { out[o + 3] = 0; continue; }
      if (mode === 'preserve') {
        out[o] = clamp(colorR[i] * 255, 0, 255);
        out[o + 1] = clamp(colorG[i] * 255, 0, 255);
        out[o + 2] = clamp(colorB[i] * 255, 0, 255);
        out[o + 3] = alpha[i];
        continue;
      }
      const v = clamp(lum[i], 0, 1);
      let c;
      if (mode === 'gradient') {
        const ramp = map.ramp || params.colorOpts.ramp;
        const lvl = Math.max(2, Math.min(64, params.colorOpts.levels || 12));
        const qv = Math.round(v * (lvl - 1)) / (lvl - 1);
        c = colorFromRamp(ramp, qv);
      } else {
        const idx = clamp(Math.round(v * (nLevels - 1)), 0, nLevels - 1);
        c = lut[idx];
      }
      out[o] = c[0] * 255;
      out[o + 1] = c[1] * 255;
      out[o + 2] = c[2] * 255;
      out[o + 3] = alpha[i];
    }

    applyTransparency(out, alpha, total, params);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(w, h);
    id.data.set(out);
    ctx.putImageData(id, 0, 0);
    return { canvas, width: w, height: h, rgba: out };
  }

  function rangeMap(v, dark, light, rangeInv) {
    if (v <= dark) return 0;
    if (v >= light) return 1;
    return (v - dark) * rangeInv;
  }

  function setColor(out, i, lut, idx) {
    const o = i * 4;
    const c = lut[idx];
    out[o] = c[0] * 255;
    out[o + 1] = c[1] * 255;
    out[o + 2] = c[2] * 255;
    out[o + 3] = 255;
  }

  function runDiffusion(algoName, params, lum, out, lut, n, alpha) {
    if (algoName === 'riemersma') return runDiffusionRiemersma(params, lum, out, lut, n, alpha);
    if (algoName === 'adaptivefs3') return runDiffusionAdaptive(3, params, lum, out, lut, n, alpha);
    if (algoName === 'adaptivefs7') return runDiffusionAdaptive(7, params, lum, out, lut, n, alpha);
    const w = params.width, h = params.height;
    const k = kernelOf(algoName, params);
    const es = errStrengthOf(params);
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;
    const work = Float32Array.from(lum);
    const inv = n > 1 ? 1 / (n - 1) : 0;
    const step = 1 - 1e-7;

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        if (alpha[i] === 0) continue;
        const v = clamp(work[i], 0, 1);
        if (v <= 0) { setColor(out, i, lut, 0); continue; }
        if (v >= step) { setColor(out, i, lut, n - 1); continue; }
        let idx = Math.round(v * (n - 1));
        if (idx > n - 1) idx = n - 1;
        const err = (v - idx * inv) * es;
        setColor(out, i, lut, idx);

        for (let j = 0; j < k.c.length; j++) {
          let dx = k.c[j][0], dy = k.c[j][1];
          if (!right) dx = -dx;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (alpha[ni] === 0) continue;
          work[ni] += (err * k.w[j]) / k.div;
        }
      }
    }
  }

  function runDiffusionRGB(algoName, params, cr, cg, cb, out) {
    if (algoName === 'riemersma') return runDiffusionRiemersmaRGB(params, cr, cg, cb, out);
    if (algoName === 'adaptivefs3') return runDiffusionAdaptiveRGB(3, params, cr, cg, cb, out);
    if (algoName === 'adaptivefs7') return runDiffusionAdaptiveRGB(7, params, cr, cg, cb, out);
    const w = params.width, h = params.height;
    const k = kernelOf(algoName, params);
    const es = errStrengthOf(params);
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;
    const levels = params.colorOpts.levels || 8;
    const inv = 1 / (levels - 1);
    const step = 1 - 1e-7;
    const wr = Float32Array.from(cr);
    const wg = Float32Array.from(cg);
    const wb = Float32Array.from(cb);

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        const ri = Math.round(clamp(wr[i], 0, step) * (levels - 1));
        const gi = Math.round(clamp(wg[i], 0, step) * (levels - 1));
        const bi = Math.round(clamp(wb[i], 0, step) * (levels - 1));
        const o = i * 4;
        out[o] = ri * inv * 255;
        out[o + 1] = gi * inv * 255;
        out[o + 2] = bi * inv * 255;
        out[o + 3] = 255;
        const er = (wr[i] - ri * inv) * es;
        const eg = (wg[i] - gi * inv) * es;
        const eb = (wb[i] - bi * inv) * es;

        for (let j = 0; j < k.c.length; j++) {
          let dx = k.c[j][0], dy = k.c[j][1];
          if (!right) dx = -dx;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          const f = k.w[j] / k.div;
          wr[ni] += er * f;
          wg[ni] += eg * f;
          wb[ni] += eb * f;
        }
      }
    }
  }

  function runDiffusionPalette(algoName, params, cr, cg, cb, lut, out) {
    if (algoName === 'riemersma') return runDiffusionRiemersmaPalette(params, cr, cg, cb, lut, out);
    if (algoName === 'adaptivefs3') return runDiffusionAdaptivePalette(3, params, cr, cg, cb, lut, out);
    if (algoName === 'adaptivefs7') return runDiffusionAdaptivePalette(7, params, cr, cg, cb, lut, out);
    const w = params.width, h = params.height;
    const k = kernelOf(algoName, params);
    const es = errStrengthOf(params);
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;
    const wr = Float32Array.from(cr);
    const wg = Float32Array.from(cg);
    const wb = Float32Array.from(cb);

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        let bIdx = 0, best = Infinity;
        for (let p = 0; p < lut.length; p++) {
          const dr = wr[i] - lut[p][0];
          const dg = wg[i] - lut[p][1];
          const db = wb[i] - lut[p][2];
          const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
          if (d < best) { best = d; bIdx = p; }
        }
        const o = i * 4;
        out[o] = lut[bIdx][0] * 255;
        out[o + 1] = lut[bIdx][1] * 255;
        out[o + 2] = lut[bIdx][2] * 255;
        out[o + 3] = 255;
        const er = (wr[i] - lut[bIdx][0]) * es;
        const eg = (wg[i] - lut[bIdx][1]) * es;
        const eb = (wb[i] - lut[bIdx][2]) * es;

        for (let j = 0; j < k.c.length; j++) {
          let dx = k.c[j][0], dy = k.c[j][1];
          if (!right) dx = -dx;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          const f = k.w[j] / k.div;
          wr[ni] += er * f;
          wg[ni] += eg * f;
          wb[ni] += eb * f;
        }
      }
    }
  }

  /* Riemersma: difusión a lo largo de una curva de Hilbert con cola de 16
     errores y pesos exponenciales (referencia compuphase). Para imágenes
     rectangulares el lado de la curva es la potencia de 2 superior y la
     historia se resetea en los saltos de continuidad. */
  function hilbertXY(n, d) {
    let t = d, x = 0, y = 0;
    for (let s = 1; s < n; s <<= 1) {
      const rx = (t / 2) & 1;
      const ry = (t ^ rx) & 1;
      if (ry === 0) {
        if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
        const tmp = x; x = y; y = tmp;
      }
      x += s * rx; y += s * ry; t = Math.floor(t / 4);
    }
    return [x, y];
  }

  const RIEM_H = [1, 1, 2, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 19, 23, 27];
  const RIEM_SUM = 153;

  function runDiffusionRiemersma(params, lum, out, lut, n, alpha) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const work = Float32Array.from(lum);
    const inv = n > 1 ? 1 / (n - 1) : 0;
    const step = 1 - 1e-7;
    const hist = new Float32Array(RIEM_H.length);
    let head = 0, filled = 0, px = -1, py = -1;
    let side = 1;
    while (side < Math.max(w, h)) side <<= 1;
    const nSide = side * side;
    for (let d = 0; d < nSide; d++) {
      const p = hilbertXY(side, d);
      const x = p[0], y = p[1];
      if (x >= w || y >= h) { px = -1; py = -1; filled = 0; continue; }
      if (px >= 0 && Math.abs(x - px) + Math.abs(y - py) !== 1) filled = 0;
      px = x; py = y;
      const i = y * w + x;
      if (alpha[i] === 0) continue;
      let acc = 0;
      if (filled > 0) {
        const startW = RIEM_H.length - filled;
        for (let k = 0; k < filled; k++) {
          const slot = (head - filled + k + RIEM_H.length) % RIEM_H.length;
          acc += hist[slot] * RIEM_H[startW + k];
        }
        acc /= RIEM_SUM;
      }
      const v = clamp(work[i] + acc, 0, 1);
      let idx;
      if (v <= 0) idx = 0;
      else if (v >= step) idx = n - 1;
      else idx = Math.round(v * (n - 1));
      if (idx > n - 1) idx = n - 1;
      setColor(out, i, lut, idx);
      hist[head] = (v - idx * inv) * es;
      head = (head + 1) % RIEM_H.length;
      if (filled < RIEM_H.length) filled++;
    }
  }

  function runDiffusionRiemersmaRGB(params, cr, cg, cb, out) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const levels = params.colorOpts.levels || 8;
    const inv = 1 / (levels - 1);
    const step = 1 - 1e-7;
    const wr = Float32Array.from(cr), wg = Float32Array.from(cg), wb = Float32Array.from(cb);
    const hr = new Float32Array(RIEM_H.length), hg = new Float32Array(RIEM_H.length), hb = new Float32Array(RIEM_H.length);
    let head = 0, filled = 0, px = -1, py = -1;
    let side = 1;
    while (side < Math.max(w, h)) side <<= 1;
    const nSide = side * side;
    for (let d = 0; d < nSide; d++) {
      const p = hilbertXY(side, d);
      const x = p[0], y = p[1];
      if (x >= w || y >= h) { px = -1; py = -1; filled = 0; continue; }
      if (px >= 0 && Math.abs(x - px) + Math.abs(y - py) !== 1) filled = 0;
      px = x; py = y;
      const i = y * w + x;
      let ar = 0, ag = 0, ab = 0;
      const startW = RIEM_H.length - filled;
      for (let k = 0; k < filled; k++) {
        const slot = (head - filled + k + RIEM_H.length) % RIEM_H.length;
        const wt = RIEM_H[startW + k];
        ar += hr[slot] * wt; ag += hg[slot] * wt; ab += hb[slot] * wt;
      }
      const iv = 1 / RIEM_SUM;
      const rr = clamp(wr[i] + ar * iv, 0, step);
      const gg = clamp(wg[i] + ag * iv, 0, step);
      const bb = clamp(wb[i] + ab * iv, 0, step);
      const ri = Math.round(rr * (levels - 1));
      const gi = Math.round(gg * (levels - 1));
      const bi = Math.round(bb * (levels - 1));
      const o = i * 4;
      out[o] = ri * inv * 255; out[o + 1] = gi * inv * 255; out[o + 2] = bi * inv * 255; out[o + 3] = 255;
      hr[head] = (rr - ri * inv) * es;
      hg[head] = (gg - gi * inv) * es;
      hb[head] = (bb - bi * inv) * es;
      head = (head + 1) % RIEM_H.length;
      if (filled < RIEM_H.length) filled++;
    }
  }

  function runDiffusionRiemersmaPalette(params, cr, cg, cb, lut, out) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const wr = Float32Array.from(cr), wg = Float32Array.from(cg), wb = Float32Array.from(cb);
    const hr = new Float32Array(RIEM_H.length), hg = new Float32Array(RIEM_H.length), hb = new Float32Array(RIEM_H.length);
    let head = 0, filled = 0, px = -1, py = -1;
    let side = 1;
    while (side < Math.max(w, h)) side <<= 1;
    const nSide = side * side;
    for (let d = 0; d < nSide; d++) {
      const p = hilbertXY(side, d);
      const x = p[0], y = p[1];
      if (x >= w || y >= h) { px = -1; py = -1; filled = 0; continue; }
      if (px >= 0 && Math.abs(x - px) + Math.abs(y - py) !== 1) filled = 0;
      px = x; py = y;
      const i = y * w + x;
      let ar = 0, ag = 0, ab = 0;
      const startW = RIEM_H.length - filled;
      for (let k = 0; k < filled; k++) {
        const slot = (head - filled + k + RIEM_H.length) % RIEM_H.length;
        const wt = RIEM_H[startW + k];
        ar += hr[slot] * wt; ag += hg[slot] * wt; ab += hb[slot] * wt;
      }
      const iv = 1 / RIEM_SUM;
      const rr = wr[i] + ar * iv, gg = wg[i] + ag * iv, bb = wb[i] + ab * iv;
      let bIdx = 0, best = Infinity;
      for (let pcol = 0; pcol < lut.length; pcol++) {
        const dr = rr - lut[pcol][0], dg = gg - lut[pcol][1], db = bb - lut[pcol][2];
        const dd = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
        if (dd < best) { best = dd; bIdx = pcol; }
      }
      const o = i * 4;
      out[o] = lut[bIdx][0] * 255; out[o + 1] = lut[bIdx][1] * 255; out[o + 2] = lut[bIdx][2] * 255; out[o + 3] = 255;
      hr[head] = (rr - lut[bIdx][0]) * es;
      hg[head] = (gg - lut[bIdx][1]) * es;
      hb[head] = (bb - lut[bIdx][2]) * es;
      head = (head + 1) % RIEM_H.length;
      if (filled < RIEM_H.length) filled++;
    }
  }

  /* Adaptive FS (edge-adaptive): el kernel (3x3 o 7x7) se interpola por el
     angulo del gradiente de luminancia, orientado a lo largo del borde para
     no cruzar contornos; en zonas planas queda el punto medio (disperso). */
  function runDiffusionAdaptive(size, params, lum, out, lut, n, alpha) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const work = Float32Array.from(lum);
    const inv = n > 1 ? 1 / (n - 1) : 0;
    const step = 1 - 1e-7;
    const tbl = AFS_TABLES[size] || AFS_TABLES[3];
    const cells = tbl.cells;
    const rSum = tbl.rSum, dSum = tbl.dSum;
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        if (alpha[i] === 0) continue;
        const v = clamp(work[i], 0, 1);
        let idx;
        if (v <= 0) idx = 0;
        else if (v >= step) idx = n - 1;
        else idx = Math.round(v * (n - 1));
        if (idx > n - 1) idx = n - 1;
        const err = (v - idx * inv) * es;
        setColor(out, i, lut, idx);
        const l = lum[i];
        const gl = x > 0 ? lum[i - 1] : l;
        const grr = x < w - 1 ? lum[i + 1] : l;
        const gu = y > 0 ? lum[i - w] : l;
        const gd = y < h - 1 ? lum[i + w] : l;
        const gx = grr - gl, gy = gd - gu;
        if (gx === gx && gy === gy) {
          const mag = Math.abs(gx) + Math.abs(gy) + 1e-6;
          const t = Math.abs(gx) / mag;
          const denom = rSum * t + dSum * (1 - t);
          for (let j = 0; j < cells.length; j++) {
            const cc = cells[j];
            let dx = cc.dx, dy = cc.dy;
            if (!right) dx = -dx;
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || nx >= w || ny >= h) continue;
            const ni = ny * w + nx;
            if (alpha[ni] === 0) continue;
            const f = (cc.r * t + cc.d * (1 - t)) / denom;
            work[ni] += err * f;
          }
        }
      }
    }
  }

  function runDiffusionAdaptiveRGB(size, params, cr, cg, cb, out) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const levels = params.colorOpts.levels || 8;
    const inv = 1 / (levels - 1);
    const step = 1 - 1e-7;
    const wr = Float32Array.from(cr), wg = Float32Array.from(cg), wb = Float32Array.from(cb);
    const tbl = AFS_TABLES[size] || AFS_TABLES[3];
    const cells = tbl.cells;
    const rSum = tbl.rSum, dSum = tbl.dSum;
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        const ri = Math.round(clamp(wr[i], 0, step) * (levels - 1));
        const gi = Math.round(clamp(wg[i], 0, step) * (levels - 1));
        const bi = Math.round(clamp(wb[i], 0, step) * (levels - 1));
        const o = i * 4;
        out[o] = ri * inv * 255; out[o + 1] = gi * inv * 255; out[o + 2] = bi * inv * 255; out[o + 3] = 255;
        const er = (wr[i] - ri * inv) * es;
        const eg = (wg[i] - gi * inv) * es;
        const eb = (wb[i] - bi * inv) * es;
        const l = luminance(cr[i], cg[i], cb[i]);
        const gl = x > 0 ? luminance(cr[i - 1], cg[i - 1], cb[i - 1]) : l;
        const grr = x < w - 1 ? luminance(cr[i + 1], cg[i + 1], cb[i + 1]) : l;
        const gu = y > 0 ? luminance(cr[i - w], cg[i - w], cb[i - w]) : l;
        const gd = y < h - 1 ? luminance(cr[i + w], cg[i + w], cb[i + w]) : l;
        const gx = grr - gl, gy = gd - gu;
        const mag = Math.abs(gx) + Math.abs(gy) + 1e-6;
        const t = Math.abs(gx) / mag;
        const denom = rSum * t + dSum * (1 - t);
        for (let j = 0; j < cells.length; j++) {
          const cc = cells[j];
          let dx = cc.dx, dy = cc.dy;
          if (!right) dx = -dx;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          const f = (cc.r * t + cc.d * (1 - t)) / denom;
          wr[ni] += er * f; wg[ni] += eg * f; wb[ni] += eb * f;
        }
      }
    }
  }

  function runDiffusionAdaptivePalette(size, params, cr, cg, cb, lut, out) {
    const w = params.width, h = params.height;
    const es = errStrengthOf(params);
    const wr = Float32Array.from(cr), wg = Float32Array.from(cg), wb = Float32Array.from(cb);
    const tbl = AFS_TABLES[size] || AFS_TABLES[3];
    const cells = tbl.cells;
    const rSum = tbl.rSum, dSum = tbl.dSum;
    const serpentine = params.algorithmOpts ? params.algorithmOpts.serpentine : true;

    for (let y = 0; y < h; y++) {
      const right = !((serpentine) && (y & 1));
      for (let sx = 0; sx < w; sx++) {
        const x = right ? sx : w - 1 - sx;
        const i = y * w + x;
        let bIdx = 0, best = Infinity;
        for (let pcol = 0; pcol < lut.length; pcol++) {
          const dr = wr[i] - lut[pcol][0], dg = wg[i] - lut[pcol][1], db = wb[i] - lut[pcol][2];
          const dd = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
          if (dd < best) { best = dd; bIdx = pcol; }
        }
        const o = i * 4;
        out[o] = lut[bIdx][0] * 255; out[o + 1] = lut[bIdx][1] * 255; out[o + 2] = lut[bIdx][2] * 255; out[o + 3] = 255;
        const er = (wr[i] - lut[bIdx][0]) * es;
        const eg = (wg[i] - lut[bIdx][1]) * es;
        const eb = (wb[i] - lut[bIdx][2]) * es;
        const l = luminance(cr[i], cg[i], cb[i]);
        const gl = x > 0 ? luminance(cr[i - 1], cg[i - 1], cb[i - 1]) : l;
        const grr = x < w - 1 ? luminance(cr[i + 1], cg[i + 1], cb[i + 1]) : l;
        const gu = y > 0 ? luminance(cr[i - w], cg[i - w], cb[i - w]) : l;
        const gd = y < h - 1 ? luminance(cr[i + w], cg[i + w], cb[i + w]) : l;
        const gx = grr - gl, gy = gd - gu;
        const mag = Math.abs(gx) + Math.abs(gy) + 1e-6;
        const t = Math.abs(gx) / mag;
        const denom = rSum * t + dSum * (1 - t);
        for (let j = 0; j < cells.length; j++) {
          const cc = cells[j];
          let dx = cc.dx, dy = cc.dy;
          if (!right) dx = -dx;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          const f = (cc.r * t + cc.d * (1 - t)) / denom;
          wr[ni] += er * f; wg[ni] += eg * f; wb[ni] += eb * f;
        }
      }
    }
  }

  function thresholdAt(algorithm, x, y, params) {
    const aOpts = params.algorithmOpts || {};
    const phaseX = params.phaseX || 0, phaseY = params.phaseY || 0;
    const px = x + phaseX, py = y + phaseY;
    if (algorithm === 'bayer') {
      const s = aOpts.size || 4;
      const m = BAYER[s];
      return m[py % s][px % s] / (s * s);
    }
    if (algorithm === 'modulation') {
      const aOpts = params.algorithmOpts || {};
      const t = aOpts._noiseTable;
      let cx = px, cy = py;
      const rip = aOpts.modRipple || 0;
      if (rip > 0) {
        const seed = aOpts.seed != null ? aOpts.seed : 0;
        const sc = Math.max(0.1, aOpts.noiseScale || 1);
        cx += (valueNoise(px / (sc * 6), py / (sc * 6), seed ^ 0x51ab) - 0.5) * rip * sc * 1.4;
        cy += (valueNoise(px / (sc * 6) + 37.7, py / (sc * 6) + 91.3, seed ^ 0x77dc) - 0.5) * rip * sc * 1.4;
      }
      if (t && t.length === params.width * params.height) {
        const w = params.width, h = params.height;
        const wx = ((cx % w) + w) % w;
        const wy = ((cy % h) + h) % h;
        return t[wy * w + wx];
      }
      const seed = aOpts.seed != null ? aOpts.seed : 0;
      const sc = aOpts.noiseScale || 1;
      if (aOpts.modType === 'ign') return ignNoise(cx, cy);
      if (aOpts.modType === 'knoll') return knollNoise(cx / sc, cy / sc, seed);
      return valueNoise(cx / sc, cy / sc, seed);
    }
    if (algorithm === 'bitmappattern') {
      return patternThreshold(px, py, params);
    }
    return 0.5;
  }

  function maskStrengthAt(params, x, y) {
    const aOpts = params.algorithmOpts || {};
    const map = aOpts.strengthMap;
    if (!map) return 1;
    const w = params.width;
    if (map.length !== w * params.height) return 1;
    return map[y * w + x] / 255;
  }

  /* Aplica la mascara como fuerza del grano: m=0 deja el umbral en 0.5
     (banda lisa sin dither), m=1 deja el umbral original. */
  function gateThreshold(t, params, x, y) {
    const m = maskStrengthAt(params, x, y);
    return m >= 1 ? t : lerp(0.5, t, m);
  }

  function modThreshold(x, y, lumV, params) {
    const aOpts = params.algorithmOpts || {};
    const t = thresholdAt('modulation', x, y, params);
    const globalF = aOpts.modStrength != null ? aOpts.modStrength : 1;
    const zones = aOpts.modZones;
    const zf = zones ? zoneStrength(lumV, zones) : 1;
    const m = maskStrengthAt(params, x, y);
    const f = clamp(globalF * zf * m, 0, 1);
    return lerp(0.5, t, f);
  }

  function runOrdered(algorithm, params, lum, out, lut, n, alpha) {
    const w = params.width, h = params.height;
    const step = 1 - 1e-7;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (alpha[i] === 0) continue;
        const v = clamp(lum[i], 0, 1);
        if (v <= 0) { setColor(out, i, lut, 0); continue; }
        if (v >= step) { setColor(out, i, lut, n - 1); continue; }
        const scaled = v * (n - 1);
        const low = Math.floor(scaled);
        const frac = scaled - low;
        const t = algorithm === 'modulation' ? modThreshold(x, y, v, params) : gateThreshold(thresholdAt(algorithm, x, y, params), params, x, y);
        setColor(out, i, lut, frac > t ? low + 1 : low);
      }
    }
  }

  function runOrderedRGB(algorithm, params, cr, cg, cb, out) {
    const w = params.width, h = params.height;
    const levels = params.colorOpts.levels || 8;
    const inv = 1 / (levels - 1);
    const step = 1 - 1e-7;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const o = i * 4;
        const lv = clamp(luminance(cr[i], cg[i], cb[i]), 0, 1);
        const t = algorithm === 'modulation' ? modThreshold(x, y, lv, params) : gateThreshold(thresholdAt(algorithm, x, y, params), params, x, y);
        out[o] = orderedLevel(cr[i], levels, inv, t, step) * inv * 255;
        out[o + 1] = orderedLevel(cg[i], levels, inv, t, step) * inv * 255;
        out[o + 2] = orderedLevel(cb[i], levels, inv, t, step) * inv * 255;
        out[o + 3] = 255;
      }
    }
  }

  function orderedLevel(v, levels, inv, t, step) {
    const c = clamp(v, 0, 1);
    if (c <= 0) return 0;
    if (c >= step) return levels - 1;
    const scaled = c * (levels - 1);
    const low = Math.floor(scaled);
    const frac = scaled - low;
    return frac > t ? low + 1 : low;
  }

  function patternThreshold(x, y, params) {
    const aOpts = params.algorithmOpts || {};
    const pat = aOpts.pattern || 'dot';
    const size = aOpts.patternSize || 8;
    if (pat === 'custom' && aOpts.customPattern) {
      const cp = aOpts.customPattern;
      if (cp.bits) {
        const v = cp.bits[((y % cp.h) * cp.w) + (x % cp.w)];
        return aOpts.invert ? 1 - v : v;
      }
    }
    const u = x % size, v = y % size;
    let t = (PATTERNS[pat] || PATTERNS.dot)(u, v, size);
    if (aOpts.invert) t = 1 - t;
    return t;
  }

  const ASCII_CHARSETS = {
    classic: '@%#*+=-:. ',
    blocks: '\u2588\u2593\u2592\u2591 ',
    partial: '\u2588\u2589\u258A\u258B\u258C\u258D\u258E\u258F ',
    minimal: '\u2588\u2591 ',
    digits: '9#8&6+;:,. ',
    binary: '\u2588 '
  };

  function renderMultiplied(algorithm, params, k, cr, cg, cb, lum, alpha, out, nLevels, lut) {
    const w = params.width, h = params.height;
    const gw = Math.ceil(w / k), gh = Math.ceil(h / k);
    const total = gw * gh;
    const sumLum = new Float64Array(total);
    const sumR = new Float64Array(total);
    const sumG = new Float64Array(total);
    const sumB = new Float64Array(total);
    const cnt = new Uint32Array(total);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        if (alpha[i] === 0) continue;
        const j = ((y / k) | 0) * gw + ((x / k) | 0);
        sumLum[j] += lum[i];
        sumR[j] += cr[i];
        sumG[j] += cg[i];
        sumB[j] += cb[i];
        cnt[j]++;
      }
    }
    const invW = 1 / (k * k);
    const cellLum = new Float32Array(total);
    const cellR = new Float32Array(total);
    const cellG = new Float32Array(total);
    const cellB = new Float32Array(total);
    const cellAlpha = new Uint8ClampedArray(total);
    for (let j = 0; j < total; j++) {
      if (!cnt[j]) continue;
      const c = cnt[j] * invW <= 0.25 ? 0 : 1;
      cellAlpha[j] = c ? 255 : 0;
      const inv = 1 / cnt[j];
      cellLum[j] = sumLum[j] * inv;
      cellR[j] = sumR[j] * inv;
      cellG[j] = sumG[j] * inv;
      cellB[j] = sumB[j] * inv;
    }
    const preserve = params.colorMode === 'preserve';
    const pal = params.colorOpts.palette;
    const palette = params.colorMode === 'palette';
    const p2 = Object.assign({}, params, { width: gw, height: gh, rgba: undefined });
    p2.algorithmOpts = Object.assign({}, params.algorithmOpts);
    if (algorithm === 'modulation') prepModulation(p2);
    const outLow = new Uint8ClampedArray(total * 4);
    if (preserve) {
      if (ALG_DIFF[algorithm]) runDiffusionRGB(algorithm, p2, cellR, cellG, cellB, outLow);
      else runOrderedRGB(algorithm, p2, cellR, cellG, cellB, outLow);
    } else if (palette) {
      const sl = sortedPaletteLut(pal);
      if (ALG_DIFF[algorithm]) {
        if (params.colorOpts.order === 'ordered') runDiffusion(algorithm, p2, cellLum, outLow, sl, nLevels, cellAlpha);
        else runDiffusionPalette(algorithm, p2, cellR, cellG, cellB, sl, outLow);
      } else {
        runOrdered(algorithm, p2, cellLum, outLow, sl, pal.length, cellAlpha);
      }
    } else if (ALG_DIFF[algorithm]) {
      runDiffusion(algorithm, p2, cellLum, outLow, lut, nLevels, cellAlpha);
    } else {
      runOrdered(algorithm, p2, cellLum, outLow, lut, nLevels, cellAlpha);
    }
    for (let cy = 0; cy < gh; cy++) {
      const y0 = cy * k, y1 = Math.min(h, y0 + k);
      for (let cx = 0; cx < gw; cx++) {
        const j = cy * gw + cx;
        const o = j * 4;
        if (outLow[o + 3] === 0) continue;
        const r = outLow[o], g = outLow[o + 1], b = outLow[o + 2], a = outLow[o + 3];
        const x0 = cx * k, x1 = Math.min(w, x0 + k);
        for (let y = y0; y < y1; y++) {
          const row = y * w;
          const prow = row * 4;
          for (let x = x0; x < x1; x++) {
            const p = prow + x * 4;
            out[p] = r; out[p + 1] = g; out[p + 2] = b; out[p + 3] = a;
          }
        }
      }
    }
  }

  function renderAscii(params, alpha, lum, out) {
    const w = params.width, h = params.height;
    const aOpts = params.algorithmOpts || {};
    const cell = aOpts.asciiScale || 8;
    const charset = ASCII_CHARSETS[aOpts.asciiCharset] || ASCII_CHARSETS.classic;
    const invert = !!aOpts.asciiInvert;
    const cw = w * cell, ch = h * cell;
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, cw, ch);
    ctx.font = cell + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const map = rampColorOpts(params.colorMode, params.colorOpts);
    const phX = params.phaseX || 0, phY = params.phaseY || 0;
    const ox = ((Math.floor(phX) % w) + w) % w;
    const oy = ((Math.floor(phY) % h) + h) % h;

    for (let cy = 0; cy < h; cy++) {
      for (let cx = 0; cx < w; cx++) {
        const gcx = (cx + ox) % w;
        const gcy = (cy + oy) % h;
        let sum = 0;
        for (let yy = 0; yy < cell; yy++) {
          const gy = cy * cell + yy;
          if (gy >= ch) break;
          const rowStart = (gcy * cell + yy) * w + gcx * cell;
          for (let xx = 0; xx < cell; xx++) {
            if (gcx * cell + xx >= cw) break;
            sum += lum[rowStart + xx];
          }
        }
        const avg = sum / (cell * cell);
        let ci = clamp(Math.round(avg * (charset.length - 1)), 0, charset.length - 1);
        if (invert) ci = charset.length - 1 - ci;
        const c = sampleColor(map, clamp(avg, 0, 1));
        ctx.fillStyle = 'rgb(' + (c[0] * 255 | 0) + ',' + (c[1] * 255 | 0) + ',' + (c[2] * 255 | 0) + ')';
        ctx.fillText(charset[ci], cx * cell + cell / 2, cy * cell + cell / 2 + 1);
      }
    }

    const id = ctx.getImageData(0, 0, cw, ch);
    const d = id.data;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        let r = 0, g = 0, b = 0, a = 0, cnt = 0;
        for (let yy = 0; yy < cell; yy++) {
          const row = ((y * cell + yy) * cw + x * cell) * 4;
          for (let xx = 0; xx < cell; xx++) {
            const idx = row + xx * 4;
            r += d[idx]; g += d[idx + 1]; b += d[idx + 2]; a += d[idx + 3]; cnt++;
          }
        }
        const invCnt = 1 / (cnt || 1);
        out[o] = r * invCnt; out[o + 1] = g * invCnt; out[o + 2] = b * invCnt;
        out[o + 3] = a * invCnt;
      }
    }
    void alpha;
  }

  function applyTransparency(out, alpha, total, params) {
    const t = params.transparent;
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      if (alpha[i] === 0) { out[o + 3] = 0; continue; }
      if (t && t.enabled) {
        const bg = (t.which === 'darkest' ? extremes(params).dark : extremes(params).light);
        const tol = 18;
        const dr = out[o] - bg[0] * 255;
        const dg = out[o + 1] - bg[1] * 255;
        const db = out[o + 2] - bg[2] * 255;
        if (Math.abs(dr) <= tol && Math.abs(dg) <= tol && Math.abs(db) <= tol) out[o + 3] = 0;
      }
    }
  }

  /* Clave (key) de luminancia estilo CRT calculada sobre la imagen YA
     procesada (gamma/brillo/contraste/cortes/curva) y con luma Rec.601
     (0.299R + 0.587G + 0.114B), para que la mascara coincida exactamente con
     lo que se ve en pantalla y quede superpuesta a la imagen original.
     Fuentes: 'brillo' (clave de luces), 'sombra' (clave de sombras),
     'medios' (clave de tonos medios, banda real de luminancia) y 'bordes'
     (clave de contorno). Suavizado por smoothstep + blur 3x3. */
  function maskFromLuma(rgba, w, h, cfg) {
    cfg = cfg || {};
    const src = cfg.source || 'brillo';
    const th = clamp((cfg.threshold != null ? cfg.threshold : 50) / 100, 0, 0.999);
    const sm = clamp((cfg.smooth != null ? cfg.smooth : 25) / 100, 0, 0.8);
    const op = clamp((cfg.opacity != null ? cfg.opacity : 100) / 100, 0, 1);
    const total = w * h;

    const pre = cfg.pre || null;
    const gamma = pre ? pre.gamma : 1;
    const bright = pre ? pre.brightness : 0;
    const contrast = pre ? pre.contrast : 1;
    const midGammaMask = pre ? (pre.midGamma != null ? pre.midGamma : 1) : 1;
    const hlCompMask = pre ? (pre.hlComp != null ? pre.hlComp : 0) : 0;
    const gInv = gamma > 0.01 ? 1 / gamma : 1;
    const darkC = cfg.outputRange ? cfg.outputRange.dark : 0;
    const lightC = cfg.outputRange ? cfg.outputRange.light : 1;
    const rangeInv = (lightC - darkC) < 1e-6 ? 1 : 1 / (lightC - darkC);
    const curve = pre && pre.curve;
    const invert = !!cfg.invert;

    const luma = new Float32Array(total);
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      let r = rgba[o] / 255, g = rgba[o + 1] / 255, b = rgba[o + 2] / 255;
      if (gamma !== 1) {
        r = Math.pow(Math.max(r, 0), gInv);
        g = Math.pow(Math.max(g, 0), gInv);
        b = Math.pow(Math.max(b, 0), gInv);
      }
      if (bright !== 0) { r = clamp(r + bright, 0, 1); g = clamp(g + bright, 0, 1); b = clamp(b + bright, 0, 1); }
      if (contrast !== 1) {
        r = clamp((r - 0.5) * contrast + 0.5, 0, 1);
        g = clamp((g - 0.5) * contrast + 0.5, 0, 1);
        b = clamp((b - 0.5) * contrast + 0.5, 0, 1);
      }
      if (midGammaMask !== 1) {
        r = midtonesGamma(r, midGammaMask);
        g = midtonesGamma(g, midGammaMask);
        b = midtonesGamma(b, midGammaMask);
      }
      if (hlCompMask > 0) {
        r = highlightCompress(r, hlCompMask);
        g = highlightCompress(g, hlCompMask);
        b = highlightCompress(b, hlCompMask);
      }
      if (darkC > 0 || lightC < 1) { r = rangeMap(r, darkC, lightC, rangeInv); g = rangeMap(g, darkC, lightC, rangeInv); b = rangeMap(b, darkC, lightC, rangeInv); }
      if (curve) { r = sampleCurve(curve, r); g = sampleCurve(curve, g); b = sampleCurve(curve, b); }
      let l = 0.299 * r + 0.587 * g + 0.114 * b;
      if (invert) l = 1 - l;
      luma[i] = l;
    }

    const lo = Math.max(0, th - sm * 0.5);
    const hi = Math.min(1, th + sm * 0.5);
    const inv = 1 / Math.max(1e-4, hi - lo);
    const raw = new Float32Array(total);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let v;
        if (src === 'medios') {
          const half = Math.max(1e-4, sm * 0.5);
          v = clamp(1 - Math.abs(luma[i] - th) / half, 0, 1);
        } else if (src === 'bordes') {
          const l = luma[i];
          const pl = x > 0 ? luma[i - 1] : l;
          const pu = y > 0 ? luma[i - w] : l;
          v = clamp((Math.abs(l - pl) + Math.abs(l - pu)) * 2.2, 0, 1);
        } else {
          let l = luma[i];
          if (src === 'sombra') l = 1 - l;
          v = l <= lo ? 0 : l >= hi ? 1 : (l - lo) * inv;
          v = v * v * (3 - 2 * v);
        }
        raw[i] = v;
      }
    }
    const blurred = new Float32Array(total);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            s += raw[yy * w + xx]; n++;
          }
        }
        blurred[row + x] = s / n;
      }
    }
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    const id = ctx.createImageData(w, h);
    const dd = id.data;
    for (let i = 0; i < total; i++) {
      const v = blurred[i] * 255 * op;
      const o = i * 4;
      dd[o] = v; dd[o + 1] = v; dd[o + 2] = v; dd[o + 3] = 255;
    }
    ctx.putImageData(id, 0, 0);
    return canvas;
  }

  dither.levels = colorLevels;
  dither.sampleColor = sampleColor;
  dither.rampColorOpts = rampColorOpts;
  dither.renderFlat = renderFlat;
  dither.maskFromLuma = maskFromLuma;
  dither.preparePattern = function (params) {
    const aOpts = params.algorithmOpts || {};
    if (aOpts.pattern === 'custom' && aOpts.customPatternText) {
      aOpts.customPattern = parseCustomPattern(aOpts.customPatternText);
    }
  };
  dither.parseKernel = parseCustomKernel;
  dither.prepareKernel = function (params) {
    const aOpts = params.algorithmOpts || {};
    aOpts.kernel = parseCustomKernel(params);
  };

  return dither;
})();