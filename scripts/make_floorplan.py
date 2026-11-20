#!/usr/bin/env python3
"""Generate a realistic retail store floor plan (PNG) for the Customer Flow
demo. Layout per the scenario: ENTRANCE top-left, EXIT top-right, CHECKOUT
bottom-right, aisle shelving across the middle. 1600x1000."""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1600, 1000
BG = (245, 246, 248)        # light floor
WALL = (60, 64, 72)         # dark walls
AISLE = (214, 220, 228)     # shelving fill
AISLE_EDGE = (150, 158, 170)
DOOR = (34, 120, 80)        # green doors
CHECKOUT = (220, 120, 40)   # orange checkout
TEXT = (40, 44, 52)

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# Try to load a font; fall back to default
def font(size):
    for p in [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

f_big = font(40)
f_med = font(28)
f_sm = font(20)

# Outer walls
wt = 16
d.rectangle([0, 0, W, wt], fill=WALL)
d.rectangle([0, H - wt, W, H], fill=WALL)
d.rectangle([0, 0, wt, H], fill=WALL)
d.rectangle([W - wt, 0, W, H], fill=WALL)

# Entrances/exits (top wall) — green gaps
def door_gap(x, width):
    d.rectangle([x, 0, x + width, wt + 8], fill=DOOR)
door_gap(120, 140)   # ENTRANCE
door_gap(W - 260, 140)  # EXIT
d.text((150, wt + 16), "ENTRANCE", font=f_sm, fill=DOOR)
d.text((W - 250, wt + 16), "EXIT", font=f_sm, fill=DOOR)

# Checkout (bottom-right)
cx, cy, cw, ch = W - 420, H - 200, 360, 160
d.rectangle([cx, cy, cx + cw, cy + ch], fill=CHECKOUT)
d.text((cx + 40, cy + 55), "CHECKOUT", font=f_med, fill=(255, 255, 255))
# checkout lanes
for i in range(4):
    lx = cx + 30 + i * 80
    d.line([lx, cy + 95, lx + 50, cy + 95], fill=(255, 255, 255), width=4)

# Shelving aisles across the middle (grid of shelving blocks with gaps = aisles)
top = 150
bottom = H - 260
cols = 6
rows = 4
gx = (W - 2 * 80) / cols
gy = (bottom - top) / rows
pad_x = 26
pad_y = 40  # aisle gap
shelf_h = gy - pad_y
shelf_w = gx - pad_x
x0, y0 = 80, top
labels = ["FABRIC", "DESK", "LIGHTING", "SOFA", "TABLE", "DECOR"]
for r in range(rows):
    for c in range(cols):
        sx = x0 + c * gx
        sy = y0 + r * gy
        d.rounded_rectangle([sx, sy, sx + shelf_w, sy + shelf_h], radius=8,
                            fill=AISLE, outline=AISLE_EDGE, width=2)
# aisle labels (vertical, in the gaps)
for c in range(cols - 1):
    ax = x0 + (c + 1) * gx - 12
    d.text((ax - 4, (top + bottom) // 2), "A", font=f_sm, fill=(120, 126, 138))
# section labels on the first row of shelves
for c in range(cols):
    sx = x0 + c * gx
    sy = y0
    try:
        tw = d.textlength(labels[c], font=f_sm)
    except Exception:
        tw = len(labels[c]) * 10
    d.text((sx + (shelf_w - tw) / 2, sy + shelf_h / 2 - 12), labels[c], font=f_sm, fill=(90, 96, 108))

# Floorplan title
d.text((80, 40), "TEST FLOOR PLAN — RETAIL STORE", font=f_med, fill=TEXT)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "dist", "test_floorplan.png")
out = os.path.abspath(out)
img.save(out)
print("WROTE", out, os.path.getsize(out), "bytes")
