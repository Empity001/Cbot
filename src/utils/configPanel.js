// Panel interactivo y privado de /config. Mantiene la configuración agrupada
// en un solo comando sin convertir cada ajuste en otro subcomando.

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
} from 'discord.js';
import { recordDiscordAudit } from '../services/audit.js';
import { collectBotHealth } from '../services/botHealth.js';
import { getGuildConfig, resolveAlertChannelId } from '../services/botConfig.js';
import {
  ConfigurationActionError,
  clearAdminRole,
  clearChannelSetting,
  retryExhaustedGuideJobs,
  setAdminRole,
  setAlertChannel,
  setGuidesForum,
  setLogChannel,
} from '../services/discordConfiguration.js';
import { isPublicationIntegritySweepRunning, sweepPublicationIntegrity } from '../services/publicationRecovery.js';
import { getRenderPalette } from '../services/siteTheme.js';
import { buildErrorEmbed } from './embeds.js';
import { requireOwnerOrAdministrator } from './permissions.js';

const IDS = Object.freeze({
  main: 'config:nav:main',
  channels: 'config:nav:channels',
  access: 'config:nav:access',
  health: 'config:nav:health',
  recovery: 'config:nav:recovery',
  channelLogs: 'config:nav:channel:logs',
  channelGuides: 'config:nav:channel:guides',
  channelAlerts: 'config:nav:channel:alerts',
  setLogs: 'config:set-channel:logs',
  setGuides: 'config:set-channel:guides',
  setAlerts: 'config:set-channel:alerts',
  clearLogs: 'config:clear-channel:logs',
  clearGuides: 'config:clear-channel:guides',
  clearAlerts: 'config:clear-channel:alerts',
  setRole: 'config:set-role',
  askClearRole: 'config:access:ask-clear',
  confirmClearRole: 'config:access:confirm-clear',
  refreshHealth: 'config:health:refresh',
  runSweep: 'config:recovery:sweep',
  askRetry: 'config:recovery:ask-retry',
  confirmRetry: 'config:recovery:confirm-retry',
});

function colorInt(value, fallback = 0x8b3dff) {
  const parsed = Number.parseInt(String(value || '').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function primaryColor() {
  return colorInt(getRenderPalette().primary);
}

function button(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const component = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) component.setEmoji(emoji);
  return component;
}

function backRow(customId = IDS.main) {
  return new ActionRowBuilder().addComponents(button(customId, 'Volver', ButtonStyle.Secondary, '↩️'));
}

function mentionChannel(id, fallback = 'Sin configurar') {
  return id ? `<#${id}>` : fallback;
}

function mentionRole(id) {
  return id ? `<@&${id}>` : 'Sin configurar';
}

function panelEmbed(title, description, fields = []) {
  const embed = new EmbedBuilder()
    .setColor(primaryColor())
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: 'Panel privado · solo modifica lo que confirmes' });
  if (fields.length) embed.addFields(fields);
  return embed;
}

function noticeText(notice) {
  if (!notice?.message) return '';
  return `\n\n${notice.ok === false ? '❌' : '✅'} **${notice.message}**`;
}

export async function renderConfigMain(_interaction, notice = null) {
  const current = await getGuildConfig();
  const alertChannelId = resolveAlertChannelId(current);
  const description = [
    'Administra el bot y sus conexiones desde un solo lugar. Cada sección abre sus propios controles; nada se guarda por visitar una pantalla.',
    noticeText(notice),
  ].join('');
  const embed = panelEmbed('⚙️ Configuración', description, [
    {
      name: 'Canales',
      value: `Logs: ${mentionChannel(current?.log_channel_id)}\nGuías: ${mentionChannel(current?.guides_forum_channel_id)}\nAlertas: ${mentionChannel(alertChannelId, 'DM del propietario')}`,
      inline: true,
    },
    {
      name: 'Acceso',
      value: `Rol de la web: ${mentionRole(current?.admin_role_id)}\nPanel: propietario o permiso Administrador`,
      inline: true,
    },
  ]);
  const navigation = new ActionRowBuilder().addComponents(
    button(IDS.channels, 'Canales', ButtonStyle.Primary, '📡'),
    button(IDS.access, 'Acceso', ButtonStyle.Secondary, '🔐'),
    button(IDS.health, 'Estado', ButtonStyle.Secondary, '🩺'),
    button(IDS.recovery, 'Recuperación', ButtonStyle.Secondary, '🛠️'),
  );
  return { embeds: [embed], components: [navigation] };
}

