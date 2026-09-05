import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import fs from 'node:fs';
import readline from 'node:readline';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { db } from '../database/database.js';
import { useDatabaseAuthState } from '../database/authStore.js';
import { handleMessagesUpsert, handleGroupParticipantsUpdate } from './messageHandler.js';

const log = logger.child({ class: 'connection' });

async function getAuthState() {
  if (config.authStorage === 'database') {
    log.info('Stockage de session WhatsApp : base de données (JSON).');
    return useDatabaseAuthState(db);
  }
  log.info(`Stockage de session WhatsApp : dossier "${config.authDir}".`);
  if (!fs.existsSync(config.authDir)) fs.mkdirSync(config.authDir, { recursive: true });
  return useMultiFileAuthState(config.authDir);
}

function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });
    process.stdout.write('📱 Numéro WhatsApp du bot (indicatif pays, SANS +) : ');
    rl.once('line', (line) => {
      try { rl.close(); } catch {}
      resolve(String(line || '').replace(/\D/g, ''));
    });
    setTimeout(() => {
      try { rl.close(); } catch {}
      resolve('');
    }, 120000);
  });
}

async function resolveBotNumber() {
  let number = config.whatsappNumber || process.env.WHATSAPP_NUMBER || '';
  number = String(number).replace(/\D/g, '');
  if (number.length >= 8) return number;

  // Fallback terminal (local / Termux)
  if (process.stdin.isTTY || process.env.FORCE_PROMPT === '1') {
    number = await askPhoneNumber();
  }
  return String(number || '').replace(/\D/g, '');
}

async function requestCodeWithRetry(sock, phone, max = 4) {
  for (let i = 1; i <= max; i++) {
    try {
      await new Promise((r) => setTimeout(r, 2000 + i * 800));
      const code = await Promise.race([
        sock.requestPairingCode(phone),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 25s')), 25000)),
      ]);
      if (code && String(code).length >= 6) return String(code);
      log.warn(`Tentative ${i}/${max} : code vide`);
    } catch (err) {
      log.warn(`Tentative ${i}/${max} : ${err.message}`);
    }
  }
  throw new Error('Impossible de générer le code après plusieurs essais');
}

let reconnectAttempts = 0;
let pairingStarted = false;
let currentSock = null;

export async function startConnection() {
  // Reset session forcé
  if (process.env.RESET_SESSION === 'true' || process.env.RESET_SESSION === '1') {
    log.warn('🔥 RESET_SESSION=true → suppression de auth/');
    if (fs.existsSync(config.authDir)) {
      fs.rmSync(config.authDir, { recursive: true, force: true });
    }
    delete process.env.RESET_SESSION;
    pairingStarted = false;
  }

  const { state, saveCreds } = await getAuthState();
  let version;
  try {
    const v = await fetchLatestBaileysVersion();
    version = v.version;
    log.info(`Version WA : ${version.join('.')} (latest: ${v.isLatest})`);
  } catch (e) {
    log.warn(`fetchLatestBaileysVersion échoué : ${e.message} — version par défaut`);
  }

  const sock = makeWASocket({
    version,
    auth: state,
    logger: logger.child({ class: 'baileys', level: 'silent' }),
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    generateHighQualityLinkPreview: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 60000,
    keepAliveIntervalMs: 30000,
  });
  currentSock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Pairing UNIQUEMENT quand le signal QR arrive (= socket prêt)
    // et seulement si pas encore enregistré
    if (qr && !sock.authState.creds.registered && !pairingStarted) {
      pairingStarted = true;
      try {
        const number = await resolveBotNumber();
        if (!number || number.length < 8) {
          log.error('❌ WHATSAPP_NUMBER manquant ou invalide dans .env');
          log.error('   Ajoute : WHATSAPP_NUMBER=2250700000000  (sans +)');
          log.error('   Puis : RESET_SESSION=true npm start');
          pairingStarted = false;
          return;
        }

        log.info(`📞 Numéro bot : +${number}`);
        log.info('⏳ Génération du code d\'appairage…');
        const code = await requestCodeWithRetry(sock, number);
        const pretty = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;

        log.info('════════════════════════════════════════');
        log.info(`   📱 CODE D'APPAIRAGE : ${pretty}`);
        log.info('   WhatsApp → Appareils liés → Lier un appareil');
        log.info('   → Lier avec un numéro de téléphone');
        log.info('   ⚠️  Expire dans ~60 secondes — entre-le vite !');
        log.info('════════════════════════════════════════');
      } catch (err) {
        log.error(`Échec pairing : ${err.message}`);
        log.error('Astuce : RESET_SESSION=true npm start');
        pairingStarted = false;
      }
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

      if (loggedOut) {
        log.error('❌ Session logout. Supprime auth/ ou utilise RESET_SESSION=true puis redémarre.');
        pairingStarted = false;
        return;
      }

      // 515 = restart required (souvent après un pairing réussi)
      if (statusCode === 515) {
        log.info('🔄 Code 515 — redémarrage après pairing…');
        pairingStarted = false;
        setTimeout(() => {
          startConnection().catch((e) => log.error('reconnexion 515', e.message));
        }, 2000);
        return;
      }

      reconnectAttempts += 1;
      const delay = Math.min(30_000, 2000 * reconnectAttempts);
      log.warn(`Connexion fermée (${statusCode || '?'}). Reconnexion dans ${delay / 1000}s…`);
      pairingStarted = false;
      setTimeout(() => {
        startConnection().catch((err) => log.error('Échec reconnexion', err.message));
      }, delay);
    } else if (connection === 'open') {
      reconnectAttempts = 0;
      pairingStarted = false;
      log.info(`✅ ${config.botName} est connecté à WhatsApp.`);
    } else if (connection === 'connecting') {
      log.info('⏳ Connexion à WhatsApp en cours…');
    }
  });

  sock.ev.on('messages.upsert', (payload) => {
    handleMessagesUpsert(sock, payload).catch((err) => log.error('messages.upsert', err.message));
  });

  sock.ev.on('group-participants.update', (evt) => {
    handleGroupParticipantsUpdate(sock, evt).catch((err) =>
      log.error('group-participants.update', err.message)
    );
  });

  return sock;
}

export function getSock() {
  return currentSock;
}
