-- sql/migration_discord_publications.sql
-- =========================================================
-- Tabla de persistencia de publicaciones de Discord.
-- Separa los IDs de Discord de la tabla `logs` para evitar
-- que guardar un message_id dispare nuevamente el watcher
-- de Realtime (que escucha INSERT/UPDATE en `logs`).
--
-- Ejecuta en: Supabase Dashboard → SQL Editor → New query
-- Es seguro correr más de una vez (usa IF NOT EXISTS).
-- =========================================================

-- ---------------------------------------------------------
-- 1) TABLA: log_discord_publications
--    Una fila por log publicado. Se upsertea cada vez que
--    el bot publica o sincroniza un log.
-- ---------------------------------------------------------
create table if not exists public.log_discord_publications (
  log_id             uuid primary key references public.logs (id) on delete cascade,
  channel_id         text not null,
  summary_message_id text not null,
  thread_id          text,
  page_message_ids   jsonb not null default '[]'::jsonb,  -- array ordenado de IDs de mensajes de páginas
  updated_at         timestamptz not null default now()
);

-- Índice para lookup rápido por thread_id (para editar páginas)
create index if not exists log_discord_pubs_thread_idx
  on public.log_discord_publications (thread_id);

-- ---------------------------------------------------------
-- 2) RLS: solo el service_role (el bot) puede tocar esto.
--    La web no necesita ni saber que existe esta tabla.
-- ---------------------------------------------------------
alter table public.log_discord_publications enable row level security;

drop policy if exists "discord_pubs_no_public" on public.log_discord_publications;
create policy "discord_pubs_no_public"
  on public.log_discord_publications for all
  to anon, authenticated
  using (false)
  with check (false);

-- ---------------------------------------------------------
-- 3) Compatibilidad con logs anteriores que tenían
--    discord_message_id directamente en la tabla logs.
--    Si esa columna existe, la añadimos al historial como
--    publicaciones sin hilo (para que el bot pueda editarlos
--    la próxima vez que se actualicen).
--
--    NOTA: esta sección es segura — si la columna no existe,
--    el DO block simplemente no hace nada.
-- ---------------------------------------------------------
do $$
declare
  col_exists boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name   = 'logs'
      and column_name  = 'discord_message_id'
  ) into col_exists;

  if col_exists then
    -- Migrar los message IDs existentes a la nueva tabla.
    -- channel_id se deja vacío ('') porque no lo tenemos guardado;
    -- el bot lo completará la próxima vez que edite el log.
    insert into public.log_discord_publications (log_id, channel_id, summary_message_id, thread_id, page_message_ids)
    select
      id,
      '',                  -- channel_id desconocido en el legacy
      discord_message_id,
      null,                -- sin hilo todavía
      '[]'::jsonb
    from public.logs
    where discord_message_id is not null
    on conflict (log_id) do nothing;

    raise notice 'Migración de discord_message_id completada.';
  else
    raise notice 'Columna discord_message_id no existe en logs — nada que migrar.';
  end if;
end $$;
