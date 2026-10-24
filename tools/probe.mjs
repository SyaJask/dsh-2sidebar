// Ad-hoc inspector: extract interesting strings from a built bundle.
// usage: node tools/probe.mjs <file> [needle ...]
import fs from 'node:fs';

const [file, ...needles] = process.argv.slice(2);
const src = fs.readFileSync(file, 'utf8');

if (needles.length === 0) {
  const slots = [...src.matchAll(/['"`]([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9_-]+){2,})['"`]/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith('sidebar.') || s.startsWith('conversation.') || s.startsWith('shell.'));
  console.log([...new Set(slots)].sort().join('\n'));
} else {
  for (const needle of needles) {
    let idx = 0;
    let count = 0;
    while ((idx = src.indexOf(needle, idx)) !== -1 && count < 6) {
      console.log(`\n=== [${needle}] @${idx} ===`);
      console.log(src.slice(Math.max(0, idx - 260), idx + 420).replace(/\s+/g, ' '));
      idx += needle.length;
      count++;
    }
    if (count === 0) console.log(`\n=== [${needle}] NOT FOUND ===`);
  }
}
