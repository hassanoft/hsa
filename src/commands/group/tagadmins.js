export default {
  name: 'tagadmins',
  aliases: [],
  category: 'group',
  groupOnly: true,
  description: 'Mentionne uniquement les administrateurs du groupe.',
  async execute(ctx) {
    const admins = (ctx.groupMetadata?.participants || []).filter((p) => p.admin);
    if (!admins.length) {
      await ctx.reply('❌ Aucun administrateur trouvé.');
      return;
    }
    const mentions = admins.map((a) => a.id);
    const text = `👮 ${ctx.text || 'Attention administrateurs :'}\n\n` + mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
    await ctx.sock.sendMessage(ctx.chatId, { text, mentions });
  },
};
