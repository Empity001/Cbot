import { PermissionFlagsBits } from 'discord.js';
import { createHash } from 'node:crypto';
import { supabase } from './supabase.js';
import { getGuildConfig } from './botConfig.js';
import { getPublication, upsertPublication, deletePublication } from './logPublication.js';
import { buildLogMessageSpecs } from '../utils/logMessages.js';
import { suppressDiscordDeletion } from './deletionSuppressor.js';
import { refreshRenderPalette } from './siteTheme.js';
import { sendAdminAlert } from './adminAlerts.js';

const syncStates = new Map();
const deletionLocks = new Set();
const configuredChannels = new Set();
let watcherChannel = null;

export function startLogWatcher(client) {
  if (watcherChannel) return watcherChannel;
  watcherChannel = supabase
    .channel('bot-log-watcher-v3')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'logs' }, payload => {
      enqueueLogSync(client, payload.new, 2200);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'logs' }, payload => {
      enqueueLogSync(client, payload.new, 1200);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'discord_deletion_queue' }, payload => {
      void processDeletionQueueRow(client, payload.new);
    })
    .subscribe(status => console.log('[LogWatcher] Estado:', status));

  void sweepPendingDeletions(client);
  return watcherChannel;
}

function enqueueLogSync(client, log, waitMs = 0) {
  if (!log?.id) return;
  const current = syncStates.get(log.id) || {
    running: false,
    dirty: false,
    log: null,
    waitMs: 0,
    failures: 0,
  };
  current.log = log;
  current.dirty = true;
  current.waitMs = Math.max(current.waitMs || 0, Number(waitMs) || 0);
  syncStates.set(log.id, current);
  if (!current.running) void runSyncLoop(client, log.id);
}


export async function requestLogSyncById(client, logId, waitMs = 0) {
  if (!logId) return false;
  const { data: log, error } = await supabase.from('logs').select('*').eq('id', logId).maybeSingle();
  if (error) throw new Error(`[LogWatcher] No se pudo cargar el Log ${logId}: ${error.message}`);
  if (!log) return false;
  enqueueLogSync(client, log, waitMs);
  return true;
}

