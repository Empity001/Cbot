// src/utils/renderTierlistFull.js
// Genera una imagen PNG con las 3 columnas de la tierlist
// (Arma / Sub-arma / Accesorio) una al lado de la otra.
// Reutiliza la lógica de renderTierlist.js pero en modo "3 paneles".

import { createCanvas, loadImage } from '@napi-rs/canvas';
import axios from 'axios';
import { ensureFonts, FONT } from './fonts.js';
import { TIER_COLUMNS } from '../services/tierlist.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño (idénticos a renderTierlist.js) ─────────────────────────
const ITEM_SIZE    = 44;
const ITEM_GAP     = 5;
const ROW_LABEL_W  = 58;
const PADDING      = 14;
const ROW_GAP      = 6;
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

// Cuántos items caben por fila en un panel de ancho panelW
function ipr(panelW) {
  const avail = panelW - ROW_LABEL_W - PADDING * 2;
  return Math.max(3, Math.floor(avail / (ITEM_SIZE + ITEM_GAP)));
}

// Altura de un panel dado su grouped y su ancho
function panelHeight(grouped, panelW) {
  const cols = ipr(panelW);
  return grouped.reduce((h, g) => {
    const lines = Math.max(1, Math.ceil(g.items.length / cols));
    return h + lines * (ITEM_SIZE + ITEM_GAP) + ITEM_GAP + 8 + ROW_GAP;
  }, 0);
}

/**
 * Dibuja un panel de tierlist en el contexto `ctx` en la posición (ox, oy).
 */
