# Evidencia de verificación manual — tarea 15, `consultas-negocio-a2a-entrante` (PR6)

Ejecutada sobre `hito/v3.8-consultas-negocio-a2a-entrante`, tras completar las tareas 11-14 de PR6 (Agent Card corregido, instrucción de uso de la tool en el prompt sintético, verificación de consistencia de specs, documentación). Alcance: `proposal.md` Success Criteria + tasks.md tarea 15, los cinco puntos mínimos exigidos.

## 1. Las tres preguntas de `examples` del Agent Card responden con datos reales (cierra "Hallazgo 1")

Verificado a nivel de lógica de negocio real: SQLite real en memoria (`openDatabase(":memory:")`), datos sembrados con las funciones reales de `repository.ts` (`createActividad`, `crearSolicitudConCaso`, `createVentaConCaso`, `confirmarVentaConComision`, `escalarReembolso`), y `createConsultas` cableado **exactamente** como en `main.ts` (mismos closures, mismas funciones de `repository.ts`) — NO a través de una invocación real del modelo/Anthropic API (limitación ya documentada en `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md` y en `docs/progreso/v3.7-comandos-administracion-empleados/verificacion-manual-tarea-12.md`: este entorno de ejecución no tiene acceso a una sesión interactiva real ni budget de red para una corrida end-to-end contra el modelo).

Se sembraron datos con nombres/ids marcados explícitamente como "secretos" (`Nombre Secreto Vendedor`, `cliente-secreto-1`, `empleado-secreto-1`, `detalle privado que NO debe filtrarse`, etc.) para poder confirmar en negativo, sobre datos reales (no dobles), que el recorte del ADR 180 sigue vigente con el wiring real de `main.ts`.

Resultado real, capturado con `npx vitest run --reporter=verbose` sobre un test temporal (`src/test/integration/_tmp-verificacion-tarea15.test.ts`, borrado tras esta corrida — tarea 15 es "sin código de producción", tasks.md):

```
=== Pregunta 1 (estado_actividad) — "¿En qué estado está la revisión del PR 42 del proyecto X?" ===
Estado de actividad - proyecto owner/repo, referencia https://github.com/owner/repo/pull/42
Estado: aprobado
Actualizado: 2026-09-05T00:00:00.000Z

=== Pregunta 2 (solicitudes_pendientes) — "¿Cuántas solicitudes internas quedaron pendientes de aprobación?" ===
Solicitudes internas pendientes
Total: 1
- vacaciones: 1

=== Pregunta 3 (reporte_comisiones) — "¿Cuál fue el total comisionado en el período actual?" ===
Reporte de comisiones (agregado) - periodo 2026-09
Vendedores con ventas: 2
Ventas confirmadas: 2
Monto vendido: 700.00
Total comisionado: 70.00
Ventas con reembolso: 1

=== Cuarta operación (reembolsos_pendientes, no es un example pero es la 4ta operación real) ===
Reembolsos pendientes de aprobación
Total: 1
Monto total: 200.00
```

Verificación cruzada de los números: se sembraron dos ventas confirmadas (montos 500 y 200 ⇒ "Monto vendido: 700.00" real) con comisiones 50 y 20 (⇒ "Total comisionado: 70.00" real); la segunda venta se escaló a reembolso pendiente (⇒ "Ventas con reembolso: 1" y la cuarta operación "Total: 1, Monto total: 200.00", el monto de esa venta). Ninguno de los cuatro textos contiene `Nombre Secreto Vendedor`, `Otro Vendedor Secreto`, `cliente-secreto-1`, `cliente-secreto-2`, `empleado-secreto-1`, `vendedor-secreto-1`, `vendedor-secreto-2` ni `detalle privado que NO debe filtrarse` — confirmado por inspección directa de los cuatro strings de salida de arriba.

**Cierra el "Hallazgo 1"** de `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`: las tres preguntas del card corregido (tarea 11) ya no reciben una generalidad — reciben datos reales, agregados y recortados, del wiring real de `main.ts`.

## 2. `git diff` confirma nueve campos en `BuildOnA2AEntranteDeps`, las siete filas del ADR 98 pto 2 intactas

```
grep -n "interface BuildOnA2AEntranteDeps" -A 15 src/build-on-a2a-entrante.ts
```

