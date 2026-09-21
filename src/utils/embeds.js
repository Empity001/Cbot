// Respuestas visuales breves para comandos de Discord.

import { EmbedBuilder } from 'discord.js';
import { getRenderPalette } from '../services/siteTheme.js';

function colorInt(value, fallback) {
  const parsed = Number.parseInt(String(value || '').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeDescription(value) {
  const text = String(value || '').trim() || 'Sin detalles adicionales.';
  return text.length <= 3900 ? text : `${text.slice(0, 3899)}…`;
}

export function buildSuccessEmbed(title, description) {
  const theme = getRenderPalette();
  return new EmbedBuilder()
    .setColor(colorInt(theme.confirmation, 0x35d98b))
    .setTitle(`✅ ${String(title || 'Operación completada').slice(0, 240)}`)
    .setDescription(safeDescription(description))
    .setTimestamp();
}

export function buildErrorEmbed(description) {
  const theme = getRenderPalette();
  return new EmbedBuilder()
    .setColor(colorInt(theme.danger, 0xef4444))
    .setTitle('❌ Error')
    .setDescription(safeDescription(description))
    .setTimestamp();
}
