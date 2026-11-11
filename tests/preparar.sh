#!/usr/bin/env bash
# Prepara el ambiente LOCAL de pruebas: un PostgreSQL con el mismo SQL de la app y un servidor web.
# No toca Supabase ni Cloudflare. Uso:  bash tests/preparar.sh [--recrear]
set -euo pipefail
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
D="${CC_PGDIR:-/var/lib/postgresql/cctest}"; PUERTO=55432; DB="${PGDATABASE:-postgres}"
B="$(ls -d /usr/lib/postgresql/*/bin | tail -1)"
PSQL=(psql -h "$D/sock" -p "$PUERTO" -U postgres -v ON_ERROR_STOP=1 -q)
if [ ! -d "$D/data" ]; then
  mkdir -p "$D/sock"; chown -R postgres "$D"
  su postgres -c "$B/initdb -D $D/data -U postgres -A trust" >/dev/null
fi
"${PSQL[@]}" -d postgres -tAc "select 1" >/dev/null 2>&1 || {
  su postgres -c "$B/pg_ctl -D $D/data -o '-p $PUERTO -k $D/sock -c listen_addresses=' -l $D/log start" >/dev/null 2>&1 </dev/null; sleep 2; }
existe="$("${PSQL[@]}" -d postgres -tAc "select count(*) from pg_database where datname='$DB'")"
tiene="0"; [ "$existe" = "1" ] && tiene="$("${PSQL[@]}" -d "$DB" -tAc "select count(*) from pg_proc where proname='rpc_test'")"
if [ "${1:-}" = "--recrear" ] || [ "$tiene" = "0" ]; then
  if [ "$DB" != "postgres" ]; then "${PSQL[@]}" -d postgres -c "drop database if exists \"$DB\"" -c "create database \"$DB\""
  else "${PSQL[@]}" -d postgres -c "drop schema if exists public cascade; create schema public; drop schema if exists extensions cascade"; fi
  TMP="$(mktemp)"
  # El SQL sale del mismo index.html (bloque #sqlScript): se prueba exactamente lo que se instala en Supabase.
  # CC_SQL_DESDE: otro index.html del que sacar el SQL (para probar la app publicada contra un SQL más nuevo).
  python3 -I - "${CC_SQL_DESDE:-$RAIZ/index.html}" > "$TMP" <<'PY'
import sys,re
s=open(sys.argv[1],encoding='utf-8').read()
m=re.search(r'<script type="text/plain" id="sqlScript">(.*?)</script>',s,re.S)
sys.stdout.write(m.group(1))   # tal cual lo copia el botón «Copiar script SQL»
PY
  "${PSQL[@]}" -d postgres -tAc "select 1 from pg_roles where rolname='anon'" | grep -q 1 || "${PSQL[@]}" -d postgres -c "create role anon nologin; create role authenticated nologin"
  "${PSQL[@]}" -d "$DB" -c "create schema if not exists extensions; create extension if not exists pgcrypto schema extensions; grant usage on schema extensions to anon, authenticated"
  "${PSQL[@]}" -d "$DB" -f "$TMP" >/dev/null
  "${PSQL[@]}" -d "$DB" -f "$RAIZ/tests/sql/post.sql" >/dev/null
  rm -f "$TMP"; echo "Base local '$DB' creada desde index.html"
fi
# El servidor web queda en segundo plano, sin heredar la salida de este script (si no, quien lo llama no termina nunca).
curl -s -o /dev/null localhost:8811/index.html || { (cd "$RAIZ" && exec nohup python3 -m http.server 8811) >/dev/null 2>&1 </dev/null & sleep 1; }
echo "Listo: PostgreSQL en $D/sock:$PUERTO (base $DB) · app en http://localhost:8811/"
