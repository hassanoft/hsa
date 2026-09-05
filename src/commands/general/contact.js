import { forwardTextToOwner, markPending } from '../../services/contact.js';
import { successMessage, errorMessage } from '../../utils/formatter.js';

export default {
  name: 'contact',
  aliases: [],
  category: 'general',
  privateOnly: true,
  description: 'Envoie un message privé au propriétaire de H$Λ BOT.',
  async execute(ctx) {
    if (ctx.text && ctx.text.trim()) {
      const result = await forwardTextToOwner(ctx.sock, {
        userJid: ctx.senderJid,
        userName: ctx.pushName,
        text: ctx.text.trim(),
      });
      await ctx.reply(
        result.ok
          ? successMessage('Votre message a bien été transmis au propriétaire de H$Λ BOT.')
          : errorMessage("Le propriétaire du bot n'est pas configuré pour le moment.")
      );
      return;
    }

    markPending(ctx.senderJid);
    await ctx.reply('📩 Envoyez maintenant votre message (texte, image, audio, vidéo ou document).');
  },
};
