import { createCanvas, loadImage } from '@napi-rs/canvas';
import { downloadImage } from './mediaAttachments.js';
import { getRenderPalette, themeRgba } from '../services/siteTheme.js';

const SLOT = 72;
const SLOT_GAP = 7;
const CANVAS_WIDTH = 760;

const MINECRAFT = Object.freeze({
  panel: '#c6c6c6',
  panelLight: '#ffffff',
  panelMid: '#9b9b9b',
  panelDark: '#555555',
  slot: '#8b8b8b',
  slotDark: '#373737',
  slotLight: '#f3f3f3',
  text: '#262626',
  muted: '#4b4b4b',
});

function modeLabel(method = {}) {
  if (method.mode === 'crafting') return 'MESA DE CRAFTEO';
  if (method.mode === 'furnace') {
    if (method.furnace_type === 'blast_furnace') return 'ALTO HORNO';
    if (method.furnace_type === 'smoker') return 'AHUMADOR';
    return 'HORNO NORMAL';
  }
  if (method.mode === 'smithing') return 'MESA DE HERRERÍA';
  return 'INTERCAMBIO';
}

function canvasHeight(method = {}) {
  if (method.mode === 'crafting') return 440;
  if (method.mode === 'furnace') return 465;
  if (method.mode === 'smithing') return 355;
  return (method.materials || []).length > 3 ? 465 : 365;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawText(ctx, value, x, y, size = 22, align = 'left', weight = 'normal', color = MINECRAFT.text) {
  ctx.font = `${weight} ${size}px "Liberation Sans"`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(String(value || ''), x, y);
}

function shortName(value, max = 24) {
  const text = String(value || '').trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function drawScene(ctx, width, height, title, method) {
  const theme = getRenderPalette();
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createLinearGradient(0, 0, width, height);
  glow.addColorStop(0, themeRgba(theme.primary, 0.2));
  glow.addColorStop(0.55, themeRgba(theme.primary, 0.03));
  glow.addColorStop(1, themeRgba(theme.accent, 0.12));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  roundedRect(ctx, 18, 18, width - 36, height - 36, 16);
  ctx.fillStyle = theme.panel;
  ctx.fill();
  ctx.strokeStyle = themeRgba(theme.primary, 0.68);
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = theme.primary;
  ctx.fillRect(18, 18, 7, height - 36);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(25, 18, 96, 4);

  drawText(ctx, shortName(title || 'Método de fabricación', 42), 48, 52, 25, 'left', 'bold', theme.text);
  drawText(ctx, 'MEJORA / FABRICACIÓN', 49, 78, 12, 'left', 'bold', theme.muted);

  const badge = modeLabel(method);
  ctx.font = 'bold 13px "Liberation Sans"';
  const badgeWidth = Math.max(122, ctx.measureText(badge).width + 30);
  roundedRect(ctx, width - badgeWidth - 42, 40, badgeWidth, 38, 7);
  ctx.fillStyle = themeRgba(theme.primary, 0.16);
  ctx.fill();
  ctx.strokeStyle = themeRgba(theme.primarySoft, 0.65);
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(ctx, badge, width - badgeWidth / 2 - 42, 59, 13, 'center', 'bold', theme.primarySoft);

  drawMinecraftPanel(ctx, 42, 105, width - 84, height - 140);
}

function drawMinecraftPanel(ctx, x, y, width, height) {
  ctx.fillStyle = MINECRAFT.panel;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = MINECRAFT.panelLight;
  ctx.fillRect(x, y, width, 6);
  ctx.fillRect(x, y, 6, height);
  ctx.fillStyle = MINECRAFT.panelDark;
  ctx.fillRect(x, y + height - 6, width, 6);
  ctx.fillRect(x + width - 6, y, 6, height);
  ctx.fillStyle = MINECRAFT.panelMid;
  ctx.fillRect(x + 6, y + height - 10, width - 12, 4);
  ctx.fillRect(x + width - 10, y + 6, 4, height - 12);
}

async function loadSlotImage(slot, cache) {
  const url = slot?.image_url;
  if (!url) return null;
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    try {
      const downloaded = await downloadImage(url);
      return downloaded ? await loadImage(downloaded.buffer) : null;
    } catch {
      return null;
    }
  })();
  cache.set(url, promise);
  return promise;
}

