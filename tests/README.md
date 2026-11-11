# Pruebas automáticas

Estas pruebas abren la app en un navegador automático (celular y PC simulados) contra una base de
datos **local**. No tocan Supabase ni Cloudflare, y no usan claves reales.

## Qué se necesita
- PostgreSQL 16 y Node con Playwright (Chromium) instalados en el equipo donde se corren.

## Cómo se corren
```bash
bash tests/correr.sh                 # todas
bash tests/correr.sh e2e_sup_ui      # una o varias, por nombre
```
Cada prueba parte con una **base limpia**, creada desde el bloque `#sqlScript` de `index.html`
(el mismo SQL que se instala en Supabase), más una clave de administrador y una lista de productos
de prueba. Así una prueba no depende de lo que dejó otra.

`bash tests/preparar.sh` solo levanta la base local y el servidor web (`http://localhost:8811/`).

## Carpetas
| Carpeta | Contenido |
|---|---|
| `e2e/` | Pruebas vigentes. Deben pasar todas antes de publicar una versión. |
| `obsoletas/` | Pruebas de flujos que ya no existen (celulares fijos, links de conteo). Quedan como referencia para reescribirlas. |
| `sql/post.sql` | Función auxiliar `rpc_test`, que imita las llamadas de la app a Supabase. Solo existe en la base local. |
| `sql/supervisores.sql` | Copia de la actualización 17 (supervisores de área), tal como va dentro de `index.html`. |

## Pruebas de seguridad
`e2e_sup_sql.js` llama a **todas** las funciones del servidor que reciben clave usando la sesión de un
supervisor de área, y exige que solo pasen las de su lista. Si se agrega una función nueva de
administrador y por error queda abierta para supervisores, esta prueba falla.

## Antes de aplicar una migración en Supabase
1. Agregar el SQL al final de `#sqlScript` en `index.html`.
2. Correr `bash tests/correr.sh`.
3. Aplicar la migración en Supabase y guardar el archivo en `supabase/migrations/` con la versión que Supabase le asigne.
