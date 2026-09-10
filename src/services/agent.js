// Service AGENT-IA : assistant personnel du créateur HASSAN SOUGUE.
// - Discute avec tout le monde (chat libre)
// - Exécute des commandes publiques pour tout le monde
// - Exécute les commandes admin pour owner + bot-admins
// - Réserve les commandes ownerOnly au créateur
// Aucune simulation : si l'IA n'est pas configurée, on refuse proprement.

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { db } from '../database/database.js';
import { getCommand, getAllCommands, getCategories } from '../handlers/commandHandler.js';

const log = logger.child({ class: 'agent' });

// ── Catégories JAMAIS accessibles aux utilisateurs simples via l'agent ──
const RESTRICTED_CATEGORIES = new Set(['owner', 'moderation', 'group', 'admin']);

// ── Blacklist globale (personne, même le créateur via l'agent) ──
const DEFAULT_BLACKLIST = ['logout', 'restart', 'shutdown', 'eval', 'exec', 'pair', 'unpair'];

// ── Niveaux ──
export const LEVEL = { USER: 1, BOT_ADMIN: 2, OWNER: 3 };

// ── Mémoire conversationnelle (RAM, non persistante) ──
const conversations = new Map(); // senderJid -> [{role, content}, ...]

// ── Configuration par défaut de l'agent ──
function defaultAgentConfig() {
  return {
    enabled: false,
    creatorJid: config.ownerNumber ? `${config.ownerNumber}@s.whatsapp.net` : '',
    blacklist: DEFAULT_BLACKLIST,
    autoExecute: true,
    confirmDangerous: true,
    maxHistory: 20,
    stats: {
      interactions: 0,
      commandsExecuted: 0,
      errors: 0,
      startedAt: null,
    },
  };
}

export function getAgentConfig() {
  const stored = db.getSetting('agent', null);
  return stored ? { ...defaultAgentConfig(), ...stored } : defaultAgentConfig();
}

export function setAgentConfig(patch) {
  const current = getAgentConfig();
  const next = { ...current, ...patch };
  db.setSetting('agent', next);
  return next;
}

export function isAgentEnabled() {
  return getAgentConfig().enabled === true;
}

export function getAgentLevel(senderJid) {
  if (!senderJid) return 0;
  if (config.ownerNumber) {
    const digits = String(senderJid).replace(/\D/g, '');
    if (digits && digits.startsWith(config.ownerNumber)) return LEVEL.OWNER;
  }
  if (db.isBotAdmin(senderJid)) return LEVEL.BOT_ADMIN;
  return LEVEL.USER;
}

function levelLabel(level) {
  return { 3: 'CRÉATEUR', 2: 'BOT-ADMIN', 1: 'UTILISATEUR' }[level] || 'INCONNU';
}

// ── Catégories publiques (calculées dynamiquement) ──
function getPublicCategories() {
  return getCategories().filter((c) => !RESTRICTED_CATEGORIES.has(c));
}

// ── Vérifie si une commande peut être exécutée par ce niveau ──
export function canAgentExecute(command, level, agentCfg = getAgentConfig()) {
  if (!command) return { ok: false, reason: 'unknown-command' };

  if (agentCfg.blacklist?.includes(command.name)) {
    return { ok: false, reason: 'blacklisted' };
  }

  if (command.ownerOnly && level < LEVEL.OWNER) {
    return { ok: false, reason: 'owner-required' };
  }

  if (command.adminOnly && level < LEVEL.BOT_ADMIN) {
    return { ok: false, reason: 'admin-required' };
  }

  if (RESTRICTED_CATEGORIES.has(command.category) && level < LEVEL.BOT_ADMIN) {
    return { ok: false, reason: 'restricted-category' };
  }

  return { ok: true };
}

