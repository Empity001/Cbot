// Operaciones administrativas reutilizables por el panel de /config.

import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { config } from '../config.js';
import { recordDiscordAudit } from './audit.js';
import { getGuildConfig, updateGuildConfig } from './botConfig.js';
import { supabase } from './supabase.js';

export class ConfigurationActionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigurationActionError';
  }
}

function actorName(interaction) {
  return interaction.member?.displayName || interaction.user?.username || 'Administrador';
}

async function botMember(interaction) {
  return interaction.guild.members.me || interaction.guild.members.fetchMe();
}

function hasAll(channel, member, permissions) {
  const available = channel.permissionsFor(member);
  return permissions.every(permission => available?.has(permission));
}

const LOG_PERMISSIONS = [
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

const GUIDE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageRoles,
];

export async function setLogChannel(interaction, channel) {
  if (channel?.type !== ChannelType.GuildText) throw new ConfigurationActionError('Selecciona un canal de texto normal para los Logs.');
  const member = await botMember(interaction);
  if (!hasAll(channel, member, LOG_PERMISSIONS)) {
    throw new ConfigurationActionError('Al bot le faltan permisos en ese canal: ver, enviar, insertar enlaces, adjuntar, crear/gestionar hilos, mencionar @everyone y gestionar canal/roles.');
  }

  const previous = await getGuildConfig();
  await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
    [PermissionFlagsBits.ViewChannel]: true,
    [PermissionFlagsBits.ReadMessageHistory]: true,
    [PermissionFlagsBits.AddReactions]: true,
    [PermissionFlagsBits.SendMessagesInThreads]: false,
    [PermissionFlagsBits.CreatePublicThreads]: false,
    [PermissionFlagsBits.CreatePrivateThreads]: false,
  }, { reason: `Canal de Logs configurado por ${interaction.user.tag}` });
  await channel.permissionOverwrites.edit(member.id, {
    [PermissionFlagsBits.ViewChannel]: true,
    [PermissionFlagsBits.SendMessages]: true,
    [PermissionFlagsBits.SendMessagesInThreads]: true,
    [PermissionFlagsBits.CreatePublicThreads]: true,
    [PermissionFlagsBits.EmbedLinks]: true,
    [PermissionFlagsBits.AttachFiles]: true,
    [PermissionFlagsBits.ReadMessageHistory]: true,
    [PermissionFlagsBits.ManageThreads]: true,
    [PermissionFlagsBits.MentionEveryone]: true,
  }, { reason: 'Permisos del bot para publicar y mantener los Logs' });
  await updateGuildConfig({ log_channel_id: channel.id, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: 'log_channel_changed',
    description: `${actorName(interaction)} configuró #${channel.name} como canal oficial de Logs.`,
    entityType: 'discord_log_channel', entityId: channel.id, entityName: channel.name,
    oldValue: { channel_id: previous?.log_channel_id || null }, newValue: { channel_id: channel.id, channel_name: channel.name },
  });
  return channel;
}

export async function setGuidesForum(interaction, channel) {
  if (channel?.type !== ChannelType.GuildForum) throw new ConfigurationActionError('Selecciona un canal de tipo Foro para las Guías.');
  const member = await botMember(interaction);
  if (!hasAll(channel, member, GUIDE_PERMISSIONS)) {
    throw new ConfigurationActionError('Al bot le faltan permisos en ese foro: ver, enviar, adjuntar, gestionar canal/roles, mensajes e hilos, además de añadir reacciones.');
  }

  const previous = await getGuildConfig();
  await channel.permissionOverwrites.edit(interaction.guild.roles.everyone.id, {
    [PermissionFlagsBits.ViewChannel]: true,
    [PermissionFlagsBits.ReadMessageHistory]: true,
    [PermissionFlagsBits.AddReactions]: false,
    [PermissionFlagsBits.SendMessages]: false,
    [PermissionFlagsBits.SendMessagesInThreads]: false,
    [PermissionFlagsBits.CreatePublicThreads]: false,
    [PermissionFlagsBits.CreatePrivateThreads]: false,
  }, { reason: `Foro de Guías configurado por ${interaction.user.tag}` });
  await channel.permissionOverwrites.edit(member.id, {
    [PermissionFlagsBits.ViewChannel]: true,
    [PermissionFlagsBits.SendMessages]: true,
    [PermissionFlagsBits.SendMessagesInThreads]: true,
    [PermissionFlagsBits.CreatePublicThreads]: true,
    [PermissionFlagsBits.EmbedLinks]: true,
    [PermissionFlagsBits.AttachFiles]: true,
    [PermissionFlagsBits.ReadMessageHistory]: true,
    [PermissionFlagsBits.ManageThreads]: true,
    [PermissionFlagsBits.ManageMessages]: true,
    [PermissionFlagsBits.AddReactions]: true,
  }, { reason: 'Permisos del bot para publicar y mantener las Guías' });
  await updateGuildConfig({ guides_forum_channel_id: channel.id, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: 'guides_forum_changed',
    description: `${actorName(interaction)} configuró #${channel.name} como foro oficial de Guías.`,
    entityType: 'discord_guides_forum', entityId: channel.id, entityName: channel.name,
    oldValue: { channel_id: previous?.guides_forum_channel_id || null }, newValue: { channel_id: channel.id, channel_name: channel.name },
  });
  return channel;
}

