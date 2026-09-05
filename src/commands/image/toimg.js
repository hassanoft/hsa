import { downloadQuotedOrDirectMedia } from '../../utils/media.js';
import Jimp from 'jimp';
import { errorMessage } from '../../utils/formatter.js';

export default {
  name: 'toimg',
  aliases: [],
  category: 'image',
  description: 'Convertit un sticker (statique) en image.',
  async execute(ctx) {
    const media = await downloadQuotedOrDirectMedia(ctx.msg);
    if (!media || media.type !== 'sticker') {
      await ctx.reply(`❌ Répondez à un sticker avec ${ctx.prefix}toimg.`);
      return;
    }
    try {
      const img = await Jimp.read(media.buffer);
      const png = await img.getBufferAsync(Jimp.MIME_PNG);
      await ctx.sock.sendMessage(ctx.chatId, { image: png }, { quoted: ctx.msg });
    } catch {
      await ctx.reply(errorMessage("Ce sticker est animé : la conversion en image n'est pas supportée."));
    }
  },
};
