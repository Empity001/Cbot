# Deploy `bot-config-panel-02`

Esta entrega sustituye los subcomandos administrativos por un único panel privado en `/config`. También mueve el diagnóstico y la recuperación al panel, y retira `/ping` y `/estado` como comandos separados.

## 1. Base de datos

El esquema compartido vive en el repositorio web (`Crpg/supabase/migrations`) y ya incluye la columna `alert_channel_id` de `discord_guild_config`. Aplícalo desde ese repositorio con `supabase db push`.

## 2. Instalar y registrar comandos

Con las variables reales disponibles:

```bash
npm ci
npm run deploy
```

El registro reemplaza los comandos del servidor. El resultado esperado es:

- `/config`
- `/buscar`
- `/screenshot`

## 3. Desplegar en Railway

Sube el proyecto y reinicia o redeploya el servicio. El inicio continúa siendo:

```bash
npm start
```

## 4. Comprobación rápida

1. Abre `/config`; debe aparecer un único mensaje privado con cuatro botones.
2. Revisa **Canales** y configura Logs, Guías y, opcionalmente, Alertas.
3. Revisa **Acceso** y selecciona el rol administrativo de la web.
4. Abre **Estado** y confirma Discord, Supabase, permisos y cola.
5. Abre **Recuperación**. No pulses el reintento de cola salvo que existan trabajos agotados y ya hayas corregido su causa.
6. Ejecuta `/buscar consulta:oz astral` con una cuenta normal.

No publiques `.env`, `DISCORD_TOKEN` ni `SUPABASE_SERVICE_ROLE_KEY`.
