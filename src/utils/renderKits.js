// src/utils/renderKits.js
// Genera una imagen PNG con los kits recomendados (pestaña "Kits" de la
// web). Cada kit se dibuja como una tarjeta con 3 columnas fijas
// (Arma / Accesorio / Sub-arma — mismo orden que KIT_COLUMNS en la web),
// cada una con su propia lista vertical de items.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { ensureFonts, FONT } from './fonts.js';
import { fillTextWithEmoji } from './emojiText.js';
import { KIT_COLUMNS } from '../services/kits.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño (mismos que renderWeaponCatalog.js para consistencia) ───
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

const CANVAS_W    = 640;
const PADDING     = 20;
const CARD_PAD    = 14;
const COL_GAP     = 10;
const ITEM_SIZE   = 34;
const ITEM_GAP    = 6;
const HEADER_H    = 56;
const FOOTER_H    = 30;

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

function colWidth() {
  return (CANVAS_W - PADDING * 2 - CARD_PAD * 2 - COL_GAP * (KIT_COLUMNS.length - 1)) / KIT_COLUMNS.length;
}

function kitBodyHeight(ctx, kit) {
  const contentW = CANVAS_W - PADDING * 2 - CARD_PAD * 2;
  let h = CARD_PAD; // padding superior de la tarjeta
  h += 20; // nombre del kit

  if (kit.description) {
    ctx.font = `11px ${FONT.sans}`;
    h += wrapText(ctx, kit.description, contentW).length * 15 + 4;
  }

  h += 18; // headers de columnas

  const maxRows = Math.max(1, ...KIT_COLUMNS.map((c) => kit.items[c.key].length));
  h += maxRows * (ITEM_SIZE + ITEM_GAP);
  h += CARD_PAD; // padding inferior
  return h;
}

/**
 * Genera la imagen de kits recomendados.
 * @param {Array} kits - lista de kits (ya normalizados, ver services/kits.js)
 * @param {string} serverName
 * @returns {Buffer}
 */
export async function renderKitsImage(kits, serverName = 'Culones RPG') {
  applyRenderTheme();
  ensureFonts();

  // Pre-descargar todas las imágenes de todos los kits/columnas
  const allUrls = [];
  for (const kit of kits) {
    for (const column of KIT_COLUMNS) {
      for (const item of kit.items[column.key]) {
        if (item.image_url) allUrls.push(item.image_url);
      }
    }
  }
  await Promise.all(allUrls.map(fetchImage));

  const measureCanvas = createCanvas(10, 10);
  const measureCtx    = measureCanvas.getContext('2d');
  ensureFonts();

  const KIT_GAP = 14;
  let bodyH = 0;
  for (const kit of kits) {
    bodyH += kitBodyHeight(measureCtx, kit) + KIT_GAP;
  }
  if (kits.length === 0) bodyH = 80;

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
  fillTextWithEmoji(ctx, '🎒 KITS RECOMENDADOS', PADDING, HEADER_H / 2);

  ctx.fillStyle = INK_400;
  ctx.font      = `11px ${FONT.sans}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${kits.length} kit${kits.length !== 1 ? 's' : ''}`, CANVAS_W - PADDING, HEADER_H / 2);

  // ── Cuerpo ────────────────────────────────────────────────────────────────
  let y = HEADER_H + PADDING;
  const cardW  = CANVAS_W - PADDING * 2;
  const cW     = colWidth();

  if (kits.length === 0) {
    ctx.fillStyle    = INK_600;
    ctx.font         = `13px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Todavía no hay kits recomendados publicados.', CANVAS_W / 2, y + 30);
    y += 60;
  }

  for (const kit of kits) {
    const cardH = kitBodyHeight(ctx, kit);
    const cardY = y;

    ctx.fillStyle = 'rgba(143,105,230,0.075)';
    roundRect(ctx, PADDING, cardY, cardW, cardH, 8);
    ctx.fill();
    ctx.strokeStyle = 'rgba(169,133,255,0.18)';
    ctx.lineWidth   = 1;
    roundRect(ctx, PADDING, cardY, cardW, cardH, 8);
    ctx.stroke();

    let innerY = cardY + CARD_PAD;
    const innerX = PADDING + CARD_PAD;

    ctx.fillStyle    = GOLD;
    ctx.font         = `bold 15px ${FONT.sans}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncate(kit.name || 'Kit sin nombre', 46), innerX, innerY);
    innerY += 20;

    if (kit.description) {
      ctx.fillStyle = INK_400;
      ctx.font      = `11px ${FONT.sans}`;
      const lines = wrapText(ctx, kit.description, cardW - CARD_PAD * 2);
      for (const line of lines) {
        ctx.fillText(line, innerX, innerY);
        innerY += 15;
      }
      innerY += 4;
    }

    // Headers de columna
    KIT_COLUMNS.forEach((column, idx) => {
      const cx = innerX + idx * (cW + COL_GAP);
      ctx.fillStyle    = CYAN;
      ctx.font         = `bold 10px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(column.label.toUpperCase(), cx, innerY);
    });
    innerY += 18;

    // Filas de items por columna
    const maxRows = Math.max(1, ...KIT_COLUMNS.map((c) => kit.items[c.key].length));
    for (let row = 0; row < maxRows; row++) {
      const rowY = innerY + row * (ITEM_SIZE + ITEM_GAP);

      KIT_COLUMNS.forEach((column, idx) => {
        const cx   = innerX + idx * (cW + COL_GAP);
        const item = kit.items[column.key][row];

        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        roundRect(ctx, cx, rowY, ITEM_SIZE, ITEM_SIZE, 6);
        ctx.fill();

        if (!item) return; // slot vacío para esta columna en esta fila

        const img = item.image_url ? imageCache.get(item.image_url) : null;
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.save();
          roundRect(ctx, cx, rowY, ITEM_SIZE, ITEM_SIZE, 6);
          ctx.clip();
          ctx.drawImage(img, cx, rowY, ITEM_SIZE, ITEM_SIZE);
          ctx.restore();
        }

        ctx.fillStyle    = INK_100;
        ctx.font         = `9px ${FONT.sans}`;
        ctx.textAlign    = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(truncate(item.name || '', 12), cx + ITEM_SIZE + 6, rowY + ITEM_SIZE / 2);
      });
    }

    y = cardY + cardH + KIT_GAP;
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
  ctx.fillText(`${serverName} · Kits · ${new Date().toLocaleDateString('es-ES')}`, PADDING, footerY + 15);

  ctx.fillStyle = CYAN;
  ctx.textAlign = 'right';
  ctx.fillText('culones-rpg', CANVAS_W - PADDING, footerY + 15);

  return canvas.toBuffer('image/png');
}
