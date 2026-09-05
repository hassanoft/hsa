import { numberToJid } from '../../utils/helpers.js';
import { errorMessage, successMessage } from '../../utils/formatter.js';

export default {
  name: 'add',
  aliases: [],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  requireBotGroupAdmin: true,
  description: 'Ajoute un membre au groupe. Usage : /add <numéro>',
  async execute(ctx) {
    const number = ctx.args[0]?.replace(/\D/g, '');
    if (!number) {
      await ctx.reply(`❌ Utilisation : ${ctx.prefix}add <numéro international>`);
      return;
    }
    try {
      await ctx.sock.groupParticipantsUpdate(ctx.chatId, [numberToJid(number)], 'add');
      await ctx.reply(successMessage('Membre ajouté (si son confidentialité le permet).'));
    } catch {
      await ctx.reply(errorMessage("Échec de l'ajout (numéro invalide ou confidentialité restrictive)."));
    }
  },
};
