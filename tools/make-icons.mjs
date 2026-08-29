/* 產生 PWA 圖示。本機沒有 SVG 轉檔工具，所以直接畫像素再自己編碼 PNG
   （Node 內建 zlib 就夠，不必裝任何東西）。圖案是這支 app 的世界本身：
   一片飽和色的分頁板、右緣的階梯分頁鐵、板上浮著一頁打了孔的賽璐珞。 */
import { writeFileSync } from 'node:fs';
import zlib from 'node:zlib';

const HUES = ['#D2571C','#E0A70B','#3F8F3A','#0E7A78','#1F45A8','#6B3FA0','#8E4A24'];
const BOARD = '#0E7A78', LEAF = '#E9EFEC', INK = '#15171B';
const hex = h => [1,3,5].map(i => parseInt(h.substr(i,2),16));

function crc32(buf) {
  let c, t = crc32.t;
  if (!t) { t = crc32.t = []; for (let n=0;n<256;n++){ c=n; for(let k=0;k<8;k++) c = c&1 ? 0xEDB88320^(c>>>1) : c>>>1; t[n]=c>>>0; } }
  let crc = 0xFFFFFFFF;
  for (let i=0;i<buf.length;i++) crc = t[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level:9 })), chunk('IEND', Buffer.alloc(0))]);
}

function draw(size, pad) {
  const buf = Buffer.alloc(size * size * 3);
  const put = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3; buf[i] = c[0]; buf[i+1] = c[1]; buf[i+2] = c[2];
  };
  const rect = (x0, y0, x1, y1, c) => {
    for (let y = Math.round(y0); y < Math.round(y1); y++)
      for (let x = Math.round(x0); x < Math.round(x1); x++) put(x, y, c);
  };
  const disc = (cx, cy, r, c) => {
    for (let y = Math.round(cy - r); y <= cy + r; y++)
      for (let x = Math.round(cx - r); x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(x, y, c);
  };
  const S = size, m = pad;                       // m = maskable 的安全留白
  rect(0, 0, S, S, hex(BOARD));                  // 分頁板

  // 右緣的階梯分頁鐵：一格一個色階
  const railW = S * 0.115, tabs = 6;
  const top = m, bot = S - m, th = (bot - top) / tabs;
  for (let i = 0; i < tabs; i++) {
    const hue = HUES[(i + 4) % HUES.length];
    rect(S - m - railW, top + i * th + 1, S - m, top + (i + 1) * th - 1, hex(hue));
  }

  // 抬起一毫米的賽璐珞頁：一道不模糊的硬影，然後是頁本身
  const lx0 = m + S * 0.06, ly0 = m + S * 0.10, lx1 = S - m - railW - S * 0.05, ly1 = S - m - S * 0.10;
  const off = S * 0.022;
  rect(lx0 + off, ly0 + off, lx1 + off, ly1 + off, [11, 58, 57]);
  rect(lx0, ly0, lx1, ly1, hex(LEAF));

  // 頁上的機器語：兩條粗規線代表時刻，兩條細規線代表內文
  const bx = lx0 + S * 0.055;
  rect(bx, ly0 + S * 0.10, bx + S * 0.20, ly0 + S * 0.155, hex(INK));
  rect(bx, ly0 + S * 0.20, lx1 - S * 0.055, ly0 + S * 0.225, [120, 126, 132]);
  rect(bx, ly0 + S * 0.26, lx1 - S * 0.13,  ly0 + S * 0.285, [120, 126, 132]);

  // 選取＝打孔：孔裡看得到板色
  disc(lx1 - S * 0.085, ly1 - S * 0.085, S * 0.045, hex(BOARD));
  return png(S, S, buf);
}

writeFileSync(new URL('../icon-192.png', import.meta.url), draw(192, 8));
writeFileSync(new URL('../icon-512.png', import.meta.url), draw(512, 20));
writeFileSync(new URL('../maskable-512.png', import.meta.url), draw(512, 62));
console.log('icons written');
