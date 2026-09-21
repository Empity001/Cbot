import { supabase } from './supabase.js';
import { requestLogSyncById } from './logWatcher.js';
import { suppressDiscordDeletion } from './deletionSuppressor.js';
import { sendAdminAlert } from './adminAlerts.js';

const POLL_MS = 5_000;
const FULL_SWEEP_MS = 10 * 60 * 1_000;
const MISSING_DISCORD_CODES = new Set([10003, 10008]);

let workerTimer = null;
let runInFlight = null;
let lastLogVersion = null;
let lastFullSweepAt = 0;
let consecutiveFailures = 0;

function discordErrorCode(error) {
  const value = error?.code ?? error?.rawError?.code ?? error?.data?.code;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingDiscordResource(error) {
  return MISSING_DISCORD_CODES.has(discordErrorCode(error));
}

async function fetchChannelOrMissing(client, channelId) {
  if (!channelId) return null;
  try {
    return await client.channels.fetch(channelId);
  } catch (error) {
    if (isMissingDiscordResource(error)) return null;
    throw error;
  }
}

async function deleteThreadIfPresent(client, threadId) {
  if (!threadId) return;
  const thread = await fetchChannelOrMissing(client, threadId);
  if (!thread) return;
  suppressDiscordDeletion(threadId);
  try {
    await thread.delete();
  } catch (error) {
    if (!isMissingDiscordResource(error)) throw error;
  }
}

async function deleteSummaryIfPresent(client, channelId, messageId) {
  if (!channelId || !messageId) return;
  const channel = await fetchChannelOrMissing(client, channelId);
  if (!channel) return;
  if (!channel.messages?.fetch) {
    throw new Error(`El canal ${channelId} no permite buscar mensajes.`);
  }

  let message = null;
  try {
    message = await channel.messages.fetch(messageId);
  } catch (error) {
    if (isMissingDiscordResource(error)) return;
    throw error;
  }
  if (!message) return;

  suppressDiscordDeletion(messageId);
  try {
    await message.delete();
  } catch (error) {
    if (!isMissingDiscordResource(error)) throw error;
  }
}

async function deleteDiscordPublicationDurably(client, row) {
  await deleteThreadIfPresent(client, row.thread_id);
  await deleteSummaryIfPresent(client, row.channel_id, row.summary_message_id);
}

async function processDeletionQueue(client) {
  const { data: rows, error } = await supabase
    .from('discord_deletion_queue')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[LogDurability] No se pudo leer la cola: ${error.message}`);

  for (const row of rows || []) {
    try {
      await deleteDiscordPublicationDurably(client, row);

      const { error: publicationError } = await supabase
        .from('log_discord_publications')
        .delete()
        .eq('log_id', row.log_id);
      if (publicationError) throw new Error(`No se pudo limpiar el mapeo: ${publicationError.message}`);

      const { error: queueError } = await supabase
        .from('discord_deletion_queue')
        .delete()
        .eq('id', row.id);
      if (queueError) throw new Error(`No se pudo confirmar la cola: ${queueError.message}`);

      console.log(`[LogDurability] 🗑️ Eliminación confirmada para el Log ${row.log_id}.`);
    } catch (error) {
      console.error(`[LogDurability] La eliminación ${row.id} seguirá pendiente:`, error);
      void sendAdminAlert(client, {
        key: `log-deletion-pending:${row.id}`,
        title: 'Una publicación de Log no pudo eliminarse',
        description: 'La orden se conservará en la cola y el bot seguirá reintentándola automáticamente.',
        details: [
          { name: 'Log', value: String(row.log_id || 'desconocido') },
          { name: 'Error', value: String(error?.message || error).slice(0, 1000) },
        ],
      });
    }
  }
}

async function readLogVersion() {
  const { data, error } = await supabase
    .from('site_content_versions')
    .select('version')
    .eq('section', 'logs')
    .maybeSingle();
  if (error) throw new Error(`[LogDurability] No se pudo leer la versión de Logs: ${error.message}`);
  return data?.version == null ? null : String(data.version);
}

async function enqueueAllLogs(client) {
  const { data: logs, error } = await supabase
    .from('logs')
    .select('id')
    .order('created_at', { ascending: true });
  if (error) throw new Error(`[LogDurability] No se pudieron listar los Logs: ${error.message}`);

  for (const log of logs || []) {
    await requestLogSyncById(client, log.id, 0);
  }
  console.log(`[LogDurability] 🔄 Revisión solicitada para ${(logs || []).length} Log(s).`);
}

async function runDurabilityCycle(client) {
  await processDeletionQueue(client);

  const version = await readLogVersion();
  const now = Date.now();
  const versionChanged = lastLogVersion == null || version !== lastLogVersion;
  const periodicSweepDue = now - lastFullSweepAt >= FULL_SWEEP_MS;

  if (versionChanged || periodicSweepDue) {
    await enqueueAllLogs(client);
    lastLogVersion = version;
    lastFullSweepAt = now;
  }
}

function runCycle(client) {
  if (runInFlight) return runInFlight;
  runInFlight = runDurabilityCycle(client)
    .then(() => {
      consecutiveFailures = 0;
    })
    .catch(error => {
      consecutiveFailures += 1;
      console.error(`[LogDurability] Ciclo fallido (${consecutiveFailures}):`, error);
      if (consecutiveFailures >= 3) {
        void sendAdminAlert(client, {
          key: 'log-durability-worker-failing',
          title: 'El sistema durable de Logs está fallando',
          description: 'El worker seguirá intentando recuperarse cada cinco segundos.',
          details: [{ name: 'Último error', value: String(error?.message || error).slice(0, 1000) }],
        });
      }
    })
    .finally(() => {
      runInFlight = null;
    });
  return runInFlight;
}

export function startLogDurabilityWorker(client) {
  if (workerTimer) return workerTimer;
  console.log('[LogDurability] Worker durable iniciado; Realtime ya no es un punto único de fallo.');
  void runCycle(client);
  workerTimer = setInterval(() => void runCycle(client), POLL_MS);
  workerTimer.unref?.();
  return workerTimer;
}
