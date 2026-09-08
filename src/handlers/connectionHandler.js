import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';

import fs from 'node:fs';
import path from 'node:path';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import {
  handleMessagesUpsert,
  handleGroupParticipantsUpdate,
} from './messageHandler.js';

const log = logger.child({ class: 'connection' });

let currentSock = null;
let reconnectTimer = null;
let reconnectAttempts = 0;
let pairingStarted = false;
let starting = false;

/**
 * Retourne le dossier d'authentification absolu.
 */
function getAuthDir() {
  const dir = path.resolve(config.authDir);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return dir;
}

/**
 * Charge TOUJOURS la même session.
 *
 * IMPORTANT :
 * La session WhatsApp est conservée dans ./auth.
 * Elle ne doit jamais être supprimée lors d'un redémarrage normal.
 */
async function getAuthState() {
  const authDir = getAuthDir();

  log.info(`🔐 Session WhatsApp : ${authDir}`);

  return useMultiFileAuthState(authDir);
}

/**
 * Demande le numéro dans le terminal.
 */
function askPhoneNumber() {
  return new Promise((resolve) => {
    const rl = requireReadline();

    process.stdout.write(
      '📱 Numéro WhatsApp du bot (indicatif pays, SANS +) : '
    );

    let finished = false;

    const finish = (value) => {
      if (finished) return;
      finished = true;

      try {
        rl.close();
      } catch {}

      resolve(String(value || '').replace(/\D/g, ''));
    };

    rl.once('line', finish);

    setTimeout(() => finish(''), 120000);
  });
}

/**
 * Import dynamique de readline pour éviter les problèmes
 * avec certains environnements Termux.
 */
function requireReadline() {
  // eslint-disable-next-line global-require
  return require('node:readline').createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });
}

/**
 * Récupère le numéro utilisé pour le pairing.
 */
async function resolveBotNumber() {
  let number =
    config.whatsappNumber ||
    process.env.WHATSAPP_NUMBER ||
    '';

  number = String(number).replace(/\D/g, '');

  if (number.length >= 8) {
    return number;
  }

  if (process.stdin.isTTY || process.env.FORCE_PROMPT === '1') {
    number = await askPhoneNumber();
  }

  return String(number || '').replace(/\D/g, '');
}

/**
 * Génère le code de pairing.
 *
 * On évite de générer plusieurs codes en même temps.
 */
async function requestPairingCode(sock, phone) {
  if (pairingStarted) {
    return null;
  }

  pairingStarted = true;

  try {
    log.info(`📞 Numéro du bot : +${phone}`);
    log.info('⏳ Génération du code d’appairage...');

    /*
     * Baileys peut gérer l'attente du socket.
     * Un petit délai évite néanmoins de lancer la demande
     * exactement au même instant que l'ouverture du websocket.
     */
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const code = await Promise.race([
      sock.requestPairingCode(phone),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error('Timeout génération du code (30s)')),
          30000
        )
      ),
    ]);

    if (!code) {
      throw new Error('WhatsApp a retourné un code vide');
    }

    const value = String(code).replace(/\s+/g, '');

    const pretty =
      value.length === 8
        ? `${value.slice(0, 4)}-${value.slice(4)}`
        : value;

    log.info('════════════════════════════════════════');
    log.info(`📱 CODE D'APPAIRAGE : ${pretty}`);
    log.info('👉 WhatsApp → Appareils liés');
    log.info('👉 Lier un appareil');
    log.info('👉 Lier avec un numéro de téléphone');
    log.info('⚠️ Entre le code rapidement.');
    log.info('════════════════════════════════════════');

    return value;
  } catch (err) {
    pairingStarted = false;

    log.error(`❌ Échec pairing : ${err?.message || err}`);

    throw err;
  }
}

/**
 * Nettoyage d'une ancienne connexion.
 */
function closeCurrentSocket() {
  if (!currentSock) return;

  try {
    currentSock.ev?.removeAllListeners?.();
  } catch {}

  try {
    currentSock.ws?.close?.();
  } catch {}

  try {
    currentSock.end?.();
  } catch {}

  currentSock = null;
}

/**
 * Programme une reconnexion unique.
 */
function scheduleReconnect() {
  if (reconnectTimer) {
    return;
  }

  reconnectAttempts += 1;

  const delay = Math.min(
    30000,
    2000 * reconnectAttempts
  );

  log.warn(
    `🔄 Reconnexion dans ${Math.round(delay / 1000)}s...`
  );

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;

    startConnection().catch((err) => {
      log.error(
        `❌ Échec reconnexion : ${err?.message || err}`
      );
    });
  }, delay);
}

/**
 * Connexion principale.
 */
