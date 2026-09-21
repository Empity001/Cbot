// Recuperación de publicaciones cuando alguien borra manualmente un mensaje
// o hilo de Discord. Los Logs se reconstruyen automáticamente; las Guías se
// marcan como perdidas/desactualizadas para respetar su actualización manual.

import { supabase } from './supabase.js';
import { requestLogSyncById } from './logWatcher.js';

let integritySweepInFlight = null;

function mapContainsId(map, messageId) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.values(map).some(value => String(value) === String(messageId));
}

async function markGuideLost(guideId, reason, code = 'THREAD_NOT_FOUND') {
  const { error } = await supabase.from('guide_forum_publications').update({
    status: 'lost',
    last_error_code: code,
    last_error_message: reason,
    updated_at: new Date().toISOString(),
  }).eq('guide_id', guideId);
  if (error) console.warn('[Recovery] No se pudo marcar la Guía como perdida:', error.message);
}

async function markGuideOutdated(guideId, reason) {
  const { error } = await supabase.from('guide_forum_publications').update({
    status: 'outdated',
    last_error_code: 'MESSAGE_NOT_FOUND',
    last_error_message: reason,
    updated_at: new Date().toISOString(),
  }).eq('guide_id', guideId);
  if (error) console.warn('[Recovery] No se pudo marcar la Guía como desactualizada:', error.message);
}

export async function recoverDeletedMessage(client, messageId, channelId = null) {
  if (!messageId) return;

  const [{ data: guideStarter, error: starterError }, { data: logSummary, error: summaryError }] = await Promise.all([
    supabase.from('guide_forum_publications').select('guide_id').eq('starter_message_id', messageId).maybeSingle(),
    supabase.from('log_discord_publications').select('log_id').eq('summary_message_id', messageId).maybeSingle(),
  ]);
  if (starterError) console.warn('[Recovery] Error buscando portada de Guía:', starterError.message);
  if (summaryError) console.warn('[Recovery] Error buscando resumen de Log:', summaryError.message);
  if (guideStarter?.guide_id) {
    await markGuideLost(guideStarter.guide_id, 'La portada o publicación de la Guía fue eliminada directamente en Discord.', 'STARTER_MESSAGE_NOT_FOUND');
    return;
  }
  if (logSummary?.log_id) {
    console.log(`[Recovery] Resumen ${messageId} de Log eliminado; reconstruyendo ${logSummary.log_id}.`);
    await requestLogSyncById(client, logSummary.log_id, 350);
    return;
  }

  // Los mensajes internos viven en el hilo, así que channelId permite buscar
  // una sola publicación en vez de escanear todos los message_map del sistema
  // cada vez que se borra cualquier mensaje del servidor.
  if (!channelId) return;
  const [{ data: guide, error: guideError }, { data: log, error: logError }] = await Promise.all([
    supabase.from('guide_forum_publications').select('guide_id,message_map').eq('thread_id', channelId).maybeSingle(),
    supabase.from('log_discord_publications').select('log_id,message_map').eq('thread_id', channelId).maybeSingle(),
  ]);
  if (guideError) console.warn('[Recovery] Error revisando el hilo de Guía:', guideError.message);
  if (logError) console.warn('[Recovery] Error revisando el hilo de Log:', logError.message);

  if (guide?.guide_id && mapContainsId(guide.message_map, messageId)) {
    await markGuideOutdated(guide.guide_id, 'Falta un mensaje interno de la publicación. Pulsa “Actualizar en foro” para reconstruirlo.');
    return;
  }
  if (log?.log_id && mapContainsId(log.message_map, messageId)) {
    console.log(`[Recovery] Mensaje ${messageId} de Log eliminado; reconstruyendo ${log.log_id}.`);
    await requestLogSyncById(client, log.log_id, 350);
  }
}

export async function recoverDeletedThread(client, threadId) {
  if (!threadId) return;
  const [{ data: guide, error: guideError }, { data: log, error: logError }] = await Promise.all([
    supabase.from('guide_forum_publications').select('guide_id').eq('thread_id', threadId).maybeSingle(),
    supabase.from('log_discord_publications').select('log_id').eq('thread_id', threadId).maybeSingle(),
  ]);
  if (guideError) console.warn('[Recovery] Error buscando hilo de Guía:', guideError.message);
  if (logError) console.warn('[Recovery] Error buscando hilo de Log:', logError.message);

  if (guide?.guide_id) {
    await markGuideLost(guide.guide_id, 'La publicación completa fue eliminada directamente en Discord.');
  }
  if (log?.log_id) {
    console.log(`[Recovery] Hilo ${threadId} de Log eliminado; reconstruyendo ${log.log_id}.`);
    await requestLogSyncById(client, log.log_id, 350);
  }
}