async function renderChannels(notice = null) {
  const current = await getGuildConfig();
  const alertChannelId = resolveAlertChannelId(current);
  const embed = panelEmbed(
    '📡 Canales',
    `Elige qué conexión quieres revisar o cambiar.${noticeText(notice)}`,
    [
      { name: 'Logs', value: mentionChannel(current?.log_channel_id), inline: true },
      { name: 'Guías', value: mentionChannel(current?.guides_forum_channel_id), inline: true },
      { name: 'Alertas', value: mentionChannel(alertChannelId, 'DM del propietario'), inline: true },
    ],
  );
  const choices = new ActionRowBuilder().addComponents(
    button(IDS.channelLogs, 'Logs', ButtonStyle.Secondary, '📘'),
    button(IDS.channelGuides, 'Guías', ButtonStyle.Secondary, '🧭'),
    button(IDS.channelAlerts, 'Alertas', ButtonStyle.Secondary, '🚨'),
    button(IDS.main, 'Inicio', ButtonStyle.Secondary, '↩️'),
  );
  return { embeds: [embed], components: [choices] };
}

const CHANNEL_DETAILS = Object.freeze({
  logs: {
    title: '📘 Canal de Logs',
    description: 'Aquí se publican y mantienen los registros visibles en Discord.',
    field: 'log_channel_id',
    selectId: IDS.setLogs,
    clearId: IDS.clearLogs,
    placeholder: 'Selecciona el canal de Logs',
    types: [ChannelType.GuildText],
  },
  guides: {
    title: '🧭 Foro de Guías',
    description: 'Aquí se crean y actualizan las publicaciones procedentes de la Guía web.',
    field: 'guides_forum_channel_id',
    selectId: IDS.setGuides,
    clearId: IDS.clearGuides,
    placeholder: 'Selecciona el foro de Guías',
    types: [ChannelType.GuildForum],
  },
  alerts: {
    title: '🚨 Canal de alertas',
    description: 'Recibe fallos operativos importantes. Sin canal configurado, el bot intenta avisar por DM al propietario.',
    field: 'alert_channel_id',
    selectId: IDS.setAlerts,
    clearId: IDS.clearAlerts,
    placeholder: 'Selecciona un canal privado de alertas',
    types: [ChannelType.GuildText],
  },
});

async function renderChannelDetail(kind, notice = null) {
  const detail = CHANNEL_DETAILS[kind];
  const current = await getGuildConfig();
  const configuredId = kind === 'alerts' ? resolveAlertChannelId(current) : current?.[detail.field];
  const fallback = kind === 'alerts' ? 'DM del propietario' : 'Sin configurar';
  const embed = panelEmbed(
    detail.title,
    `${detail.description}${noticeText(notice)}`,
    [{ name: 'Destino actual', value: mentionChannel(configuredId, fallback) }],
  );
  const selector = new ChannelSelectMenuBuilder()
    .setCustomId(detail.selectId)
    .setPlaceholder(detail.placeholder)
    .setChannelTypes(...detail.types)
    .setMinValues(1)
    .setMaxValues(1);
  const selectorRow = new ActionRowBuilder().addComponents(selector);
  const actions = new ActionRowBuilder().addComponents(
    button(detail.clearId, 'Quitar configuración', ButtonStyle.Danger, '🗑️'),
    button(IDS.channels, 'Volver a Canales', ButtonStyle.Secondary, '↩️'),
  );
  return { embeds: [embed], components: [selectorRow, actions] };
}

async function renderAccess(notice = null) {
  const current = await getGuildConfig();
  const embed = panelEmbed(
    '🔐 Acceso administrativo',
    `Este rol permite administrar la **página web**. El panel del bot sigue reservado al propietario o a miembros con permiso Administrador.${noticeText(notice)}`,
    [{ name: 'Rol actual', value: mentionRole(current?.admin_role_id) }],
  );
  const selector = new RoleSelectMenuBuilder()
    .setCustomId(IDS.setRole)
    .setPlaceholder('Selecciona el rol administrativo de la web')
    .setMinValues(1)
    .setMaxValues(1);
  const actions = new ActionRowBuilder().addComponents(
    button(IDS.askClearRole, 'Quitar rol', ButtonStyle.Danger, '🗑️'),
    button(IDS.main, 'Inicio', ButtonStyle.Secondary, '↩️'),
  );
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(selector), actions] };
}

