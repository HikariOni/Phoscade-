(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const ui = {};
  const rangeLabel = {};
  const rangeFmt = {};
  let defaultControls = null;
  const state = {
    imageData: null,
    srcW: 0,
    srcH: 0,
    workingW: 0,
    workingH: 0,
    palette: [],
    palSel: -1,
    palUse: 'wheel',
    stops: [
      { pos: 0, color: '#0b0f1a' },
      { pos: 100, color: '#f5f7ff' }
    ],
    gradientRamp: null,
    gradPhase: 0,
    gradCycles: 1,
    gradLevels: 12,
    curve: [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ],
    curveLut: null,
    baseName: 'dither',
    frames: [],
    rawFrames: [],
    animBoom: [],
    animTick: 0,
    raf: 0,
    animLast: 0,
    animActive: false,
    animBusy: false,
    fitMode: true,
    videoURL: null,
    videoEl: null,
    videoReady: false,
    videoLoading: false,
    videoFrames: [],
    lastSource: 'procedural',
    isVideo: false,
    mode: 'glitch',
    gifFrames: []
  };

  const PALETTES = {
    pico8: ['#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8', '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa', '#2b2b2b', '#3d3d3d', '#4f4f4f', '#616161', '#737373', '#858585', '#979797', '#a9a9a9', '#bbbbbb', '#cdcdcd', '#dfdfdf', '#f1f1f1', '#000000', '#1d2b53', '#7e2553', '#008751'],
    sweetie16: ['#1a1c2c', '#5d275d', '#b13e53', '#ef7d57', '#ffcd75', '#a7f070', '#38b764', '#257179', '#29366f', '#3b5dc9', '#41a6f6', '#73eff7', '#f4f4f4', '#94b0c2', '#566c86', '#333c57'],
    apollo: ['#263238', '#4f5d75', '#7da9bb', '#e3d5ca', '#f7f7f7', '#000000', '#a44a3f', '#eb7f58', '#f6b29b', '#8ab17d', '#bccb4f', '#4e3e3e', '#d8d3c9', '#846d5e', '#9c938b', '#b8b5ae'],
    coldgray: ['#08131f', '#183447', '#27547a', '#3c8ea2', '#79b2b2', '#b8cbb8', '#dfe6c4', '#eceab9'],
    commodore: ['#000000', '#7b7b7b', '#8c3827', '#e7662b', '#e7ba33', '#6fc242', '#36c17e', '#2d9902', '#4cd3ed', '#2e68f0', '#3356a1', '#8142c5', '#b365c4', '#ed7bd8', '#f8f8f4', '#a8a8a8'],
    journey: ['#cc3a4b', '#ab3c46', '#8b373f', '#6b3137', '#4b282d', '#d4979c', '#d06c74', '#3bd6c6', '#42c0b5', '#40a8a1', '#3e8f8a', '#3e776f', '#33bce3', '#2e9bc2', '#29e7cd', '#1e9c8e']
  };

  function hexToRgb(h) {
    h = String(h).replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(r, g, b) {
    return '#' + ('0' + Math.round(r).toString(16)).slice(-2) + ('0' + Math.round(g).toString(16)).slice(-2) + ('0' + Math.round(b).toString(16)).slice(-2);
  }

  function toast(msg, kind) {
    const t = ui.toast;
    t.textContent = msg;
    t.className = 'toast ' + (kind || 'ok');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.add('hidden'), 2600);
  }

  function parsePaletteText(text, filename) {
    const lines = String(text).split(/\r?\n/).map(l => l.replace(/^\s+/, '').replace(/\s+$/, ''));
    let mode = 'auto';
    const first = lines[0] || '';
    const isJson = /^\s*[\[{]/.test(text);
    if (isJson || /\.json$/i.test(filename || '')) {
      try {
        const data = JSON.parse(text);
        const arr = Array.isArray(data) ? data : (data.colors || data.palette || []);
        const out = [];
        for (const item of arr) {
          if (typeof item === 'string') out.push(hexToRgb(item));
          else if (Array.isArray(item)) out.push([item[0], item[1], item[2]]);
          else if (item && (item.hex !== undefined)) out.push(hexToRgb(item.hex));
          else if (item && (item.color !== undefined)) out.push(Array.isArray(item.color) ? item.color : hexToRgb(item.color));
          else if (item && (item[0] !== undefined)) out.push([item[0], item[1], item[2]]);
        }
        return out;
      } catch (e) {
        return null;
      }
    }
    if (/^GIMP Palette/i.test(first)) mode = 'gpl';
    else if (/^JASC-PAL/i.test(first)) mode = 'jasc';
    const out = [];
    let started = mode === 'auto';
    for (const raw of lines) {
      const line = raw.replace(/#.*$/, '').replace(/;.*$/, '').trim();
      if (!line) continue;
      if (mode === 'gpl') {
        if (/^(Title|Name|Columns|Channels|GIMP Palette)/i.test(line)) continue;
        started = true;
      } else if (mode === 'jasc') {
        if (/^(JASC-PAL|[0-9]+)$/i.test(line)) { continue; }
        started = true;
      }
      let m;
      m = line.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
      if (!m) m = line.match(/(\d{1,3})[,\s]+(\d{1,3})[,\s]+(\d{1,3})/);
      if (m) {
        const r = Math.min(255, +m[1]), g = Math.min(255, +m[2]), b = Math.min(255, +m[3]);
        if (r <= 255 && g <= 255 && b <= 255) out.push([r, g, b]);
        continue;
      }
      const hex = line.match(/([0-9a-fA-F]{6})\b/);
      if (hex) {
        const n = parseInt(hex[1], 16);
        out.push([(n >> 16) & 255, (n >> 8) & 255, n & 255]);
      }
    }
    void started;
    return out.length ? out : null;
  }

  /* La paleta cargada alimenta las paradas de la rueda (modo Paleta · Rueda). */
  function syncStopsFromPalette() {
    if (!state.palette.length) return;
    const colors = state.palette.slice().sort((a, b) => lum(a) - lum(b));
    state.stops = colors.map((c, i) => ({
      pos: Math.round((i / Math.max(1, colors.length - 1)) * 100),
      color: rgbToHex(c[0] * 255, c[1] * 255, c[2] * 255)
    }));
  }

  function setPalette(colors) {
    state.palette = colors.map(c => [c[0] / 255, c[1] / 255, c[2] / 255]);
    state.palSel = -1;
    ui.palCount.textContent = colors.length;
    renderSwatches();
    syncPalEdit();
    syncStopsFromPalette();
    if (ui.colorMode.value === 'palRueda') {
      renderColorOpts();
      schedule();
    } else {
      toast('Paleta cargada: ' + colors.length + ' colores');
    }
  }

  function renderSwatches() {
    if (!ui.palSwatches) return;
    ui.palSwatches.innerHTML = '';
    state.palette.forEach((c, i) => {
      const inp = document.createElement('input');
      inp.type = 'color';
      inp.className = 'swatch' + (i === state.palSel ? ' selected' : '');
      const hex = rgbToHex(c[0] * 255, c[1] * 255, c[2] * 255);
      inp.value = hex;
      inp.title = hex;
      inp.addEventListener('click', (e) => {
        e.stopPropagation();
        selectSwatch(i);
      });
      inp.addEventListener('change', () => {
        const rgb = hexToRgb(inp.value);
        state.palette[i] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
        markCustom();
        schedule();
        syncPalEdit();
      });
      ui.palSwatches.appendChild(inp);
    });
    renderSwatchClasses();
  }

  function renderSwatchClasses() {
    if (!ui.palSwatches) return;
    for (let k = 0; k < ui.palSwatches.children.length; k++) {
      ui.palSwatches.children[k].classList.toggle('selected', k === state.palSel);
    }
  }

  function selectSwatch(i) {
    state.palSel = i;
    renderSwatchClasses();
    syncPalEdit();
  }

  function applyPaletteToTritone() {
    if (!state.palette.length) return toast('Importa una paleta primero', 'err');
    const colors = state.palette;
    const sorted = colors.slice().sort((a, b) => lum(a) - lum(b));
    const pick = (i) => rgbToHex(sorted[Math.min(i, sorted.length - 1)][0] * 255, sorted[Math.min(i, sorted.length - 1)][1] * 255, sorted[Math.min(i, sorted.length - 1)][2] * 255);
    ui.colorMode.value = 'tritone';
    renderColorOpts();
    setTimeout(() => {
      ui.trC1.value = pick(0);
      ui.trC2.value = pick(Math.floor(sorted.length / 2));
      ui.trC3.value = pick(sorted.length - 1);
      schedule();
    }, 0);
  }

  /* ---------------- palette editor (ColorWheel HSV propio) ---------------- */

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    const c = v * s;
    const x = c * (1 - Math.abs((h / 60) % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const d = mx - mn;
    let h = 0;
    if (d > 0) {
      if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return [h, mx === 0 ? 0 : d / mx, mx];
  }

  function drawWheel() {
    const cv = ui.colorWheel;
    if (!cv) return;
    const size = cv.width;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const dd = img.data;
    const c = size / 2, r = size / 2 - 2;
    const v = (ui.wheelValue ? +ui.wheelValue.value : 85) / 100;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - c + 0.5, dy = y - c + 0.5;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const o = (y * size + x) * 4;
        if (dist > r) { dd[o + 3] = 0; continue; }
        const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        const sat = dist / r;
        const rgb = hsvToRgb(hue, sat, v);
        dd[o] = rgb[0]; dd[o + 1] = rgb[1]; dd[o + 2] = rgb[2]; dd[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    drawWheelMarker();
  }

  function drawWheelMarker() {
    const cv = ui.colorWheel;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const size = cv.width;
    const c = size / 2, r = size / 2 - 2;
    if (state.palSel >= 0 && state.palette[state.palSel]) {
      const cur = state.palette[state.palSel];
      const hsv = rgbToHsv(cur[0] * 255, cur[1] * 255, cur[2] * 255);
      if (hsv[1] > 0.02) {
        const ang = hsv[0] * Math.PI / 180;
        const x = c + Math.cos(ang) * hsv[1] * r;
        const y = c + Math.sin(ang) * hsv[1] * r;
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = '#0b0f1a';
        ctx.fill();
      }
    }
  }

  function wheelPick(e) {
    if (state.palSel < 0) { toast('Selecciona un swatch primero', 'err'); return; }
    const cv = ui.colorWheel;
    const rect = cv.getBoundingClientRect();
    const scale = cv.width / rect.width;
    const x = (e.clientX - rect.left) * scale;
    const y = (e.clientY - rect.top) * scale;
    const c = cv.width / 2, r = c - 2;
    const dx = x - c, dy = y - c;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > r) return;
    const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
    const sat = dist / r;
    const rgb = hsvToRgb(hue, sat, (ui.wheelValue ? +ui.wheelValue.value : 85) / 100);
    applyPalEditColor(rgb);
  }

  function applyPalEditColor(rgb) {
    if (state.palSel < 0) return;
    state.palette[state.palSel] = [rgb[0] / 255, rgb[1] / 255, rgb[2] / 255];
    ui.palHex.value = rgbToHex(rgb[0], rgb[1], rgb[2]);
    ui.palCount.textContent = state.palette.length;
    renderSwatches();
    markCustom();
    schedule();
  }

  function syncPalEdit() {
    if (!ui.palHex) return;
    if (state.palSel < 0 || !state.palette[state.palSel]) {
      ui.palHex.value = state.palette.length ? rgbToHex(state.palette[0][0] * 255, state.palette[0][1] * 255, state.palette[0][2] * 255) : '#ffffff';
      if (ui.palSelHint) ui.palSelHint.textContent = 'Haz clic en un swatch para editarlo.';
      drawWheel();
      return;
    }
    const cur = state.palette[state.palSel];
    ui.palHex.value = rgbToHex(cur[0] * 255, cur[1] * 255, cur[2] * 255);
    if (ui.wheelValue) {
      const hsv = rgbToHsv(cur[0] * 255, cur[1] * 255, cur[2] * 255);
      const v = Math.max(10, Math.round(hsv[2] * 100));
      ui.wheelValue.value = v;
      const vl = $('valWheelV');
      if (vl) vl.textContent = v;
    }
    if (ui.palSelHint) ui.palSelHint.textContent = 'Editando color ' + (state.palSel + 1) + ' de ' + state.palette.length + '.';
    drawWheel();
  }

  

  function lum(c) {
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function buildGradientRamp() {
    const stops = state.stops.slice().sort((a, b) => a.pos - b.pos);
    const cycles = Math.max(1, Math.min(8, Math.round(state.gradCycles || 1)));
    const phaseT = ((state.gradPhase || 0) % 360) / 360;
    const ramp = new Float32Array(256 * 3);
    const norm = stops.map(s => ({ p: s.pos / 100, c: hexToRgb(s.color).map(v => v / 255) }));
    for (let i = 0; i <= 255; i++) {
      const t0 = i / 255;
      const t = ((t0 * cycles) + phaseT) % 1;
      let a = norm[0], b = norm[norm.length - 1];
      for (let j = 0; j < norm.length - 1; j++) {
        if (t >= norm[j].p && t <= norm[j + 1].p) { a = norm[j]; b = norm[j + 1]; break; }
      }
      const span = Math.max(0.0001, b.p - a.p);
      const f = (t - a.p) / span;
      ramp[i * 3] = lerp(a.c[0], b.c[0], f);
      ramp[i * 3 + 1] = lerp(a.c[1], b.c[1], f);
      ramp[i * 3 + 2] = lerp(a.c[2], b.c[2], f);
    }
    return ramp;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  function buildCurveLut() {
    const lut = new Float32Array(256);
    const pts = state.curve.slice().sort((a, b) => a.x - b.x);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let lo = pts[0], hi = pts[pts.length - 1];
      for (let j = 0; j < pts.length - 1; j++) {
        if (t >= pts[j].x && t <= pts[j + 1].x) { lo = pts[j]; hi = pts[j + 1]; break; }
      }
      const span = Math.max(1e-6, hi.x - lo.x);
      lut[i] = clamp01(lo.y + (hi.y - lo.y) * ((t - lo.x) / span));
    }
    return lut;
  }

  function curveChanged() {
    state.curveLut = buildCurveLut();
    drawToneCurve();
    schedule();
  }

  function drawToneCurve() {
    const cv = ui.toneCurve;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.07)';
    ctx.lineWidth = 1;
    for (let g = 1; g < 4; g++) {
      const x = W * g / 4, y = H * g / 4;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();
    ctx.setLineDash([]);
    const pts = state.curve.slice().sort((a, b) => a.x - b.x);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, idx) => {
      const px = p.x * W, py = H - p.y * H;
      if (idx === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.stroke();
    pts.forEach(p => {
      const px = p.x * W, py = H - p.y * H;
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0b0f1a'; ctx.fill();
      ctx.strokeStyle = '#a78bfa'; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  function curveCanvasCoords(e) {
    const cv = ui.toneCurve;
    const r = cv.getBoundingClientRect();
    return { x: clamp01((e.clientX - r.left) / r.width), y: clamp01(1 - (e.clientY - r.top) / r.height) };
  }

  function curveNear(p) {
    let best = -1, bd = 0.07;
    state.curve.forEach((pt, i) => {
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return best;
  }

  function bindToneCurve() {
    const cv = ui.toneCurve;
    if (!cv) return;
    cv.addEventListener('mousedown', (e) => {
      const p = curveCanvasCoords(e);
      let dragging = curveNear(p);
      if (dragging < 0) {
        state.curve.push({ x: p.x, y: p.y });
        state.curve.sort((a, b) => a.x - b.x);
        dragging = state.curve.findIndex(pt => pt.x === p.x && pt.y === p.y);
        curveChanged();
      }
      const move = (ev) => {
        const q = curveCanvasCoords(ev);
        const pts = state.curve;
        if (dragging >= 0) {
          const lo = dragging === 0 ? 0 : pts[dragging - 1].x + 0.005;
          const hi = dragging === pts.length - 1 ? 1 : pts[dragging + 1].x - 0.005;
          pts[dragging].x = clamp01(Math.min(hi, Math.max(lo, q.x)));
          pts[dragging].y = clamp01(q.y);
          curveChanged();
        }
      };
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    cv.addEventListener('dblclick', (e) => {
      const p = curveCanvasCoords(e);
      const idx = curveNear(p);
      if (idx >= 0 && state.curve.length > 2) {
        state.curve.splice(idx, 1);
        curveChanged();
      }
    });
    const btn = ui.btnCurveReset;
    if (btn) btn.addEventListener('click', () => {
      state.curve = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
      curveChanged();
    });
  }

  function renderGradient() {
    const out = document.getElementById('gradStops');
    if (!out) return;
    const stops = state.stops.slice().sort((a, b) => a.pos - b.pos);
    const lane = document.getElementById('gradLane');
    if (lane) {
      lane.style.background = 'linear-gradient(90deg, ' + stops.map(s => s.color + ' ' + s.pos + '%').join(', ') + ')';
    }
    out.innerHTML = '';
    state.stops.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'grad-stop';
      const color = document.createElement('input');
      color.type = 'color';
      color.value = s.color;
      color.addEventListener('input', () => {
        state.stops[i].color = color.value;
        renderGradient();
        schedule();
      });
      const pos = document.createElement('input');
      pos.type = 'range';
      pos.min = 0;
      pos.max = 100;
      pos.value = s.pos;
      pos.addEventListener('input', () => {
        state.stops[i].pos = +pos.value;
        renderGradient();
        schedule();
      });
      const del = document.createElement('button');
      del.className = 'del';
      del.textContent = '✕';
      del.addEventListener('click', () => {
        if (state.stops.length > 2) {
          state.stops.splice(i, 1);
          renderGradient();
          schedule();
        } else {
          toast('El degradado necesita al menos 2 paradas', 'err');
        }
      });
      row.appendChild(color);
      row.appendChild(pos);
      row.appendChild(del);
      out.appendChild(row);
    });
  }

  /* ---------------- dynamic option panels ---------------- */

  const ALGO_TITLES = {
    floydsteinberg: 'Diffusion d\'erreur', falsefloyd: 'False Floyd', jarvis: 'Jarvis', stucki: 'Stucki',
    burkes: 'Burkes', sierra: 'Sierra', sierra2: 'Sierra 2', sierralite: 'Sierra Lite', atkinson: 'Atkinson',
    bayer: 'Bayer', modulation: 'Modulación', bitmappattern: 'Patrón', ascii: 'ASCII'
  };

  function renderAlgoOpts() {
    const box = ui.algoOpts;
    const algo = ui.algoSelect.value;
    const diff = ['floydsteinberg', 'falsefloyd', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra2', 'sierralite', 'atkinson'].includes(algo);
    let html = '';
    if (diff) {
      html += '<label class="check"><input type="checkbox" id="serpentine" checked/><span>Barrido serpentino</span></label>';
    } else if (algo === 'bayer') {
      html += '<label class="field"><span class="field-label">Tamaño de matriz</span><select id="bayerSize"><option value="2">2×2</option><option value="4" selected>4×4</option><option value="8">8×8</option><option value="16">16×16</option></select></label>';
    } else if (algo === 'modulation') {
      html += '<label class="field"><span class="field-label">Algoritmo de ruido</span><select id="modType">';
      html += '<option value="white">Ruido blanco (estatico)</option>';
      html += '<option value="blue" selected>Azul equilibrado (Ulichney)</option>';
      html += '<option value="bayer">Ordenado (Bayer)</option>';
      html += '<option value="ign">Entrelazado IGN (retro consola)</option>';
      html += '<option value="knoll">Disperso Knoll (grano foto)</option>';
      html += '<option value="value">Valor suave</option>';
      html += '<option value="perlin">Perlin</option>';
      html += '<option value="cellular">Celular (Worley)</option>';
      html += '</select></label>';
      html += '<label class="field"><span class="field-label">Fuerza de modulacion <b id="valModStr">80</b>%</span><input type="range" id="modStrength" min="0" max="100" value="80"/></label>';
      html += '<div class="divider-label">Ruido por zonas</div>';
      html += '<label class="field"><span class="field-label">Sombras <b id="valZoneD">70</b>%</span><input type="range" id="zoneDark" min="0" max="100" value="70"/></label>';
      html += '<label class="field"><span class="field-label">Medios <b id="valZoneM">100</b>%</span><input type="range" id="zoneMid" min="0" max="100" value="100"/></label>';
      html += '<label class="field"><span class="field-label">Luces <b id="valZoneL">35</b>%</span><input type="range" id="zoneLight" min="0" max="100" value="35"/></label>';
      html += '<label class="field"><span class="field-label">Tamaño de celda <b id="valNoise">4</b> px</span><input type="range" id="noiseScale" min="1" max="32" value="4"/></label>';
      html += '<label class="field"><span class="field-label">Semilla</span><input type="number" id="noiseSeed" min="0" max="9999" value="1"/></label>';
      html += '<label class="field"><span class="field-label">Bandas de posterización <b id="valBands">5</b></span><input type="range" id="modBands" min="2" max="16" value="5"/></label>';
      html += '<label class="field"><span class="field-label">Ripple (ondulación) <b id="valRipple">25</b></span><input type="range" id="modRipple" min="0" max="100" value="25"/></label>';
      html += '<label class="check"><input type="checkbox" id="modInterp"/><span>Interpolación suave</span></label>';
    } else if (algo === 'bitmappattern') {
      html += '<label class="field"><span class="field-label">Patrón</span><select id="pattern">';
      html += '<option value="dot">Punto (halftone)</option><option value="ring">Anillo</option><option value="horizontal">Líneas horizontales</option><option value="vertical">Líneas verticales</option><option value="diagonal">Diagonal</option><option value="checker">Cuadrícula</option><option value="spiral">Espiral</option><option value="custom">Personalizado</option></select></label>';
      html += '<label class="field"><span class="field-label">Tamaño <b id="valPatSize">8</b></span><input type="range" id="patternSize" min="2" max="64" value="8"/></label>';
      html += '<label class="check"><input type="checkbox" id="patternInvert"/><span>Invertir umbral</span></label>';
      html += '<details id="customPatternBox" class="hidden"><summary>Mapa de bits personalizado</summary><textarea id="patternCustom" rows="4" spellcheck="false" placeholder="10101010&#10;01010101&#10;10101010&#10;01010101"></textarea></details>';
    } else if (algo === 'ascii') {
      html += '<label class="field"><span class="field-label">Tamaño de carácter <b id="valAscii">8 px</b></span><input type="range" id="asciiScale" min="4" max="32" value="8"/></label>';
      html += '<label class="field"><span class="field-label">Conjunto</span><select id="asciiCharset"><option value="classic">Clásico</option><option value="blocks">Bloques</option><option value="partial">Bloques parciales</option><option value="minimal">Minimal</option><option value="digits">Dígitos</option><option value="binary">Binario</option></select></label>';
      html += '<label class="check"><input type="checkbox" id="asciiInvert"/><span>Invertir</span></label>';
    }
    if (algo !== 'ascii') {
      html += '<label class="field"><span class="field-label">Multiplicador de celda</span><select id="algoMult">';
      html += '<option value="1" selected>×1 (detalle completo)</option>';
      html += '<option value="2">×2</option><option value="4">×4</option><option value="6">×6</option><option value="8">×8</option>';
      html += '</select></label>';
      html += '<p class="hint">' + algoHint(algo) + '</p>';
    }
    box.innerHTML = html;
    if (algo === 'bitmappattern') {
      const patSel = $('pattern');
      const customBox = $('customPatternBox');
      const sync = () => customBox.classList.toggle('hidden', patSel.value !== 'custom');
      patSel.addEventListener('change', sync);
      sync();
      const patSize = $('patternSize');
      patSize.addEventListener('input', () => { $('valPatSize').textContent = patSize.value; schedule(); });
      $('patternInvert').addEventListener('change', schedule);
      const custom = $('patternCustom');
      custom.addEventListener('input', () => { schedule(); });
      patSel.addEventListener('change', schedule);
    } else if (algo === 'modulation') {
      const ns = $('noiseScale');
      ns.addEventListener('input', () => { $('valNoise').textContent = ns.value + ' px'; markCustom(); schedule(); });
      $('noiseSeed').addEventListener('input', () => { markCustom(); schedule(); });
      $('modType').addEventListener('change', () => { markCustom(); schedule(); });
      const mstr = $('modStrength');
      mstr.addEventListener('input', () => { $('valModStr').textContent = mstr.value; markCustom(); schedule(); });
      const zd = $('zoneDark');
      zd.addEventListener('input', () => { $('valZoneD').textContent = zd.value; markCustom(); schedule(); });
      const zm = $('zoneMid');
      zm.addEventListener('input', () => { $('valZoneM').textContent = zm.value; markCustom(); schedule(); });
      const zl = $('zoneLight');
      zl.addEventListener('input', () => { $('valZoneL').textContent = zl.value; markCustom(); schedule(); });
      const bands = $('modBands');
      bands.addEventListener('input', () => { $('valBands').textContent = bands.value; markCustom(); schedule(); });
      const ripple = $('modRipple');
      ripple.addEventListener('input', () => { $('valRipple').textContent = ripple.value; markCustom(); schedule(); });
      $('modInterp').addEventListener('change', () => { markCustom(); schedule(); });
    } else if (algo === 'ascii') {
      const as = $('asciiScale');
      as.addEventListener('input', () => { $('valAscii').textContent = as.value + ' px'; markCustom(); schedule(); });
      $('asciiCharset').addEventListener('change', () => { markCustom(); schedule(); });
      $('asciiInvert').addEventListener('change', () => { markCustom(); schedule(); });
    } else if (diff) {
      $('serpentine').addEventListener('change', () => { markCustom(); schedule(); });
    } else {
      $('bayerSize').addEventListener('change', () => { markCustom(); schedule(); });
    }
    const mEl = $('algoMult');
    if (mEl) mEl.addEventListener('change', () => { markCustom(); schedule(); });
  }

  function algoHint(algo) {
    const hints = {
      floydsteinberg: 'Difusión de error jerárquica con pesos 7/16, 3/16, 5/16 y 1/16.',
      falsefloyd: 'Variante ligera de Floyd–Steinberg con solo 3 celdas.',
      jarvis: 'Difusión de 2 filas con núcleo 3×5, patrón suave.',
      stucki: 'Similar a Jarvis con error ligeramente amortiguado.',
      burkes: 'Núcleo compacto de 2 filas muy usado.',
      sierra: 'Difusión de 3 filas con distribución completa.',
      sierra2: 'Versión de 2 filas de Sierra.',
      sierralite: 'La más simple de la familia Sierra.',
      atkinson: 'Reparte 6/8 del error, da textura acentuada.',
      bayer: 'Umbral mediante matriz ordenada de Bayer.',
      modulation: 'Ruido modulado: azul Ulichney, blanco, Bayer, IGN retro, Knoll foto, valor, Perlin o Worley, con fuerza global y por zonas + bandas + ripple.',
      bitmappattern: 'Umbral por repetición de un patrón de mapa de bits.'
    };
    return hints[algo] || '';
  }

  function gradientOptsHtml() {
    let html = '';
    html += '<label class="field"><span class="field-label">Preset</span><select id="gradPreset">';
    html += '<option value="nightRush">NightRush</option><option value="asukaNeon">Cian-rojo neón</option><option value="neonTrace">Magenta neón</option><option value="matrixCyber">Verde-cian digital</option><option value="eva">Violeta profundo</option><option value="fire">Fuego</option><option value="ocean">Océano</option><option value="neon">Neón</option><option value="sepia">Sepia</option><option value="viridis">Viridis</option><option value="cold">Frío</option><option value="thermal">Térmico</option><option value="solarize">Solarize</option><option value="irPaik">Infrarrojo</option><option value="fireAsh">Fuego y Ceniza</option><option value="cyberMatrix">Fósforo verde</option><option value="acidRainbow">Acid Rainbow</option></select></label>';
    html += '<div class="grad-lane" id="gradLane"></div>';
    html += '<div id="gradStops" class="grad-stops"></div>';
    html += '<button class="btn ghost small" id="btnAddStop">+ Añadir parada</button>';
    html += '<div class="color-grid">';
    html += '<label class="field"><span class="field-label">Ciclos <b id="valGradCycles">' + (state.gradCycles || 1) + 'x</b></span><input type="range" id="gradCycles" min="1" max="8" value="' + Math.max(1, Math.min(8, state.gradCycles || 1)) + '"/></label>';
    html += '<label class="field"><span class="field-label">Fase <b id="valGradPhase">' + (Math.round(state.gradPhase || 0)) + '°</b></span><input type="range" id="gradPhase" min="0" max="360" step="2" value="' + Math.round(state.gradPhase || 0) + '"/></label>';
    html += '</div>';
    html += '<label class="field"><span class="field-label">Niveles de color <b id="valGradLevels">' + Math.max(2, Math.min(64, state.gradLevels || 12)) + '</b></span><input type="range" id="gradLevels" min="2" max="64" value="' + Math.max(2, Math.min(64, state.gradLevels || 12)) + '"/></label>';
    return html;
  }

  function bindGradientOpts() {
    const preset = $('gradPreset');
    if (preset) preset.addEventListener('change', () => applyGradientPreset(preset.value));
    const add = $('btnAddStop');
    if (add) add.addEventListener('click', () => {
      state.stops.push({ pos: 50, color: '#7aa2ff' });
      renderGradient();
      schedule();
    });
    const cyc = $('gradCycles');
    if (cyc) cyc.addEventListener('input', () => {
      state.gradCycles = +cyc.value;
      $('valGradCycles').textContent = cyc.value + 'x';
      markCustom();
      schedule();
    });
    const ph = $('gradPhase');
    if (ph) ph.addEventListener('input', () => {
      state.gradPhase = +ph.value;
      $('valGradPhase').textContent = ph.value + '°';
      markCustom();
      schedule();
    });
    const lv = $('gradLevels');
    if (lv) lv.addEventListener('input', () => {
      state.gradLevels = +lv.value;
      $('valGradLevels').textContent = lv.value;
      markCustom();
      schedule();
    });
    renderGradient();
  }

  function renderColorOpts() {
    const box = ui.colorOpts;
    const mode = ui.colorMode.value;
    let html = '';
    if (mode === 'bw') {
      html += '<div class="color-grid">';
      html += '<label class="field"><span class="field-label">Oscuro</span><input type="color" id="bwC1" value="#000000"/></label>';
      html += '<label class="field"><span class="field-label">Claro</span><input type="color" id="bwC2" value="#ffffff"/></label>';
      html += '</div>';
      html += '<label class="check"><input type="checkbox" id="invBw"/><span>Invertir</span></label>';
    } else if (mode === 'duotone') {
      html += '<div class="color-grid">';
      html += '<label class="field"><span class="field-label">Color 1</span><input type="color" id="dtC1" value="#000000"/></label>';
      html += '<label class="field"><span class="field-label">Color 2</span><input type="color" id="dtC2" value="#f5f7ff"/></label>';
      html += '</div>';
    } else if (mode === 'tritone') {
      html += '<div class="color-grid">';
      html += '<label class="field"><span class="field-label">Color 1</span><input type="color" id="trC1" value="#12081c"/></label>';
      html += '<label class="field"><span class="field-label">Color 2</span><input type="color" id="trC2" value="#7a2cff"/></label>';
      html += '<label class="field"><span class="field-label">Color 3</span><input type="color" id="trC3" value="#8bff7d"/></label>';
      html += '</div>';
    } else if (mode === 'preserve') {
      html += '<label class="field"><span class="field-label">Niveles por canal <b id="valPreserve">8</b></span><input type="range" id="presLevels" min="2" max="16" value="8"/></label>';
      html += '<p class="hint">Quantifica cada canal RGB conservando el color de la foto con dithering por canal.</p>';
    } else if (mode === 'palRueda') {
      html += '<label class="field"><span class="field-label">Uso</span><select id="palUse">';
      html += '<option value="wheel">Degradado continuo (rueda)</option>';
      html += '<option value="quant">Paleta cuantizada</option>';
      html += '</select></label>';
      if (state.palUse === 'quant') {
        if (!state.palette.length) {
          html += '<p class="hint">Importa o carga una paleta abajo en esta misma sección.</p>';
        } else {
          html += '<label class="field"><span class="field-label">Paletizado</span><select id="palOrder">';
          html += '<option value="diffusion">Difusión RGB (formas suaves)</option>';
          html += '<option value="ordered">Ordenado por luminancia</option>';
          html += '</select></label>';
          html += '<p class="hint">Usando los <b>' + state.palette.length + '</b> colores de tu paleta.</p>';
        }
      } else {
        html += gradientOptsHtml();
        html += '<p class="hint">Colorama analógico: la paleta cargada alimenta las paradas de la rueda; los ciclos repiten el degradado y la fase desplaza el punto de arranque alrededor del anillo.</p>';
      }
      if (ui.palDetails) {
        ui.palDetails.classList.remove('hidden');
        ui.palDetails.open = true;
      }
      renderSwatches();
    }
    box.innerHTML = html;

    if (mode === 'bw') {
      ui.bwC1 = $('bwC1'); ui.bwC2 = $('bwC2'); ui.invBw = $('invBw');
      [ui.bwC1, ui.bwC2].forEach(el => el.addEventListener('input', schedule));
      ui.invBw.addEventListener('change', schedule);
    } else if (mode === 'duotone') {
      ui.dtC1 = $('dtC1'); ui.dtC2 = $('dtC2');
      [ui.dtC1, ui.dtC2].forEach(el => el.addEventListener('input', schedule));
    } else if (mode === 'tritone') {
      ui.trC1 = $('trC1'); ui.trC2 = $('trC2'); ui.trC3 = $('trC3');
      [ui.trC1, ui.trC2, ui.trC3].forEach(el => el.addEventListener('input', schedule));
    } else if (mode === 'preserve') {
      const pl = $('presLevels');
      pl.addEventListener('input', () => { $('valPreserve').textContent = pl.value; schedule(); });
    } else if (mode === 'palRueda') {
      const use = $('palUse');
      if (use) {
        use.value = state.palUse;
        use.addEventListener('change', () => {
          state.palUse = use.value;
          markCustom();
          renderColorOpts();
          schedule();
        });
      }
      if (state.palUse === 'quant') {
        const po = $('palOrder');
        if (po) po.addEventListener('change', schedule);
      } else {
        bindGradientOpts();
      }
    }
    if (ui.palDetails) ui.palDetails.classList.toggle('hidden', mode !== 'palRueda');
  }

  const GRAD_PRESETS = {
    nightRush: [{ pos: 0, color: '#0b0f1a' }, { pos: 50, color: '#7e22ce' }, { pos: 100, color: '#22d3ee' }],
    asukaNeon: [{ pos: 0, color: '#040206' }, { pos: 25, color: '#2b033d' }, { pos: 55, color: '#d9114e' }, { pos: 82, color: '#ff2560' }, { pos: 100, color: '#ffe4ea' }],
    neonTrace: [{ pos: 0, color: '#030207' }, { pos: 40, color: '#16082e' }, { pos: 70, color: '#a814d4' }, { pos: 88, color: '#f72ac7' }, { pos: 100, color: '#ffffff' }],
    matrixCyber: [{ pos: 0, color: '#02070d' }, { pos: 35, color: '#062d3e' }, { pos: 70, color: '#06d6a0' }, { pos: 90, color: '#22d3ee' }, { pos: 100, color: '#f0fdff' }],
    eva: [{ pos: 0, color: '#000000' }, { pos: 33, color: '#2a0a4a' }, { pos: 66, color: '#7b2ff7' }, { pos: 100, color: '#e8dcff' }],
    fire: [{ pos: 0, color: '#0a0a14' }, { pos: 40, color: '#7b1fa2' }, { pos: 75, color: '#ff7849' }, { pos: 100, color: '#ffe66d' }],
    ocean: [{ pos: 0, color: '#030712' }, { pos: 45, color: '#0b3d91' }, { pos: 100, color: '#0db39e' }],
    neon: [{ pos: 0, color: '#090814' }, { pos: 50, color: '#2bff88' }, { pos: 100, color: '#ff2bd6' }],
    sepia: [{ pos: 0, color: '#17120d' }, { pos: 50, color: '#8a5a3b' }, { pos: 100, color: '#f2e3c6' }],
    viridis: [{ pos: 0, color: '#440154' }, { pos: 25, color: '#414487' }, { pos: 55, color: '#2a788e' }, { pos: 78, color: '#22a884' }, { pos: 100, color: '#fde725' }],
    cold: [{ pos: 0, color: '#08131f' }, { pos: 50, color: '#3c8ea2' }, { pos: 100, color: '#eceab9' }],
    thermal: [{ pos: 0, color: '#05050a' }, { pos: 28, color: '#28124a' }, { pos: 50, color: '#8a1c4a' }, { pos: 68, color: '#e2442a' }, { pos: 84, color: '#ff9a3d' }, { pos: 100, color: '#fff6c9' }],
    solarize: [{ pos: 0, color: '#000000' }, { pos: 30, color: '#ff00a2' }, { pos: 55, color: '#fafafa' }, { pos: 75, color: '#00c2ff' }, { pos: 100, color: '#000000' }],
    irPaik: [{ pos: 0, color: '#02020a' }, { pos: 30, color: '#12086a' }, { pos: 55, color: '#ff2b6a' }, { pos: 78, color: '#ffb3d1' }, { pos: 100, color: '#ffffff' }],
    fireAsh: [{ pos: 0, color: '#06060a' }, { pos: 35, color: '#3d1f2e' }, { pos: 62, color: '#ff5a1f' }, { pos: 82, color: '#ffd370' }, { pos: 100, color: '#e8e6df' }],
    cyberMatrix: [{ pos: 0, color: '#010603' }, { pos: 40, color: '#062b1a' }, { pos: 70, color: '#00ff9c' }, { pos: 100, color: '#eafff4' }],
    acidRainbow: [{ pos: 0, color: '#0c0012' }, { pos: 20, color: '#ff00cc' }, { pos: 40, color: '#ffcc00' }, { pos: 60, color: '#00e676' }, { pos: 80, color: '#00b0ff' }, { pos: 100, color: '#0c0012' }]
  };

  function applyGradientPreset(name) {
    if (GRAD_PRESETS[name]) {
      state.stops = GRAD_PRESETS[name].map(s => ({ pos: s.pos, color: s.color }));
      renderGradient();
      schedule();
    }
  }

  /* ---------------- params collection ---------------- */

  function collectAlgoOpts() {
    const algo = ui.algoSelect.value;
    const mult = algo !== 'ascii' && $('algoMult') ? +$('algoMult').value : 1;
    const diff = ['floydsteinberg', 'falsefloyd', 'jarvis', 'stucki', 'burkes', 'sierra', 'sierra2', 'sierralite', 'atkinson'].includes(algo);
    let o;
    if (diff) {
      o = { serpentine: $('serpentine') ? $('serpentine').checked : true };
    } else if (algo === 'bayer') {
      o = { size: $('bayerSize') ? +$('bayerSize').value : 4 };
    } else if (algo === 'modulation') {
      o = { modType: $('modType') ? $('modType').value : 'blue', seed: $('noiseSeed') ? (+$('noiseSeed').value || 0) : 0, noiseScale: $('noiseScale') ? +$('noiseScale').value : 4, interp: $('modInterp') ? $('modInterp').checked : false, modBands: $('modBands') ? +$('modBands').value : 5, modRipple: $('modRipple') ? +$('modRipple').value : 25 };
      o.modStrength = $('modStrength') ? (+$('modStrength').value / 100) : 0.8;
      o.modZones = {
        dark: $('zoneDark') ? (+$('zoneDark').value / 100) : 0.7,
        mid: $('zoneMid') ? (+$('zoneMid').value / 100) : 1,
        light: $('zoneLight') ? (+$('zoneLight').value / 100) : 0.35
      };
    } else if (algo === 'bitmappattern') {
      o = {
        pattern: $('pattern') ? $('pattern').value : 'dot',
        patternSize: $('patternSize') ? +$('patternSize').value : 8,
        invert: $('patternInvert') ? $('patternInvert').checked : false,
        customPatternText: $('patternCustom') ? $('patternCustom').value : null
      };
    } else if (algo === 'ascii') {
      o = {
        asciiScale: $('asciiScale') ? +$('asciiScale').value : 8,
        asciiCharset: $('asciiCharset') ? $('asciiCharset').value : 'classic',
        asciiInvert: $('asciiInvert') ? $('asciiInvert').checked : false
      };
    } else {
      o = {};
    }
    o.mult = mult;
    return o;
  }

  function collectColorOpts() {
    const m = ui.colorMode.value;
    if (m === 'bw') {
      return { c1: hexToRgb(ui.bwC1.value).map(v => v / 255), c2: hexToRgb(ui.bwC2.value).map(v => v / 255) };
    }
    if (m === 'duotone') return { c1: hexToRgb(ui.dtC1.value).map(v => v / 255), c2: hexToRgb(ui.dtC2.value).map(v => v / 255) };
    if (m === 'tritone') return { c1: hexToRgb(ui.trC1.value).map(v => v / 255), c2: hexToRgb(ui.trC2.value).map(v => v / 255), c3: hexToRgb(ui.trC3.value).map(v => v / 255) };
    if (m === 'preserve') return { levels: $('presLevels') ? +$('presLevels').value : 8 };
    if (m === 'palRueda') {
      if (state.palUse === 'quant') {
        return { palette: state.palette.length ? state.palette : [[0, 0, 0], [1, 1, 1]], order: $('palOrder') ? $('palOrder').value : 'diffusion' };
      }
      return { ramp: state.gradientRamp || buildGradientRamp(), levels: state.gradLevels || 12 };
    }
    return {};
  }

  /* Modo interno del motor a partir del modo de UI (palRueda fusiona
     Degradado continuo y Paleta cuantizada bajo un mismo modo). */
  function engineColorMode() {
    const m = ui.colorMode.value;
    if (m === 'palRueda') return state.palUse === 'quant' ? 'palette' : 'gradient';
    return m;
  }

  function upgradeParams(extra) {
    if (!state.imageData) return null;
    const p = {
      width: state.workingW,
      height: state.workingH,
      rgba: state.workingRGBA,
      algorithm: ui.algoSelect.value,
      algorithmOpts: collectAlgoOpts(),
      colorMode: engineColorMode(),
      colorOpts: collectColorOpts(),
      pre: {
        brightness: (+ui.preBrightness.value) / 100,
        contrast: (+ui.preContrast.value + 100) / 100,
        gamma: (+ui.preGamma.value) / 100,
        curve: state.curveLut || buildCurveLut()
      },
      outputRange: {
        dark: (+ui.darkCut.value) / 100,
        light: Math.max(+ui.lightCut.value / 100, +ui.darkCut.value / 100 + 0.01)
      },
      invert: ui.invBw ? ui.invBw.checked : false,
      transparent: { enabled: ui.transpCheck.checked, which: ui.transpWhich.value }
    };
    if (extra) Object.assign(p, extra);
    DitherEngine.preparePattern(p);
    return p;
  }

  function getWorkingRGBA() {
    if (!state.imageData) return null;
    const w = state.srcW;
    const h = state.srcH;
    state.workingW = w;
    state.workingH = h;
    state.workingRGBA = state.imageData.data;
    return state.workingRGBA;
  }

  /* ---------------- render pipeline ---------------- */

  let renderTimer = 0;
  function schedule() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 90);
  }

  function render() {
    if (!state.imageData) return;
    state.gradientRamp = buildGradientRamp();
    state.curveLut = buildCurveLut();
    getWorkingRGBA();
    const params = upgradeParams();
    if (!params) return;
    const t0 = performance.now();

    const info = updateInfoLabel();
    setInfoDim(true);
    try {
      if (ui.animCheck.checked) {
        buildAnimFrames(params);
      } else {
        stopAnim();
        const core = renderCore(params, null);
        const final = applyFrameEffects(core, params, null);
        drawToPreview(final);
      }
    } catch (e) {
      console.error(e);
      toast('Error procesando: ' + e.message, 'err');
    }
    setInfoDim(false);
    const elapsed = Math.round(performance.now() - t0);
    ui.dimInfo.textContent = state.workingW + '×' + state.workingH + ' · ' + elapsed + ' ms';
    ui.algoInfo.textContent = info;
  }

  function collectCrtOpts() {
    return {
      enabled: true,
      type: ui.crtType ? ui.crtType.value : 'rect',
      mask: ui.crtMask ? ui.crtMask.value : 'grille',
      scanlines: +ui.crtScanlines.value / 100,
      phosphor: +ui.crtPhosphor.value / 100,
      frame: +ui.crtFrame.value / 100,
      hue: +ui.crtHue.value,
      curvature: +ui.crtCurvature.value / 100,
      eyefish: +ui.crtEyefish.value / 100,
      eyefishRadius: +ui.crtEyefishR.value / 100,
      conv: +ui.crtConv.value / 100,
      roll: +ui.crtRoll.value / 100,
      bloom: ui.crtBloom ? +ui.crtBloom.value / 100 : 0,
      bloomThresh: ui.crtBloomThresh ? +ui.crtBloomThresh.value / 100 : 0.22,
      bloomChrom: ui.crtBloomChrom ? +ui.crtBloomChrom.value : 2,
      bloomTint: ui.crtBloomTint ? ui.crtBloomTint.value : '#ff00cc',
      bloomBlend: ui.crtBloomBlend ? ui.crtBloomBlend.value : 'screen',
      trail: +ui.crtTrail.value / 100,
      raster: +ui.crtRaster.value / 100,
      flicker: +ui.crtFlicker.value / 100,
      dropout: ui.crtDropout ? +ui.crtDropout.value / 100 : 0,
      echo: +ui.crtEcho.value / 100,
      echoMode: ui.crtEchoMode ? ui.crtEchoMode.value : 'rgb',
      vibrance: +ui.crtVibrance.value / 100,
      saturation: +ui.crtSatur.value / 100,
      wave: ui.waveAmount ? +ui.waveAmount.value : 0,
      waveFreq: ui.waveFreq ? +ui.waveFreq.value / 10 : 1.5,
      waveSpeed: ui.waveSpeed ? +ui.waveSpeed.value / 100 : 0.2,
      waveSkew: ui.waveSkew ? +ui.waveSkew.value / 100 : 0,
      waveForm: ui.waveForm ? ui.waveForm.value : 'sin'
    };
  }

  /* ---------------- mascara selectiva (grano en una sola pasada) ---------------- */

  function collectMaskOpts() {
    return {
      enabled: ui.maskCheck ? ui.maskCheck.checked : false,
      source: ui.maskSource ? ui.maskSource.value : 'brillo',
      threshold: ui.maskThresh ? +ui.maskThresh.value : 50,
      smooth: ui.maskSmooth ? +ui.maskSmooth.value : 25,
      opacity: ui.maskOpacity ? +ui.maskOpacity.value : 100,
      color: ui.maskColor ? ui.maskColor.value : '#2a5aff',
      bw: ui.maskBW ? ui.maskBW.checked : true
    };
  }

  function syncMaskUI() {
    const on = ui.maskCheck ? ui.maskCheck.checked : false;
    if (ui.maskOpts) ui.maskOpts.classList.toggle('hidden', !on);
  }

  /* Render del fotograma. Con mascara activa siempre se compone por overlay
     (doble capa, tanto imagen fija como video): la base es la "capa original"
     (mapa continuo del modo de color/gradiente activo via renderFlat, sin
     dither) y la capa afectada es el dither del algoritmo activo, en B&N por
     defecto para leerse como luminancia superpuesta, mezcladas pixel a pixel
     con el alpha de la clave CRT (luma Rec.601 sobre la imagen procesada).
     Asi la mascara funciona con cualquier algoritmo (difusion de error
     incluida), no solo con los ordenados. */
  /* Construye el paquete de efectos a partir de la UI y delega el render en el motor. */
  function frameFx() {
    const crtEnabled = !!(ui.crtCheck && ui.crtCheck.checked);
    const fx = {
      sharpen: ui.sharpen ? +ui.sharpen.value : 0,
      crtEnabled,
      crtOpts: collectCrtOpts(),
      bloomTintOverride: (ui.maskCheck && ui.maskCheck.checked && ui.maskColor) ? ui.maskColor.value : null,
      bloomFallback: null
    };
    // Si CRT esta apagado pero Bloom esta configurado (> 0), se aplica standalone
    if (!crtEnabled && window.CRT && window.CRT.bloomPass && ui.crtBloom && +ui.crtBloom.value > 0) {
      fx.bloomFallback = {
        amount: +ui.crtBloom.value / 100,
        thresh: ui.crtBloomThresh ? +ui.crtBloomThresh.value / 100 : 0.22,
        chromatic: ui.crtBloomChrom ? +ui.crtBloomChrom.value : 2,
        tint: ui.crtBloomTint ? ui.crtBloomTint.value : '#ff00cc',
        blend: ui.crtBloomBlend ? ui.crtBloomBlend.value : 'screen'
      };
    }
    return fx;
  }

  function renderCore(params, frameIdx) {
    void frameIdx;
    return window.StudioEngine.renderCore(params, collectMaskOpts());
  }

  function applyFrameEffects(coreCanvas, params, time) {
    return window.StudioEngine.applyFrameEffects(coreCanvas, params, frameFx(), time);
  }

  function dualLayerActive() {
    return !!(ui.maskCheck && ui.maskCheck.checked);
  }

  function updateInfoLabel() {
    const algo = ALGO_TITLES[ui.algoSelect.value] || ui.algoSelect.value;
    const modes = { bw: 'B&N', duotone: 'Duotono', tritone: 'Tritono', preserve: 'Color', palRueda: 'Paleta · Rueda' };
    return algo + ' · ' + (modes[ui.colorMode.value] || '') + (dualLayerActive() ? ' · Doble capa' : '');
  }

  function setInfoDim(busy) {
    ui.dimInfo.style.opacity = busy ? 0.5 : 1;
  }

  function drawToPreview(canvas) {
    const pv = ui.preview;
    if (pv.width !== canvas.width) pv.width = canvas.width;
    if (pv.height !== canvas.height) pv.height = canvas.height;
    const ctx = pv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(canvas, 0, 0);
  }

  /* ---------------- animation ---------------- */

  function boomerangize(frames, enabled) {
    return window.StudioEngine.boomerangize(frames, enabled);
  }

  function buildAnimFrames(baseParams) {
    const source = ui.animSource ? ui.animSource.value : 'procedural';
    state.lastSource = source;
    if (source === 'video') {
      buildVideoAnimFrames();
      return;
    }
    if (source === 'gif') {
      buildGifAnimFrames();
      return;
    }
    const n = Math.max(2, +ui.animRhythm.value);
    const noise = ui.animNoise ? (+ui.animNoise.value || 0) / 100 : 0;
    const echoAmt = ui.animEcho ? (+ui.animEcho.value || 0) / 100 : 0;

    const frames = [];
    const fps = +ui.animRhythm.value;
    const delayMs = 1000 / fps;
    let prev = null;
    for (let f = 0; f < n; f++) {
      const p = {
        width: baseParams.width,
        height: baseParams.height,
        rgba: baseParams.rgba,
        algorithm: baseParams.algorithm,
        algorithmOpts: Object.assign({}, baseParams.algorithmOpts),
        colorMode: baseParams.colorMode,
        colorOpts: Object.assign({}, baseParams.colorOpts),
        pre: baseParams.pre,
        outputRange: baseParams.outputRange,
        invert: baseParams.invert,
        transparent: baseParams.transparent,
        animNoise: noise,
        animSeed: f
      };
      const core = renderCore(p, f);
      let fr = applyFrameEffects(core, p, f);
      if (echoAmt > 0) fr = window.StudioEngine.blendEcho(prev, fr, echoAmt);
      prev = fr;
      frames.push(fr);
    }
    const boomOn = ui.animBoomerang ? ui.animBoomerang.checked : false;
    state.rawFrames = frames;
    state.animBoom = boomOn;
    state.frames = boomerangize(frames, boomOn);
    startPreviewLoop(delayMs);
    if (noise > 0) {
      ui.animHint.textContent = 'Ruido animado ' + Math.round(noise * 100) + '% en ' + n + ' frames' + (boomOn ? ' -> ' + state.frames.length + ' en ping-pong.' : '.');
    } else if (boomOn) {
      ui.animHint.textContent = 'Boomerang: ' + n + ' frames -> ' + state.frames.length + ' en ping-pong.';
    }
  }

  function ensureVideoEl() {
    if (state.videoEl) return state.videoEl;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.style.display = 'none';
    document.body.appendChild(v);
    state.videoEl = v;
    return v;
  }

  function loadVideoFile(file) {
    resetToDefaults();
    state.isVideo = true;
    syncExpUI();
    updateExpHint();
    if (state.videoURL) { try { URL.revokeObjectURL(state.videoURL); } catch (e) { /* noop */ } }
    stopAnim();
    state.videoReady = false;
    state.videoLoading = true;
    state.videoFrames = [];
    const url = URL.createObjectURL(file);
    state.videoURL = url;
    const v = ensureVideoEl();
    state.baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
    toast('Cargando video...');
    v.onerror = () => {
      state.videoLoading = false;
      toast('No se pudo leer el video (prueba MP4/H.264 o WebM)', 'err');
    };
    v.onloadeddata = () => {
      state.videoReady = true;
      state.videoLoading = false;
      try {
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        ingest(c);
        state.baseName = (file.name || 'video').replace(/\.[^.]+$/, '');
      } catch (e) { /* noop */ }
      toast('Video listo: ' + v.videoWidth + 'x' + v.videoHeight);
      if (ui.animSource) { ui.animSource.value = 'video'; syncAnimSourceUI(); }
      if (ui.animCheck && !ui.animCheck.checked) {
        ui.animCheck.checked = true;
        ui.animOpts.classList.remove('hidden');
      }
      schedule();
    };
    v.src = url;
    v.load();
  }

  function seekVideo(v, t) {
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        v.removeEventListener('seeked', done);
        resolve();
      };
      v.addEventListener('seeked', done);
      try { v.currentTime = Math.min(Math.max(0, t), (v.duration || 1) - 0.05); }
      catch (e) { done(); }
      setTimeout(done, 1500);
    });
  }

  function startPreviewLoop(delayMs) {
    const frames = state.frames;
    stopAnim();
    state.animTick = 0;
    state.animLast = 0;
    state.delayMs = delayMs || 100;
    state.frames = frames;
    state.animActive = true;
    drawToPreview(frames[0]);
    requestAnimationFrame(animTick);
  }

  function animTick(now) {
    if (!state.animActive) return;
    if (!state.animLast) state.animLast = now;
    if (now - state.animLast >= state.delayMs) {
      state.animLast = now;
      state.animTick = (state.animTick + 1) % state.frames.length;
      drawToPreview(state.frames[state.animTick]);
    }
    requestAnimationFrame(animTick);
  }

  function stopAnim() {
    state.animActive = false;
    state.frames = [];
  }

  function sampleVideoFrames() {
    const v = state.videoEl;
    if (!v || !state.videoReady) return Promise.resolve(null);
    const n = Math.max(2, +ui.animRhythm.value);
    const wantDur = ui.vidDuration ? +ui.vidDuration.value : 1.5;
    const dur = Math.max(0.2, Math.min(v.duration || wantDur, wantDur));
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return Promise.resolve(null);
    const out = [];
    let chain = Promise.resolve();
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? (i / (n - 1)) * dur : 0;
      chain = chain.then(() => seekVideo(v, t)).then(() => {
        const c = document.createElement('canvas');
        c.width = vw; c.height = vh;
        c.getContext('2d').drawImage(v, 0, 0, vw, vh);
        out.push(c);
      });
    }
    return chain.then(() => out);
  }

  function buildVideoAnimFrames() {
    if (state.animBusy) return;
    if (!state.videoReady) {
      ui.animHint.textContent = 'Carga un video primero para usar la fuente Video.';
      const bp = upgradeParams();
      if (bp) buildProceduralFallback(bp);
      return;
    }
    state.animBusy = true;
    ui.animHint.textContent = 'Muestreando video...';
    sampleVideoFrames().then((sampled) => {
      if (!sampled || !sampled.length) throw new Error('sin frames');
      const fps = +ui.animRhythm.value;
      const delayMs = 1000 / fps;
      const echoAmt = ui.animEcho ? (+ui.animEcho.value || 0) / 100 : 0;
      const raw = [];
      let prev = null;
      for (let i = 0; i < sampled.length; i++) {
        const src = sampled[i];
        const w = src.width;
        const h = src.height;
        const wc = document.createElement('canvas');
        wc.width = w; wc.height = h;
        const wctx = wc.getContext('2d');
        wctx.imageSmoothingEnabled = true;
        wctx.drawImage(src, 0, 0, w, h);
        const rgba = wctx.getImageData(0, 0, w, h).data;
        const p = upgradeParams();
        if (!p) break;
        p.width = w; p.height = h; p.rgba = rgba;
        p.animNoise = ui.animNoise ? (+ui.animNoise.value || 0) / 100 : 0;
        p.animSeed = i;
        const core = renderCore(p, i);
        let fr = applyFrameEffects(core, p, i);
        if (echoAmt > 0) fr = window.StudioEngine.blendEcho(prev, fr, echoAmt);
        prev = fr;
        raw.push(fr);
      }
      const hold = ui.vidHold ? Math.max(0, +ui.vidHold.value | 0) : 0;
      for (let k = 0; k < hold && raw.length; k++) raw.push(raw[raw.length - 1]);
      const boomOn = ui.animBoomerang ? ui.animBoomerang.checked : true;
      state.rawFrames = raw;
      state.videoFrames = raw.slice();
      state.animBoom = boomOn;
      state.frames = boomerangize(raw, boomOn);
      state.workingW = raw[0].width; state.workingH = raw[0].height;
      startPreviewLoop(delayMs);
      ui.animHint.textContent = boomOn
        ? 'Video Boomerang: ' + raw.length + ' -> ' + state.frames.length + ' ping-pong.'
        : 'Video: ' + raw.length + ' frames ditherizados.';
      state.animBusy = false;
    }).catch((e) => {
      console.error(e);
      ui.animHint.textContent = 'No se pudo muestrear el video. Revisa el formato.';
      state.animBusy = false;
    });
  }

  function buildProceduralFallback(baseParams) {
    const n = Math.max(2, +ui.animRhythm.value);
    const fps = +ui.animRhythm.value;
    const noise = ui.animNoise ? (+ui.animNoise.value || 0) / 100 : 0;
    const echoAmt = ui.animEcho ? (+ui.animEcho.value || 0) / 100 : 0;
    const raw = [];
    let prev = null;
    for (let f = 0; f < n; f++) {
      const p = {
        width: baseParams.width, height: baseParams.height, rgba: baseParams.rgba,
        algorithm: baseParams.algorithm,
        algorithmOpts: Object.assign({}, baseParams.algorithmOpts),
        colorMode: baseParams.colorMode,
        colorOpts: Object.assign({}, baseParams.colorOpts),
        pre: baseParams.pre, outputRange: baseParams.outputRange,
        invert: baseParams.invert, transparent: baseParams.transparent,
        animNoise: noise, animSeed: f
      };
      const core = renderCore(p, f);
      let fr = applyFrameEffects(core, p, f);
      if (echoAmt > 0) fr = window.StudioEngine.blendEcho(prev, fr, echoAmt);
      prev = fr;
      raw.push(fr);
    }
    const boomOn = ui.animBoomerang ? ui.animBoomerang.checked : false;
    state.rawFrames = raw;
    state.animBoom = boomOn;
    state.frames = boomerangize(raw, boomOn);
    startPreviewLoop(1000 / fps);
  }

  /* ---------------- GIF animado (ImageDecoder) ---------------- */

  async function decodeGifFrames(file) {
    if (typeof window.ImageDecoder !== 'function') return null;
    let dec = null;
    try {
      const buf = await file.arrayBuffer();
      dec = new ImageDecoder({ data: buf, type: 'image/gif' });
      if (dec.tracks && dec.tracks.ready) await dec.tracks.ready;
      const track = dec.tracks && dec.tracks.selectedTrack;
      const count = track ? track.frameCount : 0;
      window.__gifDecCount = count;
      if (!count || count < 2) return null;
      const frames = [];
      const maxDim = 512;
      for (let i = 0; i < count && frames.length < 120; i++) {
        const res = await dec.decode({ frameIndex: i });
        const image = res.image;
        const vw = image.displayWidth || image.codedWidth || 1;
        const vh = image.displayHeight || image.codedHeight || 1;
        const scale = Math.min(1, maxDim / Math.max(vw, vh));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(vw * scale));
        c.height = Math.max(1, Math.round(vh * scale));
        c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
        if (image.close) image.close();
        frames.push(c);
      }
      return frames.length ? frames : null;
    } catch (e) {
      window.__gifDecErr = String((e && e.stack) || e);
      return null;
    } finally {
      try { if (dec) dec.close(); } catch (e) { /* noop */ }
    }
  }

  function loadGifFrames(file) {
    decodeGifFrames(file).then((frames) => {
      if (!frames || !frames.length) return;
      state.gifFrames = frames;
      if (ui.animSource) { ui.animSource.value = 'gif'; syncAnimSourceUI(); }
      if (ui.animCheck && !ui.animCheck.checked) {
        ui.animCheck.checked = true;
        ui.animOpts.classList.remove('hidden');
      }
      schedule();
      toast('GIF con ' + frames.length + ' frames cargado');
    }).catch(() => { /* noop */ });
  }

  function buildGifAnimFrames() {
    const list = state.gifFrames || [];
    if (!list.length) {
      const bp = upgradeParams();
      if (bp) buildProceduralFallback(bp);
      return;
    }
    const fps = +ui.animRhythm.value;
    const delayMs = 1000 / fps;
    const noise = ui.animNoise ? (+ui.animNoise.value || 0) / 100 : 0;
    const echoAmt = ui.animEcho ? (+ui.animEcho.value || 0) / 100 : 0;
    const raw = [];
    let prev = null;
    for (let i = 0; i < list.length; i++) {
      const src = list[i];
      const w = src.width, h = src.height;
      const rgba = src.getContext('2d').getImageData(0, 0, w, h).data;
      const p = upgradeParams();
      if (!p) break;
      p.width = w; p.height = h; p.rgba = rgba;
      p.animNoise = noise; p.animSeed = i;
      const core = renderCore(p, i);
      let fr = applyFrameEffects(core, p, i);
      if (echoAmt > 0) fr = window.StudioEngine.blendEcho(prev, fr, echoAmt);
      prev = fr;
      raw.push(fr);
    }
    const boomOn = ui.animBoomerang ? ui.animBoomerang.checked : true;
    state.rawFrames = raw;
    state.animBoom = boomOn;
    state.frames = boomerangize(raw, boomOn);
    if (raw.length) { state.workingW = raw[0].width; state.workingH = raw[0].height; }
    startPreviewLoop(delayMs);
    ui.animHint.textContent = 'GIF: ' + raw.length + ' frames' + (boomOn ? ' -> ' + state.frames.length + ' ping-pong.' : '.');
  }

  /* ---------------- export ---------------- */

  async function handleExport(fmt) {
    if (!state.imageData) return toast('Carga una imagen primero', 'err');
    const name = state.baseName;
    try {
      if (fmt === 'png') {
        const c = await exportCanvas();
        await Export.png(c, name);
        toast('PNG exportado');
      } else if (fmt === 'jpeg') {
        const c = await exportCanvas();
        await Export.jpeg(c, name, { bg: ui.bgColor.value });
        toast('JPEG exportado');
      } else if (fmt === 'svg') {
        const base = DitherEngine(upgradeParams());
        Export.svgOut(base.rgba, base.width, base.height, { scale: 1 }, name);
        toast('SVG exportado');
      } else if (fmt === 'gif') {
        let frames;
        let delay;
        if (ui.animCheck.checked && state.frames.length) {
          frames = state.frames.map(f => cloneCanvas(f));
          delay = 1000 / (+ui.animRhythm.value);
        } else if (ui.animBoomerang && ui.animBoomerang.checked && state.rawFrames && state.rawFrames.length) {
          frames = boomerangize(state.rawFrames.map(f => cloneCanvas(f)), true);
          delay = 1000 / (+ui.animRhythm.value);
        } else {
          const c = await exportCanvas();
          frames = [c];
          delay = 250;
        }
        Export.gif(frames, { delayMs: delay, transparent: ui.transpCheck.checked }, name);
        toast('GIF exportado');
      } else if (fmt === 'video') {
        const fps = +ui.animRhythm.value;
        let frames;
        if (ui.animCheck.checked && state.frames.length) {
          frames = state.frames;
        } else if (state.rawFrames && state.rawFrames.length) {
          frames = boomerangize(state.rawFrames, true);
        } else {
          const c = await exportCanvas();
          frames = [cloneCanvas(c)];
        }
        await Export.video(frames, { fps, loop: true }, name);
        toast('Video exportado');
      }
    } catch (e) {
      console.error(e);
      toast('Error al exportar: ' + e.message, 'err');
    }
  }

  async function exportCanvas() {
    const params = upgradeParams({ phaseX: 0, phaseY: 0 });
    const core = renderCore(params, null);
    const c = document.createElement('canvas');
    c.width = core.width;
    c.height = core.height;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(core, 0, 0);
    return applyFrameEffects(c, params, 0);
  }

  function cloneCanvas(c) {
    return window.StudioEngine.cloneCanvas(c);
  }

  /* ---------------- image loading ---------------- */

  function loadFromFile(file) {
    if (file && file.type && file.type.indexOf('video/') === 0) {
      loadVideoFile(file);
      return;
    }
    resetToDefaults();
    state.gifFrames = [];
    if (file && file.type === 'image/gif') {
      loadGifFrames(file);
    } else if (ui.animSource && ui.animSource.value === 'gif') {
      ui.animSource.value = 'procedural';
      syncAnimSourceUI();
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      ingest(img);
      state.baseName = (file.name || 'dither').replace(/\.[^.]+$/, '');
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast('No se pudo leer la imagen', 'err');
    };
    img.src = url;
  }

  function ingest(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0);
    state.srcCanvas = c;
    state.imageData = ctx.getImageData(0, 0, c.width, c.height);
    state.srcW = c.width;
    state.srcH = c.height;
    ui.dropHint.classList.add('hidden');
    schedule();
    toast('Imagen cargada ' + c.width + '×' + c.height);
  }

  function loadSample() {
    const c = document.createElement('canvas');
    const w = 640, h = 480;
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#22d3ee');
    g.addColorStop(0.35, '#7e22ce');
    g.addColorStop(0.7, '#f472b6');
    g.addColorStop(1, '#ffd166');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0b0f1a';
    for (let i = 0; i < 9; i++) {
      ctx.beginPath();
      const x = (i * 137) % w, y = (i * 89) % h, r = 12 + (i % 4) * 14;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = 'bold 42px ' + 'Segoe UI';
    ctx.fillText('DITHER', 30, 70);
    const img = new Image();
    img.src = c.toDataURL();
    img.onload = () => {
      ingest(img);
      state.baseName = 'muestra';
    };
  }

  /* ---------------- init ---------------- */

  function bindRange(id, labelId, fmt) {
    const el = $(id);
    if (!el) return;
    if (labelId) { rangeLabel[id] = labelId; rangeFmt[id] = fmt; }
    el.addEventListener('input', () => {
      if (labelId) {
        const l = $(labelId);
        if (l) l.textContent = fmt ? fmt(el.value) : el.value;
      }
      markCustom();
      schedule();
    });
  }

  function captureDefaults() {
    defaultControls = {};
    const els = document.querySelectorAll('aside.panel input, aside.panel select');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.id || el.type === 'file') continue;
      defaultControls[el.id] = (el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value;
    }
  }

  function refreshRangeLabels() {
    for (const id in rangeLabel) {
      const el = $(id);
      const l = $(rangeLabel[id]);
      if (el && l) l.textContent = rangeFmt[id] ? rangeFmt[id](el.value) : el.value;
    }
  }

  function resetSectionControls(sectionIds) {
    if (!defaultControls) captureDefaults();
    for (let s = 0; s < sectionIds.length; s++) {
      const sec = $(sectionIds[s]);
      if (!sec) continue;
      const els = sec.querySelectorAll('input, select');
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (!el.id || el.type === 'file' || !(el.id in defaultControls)) continue;
        if (el.type === 'checkbox' || el.type === 'radio') el.checked = defaultControls[el.id];
        else el.value = defaultControls[el.id];
      }
    }
  }

  function resetLookToDefaults() {
    state.palUse = 'wheel';
    state.stops = [{ pos: 0, color: '#0b0f1a' }, { pos: 100, color: '#f5f7ff' }];
    state.gradientRamp = null;
    state.gradPhase = 0;
    state.gradCycles = 1;
    state.gradLevels = 12;
    state.curve = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    state.curveLut = null;
    resetSectionControls(['secAlgo', 'secColor', 'secPre', 'secOut', 'secCrt']);
  }

  function resetToDefaults() {
    stopAnim();
    if (!defaultControls) captureDefaults();

    state.palUse = 'wheel';
    state.stops = [{ pos: 0, color: '#0b0f1a' }, { pos: 100, color: '#f5f7ff' }];
    state.gradientRamp = null;
    state.gradPhase = 0;
    state.gradCycles = 1;
    state.gradLevels = 12;
    state.curve = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    state.curveLut = null;
    state.palette = [];
    state.palSel = -1;
    state.frames = [];
    state.rawFrames = [];
    state.animBoom = [];
    state.animActive = false;
    state.animBusy = false;
    state.lastSource = 'procedural';
    state.isVideo = false;

    const els = document.querySelectorAll('aside.panel input, aside.panel select');
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (!el.id || el.type === 'file' || !(el.id in defaultControls)) continue;
      if (el.type === 'checkbox' || el.type === 'radio') el.checked = defaultControls[el.id];
      else el.value = defaultControls[el.id];
    }

    renderAlgoOpts();
    renderColorOpts();
    renderSwatches();
    syncPalEdit();
    syncMaskUI();
    drawToneCurve();
    if (ui.crtOpts) ui.crtOpts.classList.toggle('hidden', !ui.crtCheck.checked);
    if (ui.animOpts) ui.animOpts.classList.toggle('hidden', !ui.animCheck.checked);
    syncAnimSourceUI();
    syncExpUI();
    updateExpHint();
    refreshRangeLabels();
    if (ui.presetSelect) ui.presetSelect.value = 'custom';
    schedule();
  }

  /* Presets: receta = mismos controles + valores. Editables, customs en localStorage. */
  const PRESET_KEY = 'ditherfx.presets.v1';

  function factoryPresets() {
    return {
      'Modulación azul · rojo fósforo': {
        algo: 'modulation', colorMode: 'gradient', gradient: 'asukaNeon', mult: '3', contrast: 15, levels: 10,
        mod: { type: 'blue', scale: 4, str: 75, zd: 40, zm: 95, zl: 35, bands: 5, ripple: 20 },
        crt: { on: true, mask: 'shadow', scan: 30, phos: 45, frame: 25, curv: 12, eye: 6, eyeR: 100, bloom: 35, bloomThresh: 30, bloomChrom: 3, bloomTint: '#ff2266', bloomBlend: 'screen', trail: 0, raster: 15, flk: 2, dropout: 0, echo: 0, echoMode: 'rgb', vib: 25, sat: 135 }
      },
      'Modulación Knoll · neón magenta': {
        algo: 'modulation', colorMode: 'gradient', gradient: 'neonTrace', mult: '2', contrast: 25, levels: 14,
        mod: { type: 'knoll', scale: 3, str: 35, zd: 100, zm: 50, zl: 0, bands: 7, ripple: 15 },
        crt: { on: true, mask: 'none', scan: 25, phos: 0, frame: 20, curv: 10, eye: 0, eyeR: 100, bloom: 80, bloomThresh: 20, bloomChrom: 6, bloomTint: '#ff00d4', bloomBlend: 'lighter', trail: 0, raster: 10, flk: 0, dropout: 0, echo: 0, echoMode: 'ghost', vib: 40, sat: 140 }
      },
      'Modulación Bayer · violeta tríada': {
        algo: 'modulation', colorMode: 'tritone', mult: '4', contrast: 0,
        mod: { type: 'bayer', scale: 4, str: 65, zd: 18, zm: 100, zl: 45, bands: 4, ripple: 0 },
        crt: { on: true, mask: 'grille', scan: 75, phos: 55, frame: 45, curv: 35, eye: 10, eyeR: 100, bloom: 60, bloomThresh: 40, bloomChrom: 2, bloomTint: '#8a3bff', bloomBlend: 'lighter', trail: 0, raster: 10, conv: 0, roll: 0, flk: 8, dropout: 12, echo: 0, echoMode: 'ghost', vib: 15, sat: 110 }
      },
      'Modulación Knoll · B&N azul': {
        algo: 'modulation', colorMode: 'bw', mult: '2', contrast: 10,
        mod: { type: 'knoll', scale: 3, str: 40, zd: 100, zm: 60, zl: 0, bands: 6, ripple: 15 },
        crt: { on: true, mask: 'grille', scan: 60, phos: 40, frame: 35, curv: 20, eye: 12, eyeR: 90, bloom: 20, bloomThresh: 30, bloomChrom: 2, bloomTint: '#2a5aff', bloomBlend: 'lighter', trail: 0, raster: 10, conv: 0, roll: 0, flk: 5, dropout: 0, echo: 0, echoMode: 'ghost', vib: 0, sat: 90 },
        mask: { on: true, source: 'brillo', thresh: 65, smooth: 25, opacity: 100, color: '#2a5aff' },
        mode: 'selective'
      },
      'NightRush · B&N (Selectivo)': {
        algo: 'modulation', colorMode: 'bw', mult: '2', contrast: 18, sharpen: 12,
        mod: { type: 'knoll', scale: 3, str: 45, zd: 95, zm: 55, zl: 5, bands: 6, ripple: 18 },
        crt: { on: true, mask: 'grille', scan: 55, phos: 35, frame: 30, curv: 18, eye: 10, eyeR: 95, bloom: 30, bloomThresh: 28, bloomChrom: 2, bloomTint: '#7e22ce', bloomBlend: 'screen', trail: 0, raster: 12, conv: 0, roll: 0, flk: 4, dropout: 0, echo: 0, echoMode: 'ghost', vib: 0, sat: 85 },
        mask: { on: true, source: 'brillo', thresh: 62, smooth: 28, opacity: 100, color: '#22d3ee', bw: true },
        mode: 'selective'
      }
    };
  }

  function loadCustom() {
    try {
      const raw = localStorage.getItem(PRESET_KEY);
      if (!raw) return {};
      const o = JSON.parse(raw);
      return o && typeof o === 'object' ? o : {};
    } catch (e) { return {}; }
  }

  function saveCustom(o) {
    try { localStorage.setItem(PRESET_KEY, JSON.stringify(o)); } catch (e) { /* noop */ }
  }

  function allPresets() {
    const out = factoryPresets();
    const custom = loadCustom();
    for (const k in custom) out[k] = custom[k];
    return out;
  }

  function refreshPresets(keep) {
    const sel = $('presetSelect');
    if (!sel) return;
    const cur = keep || sel.value;
    sel.innerHTML = '';
    const o0 = document.createElement('option');
    o0.value = 'custom'; o0.textContent = 'Custom (manual)';
    sel.appendChild(o0);
    const all = allPresets();
    for (const name in all) {
      const op = document.createElement('option');
      op.value = name; op.textContent = name;
      sel.appendChild(op);
    }
    sel.value = all[cur] ? cur : 'custom';
  }

  function snapState() {
    const algo = ui.algoSelect.value;
    const snap = { algo, colorMode: ui.colorMode.value, mult: '1', contrast: +ui.preContrast.value, mode: state.mode };
    const mEl = $('algoMult');
    if (mEl) snap.mult = mEl.value;
    if (algo === 'modulation') {
      snap.mod = {
        type: $('modType') ? $('modType').value : 'blue',
        scale: $('noiseScale') ? +$('noiseScale').value : 4,
        str: $('modStrength') ? +$('modStrength').value : 80,
        zd: $('zoneDark') ? +$('zoneDark').value : 70,
        zm: $('zoneMid') ? +$('zoneMid').value : 100,
        zl: $('zoneLight') ? +$('zoneLight').value : 35,
        bands: $('modBands') ? +$('modBands').value : 5,
        ripple: $('modRipple') ? +$('modRipple').value : 25
      };
    }
    if (ui.colorMode.value === 'palRueda') {
      snap.palUse = state.palUse;
      snap.stops = state.stops.map(s => ({ pos: s.pos, color: s.color }));
      snap.phase = state.gradPhase || 0;
      snap.cycles = state.gradCycles || 1;
      snap.levels = state.gradLevels || 12;
    }
    snap.crt = {
      on: ui.crtCheck.checked,
      mask: $('crtMask') ? $('crtMask').value : 'grille',
      bloomBlend: $('crtBloomBlend') ? $('crtBloomBlend').value : 'screen',
      bloomTint: $('crtBloomTint') ? $('crtBloomTint').value : '#ff00cc',
      echoMode: $('crtEchoMode') ? $('crtEchoMode').value : 'rgb',
      scan: +$('crtScanlines').value, phos: +$('crtPhosphor').value,
      frame: +$('crtFrame').value, curv: +$('crtCurvature').value,
      eye: +$('crtEyefish').value, eyeR: +$('crtEyefishR').value,
      bloom: +$('crtBloom').value, bloomT: +$('crtBloomThresh').value,
      trail: +$('crtTrail').value, raster: +$('crtRaster').value,
      conv: +$('crtConv').value,
      roll: +$('crtRoll').value, flk: +$('crtFlicker').value,
      dropout: +$('crtDropout').value, echo: +$('crtEcho').value,
      vib: +$('crtVibrance').value, sat: +$('crtSatur').value,
      bloomChrom: ui.crtBloomChrom ? +ui.crtBloomChrom.value : 2,
      wave: ui.waveAmount ? +ui.waveAmount.value : 0,
      waveFreq: ui.waveFreq ? +ui.waveFreq.value : 15,
      waveSpeed: ui.waveSpeed ? +ui.waveSpeed.value : 20,
      waveSkew: ui.waveSkew ? +ui.waveSkew.value : 0,
      waveForm: ui.waveForm ? ui.waveForm.value : 'sin'
    };
    snap.sharpen = +$('sharpen').value;
    snap.animEcho = ui.animEcho ? +ui.animEcho.value : 0;
    snap.curve = state.curve.map(p => ({ x: p.x, y: p.y }));
    if (ui.maskCheck) {
      snap.mask = {
        on: ui.maskCheck.checked,
        source: ui.maskSource ? ui.maskSource.value : 'brillo',
        thresh: +ui.maskThresh.value, smooth: +ui.maskSmooth.value,
        opacity: ui.maskOpacity ? +ui.maskOpacity.value : 100,
        color: ui.maskColor ? ui.maskColor.value : '#2a5aff',
        bw: ui.maskBW ? ui.maskBW.checked : true
      };
    }
    return snap;
  }

  function applyPresetState(p) {
    resetLookToDefaults();
    setMode(p.mode || state.mode, { silent: true });
    ui.algoSelect.value = p.algo || 'modulation';
    const cm = p.colorMode || 'bw';
    if (cm === 'gradient') {
      ui.colorMode.value = 'palRueda';
      state.palUse = 'wheel';
    } else if (cm === 'palette') {
      ui.colorMode.value = 'palRueda';
      state.palUse = 'quant';
    } else {
      ui.colorMode.value = cm;
    }
    if (p.palUse) state.palUse = p.palUse;
    renderAlgoOpts();
    renderColorOpts();
    drawToneCurve();
    if (p.gradient && (cm === 'gradient' || state.palUse === 'wheel')) applyGradientPreset(p.gradient);
    if (p.stops && (cm === 'gradient' || cm === 'palette' || state.palUse === 'wheel')) {
      state.stops = p.stops.map(s => ({ pos: s.pos, color: s.color }));
      renderColorOpts();
    }
    if (p.phase != null) state.gradPhase = p.phase;
    if (p.cycles != null) state.gradCycles = p.cycles;
    if (p.levels != null) state.gradLevels = p.levels;
    if (state.palUse === 'wheel' && (p.phase != null || p.cycles != null || p.levels != null || p.stops)) {
      renderColorOpts();
    }
    if (p.mod) setModUI(p.mod.type, p.mod.scale, p.mod.str, p.mod.zd, p.mod.zm, p.mod.zl, p.mod.bands, p.mod.ripple);
    const mEl = $('algoMult');
    if (mEl && p.mult) { mEl.value = String(p.mult); mEl.dispatchEvent(new Event('change', { bubbles: true })); }
    if (p.contrast != null) {
      ui.preContrast.value = p.contrast;
      ui.preContrast.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (p.sharpen != null && $('sharpen')) {
      $('sharpen').value = p.sharpen;
      $('sharpen').dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (p.curve && p.curve.length >= 2) {
      state.curve = p.curve.map(pt => ({ x: clamp01(pt.x), y: clamp01(pt.y) }));
      state.curveLut = buildCurveLut();
      drawToneCurve();
    }
    if (p.crt) {
      ui.crtCheck.checked = p.crt.on !== false;
      ui.crtOpts.classList.toggle('hidden', !ui.crtCheck.checked);
      setCrtUI(p.crt);
    }
    if (p.animEcho != null && ui.animEcho) {
      ui.animEcho.value = p.animEcho;
      const la = $('valAnimEcho'); if (la) la.textContent = p.animEcho;
    }
    if (p.mask && ui.maskCheck) {
      ui.maskCheck.checked = p.mask.on !== false;
      if (ui.maskSource) ui.maskSource.value = p.mask.source || 'brillo';
      ui.maskThresh.value = p.mask.thresh != null ? p.mask.thresh : 50;
      ui.maskSmooth.value = p.mask.smooth != null ? p.mask.smooth : 25;
      if (ui.maskOpacity) ui.maskOpacity.value = p.mask.opacity != null ? p.mask.opacity : 100;
      if (ui.maskColor) ui.maskColor.value = p.mask.color || '#2a5aff';
      if (ui.maskBW) ui.maskBW.checked = p.mask.bw !== false;
      syncMaskUI();
      const lt = $('valMaskTh'); if (lt) lt.textContent = ui.maskThresh.value;
      const ls = $('valMaskSm'); if (ls) ls.textContent = ui.maskSmooth.value;
      const lo = $('valMaskOp'); if (lo) lo.textContent = (ui.maskOpacity ? ui.maskOpacity.value : 100) + '%';
    }
    schedule();
  }

  function applyPresetByName(name) {
    const all = allPresets();
    if (!all[name]) return;
    applyPresetState(all[name]);
    const sel = $('presetSelect');
    if (sel) sel.value = name;
    toast('Preset aplicado: ' + name);
  }

  function markCustom() {
    const sel = $('presetSelect');
    if (sel && sel.value !== 'custom') sel.value = 'custom';
  }

  /* ---------------- modos de trabajo (glitch / selectivo) ----------------
     Comparten un unico conjunto de parametros; el modo solo cambia defaults
     y el enfasis de la UI (clase en <body>) mas la pista de exportacion. */
  function modeDefaults(mode) {
    if (mode === 'selective') {
      if (ui.maskCheck) ui.maskCheck.checked = true;
      if (ui.maskBW) ui.maskBW.checked = true;
      if (ui.maskSource) ui.maskSource.value = 'brillo';
      if (ui.colorMode) { ui.colorMode.value = 'bw'; renderColorOpts(); }
      syncMaskUI();
    }
  }

  function setMode(mode, opts) {
    opts = opts || {};
    mode = mode === 'selective' ? 'selective' : 'glitch';
    state.mode = mode;
    document.body.classList.toggle('mode-selective', mode === 'selective');
    document.body.classList.toggle('mode-glitch', mode === 'glitch');
    if (ui.modeGlitch) ui.modeGlitch.classList.toggle('active', mode === 'glitch');
    if (ui.modeSelective) ui.modeSelective.classList.toggle('active', mode === 'selective');
    if (opts.defaults) modeDefaults(mode);
    updateExpHint();
    if (!opts.silent) { markCustom(); schedule(); }
  }

  function setCrtUI(o) {
    const labels = { crtScanlines: 'valCrtScan', crtPhosphor: 'valCrtPhos', crtFrame: 'valCrtFrame', crtCurvature: 'valCrtCurv', crtEyefish: 'valCrtEye', crtEyefishR: 'valCrtEyeR', crtBloom: 'valCrtBloom', crtBloomThresh: 'valCrtBloomThresh', crtBloomChrom: 'valCrtBloomChrom', crtTrail: 'valCrtTrail', crtRaster: 'valCrtRaster', crtFlicker: 'valCrtFlk', crtDropout: 'valCrtDrop', crtConv: 'valCrtConv', crtRoll: 'valCrtRoll', crtEcho: 'valCrtEcho', crtVibrance: 'valCrtVib', crtSatur: 'valCrtSat', waveAmount: 'valWave', waveFreq: 'valWaveFreq', waveSpeed: 'valWaveSpd', waveSkew: 'valWaveSkew' };
    const setRange = (id, val) => {
      const el = $(id);
      if (!el) return;
      el.value = val;
      const lab = labels[id] ? $(labels[id]) : null;
      if (lab) lab.textContent = id === 'crtSatur' ? (val + '%') : (id === 'waveFreq' ? (+val / 10).toFixed(1) : val);
    };
    const setSel = (id, val) => { const el = $(id); if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); } };
    if (o.mask) setSel('crtMask', o.mask);
    if (o.echoMode) setSel('crtEchoMode', o.echoMode);
    if (o.waveForm) setSel('waveForm', o.waveForm);
    const bloomTint = o.bloomTint || o.edgeTint || o.glowTint || o.glowHaloC;
    if (bloomTint && $('crtBloomTint')) $('crtBloomTint').value = bloomTint;
    const bloomBlend = o.bloomBlend || o.edgeBlend || o.glowBlend;
    if (bloomBlend) setSel('crtBloomBlend', bloomBlend);
    const bloomVals = {
      crtBloom: o.bloom != null ? o.bloom : (o.edgeBloom != null ? o.edgeBloom : o.glow),
      crtBloomThresh: o.bloomT != null ? o.bloomT : (o.edgeThresh != null ? o.edgeThresh : o.glowT),
      crtBloomChrom: o.bloomChrom != null ? o.bloomChrom : (o.edgeChrom != null ? o.edgeChrom : null)
    };
    for (const id in bloomVals) if (bloomVals[id] != null) setRange(id, String(bloomVals[id]));
    const map = { scan: 'crtScanlines', phos: 'crtPhosphor', frame: 'crtFrame', curv: 'crtCurvature', eye: 'crtEyefish', eyeR: 'crtEyefishR', trail: 'crtTrail', raster: 'crtRaster', conv: 'crtConv', roll: 'crtRoll', flk: 'crtFlicker', dropout: 'crtDropout', echo: 'crtEcho', vib: 'crtVibrance', sat: 'crtSatur', wave: 'waveAmount', waveFreq: 'waveFreq', waveSpeed: 'waveSpeed', waveSkew: 'waveSkew' };
    for (const k in map) if (o[k] != null) setRange(map[k], String(o[k]));
  }

  function setModUI0(type, scale, str, zd, zm, zl, bands, ripple) {
    const labels = { noiseScale: 'valNoise', modStrength: 'valModStr', zoneDark: 'valZoneD', zoneMid: 'valZoneM', zoneLight: 'valZoneL', modBands: 'valBands', modRipple: 'valRipple' };
    const setRange = (id, val) => {
      const el = $(id);
      if (!el) return;
      el.value = val;
      const lab = labels[id] ? $(labels[id]) : null;
      if (lab) lab.textContent = (id === 'noiseScale') ? (val + ' px') : val;
    };
    const el2 = $('modType');
    if (el2) el2.value = type;
    setRange('noiseScale', String(scale));
    setRange('modStrength', String(str));
    setRange('zoneDark', String(zd));
    setRange('zoneMid', String(zm));
    setRange('zoneLight', String(zl));
    setRange('modBands', String(bands));
    setRange('modRipple', String(ripple));
  }

  function setModUI(type, scale, str, zd, zm, zl, bands, ripple) {
    setModUI0(type, scale, str, zd, zm, zl, bands, ripple);
  }

  function setSel2(id, val) {
    const el = $(id);
    if (el) { el.value = val; el.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  function init() {
    Object.assign(ui, {
      preview: $('preview'),
      dimInfo: $('dimInfo'),
      algoInfo: $('algoInfo'),
      dropHint: $('dropHint'),
      toast: $('toast'),
      btnUpload: $('btnUpload'),
      btnSample: $('btnSample'),
      modeGlitch: $('modeGlitch'),
      modeSelective: $('modeSelective'),
      fileInput: $('fileInput'),
      algoSelect: $('algoSelect'),
      algoOpts: $('algoOpts'),
      colorMode: $('colorMode'),
      colorOpts: $('colorOpts'),
      preBrightness: $('preBrightness'),
      preContrast: $('preContrast'),
      preGamma: $('preGamma'),
      darkCut: $('darkCut'),
      lightCut: $('lightCut'),
      transpCheck: $('transpCheck'),
      transpWhich: $('transpWhich'),
      bgColor: $('bgColor'),
      palCount: $('palCount'),
      palSwatches: $('palSwatches'),
      palPreset: $('palPreset'),
      palFile: $('palFile'),
      palText: $('palText'),
      animCheck: $('animCheck'),
      animOpts: $('animOpts'),
      animSource: $('animSource'),
      videoOpts: $('videoOpts'),
      animBoomerang: $('animBoomerang'),
      vidDuration: $('vidDuration'),
      vidHold: $('vidHold'),
      animNoise: $('animNoise'),
      animRhythm: $('animRhythm'),
      waveAmount: $('waveAmount'),
      waveFreq: $('waveFreq'),
      waveSpeed: $('waveSpeed'),
      waveSkew: $('waveSkew'),
      waveForm: $('waveForm'),
      animEcho: $('animEcho'),
      animHint: $('animHint'),
      crtCheck: $('crtCheck'),
      crtOpts: $('crtOpts'),
      crtType: $('crtType'),
      crtMask: $('crtMask'),
      crtBloomBlend: $('crtBloomBlend'),
      crtBloomTint: $('crtBloomTint'),
      crtBloomChrom: $('crtBloomChrom'),
      crtScanlines: $('crtScanlines'),
      crtPhosphor: $('crtPhosphor'),
      crtHue: $('crtHue'),
      crtCurvature: $('crtCurvature'),
      crtEyefish: $('crtEyefish'),
      crtEyefishR: $('crtEyefishR'),
      crtFrame: $('crtFrame'),
      crtRoll: $('crtRoll'),
      crtConv: $('crtConv'),
      crtBloom: $('crtBloom'),
      crtBloomThresh: $('crtBloomThresh'),
      crtTrail: $('crtTrail'),
      crtRaster: $('crtRaster'),
      crtFlicker: $('crtFlicker'),
      crtDropout: $('crtDropout'),
      crtEchoMode: $('crtEchoMode'),
      crtVibrance: $('crtVibrance'),
      crtSatur: $('crtSatur'),
      crtEcho: $('crtEcho'),
      maskCheck: $('maskCheck'),
      maskOpts: $('maskOpts'),
      maskSource: $('maskSource'),
      maskThresh: $('maskThresh'),
      maskSmooth: $('maskSmooth'),
    maskOpacity: $('maskOpacity'),
    maskBW: $('maskBW'),
    maskColor: $('maskColor'),
      maskPreview: $('maskPreview'),
      palDetails: $('palPalette'),
      palHex: $('palHex'),
      palEdit: $('palEdit'),
      colorWheel: $('colorWheel'),
      wheelValue: $('wheelValue'),
      btnPalAdd: $('btnPalAdd'),
      btnPalDel: $('btnPalDel'),
      expHint: $('expHint'),
      btnFit: $('btnFit'),
      btn100: $('btn100'),
      btnVideo: $('btnVideo'),
      toneCurve: $('toneCurve'),
      btnCurveReset: $('btnCurveReset'),
      sharpen: $('sharpen')
    });

    ui.btnUpload.addEventListener('click', () => ui.fileInput.click());
    ui.btnSample.addEventListener('click', loadSample);
    if (ui.modeGlitch) ui.modeGlitch.addEventListener('click', () => setMode('glitch', { defaults: true }));
    if (ui.modeSelective) ui.modeSelective.addEventListener('click', () => setMode('selective', { defaults: true }));
    ui.fileInput.addEventListener('change', () => {
      if (ui.fileInput.files.length) loadFromFile(ui.fileInput.files[0]);
    });

    ui.algoSelect.addEventListener('change', () => { markCustom(); renderAlgoOpts(); schedule(); });
    ui.colorMode.addEventListener('change', () => { markCustom(); renderColorOpts(); schedule(); });

    ui.presetSelect = $('presetSelect');
    refreshPresets('custom');
    $('presetSelect').addEventListener('change', (e) => {
      if (e.target.value !== 'custom') applyPresetByName(e.target.value);
    });
    $('btnPresetSave').addEventListener('click', () => {
      const nameEl = $('presetName');
      const name = (nameEl.value || '').trim() || 'Mi preset';
      const custom = loadCustom();
      custom[name] = snapState();
      saveCustom(custom);
      refreshPresets(name);
      toast('Preset guardado: ' + name);
    });
    $('btnPresetDelete').addEventListener('click', () => {
      const sel = $('presetSelect');
      const name = sel.value;
      if (name === 'custom') { toast('Elige un preset guardado para borrar', 'err'); return; }
      if (factoryPresets()[name]) { toast('Los presets de fabrica no se pueden borrar', 'err'); return; }
      const custom = loadCustom();
      delete custom[name];
      saveCustom(custom);
      refreshPresets('custom');
      toast('Preset borrado: ' + name);
    });

    bindRange('preBrightness', 'valBright');
    bindRange('preContrast', 'valContrast');
    bindRange('preGamma', 'valGamma', (v) => (v / 100).toFixed(2));
    bindRange('darkCut', 'valDark');
    bindRange('lightCut', 'valLight');

    ui.transpCheck.addEventListener('change', () => {
      ui.transpWhich.disabled = !ui.transpCheck.checked;
      schedule();
    });
    ui.transpWhich.addEventListener('change', schedule);
    ui.bgColor.addEventListener('input', schedule);

    ui.palPreset.addEventListener('change', () => {
      const name = ui.palPreset.value;
      if (PALETTES[name]) {
        const hexes = PALETTES[name];
        // pico8 presets include duplicates; dedupe
        const seen = [];
        const hexes2 = [];
        for (const h of hexes) {
          if (!seen.includes(h)) { seen.push(h); hexes2.push(h); }
        }
        setPalette(hexes2.map(hexToRgb));
      }
    });
    $('btnPalLoad').addEventListener('click', () => ui.palPreset.dispatchEvent(new Event('change')));
    $('btnPalImport').addEventListener('click', () => ui.palFile.click());
    ui.palFile.addEventListener('change', () => {
      const f = ui.palFile.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        const colors = parsePaletteText(reader.result, f.name);
        if (colors && colors.length) setPalette(colors);
        else toast('No se detectaron colores en el archivo', 'err');
      };
      reader.readAsText(f);
    });
    $('btnPalText').addEventListener('click', () => {
      const colors = parsePaletteText(ui.palText.value);
      if (colors && colors.length) setPalette(colors);
      else toast('No se detectaron colores', 'err');
    });
    $('btnPalTri').addEventListener('click', applyPaletteToTritone);

    if (ui.colorWheel) {
      ui.colorWheel.addEventListener('mousedown', (e) => {
        wheelPick(e);
        const move = (ev) => wheelPick(ev);
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
        };
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      });
      ui.wheelValue.addEventListener('input', () => {
        const v = Math.max(10, +ui.wheelValue.value || 10);
        const sw = state.palSel;
        if (sw < 0 || !state.palette[sw]) { syncPalEdit(); return; }
        const cur = state.palette[sw];
        const rgb = hsvToRgb(rgbToHsv(cur[0] * 255, cur[1] * 255, cur[2] * 255)[0] * 360, rgbToHsv(cur[0] * 255, cur[1] * 255, cur[2] * 255)[1] * 100, v);
        state.palette[sw] = rgb;
        renderSwatches();
        renderColorOpts();
        syncPalEdit();
        schedule();
      });
      ui.palHex.addEventListener('change', () => {
        const sw = state.palSel;
        if (sw < 0 || !state.palette[sw]) return;
        const hex = ui.palHex.value;
        state.palette[sw] = hexToRgb(hex);
        renderSwatches();
        renderColorOpts();
        syncPalEdit();
        schedule();
      });
      ui.btnPalAdd.addEventListener('click', () => {
        const hex = ui.palHex.value;
        state.palette.push(hexToRgb(hex));
        state.palSel = state.palette.length - 1;
        renderSwatches();
        renderColorOpts();
        syncPalEdit();
        schedule();
      });
      ui.btnPalDel.addEventListener('click', () => {
        const sw = state.palSel;
        if (sw < 0 || state.palette.length < 2) return;
        state.palette.splice(sw, 1);
        state.palSel = Math.min(state.palSel, state.palette.length - 1);
        renderSwatches();
        renderColorOpts();
        syncPalEdit();
        schedule();
      });
    }
    ui.palSwatches.addEventListener('click', (e) => {
      const sw = e.target.closest('.swatch');
      if (!sw) return;
      const i = sw.dataset.index;
      if (i != null) selectSwatch(+i);
    });

    ui.animCheck.addEventListener('change', () => {
      ui.animOpts.classList.toggle('hidden', !ui.animCheck.checked);
      ui.animHint.classList.remove('hidden');
      schedule();
    });
    bindRange('animRhythm', 'valRhythm');
    bindRange('vidDuration', 'valVidDur', (v) => (+v).toFixed(1));
    bindRange('vidHold', 'valVidHold');
    bindRange('animNoise', 'valAnimNoise');
    bindRange('waveAmount', 'valWave');
    bindRange('waveFreq', 'valWaveFreq', (v) => (+v / 10).toFixed(1));
    bindRange('waveSpeed', 'valWaveSpd');
    bindRange('waveSkew', 'valWaveSkew');
    bindRange('animEcho', 'valAnimEcho');
    if (ui.waveForm) ui.waveForm.addEventListener('change', () => { markCustom(); schedule(); });
    ui.animSource.addEventListener('change', () => { syncAnimSourceUI(); schedule(); });
    ui.animBoomerang.addEventListener('change', schedule);
    ui.vidDuration.addEventListener('change', schedule);
    ui.vidHold.addEventListener('change', schedule);

    ui.crtCheck.addEventListener('change', () => {
      ui.crtOpts.classList.toggle('hidden', !ui.crtCheck.checked);
      schedule();
    });
    bindRange('crtScanlines', 'valCrtScan');
    bindRange('crtPhosphor', 'valCrtPhos');
    bindRange('crtHue', 'valCrtHue', (v) => v + '°');
    bindRange('crtCurvature', 'valCrtCurv');
    bindRange('crtEyefish', 'valCrtEye');
    bindRange('crtEyefishR', 'valCrtEyeR');
    bindRange('crtFrame', 'valCrtFrame');
    bindRange('crtRoll', 'valCrtRoll');
    bindRange('crtConv', 'valCrtConv');
    bindRange('crtBloom', 'valCrtBloom');
    bindRange('crtBloomThresh', 'valCrtBloomThresh');
    bindRange('crtBloomChrom', 'valCrtBloomChrom');
    bindRange('crtTrail', 'valCrtTrail');
    bindRange('crtRaster', 'valCrtRaster');
    bindRange('crtFlicker', 'valCrtFlk');
    bindRange('crtDropout', 'valCrtDrop');
    bindRange('crtVibrance', 'valCrtVib');
    bindRange('crtSatur', 'valCrtSat', (v) => v + '%');
    bindRange('crtEcho', 'valCrtEcho');
    bindRange('sharpen', 'valSharpen');
    bindToneCurve();
    if (ui.crtType) ui.crtType.addEventListener('change', () => { markCustom(); schedule(); });
    if (ui.crtMask) ui.crtMask.addEventListener('change', () => { markCustom(); schedule(); });
    if (ui.crtBloomBlend) ui.crtBloomBlend.addEventListener('change', () => { markCustom(); schedule(); });
    if (ui.crtBloomTint) ui.crtBloomTint.addEventListener('input', () => { markCustom(); schedule(); });
    if (ui.crtEchoMode) ui.crtEchoMode.addEventListener('change', () => { markCustom(); schedule(); });

    if (ui.maskCheck) {
      ui.maskCheck.addEventListener('change', () => { syncMaskUI(); markCustom(); schedule(); });
    if (ui.maskSource) ui.maskSource.addEventListener('change', () => { markCustom(); schedule(); });
    if (ui.maskBW) ui.maskBW.addEventListener('change', () => { markCustom(); schedule(); });
    bindRange('maskThresh', 'valMaskTh');
      bindRange('maskSmooth', 'valMaskSm');
      bindRange('maskOpacity', 'valMaskOp', (v) => v + '%');
      if (ui.maskColor) ui.maskColor.addEventListener('input', () => { markCustom(); schedule(); });
    }

    $('btnPng').addEventListener('click', () => handleExport('png'));
    $('btnJpeg').addEventListener('click', () => handleExport('jpeg'));
    $('btnSvg').addEventListener('click', () => handleExport('svg'));
    $('btnGif').addEventListener('click', () => handleExport('gif'));
    if (ui.btnVideo) ui.btnVideo.addEventListener('click', () => handleExport('video'));

    ui.btnFit.addEventListener('click', () => { setView('fit'); });
    ui.btn100.addEventListener('click', () => { setView('100'); });

    renderAlgoOpts();
    renderColorOpts();
    renderSwatches();
    syncPalEdit();
    syncMaskUI();
    drawToneCurve();
    updateExpHint();
    syncExpUI();
    syncAnimSourceUI();
    ui.crtOpts.classList.toggle('hidden', !ui.crtCheck.checked);
    ui.animOpts.classList.toggle('hidden', !ui.animCheck.checked);
    setMode(state.mode, { silent: true });
    captureDefaults();

    bindDrop();

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        ui.fileInput.click();
      }
    });
    document.addEventListener('paste', (e) => {
      const item = e.clipboardData && e.clipboardData.items && e.clipboardData.items[0];
      if (item && item.type && item.type.indexOf('image') === 0) {
        const f = item.getAsFile();
        if (f) loadFromFile(f);
      }
    });

    loadSample();
  }

  function syncAnimSourceUI() {
    if (!ui.animSource) return;
    const isVid = ui.animSource.value === 'video';
    if (ui.videoOpts) ui.videoOpts.classList.toggle('hidden', !isVid);
  }

  function syncExpUI() {
    const vid = !!state.isVideo;
    const still = document.querySelectorAll('.exp-still');
    for (let i = 0; i < still.length; i++) still[i].hidden = vid;
    if (ui.btnVideo) ui.btnVideo.hidden = !vid;
  }

  function updateExpHint() {
    const s = state.workingW || 0;
    const cell = (typeof $ === 'function' && $('algoMult')) ? $('algoMult').value : '1';
    const modeTag = state.mode === 'selective'
      ? 'Modo Selectivo (reel B&N): máscara al metraje en blanco y negro. '
      : 'Modo Glitch Art: animación/flicker sobre la imagen. ';
    if (state.isVideo) {
      ui.expHint.textContent = modeTag + 'Salida ' + s + '×' + (state.workingH || 0) + ' px (celda ' + cell + 'x). GIF/WebM animados a resolución nativa.';
    } else {
      ui.expHint.textContent = modeTag + 'Salida ' + s + '×' + (state.workingH || 0) + ' px (celda ' + cell + 'x). PNG/JPEG/SVG/GIF a resolución nativa.';
    }
  }

  function setView(mode) {
    state.fitMode = mode === 'fit';
    const wrap = $('previewWrap');
    const pv = ui.preview;
    if (state.fitMode) {
      pv.style.maxWidth = '100%';
      pv.style.maxHeight = '100%';
      pv.style.width = 'auto';
      pv.style.height = 'auto';
      wrap.style.overflow = 'hidden';
      ui.btnFit.classList.add('active');
      ui.btn100.classList.remove('active');
    } else {
      pv.style.maxWidth = 'none';
      pv.style.maxHeight = 'none';
      pv.style.width = pv.width + 'px';
      pv.style.height = pv.height + 'px';
      wrap.style.overflow = 'auto';
      ui.btn100.classList.add('active');
      ui.btnFit.classList.remove('active');
    }
  }

  function bindDrop() {
    const overlay = $('dropOverlay');
    let depth = 0;
    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });
    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (!hasFiles(e)) return;
      depth++;
      overlay.classList.remove('hidden');
    });
    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      depth--;
      if (depth <= 0) { depth = 0; overlay.classList.add('hidden'); }
    });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      depth = 0;
      overlay.classList.add('hidden');
      const f = e.dataTransfer.files[0];
      if (f && f.type.indexOf('image/') === 0) loadFromFile(f);
      else if (f) toast('Formato no soportado', 'err');
    });
  }

  function hasFiles(e) {
    return e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') !== -1;
  }

  state.gradientRamp = buildGradientRamp();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();