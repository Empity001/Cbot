import { ChannelType } from 'discord.js';
import { createHash } from 'node:crypto';
import { supabase } from './supabase.js';
import { getGuildConfig } from './botConfig.js';
import { loadWeaponWithRanks } from './weapons.js';
import { buildGuideForumSpecs } from '../utils/guideForumEmbeds.js';
import { config } from '../config.js';
import { refreshRenderPalette } from './siteTheme.js';
import { recordGuideForumWorkerAudit } from './audit.js';
import { suppressDiscordDeletion } from './deletionSuppressor.js';
import { sendAdminAlert } from './adminAlerts.js';

const processingJobs = new Set();
const processingGuides = new Set();
let realtimeChannel = null;
let pollTimer = null;
let consecutiveSweepFailures = 0;

export function startGuideForumWorker(client) {
  if (realtimeChannel) return;
  realtimeChannel = supabase
    .channel('guide-forum-worker-v1')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'guide_forum_jobs' }, payload => {
      void processJob(client, payload.new);
    })
    .subscribe(status => console.log('[GuideForum] Realtime:', status));

  void sweepJobs(client);
  pollTimer = setInterval(() => void sweepJobs(client), config.worker.pollIntervalMs);
  pollTimer.unref?.();
}

async function sweepJobs(client) {
  // Si Railway se reinicia en mitad de un trabajo, la fila puede quedar en
  // `processing`. Después de cinco minutos se considera abandonada y vuelve
  // a la cola; la idempotencia impide crear publicaciones duplicadas.
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { error: recoveryError } = await supabase
    .from('guide_forum_jobs')
    .update({ status: 'pending', started_at: null, error_code: 'WORKER_RESTARTED', error_message: 'El trabajo fue recuperado después de una interrupción del bot.' })
    .eq('status', 'processing')
    .lt('started_at', staleBefore);
  if (recoveryError) console.warn('[GuideForum] No se pudieron recuperar trabajos interrumpidos:', recoveryError.message);

  const { data, error } = await supabase
    .from('guide_forum_jobs')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lt('attempts', config.worker.maxJobAttempts)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) {
    consecutiveSweepFailures += 1;
    console.warn('[GuideForum] No se pudo revisar la cola:', error.message);
    if (consecutiveSweepFailures >= 3) {
      void sendAdminAlert(client, {
        key: 'guide-queue-unavailable',
        title: 'La cola de Guías no responde',
        description: `El bot no pudo consultar guide_forum_jobs en ${consecutiveSweepFailures} revisiones consecutivas.`,
        details: [{ name: 'Último error', value: String(error.message || error).slice(0, 1000) }],
      });
    }
    return;
  }
  consecutiveSweepFailures = 0;
  for (const job of data || []) void processJob(client, job);
}

