window.CRT = (function () {
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  /* crtPrng: PRNG deterministico propio (sustituye el LCG clasico de
     terceros que usaban los passes de CRT). Seed -> generador en [0,1). */
  function crtPrng(seed) {
    let x = (Math.imul(seed | 0, 0x7461b827) | 0) ^ 0x39f2a1c6;
    let w = 0x5b3d90e4 ^ (Math.imul(seed | 0, 0xc2e7a913) | 0);
    if (!x) x = 0x21e7c4d9;
    return function () {
      w = (w + 0xe4b1c957) | 0;
      x ^= x << 11;
      x ^= x >>> 19;
      x ^= x << 21;
      x = x | 0;
      let z = (Math.imul(x, 0xada1cf68) + w) | 0;
      z = (z ^ (z >>> 17)) | 0;
      z = Math.imul(z, 0x9f6b3ce1) | 0;
      z = (z ^ (z >>> 12)) | 0;
      return (z >>> 0) / 4294967296;
    };
  }

  /* Sincronismo real: estandares de linea (PAL 625/576 a 50Hz, NTSC 525/480
     a 59.94, plantilla 810/768 a 60Hz) y el pitch vertical del scanline en
     pixeles de salida: pitch = alto de imagen / lineas activas. El pitch es
     fraccional (divisor no entero y relativo a la resolucion activa), asi que
     el dibujado de scanlines no puede ser 'cada 2px': deriva del estandar. */
  function signalModel(type, h) {
    const t = type || 'rect';
    const base = {
      rect: { name: 'PANTALLA', fps: 60, fieldHz: 120, total: 810, active: 768, interlaced: false },
      pal: { name: 'PAL', fps: 25, fieldHz: 50, total: 625, active: 576, interlaced: true },
      ntsc: { name: 'NTSC', fps: 30, fieldHz: 60, total: 525, active: 480, interlaced: true }
    }[t] || { name: 'PANTALLA', fps: 60, fieldHz: 120, total: 810, active: 768, interlaced: false };
    const s = Object.assign({}, base);
    s.pitch = Math.max(1, (h || 1) / s.active);
    return s;
  }

  /* Frame oficial del estandar: los efectos de sincronismo (flicker, campos,
     raster) se indexan por campo (field). Si 'time' ya es un entero (indice
     de frame en animaciones) se usa tal cual: preview == GIF. */
  function frameOf(time, s) {
    if (typeof time !== 'number') time = performance.now() / 1000;
    return Number.isInteger(time) ? time : Math.floor(time * s.fieldHz);
  }

  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function cloneCanvas(c) {
    const n = document.createElement('canvas');
    n.width = c.width;
    n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  /* Eyefish 90s: lente de tubo CRT limpia y geometrica (sin franja cromatica).
     Fusiona deformacion barrel + radio de lente + caida de luz de bordes.
     amount: cuanto abomba (0 = plano). radius: tamano del circulo visible
     (TV 14" cerrada vs 29" abierta). Fuera del circulo: negro de bezel. */
  function eyefishCanvas(src, amount, radius) {
    const w = src.width, h = src.height;
    if (amount < 0.004 && (radius == null || radius > 0.999)) return src;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    const octx = out.getContext('2d');
    const img = octx.getImageData(0, 0, w, h);
    const d = img.data;
    const sctx = cloneCanvas(src).getContext('2d');
    const sd = sctx.getImageData(0, 0, w, h).data;
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const maxR = Math.sqrt(cx * cx + cy * cy);
    // radius 0..1: 1 = circulo abierto (TV grande), 0.55 = tubo cerrado 14".
    const rVis = 0.55 + 0.45 * clamp(radius == null ? 1 : radius, 0, 1);
    const k = clamp(amount, 0, 1) * 0.35;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4;
        const dx = (x - cx) / maxR, dy = (y - cy) / maxR;
        const r = Math.sqrt(dx * dx + dy * dy) / Math.max(1e-6, rVis);
        if (r > 1) { d[o + 3] = 0; continue; }
        const f = 1 / (1 + k * r * r);
        const sx = clamp(cx + (x - cx) * f, 0, w - 1);
        const sy = clamp(cy + (y - cy) * f, 0, h - 1);
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
        const tx = sx - x0, ty = sy - y0;
        const i00 = (y0 * w + x0) * 4, i10 = (y0 * w + x1) * 4;
        const i01 = (y1 * w + x0) * 4, i11 = (y1 * w + x1) * 4;
        // Caida de luz de tubo: bordes ~12% mas oscuros con amount al maximo.
        const fall = 1 - 0.12 * clamp(amount, 0, 1) * r * r;
        for (let c = 0; c < 3; c++) {
          const v = (sd[i00 + c] * (1 - tx) + sd[i10 + c] * tx) * (1 - ty) +
                    (sd[i01 + c] * (1 - tx) + sd[i11 + c] * tx) * ty;
          d[o + c] = v * fall;
        }
        d[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  /* Beam misalignment: red and blue beams offset in opposite directions (more
     visible towards the edges, as in a real tube still warming up). */
  function convergePass(canvas, amount) {
    if (amount < 0.005) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = d.slice();
    const off = Math.max(1, Math.round(amount * w * 0.02));
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 4;
        const xr = clamp(x + off, 0, w - 1);
        const xb = clamp(x - off, 0, w - 1);
        d[o] = src[(row + xr) * 4];
        d[o + 2] = src[(row + xb) * 4 + 2];
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Ghosting / echo of the video signal (broadcast reflections).
     Modo 'rgb': 3 ecos R/G/B independientes con warp sinusoidal 1-2px.
     Modo 'ghost': ghost offset clasico con screen blend. */
  function echoPass(canvas, amount, time, mode) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    if (mode === 'rgb') {
      const img = ctx.getImageData(0, 0, w, h);
      const d = img.data;
      const src = d.slice();
      const base = Math.max(1, Math.round(w * 0.02 * amount));
      const amp = Math.max(1, Math.round(1 + amount * 2));
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const rw = Math.sin(time * 1.7 + y * 0.05) * amp;
        const gw = Math.cos(time * 1.9 + y * 0.04) * amp;
        const bw = Math.sin(time * 2.3 + y * 0.06 + 1.7) * amp;
        for (let x = 0; x < w; x++) {
          const o = (row + x) * 4;
          const xr = clamp(x + Math.round(base + rw), 0, w - 1);
          const xg = clamp(x + Math.round(base + gw), 0, w - 1);
          const xb = clamp(x + Math.round(base + bw), 0, w - 1);
          const orr = (row + xr) * 4, ogg = (row + xg) * 4, obb = (row + xb) * 4;
          d[o] = Math.round(lerp(src[o], src[orr], amount));
          d[o + 1] = Math.round(lerp(src[o + 1], src[ogg + 1], amount));
          d[o + 2] = Math.round(lerp(src[o + 2], src[obb + 2], amount));
        }
      }
      ctx.putImageData(img, 0, 0);
      return;
    }
    const ghost = cloneCanvas(canvas);
    const off = Math.max(1, Math.round(w * 0.04 * amount));
    const sway = Math.sin(time * 2.1) * amount * 0.006 * h;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const taps = 3;
    for (let t = 1; t <= taps; t++) {
      ctx.globalAlpha = Math.max(0, amount * 0.5 * Math.pow(0.55, t - 1));
      ctx.drawImage(ghost, -off * t, sway * t);
      ctx.drawImage(ghost, off * t, -sway * t);
    }
    ctx.restore();
  }

  /* Color grading: hue rotation, saturation and vibrance. */
  function gradingPass(canvas, opts) {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const sat = clamp((opts.saturation == null ? 1 : opts.saturation) - 1, -1, 1);
    const vib = opts.vibrance || 0;
    const hue = (opts.hue || 0) * Math.PI / 180;
    const u = Math.cos(hue), s = Math.sin(hue);
    const m = [
      0.213 + u * 0.787 - s * 0.213, 0.715 - u * 0.715 - s * 0.715, 0.072 - u * 0.072 + s * 0.928,
      0.213 - u * 0.213 + s * 0.143, 0.715 + u * 0.285 + s * 0.140, 0.072 - u * 0.072 - s * 0.283,
      0.213 - u * 0.213 - s * 0.787, 0.715 - u * 0.715 + s * 0.715, 0.072 + u * 0.928 + s * 0.072
    ];
    for (let i = 0; i < d.length; i += 4) {
      let r = d[i], g = d[i + 1], b = d[i + 2];
      if (hue > 0.0001) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
      const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
      const localSat = mx > 0 ? (mx - mn) : 0;
      const mul = clamp(1 + sat + vib * (1 - localSat), 0, 2);
      const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      d[i] = clamp(gray + (r - gray) * mul, 0, 255);
      d[i + 1] = clamp(gray + (g - gray) * mul, 0, 255);
      d[i + 2] = clamp(gray + (b - gray) * mul, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Scanlines cuyo hueco negro depende de la luminancia (fosforo real) y del
     pitch del estandar. El pitch es fraccional (lineas activas / alto), asi
     que cada linea de barrido se dibuja con cobertura continua: para pitch
     entero reproduce 'una linea si, una no'; para pitch fraccional mezcla suave
     entre filas (sin bloques artificiales). */
  function scanlinesPass(canvas, amount, signal) {
    if (amount < 0.01) return;
    const w = canvas.width, h = canvas.height;
    const p = Math.max(2, (signal && signal.pitch) ? signal.pitch : h / 768);
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let y = 0; y < h; y++) {
      const fr = ((y + 0.5) / p) % 1;
      const cov = fr < 0.5 ? 0 : (fr - 0.5) * 2;
      if (cov <= 0.003) continue;
      const row = y * w * 4;
      const kc = amount * cov;
      for (let x = 0; x < w; x++) {
        const o = row + x * 4;
        const lum = (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255;
        const k = kc * (0.3 + 0.7 * lum);
        d[o] *= 1 - k;
        d[o + 1] *= 1 - k;
        d[o + 2] *= 1 - k;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Interlace real: dos campos. Con estandares entrelazados (PAL/NTSC) cada
     imagen se barre en dos campos; la paridad de linea alterna entre campos y
     produce el 'twittido' de entrelazado (un desplazamiento de 1 scanline).
     Indexado por frame, asi queda bakeado en GIF/Secuencia igual que el
     preview. */
  function interlacePass(canvas, opts, time, signal) {
    const on = opts.interlace == null ? true : !!opts.interlace;
    if (!on || !signal || !signal.interlaced) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const p = signal.pitch;
    const field = frameOf(time, signal) % 2;
    const amt = 0.09 + 0.13 * (opts.scanlines || 0);
    for (let y = 0; y < h; y++) {
      const band = Math.floor((y + 0.5) / p);
      if ((band + field) & 1) continue;
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const o = row + x * 4;
        const kk = amt * (0.35 + 0.65 * (0.2126 * d[o] + 0.7152 * d[o + 1] + 0.0722 * d[o + 2]) / 255);
        d[o] *= 1 - kk;
        d[o + 1] *= 1 - kk;
        d[o + 2] *= 1 - kk;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Phosphor masks: aperture grille (Trinitron) or shadow-mask dot triads. */
  function hueTint(r0, g0, b0, hueDeg) {
    const a = hueDeg * Math.PI / 180;
    const c = Math.cos(a), s = Math.sin(a);
    const r = c * r0 + s * (-0.5 * r0 + 0.866 * g0 + 0.5 * b0);
    const g = c * g0 + s * (0.866 * r0 - 0.5 * g0 - 0.866 * b0);
    const b = c * b0 + s * (-0.5 * r0 + 0.866 * g0 + 0.5 * b0);
    return [clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1)];
  }

  function maskCanvas(kind, hue, strength) {
    let pw = 3, ph = 1;
    if (kind === 'shadow') { pw = 6; ph = 3; }
    const mask = document.createElement('canvas');
    mask.width = pw;
    mask.height = ph;
    const mctx = mask.getContext('2d');
    const R = hueTint(1, 0, 0, hue), G = hueTint(0, 1, 0, hue), B = hueTint(0, 0, 1, hue);
    const col = (c) => 'rgb(' + (c[0] * 255 | 0) + ',' + (c[1] * 255 | 0) + ',' + (c[2] * 255 | 0) + ')';
    const alpha = 255 * strength;
    const md = mctx.createImageData(pw, ph);
    const d = md.data;
    if (kind === 'grille') {
      for (let i = 0; i < pw; i++) {
        const o = i * 4;
        if (i === 0) { d[o] = R[0] * 255; d[o + 1] = R[1] * 255; d[o + 2] = R[2] * 255; }
        else if (i === 1) { d[o] = G[0] * 255; d[o + 1] = G[1] * 255; d[o + 2] = G[2] * 255; }
        else { d[o] = B[0] * 255; d[o + 1] = B[1] * 255; d[o + 2] = B[2] * 255; }
        d[o + 3] = alpha;
      }
    } else {
      const dots = [
        { x: 1.5, y: 0.5, c: R },
        { x: 4.5, y: 0.5, c: G },
        { x: 3.0, y: 2.0, c: B }
      ];
      for (const p of dots) {
        const x0 = Math.max(0, Math.floor(p.x - 1.4)), x1 = Math.min(pw - 1, Math.ceil(p.x + 1.4));
        const y0 = Math.max(0, Math.floor(p.y - 1.4)), y1 = Math.min(ph - 1, Math.ceil(p.y + 1.4));
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            const dx = xx - p.x, dy = yy - p.y;
            const rr = Math.min(1, 1 - Math.sqrt(dx * dx + dy * dy) / 1.4);
            if (rr <= 0) continue;
            const o = (yy * pw + xx) * 4;
            d[o] = p.c[0] * 255 * rr;
            d[o + 1] = p.c[1] * 255 * rr;
            d[o + 2] = p.c[2] * 255 * rr;
            d[o + 3] = alpha * rr;
          }
        }
      }
    }
    mctx.putImageData(md, 0, 0);
    void col;
    return { mask, alpha: clamp(strength * 0.85, 0, 0.95) };
  }

  function roundedRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* V-Hold roll: wrap vertical real + barra de borrado + tearing con jitter.
     No es banda gaussiana: la imagen rellena ciclicamente y la costura del
     wrap muestra corte horizontal desplazado. */
  function rollPass(ctx, w, h, amount, time) {
    if (amount < 0.01 || typeof time !== 'number') return;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = d.slice();
    const off = (Math.floor(time * amount * 240) % h + h) % h;
    const row = w * 4;
    const out = new Uint8ClampedArray(d.length);
    for (let y = 0; y < h; y++) {
      const sy = (y + off) % h;
      const sb = sy * row, db = y * row;
      out.set(src.subarray(sb, sb + row), db);
    }
    const tear = Math.max(1, Math.round(h * 0.05 * amount));
    const rand = crtPrng(Math.floor(time));
    const rnd = (n) => Math.floor(rand() * n);
    for (let k = -tear; k <= tear; k++) {
      const y = (off + k + h) % h;
      const shift = (rnd(200) / 200 - 0.5) * w * 0.12 * amount;
      if (Math.abs(shift) < 0.5) continue;
      const o = Math.round(shift);
      const sb = y * row;
      for (let x = 0; x < w; x++) {
        const sx = (x + o + w) % w;
        const oo = sb + x * 4, so = sb + sx * 4;
        out[oo] = src[so]; out[oo + 1] = src[so + 1]; out[oo + 2] = src[so + 2];
      }
    }
    const bw = Math.max(1, Math.round(3 * amount + 1));
    const drift = Math.floor(Math.sin(time * 6) * 20 + 40);
    for (let k = 0; k < bw; k++) {
      const y = (off + k) % h;
      const sb = y * row;
      for (let x = 0; x < w; x++) {
        const oo = sb + x * 4;
        out[oo] = 255; out[oo + 1] = 240; out[oo + 2] = 225;
        out[oo + 3] = 255;
      }
    }
    for (let k = 0; k < bw; k++) {
      const y = (off + k + drift) % h;
      const sb = y * row;
      out[sb + 0] = 26; out[sb + 1] = 22; out[sb + 2] = 30;
    }
    d.set(out);
    ctx.putImageData(img, 0, 0);
  }

  /* Tube bezel: rounded corners + tube edge darkening and a thin glass rim. */
  function framePass(ctx, w, h, amount) {
    if (amount < 0.01) return;
    const r = Math.min(w, h) * 0.09;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1, -1, w + 2, h + 2);
    roundedRectPath(ctx, 0, 0, w, h, r);
    ctx.fillStyle = 'rgba(4,6,12,' + (0.5 * amount).toFixed(3) + ')';
    ctx.fill('evenodd');
    ctx.beginPath();
    roundedRectPath(ctx, -1, -1, w + 2, h + 2, r + 1);
    roundedRectPath(ctx, 2, 2, w - 4, h - 4, Math.max(1, r - 2));
    ctx.fillStyle = 'rgba(0,0,0,' + (0.28 * amount).toFixed(3) + ')';
    ctx.fill('evenodd');
    ctx.restore();
  }

  /* Crea una capa borrosa con anamorfosis horizontal (K = 1 + anam):
     la imagen se aplasta en X, se desenfoca y se vuelve a estirar, de forma
     que el kernel de desenfoque queda eliptico (mas ancho que alto),
     igual que el halo de un tubo CRT fotografiado. */
  function drawBlurred(ctx, src, radius, alpha, mode, anam, dx, dy) {
    const w = src.width, h = src.height;
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = clamp(alpha, 0, 1);
    const K = 1 + (anam || 0);
    const sw = Math.max(1, Math.round(w / K));
    const slim = document.createElement('canvas');
    slim.width = sw;
    slim.height = h;
    const sctx = slim.getContext('2d');
    sctx.imageSmoothingEnabled = true;
    sctx.drawImage(src, 0, 0, sw, h);
    const blurred = document.createElement('canvas');
    blurred.width = sw;
    blurred.height = h;
    const bctx = blurred.getContext('2d');
    bctx.imageSmoothingEnabled = true;
    bctx.filter = 'blur(' + radius.toFixed(1) + 'px)';
    bctx.drawImage(slim, 0, 0);
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(blurred, 0, 0, w, h, dx || 0, dy || 0, w, h);
    ctx.restore();
  }

  /* Bloom de fósforo unificado (modelo de borde):
     la emision se concentra donde el haz encuentra alto contraste —dispersion
     del haz + separacion cromatica de los fosforos RGB de la rejilla/mascara—,
     con centro blanco-candente hacia un Tint unico, dispersion cromatica
     horizontal, capas anisotropas (anamorfosis del haz, anam=0.35 fija) y un
     pool atmosferico amplio. Sustituye el glow clasico por umbral de
     luminancia: en un tubo el bloom vive en los bordes, no en zonas planas. */
  function bloomPass(canvas, opts) {
    if (!opts) return canvas;
    let amount = opts.amount != null ? opts.amount : (opts.edgeBloom != null ? opts.edgeBloom : (opts.glow != null ? opts.glow : 0));
    amount = clamp(amount, 0, 1);
    if (amount < 0.008) return canvas;

    const w = canvas.width, h = canvas.height;
    if (w < 4 || h < 4) return canvas;

    let thresh = opts.thresh != null ? opts.thresh : (opts.edgeThresh != null ? opts.edgeThresh : (opts.glowThreshold != null ? opts.glowThreshold : (opts.glowT != null ? opts.glowT / 100 : 0.22)));
    thresh = clamp(thresh, 0, 0.95);
    const chromatic = Math.max(0, Math.min(25, Math.round(opts.chromatic != null ? opts.chromatic : (opts.edgeChrom != null ? opts.edgeChrom : 4))));
    const tint = opts.tint || opts.edgeTint || opts.glowTint || '#ff00cc';
    const tc = hexToRgb(tint);
    const blendMode = opts.blend || opts.edgeBlend || opts.glowBlend || 'screen';
    const mode = blendMode === 'lighter' ? 'lighter' : 'screen';
    const anam = opts.anam == null ? 0.35 : opts.anam;

    const ctx = canvas.getContext('2d', { willReadFrequently: true }) || canvas.getContext('2d');
    const srcData = ctx.getImageData(0, 0, w, h).data;

    const luma = new Float32Array(w * h);
    for (let i = 0, j = 0; i < srcData.length; i += 4, j++) {
      luma[j] = (0.2126 * srcData[i] + 0.7152 * srcData[i + 1] + 0.0722 * srcData[i + 2]) / 255;
    }

    const edgeCanvas = document.createElement('canvas');
    edgeCanvas.width = w;
    edgeCanvas.height = h;
    const edgeCtx = edgeCanvas.getContext('2d');
    const edgeImg = edgeCtx.createImageData(w, h);
    const ed = edgeImg.data;

    const knee = 0.12;
    const lo = Math.max(0, thresh - knee);
    const hi = Math.min(1, thresh + knee);
    const invSpan = 1 / Math.max(1e-4, hi - lo);

    for (let y = 1; y < h - 1; y++) {
      const row = y * w;
      const up = (y - 1) * w;
      const dn = (y + 1) * w;
      for (let x = 1; x < w - 1; x++) {
        const gx = (luma[up + x + 1] + 2 * luma[row + x + 1] + luma[dn + x + 1]) -
                   (luma[up + x - 1] + 2 * luma[row + x - 1] + luma[dn + x - 1]);
        const gy = (luma[dn + x - 1] + 2 * luma[dn + x] + luma[dn + x + 1]) -
                   (luma[up + x - 1] + 2 * luma[up + x] + luma[up + x + 1]);
        const mag = Math.sqrt(gx * gx + gy * gy) * 0.35;
        if (mag <= lo) continue;
        let wgt = mag >= hi ? 1 : (mag - lo) * invSpan;
        wgt *= wgt * (3 - 2 * wgt);
        if (wgt <= 0.01) continue;
        const edgeVal = wgt * amount;
        const o = (row + x) * 4;
        const hot = Math.max(0, edgeVal - 0.45) * 1.8;
        ed[o] = clamp(lerp(tc[0], 255, hot), 0, 255);
        ed[o + 1] = clamp(lerp(tc[1], 255, hot), 0, 255);
        ed[o + 2] = clamp(lerp(tc[2], 255, hot), 0, 255);
        ed[o + 3] = clamp(edgeVal * 255, 0, 255);
      }
    }
    edgeCtx.putImageData(edgeImg, 0, 0);

    const a1 = clamp(amount * 0.9, 0, 1);
    const aD = clamp(amount * 0.45, 0, 0.65);
    const a2 = clamp(amount * 0.6, 0, 0.75);
    const a4 = clamp((amount - 0.15) * 0.45, 0, 0.5);

    ctx.save();
    ctx.globalCompositeOperation = mode;

    /* Tier 1: borde cromatico nitido */
    drawBlurred(ctx, edgeCanvas, 1, a1, mode, anam);

    /* Dispersión cromatica horizontal (B desplazado -X, R desplazado +X) */
    if (chromatic > 0) {
      const off = chromatic;
      drawBlurred(ctx, edgeCanvas, 2.5, aD, mode, anam, off, 0);
      drawBlurred(ctx, edgeCanvas, 2.5, aD, mode, anam, -off, 0);
    }

    /* Tier 2: halacion media del borde */
    drawBlurred(ctx, edgeCanvas, 6.5, a2, mode, anam);

    /* Tier 3: pool atmosferico amplio */
    if (amount > 0.15) drawBlurred(ctx, edgeCanvas, 22, a4, mode, anam);

    ctx.restore();
    return canvas;
  }

  /* Phosphor persistence: frames rendered at integer times keep a run-length
     buffer so bright pixels leave a decaying afterglow, like a real tube.
     The run restarts whenever the time sequence is broken (new render). */
  const trailState = { buf: null, w: 0, h: 0, t: -1 };
  function afterglowPass(canvas, amount, time) {
    if (amount < 0.01 || !Number.isInteger(time)) { trailState.buf = null; return; }
    const w = canvas.width, h = canvas.height;
    if (time !== trailState.t + 1 || !trailState.buf || trailState.w !== w || trailState.h !== h) {
      trailState.t = time;
      trailState.w = w;
      trailState.h = h;
      const img = canvas.getContext('2d').getImageData(0, 0, w, h).data;
      trailState.buf = new Float32Array(w * h * 4);
      for (let o = 0; o < img.length; o++) trailState.buf[o] = img[o];
      return;
    }
    trailState.t = time;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const buf = trailState.buf;
    const persist = clamp(amount, 0, 1);
    const decay = 1 - persist * 0.45;
    for (let o = 0; o < d.length; o++) {
      const cur = d[o];
      const prev = buf[o] * decay;
      const v = prev > cur ? prev : cur + prev * 0.18;
      d[o] = v > 255 ? 255 : v;
      buf[o] = d[o];
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Raster bloom: average picture level drives a slight brightness swell plus
     a slow hum, so the tube seems to breathe with the scene. Cheap thumbnail
     readback keeps the cost low. */
  function rasterPass(canvas, amount, time, signal) {
    if (amount < 0.01 || typeof time !== 'number') return;
    const w = canvas.width, h = canvas.height;
    const tw = Math.max(2, Math.round(w / 24)), th = Math.max(2, Math.round(h / 24));
    const sm = document.createElement('canvas');
    sm.width = tw; sm.height = th;
    const sctx = sm.getContext('2d');
    sctx.drawImage(canvas, 0, 0, tw, th);
    const sd = sctx.getImageData(0, 0, tw, th).data;
    let sum = 0;
    for (let i = 0; i < sd.length; i += 4) sum += 0.2126 * sd[i] + 0.7152 * sd[i + 1] + 0.0722 * sd[i + 2];
    const apl = sum / ((tw * th) * 255);
    const s = signal || { fieldHz: 120 };
    const humHz = s.fieldHz / 120;
    const hum = 0.72 + 0.28 * Math.sin(time * 0.9 * humHz);
    const add = (apl - 0.45) * amount * hum * 0.75 * 60;
    if (Math.abs(add) < 0.3) return;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = clamp(d[i] + add, 0, 255);
      d[i + 1] = clamp(d[i + 1] + add, 0, 255);
      d[i + 2] = clamp(d[i + 2] + add, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
  }

  /* Flicker de tubo indexado por campo: la cadencia la marca el estandar
     (PAL: 50 campos/s, NTSC: 60, pantalla: 120). flkMain es la caida de
     luminancia principal; flkExtra, el sub-destello de 40% de flkMain. */
  function flickerPass(ctx, w, h, amount, time, signal) {
    if (amount < 0.01 || typeof time !== 'number') return;
    const s = signal || { name: 'PANTALLA', fps: 60, fieldHz: 120 };
    const idx = frameOf(time, s);
    const rand = crtPrng(idx * 31 + 13);
    const rnd = () => rand();
    let alpha = 0;
    const n = 2 + Math.floor(rnd() * 3);
    const extra = amount * 0.4;
    for (let k = 0; k < n; k++) {
      if (rnd() < amount) alpha = Math.max(alpha, 0.05 + rnd() * 0.32 * amount);
      if (rnd() < extra) alpha = Math.max(alpha, 0.02 + rnd() * 0.10 * extra);
    }
    if (alpha > 0.01) {
      ctx.fillStyle = 'rgba(0,0,0,' + alpha.toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
    }
  }

  /* VHS dropout: lineas horizontales de 1px que se desplazan y destellan.
     Seed por indice de frame (entero) para que preview = GIF animado. */
  function dropoutPass(canvas, amount, frame) {
    if (amount < 0.01) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = d.slice();
    const nLines = 3 + Math.round(amount * 3);
    const rand = crtPrng(Math.round(Number.isFinite(frame) ? frame : 0) * 101 + 17);
    for (let k = 0; k < nLines; k++) {
      const y = Math.floor(rand() * h);
      const shift = Math.floor((rand() - 0.5) * w * 0.18 * amount);
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        const o = row + x * 4;
        const so = row + ((x + shift + w) % w) * 4;
        d[o] = src[so]; d[o + 1] = src[so + 1]; d[o + 2] = src[so + 2];
        if (rand() < 0.18 * amount) {
          d[o] = 255; d[o + 1] = 252; d[o + 2] = 245;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function lensPass(ctx, w, h, amount) {
    if (amount < 0.01) return;
    const strength = clamp(amount, 0, 0.85);
    const r0 = Math.min(w, h) * (0.4 + (1 - amount) * 0.3);
    const g = ctx.createRadialGradient(w / 2, h / 2, r0, w / 2, h / 2, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,' + strength.toFixed(3) + ')');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  /* H-sync hum: desplazamiento horizontal por fila (fallo de H-Hold / hum de
     fuente). Onda de baja frecuencia que recorre el cuadro en vertical, con
     sesgo diagonal opcional. Es la contraparte horizontal del V-Hold roll. */
  function wavePass(canvas, opts, time) {
    const amp = opts && opts.amp ? opts.amp : 0;
    if (amp < 0.01) return canvas;
    const w = canvas.width, h = canvas.height;
    if (w < 2 || h < 2) return canvas;
    const ctx = canvas.getContext('2d');
    const src = cloneCanvas(canvas);
    const sd = src.getContext('2d').getImageData(0, 0, w, h).data;
    const img = ctx.createImageData(w, h);
    const d = img.data;
    const freq = opts.freq == null ? 1.5 : opts.freq;
    const speed = opts.speed == null ? 0.2 : opts.speed;
    const skew = opts.skew || 0;
    const form = opts.form || 'sin';
    const t = (typeof time === 'number' ? time : performance.now() / 1000);
    const phase = t * speed * Math.PI * 2;
    const wave = (u) => {
      const p = u * freq * Math.PI * 2 + phase;
      if (form === 'tri') { const f = ((p / Math.PI) % 2 + 2) % 2; return f < 1 ? f * 2 - 1 : 3 - f * 2; }
      if (form === 'square') return Math.sin(p) >= 0 ? 1 : -1;
      if (form === 'saw') { const f = ((p / (Math.PI * 2)) % 1 + 1) % 1; return f * 2 - 1; }
      return Math.sin(p);
    };
    for (let y = 0; y < h; y++) {
      const u = y / (h - 1);
      let dx = amp * wave(u);
      if (skew) dx += amp * skew * (u - 0.5) * 2;
      const iDx = Math.floor(dx);
      const frac = dx - iDx;
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 4;
        const sx0 = (((x - iDx) % w) + w) % w;
        const sx1 = (((x - iDx - 1) % w) + w) % w;
        const a0 = (row + sx0) * 4, a1 = (row + sx1) * 4;
        const w0 = 1 - frac, w1 = frac;
        d[o] = sd[a0] * w0 + sd[a1] * w1;
        d[o + 1] = sd[a0 + 1] * w0 + sd[a1 + 1] * w1;
        d[o + 2] = sd[a0 + 2] * w0 + sd[a1 + 2] * w1;
        d[o + 3] = sd[a0 + 3] * w0 + sd[a1 + 3] * w1;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function apply(canvas, opts, time) {
    if (!opts || !opts.enabled) return canvas;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const snap = cloneCanvas(canvas);
    const signal = signalModel(opts.type, h);

    /* 1. Warp geometrico real: curvatura de tubo + lente eyefish como una
          unica deformacion barrel inversa. 'curvature' aporta el cristal del
          tubo; 'eyefish' la lente 90s extra; el radio limita el circulo. */
    const curv = opts.curvature == null ? 0 : clamp(opts.curvature, 0, 1.2);
    const eyeAmt = clamp((opts.eyefish || 0) + curv * 0.22, 0, 1.2);
    const eyeRad = opts.eyefishRadius == null ? 1 : opts.eyefishRadius;
    let work = (eyeAmt > 0.004 || eyeRad < 0.999) ? eyefishCanvas(snap, eyeAmt, eyeRad) : cloneCanvas(snap);

    /* 2. Beam convergence misalignment */
    convergePass(work, opts.conv || 0);

    /* 4. Signal echo */
    if ((opts.echo || 0) > 0.01 && typeof time === 'number') echoPass(work, opts.echo, time, opts.echoMode);

    /* 5. Color grading */
    gradingPass(work, opts);

    /* 6. Scanlines (pitch del estandar / lineas activas) */
    scanlinesPass(work, opts.scanlines || 0, signal);

    /* 6b. Interlace real: dos campos alternos (twittido) */
    interlacePass(work, opts, time, signal);

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.drawImage(work, 0, 0);

    /* 7. Phosphor softness (veil) */
    const bloomAmt = opts.bloom != null ? opts.bloom : (opts.edgeBloom != null ? opts.edgeBloom : (opts.glow != null ? opts.glow : 0));
    const bloomT = opts.bloomThresh != null ? opts.bloomThresh : (opts.edgeThresh != null ? opts.edgeThresh : (opts.glowThreshold != null ? opts.glowThreshold : (opts.glowT != null ? opts.glowT / 100 : 0.22)));
    const bloomChrom = opts.bloomChrom != null ? opts.bloomChrom : (opts.edgeChrom != null ? opts.edgeChrom : 2);
    const bloomTint = opts.bloomTint || opts.edgeTint || opts.glowTint || '#ff00cc';
    const bloomMode = opts.bloomBlend || opts.edgeBlend || opts.glowBlend || 'screen';
    if (bloomAmt > 0.02) {
      ctx.save();
      ctx.globalAlpha = 0.22 * bloomAmt;
      ctx.filter = 'blur(' + (0.5 + bloomAmt * 2) + 'px)';
      ctx.drawImage(work, 0, 0);
      ctx.restore();
    }

    /* 8. Phosphor mask (aperture grille / shadow mask) */
    const kind = opts.mask || 'grille';
    if (kind !== 'none') {
      const mc = maskCanvas(kind, opts.hue || 0, opts.phosphor || 0);
      if (mc.alpha > 0.01) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.save();
        const off = Math.floor((typeof time === 'number' ? time : 0)) * 3;
        ctx.translate(-((off % 3) + 3) % 3, 0);
        ctx.fillStyle = ctx.createPattern(mc.mask, 'repeat');
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    /* 9. Bloom de fósforo (edge-based, Tint único) */
    if (bloomAmt > 0.008) {
      apply.bloomPass(canvas, {
        amount: bloomAmt,
        thresh: bloomT,
        chromatic: bloomChrom,
        tint: bloomTint,
        blend: bloomMode
      });
    }

    /* 10. (curvatura geometrica ya aplicada en la lente barrel de la etapa 1;
          aqui solo la sombra de vidrio sutil del bezel que la acompania) */
    glassShade(ctx, w, h, curv);

    /* 10b. H-sync hum wave (desplazamiento horizontal animado por fila) */
    if ((opts.wave || 0) > 0.01) {
      wavePass(canvas, {
        amp: opts.wave,
        freq: opts.waveFreq,
        speed: opts.waveSpeed,
        skew: opts.waveSkew,
        form: opts.waveForm
      }, time);
    }

    /* 11. V-Hold roll */
    rollPass(ctx, w, h, opts.roll || 0, time);

    /* 12. Tube bezel / frame */
    framePass(ctx, w, h, opts.frame == null ? 0.4 : opts.frame);

    /* 13. Flicker (flkMain+flkExtra, cadencia del campo) */
    flickerPass(ctx, w, h, opts.flicker || 0, time, signal);

    /* 15. VHS dropouts */
    dropoutPass(canvas, opts.dropout || 0, time);

    /* 16. Raster bloom (APL breathing) + phosphor persistence afterglow */
    rasterPass(canvas, (opts.raster || 0) / 100, time, signal);
    afterglowPass(canvas, (opts.trail || 0) / 100, time);

    return canvas;
  }

  /* Sombra de vidrio del tubo: oscurecimiento radial suave que acompaña al
     warp geometrico (su coordenada es la del radio de la lente barrel). */
  function glassShade(ctx, w, h, amount) {
    if (amount < 0.01) return;
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const maxR = Math.max(1e-3, Math.sqrt(cx * cx + cy * cy));
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const k = amount * 0.5;
    for (let y = 0; y < h; y++) {
      const dy = (y - cy) / maxR;
      for (let x = 0; x < w; x++) {
        const dx = (x - cx) / maxR;
        const r2 = dx * dx + dy * dy;
        const f = 1 - k * r2 * r2;
        const o = (y * w + x) * 4;
        d[o] = clamp(d[o] * f, 0, 255);
        d[o + 1] = clamp(d[o + 1] * f, 0, 255);
        d[o + 2] = clamp(d[o + 2] * f, 0, 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  apply.bloomPass = bloomPass;
  apply.wavePass = wavePass;

  return apply;
})();