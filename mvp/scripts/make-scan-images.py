"""Draws the four test photos for scripts/qa-scan.ts into eval/scan/ (invented packs, no real brands).
Run: python scripts/make-scan-images.py   (needs Pillow)"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

out = Path(__file__).resolve().parent.parent / "eval" / "scan"
out.mkdir(parents=True, exist_ok=True)


def font(size, bold=False):
    try:
        return ImageFont.truetype("arialbd.ttf" if bold else "arial.ttf", size)
    except OSError:
        return ImageFont.load_default()


def pack(lines, name):
    im = Image.new("RGB", (600, 800), (250, 236, 210))
    d = ImageDraw.Draw(im)
    d.rectangle([30, 30, 570, 770], outline=(120, 60, 20), width=8)
    y = 90
    for i, t in enumerate(lines):
        d.text((60, y), t, fill=(90, 30, 10), font=font(64 if i == 0 else 44, bold=i == 0))
        y += 110 if i == 0 else 80
    im.save(out / name, "JPEG", quality=85)


pack(["Purrfect Bowl", "Cat food", "Chicken in gravy", "ADULT 1+ years", "85 g pouch"], "chicken.jpg")
pack(["Purrfect Bowl", "Cat food", "Salmon in gravy", "ADULT 1+ years", "85 g pouch"], "salmon.jpg")

land = Image.new("RGB", (800, 600), (135, 190, 235))
d = ImageDraw.Draw(land)
d.rectangle([0, 380, 800, 600], fill=(70, 140, 60))
d.polygon([(100, 380), (300, 150), (500, 380)], fill=(110, 110, 120))
d.ellipse([620, 60, 720, 160], fill=(250, 220, 80))
land.save(out / "landscape.jpg", "JPEG", quality=85)

Image.new("RGB", (600, 800), (255, 255, 255)).save(out / "blank.jpg", "JPEG", quality=85)
print("wrote", sorted(p.name for p in out.iterdir()))
