// Diagnóstico puntual. No mantiene sondeos adicionales: se ejecuta al iniciar
// y cuando un administrador abre Estado dentro de /config.

import { PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { supabase } from './supabase.js';
import { getGuildConfig, resolveAlertChannelId } from './botConfig.js';
import { sendAdminAlert } from './adminAlerts.js';

const DEADLINE_MS = 8_000;

function deadline(promise, label, ms = DEADLINE_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} superó ${ms} ms`)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

async function countQuery(query, label) {
  try {
    const response = await deadline(query, label);
    if (response.error) throw response.error;
    return { ok: true, count: Number(response.count || 0) };
  } catch (error) {
    return { ok: false, count: null, error: String(error?.message || error) };
  }
}

function channelCheck(channel, member, requiredPermissions) {
  if (!channel) return { ok: false, state: 'missing', missing: [] };
  const permissions = member ? channel.permissionsFor(member) : null;
  const missing = permissions ? permissions.missing(requiredPermissions) : ['No se pudo resolver al bot'];
  return { ok: missing.length === 0, state: missing.length ? 'permissions' : 'ok', missing };
}

export async function collectBotHealth(client) {
  const startedAt = Date.now();
  const health = {
    checkedAt: new Date(),
    overall: 'ok',
    discord: { ok: false, ping: Number(client.ws?.ping ?? -1), uptimeMs: Number(client.uptime || 0) },
    supabase: { ok: false, latencyMs: null, error: null },
    configuration: { ok: false, adminRole: null, logChannel: null, forumChannel: null, alertChannel: null },
    queue: {},
    publications: {},
    warnings: [],
    critical: [],
  };

  let guildConfig = null;
  const databaseStartedAt = Date.now();
  try {
    guildConfig = await deadline(getGuildConfig({ force: true }), 'Supabase');
    health.supabase = { ok: true, latencyMs: Date.now() - databaseStartedAt, error: null };
  } catch (error) {
    health.supabase = { ok: false, latencyMs: Date.now() - databaseStartedAt, error: String(error?.message || error) };
    health.critical.push(`Supabase: ${health.supabase.error}`);
  }

  let guild = null;
  let member = null;
  try {
    guild = await deadline(client.guilds.fetch(config.discord.guildId), 'Servidor de Discord');
    member = guild.members.me || await deadline(guild.members.fetchMe(), 'Miembro del bot');
    health.discord.ok = true;
  } catch (error) {
    health.discord.error = String(error?.message || error);
    health.critical.push(`Discord: ${health.discord.error}`);
  }

  if (guild && guildConfig) {
    const alertChannelId = resolveAlertChannelId(guildConfig);
    const [role, logChannel, forumChannel, alertChannel] = await Promise.all([
      guildConfig.admin_role_id ? guild.roles.fetch(guildConfig.admin_role_id).catch(() => null) : null,
      guildConfig.log_channel_id ? client.channels.fetch(guildConfig.log_channel_id).catch(() => null) : null,
      guildConfig.guides_forum_channel_id ? client.channels.fetch(guildConfig.guides_forum_channel_id).catch(() => null) : null,
      alertChannelId ? client.channels.fetch(alertChannelId).catch(() => null) : null,
    ]);

    health.configuration.adminRole = {
      configured: Boolean(guildConfig.admin_role_id),
      exists: Boolean(role),
      id: guildConfig.admin_role_id || null,
      name: role?.name || null,
    };

    const logPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.MentionEveryone,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
    ];
    const forumPermissions = [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.CreatePublicThreads,
      PermissionFlagsBits.SendMessagesInThreads,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ReadMessageHistory,
    ];

    health.configuration.logChannel = {
      configured: Boolean(guildConfig.log_channel_id),
      id: guildConfig.log_channel_id || null,
      name: logChannel?.name || null,
      ...channelCheck(logChannel, member, logPermissions),
    };
    health.configuration.forumChannel = {
      configured: Boolean(guildConfig.guides_forum_channel_id),
      id: guildConfig.guides_forum_channel_id || null,
      name: forumChannel?.name || null,
      ...channelCheck(forumChannel, member, forumPermissions),
    };
    health.configuration.alertChannel = alertChannelId ? {
      configured: true,
      id: alertChannelId,
      name: alertChannel?.name || null,
      ...channelCheck(alertChannel, member, [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages]),
    } : {
      configured: false,
      id: null,
      name: null,
      ok: true,
      state: 'owner-dm',
      missing: [],
    };

    if (!health.configuration.adminRole.configured) health.warnings.push('No hay rol administrativo configurado.');
    else if (!health.configuration.adminRole.exists) health.warnings.push('El rol administrativo configurado ya no existe.');
    if (!health.configuration.logChannel.configured) health.warnings.push('No hay canal de Logs configurado.');
    else if (!health.configuration.logChannel.ok) health.warnings.push(`Canal de Logs: ${health.configuration.logChannel.state === 'missing' ? 'no existe' : `faltan permisos (${health.configuration.logChannel.missing.join(', ')})`}.`);
    if (!health.configuration.forumChannel.configured) health.warnings.push('No hay foro de Guías configurado.');
    else if (!health.configuration.forumChannel.ok) health.warnings.push(`Foro de Guías: ${health.configuration.forumChannel.state === 'missing' ? 'no existe' : `faltan permisos (${health.configuration.forumChannel.missing.join(', ')})`}.`);
    if (health.configuration.alertChannel.configured && !health.configuration.alertChannel.ok) health.warnings.push(`Canal de alertas: ${health.configuration.alertChannel.state === 'missing' ? 'no existe; se usará el DM del dueño' : `faltan permisos (${health.configuration.alertChannel.missing.join(', ')}); se intentará usar el DM del dueño`}.`);
  } else if (health.supabase.ok) {
    health.warnings.push('No existe una fila de configuración para el servidor oficial.');
  }

  if (health.supabase.ok) {
    const counts = await Promise.all([
      countQuery(supabase.from('guide_forum_jobs').select('*', { count: 'exact', head: true }).eq('status', 'pending'), 'Cola pendiente'),
      countQuery(supabase.from('guide_forum_jobs').select('*', { count: 'exact', head: true }).eq('status', 'processing'), 'Cola en proceso'),
      countQuery(supabase.from('guide_forum_jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed').lt('attempts', config.worker.maxJobAttempts), 'Cola reintentable'),
      countQuery(supabase.from('guide_forum_jobs').select('*', { count: 'exact', head: true }).eq('status', 'failed').gte('attempts', config.worker.maxJobAttempts), 'Cola agotada'),
      countQuery(supabase.from('guide_forum_publications').select('*', { count: 'exact', head: true }).in('status', ['failed', 'lost', 'outdated']), 'Publicaciones de Guías'),
    ]);
    const [pending, processing, retryable, exhausted, guideIssues] = counts;
    health.queue = { pending, processing, retryable, exhausted };
    health.publications.guideIssues = guideIssues;
    const queryErrors = counts.filter(item => !item.ok);
    if (queryErrors.length) health.warnings.push('No se pudieron leer todos los contadores operativos.');
    if (exhausted.ok && exhausted.count > 0) health.warnings.push(`Hay ${exhausted.count} trabajo(s) de Guías sin más reintentos.`);
    if (guideIssues.ok && guideIssues.count > 0) health.warnings.push(`Hay ${guideIssues.count} publicación(es) de Guías que requieren revisión.`);
  }

  health.configuration.ok = health.warnings.length === 0 && health.critical.length === 0;
  health.overall = health.critical.length ? 'critical' : health.warnings.length ? 'warning' : 'ok';
  health.durationMs = Date.now() - startedAt;
  return health;
}

export async function runStartupDiagnostics(client) {
  const health = await collectBotHealth(client);
  const icon = health.overall === 'ok' ? '✅' : health.overall === 'warning' ? '⚠️' : '❌';
  console.log(`[Health] ${icon} Arranque: ${health.overall} · Discord ${health.discord.ping} ms · Supabase ${health.supabase.latencyMs ?? '?'} ms · diagnóstico ${health.durationMs} ms`);
  for (const message of [...health.critical, ...health.warnings]) console.warn(`[Health] ${message}`);

  if (health.overall !== 'ok') {
    await sendAdminAlert(client, {
      key: `startup-health-${health.overall}`,
      title: health.overall === 'critical' ? 'El bot arrancó con errores críticos' : 'El bot arrancó con advertencias',
      description: 'El bot está conectado, pero el diagnóstico encontró elementos que conviene revisar desde `/config` → Estado.',
      details: [
        { name: 'Críticos', value: health.critical.join('\n') || 'Ninguno' },
        { name: 'Advertencias', value: health.warnings.join('\n') || 'Ninguna' },
      ],
    });
  }
  return health;
}
