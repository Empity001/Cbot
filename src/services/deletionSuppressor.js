// Evita que los eventos de borrado causados intencionalmente por el propio
// bot se interpreten como daños que haya que reconstruir.

const suppressed = new Map();
const DEFAULT_TTL_MS = 30_000;

function cleanup(now = Date.now()) {
  for (const [id, expiresAt] of suppressed) {
    if (expiresAt <= now) suppressed.delete(id);
  }
}

export function suppressDiscordDeletion(id, ttlMs = DEFAULT_TTL_MS) {
  if (!id) return;
  cleanup();
  suppressed.set(String(id), Date.now() + Math.max(1_000, Number(ttlMs) || DEFAULT_TTL_MS));
}

export function consumeSuppressedDeletion(id) {
  if (!id) return false;
  const key = String(id);
  const expiresAt = suppressed.get(key);
  if (!expiresAt) return false;
  suppressed.delete(key);
  return expiresAt > Date.now();
}
