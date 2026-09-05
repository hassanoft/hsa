export default {
  name: 'groupinfo',
  aliases: [],
  category: 'group',
  groupOnly: true,
  description: 'Affiche les informations du groupe.',
  async execute(ctx) {
    const g = ctx.groupMetadata;
    if (!g) {
      await ctx.reply('❌ Impossible de récupérer les informations du groupe.');
      return;
    }
    const admins = g.participants.filter((p) => p.admin).length;
    await ctx.reply(
      `👥 ${g.subject}\n\n` +
      `🆔 ID : ${g.id}\n` +
      `📄 Description : ${g.desc || 'Aucune'}\n` +
      `👤 Membres : ${g.participants.length}\n` +
      `👮 Administrateurs : ${admins}\n` +
      `📅 Créé le : ${g.creation ? new Date(g.creation * 1000).toLocaleDateString('fr-FR') : 'inconnu'}`
    );
  },
};