function drawSlotFrame(ctx, x, y, { result = false } = {}) {
  const theme = getRenderPalette();
  const fill = result ? themeRgba(theme.primary, 0.42) : MINECRAFT.slot;
  const dark = result ? theme.primary : MINECRAFT.slotDark;

  ctx.fillStyle = dark;
  ctx.fillRect(x, y, SLOT, SLOT);
  ctx.fillStyle = MINECRAFT.slotLight;
  ctx.fillRect(x + 4, y + 4, SLOT - 4, SLOT - 4);
  ctx.fillStyle = fill;
  ctx.fillRect(x + 4, y + 4, SLOT - 8, SLOT - 8);
  ctx.fillStyle = result ? themeRgba(theme.accent, 0.8) : '#666666';
  ctx.fillRect(x + SLOT - 7, y + 4, 3, SLOT - 8);
  ctx.fillRect(x + 4, y + SLOT - 7, SLOT - 8, 3);
}

async function drawSlot(ctx, slot, x, y, cache, { result = false, label = true } = {}) {
  drawSlotFrame(ctx, x, y, { result });
  const image = await loadSlotImage(slot, cache);
  if (image) {
    ctx.imageSmoothingEnabled = false;
    const max = 53;
    let width;
    let height;
    if (image.width <= max && image.height <= max) {
      const scale = Math.max(1, Math.floor(Math.min(max / image.width, max / image.height)));
      width = Math.max(1, Math.min(max, image.width * scale));
      height = Math.max(1, Math.min(max, image.height * scale));
    } else {
      const scale = Math.min(max / image.width, max / image.height);
      width = Math.max(1, Math.round(image.width * scale));
      height = Math.max(1, Math.round(image.height * scale));
    }
    ctx.drawImage(image, Math.round(x + (SLOT - width) / 2), Math.round(y + (SLOT - height) / 2), width, height);
  } else if (slot?.name) {
    drawText(ctx, String(slot.name).slice(0, 2).toUpperCase(), x + SLOT / 2, y + SLOT / 2, 19, 'center', 'bold', '#f8f8f8');
  }

  const quantity = Math.max(1, Number(slot?.qty) || 1);
  if ((slot?.name || slot?.image_url) && quantity > 1) {
    const value = String(quantity);
    drawText(ctx, value, x + SLOT - 8, y + SLOT - 10, 18, 'right', 'bold', '#161616');
    drawText(ctx, value, x + SLOT - 10, y + SLOT - 12, 18, 'right', 'bold', '#ffffff');
  }

  if (label && (slot?.name || result)) {
    drawText(ctx, shortName(slot?.name || 'Resultado', 18), x + SLOT / 2, y + SLOT + 18, 13, 'center', 'bold', MINECRAFT.muted);
  }
}

function drawArrow(ctx, x, y) {
  ctx.fillStyle = '#555555';
  ctx.fillRect(x - 34, y - 7, 48, 14);
  ctx.beginPath();
  ctx.moveTo(x + 14, y - 24);
  ctx.lineTo(x + 42, y);
  ctx.lineTo(x + 14, y + 24);
  ctx.closePath();
  ctx.fill();
}

function drawPlus(ctx, x, y) {
  ctx.fillStyle = '#555555';
  ctx.fillRect(x - 11, y - 3, 22, 6);
  ctx.fillRect(x - 3, y - 11, 6, 22);
}

function methodsSlots(method) {
  if (method.mode === 'crafting') return Array.from({ length: 9 }, (_, index) => method.grid?.[index] || {});
  if (method.mode === 'furnace' || method.mode === 'smithing') return method.inputs || [];
  return method.materials || [];
}

function markdownLabel(value) {
  return String(value || '').replace(/([\\[\]()])/g, '\\$1');
}

function linkedSlotLabel(slot, fallback, guideLinkBuilder) {
  const label = markdownLabel(slot?.name || fallback);
  const url = typeof guideLinkBuilder === 'function' ? guideLinkBuilder(slot?.guide_link) : null;
  return url ? `[${label}](${url})` : label;
}

