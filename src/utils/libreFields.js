// src/utils/libreFields.js
// Lógica compartida para tratar bloques libres (item_type === '_libre') y
// valores guardados como JSON en logs. Tanto embeds.js como renderLogDetail.js
// usan este módulo para evitar JSON crudo visible y mantener un fallback seguro.

function isJsonishString(value) {
  return typeof value === 'string' && /^[\[{]/.test(value.trim());
}

function safeParseJson(raw) {
  if (Array.isArray(raw) || (raw && typeof raw === 'object')) return { ok: true, value: raw };
  if (typeof raw !== 'string') return { ok: false, value: null };

  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, value: null };

  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false, value: null };
  }
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function normalizeSubfield(sub) {
  if (typeof sub === 'string') {
    return { key: sub, value: '' };
  }
  if (!sub || typeof sub !== 'object') return null;

  return {
    key: String(firstDefined(sub.key, sub.label, sub.title, sub.name, sub.heading)),
    value: String(firstDefined(sub.value, sub.text, sub.description, sub.content, sub.body)),
  };
}

function normalizeLibreField(field) {
  if (typeof field === 'string') {
    return { key: 'Contenido', value: field, subfields: [] };
  }
  if (!field || typeof field !== 'object') return null;

  const rawSubfields = firstDefined(
    field.subfields,
    field.children,
    field.items,
    field.fields,
    field.options,
    []
  );

  return {
    key: String(firstDefined(field.key, field.label, field.title, field.name, field.heading, 'Contenido')),
    value: String(firstDefined(field.value, field.text, field.description, field.content, field.body)),
    subfields: Array.isArray(rawSubfields)
      ? rawSubfields.map(normalizeSubfield).filter(Boolean)
      : [],
  };
}

/**
 * Parsea el campo `obtained_from` de un bloque libre.
 * Formato esperado actual: [{ key, value, subfields:[{ key, value }] }].
 * También acepta variantes legacy como label/text/title/content/children.
 * Si llega texto plano legacy, lo muestra como `Contenido`.
 * Si llega JSON inválido, no muestra el JSON crudo: devuelve un aviso seguro.
 *
 * @param {Object} item - fila de log_items
 * @returns {Array<{key:string, value:string, subfields:Array}>}
 */
export function parseLibreFields(item) {
  const raw = item?.obtained_from;
  if (raw === undefined || raw === null || raw === '') return [];

  const parsed = safeParseJson(raw);

  if (!parsed.ok) {
    const text = String(raw).trim();
    if (!text) return [];

    if (isJsonishString(text)) {
      return [{
        key: 'Contenido',
        value: 'El contenido guardado tiene formato JSON inválido y no se pudo leer sin mostrarlo en crudo.',
        subfields: [],
      }];
    }

    return [{ key: 'Contenido', value: text, subfields: [] }];
  }

  let list = parsed.value;
  if (!Array.isArray(list)) {
    if (list && typeof list === 'object' && Array.isArray(list.fields)) {
      list = list.fields;
    } else if (list && typeof list === 'object') {
      list = [list];
    } else {
      return [];
    }
  }

  return list.map(normalizeLibreField).filter(Boolean).filter((field) => field.key || field.value);
}

/**
 * Separa los items de un log en dos listas: normales y bloques libres.
 * Los bloques libres no deben aparecer en el conteo ni en la sección ITEMS.
 *
 * @param {Array} items - array completo de items del log
 * @returns {{ normalItems: Array, libres: Array }}
 */
export function splitItems(items) {
  const all = Array.isArray(items) ? items : [];
  return {
    normalItems: all.filter((i) => i.item_type !== '_libre'),
    libres:      all.filter((i) => i.item_type === '_libre'),
  };
}

function formatEnchantments(enchantments) {
  if (!Array.isArray(enchantments) || enchantments.length === 0) return '';

  const parts = enchantments.map((ench) => {
    if (typeof ench === 'string') return ench;
    if (!ench || typeof ench !== 'object') return '';
    const name = firstDefined(ench.name, ench.id, ench.key, ench.label);
    const level = firstDefined(ench.level, ench.lvl, ench.value);
    if (!name) return '';
    return level ? `${name} ${level}` : String(name);
  }).filter(Boolean);

  return parts.length ? ` (${parts.join(', ')})` : '';
}

function formatGenericObject(obj) {
  if (!obj || typeof obj !== 'object') return String(obj ?? '');

  const preferredName = firstDefined(obj.name, obj.item, obj.id, obj.key, obj.label, obj.title);
  const count = firstDefined(obj.count, obj.amount, obj.quantity, obj.qty);
  const enchants = formatEnchantments(obj.enchantments || obj.enchants);

  if (preferredName) {
    return `${preferredName}${count ? ` x${count}` : ''}${enchants}`;
  }

  const cleanPairs = Object.entries(obj)
    .filter(([key, value]) => value !== undefined && value !== null && key !== 'enchantments' && key !== 'enchants')
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);

  return cleanPairs.join(', ');
}

