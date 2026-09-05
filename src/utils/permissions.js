import { config, isOwner } from '../config.js';
import { db } from '../database/database.js';

export const LEVELS = { OWNER: 3, ADMIN: 2, USER: 1 };

/**
 * Vérifie si un JID est l'OWNER configuré (.env OWNER_NUMBER).
 * Vérification faite côté serveur — jamais confiée au client / au menu.
 */
export function checkOwner(jid) {
  return isOwner(jid);
}

/** ADMIN applicatif H$Λ BOT (ajouté via /addadmin), distinct des admins de groupe WhatsApp. */
export function checkBotAdmin(jid) {
  return checkOwner(jid) || db.isBotAdmin(jid);
}

/** Vérifie si l'utilisateur est admin du groupe WhatsApp courant (nécessite groupMetadata). */
export function isGroupAdmin(groupMetadata, jid) {
  if (!groupMetadata || !jid) return false;
  const participant = groupMetadata.participants?.find((p) => p.id === jid);
  return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}

/** Vérifie si le bot lui-même est admin du groupe (requis pour kick/promote/etc.) */
export function isBotGroupAdmin(groupMetadata, botJid) {
  return isGroupAdmin(groupMetadata, botJid);
}

export function getPermissionLevel(jid, groupMetadata) {
  if (checkOwner(jid)) return LEVELS.OWNER;
  if (checkBotAdmin(jid) || isGroupAdmin(groupMetadata, jid)) return LEVELS.ADMIN;
  return LEVELS.USER;
}

/**
 * Vérifie les permissions requises par une commande contre le contexte d'exécution.
 * Retourne { allowed: boolean, reason?: string }
 */
export function checkCommandPermissions(command, ctx) {
  if (command.groupOnly && !ctx.isGroup) {
    return { allowed: false, reason: 'group' };
  }
  if (command.privateOnly && ctx.isGroup) {
    return { allowed: false, reason: 'private' };
  }
  if (command.ownerOnly && !ctx.isOwner) {
    return { allowed: false, reason: 'owner' };
  }
  if (command.adminOnly && !ctx.isOwner && !ctx.isBotAdmin && !ctx.isSenderGroupAdmin) {
    return { allowed: false, reason: 'admin' };
  }
  if (command.requireBotGroupAdmin && ctx.isGroup && !ctx.isBotGroupAdmin) {
    return { allowed: false, reason: 'bot-admin' };
  }
  return { allowed: true };
}

export { config };
