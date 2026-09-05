import express from 'express';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import { loadCommands, getAllCommands } from './handlers/commandHandler.js';
import { startConnection } from './handlers/connectionHandler.js';
import { db } from './database/database.js';
import { START_TIME } from './utils/uptime.js';

const log = logger.child({ class: 'bootstrap' });

async function startHttpServer() {
  const app = express();

  app.get('/', (_req, res) => {
    res.type('text/plain').send(`${config.botName} is running.`);
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      bot: config.botName,
      uptimeSeconds: Math.floor((Date.now() - START_TIME) / 1000),
      commandsExecuted: db.getStat('commandsExecuted'),
      timestamp: new Date().toISOString(),
    });
  });

  app.listen(config.port, () => {
    log.info(`🌐 Serveur HTTP démarré sur le port ${config.port}`);
  });
}

async function main() {
  log.info(`Démarrage de ${config.botName}...`);

  // 1. Charger les commandes
  await loadCommands();
  log.info(`📦 ${getAllCommands().length} commandes disponibles.`);

  // 2. Démarrer le serveur HTTP (pour que Render voie que le service est "live")
  await startHttpServer();

  // 3. Démarrer la connexion WhatsApp
  try {
    await startConnection();
  } catch (err) {
    // Si la connexion plante au démarrage (ex: mauvais numéro), on log l'erreur 
    // sans tuer le serveur HTTP, pour que Render ne redémarre pas en boucle.
    log.error("Erreur critique au démarrage de la connexion WhatsApp:", err?.message || err);
  }
}

process.on('unhandledRejection', (err) => {
  log.error('Rejet de promesse non géré', err?.message || err);
});

process.on('uncaughtException', (err) => {
  log.error('Exception non interceptée', err?.message || err);
});

main().catch((err) => {
  log.fatal("Échec du démarrage de H$Λ BOT", err?.message || err);
  process.exit(1);
});