// ── Prompt système envoyé à l'IA ──
function buildSystemPrompt(level, pushName) {
  const publicCats = getPublicCategories().join(', ');
  const restrictedCats = [...RESTRICTED_CATEGORIES].join(', ');
  const agentCfg = getAgentConfig();

  const authority =
    level === LEVEL.OWNER
      ? "Tu peux exécuter N'IMPORTE QUELLE commande, y compris ownerOnly."
      : level === LEVEL.BOT_ADMIN
      ? "Tu peux exécuter les commandes admin et modération, mais PAS les commandes ownerOnly."
      : `Tu peux exécuter uniquement les commandes des catégories publiques : ${publicCats}.
         Tu NE PEUX PAS exécuter les catégories réservées : ${restrictedCats}.`;

  return `Tu es AGENT-IA, l'assistant personnel et surveillant officiel du bot WhatsApp "${config.botName}".
Créateur : HASSAN SOUGUE.

L'utilisateur qui te parle :
- Nom : ${pushName || 'inconnu'}
- Niveau : ${levelLabel(level)} (${level})

POUVOIRS ACTUELS :
${authority}

RÔLES :
1. Discuter naturellement, aider, expliquer.
2. Exécuter des commandes du bot quand on te le demande (via l'action "execute_command").
3. Activer/désactiver des features de groupe (antilink, antispam, etc.) via "toggle_feature".
4. Générer des rapports via "get_report".

RÉPONSE OBLIGATOIRE — JSON STRICT :
{
  "reply": "texte à envoyer à l'utilisateur (ton pro, clair, en français)",
  "action": null | "execute_command" | "toggle_feature" | "get_report",
  "params": null | objet
}

Détails des actions :
- execute_command : { "command": "kick", "args": ["@user", "raison"] }
- toggle_feature  : { "feature": "antilink"|"antispam"|"antibadword"|"antiflood"|"welcome"|"goodbye"|"autoread"|"autotyping"|"autorecording", "state": true|false }
- get_report      : { "type": "global"|"group"|"features" }

INTERDIT :
- Ne jamais inventer une commande qui n'existe pas.
- Ne jamais exécuter une commande que ton niveau ne permet pas.
- Si l'utilisateur demande une action interdite, refuse poliment en JSON avec action=null.

Réponds TOUJOURS en JSON valide, rien d'autre.`;
}

// ── Appel IA avec rotation multi-provider + convention { ok, text } ──
async function callAI(messages, { temperature = 0.4 } = {}) {
  const providers = config.aiProviders || [];
  if (providers.length === 0) return { ok: false, reason: 'not-configured' };

  let lastError = 'unknown';

  for (const provider of providers) {
    for (const apiKey of provider.apiKeys) {
      try {
        const isGemini = provider.name === 'gemini';
        let url = provider.url;
        let body;

        if (isGemini) {
          url = url.replace('{model}', provider.model).replace('{apiKey}', apiKey);
          // Gemini : conversion messages → contents
          const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
          const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
          body = {
            contents,
            systemInstruction: systemParts ? { parts: [{ text: systemParts }] } : undefined,
            generationConfig: { temperature, responseMimeType: 'application/json' },
          };
        } else {
          body = {
            model: provider.model,
            messages,
            temperature,
            response_format: { type: 'json_object' },
          };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          lastError = `http-${res.status}`;
          continue;
        }

        const data = await res.json();
        const text = isGemini
          ? data.candidates?.[0]?.content?.parts?.[0]?.text
          : data.choices?.[0]?.message?.content;

        if (!text) {
          lastError = 'empty';
          continue;
        }

        return { ok: true, text: text.trim(), provider: provider.name };
      } catch (err) {
        lastError = err.message;
        continue;
      }
    }
  }

  return { ok: false, reason: lastError };
}

// ── Parse la réponse JSON de l'IA ──
function parseAgentResponse(raw) {
  if (!raw) return { reply: '…', action: null, params: null };
  let cleaned = raw.trim();
  // Retirer les ```json ... ```
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '');
  try {
    const parsed = JSON.parse(cleaned);
    return {
      reply: String(parsed.reply || '').trim() || '…',
      action: parsed.action || null,
      params: parsed.params || null,
    };
  } catch {
    return { reply: cleaned, action: null, params: null };
  }
}

