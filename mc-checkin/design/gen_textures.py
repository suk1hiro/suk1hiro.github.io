import base64
import random
import re
import sys
from pathlib import Path


def svg(inner, size=16):
    return (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='{size}' height='{size}' "
        f"shape-rendering='crispEdges'>{inner}</svg>"
    )


def uri(inner):
    return 'url("data:image/svg+xml;base64,' + base64.b64encode(svg(inner).encode()).decode() + '")'


def noise(base, light, dark, seed, density=0.2, extra=""):
    rnd = random.Random(seed)
    parts = [f"<rect width='16' height='16' fill='{base}'/>"]
    for y in range(16):
        for x in range(16):
            r = rnd.random()
            if r < density:
                c = dark if rnd.random() < 0.55 else light
                parts.append(f"<rect x='{x}' y='{y}' width='1' height='1' fill='{c}'/>")
    return uri("".join(parts) + extra)


textures = {}

textures["deepslate"] = noise("#191713", "#24211c", "#12100d", 11, 0.22)
textures["stone"] = noise("#2b2822", "#38342c", "#211e19", 22, 0.2)
textures["paper"] = noise("#efe6d2", "#f7f0df", "#e4d8c0", 66, 0.16)

plank_rows = []
for row in range(4):
    y = row * 4
    plank_rows.append(f"<rect x='0' y='{y}' width='16' height='1' fill='#7b5733'/>")
    plank_rows.append(f"<rect x='0' y='{y + 3}' width='16' height='1' fill='#3c2917'/>")
    seam = 3 if row % 2 == 0 else 11
    plank_rows.append(f"<rect x='{seam}' y='{y}' width='1' height='3' fill='#3c2917'/>")
textures["planks"] = noise("#5f4226", "#745232", "#4b321c", 33, 0.14, "".join(plank_rows))

textures["dirt"] = noise("#4a3524", "#5a4230", "#382718", 44, 0.26)

css_vars = ":root {\n" + "".join(
    f"  --tex-{name}: {value};\n" for name, value in textures.items()
) + "}\n"

out = Path(__file__).resolve().parent / "texture-vars.css"
out.write_text(css_vars, encoding="utf-8")
print("wrote", out, len(css_vars), "bytes")
for name in textures:
    print(name, "ok")

# optional injection into ../styles.css marker
styles = Path(__file__).resolve().parent.parent / "styles.css"
if styles.exists():
    text = styles.read_text(encoding="utf-8")
    marker = "/*__TEXTURES__*/"
    if marker in text:
        text = text.replace(marker, css_vars.strip())
        styles.write_text(text, encoding="utf-8")
        print("injected textures into", styles)
