---
name: tres-d
description: Revisión "3D" de un cambio de código — Duplicidad (reutilizar funciones existentes, nunca crear otra que haga lo mismo), Desviación (el cambio no se sale del objetivo pedido ni de la línea del código) y Diluvio (optimizar sin perder funciones ni funcionalidades). Úsala al revisar cualquier cambio en index.html, sw.js, migraciones SQL o pruebas, antes de publicar.
---

# Las 3D — Duplicidad · Desviación · Diluvio

Revisa **solo el cambio pendiente** (`git diff`, `git diff origin/main...HEAD`) y lo que toca. Solo lees y reportas; no editas.

## 1. Duplicidad — reutilizar, NO recrear

Regla: si ya existe una función que hace lo mismo (o casi), se usa esa (o se extiende con un parámetro). Nunca una copia nueva.

1. Corre el detector: `bash .claude/skills/tres-d/duplicados.sh` (nombres JS definidos 2+ veces en `index.html`).
2. Por cada función/constante **nueva** del diff (`function X`, `const X=(...)=>`, `create function public.X`):
   - Busca equivalentes por propósito, no solo por nombre: `grep -nE "function [a-z]*<palabra>" index.html` con palabras clave (conv, fmt, fecha, sku, bulto, guardar, cargar, esc, norm…).
   - Compara cuerpos: misma lógica con otro nombre, o copia con 1–2 líneas cambiadas = duplicado.
3. Helpers clave que **siempre** deben reutilizarse (no reimplementar): `$`, `esc`, `norm`, `store.get/set`, `convFix`, `conv`, `enrich`, `FACT`, `catNube`, `solFix`, `qBC`, `pvCuadre`, `ptRows`; en SQL `cb_check`, `cb_puede`, `cb_puesto_ok`, `cb_u_tiene`.
4. SQL: `create or replace function` de una existente es correcto (evoluciona); una función **nueva** que repite lógica de otra no.

Bloqueante si hay copia de lógica de conversiones, permisos o guardado (dos fuentes de verdad = resultados distintos entre módulos).

## 2. Desviación — mantener la línea y el objetivo

1. Escribe en 1 línea el **objetivo pedido** (del mensaje del usuario o del commit).
2. Clasifica cada archivo/bloque del diff: ✅ necesario para el objetivo · ⚠️ relacionado pero no pedido · ⛔ ajeno.
3. Revisa que siga la **línea del código existente**: mismo estilo (nombres cortos tipo `pvX/dvX/pcX` por módulo, `$("#id")`, plantillas `` `...${esc(x)}` ``), misma estructura de módulo (estado + `xDirty()` + render), mismos patrones de permisos (`SUP_*`) y de cola sin señal (`dirty`, `ver`, `lid`).
4. Alerta si el cambio: introduce librería/framework nuevo, cambia un patrón establecido solo en un lugar, renombra cosas sin pedirlo, o "aprovecha" para reescribir algo no solicitado.

## 3. Diluvio — optimizar sin perder nada

Propón optimizaciones, pero **ninguna puede quitar una función ni una funcionalidad**.

1. Busca: código muerto nuevo, bucles repetidos sobre la misma lista, consultas a Supabase dentro de bucles, `querySelector` repetidos en caliente, cálculos que se pueden cachear, bloques copiados que se pueden unificar con un helper existente.
2. Para cada propuesta verifica "sin pérdida":
   - Lista las funciones/comportamientos antes y después (`git diff` + `grep` de cada nombre eliminado: `grep -n "nombre" index.html tests -r` debe dar 0 usos restantes antes de quitarlo).
   - Si se elimina o fusiona algo, debe existir prueba en `tests/e2e/` que cubra el comportamiento; si no hay, márcalo "por confirmar".
3. Nunca propongas optimizar quitando validaciones de acceso, conversiones de bulto ↔ unidad ERP o el soporte sin señal.

## Reporte (añadir al reporte del revisor)

```
3D:
Duplicidad — ✅ sin duplicados | 🟠 <nueva fn> duplica <fn existente> (archivo:línea) → reutilizar <fn>
Desviación — Objetivo: <1 línea> · ✅ alineado | ⚠️ <bloque no pedido> (archivo:línea)
Diluvio — <optimización propuesta> (archivo:línea) · Sin pérdida: ✅ verificado | por confirmar
```

Corto y verificado: solo lo que comprobaste en el código. Si no hay hallazgos en una D, una línea con ✅.
