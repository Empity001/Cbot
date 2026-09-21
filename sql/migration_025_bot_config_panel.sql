-- Culones RPG · Panel único de configuración del bot.
-- Añade el canal administrable de alertas. Seguro para ejecutar varias veces.

alter table public.discord_guild_config
  add column if not exists alert_channel_id text;

comment on column public.discord_guild_config.alert_channel_id is
  'Canal privado donde el bot envía alertas operativas; null usa DM al propietario.';
