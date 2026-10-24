// Inspect a captured /plugins/events SSE snapshot: list client row ids and
// search for a needle. usage: node tools/inspect-plugin-events.mjs <file> [needle]
import fs from 'node:fs';

const [file, needle] = process.argv.slice(2);
const source = fs.readFileSync(file, 'utf8');
const ids = [...source.matchAll(/"id":"([^"]+)"/g)].map((match) => match[1]);
const unique = [...new Set(ids)].sort();
console.log(`rows: ${unique.length}`);

const thirdParty = unique.filter((id) => !id.startsWith('@deepseek-ai/'));
console.log(`\n[third-party rows] ${thirdParty.length}`);
for (const id of thirdParty) console.log('  ' + id);

const needles = (needle ? [needle] : ['sidebar', 'better', 'locale', 'slots', 'remote', 'split']);
for (const word of needles) {
  const hits = unique.filter((id) => id.toLowerCase().includes(word.toLowerCase()));
  console.log(`\n[${word}] ${hits.length}`);
  for (const hit of hits) console.log('  ' + hit);
}

// The graph frame also carries row metadata; show the raw frame shape once.
const graphIndex = source.indexOf('"type":"graph"');
if (graphIndex !== -1) {
  console.log('\n--- graph frame head ---');
  console.log(source.slice(graphIndex, graphIndex + 700).replace(/\s+/g, ' '));
}
