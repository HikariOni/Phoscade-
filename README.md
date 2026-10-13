# DITHER//FOUNDRY · DitherFX

> Guía práctica del programa **hasta ahora**. Documento vivo: se irá editando a medida que la app crece y evoluciona hacia un plug-in.

Estudio de dithering con emulador CRT, máscara selectiva, animación y exportación multi-formato. App de escritorio Electron (renderer web, sin servidor).

---

## 1 · Arrancar y probar

```bash
npm install      # primera vez (solo devDependency: electron)
npm start        # abre la ventana Electron
```

- `SMOKE=1 npm start` → modo verificación: abre, imprime `SMOKE_OK` y cierra solo.
- `node drive-test.js` → harness end-to-end en Electron que escanea el pipeline completo (algoritmos, animación, GIF, export) y reporta `DRIVE_RESULT`.

### Entrada de imagen/video

| Vía | Detalle |
|---|---|
| Botón `CARGAR IMAGEN / VIDEO` | diálogo nativo |
| Arrastrar y soltar | sobre la ventana o el stage |
| Pegar | `Ctrl+V` imágenes desde el portapapeles |
| Atajo | `Ctrl+O` abre el diálogo de archivo |
| `≋ MUESTRA` | carga la imagen de muestra interna |

Formatos aceptados: `PNG, JPEG, WEBP, GIF, BMP, AVIF, SVG` · video `MP4, WEBM, OGG, QuickTime`.

Si cargas **video**, la app pasa automáticamente a fuente de animación `Video` y a exportación WebM. Además aplica el **look de fábrica para reel**: degradado continuo en **blanco y negro** (`#000000 → #ffffff`), sin tocar el modo de trabajo ni la máscara.

El preview del video se muestrea acotado al borde largo (**1280 px**) para agilidad; al exportar GIF/WebM/Secuencia el reel se **re-muestrea a resolución nativa** automáticamente.

El arranque de la app es más liviano: splash de inicio, `ready-to-show` y scripts diferidos (`defer`), así la ventana aparece al instante sin ventana en blanco.

---

## 2 · Modos de trabajo

| Modo | Uso |
|---|---|
| **`[01] GLITCH ART`** | Imagen + animación/flicker. Exporta PNG/JPEG/SVG/GIF. |
| **`[02] SELECTIVO`** | Reel B&N: el dithering se aplica solo donde lo permite la máscara. Fuente **video o GIF animado** (la máscara nunca se aplica a imagen fija). |

---

## 3 · `01 // ALGORITMO`

### Presets
Selector de presets + guardar/borrar. Incluye 5 presets de fábrica:

- Modulación azul · rojo fósforo
- Modulación Knoll · neón magenta
- Modulación Bayer · violeta tríada
- Modulación Knoll · B&N azul (selectivo)
- NightRush · B&N (Selectivo)

Los presets propios se guardan en `localStorage` (clave `ditherfx.presets.v1`); los de fábrica no se pueden borrar.

### Técnicas de dithering (13)

**Difusión de error (serpentino opcional):**
- Floyd–Steinberg, False Floyd–Steinberg, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra, Sierra (2 filas), Sierra Lite, Atkinson

**Ordenado / estructural:**
- Bayer (matriz 2×2, 4×4, 8×8, 16×16), Patrón de mapa de bits, ASCII

**Modulación (ruidosa, por defecto):**
- 8 tipos de grano: Ruido blanco (estático), Azul equilibrado (Ulichney), Ordenado (Bayer), Entrelazado IGN (retro consola), Disperso Knoll (grano foto), Valor suave, Perlin, Celular (Worley)
- Barras/zonas de luminancia, ondulación, escala, fuerza y semilla por frame
- Multiplicador de celda `×1 ×2 ×4 ×6 ×8` (resolución de la celda)

**Patrón de mapa de bits:** punto (halftone), anillo, líneas horizontal/vertical/diagonal, cuadrícula, espiral, personalizado (texto).

