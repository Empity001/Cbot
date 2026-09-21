# Deploy `bot-reliability-01`

> Entrega histórica. Para la versión actual usa `DEPLOY_BOT_CONFIG_PANEL_02.md`.

Esta entrega añade `/buscar`, `/estado`, diagnóstico de arranque, alertas administrativas, caché de configuración y cierre limpio. No modifica tablas ni requiere SQL nuevo.

Requiere Node.js 22 o posterior; Railway leerá esta versión desde `package.json`.

## 1. Variables de Railway

Se conservan todas las actuales. Opcionalmente añade:

```env
BOT_ALERT_CHANNEL_ID=ID_DE_UN_CANAL_PRIVADO
BOT_ALERT_COOLDOWN_MS=21600000
```

Si `BOT_ALERT_CHANNEL_ID` queda vacío, el bot intenta enviar las alertas por DM al propietario del servidor. El enfriamiento predeterminado es de seis horas por tipo de incidencia.

## 2. Registrar los comandos

Con las mismas variables de Discord y Supabase disponibles:

```bash
npm ci
npm run deploy
```

Este paso es obligatorio una vez porque añade `/buscar` y `/estado` al servidor.

## 3. Desplegar en Railway

Sube el proyecto y reinicia/redeploya el servicio. El comando de inicio continúa siendo:

```bash
npm start
```

## 4. Comprobación rápida

1. Revisa el arranque de Railway: debe aparecer una línea `[Health]`.
2. Ejecuta `/estado` con el rol administrativo.
3. Ejecuta `/buscar consulta:oz astral` con una cuenta normal.
4. Confirma que el canal de alertas sea privado si configuraste `BOT_ALERT_CHANNEL_ID`.

No publiques `.env`, el token de Discord ni `SUPABASE_SERVICE_ROLE_KEY`.
