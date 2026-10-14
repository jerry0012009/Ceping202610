"""Optional font-asset regeneration. Runtime/build does not require Python.
Requires fonttools[woff] and official Noto CJK installed locally; SIL OFL 1.1.
The regular font covers arbitrary CJK entered text. Bold needs only authored
headings/labels; free text and names are rendered in the full regular face.
"""
from pathlib import Path
import argparse
from fontTools import subset
from fontTools.ttLib import TTFont
parser=argparse.ArgumentParser();parser.add_argument('--font-dir',default='/usr/share/fonts/opentype/noto');parser.add_argument('--license',default='/usr/share/doc/fonts-noto-cjk/copyright');args=parser.parse_args()
root=Path(__file__).resolve().parents[1];out=root/'public/fonts';out.mkdir(exist_ok=True)
corpus=''.join((root/p).read_text() for p in ['public/report-print.js','private/report-presentation.json','public/app.js'])
for weight in ['Regular','Bold']:
 dest=out/f'NotoSansCJKsc-{weight}.woff2'
 if weight=='Regular' and dest.exists():continue
 font=TTFont(Path(args.font_dir)/f'NotoSansCJK-{weight}.ttc',fontNumber=2)
 opts=subset.Options();opts.layout_features=[];opts.name_IDs=['*'];opts.name_languages=['*'];opts.recalc_timestamp=False
 s=subset.Subsetter(options=opts)
 if weight=='Regular':
  codes=[x for x in font.getBestCmap() if x<=0x052f or 0x2000<=x<=0x206f or 0x2e80<=x<=0x9fff or 0xf900<=x<=0xfaff or 0xfe00<=x<=0xffef or 0x20000<=x<=0x2ffff]
 else:codes=set(map(ord,corpus))|set(range(0x20,0x250))|set(range(0x2000,0x2070))|set(range(0xff00,0xfff0))
 s.populate(unicodes=codes);s.subset(font);font.flavor='woff2';font.save(dest);print(dest.name,dest.stat().st_size)
(out/'LICENSE-Noto.txt').write_text(Path(args.license).read_text())
