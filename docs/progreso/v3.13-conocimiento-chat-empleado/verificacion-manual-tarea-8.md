# Verificación manual "después" + guardas de alcance — `conocimiento-chat-empleado` (tarea 8)

**Fecha**: 2026-09-19
**Rama**: `hito/v3.13-conocimiento-chat-empleado`, con las tareas 1-7 aplicadas y commiteadas (incluida la corrección del Reviewer sobre el doc-comment de secuencia).
**Ejecutor**: verificación manual de la tarea 8 de `openspec/changes/conocimiento-chat-empleado/tasks.md`. Molde de `docs/progreso/v3.12-devolucion-sin-token-dos-personas/verificacion-manual-tarea-27.md`, y de la propia tarea 1 de este change (`verificacion-manual-antes.md`).

## 0. Nota de método

Igual que en la tarea 1, este entorno tiene `ANTHROPIC_API_KEY` real vía `.env` — corrida completa contra el Claude Agent SDK, chat web (`POST /operaciones`), mismo empleado (`verif-antes-v313`) que la tarea 1. Arranque desde build limpio: `rm -rf dist && npm run build && WEB_PORT=8794 node dist/main.js`.

## (a) El "después" — misma pregunta que la tarea 1

```bash
$ curl -s -X POST http://localhost:8794/operaciones -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"consulta":"¿Cuál es la política de reembolsos de la empresa?"}'
{
  "casoId": "5b2508ea-42d9-4971-9a60-48824850407c",
  "respuesta": "No encontré el contenido real de la política de reembolsos en la base de conocimiento: la consulta devolvió nodos truncados (141 encontrados, solo 5 mostrados) que apuntan a archivos de arquitectura y código (por ejemplo `docs/ARC42_Harness_Empresarial.md` y `src/core/ventas/consulta-reembolsos-contract.ts`), pero ninguno trae el texto de la política en sí — así que no puedo citar una respuesta fundada sin arriesgarme a inventarla.\n\n¿Querés que intente una consulta más acotada ...?"
}
```

**Comparación lado a lado con el "antes" (tarea 1)**:

| | Antes (tarea 1) | Después (tarea 8) |
|---|---|---|
| `casoId` | `cbf43acb-47f9-45cb-9c83-5f484355c28a` | `5b2508ea-42d9-4971-9a60-48824850407c` |
| ¿Tool invocada? | No — el handler no tenía `mcpServers.knowledge` | **Sí** — log: `conocimiento-consulta-inicio` → `conocimiento-consulta-ok` (5 nodos, de 141) |
| ¿Cita `src`/`loc`? | No | No (ver nota) |
| Motivo de la respuesta | "No tengo disponible en este turno la herramienta" | "la consulta devolvió nodos... pero ninguno trae el texto de la política en sí" |

**Nota de método — por qué esta pregunta puntual no cita, y por qué NO es un hallazgo de este change (R11)**: repetí la misma pregunta en un segundo turno (`casoId 0896f572-b42a-4dd1-ba9a-2ab888eee66a`) y dio el mismo resultado. Esto **ya estaba documentado antes de este change**: existe memoria de la MISMA pregunta exacta hecha por TUI el 2026-09-12 (`graphify-out/memory/query_20260912_035037_cuál_es_la_política_de_reembolsos_de_la_empresa.md`), con el mismo patrón — tool alcanzable, 157 nodos encontrados, ninguno con el texto de una política real, el modelo se niega a inventar. `docs/progreso/guia-verificacion-casos-de-uso.md:367` ya marca ese caso como *"8. fallo pero funciona un poquito"*, sin checkbox, en el canal TUI que **ya tenía la tool cableada antes de este change**. El vault de Graphify de este repo es un grafo de código/arquitectura, no un repositorio de políticas de RR.HH. — no hay, y nunca hubo, un documento con el texto de una "política de reembolsos" para citar. Esto no contradice la hipótesis del diseño (R11: la tool es alcanzable, no hay error ni crash) — sólo confirma que el criterio R2 ("la tool es alcanzable y cita una fuente real") no se puede demostrar con ESTA pregunta puntual, algo que el propio `design.md` §10.4 pto 3 ya anticipaba al citar ese mismo antecedente.

