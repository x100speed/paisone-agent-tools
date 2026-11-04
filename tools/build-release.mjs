import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const skill = readFileSync(new URL('../skills/paisone/SKILL.md', import.meta.url));
const cli = readFileSync(new URL('../skills/paisone/scripts/paisone.mjs', import.meta.url));
const metadata = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (metadata.version !== '0.2.0-test' || !cli.includes(Buffer.from("version: '0.2.0-test', environment: 'test'"))) throw new Error('Release version differs from CLI capabilities');

// Store files without compression so the archive is identical across Node versions.
const crc32 = data => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
};
const parts = [], central = [];
let offset = 0;
for (const [path, data] of [['paisone/SKILL.md', skill], ['paisone/scripts/paisone.mjs', cli]]) {
  const name = Buffer.from(path, 'utf8'), crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x800, 6); local.writeUInt16LE(33, 12);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  parts.push(local, name, data);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(0x314, 4); entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x800, 8); entry.writeUInt16LE(33, 14);
  entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(data.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38); entry.writeUInt32LE(offset, 42);
  central.push(entry, name); offset += local.length + name.length + data.length;
}
const directory = Buffer.concat(central), end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...parts, directory, end]);
const output = new URL('../dist/', import.meta.url);
mkdirSync(output, { recursive: true });
const files = [['paisone.mjs', cli], ['paisone-skill.zip', zip]];
for (const [name, data] of files) writeFileSync(new URL(name, output), data);
const checksums = files.map(([name, data]) => createHash('sha256').update(data).digest('hex') + '  ' + name).join('\n') + '\n';
writeFileSync(new URL('SHA256SUMS', output), checksums);
console.log(JSON.stringify({ version: metadata.version, directory: root + 'dist', files: [...files.map(([name]) => name), 'SHA256SUMS'], published: false }));
