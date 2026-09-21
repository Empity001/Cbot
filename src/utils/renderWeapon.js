// src/utils/renderWeapon.js
// Genera una imagen PNG por cada RANGO de un arma
// (stats, habilidades, receta de mejora).

import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { ensureFonts, FONT } from './fonts.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño ─────────────────────────────────────────────────────────
let BG_COLOR = '#090612';
let BORDER_COLOR = 'rgba(169,133,255,0.18)';
let GOLD = '#d6b56f';
let CYAN = '#a985ff';
let MAGENTA = '#ec72d3';
let GREEN = '#38e07a';
let INK_100 = '#f6f1ff';
let INK_400 = '#aaa2c1';
let INK_600 = 'rgba(220,208,244,0.52)';

function applyRenderTheme() {
  const theme = getRenderPalette();
  BG_COLOR = theme.bg;
  BORDER_COLOR = themeRgba(theme.primary, 0.18);
  GOLD = theme.accent;
  CYAN = theme.primary;
  MAGENTA = theme.event;
  GREEN = theme.confirmation;
  INK_100 = theme.text;
  INK_400 = theme.muted;
  INK_600 = themeRgba(theme.muted, 0.52);
}

const CANVAS_W       = 640;
const PADDING        = 20;
const HEADER_IMG_SIZE = 72;

const imageCache = new Map();
const IMAGE_FAIL_CACHE = new Set();

