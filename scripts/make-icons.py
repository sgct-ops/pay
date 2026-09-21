#!/usr/bin/env python3
"""
Draws the CarbonTree Payout Desk app icons.

Kept in the repo rather than checked in as opaque PNGs so the mark can be
regenerated at any size: python3 scripts/make-icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw

SPRUCE = (47, 107, 79)
CREAM = (250, 247, 240)
SS = 4  # supersample factor, for clean edges without any AA library

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def bezier(p0, p1, p2, steps=140):
    """Quadratic Bezier, sampled into a polyline."""
    pts = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        pts.append(
            (
                u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
            )
        )
    return pts


def draw_mark(size: int, inset: float, rounded: bool) -> Image.Image:
    """One icon. `inset` keeps the leaf inside a maskable icon's safe zone."""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    if rounded:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=SPRUCE)
    else:
        d.rectangle([0, 0, s, s], fill=SPRUCE)

    # Leaf, laid out in a 0..1 box then scaled into the safe zone.
    pad = (1 - inset) / 2
    def P(x, y):
        return ((pad + x * inset) * s, (pad + y * inset) * s)

    tip = P(0.80, 0.16)
    base = P(0.22, 0.74)
    outline = bezier(base, P(0.92, 0.66), tip) + bezier(tip, P(0.30, 0.22), base)
    d.polygon(outline, fill=CREAM)

    # Midrib and stem, cut back through the leaf in the background colour.
    d.line([base, tip], fill=SPRUCE, width=int(s * 0.022 * inset))
    d.line([base, P(0.06, 0.90)], fill=CREAM, width=int(s * 0.030 * inset))

    return img.resize((size, size), Image.LANCZOS)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    draw_mark(192, 0.64, True).save(OUT / "icon-192.png")
    draw_mark(512, 0.64, True).save(OUT / "icon-512.png")
    # Maskable icons get cropped to a circle on some launchers: fill the whole
    # square and keep the mark inside the middle 60%.
    draw_mark(512, 0.52, False).save(OUT / "maskable-512.png")
    draw_mark(180, 0.64, True).save(OUT / "apple-touch-icon.png")

    favicon = draw_mark(64, 0.68, True)
    favicon.save(OUT.parent / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])

    print("wrote", ", ".join(sorted(p.name for p in OUT.iterdir())))


if __name__ == "__main__":
    main()
