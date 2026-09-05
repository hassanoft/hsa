import { getTargetJids } from './_groupHelpers.js';
import { errorMessage, successMessage } from '../../utils/formatter.js';

export default {
  name: 'promote',
  aliases: [],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  requireBotGroupAdmin: true,
  description: 'Promeut un membre administrateur du groupe.',
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez ou répondez au membre à promouvoir.');
      return;
    }
    try {
      await ctx.sock.groupParticipantsUpdate(ctx.chatId, targets, 'promote');
      await ctx.reply(successMessage('Membre(s) promu(s) administrateur.'));
    } catch {
      await ctx.reply(errorMessage('Échec de la promotion.'));
    }
  },
};
