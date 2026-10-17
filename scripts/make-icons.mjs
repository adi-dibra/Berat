// Generates the extension icons (public/icons/*.png) without any image tooling:
// a rounded blue square with three stacked "group" bars, rendered with 4x4
// supersampling and written as PNG via node:zlib.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

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

export function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};

// Shapes in a 0..1 coordinate space, painted in order.
const SHAPES = [
  { rect: [0.04, 0.04, 0.96, 0.96], r: 0.2, color: [26, 115, 232] },
  { rect: [0.2, 0.22, 0.8, 0.36], r: 0.07, color: [255, 255, 255] },
  { rect: [0.2, 0.43, 0.66, 0.57], r: 0.07, color: [210, 227, 252] },
  { rect: [0.2, 0.64, 0.52, 0.78], r: 0.07, color: [174, 203, 250] },
];

export function renderIcon(size) {
  const S = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const x = (px + (sx + 0.5) / S) / size;
          const y = (py + (sy + 0.5) / S) / size;
          let col = null;
          for (const s of SHAPES) if (inRoundRect(x, y, ...s.rect, s.r)) col = s.color;
          if (col) { r += col[0]; g += col[1]; b += col[2]; a += 1; }
        }
      }
      const i = (py * size + px) * 4;
      const n = S * S;
      buf[i] = a ? r / a : 0;
      buf[i + 1] = a ? g / a : 0;
      buf[i + 2] = a ? b / a : 0;
      buf[i + 3] = Math.round((a / n) * 255);
    }
  }
  return png(size, size, buf);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('make-icons.mjs')) {
  mkdirSync('public/icons', { recursive: true });
  for (const size of [16, 32, 48, 128]) writeFileSync(`public/icons/icon${size}.png`, renderIcon(size));
  mkdirSync('store', { recursive: true });
  writeFileSync('store/icon-128.png', renderIcon(128));
  console.log('icons written');
}
