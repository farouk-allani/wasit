// Builds the Wasit deck: slides.json -> deck.html -> ../wasit-deck.pdf (headless Chrome).
// Usage: node docs/deck/build.mjs   (set CHROME to the browser binary if it is not found)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const deck = JSON.parse(readFileSync(join(here, "slides.json"), "utf8"));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mark = readFileSync(join(here, "assets/mark.svg"), "utf8");

const eyebrow = (s) => `<div class="eyebrow">${esc(s.eyebrow)}</div>`;
const title = (s, cls = "") => `<h1 class="${cls}">${esc(s.title)}</h1>`;
const shot = (s) =>
  s.image
    ? `<figure class="shot"><img src="${esc(s.image)}" alt="" /><figcaption>${esc(s.caption ?? "")}</figcaption></figure>`
    : "";
const list = (items) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;

const render = {
  cover: (s) => `
    <div class="cover-bg"></div>
    <div class="cover">
      <div class="brand">${mark}<span>WASIT</span></div>
      ${eyebrow(s)}
      <h1 class="huge">${esc(s.lede)}</h1>
      <p class="lede">${esc(s.body)}</p>
      <div class="meta">${s.meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>
    </div>`,
  stats: (s) => `
    ${eyebrow(s)}${title(s)}
    <div class="stats">${s.rows
      .map((r) => `<div class="stat"><div class="figure">${esc(r.figure)}</div><p>${esc(r.text)}</p></div>`)
      .join("")}</div>
    <p class="source">${esc(s.source)}</p>`,
  steps: (s) => `
    <div class="two">
      <div>${eyebrow(s)}${title(s, "md")}
        <ol class="steps">${s.steps
          .map((st, i) => `<li><span class="n">${i + 1}</span><div><b>${esc(st.head)}</b><p>${esc(st.text)}</p></div></li>`)
          .join("")}</ol>
      </div>
      ${shot(s)}
    </div>`,
  table: (s) => `
    <div class="two">
      <div>${eyebrow(s)}${title(s, "md")}
        <table><thead><tr>${s.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${s.rows.map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join("")}</tbody></table>
      </div>
      ${shot(s)}
    </div>`,
  grid: (s) => `
    ${eyebrow(s)}${title(s)}
    <div class="grid">${s.items
      .map((it) => `<div class="cell"><b>${esc(it.head)}</b><p>${esc(it.text)}</p></div>`)
      .join("")}</div>`,
  proof: (s) => `
    ${eyebrow(s)}${title(s)}
    <div class="proof">
      <table class="plain"><tbody>${s.rows
        .map((r) => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`)
        .join("")}</tbody></table>
      <div class="figs">${s.figures
        .map((f) => `<div><div class="figure">${esc(f.figure)}</div><p>${esc(f.text)}</p></div>`)
        .join("")}</div>
    </div>
    <p class="source">${esc(s.note)}</p>`,
  split: (s) => `
    ${eyebrow(s)}${title(s)}
    <div class="split">
      <div><h2>${esc(s.left.head)}</h2>${list(s.left.items)}</div>
      <div><h2>${esc(s.right.head)}</h2>${list(s.right.items)}</div>
    </div>`,
  close: (s) => `
    <div class="cover-bg dim"></div>
    <div class="cover">
      <div class="brand">${mark}<span>WASIT</span></div>
      <h1 class="huge">${esc(s.title)}</h1>
      <dl class="links">${s.links.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
      <p class="team">${esc(s.team)}</p>
    </div>`,
};

const pages = deck.slides
  .map((s, i) => {
    const theme = s.theme ?? "dark";
    const foot =
      s.kind === "cover" || s.kind === "close"
        ? ""
        : `<footer><span>${esc(deck.footer)}</span><span>${i + 1} / ${deck.slides.length}</span></footer>`;
    return `<section class="slide ${theme} k-${s.kind}">${render[s.kind](s)}${foot}</section>`;
  })
  .join("\n");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><title>Wasit deck</title>
<style>
@font-face { font-family: "Mona Sans"; src: url(assets/mona-sans.woff2) format("woff2"); font-weight: 200 900; font-stretch: 75% 125%; }
@font-face { font-family: "Plex Mono"; src: url(assets/plex-mono-500.woff2) format("woff2"); font-weight: 500; }
@page { size: 1920px 1080px; margin: 0; }
:root { --navy-950:#070f19; --navy-900:#0b1624; --navy-850:#0f1d2e; --navy-800:#142539; --navy-700:#1d3149;
  --steel-400:#8e9bb0; --steel-300:#b4bfcf; --gold-600:#a97f4b; --gold-400:#ddb886; --gold-300:#ecd2ab;
  --ivory-100:#f6f2ea; --ivory-200:#ece5d8; --ink-900:#111a26; --muted:#5b6574; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--navy-950); }
body { font-family: "Mona Sans", sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.slide { width: 1920px; height: 1080px; position: relative; overflow: hidden; padding: 112px 128px 120px; page-break-after: always; break-after: page; }
.slide.dark { background: radial-gradient(ellipse at 80% 20%, var(--navy-850) 0%, var(--navy-900) 55%, var(--navy-950) 100%); color: #edf1f6; }
.slide.paper { background: var(--ivory-100); color: var(--ink-900); }
.eyebrow { font-size: 22px; font-weight: 620; letter-spacing: .2em; text-transform: uppercase; color: var(--gold-400); margin-bottom: 26px; }
.paper .eyebrow { color: var(--gold-600); }
h1 { font-size: 76px; line-height: 1.04; font-weight: 640; letter-spacing: -0.02em; font-stretch: 105%; max-width: 1500px; }
h1.md { font-size: 58px; max-width: 760px; }
h1.huge { font-size: 96px; max-width: 1300px; }
h2 { font-size: 30px; font-weight: 640; margin-bottom: 24px; }
p, li, td, th, dd, dt { font-size: 27px; line-height: 1.42; }
.dark p, .dark li, .dark td { color: var(--steel-300); }
.paper p, .paper li, .paper td { color: #2d3644; }
footer { position: absolute; left: 128px; right: 128px; bottom: 48px; display: flex; justify-content: space-between; font-size: 18px; letter-spacing: .04em; }
.dark footer { color: var(--steel-400); } .paper footer { color: var(--muted); }
.source { position: absolute; left: 128px; bottom: 96px; font-size: 19px; max-width: 1500px; }
.dark .source { color: var(--steel-400); } .paper .source { color: var(--muted); }
.figure { font-size: 112px; font-weight: 680; line-height: 1; letter-spacing: -0.03em; font-stretch: 110%; color: var(--gold-400); }
.paper .figure { color: var(--gold-600); }

.cover-bg { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(7,15,25,.96) 0%, rgba(7,15,25,.86) 45%, rgba(7,15,25,.35) 100%), url(assets/port-dusk.jpg) center/cover; }
.cover-bg.dim { background: linear-gradient(90deg, rgba(7,15,25,.97) 0%, rgba(7,15,25,.9) 55%, rgba(7,15,25,.55) 100%), url(assets/port-dusk.jpg) center/cover; }
.cover { position: relative; color: #edf1f6; height: 100%; display: flex; flex-direction: column; justify-content: center; }
.brand { position: absolute; top: 0; display: flex; align-items: center; gap: 22px; font-size: 34px; font-weight: 640; letter-spacing: .28em; color: var(--ivory-100); }
.brand svg { width: 56px; height: 56px; }
.lede { font-size: 34px; color: var(--steel-300); max-width: 1080px; margin-top: 40px; }
.meta { position: absolute; bottom: 0; display: flex; gap: 48px; font-size: 24px; color: var(--gold-300); }
.meta span + span::before { content: "·"; margin-right: 48px; color: var(--steel-400); }

.stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 64px; margin-top: 96px; }
.stat { border-top: 2px solid rgba(221,184,134,.35); padding-top: 40px; }
.stat p { margin-top: 28px; font-size: 29px; }

.two { display: grid; grid-template-columns: 760px 1fr; gap: 72px; height: 100%; align-items: start; }
.shot { margin-top: 8px; }
.shot img { width: 100%; border-radius: 18px; border: 1px solid rgba(17,26,38,.12); box-shadow: 0 30px 60px rgba(17,26,38,.16); display: block; }
.shot figcaption { margin-top: 20px; font-size: 21px; color: var(--muted); }
.steps { list-style: none; margin-top: 52px; display: grid; gap: 30px; }
.steps li { display: grid; grid-template-columns: 56px 1fr; gap: 20px; }
.steps .n { width: 48px; height: 48px; border-radius: 50%; background: var(--navy-900); color: var(--gold-300); display: grid; place-items: center; font-size: 24px; font-weight: 640; }
.steps b { font-size: 29px; font-weight: 640; }
.steps p { font-size: 23px; margin-top: 4px; }

table { width: 100%; border-collapse: collapse; margin-top: 44px; }
th { text-align: left; font-size: 19px; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); font-weight: 600; padding: 0 0 14px; border-bottom: 2px solid var(--ink-900); }
td { padding: 18px 24px 18px 0; vertical-align: top; border-bottom: 1px solid rgba(17,26,38,.12); font-size: 23px; }
td:first-child { font-weight: 620; color: var(--ink-900) !important; width: 40%; }

.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0; margin-top: 76px; border-top: 1px solid rgba(180,191,207,.18); }
.cell { padding: 40px 48px 40px 0; border-bottom: 1px solid rgba(180,191,207,.18); }
.cell b { font-size: 32px; font-weight: 640; color: var(--gold-300); }
.cell p { margin-top: 12px; font-size: 24px; }

.proof { display: grid; grid-template-columns: 1fr 520px; gap: 96px; margin-top: 24px; }
table.plain td { font-size: 24px; }
.figs { display: grid; gap: 36px; margin-top: 44px; }
.figs p { font-size: 22px; margin-top: 8px; }
.figs .figure { font-size: 88px; }

.split { display: grid; grid-template-columns: 1fr 1fr; gap: 96px; margin-top: 72px; }
.split ul { list-style: none; display: grid; gap: 22px; }
.split li { padding-left: 34px; position: relative; font-size: 26px; }
.split li::before { content: ""; position: absolute; left: 0; top: 15px; width: 12px; height: 12px; transform: rotate(45deg); background: var(--gold-400); }
.paper .split li::before { background: var(--gold-600); }
.split h2 { padding-bottom: 18px; border-bottom: 1px solid rgba(180,191,207,.25); }
.paper .split h2 { border-color: rgba(17,26,38,.15); }

.links { display: grid; grid-template-columns: 520px 1fr; row-gap: 18px; margin-top: 64px; }
.links dt { color: var(--steel-400); font-size: 26px; }
.links dd { color: var(--gold-300); font-size: 30px; font-weight: 600; }
.team { position: absolute; bottom: 0; font-size: 24px; color: var(--steel-300) !important; }
</style></head><body>
${pages}
</body></html>`;

const htmlPath = join(here, "deck.html");
writeFileSync(htmlPath, html);

const chrome =
  process.env.CHROME ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
  ].find((p) => existsSync(p));
if (!chrome) throw new Error("Chrome not found; set CHROME");
const pdf = join(here, "..", "wasit-deck.pdf");
execFileSync(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-pdf-header-footer",
  "--virtual-time-budget=5000",
  `--print-to-pdf=${pdf}`,
  pathToFileURL(htmlPath).href,
]);
console.log(`wrote ${pdf}`);
