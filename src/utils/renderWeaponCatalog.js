// src/utils/renderWeaponCatalog.js
// Genera una imagen PNG tipo catálogo con todas las armas publicadas
// (o filtradas por categoría/tipo): nombre + imagen, sin specs.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { ensureFonts, FONT } from './fonts.js';
import { fillTextWithEmoji } from './emojiText.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño ─────────────────────────────────────────────────────────
let BG_COLOR = '#090612';
let BORDER_COLOR = 'rgba(169,133,255,0.18)';
let CYAN = '#a985ff';
let GOLD = '#d6b56f';
let INK_100 = '#f6f1ff';
let INK_400 = '#aaa2c1';
let INK_600 = 'rgba(220,208,244,0.52)';

function applyRenderTheme() {
  const theme = getRenderPalette();
  BG_COLOR = theme.bg;
  BORDER_COLOR = themeRgba(theme.primary, 0.18);
  CYAN = theme.primary;
  GOLD = theme.accent;
  INK_100 = theme.text;
  INK_400 = theme.muted;
  INK_600 = themeRgba(theme.muted, 0.52);
}

const CANVAS_W    = 720;
const PADDING     = 20;
const CARD_W      = 110;
const CARD_H      = 130; // imagen + nombre + badges
const IMG_SIZE    = 72;
const COLS        = 5;
const COL_GAP     = (CANVAS_W - PADDING * 2 - COLS * CARD_W) / (COLS - 1);

const imageCache = new Map();
const IMAGE_FAIL_CACHE = new Set();

