import { getTargetJids } from './_groupHelpers.js';
import { db } from '../../database/database.js';

export default {
  name: 'warnings',
  aliases: [],
  category: 'group',
  groupOnly: true,
  description: "Affiche les avertissements d'un membre.",
  async execute(ctx) {
    const targets = getTargetJids(ctx);
    const target = targets[0] || ctx.senderJid;
    const list = db.getWarnings(ctx.chatId, target);
    if (!list.length) {
      await ctx.reply('✅ Aucun avertissement pour ce membre.');
      return;
    }
    const lines = list.map((w, i) => `${i + 1}. ${w.reason} — ${new Date(w.date).toLocaleDateString('fr-FR')}`);
    await ctx.sock.sendMessage(ctx.chatId, { text: `⚠️ Avertissements :\n${lines.join('\n')}`, mentions: [target] });
  },
};
