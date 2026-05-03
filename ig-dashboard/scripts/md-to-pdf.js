// md → pdf via Microsoft Edge headless --print-to-pdf.
// Mantiene la palette Pulp ma in versione print-ready (background chiaro,
// testo scuro, tipografia editoriale con Fraunces + JetBrains Mono).
//
// Usage:
//   npm run pdf -- ../reports/aprile-2026.md
//   npm run pdf -- ../reports/aprile-2026.md ../reports/aprile-2026.pdf
//
// Output: stesso path del .md ma con estensione .pdf, salvo override.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve, dirname, basename, extname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { marked } from "marked";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const inputArg = process.argv[2];
if (!inputArg) {
  console.error("Usage: npm run pdf -- <path-to-md> [output.pdf]");
  process.exit(1);
}
const inputAbs = resolve(process.cwd(), inputArg);
if (!existsSync(inputAbs)) {
  console.error(`File non trovato: ${inputAbs}`);
  process.exit(1);
}
const outputAbs = process.argv[3]
  ? resolve(process.cwd(), process.argv[3])
  : resolve(dirname(inputAbs), basename(inputAbs, extname(inputAbs)) + ".pdf");

const md = readFileSync(inputAbs, "utf-8");

marked.setOptions({ gfm: true, breaks: false });
const bodyHtml = marked.parse(md);

const docTitle = basename(inputAbs, extname(inputAbs));

const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8" />
<title>${docTitle}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=JetBrains+Mono:wght@300;400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet" />
<style>
  :root {
    --green-deep: #052019;
    --green-mid: #0b3a30;
    --green-light: #164f3f;
    --cream: #ede5d0;
    --paper: #faf7ee;
    --gold: #b88a4a;
    --gold-bright: #d4a85c;
    --terracotta-soft: #c46f50;
    --sage: #3e7a66;
    --ink: #1a2820;
    --muted: #5a6760;
  }

  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
    color: var(--ink);
    background: var(--paper);
    font-size: 10.5pt;
    line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }

  /* Tipografia editoriale */
  h1, h2, h3, h4 {
    font-family: "Fraunces", Georgia, serif;
    color: var(--green-deep);
    font-weight: 400;
    line-height: 1.15;
    margin: 1.6em 0 0.5em;
    letter-spacing: -0.005em;
    page-break-after: avoid;
  }
  h1 {
    font-size: 26pt;
    font-style: italic;
    font-weight: 300;
    margin-top: 0;
    margin-bottom: 0.2em;
    border-bottom: 1px solid var(--gold);
    padding-bottom: 0.4em;
  }
  h2 {
    font-size: 17pt;
    font-style: italic;
    font-weight: 400;
    color: var(--green-light);
    border-bottom: 1px dashed rgba(11, 58, 48, 0.18);
    padding-bottom: 0.25em;
  }
  h3 {
    font-size: 12.5pt;
    font-weight: 500;
    color: var(--gold);
  }
  h4 {
    font-size: 11pt;
    font-weight: 500;
    color: var(--green-light);
    font-style: italic;
  }

  p { margin: 0.6em 0; orphans: 3; widows: 3; }
  em { color: var(--green-mid); }
  strong { color: var(--green-deep); font-weight: 600; }

  /* Liste */
  ul, ol { margin: 0.4em 0 0.8em; padding-left: 1.5em; }
  li { margin: 0.2em 0; }
  li::marker { color: var(--gold); }

  /* Code & kbd */
  code {
    font-family: "JetBrains Mono", monospace;
    font-size: 9pt;
    background: rgba(212, 168, 92, 0.14);
    color: var(--green-deep);
    padding: 1px 4px;
    border-radius: 3px;
  }
  pre {
    font-family: "JetBrains Mono", monospace;
    font-size: 9pt;
    background: rgba(11, 58, 48, 0.05);
    border-left: 3px solid var(--gold);
    padding: 10px 14px;
    overflow-x: auto;
    page-break-inside: avoid;
    margin: 0.8em 0;
  }
  pre code { background: transparent; padding: 0; }

  /* Blockquote */
  blockquote {
    border-left: 3px solid var(--gold);
    background: rgba(212, 168, 92, 0.08);
    padding: 8px 16px;
    margin: 0.8em 0;
    font-family: "Fraunces", Georgia, serif;
    font-style: italic;
    font-size: 11.5pt;
    color: var(--green-deep);
    page-break-inside: avoid;
  }
  blockquote p { margin: 0.4em 0; }

  /* Hr come separatore di sezione */
  hr {
    border: 0;
    border-top: 1px solid rgba(184, 138, 74, 0.4);
    margin: 1.6em 0;
  }

  /* Tabelle: il cuore di un report dati */
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 9.5pt;
    margin: 0.8em 0 1em;
    page-break-inside: avoid;
    background: white;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }
  thead { background: var(--green-light); }
  thead th {
    color: var(--cream);
    font-family: "Inter", sans-serif;
    font-weight: 500;
    text-align: left;
    padding: 7px 10px;
    font-size: 9pt;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border: 0;
  }
  tbody td {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(11, 58, 48, 0.08);
    vertical-align: top;
  }
  tbody tr:nth-child(odd) { background: rgba(212, 168, 92, 0.04); }
  tbody tr:last-child td { border-bottom: 0; }
  th[align="right"], td[align="right"] { text-align: right; font-variant-numeric: tabular-nums; }
  th[align="center"], td[align="center"] { text-align: center; }

  /* Link (stampa: tieni colore ma niente underline pesante) */
  a {
    color: var(--green-light);
    text-decoration: none;
    border-bottom: 1px dotted var(--gold);
  }

  /* Page break helpers */
  h1, h2 { page-break-before: auto; }
  h2 + p, h2 + table, h2 + ul, h2 + ol { page-break-before: avoid; }

  /* Footer/header decoration sulla prima pagina (drop-cap soft) */
  body > h1:first-child + p em:first-child {
    color: var(--muted);
    font-style: italic;
  }

  /* Riduci dimensioni in tabelle dense */
  table table { font-size: 8.5pt; }

  /* Numeri allineati a destra di default nelle ultime colonne tipiche */
  table td:last-child, table th:last-child {
    /* lasciamo libero — markdown table align style li gestisce */
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const tmpHtml = resolve(dirname(outputAbs), `.tmp-${basename(outputAbs, ".pdf")}.html`);
writeFileSync(tmpHtml, html);
console.log(`[pdf] HTML temp scritto: ${tmpHtml}`);

const EDGE_PATHS = [
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
];
const edge = EDGE_PATHS.find((p) => existsSync(p));
if (!edge) {
  console.error("Microsoft Edge non trovato. Installalo o adatta lo script per usare Chrome.");
  process.exit(1);
}

const fileUrl = pathToFileURL(tmpHtml).href;
console.log(`[pdf] Edge: ${edge}`);
console.log(`[pdf] generazione…`);

const result = spawnSync(
  edge,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--no-pdf-header-footer",
    `--print-to-pdf=${outputAbs}`,
    fileUrl,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);

// Edge headless logga su stderr ma exit 0 quando ok
if (result.status !== 0) {
  console.error("[pdf] Edge ha restituito errore:");
  console.error(result.stderr?.toString());
  process.exit(1);
}

if (!existsSync(outputAbs)) {
  console.error("[pdf] PDF non generato. Output Edge:");
  console.error(result.stderr?.toString());
  process.exit(1);
}

// Pulizia HTML temp
try { unlinkSync(tmpHtml); } catch {}

console.log(`[pdf] OK → ${outputAbs}`);
