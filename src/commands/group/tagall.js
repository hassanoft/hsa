export default {
  name: 'tagall',
  aliases: [],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  description: 'Mentionne tous les membres du groupe.',
  async execute(ctx) {
    const participants = ctx.groupMetadata?.participants || [];
    const mentions = participants.map((p) => p.id);
    const text = `📢 ${ctx.text || 'Attention à tous !'}\n\n` + mentions.map((m) => `@${m.split('@')[0]}`).join(' ');
    await ctx.sock.sendMessage(ctx.chatId, { text, mentions });
  },
};
