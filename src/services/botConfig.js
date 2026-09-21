// src/services/botConfig.js
// Configuración persistente del único servidor oficial.

import { supabase } from './supabase.js';
import { config } from '../config.js';

const TABLE = 'discord_guild_config';
const CACHE_MS = 30_000;
let cached = null;
let cachedAt = 0;
let loading = null;
let mutationVersion = 0;

export async function getGuildConfig({ force = false } = {}) {
  if (!force && cachedAt && Date.now() - cachedAt < CACHE_MS) return cached;
  if (loading) return loading;

  const readVersion = mutationVersion;
  loading = (async () => {
    const { data, error } = await supabase
      .from(TABLE)
      .select('*')
      .eq('guild_id', config.discord.guildId)
      .maybeSingle();

    if (error) throw new Error(`[BotConfig] Error leyendo configuración: ${error.message}`);
    // Una escritura que comenzó después de esta lectura tiene prioridad. Así
    // una respuesta lenta nunca pisa el valor que acaba de guardar /config.
    if (readVersion === mutationVersion) {
      cached = data || null;
      cachedAt = Date.now();
      return cached;
    }
    return data || null;
  })().finally(() => { loading = null; });
  return loading;
}

export async function updateGuildConfig(patch = {}) {
  mutationVersion += 1;
  const row = {
    guild_id: config.discord.guildId,
    ...patch,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(row, { onConflict: 'guild_id' })
    .select('*')
    .single();
  if (error) throw new Error(`[BotConfig] Error guardando configuración: ${error.message}`);
  cached = data;
  cachedAt = Date.now();
  return cached;
}

// La columna de alertas pertenece al panel nuevo. En instalaciones que aún no
// ejecutaron su migración se conserva BOT_ALERT_CHANNEL_ID como compatibilidad.
export function resolveAlertChannelId(guildConfig) {
  if (guildConfig && Object.prototype.hasOwnProperty.call(guildConfig, 'alert_channel_id')) {
    return String(guildConfig.alert_channel_id || '').trim() || null;
  }
  return config.discord.alertChannelId;
}