**ASCII:** conjuntos Clásico, Bloques, Bloques parciales, Minimal, Dígitos, Binario.

### Máscara selectiva
Activable independientemente del modo. **Composición de doble capa**: la imagen original queda viva a resolución completa y el dithering se aplica como capa de luminancia donde la máscara lo permite (funciona con cualquier técnica, incluida difusión de error).

Solo actúa sobre **material en movimiento** (video importado o GIF animado); con imagen fija la máscara queda inactiva y la salida es el dither sin doble capa. Con `mult > 1` el matte se muestrea por celda de grano y se expande a bloques idénticos al estampado (overlay alineado a la rejilla, borde sin invasión de media celda); con `mult = 1` la clave es por píxel.

- Fuente: Brillo (luces), Medios (tonos medios), Bordes (rim-light), Sombra
- Umbral, suavizado, opacidad de máscara
- Capa afectada en blanco y negro (toggle)
- **Borde duro (centro de celda)**: con `mult > 1` cada celda se decide por su píxel central en vez del promedio, así el borde del overlay cae exacto sobre la frontera de celdas (sin celda de mezcla a media intensidad). Activo por defecto.
- **Ver matte en el monitor**: overlay de monitoreo que muestra la clave (blanco/negro) sobre el preview mientras ajustás umbral/suavizado. Es solo visual, la salida/export no lo incluye.
- Color de efecto (también tiñe el Bloom del CRT)
- La clave se calcula con luma CRT (Rec.601) sobre la imagen procesada

### Rango de corte
Corte oscuro / corte claro: recorta los extremos de la escala de luminancia.

---

## 4 · `02 // COLOR + PALETA`

### Modos de color
| Modo | Descripción |
|---|---|
| Blanco y negro | 2 colores |
| Duotono | gradiente de 2 colores |
| Tritono | 3 colores (por defecto) |
| Preservar colores | mapeo a la paleta de la fuente |
| Paleta · Rueda | degradado continuo o paleta cuantizada (Colorama) |

Degradados predefinidos (16): NightRush, Cian-rojo neón, Magenta neón, Verde-cian digital, Violeta profundo, Fuego, Océano, Neón, Sepia, Viridis, Frío, Térmico, Solarize, Infrarrojo, Fuego y Ceniza, Fósforo verde, Acid Rainbow.

Niveles de degradado: cantidad de bandas del gradiente.

### Presets de paleta
PICO-8 (32), Sweetie 16 (16), Apollo (12), Cold Gray (8), Commodore (16), Journey (16), 1-Bit Monocromo (2).

**Importar:** formatos `.gpl, .pal, .txt, .hex, .colors, .json`, o pegar colores en texto (`#000000`, `rgb(0,0,0)`, `0 0 0`, nombres…).

**Editor:** rueda de color (valor V), campo hex, añadir/borrar swatch. `Colores → Tritono` vuelca la paleta como tritono.

---

## 5 · `03 // PRE-PROCESO`

- **Brillo**, **Contraste**, **Gamma**
- **Curva de tono** interactiva: clic añade punto, arrastrar mueve, doble clic elimina. Se aplica tras Brillo/Gamma/Contraste.
- **Enfoque (Sharpen)**: unsharp 3×3 sobre el fotograma procesado (0–100%).

---

## 6 · `04 // SALIDA`

- **Fondo transparente** (PNG/GIF/SVG): dejar claro o oscuro transparente
- **Color de relleno para JPEG** (fondo donde hay transparencia)

---

## 7 · `05 // CRT-EMULATOR`

Simulación de tubo aplicada al resultado final (viva en preview y exportada, también en GIFs).

**Tubo y señal**
- Máscara de fósforo: Rejilla (Trinitron), Sombra (triadas), Ninguna
- Scanlines, Máscara RGB (fósforo), Marco/bezel
- Hue-Color (matiz), Curvatura, Eyefish 90s + radio

**Bloom (fósforo)**
- Bloom, umbral de borde, dispersión cromática (px), Tint (color), mezcla Screen / Add (Linear Dodge)
- Persistencia de fósforo (trail), Raster bloom
- Flicker de tubo (también en Animación)

