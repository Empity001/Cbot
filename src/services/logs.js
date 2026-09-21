// src/services/logs.js
// Carga logs desde Supabase para /screenshot logs.

import { supabase } from './supabase.js';

/**
 * Carga los N logs más recientes junto con los datos de su
 * categoría (emoji, color, label).
 * @param {number} limit
 */
export async function loadRecentLogs(limit = 10) {
  const [logsRes, catsRes] = await Promise.all([
    supabase.from('logs').select('*').eq('published', true).order('created_at', { ascending: false }).limit(limit),
    supabase.from('categories').select('*'),
  ]);

  if (logsRes.error) throw new Error(`[Logs] Error cargando logs: ${logsRes.error.message}`);
  if (catsRes.error) throw new Error(`[Logs] Error cargando categorías: ${catsRes.error.message}`);

  const categoriesBySlug = new Map((catsRes.data || []).map((c) => [c.slug, c]));

  return (logsRes.data || []).map((log) => ({
    ...log,
    categoryInfo: categoriesBySlug.get(log.category) || null,
  }));
}

/**
 * Carga un log específico por ID junto con sus mobs, items y
 * datos de categoría. Para /screenshot logs ver:<id>
 * @param {string} logId
 */
export async function loadLogById(logId) {
  const [logRes, catsRes, mobsRes, itemsRes] = await Promise.all([
    supabase.from('logs').select('*').eq('id', logId).eq('published', true).single(),
    supabase.from('categories').select('*'),
    supabase.from('log_mobs').select('*').eq('log_id', logId).order('sort_order', { ascending: true }),
    supabase.from('log_items').select('*').eq('log_id', logId).order('sort_order', { ascending: true }),
  ]);

  if (logRes.error) throw new Error(`[Logs] Error cargando log: ${logRes.error.message}`);

  const categoriesBySlug = new Map((catsRes.data || []).map((c) => [c.slug, c]));
  const log = logRes.data;

  return {
    ...log,
    categoryInfo: categoriesBySlug.get(log.category) || null,
    mobs:  mobsRes.data  || [],
    items: itemsRes.data || [],
  };
}
