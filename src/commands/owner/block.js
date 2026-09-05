import { getTargetJids } from '../group/_groupHelpers.js';
import { errorMessage, successMessage } from '../../utils/formatter.js';

export default {
  name: 'block',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  description: 'Bloque un contact WhatsApp depuis le compte connecté au bot.',
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez, répondez, ou indiquez le numéro à bloquer.');
      return;
    }
    try {
      await ctx.sock.updateBlockStatus(targets[0], 'block');
      await ctx.reply(successMessage('Contact bloqué.'));
    } catch {
      await ctx.reply(errorMessage('Échec du blocage.'));
    }
  },
};