async function renderClearRoleConfirmation() {
  const current = await getGuildConfig();
  const embed = panelEmbed(
    '⚠️ Quitar rol administrativo',
    `Vas a quitar ${mentionRole(current?.admin_role_id)}. La web quedará sin ese acceso por rol hasta que configures otro.`,
  );
  const actions = new ActionRowBuilder().addComponents(
    button(IDS.confirmClearRole, 'Sí, quitar rol', ButtonStyle.Danger),
    button(IDS.access, 'Cancelar', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [actions] };
}

function statusIcon(ok) { return ok ? '✅' : '❌'; }
function healthCount(item) { return item?.ok ? String(item.count) : '?'; }
function uptime(ms) {
  const totalMinutes = Math.floor(Number(ms || 0) / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

async function renderHealth(client) {
  const health = await collectBotHealth(client);
  const theme = getRenderPalette();
  const color = health.overall === 'ok'
    ? colorInt(theme.confirmation, 0x35d98b)
    : health.overall === 'warning'
      ? colorInt(theme.warning, 0xf5c542)
      : colorInt(theme.danger, 0xef4444);
  const labels = { ok: 'Operativo', warning: 'Requiere atención', critical: 'Error crítico' };
  const notices = [...health.critical, ...health.warnings];
  const admin = health.configuration.adminRole;
  const logs = health.configuration.logChannel;
  const forum = health.configuration.forumChannel;
  const alerts = health.configuration.alertChannel;
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`${health.overall === 'ok' ? '✅' : health.overall === 'warning' ? '⚠️' : '❌'} Estado · ${labels[health.overall]}`)
    .setDescription(notices.length ? notices.map(item => `• ${item}`).join('\n').slice(0, 3900) : 'No se detectaron problemas operativos.')
    .addFields(
      {
        name: 'Servicios',
        value: `${statusIcon(health.discord.ok)} Discord · ${health.discord.ping} ms\n${statusIcon(health.supabase.ok)} Supabase · ${health.supabase.latencyMs ?? '?'} ms\n⏱️ Activo · ${uptime(health.discord.uptimeMs)}`,
        inline: true,
      },
      {
        name: 'Configuración',
        value: `${statusIcon(Boolean(admin?.configured && admin?.exists))} Rol · ${admin?.name || 'sin configurar'}\n${statusIcon(Boolean(logs?.ok))} Logs · ${logs?.name ? `#${logs.name}` : 'sin configurar'}\n${statusIcon(Boolean(forum?.ok))} Guías · ${forum?.name ? `#${forum.name}` : 'sin configurar'}\n${statusIcon(Boolean(alerts?.ok))} Alertas · ${alerts?.name ? `#${alerts.name}` : 'DM del dueño'}`,
        inline: true,
      },
      {
        name: 'Cola y publicaciones',
        value: `Pendientes: **${healthCount(health.queue.pending)}** · Procesando: **${healthCount(health.queue.processing)}**\nCon reintentos: **${healthCount(health.queue.retryable)}** · Agotados: **${healthCount(health.queue.exhausted)}**\nGuías con incidencias: **${healthCount(health.publications.guideIssues)}**`,
      },
    )
    .setFooter({ text: `Diagnóstico puntual · ${health.durationMs} ms · no crea sondeos adicionales` })
    .setTimestamp(health.checkedAt);
  const actions = new ActionRowBuilder().addComponents(
    button(IDS.refreshHealth, 'Actualizar', ButtonStyle.Primary, '🔄'),
    button(IDS.main, 'Inicio', ButtonStyle.Secondary, '↩️'),
  );
  return { embeds: [embed], components: [actions] };
}

function renderRecovery(notice = null) {
  const embed = panelEmbed(
    '🛠️ Recuperación',
    `Las comprobaciones manuales son puntuales: no crean tareas recurrentes nuevas.${noticeText(notice)}`,
    [
      { name: 'Comprobar publicaciones', value: 'Busca mensajes o hilos perdidos y solicita la reparación de Logs dañados.' },
      { name: 'Reintentar cola agotada', value: 'Devuelve a pendientes los trabajos de Guías que consumieron todos sus intentos.' },
    ],
  );
  const actions = new ActionRowBuilder().addComponents(
    button(IDS.runSweep, 'Comprobar publicaciones', ButtonStyle.Primary, '🔎'),
    button(IDS.askRetry, 'Reintentar cola agotada', ButtonStyle.Danger, '♻️'),
    button(IDS.main, 'Inicio', ButtonStyle.Secondary, '↩️'),
  );
  return { embeds: [embed], components: [actions] };
}

function renderRetryConfirmation() {
  const embed = panelEmbed(
    '⚠️ Reintentar trabajos agotados',
    'Los trabajos fallidos volverán a estado pendiente y el worker intentará publicarlos otra vez. Úsalo después de corregir la causa del fallo.',
  );
  const actions = new ActionRowBuilder().addComponents(
    button(IDS.confirmRetry, 'Sí, reintentar', ButtonStyle.Danger),
    button(IDS.recovery, 'Cancelar', ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [actions] };
}

async function selectedChannel(interaction) {
  return interaction.channels?.first?.() || interaction.guild.channels.fetch(interaction.values?.[0]).catch(() => null);
}

async function selectedRole(interaction) {
  return interaction.roles?.first?.() || interaction.guild.roles.fetch(interaction.values?.[0]).catch(() => null);
}

function readableError(error) {
  const message = String(error?.message || error || 'No se pudo completar la acción.');
  if (/alert_channel_id|schema cache/i.test(message)) {
    return 'Falta aplicar `sql/migration_023_bot_config_panel.sql` en Supabase antes de configurar el canal de alertas.';
  }
  return error instanceof ConfigurationActionError ? message : 'No se pudo completar la acción. Revisa los permisos del bot y vuelve a intentarlo.';
}

async function editWithError(interaction, error) {
  console.error(`[ConfigPanel] ${interaction.customId}:`, error);
  await interaction.editReply({
    embeds: [buildErrorEmbed(readableError(error))],
    components: [backRow()],
  });
}

export async function handleConfigComponent(interaction) {
  if (!interaction.customId?.startsWith('config:')) return false;
  if (!(await requireOwnerOrAdministrator(interaction, buildErrorEmbed))) return true;
  await interaction.deferUpdate();

  try {
    switch (interaction.customId) {
      case IDS.main: await interaction.editReply(await renderConfigMain(interaction)); break;
      case IDS.channels: await interaction.editReply(await renderChannels()); break;
      case IDS.access: await interaction.editReply(await renderAccess()); break;
      case IDS.health:
      case IDS.refreshHealth: await interaction.editReply(await renderHealth(interaction.client)); break;
      case IDS.recovery: await interaction.editReply(renderRecovery()); break;
      case IDS.channelLogs: await interaction.editReply(await renderChannelDetail('logs')); break;
      case IDS.channelGuides: await interaction.editReply(await renderChannelDetail('guides')); break;
      case IDS.channelAlerts: await interaction.editReply(await renderChannelDetail('alerts')); break;
      case IDS.setLogs: {
        const channel = await selectedChannel(interaction);
        await setLogChannel(interaction, channel);
        await interaction.editReply(await renderChannelDetail('logs', { message: `Canal cambiado a #${channel.name}.` }));
        break;
      }
      case IDS.setGuides: {
        const channel = await selectedChannel(interaction);
        await setGuidesForum(interaction, channel);
        await interaction.editReply(await renderChannelDetail('guides', { message: `Foro cambiado a #${channel.name}.` }));
        break;
      }
      case IDS.setAlerts: {
        const channel = await selectedChannel(interaction);
        await setAlertChannel(interaction, channel);
        await interaction.editReply(await renderChannelDetail('alerts', { message: `Alertas enviadas a #${channel.name}.` }));
        break;
      }
      case IDS.clearLogs:
        await clearChannelSetting(interaction, 'logs');
        await interaction.editReply(await renderChannelDetail('logs', { message: 'Canal de Logs retirado.' }));
        break;
      case IDS.clearGuides:
        await clearChannelSetting(interaction, 'guides');
        await interaction.editReply(await renderChannelDetail('guides', { message: 'Foro de Guías retirado.' }));
        break;
      case IDS.clearAlerts:
        await clearChannelSetting(interaction, 'alerts');
        await interaction.editReply(await renderChannelDetail('alerts', { message: 'Se usarán los DM del propietario para las alertas.' }));
        break;
      case IDS.setRole: {
        const role = await selectedRole(interaction);
        await setAdminRole(interaction, role);
        await interaction.editReply(await renderAccess({ message: `Rol cambiado a @${role.name}.` }));
        break;
      }
      case IDS.askClearRole: await interaction.editReply(await renderClearRoleConfirmation()); break;
      case IDS.confirmClearRole:
        await clearAdminRole(interaction);
        await interaction.editReply(await renderAccess({ message: 'Rol administrativo retirado.' }));
        break;
      case IDS.askRetry: await interaction.editReply(renderRetryConfirmation()); break;
      case IDS.confirmRetry: {
        const count = await retryExhaustedGuideJobs(interaction);
        await interaction.editReply(renderRecovery({ message: `${count} trabajo(s) devuelto(s) a la cola.` }));
        break;
      }
      case IDS.runSweep: {
        const joinedExistingSweep = isPublicationIntegritySweepRunning();
        await sweepPublicationIntegrity(interaction.client);
        if (!joinedExistingSweep) {
          await recordDiscordAudit(interaction, {
            action: 'publication_integrity_sweep',
            description: `${interaction.member?.displayName || interaction.user.username} ejecutó una comprobación manual de publicaciones.`,
            entityType: 'discord_publications',
          });
        }
        const message = joinedExistingSweep
          ? 'La comprobación que ya estaba en curso terminó correctamente.'
          : 'Comprobación terminada; las reparaciones necesarias quedaron solicitadas.';
        await interaction.editReply(renderRecovery({ message }));
        break;
      }
      default:
        await interaction.editReply(await renderConfigMain(interaction, { ok: false, message: 'Esta pantalla ya no existe; volviste al inicio.' }));
    }
  } catch (error) {
    await editWithError(interaction, error);
  }
  return true;
}
