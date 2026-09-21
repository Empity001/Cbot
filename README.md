# Culones RPG — Bot de Discord

Bot exclusivo del servidor oficial de Culones RPG. Conecta Discord con la web y Supabase: publica Logs, sincroniza Guías con un foro, genera screenshots y valida el rol que permite administrar la página.

## Comandos

| Comando | Uso | Permiso |
|---|---|---|
| `/buscar consulta:<texto>` | Busca contenido publicado y devuelve enlaces exactos a la web | Cualquiera |
| `/screenshot tierlist` | Genera la Tierlist completa o una columna | Cualquiera |
| `/screenshot guias` | Genera el catálogo de Guías | Cualquiera |
| `/screenshot guia` | Genera una imagen por rango | Cualquiera |
| `/screenshot kits` | Genera los Kits recomendados | Cualquiera |
| `/screenshot logs` | Genera la lista o el detalle de un Log | Cualquiera |
| `/config` | Abre el panel privado de configuración, estado y recuperación | Propietario o `Administrator` |

`/getcode`, `/ping` y `/estado` ya no existen como comandos separados. El acceso administrativo se realiza desde la web mediante Discord OAuth y el rol elegido en **`/config` → Acceso**. El diagnóstico está en **`/config` → Estado**.

## Panel único de configuración

`/config` responde de forma privada con una interfaz de botones y selectores. No hay familias de subcomandos con `set/view/clear`:

- **Canales** configura Logs, foro de Guías y alertas.
- **Acceso** configura el rol administrativo de la web.
- **Estado** ejecuta un diagnóstico puntual de Discord, Supabase, permisos y colas.
- **Recuperación** comprueba publicaciones y permite reintentar, con confirmación, trabajos de Guías agotados.

Las acciones vuelven a comprobar que el usuario sea propietario o tenga `Administrator`, incluso al pulsar botones antiguos. Las comprobaciones de integridad se deduplican: si el barrido de arranque, el horario o uno manual ya está en curso, cualquier otra solicitud se une a la misma operación.

## Logs automáticos

Cada Log produce:

1. Un resumen en el canal configurado, con portada solo cuando el Log tenga una.
2. Un hilo público de solo lectura.
3. Un mensaje independiente por mob.
4. Un mensaje independiente por item.
5. Un mensaje independiente por Extra.
6. Un mensaje final con enlace a la web.

Cada elemento enlaza al punto exacto de la página mediante `log`, `tab` y `entry`. La web selecciona el Log, abre la pestaña, despliega la ficha, hace scroll y la resalta.

El bot guarda un `message_map` y un `message_order` persistentes. Al editar el contenido:

- una sincronización fallida se reintenta hasta tres veces con espera incremental;
- el barrido de integridad recupera publicaciones dañadas y Logs públicos que nunca alcanzaron a crear su primer mapeo;
- el contenido extenso se divide por elemento y continuación respetando los límites de Discord.
- Edita mensajes existentes por ID de elemento.
- Crea los nuevos.
- Elimina los que ya no existen.
- Reconstruye mensajes, hilos o resúmenes borrados.
- Agrupa eventos cercanos sin perder la edición más reciente.

## Foro de Guías

La publicación en la web y en Discord son estados separados. Desde la web, un administrador puede:

- **Publicar en foro**.
- **Actualizar en foro** cuando el contenido cambie.
- **Despublicar del foro**.
- **Volver a publicar** cuando el post se haya eliminado manualmente.

Cada Guía crea una sola publicación con todos sus rangos. El bot organiza información general, descripciones, estadísticas, habilidades, recursos, Mesas de trabajo y Extras en mensajes separados. Secciones largas se dividen en continuaciones.

Las publicaciones usan dos etiquetas:

- `C · Categoría`
- `T · Tipo`

El bot crea y reutiliza las etiquetas por ID. Si el foro alcanza su límite, la publicación falla con un mensaje explicativo en la web.

