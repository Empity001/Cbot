// src/utils/fonts.js
// =========================================================
// Registro centralizado de fuentes para @napi-rs/canvas.
//
// ESTRATEGIA DE EMOJI (3 capas, de más a menos robusta):
//
//   Capa 1 — @fontsource/noto-emoji instalado como dependencia:
//     Si el paquete existe y sus archivos woff2 tienen el nombre
//     estándar que fontsource usa en v5, los cargamos todos.
//
//   Capa 2 — fuentes del sistema Linux (Railway / Ubuntu):
//     Railway corre sobre Ubuntu. Si la capa 1 falla, buscamos
//     NotoColorEmoji.ttf en las rutas estándar de Ubuntu.
//
//   Capa 3 — sustitución en texto (texto legible sin emoji):
//     Si las dos anteriores fallan, fillTextWithEmoji() sigue
//     funcionando pero los emojis se muestran como □. El código
//     de renderizado usa `emojiAscii()` como texto alternativo
//     para las secciones críticas (❤ → HP, ⚔ → DMG, etc.)
//     para que el canvas siempre sea legible.
// =========================================================

import { GlobalFonts } from '@napi-rs/canvas';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { existsSync, readdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = join(__dirname, '../assets/fonts');

export const FONT = {
  sans:  'CulonesUI',
  mono:  'CulonesMono',
  emoji: 'Noto Color Emoji',
};

// true  = la fuente de emoji quedó registrada (los emojis se ven)
// false = no se encontró ninguna fuente de emoji (los emojis son □)
export let emojiAvailable = false;

let _registered = false;

// ─── Capa 1: @fontsource/noto-emoji ──────────────────────────────────────────
function tryLoadFontsource() {
  try {
    // fontsource v5 estructura: files/noto-emoji-{subset}-400-normal.woff2
    // Los subsets pueden ser rangos unicode (u1f600-u1f64f) o números (0..9).
    // Buscamos dinámicamente todos los woff2 del paquete para no depender
    // de nombres hardcodeados que cambian entre versiones.
    const pkgPath = new URL(
      '../../../node_modules/@fontsource/noto-emoji/files',
      import.meta.url
    ).pathname;

    if (!existsSync(pkgPath)) return false;

    const files = readdirSync(pkgPath).filter((f) => f.endsWith('.woff2'));
    if (files.length === 0) return false;

    let loaded = 0;
    for (const file of files) {
      try {
        GlobalFonts.registerFromPath(join(pkgPath, file));
        loaded++;
      } catch {
        // Ignorar archivos corruptos/no soportados y seguir
      }
    }
    return loaded > 0;
  } catch {
    return false;
  }
}

// ─── Capa 2: fuentes del sistema Linux (Railway / Ubuntu) ────────────────────
const SYSTEM_EMOJI_PATHS = [
  // Ubuntu / Debian
  '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/noto/NotoColorEmoji.ttf',
  '/usr/share/fonts/truetype/noto-color-emoji/NotoColorEmoji.ttf',
  // Fallback: cualquier Noto en el sistema
  '/usr/share/fonts/opentype/noto/NotoColorEmoji.ttf',
  // macOS (dev local)
  '/System/Library/Fonts/Apple Color Emoji.ttc',
];

function tryLoadSystemEmoji() {
  for (const path of SYSTEM_EMOJI_PATHS) {
    if (existsSync(path)) {
      try {
        GlobalFonts.registerFromPath(path);
        return true;
      } catch {
        // Intentar el siguiente
      }
    }
  }
  return false;
}

export function ensureFonts() {
  if (_registered) return;

  // Fuentes de interfaz (siempre bundleadas — estas nunca fallan)
  try {
    GlobalFonts.registerFromPath(join(FONTS_DIR, 'LiberationSans-Regular.ttf'), FONT.sans);
    GlobalFonts.registerFromPath(join(FONTS_DIR, 'LiberationSans-Bold.ttf'),    FONT.sans);
    GlobalFonts.registerFromPath(join(FONTS_DIR, 'LiberationMono-Regular.ttf'), FONT.mono);
    console.log('[Fonts] ✓ Fuentes de interfaz registradas.');
  } catch (err) {
    console.warn('[Fonts] ⚠ Error cargando fuentes de interfaz:', err.message);
  }

  // Fuente de emoji — intentar las 3 capas en orden
  if (tryLoadFontsource()) {
    emojiAvailable = true;
    console.log('[Fonts] ✓ Emoji cargado desde @fontsource/noto-emoji.');
  } else if (tryLoadSystemEmoji()) {
    emojiAvailable = true;
    console.log('[Fonts] ✓ Emoji cargado desde fuentes del sistema.');
  } else {
    emojiAvailable = false;
    console.warn(
      '[Fonts] ⚠ No se encontró fuente de emoji. Los emojis se mostrarán como texto alternativo.\n' +
      '[Fonts]   Para arreglar: descarga NotoColorEmoji.ttf y ponla en src/assets/fonts/.'
    );
  }

  _registered = true;
}
