import { getTargetJids } from '../group/_groupHelpers.js';
import { randomInt } from '../../utils/helpers.js';

export default {
  name: 'ship',
  aliases: [],
  category: 'fun',
  description: 'Calcule le pourcentage de compatibilité entre deux membres (mentionnez-les).',
  async execute(ctx) {
    const mentioned = ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const a = mentioned[0] || ctx.senderJid;
    const b = mentioned[1] || getTargetJids(ctx)[0];
    if (!b) {
      await ctx.reply(`❌ Mentionnez deux membres. Usage : ${ctx.prefix}ship @personne1 @personne2`);
      return;
    }
    const percent = randomInt(0, 100);
    await ctx.sock.sendMessage(ctx.chatId, {
      text: `💘 @${a.split('@')[0]} + @${b.split('@')[0]} = ${percent}% de compatibilité !`,
      mentions: [a, b],
    });
  },
};
