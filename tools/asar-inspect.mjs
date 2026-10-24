// Minimal Electron ASAR archive reader (header + file extraction), no deps.
// Usage:
//   node asar-inspect.mjs list <archive> [pattern]
//   node asar-inspect.mjs read <archive> <entryPath>
//   node asar-inspect.mjs extract <archive> <pathPrefix> <outDir>
import fs from 'node:fs';
import path from 'node:path';

const ASAR = process.argv[3];
if (!ASAR) {
  console.error('usage: node asar-inspect.mjs <list|read|extract> <archive> [arg...]');
  process.exit(2);
}

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

function walk(node, prefix, out) {
  for (const [name, entry] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (entry.files) walk(entry, p, out);
    else out.push({ path: p, size: entry.size, offset: entry.offset, unpacked: !!entry.unpacked });
  }
  return out;
}

const mode = process.argv[2];
const archive = openArchive(ASAR);
const entries = walk(archive.header, '', []);

function readEntry(hit) {
  if (hit.unpacked) return null;
  const buf = Buffer.alloc(hit.size);
  fs.readSync(archive.fd, buf, 0, hit.size, archive.contentOffset + Number(hit.offset));
  return buf;
}

if (mode === 'list') {
  const pattern = process.argv[4] ? new RegExp(process.argv[4], 'i') : null;
  const hits = entries.filter((e) => !pattern || pattern.test(e.path));
  hits.forEach((e) => console.log(`${String(e.size).padStart(9)} ${e.unpacked ? 'U' : ' '} ${e.path}`));
  console.error(`# ${hits.length}/${entries.length} entries in ${ASAR}`);
} else if (mode === 'read') {
  const hit = entries.find((e) => e.path === process.argv[4]);
  if (!hit) { console.error('entry not found: ' + process.argv[4]); process.exit(1); }
  const buf = readEntry(hit);
  if (!buf) { console.error('# unpacked entry'); process.exit(3); }
  process.stdout.write(buf);
} else if (mode === 'extract') {
  const prefix = (process.argv[4] || '').replace(/\/+$/, '');
  const outDir = process.argv[5];
  const hits = entries.filter((e) => e.path === prefix || e.path.startsWith(prefix + '/'));
  let n = 0;
  for (const hit of hits) {
    const buf = readEntry(hit);
    if (!buf) continue;
    const rel = prefix ? hit.path.slice(prefix.length + 1) : hit.path;
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, buf);
    n++;
  }
  console.error(`# extracted ${n} files to ${outDir}`);
}
fs.closeSync(archive.fd);
