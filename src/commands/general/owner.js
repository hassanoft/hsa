import { config } from '../../config.js';
import { numberToJid } from '../../utils/helpers.js';

export default {
  name: 'owner',
  aliases: [],
  category: 'general',
  description: 'Affiche le contact du propriétaire du bot.',
  async execute(ctx) {
    if (!config.ownerNumber) {
      await ctx.reply('❌ Aucun propriétaire configuré pour le moment.');
      return;
    }
    const ownerJid = numberToJid(config.ownerNumber);
    await ctx.sock.sendMessage(ctx.chatId, {
      contacts: {
        displayName: `${config.botName} — Owner`,
        contacts: [
          {
            vcard:
              `BEGIN:VCARD\nVERSION:3.0\nFN:${config.botName} Owner\n` +
              `TEL;type=CELL;type=VOICE;waid=${config.ownerNumber}:+${config.ownerNumber}\nEND:VCARD`,
          },
        ],
      },
    }).catch(async () => {
      await ctx.reply(`👑 Propriétaire : wa.me/${config.ownerNumber}`);
    });
  },
};
