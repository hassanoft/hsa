import { getContentType, jidNormalizedUser } from '@whiskeysockets/baileys';
import { db } from '../database/database.js';
import { logger } from '../utils/logger.js';
import { getPrefix } from '../utils/prefixStore.js';
import { checkOwner, checkBotAdmin, isGroupAdmin, isBotGroupAdmin } from '../utils/permissions.js';
import { dispatchCommand } from './commandHandler.js';
import { tryHandleContactFlow } from './contactHandler.js';
import { runGroupModeration } from './moderationHandler.js';

const log = logger.child({ class: 'messageHandler' });

function extractText(message) {
  if (!message) return '';
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    message.documentMessage?.caption ||
    message.buttonsResponseMessage?.selectedButtonId ||
    message.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  );
}

const groupMetaCache = new Map(); // groupId -> { data, expiresAt }
const GROUP_META_TTL_MS = 30_000;

export async function getGroupMetadataCached(sock, groupId) {
  const cached = groupMetaCache.get(groupId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  try {
    const data = await sock.groupMetadata(groupId);
    groupMetaCache.set(groupId, { data, expiresAt: Date.now() + GROUP_META_TTL_MS });
    return data;
  } catch (err) {
    log.warn(`Impossible de récupérer les métadonnées du groupe ${groupId}`, err.message);
    return null;
  }
}

export function invalidateGroupMetadata(groupId) {
  groupMetaCache.delete(groupId);
}

export async function handleMessagesUpsert(sock, { messages, type }) {
  if (type !== 'notify') return;

  for (const msg of messages) {
    try {
      await handleSingleMessage(sock, msg);
    } catch (err) {
      log.error('Erreur non gérée dans le traitement du message', err.message, err.stack);
    }
  }
}

async function handleSingleMessage(sock, msg) {
  if (!msg.message) return;
  if (msg.key.remoteJid === 'status@broadcast') return;

  const contentType = getContentType(msg.message);
  if (contentType === 'protocolMessage' || contentType === 'reactionMessage') return;

  const chatId = msg.key.remoteJid;
  const isGroup = chatId.endsWith('@g.us');
  const botJid = jidNormalizedUser(sock.user.id);

  const senderJid = msg.key.fromMe
    ? botJid
    : jidNormalizedUser(isGroup ? msg.key.participant : msg.key.remoteJid);

  const text = extractText(msg.message).trim();
  const pushName = msg.pushName || senderJid.split('@')[0];

  db.touchUser(senderJid, { name: pushName });

  const groupMetadata = isGroup ? await getGroupMetadataCached(sock, chatId) : null;
  if (isGroup) db.touchGroup(chatId, { name: groupMetadata?.subject });

  const isOwner = msg.key.fromMe || checkOwner(senderJid);
  const isBotAdmin = checkBotAdmin(senderJid);
  const isSenderGroupAdmin = isGroup ? isGroupAdmin(groupMetadata, senderJid) : false;
  const isBotGroupAdminFlag = isGroup ? isBotGroupAdmin(groupMetadata, botJid) : false;

  const prefix = getPrefix();

  const reply = async (content) => {
    const payload = typeof content === 'string' ? { text: content } : content;
    return sock.sendMessage(chatId, payload, { quoted: msg });
  };

  const ctx = {
    sock,
    msg,
    chatId,
    isGroup,
    groupMetadata,
    senderJid,
    pushName,
    text,
    isOwner,
    isBotAdmin,
    isSenderGroupAdmin,
    isBotGroupAdmin: isBotGroupAdminFlag,
    prefix,
    reply,
    db,
  };

  // --- Réglages de groupe : lecture automatique ---
  if (isGroup) {
    const settings = db.getGroupSettings(chatId);
    if (settings.autoread) {
      sock.readMessages([msg.key]).catch(() => {});
    }
  }

  // --- Système /contact (réponse OWNER ou contenu en attente) ---
  const handledByContact = await tryHandleContactFlow(sock, ctx);
  if (handledByContact) return;

  // --- Modération automatique de groupe (s'applique à tous les messages) ---
  if (isGroup) {
    const moderated = await runGroupModeration(sock, ctx);
    if (moderated) return;
  }

  // --- Commandes (préfixe obligatoire) ---
  if (!text || !text.startsWith(prefix)) return; // aucune réponse sans préfixe (section 6 / 39)

  const withoutPrefix = text.slice(prefix.length).trim();
  if (!withoutPrefix) return;

  const [rawCommand, ...rest] = withoutPrefix.split(/\s+/);
  const commandName = rawCommand.toLowerCase();
  const args = rest;

  ctx.commandName = commandName;
  ctx.args = args;
  ctx.text = args.join(' ');

  if (isGroup) {
    const settings = db.getGroupSettings(chatId);
    if (settings.autotyping) sock.sendPresenceUpdate('composing', chatId).catch(() => {});
    if (settings.autorecording) sock.sendPresenceUpdate('recording', chatId).catch(() => {});
  }

  await dispatchCommand(ctx);
}

export async function handleGroupParticipantsUpdate(sock, evt) {
  const { id: groupId, participants, action } = evt;
  const { sendWelcome, sendGoodbye } = await import('./moderationHandler.js');
  invalidateGroupMetadata(groupId);

  for (const participant of participants) {
    if (action === 'add') await sendWelcome(sock, groupId, participant).catch(() => {});
    if (action === 'remove') await sendGoodbye(sock, groupId, participant).catch(() => {});
  }
}
