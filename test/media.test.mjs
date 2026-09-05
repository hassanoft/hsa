import path from 'node:path';
import fs from 'node:fs';

const TMP_DIR = path.resolve('test/.tmp-media');
fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

process.env.BOT_NAME ??= 'H$Λ BOT';
process.env.PREFIX ??= '/';
process.env.OWNER_NUMBER ??= '2250700000001';
process.env.WHATSAPP_NUMBER ??= '2250700000000';
process.env.DATA_DIR = path.join(TMP_DIR, 'data');
process.env.AUTH_DIR = path.join(TMP_DIR, 'auth');
process.env.RATE_LIMIT_MAX ??= '1000';

const { loadCommands } = await import('../src/handlers/commandHandler.js');
const { handleMessagesUpsert } = await import('../src/handlers/messageHandler.js');

let passed = 0;
let failed = 0;
function assert(cond, label) {
  if (cond) { passed += 1; console.log(`✅ ${label}`); }
  else { failed += 1; console.log(`❌ ${label}`); }
}

const BOT_JID = '2250700000000@s.whatsapp.net';
const OWNER_JID = '2250700000001@s.whatsapp.net';
const USER_JID = '2250712345678@s.whatsapp.net';

const sentMessages = [];
const fakeSock = {
  user: { id: BOT_JID, name: 'H$Λ BOT Test' },
  async sendMessage(jid, content) {
    const key = { id: `FAKEID-${Math.random().toString(36).slice(2)}`, remoteJid: jid };
    sentMessages.push({ jid, content, key });
    return { key };
  },
  async groupMetadata() { return { id: 'g', subject: 'g', participants: [] }; },
  async profilePictureUrl() { throw new Error('no-photo'); },
  async readMessages() {},
  async sendPresenceUpdate() {},
};

function buildImageMessage(text, extra = {}) {
  return {
    key: { remoteJid: USER_JID, fromMe: false, id: `MSG-${Math.random()}` },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Testeur',
    message: { imageMessage: { mimetype: 'image/jpeg', caption: text, ...extra } },
  };
}

function buildTextMessage(text) {
  return {
    key: { remoteJid: USER_JID, fromMe: false, id: `MSG-${Math.random()}` },
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

function hasErrorReply(out) {
  return out.some((m) => (m.content.text || '').includes('❌'));
}
function hasImageReply(out) {
  return out.some((m) => m.content.image);
}

async function main() {
  await loadCommands();

  // --- Commandes image (avec image jointe directement, pas en citation) ---
  const imageCommands = ['blur', 'resize 100 100', 'rotate 90', 'mirror', 'caption Haut|Bas', 'wanted', 'avatar', 'wallpaper', 'enhance', 'upscale'];
  for (const cmdLine of imageCommands) {
    const out = await send(buildImageMessage(`/${cmdLine}`));
    const ok = hasImageReply(out) || hasErrorReply(out);
    assert(ok, `/${cmdLine.split(' ')[0]} répond sans planter (image ou erreur propre)`);
  }

  // --- /sticker sur une image ---
  {
    const out = await send(buildImageMessage('/sticker'));
    const ok = out.some((m) => m.content.sticker) || hasErrorReply(out);
    assert(ok, '/sticker répond sans planter (sticker ou erreur propre)');
  }

  // --- /qr génère un QR ---
  {
    const out = await send(buildTextMessage('/qr https://example.com'));
    assert(out.some((m) => m.content.image), '/qr génère une image');
  }

  // --- /readqr sur une image (jsQR stub renvoie null = "non détecté", ne doit pas planter) ---
  {
    const out = await send(buildImageMessage('/readqr'));
    assert(out.some((m) => (m.content.text || '').includes('Aucun QR')), '/readqr gère proprement "aucun QR détecté"');
  }

  // --- /ocr (tesseract stub) ---
  {
    const out = await send(buildImageMessage('/ocr'));
    assert(out.some((m) => (m.content.text || '').includes('TEXTE_SIMULE')), '/ocr extrait le texte simulé sans planter');
  }

  // --- /vision sans clé IA configurée -> message clair, pas de crash ---
  {
    const out = await send(buildImageMessage('/vision'));
    assert(out.some((m) => (m.content.text || '').includes("n'est pas configuré")), '/vision sans clé API -> message clair');
  }

  // --- Commandes réseau externes indisponibles (pas d'accès réseau en sandbox) -> erreur propre, pas de crash ---
  const networkCommands = ['/ip 8.8.8.8', '/short https://example.com', '/currency 10 USD EUR'];
  for (const line of networkCommands) {
    const out = await send(buildTextMessage(line));
    assert(out.length > 0 && !out.some((m) => m.content.text?.includes('erreur est survenue lors de l')), `${line} échoue proprement sans crash serveur`);
  }

  console.log(`\n${passed} test(s) réussis, ${failed} échec(s).`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('ERREUR FATALE:', err);
  process.exit(1);
});
