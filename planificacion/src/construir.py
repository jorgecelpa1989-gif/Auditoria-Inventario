# Genera ../Planificador.html (un solo archivo, sin internet) incrustando SheetJS 0.18.5
import pathlib
d = pathlib.Path(__file__).parent
html = (d/'planificador.src.html').read_text(encoding='utf-8')
lib = (d/'xlsx.full.min.js').read_text(encoding='utf-8').replace('</script', '<\\/script')
(d.parent/'Planificador.html').write_text(html.replace('/*__SHEETJS__*/', lib, 1), encoding='utf-8')
print('OK', (d.parent/'Planificador.html').stat().st_size, 'bytes')
