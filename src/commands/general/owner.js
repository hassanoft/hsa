import { config } from '../../config.js';
import { numberToJid } from '../../utils/helpers.js';

// WhatsApp affiche mal les caractères non-ASCII (ex. Λ) dans les champs FN/displayName
// des messages de type "contacts" (vCard) — contrairement aux messages texte classiques,
// où "H$Λ BOT" s'affiche correctement. On utilise donc un nom ASCII sûr uniquement ici.
const SAFE_BRAND = 'HSA BOT';

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
        displayName: `${SAFE_BRAND} - Owner`,
        contacts: [
          {
            vcard:
              `BEGIN:VCARD\nVERSION:3.0\nFN:${SAFE_BRAND} Owner\n` +
              `TEL;type=CELL;type=VOICE;waid=${config.ownerNumber}:+${config.ownerNumber}\nEND:VCARD`,
          },
        ],
      },
    }).catch(async () => {
      await ctx.reply(`👑 Propriétaire : wa.me/${config.ownerNumber}`);
    });
  },
};
