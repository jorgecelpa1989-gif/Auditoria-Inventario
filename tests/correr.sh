#!/usr/bin/env bash
# Corre todas las pruebas (o las que se indiquen).  Uso:  bash tests/correr.sh [e2e_ptcero e2e_mp ...]
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"; SAL="${CC_SALIDA:-$(mktemp -d)}"
bash "$RAIZ/tests/preparar.sh" >/dev/null || exit 1
cd "$RAIZ/tests/e2e"; L=("$@"); [ ${#L[@]} -eq 0 ] && L=($(ls e2e_*.js | sed 's/\.js$//' | grep -v swredir))
ok=0; mal=()
for f in "${L[@]}"; do
  bash "$RAIZ/tests/preparar.sh" --recrear >/dev/null 2>&1 || { echo "No se pudo preparar la base"; exit 1; }   # base limpia para cada prueba
  psql -h "${CC_PGDIR:-/var/lib/postgresql/cctest}/sock" -p 55432 -U postgres -tAq -c "select cb_configurar('clave-supervisor-123'); select cb_catalogo_subir('clave-supervisor-123', '[[\"140101\",\"\",\"SACO HARINA 25KG\",\"KG\",\"SACO\",25],[\"110107\",\"\",\"ROLLO ALAMBRE\",\"KG\",\"\",1]]'::jsonb, null, 'pruebas')" >/dev/null   # clave de administrador y lista de productos de las pruebas (no son las reales)
  out="$(timeout 600 node ${CC_COMO_SUP:+--require "$RAIZ/tests/como_supervisor.js"} "$f.js" "$SAL" 2>&1)"
  if echo "$out" | grep -q "TODO OK" || { [ "$f" = e2e_pwa_panel ] && echo "$out" | grep -q "errores: \[\]"; }; then ok=$((ok+1)); echo "✅ $f"
  else mal+=("$f"); echo "❌ $f"; echo "$out" | grep -E "❌|Error|FALLAS" | head -6 | sed 's/^/     /'; fi
done
echo "---- $ok bien, ${#mal[@]} con fallas ${mal[*]}"; [ ${#mal[@]} -eq 0 ]
