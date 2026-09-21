import { Events } from 'discord.js';
import { consumeSuppressedDeletion } from '../services/deletionSuppressor.js';
import { recoverDeletedMessage } from '../services/publicationRecovery.js';

export const name = Events.MessageDelete;
export const once = false;

export async function execute(message) {
  if (!message?.id || consumeSuppressedDeletion(message.id)) return;
  await recoverDeletedMessage(message.client, message.id, message.channelId).catch(error => {
    console.error(`[Recovery] Error procesando messageDelete ${message.id}:`, error);
  });
}
