// src/services/audit.js
// Bitácora descriptiva de acciones ejecutadas desde comandos de Discord.

import { supabase } from './supabase.js';

function text(value, max = 1200) {
  return String(value ?? '').trim().slice(0, max);
}

export async function recordDiscordAudit(interaction, {
  action,
  description,
  entityType = 'discord_config',
  entityId = null,
  entityName = null,
  oldValue = null,
  newValue = null,
  metadata = {},
  success = true,
} = {}) {
  const memberName = interaction?.member?.displayName;
  const username = interaction?.user?.globalName || interaction?.user?.username || 'Usuario de Discord';
  const actor = text(memberName || username, 200);
  const row = {
    actor,
    action: text(action || 'discord_config_updated', 80),
    description: text(description || `${actor} actualizó la configuración de Discord.`),
    discord_user_id: interaction?.user?.id || null,
    actor_avatar_url: interaction?.user?.displayAvatarURL?.({ extension: 'png', size: 128 }) || null,
    entity_type: text(entityType, 80) || null,
    entity_id: text(entityId, 160) || null,
    entity_name: text(entityName, 200) || null,
    old_value: oldValue,
    new_value: newValue,
    metadata: {
      source: 'discord-command',
      guild_id: interaction?.guildId || null,
      channel_id: interaction?.channelId || null,
      ...metadata,
    },
    success: success !== false,
  };
  const { error } = await supabase.from('action_log').insert(row);
  if (error) console.warn('[Audit] No se pudo registrar la acción:', error.message);
}

export async function recordGuideForumWorkerAudit(job, {
  action,
  description,
  entityId = null,
  entityName = null,
  metadata = {},
  success = true,
} = {}) {
  const payload = job?.payload && typeof job.payload === 'object' ? job.payload : {};
  const actor = text(payload.requested_actor_name || job?.requested_discord_user_id || 'Administrador de Discord', 200);
  const row = {
    actor,
    action: text(action || `guide_forum_${job?.action || 'sync'}`, 80),
    description: text(description || `${actor} procesó una publicación del foro de Guías.`),
    auth_user_id: job?.requested_by || null,
    discord_user_id: job?.requested_discord_user_id || null,
    actor_avatar_url: payload.requested_actor_avatar_url || null,
    entity_type: 'guide',
    entity_id: text(entityId || job?.guide_id, 160) || null,
    entity_name: text(entityName || payload.guide_name, 200) || null,
    metadata: {
      source: 'discord-worker',
      job_id: job?.id || null,
      forum_action: job?.action || null,
      ...metadata,
    },
    success: success !== false,
  };
  const { error } = await supabase.from('action_log').insert(row);
  if (error) console.warn('[Audit] No se pudo registrar el resultado del worker:', error.message);
}