async function runSyncLoop(client, logId) {
  const state = syncStates.get(logId);
  if (!state || state.running) return;
  state.running = true;
  try {
    while (state.dirty) {
      state.dirty = false;
      const log = state.log;
      if (state.waitMs > 0) {
        const waitMs = state.waitMs;
        state.waitMs = 0;
        await delay(waitMs);
      }
      try {
        await syncLogPublication(client, log);
        state.failures = 0;
      } catch (error) {
        state.failures = Number(state.failures || 0) + 1;
        if (state.failures <= 3) {
          state.dirty = true;
          state.waitMs = Math.max(state.waitMs || 0, 1000 * (2 ** (state.failures - 1)));
          console.warn(`[LogWatcher] Reintento ${state.failures}/3 para ${logId}:`, error.message || error);
        } else {
          console.error(`[LogWatcher] Error completo sincronizando ${logId} después de 3 reintentos:`, error);
          void sendAdminAlert(client, {
            key: `log-sync-exhausted:${logId}`,
            title: 'Un Log agotó sus reintentos',
            description: `No se pudo sincronizar “${log?.title || logId}” con Discord después de tres reintentos. El barrido de integridad volverá a revisarlo.`,
            details: [
              { name: 'Log', value: String(logId) },
              { name: 'Último error', value: String(error?.message || error).slice(0, 1000) },
            ],
          });
        }
      }
    }
  } finally {
    state.running = false;
    if (!state.dirty) syncStates.delete(logId);
  }
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function isArchiveDurationError(error) {
  return Number(error?.code) === 50035
    || /auto[_ -]?archive|archive duration/i.test(String(error?.message || ''));
}

async function startReadableLogThread(summary, name) {
  const durations = [...new Set([
    10080,
    Number(summary.channel?.defaultAutoArchiveDuration) || null,
    4320,
    1440,
    60,
  ].filter(Boolean))];
  let lastError = null;
  for (const duration of durations) {
    try {
      return await summary.startThread({ name, autoArchiveDuration: duration });
    } catch (error) {
      lastError = error;
      if (!isArchiveDurationError(error)) throw error;
      console.warn(`[LogWatcher] El archivado de ${duration} minutos no está disponible; probando otro valor.`);
    }
  }
  throw lastError || new Error('No se pudo crear el hilo del Log.');
}

async function loadLogData(log) {
  const [catRes, mobsRes, itemsRes] = await Promise.all([
    supabase.from('categories').select('*').eq('slug', log.category).maybeSingle(),
    supabase.from('log_mobs').select('*').eq('log_id', log.id).order('sort_order', { ascending: true }),
    supabase.from('log_items').select('*').eq('log_id', log.id).order('sort_order', { ascending: true }),
  ]);
  if (mobsRes.error) throw new Error(mobsRes.error.message);
  if (itemsRes.error) throw new Error(itemsRes.error.message);
  return { category: catRes.data || null, mobs: mobsRes.data || [], items: itemsRes.data || [] };
}

async function getLogChannel(client) {
  const cfg = await getGuildConfig();
  if (!cfg?.log_channel_id) {
    console.warn('[LogWatcher] No hay canal de Logs. Abre /config → Canales → Logs.');
    return null;
  }
  return client.channels.fetch(cfg.log_channel_id).catch(error => {
    console.warn(`[LogWatcher] No se pudo abrir ${cfg.log_channel_id}:`, error.message);
    return null;
  });
}

async function syncLogPublication(client, log) {
  const publication = await getPublication(log.id);
  if (log?.published === false) {
    if (publication) {
      await deleteDiscordPublication(client, publication);
      await deletePublication(log.id);
      console.log(`[LogWatcher] 📴 “${log.title}” está oculto; su publicación de Discord fue eliminada.`);
    }
    return;
  }

  const channel = await getLogChannel(client);
  if (!channel?.isTextBased?.()) return;
  await ensureLogChannelThreadPerms(channel);
  await refreshRenderPalette();
  const { category, mobs, items } = await loadLogData(log);
  const specs = await buildLogMessageSpecs(log, category, mobs, items);
  const contentHash = createHash('sha256').update(JSON.stringify({ log, category, mobs, items })).digest('hex');
  if (!publication) {
    await publishFresh(channel, log, specs, contentHash);
    return;
  }
  await syncExisting(client, channel, log, publication, specs, contentHash);
}

async function sendSpec(target, spec) {
  const payload = {
    embeds: spec.embeds || [],
    files: spec.files || [],
    allowedMentions: spec.allowedMentions || { parse: [] },
  };
  if (spec.flags != null) payload.flags = spec.flags;
  if (spec.content != null) payload.content = spec.content;
  return target.send(payload);
}

async function editSpec(message, spec) {
  return message.edit({
    content: spec.content ?? null,
    embeds: spec.embeds || [],
    files: spec.files || [],
    attachments: [],
    allowedMentions: spec.allowedMentions || { parse: [] },
  });
}

async function publishFresh(channel, log, specs, contentHash) {
  const summary = await sendSpec(channel, specs.summary);
  console.log(`[LogWatcher] ✅ Resumen creado para “${log.title}”: ${summary.id}`);
  let thread;
  try {
    thread = await startReadableLogThread(summary, String(log.title || 'Log').slice(0, 100));
  } catch (error) {
    suppressDiscordDeletion(summary.id);
    await summary.delete().catch(() => {});
    throw new Error(`No se pudo crear el hilo: ${error.message}`);
  }

  const messageMap = { summary: summary.id };
  for (const spec of specs.entries) {
    const message = await sendSpec(thread, spec);
    messageMap[spec.key] = message.id;
  }
  await upsertPublication({
    logId: log.id,
    channelId: channel.id,
    summaryMessageId: summary.id,
    threadId: thread.id,
    messageMap,
    messageOrder: specs.entries.map(spec => spec.key),
    contentHash,
  });
  console.log(`[LogWatcher] ✅ “${log.title}” publicado con ${specs.entries.length} mensajes internos.`);
}

function normalizeLegacyMap(publication, specs) {
  const map = publication?.message_map && typeof publication.message_map === 'object' && !Array.isArray(publication.message_map)
    ? { ...publication.message_map }
    : {};
  if (!map.summary && publication?.summary_message_id) map.summary = publication.summary_message_id;
  if (Object.keys(map).length <= 1 && Array.isArray(publication?.page_message_ids)) {
    publication.page_message_ids.forEach((id, index) => {
      if (specs.entries[index]) map[specs.entries[index].key] = id;
    });
  }
  return map;
}

async function syncExisting(client, channel, log, publication, specs, contentHash) {
  if (publication.channel_id && publication.channel_id !== channel.id) {
    await deleteDiscordPublication(client, publication);
    await deletePublication(log.id);
    await publishFresh(channel, log, specs, contentHash);
    return;
  }

  let summary;
  try {
    summary = await channel.messages.fetch(publication.summary_message_id);
  } catch {
    await deleteDiscordPublication(client, publication);
    await deletePublication(log.id);
    await publishFresh(channel, log, specs, contentHash);
    return;
  }
  await editSpec(summary, specs.summary);

  let thread = publication.thread_id ? await client.channels.fetch(publication.thread_id).catch(() => null) : null;
  if (!thread) {
    try {
      thread = await startReadableLogThread(summary, String(log.title || 'Log').slice(0, 100));
    } catch (error) {
      // Algunos estados de Discord conservan temporalmente la asociación del
      // mensaje con el hilo borrado e impiden crear otro sobre el mismo
      // resumen. En ese caso se reconstruye la publicación completa.
      console.warn(`[LogWatcher] No se pudo recrear el hilo sobre el resumen ${summary.id}; reconstruyendo el Log completo:`, error.message);
      await deleteDiscordPublication(client, publication);
      await deletePublication(log.id);
      await publishFresh(channel, log, specs, contentHash);
      return;
    }
  }
  if (thread.archived) await thread.setArchived(false).catch(() => {});
  if (thread.name !== String(log.title || 'Log').slice(0, 100)) await thread.setName(String(log.title || 'Log').slice(0, 100)).catch(() => {});

  const oldMap = normalizeLegacyMap(publication, specs);
  const desiredKeys = specs.entries.map(spec => spec.key);
  const existingKeys = Object.keys(oldMap).filter(key => key !== 'summary');
  const storedOrder = Array.isArray(publication.message_order) && publication.message_order.length
    ? publication.message_order.filter(key => oldMap[key])
    : existingKeys;
  const comparableDesired = desiredKeys.filter(key => oldMap[key]);
  const orderChanged = storedOrder.length > 0 && storedOrder.join('|') !== comparableDesired.join('|');
  const newMap = { summary: summary.id };

  if (orderChanged) {
    for (const key of existingKeys) {
      const id = oldMap[key];
      const msg = await thread.messages.fetch(id).catch(() => null);
      if (msg) suppressDiscordDeletion(msg.id);
      await msg?.delete().catch(() => {});
    }
    for (const spec of specs.entries) {
      const msg = await sendSpec(thread, spec);
      newMap[spec.key] = msg.id;
    }
  } else {
    for (const spec of specs.entries) {
      const existingId = oldMap[spec.key];
      let message = existingId ? await thread.messages.fetch(existingId).catch(() => null) : null;
      if (message) await editSpec(message, spec);
      else message = await sendSpec(thread, spec);
      newMap[spec.key] = message.id;
    }
    for (const [key, id] of Object.entries(oldMap)) {
      if (key === 'summary' || desiredKeys.includes(key)) continue;
      const message = await thread.messages.fetch(id).catch(() => null);
      if (message) suppressDiscordDeletion(message.id);
      await message?.delete().catch(() => {});
    }
  }

  await upsertPublication({
    logId: log.id,
    channelId: channel.id,
    summaryMessageId: summary.id,
    threadId: thread.id,
    messageMap: newMap,
    messageOrder: desiredKeys,
    contentHash,
  });
  console.log(`[LogWatcher] ✅ “${log.title}” sincronizado.`);
}

async function ensureLogChannelThreadPerms(channel) {
  if (configuredChannels.has(channel.id)) return;
  try {
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id, {
      [PermissionFlagsBits.ViewChannel]: true,
      [PermissionFlagsBits.ReadMessageHistory]: true,
      [PermissionFlagsBits.AddReactions]: true,
      [PermissionFlagsBits.SendMessagesInThreads]: false,
      [PermissionFlagsBits.CreatePublicThreads]: false,
      [PermissionFlagsBits.CreatePrivateThreads]: false,
    });
    const me = channel.guild.members.me || await channel.guild.members.fetchMe().catch(() => null);
    if (me) {
      await channel.permissionOverwrites.edit(me.id, {
        [PermissionFlagsBits.ViewChannel]: true,
        [PermissionFlagsBits.SendMessages]: true,
        [PermissionFlagsBits.SendMessagesInThreads]: true,
        [PermissionFlagsBits.CreatePublicThreads]: true,
        [PermissionFlagsBits.EmbedLinks]: true,
        [PermissionFlagsBits.AttachFiles]: true,
        [PermissionFlagsBits.ReadMessageHistory]: true,
        [PermissionFlagsBits.ManageThreads]: true,
        [PermissionFlagsBits.MentionEveryone]: true,
      });
    }
    configuredChannels.add(channel.id);
  } catch (error) {
    console.warn('[LogWatcher] No se pudieron fijar permisos de solo lectura:', error.message);
  }
}

