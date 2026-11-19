#!/usr/bin/env python3
"""Reproduce the renamed OFL-licensed SDK fallback (fonttools[brotli] required).
Run from the repository root. Network download is checksum-pinned and bounded to
one official release archive. No upstream font binary is modified in node_modules.
"""
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from tarfile import open as open_tar
from urllib.request import urlopen
from fontTools.ttLib import TTFont

URL = 'https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz'
ARCHIVE_SHA256 = '7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0'
TTF_SHA256 = '76d04c18ea243f426b7de1f3ad208e927008f961dc5945e5aad352d0dfde8ee8'
OUTPUT_SHA256 = '5b8340b229c2f9888b8035b68e8489e28b3af3c4d561463bc31030b01cdfcb2e'
archive = urlopen(URL, timeout=60).read()
if sha256(archive).hexdigest() != ARCHIVE_SHA256:
    raise RuntimeError('Upstream archive checksum mismatch')
with open_tar(fileobj=BytesIO(archive), mode='r:gz') as source:
    member = next(item for item in source.getmembers() if item.name.endswith('/LiberationSans-Regular.ttf'))
    original = source.extractfile(member).read()
if sha256(original).hexdigest() != TTF_SHA256:
    raise RuntimeError('Upstream TTF checksum mismatch')
font = TTFont(BytesIO(original), recalcTimestamp=False)
rename = {
    1: 'Agent Sans', 2: 'Regular', 3: 'Agent Sans Regular 2.1.5-agent.1',
    4: 'Agent Sans Regular',
    5: 'Version 2.1.5; Agent Sans metadata/WOFF2 derivative 1',
    6: 'AgentSans-Regular', 16: 'Agent Sans', 17: 'Regular',
    18: 'Agent Sans Regular', 21: 'Agent Sans', 22: 'Regular',
}
for record in font['name'].names:
    if record.nameID in rename:
        record.string = rename[record.nameID].encode(record.getEncoding(), errors='strict')
font.flavor = 'woff2'
output = Path('assets/fonts/AgentSans-Regular.woff2')
font.save(output)
source = TTFont(BytesIO(original))
result = TTFont(output)
assert result.getBestCmap() == source.getBestCmap()
assert result['hmtx'].metrics == source['hmtx'].metrics
assert result['head'].unitsPerEm == source['head'].unitsPerEm
if sha256(output.read_bytes()).hexdigest() != OUTPUT_SHA256:
    raise RuntimeError('Output differs: use the pinned fontTools/Brotli versions in provenance.json')
print(f'Reproduced {output}; source glyph advances and character map unchanged.')
