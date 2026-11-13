"""Build native assets from the locally installed preset; no web runtime needed.

Build-only dependencies: fonttools, brotli, Node and the original npm packages.
The generated TTF, SVG, licenses and palette are bundled in the Qt application.
"""
import json
import math
import re
import shutil
import subprocess
from pathlib import Path
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "qt/casepilot/assets"
ASSETS.mkdir(exist_ok=True)
(ASSETS / "icons").mkdir(exist_ok=True)

def rgb(value):
    values = re.search(r"oklch\(([^)]+)\)", value).group(1).split()
    lightness, chroma, hue = map(float, values[:3])
    a = chroma * math.cos(math.radians(hue))
    b = chroma * math.sin(math.radians(hue))
    l = (lightness + .3963377774*a + .2158037573*b)**3
    m = (lightness - .1055613458*a - .0638541728*b)**3
    s = (lightness - .0894841775*a - 1.2914855480*b)**3
    linear = (4.0767416621*l - 3.3077115913*m + .2309699292*s,
              -1.2684380046*l + 2.6097574011*m - .3413193965*s,
              -.0041960863*l - .7034186147*m + 1.7076147010*s)
    channels = [round(255*max(0, min(1, 12.92*x if x <= .0031308 else 1.055*x**(1/2.4)-.055))) for x in linear]
    return "#" + "".join(f"{x:02x}" for x in channels)

source = (ROOT / "src/shadcn.css").read_text()
palette = {}
for name, selector in (("light", ":root"), ("dark", ".dark")):
    block = re.search(re.escape(selector) + r"\s*\{([^}]+)\}", source).group(1)
    palette[name] = {}
    for key, value in re.findall(r"--([\w-]+):\s*(oklch\([^;]+);", block):
        if "/" in value:
            # Composite translucent borders over the native card background.
            opacity = float(re.search(r"/\s*(\d+)%", value).group(1)) / 100
            background = palette[name]["card"]
            channels = [round(int(background[i:i+2], 16)*(1-opacity) + 255*opacity) for i in (1, 3, 5)]
            palette[name][key] = "#" + "".join(f"{x:02x}" for x in channels)
        else:
            palette[name][key] = rgb(value)
preset = json.loads((ROOT / "artifacts/shadcn-preset-2026-10-14/preset.json").read_text())
preset.update(palette=palette, rtl=True, pointer=True, source="https://ui.shadcn.com/create?preset=bKsI1x32")
(ASSETS / "preset.json").write_text(json.dumps(preset, indent=2) + "\n")
font = TTFont(ROOT / "node_modules/@fontsource-variable/inter/files/inter-latin-opsz-normal.woff2")
font.flavor = None
font.save(ASSETS / "Inter.ttf")
shutil.copyfile(ROOT / "node_modules/@fontsource-variable/inter/LICENSE", ASSETS / "Inter-LICENSE.txt")
shutil.copyfile(ROOT / "node_modules/lucide-react/LICENSE", ASSETS / "Lucide-LICENSE.txt")
names = ["layout-dashboard", "users", "zap", "package-open", "repeat-2", "backpack", "gamepad-2", "gift", "network", "sliders-horizontal", "stethoscope", "settings", "activity", "gauge", "boxes", "arrow-right-left", "package", "coins", "map", "settings-2", "scan-line", "sun", "moon"]
script = """
const fs=require('fs'),vm=require('vm');
const result={};
for(const name of JSON.parse(process.argv[1])) {
 const source=fs.readFileSync('node_modules/lucide-react/dist/esm/icons/'+name+'.mjs','utf8');
 const data=source.match(/const __iconData = ([\\s\\S]+?);\\n__iconData/)[1];
 result[name]=vm.runInNewContext('('+data+')');
}
process.stdout.write(JSON.stringify(result));
"""
icons = json.loads(subprocess.check_output(["node", "-e", script, json.dumps(names)], cwd=ROOT))
from xml.sax.saxutils import quoteattr
for name, icon in icons.items():
    nodes = "".join("<"+tag+" "+" ".join(key+"="+quoteattr(str(value)) for key, value in attrs.items() if key != "key")+"/>" for tag, attrs in icon["node"])
    (ASSETS / "icons" / (name + ".svg")).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+nodes+'</svg>\n')
print("Native preset assets: Inter, 13 Lucide icons, light/dark palette, licenses")
