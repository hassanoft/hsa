// Non une commande : helpers partagés pour extraire les JID ciblés dans une commande de groupe.
export function getTargetJids(ctx) {
  const mentioned = ctx.msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
  if (mentioned.length) return mentioned;

  const quotedParticipant = ctx.msg.message?.extendedTextMessage?.contextInfo?.participant;
  if (quotedParticipant) return [quotedParticipant];

  if (ctx.args[0]) {
    const digits = ctx.args[0].replace(/\D/g, '');
    if (digits) return [`${digits}@s.whatsapp.net`];
  }

  return [];
}
