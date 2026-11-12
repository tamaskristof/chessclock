import { deflateSync, crc32 } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const BG = [17, 17, 17, 255];
const WEDGE = [136, 136, 136, 255];
const PLANK = [200, 135, 58, 255];

function pixel(u, v) {
  const plankCenter = 0.52 + (u - 0.5) * 0.25;
  if (u >= 0.15 && u <= 0.85 && Math.abs(v - plankCenter) <= 0.03) return PLANK;
  if (v >= 0.55 && v <= 0.8 && Math.abs(u - 0.5) <= (v - 0.55) * 0.6) return WEDGE;
  return BG;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function png(size) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      raw.set(pixel((x + 0.5) / size, (y + 0.5) / size), y * stride + 1 + x * 4);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("public", { recursive: true });
writeFileSync("public/pwa-192.png", png(192));
writeFileSync("public/pwa-512.png", png(512));
writeFileSync("public/apple-touch-icon.png", png(180));
console.log("icons written");
