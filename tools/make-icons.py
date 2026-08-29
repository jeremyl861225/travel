#!/usr/bin/env python3
"""產生 PWA 圖示：大阪城線稿放在灰底上。

比例照 Clinical-Tools 那套（實測值，不是猜的）：
  一般圖示    圖案佔畫布 57.8%，四邊各留 21.1%
  maskable    圖案佔畫布 35.9%，四邊各留 32.0%（maskable 的安全區是內圈 80%，
              系統會裁掉外圈，留白不夠就會被切到）
底色沿用來源圖的 #EEEEEE，與 Clinical-Tools 完全一致。

用法：python3 tools/make-icons.py
"""
from PIL import Image
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'osaka-castle.png'
BG = (238, 238, 238, 255)

# (檔名, 邊長, 圖案佔畫布比例)
TARGETS = [
    ('icon-192.png',     192, 0.578),
    ('icon-512.png',     512, 0.578),
    ('maskable-512.png', 512, 0.359),
    ('apple-touch-icon.png', 180, 0.578),   # iOS 主畫面用，不吃透明、圓角由系統加
]


def glyph(src: Image.Image) -> Image.Image:
    """裁出線稿本身的外框，去掉來源圖自帶的留白。"""
    px = src.load()
    w, h = src.size
    bg = px[4, 4]

    def ink(q):
        return abs(q[0] - bg[0]) + abs(q[1] - bg[1]) + abs(q[2] - bg[2]) > 40 and q[3] > 20

    xs, ys = [], []
    for y in range(h):
        for x in range(w):
            if ink(px[x, y]):
                xs.append(x)
                ys.append(y)
    return src.crop((min(xs), min(ys), max(xs) + 1, max(ys) + 1))


def main():
    src = Image.open(SRC).convert('RGBA')
    g = glyph(src)
    gw, gh = g.size
    print(f'來源 {src.size[0]}x{src.size[1]}，線稿外框 {gw}x{gh}')

    for name, size, ratio in TARGETS:
        # 以長邊對齊目標比例，短邊等比縮放，圖案才不會被拉扁
        target = int(round(size * ratio))
        scale = target / max(gw, gh)
        nw, nh = max(1, int(round(gw * scale))), max(1, int(round(gh * scale)))
        # LANCZOS 對細線稿最不會糊；用 NEAREST 會讓斜屋簷長出鋸齒
        small = g.resize((nw, nh), Image.LANCZOS)

        canvas = Image.new('RGBA', (size, size), BG)
        canvas.paste(small, ((size - nw) // 2, (size - nh) // 2), small)
        # PNG 不需要 alpha，iOS 的 apple-touch-icon 也不吃透明
        canvas.convert('RGB').save(ROOT / name, 'PNG', optimize=True)
        print(f'  {name}  {size}x{size}  圖案 {nw}x{nh}（佔 {max(nw,nh)/size:.1%}）')


if __name__ == '__main__':
    main()
