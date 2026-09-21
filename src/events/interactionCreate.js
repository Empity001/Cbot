// src/events/interactionCreate.js
// Recibe todas las interacciones y las despacha al comando correspondiente.

import { Events } from 'discord.js';
import { buildErrorEmbed } from '../utils/embeds.js';

export const name = Events.InteractionCreate;
export const once = false;

export async function execute(interaction) {
  // ── Autocompletado (ej: /screenshot guia nombre:<escribiendo...>) ───────
  if (interaction.isAutocomplete()) {
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command || typeof command.autocomplete !== 'function') return;
    try {
      await command.autocomplete(interaction);
    } catch (err) {
      console.error(`[Interaction] Error en autocomplete de /${interaction.commandName}:`, err);
      // Discord requiere una respuesta aunque sea vacía, o el autocompletado queda colgado.
      await interaction.respond([]).catch(() => {});
    }
    return;
  }

  // El panel de /config vive en un único mensaje efímero y navega mediante
  // botones/selectores. Se enruta antes de los comandos de chat.
  if (interaction.isMessageComponent()) {
    if (!interaction.customId?.startsWith('config:')) return;
    const command = interaction.client.commands.get('config');
    if (!command || typeof command.handleComponent !== 'function') return;
    try {
      await command.handleComponent(interaction);
    } catch (err) {
      console.error('[Interaction] Error en el panel de /config:', err);
      const errEmbed = buildErrorEmbed('Ocurrió un error al usar el panel. Abre `/config` de nuevo e inténtalo otra vez.');
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[Interaction] Comando desconocido: ${interaction.commandName}`);
    return;
  }

  try {
    await command.execute(interaction);
  } catch (err) {
    console.error(`[Interaction] Error en /${interaction.commandName}:`, err);
    const errEmbed = buildErrorEmbed('Ocurrió un error al ejecutar el comando. Intenta de nuevo.');

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
    } else {
      await interaction.reply({ embeds: [errEmbed], ephemeral: true }).catch(() => {});
    }
  }
}
