import { Events } from 'discord.js';
import { consumeSuppressedDeletion } from '../services/deletionSuppressor.js';
import { recoverDeletedThread } from '../services/publicationRecovery.js';

export const name = Events.ThreadDelete;
export const once = false;

export async function execute(thread) {
  if (!thread?.id || consumeSuppressedDeletion(thread.id)) return;
  await recoverDeletedThread(thread.client, thread.id).catch(error => {
    console.error(`[Recovery] Error procesando threadDelete ${thread.id}:`, error);
  });
}