/**
 * Convierte valores tipo JSON array/object a texto corto y legible para canvas.
 * Evita casos como [{"name":"Casco..."}] visibles en mobs/items.
 */
export function formatJsonishListForCanvas(raw, invalidLabel = 'Formato inválido') {
  if (raw === undefined || raw === null || raw === '') return '';

  const parsed = safeParseJson(raw);
  if (!parsed.ok) {
    const text = String(raw).trim();
    if (!text) return '';
    return isJsonishString(text) ? invalidLabel : text;
  }

  const value = parsed.value;
  if (Array.isArray(value)) {
    const parts = value.map((entry) => {
      if (typeof entry === 'string') return entry;
      return formatGenericObject(entry);
    }).filter(Boolean);
    return parts.join(', ');
  }

  if (value && typeof value === 'object') return formatGenericObject(value);
  return String(value ?? '');
}

export function formatEquipmentForCanvas(raw) {
  return formatJsonishListForCanvas(raw, 'Equipamiento con formato inválido');
}

export function formatSourceForCanvas(raw) {
  if (raw === undefined || raw === null || raw === '') return '';

  const parsed = safeParseJson(raw);
  if (parsed.ok) {
    let list = parsed.value;
    if (Array.isArray(list)) {
      const maybeFields = list.map(normalizeLibreField).filter(Boolean);
      if (maybeFields.length) {
        return maybeFields
          .map((field) => field.value ? `${field.key}: ${field.value}` : field.key)
          .join(', ');
      }
    }
    if (list && typeof list === 'object') {
      const field = normalizeLibreField(list);
      if (field) return field.value ? `${field.key}: ${field.value}` : field.key;
    }
  }

  return formatJsonishListForCanvas(raw, 'Origen con formato inválido');
}

/**
 * Genera las líneas de texto plano de un bloque libre para el canvas.
 */
export function formatLibreForCanvas(libre) {
  const lines = [];
  const fields = parseLibreFields(libre);

  for (const field of fields) {
    if (!field?.key && !field?.value) continue;

    if (field.key && field.value) {
      lines.push({ text: `${field.key}:`, style: 'header', indent: 0 });
      lines.push({ text: field.value, style: 'value', indent: 12 });
    } else if (field.key) {
      lines.push({ text: field.key, style: 'header', indent: 0 });
    } else if (field.value) {
      lines.push({ text: field.value, style: 'value', indent: 0 });
    }

    for (const sub of (field.subfields || [])) {
      if (!sub?.key && !sub?.value) continue;
      const subText = sub.key && sub.value
        ? `↳ ${sub.key}: ${sub.value}`
        : `↳ ${sub.key || sub.value}`;
      lines.push({ text: subText, style: 'sub', indent: 20 });
    }
  }

  if (libre.description) {
    lines.push({ text: libre.description, style: 'desc', indent: 0 });
  }

  if (libre.image_url) {
    const shortUrl = libre.image_url.length > 60
      ? libre.image_url.slice(0, 58) + '…'
      : libre.image_url;
    lines.push({ text: `Imagen: ${shortUrl}`, style: 'img', indent: 0 });
  }

  return lines;
}

function countWrappedLines(ctx, text, maxWidth) {
  if (!text) return 1;
  const words = String(text).split(/\s+/);
  let current = '';
  let count = 0;

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      count++;
      current = word;
    } else {
      current = test;
    }
  }
  if (current) count++;
  return Math.max(count, 1);
}

export function measureLibreTitleHeight(ctx, libre, maxWidth, fontSans) {
  ctx.font = `bold 13px ${fontSans}`;
  const titleLineCount = countWrappedLines(ctx, libre?.name || 'Extra', maxWidth);
  return 8 + titleLineCount * 16 + 8;
}

/**
 * Calcula la altura en píxeles que ocupa un bloque libre en el canvas.
 */
export function measureLibreHeight(ctx, libre, maxWidth, fontSans) {
  const LINE_H = { header: 18, value: 17, sub: 16, desc: 17, img: 15 };
  const BOTTOM_PADDING = 10;
  const titleAreaH = measureLibreTitleHeight(ctx, libre, maxWidth, fontSans);
  const lines = formatLibreForCanvas(libre);

  if (lines.length === 0) {
    return titleAreaH + 18 + BOTTOM_PADDING;
  }

  let h = titleAreaH + BOTTOM_PADDING;
  for (const line of lines) {
    const effectiveWidth = Math.max(40, maxWidth - line.indent);
    ctx.font = `${line.style === 'sub' ? 'italic ' : ''}11px ${fontSans}`;
    const lineCount = countWrappedLines(ctx, line.text, effectiveWidth);
    h += lineCount * (LINE_H[line.style] || 17);
  }

  return h;
}
