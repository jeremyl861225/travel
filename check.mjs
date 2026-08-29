#!/usr/bin/env node
/* 這支 app 沒有建置步驟，語法錯誤不會在任何地方被攔下來——
   只會在瀏覽器變成一片空白加上 Unexpected end of input。
   交付前一定要跑過：node check.mjs
   檢查：每個 <script> 的語法、括號從哪一行開始沒收、$('#id') 指到的元素是否存在、
   以及被呼叫但沒有定義的函式。 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const file = process.argv[2] || 'index.html';
const html = readFileSync(file, 'utf8');
let bad = 0;

/* 把字串、樣板字串、註解、正規表達式字面值換成等長的空白。
   少了這一步，'/[&<>"]/g' 裡的引號會被當成字串開頭，後面全錯。 */
function strip(code) {
  const out = code.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0, prev = '';
  while (i < code.length) {
    const c = code[i], n = code[i + 1];
    if (c === '/' && n === '/') { let j = code.indexOf('\n', i); if (j < 0) j = code.length; blank(i, j); i = j; continue; }
    if (c === '/' && n === '*') { let j = code.indexOf('*/', i + 2); j = j < 0 ? code.length : j + 2; blank(i, j); i = j; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < code.length) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === c) break;
        j++;
      }
      blank(i, Math.min(j + 1, code.length)); i = j + 1; prev = 'x'; continue;
    }
    /* 正規表達式字面值：只有在「前一個有意義的字元不可能是運算元結尾」時才算。 */
    if (c === '/' && /[(,=:[!&|?{};+\-*%~^<>]|^$/.test(prev)) {
      let j = i + 1, cls = false, ok = false;
      while (j < code.length) {
        const d = code[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') cls = true;
        else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; break; }
        j++;
      }
      if (ok) { blank(i, j + 1); i = j + 1; prev = 'x'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
const blocks = [];
let m;
while ((m = re.exec(html))) blocks.push({ code: m[1], line: html.slice(0, m.index).split('\n').length });
console.log(`${file}: ${blocks.length} 個 script 區塊，${html.split('\n').length} 行`);

// ── 1. 語法 ───────────────────────────────────────────────
for (const b of blocks) {
  try { new vm.Script(b.code, { filename: `${file}:${b.line}` }); }
  catch (e) {
    bad++;
    console.error(`✗ 語法錯誤（區塊起於第 ${b.line} 行）: ${e.message}`);
    console.error((e.stack || '').split('\n').slice(0, 3).join('\n'));
  }
}

// ── 2. 括號：指出沒收起來的那一個開在哪一行 ───────────────
for (const b of blocks) {
  const s = strip(b.code);
  const st = [], pairs = { ')': '(', ']': '[', '}': '{' };
  let line = 1, err = null;
  for (let i = 0; i < s.length && !err; i++) {
    const c = s[i];
    if (c === '\n') { line++; continue; }
    if ('([{'.includes(c)) st.push({ c, line });
    else if (')]}'.includes(c)) {
      const t = st.pop();
      if (!t || t.c !== pairs[c]) err = `第 ${b.line + line - 1} 行多出一個 ${c}`;
    }
  }
  if (!err && st.length) { const t = st[st.length - 1]; err = `第 ${b.line + t.line - 1} 行的 ${t.c} 沒有收起來`; }
  if (err) { bad++; console.error('✗ 括號不平衡：' + err); }
}

// ── 3. $('#id') 指到的元素要存在於 HTML ───────────────────
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(x => x[1]));
const wanted = new Set();
for (const x of html.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) wanted.add(x[1]);
for (const x of html.matchAll(/getElementById\('([A-Za-z0-9_-]+)'\)/g)) wanted.add(x[1]);
const missing = [...wanted].filter(id => !ids.has(id));
if (missing.length) {
  bad++;
  console.error('✗ 這些 id 被 $() 找，但 HTML 裡沒有（動態插入的要確認真的會被產生）：\n   ' + missing.join(', '));
}

// ── 4. 呼叫了但沒定義的函式 ───────────────────────────────
const src = blocks.map(b => strip(b.code)).join('\n');
const defined = new Set();
const add = s => { s = s.trim(); if (/^[A-Za-z_$][\w$]*$/.test(s)) defined.add(s); };
for (const x of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\(([^()]*)\)/g)) {
  if (x[1]) add(x[1]);
  x[2].split(',').forEach(p => add(p.split('=')[0]));
}
for (const x of src.matchAll(/\(([^()]*)\)\s*=>/g)) x[1].split(',').forEach(p => add(p.split('=')[0]));
for (const x of src.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(x[1]);
/* 一句宣告多個變數（const a = 1, b = 2）時，只抓第一個會漏掉後面的，
   造成「呼叫了但找不到定義」的假警報。整段切開逐一登記。 */
for (const x of src.matchAll(/\b(?:const|let|var)\s+([^;\n]+)/g)) {
  let depth = 0, cur = '';
  for (const ch of x[1]) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (ch === ',' && depth === 0) { add(cur.split('=')[0]); cur = ''; }
    else cur += ch;
  }
  add(cur.split('=')[0]);
}
for (const x of src.matchAll(/\b(?:const|let|var)\s*[[{]([^}\]]+)[}\]]/g))
  x[1].split(',').forEach(p => add(p.split(':').pop().split('=')[0]));
for (const x of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) add(x[1]);
for (const x of src.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(x[1]);

const KEYWORDS = new Set(['if','for','while','switch','catch','return','typeof','await','new','function',
  'of','in','else','do','try','throw','case','delete','void','instanceof','yield','super','this','import','async']);
const BUILTINS = new Set(['console','Math','JSON','Object','Array','String','Number','Boolean','Date',
  'Promise','Set','Map','WeakMap','parseInt','parseFloat','isFinite','isNaN','encodeURIComponent',
  'decodeURIComponent','btoa','atob','setTimeout','clearTimeout','setInterval','clearInterval','fetch',
  'alert','confirm','prompt','requestAnimationFrame','matchMedia','addEventListener','removeEventListener',
  'indexedDB','visualViewport','crypto','Uint8Array','TextEncoder','TextDecoder','Error','RegExp','document','window',
  'Blob','File','FileReader','URL','Image','FormData','AbortController','performance',
  'navigator','localStorage','structuredClone','queueMicrotask','getComputedStyle']);
const called = new Set();
for (const x of src.matchAll(/(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(x[1]);
const undef = [...called].filter(f => !defined.has(f) && !KEYWORDS.has(f) && !BUILTINS.has(f));
if (undef.length) { bad++; console.error('✗ 呼叫了但找不到定義：' + undef.join(', ')); }

console.log(bad ? `\n✗ ${bad} 個問題` : '\n✓ 通過');
process.exit(bad ? 1 : 0);