**Demostración suplementaria de R2 de punta a punta** (mismo `casoId` distinto, mismo empleado, mismo turno de sesión): para no dejar el criterio de éxito sin evidencia positiva, repetí una pregunta cuyo contenido SÍ existe literal en el vault (mismo tipo usado en el Hito 2 / v1.1.0 de `guia-verificacion-completa.md`):

```bash
$ curl -s -X POST http://localhost:8794/operaciones -H "Authorization: Bearer $TOKEN" \
  -d '{"consulta":"¿Qué convención de commits usa este proyecto según AGENTS.md?"}'
{
  "casoId": "ab3f2f1e-10fe-4bd6-a547-9323636b0021",
  "respuesta": "Encontré la sección donde está documentada la convención, pero el resultado del vault no trae el contenido completo — solo el título del nodo, no el texto de la política:\n\n- **Convención de commits y versionado** (AGENTS.md, L75)\n- **Commits por unidad de trabajo (durante el Implementer)** (AGENTS.md, L89)\n\nNo puedo afirmar cuál es la convención específica ... Si querés, puedo intentar una consulta más acotada ..., o podés revisar directamente `AGENTS.md` líneas 75-89."
}
```

**`(AGENTS.md, L75)` y `(AGENTS.md, L89)` son citas reales, formato exacto de la skill `citar-conocimiento`** (`src` + `, L<n>` entre paréntesis, inmediatamente después de la afirmación que sustentan) — `src=AGENTS.md` existe, y las líneas 75/89 son las secciones reales "Convención de commits y versionado" / "Commits por unidad de trabajo". **Criterio R2 cumplido explícitamente**: *"la tool es alcanzable y la respuesta cita una fuente real, no que la respuesta es buena"* — acá la cita es real y el contenido es pobre (el nodo no trae el texto completo), que es exactamente el caso que `design.md` §10.4 declara como "change cumplido".

## (b) Prueba en vivo del ADR 235

```bash
$ find graphify-out/memory -maxdepth 1 -type f | wc -l
39   # antes de los tres turnos de esta verificación
39   # después de los tres turnos (recontado al final)
```

Log de los tres turnos (`data/harness.log`, filtrado por los tres `casoId` de esta corrida):

```
{"casoId":"5b2508ea-...","event":"operaciones-caso-creado", ...}
{"casoId":"5b2508ea-...","event":"conocimiento-consulta-inicio", ...}
{"durationMs":1274,"nodes":5,"casoId":"5b2508ea-...","event":"conocimiento-consulta-ok", ...}
{"agentId":"agente-conversacional","casoId":"5b2508ea-...","event":"turno-completado", ...}
{"casoId":"0896f572-...","event":"operaciones-caso-creado", ...} ... (mismo patrón)
{"casoId":"ab3f2f1e-...","event":"operaciones-caso-creado", ...}
{"casoId":"ab3f2f1e-...","event":"conocimiento-consulta-inicio", ...}
{"durationMs":1273,"nodes":7,"casoId":"ab3f2f1e-...","event":"conocimiento-consulta-ok", ...}
{"agentId":"agente-conversacional","casoId":"ab3f2f1e-...","event":"turno-completado", ...}
```

**Ninguno de los tres eventos del feedback** (`conocimiento-guardado`, `conocimiento-sin-consulta`, `conocimiento-guardado-fallido` — `adapters/knowledge/index.ts:123,131,134`; nota: `design.md` §4 pto 6 menciona sólo dos, `tasks.md` corrige a tres, ambos verificados contra el código real) aparece con ninguno de los tres `casoId` de esta corrida — confirmado con `rg` sobre `data/harness.log` filtrando explícitamente esos tres `casoId`. Sí aparecen, para cada turno, `operaciones-caso-creado` y `turno-completado`.

## (c) Guardas de alcance