**Defectos de cinta**
- VHS dropouts

**Óptica y color**
- Vibrance, Saturation, V-Hold roll, Convergencia
- EchoFX: Señal (ghost) o Sangrado RGB (ecos R/G/B)

---

## 8 · `06 // ANIMACIÓN`

Fuente:
- **Procedural** — ruido propio del dither (por frame)
- **Video** — Boomerang real (muestrea duración 0.5–4 s, hold final 0–6 frames)
- **GIF** — usa los frames reales del archivo (ImageDecoder)

Controles:
- **Ruido animado** (0–100)
- **Onda de frecuencia (H-sync)** — amplitud (px), frecuencia, velocidad, sesgo diagonal; formas sinusoidal, triangular, sierra, cuadrada
- **Eco temporal entre frames** (feedback de señal 0–100%)
- **Modo Boomerang / Ping-pong**
- **Ritmo** (frames por ciclo, 2–24)
- **Flicker de tubo**

Todo indexado por frame: preview = resultado del GIF/WebM.

---

## 9 · `07 // EXPORT`

| Formato | Notas |
|---|---|
| **PNG** | resolución nativa, alpha |
| **JPEG** | rellena el fondo con el color de Salida, Q=0.92 |
| **SVG** | vector, run-length por fila, `shape-rendering=crispEdges`, respeta transparencia |
| **GIF** | codificador propio GIF89a (median cut + LUT 5-bit + LZW + Netscape loop + paleta opcional transparente). Con 4+ frames usa los frames animados |
| **WebM** | MediaRecorder (VP9→VP8→WebM), solo disponible si hay video cargado |

El nombre de archivo sale de `baseName` del estado actual.

**Vista:** botones `AJUSTAR` (fit) / `100%`.

---

## 10 · Arquitectura (de cara al plug-in)

El render está **desacoplado de la UI** para reutilizarse como motor de un plug-in futuro.

| Módulo | Rol |
|---|---|
| `src/engine.js` | **StudioEngine** — núcleo de render. Entrada única `renderFrame(params, maskOpts, fx, time) → canvas`. También `renderCore`, `applyFrameEffects`, `boomerangize`, `blendEcho`, `sharpenCanvas`, `renderMaskOverlay`. No lee la UI. |
| `src/dither.js` | **DitherEngine** — algoritmos, paletas/rampas, ruidos, máscara por luma. `DitherEngine(params) → { canvas, rgba }`. |
| `src/crt.js` | **CRT** — pasada de tubo single-canvas. Expone `apply` + helpers `wavePass`, `bloomPass`. |
| `src/gif.js` | **GIF** — encoder GIF89a puro (sin dependencias): `.encode(frames, opts)`, `.encodeCanvas(canvas, opts)`. |
| `src/export.js` | **Export** — PNG, JPEG, SVG, GIF, WebM (`download`, `png`, `jpeg`, `svgOut`, `gif`, `video`). |
| `src/app.js` | UI Electron: recolecta controles → arma `params` → llama a StudioEngine. |
| `main.js` / `preload.js` | Carga de la ventana, contextIsolation, puente mínimo (`platform`, `versions`). |

Flujo por frame:

```
entrada → pre-proceso (brillo/constraste/gamma/curva) → paleta/color → dither
  → [máscara selectiva: doble capa] → sharpen → CRT (bloom, scanlines, óptica…)
  → [eco temporal] → [boomerang] → preview / export
```

---

## 11 · Pendientes / notas

- Nombre/producto final aún por decidir (candidatos en conversación: *Phoscade*, *Afterphos*, *50Hz Afterimage*, …). Hoy en `package.json`: `dither-studio`.
- `drive-test.js` es herramienta de QA, no parte del producto.
- Este README se actualizará con cada refactor hacia plug-in (p. ej. exponer `renderFrame` como API pública documentada).

---

### Licencia
MIT · **Kozneo Foundry**