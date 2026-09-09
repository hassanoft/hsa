import 'dotenv/config';
import path from 'node:path';

// ── Helpers ────────────────────────────────────────────────
function bool(value, def = false) {
  if (value === undefined || value === null || value === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, def) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : def;
}

// Récupère une ou plusieurs clés depuis une variable d'env.
// Gère les formats : "cle1,cle2,cle3" et "CLE_1,cle2" + "CLE_2,cle3" etc.
function getKeys(baseVar, env = process.env) {
  const keys = [];
  const main = env[baseVar] || '';
  if (main.trim()) {
    keys.push(...main.split(',').map(k => k.trim()).filter(Boolean));
  }
  // Vérifier les suffixes _2, _3, ...
  let i = 2;
  while (env[`${baseVar}_${i}`]) {
    const val = env[`${baseVar}_${i}`];
    if (val.trim()) {
      keys.push(...val.split(',').map(k => k.trim()).filter(Boolean));
    }
    i++;
  }
  return keys;
}

// ── Définition des fournisseurs (ordre préféré) ────────────
const providerDefinitions = [
  {
    name: 'openrouter',
    envKey: 'OPENROUTER_API_KEY',
    model: process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini',
    url: 'https://openrouter.ai/api/v1/chat/completions',
  },
  {
    name: 'groq',
    envKey: 'GROQ_API_KEY',
    model: process.env.GROQ_MODEL || 'llama3-8b-8192',
    url: 'https://api.groq.com/openai/v1/chat/completions',
  },
  {
    name: 'cerebras',
    envKey: 'CEREBRAS_API_KEY',
    model: process.env.CEREBRAS_MODEL || 'llama3.1-8b',
    url: 'https://api.cerebras.ai/v1/chat/completions',
  },
  {
    name: 'gemini',
    envKey: 'GEMINI_API_KEY',
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash', // ⚠️ utilisez un modèle valide
    url: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}',
  },
  {
    name: 'openai',
    envKey: 'OPENAI_API_KEY',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    url: 'https://api.openai.com/v1/chat/completions',
  },
  // Ajoutez d'autres providers si besoin (DeepSeek, etc.)
];

// Construit le tableau des providers disponibles (avec au moins une clé)
const aiProviders = providerDefinitions
  .map(def => {
    const apiKeys = getKeys(def.envKey);
    if (apiKeys.length === 0) return null;
    return {
      name: def.name,
      apiKeys,
      model: def.model,
      url: def.url,
    };
  })
  .filter(Boolean);

// ── Autres variables ───────────────────────────────────────
const DATA_DIR = process.env.DATA_DIR || './data';
const AUTH_DIR = process.env.AUTH_DIR || './auth';

export const config = {
  botName: process.env.BOT_NAME || 'H$Λ BOT',
  prefix: process.env.PREFIX || '/',
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  ownerLid: (process.env.OWNER_LID || '').replace(/\D/g, ''),
  whatsappNumber: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),

  port: int(process.env.PORT, 3000),

  dataDir: path.resolve(DATA_DIR),
  authDir: path.resolve(AUTH_DIR),
  authStorage: (process.env.AUTH_STORAGE || 'file').toLowerCase(), // 'file' | 'database'

  // ── Ancienne structure `ai` conservée pour compatibilité
  // Elle pointe vers le premier provider disponible (utile si votre code existant l'utilise)
  ai: aiProviders.length > 0
    ? {
        apiKey: aiProviders[0].apiKeys[0],
        apiUrl: aiProviders[0].url,
        model: aiProviders[0].model,
        imageApiUrl: process.env.AI_IMAGE_API_URL || 'https://api.openai.com/v1/images/generations',
        imageModel: process.env.AI_IMAGE_MODEL || 'dall-e-3',
        ttsApiUrl: process.env.TTS_API_URL || '',
        ttsApiKey: process.env.TTS_API_KEY || '',
      }
    : {
        apiKey: '',
        apiUrl: '',
        model: '',
        imageApiUrl: process.env.AI_IMAGE_API_URL || 'https://api.openai.com/v1/images/generations',
        imageModel: process.env.AI_IMAGE_MODEL || 'dall-e-3',
        ttsApiUrl: process.env.TTS_API_URL || '',
        ttsApiKey: process.env.TTS_API_KEY || '',
      },

  // ── Nouvelle structure : liste des providers utilisables
  aiProviders,

  image: {
    removeBgKey: process.env.REMOVEBG_API_KEY || '',
    removeBgUrl: process.env.REMOVEBG_API_URL || 'https://api.remove.bg/v1.0/removebg',
    upscaleUrl: process.env.IMAGE_UPSCALE_API_URL || '',
    upscaleKey: process.env.IMAGE_UPSCALE_API_KEY || '',
  },

  download: {
    apiUrl: process.env.DOWNLOAD_API_URL || '',
    apiKey: process.env.DOWNLOAD_API_KEY || '',
  },

  weather: {
    apiKey: process.env.WEATHER_API_KEY || '',
    apiUrl: process.env.WEATHER_API_URL || 'https://api.openweathermap.org/data/2.5/weather',
  },

  currency: {
    apiUrl: process.env.CURRENCY_API_URL || 'https://api.exchangerate.host/latest',
  },

  nsfw: {
    apiUrl: process.env.NSFW_API_URL || '',
    apiKey: process.env.NSFW_API_KEY || '',
  },

  ffmpegPath: process.env.FFMPEG_PATH || '',

  rateLimit: {
    max: int(process.env.RATE_LIMIT_MAX, 8),
    windowMs: int(process.env.RATE_LIMIT_WINDOW_MS, 10000),
  },
};

export function isOwner(jid = '') {
  const digits = String(jid).replace(/\D/g, '');
  if (!digits) return false;
  if (config.ownerNumber && digits.startsWith(config.ownerNumber)) return true;
  if (config.ownerLid && digits.startsWith(config.ownerLid)) return true;
  return false;
}