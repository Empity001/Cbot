// Búsqueda pública bajo demanda. No usa autocomplete para evitar una consulta
// por pulsación y limita cada fuente antes de combinar resultados.

import { config } from '../config.js';
import { supabase } from './supabase.js';

const SOURCE_LIMIT = 6;
const RESULT_LIMIT = 10;

function cleanQuery(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[%_*,()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function comparable(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function scoreName(name, query) {
  const haystack = comparable(name);
  const needle = comparable(query);
  if (haystack === needle) return 100;
  if (haystack.startsWith(needle)) return 80;
  if (haystack.includes(needle)) return 60;
  return 10;
}

async function safeRun(label, promise) {
  try {
    const response = await promise;
    if (response.error) throw response.error;
    return response.data || [];
  } catch (error) {
    console.warn(`[Search] ${label}:`, error?.message || error);
    return [];
  }
}

function page(path, params) {
  const query = new URLSearchParams(params);
  return `${config.siteUrl}/${path}?${query.toString()}`;
}

function kitContains(kit, query) {
  if (comparable(kit.name).includes(comparable(query))) return true;
  const groups = kit?.items && typeof kit.items === 'object' ? Object.values(kit.items) : [];
  return groups.some(group => Array.isArray(group) && group.some(item => comparable(item?.name).includes(comparable(query))));
}

export async function searchPublicContent(rawQuery) {
  const query = cleanQuery(rawQuery);
  if (query.length < 2) return { query, results: [], tooShort: true };
  const pattern = `%${query}%`;

  const [weapons, ranks, logs, logItems, logMobs, tierItems, kits] = await Promise.all([
    safeRun('Guías', supabase.from('weapons').select('id,name').eq('published', true).ilike('name', pattern).limit(SOURCE_LIMIT)),
    safeRun('Rangos', supabase.from('weapon_ranks').select('id,weapon_id,name').ilike('name', pattern).limit(SOURCE_LIMIT)),
    safeRun('Logs', supabase.from('logs').select('id,title,description,created_at').eq('published', true).ilike('title', pattern).order('created_at', { ascending: false }).limit(SOURCE_LIMIT)),
    safeRun('Items de Logs', supabase.from('log_items').select('id,log_id,name').ilike('name', pattern).limit(SOURCE_LIMIT)),
    safeRun('Mobs de Logs', supabase.from('log_mobs').select('id,log_id,name').ilike('name', pattern).limit(SOURCE_LIMIT)),
    safeRun('Tierlist', supabase.from('tierlist_items').select('id,name,column_key,row_id').ilike('name', pattern).limit(SOURCE_LIMIT)),
    safeRun('Kits', supabase.from('kits').select('id,name,description,items').eq('published', true).order('sort_order', { ascending: true }).limit(100)),
  ]);

  const weaponIds = [...new Set(ranks.map(rank => rank.weapon_id).filter(Boolean))];
  const logIds = [...new Set([...logItems, ...logMobs].map(item => item.log_id).filter(Boolean))];
  const [rankParents, logParents] = await Promise.all([
    weaponIds.length
      ? safeRun('Padres de rangos', supabase.from('weapons').select('id,name').eq('published', true).in('id', weaponIds))
      : [],
    logIds.length
      ? safeRun('Padres de entradas de Logs', supabase.from('logs').select('id,title').eq('published', true).in('id', logIds))
      : [],
  ]);
  const weaponsById = new Map(rankParents.map(item => [item.id, item]));
  const logsById = new Map(logParents.map(item => [item.id, item]));

  const results = [];
  for (const weapon of weapons) results.push({
    kind: 'Guía',
    title: weapon.name,
    description: 'Objeto publicado en Guías.',
    url: page('guides.html', { weapon: weapon.id }),
    score: scoreName(weapon.name, query) + 8,
  });
  for (const rank of ranks) {
    const parent = weaponsById.get(rank.weapon_id);
    if (!parent) continue;
    results.push({
      kind: 'Rango',
      title: `${parent.name} · ${rank.name}`,
      description: 'Rango o variante dentro de una Guía.',
      url: page('guides.html', { weapon: parent.id, rank: rank.id }),
      score: scoreName(rank.name, query) + 7,
    });
  }
  for (const log of logs) results.push({
    kind: 'Log',
    title: log.title,
    description: log.description || 'Registro publicado.',
    url: page('index.html', { log: log.id }),
    score: scoreName(log.title, query) + 6,
  });
  for (const [entryType, entries, tab] of [['Item de Log', logItems, 'items'], ['Mob de Log', logMobs, 'mobs']]) {
    for (const entry of entries) {
      const parent = logsById.get(entry.log_id);
      if (!parent) continue;
      results.push({
        kind: entryType,
        title: entry.name,
        description: `Aparece en el Log “${parent.title}”.`,
        url: page('index.html', { log: parent.id, tab, entry: entry.id }),
        score: scoreName(entry.name, query) + 5,
      });
    }
  }
  for (const item of tierItems) results.push({
    kind: 'Tierlist',
    title: item.name,
    description: `Elemento de la columna ${item.column_key || 'general'}.`,
    url: page('tierlist.html', { item: item.id }),
    score: scoreName(item.name, query) + 4,
  });
  for (const kit of kits.filter(item => kitContains(item, query)).slice(0, SOURCE_LIMIT)) results.push({
    kind: 'Kit',
    title: kit.name,
    description: kit.description || 'Kit recomendado.',
    url: page('kits.html', { kit: kit.id }),
    score: scoreName(kit.name, query) + 3,
  });

  const unique = new Map();
  for (const result of results) {
    const key = `${result.kind}:${result.url}`;
    if (!unique.has(key) || unique.get(key).score < result.score) unique.set(key, result);
  }
  return {
    query,
    tooShort: false,
    results: [...unique.values()].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, 'es')).slice(0, RESULT_LIMIT),
  };
}
