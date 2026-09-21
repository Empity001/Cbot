// src/services/weapons.js
// Lee armas y sus rangos desde Supabase para la Guía de Armas.

import { supabase } from './supabase.js';

/**
 * Busca armas PUBLICADAS por nombre (para el autocompletado del
 * comando /screenshot). Limita a 25 resultados — es el máximo
 * que Discord permite mostrar en una lista de autocompletado.
 * @param {string} query - texto parcial escrito por el usuario
 * @returns {Array<{id, name}>}
 */
export async function searchWeaponsByName(query) {
  let req = supabase
    .from('weapons')
    .select('id, name')
    .eq('published', true)
    .order('name', { ascending: true })
    .limit(25);

  if (query && query.trim() !== '') {
    req = req.ilike('name', `%${query.trim()}%`);
  }

  const { data, error } = await req;
  if (error) {
    console.error('[Weapons] Error buscando armas:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Carga una arma completa: ficha + categoría + tipo + todos sus
 * rangos (ordenados), listos para renderizar.
 * @param {string} weaponId
 */
export async function loadWeaponWithRanks(weaponId) {
  const [weaponRes, ranksRes] = await Promise.all([
    supabase.from('weapons').select('*').eq('id', weaponId).single(),
    supabase.from('weapon_ranks').select('*').eq('weapon_id', weaponId).order('sort_order', { ascending: true }),
  ]);

  if (weaponRes.error) throw new Error(`[Weapons] Error cargando arma: ${weaponRes.error.message}`);
  if (ranksRes.error) throw new Error(`[Weapons] Error cargando rangos: ${ranksRes.error.message}`);

  const weapon = weaponRes.data;
  let category = null;
  let type = null;

  const [catRes, typeRes] = await Promise.all([
    weapon.category_id
      ? supabase.from('weapon_categories').select('*').eq('id', weapon.category_id).single()
      : Promise.resolve({ data: null }),
    weapon.type_id
      ? supabase.from('weapon_types').select('*').eq('id', weapon.type_id).single()
      : Promise.resolve({ data: null }),
  ]);
  category = catRes.data || null;
  type = typeRes.data || null;

  return { weapon, category, type, ranks: ranksRes.data || [] };
}

/**
 * Carga todas las armas publicadas junto con su categoría y tipo.
 * Opcionalmente filtra por category_id o type_id.
 * @param {{ categoryId?: string, typeId?: string }} filters
 */
export async function loadWeaponCatalog({ categoryId, typeId } = {}) {
  let req = supabase
    .from('weapons')
    .select('*')
    .eq('published', true)
    .order('sort_order', { ascending: true });

  if (categoryId) req = req.eq('category_id', categoryId);
  if (typeId)     req = req.eq('type_id', typeId);

  const [weaponsRes, catsRes, typesRes] = await Promise.all([
    req,
    supabase.from('weapon_categories').select('*').order('sort_order', { ascending: true }),
    supabase.from('weapon_types').select('*').order('sort_order', { ascending: true }),
  ]);

  if (weaponsRes.error) throw new Error(`[Weapons] Error catálogo: ${weaponsRes.error.message}`);

  const catsById  = new Map((catsRes.data  || []).map(c => [c.id, c]));
  const typesById = new Map((typesRes.data || []).map(t => [t.id, t]));

  const weapons = (weaponsRes.data || []).map(w => ({
    ...w,
    categoryLabel: w.category_id ? (catsById.get(w.category_id)?.label || null) : null,
    categoryColor: w.category_id ? (catsById.get(w.category_id)?.color || null) : null,
    typeLabel:     w.type_id     ? (typesById.get(w.type_id)?.label  || null) : null,
  }));

  return {
    weapons,
    categories: catsRes.data  || [],
    types:      typesRes.data || [],
  };
}
