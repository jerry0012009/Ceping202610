"""One-time maintainer utility. Not needed when running the application.
Convert locally installed OFL Noto Sans CJK SC outlines into TrueType for ReportLab.
Keeps the complete Unicode cmap, not a subset of any user's answers.
Requires fonttools; Debian source package: fonts-noto-cjk.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.pens.cu2quPen import Cu2QuPen
out = Path(__file__).resolve().parents[1] / 'report-pdf/fonts'
for weight in ['Regular', 'Bold']:
    source = TTFont('/usr/share/fonts/opentype/noto/NotoSansCJK-' + weight + '.ttc', fontNumber=2)
    cmap = source.getBestCmap()
    names = ['.notdef'] + list(dict.fromkeys(cmap.values()))
    glyphset = source.getGlyphSet()
    glyphs = {}
    for name in names:
        pen = TTGlyphPen(None)
        glyphset[name].draw(Cu2QuPen(pen, max_err=1.0, reverse_direction=True))
        glyphs[name] = pen.glyph()
    font = FontBuilder(source['head'].unitsPerEm, isTTF=True)
    font.setupGlyphOrder(names); font.setupCharacterMap(cmap); font.setupGlyf(glyphs)
    font.setupHorizontalMetrics({n: source['hmtx'].metrics[n] for n in names})
    font.setupHorizontalHeader(ascent=source['hhea'].ascent, descent=source['hhea'].descent)
    font.setupNameTable({'familyName': 'Duren Report CJK', 'styleName': weight,
        'uniqueFontIdentifier': 'DurenReportCJK-' + weight,
        'fullName': 'Duren Report CJK ' + weight, 'psName': 'DurenReportCJK-' + weight})
    font.setupOS2(sTypoAscender=source['hhea'].ascent, sTypoDescender=source['hhea'].descent,
        usWinAscent=source['hhea'].ascent, usWinDescent=-source['hhea'].descent)
    font.setupPost(keepGlyphNames=False); font.save(out / ('DurenReportCJK-' + weight + '.ttf'))
    print(weight, len(cmap), flush=True)