La cola `guide_forum_jobs` es duradera e idempotente. Si Railway se reinicia, los trabajos pendientes continúan y los que quedaron interrumpidos se recuperan.

## Salud, reintentos y alertas

- Al iniciar, el bot ejecuta un único diagnóstico de Discord, Supabase, rol, canales, permisos y cola. No crea un sondeo de salud permanente.
- **`/config` → Estado** repite el diagnóstico solo cuando un administrador lo solicita.
- Una sincronización de Log se reintenta tres veces con espera incremental; si se agota, el bot alerta y el barrido de integridad conserva una vía posterior de recuperación.
- Los trabajos del foro respetan `GUIDE_JOB_MAX_ATTEMPTS`. Cuando un trabajo llega al límite o la cola falla tres revisiones seguidas, se genera una alerta deduplicada.
- El canal privado de alertas se elige en **`/config` → Canales → Alertas**. `BOT_ALERT_CHANNEL_ID` queda como respaldo de compatibilidad hasta aplicar la migración nueva. Sin canal, el bot intenta avisar por DM al dueño del servidor.
- La configuración del servidor usa una caché compartida de 30 segundos para evitar lecturas repetidas desde el panel y los workers; cualquier cambio actualiza esa caché inmediatamente.
- Railway cierra Realtime y Discord limpiamente al enviar `SIGTERM` o `SIGINT`.

## Búsqueda pública

`/buscar` consulta únicamente cuando alguien ejecuta el comando. Busca coincidencias publicadas en Guías y rangos, Logs y sus fichas, Tierlist y Kits. Cada fuente tiene límites independientes y el resultado combinado muestra como máximo diez enlaces. No utiliza autocomplete para evitar consultas por cada tecla escrita.


## Recuperación ante borrados manuales

El bot escucha eliminaciones de mensajes e hilos y también ejecuta una comprobación de integridad al iniciar y cada hora:

- Un mensaje interno de una Guía borrado marca la publicación como desactualizada para que **Actualizar en foro** lo reconstruya.
- Una publicación de Guía eliminada cambia a estado **lost** y muestra **Volver a publicar**.
- Un resumen, hilo o mensaje interno de Log eliminado se reconstruye automáticamente.
- Los borrados intencionales realizados por el propio bot se suprimen temporalmente para no iniciar una recuperación falsa.

## Imágenes y pixel art

Las imágenes estáticas de hasta 64×64 se tratan como pixel art:

- Escalado a 256×256.
- Nearest-neighbor.
- Sin antialiasing.
- Fondo transparente.
- Conserva proporción.

La imagen escalada se adjunta directamente a Discord; no se almacena permanentemente en Supabase ni en Railway. Las imágenes grandes se envían sin ese tratamiento.

Las Mesas de trabajo se renderizan como interfaces visuales de Minecraft, acompañadas por una versión textual de materiales y cantidades.

## Sistema visual de Discord

Las publicaciones automáticas comparten una composición visual única y toman sus colores del tema configurado en la web:

- Los Logs comienzan con un resumen compacto y continúan con fichas separadas para mobs, items y Extras.
- Las imágenes de fichas se muestran como miniaturas para conservar una lectura rápida; las portadas y recursos visuales mantienen formato panorámico.
- Las Guías separan claramente cada rango y organizan descripción, estadísticas, habilidades, recursos y fabricación por bloques.
- Los métodos de fabricación conservan la lectura de Minecraft dentro de un marco negro, morado y dorado propio de Culones RPG.
- Mesa de crafteo, horno normal, alto horno, ahumador, mesa de herrería e intercambio tienen composiciones específicas.
- El resultado de cada receta usa un slot destacado y la versión textual conserva cantidades y enlaces a Guías relacionadas.
- Los textos extensos se dividen en continuaciones sin superar los límites de Discord.

## Screenshots

Los renderizadores usan una temática oscura y morada coherente con el rebranding de la web. Los resultados compartibles se envían públicamente con un texto como:

> @Usuario solicitó el detalle del Log «Cumpleaños».

