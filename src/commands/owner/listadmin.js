import { db } from '../../database/database.js';

export default {
  name: 'listadmin',
  aliases: [],
  category: 'owner',
  ownerOnly: true,
  description: 'Liste les administrateurs applicatifs de H$Λ BOT.',
  async execute(ctx) {
    const admins = db.listBotAdmins();
    if (!admins.length) {
      await ctx.reply('ℹ️ Aucun administrateur applicatif défini (en dehors du propriétaire).');
      return;
    }
    await ctx.sock.sendMessage(ctx.chatId, {
      text: `👮 Administrateurs H$Λ BOT :\n${admins.map((a) => `• @${a.split('@')[0]}`).join('\n')}`,
      mentions: admins,
    });
  },
};
