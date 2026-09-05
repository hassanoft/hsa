// Script de test hors-ligne : simule un socket Baileys et fait transiter de
// faux messages à travers le vrai pipeline (messageHandler -> commandHandler
// -> commandes) pour vérifier le comportement réel du bot.

// Script de test hors-ligne : simule un socket Baileys et fait transiter de
// faux messages à travers le vrai pipeline (messageHandler -> commandHandler
// -> commandes) pour vérifier le comportement réel du bot.
//
// Autonome : configure son propre environnement (aucun .env externe requis),
// avec un dossier de données temporaire dédié pour ne pas polluer /data.

import path from 'node:path';
import fs from 'node:fs';

const TMP_DIR = path.resolve('test/.tmp-functional');
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

process.env.BOT_NAME ??= 'H$Λ BOT';
process.env.PREFIX ??= '/';
process.env.OWNER_NUMBER ??= '2250700000001';
process.env.WHATSAPP_NUMBER ??= '2250700000000';
process.env.DATA_DIR = path.join(TMP_DIR, 'data');
process.env.AUTH_DIR = path.join(TMP_DIR, 'auth');
process.env.AUTH_STORAGE ??= 'file';
process.env.RATE_LIMIT_MAX ??= '1000'; // le test envoie volontairement beaucoup de commandes très vite
process.env.RATE_LIMIT_WINDOW_MS ??= '10000';

const { loadCommands, getAllCommands } = await import('../src/handlers/commandHandler.js');
const { handleMessagesUpsert } = await import('../src/handlers/messageHandler.js');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    passed += 1;
    console.log(`✅ ${label}`);
  } else {
    failed += 1;
    console.log(`❌ ${label}`);
  }
}

// --- Faux socket WhatsApp ---
const sentMessages = [];
const BOT_JID = '2250700000000@s.whatsapp.net';
const OWNER_JID = '2250700000001@s.whatsapp.net';
const USER_JID = '2250712345678@s.whatsapp.net';
const GROUP_JID = '123456789-987654321@g.us';

const fakeSock = {
  user: { id: BOT_JID, name: 'H$Λ BOT Test' },
  async sendMessage(jid, content, opts = {}) {
    const key = { id: `FAKEID-${Math.random().toString(36).slice(2)}`, remoteJid: jid };
    sentMessages.push({ jid, content, opts, key });
    return { key };
  },
  async groupMetadata(jid) {
    return {
      id: jid,
      subject: 'Groupe de test',
      desc: 'Description de test',
      creation: Math.floor(Date.now() / 1000),
      participants: [
        { id: BOT_JID, admin: 'admin' },
        { id: OWNER_JID, admin: null },
        { id: USER_JID, admin: null },
      ],
    };
  },
  async profilePictureUrl() {
    throw new Error('no-photo-in-test');
  },
  async readMessages() {},
  async sendPresenceUpdate() {},
  async groupParticipantsUpdate() { return {}; },
  async updateBlockStatus() { return {}; },
  async groupInviteCode() { return 'FAKEINVITECODE'; },
};

