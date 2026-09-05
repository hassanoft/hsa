import { getTargetJids } from '../group/_groupHelpers.js';
import { db } from '../../database/database.js';
import { successMessage } from '../../utils/formatter.js';

export default {
  name: 'addadmin',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  description: 'Ajoute un administrateur applicatif de H$Λ BOT.',
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez, répondez, ou indiquez le numéro à ajouter comme admin.');
      return;
    }
    db.addBotAdmin(targets[0]);
    await ctx.reply(successMessage(`@${targets[0].split('@')[0]} est maintenant administrateur de H$Λ BOT.`));
  },
};