async function deleteDiscordPublication(client, publication) {
  if (publication.thread_id) {
    suppressDiscordDeletion(publication.thread_id);
    const thread = await client.channels.fetch(publication.thread_id).catch(() => null);
    await thread?.delete().catch(() => {});
  }
  if (publication.channel_id && publication.summary_message_id) {
    suppressDiscordDeletion(publication.summary_message_id);
    const channel = await client.channels.fetch(publication.channel_id).catch(() => null);
    const message = await channel?.messages?.fetch(publication.summary_message_id).catch(() => null);
    await message?.delete().catch(() => {});
  }
}

async function processDeletionQueueRow(client, row) {
  if (!row?.id || deletionLocks.has(row.id)) return;
  deletionLocks.add(row.id);
  try {
    await deleteDiscordPublication(client, row);
    await deletePublication(row.log_id);
    await supabase.from('discord_deletion_queue').delete().eq('id', row.id);
  } catch (error) {
    console.error(`[LogWatcher] No se pudo procesar el borrado ${row.id}:`, error);
  } finally {
    deletionLocks.delete(row.id);
  }
}

async function sweepPendingDeletions(client) {
  const { data, error } = await supabase.from('discord_deletion_queue').select('*').order('created_at', { ascending: true });
  if (error) {
    console.warn('[LogWatcher] No se pudo revisar la cola:', error.message);
    return;
  }
  for (const row of data || []) await processDeletionQueueRow(client, row);
}
