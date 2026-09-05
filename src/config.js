import 'dotenv/config';
import path from 'node:path';

function bool(value, def = false) {
  if (value === undefined || value === null || value === '') return def;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, def) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : def;
}

const DATA_DIR = process.env.DATA_DIR || './data';
const AUTH_DIR = process.env.AUTH_DIR || './auth';

export const config = {
  botName: process.env.BOT_NAME || 'H$Λ BOT',
  prefix: process.env.PREFIX || '/',
  ownerNumber: (process.env.OWNER_NUMBER || '').replace(/\D/g, ''),
  whatsappNumber: (process.env.WHATSAPP_NUMBER || '').replace(/\D/g, ''),

  port: int(process.env.PORT, 3000),

  dataDir: path.resolve(DATA_DIR),
  authDir: path.resolve(AUTH_DIR),
  authStorage: (process.env.AUTH_STORAGE || 'file').toLowerCase(), // 'file' | 'database'

  ai: {
    apiKey: process.env.AI_API_KEY || '',
    apiUrl: process.env.AI_API_URL || 'https://api.openai.com/v1/chat/completions',
    model: process.env.AI_MODEL || 'gpt-4o-mini',
    imageApiUrl: process.env.AI_IMAGE_API_URL || 'https://api.openai.com/v1/images/generations',
    imageModel: process.env.AI_IMAGE_MODEL || 'dall-e-3',
    ttsApiUrl: process.env.TTS_API_URL || '',
    ttsApiKey: process.env.TTS_API_KEY || '',
  },

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
  return !!config.ownerNumber && digits.startsWith(config.ownerNumber);
}
