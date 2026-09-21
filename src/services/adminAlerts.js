// Alertas operativas con deduplicación. Se intenta usar el canal opcional y,
// si no existe, se avisa por DM al propietario del servidor oficial.

import { config } from '../config.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { getGuildConfig, resolveAlertChannelId } from './botConfig.js';

const lastSentAt = new Map();

function canSendAgain(key) {
  const last = Number(lastSentAt.get(key) || 0);
  return Date.now() - last >= config.alerts.cooldownMs;
}

function alertEmbed(title, description, details = []) {
  const embed = buildErrorEmbed(description)
    .setTitle(`🚨 ${String(title || 'Alerta del bot').slice(0, 230)}`);
  const fields = (details || [])
    .filter(item => item?.name && item?.value)
    .slice(0, 8)
    .map(item => ({
      name: String(item.name).slice(0, 256),
      value: String(item.value).slice(0, 1024),
      inline: Boolean(item.inline),
    }));
  if (fields.length) embed.addFields(fields);
  return embed;
}

async function resolveAlertTarget(client) {
  const guildConfig = await getGuildConfig().catch(() => null);
  const alertChannelId = resolveAlertChannelId(guildConfig);
  if (alertChannelId) {
    const channel = await client.channels.fetch(alertChannelId).catch(() => null);
    if (channel?.isTextBased?.() && typeof channel.send === 'function') return channel;
    console.warn(`[Alerts] El canal de alertas no es utilizable: ${alertChannelId}`);
  }

  const guild = await client.guilds.fetch(config.discord.guildId).catch(() => null);
  if (!guild) return null;
  const owner = await guild.fetchOwner().catch(() => null);
  return owner || null;
}

export async function sendAdminAlert(client, {
  key,
  title,
  description,
  details = [],
  force = false,
} = {}) {
  const alertKey = String(key || title || 'generic');
  if (!force && !canSendAgain(alertKey)) return false;

  const target = await resolveAlertTarget(client);
  if (!target) {
    console.warn(`[Alerts] No se encontró un destino para la alerta “${alertKey}”.`);
    return false;
  }

  try {
    await target.send({
      embeds: [alertEmbed(title, description, details)],
      allowedMentions: { parse: [] },
    });
    lastSentAt.set(alertKey, Date.now());
    console.log(`[Alerts] Alerta enviada: ${alertKey}`);
    return true;
  } catch (error) {
    console.warn(`[Alerts] No se pudo enviar “${alertKey}”:`, error?.message || error);
    return false;
  }
}

export function clearAlertCooldown(key) {
  lastSentAt.delete(String(key || ''));
}