export async function startConnection() {
  /*
   * Empêche plusieurs appels simultanés à startConnection().
   */
  if (starting) {
    log.warn('⚠️ Une connexion WhatsApp est déjà en cours.');
    return currentSock;
  }

  starting = true;

  try {
    /*
     * IMPORTANT :
     * RESET_SESSION doit être volontaire.
     *
     * Il n'est PAS utilisé normalement.
     */
    const reset =
      process.env.RESET_SESSION === 'true' ||
      process.env.RESET_SESSION === '1';

    if (reset) {
      const authDir = getAuthDir();

      log.warn(
        '🔥 RESET_SESSION activé : suppression volontaire de la session WhatsApp.'
      );

      try {
        fs.rmSync(authDir, {
          recursive: true,
          force: true,
        });
      } catch (err) {
        log.error(
          `Erreur suppression session : ${err?.message || err}`
        );
      }

      /*
       * Très important :
       * on empêche un deuxième démarrage de supprimer
       * encore la session.
       */
      delete process.env.RESET_SESSION;
    }

    /*
     * Si une ancienne connexion existe, on la ferme.
     */
    if (currentSock) {
      closeCurrentSocket();
    }

    const {
      state,
      saveCreds,
    } = await getAuthState();

    /*
     * Vérification importante :
     * si registered = true, il NE FAUT PAS demander
     * un nouveau pairing.
     */
    const alreadyRegistered =
      !!state?.creds?.registered;

    log.info(
      alreadyRegistered
        ? '🔐 Session WhatsApp existante détectée.'
        : '🆕 Aucune session WhatsApp enregistrée.'
    );

    /*
     * Version WhatsApp.
     */
    let version;

    try {
      const latest = await fetchLatestBaileysVersion();

      version = latest.version;

      log.info(
        `📦 WhatsApp Web : ${version.join('.')} (latest: ${latest.isLatest})`
      );
    } catch (err) {
      log.warn(
        `⚠️ Impossible de récupérer la version WhatsApp : ${err?.message || err}`
      );
    }

    /*
     * Création du socket.
     */
    const sock = makeWASocket({
      version,
      auth: state,

      logger: logger.child({
        class: 'baileys',
        level: 'silent',
      }),

      browser: Browsers.ubuntu('Chrome'),

      printQRInTerminal: false,

      generateHighQualityLinkPreview: false,

      syncFullHistory: false,

      markOnlineOnConnect: false,

      connectTimeoutMs: 60000,

      defaultQueryTimeoutMs: 60000,

      keepAliveIntervalMs: 30000,
    });

    currentSock = sock;

    /*
     * SAUVEGARDE DES CREDENTIALS.
     *
     * C'est essentiel.
     */
    sock.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        log.debug?.('💾 Credentials WhatsApp sauvegardés.');
      } catch (err) {
        log.error(
          `❌ Impossible de sauvegarder les credentials : ${err?.message || err}`
        );
      }
    });

    /*
     * Événements de connexion.
     */
    sock.ev.on(
      'connection.update',
      async (update) => {
        const {
          connection,
          lastDisconnect,
        } = update;

        /*
         * IMPORTANT :
         * Le pairing est demandé lorsque le socket
         * commence à se connecter, PAS lorsqu'un QR
         * apparaît.
         */
        if (
          connection === 'connecting' &&
          !sock.authState.creds.registered &&
          !pairingStarted
        ) {
          try {
            const number = await resolveBotNumber();

            if (!number || number.length < 8) {
              log.error(
                '❌ WHATSAPP_NUMBER manquant ou invalide.'
              );

              log.error(
                'Exemple : WHATSAPP_NUMBER=2250700000000'
              );

              pairingStarted = false;

              return;
            }

            await requestPairingCode(
              sock,
              number
            );
          } catch (err) {
            log.error(
              `❌ Pairing impossible : ${err?.message || err}`
            );

            pairingStarted = false;
          }
        }

        /*
         * Connexion réussie.
         */
        if (connection === 'open') {
          reconnectAttempts = 0;
          pairingStarted = false;

          log.info(
            `✅ ${config.botName} est connecté à WhatsApp.`
          );

          log.info(
            '🔐 Session sauvegardée : les prochains redémarrages ne devraient pas demander de nouveau code.'
          );
        }

        /*
         * Connexion fermée.
         */
        if (connection === 'close') {
          const statusCode =
            lastDisconnect?.error?.output?.statusCode;

          const loggedOut =
            statusCode === DisconnectReason.loggedOut ||
            statusCode === 401;

          pairingStarted = false;

          /*
           * L'utilisateur a réellement déconnecté
           * l'appareil WhatsApp.
           */
          if (loggedOut) {
            log.error(
              '❌ WhatsApp a invalidé/déconnecté la session.'
            );

            log.error(
              '👉 Pour refaire un pairing : supprime auth/ volontairement puis redémarre.'
            );

            currentSock = null;

            return;
          }

          /*
           * 515 = WhatsApp demande un redémarrage
           * de la connexion.
           *
           * On conserve auth/.
           */
          if (statusCode === 515) {
            log.warn(
              '🔄 WhatsApp demande un redémarrage de la connexion (515).'
            );

            currentSock = null;

            scheduleReconnect();

            return;
          }

          currentSock = null;

          log.warn(
            `⚠️ Connexion fermée (${statusCode || 'inconnu'}).`
          );

          scheduleReconnect();
        }

        if (connection === 'connecting') {
          log.info(
            '⏳ Connexion à WhatsApp en cours...'
          );
        }
      }
    );

    /*
     * Messages.
     */
    sock.ev.on('messages.upsert', (payload) => {
      handleMessagesUpsert(
        sock,
        payload
      ).catch((err) => {
        log.error(
          `messages.upsert : ${err?.message || err}`
        );
      });
    });

    /*
     * Groupes.
     */
    sock.ev.on(
      'group-participants.update',
      (evt) => {
        handleGroupParticipantsUpdate(
          sock,
          evt
        ).catch((err) => {
          log.error(
            `group-participants.update : ${err?.message || err}`
          );
        });
      }
    );

    return sock;
  } finally {
    starting = false;
  }
}

/**
 * Retourne le socket actuellement actif.
 */
export function getSock() {
  return currentSock;
}