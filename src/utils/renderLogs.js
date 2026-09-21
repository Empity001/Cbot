// src/utils/renderLogs.js
// Genera una imagen PNG con la lista de los logs más recientes.
// Mismo lenguaje visual que renderTierlist.js / renderWeapon.js.

import { createCanvas } from '@napi-rs/canvas';
import { ensureFonts, FONT } from './fonts.js';
import { fillTextWithEmoji, measureTextWithEmoji } from './emojiText.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño (compartidos entre los tres renderers) ─────────────────
let BG_COLOR = '#090612';
let BORDER_COLOR = 'rgba(169,133,255,0.18)';
let GOLD = '#d6b56f';
let CYAN = '#a985ff';
let MAGENTA = '#ec72d3';
let INK_100 = '#f6f1ff';
let INK_400 = '#aaa2c1';
let INK_600 = 'rgba(220,208,244,0.52)';

const CANVAS_W    = 680;
const PADDING     = 20;
const ROW_H       = 58;

const RELEVANCE_COLOR = {
  low:      '#aaa2c1',
  normal:   CYAN,
  high:     GOLD,
  critical: MAGENTA,
};

const RELEVANCE_LABEL = {
  low:      'Baja',
  normal:   'Normal',
  high:     'Alta',
  critical: 'Crítica',
};

function applyRenderTheme() {
  const theme = getRenderPalette();
  BG_COLOR = theme.bg;
  BORDER_COLOR = themeRgba(theme.primary, 0.18);
  GOLD = theme.accent;
  CYAN = theme.primary;
  MAGENTA = theme.event;
  INK_100 = theme.text;
  INK_400 = theme.muted;
  INK_600 = themeRgba(theme.muted, 0.52);
  RELEVANCE_COLOR.low = theme.muted;
  RELEVANCE_COLOR.normal = theme.primary;
  RELEVANCE_COLOR.high = theme.warning;
  RELEVANCE_COLOR.critical = theme.danger;
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
 * Genera el PNG con la lista de logs recientes.
 * @param {Array} logs - salida de loadRecentLogs() (cada uno con .categoryInfo)
 * @param {string} serverName
 * @returns {Buffer}
 */
export function renderLogsImage(logs, serverName = 'Culones RPG') {
  applyRenderTheme();
  // Registrar fuentes bundleadas antes del primer uso (idempotente)
  ensureFonts();

  const HEADER_H = 56;
  const FOOTER_H = 30;
  const totalH   = HEADER_H + PADDING + logs.length * (ROW_H + 8) + PADDING + FOOTER_H;
  const canvas   = createCanvas(CANVAS_W, Math.max(totalH, 200));
  const ctx      = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_W, canvas.height);

  // ── Header ──────────────────────────────────────────────────────────────
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, CANVAS_W, HEADER_H);
  ctx.strokeStyle = 'rgba(243,183,58,0.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(CANVAS_W, HEADER_H);
  ctx.stroke();

  ctx.fillStyle   = GOLD;
  ctx.font        = `bold 18px ${FONT.sans}`;
  ctx.textAlign   = 'left';
  ctx.textBaseline = 'middle';
  fillTextWithEmoji(ctx, '📜 LOGS RECIENTES', PADDING, HEADER_H / 2);

  ctx.fillStyle = INK_400;
  ctx.font      = `11px ${FONT.sans}`;
  ctx.textAlign = 'right';
  ctx.fillText(`últimos ${logs.length}`, CANVAS_W - PADDING, HEADER_H / 2);

  // ── Filas ────────────────────────────────────────────────────────────────
  let y          = HEADER_H + PADDING;
  const contentW = CANVAS_W - PADDING * 2;

  if (logs.length === 0) {
    ctx.fillStyle    = INK_600;
    ctx.font         = `13px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('No hay logs todavía.', CANVAS_W / 2, y + 30);
    y += 60;
  }

  for (const log of logs) {
    const relColor = RELEVANCE_COLOR[log.relevance] || CYAN;
    const cat      = log.categoryInfo;

    // Fondo de la fila
    ctx.fillStyle = 'rgba(143,105,230,0.075)';
    roundRect(ctx, PADDING, y, contentW, ROW_H, 8);
    ctx.fill();

    // Barra de color de relevancia (izquierda)
    ctx.fillStyle = relColor;
    roundRect(ctx, PADDING, y, 4, ROW_H, 2);
    ctx.fill();

    const textX = PADDING + 16;

    // Título del log
    ctx.fillStyle    = INK_100;
    ctx.font         = `bold 14px ${FONT.sans}`;
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(truncate(log.title, 52), textX, y + 9);

    // Categoría + relevancia
    ctx.font      = `11px ${FONT.sans}`;
    let metaX     = textX;

    if (cat) {
      const label = `${cat.emoji || ''} ${cat.label}`;
      ctx.fillStyle = cat.color || INK_400;
      fillTextWithEmoji(ctx, label, metaX, y + 31);
      metaX += measureTextWithEmoji(ctx, label) + 14;
    }

    ctx.fillStyle = relColor;
    fillTextWithEmoji(ctx, `⚡ ${RELEVANCE_LABEL[log.relevance] || log.relevance}`, metaX, y + 31);

    // Fecha y likes (derecha)
    ctx.fillStyle    = INK_600;
    ctx.font         = `10.5px ${FONT.sans}`;
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    const dateStr = new Date(log.created_at).toLocaleDateString('es-ES', {
      day: '2-digit', month: 'short', year: 'numeric',
    });
    ctx.fillText(dateStr, CANVAS_W - PADDING - 12, y + 9);

    ctx.fillStyle = MAGENTA;
    fillTextWithEmoji(ctx, `❤ ${log.likes ?? 0}`, CANVAS_W - PADDING - 12, y + 31);
    ctx.textAlign = 'left';

    y += ROW_H + 8;
  }

  // ── Footer ───────────────────────────────────────────────────────────────
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
  ctx.fillText(
    `${serverName} · ${new Date().toLocaleDateString('es-ES')}`,
    PADDING,
    footerY + FOOTER_H / 2
  );

  ctx.fillStyle = CYAN;
  ctx.textAlign = 'right';
  ctx.fillText('culones-rpg', CANVAS_W - PADDING, footerY + FOOTER_H / 2);

  return canvas.toBuffer('image/png');
}
