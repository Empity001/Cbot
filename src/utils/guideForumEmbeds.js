import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { prepareDiscordImage } from './mediaAttachments.js';
import { renderWorkbenchMethod, recipeMethodText } from './renderWorkbench.js';
import {
  cleanText,
  discordColor,
  makeBrandedEmbed,
  splitDiscordText,
  truncateText,
} from './discordPresentation.js';
import { config } from '../config.js';
import { getRenderPalette } from '../services/siteTheme.js';

function array(value) {
  return Array.isArray(value) ? value : [];
}

function guideUrl(weaponId, rankId = null) {
  let url = `${config.siteUrl}/guides.html?weapon=${encodeURIComponent(weaponId)}`;
  if (rankId) url += `&rank=${encodeURIComponent(rankId)}`;
  return url;
}

function guideLinkUrl(link) {
  const weaponId = link?.weapon_id || link?.weaponId || link?.weapon;
  const rankId = link?.rank_id || link?.rankId || link?.rank;
  return weaponId ? guideUrl(weaponId, rankId) : null;
}

function recipeMethods(recipe) {
  if (!recipe) return [];
  if (Array.isArray(recipe.methods) && recipe.methods.length) return recipe.methods;
  return [recipe];
}

function infoVisuals(sections) {
  const section = array(sections).find(item => item?._kind === 'info_visuals');
  return array(section?.images || section?.visuals);
}

function visibleSections(sections) {
  return array(sections).filter(item => item?._kind !== 'info_visuals');
}

function textSpecs({ keyBase, color, title, description, url, footer }) {
  const chunks = splitDiscordText(description);
  return (chunks.length ? chunks : ['_Sin información._']).map((chunk, index) => ({
    key: index ? `${keyBase}:${index + 1}` : keyBase,
    embeds: [makeBrandedEmbed({
      color,
      title: index ? `${title} · continuación ${index + 1}` : title,
      description: chunk,
      url,
      footer,
    })],
    files: [],
  }));
}

async function imageSpec({ key, color, title, description, imageUrl, imageName, url, footer, thumbnail = false }) {
  const prepared = imageUrl ? await prepareDiscordImage(imageUrl, imageName) : null;
  const embed = makeBrandedEmbed({ color, title, description, url, footer });
  const files = [];
  if (prepared?.attachment) {
    if (thumbnail) embed.setThumbnail(prepared.imageRef);
    else embed.setImage(prepared.imageRef);
    files.push(prepared.attachment);
  }
  return {
    key,
    embeds: [embed],
    files,
    attachmentHash: prepared?.hash || null,
    warning: prepared?.error?.message || null,
  };
}

function rankSeparatorSpec(rank, index, total) {
  const name = cleanText(rank?.name || 'Rango').replace(/[\r\n]+/g, ' ').slice(0, 80);
  return {
    key: `rank:${rank.id}:separator`,
    content: `## ${String(index + 1).padStart(2, '0')} · ${name}\n-# Rango ${index + 1} de ${total}`,
    embeds: [],
    files: [],
  };
}

function statsDescription(stats, rankUrl) {
  const lines = stats.map(stat => {
    const label = cleanText(stat.key || stat.label || 'Dato');
    const value = cleanText(stat.value ?? '—');
    return `> **${label}**\n> ${value}`;
  });
  return `${lines.join('\n')}\n\n[Consultar este rango](${rankUrl})`;
}

