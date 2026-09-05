import { config } from '../config.js';
import { db } from '../database/database.js';
import { logger } from '../utils/logger.js';
import { numberToJid } from '../utils/helpers.js';
import {
  contactOwnerTemplate,
  contactMediaOwnerTemplate,
  contactUserReplyTemplate,
} from '../utils/formatter.js';

const log = logger.child({ class: 'contact' });

const MAX_MEDIA_BYTES = 15 * 1024 * 1024; // 15 Mo, marge de sécurité raisonnable pour WhatsApp

// Sessions "mode 2" en attente d'un contenu (/contact sans texte). En mémoire :
// il s'agit d'un état conversationnel court terme, pas d'une donnée à archiver.
const pendingContacts = new Map(); // userJid -> { expiresAt }

const PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes pour envoyer le message

export function getOwnerJid() {
  if (!config.ownerNumber) return null;
  return numberToJid(config.ownerNumber);
}

export function markPending(userJid) {
  pendingContacts.set(userJid, { expiresAt: Date.now() + PENDING_TTL_MS });
}

export function consumePending(userJid) {
  const entry = pendingContacts.get(userJid);
  if (!entry) return false;
  pendingContacts.delete(userJid);
  if (Date.now() > entry.expiresAt) return false;
  return true;
}

export function isPending(userJid) {
  const entry = pendingContacts.get(userJid);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    pendingContacts.delete(userJid);
    return false;
  }
  return true;
}

/** Envoie un message texte de contact à OWNER et enregistre la correspondance. */
export async function forwardTextToOwner(sock, { userJid, userName, text }) {
  const ownerJid = getOwnerJid();
  if (!ownerJid) {
    log.warn('OWNER_NUMBER non configuré : impossible de transmettre le message /contact.');
    return { ok: false, reason: 'no-owner' };
  }

  const body = contactOwnerTemplate({ userName, userId: userJid, message: text });
  const sent = await sock.sendMessage(ownerJid, { text: body });

  db.saveContactMessage({
    contactMessageId: sent.key.id,
    userJid,
    ownerJid,
    timestamp: Date.now(),
    status: 'pending',
  });

  return { ok: true };
}

/** Envoie un média de contact (image/audio/vidéo/document) à OWNER et enregistre la correspondance. */
export async function forwardMediaToOwner(sock, { userJid, userName, mediaType, buffer, mimetype, caption }) {
  const ownerJid = getOwnerJid();
  if (!ownerJid) {
    return { ok: false, reason: 'no-owner' };
  }

  if (buffer && buffer.length > MAX_MEDIA_BYTES) {
    return { ok: false, reason: 'too-large' };
  }

  const header = contactMediaOwnerTemplate({ userName, userId: userJid, mediaType });

  // On envoie d'abord l'en-tête texte (identité + instructions), puis le média,
  // de façon à garder l'en-tête comme message "citable" pour la réponse de OWNER.
  const sentHeader = await sock.sendMessage(ownerJid, { text: header });

  const mediaPayload = buildMediaPayload(mediaType, buffer, mimetype, caption);
  if (mediaPayload) {
    await sock.sendMessage(ownerJid, mediaPayload);
  }

  db.saveContactMessage({
    contactMessageId: sentHeader.key.id,
    userJid,
    ownerJid,
    timestamp: Date.now(),
    status: 'pending',
  });

  return { ok: true };
}

function buildMediaPayload(type, buffer, mimetype, caption) {
  switch (type) {
    case 'image':
      return { image: buffer, mimetype, caption };
    case 'video':
      return { video: buffer, mimetype, caption };
    case 'audio':
      return { audio: buffer, mimetype: mimetype || 'audio/mp4', ptt: false };
    case 'document':
      return { document: buffer, mimetype: mimetype || 'application/octet-stream', fileName: 'fichier' };
    default:
      return null;
  }
}

/**
 * Traite une éventuelle réponse de OWNER (fonction WhatsApp "Répondre") à un
 * message de contact, et la retransmet à l'utilisateur d'origine.
 * Retourne true si le message a bien été traité comme une réponse de contact.
 */
export async function handleOwnerReply(sock, ctx) {
  const { msg, senderJid, text } = ctx;
  if (senderJid !== getOwnerJid()) return false;

  const quotedId = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
  if (!quotedId) return false;

  const entry = db.getContactMessageById(quotedId);
  if (!entry) return false;

  if (!text) return false;

  await sock.sendMessage(entry.userJid, { text: contactUserReplyTemplate(text) });
  db.updateContactMessageStatus(quotedId, 'answered');

  return true;
}
