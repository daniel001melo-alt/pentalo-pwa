// Gera os ícones PNG do PWA sem dependências externas (encoder PNG + zlib do Node).
// Desenho próprio: pentágono (5 provas) em verde-oliva sobre azul-noite.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(root, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
      raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const pentagon = (cx, cy, r) => Array.from({ length: 5 }, (_, i) => [cx + r * Math.cos(-Math.PI / 2 + (i * 2 * Math.PI) / 5), cy + r * Math.sin(-Math.PI / 2 + (i * 2 * Math.PI) / 5)]);
const inside = (pts, x, y) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

const NAVY = [11, 18, 32];
const OLIVE = [163, 196, 98];
const LIGHT = [236, 241, 233];

function icon(size, { maskable = false, rounded = true } = {}) {
  const s = size;
  const scale = maskable ? 0.62 : 0.78; // área segura de ícones maskable
  const outer = pentagon(s / 2, s / 2 + s * 0.03, (s / 2) * scale);
  const inner = pentagon(s / 2, s / 2 + s * 0.03, (s / 2) * scale * 0.62);
  const radius = rounded && !maskable ? s * 0.22 : 0;
  const SS = 4;
  return png(s, (px, py) => {
    let acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++)
      for (let sx = 0; sx < SS; sx++) {
        const x = px + (sx + 0.5) / SS;
        const y = py + (sy + 0.5) / SS;
        // fundo com cantos arredondados (o iOS aplica a própria máscara; mantemos opaco)
        let col = NAVY;
        let a = 255;
        if (radius) {
          const dx = Math.max(radius - x, 0, x - (s - radius));
          const dy = Math.max(radius - y, 0, y - (s - radius));
          if (dx * dx + dy * dy > radius * radius) a = 0;
        }
        if (inside(outer, x, y)) col = OLIVE;
        if (inside(inner, x, y)) col = NAVY;
        const d = Math.hypot(x - s / 2, y - (s / 2 + s * 0.03));
        if (d < s * 0.075 * (scale / 0.78)) col = LIGHT;
        acc = [acc[0] + col[0], acc[1] + col[1], acc[2] + col[2], acc[3] + a];
      }
    const n = SS * SS;
    return [Math.round(acc[0] / n), Math.round(acc[1] / n), Math.round(acc[2] / n), Math.round(acc[3] / n)];
  });
}

writeFileSync(join(root, 'icon-192.png'), icon(192));
writeFileSync(join(root, 'icon-512.png'), icon(512));
writeFileSync(join(root, 'icon-maskable-512.png'), icon(512, { maskable: true }));
// Apple touch icon: opaco, sem transparência (o iOS arredonda sozinho)
writeFileSync(join(root, 'apple-touch-icon.png'), icon(180, { rounded: false }));
console.log('Ícones gerados em', root);
