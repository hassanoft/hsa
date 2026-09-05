import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { downloadMediaMessage } from '@whiskeysockets/baileys';
import ffmpeg from 'fluent-ffmpeg';
import { config } from '../config.js';
import { logger } from './logger.js';
import { shortId } from './helpers.js';

const log = logger.child({ class: 'media' });

let resolvedFfmpegPath = null;

/** Résout le chemin du binaire ffmpeg : FFMPEG_PATH > ffmpeg-static > "ffmpeg" (PATH système). */
export async function resolveFfmpegPath() {
  if (resolvedFfmpegPath) return resolvedFfmpegPath;

  if (config.ffmpegPath) {
    resolvedFfmpegPath = config.ffmpegPath;
  } else {
    try {
      const mod = await import('ffmpeg-static');
      resolvedFfmpegPath = mod.default || mod;
    } catch {
      resolvedFfmpegPath = 'ffmpeg'; // suppose présent dans le PATH (Termux: pkg install ffmpeg)
    }
  }

  ffmpeg.setFfmpegPath(resolvedFfmpegPath);
  return resolvedFfmpegPath;
}

export function getTempDir() {
  const dir = path.join(os.tmpdir(), 'hsa-bot');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function tempFilePath(ext = '') {
  return path.join(getTempDir(), `${Date.now()}-${shortId()}${ext ? `.${ext}` : ''}`);
}

export function writeTempFile(buffer, ext = '') {
  const file = tempFilePath(ext);
  fs.writeFileSync(file, buffer);
  return file;
}

export function cleanupFile(file) {
  try {
    if (file && fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    log.warn(`Nettoyage du fichier temporaire échoué : ${file}`, err.message);
  }
}

const MEDIA_KEYS = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];

function hasMedia(content) {
  return !!content && MEDIA_KEYS.some((k) => content[k]);
}

/**
 * Localise le média présent dans le message lui-même OU dans le message cité (reply).
 * Retourne { source, waMessage, type } où waMessage est un objet compatible
 * avec downloadMediaMessage (forme { key, message }).
 */
export function getMediaMessage(msg) {
  const own = msg.message;
  const ctxInfo =
    own?.extendedTextMessage?.contextInfo ||
    own?.imageMessage?.contextInfo ||
    own?.videoMessage?.contextInfo ||
    own?.documentMessage?.contextInfo ||
    own?.stickerMessage?.contextInfo;
  const quoted = ctxInfo?.quotedMessage;

  let source = null;
  let waMessage = null;

  if (hasMedia(own)) {
    source = own;
    waMessage = msg;
  } else if (hasMedia(quoted)) {
    source = quoted;
    waMessage = {
      key: {
        remoteJid: msg.key.remoteJid,
        id: ctxInfo.stanzaId,
        participant: ctxInfo.participant,
        fromMe: false,
      },
      message: quoted,
    };
  } else {
    return null;
  }

  const type = MEDIA_KEYS.find((k) => source[k]);
  return { source, waMessage, type };
}

/** Télécharge le média (image/vidéo/audio/sticker/document) présent ou cité dans le message. */
export async function downloadQuotedOrDirectMedia(msg) {
  const found = getMediaMessage(msg);
  if (!found) return null;

  const buffer = await downloadMediaMessage(found.waMessage, 'buffer', {}, { logger: log });
  return {
    type: found.type.replace('Message', ''),
    buffer,
    mimetype: found.source[found.type]?.mimetype,
  };
}

export function ffmpegRun(builder) {
  return new Promise((resolve, reject) => {
    builder
      .on('end', resolve)
      .on('error', reject)
      .run();
  });
}
