import { EmbedBuilder } from 'discord.js';
import { getRenderPalette } from '../services/siteTheme.js';

export const DISCORD_LIMITS = Object.freeze({
  description: 3800,
  field: 1000,
  footer: 500,
  title: 250,
});

export function cleanText(value) {
  return String(value ?? '').trim();
}

export function truncateText(value, max = DISCORD_LIMITS.title) {
  const text = cleanText(value);
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

export function splitDiscordText(value, max = DISCORD_LIMITS.description) {
  let rest = cleanText(value);
  if (!rest) return [];

  const chunks = [];
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut < max * 0.55) cut = rest.lastIndexOf(' ', max);
    if (cut < max * 0.55) cut = max;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function discordColor(value, fallback = null) {
  const theme = getRenderPalette();
  if (Number.isInteger(value) && value >= 0 && value <= 0xffffff) return value;
  const parsed = Number.parseInt(String(value || fallback || theme.primary).replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x8b3dff;
}

export function makeBrandedEmbed({
  color,
  title,
  description,
  url,
  footer = 'Culones RPG',
  timestamp = null,
} = {}) {
  const embed = new EmbedBuilder()
    .setColor(discordColor(color))
    .setTitle(truncateText(title || 'Culones RPG'))
    .setDescription(cleanText(description) || '_Sin información._')
    .setFooter({ text: truncateText(footer, DISCORD_LIMITS.footer) });

  if (url) embed.setURL(url);
  if (timestamp) embed.setTimestamp(timestamp);
  return embed;
}

export function compactFacts(facts = []) {
  return facts
    .filter(fact => cleanText(fact?.value))
    .map(fact => `**${cleanText(fact.label)}**\n${truncateText(fact.value, DISCORD_LIMITS.field)}`);
}
