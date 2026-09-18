// Assemble le DAW en un seul fichier HTML autonome.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const r = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const safe = (s) => s.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

let html = r("./shell.html");
const parts = {
  "/*__CSS__*/": r("./style.css"),
  "/*__LAME__*/": safe(r("./vendor/lame.min.js")),
  "/*__SAMPLES__*/": safe(r("./samples.json")),
  "/*__ENGINE__*/": safe(r("./engine.js")),
  "/*__APP__*/": safe(r("./app.js")),
};
for (const [token, value] of Object.entries(parts)) {
  if (!html.includes(token)) throw new Error("token manquant: " + token);
  html = html.replace(token, () => value);
}

mkdirSync(new URL("../public/", import.meta.url), { recursive: true });
writeFileSync(new URL("../public/neonforge-studio.html", import.meta.url), html);
console.log("OK", (html.length / 1048576).toFixed(2), "Mo");
