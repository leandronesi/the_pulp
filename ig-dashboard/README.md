# Instagram Insights Dashboard

Dashboard React che legge i dati dalla **Instagram API con Instagram Login** (`graph.instagram.com`). Gira in locale con Vite.

## Avvio

```bash
npm install
npm run dev
```

Apre `http://localhost:5180` automaticamente.

## Configurazione

Token in [src/config.js](src/config.js). Aggiornalo lì quando scade (dura ~60 giorni).

Il token si genera dal dashboard Meta → app → **Instagram** → **API setup with Instagram business login** → Generate access token. Deve avere almeno lo scope `instagram_business_basic` + `instagram_business_manage_insights`.

Vedi [CLAUDE.md](CLAUDE.md) per i dettagli architetturali.

## Note

- I long-lived token Instagram Login durano circa 60 giorni.
- Se qualche metrica mostra "—", quella metrica non è disponibile per il tuo tipo di account/media (normale per alcuni formati). Nel pannello "metriche con problemi" vedi i dettagli; se l'errore è `(#10)`, manca uno scope sul token.
- Le chiamate vanno direttamente dal browser a `graph.instagram.com`. In locale funzionano senza problemi di CORS.

## Build per deploy

```bash
npm run build
```

Output in `dist/`. Attenzione: il token finisce nel bundle, quindi non deployare su un URL pubblico senza prima spostare le chiamate dietro un backend.
