// src/index.js
// Punto de entrada del bot.
// Carga comandos y eventos automáticamente desde sus carpetas
// — para agregar algo nuevo, solo crea el archivo, no hay que tocar este archivo.

import { Client, GatewayIntentBits, Collection, Partials } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';

// Cargar config primero (valida variables de entorno)
import { config } from './config.js';
import { supabase } from './services/supabase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Cliente de Discord ─────────────────────────────────────────────────────────
const client = new Client({
  // GuildMessages se usa únicamente para detectar eliminaciones y recuperar
  // publicaciones propias. No se solicita MessageContent.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  partials: [Partials.Channel, Partials.Message],
});

// Colección de comandos disponibles
client.commands = new Collection();

// ── Cargar Comandos ────────────────────────────────────────────────────────────
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = pathToFileURL(join(commandsPath, file)).href;
  const command = await import(filePath);

  if ('data' in command && 'execute' in command) {
    client.commands.set(command.data.name, command);
    console.log(`[Commands] Cargado: /${command.data.name}`);
  }
}

// ── Cargar Eventos ─────────────────────────────────────────────────────────────
const eventsPath = join(__dirname, 'events');
const eventFiles = readdirSync(eventsPath).filter((f) => f.endsWith('.js'));

for (const file of eventFiles) {
  const filePath = pathToFileURL(join(eventsPath, file)).href;
  const event = await import(filePath);

  if (event.once) {
    client.once(event.name, (...args) => event.execute(...args));
  } else {
    client.on(event.name, (...args) => event.execute(...args));
  }
  console.log(`[Events] Cargado: ${event.name}`);
}

// ── Manejo global de errores no capturados ────────────────────────────────────
process.on('unhandledRejection', (err) => {
  console.error('[Process] unhandledRejection:', err);
});
process.on('uncaughtException', (err) => {
  console.error('[Process] uncaughtException:', err);
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Process] ${signal}: cerrando conexiones…`);
  const forceExit = setTimeout(() => process.exit(1), 8_000);
  forceExit.unref?.();
  try {
    await supabase.removeAllChannels();
    client.destroy();
    clearTimeout(forceExit);
    process.exit(0);
  } catch (error) {
    console.error('[Process] Error durante el cierre:', error);
    process.exit(1);
  }
}

process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

// ── Conectar ──────────────────────────────────────────────────────────────────
client.login(config.discord.token);
