# ADR 003 — Deploy pubblico statico pre-renderato (GH Pages)

**Data**: 2026-04-24
**Status**: accettata, implementata

## Contesto

Il dashboard è utile solo se qualcuno lo può vedere. Ma è un'app client-side che chiama Graph API dal browser col token in `src/config.js`. Se deployato come-è, il token finirebbe nel bundle JS pubblico → chiunque può leggerlo, cloneare l'accesso all'account IG, rate-limit-a l'app. Non si può.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **Proxy backend** (Cloudflare Worker o simile) che custodisce il token | Dati sempre live, UX identica al locale | Nuovo componente da gestire, nuovo account cloud, più codice |
| **Static pre-render** (workflow genera JSON, dashboard legge JSON) | Zero infra nuova, token mai nel bundle, deploy gratis su GH Pages | Dati non live: "snapshot generato X ore fa" |
| **Repo privato + auth basic** | Semplice | Quasi inutile: chi ha accesso vede il token comunque |
| **Niente deploy pubblico** | Zero rischio | Ovvio contro |

## Decisione

**Static pre-render su GitHub Pages**. Workflow [.github/workflows/publish-dashboard.yml](../../.github/workflows/publish-dashboard.yml):

1. Runner Ubuntu esegue `scripts/export-json.js` con `IG_PAGE_TOKEN` da GH Secrets → chiama Graph API server-side → scrive `ig-dashboard/public/data.json` con tutti i dati necessari al dashboard (3 range pre-calcolati, 30 post, audience).
2. `VITE_USE_STATIC=true npm run build` → bundle Vite include `data.json` come asset statico. Il codice di `App.jsx` rileva il flag e carica da `/data.json` invece di chiamare Graph API.
3. `actions/upload-pages-artifact@v3` + `actions/deploy-pages@v4` → GH Pages.

Cron `15 */4 * * *` più trigger su ogni push a main.

**URL live**: https://leandronesi.github.io/the_pulp/

## Conseguenze

**Positive:**
- Token non è mai nel bundle JS pubblico (verificato — `grep TOKEN dist/assets/*.js` → solo lo stub vuoto)
- Zero infra nuova. GH Actions + GH Pages = gratis + già integrato col repo
- Browser cache-abile, CDN-servibile, velocità istantanea (è HTML+JSON statici)
- Indicatore "snapshot generato X" onesto sul footer invece di "dati live"

**Negative accettate:**
- Dati sempre al massimo 4h vecchi. Per un account community che pubblica ~2-3 post/settimana, accettabile
- 3 run/giorno (un per quartiere) di chiamate Graph API ridondanti con gli snapshot verso Turso. Potremmo unificare (export-json legge da Turso invece di riscaricare) — **TODO, vedi [TODO.md](../../TODO.md)**
- Il date-range selector richiede 3x call (7/30/90) per ogni build → ogni export = ~21 call Graph API. Se volessimo abbattere, potremmo ridurre a solo il 30d default

## Dettagli implementativi

- Due job separati nel workflow: `build` (no environment) + `deploy` (environment: github-pages). Pattern canonico GitHub; in un unico job le repo-secrets passavano mal con `environment:` scoping. Vedi commit `2ac3ba6`.
- `src/config.js` è gitignored → su CI serve stub da `config.example.js` per far passare Vite bundler. Vedi commit `cf59c8b`.
- `FAKE_MODE = !STATIC_MODE && isFakeToken(TOKEN)` → in static mode il badge "demo · dati fake" non appare anche se TOKEN è stub vuoto. Vedi commit `13f53ce`.
- Img src in JSX usa helper `ASSET()` che prefissa con `import.meta.env.BASE_URL` (`/the_pulp/` in prod) — Vite non rewrite stringhe runtime, solo `index.html`. Vedi commit `13f53ce`.

## Quando riconsiderare

- Se si vuole vedere "dati live" al refresh (es. per demo in riunione): vale il proxy Cloudflare Worker. Costo setup ~1-2h, gratis come Pages.
- Se l'account diventa più grande e i dati sensibili (es. sponsor, campagne private): valutare repo privato + hosting autenticato.

## Riferimenti

- [ig-dashboard/scripts/export-json.js](../../ig-dashboard/scripts/export-json.js) — pre-render logic
- [ig-dashboard/src/App.jsx](../../ig-dashboard/src/App.jsx) — cerca `STATIC_MODE`
- [.github/workflows/publish-dashboard.yml](../../.github/workflows/publish-dashboard.yml)
