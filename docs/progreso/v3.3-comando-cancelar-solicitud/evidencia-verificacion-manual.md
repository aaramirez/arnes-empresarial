# Tarea 19 — evidencia detallada de verificación manual (`comando-cancelar-solicitud`, post-ADR 144)

**Referencia**: [`openspec/changes/comando-cancelar-solicitud/tasks.md`](../../../openspec/changes/comando-cancelar-solicitud/tasks.md), tarea 19. Complementa [`README.md`](README.md) de esta misma carpeta (resumen + tabla de 19 pasos). La salida cruda completa del driver throwaway (ya borrado) queda en [`driver-output-raw.log`](driver-output-raw.log).

**Entorno**: Windows 11, Git Bash (MINGW64). Node v24.14.1. `data/harness.db` real del repo **no se tocó** en ningún momento — toda la corrida usó una SQLite bajo el scratchpad de la sesión (`.../scratchpad/demo-v3.3-cancelar-solicitud/data/harness.db`), ya borrada.

## 1. Caso heredado — dueño cancela su propia solicitud pendiente (dos pasos)

Seed: `sol-a1` (`solicitanteId: "ana"`, `tipo: "vacaciones"`, `detalle: "semana en octubre"`), sembrada con `SolicitudStorePort.crearSolicitudConCaso` real.

```
[18:02:13] Vos: /login ana clave-ana-1
sistema: Sesión abierta como ana. Vence 2026-09-11T22:32:13.624Z.
[18:02:13] Vos: /cancelar-solicitud sol-a1
sistema: solicitud sol-a1 · tipo vacaciones · detalle semana en octubre · caso caso-a1 — repetí el
comando para confirmar.
[18:02:13] Vos: /cancelar-solicitud sol-a1
sistema: Listo: la solicitud sol-a1 quedó cancelada.
```

Consulta **directa** a la base (no a través del código de la app):

```json
{"estado":"cancelada","resuelta_por":"ana","resuelta_at":"2026-09-11T22:02:13.689Z"}
```

Fila real en `registro_acciones_empleado` (query directa por `comando = '/cancelar-solicitud'`):

```json
[{"comando":"/cancelar-solicitud","resultado":"cancelada","empleado_id":"ana"}]
```

## 2. Caso heredado — un tercero intenta cancelar

Seed: `sol-a2` (`solicitanteId: "ana"`, `detalle: "viatico octubre"`). Sesión activa: `beto`.

```
[18:02:13] Vos: /cancelar-solicitud sol-a2
sistema: La solicitud sol-a2 no es tuya: sólo quien la creó puede cancelarla.
```

La respuesta **no contiene** `"viatico octubre"` (el `detalle` de `sol-a2`) ni `"ana"` (el `solicitanteId`) — verificado por inspección directa del string de respuesta: la variante `no_es_dueno` de `ResolverSolicitudResult` (`resolver-solicitud-interna.ts`) es estructuralmente `{ resultado, accion, itemId }`, **sin** campo `item` (R6) — el handler no puede filtrar lo que no recibe.

## 3. Caso heredado — cancelar una solicitud ya `aprobada`

Seed: `sol-a3` (`solicitanteId: "ana"`), pre-aprobada con `SolicitudStorePort.aprobarSolicitud` (simula una resolución previa de `beto`) ANTES de que `ana` intente cancelarla.

Snapshot de las tres tablas antes/después del intento de cancelación:

```
[SQL snapshot] {"label":"antes de cancelar sol-a3 (ya aprobada)","solicitudes":31,"casos":31,"registro":3}
[SQL snapshot] {"label":"despues de cancelar sol-a3 (ya aprobada)","solicitudes":31,"casos":31,"registro":3}
[verificacion] cero filas nuevas: true
```

Respuesta:

```
[18:02:13] Vos: /cancelar-solicitud sol-a3
sistema: No hay ninguna solicitud sol-a3 tuya pendiente de cancelación. Si ya fue aprobada,
rechazada o cancelada, no se puede retirar.
```

Y contra un id **verdaderamente inexistente** (`sol-no-existe`):

```
[18:02:13] Vos: /cancelar-solicitud sol-no-existe
sistema: No hay ninguna solicitud sol-no-existe tuya pendiente de cancelación. Si ya fue aprobada,
rechazada o cancelada, no se puede retirar.
```

**Mensaje byte-por-byte idéntico** entre los dos casos (sólo cambia el id interpolado) — confirma que `/cancelar-solicitud` no distingue "ya resuelta" de "nunca existió" (ADR 125: sin lector sin filtro de estado que los distinga).

## 4. Caso heredado — `/aprobar-solicitud`/`/rechazar-solicitud` sobre solicitudes ajenas (R1 no derogado)

Seeds: `sol-a4` (`solicitanteId: "carla"`, `detalle: "ajena para aprobar sin chequeo de dueno"`), `sol-a5` (`solicitanteId: "carla"`, `detalle: "ajena para rechazar sin chequeo de dueno"`). Sesión activa: `beto` (ni dueño de `sol-a4` ni de `sol-a5`).