```bash
$ git diff --stat main -- src/core/ src/adapters/memory/migrations/ package.json \
    src/adapters/web/server.ts src/adapters/knowledge/ \
    src/core/operaciones/operaciones-contract.ts src/core/operaciones/validar-operacion.ts \
    src/core/operaciones/ejecutar-operacion.ts src/adapters/operaciones/index.ts \
    src/core/operaciones/operaciones-contract.test.ts \
    src/core/agents/definitions.ts src/core/agents/soporte-prompt.ts
(vacío — cero archivos tocados de la lista protegida)
```

- `src/core/**`: sin cambios.
- Migraciones: próxima libre sigue siendo `0015` (última existente: `0014_justificaciones_devolucion.ts`).
- `src/adapters/web/server.ts`, `src/adapters/knowledge/**`, `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts`, `adapters/operaciones/index.ts`: sin tocar.
- `operaciones-contract.test.ts`: sin tocar (`OPERACIONES_NEGOCIO` sigue con diez).
- `package.json`: sin dependencias nuevas.
- `definitions.ts`, `soporte-prompt.ts`: sin tocar.
- `src/core/` sin imports de `src/adapters/*`: confirmado, `rg` sobre `src/core/` sin coincidencias.

## (d) Suite completa

```bash
$ rm -rf dist && npm run typecheck
tsc --noEmit
(sin salida — sin errores)

$ npm run build
tsc -p tsconfig.json
(sin salida — sin errores)

$ rm -rf dist && npx vitest run --exclude "**/.claude/worktrees/**"
 Test Files  143 passed | 1 skipped (144)
      Tests  2626 passed | 3 skipped (2629)
```

**Nota de entorno, no de este change** (mismo hallazgo que `v3.12-devolucion-sin-token-dos-personas/verificacion-manual-tarea-27.md:173`): correr `npm run build` inmediatamente antes de `npm test` sin limpiar `dist/` entre medio duplica/rompe el conteo (Vitest recoge también los `.test.js` compilados, y además colisiona con un worktree de `.claude/worktrees/agent-a2a4dfe48ac7fdf6d/`) — se reprodujo dos veces en esta misma sesión de verificación antes de aislar la causa. Con `rm -rf dist` inmediatamente antes de `vitest run` (sin `build` en el medio) y `--exclude "**/.claude/worktrees/**"`, el resultado es el de arriba, limpio.

## (e) Doc-comment R3 — verificado leyendo

```bash
$ rg -n "inalcanzable" src/build-on-operaciones-empleado.ts
31: * servidor registrado para este turno, o sea inalcanzable en runtime— queda
```

La única mención de "inalcanzable" en el archivo describe el gap VIEJO que "queda CERRADO" (línea 32) — no afirma que la tool sigue inalcanzable hoy.

## Resultado

| Criterio de aceptación (tarea 8) | Resultado |
|---|---|
| (a) "Después" con `casoId`, comparado con el "antes" | ✅ — tool alcanzable confirmada por log; la pregunta literal de la tarea 1 no cita (motivo documentado, no es regresión); demostración suplementaria cita `src`/`loc` real, formato `citar-conocimiento` |
| (b) Prueba en vivo ADR 235 (conteo estable, eventos de feedback ausentes) | ✅ — 39 antes y después, cero eventos de feedback en los tres turnos |
| (c) Guardas de alcance | ✅ — todas las rutas protegidas sin tocar |
| (d) Suite en verde | ✅ — typecheck, build y 2626 tests |
| (e) Doc-comment R3 ya no afirma inalcanzable | ✅ |

**No aplica el STOP de R11**: la respuesta a la pregunta literal de la tarea 1 no contradice la hipótesis del diseño (no hay error visible al empleado, no hay crash) — el log confirma que la tool SÍ se invocó, y el patrón "tool alcanzable, sin contenido citable para esta pregunta puntual" ya estaba documentado antes de este change (memoria TUI del 2026-09-12, checklist de casos de uso). El criterio R2 queda demostrado con la consulta suplementaria.
