export default {
  name: 'hidetag',
  aliases: [],
  category: 'group',
  groupOnly: true,
  adminOnly: true,
  description: 'Envoie un message qui notifie tous les membres, sans afficher la liste.',
  async execute(ctx) {
    const participants = ctx.groupMetadata?.participants || [];
    const mentions = participants.map((p) => p.id);
    await ctx.sock.sendMessage(ctx.chatId, { text: ctx.text || '📢', mentions });
  },
};
