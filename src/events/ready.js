// src/events/ready.js
// Inicia los workers durables de Logs y del foro.

import { Events } from 'discord.js';
import { startLogDurabilityWorker } from '../services/logDurabilityWorker.js';
import { startGuideForumWorker } from '../services/guideForumWorker.js';
import { sweepPublicationIntegrity } from '../services/publicationRecovery.js';
import { runStartupDiagnostics } from '../services/botHealth.js';

export const name = Events.ClientReady;
export const once = true;

export async function execute(client) {
  console.log(`[Ready] ✅ Bot conectado como ${client.user.tag}`);
  startLogDurabilityWorker(client);
  startGuideForumWorker(client);
  void runStartupDiagnostics(client).catch(error => {
    console.warn('[Health] El diagnóstico de arranque falló:', error?.message || error);
  });

  // Recupera daños ocurridos mientras el bot estaba apagado. Después se
  // repite de forma espaciada como red de seguridad adicional a los eventos
  // messageDelete/threadDelete y al worker durable de Logs.
  const firstSweep = setTimeout(() => void sweepPublicationIntegrity(client), 5_000);
  firstSweep.unref?.();
  const integrityTimer = setInterval(() => void sweepPublicationIntegrity(client), 60 * 60 * 1000);
  integrityTimer.unref?.();
}
