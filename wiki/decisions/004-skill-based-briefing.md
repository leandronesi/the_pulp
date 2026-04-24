# ADR 004 — Skill `pulp-briefing` come source-of-truth

**Data**: 2026-04-24
**Status**: accettata, implementata (schema; esecuzione ancora interattiva)

## Contesto

L'ambizione è che Claude (Opus 4.7) diventi un analista che legge Turso e produce briefing settimanali/mensili con analisi vera (non placeholder, non template riempiti male). Problema: ogni volta che si chiede "fammi il briefing", senza un piano, l'LLM ripartirebbe da zero, ri-inventerebbe la forma, sceglierebbe tier diversi, userebbe voice diversa ogni volta.

Risultato = output inconsistente tra briefing, non confrontabili, difficili da inserire in workflow (email, gestione clienti, ecc).

## Opzioni considerate

| Opzione | Pro | Contro |
|---|---|---|
| **Prompt ad-hoc ogni volta** | Zero setup | Varianza alta, risultati non comparabili, impossibile da automatizzare |
| **Script Node che genera il report con template fisso** | Output deterministico | Tutto il valore dell'LLM (analisi, voice, interpretazione) sparisce → si torna a report statistici freddi |
| **Skill `.claude/skills/pulp-briefing/` con workflow e references** | LLM guida ma aderisce a schema, voice e benchmarks fissati | Richiede disciplina nel mantenere la skill aggiornata |

## Decisione

**Skill Claude Code formalizzata**, struttura:

```
.claude/skills/pulp-briefing/
├── SKILL.md                  # workflow 7-step + template output + regole
└── references/
    ├── schema.md             # tabelle Turso + query tipiche
    ├── brand-context.md      # identità Pulp, audience, voice
    └── benchmarks.md         # tier IG (ER, reach, growth)
```

**Workflow 7-step** (adattato da [social-media-analyzer di alirezarezvani](https://github.com/alirezarezvani/claude-skills/blob/main/marketing-skill/social-media-analyzer/SKILL.md), non reinventato):

1. Validate data availability (minimo 3 snapshot nel periodo)
2. Current period aggregates
3. Previous period aggregates (stessa lunghezza)
4. Identify outliers (hero + bottom)
5. Benchmark (tier IG)
6. Brand voice synthesis (italiano editoriale, anti-marketing-speak)
7. Draft report

## Conseguenze

**Positive:**
- Ogni briefing ha struttura identica → confrontabili nel tempo
- La voice è fissata: italiano editoriale, no marketing-speak, trattini per ritmo. Definito in `brand-context.md`
- I tier IG sono fissati e citabili: "ER 5.2% — tier good, in [benchmarks.md](...)"
- Il `schema.md` documenta le query → meno rischio di calcoli sbagliati
- Se la skill evolve, tutti i briefing futuri evolvono con lei (vs migliaia di prompt dispersi)

**Negative accettate:**
- Manutenzione: ogni volta che cambio lo schema DB o la voice, va sincronizzato
- Richiede un LLM che sappia seguire skill (Claude Code sì, altri meno)

## Regole chiave incorporate

- **Human-in-the-loop**: i briefing sono sempre **draft**. Anche se in futuro ci sarà un cron che li genera automaticamente, il cron produce il draft e notifica — non pubblica
- **Mai inventare numeri**: query null → `—` nel briefing + nota il gap. Meglio un briefing con buchi dichiarati che un briefing fittizio
- **Periodo prec. sempre stessa lunghezza**: 7d vs 7d, 30d vs 30d. Mai mescolare
- **Post concreti, non astratti**: "il reel del 17/4 su Monteforte" ≠ "un contenuto recente"

## Quando riconsiderare

- Se risulta che la skill è troppo rigida e fa perdere insight creativi → ammorbidirla o spostare la decisione "voice/struttura" al briefing specifico
- Se un altro account (non The Pulp) va gestito → creare `pulp-briefing` → `client-X-briefing` come skill separata, o parametrizzare la skill

## Riferimenti

- Skill: [.claude/skills/pulp-briefing/SKILL.md](../../.claude/skills/pulp-briefing/SKILL.md)
- Pattern ispiratore: [alirezarezvani/claude-skills — social-media-analyzer](https://github.com/alirezarezvani/claude-skills/blob/main/marketing-skill/social-media-analyzer/SKILL.md)
- Pattern "skill.md come source-of-truth": [Stormy AI — Automate Social Media Reporting with Claude Code](https://stormy.ai/blog/automate-social-media-reporting-claude-code)
