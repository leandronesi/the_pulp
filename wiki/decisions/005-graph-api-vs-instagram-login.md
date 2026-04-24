# ADR 005 — Facebook Graph API, non Instagram Login

**Data**: 2026-04-23 (registrato in wiki 2026-04-24)
**Status**: accettata, implementata (seconda iterazione)

## Contesto

Instagram Business Account è accessibile via due "flow" Meta:

1. **Facebook Graph API** (`graph.facebook.com`): la Page FB che gestisce l'IG Business si autentica con un Page access token. Scope storici IG: `instagram_basic`, `instagram_manage_insights`.
2. **Instagram API with Instagram Login** (`graph.instagram.com`): OAuth direttamente a Instagram, scope famiglia `instagram_business_*`.

Il progetto ha oscillato tra i due:

- **Iterazione 1** (primo avvio): FB Graph API con `instagram_manage_insights`. Problema: il dashboard Meta dava errore generico "Si è verificato un errore. Riprova più tardi" nell'aggiungere lo scope. Bloccati.
- **Iterazione 2**: migrazione a Instagram Login per bypassare il blocco (scope `instagram_business_manage_insights`).
- **Iterazione 3** (attuale): risolto il blocco Meta → ritorno a FB Graph API.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **FB Graph API via Page token** | Flow canonico per dashboard business lato Page. Page token non-expiring derivato da user long-lived. `/me/accounts` dà accesso alla Page + tutte le sotto-risorse IG | Richiede Page FB collegata all'IG (ma The Pulp ce l'ha già) |
| **Instagram API with Instagram Login** | `me` risolve automaticamente al titolare. Meno dipendenze dalla Page FB. Scope unificati `instagram_business_*` | Token long-lived da 60gg rinnovabile via `/refresh_access_token` ma deve essere ancora valido per il refresh |

## Decisione

**FB Graph API** (`graph.facebook.com/v21.0`).

Motivi concreti:
- **Page token non scade** (derivato da user long-lived) — vedi [concepts/token-lifecycle.md](../concepts/token-lifecycle.md). Un token permanente è un punto di failure in meno.
- Ho già fatto il setup (App Meta, Page FB collegata all'IG, scope approvato) → cambiare flow significherebbe re-fare l'approvazione scope su un use case diverso
- L'endpoint `/me/accounts` è il pattern canonico, ben documentato, non si evolve spesso

## Dettagli implementativi

- **PAGE_ID**: `111507393712812` (hardcoded in [ig-dashboard/src/config.example.js](../../ig-dashboard/src/config.example.js) — non è segreto)
- **Resolve dell'IG User ID a runtime**: `GET /{PAGE_ID}?fields=instagram_business_account` → cachato in `meta.ig_user_id` dopo il primo fetch
- **Scope necessari** sul user token da cui deriva il Page token:
  - `pages_show_list` (per `/me/accounts`)
  - `pages_read_engagement` (lettura base Page)
  - `instagram_basic` (profilo, media)
  - `instagram_manage_insights` (tutte le insights)

## Conseguenze

- Codice identifica l'account via `{IG_USER_ID}` risolto, non tramite `me`. Tutte le chiamate sono `/{ig_user_id}/...`
- Se la Page FB cambiasse ID (raro), basta aggiornare `PAGE_ID`
- Se Meta rompesse qualcosa in `/me/accounts` o deprecasse i Page token non-expiring: fallback Instagram Login, ma richiede refactor completo di app.jsx/snapshot.js (endpoint base diverso, `me` invece di `{id}`, scope diversi)

## Riferimenti

- [concepts/token-lifecycle.md](../concepts/token-lifecycle.md) — procedura di rinnovo token
- [ig-dashboard/CLAUDE.md](../../ig-dashboard/CLAUDE.md) — sezione "Perché la Facebook Graph API e non Instagram Login"
- Meta docs: https://developers.facebook.com/docs/instagram-api/
