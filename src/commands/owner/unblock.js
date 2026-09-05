import { getTargetJids } from '../group/_groupHelpers.js';
import { errorMessage, successMessage } from '../../utils/formatter.js';

export default {
  name: 'unblock',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  description: 'Débloque un contact WhatsApp depuis le compte connecté au bot.',
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez, répondez, ou indiquez le numéro à débloquer.');
      return;
    }
    try {
      await ctx.sock.updateBlockStatus(targets[0], 'unblock');
      await ctx.reply(successMessage('Contact débloqué.'));
    } catch {
      await ctx.reply(errorMessage('Échec du déblocage.'));
    }
  },
};
