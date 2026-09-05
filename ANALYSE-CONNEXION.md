# Analyse H$Λ BOT — Pourquoi WhatsApp ne se connecte pas

## Causes principales trouvées

### 1. Pairing déclenché trop tôt / trop souvent (BUG CRITIQUE)
Dans l'ancien `connectionHandler.js`, le code faisait :
```js
if (connection === 'connecting' && !sock.authState.creds.registered)
```
L'événement `connecting` peut se répéter → plusieurs appels à `requestPairingCode` → échecs, timeouts, codes invalides.

**Correction** : pairing uniquement quand le signal `qr` arrive (socket prêt), avec un flag `pairingStarted`.

### 2. WHATSAPP_NUMBER souvent vide
Sans `WHATSAPP_NUMBER` dans `.env`, le bot loggait une erreur et n'affichait aucun code.
README promettait un prompt terminal, mais le code ne le faisait pas vraiment de façon fiable.

**Correction** : prompt terminal en fallback + message d'erreur clair.

### 3. Pas de retry / timeout sur requestPairingCode
Un seul essai → si le réseau est lent (Katabump, Render), échec immédiat.

**Correction** : 4 tentatives avec délais + timeout 25s.

### 4. Code 515 non géré
Après un pairing réussi, WhatsApp envoie souvent un close 515 (restart required).
Sans gestion → le bot restait "déconnecté".

**Correction** : reconnexion automatique sur 515.

### 5. QR désactivé sans alternative
`printQRInTerminal: false` + pas d'affichage QR → si pairing échoue, aucune option.

---

## Checklist pour connecter

1. Créer `.env` depuis `.env.example`
2. Remplir au minimum :
   ```
   WHATSAPP_NUMBER=2250700000000
   OWNER_NUMBER=2250700000000
   ```
   (sans +, avec indicatif pays)
3. Nouvelle session :
   ```
   RESET_SESSION=true npm start
   ```
4. Entrer le code affiché dans les logs sur WhatsApp (Appareils liés)

---

## Commandes : 147 au total

Préfixe par défaut : `/`

Voir le rapport complet dans la réponse de l'assistant.
