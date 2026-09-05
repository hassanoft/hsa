// Modération automatique de groupe : antilink, antibadword, antiflood,
// antispam. S'applique à TOUS les messages d'un groupe (pas seulement aux
// commandes). Nécessite que H$Λ BOT soit administrateur du groupe pour
// pouvoir supprimer les messages fautifs.

import { db } from '../database/database.js';
import { logger } from '../utils/logger.js';

const log = logger.child({ class: 'moderation' });

const LINK_REGEX = /(https?:\/\/|chat\.whatsapp\.com\/|wa\.me\/)[^\s]+/i;

// Fenêtres glissantes en mémoire pour antiflood / antispam
const floodTracker = new Map(); // `${group}:${user}` -> timestamps[]
const spamTracker = new Map(); // `${group}:${user}` -> { lastText, count }

const FLOOD_WINDOW_MS = 8000;
const FLOOD_MAX_MESSAGES = 6;
const SPAM_REPEAT_THRESHOLD = 4;

async function deleteAndWarn(sock, ctx, reason) {
  const { chatId, senderJid, msg } = ctx;
  try {
    if (ctx.isBotGroupAdmin) {
      await sock.sendMessage(chatId, { delete: msg.key });
    }
  } catch (err) {
    log.warn('Suppression du message impossible (droits admin manquants ?)', err.message);
  }

  const settings = db.getGroupSettings(chatId);
  const warnings = db.addWarning(chatId, senderJid, reason);
  const limit = settings.warnLimit || 3;

  await sock.sendMessage(chatId, {
    text: `⚠️ @${senderJid.split('@')[0]} : ${reason}\n⚠️ Avertissement : ${warnings.length}/${limit}`,
    mentions: [senderJid],
  });

  if (warnings.length >= limit && ctx.isBotGroupAdmin) {
    try {
      await sock.groupParticipantsUpdate(chatId, [senderJid], 'remove');
      db.clearWarnings(chatId, senderJid);
      await sock.sendMessage(chatId, {
        text: `🚫 @${senderJid.split('@')[0]} a été exclu (limite d'avertissements atteinte).`,
        mentions: [senderJid],
      });
    } catch (err) {
      log.warn("Exclusion automatique impossible", err.message);
    }
  }
}

/** À appeler pour chaque message reçu dans un groupe. Retourne true si le message a été traité (supprimé). */
export async function runGroupModeration(sock, ctx) {
  const { chatId, senderJid, text, isSenderGroupAdmin, isOwner } = ctx;
  if (!chatId?.endsWith('@g.us')) return false;
  if (isSenderGroupAdmin || isOwner) return false; // les admins/owner ne sont jamais modérés
  if (!text) return false;

  const settings = db.getGroupSettings(chatId);

  // --- ANTILINK ---
  if (settings.antilink && LINK_REGEX.test(text)) {
    const whitelisted = (settings.antilinkWhitelist || []).some((w) => text.includes(w));
    if (!whitelisted) {
      await deleteAndWarn(sock, ctx, 'Envoi de lien non autorisé.');
      return true;
    }
  }

  // --- ANTIBADWORD ---
  if (settings.antibadword && (settings.antibadwordList || []).length) {
    const lower = text.toLowerCase();
    const hit = settings.antibadwordList.find((w) => lower.includes(w.toLowerCase()));
    if (hit) {
      await deleteAndWarn(sock, ctx, 'Langage inapproprié détecté.');
      return true;
    }
  }

  // --- ANTIFLOOD (trop de messages en peu de temps) ---
  if (settings.antiflood) {
    const key = `${chatId}:${senderJid}`;
    const now = Date.now();
    const list = (floodTracker.get(key) || []).filter((t) => now - t < FLOOD_WINDOW_MS);
    list.push(now);
    floodTracker.set(key, list);
    if (list.length > FLOOD_MAX_MESSAGES) {
      floodTracker.set(key, []);
      await deleteAndWarn(sock, ctx, 'Flood détecté (trop de messages).');
      return true;
    }
  }

  // --- ANTISPAM (même message répété) ---
  if (settings.antispam) {
    const key = `${chatId}:${senderJid}`;
    const prev = spamTracker.get(key);
    if (prev && prev.lastText === text) {
      prev.count += 1;
    } else {
      spamTracker.set(key, { lastText: text, count: 1 });
    }
    const entry = spamTracker.get(key);
    if (entry.count >= SPAM_REPEAT_THRESHOLD) {
      spamTracker.set(key, { lastText: text, count: 0 });
      await deleteAndWarn(sock, ctx, 'Message répété (spam).');
      return true;
    }
  }

  return false;
}

export async function sendWelcome(sock, groupId, userJid) {
  const settings = db.getGroupSettings(groupId);
  if (!settings.welcome) return;
  const template = settings.welcomeMessage || 'Bienvenue @user dans le groupe ! 👋';
  const text = template.replace('@user', `@${userJid.split('@')[0]}`);
  await sock.sendMessage(groupId, { text, mentions: [userJid] });
}

export async function sendGoodbye(sock, groupId, userJid) {
  const settings = db.getGroupSettings(groupId);
  if (!settings.goodbye) return;
  const template = settings.goodbyeMessage || 'Au revoir @user 👋';
  const text = template.replace('@user', `@${userJid.split('@')[0]}`);
  await sock.sendMessage(groupId, { text, mentions: [userJid] });
}