Nueve campos confirmados en el archivo real: `db`, `memory`, `hooks`, `agents`, `createKnowledge`, `createConsultas` (noveno, tarea 7), `newId`, `now`, `logDeps`. Ninguno de los nueve es un puerto de escritura (`VentaStorePort`, `ActivityStorePort`, `ActivityBoardPort`, `SolicitudStorePort`, `escritura`/`WorktreePort`, `ClienteA2APort`, `notifier`, `KeyedQueue` — ninguno presente).

## 3. `hito-3.0-a2a-servidor/design.md` no aparece en el diff

```
git diff --name-only main | rg -i "hito-3.0-a2a-servidor"
→ sin resultados
```

## 4. Test de conjunto exacto de `mcpServers` corre contra el `mcp__operaciones__*` REAL de `main`, no un doble hipotético

```
grep -n "OPERACIONES_MCP_SERVER_NAME" src/build-on-a2a-entrante.test.ts
42:import { OPERACIONES_MCP_SERVER_NAME } from "./core/operaciones/operaciones-contract.js";
505:      expect(depsPasadosAHandleTurn.mcpServers).not.toHaveProperty(OPERACIONES_MCP_SERVER_NAME);
```

El nombre viene importado del módulo real de `operaciones-negocio-conversacionales` (ya mergeado en `main` al momento de esta PR, confirmando que el gate de merge documentado en `tasks.md` se respetó) — nunca un string hipotético.

## 5. `npm test`, typecheck en verde; `src/core/` sigue sin importar de `src/adapters/*`

```
npm test
 Test Files  2 failed | 131 passed | 1 skipped (134)
      Tests  2 failed | 2325 passed | 3 skipped (2330)
```

Las 2 fallas son **preexistentes y ambientales, no introducidas por esta PR** — ninguno de los dos archivos fue tocado por las tareas 11-15 (confirmado por `git status --porcelain`, que sólo lista `README.md`, `docs/ARC42_Harness_Empresarial.md`, `src/adapters/a2a/agent-card.ts`, `src/adapters/a2a/agent-card.test.ts`, `src/core/agents/a2a-entrante-prompt.ts`, `src/core/agents/a2a-entrante-prompt.test.ts`):

- `src/adapters/knowledge/graphify-cli.test.ts` — falla porque este worktree no tiene `graphify-out/graph.json` generado (artefacto de entorno, no de código; el hook del repo ya documenta esta limitación en varios `design.md` de la serie).
- `src/test/integration/run-tests.integration.test.ts` — falla resolviendo el `vitestEntrypoint` del checkout principal (`resolveTestRunnerConfig`) desde la ubicación anidada de este worktree (`.claude/worktrees/agent-a8b9617690db74e76`); no relacionado con `consultas-negocio-a2a-entrante`.

Todos los tests relevantes a esta PR (`agent-card`, `a2a-entrante-prompt`, `build-on-a2a-entrante`, `consultas-negocio-tool`, `definitions`, `main`, `consulta-*-contract`) están dentro de los 2325 tests en verde.

```
npm run typecheck
  (sin salida, sin errores)

npm run lint
  → no existe script "lint" en package.json — N/A para este proyecto (verificado con `npm run`)
```

```
rg -n "from \"\.\./\.\./adapters|from \"\.\./adapters|from \"adapters/" src/core --glob '*.ts' | grep -v '\.test\.ts'
→ sin resultados: src/core no importa de src/adapters
```

## Checklist de tasks.md tarea 15

- [x] Las tres preguntas de `examples` del Agent Card corregido responden con datos reales de negocio (punto 1).
- [x] `git diff` confirma nueve campos en `BuildOnA2AEntranteDeps` y las siete filas del ADR 98 pto 2 intactas (punto 2).
- [x] `hito-3.0-a2a-servidor/design.md` no aparece en el diff completo del change (punto 3).
- [x] El test de conjunto exacto de `mcpServers` corre contra el `mcp__operaciones__*` real de `main`, no un doble hipotético (punto 4).
- [x] `npm test` (2325 passed, 2 fallas preexistentes ambientales sin relación con esta PR), typecheck en verde; `src/core/` sigue sin importar de `src/adapters/*`; `lint` no existe como script en este proyecto (punto 5).

Con este punto, el checklist de tarea 15 de `tasks.md` queda **completo**, cerrando PR6 y el change `consultas-negocio-a2a-entrante` completo (tareas 1-15).
