import { getTargetJids } from '../group/_groupHelpers.js';
import { db } from '../../database/database.js';
import { successMessage } from '../../utils/formatter.js';

export default {
  name: 'unban',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  description: "Retire l'interdiction d'utilisation de H$Λ BOT à un utilisateur.",
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    if (!targets.length) {
      await ctx.reply('❌ Mentionnez, répondez, ou indiquez le numéro de la personne à débannir.');
      return;
    }
    db.setBanned(targets[0], false);
    await ctx.reply(successMessage(`@${targets[0].split('@')[0]} n'est plus banni.`));
  },
};
