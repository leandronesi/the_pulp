# Concept — Lifecycle del token Meta

Tre token esistono nel sistema Meta, di durate diverse. Capire le interazioni serve a non trovarsi con tutto scaduto.

## Tipi di token

| Token | Durata | Dove sta |
|---|---|---|
| **User token short-lived** | 1-2h | Solo temporaneo, generato da Graph API Explorer |
| **User token long-lived** | 60gg | Nostro, ottenuto da exchange del short-lived |
| **Page access token** | Non scade* | Nostro, derivato dallo user long-lived via `/me/accounts`. Questo è ciò che finisce in `IG_PAGE_TOKEN` |

*Non scade finché lo user da cui deriva resta autenticato: password non cambiata, app non revocata, account non sospeso.

## Flow di generazione

### 1. User token short-lived
1. Graph API Explorer → app "The Pulp" → seleziona permissions: `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_insights`
2. "Generate Access Token" → popup OAuth Meta → autorizza → token viene stampato nel box
3. **Valido ~1-2h**. Non usarlo direttamente: scambialo subito prima che scada

### 2. Exchange → long-lived (60gg)
```
GET https://graph.facebook.com/v21.0/oauth/access_token
    ?grant_type=fb_exchange_token
    &client_id={APP_ID}
    &client_secret={APP_SECRET}
    &fb_exchange_token={USER_TOKEN_SHORT_LIVED}
```
Risposta: `{"access_token": "EAA...", "expires_in": 5184000}` (= 60gg).

`APP_ID` = `790185340523845` (pubblico).
`APP_SECRET` = vive nel dashboard Meta, non committato. Vedi sezione "Rinnovo App Secret" sotto.

### 3. /me/accounts → Page token non-expiring
```
GET https://graph.facebook.com/v21.0/me/accounts
    ?access_token={USER_TOKEN_LONG_LIVED}
```
Risposta include array di Page collegate all'user. `data[0].access_token` è il **Page access token non-expiring**. Questo è il valore da:
- Mettere in `ig-dashboard/src/config.js` locale
- Settare come GitHub Secret `IG_PAGE_TOKEN`

**Chiave chiave**: il Page token non-expiring è tale SOLO perché deriva da un user long-lived. Se derivi un Page token da uno short-lived, anche il Page token scade in 1-2h.

## Quando scade e perché

- **User long-lived scade a 60gg**: dovrebbe essere rinnovato entro quella finestra. Puoi fare refresh del long-lived chiamando di nuovo l'exchange con lo stesso user token prima che scada.
- **Page token non-expiring si invalida se**:
  - L'utente proprietario cambia password Facebook
  - L'utente revoca l'app dalla sua lista app autorizzate
  - L'app Meta viene disabilitata da Meta
  - L'utente perde i ruoli sulla Page (es. rimosso come admin)
- Errore 401 / code 190 → rigenerare.

## Procedura di rinnovo (quando il Page token muore)

1. Generare nuovo user token short-lived da Graph API Explorer (~1 min)
2. Exchange short-lived → long-lived (`fb_exchange_token`) → lancio curl con APP_ID + APP_SECRET
3. `GET /me/accounts` col long-lived → nuovo Page token
4. Aggiornare:
   - `ig-dashboard/src/config.js` (locale)
   - GitHub Secret `IG_PAGE_TOKEN`

Tempo totale: ~3 minuti se si ha App Secret a portata di mano.

## Rinnovo App Secret

Se l'App Secret finisce in posti pubblici (chat logs, commit per errore, ecc.) va rigenerato:

1. Meta for Developers → The Pulp → Impostazioni → Di base → **"Chiave segreta app"** → **Reimposta** → inserisci password FB → copia nuovo secret
2. L'Operation non invalida i token già emessi, invalida solo il secret per emettere token nuovi
3. Futuri exchange usano il nuovo secret

## Cosa NON fare

- **Non usare uno user short-lived direttamente in `config.js`**: scade in 1-2h e tutti i workflow iniziano a fallire. Successo già una volta, vedi wiki/log.md entry del 2026-04-24.
- **Non condividere App Secret in chat senza reset dopo**: è utile come cautela. Vale anche per i Page token, ma i Page sono più facili da rinnovare.
- **Non scambiare un Page token per uno user token**: i flussi sono diversi, l'endpoint `fb_exchange_token` richiede uno user token.

## Riferimenti

- [decisions/005-graph-api-vs-instagram-login.md](../decisions/005-graph-api-vs-instagram-login.md) — perché questo flow invece di Instagram Login
- [ig-dashboard/CLAUDE.md](../../ig-dashboard/CLAUDE.md) sezione "Generazione token"
- Meta docs access tokens: https://developers.facebook.com/docs/facebook-login/guides/access-tokens/
