/* 把 colormind 抓回來的 60 色依色系分群，每群補到 15 色。
   為什麼要 OKLab：RGB 的距離跟眼睛看到的差距對不起來——深藍與黑在 RGB 上很遠，
   看起來卻很像；黃與綠在 RGB 上很近，看起來卻分得很開。分頁鐵存在的意義就是
   一眼看出今天是哪一天，所以整份程式的距離一律在 OKLab 裡算。 */
import { readFileSync, writeFileSync } from 'node:fs';

const RAW = JSON.parse(readFileSync(new URL('../docs/refs/colormind-raw.json', import.meta.url)));
const K = 4;                 // 分幾群
const TARGET = 15;           // 每群幾色 = 十五天內不重複
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── 色彩空間 ──────────────────────────────────────────────
const hex2rgb = h => [1,3,5].map(i => parseInt(h.slice(i, i+2), 16));
const rgb2hex = c => '#' + c.map(v => Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('').toUpperCase();
const srgb2lin = c => { c /= 255; return c <= 0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); };
function oklab(hex) {
  const [r,g,b] = hex2rgb(hex).map(srgb2lin);
  const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b);
  const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b);
  const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b);
  return [ 0.2104542553*l + 0.7936177850*m - 0.0040720468*s,
           1.9779984951*l - 2.4285922050*m + 0.4505937099*s,
           0.0259040371*l + 0.7827717662*m - 0.8086757660*s ];
}
const dE = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const relLum = hex => { const [r,g,b] = hex2rgb(hex).map(srgb2lin);
  return 0.2126*r + 0.7152*g + 0.0722*b; };
const contrast = (a, b) => { const l1 = relLum(a), l2 = relLum(b);
  return (Math.max(l1,l2) + 0.05) / (Math.min(l1,l2) + 0.05); };

// ── 分群：k-means++ 起始，避免隨機起點把兩個明顯不同的家族併在一起 ──
function kmeans(items, k, iters = 60) {
  const pts = items.map(h => oklab(h));
  const centers = [pts[0]];
  while (centers.length < k) {
    // 每次挑「離現有所有中心最遠」的那一點當新中心
    let best = -1, bestD = -1;
    pts.forEach((p, i) => {
      const d = Math.min(...centers.map(c => dE(p, c)));
      if (d > bestD) { bestD = d; best = i; }
    });
    centers.push(pts[best]);
  }
  let assign = new Array(pts.length).fill(0);
  for (let it = 0; it < iters; it++) {
    let moved = false;
    pts.forEach((p, i) => {
      let bi = 0, bd = Infinity;
      centers.forEach((c, ci) => { const d = dE(p, c); if (d < bd) { bd = d; bi = ci; } });
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
    });
    for (let ci = 0; ci < k; ci++) {
      const mem = pts.filter((_, i) => assign[i] === ci);
      if (!mem.length) continue;
      centers[ci] = [0,1,2].map(d => mem.reduce((s, p) => s + p[d], 0) / mem.length);
    }
    if (!moved) break;
  }
  return { assign, centers };
}

// ── 補色：回同一個 model、鎖住群內一色再抓，讓補進來的留在同一個家族 ──
async function fetchLocked(model, lockHex) {
  const body = lockHex ? { model, input: [hex2rgb(lockHex), 'N','N','N','N'] } : { model };
  const r = await fetch('http://colormind.io/api/', { method:'POST', body: JSON.stringify(body) });
  if (!r.ok) throw new Error('colormind ' + r.status);
  return (await r.json()).result.map(rgb2hex);
}

