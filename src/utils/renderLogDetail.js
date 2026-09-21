// src/utils/renderLogDetail.js
// Genera una imagen PNG con el contenido completo de un log:
// título, descripción, categoría, relevancia, mobs, items y bloques libres.

import { createCanvas } from '@napi-rs/canvas';
import { ensureFonts, FONT } from './fonts.js';
import { splitItems, formatLibreForCanvas, measureLibreHeight, measureLibreTitleHeight, formatEquipmentForCanvas, formatSourceForCanvas } from './libreFields.js';
import { fillTextWithEmoji, measureTextWithEmoji } from './emojiText.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

// ── Tokens de diseño (mismo sistema que los otros renderers) ─────────────────
let BG_COLOR = '#090612';
let BORDER_COLOR = 'rgba(169,133,255,0.18)';
let GOLD = '#d6b56f';
let CYAN = '#a985ff';
let MAGENTA = '#ec72d3';
let GREEN = '#38e07a';
let INK_100 = '#f6f1ff';
let INK_400 = '#aaa2c1';
let INK_600 = 'rgba(220,208,244,0.52)';

const CANVAS_W = 680;
const PADDING  = 20;

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
  GREEN = theme.confirmation;
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

function wrapText(ctx, text, maxWidth) {
  if (!text) return [];
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (measureTextWithEmoji(ctx, test) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function sectionHeader(ctx, label, color, x, y, w) {
  ctx.fillStyle = color;
  ctx.font = `bold 12px ${FONT.sans}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x, y + 9);
  ctx.strokeStyle = `${color}44`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const textW = ctx.measureText(label).width;
  ctx.moveTo(x + textW + 8, y + 9);
  ctx.lineTo(x + w, y + 9);
  ctx.stroke();
  return y + 24;
}

/**
 * Genera el PNG con el contenido completo de un log.
 * @param {Object} log - salida de loadLogById()
 * @param {string} serverName
 * @returns {Buffer}
 */
export function renderLogDetailImage(log, serverName = 'Culones RPG') {
  applyRenderTheme();
  ensureFonts();

  const contentW = CANVAS_W - PADDING * 2;
  const relColor = RELEVANCE_COLOR[log.relevance] || CYAN;
  const cat      = log.categoryInfo;

  // ── Pre-calcular altura total ────────────────────────────────────────────
  // Usamos un canvas temporal solo para medir texto
  const measure = createCanvas(CANVAS_W, 10).getContext('2d');
  ensureFonts();

  // Bug 3 fix: separar items normales de bloques libres desde el principio
  const allItems = log.items || [];
  const { normalItems, libres } = splitItems(allItems);

  let estimatedH = 56; // header
  estimatedH += PADDING;

  // Título (puede tener 2 líneas)
  measure.font = `bold 18px ${FONT.sans}`;
  const titleLines = wrapText(measure, log.title || '', contentW - 8);
  estimatedH += titleLines.length * 24 + 8;

  // Meta: fecha + categoría + relevancia
  estimatedH += 22 + PADDING;

  // Separador
  estimatedH += 14;

  // Descripción
  if (log.description) {
    measure.font = `13px ${FONT.sans}`;
    estimatedH += 24; // sección header
    estimatedH += wrapText(measure, log.description, contentW - 4).length * 18 + 12;
  }

  // Mobs
  const mobs = log.mobs || [];
  if (mobs.length > 0) {
    estimatedH += 24; // sección header
    estimatedH += mobs.length * 72 + (mobs.length - 1) * 8;
    estimatedH += 12;
  }

  // Items normales (bug 3 fix: excluye libres del cálculo de altura de esta sección)
  if (normalItems.length > 0) {
    estimatedH += 24;
    estimatedH += normalItems.length * 52 + (normalItems.length - 1) * 6;
    estimatedH += 12;
  }

  // Bug 4 fix: altura dinámica para bloques libres (cada uno puede necesitar
  // mucho más que 52px si tiene varios campos/sub-campos/descripción).
  if (libres.length > 0) {
    estimatedH += 24; // sección header
    for (const libre of libres) {
      estimatedH += measureLibreHeight(measure, libre, contentW - 24, FONT.sans);
      estimatedH += 10; // gap entre cards
    }
    estimatedH += 8;
  }

  estimatedH += PADDING + 30; // footer

  // ── Canvas real ───────────────────────────────────────────────────────────
  const canvas = createCanvas(CANVAS_W, Math.max(estimatedH, 200));
  const ctx    = canvas.getContext('2d');

  ctx.fillStyle = BG_COLOR;
  ctx.fillRect(0, 0, CANVAS_W, canvas.height);

  // ── Header ────────────────────────────────────────────────────────────────
  const HEADER_H = 56;
  ctx.fillStyle = 'rgba(124,92,255,0.10)';
  ctx.fillRect(0, 0, CANVAS_W, HEADER_H);
  ctx.strokeStyle = `${GOLD}66`;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEADER_H);
  ctx.lineTo(CANVAS_W, HEADER_H);
  ctx.stroke();

  ctx.fillStyle    = GOLD;
  ctx.font         = `bold 17px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('DETALLE DE LOG', PADDING, HEADER_H / 2);

  // Fecha en el header
  const dateStr = new Date(log.created_at).toLocaleDateString('es-ES', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
  ctx.fillStyle = INK_600;
  ctx.font      = `11px ${FONT.sans}`;
  ctx.textAlign = 'right';
  ctx.fillText(dateStr, CANVAS_W - PADDING, HEADER_H / 2);

  // ── Cuerpo ────────────────────────────────────────────────────────────────
  let y = HEADER_H + PADDING;

  // Barra lateral de relevancia + Título
  ctx.fillStyle = relColor;
  ctx.fillRect(PADDING, y, 4, titleLines.length * 24 + 4);

  ctx.fillStyle    = INK_100;
  ctx.font         = `bold 18px ${FONT.sans}`;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < titleLines.length; i++) {
    ctx.fillText(titleLines[i], PADDING + 14, y + i * 24);
  }
  y += titleLines.length * 24 + 8;

  // Meta row: categoría + relevancia + likes
  ctx.font = `11px ${FONT.sans}`;
  ctx.textBaseline = 'middle';
  let metaX = PADDING + 14;

  if (cat) {
    const catLabel = cat.label || '';
    ctx.fillStyle = cat.color || INK_400;
    ctx.fillText(catLabel, metaX, y + 8);
    metaX += ctx.measureText(catLabel).width + 14;
  }

  ctx.fillStyle = relColor;
  const relevanceText = RELEVANCE_LABEL[log.relevance] || log.relevance || '—';
  ctx.fillText(relevanceText, metaX, y + 8);
  metaX += ctx.measureText(relevanceText).width + 14;

  ctx.fillStyle = MAGENTA;
  ctx.fillText(`+${log.likes ?? 0}`, metaX, y + 8);

  y += 22 + PADDING;

  // Separador
  ctx.strokeStyle = BORDER_COLOR;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, y);
  ctx.lineTo(CANVAS_W - PADDING, y);
  ctx.stroke();
  y += 14;

  // ── Descripción ───────────────────────────────────────────────────────────
  if (log.description) {
    y = sectionHeader(ctx, 'DESCRIPCIÓN', CYAN, PADDING, y, contentW);

    ctx.font         = `13px ${FONT.sans}`;
    ctx.fillStyle    = 'rgba(255,255,255,0.78)';
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'left';
    const descLines = wrapText(ctx, log.description, contentW - 4);
    for (const line of descLines) {
      ctx.fillText(line, PADDING, y);
      y += 18;
    }
    y += 12;
  }

  // ── Mobs ──────────────────────────────────────────────────────────────────
  if (mobs.length > 0) {
    y = sectionHeader(ctx, `MOBS (${mobs.length})`, MAGENTA, PADDING, y, contentW);

    for (const mob of mobs) {
      const cardH = 68;

      ctx.fillStyle = 'rgba(255,61,142,0.06)';
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,61,142,0.18)';
      ctx.lineWidth = 1;
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.stroke();

      // Nombre
      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 13px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(mob.name, 34), PADDING + 12, y + 10);

      // Stats en fila — usamos etiquetas de texto cortas para que sean
      // legibles aunque la fuente de emoji no esté disponible en el servidor.
      const stats = [];
      if (mob.health != null) stats.push({ label: 'Vida',  value: mob.health, color: MAGENTA });
      if (mob.damage != null) stats.push({ label: 'Daño',  value: mob.damage, color: GOLD });
      if (mob.armor  != null) stats.push({ label: 'Armor', value: mob.armor,  color: CYAN });

      let sx = PADDING + 12;
      const sy = y + 30;
      ctx.font = `11px ${FONT.sans}`;
      for (const st of stats) {
        ctx.fillStyle = INK_400;
        fillTextWithEmoji(ctx, `${st.label}: `, sx, sy);
        const labelW = measureTextWithEmoji(ctx, `${st.label}: `);
        ctx.fillStyle = st.color;
        ctx.font = `bold 11px ${FONT.sans}`;
        ctx.fillText(String(st.value), sx + labelW, sy);
        sx += labelW + ctx.measureText(String(st.value)).width + 16;
        ctx.font = `11px ${FONT.sans}`;
      }

      // Equipamiento / ubicación
      const metaParts = [];
      const equipmentText = formatEquipmentForCanvas(mob.equipment);
      if (equipmentText) metaParts.push(equipmentText);
      if (mob.location)  metaParts.push(mob.location);
      if (metaParts.length) {
        ctx.fillStyle    = INK_400;
        ctx.font         = `10px ${FONT.sans}`;
        ctx.textBaseline = 'top';
        fillTextWithEmoji(ctx, truncate(metaParts.join('  ·  '), 72), PADDING + 12, y + 48);
      }

      y += cardH + 8;
    }
    y += 4;
  }

  // ── Items normales ────────────────────────────────────────────────────────
  // Bug 1+2+3 fix: solo items cuyo item_type !== '_libre', con contador correcto
  if (normalItems.length > 0) {
    y = sectionHeader(ctx, `ITEMS (${normalItems.length})`, GREEN, PADDING, y, contentW);

    for (const item of normalItems) {
      const cardH = 48;

      ctx.fillStyle = 'rgba(56,224,122,0.05)';
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(56,224,122,0.15)';
      ctx.lineWidth = 1;
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.stroke();

      // Nombre
      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 13px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(truncate(item.name, 34), PADDING + 12, y + 8);

      // Meta: tier · tipo · origen (texto limpio, nunca JSON crudo)
      const metaParts = [];
      if (item.tier)          metaParts.push(`Rango: ${item.tier}`);
      if (item.item_type)     metaParts.push(item.item_type);
      const sourceText = formatSourceForCanvas(item.obtained_from);
      if (sourceText) metaParts.push(sourceText);

      if (metaParts.length) {
        ctx.fillStyle    = INK_400;
        ctx.font         = `10.5px ${FONT.sans}`;
        ctx.textBaseline = 'top';
        ctx.fillText(truncate(metaParts.join('  ·  '), 76), PADDING + 12, y + 28);
      }

      y += cardH + 6;
    }
    y += 4;
  }

  // ── Extras ────────────────────────────────────────────────────────
  // Bug 1+2+4 fix: sección separada con card dinámica por cada bloque libre,
  // parseando obtained_from como JSON (nunca como texto plano).
  // Usamos violeta como color de acento para diferenciarlos visualmente.
  const LIBRE_COLOR = '#9a72f5'; // violeta
  if (libres.length > 0) {
    y = sectionHeader(ctx, `EXTRAS (${libres.length})`, LIBRE_COLOR, PADDING, y, contentW);

    for (const libre of libres) {
      const canvasLines = formatLibreForCanvas(libre);

      // Calcular la altura real de esta card para que no se corte nada
      const cardH = measureLibreHeight(ctx, libre, contentW - 24, FONT.sans);

      ctx.fillStyle = 'rgba(154,114,245,0.06)';
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.fill();
      ctx.strokeStyle = 'rgba(154,114,245,0.22)';
      ctx.lineWidth = 1;
      roundRect(ctx, PADDING, y, contentW, cardH, 8);
      ctx.stroke();

      // Nombre del bloque libre como título de la card.
      // Ya no se trunca a una sola línea: algunos bloques legacy guardaban
      // casi todo el contexto en el nombre, así que lo envolvemos completo.
      ctx.fillStyle    = INK_100;
      ctx.font         = `bold 13px ${FONT.sans}`;
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      const libreTitleLines = wrapText(ctx, libre.name || 'Extra', contentW - 24);
      for (let i = 0; i < libreTitleLines.length; i++) {
        ctx.fillText(libreTitleLines[i], PADDING + 12, y + 8 + i * 16);
      }

      let innerY = y + measureLibreTitleHeight(ctx, libre, contentW - 24, FONT.sans);

      if (canvasLines.length === 0) {
        ctx.fillStyle = INK_400;
        ctx.font      = `italic 11px ${FONT.sans}`;
        ctx.fillText('Sin campos.', PADDING + 12, innerY);
        innerY += 17;
      } else {
        for (const line of canvasLines) {
          const effectiveMaxW = contentW - 24 - line.indent;

          switch (line.style) {
            case 'header':
              ctx.fillStyle = LIBRE_COLOR;
              ctx.font = `bold 11px ${FONT.sans}`;
              break;
            case 'value':
              ctx.fillStyle = INK_100;
              ctx.font = `11px ${FONT.sans}`;
              break;
            case 'sub':
              ctx.fillStyle = INK_400;
              ctx.font = `italic 11px ${FONT.sans}`;
              break;
            case 'desc':
              ctx.fillStyle = 'rgba(255,255,255,0.6)';
              ctx.font = `italic 11px ${FONT.sans}`;
              break;
            case 'img':
              ctx.fillStyle = INK_600;
              ctx.font = `10px ${FONT.sans}`;
              break;
            default:
              ctx.fillStyle = INK_400;
              ctx.font = `11px ${FONT.sans}`;
          }

          ctx.textBaseline = 'top';
          ctx.textAlign    = 'left';

          // Wrap de texto manual para esta línea
          const wrapped = wrapText(ctx, line.text, effectiveMaxW);
          const lineH   = line.style === 'img' ? 15 : (line.style === 'sub' ? 16 : 17);
          for (const wrappedLine of wrapped) {
            ctx.fillText(wrappedLine, PADDING + 12 + line.indent, innerY);
            innerY += lineH;
          }
        }
      }

      y += cardH + 10;
    }
    y += 4;
  }

  // ── Vacío ─────────────────────────────────────────────────────────────────
  // Bug 5 fix: el check de vacío usa normalItems + libres, no el array completo
  if (!log.description && mobs.length === 0 && normalItems.length === 0 && libres.length === 0) {
    ctx.fillStyle    = INK_600;
    ctx.font         = `13px ${FONT.sans}`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Este log no tiene contenido detallado.', CANVAS_W / 2, y + 24);
    y += 48;
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const footerY = canvas.height - 30;
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
  ctx.fillText(`${serverName} · ${new Date().toLocaleDateString('es-ES')}`, PADDING, footerY + 15);

  ctx.fillStyle = CYAN;
  ctx.textAlign = 'right';
  ctx.fillText('culones-rpg', CANVAS_W - PADDING, footerY + 15);

  return canvas.toBuffer('image/png');
}
