// src/utils/renderTierlist.js
// Genera una imagen PNG de la tierlist para una columna específica.

import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { ensureFonts, FONT } from './fonts.js';
import { supabase } from '../services/supabase.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño ─────────────────────────────────────────────────────────
const ITEM_SIZE    = 52;
const ITEM_GAP     = 6;
const ROW_LABEL_W  = 72;
const PADDING      = 16;
const ROW_GAP      = 8;
let BG_COLOR = '#090612';
let BORDER_COLOR = 'rgba(169,133,255,0.18)';
let CYAN = '#a985ff';
let INK_400 = '#aaa2c1';

function applyRenderTheme() {
  const theme = getRenderPalette();
  BG_COLOR = theme.bg;
  BORDER_COLOR = themeRgba(theme.primary, 0.18);
  CYAN = theme.primary;
  INK_400 = theme.muted;
}

const imageCache = new Map();
const IMAGE_FAIL_CACHE = new Set(); // URLs que fallaron: no reintentar en el mismo proceso

// Extrae el path relativo dentro del bucket desde una URL pública de Supabase Storage
// Ej: https://xxx.supabase.co/storage/v1/object/public/culones/tierlist/img.png → tierlist/img.png
function extractStoragePath(url) {
  const marker = '/object/public/culones/';
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return url.slice(idx + marker.length);
}

async function fetchImage(url) {
  if (!url) return null;
  if (IMAGE_FAIL_CACHE.has(url)) return null;
  if (imageCache.has(url)) return imageCache.get(url);

  try {
    let buffer;

    // Intentar primero con Supabase Storage SDK (para imágenes en el bucket)
    const storagePath = extractStoragePath(url);
    if (storagePath) {
      const { data, error } = await supabase.storage
        .from('culones')
        .download(storagePath);

      if (!error && data) {
        const arrayBuffer = await data.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }
    }

    // Fallback: fetch directo para imágenes externas (Discord CDN, imgur, etc.)
    if (!buffer) {
      const response = await axios.get(url, {
        responseType: 'arraybuffer',
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'image/*,*/*;q=0.8',
        },
      });
      buffer = Buffer.from(response.data);
    }

    const img = await loadImage(buffer);
    imageCache.set(url, img);
    return img;
  } catch (err) {
    console.warn(`[renderTierlist] No se pudo cargar imagen: ${url} — ${err.message}`);
    IMAGE_FAIL_CACHE.add(url);
    return null;
  }
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function contrastColor(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#090612' : '#ffffff';
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

function itemsPerRow(totalWidth) {
  const availableW = totalWidth - ROW_LABEL_W - PADDING * 2;
  return Math.max(4, Math.floor(availableW / (ITEM_SIZE + ITEM_GAP)));
}

export async function renderTierlistImage(grouped, columnLabel, serverName = 'Culones RPG') {
  applyRenderTheme();
  ensureFonts();

  // Pre-descargar imágenes en paralelo
  const allItems = grouped.flatMap(g => g.items);
  await Promise.all(allItems.filter(i => i.image_url).map(i => fetchImage(i.image_url)));

  // Calcular dimensiones
  const maxItemsInAnyRow = Math.max(...grouped.map(g => g.items.length), 1);
  const displayCols = Math.min(Math.max(maxItemsInAnyRow, 4), 8);
  const canvasW = Math.min(
    Math.max(ROW_LABEL_W + PADDING * 2 + displayCols * (ITEM_SIZE + ITEM_GAP), 400),
    900
  );

  const IPR = itemsPerRow(canvasW);

  const rowHeights = grouped.map(g => {
    const lines = Math.max(1, Math.ceil(g.items.length / IPR));
    return lines * (ITEM_SIZE + ITEM_GAP) + ITEM_GAP + 8;
  });

  const HEADER_H = 50;
  const FOOTER_H = 28;
  const totalH = HEADER_H + PADDING
    + rowHeights.reduce((s, h) => s + h + ROW_GAP, 0)
    + PADDING + FOOTER_H;

  const canvas = createCanvas(canvasW, totalH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, canvasW, totalH);

  // ── Header ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, canvasW, HEADER_H);
  ctx.strokeStyle = 'rgba(77,212,232,0.4)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(canvasW, HEADER_H);
  ctx.stroke();

  ctx.fillStyle    = CYAN;
  ctx.font         = `bold 18px ${FONT.sans}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign    = 'left';
  ctx.fillText(`TIERLIST · ${columnLabel.toUpperCase()}`, PADDING, HEADER_H / 2);

  // ── Filas ────────────────────────────────────────────────────────────────
  let y = HEADER_H + PADDING;

  for (let ri = 0; ri < grouped.length; ri++) {
    const { row, items } = grouped[ri];
    const rowH           = rowHeights[ri];
    const rowColor       = row.color || CYAN;

    // Etiqueta de fila
    ctx.fillStyle = rowColor;
    ctx.fillRect(PADDING, y, ROW_LABEL_W, rowH);

    ctx.fillStyle    = contrastColor(rowColor);
    ctx.font         = `bold 16px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(row.name, 6), PADDING + ROW_LABEL_W / 2, y + rowH / 2);

    // Zona de items
    const itemsX = PADDING + ROW_LABEL_W + ITEM_GAP;
    const itemsW = canvasW - itemsX - PADDING;
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(itemsX, y, itemsW, rowH);

    for (let ii = 0; ii < items.length; ii++) {
      const item = items[ii];
      const col  = ii % IPR;
      const line = Math.floor(ii / IPR);
      const ix   = itemsX + ITEM_GAP + col * (ITEM_SIZE + ITEM_GAP);
      const iy   = y + ITEM_GAP + line * (ITEM_SIZE + ITEM_GAP + 16);

      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      roundRect(ctx, ix, iy, ITEM_SIZE, ITEM_SIZE, 4);
      ctx.fill();

      if (item.image_url) {
        const img = imageCache.get(item.image_url);
        if (img) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, ix, iy, ITEM_SIZE, ITEM_SIZE);
        }
      } else {
        ctx.fillStyle = 'rgba(77,212,232,0.15)';
        roundRect(ctx, ix, iy, ITEM_SIZE, ITEM_SIZE, 4);
        ctx.fill();
        ctx.fillStyle    = CYAN;
        ctx.font         = `bold 20px ${FONT.sans}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((item.name || '?')[0].toUpperCase(), ix + ITEM_SIZE / 2, iy + ITEM_SIZE / 2);
      }

      ctx.fillStyle    = 'rgba(255,255,255,0.75)';
      ctx.font         = `9px ${FONT.sans}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(item.name || '', 10), ix + ITEM_SIZE / 2, iy + ITEM_SIZE + 2);
    }

    if (items.length === 0) {
      ctx.fillStyle    = 'rgba(255,255,255,0.2)';
      ctx.font         = `12px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('— sin elementos —', itemsX + ITEM_GAP * 2, y + rowH / 2);
    }

    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(PADDING, y + rowH);
    ctx.lineTo(canvasW - PADDING, y + rowH);
    ctx.stroke();

    y += rowH + ROW_GAP;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, totalH - FOOTER_H, canvasW, FOOTER_H);

  ctx.fillStyle    = 'rgba(255,255,255,0.3)';
  ctx.font         = `11px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${serverName} · ${new Date().toLocaleDateString('es-ES')}`, PADDING, totalH - FOOTER_H / 2);

  ctx.textAlign = 'right';
  ctx.fillStyle = CYAN;
  ctx.fillText('culones-rpg', canvasW - PADDING, totalH - FOOTER_H / 2);

  return canvas.toBuffer('image/png');
}
