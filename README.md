# H$Λ BOT

Bot WhatsApp multifonction, **100 % gratuit**, construit avec [Baileys](https://github.com/WhiskeySockets/Baileys), Node.js (ES Modules) et Express. Architecture modulaire, prêt pour Termux, Linux et Render.

Aucune fonctionnalité payante : pas de premium, pas de crédits, pas d'abonnement.

---

## Sommaire

1. [Présentation](#1-présentation)
2. [Fonctionnalités](#2-fonctionnalités)
3. [Installation sur Termux](#3-installation-sur-termux)
4. [Installation sur Linux](#4-installation-sur-linux)
5. [Configuration (.env)](#5-configuration-env)
6. [Connexion WhatsApp (pairing code)](#6-connexion-whatsapp-pairing-code)
7. [Propriétaire (OWNER)](#7-propriétaire-owner)
8. [APIs externes](#8-apis-externes)
9. [Base de données](#9-base-de-données)
10. [Déploiement sur Render](#10-déploiement-sur-render)
11. [Persistance de la session](#11-persistance-de-la-session)
12. [Liste des commandes](#12-liste-des-commandes)
13. [Configuration des groupes](#13-configuration-des-groupes)
14. [Système /contact](#14-système-contact)
15. [Dépannage](#15-dépannage)
16. [Sécurité](#16-sécurité)

---

## 1. Présentation

**H$Λ BOT** est un bot WhatsApp multifonction : intelligence artificielle, traitement d'image et de vidéo, téléchargement, utilitaires, gestion de groupes, modération automatique et un véritable système de messagerie `/contact` entre les utilisateurs et le propriétaire du bot.

Le projet est volontairement **honnête techniquement** : toute fonctionnalité nécessitant une API externe (IA, météo, suppression de fond, etc.) affiche un message clair si la clé correspondante n'est pas configurée, plutôt que de simuler un résultat.

## 2. Fonctionnalités

- 🤖 IA (chat, traduction, résumé, vision, OCR local, TTS...)
- 🖼️ Traitement d'image 100 % local (Jimp) : resize, crop, rotate, blur, mèmes, stickers...
- 🎬 Traitement vidéo/audio via ffmpeg : conversion, découpe, compression, extraction audio...
- 📥 Téléchargement (YouTube, TikTok, Instagram, Facebook, Twitter, MediaFire, Google Drive)
- 🛠️ Utilitaires (calculatrice sécurisée, QR code, météo, devises, mots de passe...)
- 👥 Gestion de groupe complète (kick, promote, tagall, warnings...)
- 🛡️ Modération automatique (antilink, antispam, antibadword, antiflood, welcome/goodbye...)
- 🎮 Commandes fun (quiz, devinettes, 8ball, action ou vérité...)
- 👑 Panneau OWNER (broadcast, maintenance, eval, backup, logs...)
- 📩 Système `/contact` bidirectionnel et persistant entre utilisateurs et OWNER

## 3. Installation sur Termux

```bash
pkg update && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg

git clone <url-de-votre-dépôt> hsa-bot
cd hsa-bot
npm install

cp .env.example .env
nano .env   # renseignez au minimum OWNER_NUMBER et WHATSAPP_NUMBER

npm start
```

> `ffmpeg` est requis pour les commandes vidéo/audio/sticker. Sans lui, ces commandes afficheront une erreur claire au lieu de planter.

## 4. Installation sur Linux

```bash
sudo apt update && sudo apt install -y nodejs npm ffmpeg git
# (Node.js >= 18 recommandé — utilisez nvm si votre distribution fournit une version trop ancienne)

git clone <url-de-votre-dépôt> hsa-bot
cd hsa-bot
npm install

cp .env.example .env
nano .env

npm start        # production
npm run dev       # développement (redémarrage automatique)
```

## 5. Configuration (.env)

Copiez `.env.example` en `.env` et renseignez vos valeurs. Variables essentielles :

| Variable | Description |
|---|---|
| `BOT_NAME` | Nom affiché du bot (par défaut `H$Λ BOT`) |
| `PREFIX` | Préfixe des commandes (par défaut `/`) |
| `OWNER_NUMBER` | Numéro WhatsApp du propriétaire (sans `+`, ex: `2250700000000`) |
| `WHATSAPP_NUMBER` | Numéro utilisé pour connecter **le bot lui-même** (pairing code) |
| `PORT` | Port du serveur HTTP (Render l'impose automatiquement) |
| `DATA_DIR` / `AUTH_DIR` | Emplacements des données persistantes et de la session |
| `AUTH_STORAGE` | `file` (par défaut) ou `database` |

Toutes les autres variables (IA, météo, téléchargement, etc.) sont **optionnelles** : chaque fonctionnalité concernée reste désactivée avec un message clair tant que sa clé n'est pas renseignée. Voir `.env.example` pour la liste complète et commentée.

## 6. Connexion WhatsApp (pairing code)

H$Λ BOT se connecte **uniquement par code d'appairage** (pas de QR code) :

1. Renseignez `WHATSAPP_NUMBER` dans `.env` (ou laissez vide pour qu'il soit demandé dans le terminal, en local/Termux uniquement — **obligatoire sur Render**, faute de terminal interactif).
2. Démarrez le bot (`npm start`).
3. Le code d'appairage s'affiche dans les logs :
   ```
   ════════════════════════════════════
      CODE D'APPAIRAGE : ABCD-1234
      WhatsApp > Appareils liés > Lier un appareil > Lier avec un numéro
   ════════════════════════════════════
   ```
4. Sur le téléphone qui possède le numéro `WHATSAPP_NUMBER` : WhatsApp → Appareils liés → Lier un appareil → *Lier avec un numéro de téléphone* → entrez le code.
5. Une fois connecté, la session est sauvegardée (voir [§11](#11-persistance-de-la-session)) et les prochains démarrages se reconnectent automatiquement, sans nouveau code.

La reconnexion automatique gère les coupures réseau. Seul un **logout explicite** (déconnexion depuis le téléphone) nécessite un nouvel appairage (supprimez alors le contenu de `AUTH_DIR`).

## 7. Propriétaire (OWNER)

`OWNER_NUMBER` définit qui a accès aux commandes du panneau `👑 OWNER` (broadcast, maintenance, eval, backup...), ainsi qu'aux commandes `adminOnly` de groupe par défaut. Cette vérification est faite **côté serveur** à chaque commande — jamais uniquement via l'affichage du menu.

`OWNER_NUMBER` peut être le même numéro que `WHATSAPP_NUMBER` (le propriétaire utilise son propre téléphone comme bot) ou un numéro différent (un compte dédié fait tourner le bot, administré à distance par le propriétaire).

Des administrateurs applicatifs supplémentaires peuvent être ajoutés avec `/addadmin` (niveau intermédiaire entre OWNER et USER, voir [§16](#16-sécurité)).

## 8. APIs externes

Aucune clé n'est fournie avec le projet. Chaque intégration est **optionnelle** et clairement indiquée dans `.env.example` :

| Fonctionnalité | Variable(s) | Sans clé configurée |
|---|---|---|
| IA (chat, traduction, résumé...) | `AI_API_KEY`, `AI_API_URL`, `AI_MODEL` | Message "service non configuré" |
| Génération d'image | `AI_API_KEY`, `AI_IMAGE_API_URL` | Idem |
| Synthèse vocale | `TTS_API_URL`, `TTS_API_KEY` | Idem |
| Suppression de fond | `REMOVEBG_API_KEY` | Idem |
| Upscaling IA | `IMAGE_UPSCALE_API_URL` | Repli automatique sur un upscaling classique local (sans IA) |
| Téléchargement YT/TikTok/IG/FB/Twitter | `DOWNLOAD_API_URL`, `DOWNLOAD_API_KEY` | Message "service non configuré" |
| Météo | `WEATHER_API_KEY` | Idem |
| Anti-NSFW | `NSFW_API_URL` | La fonctionnalité refuse de s'activer |

Certaines commandes (`/qr`, `/readqr`, `/ocr`, images locales, `/short`, `/currency`, `/lyrics`, `/domain`) fonctionnent **sans aucune clé**, via des traitements 100 % locaux ou des API publiques gratuites reconnues.

⚠️ Pour le téléchargement (YouTube, TikTok, Instagram, Facebook, Twitter), branchez un fournisseur tiers **conforme aux CGU des plateformes concernées** — H$Λ BOT ne contourne aucune protection technique.

## 9. Base de données

Stockage **JSON persistant sur disque** (un fichier par collection dans `DATA_DIR`), sans dépendance native — donc compatible Termux. Collections : `users`, `groups`, `admins`, `group_settings`, `warnings`, `bot_settings`, `stats`, `contact_messages`.

L'architecture (classe `Collection` avec une interface `get/set/delete/all`) a été pensée pour permettre une migration future vers PostgreSQL sans réécrire la logique métier.

## 10. Déploiement sur Render

1. Poussez le projet sur un dépôt Git.
2. Créez un nouveau **Web Service** Render, ou utilisez directement `render.yaml` (Blueprint).
3. Renseignez au minimum `OWNER_NUMBER` et `WHATSAPP_NUMBER` dans les variables d'environnement Render (elles sont marquées `sync: false` dans `render.yaml`, donc à saisir manuellement dans le tableau de bord).
4. Déployez. `npm install` puis `npm start` sont exécutés automatiquement.
5. Récupérez le code d'appairage dans les **logs Render**.

⚠️ Le plan gratuit Render utilise un **système de fichiers éphémère** : la session WhatsApp et la base JSON seront perdues à chaque redéploiement/veille, sauf si vous attachez un **Persistent Disk** (voir le bloc commenté dans `render.yaml`).

## 11. Persistance de la session

Par défaut (`AUTH_STORAGE=file`), la session Baileys est stockée dans `AUTH_DIR` (dossier multi-fichiers standard). Une alternative (`AUTH_STORAGE=database`) stocke les mêmes credentials dans la base JSON (`src/database/authStore.js`), utile si vous préférez une seule couche de stockage à sauvegarder/migrer.

Dans les deux cas, sur Render, la persistance réelle **nécessite un disque monté** (Persistent Disk). Sans cela, un redémarrage du service demandera un nouvel appairage.

## 12. Liste des commandes

La liste complète et à jour est toujours disponible via `/help` (ou `/help <catégorie>`) directement dans WhatsApp — elle reflète exactement les commandes chargées par le bot. Catégories : `general`, `ai`, `image`, `video`, `audio`, `download`, `tools`, `group`, `moderation`, `fun`, `owner`.

## 13. Configuration des groupes

Chaque groupe a ses propres réglages, stockés indépendamment (`group_settings`) :

```
/antilink on|off|whitelist <lien>
/antispam on|off
/antibadword on|off|add <mot>|list
/antiflood on|off
/antinsfw on|off
/welcome on|off|set <message avec @user>
/goodbye on|off|set <message avec @user>
/autoread on|off
/autotyping on|off
/autorecording on|off
```

Les commandes de modération nécessitent que **H$Λ BOT soit administrateur du groupe** pour pouvoir supprimer les messages fautifs ou exclure un membre.

## 14. Système /contact

- `/contact <message>` : transmet directement le message à OWNER.
- `/contact` (sans texte) : le bot répond *« Envoyez maintenant votre message »*, puis transmet le prochain contenu envoyé (texte, image, audio, vidéo, document).
- OWNER répond en utilisant la fonction **« Répondre »** de WhatsApp directement sur le message reçu : la réponse est automatiquement retransmise au bon utilisateur.
- La correspondance (`contact_messages`) est **persistante** : OWNER peut répondre même après un redémarrage du bot.
- Chaque conversation est isolée : une réponse à un utilisateur A n'est jamais envoyée à un utilisateur B.

## 15. Dépannage

| Problème | Piste |
|---|---|
| Pas de code d'appairage sur Render | Vérifiez que `WHATSAPP_NUMBER` est bien renseigné dans les variables d'environnement Render |
| Session perdue à chaque redéploiement | Attachez un Persistent Disk (voir [§10](#10-déploiement-sur-render)) |
| Commandes vidéo/audio/sticker en erreur | Installez `ffmpeg` (`pkg install ffmpeg` sur Termux, `apt install ffmpeg` sur Linux) ou définissez `FFMPEG_PATH` |
| Une commande IA répond "non configuré" | Renseignez `AI_API_KEY` dans `.env` |
| Le bot ne répond à aucun message | Vérifiez que vos messages commencent bien par le préfixe actuel (`/help` pour le voir) |
| Erreur de permission WhatsApp (kick/promote...) | H$Λ BOT doit être administrateur du groupe |

## 16. Sécurité

- Vérification des permissions **OWNER / ADMIN / USER** faite côté serveur à chaque commande (jamais confiée au client).
- `/eval` et `/exec` sont strictement réservées à OWNER et ne sont jamais exposées à un utilisateur normal.
- Aucun `eval()` n'est utilisé pour la calculatrice (`/calc`) : un évaluateur d'expressions dédié est utilisé.
- Anti-spam interne configurable (`RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`) pour limiter les abus et protéger les API externes.
- Les logs ne contiennent jamais de clés API, tokens ou credentials WhatsApp (filtrage automatique).
- Toute commande peut échouer sans jamais faire planter le processus (gestion d'erreurs systématique + messages clairs).

---

**H$Λ BOT** — Multifunction WhatsApp Bot, 100% gratuit.
