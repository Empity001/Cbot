import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { searchPublicContent } from '../services/search.js';
import { getRenderPalette } from '../services/siteTheme.js';

export const data = new SlashCommandBuilder()
  .setName('buscar')
  .setDescription('Busca Guías, Logs, Tierlist y Kits publicados')
  .addStringOption(option => option
    .setName('consulta')
    .setDescription('Nombre del objeto, arma, mob, Log o Kit')
    .setMinLength(2)
    .setMaxLength(80)
    .setRequired(true));

function colorInt(value) {
  const parsed = Number.parseInt(String(value || '').replace('#', ''), 16);
  return Number.isFinite(parsed) ? parsed : 0x8b3dff;
}

function safeLinkText(value) {
  return String(value || '').replace(/[\[\]]/g, '').slice(0, 120) || 'Sin nombre';
}

function shortText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > 150 ? `${text.slice(0, 149)}…` : text;
}

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const response = await searchPublicContent(interaction.options.getString('consulta', true));
  const theme = getRenderPalette();
  const embed = new EmbedBuilder()
    .setColor(colorInt(theme.primary))
    .setTitle(`🔎 Resultados para “${response.query || 'consulta'}”`)
    .setTimestamp();

  if (response.tooShort) {
    embed.setDescription('Escribe al menos dos caracteres útiles para buscar.');
  } else if (!response.results.length) {
    embed.setDescription('No encontré coincidencias publicadas en Guías, Logs, Tierlist o Kits.');
  } else {
    embed.setDescription(response.results.map(result => {
      const detail = shortText(result.description);
      return `**${result.kind}** · [${safeLinkText(result.title)}](${result.url})${detail ? `\n-# ${detail}` : ''}`;
    }).join('\n\n'));
    embed.setFooter({ text: `${response.results.length} resultado${response.results.length === 1 ? '' : 's'} · búsqueda bajo demanda` });
  }

  await interaction.editReply({ embeds: [embed] });
}