// ── 群超過 15 色時，挑「彼此最分得開」的 15 個，而不是砍掉後面幾個 ──
function pick(list, n) {
  if (list.length <= n) return list.slice();
  const lab = new Map(list.map(h => [h, oklab(h)]));
  const chroma = h => Math.hypot(lab.get(h)[1], lab.get(h)[2]);
  const out = [list.slice().sort((a,b) => chroma(b) - chroma(a))[0]];
  const rest = list.filter(h => h !== out[0]);
  while (out.length < n) {
    let bi = 0, bd = -1;
    rest.forEach((h, i) => {
      const d = Math.min(...out.map(o => dE(lab.get(h), lab.get(o))));
      if (d > bd) { bd = d; bi = i; }
    });
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

// ── 群內重排：相鄰兩天的感知距離要最大 ──
function spread(list) {
  // 從彩度最高的那一色起頭，之後每次挑「離上一色最遠、且離已排入者不要太近」的
  const lab = new Map(list.map(h => [h, oklab(h)]));
  const chroma = h => Math.hypot(lab.get(h)[1], lab.get(h)[2]);
  const out = [list.slice().sort((a,b) => chroma(b) - chroma(a))[0]];
  const rest = list.filter(h => h !== out[0]);
  while (rest.length) {
    let bi = 0, bs = -1;
    rest.forEach((h, i) => {
      const prev = dE(lab.get(h), lab.get(out[out.length-1]));
      // 主要看跟前一色的距離，順帶避開兩色之前那一個，避免 A B A B 來回跳
      const prev2 = out.length > 1 ? dE(lab.get(h), lab.get(out[out.length-2])) : 1;
      const score = prev + 0.35 * prev2;
      if (score > bs) { bs = score; bi = i; }
    });
    out.push(rest.splice(bi, 1)[0]);
  }
  return out;
}

// ── 主流程 ────────────────────────────────────────────────
const all = [];
for (const p of RAW.palettes) for (const h of p.hues) all.push({ hex: h, model: p.model });
const uniq = [];
for (const c of all) if (!uniq.some(u => u.hex === c.hex)) uniq.push(c);
console.log('原料 ' + all.length + ' 色，去掉完全重複後 ' + uniq.length + ' 色');

const { assign } = kmeans(uniq.map(c => c.hex), K);
const groups = Array.from({ length: K }, () => ({ colors: [], models: new Map() }));
uniq.forEach((c, i) => {
  const g = groups[assign[i]];
  g.colors.push(c.hex);
  g.models.set(c.model, (g.models.get(c.model) || 0) + 1);
});
groups.forEach((g, i) => console.log('  群 ' + (i+1) + '：' + g.colors.length + ' 色，來源 ' +
  [...g.models.entries()].sort((a,b) => b[1]-a[1]).map(([m,n]) => m + '×' + n).join(' ')));

// 補到 15
for (const [gi, g] of groups.entries()) {
  const center = [0,1,2].map(d => g.colors.reduce((s,h) => s + oklab(h)[d], 0) / g.colors.length);
  const models = [...g.models.entries()].sort((a,b) => b[1]-a[1]).map(([m]) => m);
  let tries = 0;
  while (g.colors.length < TARGET && tries < 90) {
    tries++;
    const model = models[tries % models.length];
    const lock = g.colors[Math.floor(tries * 7 % g.colors.length)];
    let got;
    try { got = await fetchLocked(model, lock); } catch (e) { await sleep(800); continue; }
    for (const h of got) {
      if (g.colors.length >= TARGET) break;
      if (groups.some(x => x.colors.includes(h))) continue;      // 別的群已經有了
      // 差一個位元的顏色是同一個顏色。這不是品味過濾，是去重複——
      // 不擋的話會出現 #8A8071 與 #8B8071 排在相鄰兩天，那兩天就分不出來了。
      if (groups.some(x => x.colors.some(e => dE(oklab(e), oklab(h)) < 0.02))) continue;
      const d = dE(oklab(h), center);
      // 門檻先嚴後鬆：抓不夠就慢慢放寬，總比湊不滿或自己生成好
      const limit = 0.18 + Math.min(0.22, tries * 0.004);
      if (d > limit) continue;
      g.colors.push(h);
    }
    await sleep(330);
  }
  console.log('群 ' + (gi+1) + ' 補到 ' + g.colors.length + ' 色（' + tries + ' 次請求）');
}

// 重排 + 命名 + 檢查
const VERMILION = '#D62D14';
const out = groups.map((g, i) => {
  const kept = pick(g.colors, TARGET);
  const dropped = g.colors.filter(h => !kept.includes(h));
  const colors = spread(kept);
  const labs = colors.map(oklab);
  const meanL = labs.reduce((s,p) => s + p[0], 0) / labs.length;
  const meanC = labs.reduce((s,p) => s + Math.hypot(p[1], p[2]), 0) / labs.length;
  let minAdj = Infinity;
  for (let k = 1; k < labs.length; k++) minAdj = Math.min(minAdj, dE(labs[k-1], labs[k]));
  const clash = colors.filter(h => dE(oklab(h), oklab(VERMILION)) < 0.10);
  const dim = colors.filter(h => Math.max(contrast(h, '#FFFFFF'), contrast(h, '#101010')) < 4.5);
  return { group: i + 1, count: colors.length, colors, dropped,
    models: [...g.models.keys()],
    meanLightness: +meanL.toFixed(3), meanChroma: +meanC.toFixed(3),
    minAdjacentDistance: +minAdj.toFixed(3),
    clashWithErrata: clash, lowContrastForButtonText: dim };
});
writeFileSync(new URL('../docs/refs/colormind-groups.json', import.meta.url),
  JSON.stringify({ note: '由 tools/group-palettes.mjs 從 colormind-raw.json 分群後補到 15 色。順序已重排成相鄰感知距離最大。',
    space: 'OKLab', target: TARGET, groups: out }, null, 1));
console.log('\n' + out.map(g => '群 ' + g.group + '  L=' + g.meanLightness + ' C=' + g.meanChroma +
  (g.dropped.length ? '  （這一群原本 ' + (15 + g.dropped.length) + ' 色，捨掉最像的 ' +
    g.dropped.length + ' 個：' + g.dropped.join(',') + '）' : '') +
  ' 相鄰最小距離=' + g.minAdjacentDistance +
  (g.clashWithErrata.length ? '  ⚠撞勘誤紅 ' + g.clashWithErrata.join(',') : '') +
  (g.lowContrastForButtonText.length ? '  ⚠按鈕字對比不足 ' + g.lowContrastForButtonText.length + ' 色' : '') +
  '\n   ' + g.colors.join(' ')).join('\n'));
