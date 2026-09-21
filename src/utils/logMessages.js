import { EmbedBuilder, MessageFlags } from 'discord.js';
import { splitItems, parseLibreFields, formatEquipmentForCanvas, formatSourceForCanvas } from './libreFields.js';
import { prepareDiscordImage } from './mediaAttachments.js';
import {
  cleanText,
  discordColor,
  makeBrandedEmbed,
  splitDiscordText,
  truncateText,
} from './discordPresentation.js';
import { config } from '../config.js';
import { getRenderPalette } from '../services/siteTheme.js';

const RELEVANCE_LABEL = { low: 'Baja', normal: 'Normal', high: 'Alta', critical: 'Crítica' };

function relevanceColor(relevance) {
  const theme = getRenderPalette();
  const colors = {
    low: theme.muted,
    normal: theme.primary,
    high: theme.warning,
    critical: theme.danger,
  };
  return discordColor(colors[relevance], theme.primary);
}

function baseUrl(logId, tab = null, entry = null) {
  let url = `${config.siteUrl}/index.html?log=${encodeURIComponent(logId)}`;
  if (tab) url += `&tab=${encodeURIComponent(tab)}`;
  if (entry) url += `&entry=${encodeURIComponent(entry)}`;
  return url;
}

function linesFromExtras(extraFields) {
  const source = Array.isArray(extraFields) ? extraFields : [];
  return source.flatMap(field => {
    const key = cleanText(field?.key || field?.label || field?.name);
    const value = cleanText(field?.value ?? field?.text ?? field?.content);
    if (!key && !value) return [];
    return [key ? `> **${key}:** ${value || '—'}` : `> ${value}`];
  });
}

function detailSection(lines) {
  const visible = lines.filter(Boolean);
  return visible.length ? visible.join('\n') : '_Sin información adicional._';
}

