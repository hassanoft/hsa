// Service AGENT-IA : assistant personnel du créateur H$Λ BOT.
//
// - Discute avec tout le monde (chat libre)
// - Exécute les commandes publiques
// - Exécute les commandes admin pour owner + bot-admins
// - Réserve les commandes ownerOnly au créateur
// - Vérifie toujours les permissions côté Node.js
// - N'invente jamais une commande ni l'identité de l'utilisateur
//
// ESM / Node.js / Baileys

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { db } from '../database/database.js';
import {
  getCommand,
  getAllCommands,
  getCategories,
  dispatchCommand,
} from '../handlers/commandHandler.js';

const log = logger.child({ class: 'agent' });

// ─────────────────────────────────────────────────────────────
// CATÉGORIES RESTRICTED
// ─────────────────────────────────────────────────────────────

const RESTRICTED_CATEGORIES = new Set([
  'owner',
  'moderation',
  'group',
  'admin',
]);

// ─────────────────────────────────────────────────────────────
// BLACKLIST
// ─────────────────────────────────────────────────────────────
//
// IMPORTANT :
// Une commande blacklistée est interdite aux utilisateurs normaux,
// MAIS le créateur peut l'utiliser via l'agent.
//
// Cela corrige notamment le cas /shutdown.
// ─────────────────────────────────────────────────────────────

const DEFAULT_BLACKLIST = [
  'logout',
  'restart',
  'shutdown',
  'eval',
  'exec',
  'pair',
  'unpair',
];

// ─────────────────────────────────────────────────────────────
// NIVEAUX
// ─────────────────────────────────────────────────────────────

export const LEVEL = {
  USER: 1,
  BOT_ADMIN: 2,
  OWNER: 3,
};

// ─────────────────────────────────────────────────────────────
// MÉMOIRE CONVERSATIONNELLE
// ─────────────────────────────────────────────────────────────

const conversations = new Map();

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

