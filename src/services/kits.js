// src/services/kits.js
// Lee los kits recomendados desde Supabase para el comando /screenshot kits.
// Misma tabla que usa la web (sql/migration_016_kits.sql): `kits`, con
// RLS que solo deja ver filas `published = true` a la key anon — igual
// que hace la web para usuarios no-admin, así que un simple select directo
// alcanza (no hace falta pasar por el RPC list_kits, que además necesita
// input_code para traer los no publicados).

import { supabase } from './supabase.js';

export const KIT_COLUMNS = [
  { key: 'weapon',     label: 'Arma' },
  { key: 'accessory',  label: 'Accesorio' },
  { key: 'subweapon',  label: 'Sub-arma' },
];

function normalizeKitItems(items) {
  const source = items && typeof items === 'object' && !Array.isArray(items) ? items : {};
  const normalized = {};
  for (const column of KIT_COLUMNS) {
    const list = Array.isArray(source[column.key]) ? source[column.key] : [];
    normalized[column.key] = list
      .map((item) => ({
        name: String(item?.name || '').trim(),
        image_url: String(item?.image_url || '').trim(),
      }))
      .filter((item) => item.name || item.image_url);
  }
  return normalized;
}

/**
 * Carga todos los kits publicados, ordenados igual que la web
 * (sort_order, created_at).
 * @returns {Array<{id, name, description, items}>}
 */
export async function loadKits() {
  const { data, error } = await supabase
    .from('kits')
    .select('*')
    .eq('published', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw new Error(`[Kits] Error cargando kits: ${error.message}`);

  return (data || []).map((kit) => ({
    ...kit,
    items: normalizeKitItems(kit.items),
  }));
}
