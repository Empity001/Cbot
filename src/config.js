// src/config.js
// Configuración centralizada. El bot trabaja con un único servidor oficial.

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_GUILD_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
];

function positiveNumber(value, fallback, minimum = 1) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
}

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[Config] ❌ Falta la variable de entorno: ${key}`);
    process.exit(1);
  }
}

export const config = {
  discord: {
    token: process.env.DISCORD_TOKEN,
    clientId: process.env.DISCORD_CLIENT_ID,
    guildId: process.env.DISCORD_GUILD_ID,
    alertChannelId: String(process.env.BOT_ALERT_CHANNEL_ID || '').trim() || null,
  },
  supabase: {
    url: process.env.SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  siteUrl: (process.env.SITE_URL || 'https://empity001.github.io/culones-rpg/').replace(/\/+$/, ''),
  worker: {
    pollIntervalMs: positiveNumber(process.env.GUIDE_JOB_POLL_MS, 15000, 5000),
    maxJobAttempts: positiveNumber(process.env.GUIDE_JOB_MAX_ATTEMPTS, 5, 1),
  },
  alerts: {
    cooldownMs: positiveNumber(process.env.BOT_ALERT_COOLDOWN_MS, 6 * 60 * 60 * 1000, 60_000),
  },
};