async function fetchImage(url) {
  if (!url) return null;
  if (IMAGE_FAIL_CACHE.has(url)) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': 'https://discord.com/',
        'sec-fetch-dest': 'image',
        'sec-fetch-mode': 'no-cors',
        'sec-fetch-site': 'cross-site',
      },
    });
    const img = await loadImage(Buffer.from(response.data));
    imageCache.set(url, img);
    return img;
  } catch {
    IMAGE_FAIL_CACHE.add(url);
    return null;
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max - 1) + '…' : str;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// Ícono de llama dibujado a mano (curvas de canvas), no con el emoji 🔥.
// Así se ve igual siempre, tenga o no el entorno una fuente de emoji
// instalada (ver la estrategia de 3 capas documentada en fonts.js).
function drawFlameIcon(ctx, cx, cy, size) {
  const drawTeardrop = (scale, color) => {
    const w = size * 0.5 * scale;
    const h = size * scale;
    ctx.beginPath();
    ctx.moveTo(cx, cy + h / 2);
    ctx.quadraticCurveTo(cx - w / 2, cy + h / 6, cx - w / 4, cy - h / 3);
    ctx.quadraticCurveTo(cx, cy - h / 2 - h * 0.08, cx + w / 4, cy - h / 3);
    ctx.quadraticCurveTo(cx + w / 2, cy + h / 6, cx, cy + h / 2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  };
  drawTeardrop(1, '#ff6a2d');
  drawTeardrop(0.55, '#ffd23d');
}

function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function estimateHeight(rank) {
  const measureCanvas = createCanvas(10, 10);
  const ctx = measureCanvas.getContext('2d');
  // Registrar fuentes para medir correctamente
  ensureFonts();

  let h = PADDING;
  h += HEADER_IMG_SIZE + 16;

  ctx.font = `13px ${FONT.sans}`;
  const contentW = CANVAS_W - PADDING * 2;

  if (rank.description) {
    const lines = wrapText(ctx, rank.description, contentW - 4);
    h += 22 + lines.length * 18 + 10;
  }

  const stats = Array.isArray(rank.stats) ? rank.stats : [];
  if (stats.length > 0) h += 26 + stats.length * 30 + 4;

  const abilities = Array.isArray(rank.abilities) ? rank.abilities : [];
  if (abilities.length > 0) {
    h += 26;
    for (const ab of abilities) {
      h += 8 + 22;
      if (ab.description) h += wrapText(ctx, ab.description, contentW - 40).length * 16 + 4;
      h += 22;
      const abStats = Array.isArray(ab.stats) ? ab.stats : [];
      if (abStats.length > 0) h += Math.ceil(abStats.length / 2) * 18 + 4;
      h += 8 + 6;
    }
    h += 6;
  }

  if (rank.upgrade_recipe) {
    // Soporte para el nuevo formato multi-método: {methods:[...]} o método directo
    const recipeMethods = getRecipeMethods(rank.upgrade_recipe);
    // Cada método puede tener materiales/grid de distinto tamaño
    let recipeH = 26; // header
    for (const method of recipeMethods) {
      if (method.title || getRecipeLabel(method)) recipeH += 16;
      const layout = getRecipeBoxLayout(method);
      recipeH += Math.max(layout.height, CELL) + 14 /* nombre resultado */ + 20 /* margen */;
    }
    h += recipeH;
  }

  h += PADDING + 30;
  return Math.max(Math.round(h), 280);
}

// ── Helpers de receta ────────────────────────────────────────────────────────
// La web evolucionó de una receta plana {materials, result} a un sistema
// con múltiples métodos y modos: trade/crafting/furnace/smithing.
// getRecipeMethods normaliza ambos formatos para que el renderer siempre
// reciba un array de métodos, independientemente de cuán vieja sea la data.

function getRecipeMethods(recipe) {
  if (!recipe) return [];
  // Nuevo formato: { methods: [...] }
  if (Array.isArray(recipe.methods) && recipe.methods.length > 0) return recipe.methods;
  // Formato legacy / directo: el objeto raíz ES el único método
  return [recipe];
}

function getRecipeSlots(method) {
  const mode = method.mode || 'trade';
  if (mode === 'crafting') return Array.isArray(method.grid) ? method.grid : [];
  if (mode === 'furnace' || mode === 'smithing') return Array.isArray(method.inputs) ? method.inputs : [];
  // trade: materials
  return Array.isArray(method.materials) ? method.materials : [];
}

function getRecipeLabel(method) {
  const mode = method.mode || 'trade';
  if (mode === 'crafting') return 'Mesa de crafteo';
  if (mode === 'furnace') {
    const labels = { blast_furnace: 'Alto horno', smoker: 'Ahumador' };
    return labels[method.furnace_type] || 'Horno';
  }
  if (mode === 'smithing') return 'Mesa de herrería';
  return null; // trade: sin label de modo
}

// Igual que la web (weapons.css): cada modo tiene su propia disposición de
// slots dentro de una "caja" tipo mesa de crafteo, no una fila continua.
//   - crafting: grid 3x3 (9 slots)
//   - furnace:  columna vertical (slot, llama, slot) — 2 slots
//   - smithing: fila de 3 slots
//   - trade:    fila libre, sin caja (comportamiento anterior)
const CELL = 48;
const CELL_GAP = 4;
const BOX_PAD = 10;
const FLAME_SIZE = 22;

function getRecipeBoxLayout(method) {
  const mode = method.mode || 'trade';
  if (mode === 'crafting') {
    const cols = 3, rows = 3;
    return {
      mode, cols, rows,
      width:  cols * CELL + (cols - 1) * CELL_GAP + BOX_PAD * 2,
      height: rows * CELL + (rows - 1) * CELL_GAP + BOX_PAD * 2,
    };
  }
  if (mode === 'smithing') {
    const cols = 3, rows = 1;
    return {
      mode, cols, rows,
      width:  cols * CELL + (cols - 1) * CELL_GAP + BOX_PAD * 2,
      height: rows * CELL + BOX_PAD * 2,
    };
  }
  if (mode === 'furnace') {
    return {
      mode,
      width:  CELL + BOX_PAD * 2,
      height: CELL + CELL_GAP + FLAME_SIZE + CELL_GAP + CELL + BOX_PAD * 2,
    };
  }
  // trade: sin caja, fila libre de slots
  return { mode, width: null, height: CELL };
}

export async function renderWeaponRankImage({ weapon, category, type, rank }) {
  applyRenderTheme();
  ensureFonts();

  const safeImageUrl = rank.image_url || weapon.image_url;
  const headerImg    = await fetchImage(safeImageUrl);

  const recipe       = rank.upgrade_recipe;
  const recipeMethods = getRecipeMethods(recipe);

  // Pre-cargar todas las imágenes de todos los métodos de receta
  const methodImageData = await Promise.all(recipeMethods.map(async (method) => {
    const slots = getRecipeSlots(method);
    const slotImages = await Promise.all(slots.map(s => fetchImage(s?.image_url)));
    const resultImg = await fetchImage(method.result?.image_url);
    return { method, slots, slotImages, resultImg };
  }));

  const totalH = estimateHeight(rank);
  const canvas  = createCanvas(CANVAS_W, totalH);
  const ctx     = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_W, totalH);

  let y          = PADDING;
  const contentW = CANVAS_W - PADDING * 2;

  // ── Header: imagen + nombre + badges ────────────────────────────────────
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  roundRect(ctx, PADDING, y, HEADER_IMG_SIZE, HEADER_IMG_SIZE, 8);
  ctx.fill();

  if (headerImg) {
    ctx.imageSmoothingEnabled = false;
    ctx.save();
    roundRect(ctx, PADDING, y, HEADER_IMG_SIZE, HEADER_IMG_SIZE, 8);
    ctx.clip();
    ctx.drawImage(headerImg, PADDING, y, HEADER_IMG_SIZE, HEADER_IMG_SIZE);
    ctx.restore();
  } else {
    ctx.fillStyle    = INK_400;
    ctx.font         = `bold 28px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((weapon.name || '?')[0].toUpperCase(), PADDING + HEADER_IMG_SIZE / 2, y + HEADER_IMG_SIZE / 2);
  }

  const headTextX  = PADDING + HEADER_IMG_SIZE + 16;

  ctx.fillStyle    = INK_100;
  ctx.font         = `bold 22px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(truncate(weapon.name, 26), headTextX, y);

  ctx.fillStyle = GOLD;
  ctx.font      = `bold 14px ${FONT.sans}`;
  ctx.fillText(rank.name, headTextX, y + 30);

  // Badges
  let badgeX     = headTextX;
  const badgeY   = y + 52;
  ctx.font       = `11px ${FONT.sans}`;

  if (category) {
    const label = ` ${category.label} `;
    const w     = ctx.measureText(label).width + 10;
    ctx.strokeStyle = category.color || CYAN;
    ctx.lineWidth   = 1;
    roundRect(ctx, badgeX, badgeY, w, 20, 10);
    ctx.stroke();
    ctx.fillStyle    = category.color || CYAN;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + 5, badgeY + 10);
    badgeX += w + 8;
  }

  if (type) {
    const label = ` ${type.label} `;
    const w     = ctx.measureText(label).width + 10;
    ctx.fillStyle = 'rgba(169,133,255,0.18)';
    roundRect(ctx, badgeX, badgeY, w, 20, 10);
    ctx.fill();
    ctx.fillStyle    = INK_100;
    ctx.textBaseline = 'middle';
    ctx.fillText(label, badgeX + 5, badgeY + 10);
  }

  if (!weapon.published) {
    ctx.fillStyle    = MAGENTA;
    ctx.font         = `bold 10px ${FONT.sans}`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText('OCULTA', CANVAS_W - PADDING, y);
    ctx.textAlign = 'left';
  }

  y += HEADER_IMG_SIZE + 16;

  // Separador
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(CANVAS_W - PADDING, y);
  ctx.stroke();
  y += 14;

  // ── Descripción ───────────────────────────────────────────────────────────
  if (rank.description) {
    ctx.fillStyle    = CYAN;
    ctx.font         = `bold 13px ${FONT.sans}`;
    ctx.textBaseline = 'top';
    ctx.fillText('DESCRIPCION', PADDING, y);
    y += 22;

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font      = `13px ${FONT.sans}`;
    const lines   = wrapText(ctx, rank.description, contentW - 4);
    for (const line of lines) {
      ctx.fillText(line, PADDING, y);
      y += 18;
    }
    y += 10;
  }

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = Array.isArray(rank.stats) ? rank.stats : [];
  if (stats.length > 0) {
    ctx.fillStyle = GOLD;
    ctx.font      = `bold 13px ${FONT.sans}`;
    ctx.fillText('ESTADISTICAS', PADDING, y);
    y += 26;

    for (const s of stats) {
      const label = truncate(String(s.key ?? s.label ?? ''), 18);
      const value = String(s.value ?? '');

      ctx.fillStyle = INK_400;
      ctx.font      = `12px ${FONT.sans}`;
      ctx.fillText(label, PADDING, y + 2);

      const barX = PADDING + 130;
      const barW = contentW - 130 - 60;

      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, barX, y, barW, 14, 4);
      ctx.fill();

      ctx.fillStyle = GOLD;
      roundRect(ctx, barX, y, barW, 14, 4);
      ctx.fill();

      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 12px ${FONT.sans}`;
      ctx.textAlign    = 'right';
      ctx.fillText(truncate(value, 10), CANVAS_W - PADDING, y + 2);
      ctx.textAlign = 'left';

      y += 30;
    }
    y += 4;
  }

  // ── Habilidades ───────────────────────────────────────────────────────────
  const abilities = Array.isArray(rank.abilities) ? rank.abilities : [];
  if (abilities.length > 0) {
    ctx.fillStyle = MAGENTA;
    ctx.font      = `bold 13px ${FONT.sans}`;
    ctx.fillText('HABILIDADES', PADDING, y);
    y += 26;

    for (const ab of abilities) {
      const cardTop  = y;
      const descLines = ab.description
        ? wrapText(ctx, ab.description, contentW - 24)
        : [];

      let cardH = 8 + 22;
      if (descLines.length > 0) cardH += descLines.length * 16 + 4;
      cardH += 22;
      const abStats = Array.isArray(ab.stats) ? ab.stats : [];
      if (abStats.length > 0) cardH += Math.ceil(abStats.length / 2) * 18 + 4;
      cardH += 8;

      ctx.fillStyle = 'rgba(143,105,230,0.075)';
      roundRect(ctx, PADDING, cardTop, contentW, cardH, 8);
      ctx.fill();

      let innerY       = cardTop + 8;
      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 13px ${FONT.sans}`;
      ctx.textBaseline = 'top';
      ctx.textAlign    = 'left';
      ctx.fillText(truncate(ab.name || 'Habilidad', 30), PADDING + 12, innerY);

      if (ab.tag) {
        ctx.fillStyle = MAGENTA;
        ctx.font      = `10px ${FONT.sans}`;
        ctx.textAlign = 'right';
        ctx.fillText(ab.tag, PADDING + contentW - 12, innerY + 2);
        ctx.textAlign = 'left';
      }
      innerY += 22;

      if (descLines.length > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        ctx.font      = `11px ${FONT.sans}`;
        for (const line of descLines) {
          ctx.fillText(line, PADDING + 12, innerY);
          innerY += 16;
        }
        innerY += 4;
      }

      // Barra de nivel
      const level    = ab.level ?? 0;
      const levelMax = ab.level_max ?? 10;
      const pct      = levelMax > 0 ? Math.min(1, Math.max(0, level / levelMax)) : 0;

      ctx.fillStyle = INK_400;
      ctx.font      = `10px ${FONT.sans}`;
      ctx.fillText(`Nivel ${level}${levelMax ? ' / ' + levelMax : ''}`, PADDING + 12, innerY + 2);

      const lvlBarX = PADDING + 110;
      const lvlBarW = contentW - 110 - 24;

      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, lvlBarX, innerY, lvlBarW, 10, 4);
      ctx.fill();

      ctx.fillStyle = GREEN;
      roundRect(ctx, lvlBarX, innerY, Math.max(4, lvlBarW * pct), 10, 4);
      ctx.fill();
      innerY += 22;

      if (abStats.length > 0) {
        ctx.font      = `10.5px ${FONT.sans}`;
        const colW    = contentW / 2;
        abStats.forEach((s, idx) => {
          const col     = idx % 2;
          const row     = Math.floor(idx / 2);
          const sx      = PADDING + 12 + col * colW;
          const sy      = innerY + row * 18;
          const keyText = `${truncate(String(s.key ?? s.label ?? ''), 14)}: `;
          ctx.fillStyle = INK_400;
          ctx.fillText(keyText, sx, sy);
          const labelW  = ctx.measureText(keyText).width;
          ctx.fillStyle = INK_100;
          ctx.fillText(truncate(String(s.value ?? ''), 14), sx + labelW, sy);
        });
      }

      y = cardTop + cardH + 6;
    }
    y += 6;
  }

  // ── Mejora/fabricación ────────────────────────────────────────────────────
  if (recipe && recipeMethods.length > 0) {
    ctx.fillStyle    = CYAN;
    ctx.font         = `bold 13px ${FONT.sans}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('MEJORA/FABRICACIÓN', PADDING, y);
    y += 26;

    const RESULT_SIZE = 52;

    // Dibuja un slot individual (fondo + imagen + cantidad), reutilizado
    // tanto dentro de la caja tipo mesa de crafteo como en el resultado.
    // emptyBg es configurable porque el mismo slot se usa sobre fondos muy
    // distintos: el embed oscuro (trade) vs. la caja gris clara del grid
    // (crafting/furnace/smithing), donde un blanco al 5% casi no se nota.
    const drawSlotCell = (x, sy, size, slot, img, { isResult = false, showQty = true, emptyBg = 'rgba(255,255,255,0.05)' } = {}) => {
      ctx.fillStyle = isResult ? 'rgba(243,183,58,0.12)' : emptyBg;
      roundRect(ctx, x, sy, size, size, 6);
      ctx.fill();
      if (isResult) {
        ctx.strokeStyle = GOLD;
        ctx.lineWidth   = 1;
        roundRect(ctx, x, sy, size, size, 6);
        ctx.stroke();
      } else if (!img) {
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth   = 1;
        roundRect(ctx, x, sy, size, size, 6);
        ctx.stroke();
      }
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        roundRect(ctx, x, sy, size, size, 6);
        ctx.clip();
        ctx.drawImage(img, x, sy, size, size);
        ctx.restore();
      }
      const qty = slot?.qty ?? slot?.count ?? 1;
      if (showQty && qty > 1) {
        ctx.fillStyle    = INK_100;
        ctx.font         = `bold 9px ${FONT.sans}`;
        ctx.textAlign    = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`x${qty}`, x + size - 3, sy + size - 3);
      }
    };

    for (const { method, slots, slotImages, resultImg } of methodImageData) {
      const modeLabel = getRecipeLabel(method);
      if (method.title || modeLabel) {
        ctx.fillStyle    = INK_400;
        ctx.font         = `10px ${FONT.sans}`;
        ctx.textBaseline = 'top';
        ctx.textAlign    = 'left';
        ctx.fillText(method.title || modeLabel || '', PADDING, y);
        y += 16;
      }

      const slotY  = y;
      const layout = getRecipeBoxLayout(method);
      const blockH = Math.max(layout.height, RESULT_SIZE);
      let mx;

      if (layout.mode === 'crafting' || layout.mode === 'smithing') {
        // Caja gris tipo mesa de crafteo/herrería con grid interno
        ctx.fillStyle   = '#8b889a';
        roundRect(ctx, PADDING, slotY, layout.width, layout.height, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth   = 1;
        roundRect(ctx, PADDING, slotY, layout.width, layout.height, 6);
        ctx.stroke();

        for (let i = 0; i < layout.cols * layout.rows; i++) {
          const col = i % layout.cols;
          const row = Math.floor(i / layout.cols);
          const cx  = PADDING + BOX_PAD + col * (CELL + CELL_GAP);
          const cy  = slotY + BOX_PAD + row * (CELL + CELL_GAP);
          drawSlotCell(cx, cy, CELL, slots[i], slotImages[i], { emptyBg: 'rgba(0,0,0,0.18)' });
        }
        mx = PADDING + layout.width + 16;
      } else if (layout.mode === 'furnace') {
        // Caja gris vertical: slot arriba, llama, slot abajo
        ctx.fillStyle   = '#8b889a';
        roundRect(ctx, PADDING, slotY, layout.width, layout.height, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth   = 1;
        roundRect(ctx, PADDING, slotY, layout.width, layout.height, 6);
        ctx.stroke();

        const cx = PADDING + BOX_PAD;
        const topY = slotY + BOX_PAD;
        drawSlotCell(cx, topY, CELL, slots[0], slotImages[0], { emptyBg: 'rgba(0,0,0,0.18)' });

        const flameY = topY + CELL + CELL_GAP;
        drawFlameIcon(ctx, cx + CELL / 2, flameY + FLAME_SIZE / 2, FLAME_SIZE);

        const bottomY = flameY + FLAME_SIZE + CELL_GAP;
        drawSlotCell(cx, bottomY, CELL, slots[1], slotImages[1], { emptyBg: 'rgba(0,0,0,0.18)' });

        mx = PADDING + layout.width + 16;
      } else {
        // trade: fila libre de slots, sin caja, con nombre debajo de cada uno
        mx = PADDING;
        for (let i = 0; i < slots.length; i++) {
          const slot = slots[i] || {};
          drawSlotCell(mx, slotY, RESULT_SIZE, slot, slotImages[i]);

          ctx.textAlign    = 'center';
          ctx.font         = `9px ${FONT.sans}`;
          ctx.fillStyle    = INK_400;
          ctx.textBaseline = 'top';
          ctx.fillText(truncate(slot.name || '', 10), mx + RESULT_SIZE / 2, slotY + RESULT_SIZE + 3);

          mx += RESULT_SIZE + 8;
        }
      }

      // Flecha
      ctx.fillStyle    = INK_400;
      ctx.font         = `bold 18px ${FONT.sans}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('→', mx + 10, slotY + blockH / 2);
      mx += 26;

      // Resultado (centrado verticalmente respecto a la caja/fila)
      const result   = method.result || {};
      const resultY  = slotY + (blockH - RESULT_SIZE) / 2;
      drawSlotCell(mx, resultY, RESULT_SIZE, result, resultImg, { isResult: true, showQty: false });

      ctx.fillStyle    = GOLD;
      ctx.textAlign    = 'center';
      ctx.font         = `9px ${FONT.sans}`;
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(result.name || '', 10), mx + RESULT_SIZE / 2, resultY + RESULT_SIZE + 3);
      ctx.textAlign = 'left';

      y = Math.max(slotY + blockH, resultY + RESULT_SIZE + 14) + 20;
    }
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, totalH - 30);
  ctx.lineTo(CANVAS_W - PADDING, totalH - 30);
  ctx.stroke();

  ctx.fillStyle    = INK_600;
  ctx.font         = `10px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `Culones RPG · Guías · ${new Date().toLocaleDateString('es-ES')}`,
    PADDING,
    totalH - 15
  );

  ctx.fillStyle = CYAN;
  ctx.textAlign = 'right';
  ctx.fillText('culones-rpg', CANVAS_W - PADDING, totalH - 15);

  return canvas.toBuffer('image/png');
}