async function claimJob(job) {
  const { data, error } = await supabase
    .from('guide_forum_jobs')
    .update({ status: 'processing', attempts: Number(job.attempts || 0) + 1, started_at: new Date().toISOString(), error_code: null, error_message: null })
    .eq('id', job.id)
    .in('status', ['pending', 'failed'])
    .select('*')
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function finishJob(jobId, status, patch = {}) {
  const { error } = await supabase.from('guide_forum_jobs').update({
    status,
    completed_at: status === 'completed' ? new Date().toISOString() : null,
    ...patch,
  }).eq('id', jobId);
  if (error) console.error(`[GuideForum] No se pudo cerrar job ${jobId}:`, error);
}

async function processJob(client, rawJob) {
  if (!rawJob?.id || processingJobs.has(rawJob.id)) return;
  if (rawJob.guide_id && processingGuides.has(rawJob.guide_id)) return;
  processingJobs.add(rawJob.id);
  if (rawJob.guide_id) processingGuides.add(rawJob.guide_id);
  let job = null;
  try {
    job = await claimJob(rawJob);
    if (!job) return;
    let result;
    if (job.action === 'apply_reactions') result = await applyReactionsToAll(client, job);
    else if (job.action === 'unpublish') result = await unpublishGuide(client, job);
    else result = await publishOrUpdateGuide(client, job);
    await finishJob(job.id, 'completed');
    const actor = job.payload?.requested_actor_name || 'Un administrador';
    const descriptions = {
      publish: `${actor} publicó la Guía “${result?.guideName || job.payload?.guide_name || job.guide_id}” en el foro de Discord.`,
      update: `${actor} actualizó la publicación de la Guía “${result?.guideName || job.payload?.guide_name || job.guide_id}” en el foro de Discord.`,
      reconcile: `${actor} reconcilió la publicación de la Guía “${result?.guideName || job.payload?.guide_name || job.guide_id}” con su contenido actual.`,
      unpublish: `${actor} despublicó la Guía “${result?.guideName || job.payload?.guide_name || job.guide_id}” del foro de Discord.`,
      apply_reactions: `${actor} aplicó la configuración de reacciones a ${result?.updatedCount || 0} publicación(es) de Guías.`,
    };
    await recordGuideForumWorkerAudit(job, {
      action: `guide_forum_${job.action}_completed`,
      description: descriptions[job.action],
      entityId: job.guide_id,
      entityName: result?.guideName || job.payload?.guide_name || null,
      metadata: result || {},
      success: true,
    });
  } catch (error) {
    console.error(`[GuideForum] Job ${rawJob.id} falló:`, error);
    if (job) {
      await finishJob(job.id, 'failed', { error_code: error.code || 'GUIDE_FORUM_ERROR', error_message: String(error.message || error).slice(0, 1000) });
      if (job.guide_id) await markPublicationError(job.guide_id, error);
      await recordGuideForumWorkerAudit(job, {
        action: `guide_forum_${job.action}_failed`,
        description: `${job.payload?.requested_actor_name || 'Un administrador'} intentó ${job.action === 'publish' ? 'publicar' : job.action === 'update' ? 'actualizar' : job.action === 'unpublish' ? 'despublicar' : job.action === 'apply_reactions' ? 'aplicar reacciones a' : 'reconciliar'} ${job.guide_id ? `la Guía “${job.payload?.guide_name || job.guide_id}”` : 'las publicaciones de Guías'}, pero la operación falló: ${String(error.message || error).slice(0, 500)}`,
        entityId: job.guide_id,
        entityName: job.payload?.guide_name || null,
        metadata: { error_code: error.code || 'GUIDE_FORUM_ERROR' },
        success: false,
      });
      if (Number(job.attempts || 0) >= config.worker.maxJobAttempts) {
        void sendAdminAlert(client, {
          key: `guide-job-exhausted:${job.id}`,
          title: 'Una publicación de Guías agotó sus reintentos',
          description: `El trabajo “${job.action}” ya alcanzó ${config.worker.maxJobAttempts} intento(s) y necesita revisión manual.`,
          details: [
            { name: 'Trabajo', value: String(job.id), inline: true },
            { name: 'Guía', value: String(job.payload?.guide_name || job.guide_id || 'general'), inline: true },
            { name: 'Último error', value: String(error?.message || error).slice(0, 1000) },
          ],
        });
      }
    }
  } finally {
    processingJobs.delete(rawJob.id);
    if (rawJob.guide_id) processingGuides.delete(rawJob.guide_id);
  }
}

async function getPublication(guideId) {
  const { data, error } = await supabase.from('guide_forum_publications').select('*').eq('guide_id', guideId).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function markPublicationError(guideId, error) {
  await supabase.from('guide_forum_publications').upsert({
    guide_id: guideId,
    status: 'failed',
    last_error_code: error.code || 'GUIDE_FORUM_ERROR',
    last_error_message: String(error.message || error).slice(0, 1000),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'guide_id' });
}

async function loadForum(client, forumId) {
  const forum = await client.channels.fetch(forumId).catch(() => null);
  if (!forum || forum.type !== ChannelType.GuildForum) throw new Error('El foro configurado no existe o ya no es un canal Foro.');
  return forum;
}

function isArchiveDurationError(error) {
  return Number(error?.code) === 50035
    || /auto[_ -]?archive|archive duration/i.test(String(error?.message || ''));
}

async function createGuideThread(forum, options) {
  // 7 días no está disponible en todos los servidores. Se intenta primero y
  // se baja hasta el valor predeterminado/permitido sin fallar toda la
  // publicación por una capacidad del servidor.
  const durations = [...new Set([
    10080,
    Number(forum.defaultAutoArchiveDuration) || null,
    4320,
    1440,
    60,
  ].filter(Boolean))];
  let lastError = null;
  for (const duration of durations) {
    try {
      return await forum.threads.create({ ...options, autoArchiveDuration: duration });
    } catch (error) {
      lastError = error;
      if (!isArchiveDurationError(error)) throw error;
      console.warn(`[GuideForum] El archivado de ${duration} minutos no está disponible; probando otro valor.`);
    }
  }
  throw lastError || new Error('No se pudo crear la publicación del foro.');
}

function tagBase(kind, label) {
  const prefix = kind === 'category' ? 'C · ' : 'T · ';
  const available = 20 - [...prefix].length;
  return `${prefix}${[...String(label || '')].slice(0, available).join('')}`;
}

function shortHash(value) { return createHash('sha1').update(String(value)).digest('hex').slice(0, 3); }

async function ensureTag(forum, kind, source) {
  if (!source?.id || !source?.label) throw new Error(`Falta ${kind === 'category' ? 'la categoría' : 'el tipo'} de la Guía.`);
  const { data: mapped } = await supabase
    .from('guide_forum_tag_map')
    .select('*')
    .eq('forum_channel_id', forum.id)
    .eq('kind', kind)
    .eq('source_id', source.id)
    .maybeSingle();
  if (mapped?.discord_tag_id && forum.availableTags.some(tag => tag.id === mapped.discord_tag_id)) return mapped.discord_tag_id;

  let name = tagBase(kind, source.label);
  let tag = forum.availableTags.find(item => item.name === name);

  // Una etiqueta creada manualmente con el nombre exacto se puede reutilizar
  // siempre que no esté vinculada a otra categoría/tipo. Si ya pertenece a
  // otra fuente, se crea una variante corta y determinista para evitar que dos
  // valores distintos terminen compartiendo accidentalmente la misma tag.
  if (tag) {
    const { data: owner, error: ownerError } = await supabase
      .from('guide_forum_tag_map')
      .select('kind,source_id')
      .eq('forum_channel_id', forum.id)
      .eq('discord_tag_id', tag.id)
      .maybeSingle();
    if (ownerError) throw new Error(ownerError.message);
    if (owner && (owner.kind !== kind || owner.source_id !== source.id)) {
      const suffix = `·${shortHash(source.id)}`;
      name = `${[...name].slice(0, 20 - suffix.length).join('')}${suffix}`;
      tag = forum.availableTags.find(item => item.name === name);
    }
  }
  if (!tag) {
    if (forum.availableTags.length >= 20) {
      const error = new Error(`No se pudo crear la etiqueta “${name}”: el foro alcanzó el máximo de etiquetas disponibles.`);
      error.code = 'FORUM_TAG_LIMIT';
      throw error;
    }
    const tags = forum.availableTags.map(item => ({ name: item.name, moderated: item.moderated, emoji: item.emoji || undefined }));
    tags.push({ name, moderated: false });
    const updated = await forum.setAvailableTags(tags);
    tag = updated.availableTags.find(item => item.name === name);
  }
  if (!tag) throw new Error(`Discord no devolvió la etiqueta “${name}” después de crearla.`);
  await supabase.from('guide_forum_tag_map').upsert({
    forum_channel_id: forum.id,
    kind,
    source_id: source.id,
    source_name: source.label,
    discord_tag_id: tag.id,
    discord_tag_name: tag.name,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'forum_channel_id,kind,source_id' });
  return tag.id;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function guideHashPayload(bundle) {
  const weapon = bundle.weapon || {};
  const category = bundle.category || {};
  const type = bundle.type || {};
  return {
    weapon: {
      id: weapon.id,
      name: weapon.name,
      image_url: weapon.image_url,
      category_id: weapon.category_id,
      type_id: weapon.type_id,
      published: weapon.published,
      sort_order: weapon.sort_order,
    },
    category: { id: category.id, label: category.label, color: category.color, emoji: category.emoji },
    type: { id: type.id, label: type.label },
    ranks: (bundle.ranks || []).map(rank => ({
      id: rank.id,
      name: rank.name,
      description: rank.description,
      image_url: rank.image_url,
      stats: rank.stats,
      abilities: rank.abilities,
      upgrade_recipe: rank.upgrade_recipe,
      extra_sections: rank.extra_sections,
      sort_order: rank.sort_order,
    })),
  };
}

function guideHash(bundle) {
  return createHash('sha256').update(JSON.stringify(stable(guideHashPayload(bundle)))).digest('hex');
}

function specPayload(spec, { editing = false } = {}) {
  const payload = {
    embeds: spec.embeds || [],
    files: spec.files || [],
    ...(editing ? { attachments: [] } : {}),
    allowedMentions: { parse: [] },
  };
  if (spec.content != null) payload.content = spec.content;
  else if (editing) payload.content = null;
  return payload;
}

async function sendSpec(channel, spec) {
  return channel.send(specPayload(spec));
}

async function editSpec(message, spec) {
  return message.edit(specPayload(spec, { editing: true }));
}

async function publishOrUpdateGuide(client, job) {
  if (!job.guide_id) throw new Error('El trabajo no tiene guide_id.');
  const bundle = await loadWeaponWithRanks(job.guide_id);
  await refreshRenderPalette();
  if (!bundle.weapon?.published) throw new Error('La Guía está oculta en la página y no puede publicarse en el foro.');
  if (!bundle.category) throw new Error('La Guía no tiene una categoría válida.');
  if (!bundle.type) throw new Error('La Guía no tiene un tipo válido.');
  const specs = await buildGuideForumSpecs(bundle);
  if (!specs.length) throw new Error('La Guía no produjo contenido publicable.');
  const warnings = [...new Set(specs.map(spec => spec.warning).filter(Boolean))];
  const syncedStatus = warnings.length ? 'synced_with_warnings' : 'synced';
  const warningCode = warnings.length ? 'MEDIA_WARNINGS' : null;
  const warningMessage = warnings.length ? warnings.join(' · ').slice(0, 1000) : null;
  const hash = guideHash(bundle);
  let publication = await getPublication(job.guide_id);
  const cfg = await getGuildConfig();
  const targetForumId = publication?.forum_channel_id || cfg?.guides_forum_channel_id;
  if (!targetForumId) throw new Error('No hay un foro de Guías configurado. Abre /config → Canales → Guías.');
  const forum = await loadForum(client, targetForumId);
  const appliedTags = [
    await ensureTag(forum, 'category', bundle.category),
    await ensureTag(forum, 'type', bundle.type),
  ];

  if (job.action === 'publish' && publication?.thread_id) {
    const existing = await client.channels.fetch(publication.thread_id).catch(() => null);
    if (!existing) {
      await supabase.from('guide_forum_publications').delete().eq('guide_id', job.guide_id);
      publication = null;
    }
  }

  if (!publication?.thread_id) {
    const first = specs[0];
    const thread = await createGuideThread(forum, {
      name: String(bundle.weapon.name).slice(0, 100),
      appliedTags,
      message: specPayload(first),
      reason: `Publicación de Guía solicitada desde la web por ${job.requested_discord_user_id || job.requested_by || 'admin'}`,
    });
    const starter = await thread.fetchStarterMessage();
    const messageMap = { [first.key]: starter.id };
    for (const spec of specs.slice(1)) {
      const message = await sendSpec(thread, spec);
      messageMap[spec.key] = message.id;
    }
    await applyConfiguredReactions(starter, cfg?.forum_reactions || []);
    await supabase.from('guide_forum_publications').upsert({
      guide_id: job.guide_id,
      forum_channel_id: forum.id,
      thread_id: thread.id,
      starter_message_id: starter.id,
      message_map: messageMap,
      message_order: specs.map(spec => spec.key),
      attachment_map: {},
      published_hash: hash,
      status: syncedStatus,
      last_error_code: warningCode,
      last_error_message: warningMessage,
      last_synced_by: job.requested_by,
      published_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guide_id' });
    console.log(`[GuideForum] ✅ Publicada “${bundle.weapon.name}” (${thread.id}).`);
    return { guideName: bundle.weapon.name, threadId: thread.id, created: true, status: syncedStatus, warnings };
  }

  const thread = await client.channels.fetch(publication.thread_id).catch(() => null);
  if (!thread) {
    await supabase.from('guide_forum_publications').update({ status: 'lost', last_error_code: 'THREAD_NOT_FOUND', last_error_message: 'La publicación fue eliminada en Discord.', updated_at: new Date().toISOString() }).eq('guide_id', job.guide_id);
    throw new Error('La publicación fue eliminada en Discord. Usa “Volver a publicar”.');
  }
  if (thread.archived) await thread.setArchived(false).catch(() => {});
  await thread.setName(String(bundle.weapon.name).slice(0, 100));
  await thread.setAppliedTags(appliedTags);
  const starter = await thread.fetchStarterMessage();
  const oldMap = publication.message_map && typeof publication.message_map === 'object' ? publication.message_map : {};
  const desiredKeys = specs.map(spec => spec.key);
  const oldKeys = Object.keys(oldMap);
  const storedOrder = Array.isArray(publication.message_order) && publication.message_order.length
    ? publication.message_order.filter(key => oldMap[key])
    : oldKeys;
  const comparableDesired = desiredKeys.filter(key => oldMap[key]);
  const orderChanged = storedOrder.length > 0 && storedOrder.join('|') !== comparableDesired.join('|');
  const messageMap = {};

  await editSpec(starter, specs[0]);
  messageMap[specs[0].key] = starter.id;

  if (orderChanged) {
    for (const [key, id] of Object.entries(oldMap)) {
      if (id === starter.id || key === specs[0].key) continue;
      const message = await thread.messages.fetch(id).catch(() => null);
      if (message) suppressDiscordDeletion(message.id);
      await message?.delete().catch(() => {});
    }
    for (const spec of specs.slice(1)) {
      const message = await sendSpec(thread, spec);
      messageMap[spec.key] = message.id;
    }
  } else {
    for (const spec of specs.slice(1)) {
      const id = oldMap[spec.key];
      let message = id ? await thread.messages.fetch(id).catch(() => null) : null;
      if (message) await editSpec(message, spec);
      else message = await sendSpec(thread, spec);
      messageMap[spec.key] = message.id;
    }
    for (const [key, id] of Object.entries(oldMap)) {
      if (desiredKeys.includes(key) || id === starter.id) continue;
      const message = await thread.messages.fetch(id).catch(() => null);
      if (message) suppressDiscordDeletion(message.id);
      await message?.delete().catch(() => {});
    }
  }

  await supabase.from('guide_forum_publications').update({
    message_map: messageMap,
    message_order: desiredKeys,
    published_hash: hash,
    status: syncedStatus,
    last_error_code: warningCode,
    last_error_message: warningMessage,
    last_synced_by: job.requested_by,
    updated_at: new Date().toISOString(),
  }).eq('guide_id', job.guide_id);
  console.log(`[GuideForum] ✅ Actualizada “${bundle.weapon.name}”.`);
  return { guideName: bundle.weapon.name, threadId: thread.id, created: false, status: syncedStatus, warnings };
}

async function unpublishGuide(client, job) {
  const publication = await getPublication(job.guide_id);
  const { data: guide } = job.guide_id
    ? await supabase.from('weapons').select('name').eq('id', job.guide_id).maybeSingle()
    : { data: null };
  if (publication?.thread_id) {
    suppressDiscordDeletion(publication.thread_id);
    const thread = await client.channels.fetch(publication.thread_id).catch(() => null);
    await thread?.delete(`Guía despublicada desde la web por ${job.requested_discord_user_id || job.requested_by || 'admin'}`).catch(() => {});
  }
  await supabase.from('guide_forum_publications').delete().eq('guide_id', job.guide_id);
  console.log(`[GuideForum] 🗑️ Guía ${job.guide_id} despublicada.`);
  return { guideName: guide?.name || job.payload?.guide_name || null, threadId: publication?.thread_id || null };
}

function reactionIdentifier(reaction) {
  if (typeof reaction === 'string') return reaction;
  if (reaction?.type === 'custom' && reaction?.value) return `${reaction.name || 'emoji'}:${reaction.value}`;
  if (reaction?.type === 'unicode' && reaction?.value) return reaction.value;
  if (reaction?.id) return `${reaction.name || 'emoji'}:${reaction.id}`;
  return reaction?.value || reaction?.name || reaction?.emoji || null;
}

async function applyConfiguredReactions(message, reactions, { removeOld = false } = {}) {
  const desired = (Array.isArray(reactions) ? reactions : []).map(reactionIdentifier).filter(Boolean).slice(0, 20);
  const fetched = await message.fetch();
  if (removeOld) {
    for (const reaction of fetched.reactions.cache.values()) {
      const key = reaction.emoji.id ? `${reaction.emoji.name}:${reaction.emoji.id}` : reaction.emoji.name;
      if (!desired.includes(key)) await reaction.remove().catch(() => {});
    }
  }
  for (const emoji of desired) await fetched.react(emoji).catch(error => console.warn(`[GuideForum] No se pudo reaccionar con ${emoji}:`, error.message));
}

async function applyReactionsToAll(client, job) {
  const cfg = await getGuildConfig();
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : {};
  const reactions = payload.reactions || cfg?.forum_reactions || [];
  const removeOld = Boolean(payload.remove_old);
  const { data, error } = await supabase.from('guide_forum_publications').select('*').in('status', ['synced', 'synced_with_warnings']);
  if (error) throw new Error(error.message);
  let updatedCount = 0;
  for (const pub of data || []) {
    const thread = await client.channels.fetch(pub.thread_id).catch(() => null);
    if (!thread) continue;
    if (thread.archived) await thread.setArchived(false).catch(() => {});
    const starter = await thread.fetchStarterMessage().catch(() => null);
    if (starter) {
      await applyConfiguredReactions(starter, reactions, { removeOld });
      updatedCount += 1;
    }
  }
  return { updatedCount, reactions: reactions.length, removeOld };
}