```
[18:02:13] Vos: /aprobar-solicitud sol-a4
sistema: solicitud sol-a4 · tipo gasto · detalle ajena para aprobar sin chequeo de dueno · caso
caso-a4 — repetí el comando para confirmar.
[18:02:13] Vos: /aprobar-solicitud sol-a4
sistema: Listo: la solicitud sol-a4 quedó aprobada.
```

SQL directa: `{"estado":"aprobada","resuelta_por":"beto"}` — `beto` aprobó una solicitud de `carla` sin ningún chequeo de dueño, exactamente como antes de este change.

```
[18:02:13] Vos: /rechazar-solicitud sol-a5
sistema: solicitud sol-a5 · tipo vacaciones · detalle ajena para rechazar sin chequeo de dueno ·
caso caso-a5 — repetí el comando para confirmar.
[18:02:13] Vos: /rechazar-solicitud sol-a5
sistema: Listo: la solicitud sol-a5 quedó rechazada.
```

SQL directa: `{"estado":"rechazada","resuelta_por":"beto"}`.

## 5. ADR 144 (a) — `/cancelar-solicitud` sin id lista **sólo lo mío**, incluido el bug del `LIMIT`

Seed de la base para este caso: **25** solicitudes ajenas (`solicitanteId: "empleado-ajeno-0"` .. `"empleado-ajeno-24"`), creadas con timestamps `2026-09-11T00:01:00` .. `2026-09-11T00:01:24` (**todas antes** que la propia, respetando `ORDER BY created_at`), más **una** solicitud propia de `eli` (`sol-b-propia-eli`, timestamp `2026-09-11T00:01:30`, después de las 25 ajenas).

Sesión activa: `eli`. Comando: `/cancelar-solicitud` (sin id).

```
[18:02:14] Vos: /login eli clave-eli-1
sistema: Sesión abierta como eli. Vence 2026-09-11T22:32:14.074Z.
[18:02:14] Vos: /cancelar-solicitud
sistema: - solicitud sol-b-propia-eli | solicitante eli | tipo gasto | detalle propia de eli para el
 listado sin id | estado pendiente_aprobacion_humana | caso caso-b-propia-eli
```

**Ésta es la verificación manual del daño real del ADR 144, sobre datos de punta a punta** (dispatcher real → `resolverSolicitudInterna` real → `SolicitudStorePort.listarSolicitudesPendientes` real → SQL real con `WHERE ... AND (@solicitanteId IS NULL OR solicitante_id = @solicitanteId) ... LIMIT @limite` → respuesta real):

- La respuesta contiene **únicamente** `sol-b-propia-eli` — verificado por búsqueda de substring sobre el frame completo de la TUI: ninguno de los 25 ids (`empleado-ajeno-0`..`24`), ningún `detalle` ajeno (`"ajena ADR144 numero"`), ninguna otra `solicitud sol-b-ajena-*` aparece.
- **La propia SIGUE apareciendo** a pesar de que 25 solicitudes ajenas más antiguas existen en la tabla: antes del fix (`resolver-solicitud-interna.ts` sin el gate `soloPropias`, `repository.ts` sin la cláusula `AND (@solicitanteId IS NULL OR ...)`), el `LIMIT 20` se hubiera aplicado sobre el listado GLOBAL ordenado por `created_at` — las 25 ajenas, todas más viejas, se hubieran comido el cupo entero y `sol-b-propia-eli` nunca hubiera entrado al resultado bruto, sin importar qué filtro se aplicara después en el handler. Con el fix, el filtro por `solicitanteId` corre DENTRO del SQL, antes del `LIMIT`, así que la única fila de `eli` siempre entra.

## 6. ADR 144 (b) — `/aprobar-solicitud`/`/rechazar-solicitud` sin id siguen listando TODO

**Misma base** que el punto 5 (sin resembrar nada). Sesión activa: `beto`. Comando: `/aprobar-solicitud` (sin id).

```
[18:02:14] Vos: /login beto clave-beto-1
sistema: Sesión abierta como beto. Vence 2026-09-11T22:32:14.190Z.
[18:02:14] Vos: /aprobar-solicitud
sistema: - solicitud sol-a2 | solicitante ana | tipo gasto | detalle viatico octubre | estado
pendiente_aprobacion_humana | caso caso-a2
- solicitud sol-b-ajena-0 | solicitante empleado-ajeno-0 | tipo vacaciones | detalle ajena ADR144
numero 0 | estado pendiente_aprobacion_humana | caso caso-b-ajena-0
- solicitud sol-b-ajena-1 | solicitante empleado-ajeno-1 | tipo gasto | detalle ajena ADR144 numero
1 | estado pendiente_aprobacion_humana | caso caso-b-ajena-1
[... 17 líneas más, sol-b-ajena-2 .. sol-b-ajena-18, todas con `solicitante`/`detalle` completos ...]
```

(Transcripción completa de las 20 líneas — `sol-a2` + `sol-b-ajena-0` .. `sol-b-ajena-18` — en `driver-output-raw.log`, líneas 672-712.)