export function recipeMethodText(method = {}, { guideLinkBuilder = null } = {}) {
  const lines = [`**${modeLabel(method)}**`];
  const slots = methodsSlots(method).filter(slot => slot?.name || slot?.image_url || slot?.guide_link);
  slots.forEach((slot, index) => {
    lines.push(`> ${linkedSlotLabel(slot, `Material ${index + 1}`, guideLinkBuilder)} ×${Math.max(1, Number(slot.qty) || 1)}`);
  });
  if (method.result?.name || method.result?.image_url || method.result?.guide_link) {
    lines.push('', `**Resultado:** ${linkedSlotLabel(method.result, 'Resultado', guideLinkBuilder)} ×${Math.max(1, Number(method.result?.qty) || 1)}`);
  }
  return lines.join('\n');
}

async function drawCrafting(ctx, method, cache) {
  const grid = Array.from({ length: 9 }, (_, index) => method.grid?.[index] || {});
  const startX = 78;
  const startY = 132;
  for (let index = 0; index < 9; index++) {
    await drawSlot(
      ctx,
      grid[index],
      startX + (index % 3) * (SLOT + SLOT_GAP),
      startY + Math.floor(index / 3) * (SLOT + SLOT_GAP),
      cache,
      { label: false },
    );
  }
  drawArrow(ctx, 470, 251);
  await drawSlot(ctx, method.result || {}, 590, 215, cache, { result: true });
}

async function drawFurnace(ctx, method, cache) {
  const inputs = method.inputs || [];
  const slotX = 155;
  await drawSlot(ctx, inputs[0] || {}, slotX, 135, cache);
  await drawSlot(ctx, inputs[1] || {}, slotX, 290, cache);

  ctx.fillStyle = '#d86a29';
  ctx.beginPath();
  ctx.moveTo(slotX + 36, 270);
  ctx.quadraticCurveTo(slotX + 10, 245, slotX + 38, 220);
  ctx.quadraticCurveTo(slotX + 28, 248, slotX + 54, 270);
  ctx.closePath();
  ctx.fill();

  drawArrow(ctx, 430, 244);
  await drawSlot(ctx, method.result || {}, 590, 208, cache, { result: true });
  drawText(ctx, 'COMBUSTIBLE', slotX + SLOT / 2, 280, 11, 'center', 'bold', MINECRAFT.muted);
}

async function drawSmithing(ctx, method, cache) {
  const inputs = method.inputs || [];
  const positions = [75, 195, 315];
  for (let index = 0; index < 3; index++) {
    await drawSlot(ctx, inputs[index] || {}, positions[index], 165, cache);
    if (index < 2) drawPlus(ctx, positions[index] + SLOT + 24, 201);
  }
  drawArrow(ctx, 485, 201);
  await drawSlot(ctx, method.result || {}, 600, 165, cache, { result: true });
}

async function drawTrade(ctx, method, cache) {
  const materials = (method.materials || []).slice(0, 6);
  const startX = 68;
  const startY = 135;
  for (let index = 0; index < materials.length; index++) {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = startX + column * 112;
    const y = startY + row * 132;
    await drawSlot(ctx, materials[index], x, y, cache);
    if (column < 2 && index < materials.length - 1) drawPlus(ctx, x + SLOT + 20, y + SLOT / 2);
  }
  const centerY = materials.length > 3 ? 247 : 191;
  drawArrow(ctx, 495, centerY);
  await drawSlot(ctx, method.result || {}, 610, centerY - SLOT / 2, cache, { result: true });
}

export async function renderWorkbenchMethod(method = {}, title = 'Método de fabricación') {
  const height = canvasHeight(method);
  const canvas = createCanvas(CANVAS_WIDTH, height);
  const ctx = canvas.getContext('2d');
  drawScene(ctx, CANVAS_WIDTH, height, title, method);

  const cache = new Map();
  if (method.mode === 'crafting') await drawCrafting(ctx, method, cache);
  else if (method.mode === 'furnace') await drawFurnace(ctx, method, cache);
  else if (method.mode === 'smithing') await drawSmithing(ctx, method, cache);
  else await drawTrade(ctx, method, cache);

  return canvas.toBuffer('image/png');
}
