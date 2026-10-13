window.GIF = (function () {
  function toData(source) {
    if (source instanceof HTMLCanvasElement) {
      const ctx = source.getContext('2d');
      return { w: source.width, h: source.height, d: ctx.getImageData(0, 0, source.width, source.height).data };
    }
    if (source instanceof ImageData) {
      return { w: source.width, h: source.height, d: source.data };
    }
    return source;
  }

  function medianCut(colors, maxColors) {
    let buckets = [colors];
    while (buckets.length < maxColors) {
      let bi = -1, bestRange = -1, bestChan = 0;
      for (let b = 0; b < buckets.length; b++) {
        const arr = buckets[b];
        if (arr.length < 6) continue;
        const mn = [999, 999, 999], mx = [0, 0, 0];
        for (let i = 0; i < arr.length; i += 3) {
          for (let c = 0; c < 3; c++) {
            const v = arr[i + c];
            if (v < mn[c]) mn[c] = v;
            if (v > mx[c]) mx[c] = v;
          }
        }
        for (let c = 0; c < 3; c++) {
          const rng = mx[c] - mn[c];
          if (rng > bestRange) { bestRange = rng; bi = b; bestChan = c; }
        }
      }
      if (bi === -1) break;
      const arr = buckets[bi];
      const indexed = [];
      for (let i = 0; i < arr.length; i += 3) indexed.push([arr[i], arr[i + 1], arr[i + 2]]);
      indexed.sort((a, b) => a[bestChan] - b[bestChan]);
      const mid = Math.max(1, Math.floor(indexed.length / 2));
      const left = [], right = [];
      for (let i = 0; i < mid; i++) left.push(indexed[i][0], indexed[i][1], indexed[i][2]);
      for (let i = mid; i < indexed.length; i++) right.push(indexed[i][0], indexed[i][1], indexed[i][2]);
      if (!left.length || !right.length) break;
      buckets.splice(bi, 1, left, right);
    }
    const palette = [];
    for (const b of buckets) {
      if (!b.length) { palette.push(0, 0, 0); continue; }
      let r = 0, g = 0, bl = 0;
      for (let i = 0; i < b.length; i += 3) { r += b[i]; g += b[i + 1]; bl += b[i + 2]; }
      const n = b.length / 3;
      palette.push(Math.round(r / n), Math.round(g / n), Math.round(bl / n));
    }
    return palette;
  }

  function collectColors(frames, sampleCap) {
    const colors = [];
    const seen = new Set();
    let max = 0;
    for (const f of frames) {
      const { w, h, d } = f;
      const step = Math.max(1, Math.floor(w * h / 40000));
      for (let i = 0; i < w * h; i += step) {
        const o = i * 4;
        if (d[o + 3] < 128) continue;
        const key = (d[o] << 16) | (d[o + 1] << 8) | d[o + 2];
        if (seen.has(key)) continue;
        seen.add(key);
        colors.push(d[o], d[o + 1], d[o + 2]);
        if (colors.length / 3 >= sampleCap) return colors;
      }
      max += w * h;
    }
    void max;
    return colors;
  }

  function nearest(pal, r, g, b) {
    let bi = 0, best = Infinity;
    for (let i = 0; i < pal.length / 3; i++) {
      const dr = r - pal[i * 3];
      const dg = g - pal[i * 3 + 1];
      const db = b - pal[i * 3 + 2];
      const d = dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
      if (d < best) { best = d; bi = i; }
    }
    return bi;
  }

  function buildLUT(pal) {
    const bits = 5;
    const size = 1 << bits;
    const levels = 255 / (size - 1);
    const lut = new Uint8Array(size * size * size);
    for (let r = 0; r < size; r++) {
      const rv = Math.round(r * levels);
      for (let g = 0; g < size; g++) {
        const gv = Math.round(g * levels);
        for (let b = 0; b < size; b++) {
          lut[(r * size + g) * size + b] = nearest(pal, rv, gv, Math.round(b * levels));
        }
      }
    }
    return lut;
  }

  function BitWriter() {
    this.bits = 0;
    this.n = 0;
    this.out = [];
  }
  BitWriter.prototype.write = function (v, n) {
    while (n > 0) {
      const take = Math.min(8 - this.n, n);
      this.bits |= (v & ((1 << take) - 1)) << this.n;
      this.n += take;
      v >>= take;
      n -= take;
      if (this.n === 8) {
        this.out.push(this.bits & 255);
        this.bits = 0;
        this.n = 0;
      }
    }
  };
  BitWriter.prototype.flush = function () {
    if (this.n > 0) { this.out.push(this.bits & 255); this.bits = 0; this.n = 0; }
  };

  function lzwEncode(indices, minCodeSize) {
    const clear = 1 << minCodeSize;
    const eoi = clear + 1;
    const bw = new BitWriter();
    bw.write(clear, minCodeSize + 1);
    let next = eoi + 1;
    let cs = minCodeSize + 1;
    let dict = new Map();
    let w = indices[0];
    const maxCodes = 4096;
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = w * 256 + k;
      if (dict.has(key)) {
        w = dict.get(key);
      } else {
        bw.write(w, cs);
        if (next === maxCodes) {
          bw.write(clear, cs);
          dict = new Map();
          next = eoi + 1;
          cs = minCodeSize + 1;
        } else {
          if (next >= (1 << cs)) cs++;
          dict.set(key, next++);
        }
        w = k;
      }
    }
    bw.write(w, cs);
    bw.write(eoi, cs);
    bw.flush();
    return bw.out;
  }

  function toSubBlocks(bytes) {
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const n = Math.min(255, bytes.length - i);
      out.push(n);
      for (let j = 0; j < n; j++) out.push(bytes[i + j]);
      i += n;
    }
    out.push(0);
    return out;
  }

  function encode(frames, opts) {
    opts = opts || {};
    const delay = Math.max(1, Math.round((opts.delayMs || 100) / 10));
    const loop = opts.loop === undefined ? 0 : opts.loop;
    const maxColors = opts.maxColors || 256;
    const transparent = !!opts.transparent;
    const parsed = frames.map(toData);
    const first = parsed[0];
    const w = first.w, h = first.h;

    if (parsed.some(f => f.w !== w || f.h !== h)) {
      throw new Error('All frames must share the same dimensions.');
    }

    let colors = collectColors(parsed, 4096);
    if (!colors.length) colors = [255, 255, 255];
    if (transparent && colors.length / 3 > maxColors - 1) {
      colors = colors.slice(0, (maxColors - 1) * 3);
    }
    const cap = transparent ? maxColors - 1 : maxColors;
    let pal = medianCut(colors, Math.min(cap, 256));
    const realColors = Math.min(256, pal.length / 3);
    const colorOfs = transparent ? 1 : 0;
    const idxSpace = realColors + colorOfs;
    const giEntries = Math.max(2, Math.pow(2, Math.ceil(Math.log2(idxSpace))));
    const minCode = Math.max(2, Math.ceil(Math.log2(giEntries)));

    const gct = new Uint8Array(giEntries * 3);
    for (let i = 0; i < realColors * 3; i++) {
      gct[(colorOfs * 3) + i] = pal[i];
    }

    const lut = buildLUT(pal);
    const lutSize = 1 << 5;
    const lutMask = lutSize - 1;
    const lutIdx = (r, g, b) => lut[(r * lutSize + g) * lutSize + b];

    const bytes = [];
    bytes.push.apply(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
    bytes.push(w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255);
    bytes.push(0x80 | ((minCode - 1) & 7), 0, 0);
    for (let i = 0; i < gct.length; i++) bytes.push(gct[i]);

    bytes.push(0x21, 0xFF, 0x0B);
    bytes.push.apply(bytes, [0x4E, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2E, 0x30]);
    bytes.push(0x03, 0x01);
    bytes.push(loop & 255, (loop >> 8) & 255, 0x00);

    for (const f of parsed) {
      const hasTrans = transparent && f.d.some((v, i) => (i & 3) === 3 && v < 128);
      const gcePacked = (1 << 2) | (hasTrans ? 1 : 0);
      bytes.push(0x21, 0xF9, 0x04, gcePacked, delay & 255, (delay >> 8) & 255, 0, 0x00);
      bytes.push(0x2C, 0, 0, 0, 0, w & 255, (w >> 8) & 255, h & 255, (h >> 8) & 255, 0x00);
      bytes.push(minCode);

      const indices = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        const o = i * 4;
        if (hasTrans && f.d[o + 3] < 128) {
          indices[i] = 0;
        } else {
          indices[i] = colorOfs + lutIdx(f.d[o] >> 3, f.d[o + 1] >> 3, f.d[o + 2] >> 3);
        }
      }
      const comp = lzwEncode(indices, minCode);
      const blocks = toSubBlocks(comp);
      for (let bi = 0; bi < blocks.length; bi++) bytes.push(blocks[bi]);
    }

    bytes.push(0x3B);
    return new Uint8Array(bytes);
  }

  function encodeCanvas(canvas, opts) {
    return encode([canvas], opts);
  }

  return { encode, encodeCanvas };
})();