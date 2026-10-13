const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });
  win.webContents.on('console-message', (...args) => {
    const m = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (typeof m.level === 'number' && m.level > 1) {
      console.log('[renderer] ' + String(m.message).slice(0, 800));
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('did-finish-load', () => {
    setTimeout(() => {
      win.webContents.executeJavaScript(DRIVE, true).then((res) => {
        console.log('DRIVE_RESULT ' + JSON.stringify(res, null, 1));
        app.exit(res.crash ? 1 : 0);
      }).catch((e) => {
        console.log('DRIVE_ERROR ' + (e && e.stack ? e.stack : e));
        app.exit(1);
      });
    }, 1500);
  });
});

const DRIVE = `(async function () {
  const out = { scanned: 0, realErrors: [], gif: null, gifStatic: null, preview: null, png: null, blue: null, live: null, modes: null };
  window.__stacks = [];
  const _ce = console.error.bind(console);
  console.error = (...a) => { window.__stacks.push((a[0] && (a[0].stack || a[0].message)) || String(a[0])); _ce.apply(console, a); };
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const setSel = async (id, v) => { const el = $(id); el.value = v; el.dispatchEvent(new Event('change')); await sleep(70); };
  const setChk = (id, on) => { const el = $(id); el.checked = !!on; el.dispatchEvent(new Event('change')); };
  const clearToast = () => { const t = $('toast'); t.textContent = ''; t.className = 'toast hidden'; };
  const realError = () => {
    const t = $('toast');
    if (t && t.textContent.indexOf('Error procesando') === 0) return t.textContent;
    if (window.__stacks.length) return window.__stacks[0];
    return null;
  };

  /* drop photo-like image */
  const c = document.createElement('canvas');
  c.width = 320; c.height = 240;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 320, 240);
  g.addColorStop(0, '#ff9a3c'); g.addColorStop(0.4, '#3c7aff'); g.addColorStop(1, '#2bd96a');
  x.fillStyle = g; x.fillRect(0, 0, 320, 240);
  const nz = x.createImageData(40, 30);
  for (let i = 0; i < nz.data.length; i += 4) { nz.data[i] = (Math.random() * 255) | 0; nz.data[i + 1] = (Math.random() * 255) | 0; nz.data[i + 2] = (Math.random() * 255) | 0; nz.data[i + 3] = 255; }
  x.putImageData(nz, 20, 20);
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  const file = new File([blob], 'foto.png', { type: 'image/png' });
  const dt = new DataTransfer(); dt.items.add(file);
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
  await sleep(600);
  out.imageLoaded = $('toast').textContent.indexOf('Imagen cargada') === 0;

  const pv = $('preview');
  const pvHash = () => {
    if (!pv.width || !pv.height) return '_empty';
    const d = pv.getContext('2d').getImageData(0, 0, pv.width, pv.height).data;
    let h = 2166136261;
    for (let i = 0; i < d.length; i += 4) { h ^= d[i]; h = (h * 16777619) >>> 0; }
    return h;
  };

  /* 1) matrix scan: must be error-free now */
  const ALGS = ['floydsteinberg','falsefloyd','jarvis','stucki','burkes','sierra','sierra2','sierralite','atkinson','bayer','modulation','bitmappattern','ascii'];
  const MODS = ['white','blue','bayer','value','perlin','cellular','knoll','ign'];
  await setSel('algoSelect', 'modulation');
  for (const mt of MODS) {
    for (const mult of [1, 8]) {
      for (const crt of [0, 1]) {
        for (const anim of [0, 1]) {
          out.scanned++;
          clearToast(); window.__stacks.length = 0;
          setChk('crtCheck', crt); setChk('animCheck', anim);
          const am = $('algoMult'); if (am) am.value = String(mult);
          const mts = $('modType'); if (mts) { mts.value = mt; mts.dispatchEvent(new Event('change')); }
          setRange('noiseScale', 4); setRange('noiseSeed', 7);
          await sleep(260);
          const err = realError();
          if (err) out.realErrors.push({ where: 'mod ' + mt + ' mult' + mult + ' crt' + crt + ' anim' + anim, msg: err });
        }
      }
    }
  }
  for (const alg of ALGS) {
    if (alg === 'modulation') continue;
    out.scanned++;
    clearToast(); window.__stacks.length = 0;
    await setSel('algoSelect', alg);
    const am = $('algoMult'); if (am) am.value = '8';
    setChk('crtCheck', 1); setChk('animCheck', 1);
    await sleep(280);
    const err = realError();
    if (err) out.realErrors.push({ where: alg + ' mult8 crt anim', msg: err });
  }

  /* 2) real-time preview: effects change output live */
  clearToast();
  await setSel('algoSelect', 'floydsteinberg');
  setChk('crtCheck', 1);
  setChk('animCheck', 0);
  await sleep(400);
  const base = pvHash();
  setRange('crtScanlines', 10);
  await sleep(260);
  const hScan = pvHash();
  setRange('crtScanlines', 90);
  await sleep(260);
  const hScan2 = pvHash();
  out.preview = {
    base, hScan, hScan2,
    effectsLive: base !== hScan && hScan !== hScan2,
    notEmpty: base !== '_empty'
  };

  /* 3) animation preview updates over time (deterministic rAF queue) */
  clearToast();
  await setSel('algoSelect', 'floydsteinberg');
  const origRAF = window.requestAnimationFrame;
  const rafQueue = [];
  window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
  setRange('animNoise', '60');
  setChk('animCheck', 1);
  await sleep(550); // let schedule->render->buildAnimFrames->startPreviewLoop enqueue animTick
  const kh = [];
  let now2 = 0;
  for (let k = 0; k < 10; k++) {
    const cbs = rafQueue.splice(0);
    now2 += 200;
    for (const cb of cbs) cb(now2);
    kh.push(pvHash());
  }
  window.requestAnimationFrame = origRAF;
  out.animPreview = { hashes: kh, animated: new Set(kh).size > 1, err: realError() };

  /* 4) GIF functional validation via real decode + structure parse */
  clearToast();
  setChk('animCheck', 1);
  await sleep(500);
  out.animGifErr = realError();

  // build frames exactly like the app does and encode
  const W = 120, H = 90;
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const o = (y * W + x) * 4;
    rgba[o] = (x / (W - 1)) * 255; rgba[o + 1] = 128; rgba[o + 2] = 255 - (x / (W - 1)) * 255; rgba[o + 3] = 255;
  }
  for (let i = 0; i < W * H; i += 37) rgba[i * 4 + 3] = 0; // sprinkle transparent pixels
  const P = {
    width: W, height: H, rgba,
    algorithm: 'floydsteinberg', algorithmOpts: { serpentine: true, mult: 1 },
    colorMode: 'bw', colorOpts: { c1: [0, 0, 0], c2: [1, 1, 1] },
    outputRange: { dark: 0, light: 1 }, invert: false
  };
  const crtO = {
    enabled: true, type: 'rect', mask: 'grille', res: 1, fps: 10,
    scanlines: 0.5, phosphor: 0.5, frame: 0.4, hue: 0, curvature: 0.3, warp: 0,
    conv: 0, roll: 0, bloom: 0.2, bloomThresh: 0.5, bloomChrom: 2, bloomTint: '#ff2bd6', bloomBlend: 'screen',
    flkMain: 0.2, flkExtra: 0, vibrance: 0.1, saturation: 1, echo: 0
  };
  function parseGIF(bytes) {
    function u8(i) { return bytes[i]; }
    const peek = (i, n) => { let s = ''; for (let k = 0; k < n; k++) s += String.fromCharCode(u8(i + k)); return s; };
    const sig = peek(0, 6);
    const w = u8(6) | (u8(7) << 8), h = u8(8) | (u8(9) << 8);
    const packed = u8(10);
    const hasGct = (packed & 0x80) !== 0;
    const gctSize = hasGct ? 1 << ((packed & 7) + 1) : 0;
    let pos = 13 + gctSize * 3;
    let trailer = false;
    let graphicBlocks = 0;
    let imageBlocks = 0;
    let gceTransCount = 0;
    let appExt = 0;
    while (pos < bytes.length) {
      const b = u8(pos);
      if (b === 0x3b) { trailer = pos === bytes.length - 1; pos++; continue; }
      if (b === 0x21) {
        const label = u8(pos + 1);
        if (label === 0xfe || label === 0xf9 || label === 0xff || label === 0x01) {
          if (label === 0xf9) {
            graphicBlocks++;
            const gce = u8(pos + 2);
            if (gce === 4 && (u8(pos + 4) & 1)) gceTransCount++;
          }
          if (label === 0xff) appExt++;
          pos += 2;
          let len = u8(pos); pos++;
          if (label === 0xff && len === 0x0b) { appExt = 1; }
          while (len !== 0) { pos += len; len = u8(pos); pos++; }
          continue;
        }
        continue;
      }
      if (b === 0x2c) {
        imageBlocks++;
        const fp = u8(pos + 9);
        pos += 10;
        if (fp & 0x80) pos += 1 << ((fp & 7) + 1);
        pos += 1; // lzw min code size
        let len = u8(pos); pos++;
        while (len !== 0) { pos += len; len = u8(pos); pos++; }
        continue;
      }
      pos++;
    }
    return { sig, dims: w + 'x' + h, trailer, imageBlocks, graphicBlocks, gceTransCount, appExt, compact: bytes.length < 3 * w * h * 4 };
  }

  function gifBlob(bytes) { return new Blob([bytes], { type: 'image/gif' }); }
  function decodeViaImage(bytes) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ ok: true, w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => resolve({ ok: false });
      img.src = URL.createObjectURL(gifBlob(bytes));
    });
  }

  const frames = [];
  for (let f = 0; f < 4; f++) {
    const base = DitherEngine(Object.assign({}, P, { phaseX: f, phaseY: f * 0.618 }));
    const cc = document.createElement('canvas');
    cc.width = base.canvas.width; cc.height = base.canvas.height;
    cc.getContext('2d').drawImage(base.canvas, 0, 0);
    frames.push(CRT(cc, crtO, f));
  }
  const animBytes = window.GIF.encode(frames, { delayMs: 100, transparent: true });
  const animMeta = parseGIF(animBytes);
  const animDec = await decodeViaImage(animBytes);

  const staticBytes = window.GIF.encode([frames[0]], { delayMs: 250, transparent: false });
  const staticMeta = parseGIF(staticBytes);
  const staticDec = await decodeViaImage(staticBytes);

  const transpBytes = window.GIF.encode([frames[0]], { delayMs: 250, transparent: true });
  const transpMeta = parseGIF(transpBytes);
  const transpDec = await decodeViaImage(transpBytes);

  out.gif = {
    anim: {
      meta: animMeta, decoded: animDec,
      ok: animMeta.sig === 'GIF89a' && animMeta.dims === W + 'x' + H && animMeta.trailer &&
          animMeta.imageBlocks === 4 && animMeta.graphicBlocks === 4 && animDec.ok && animDec.w === W && animDec.h === H && animMeta.compact
    },
    static: {
      meta: staticMeta, decoded: staticDec,
      ok: staticMeta.sig === 'GIF89a' && staticMeta.trailer && staticMeta.imageBlocks === 1 && staticDec.ok
    },
    transparent: {
      meta: transpMeta, decoded: transpDec,
      ok: transpMeta.gceTransCount === 1 && transpDec.ok
    }
  };

  /* PNG surface (app uses canvas.toBlob) */
  try {
    const pc = document.createElement('canvas'); pc.width = 64; pc.height = 64;
    const px = pc.getContext('2d'); px.fillStyle = '#3c7aff'; px.fillRect(0, 0, 64, 64);
    const pb = await new Promise(r => pc.toBlob(r, 'image/png'));
    const di = await decodeViaImage(pb);
    out.png = { ok: pb.type === 'image/png' && pb.size > 100 && di.ok, size: pb.size };
  } catch (e) { out.png = { ok: false, err: e.message }; }

  /* 5) blue noise tile quality: permutation, dispersion vs white, tileability */
  function solidParams(mt) {
    const a = new Uint8ClampedArray(64 * 64 * 4);
    for (let i = 0; i < 64 * 64; i++) { a[i * 4] = 128; a[i * 4 + 1] = 128; a[i * 4 + 2] = 128; a[i * 4 + 3] = 255; }
    return {
      width: 64, height: 64, rgba: a,
      algorithm: 'modulation', algorithmOpts: { modType: mt, noiseScale: 1, noiseSeed: 7, interp: false, minLevel: 0.9, maxLevel: 1 },
      colorMode: 'bw', colorOpts: { c1: [0, 0, 0], c2: [1, 1, 1] },
      outputRange: { dark: 0, light: 1 }, invert: false
    };
  }
  function tileStats(mt) {
    const P3 = solidParams(mt);
    DitherEngine(P3);
    const tbl = P3.algorithmOpts._noiseTable;
    const vals = [], wrap = [];
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) vals.push(tbl[y * 64 + x]);
    const unique = new Set(vals.map(v => Math.round(v * 100000))).size;
    const k = (vals.slice().sort((a, b) => a - b)[(vals.length * 0.2) | 0]);
    const on = (x, y) => tbl[y * 64 + x] < k;
    let adj = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      if (!on(x, y)) continue;
      if (on((x + 1) % 32, y)) adj++;
      if (on(x, (y + 1) % 32)) adj++;
    }
    let mism = 0;
    for (let y = 0; y < 64; y++) for (let x = 0; x < 32; x++) {
      if (tbl[y * 64 + x] !== tbl[y * 64 + x + 32]) mism++;
    }
    return { unique, adj, mism };
  }
  const bBlue = tileStats('blue');
  const bWhite = tileStats('white');
  out.blue = {
    blue: bBlue, white: bWhite,
    ok: bBlue.unique > 900 && bBlue.adj <= 12 && bBlue.mism === 0 && bBlue.adj < bWhite.adj * 0.2
  };

  /* 6) real-time per-effect check (with CRT on, anim off) */
  clearToast();
  await setSel('algoSelect', 'floydsteinberg');
  setChk('crtCheck', 1);
  setChk('animCheck', 0);
  await sleep(300);
  const snap2 = () => pvHash();
  const eBaseA = snap2();
  await sleep(130);
  const eBase = snap2();
  const FX = ['crtBloom', 'crtBloomThresh', 'crtBloomChrom', 'crtRaster', 'crtRoll', 'crtConv', 'crtPhosphor', 'crtFrame', 'crtFlicker', 'crtVibrance', 'crtSatur', 'crtEcho', 'crtCurvature'];
  const fxOrig = {};
  for (const id of FX) fxOrig[id] = $(id).value;
  const tintOrig = $('crtBloomTint').value;
  const fxRes = { deterministic: eBaseA === eBase };
  for (const id of FX) {
    setRange(id, 90); await sleep(170);
    fxRes[id] = snap2() !== eBase;
    setRange(id, id === 'crtSatur' ? 100 : 30); await sleep(130);
  }
  for (const id of FX) setRange(id, fxOrig[id]);

  /* 6b) Bloom Tint afecta (color picker, evento input) y la mascara selectiva afecta */
  $('crtBloomTint').value = '#ff0000';
  $('crtBloomTint').dispatchEvent(new Event('input'));
  await sleep(350);
  const hTintRed = snap2();
  $('crtBloomTint').value = '#0000ff';
  $('crtBloomTint').dispatchEvent(new Event('input'));
  await sleep(350);
  const hTintBlue = snap2();
  fxRes.crtBloomTint = hTintRed !== hTintBlue;
  $('crtBloomTint').value = tintOrig;
  $('crtBloomTint').dispatchEvent(new Event('input'));
  await sleep(200);

  clearToast();
  setChk('crtCheck', 0);
  await setSel('algoSelect', 'floydsteinberg');
  await sleep(200);
  const eNoMask = snap2();
  setChk('maskCheck', 1);
  await sleep(220);
  const eMask = snap2();
  setChk('maskCheck', 0);
  await sleep(180);
  fxRes.maskAffects = eNoMask !== eMask;

  /* 6c) nueva ronda: UI de exportacion + niveles de degradado + ruido animado */
  const stillBtns = Array.prototype.slice.call(document.querySelectorAll('.exp-still'));
  out.exportUI = {
    stillVisible: stillBtns.length === 3 && stillBtns.every((b) => !b.hidden),
    videoHidden: $('btnVideo').hidden === true
  };

  setChk('crtCheck', 0);
  await setSel('algoSelect', 'floydsteinberg');
  await setSel('colorMode', 'palRueda');
  await sleep(220);
  setRange('gradLevels', 2); await sleep(240);
  const hLv2 = snap2();
  setRange('gradLevels', 64); await sleep(240);
  const hLv64 = snap2();
  fxRes.levelsAffect = hLv2 !== hLv64;
  setRange('gradLevels', 12); await sleep(120);

  await setSel('colorMode', 'bw');
  await sleep(150);

  /* 6d) modos de trabajo (glitch / selectivo) + preset NightRush B&N */
  clearToast();
  setChk('crtCheck', 0);
  await sleep(150);
  const modeRes = {};
  $('modeSelective').click(); await sleep(220);
  modeRes.selectiveClass = document.body.classList.contains('mode-selective');
  modeRes.maskOn = $('maskCheck').checked === true;
  modeRes.maskBW = $('maskBW').checked === true;
  modeRes.baseBW = $('colorMode').value === 'bw';
  $('modeGlitch').click(); await sleep(160);
  modeRes.glitchClass = document.body.classList.contains('mode-glitch') && !document.body.classList.contains('mode-selective');
  await setSel('presetSelect', 'NightRush \u00b7 B&N (Selectivo)');
  await sleep(320);
  modeRes.presetSelective = document.body.classList.contains('mode-selective') && $('maskCheck').checked === true;
  modeRes.presetBW = $('colorMode').value === 'bw';
  modeRes.err = realError();
  modeRes.ok = modeRes.selectiveClass && modeRes.maskOn && modeRes.maskBW && modeRes.baseBW &&
    modeRes.glitchClass && modeRes.presetSelective && modeRes.presetBW && !modeRes.err;
  out.modes = modeRes;

  /* 6e) onda H-sync (independiente o dentro de CRT) + eco temporal entre frames */
  clearToast();
  setChk('crtCheck', 0);
  setChk('animCheck', 0);
  await setSel('algoSelect', 'floydsteinberg');
  await sleep(260);
  setRange('waveAmount', 0); await sleep(220);
  const wOff = snap2();
  setRange('waveAmount', 24); await sleep(220);
  const wOn = snap2();
  fxRes.waveAffects = wOff !== wOn;
  setRange('waveAmount', 0); await sleep(140);

  const origRAF2 = window.requestAnimationFrame;
  const rafQ2 = [];
  window.requestAnimationFrame = (cb) => { rafQ2.push(cb); return rafQ2.length; };
  setRange('animEcho', 0);
  setChk('animCheck', 1);
  await sleep(520);
  let nowE = 0;
  for (let k = 0; k < 6; k++) { const cbs = rafQ2.splice(0); nowE += 200; for (const cb of cbs) cb(nowE); }
  const echoOffHash = pvHash();
  setRange('animEcho', 80);
  await sleep(520);
  for (let k = 0; k < 6; k++) { const cbs = rafQ2.splice(0); nowE += 200; for (const cb of cbs) cb(nowE); }
  const echoOnHash = pvHash();
  window.requestAnimationFrame = origRAF2;
  fxRes.echoAffects = echoOffHash !== echoOnHash;
  setRange('animEcho', 0);
  setChk('animCheck', 0);
  await sleep(180);

  /* 6f) import de GIF animado (ImageDecoder) */
  clearToast();
  await setSel('algoSelect', 'floydsteinberg');
  setChk('crtCheck', 0); setChk('maskCheck', 0);
  if ($('animNoise')) setRange('animNoise', 0);
  const gW = 48, gH = 48;
  const gFrames = [];
  for (let f = 0; f < 3; f++) {
    const gc = document.createElement('canvas'); gc.width = gW; gc.height = gH;
    const gx = gc.getContext('2d');
    gx.fillStyle = ['#ff0000', '#00ff00', '#0000ff'][f]; gx.fillRect(0, 0, gW, gH);
    gx.fillStyle = '#000000'; gx.fillRect(f * 12, 10, 10, 10);
    gFrames.push(gc);
  }
  const origRAF3 = window.requestAnimationFrame;
  const rafQ3 = [];
  window.requestAnimationFrame = (cb) => { rafQ3.push(cb); return rafQ3.length; };
  const gifBytes = window.GIF.encode(gFrames, { delayMs: 100, transparent: false });
  const gifFile = new File([gifBytes], 'anim.gif', { type: 'image/gif' });
  const gdt = new DataTransfer(); gdt.items.add(gifFile);
  window.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: gdt }));
  await sleep(1300);
  const gifSrcOk = $('animSource').value === 'gif';
  const gifAnimOn = $('animCheck').checked === true;
  await sleep(500);
  const gh = [];
  let nowG = 0;
  for (let k = 0; k < 5; k++) { const cbs = rafQ3.splice(0); nowG += 200; for (const cb of cbs) cb(nowG); gh.push(pvHash()); }
  window.requestAnimationFrame = origRAF3;
  fxRes.gifImport = gifSrcOk && gifAnimOn && new Set(gh).size > 1;
  fxRes.gifErr = realError();
  fxRes.gifDebug = { src: $('animSource').value, anim: $('animCheck').checked, distinct: new Set(gh).size, count: window.__gifDecCount || 0, err: window.__gifDecErr || null };
  setChk('animCheck', 0);
  await sleep(150);

  fxRes.allAffect = Object.entries(fxRes)
      .filter(([k, v]) => k !== 'deterministic' && typeof v === 'boolean')
      .every(([, v]) => v);
  out.live = fxRes;

  out.crash = out.realErrors.length > 0 || !out.preview.effectsLive || !out.animPreview.animated ||
      !out.gif.anim.ok || !out.gif.static.ok || !out.gif.transparent.ok || !out.png.ok || !out.blue.ok ||
      !out.live.allAffect || !out.exportUI.stillVisible || !out.exportUI.videoHidden || !out.modes.ok;
  return out;

  /* helpers */
  function setRange(id, v) { const el = $(id); el.value = v; el.dispatchEvent(new Event('input')); }
})()`;

console.log('harness ready');