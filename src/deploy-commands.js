// src/deploy-commands.js
// Corre este script UNA VEZ (o cuando cambies los comandos) para registrarlos en Discord.
// npm run deploy
//
// Los comandos se registran en el guild específico (DISCORD_GUILD_ID) para que aparezcan
// al instante. Para comandos globales habría que cambiar la ruta a /applications/:id/commands
// pero los globales tardan hasta 1 hora en propagarse.

import { REST, Routes } from 'discord.js';
import { readdirSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { config } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const commands = [];
const commandsPath = join(__dirname, 'commands');
const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = pathToFileURL(join(commandsPath, file)).href;
  const command = await import(filePath);
  if ('data' in command) {
    commands.push(command.data.toJSON());
    console.log(`[Deploy] Preparando: /${command.data.name}`);
  }
}

const rest = new REST().setToken(config.discord.token);

try {
  console.log(`[Deploy] Registrando ${commands.length} comando(s) en el guild ${config.discord.guildId}...`);

  const data = await rest.put(
    Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
    { body: commands }
  );

  console.log(`[Deploy] ✅ ${data.length} comando(s) registrados exitosamente.`);
} catch (err) {
  console.error('[Deploy] Error:', err);
}