`beto` **no tiene ninguna solicitud propia pendiente** en esta base (nunca fue `solicitanteId` de ninguna fila) — si `/aprobar-solicitud` sin id estuviera filtrado por dueño como `/cancelar-solicitud`, esta respuesta tendría que estar vacía (`"No hay solicitudes para listar."`). En cambio, devuelve el listado **global de la organización**, con `solicitante`/`detalle` completos para cada fila (tope `LIMIT 20`: `sol-a2` + las 19 ajenas más antiguas de las 25 sembradas) — evidencia directa de que el requirement `solicitud-interna-hitl:72` (R1) sigue sin derogarse, también después del PR3/ADR 144.

## 7. Verificaciones estáticas (sin código de producción)

### 7.1 `MotivoNoAplicableHitl` sin diff

```
$ rg 'MotivoNoAplicableHitl' src/core/hitl/hitl-contract.ts
export type MotivoNoAplicableHitl = typeof MOTIVO_NO_ENCONTRADA | typeof MOTIVO_CAS;
      readonly motivo: MotivoNoAplicableHitl;
```

Dos apariciones, tipo cerrado sobre los dos motivos preexistentes — `hitl-contract.ts` no se tocó en ningún PR de este change.

### 7.2 Blast radius — `hitl/`, `propuestas/`, `ventas/` sin diff contra `main`

```
$ git diff --stat main -- src/core/hitl/ src/core/propuestas/ src/core/ventas/
(sin salida)
```

### 7.3 Rollback de la tarea 8 (`de92b8a`) — sin tocar el working tree

En vez de un `git worktree` desechable (innecesario para esta inspección puntual), se usó `git show <commit>^:<ruta>` — lee el contenido de un archivo en un commit arbitrario sin mover el `HEAD` ni el working tree del checkout principal:

```
$ git log --oneline -1 de92b8a
de92b8a feat(core,root): agrega ACCION_CANCELAR_SOLICITUD con chequeo de dueño y variante no_es_dueno (comando-cancelar-solicitud, tarea 8)

$ git log --oneline -1 de92b8a^
c1a62f8 feat(core,root): agrega cancelarSolicitud al puerto y a createSolicitudStore en un solo commit por acoplamiento de tipos (comando-cancelar-solicitud, tarea 7)

$ git show de92b8a^:src/core/solicitudes/resolver-solicitud-interna.ts | grep -n "ACCION_\|AccionSolicitud\s*=\|case "
36:export const ACCION_APROBAR_SOLICITUD = "aprobar";
37:export const ACCION_RECHAZAR_SOLICITUD = "rechazar";
38:export type AccionSolicitud = typeof ACCION_APROBAR_SOLICITUD | typeof ACCION_RECHAZAR_SOLICITUD;
57:  [ACCION_APROBAR_SOLICITUD]: "solicitud-aprobada",
58:  [ACCION_RECHAZAR_SOLICITUD]: "solicitud-rechazada",
74:    case ACCION_APROBAR_SOLICITUD:
76:    case ACCION_RECHAZAR_SOLICITUD:
```

Confirmado: en el padre de la tarea 8, `AccionSolicitud` era una unión de **2** miembros (sin `cancelar`) y el `switch` de `aplicarCas` tenía exactamente **2** `case` — el rollback de ese commit revierte `resolver-solicitud-interna.ts` a ese estado de 2 acciones, tal como `tasks.md` (tarea 19) pide verificar.

### 7.4 `npm run typecheck`

```
$ npx tsc --noEmit
(sin salida — cero errores de tipos)
```

### 7.5 `npm test`

```
$ npx vitest run
...
 FAIL  src/test/integration/run-tests.integration.test.ts > test-runner (integration against real git + real vitest) > resuelve vitestEntrypoint del checkout principal (R5, verificado no supuesto) y devuelve exitCode 0 con una suite minima en verde
GitCliError: git worktree add failed: exit-code
Caused by: Error: Command failed: git worktree add -b harness/caso-caso-run-tests-verde ... HEAD
fatal: a branch named 'harness/caso-caso-run-tests-verde' already exists

 Test Files  1 failed | 113 passed | 1 skipped (115)
      Tests  1 failed | 1938 passed | 3 skipped (1942)
```

**1938/1942 en verde.** El único fallo es `run-tests.integration.test.ts`, por una rama de worktree (`harness/caso-caso-run-tests-verde`) que quedó de una corrida anterior de ese mismo test de integración en este entorno — no relacionado con `comando-cancelar-solicitud` (ningún archivo de `src/core/solicitudes/`, `src/build-on-comando-empleado.ts` ni `src/adapters/memory/repository.ts` aparece en el stack del fallo; el test que falla ejercita el propio test-runner del proyecto contra un `git worktree` real, no ninguna lógica de solicitudes). Confirmado en esta sesión, sobre la rama `hito/v3.3-comando-cancelar-solicitud` con los 19 tareas commiteadas.

## 8. Confirmación final — `data/` real del repo intacto

```
$ git status --porcelain data/
(sin salida)
```

Antes y después de toda la corrida. La SQLite y el log usados en esta verificación vivieron enteramente bajo el scratchpad de la sesión, ya borrados junto con `scratch-demo/driver-v3.3.tsx`.
