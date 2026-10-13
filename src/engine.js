/* ============================================================================
   StudioEngine - nucleo de render desacoplado de la interfaz.
   Recibe parametros y opciones YA resueltos (no lee la UI ni el DOM salvo para
   crear canvas), de modo que pueda reutilizarse tal cual como motor de un
   plug-in externo. La app (app.js) es la responsable de recolectar los valores
   desde los controles y entregarselos aqui.
   ============================================================================ */
(function () {
  const Dither = () => window.DitherEngine;
  const Crt = () => window.CRT;

  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  function cloneCanvas(c) {
    const n = document.createElement('canvas');
    n.width = c.width;
    n.height = c.height;
    n.getContext('2d').drawImage(c, 0, 0);
    return n;
  }

  /* Sharpening post-procesado (unsharp 3x3) sobre el fotograma ya procesado. */
  function sharpenCanvas(canvas, amount) {
    if (amount < 0.01) return canvas;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const src = d.slice();
    const a = Math.min(0.6, amount * 0.5);
    const k = 1 + 4 * a;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const o = (row + x) * 4;
        const l = x > 0 ? o - 4 : o;
        const rgt = x < w - 1 ? o + 4 : o;
        const u = y > 0 ? o - w * 4 : o;
        const dn = y < h - 1 ? o + w * 4 : o;
        d[o] = clamp01((k * src[o] - a * (src[l] + src[rgt] + src[u] + src[dn])) / 255) * 255;
        d[o + 1] = clamp01((k * src[o + 1] - a * (src[l + 1] + src[rgt + 1] + src[u + 1] + src[dn + 1])) / 255) * 255;
        d[o + 2] = clamp01((k * src[o + 2] - a * (src[l + 2] + src[rgt + 2] + src[u + 2] + src[dn + 2])) / 255) * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  function boomerangize(frames, enabled) {
    if (!enabled || !frames || frames.length < 3) return frames || [];
    const out = frames.slice();
    for (let i = frames.length - 2; i >= 1; i--) out.push(frames[i]);
    return out;
  }

  /* Eco temporal: mezcla el fotograma anterior con el actual (feedback de
     senal), base del efecto Boomerang/EchoFX entre frames. */
  function blendEcho(prev, cur, amount) {
    if (!prev || !(amount > 0)) return cur;
    const out = cloneCanvas(cur);
    const ctx = out.getContext('2d');
    ctx.globalAlpha = Math.min(1, amount);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(prev, 0, 0);
    ctx.globalAlpha = 1;
    return out;
  }

  /* Overlay de composicion real: base viva + grano selectivo por alpha. */
  function renderMaskOverlay(params, maskOpts) {
    const w = params.width, h = params.height;
    const cfg = maskOpts;
    const maskC = Dither().maskFromLuma(params.rgba, w, h, Object.assign({}, cfg, {
      pre: params.pre, outputRange: params.outputRange, invert: params.invert
    }));
    const md = maskC.getContext('2d').getImageData(0, 0, w, h).data;

    const base = Dither().renderFlat(Object.assign({}, params, { algorithmOpts: {} })).canvas;
    const g = Object.assign({}, params, {
      algorithmOpts: Object.assign({}, params.algorithmOpts || {})
    });
    delete g.algorithmOpts.strengthMap;
    if (cfg.bw) {
      g.colorMode = 'bw';
      g.colorOpts = Object.assign({}, params.colorOpts, { c1: [0, 0, 0], c2: [1, 1, 1] });
    }
    const grain = Dither()(g).canvas;

    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const octx = out.getContext('2d');
    const oid = octx.createImageData(w, h);
    const od = oid.data;
    const bd = base.getContext('2d').getImageData(0, 0, w, h).data;
    const gd = grain.getContext('2d').getImageData(0, 0, w, h).data;
    const npix = w * h;
    for (let i = 0; i < npix; i++) {
      const o = i * 4;
      const m = md[o] / 255;
      od[o] = bd[o] + (gd[o] - bd[o]) * m;
      od[o + 1] = bd[o + 1] + (gd[o + 1] - bd[o + 1]) * m;
      od[o + 2] = bd[o + 2] + (gd[o + 2] - bd[o + 2]) * m;
      od[o + 3] = bd[o + 3] + (gd[o + 3] - bd[o + 3]) * m;
    }
    octx.putImageData(oid, 0, 0);
    return out;
  }

  function renderCore(params, maskOpts) {
    const maskOn = !!(maskOpts && maskOpts.enabled);
    if (!maskOn) {
      if (params.algorithmOpts) delete params.algorithmOpts.strengthMap;
      return Dither()(params).canvas;
    }
    return renderMaskOverlay(params, maskOpts);
  }

  function crtInto(work, params, time, overrides, fx) {
    if (!fx.crtEnabled) return work;
    const c = document.createElement('canvas');
    c.width = work.width;
    c.height = work.height;
    c.getContext('2d').drawImage(work, 0, 0);
    const opts = Object.assign({}, fx.crtOpts, overrides || {});
    return Crt()(c, opts, typeof time === 'number' ? time : performance.now() / 1000);
  }

  /* fx: { sharpen (0..100), crtEnabled, crtOpts, bloomTintOverride, bloomFallback } */
  function applyFrameEffects(coreCanvas, params, fx, time) {
    fx = fx || {};
    let work = coreCanvas;
    if (fx.sharpen > 0) work = sharpenCanvas(work, fx.sharpen / 100);
    const overrides = {};
    if (fx.bloomTintOverride) overrides.bloomTint = fx.bloomTintOverride;
    work = crtInto(work, params, time, overrides, fx);
    if (!fx.crtEnabled && Crt() && Crt().wavePass && fx.crtOpts && fx.crtOpts.wave > 0.01) {
      work = Crt().wavePass(cloneCanvas(work), {
        amp: fx.crtOpts.wave,
        freq: fx.crtOpts.waveFreq,
        speed: fx.crtOpts.waveSpeed,
        skew: fx.crtOpts.waveSkew,
        form: fx.crtOpts.waveForm
      }, time);
    }
    if (!fx.crtEnabled && Crt() && Crt().bloomPass && fx.bloomFallback) {
      work = Crt().bloomPass(work, fx.bloomFallback);
    }
    return work;
  }

  /* Punto de entrada unico para el plug-in: params + opciones -> canvas final. */
  function renderFrame(params, maskOpts, fx, time) {
    return applyFrameEffects(renderCore(params, maskOpts), params, fx, time);
  }

  window.StudioEngine = {
    clamp01,
    cloneCanvas,
    sharpenCanvas,
    boomerangize,
    blendEcho,
    renderMaskOverlay,
    renderCore,
    applyFrameEffects,
    renderFrame
  };
})();
