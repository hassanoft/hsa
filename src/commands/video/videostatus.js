import { downloadQuotedOrDirectMedia } from '../../utils/media.js';
import { errorMessage, successMessage } from '../../utils/formatter.js';

export default {
  name: 'videostatus',
  aliases: [],
  category: 'video',
  ownerOnly: true,
  description: "Publie une vidéo sur le statut WhatsApp du compte connecté à H$Λ BOT (OWNER uniquement).",
  async execute(ctx) {
    const media = await downloadQuotedOrDirectMedia(ctx.msg);
    if (!media || media.type !== 'video') {
      await ctx.reply(`❌ Répondez à une vidéo avec ${ctx.prefix}videostatus.`);
      return;
    }
    try {
      await ctx.sock.sendMessage('status@broadcast', { video: media.buffer, caption: ctx.text || '' });
      await ctx.reply(successMessage('Statut vidéo publié.'));
    } catch {
      await ctx.reply(errorMessage('Échec de la publication du statut.'));
    }
  },
};