async function firstMissingMessage(thread, messageMap) {
  const ids = [...new Set(Object.values(messageMap && typeof messageMap === 'object' ? messageMap : {}).filter(Boolean).map(String))];
  for (const id of ids) {
    const message = await thread.messages.fetch(id).catch(() => null);
    if (!message) return id;
  }
  return null;
}

async function runPublicationIntegritySweep(client) {
  console.log('[Recovery] Comprobando integridad de publicaciones persistentes…');
  const [
    { data: guidePubs, error: guideError },
    { data: logPubs, error: logError },
    { data: publishedLogs, error: publishedLogsError },
  ] = await Promise.all([
    supabase.from('guide_forum_publications').select('guide_id,thread_id,starter_message_id,message_map,status').in('status', ['synced', 'synced_with_warnings', 'outdated']),
    supabase.from('log_discord_publications').select('log_id,channel_id,summary_message_id,thread_id,message_map'),
    supabase.from('logs').select('id').eq('published', true),
  ]);
  if (guideError) console.warn('[Recovery] No se pudieron revisar Guías:', guideError.message);
  if (logError) console.warn('[Recovery] No se pudieron revisar Logs:', logError.message);
  if (publishedLogsError) console.warn('[Recovery] No se pudieron localizar Logs pendientes:', publishedLogsError.message);

  // Una caída durante la primera publicación antes no dejaba mapeo que
  // revisar. Comparar ambos conjuntos permite recuperar también esos Logs sin
  // tocar los que ya están publicados ni generar duplicados.
  if (!logError && !publishedLogsError) {
    const mappedLogIds = new Set((logPubs || []).map(row => String(row.log_id)));
    for (const log of publishedLogs || []) {
      if (!mappedLogIds.has(String(log.id))) {
        await requestLogSyncById(client, log.id, 250);
      }
    }
  }

  for (const publication of guidePubs || []) {
    if (!publication.thread_id) continue;
    const thread = await client.channels.fetch(publication.thread_id).catch(() => null);
    if (!thread) {
      await markGuideLost(publication.guide_id, 'La publicación completa ya no existe en Discord.');
      continue;
    }
    const starter = publication.starter_message_id
      ? await thread.messages.fetch(publication.starter_message_id).catch(() => null)
      : await thread.fetchStarterMessage().catch(() => null);
    if (!starter) {
      await markGuideLost(publication.guide_id, 'La portada de la publicación ya no existe en Discord.', 'STARTER_MESSAGE_NOT_FOUND');
      continue;
    }
    const missing = await firstMissingMessage(thread, publication.message_map);
    if (missing) await markGuideOutdated(publication.guide_id, `Falta el mensaje ${missing} de la publicación. Pulsa “Actualizar en foro” para reconstruirlo.`);
  }

  const logIds = (logPubs || []).map(publication => publication.log_id).filter(Boolean);
  const { data: logRows, error: logStateError } = logIds.length
    ? await supabase.from('logs').select('id,published').in('id', logIds)
    : { data: [], error: null };
  if (logStateError) console.warn('[Recovery] No se pudo revisar la visibilidad de Logs:', logStateError.message);
  const logPublished = new Map((logRows || []).map(row => [String(row.id), row.published !== false]));

  for (const publication of logPubs || []) {
    if (logPublished.get(String(publication.log_id)) === false) {
      await requestLogSyncById(client, publication.log_id, 0).catch(error => console.warn(`[Recovery] No se pudo retirar Log oculto ${publication.log_id}:`, error.message));
      continue;
    }
    let damaged = false;
    const channel = publication.channel_id ? await client.channels.fetch(publication.channel_id).catch(() => null) : null;
    if (!channel?.isTextBased?.()) damaged = true;
    if (!damaged && publication.summary_message_id) {
      const summary = await channel.messages.fetch(publication.summary_message_id).catch(() => null);
      if (!summary) damaged = true;
    }
    const thread = !damaged && publication.thread_id ? await client.channels.fetch(publication.thread_id).catch(() => null) : null;
    if (!thread) damaged = true;
    if (!damaged) damaged = Boolean(await firstMissingMessage(thread, publication.message_map));
    if (damaged) await requestLogSyncById(client, publication.log_id, 250).catch(error => console.warn(`[Recovery] No se pudo reconstruir Log ${publication.log_id}:`, error.message));
  }
  console.log('[Recovery] Comprobación de integridad terminada.');
}

// Ready, el temporizador horario y el panel manual comparten este candado. Si
// coinciden, todos esperan el mismo barrido en vez de multiplicar consultas a
// Supabase y Discord.
export function isPublicationIntegritySweepRunning() {
  return Boolean(integritySweepInFlight);
}

export function sweepPublicationIntegrity(client) {
  if (integritySweepInFlight) return integritySweepInFlight;
  integritySweepInFlight = runPublicationIntegritySweep(client)
    .finally(() => { integritySweepInFlight = null; });
  return integritySweepInFlight;
}
