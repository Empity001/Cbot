import axios from 'axios';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { AttachmentBuilder } from 'discord.js';
import { createHash } from 'node:crypto';

const MAX_DOWNLOAD_BYTES = 12 * 1024 * 1024;
const PIXEL_THRESHOLD = 64;
const PIXEL_CANVAS_SIZE = 256;

function safeName(value, fallback = 'asset') {
  return String(value || fallback)
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || fallback;
}

function extensionFor(contentType, url) {
  const mime = String(contentType || '').split(';')[0].trim().toLowerCase();
  const map = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/apng': 'png',
  };
  if (map[mime]) return map[mime];
  const match = String(url || '').split('?')[0].match(/\.([a-z0-9]{2,5})$/i);
  return match?.[1]?.toLowerCase() || 'png';
}

export async function downloadImage(url) {
  if (!/^https?:\/\//i.test(String(url || ''))) return null;
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 12000,
    maxContentLength: MAX_DOWNLOAD_BYTES,
    maxBodyLength: MAX_DOWNLOAD_BYTES,
    validateStatus: status => status >= 200 && status < 300,
    headers: { 'User-Agent': 'CulonesRPG-DiscordBot/2.0' },
  });
  const buffer = Buffer.from(response.data);
  if (buffer.length > MAX_DOWNLOAD_BYTES) throw new Error('La imagen supera el límite de descarga del bot.');
  return {
    buffer,
    contentType: response.headers['content-type'] || '',
    hash: createHash('sha256').update(buffer).digest('hex'),
  };
}

export async function prepareDiscordImage(url, namePrefix = 'asset') {
  if (!url) return null;
  try {
    const downloaded = await downloadImage(url);
    if (!downloaded) return null;
    const { buffer, contentType, hash } = downloaded;
    const mime = String(contentType).toLowerCase();
    const animated = mime.includes('gif') || /\.gif(?:$|\?)/i.test(url);
    const sourceExt = extensionFor(contentType, url);
    let output = buffer;
    let extension = sourceExt;
    let pixelArt = false;
    let width = null;
    let height = null;

    if (!animated && !mime.includes('svg')) {
      try {
        const image = await loadImage(buffer);
        width = image.width;
        height = image.height;
        if (width > 0 && height > 0 && width <= PIXEL_THRESHOLD && height <= PIXEL_THRESHOLD) {
          const canvas = createCanvas(PIXEL_CANVAS_SIZE, PIXEL_CANVAS_SIZE);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = false;
          const scale = Math.max(1, Math.floor(Math.min(PIXEL_CANVAS_SIZE / width, PIXEL_CANVAS_SIZE / height)));
          const drawW = width * scale;
          const drawH = height * scale;
          const x = Math.floor((PIXEL_CANVAS_SIZE - drawW) / 2);
          const y = Math.floor((PIXEL_CANVAS_SIZE - drawH) / 2);
          ctx.clearRect(0, 0, PIXEL_CANVAS_SIZE, PIXEL_CANVAS_SIZE);
          ctx.drawImage(image, x, y, drawW, drawH);
          output = canvas.toBuffer('image/png');
          extension = 'png';
          pixelArt = true;
        }
      } catch (error) {
        console.warn(`[Images] No se pudieron leer dimensiones de ${url}:`, error.message);
      }
    }

    const filename = `${safeName(namePrefix)}-${hash.slice(0, 12)}.${extension}`;
    return {
      attachment: new AttachmentBuilder(output, { name: filename }),
      filename,
      imageRef: `attachment://${filename}`,
      hash,
      pixelArt,
      width,
      height,
    };
  } catch (error) {
    console.warn(`[Images] No se pudo preparar ${url}:`, error.message);
    return { error, sourceUrl: url };
  }
}
