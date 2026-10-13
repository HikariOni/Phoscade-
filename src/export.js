window.Export = (function () {
  function download(name, blob) {
    const a = document.createElement('a');
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function toBlob(canvas, mime, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
  }

  function flatten(canvas, bg) {
    const c = document.createElement('canvas');
    c.width = canvas.width;
    c.height = canvas.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(canvas, 0, 0);
    return c;
  }

  function toHex(n) {
    return ('0' + n.toString(16)).slice(-2);
  }

  function toColorStr(r, g, b) {
    return '#' + toHex(r) + toHex(g) + toHex(b);
  }

  function svg(rgba, w, h, opts) {
    opts = opts || {};
    const scale = opts.scale || 1;
    const bg = opts.bg || null;
    const parts = [];
    parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + (w * scale) + '" height="' + (h * scale) +
      '" viewBox="0 0 ' + w + ' ' + h + '" shape-rendering="crispEdges">');
    if (bg) {
      parts.push('<rect width="' + w + '" height="' + h + '" fill="' + bg + '"/>');
    }
    for (let y = 0; y < h; y++) {
      let runColor = null;
      let runStart = 0;
      const rowBase = y * w * 4;
      for (let x = 0; x <= w; x++) {
        let r, g, b;
        if (x < w) {
          const o = rowBase + x * 4;
          r = rgba[o];
          g = rgba[o + 1];
          b = rgba[o + 2];
          if (rgba[o + 3] < 8) { r = g = b = -1; }
        } else {
          r = g = b = -1;
        }
        const key = (r === -1) ? 't' : toColorStr(r, g, b);
        if (key !== runColor) {
          if (runColor !== null && runColor !== 't') {
            parts.push('<rect x="' + runStart + '" y="' + y + '" width="' + (x - runStart) + '" height="1" fill="' + runColor + '"/>');
          }
          runColor = key;
          runStart = x;
        }
      }
    }
    parts.push('</svg>');
    return parts.join('');
  }

  function toSVGBlob(rgba, w, h, opts) {
    return new Blob([svg(rgba, w, h, opts)], { type: 'image/svg+xml' });
  }

  function toGIF(frames, opts) {
    return window.GIF.encode(frames, opts);
  }

  async function png(canvas, name) {
    const blob = await toBlob(canvas, 'image/png');
    download(name + '.png', blob);
  }

  async function jpeg(canvas, name, opts) {
    const bg = opts && opts.bg ? opts.bg : '#ffffff';
    const c = flatten(canvas, bg);
    const blob = await toBlob(c, 'image/jpeg', 0.92);
    download(name + '.jpg', blob);
  }

  function svgOut(rgba, w, h, opts, name) {
    const key = ('svg' in document) ? 'image/svg+xml' : 'text/plain';
    const blob = new Blob([svg(rgba, w, h, opts)], { type: key });
    download(name + '.svg', blob);
  }

  function gif(frames, opts, name) {
    const bytes = toGIF(frames, opts);
    const blob = new Blob([bytes], { type: 'image/gif' });
    download(name + '.gif', blob);
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function video(frames, opts, name) {
    const fps = Math.max(1, (opts && opts.fps) || 12);
    const loop = !opts || opts.loop !== false;
    let seq = frames.slice();
    if (loop && seq.length > 1) {
      const mirrored = seq.slice(0, -1).slice().reverse().concat(seq.slice());
      seq = mirrored;
    }
    const w = seq[0].width, h = seq[0].height;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(fps);
    const mimes = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = mimes.find((m) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m));
    if (!mime) throw new Error('Este navegador no soporta grabacion WebM');
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12 * 1000 * 1000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start();
    const slotMs = 1000 / fps;
    for (let i = 0; i < seq.length; i++) {
      ctx.drawImage(seq[i], 0, 0, w, h);
      await sleep(slotMs);
    }
    await sleep(slotMs);
    rec.stop();
    await stopped;
    const blob = new Blob(chunks, { type: 'video/webm' });
    download(name + '.webm', blob);
  }

  return {
    download,
    svg,
    toSVGBlob,
    png,
    jpeg,
    svgOut,
    gif,
    toGIF,
    video
  };
})();