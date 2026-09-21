import { supabase } from './supabase.js';

const TABLE = 'log_discord_publications';

export async function getPublication(logId) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('log_id', logId).maybeSingle();
  if (error) console.error(`[LogPublication] No se pudo leer ${logId}:`, error);
  return data || null;
}

export async function upsertPublication({ logId, channelId, summaryMessageId, threadId, messageMap, messageOrder = [], contentHash = null, status = 'synced' }) {
  const normalizedOrder = Array.isArray(messageOrder) ? messageOrder.filter(key => key !== 'summary') : [];
  const pageIds = normalizedOrder.map(key => messageMap?.[key]).filter(Boolean);
  const { error } = await supabase.from(TABLE).upsert({
    log_id: logId,
    channel_id: channelId,
    summary_message_id: summaryMessageId,
    thread_id: threadId || null,
    page_message_ids: pageIds,
    message_map: messageMap || {},
    message_order: normalizedOrder,
    content_hash: contentHash,
    status,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'log_id' });
  if (error) throw new Error(`[LogPublication] No se pudo guardar ${logId}: ${error.message}`);
}

export async function deletePublication(logId) {
  const { error } = await supabase.from(TABLE).delete().eq('log_id', logId);
  if (error) console.error(`[LogPublication] No se pudo borrar ${logId}:`, error);
}
