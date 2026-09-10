// Hook appelé par messageHandler.js AVANT tout autre traitement.
// Détecte si le message est adressé à l'agent :
//  1) réponse à un message de l'agent (quote + marqueur)
//  2) message commençant par "agent" / "@agent"
// Retourne true si le message a été consommé.

import { logger } from '../utils/logger.js';
import { isAgentEnabled, runAgent } from '../services/agent.js';

const log = logger.child({ class: 'agentHandler' });

const AGENT_TAG = '🤖 AGENT-IA';
const AGENT_TRIGGER = /^(@?agent|hey\s+agent|agent\s*,|assistant)\b/i;

function extractQuotedText(msg) {
  const m = msg?.message;
  return (
    m?.extendedTextMessage?.contextInfo?.quotedMessage?.conversation ||
    m?.extendedTextMessage?.contextInfo?.quotedMessage?.extendedTextMessage?.text ||
    m?.imageMessage?.contextInfo?.quotedMessage?.conversation ||
    ''
  );
}

function extractText(msg) {
  const m = msg?.message;
  return (
    m?.conversation ||
    m?.extendedTextMessage?.text ||
    m?.imageMessage?.caption ||
    m?.videoMessage?.caption ||
    m?.documentMessage?.caption ||
    ''
  );
}

export async function tryHandleAgentFlow(sock, ctx) {
  if (!isAgentEnabled()) return false;

  const text = extractText(ctx.msg);
  const quoted = extractQuotedText(ctx.msg);

  const isReplyToAgent = quoted.includes(AGENT_TAG);
  const isDirectCall = AGENT_TRIGGER.test(text || '');

  if (!isReplyToAgent && !isDirectCall) return false;

  // Nettoie le texte (retire le trigger initial)
  let cleaned = (text || '').trim();
  cleaned = cleaned.replace(AGENT_TRIGGER, '').replace(/^[,:\s]+/, '').trim();

  // Si c'est juste une réponse à l'agent, on garde le texte tel quel
  const userMessage = isReplyToAgent ? (cleaned || text) : cleaned;
  if (!userMessage) return false;

  const agentCtx = { ...ctx, text: userMessage };

  try {
    const result = await runAgent(sock, agentCtx);
    if (!result.handled) return false;

    const header = `${AGENT_TAG}\n\n`;
    const suffix = `\n\n─ Répondez à ce message pour continuer ─`;

    await sock.sendMessage(
      ctx.chatId,
      { text: `${header}${result.reply}${suffix}` },
      { quoted: ctx.msg }
    );
    return true;
  } catch (err) {
    log.error('Erreur dans tryHandleAgentFlow', err.message, err.stack);
    return false;
  }
}