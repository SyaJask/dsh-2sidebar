// asar-grep.mjs - read one entry from an Electron ASAR archive and grep it,
// printing file line numbers plus a few lines of context. Read-only.
//
// Usage:
//   node asar-grep.mjs <archive.asar> <entryPath> <regex> [contextLines] [maxHits]
//
// Example:
//   node asar-grep.mjs "D:\apps\DeepSeek Harness\resources\app.asar" ^
//     "dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/index.js" "installBundle" 4
//
// Exits 0 even when nothing matches; prints "NO MATCH" so callers can tell.
// ASCII-only source on purpose (Windows PowerShell 5.1 friendly).
import fs from 'node:fs';

const [archivePath, entryPath, pattern, contextArg, maxArg] = process.argv.slice(2);
if (!archivePath || !entryPath || !pattern) {
  console.error('usage: node asar-grep.mjs <archive.asar> <entryPath> <regex> [contextLines=3] [maxHits=40]');
  process.exit(2);
}
const context = contextArg ? Number(contextArg) : 3;
const maxHits = maxArg ? Number(maxArg) : 40;

function openArchive(file) {
  const fd = fs.openSync(file, 'r');
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, 0);
  const headerSize = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(headerSize);
  fs.readSync(fd, headerBuf, 0, headerSize, 8);
  const jsonLen = headerBuf.readUInt32LE(4);
  const json = headerBuf.toString('utf8', 8, 8 + jsonLen);
  return { fd, header: JSON.parse(json), contentOffset: 8 + headerSize };
}

function findEntry(node, prefix, wanted) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (entry.files) {
      const hit = findEntry(entry, p, wanted);
      if (hit) return hit;
    } else if (p === wanted) {
      return entry;
    }
  }
  return null;
}

const archive = openArchive(archivePath);
const entry = findEntry(archive.header, '', entryPath);
if (!entry) {
  console.error('entry not found: ' + entryPath);
  process.exit(1);
}
if (entry.unpacked) {
  console.error('entry is unpacked, read it from disk instead');
  process.exit(3);
}
const buf = Buffer.alloc(entry.size);
fs.readSync(archive.fd, buf, 0, entry.size, archive.contentOffset + Number(entry.offset));
fs.closeSync(archive.fd);

const lines = buf.toString('utf8').split(/\r?\n/);
const re = new RegExp(pattern);
const hits = [];
for (let i = 0; i < lines.length; i++) {
  if (re.test(lines[i])) hits.push(i);
}
if (hits.length === 0) {
  console.log('NO MATCH for /' + pattern + '/ in ' + entryPath + ' (' + lines.length + ' lines)');
  process.exit(0);
}
console.log('# ' + hits.length + ' hits in ' + entryPath + ' (' + lines.length + ' lines)');
const shown = hits.slice(0, maxHits);
for (const hit of shown) {
  console.log('');
  console.log('--- line ' + (hit + 1) + ' ---');
  const from = Math.max(0, hit - context);
  const to = Math.min(lines.length - 1, hit + context);
  for (let i = from; i <= to; i++) {
    const marker = i === hit ? '>' : ' ';
    console.log(marker + String(i + 1).padStart(6) + ': ' + lines[i]);
  }
}
if (hits.length > shown.length) {
  console.log('');
  console.log('... ' + (hits.length - shown.length) + ' more hits not shown (raise maxHits)');
}
