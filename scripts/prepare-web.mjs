import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).map((name) => '/assets/' + name);
const version = createHash('sha256').update(assets.join('\n')).digest('hex').slice(0, 12);
let sw = await readFile('dist/sw.js', 'utf8');
sw =
  `self.__WIND_PRECACHE = ${JSON.stringify(['/', '/wind.svg', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', ...assets])};\n` +
  sw.replace('wind-shell-v1', `wind-shell-${version}`);
await writeFile('dist/sw.js', sw);