function defaultAgentConfig() {
  return {
    enabled: false,

    creatorJid: config.ownerNumber
      ? `${config.ownerNumber}@s.whatsapp.net`
      : '',

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

  return stored
    ? { ...defaultAgentConfig(), ...stored }
    : defaultAgentConfig();
}

export function setAgentConfig(patch) {
  const current = getAgentConfig();
  const next = {
    ...current,
    ...patch,
  };

  db.setSetting('agent', next);

  return next;
}

export function isAgentEnabled() {
  return getAgentConfig().enabled === true;
}

// ─────────────────────────────────────────────────────────────
// NORMALISATION JID
// ─────────────────────────────────────────────────────────────
//
// Exemples :
//
// 2250700000000@s.whatsapp.net -> 2250700000000
// 2250700000000@c.us           -> 2250700000000
// 123456789@lid                -> 123456789
// 2250700000000                -> 2250700000000
//
// On NE supprime PAS tous les caractères non numériques avant
// d'avoir retiré le suffixe, car @lid doit pouvoir être comparé
// à config.ownerLid.
// ─────────────────────────────────────────────────────────────

function normalizeJid(value) {
  if (!value) return '';

  return String(value)
    .trim()
    .toLowerCase()
    .replace(/@(s\.whatsapp\.net|c\.us|lid)$/i, '');
}

// ─────────────────────────────────────────────────────────────
// NORMALISATION D'UN NUMÉRO OWNER
// ─────────────────────────────────────────────────────────────

function normalizeNumber(value) {
  if (!value) return '';

  return String(value)
    .trim()
    .replace(/\D/g, '');
}

// ─────────────────────────────────────────────────────────────
// VÉRIFICATION OWNER
// ─────────────────────────────────────────────────────────────

function isOwnerJid(senderJid) {
  const senderRaw = String(senderJid || '').trim();

  if (!senderRaw) return false;

  const senderNormalized = normalizeJid(senderRaw);

  const ownerNumber = normalizeNumber(config.ownerNumber);
  const ownerLid = normalizeJid(config.ownerLid);

  // Comparaison LID
  if (
    ownerLid &&
    senderNormalized &&
    senderNormalized === ownerLid
  ) {
    return true;
  }

  // Comparaison numéro WhatsApp
  if (
    ownerNumber &&
    senderNormalized &&
    senderNormalized === ownerNumber
  ) {
    return true;
  }

  // Cas où ownerNumber/config ou senderJid contiennent encore
  // des suffixes WhatsApp.
  const senderDigits = senderNormalized.replace(/\D/g, '');

  if (
    ownerNumber &&
    senderDigits &&
    senderDigits === ownerNumber
  ) {
    return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────────
// NIVEAU UTILISATEUR
// ─────────────────────────────────────────────────────────────

export function getAgentLevel(senderJid) {
  if (!senderJid) {
    log.warn('[AGENT][LEVEL] senderJid absent -> niveau 0');

    return 0;
  }

  const normalizedSender = normalizeJid(senderJid);
  const ownerNumber = normalizeNumber(config.ownerNumber);
  const ownerLid = normalizeJid(config.ownerLid);

  let level = LEVEL.USER;

  // 1. OWNER
  if (isOwnerJid(senderJid)) {
    level = LEVEL.OWNER;
  }

  // 2. BOT ADMIN
  else {
    let isAdmin = false;

    try {
      // Test avec le JID réel
      isAdmin = db.isBotAdmin(senderJid) === true;

      // Certains systèmes de DB stockent le JID normalisé.
      if (!isAdmin && normalizedSender) {
        isAdmin = db.isBotAdmin(normalizedSender) === true;
      }
    } catch (err) {
      log.warn(
        `[AGENT][LEVEL] erreur db.isBotAdmin: ${err.message}`
      );
    }

    if (isAdmin) {
      level = LEVEL.BOT_ADMIN;
    }
  }

  // DEBUG TEMPORAIRE DEMANDÉ
  log.info(
    `[AGENT][LEVEL] senderJid=${senderJid} ` +
    `normalized=${normalizedSender} ` +
    `ownerNumber=${config.ownerNumber || ''} ` +
    `ownerNumberNormalized=${ownerNumber} ` +
    `ownerLid=${config.ownerLid || ''} ` +
    `ownerLidNormalized=${ownerLid} ` +
    `level=${levelLabel(level)}`
  );

  return level;
}

function levelLabel(level) {
  return {
    3: 'CRÉATEUR',
    2: 'BOT-ADMIN',
    1: 'UTILISATEUR',
  }[level] || 'INCONNU';
}

// ─────────────────────────────────────────────────────────────
// CATÉGORIES PUBLIQUES
// ─────────────────────────────────────────────────────────────

function getPublicCategories() {
  return getCategories().filter(
    (c) => !RESTRICTED_CATEGORIES.has(c)
  );
}

// ─────────────────────────────────────────────────────────────
// LISTE RÉELLE DES COMMANDES
// ─────────────────────────────────────────────────────────────
//
// Cette fonction utilise directement commandHandler.js.
// Aucune commande n'est inventée.
//
// ─────────────────────────────────────────────────────────────

function buildCommandCatalog() {
  const commands = getAllCommands();

  return commands
    .filter(Boolean)
    .map((command) => {
      const aliases = Array.isArray(command.aliases)
        ? command.aliases
        : [];

      return {
        name: String(command.name || '').trim().toLowerCase(),
        aliases: aliases
          .map((a) => String(a).trim().toLowerCase())
          .filter(Boolean),
        category: String(command.category || 'general'),
        description: String(
          command.description || 'Aucune description'
        ),
        groupOnly: command.groupOnly === true,
        adminOnly: command.adminOnly === true,
        ownerOnly: command.ownerOnly === true,
      };
    })
    .filter((command) => command.name);
}

// ─────────────────────────────────────────────────────────────
// FORMATAGE DE LA LISTE DES COMMANDES POUR L'IA
// ─────────────────────────────────────────────────────────────

function buildCommandCatalogText() {
  const commands = buildCommandCatalog();

  if (commands.length === 0) {
    return 'Aucune commande enregistrée dans commandHandler.js.';
  }

  return commands
    .map((command) => {
      const aliases = command.aliases.length
        ? ` | alias: ${command.aliases.map((a) => `/${a}`).join(', ')}`
        : '';

      const restrictions = [
        command.ownerOnly ? 'OWNER' : null,
        command.adminOnly ? 'ADMIN' : null,
        command.groupOnly ? 'GROUPE' : null,
      ]
        .filter(Boolean)
        .join(', ');

      const restrictionText = restrictions
        ? ` | accès: ${restrictions}`
        : '';

      return (
        `- /${command.name}` +
        ` | catégorie: ${command.category}` +
        `${aliases}` +
        `${restrictionText}` +
        ` | ${command.description}`
      );
    })
    .join('\n');
}

// ─────────────────────────────────────────────────────────────
// RECHERCHE DE COMMANDES SIMILAIRES
// ─────────────────────────────────────────────────────────────

function findCommandSuggestions(input) {
  const query = String(input || '')
    .replace(/^\//, '')
    .trim()
    .toLowerCase();

  if (!query) return [];

  const prefix = query.slice(0, 3);
  const commands = buildCommandCatalog();

  const scored = [];

  for (const command of commands) {
    const names = [
      command.name,
      ...command.aliases,
    ];

    let score = 0;

    for (const name of names) {
      if (name === query) {
        score = Math.max(score, 100);
      } else if (name.startsWith(query)) {
        score = Math.max(score, 80);
      } else if (prefix.length >= 1 && name.startsWith(prefix)) {
        score = Math.max(score, 60);
      } else if (name.includes(query)) {
        score = Math.max(score, 40);
      }
    }

    if (score > 0) {
      scored.push({
        command,
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => `/${item.command.name}`);
}

function unknownCommandMessage(name) {
  const suggestions = findCommandSuggestions(name);

  let message =
    `❌ Commande inconnue : /${String(name).replace(/^\//, '')}`;

  if (suggestions.length) {
    message +=
      `\n\n🔎 Commandes similaires :\n` +
      suggestions.map((s) => `• ${s}`).join('\n');
  } else {
    message +=
      '\n\n💡 Utilise la liste des commandes disponibles pour voir les commandes valides.';
  }

  return message;
}

// ─────────────────────────────────────────────────────────────
// PERMISSIONS
// ─────────────────────────────────────────────────────────────

export function canAgentExecute(
  command,
  level,
  agentCfg = getAgentConfig()
) {
  if (!command) {
    return {
      ok: false,
      reason: 'unknown-command',
    };
  }

  const blacklist = Array.isArray(agentCfg.blacklist)
    ? agentCfg.blacklist.map((x) =>
        String(x).replace(/^\//, '').toLowerCase()
      )
    : [];

  const commandName = String(command.name || '').toLowerCase();

  // OWNER : la blacklist agent ne bloque pas le créateur.
  //
  // Les restrictions réelles de la commande restent néanmoins
  // appliquées par dispatchCommand().
  if (
    blacklist.includes(commandName) &&
    level < LEVEL.OWNER
  ) {
    return {
      ok: false,
      reason: 'blacklisted',
    };
  }

  if (command.ownerOnly && level < LEVEL.OWNER) {
    return {
      ok: false,
      reason: 'owner-required',
    };
  }

  if (command.adminOnly && level < LEVEL.BOT_ADMIN) {
    return {
      ok: false,
      reason: 'admin-required',
    };
  }

  if (
    RESTRICTED_CATEGORIES.has(command.category) &&
    level < LEVEL.BOT_ADMIN
  ) {
    return {
      ok: false,
      reason: 'restricted-category',
    };
  }

  return {
    ok: true,
  };
}

// ─────────────────────────────────────────────────────────────
// IDENTITÉ SÉCURISÉE
// ─────────────────────────────────────────────────────────────

function getIdentityName(pushName) {
  const name = String(pushName || '').trim();

  if (!name) {
    return 'Nom WhatsApp non disponible';
  }

  return name;
}

// ─────────────────────────────────────────────────────────────
// PROMPT SYSTÈME
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(level, pushName, senderJid) {
  const publicCats = getPublicCategories().join(', ');
  const restrictedCats = [
    ...RESTRICTED_CATEGORIES,
  ].join(', ');

  const commandCatalog = buildCommandCatalogText();
  const agentCfg = getAgentConfig();

  const realName = getIdentityName(pushName);
  const realJid = String(senderJid || 'JID non disponible');

  const authority =
    level === LEVEL.OWNER
      ? `
L'utilisateur est le CRÉATEUR du bot.
Il possède le niveau OWNER.
Il peut demander les commandes ownerOnly, admin et publiques.
La blacklist AGENT ne bloque PAS le créateur.
Les permissions réelles de commandHandler.js restent obligatoires.
`
      : level === LEVEL.BOT_ADMIN
      ? `
L'utilisateur est BOT-ADMIN.
Il peut utiliser les commandes autorisées aux administrateurs.
Il ne peut PAS utiliser les commandes ownerOnly.
`
      : `
L'utilisateur est UTILISATEUR.
Il ne peut utiliser que les commandes publiques.
Catégories publiques : ${publicCats || 'aucune'}.
Catégories réservées : ${restrictedCats}.
`;

  return `Tu es AGENT-IA, l'assistant officiel du bot WhatsApp "${config.botName}".

IDENTITÉ DU BOT :
- Nom du bot : ${config.botName}
- Créateur du bot : le créateur configuré dans le système.

IDENTITÉ RÉELLE DE L'UTILISATEUR :
- Nom WhatsApp réel (pushName) : "${realName}"
- JID WhatsApp réel : "${realJid}"
- Niveau réel : "${levelLabel(level)}"
- Code niveau : ${level}

RÈGLE ABSOLUE SUR L'IDENTITÉ :
- Le nom "${realName}" est le SEUL nom connu de l'utilisateur.
- Ne remplace jamais son nom par le nom du bot.
- Ne dis jamais que l'utilisateur s'appelle "${config.botName}".
- N'invente jamais son nom.
- Ne déduis jamais son identité à partir du contexte.
- Si l'utilisateur demande "qui suis-je ?", "qui je suis ?", "mon nom ?", "quel est mon niveau ?", réponds UNIQUEMENT avec les informations présentes ci-dessus.
- Pour "qui suis-je ?", indique au minimum le nom WhatsApp réel et le niveau réel.

${authority}

LISTE OFFICIELLE DES COMMANDES :
La liste ci-dessous provient directement de getAllCommands() du bot.
Tu dois considérer cette liste comme la SEULE source de vérité pour les commandes.

${commandCatalog}

RÈGLE ABSOLUE SUR LES COMMANDES :
- N'invente JAMAIS une commande.
- Une commande n'existe que si elle apparaît dans la liste officielle ci-dessus.
- Les alias affichés sont également valides.
- Si une commande demandée n'est pas dans cette liste, ne prétends jamais qu'elle existe.
- Si l'utilisateur demande une commande inconnue, utilise action=null et explique clairement qu'elle n'existe pas.
- Tu peux proposer des commandes similaires uniquement lorsqu'elles apparaissent réellement dans la liste officielle.
- Ne transforme jamais une commande inconnue en action execute_command.
- Ne fabrique jamais de nom de commande à partir d'une description.

RÔLES :
1. Discuter naturellement.
2. Exécuter les commandes réellement disponibles via "execute_command".
3. Activer/désactiver les features autorisées via "toggle_feature".
4. Générer des rapports via "get_report".

RÉPONSE OBLIGATOIRE — JSON STRICT :
{
  "reply": "texte à envoyer à l'utilisateur",
  "action": null | "execute_command" | "toggle_feature" | "get_report",
  "params": null | objet
}

Détails des actions :

execute_command :
{
  "command": "nom_exact_de_la_commande",
  "args": []
}

toggle_feature :
{
  "feature": "antilink"|"antispam"|"antibadword"|"antiflood"|"welcome"|"goodbye"|"autoread"|"autotyping"|"autorecording",
  "state": true|false
}

get_report :
{
  "type": "global"|"group"|"features"
}

RÈGLE DE SÉCURITÉ :
L'IA ne décide jamais seule des permissions.
Le code Node.js vérifie toujours le niveau réel avant d'exécuter une commande.

Si l'utilisateur n'a pas les droits :
- action=null
- explique la restriction.

Si la commande n'existe pas :
- action=null
- indique "Commande inconnue"
- propose éventuellement les suggestions réellement trouvées.

Réponds TOUJOURS en JSON valide et rien d'autre.`;
}

// ─────────────────────────────────────────────────────────────
// APPEL IA MULTI-PROVIDER
// ─────────────────────────────────────────────────────────────

async function callAI(messages, { temperature = 0.4 } = {}) {
  const providers = config.aiProviders || [];

  if (providers.length === 0) {
    return {
      ok: false,
      reason: 'not-configured',
    };
  }

  let lastError = 'unknown';

  for (const provider of providers) {
    const keys = Array.isArray(provider.apiKeys)
      ? provider.apiKeys
      : [];

    for (const apiKey of keys) {
      try {
        const isGemini =
          String(provider.name || '').toLowerCase() === 'gemini';

        let url = provider.url;
        let body;

        if (!apiKey || !url) {
          continue;
        }

        if (isGemini) {
          url = url
            .replace('{model}', provider.model)
            .replace('{apiKey}', apiKey);

          const systemParts = messages
            .filter((m) => m.role === 'system')
            .map((m) => m.content)
            .join('\n\n');

          const contents = messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role:
                m.role === 'assistant'
                  ? 'model'
                  : 'user',
              parts: [
                {
                  text: m.content,
                },
              ],
            }));

          body = {
            contents,

            ...(systemParts
              ? {
                  systemInstruction: {
                    parts: [
                      {
                        text: systemParts,
                      },
                    ],
                  },
                }
              : {}),

            generationConfig: {
              temperature,
              responseMimeType: 'application/json',
            },
          };
        } else {
          body = {
            model: provider.model,
            messages,
            temperature,
            response_format: {
              type: 'json_object',
            },
          };
        }

        const headers = {
          'Content-Type': 'application/json',
        };

        // Gemini place généralement la clé dans l'URL.
        // Les autres providers utilisent Bearer.
        if (!isGemini) {
          headers.Authorization = `Bearer ${apiKey}`;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers,
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

        return {
          ok: true,
          text: String(text).trim(),
          provider: provider.name,
        };
      } catch (err) {
        lastError = err?.message || 'unknown-error';
        continue;
      }
    }
  }

  return {
    ok: false,
    reason: lastError,
  };
}

// ─────────────────────────────────────────────────────────────
// PARSE JSON IA
// ─────────────────────────────────────────────────────────────

function parseAgentResponse(raw) {
  if (!raw) {
    return {
      reply: '…',
      action: null,
      params: null,
    };
  }

  let cleaned = String(raw).trim();

  cleaned = cleaned
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);

    return {
      reply: String(parsed.reply || '').trim() || '…',
      action:
        parsed.action === 'execute_command' ||
        parsed.action === 'toggle_feature' ||
        parsed.action === 'get_report'
          ? parsed.action
          : null,
      params:
        parsed.params && typeof parsed.params === 'object'
          ? parsed.params
          : null,
    };
  } catch {
    return {
      reply: cleaned,
      action: null,
      params: null,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// NETTOYAGE DES HALLUCINATIONS
// ─────────────────────────────────────────────────────────────

function cleanIdentityHallucination(text, pushName) {
  let result = String(text || '');

  const realName = getIdentityName(pushName);

  if (
    !realName ||
    realName === 'Nom WhatsApp non disponible'
  ) {
    return result;
  }

  const botName = String(config.botName || '').trim();

  if (!botName) {
    return result;
  }

  // Corrige quelques formulations classiques :
  //
  // "Vous êtes H$Λ..."
  // "Tu es H$Λ..."
  //
  // On ne remplace pas aveuglément toutes les occurrences du nom
  // du bot : le bot peut légitimement être cité dans la réponse.
  const escapedBot = botName.replace(
    /[.*+?^${}()|[\]\\]/g,
    '\\$&'
  );

  result = result.replace(
    new RegExp(
      `(Vous êtes|Tu es|Vous êtes l'utilisateur|Tu es l'utilisateur)\\s+${escapedBot}`,
      'gi'
    ),
    `$1 ${realName}`
  );

  return result;
}

// ─────────────────────────────────────────────────────────────
// RÉPONSE D'IDENTITÉ DÉTERMINISTE
// ─────────────────────────────────────────────────────────────
//
// Aucun appel IA nécessaire.
//
// Cela garantit qu'une question d'identité ne peut pas être
// halluciné par le modèle.
// ─────────────────────────────────────────────────────────────

function isIdentityQuestion(text) {
  const normalized = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[?!.,]/g, '');

  const patterns = [
    'qui suis je',
    'qui je suis',
    'qui suis-je',
    'quel est mon nom',
    'c est quoi mon nom',
    'mon nom',
    'quel est mon niveau',
    'mon niveau',
  ];

  return patterns.some((pattern) =>
    normalized.includes(pattern)
  );
}

function buildIdentityReply(pushName, senderJid, level) {
  const realName = getIdentityName(pushName);

  return (
    `👤 Nom WhatsApp : ${realName}\n` +
    `🆔 JID : ${senderJid || 'non disponible'}\n` +
    `🛡️ Niveau : ${levelLabel(level)}`
  );
}

// ─────────────────────────────────────────────────────────────
// DÉTECTION D'UNE COMMANDE SIMPLE
// ─────────────────────────────────────────────────────────────
//
// Exemples détectés :
// "add"
// "/add"
// "shutdown"
// "/shutdown"
// "tagall"
//
// Cela permet de ne pas dépendre de l'IA pour reconnaître une
// commande exacte.
// ─────────────────────────────────────────────────────────────

function extractSimpleCommand(text) {
  const value = String(text || '').trim();

  if (!value) return null;

  // On accepte /command et command.
  const match = value.match(/^\/?([a-zA-Z0-9_-]+)$/);

  if (!match) return null;

  return match[1].toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// RAPPORT
// ─────────────────────────────────────────────────────────────

export function buildReport(type = 'global', ctx = null) {
  const now = new Date().toLocaleString('fr-FR');

  let r =
    `╭──────────────────────────────╮\n` +
    `│       📊 AGENT-IA RAPPORT    │\n` +
    `╰──────────────────────────────╯\n\n`;

  r += `🕐 ${now}\n\n`;

  if (type === 'group' && ctx?.chatId) {
    const s = db.getGroupSettings(ctx.chatId);

    r +=
      `👥 Groupe : ${
        ctx.groupMetadata?.subject || ctx.chatId
      }\n\n`;

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

  r +=
    `🤖 Statut agent : ${
      agentCfg.enabled ? '🟢 Actif' : '🔴 Inactif'
    }\n`;

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

// ─────────────────────────────────────────────────────────────
// HISTORIQUE
// ─────────────────────────────────────────────────────────────

function pushHistory(senderJid, role, content, max) {
  const hist = conversations.get(senderJid) || [];

  hist.push({
    role,
    content,
  });

  if (hist.length > max) {
    hist.splice(0, hist.length - max);
  }

  conversations.set(senderJid, hist);
}

export function clearHistory(senderJid) {
  conversations.delete(senderJid);
}

// ─────────────────────────────────────────────────────────────
// EXÉCUTION DIRECTE D'UNE COMMANDE SIMPLE
// ─────────────────────────────────────────────────────────────

async function executeSimpleCommand(
  commandName,
  { sock, ctx, level, agentCfg }
) {
  const command = getCommand(commandName);

  if (!command) {
    return {
      ok: false,
      append: unknownCommandMessage(commandName),
    };
  }

  const perm = canAgentExecute(
    command,
    level,
    agentCfg
  );

  if (!perm.ok) {
    return {
      ok: false,
      append: permissionMessage(
        command,
        perm.reason
      ),
    };
  }

  const subCtx = {
    ...ctx,
    commandName: command.name,
    args: [],
    text: '',
    sock,
  };

  await dispatchCommand(subCtx);

  return {
    ok: true,
    append: `✅ Commande /${command.name} exécutée.`,
  };
}

// ─────────────────────────────────────────────────────────────
// MESSAGE PERMISSION
// ─────────────────────────────────────────────────────────────

function permissionMessage(command, reason) {
  const msgs = {
    blacklisted:
      `❌ La commande /${command.name} est bloquée par sécurité.`,

    'owner-required':
      `🔒 /${command.name} est réservée au créateur du bot.`,

    'admin-required':
      `🔒 /${command.name} nécessite des droits d'administrateur.`,

    'restricted-category':
      `🔒 La catégorie "${command.category}" n'est pas accessible via l'agent.`,

    'unknown-command':
      '❌ Commande inconnue.',
  };

  return (
    msgs[reason] ||
    '❌ Action refusée.'
  );
}

// ─────────────────────────────────────────────────────────────
// POINT D'ENTRÉE PRINCIPAL
// ─────────────────────────────────────────────────────────────

export async function runAgent(sock, ctx) {
  const agentCfg = getAgentConfig();

  if (!agentCfg.enabled) {
    return {
      handled: false,
    };
  }

  const level = getAgentLevel(ctx.senderJid);

  if (level === 0) {
    return {
      handled: false,
    };
  }

  const userText = ctx.text?.trim();

  if (!userText) {
    return {
      handled: false,
    };
  }

  // ───────────────────────────────────────────────────────────
  // STATS
  // ───────────────────────────────────────────────────────────

  agentCfg.stats.interactions += 1;

  setAgentConfig({
    stats: agentCfg.stats,
  });

  // ───────────────────────────────────────────────────────────
  // IDENTITÉ : RÉPONSE 100 % DÉTERMINISTE
  // ───────────────────────────────────────────────────────────

  if (isIdentityQuestion(userText)) {
    const reply = buildIdentityReply(
      ctx.pushName,
      ctx.senderJid,
      level
    );

    pushHistory(
      ctx.senderJid,
      'user',
      userText,
      agentCfg.maxHistory
    );

    pushHistory(
      ctx.senderJid,
      'assistant',
      reply,
      agentCfg.maxHistory
    );

    return {
      handled: true,
      reply,
      executed: {
        action: null,
        ok: false,
        detail: null,
      },
      level,
    };
  }

  // ───────────────────────────────────────────────────────────
  // COMMANDE SIMPLE
  // ───────────────────────────────────────────────────────────
  //
  // Si l'utilisateur écrit exactement :
  //
  // add
  // shutdown
  // /add
  //
  // on ne demande pas à l'IA de deviner.
  // On consulte directement commandHandler.js.
  //
  // Si elle existe -> exécution normale + permissions.
  // Si elle n'existe pas -> message "commande inconnue".
  // ───────────────────────────────────────────────────────────

  const simpleCommand = extractSimpleCommand(userText);

  if (simpleCommand) {
    const command = getCommand(simpleCommand);

    if (command) {
      const result = await executeSimpleCommand(
        simpleCommand,
        {
          sock,
          ctx,
          level,
          agentCfg,
        }
      );

      if (result.ok) {
        agentCfg.stats.commandsExecuted += 1;
      } else {
        agentCfg.stats.errors += 1;
      }

      setAgentConfig({
        stats: agentCfg.stats,
      });

      return {
        handled: true,
        reply: result.append,
        executed: {
          action: 'execute_command',
          ok: result.ok,
          detail: result.append,
        },
        level,
      };
    }

    // La commande n'existe réellement pas.
    // On répond immédiatement au lieu de laisser l'IA inventer.
    const unknownReply = unknownCommandMessage(
      simpleCommand
    );

    pushHistory(
      ctx.senderJid,
      'user',
      userText,
      agentCfg.maxHistory
    );

    pushHistory(
      ctx.senderJid,
      'assistant',
      unknownReply,
      agentCfg.maxHistory
    );

    return {
      handled: true,
      reply: unknownReply,
      executed: {
        action: null,
        ok: false,
        detail: 'unknown-command',
      },
      level,
    };
  }

  // ───────────────────────────────────────────────────────────
  // HISTORIQUE
  // ───────────────────────────────────────────────────────────

  const history =
    conversations.get(ctx.senderJid) || [];

  const messages = [
    {
      role: 'system',
      content: buildSystemPrompt(
        level,
        ctx.pushName,
        ctx.senderJid
      ),
    },

    ...history,

    {
      role: 'user',
      content: userText,
    },
  ];

  // ───────────────────────────────────────────────────────────
  // IA
  // ───────────────────────────────────────────────────────────

  const aiResult = await callAI(messages);

  if (!aiResult.ok) {
    agentCfg.stats.errors += 1;

    setAgentConfig({
      stats: agentCfg.stats,
    });

    const reasonMsg = {
      'not-configured':
        "⚠️ Aucune clé IA n'est configurée. Contactez le créateur.",

      'http-401':
        '⚠️ Clé IA invalide.',

      'http-429':
        '⏳ Trop de requêtes IA, réessayez dans un instant.',
    }[aiResult.reason] ||
      `❌ Erreur IA (${aiResult.reason}).`;

    return {
      handled: true,
      reply: reasonMsg,
    };
  }

  const parsed = parseAgentResponse(
    aiResult.text
  );

  // ───────────────────────────────────────────────────────────
  // NETTOYAGE RÉPONSE
  // ───────────────────────────────────────────────────────────

  let finalReply = cleanIdentityHallucination(
    parsed.reply,
    ctx.pushName
  );

  // ───────────────────────────────────────────────────────────
  // HISTORIQUE
  // ───────────────────────────────────────────────────────────

  pushHistory(
    ctx.senderJid,
    'user',
    userText,
    agentCfg.maxHistory
  );

  pushHistory(
    ctx.senderJid,
    'assistant',
    finalReply,
    agentCfg.maxHistory
  );

  const executed = {
    action: null,
    ok: false,
    detail: null,
  };

  // ───────────────────────────────────────────────────────────
  // EXÉCUTION ACTION
  // ───────────────────────────────────────────────────────────

  if (
    parsed.action &&
    agentCfg.autoExecute
  ) {
    const result = await executeAction(
      parsed.action,
      parsed.params,
      {
        sock,
        ctx,
        level,
        agentCfg,
      }
    );

    executed.action = parsed.action;
    executed.ok = result.ok;
    executed.detail = result.detail || null;

    if (result.append) {
      finalReply += `\n\n${result.append}`;
    }

    if (result.ok) {
      agentCfg.stats.commandsExecuted += 1;
    } else {
      agentCfg.stats.errors += 1;
    }

    setAgentConfig({
      stats: agentCfg.stats,
    });
  }

  return {
    handled: true,
    reply: finalReply,
    executed,
    level,
  };
}

// ─────────────────────────────────────────────────────────────
// EXÉCUTION D'ACTION IA
// ─────────────────────────────────────────────────────────────

async function executeAction(
  action,
  params,
  {
    sock,
    ctx,
    level,
    agentCfg,
  }
) {
  try {
    // ─────────────────────────────────────────────────────────
    // EXECUTE COMMAND
    // ─────────────────────────────────────────────────────────

    if (action === 'execute_command') {
      const name = String(
        params?.command || ''
      )
        .replace(/^\//, '')
        .trim()
        .toLowerCase();

      const args = Array.isArray(params?.args)
        ? params.args.map(String)
        : [];

      if (!name) {
        return {
          ok: false,
          detail: 'missing-command',
          append:
            '❌ Aucune commande précisée.',
        };
      }

      const command = getCommand(name);

      // DOUBLE VÉRIFICATION :
      // même si l'IA invente une commande, elle ne sera jamais
      // exécutée.
      if (!command) {
        return {
          ok: false,
          detail: 'unknown-command',
          append: unknownCommandMessage(name),
        };
      }

      const perm = canAgentExecute(
        command,
        level,
        agentCfg
      );

      if (!perm.ok) {
        return {
          ok: false,
          detail: perm.reason,
          append: permissionMessage(
            command,
            perm.reason
          ),
        };
      }

      const subCtx = {
        ...ctx,

        sock,

        commandName: command.name,

        args,

        text: args.join(' '),
      };

      // dispatchCommand reste l'autorité finale.
      await dispatchCommand(subCtx);

      return {
        ok: true,
        detail: command.name,
        append:
          `✅ Commande /${command.name} exécutée.`,
      };
    }

    // ─────────────────────────────────────────────────────────
    // TOGGLE FEATURE
    // ─────────────────────────────────────────────────────────

    if (action === 'toggle_feature') {
      if (level < LEVEL.BOT_ADMIN) {
        return {
          ok: false,
          detail: 'admin-required',
          append:
            '🔒 Action réservée aux administrateurs.',
        };
      }

      const feature = String(
        params?.feature || ''
      ).toLowerCase();

      const state = !!params?.state;

      const allowed = [
        'antilink',
        'antispam',
        'antibadword',
        'antiflood',
        'welcome',
        'goodbye',
        'autoread',
        'autotyping',
        'autorecording',
      ];

      if (!allowed.includes(feature)) {
        return {
          ok: false,
          detail: 'unknown-feature',
          append:
            `❌ Fonction "${feature}" inconnue.`,
        };
      }

      if (!ctx.isGroup) {
        return {
          ok: false,
          detail: 'group-required',
          append:
            '❌ Cette action ne fonctionne que dans un groupe.',
        };
      }

      db.updateGroupSettings(
        ctx.chatId,
        {
          [feature]: state,
        }
      );

      return {
        ok: true,
        detail: feature,
        append:
          `✅ ${feature} ${
            state ? 'activé' : 'désactivé'
          }.`,
      };
    }

    // ─────────────────────────────────────────────────────────
    // REPORT
    // ─────────────────────────────────────────────────────────

    if (action === 'get_report') {
      if (level < LEVEL.BOT_ADMIN) {
        return {
          ok: false,
          detail: 'admin-required',
          append:
            '🔒 Les rapports sont réservés aux administrateurs.',
        };
      }

      const type =
        params?.type || 'global';

      const allowedTypes = [
        'global',
        'group',
        'features',
      ];

      if (!allowedTypes.includes(type)) {
        return {
          ok: false,
          detail: 'unknown-report',
          append:
            `❌ Type de rapport "${type}" inconnu.`,
        };
      }

      return {
        ok: true,
        detail: type,
        append: buildReport(
          type,
          ctx
        ),
      };
    }

    return {
      ok: false,
      detail: 'unknown-action',
      append:
        '❌ Action IA inconnue.',
    };
  } catch (err) {
    log.error(
      `Erreur lors de l'exécution de l'action agent "${action}"`,
      err.message,
      err.stack
    );

    return {
      ok: false,
      detail: 'execution-error',
      append:
        `❌ Erreur : ${err.message}`,
    };
  }
}

// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

export {
  levelLabel,
  getPublicCategories,
  normalizeJid,
  buildCommandCatalog,
  findCommandSuggestions,
};