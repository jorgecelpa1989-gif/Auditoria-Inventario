# Genera ../Planificador.html (un solo archivo, sin internet) incrustando SheetJS 0.18.5
import pathlib
d = pathlib.Path(__file__).parent
html = (d/'planificador.src.html').read_text(encoding='utf-8')
lib = (d/'xlsx.full.min.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
# Caracteres no ASCII como escapes \uXXXX (mismo código JS; evita bytes como U+FFFD que rechazan algunos visores)
def _esc(ch):
    o = ord(ch)
    if o < 0x80: return ch
    if o <= 0xFFFF: return '\\u%04x' % o
    o -= 0x10000
    return '\\u%04x\\u%04x' % (0xD800 + (o >> 10), 0xDC00 + (o & 0x3FF))
lib = ''.join(_esc(c) for c in lib)
(d.parent/'Planificador.html').write_text(html.replace('/*__SHEETJS__*/', lib, 1), encoding='utf-8')
print('OK', (d.parent/'Planificador.html').stat().st_size, 'bytes')
