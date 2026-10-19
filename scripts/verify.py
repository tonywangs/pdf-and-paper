"""Independent validation using PDFium, not the production MuPDF renderer.

Reconstruct leaves from physical sheet sides, check exact page accounting, then
compare every imposed half against an independently fitted source rendering.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import pypdfium2 as pdfium
from PIL import Image, ImageChops, ImageStat


def verify(source, directory):
    source, directory = Path(source), Path(directory)
    m = json.loads((directory / 'manifest.json').read_text())
    assert hashlib.sha256(source.read_bytes()).hexdigest() == m['source_sha256']
    src = pdfium.PdfDocument(source)
    out = pdfium.PdfDocument(directory / 'booklet.pdf')
    try:
        assert len(src) == m['source_pages']
        assert len(out) == len(m['sheets']) * 2
        seen, reading, errors = [], [], []
        # Each folded sheet has two leaves. Nest by inserting the inner sheet
        # between the outer sheet's first and last leaves.
        for sig in sorted({s['signature'] for s in m['sheets']}):
            group = [s for s in m['sheets'] if s['signature'] == sig]
            assert len(group) * 4 <= m['signature_limit']
            leaves = []
            for s in reversed(group):
                leaves = [s['front'][1], s['back'][0]] + leaves + [s['back'][1], s['front'][0]]
            assert None not in leaves[:next((i for i, p in enumerate(leaves) if p is None), len(leaves))]
            if None in leaves:
                assert all(p is None for p in leaves[leaves.index(None):])
            reading.extend(leaves)
        assert [n for n in reading if n is not None] == list(range(1, len(src) + 1))
        assert reading == m['folded_order']
        scale = 2
        margin = m['margin_mm'] * 72 / 25.4
        width, height = m['size_points']
        expected_size = {'a4': (297*72/25.4, 210*72/25.4), 'letter': (792, 612)}[m['paper']]
        assert all(abs(a-b)<.01 for a,b in zip((width,height),expected_size))
        contact = []
        for index, page in enumerate(out):
            assert all(abs(a-b)<.02 for a,b in zip(page.get_size(), expected_size))
            image = page.render(scale=scale).to_pil().convert('RGB')
            if index < 4:
                thumb=image.copy();thumb.thumbnail((600,450));contact.append(thumb)
            sheet = m['sheets'][index // 2]
            side = 'front' if index % 2 == 0 else 'back'
            for half, number in enumerate(sheet[side]):
                x0 = half * width / 2
                bounds = tuple(round(v*scale) for v in (x0, 0, x0+width/2, height))
                actual = image.crop(bounds)
                expected = Image.new('RGB', actual.size, 'white')
                if number is not None:
                    seen.append(number)
                    sp = src[number-1]
                    sw, sh = sp.get_size()
                    fit = min((width/2-2*margin)/sw, (height-2*margin)/sh)
                    rendered = sp.render(scale=scale*fit).to_pil().convert('RGB')
                    # Keep PDFium's ceil-sized raster: resizing it to rounded
                    # dimensions would rescale glyphs and introduce false drift.
                    left = round((width/2-sw*fit)*scale/2)
                    top = round((height-sh*fit)*scale/2)
                    expected.paste(rendered, (left,top))
                    sp.close()
                # Blurring by 1px tolerates rasterizer rounding without ignoring
                # clipping, missing text, reflection, or quarter-turn rotations.
                from PIL import ImageFilter
                diff=ImageChops.difference(actual.filter(ImageFilter.GaussianBlur(1)),expected.filter(ImageFilter.GaussianBlur(1)))
                energy=sum(ImageStat.Stat(ImageChops.invert(expected)).sum)
                error=sum(ImageStat.Stat(diff).sum)/max(energy,1)
                errors.append(error)
                assert error < .18, f'PDF page {index+1} half {half}, source {number}: ink-normalized error {error:.4f}'
            page.close()
        assert Counter(seen) == Counter(range(1,len(src)+1))
        assert reading.count(None) == m['blank_pages']
        # Save separate-engine evidence in the generated output directory.
        if contact:
            montage=Image.new('RGB',(1200,450*((len(contact)+1)//2)),'#dddddd')
            for i,im in enumerate(contact):montage.paste(im,((i%2)*600,(i//2)*450))
            montage.save(directory/'pdfium-contact.png')
        result={'source_pages':len(src),'sheets':len(m['sheets']),'blanks':m['blank_pages'],
                'half_pages_compared':len(errors),'max_ink_normalized_error':round(max(errors),6),
                'renderer':'PDFium via pypdfium2 5.0.0','physical_printing_performed':False}
        print(json.dumps(result, sort_keys=True))
        return result
    finally:
        src.close();out.close()


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source');parser.add_argument('directory')
    a=parser.parse_args();verify(a.source,a.directory)