// ── Rapport ──
export function buildReport(type = 'global', ctx = null) {
  const now = new Date().toLocaleString('fr-FR');
  let r = `╭──────────────────────────────╮\n│       📊 AGENT-IA RAPPORT    │\n╰──────────────────────────────╯\n\n`;
  r += `🕐 ${now}\n\n`;

  if (type === 'group' && ctx?.chatId) {
    const s = db.getGroupSettings(ctx.chatId);
    r += `👥 Groupe : ${ctx.groupMetadata?.subject || ctx.chatId}\n\n`;
    r += `🔗 antilink     : ${s.antilink ? '✅' : '❌'}\n`;
    r += `🚫 antibadword  : ${s.antibadword ? '✅' : '❌'}\n`;
    r += `🌊 antiflood    : ${s.antiflood ? '✅' : '❌'}\n`;
    r += `📨 antispam     : ${s.antispam ? '✅' : '❌'}\n`;
    r += `👋 welcome      : ${s.welcome ? '✅' : '❌'}\n`;
    r += `👋 goodbye      : ${s.goodbye ? '✅' : '❌'}\n`;
    r += `👀 autoread     : ${s.autoread ? '✅' : '❌'}\n`;
    return r;
  }

  const agentCfg = getAgentConfig();
  r += `🤖 Statut agent : ${agentCfg.enabled ? '🟢 Actif' : '🔴 Inactif'}\n`;
  r += `📦 Groupes suivis : ${db.groups.count()}\n`;
  r += `👤 Utilisateurs   : ${db.users.count()}\n`;
  r += `⚙️ Commandes      : ${getAllCommands().length}\n`;
  r += `📨 Commandes exec : ${db.getStat('commandsExecuted')}\n`;
  r += `⚠️ Erreurs        : ${db.getStat('errors')}\n\n`;
  r += `─── AGENT-IA ───\n`;
  r += `💬 Interactions   : ${agentCfg.stats.interactions}\n`;
  r += `🎯 Actions lancées: ${agentCfg.stats.commandsExecuted}\n`;
  return r;
}

// ── Historique ──
function pushHistory(senderJid, role, content, max) {
  const hist = conversations.get(senderJid) || [];
  hist.push({ role, content });
  if (hist.length > max) hist.splice(0, hist.length - max);
  conversations.set(senderJid, hist);
}

export function clearHistory(senderJid) {
  conversations.delete(senderJid);
}

// ── Point d'entrée principal : traite un message adressé à l'agent ──
// Retourne { handled: boolean, reply?: string, executed?: object }
export async function runAgent(sock, ctx) {
  const agentCfg = getAgentConfig();
  if (!agentCfg.enabled) return { handled: false };

  const level = getAgentLevel(ctx.senderJid);
  if (level === 0) return { handled: false };

  const userText = ctx.text?.trim();
  if (!userText) return { handled: false };

  // Stats
  agentCfg.stats.interactions += 1;
  setAgentConfig({ stats: agentCfg.stats });

  // Historique
  const history = conversations.get(ctx.senderJid) || [];
  const messages = [
    { role: 'system', content: buildSystemPrompt(level, ctx.pushName) },
    ...history,
    { role: 'user', content: userText },
  ];

  const aiResult = await callAI(messages);
  if (!aiResult.ok) {
    agentCfg.stats.errors += 1;
    setAgentConfig({ stats: agentCfg.stats });
    const reasonMsg = {
      'not-configured': "⚠️ Aucune clé IA n'est configurée. Contactez le créateur.",
      'http-401': '⚠️ Clé IA invalide.',
      'http-429': '⏳ Trop de requêtes IA, réessayez dans un instant.',
    }[aiResult.reason] || `❌ Erreur IA (${aiResult.reason}).`;
    return { handled: true, reply: reasonMsg };
  }

  const parsed = parseAgentResponse(aiResult.text);

  // Historique
  pushHistory(ctx.senderJid, 'user', userText, agentCfg.maxHistory);
  pushHistory(ctx.senderJid, 'assistant', parsed.reply, agentCfg.maxHistory);

  let finalReply = parsed.reply;
  const executed = { action: null, ok: false, detail: null };

  // Exécution d'action
  if (parsed.action && agentCfg.autoExecute) {
    const result = await executeAction(parsed.action, parsed.params, { sock, ctx, level, agentCfg });
    executed.action = parsed.action;
    executed.ok = result.ok;
    executed.detail = result.detail;
    if (result.append) finalReply += `\n\n${result.append}`;

    if (result.ok) {
      agentCfg.stats.commandsExecuted += 1;
      setAgentConfig({ stats: agentCfg.stats });
    } else {
      agentCfg.stats.errors += 1;
      setAgentConfig({ stats: agentCfg.stats });
    }
  }

  return { handled: true, reply: finalReply, executed, level };
}

