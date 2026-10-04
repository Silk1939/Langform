import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = paint(x, y, size);
      const offset = row + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function insideRound(x, y, size, radius) {
  const dx = x < radius ? radius - x : x > size - radius ? x - (size - radius) : 0;
  const dy = y < radius ? radius - y : y > size - radius ? y - (size - radius) : 0;
  return dx * dx + dy * dy <= radius * radius;
}

function icon(size, pad) {
  return png(size, (x, y) => {
    if (!insideRound(x, y, size, size * 0.18)) return [0, 0, 0, 0];
    const ink = [20, 17, 14, 255];
    const gold = [228, 177, 90, 255];
    const copper = [140, 90, 50, 255];
    const left = size * pad;
    const right = size * (1 - pad);
    const top = size * 0.34;
    const bottom = size * 0.66;
    const frame = (index) => {
      const gap = (right - left) / 3;
      const x0 = left + index * gap + size * 0.015;
      const x1 = left + (index + 1) * gap - size * 0.015;
      return x >= x0 && x <= x1 && y >= top && y <= bottom;
    };
    const border =
      (frame(0) || frame(1) || frame(2)) &&
      !(
        y > top + size * 0.025 &&
        y < bottom - size * 0.025 &&
        [0, 1, 2].some((index) => {
          const gap = (right - left) / 3;
          const x0 = left + index * gap + size * 0.04;
          const x1 = left + (index + 1) * gap - size * 0.04;
          return x > x0 && x < x1;
        })
      );
    if (border) return gold;
    if (y >= top - size * 0.035 && y <= top - size * 0.02 && x >= left && x <= right) return copper;
    if (y >= bottom + size * 0.02 && y <= bottom + size * 0.035 && x >= left && x <= right) return copper;
    return ink;
  });
}

const targets = [
  ["public/icons/icon-192.png", 192, 0.16],
  ["public/icons/icon-512.png", 512, 0.16],
  ["public/icons/apple-touch-icon.png", 180, 0.16],
  ["public/icons/maskable-512.png", 512, 0.28],
  ["src/app/icon.png", 512, 0.16],
  ["src/app/apple-icon.png", 180, 0.16],
];

for (const [file, size, pad] of targets) {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, icon(size, pad));
}
