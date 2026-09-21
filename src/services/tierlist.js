// src/services/tierlist.js
// Lee filas, items y columnas de la tierlist desde Supabase.

import { supabase } from './supabase.js';

// Las 3 columnas fijas de la tierlist (igual que en la web)
export const TIER_COLUMNS = [
  { key: 'weapon',    label: 'Arma' },
  { key: 'subweapon', label: 'Sub-arma' },
  { key: 'accessory', label: 'Accesorio' },
];

/**
 * Carga todas las filas e items de la tierlist.
 * @returns {{ rows: Array, items: Array, columns: Array }}
 */
export async function loadTierlistData() {
  const [rowsRes, itemsRes] = await Promise.all([
    supabase.from('tierlist_rows').select('*').order('sort_order', { ascending: true }),
    supabase.from('tierlist_items').select('*').order('sort_order', { ascending: true }),
  ]);

  if (rowsRes.error) throw new Error(`[Tierlist] Error filas: ${rowsRes.error.message}`);
  if (itemsRes.error) throw new Error(`[Tierlist] Error items: ${itemsRes.error.message}`);

  return {
    rows:    rowsRes.data  || [],
    items:   itemsRes.data || [],
    columns: TIER_COLUMNS,
  };
}

/**
 * Filtra items por columna y agrupa por fila.
 * @param {Array} rows
 * @param {Array} items
 * @param {string} columnKey — 'weapon' | 'subweapon' | 'accessory'
 * @returns {Array<{ row, items }>}
 */
export function groupByRow(rows, items, columnKey) {
  return rows.map(row => ({
    row,
    items: items.filter(i => i.row_id === row.id && i.column_key === columnKey),
  }));
}
