#!/usr/bin/env bash
# Lista funciones JS definidas más de una vez en index.html (ignora librerías minificadas: nombres < 4 letras)
# y funciones SQL nuevas (create function) que ya existen con otro nombre parecido.
# Uso: bash .claude/skills/tres-d/duplicados.sh [archivo]   (por defecto index.html)
f="${1:-index.html}"
echo "== Funciones JS definidas 2+ veces en $f =="
grep -noE '(^|[^.A-Za-z0-9_$])(async )?function [A-Za-z_$][A-Za-z0-9_$]{3,}\s*\(' "$f" \
 | sed -E 's/^([0-9]+):.*function ([A-Za-z0-9_$]+).*/\2 \1/' \
 | awk '{n[$1]++; l[$1]=l[$1]" "$2} END{for(k in n) if(n[k]>1) print k": líneas"l[k]}' | sort
echo "== Constantes flecha definidas 2+ veces =="
grep -noE '\b(const|let|var) [A-Za-z_$][A-Za-z0-9_$]{3,} ?= ?(async )?(\([^)]*\)|[A-Za-z0-9_$]+) ?=>' "$f" \
 | sed -E 's/^([0-9]+):.*(const|let|var) ([A-Za-z0-9_$]+).*/\3 \1/' \
 | awk '{n[$1]++; l[$1]=l[$1]" "$2} END{for(k in n) if(n[k]>1) print k": líneas"l[k]}' | sort