function buildTextMessage({ from, chatId, text, fromMe = false, participant }) {
  return {
    key: {
      remoteJid: chatId,
      fromMe,
      id: `MSG-${Math.random().toString(36).slice(2)}`,
      participant: chatId.endsWith('@g.us') ? participant || from : undefined,
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Testeur',
    message: { conversation: text },
  };
}

async function send(msg) {
  sentMessages.length = 0;
  await handleMessagesUpsert(fakeSock, { messages: [msg], type: 'notify' });
  return [...sentMessages];
}

async function main() {
  await loadCommands();
  assert(getAllCommands().length === 145, `145 commandes chargées (obtenu: ${getAllCommands().length})`);

  // --- /ping en privé ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/ping' }));
    const hasPong = out.some((m) => m.content.text?.includes('Pong'));
    assert(hasPong, "/ping répond avec 'Pong'");
  }

  // --- message sans préfixe : aucune réponse ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: 'Bonjour' }));
    assert(out.length === 0, 'Message sans préfixe = aucune réponse');
  }

  // --- commande inconnue ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/xyzabc' }));
    assert(out.some((m) => m.content.text?.includes('Commande inconnue')), 'Commande inconnue -> message clair');
  }

  // --- /calc ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/calc 2+2*5' }));
    assert(out.some((m) => m.content.text?.includes('= 12')), `/calc 2+2*5 = 12 (reçu: ${JSON.stringify(out.map(m=>m.content.text))})`);
  }

  // --- /calc division par zéro ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/calc 5/0' }));
    assert(out.some((m) => m.content.text?.includes('❌')), '/calc 5/0 -> erreur propre (pas de crash)');
  }

  // --- commande OWNER par un utilisateur normal : refusée ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/maintenance on' }));
    assert(out.some((m) => m.content.text?.includes('réservée au propriétaire')), 'Commande OWNER refusée à un utilisateur normal');
  }

  // --- commande OWNER par le OWNER : acceptée ---
  {
    const out = await send(buildTextMessage({ from: OWNER_JID, chatId: OWNER_JID, text: '/maintenance' }));
    assert(out.some((m) => m.content.text?.includes('Mode maintenance')), 'Commande OWNER acceptée pour OWNER_NUMBER');
  }

  // --- /help : menu complet ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/help' }));
    const text = out[0]?.content.text || out[0]?.content.caption || '';
    assert(text.includes('🏠 GENERAL') && text.includes('👑 OWNER') && text.endsWith('H$Λ BOT'), '/help affiche le menu complet structuré');
    assert(text.includes('/ping'), "/help liste bien '/ping' avec le préfixe actuel");
  }

  // --- /help <catégorie> ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/help fun' }));
    const text = out[0]?.content.text || out[0]?.content.caption || '';
    assert(text.includes('🎮 FUN') && !text.includes('🏠 GENERAL'), '/help fun affiche uniquement la catégorie FUN');
  }

  // --- commande de groupe hors groupe : refusée ---
  {
    const out = await send(buildTextMessage({ from: OWNER_JID, chatId: OWNER_JID, text: '/kick' }));
    assert(out.some((m) => m.content.text?.includes('uniquement dans un groupe')), 'Commande de groupe refusée en privé');
  }

  // --- commande de groupe, admin requis, utilisateur normal ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: GROUP_JID, participant: USER_JID, text: '/kick' }));
    assert(out.some((m) => m.content.text?.includes('réservée aux administrateurs')), 'Commande admin de groupe refusée à un membre normal');
  }

  // --- /tagall dans un groupe par le owner ---
  {
    const out = await send(buildTextMessage({ from: OWNER_JID, chatId: GROUP_JID, participant: OWNER_JID, text: '/tagall Réunion ce soir' }));
    const msg = out.find((m) => m.content.mentions);
    assert(!!msg && msg.content.mentions.length === 3, `/tagall mentionne tous les membres (obtenu: ${msg?.content.mentions?.length})`);
  }

  // --- /uuid ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/uuid' }));
    const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
    assert(out.some((m) => uuidRegex.test(m.content.text || '')), '/uuid génère un UUID valide');
  }

  // --- /base64 ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/base64 encode HelloH$Λ' }));
    assert(out.some((m) => m.content.text?.includes(Buffer.from('HelloH$Λ').toString('base64'))), '/base64 encode fonctionne');
  }

  // --- /8ball ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/8ball Est-ce que ça marche ?' }));
    assert(out.some((m) => m.content.text?.startsWith('🎱')), '/8ball répond');
  }

  // --- /contact mode 1 (texte direct) ---
  {
    const out = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/contact Bonjour, j\'ai un souci.' }));
    const confirmToUser = out.find((m) => m.jid === USER_JID);
    const forwardToOwner = out.find((m) => m.jid === OWNER_JID);
    assert(!!confirmToUser && confirmToUser.content.text.includes('transmis'), '/contact confirme la transmission à l\'utilisateur');
    assert(!!forwardToOwner && forwardToOwner.content.text.includes('H$Λ BOT CONTACT'), '/contact transmet le message formaté à OWNER');
  }

  // --- /contact mode 2 (attente) puis réponse de OWNER ---
  {
    const out1 = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: '/contact' }));
    assert(out1.some((m) => m.content.text?.includes('Envoyez maintenant')), '/contact sans texte déclenche le mode attente');

    const out2 = await send(buildTextMessage({ from: USER_JID, chatId: USER_JID, text: 'Voici mon message différé' }));
    const forwarded = out2.find((m) => m.jid === OWNER_JID);
    assert(!!forwarded && forwarded.content.text.includes('Voici mon message différé'), 'Le message différé est transmis à OWNER');

    // Simule OWNER répondant (fonction "Répondre") au message reçu du bot,
    // depuis SON PROPRE numéro (différent du numéro connecté par le bot) :
    // un message entrant classique (fromMe=false) dans la conversation privée.
    const contactMsgId = forwarded.key.id;
    const replyMsg = {
      key: { remoteJid: OWNER_JID, fromMe: false, id: `MSG-${Math.random()}` },
      messageTimestamp: Math.floor(Date.now() / 1000),
      pushName: 'Owner',
      message: {
        extendedTextMessage: {
          text: 'Bonjour, je regarde ça tout de suite.',
          contextInfo: { stanzaId: contactMsgId },
        },
      },
    };
    const out3 = await send(replyMsg);
    const toUser = out3.find((m) => m.jid === USER_JID);
    assert(!!toUser && toUser.content.text.includes('Réponse de l\'administrateur'), 'La réponse de OWNER est bien retransmise à l\'utilisateur');
  }

  console.log(`\n${passed} test(s) réussis, ${failed} échec(s).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR FATALE DANS LE TEST:', err);
  process.exit(1);
});