export async function buildGuideForumSpecs({ weapon, category, type, ranks }) {
  const theme = getRenderPalette();
  const color = discordColor(category?.color, theme.primary);
  const footer = `Culones RPG · Guías · ${weapon.name}`;
  const specs = [];
  const guidePageUrl = guideUrl(weapon.id);

  const summary = makeBrandedEmbed({
    color,
    title: `GUÍA · ${weapon.name}`,
    description: cleanText(weapon.description)
      ? `${truncateText(weapon.description, 900)}\n\n[ABRIR GUÍA COMPLETA ↗](${guidePageUrl})`
      : `[ABRIR GUÍA COMPLETA ↗](${guidePageUrl})`,
    url: guidePageUrl,
    footer,
  }).addFields(
    { name: 'Categoría', value: truncateText(category?.label || 'Sin categoría', 1000), inline: true },
    { name: 'Tipo', value: truncateText(type?.label || 'Sin tipo', 1000), inline: true },
    { name: 'Rangos', value: String(ranks.length), inline: true },
  );
  const cover = weapon.image_url ? await prepareDiscordImage(weapon.image_url, `guide-${weapon.id}-cover`) : null;
  const summaryFiles = [];
  if (cover?.attachment) {
    summary.setImage(cover.imageRef);
    summaryFiles.push(cover.attachment);
  }
  specs.push({
    key: 'guide:summary',
    embeds: [summary],
    files: summaryFiles,
    attachmentHash: cover?.hash || null,
    warning: cover?.error?.message || null,
  });

  for (const [rankIndex, rank] of ranks.entries()) {
    const rankUrl = guideUrl(weapon.id, rank.id);
    specs.push(rankSeparatorSpec(rank, rankIndex, ranks.length));

    const descriptionChunks = splitDiscordText(rank.description);
    const firstDescription = descriptionChunks.shift() || '_Este rango no tiene descripción._';
    specs.push(await imageSpec({
      key: `rank:${rank.id}:overview`,
      color,
      title: `${weapon.name} · ${rank.name}`,
      description: `${firstDescription}\n\n[VER RANGO EN LA WEB ↗](${rankUrl})`,
      imageUrl: rank.image_url,
      imageName: `guide-${weapon.id}-rank-${rank.id}`,
      url: rankUrl,
      footer,
      thumbnail: true,
    }));

    descriptionChunks.forEach((chunk, index) => specs.push({
      key: `rank:${rank.id}:description:${index + 2}`,
      embeds: [makeBrandedEmbed({
        color,
        title: `Descripción · continuación ${index + 2}`,
        description: `${chunk}\n\n[VER RANGO EN LA WEB ↗](${rankUrl})`,
        url: rankUrl,
        footer,
      })],
      files: [],
    }));

    const stats = array(rank.stats).filter(stat => stat?.key || stat?.label || stat?.value != null);
    if (stats.length) {
      specs.push(...textSpecs({
        keyBase: `rank:${rank.id}:stats`,
        color,
        title: 'ESTADÍSTICAS',
        description: statsDescription(stats, rankUrl),
        url: rankUrl,
        footer,
      }));
    }

    for (const [index, ability] of array(rank.abilities).entries()) {
      const lines = [];
      const facts = [];
      if (ability.tag) facts.push(`**Tipo:** ${ability.tag}`);
      if (ability.level != null) facts.push(`**Nivel:** ${ability.level}${ability.level_max ? ` / ${ability.level_max}` : ''}`);
      if (facts.length) lines.push(facts.join(' · '));
      if (ability.description) lines.push('', ability.description);
      for (const stat of array(ability.stats)) {
        lines.push(`> **${stat.key || stat.label || 'Dato'}:** ${stat.value ?? '—'}`);
      }
      lines.push('', `[VER RANGO EN LA WEB ↗](${rankUrl})`);
      specs.push(...textSpecs({
        keyBase: `rank:${rank.id}:ability:${ability.id || index}`,
        color,
        title: `HABILIDAD · ${ability.name || `Habilidad ${index + 1}`}`,
        description: lines.join('\n'),
        url: rankUrl,
        footer,
      }));
    }

    for (const [index, visual] of infoVisuals(rank.extra_sections).entries()) {
      const linked = guideLinkUrl(visual.guide_link);
      const lines = [
        linked ? `[ABRIR GUÍA RELACIONADA ↗](${linked})` : '',
        `[VER RANGO EN LA WEB ↗](${rankUrl})`,
      ].filter(Boolean).join('\n');
      specs.push(await imageSpec({
        key: `rank:${rank.id}:resource:${index}`,
        color,
        title: `RECURSO VISUAL · ${visual.name || `Recurso ${index + 1}`}`,
        description: lines,
        imageUrl: visual.image_url,
        imageName: `guide-${weapon.id}-resource-${rank.id}-${index}`,
        url: rankUrl,
        footer,
      }));
    }

    for (const [index, method] of recipeMethods(rank.upgrade_recipe).entries()) {
      const methodTitle = method.title || 'Método de fabricación';
      const buffer = await renderWorkbenchMethod(method, methodTitle);
      const filename = `workbench-${weapon.id}-${rank.id}-${index}.png`;
      const embed = makeBrandedEmbed({
        color,
        title: `MEJORA / FABRICACIÓN · ${methodTitle}`,
        description: `${recipeMethodText(method, { guideLinkBuilder: guideLinkUrl })}\n\n[VER RANGO EN LA WEB ↗](${rankUrl})`,
        url: rankUrl,
        footer,
      }).setImage(`attachment://${filename}`);
      specs.push({
        key: `rank:${rank.id}:workbench:${index}`,
        embeds: [embed],
        files: [new AttachmentBuilder(buffer, { name: filename })],
      });
    }

    for (const [index, section] of visibleSections(rank.extra_sections).entries()) {
      const lines = [];
      if (section.text) lines.push(section.text);
      for (const field of array(section.fields)) {
        const key = cleanText(field?.key);
        const value = cleanText(field?.value);
        if (key || value) lines.push(`${key ? `> **${key}:** ` : '> '}${value || '—'}`);
      }
      lines.push('', `[VER RANGO EN LA WEB ↗](${rankUrl})`);
      const chunks = splitDiscordText(lines.join('\n'));
      (chunks.length ? chunks : ['_Sin contenido._']).forEach((chunk, part) => specs.push({
        key: `rank:${rank.id}:extra:${section.id || index}:${part + 1}`,
        embeds: [makeBrandedEmbed({
          color,
          title: part
            ? `${section.title || 'Extra'} · continuación ${part + 1}`
            : `EXTRA · ${section.title || `Extra ${index + 1}`}`,
          description: chunk,
          url: rankUrl,
          footer,
        })],
        files: [],
      }));
    }
  }

  specs.push({
    key: 'guide:footer',
    embeds: [new EmbedBuilder()
      .setColor(color)
      .setDescription(`### GUÍA COMPLETA\nConsulta todos los rangos, vínculos y recursos interactivos en la web.\n\n[ABRIR ${truncateText(weapon.name, 80).toUpperCase()} ↗](${guidePageUrl})`)
      .setFooter({ text: footer })],
    files: [],
  });
  return specs;
}
