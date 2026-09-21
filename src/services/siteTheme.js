// src/services/siteTheme.js
// Paleta compartida por los renderizadores Canvas del bot. La web guarda su
// tema global en app_settings.theme_config; el bot lo consulta con caché y
// mantiene una paleta segura de respaldo si Supabase no responde.

import { supabase } from './supabase.js';

const HEX = /^#[0-9a-f]{6}$/i;
const CACHE_MS = 60_000;

const DEFAULT_WEB_THEME = Object.freeze({
  pageBackground: '#070914',
  panelBackground: '#111528',
  elevatedBackground: '#171b32',
  textPrimary: '#f5f3ff',
  textSecondary: '#aaa6c5',
  primary: '#8b3dff',
  primarySoft: '#b46cff',
  accent: '#ffb83e',
  event: '#ff3d8d',
  confirmation: '#35d98b',
  warning: '#f5c542',
  danger: '#ef4444',
  info: '#38bdf8',
});

const palette = {
  bg: '#090612',
  panel: '#141023',
  elevated: '#1c1730',
  primary: '#a985ff',
  primarySoft: '#c7adff',
  accent: '#d6b56f',
  event: '#ec72d3',
  confirmation: '#38e07a',
  warning: '#f5c542',
  danger: '#e84d4d',
  info: '#4dd4e8',
  text: '#f6f1ff',
  muted: '#aaa2c1',
};

let loadedAt = 0;
let loading = null;

function validHex(value, fallback) {
  const text = String(value || '').trim();
  return HEX.test(text) ? text.toLowerCase() : fallback;
}

function mapTheme(value = {}) {
  const theme = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const normalized = Object.fromEntries(Object.entries(DEFAULT_WEB_THEME).map(([key, fallback]) => [key, validHex(theme[key], fallback)]));
  return {
    bg: normalized.pageBackground,
    panel: normalized.panelBackground,
    elevated: normalized.elevatedBackground,
    primary: normalized.primary,
    primarySoft: normalized.primarySoft,
    accent: normalized.accent,
    event: normalized.event,
    confirmation: normalized.confirmation,
    warning: normalized.warning,
    danger: normalized.danger,
    info: normalized.info,
    text: normalized.textPrimary,
    muted: normalized.textSecondary,
  };
}

export function getRenderPalette() {
  return palette;
}

export async function refreshRenderPalette({ force = false } = {}) {
  if (!force && Date.now() - loadedAt < CACHE_MS) return palette;
  if (loading) return loading;

  loading = (async () => {
    try {
      const { data, error } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'theme_config')
        .maybeSingle();
      if (error) throw error;
      Object.assign(palette, mapTheme(data?.value || {}));
      loadedAt = Date.now();
    } catch (error) {
      // Un fallo visual nunca debe impedir que un comando o publicación se
      // complete. Se conserva la última paleta válida y se vuelve a intentar.
      console.warn('[Theme] No se pudo cargar theme_config:', error.message);
      loadedAt = Date.now() - CACHE_MS + 10_000;
    } finally {
      loading = null;
    }
    return palette;
  })();

  return loading;
}

export function themeRgba(hex, alpha = 1) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || ''));
  if (!match) return `rgba(169,133,255,${alpha})`;
  const [, r, g, b] = match;
  return `rgba(${parseInt(r, 16)},${parseInt(g, 16)},${parseInt(b, 16)},${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
}