export async function setAlertChannel(interaction, channel) {
  if (channel?.type !== ChannelType.GuildText) throw new ConfigurationActionError('Selecciona un canal de texto privado para las alertas.');
  const member = await botMember(interaction);
  const required = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!hasAll(channel, member, required)) throw new ConfigurationActionError('El bot necesita Ver canal, Enviar mensajes e Insertar enlaces en el canal de alertas.');
  const previous = await getGuildConfig();
  await updateGuildConfig({ alert_channel_id: channel.id, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: 'alert_channel_changed',
    description: `${actorName(interaction)} configuró #${channel.name} como canal privado de alertas del bot.`,
    entityType: 'discord_alert_channel', entityId: channel.id, entityName: channel.name,
    oldValue: { channel_id: previous?.alert_channel_id || null }, newValue: { channel_id: channel.id, channel_name: channel.name },
  });
  return channel;
}

export async function clearChannelSetting(interaction, kind) {
  const fields = { logs: 'log_channel_id', guides: 'guides_forum_channel_id', alerts: 'alert_channel_id' };
  const field = fields[kind];
  if (!field) throw new ConfigurationActionError('Configuración de canal desconocida.');
  const previous = await getGuildConfig();
  const oldId = previous?.[field] || null;
  await updateGuildConfig({ [field]: null, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: `${kind}_channel_cleared`,
    description: `${actorName(interaction)} quitó la configuración del canal de ${kind === 'logs' ? 'Logs' : kind === 'guides' ? 'Guías' : 'alertas'}.`,
    entityType: `discord_${kind}_channel`, entityId: oldId,
    oldValue: { channel_id: oldId }, newValue: { channel_id: null },
  });
  return oldId;
}

export async function setAdminRole(interaction, role) {
  if (!role) throw new ConfigurationActionError('Selecciona un rol.');
  if (role.id === interaction.guild.roles.everyone.id) throw new ConfigurationActionError('No puedes usar @everyone como rol administrativo.');
  if (role.managed) throw new ConfigurationActionError('No puedes usar un rol administrado por un bot o una integración.');
  const previous = await getGuildConfig();
  await updateGuildConfig({ admin_role_id: role.id, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: 'admin_role_changed',
    description: `${actorName(interaction)} configuró @${role.name} como rol administrativo de la web.`,
    entityType: 'discord_admin_role', entityId: role.id, entityName: role.name,
    oldValue: { role_id: previous?.admin_role_id || null }, newValue: { role_id: role.id, role_name: role.name },
  });
  return role;
}

export async function clearAdminRole(interaction) {
  const previous = await getGuildConfig();
  await updateGuildConfig({ admin_role_id: null, updated_by: interaction.user.id });
  await recordDiscordAudit(interaction, {
    action: 'admin_role_cleared',
    description: `${actorName(interaction)} eliminó el rol administrativo configurado.`,
    entityType: 'discord_admin_role', entityId: previous?.admin_role_id || null,
    oldValue: { role_id: previous?.admin_role_id || null }, newValue: { role_id: null },
  });
  return previous?.admin_role_id || null;
}

export async function retryExhaustedGuideJobs(interaction) {
  const { data, error } = await supabase
    .from('guide_forum_jobs')
    .update({ status: 'pending', attempts: 0, started_at: null, completed_at: null, error_code: null, error_message: null })
    .eq('status', 'failed')
    .gte('attempts', config.worker.maxJobAttempts)
    .select('id');
  if (error) throw new ConfigurationActionError(`No se pudo reiniciar la cola: ${error.message}`);
  const count = data?.length || 0;
  await recordDiscordAudit(interaction, {
    action: 'guide_jobs_retried',
    description: `${actorName(interaction)} devolvió ${count} trabajo(s) agotado(s) de Guías a la cola.`,
    entityType: 'guide_forum_queue', metadata: { retried_jobs: count },
  });
  return count;
}