async function drawPanel(ctx, grouped, columnLabel, panelW, panelH, ox, oy) {
  const COLS = ipr(panelW);

  // Header del panel
  const PANEL_HEADER_H = 36;
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(ox, oy, panelW, PANEL_HEADER_H);
  ctx.strokeStyle = `${CYAN}66`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ox, oy + PANEL_HEADER_H);
  ctx.lineTo(ox + panelW, oy + PANEL_HEADER_H);
  ctx.stroke();

  ctx.fillStyle    = CYAN;
  ctx.font         = `bold 13px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(columnLabel.toUpperCase(), ox + PADDING, oy + PANEL_HEADER_H / 2);

  let y = oy + PANEL_HEADER_H + PADDING / 2;

  for (const { row, items } of grouped) {
    const lines = Math.max(1, Math.ceil(items.length / COLS));
    const rowH  = lines * (ITEM_SIZE + ITEM_GAP) + ITEM_GAP + 8;
    const rowColor = row.color || CYAN;

    // Etiqueta de fila
    ctx.fillStyle = rowColor;
    ctx.fillRect(ox + PADDING, y, ROW_LABEL_W, rowH);
    ctx.fillStyle    = contrastColor(rowColor);
    ctx.font         = `bold 11px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(truncate(row.name, 5), ox + PADDING + ROW_LABEL_W / 2, y + rowH / 2);

    // Zona items
    const itemsX = ox + PADDING + ROW_LABEL_W + ITEM_GAP;
    const itemsW = panelW - ROW_LABEL_W - PADDING * 2 - ITEM_GAP;
    ctx.fillStyle = 'rgba(255,255,255,0.025)';
    ctx.fillRect(itemsX, y, itemsW, rowH);

    for (let ii = 0; ii < items.length; ii++) {
      const item = items[ii];
      const col  = ii % COLS;
      const line = Math.floor(ii / COLS);
      const ix   = itemsX + ITEM_GAP + col * (ITEM_SIZE + ITEM_GAP);
      const iy   = y + ITEM_GAP + line * (ITEM_SIZE + ITEM_GAP + 14);

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
        ctx.font         = `bold 16px ${FONT.sans}`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((item.name || '?')[0].toUpperCase(), ix + ITEM_SIZE / 2, iy + ITEM_SIZE / 2);
      }

      ctx.fillStyle    = 'rgba(255,255,255,0.7)';
      ctx.font         = `8px ${FONT.sans}`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(item.name || '', 9), ix + ITEM_SIZE / 2, iy + ITEM_SIZE + 2);
    }

    if (items.length === 0) {
      ctx.fillStyle    = 'rgba(255,255,255,0.18)';
      ctx.font         = `10px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText('— vacío —', itemsX + ITEM_GAP * 2, y + rowH / 2);
    }

    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(ox + PADDING, y + rowH);
    ctx.lineTo(ox + panelW - PADDING, y + rowH);
    ctx.stroke();

    y += rowH + ROW_GAP;
  }
}

/**
 * Genera la imagen PNG con las 3 columnas juntas.
 * @param {{ rows, items }} tierlistData - salida de loadTierlistData()
 * @param {string} serverName
 * @returns {Buffer}
 */
export async function renderTierlistFullImage(tierlistData, serverName = 'Culones RPG') {
  applyRenderTheme();
  ensureFonts();

  const { rows, items } = tierlistData;

  // Pre-descargar imágenes en paralelo
  await Promise.all(items.filter(i => i.image_url).map(i => fetchImage(i.image_url)));

  // Calcular el ancho de cada panel
  const COL_GAP   = 10;
  const TOTAL_W   = 1260;
  const PANEL_W   = Math.floor((TOTAL_W - PADDING * 2 - COL_GAP * 2) / 3);

  // Agrupar cada columna
  const panels = TIER_COLUMNS.map(col => ({
    col,
    grouped: rows.map(row => ({
      row,
      items: items.filter(i => i.row_id === row.id && i.column_key === col.key),
    })),
  }));

  // Altura de cada panel (sin header ni footer global)
  const PANEL_HEADER_H = 36;
  const panelBodies    = panels.map(p => panelHeight(p.grouped, PANEL_W));
  const maxBody        = Math.max(...panelBodies);

  const GLOBAL_HEADER_H = 50;
  const GLOBAL_FOOTER_H = 28;
  const totalH = GLOBAL_HEADER_H + PADDING + PANEL_HEADER_H + maxBody + PADDING + GLOBAL_FOOTER_H;

  const canvas = createCanvas(TOTAL_W, totalH);
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, TOTAL_W, totalH);

  // ── Header global ─────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, TOTAL_W, GLOBAL_HEADER_H);
  ctx.strokeStyle = `${CYAN}66`;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, GLOBAL_HEADER_H);
  ctx.lineTo(TOTAL_W, GLOBAL_HEADER_H);
  ctx.stroke();

  ctx.fillStyle    = CYAN;
  ctx.font         = `bold 20px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('TIERLIST COMPLETA', PADDING, GLOBAL_HEADER_H / 2);

  // ── Separadores verticales entre paneles ──────────────────────────────────
  const bodyY = GLOBAL_HEADER_H + PADDING;
  for (let i = 1; i < 3; i++) {
    const sepX = PADDING + i * (PANEL_W + COL_GAP) - COL_GAP / 2;
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(sepX, bodyY);
    ctx.lineTo(sepX, totalH - GLOBAL_FOOTER_H);
    ctx.stroke();
  }

  // ── Dibujar los 3 paneles ─────────────────────────────────────────────────
  for (let i = 0; i < panels.length; i++) {
    const { col, grouped } = panels[i];
    const ox = PADDING + i * (PANEL_W + COL_GAP);
    await drawPanel(ctx, grouped, col.label, PANEL_W, maxBody, ox, bodyY);
  }

  // ── Footer global ─────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, totalH - GLOBAL_FOOTER_H, TOTAL_W, GLOBAL_FOOTER_H);

  ctx.fillStyle    = 'rgba(255,255,255,0.3)';
  ctx.font         = `11px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${serverName} · ${new Date().toLocaleDateString('es-ES')}`, PADDING, totalH - GLOBAL_FOOTER_H / 2);

  ctx.textAlign = 'right';
  ctx.fillStyle = CYAN;
  ctx.fillText('culones-rpg', TOTAL_W - PADDING, totalH - GLOBAL_FOOTER_H / 2);

  return canvas.toBuffer('image/png');
}