// ── Exécution d'une action demandée par l'IA ──
async function executeAction(action, params, { sock, ctx, level, agentCfg }) {
  try {
    if (action === 'execute_command') {
      const name = String(params?.command || '').replace(/^\//, '').trim().toLowerCase();
      const args = Array.isArray(params?.args) ? params.args.map(String) : [];
      if (!name) return { ok: false, append: '❌ Aucune commande précisée.' };

      const command = getCommand(name);
      if (!command) return { ok: false, append: `❌ Commande "${name}" introuvable.` };

      const perm = canAgentExecute(command, level, agentCfg);
      if (!perm.ok) {
        const msgs = {
          'blacklisted': `❌ La commande /${command.name} est bloquée par sécurité.`,
          'owner-required': `🔒 /${command.name} est réservée au créateur du bot.`,
          'admin-required': `🔒 /${command.name} nécessite des droits d'administrateur.`,
          'restricted-category': `🔒 La catégorie "${command.category}" n'est pas accessible via l'agent.`,
          'unknown-command': '❌ Commande inconnue.',
        };
        return { ok: false, append: msgs[perm.reason] || '❌ Action refusée.' };
      }

      // Construit un sous-ctx pour dispatch (on clone les propriétés utiles)
      const subCtx = {
        ...ctx,
        commandName: command.name,
        args,
        text: args.join(' '),
      };

      const { dispatchCommand } = await import('../handlers/commandHandler.js');
      await dispatchCommand(subCtx);
      return { ok: true, append: `✅ Commande /${command.name} exécutée.` };
    }

    if (action === 'toggle_feature') {
      if (level < LEVEL.BOT_ADMIN) {
        return { ok: false, append: '🔒 Action réservée aux administrateurs.' };
      }
      const feature = String(params?.feature || '').toLowerCase();
      const state = !!params?.state;
      const allowed = ['antilink', 'antispam', 'antibadword', 'antiflood', 'welcome', 'goodbye', 'autoread', 'autotyping', 'autorecording'];
      if (!allowed.includes(feature)) {
        return { ok: false, append: `❌ Fonction "${feature}" inconnue.` };
      }
      if (!ctx.isGroup) {
        return { ok: false, append: '❌ Cette action ne fonctionne que dans un groupe.' };
      }
      db.updateGroupSettings(ctx.chatId, { [feature]: state });
      return { ok: true, append: `✅ ${feature} ${state ? 'activé' : 'désactivé'}.` };
    }

    if (action === 'get_report') {
      const type = params?.type || 'global';
      return { ok: true, append: buildReport(type, ctx) };
    }

    return { ok: false, append: '❌ Action inconnue.' };
  } catch (err) {
    log.error(`Erreur lors de l'exécution de l'action agent "${action}"`, err.message, err.stack);
    return { ok: false, append: `❌ Erreur : ${err.message}` };
  }
}

export { levelLabel, getPublicCategories };