La interacción privada se usa solo mientras se procesa y se elimina al terminar. Los errores sí permanecen privados. Si una Guía genera más de diez imágenes, se divide en varios mensajes sin repetir el ping.

## Reacciones del foro

Discord permite una reacción nativa predeterminada por foro, pero Culones RPG admite hasta 20 reacciones configuradas desde Herramientas. El bot las coloca en el primer mensaje de cada publicación. Se pueden aplicar a posts existentes mediante la cola, respetando rate limits.

## Arquitectura

```text
src/
├── commands/
│   ├── config.js
│   ├── buscar.js
│   └── screenshot.js
├── events/
│   ├── interactionCreate.js
│   ├── messageDelete.js
│   ├── threadDelete.js
│   └── ready.js
├── services/
│   ├── audit.js
│   ├── botConfig.js
│   ├── botHealth.js
│   ├── discordConfiguration.js
│   ├── adminAlerts.js
│   ├── deletionSuppressor.js
│   ├── guideForumWorker.js
│   ├── logPublication.js
│   ├── logWatcher.js
│   ├── publicationRecovery.js
│   ├── siteTheme.js
│   └── ...lectores de Supabase
└── utils/
    ├── configPanel.js
    ├── guideForumEmbeds.js
    ├── logMessages.js
    ├── mediaAttachments.js
    ├── renderWorkbench.js
    └── ...renderizadores Canvas
```

La migración compartida está en:

```text
sql/migration_021_discord_auth_and_forum.sql
sql/migration_022_log_visibility.sql
sql/migration_023_bot_config_panel.sql
```

## Variables de entorno

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SITE_URL=https://empity001.github.io/culones-rpg/
GUIDE_JOB_POLL_MS=15000
GUIDE_JOB_MAX_ATTEMPTS=5
BOT_ALERT_CHANNEL_ID=
BOT_ALERT_COOLDOWN_MS=21600000
```

No uses `AUTHORIZED_USER_IDS`. No incluyas el token, el Client Secret ni la service role en GitHub.

## Instalación

Requiere Node.js 22 o posterior. Railway lo selecciona desde `package.json`.

```bash
npm install
npm run deploy
npm start
```

`npm run deploy` registra todos los comandos en el servidor indicado por `DISCORD_GUILD_ID` y reemplaza el conjunto anterior. Tras actualizar a `bot-config-panel-02`, este paso retira `/ping`, `/estado` y los subcomandos anteriores de `/config`; quedan únicamente `/config`, `/buscar` y `/screenshot`.

Antes de desplegar, ejecuta `sql/migration_023_bot_config_panel.sql` en Supabase. Añade el canal de alertas a la configuración persistente. Configurar Logs y Guías desde el panel requiere que el bot tenga **Gestionar roles**, porque Discord usa ese permiso para editar los overwrites, además de los permisos de canal indicados en el diagnóstico.

Después del primer despliegue abre `/config` y completa **Canales** y **Acceso** con sus selectores.

Consulta `GUIA_DESPLIEGUE_DISCORD_AUTH.md` en el proyecto web para el orden completo de Supabase Auth, Edge Functions, SQL, Railway y GitHub Pages.

## Validación

Antes de desplegar:

```bash
npm ci
npm ls --depth=0
find src -name '*.js' -print0 | xargs -0 -n1 node --check
npm audit
```

El flujo automático activo se construye en `src/utils/logMessages.js`. `src/utils/embeds.js` contiene solo las respuestas genéricas de comandos; la implementación legacy de embeds monolíticos fue retirada.

El bot solicita `Guilds` y `GuildMessages`. `GuildMessages` se usa únicamente para recibir eventos de eliminación y recuperar mensajes o hilos propios; no lee el contenido de los mensajes. No necesita ni solicita `Message Content`.

### Visibilidad de Logs

Ejecuta `sql/migration_022_log_visibility.sql`. Los anuncios nuevos mencionan `@everyone` usando la bandera silenciosa de Discord, y el watcher elimina de Discord los Logs despublicados.
