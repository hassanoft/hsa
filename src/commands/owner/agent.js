// Commande /agent — pilote l'AGENT-IA de surveillance.
// Usage :
//   /agent on|off         (owner uniquement)
//   /agent status
//   /agent report [global|group|features]
//   /agent reset          (vide l'historique conversationnel de l'appelant)
//   /agent help

import { config } from '../../config.js';
import {
  getAgentConfig,
  setAgentConfig,
  isAgentEnabled,
  buildReport,
  clearHistory,
  getAgentLevel,
  levelLabel,
} from '../../services/agent.js';
import { successMessage, errorMessage, infoMessage } from '../../utils/formatter.js';

export default {
  name: 'agent',
  aliases: ['ia', 'aiagent'],
  category: 'owner',
  description: "Pilote l'AGENT-IA de surveillance. Usage : /agent on|off|status|report|reset",

  async execute(ctx) {
    const sub = (ctx.args[0] || '').toLowerCase();
    const cfg = getAgentConfig();

    // ── ON / OFF : réservé au créateur ──
    if (sub === 'on' || sub === 'off') {
      if (!ctx.isOwner) {
        await ctx.reply(errorMessage("Seul le créateur du bot peut activer/désactiver l'agent."));
        return;
      }
      const state = sub === 'on';
      setAgentConfig({
        enabled: state,
        creatorJid: ctx.senderJid,
        stats: { ...cfg.stats, startedAt: state ? Date.now() : cfg.stats.startedAt },
      });
      await ctx.reply(
        successMessage(
          state
            ? "AGENT-IA activé 🟢\n\nDiscutez avec lui en répondant à ses messages ou en commençant par \"agent ...\"."
            : 'AGENT-IA désactivé 🔴'
        )
      );
      return;
    }

    // ── STATUS : accessible à tous ──
    if (sub === 'status' || !sub) {
      const level = getAgentLevel(ctx.senderJid);
      const lines = [
        `╭──────────────────────────────╮`,
        `│         🤖 AGENT-IA          │`,
        `╰──────────────────────────────╯`,
        ``,
        `📡 Statut : ${isAgentEnabled() ? '🟢 Actif' : '🔴 Inactif'}`,
        `👤 Votre niveau : ${levelLabel(level)}`,
        `🧠 Créateur : HASSAN SOUGUE`,
        ``,
        `Commandes :`,
        `  ${ctx.prefix}agent on|off     (créateur)`,
        `  ${ctx.prefix}agent status`,
        `  ${ctx.prefix}agent report [global|group]`,
        `  ${ctx.prefix}agent reset`,
        ``,
        `💬 Pour discuter : commencez par "agent ..." ou répondez à un message de l'agent.`,
      ];
      await ctx.reply(lines.join('\n'));
      return;
    }

    // ── REPORT ──
    if (sub === 'report') {
      const type = (ctx.args[1] || 'global').toLowerCase();
      await ctx.reply(buildReport(type, ctx));
      return;
    }

    // ── RESET : vide l'historique de l'appelant ──
    if (sub === 'reset') {
      clearHistory(ctx.senderJid);
      await ctx.reply(successMessage('Historique conversationnel réinitialisé.'));
      return;
    }

    // ── HELP / défaut ──
    await ctx.reply(
      infoMessage(
        `AGENT-IA — utilisation :\n` +
        `${ctx.prefix}agent on|off         (créateur)\n` +
        `${ctx.prefix}agent status\n` +
        `${ctx.prefix}agent report [global|group]\n` +
        `${ctx.prefix}agent reset`
      )
    );
  },
};