"""Build Fraunces Voice, upright and italic: Fraunces with its optical size,
softness and wonk fixed, as in studies/type-voice (whose copy of
@fontsource-variable/fraunces this reads).

Canvas 2D cannot set font-variation-settings, so the dissolve effect could not
draw the same letters as the page. A fixed instance keeps the page and the
effect identical. Only the weight axis stays variable.

    python3 -m pip install fonttools brotli
    python3 scripts/instance-font.py
"""
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

AXES = {'opsz': 12, 'SOFT': 100, 'WONK': 0}
SRC = 'node_modules/@fontsource-variable/fraunces/files/fraunces-{}-full-{}.woff2'

for style in ('normal', 'italic'):
    for subset in ('latin', 'latin-ext'):
        font = instancer.instantiateVariableFont(TTFont(SRC.format(subset, style)), AXES)
        for record in font['name'].names:
            if record.nameID in (1, 16):
                record.string = 'Fraunces Voice'
            elif record.nameID == 4:
                record.string = 'Fraunces Voice Italic' if style == 'italic' else 'Fraunces Voice'
            elif record.nameID == 6:
                record.string = 'FrauncesVoice-Italic' if style == 'italic' else 'FrauncesVoice'
        font.flavor = 'woff2'
        suffix = '-italic' if style == 'italic' else ''
        font.save(f'public/fonts/fraunces-voice-{subset}{suffix}.woff2')
