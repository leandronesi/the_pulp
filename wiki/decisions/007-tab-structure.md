# ADR 007 — Tab structure (Overview / Posts / Audience)

**Data**: 2026-04-24
**Status**: accettata, Phase 1-3 implementata

## Contesto

Dashboard single-page con 8 sezioni verticali (hero, rate strip, reach chart, sintesi, content mix, post analysis, heatmap, audience). Anti-pattern "Overwhelm upfront" della skill `ui-ux-pro-max` (Priority 8). L'utente atterrando doveva scrollare fra metriche macro, approfondimenti per post, demographics — tutto insieme. Nessuna gerarchia tra "come sto andando" vs "cosa analizzo".

Inoltre il date filter era **inconsistente**: Hero/Reach chart rispettavano il range selezionato, ma Post grid/scatter/heatmap/rate strip usavano gli ultimi 30 post fetched indipendentemente. L'Audience era lifetime ma non esplicito.

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **Single-page con section dividers** | Minimal change | Non risolve overwhelm; scroll lungo |
| **Left sidebar nav** | Spazio per più sezioni | Overkill per 3-4 viste; mobile unfriendly |
| **Bottom nav (mobile-style)** | Familiare | Insolito su desktop; conflitti con chat button |
| **Top tabs (scelto)** | Pattern canonico, mobile/desktop ok, deep linkable, piccolo footprint | — |

## Decisione

**Tabs top-level con 3 sezioni** via `@radix-ui/react-tabs`, URL hash per deep linking.

- **Overview** (`#overview`): snapshot "come sto andando" del periodo. Hero 4 KPI + rate strip 4 tile + reach chart + sintesi. Tutto rispetta il date range.
- **Posts** (`#posts`): deep-dive contenuti del periodo. Content mix + scatter + grid + heatmap. Tutto filtrato per `timestamp ∈ range` via `postsInRange` memo. Banner in testa dichiara il conteggio e i post esclusi.
- **Audience** (`#audience`): demographics lifetime dei follower. Pill `lifetime` + disclaimer esplicito che non segue il range.

Chat "Chiedi al Pulp" e date picker restano **fuori** dalle tab — applicano a tutte.

## Implementazione

- `Tabs.Root` avvolge il contenuto; `Tabs.List` è una barra orizzontale sotto l'header
- Custom `TabTrigger` con:
  - Underline cream che si espande via `scale-x-0 → scale-x-100` su `data-[state=active]`
  - Hover soft `text-white/40 → text-white/80`
  - Icon + label (mono-font uppercase tracking-wide)
  - `rounded-t-lg` per focus ring accessibile
- Animazione fade-in 300ms sui `Tabs.Content` via Tailwind `data-[state=active]:animate-in data-[state=active]:fade-in`
- State sync con URL: `useState` inizializzata da `window.location.hash`, `hashchange` listener per browser back/forward, `changeTab()` aggiorna via `history.replaceState` per non inquinare la history
- Gating: stesse regole del resto (in static mode non cambia nulla, funziona uguale)

## Conseguenze

**Positive:**
- Gerarchia di informazione chiara: "sguardo rapido" vs "deep-dive" vs "chi ti segue"
- Date range finalmente coerente in Posts tab (era un bug strisciante)
- Deep link: puoi condividere `leandronesi.github.io/the_pulp/#posts` e atterri lì
- F5 mantiene la tab
- Mobile: la tab bar scrolla orizzontalmente se serve

**Negative:**
- Tutto viene renderizzato comunque (Radix Tabs monta tutti i pannelli, mostra/nasconde via CSS). Performance ok per il nostro size; se dovesse pesare si può `forceMount={false}` o lazy load
- L'utente deve cliccare per vedere i post — non sono più sotto il naso. Accettato: il cognitive load scende

## Fallback 90d

In parallelo, sistemato il bug che su range 90gg la Graph API ritorna null per `metric_type=total_value`. `fetchDayTotals` ora fa chunking in blocchi ≤28gg e somma. **Non** è deduplicato cross-chunk (un utente visto nel mese 1 e nel mese 3 conta 2), ma il numero è robusto. `fallbackUsed` array segnala quali metriche hanno usato la somma. Da valutare se mostrare un indicatore UI "numero indicativo" accanto ai valori.

## Riferimenti

- [ui-ux-pro-max SKILL.md](../../.claude/skills/ui-ux-pro-max/SKILL.md) — Priority 8 (Progressive disclosure) e 9 (Navigation patterns)
- [anthropic-frontend-design SKILL.md](../../.claude/skills/anthropic-frontend-design/SKILL.md) — intentional spatial composition
- [Radix Tabs docs](https://www.radix-ui.com/primitives/docs/components/tabs)
