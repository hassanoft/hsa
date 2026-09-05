import { getTargetJids } from './_groupHelpers.js';
import { db } from '../../database/database.js';

export default {
  name: 'warn',
  aliases: [],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  description: 'Ajoute un avertissement à un membre.',
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez ou répondez au membre à avertir.');
      return;
    }
    const settings = db.getGroupSettings(ctx.chatId);
    const target = targets[0];
    const warnings = db.addWarning(ctx.chatId, target, ctx.args.slice(1).join(' ') || 'Non spécifiée');
    await ctx.sock.sendMessage(ctx.chatId, {
      text: `⚠️ Warning : ${warnings.length}/${settings.warnLimit || 3}`,
      mentions: [target],
    });
  },
};