async function makeSpecs({ keyBase, eyebrow, title, color, descriptionLines, imageUrl, imageName, url, footer }) {
  const chunks = splitDiscordText(descriptionLines.filter(Boolean).join('\n'));
  const image = imageUrl ? await prepareDiscordImage(imageUrl, imageName) : null;
  return (chunks.length ? chunks : ['_Sin información adicional._']).map((chunk, index) => {
    const continued = index > 0;
    const embed = makeBrandedEmbed({
      color,
      title: continued ? `${title} · continuación ${index + 1}` : title,
      description: continued ? chunk : `${eyebrow ? `-# ${eyebrow}\n` : ''}${chunk}`,
      url,
      footer,
    });
    const files = [];
    if (!continued && image?.attachment) {
      embed.setThumbnail(image.imageRef);
      files.push(image.attachment);
    }
    return {
      key: continued ? `${keyBase}:${index + 1}` : keyBase,
      embeds: [embed],
      files,
      imageHash: !continued ? image?.hash || null : null,
      warning: image?.error ? `No se pudo cargar la imagen: ${image.error.message}` : null,
    };
  });
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function buildLogMessageSpecs(log, category, mobs = [], items = []) {
  const color = relevanceColor(log.relevance);
  const catEmoji = category?.emoji || '📋';
  const catLabel = category?.label || log.category || 'Sin categoría';
  const { normalItems, libres } = splitItems(items);
  const summaryUrl = baseUrl(log.id);
  const cover = log.cover_image_url ? await prepareDiscordImage(log.cover_image_url, `log-${log.id}-cover`) : null;
  const createdAt = validDate(log.created_at);

  const summary = makeBrandedEmbed({
    color,
    title: `${catEmoji} ${log.title}`,
    description: `${truncateText(log.description || 'Sin descripción.', 1200)}\n\n[LEER LOG COMPLETO ↗](${summaryUrl})`,
    url: summaryUrl,
    footer: `Culones RPG · Logs · ${catLabel}`,
    timestamp: validDate(log.updated_at || log.created_at),
  }).addFields(
    { name: 'Categoría', value: `${catEmoji} ${truncateText(catLabel, 950)}`, inline: true },
    { name: 'Relevancia', value: RELEVANCE_LABEL[log.relevance] || cleanText(log.relevance) || 'Normal', inline: true },
    { name: 'Publicado', value: createdAt ? `<t:${Math.floor(createdAt.getTime() / 1000)}:f>` : 'Sin fecha', inline: true },
    { name: 'Contenido', value: `👾 ${mobs.length} mobs\n⚔️ ${normalItems.length} items\n✦ ${libres.length} extras`, inline: true },
    { name: 'Comunidad', value: `❤️ ${Number(log.likes || 0)} likes`, inline: true },
    { name: 'Navegación', value: 'Cada ficha incluye un enlace directo a su bloque en la web.', inline: true },
  );

  const summaryFiles = [];
  if (cover?.attachment) {
    summary.setImage(cover.imageRef);
    summaryFiles.push(cover.attachment);
  }

  const entries = [];

  for (const mob of mobs) {
    const stats = [];
    if (mob.health != null) stats.push(`❤️ **Vida:** ${mob.health}`);
    if (mob.damage != null) stats.push(`⚔️ **Daño:** ${mob.damage}`);
    if (mob.armor != null) stats.push(`🛡️ **Armadura:** ${mob.armor}`);
    const equipment = formatEquipmentForCanvas(mob.equipment);
    const url = baseUrl(log.id, 'mobs', mob.id);
    const lines = [
      stats.length ? stats.join(' · ') : '',
      mob.location ? `📍 **Ubicación:** ${mob.location}` : '',
      equipment ? `🎒 **Equipamiento:** ${equipment}` : '',
      mob.description ? `\n${mob.description}` : '',
      ...linesFromExtras(mob.extra_fields),
      `\n[VER MOB EN LA WEB ↗](${url})`,
    ];
    entries.push(...await makeSpecs({
      keyBase: `mob:${mob.id}`,
      eyebrow: `MOB · ${catLabel}`,
      title: `👾 ${mob.name || 'Mob'}`,
      color,
      descriptionLines: lines,
      imageUrl: mob.image_url,
      imageName: `mob-${mob.id}`,
      url,
      footer: `Culones RPG · ${log.title} · Mobs`,
    }));
  }

  for (const item of normalItems) {
    const meta = [];
    if (item.item_type) meta.push(`**Tipo:** ${item.item_type}`);
    if (item.tier) meta.push(`**Rango:** ${item.tier}`);
    if (item.damage != null) meta.push(`**Daño:** ${item.damage}`);
    const enchants = Array.isArray(item.enchantments)
      ? item.enchantments
        .map(enchantment => typeof enchantment === 'string'
          ? enchantment
          : [enchantment?.name || enchantment?.id, enchantment?.level || enchantment?.lvl].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ')
      : '';
    const source = formatSourceForCanvas(item.obtained_from);
    const url = baseUrl(log.id, 'items', item.id);
    const lines = [
      meta.length ? `> ${meta.join(' · ')}` : '',
      enchants ? `✨ **Encantamientos:** ${enchants}` : '',
      source ? `📦 **Obtención:** ${source}` : '',
      item.description ? `\n${item.description}` : '',
      ...linesFromExtras(item.extra_fields),
      `\n[VER ITEM EN LA WEB ↗](${url})`,
    ];
    entries.push(...await makeSpecs({
      keyBase: `item:${item.id}`,
      eyebrow: `ITEM · ${catLabel}`,
      title: `⚔️ ${item.name || 'Item'}`,
      color,
      descriptionLines: lines,
      imageUrl: item.image_url,
      imageName: `item-${item.id}`,
      url,
      footer: `Culones RPG · ${log.title} · Items`,
    }));
  }

  for (const extra of libres) {
    const parsed = parseLibreFields(extra);
    const lines = [];
    for (const field of parsed) {
      const key = cleanText(field?.key);
      const value = cleanText(field?.value);
      if (key || value) lines.push(key ? `**${key}**\n${value || '—'}` : value);
      for (const sub of field?.subfields || []) {
        const subKey = cleanText(sub?.key);
        const subValue = cleanText(sub?.value);
        if (subKey || subValue) lines.push(`> ${subKey ? `**${subKey}:** ` : ''}${subValue || '—'}`);
      }
    }
    if (extra.description) lines.push(`\n${extra.description}`);
    const url = baseUrl(log.id, 'blocks', extra.id);
    lines.push(`\n[VER EXTRA EN LA WEB ↗](${url})`);
    entries.push(...await makeSpecs({
      keyBase: `extra:${extra.id}`,
      eyebrow: `EXTRA · ${catLabel}`,
      title: `✦ ${extra.name || 'Extra'}`,
      color,
      descriptionLines: [detailSection(lines)],
      imageUrl: extra.image_url,
      imageName: `extra-${extra.id}`,
      url,
      footer: `Culones RPG · ${log.title} · Extras`,
    }));
  }

  const footerEmbed = new EmbedBuilder()
    .setColor(color)
    .setDescription(`### FIN DEL LOG\nLa versión web conserva el contenido completo, las imágenes y los enlaces interactivos.\n\n[ABRIR ${truncateText(log.title, 80).toUpperCase()} ↗](${summaryUrl})`)
    .setFooter({ text: 'Culones RPG · Logs' });
  entries.push({ key: 'footer', embeds: [footerEmbed], files: [] });

  return {
    summary: {
      key: 'summary',
      content: '@everyone',
      embeds: [summary],
      files: summaryFiles,
      imageHash: cover?.hash || null,
      allowedMentions: { parse: ['everyone'] },
      flags: MessageFlags.SuppressNotifications,
    },
    entries,
  };
}
