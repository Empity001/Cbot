import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { renderConfigMain, handleConfigComponent } from '../utils/configPanel.js';
import { buildErrorEmbed } from '../utils/embeds.js';
import { requireOwnerOrAdministrator } from '../utils/permissions.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('Abre el panel administrativo del bot y la página')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator);

export async function execute(interaction) {
  if (!(await requireOwnerOrAdministrator(interaction, buildErrorEmbed))) return;
  await interaction.deferReply({ ephemeral: true });
  await interaction.editReply(await renderConfigMain(interaction));
}

export const handleComponent = handleConfigComponent;
