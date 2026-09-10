// Implémentation d'un "auth state" Baileys stocké dans notre base JSON,
// au lieu du dossier multi-fichiers par défaut. Utile si l'on veut garder
// TOUTES les données persistantes (credentials WhatsApp compris) derrière
// une seule couche de stockage (utile en vue d'une migration future vers
// PostgreSQL : il suffira d'adapter database.js, ce fichier n'a pas à
// changer). Activé via AUTH_STORAGE=database dans .env.
//
// Le format suit exactement le contrat attendu par Baileys pour un
// AuthenticationState (creds + SignalKeyStore), calqué sur l'implémentation
// officielle useMultiFileAuthState, mais avec le disque remplacé par db.js.

import * as baileys from '@whiskeysockets/baileys';
import { logger } from '../utils/logger.js';

const log = logger.child({ class: 'authStore' });
const { BufferJSON, initAuthCreds, proto } = baileys; // Vous récupérez vos variables ici

export async function useDatabaseAuthState(db) {
  const writeData = (key, data) => {
    try {
      db.setAuth(key, JSON.stringify(data, BufferJSON.replacer));
    } catch (err) {
      log.error(`Impossible d'écrire la clé d'auth "${key}"`, err.message);
    }
  };

  const readData = (key) => {
    try {
      const raw = db.getAuth(key);
      if (!raw) return null;
      return JSON.parse(raw, BufferJSON.reviver);
    } catch {
      return null;
    }
  };

  const removeData = (key) => {
    try {
      db.deleteAuth(key);
    } catch (err) {
      log.error(`Impossible de supprimer la clé d'auth "${key}"`, err.message);
    }
  };

  const creds = readData('creds') || initAuthCreds();

  return {
    state: {
      creds,

      keys: {
        get: async (type, ids) => {
          const result = {};

          for (const id of ids) {
            let value = readData(`${type}-${id}`);

            if (type === 'app-state-sync-key' && value) {
              value = proto.Message.AppStateSyncKeyData.fromObject(value);
            }

            result[id] = value;
          }

          return result;
        },

        set: async (data) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category])) {
              const value = data[category][id];
              const key = `${category}-${id}`;

              if (value) {
                writeData(key, value);
              } else {
                removeData(key);
              }
            }
          }
        },
      },
    },

    saveCreds: async () => {
      writeData('creds', creds);
    },
  };
}