async function fetchImage(url) {
  if (!url) return null;
  if (IMAGE_FAIL_CACHE.has(url)) return null;
  if (imageCache.has(url)) return imageCache.get(url);
  try {
    const res = await axios.get(url, {
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
    const img = await loadImage(Buffer.from(res.data));
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

/**
 * Genera la imagen catálogo.
 * @param {Array}  weapons    - lista de armas (con .category y .type opcionales)
 * @param {string} filterLabel - texto para el header ("Todas" | "Categoría: X" | "Tipo: Y")
 * @param {string} serverName
 * @returns {Buffer}
 */
export async function renderWeaponCatalogImage(weapons, filterLabel = 'Todas', serverName = 'Culones RPG') {
  applyRenderTheme();
  ensureFonts();

  // Pre-descargar imágenes en paralelo
  await Promise.all(weapons.filter(w => w.image_url).map(w => fetchImage(w.image_url)));

  const HEADER_H = 56;
  const FOOTER_H = 30;

  // Agrupar por categoría para mostrar headers de sección
  // Si filtramos por tipo no hay agrupación extra, mostramos todo junto
  const grouped = groupByCategory(weapons);
  const totalRows = grouped.reduce((acc, g) => {
    acc += 1; // label de categoría
    acc += Math.ceil(g.weapons.length / COLS);
    return acc;
  }, 0);

  const SECTION_LABEL_H = 28;
  const GRID_ROW_H      = CARD_H + 10;

  // Calcular altura
  let bodyH = 0;
  for (const g of grouped) {
    bodyH += SECTION_LABEL_H + 8;
    bodyH += Math.ceil(g.weapons.length / COLS) * GRID_ROW_H;
    bodyH += 12;
  }

  if (weapons.length === 0) bodyH = 80;

  const totalH = HEADER_H + PADDING + bodyH + PADDING + FOOTER_H;

  const canvas = createCanvas(CANVAS_W, Math.max(totalH, 200));
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_W, canvas.height);

  // ── Header ────────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, CANVAS_W, HEADER_H);
  ctx.strokeStyle = `${CYAN}66`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(CANVAS_W, HEADER_H);
  ctx.stroke();

  ctx.fillStyle    = CYAN;
  ctx.font         = `bold 18px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  fillTextWithEmoji(ctx, `⚔️ CATÁLOGO DE ARMAS · ${filterLabel.toUpperCase()}`, PADDING, HEADER_H / 2);

  ctx.fillStyle = INK_400;
  ctx.font      = `11px ${FONT.sans}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${weapons.length} arma${weapons.length !== 1 ? 's' : ''}`, CANVAS_W - PADDING, HEADER_H / 2);

  // ── Cuerpo ────────────────────────────────────────────────────────────────
  let y = HEADER_H + PADDING;

  if (weapons.length === 0) {
    ctx.fillStyle    = INK_600;
    ctx.font         = `13px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No hay armas publicadas en esta categoría.', CANVAS_W / 2, y + 30);
    y += 60;
  }

  for (const group of grouped) {
    // Label de sección (categoría)
    if (group.label) {
      const labelColor = group.color || GOLD;
      ctx.fillStyle = `${labelColor}22`;
      roundRect(ctx, PADDING, y, CANVAS_W - PADDING * 2, SECTION_LABEL_H, 6);
      ctx.fill();

      ctx.fillStyle    = labelColor;
      ctx.font         = `bold 12px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(group.label.toUpperCase(), PADDING + 10, y + SECTION_LABEL_H / 2);

      ctx.fillStyle = INK_600;
      ctx.font      = `11px ${FONT.sans}`;
      ctx.textAlign = 'right';
      ctx.fillText(`${group.weapons.length}`, CANVAS_W - PADDING - 10, y + SECTION_LABEL_H / 2);

      y += SECTION_LABEL_H + 8;
    }

    // Grid de cartas
    for (let i = 0; i < group.weapons.length; i++) {
      const w   = group.weapons[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx  = PADDING + col * (CARD_W + COL_GAP);
      const cy  = y + row * GRID_ROW_H;

      // Fondo carta
      ctx.fillStyle = 'rgba(143,105,230,0.075)';
      roundRect(ctx, cx, cy, CARD_W, CARD_H, 8);
      ctx.fill();

      // Borde color categoría
      if (group.color) {
        ctx.strokeStyle = `${group.color}44`;
        ctx.lineWidth   = 1;
        roundRect(ctx, cx, cy, CARD_W, CARD_H, 8);
        ctx.stroke();
      }

      // Imagen
      const imgX = cx + (CARD_W - IMG_SIZE) / 2;
      const imgY = cy + 8;

      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, imgX, imgY, IMG_SIZE, IMG_SIZE, 6);
      ctx.fill();

      const img = w.image_url ? imageCache.get(w.image_url) : null;
      if (img) {
        ctx.imageSmoothingEnabled = false;
        ctx.save();
        roundRect(ctx, imgX, imgY, IMG_SIZE, IMG_SIZE, 6);
        ctx.clip();
        ctx.drawImage(img, imgX, imgY, IMG_SIZE, IMG_SIZE);
        ctx.restore();
      } else {
        ctx.fillStyle    = group.color || CYAN;
        ctx.font         = `bold 24px ${FONT.sans}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((w.name || '?')[0].toUpperCase(), imgX + IMG_SIZE / 2, imgY + IMG_SIZE / 2);
      }

      // Nombre
      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 10px ${FONT.sans}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      // Dividir nombre en 2 líneas si hace falta
      const nameLines = splitName(ctx, w.name || '', CARD_W - 8);
      for (let nl = 0; nl < Math.min(nameLines.length, 2); nl++) {
        ctx.fillText(nameLines[nl], cx + CARD_W / 2, imgY + IMG_SIZE + 6 + nl * 13);
      }

      // Badge tipo (si está disponible)
      if (w.typeLabel) {
        ctx.fillStyle    = INK_400;
        ctx.font         = `9px ${FONT.sans}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(truncate(w.typeLabel, 14), cx + CARD_W / 2, imgY + IMG_SIZE + 34);
      }
    }

    y += Math.ceil(group.weapons.length / COLS) * GRID_ROW_H + 12;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = canvas.height - FOOTER_H;
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, footerY);
  ctx.lineTo(CANVAS_W, footerY);
  ctx.stroke();

  ctx.fillStyle    = INK_600;
  ctx.font         = `10px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${serverName} · Guías · ${new Date().toLocaleDateString('es-ES')}`, PADDING, footerY + 15);

  ctx.fillStyle = CYAN;
  ctx.textAlign = 'right';
  ctx.fillText('culones-rpg', CANVAS_W - PADDING, footerY + 15);

  return canvas.toBuffer('image/png');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupByCategory(weapons) {
  const map = new Map();
  const nocat = [];

  for (const w of weapons) {
    if (w.category_id && w.categoryLabel) {
      if (!map.has(w.category_id)) {
        map.set(w.category_id, { label: w.categoryLabel, color: w.categoryColor, weapons: [] });
      }
      map.get(w.category_id).weapons.push(w);
    } else {
      nocat.push(w);
    }
  }

  const result = [...map.values()];
  if (nocat.length > 0) {
    result.push({ label: 'Sin categoría', color: null, weapons: nocat });
  }
  return result;
}

function splitName(ctx, name, maxWidth) {
  if (!name) return [''];
  const words = name.split(/\s+/);
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
