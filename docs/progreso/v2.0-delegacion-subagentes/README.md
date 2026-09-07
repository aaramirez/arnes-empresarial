# Hito 5 (v2.0) — Delegación a subagentes: evidencia de cierre

**Entregable funcional**: un evento de PR real dispara tres invocaciones de subagente en orden Planner → Developer → Reviewer, con tres filas en `delegaciones` del mismo `caso_id`, cada una con `tarea_delegada`/`resultado` completos y sin historial del rol anterior; el veredicto final lo emite solo el Reviewer y transiciona el estado igual que en `v1.2.0`; `/solicitar` crea `caso`+`solicitud_interna` en una transacción, el validador (`validador-solicitudes`, cuarto rol, ADR 52) emite dictamen sin transicionar, y `/aprobar-solicitud`/`/rechazar-solicitud` resuelven con confirmación en dos pasos y registro append-only (`design.md` §10). El interruptor `HARNESS_DELEGACION_ROLES=off` reproduce el comportamiento de un único agente (`v1.4.0`), sin generar ninguna fila en `delegaciones`.

**Tareas**: [`openspec/changes/hito-2.0-delegacion-subagentes/tasks.md`](../../../openspec/changes/hito-2.0-delegacion-subagentes/tasks.md) (24/25 con evidencia propia — tareas 1-23 con commit propio `(Hito 5, tarea N)`, ya aprobadas; tarea 24 es esta verificación manual end-to-end, sin código de producción; **tarea 25 [README raíz] queda PENDIENTE, fuera del alcance de esta sesión** — ver sección final).

## Checklist de cierre (`AGENTS.md`)

- [ ] Reviewer no aprobó todavía el hito completo (`sdd-verify` + `code-review` contra `tasks.md`, los 6 specs y `design.md`) — no existe `verify-report.md` en la carpeta del change a la fecha de este documento. Las tareas 1-23 sí pasaron por Implementer→Reviewer individualmente (ver sus commits), pero la revisión de cierre del hito completo (ADR 48, ADR 52, RD-5) queda pendiente.
- [x] Entregable funcional demostrado de punta a punta — Entregable A (delegación por roles activa), aislamiento, sin-efectos-sobre-el-repo, Entregable B (solicitud interna con confirmación en dos pasos) y Rollback (`HARNESS_DELEGACION_ROLES=off`), los cinco con evidencia real abajo.
- [x] Esta carpeta (`docs/progreso/v2.0-delegacion-subagentes/`).
- [ ] Tarea 25 (`README.md` raíz — documentar `SUBAGENT_REGISTRY` y el interruptor `HARNESS_DELEGACION_ROLES`) — **NO ejecutada en esta sesión** (fuera de alcance de la tarea 24; asignada explícitamente a otra sesión).
- [ ] Tag `v2.0.0` — pendiente, se crea después del merge a `main`.

## Hallazgo real encontrado durante la verificación: contaminación de `data/harness.log` por tests sin aislar

**No se corrigió** (fuera de alcance de esta tarea de verificación) — se documenta acá y se dejó una sugerencia de tarea de background (`task_82cd7bb4`) para que el Implementer la atienda.

Al inspeccionar `data/harness.log` alrededor de los eventos reales del Rollback (ver más abajo), aparecieron líneas que no correspondían a ningún evento disparado por este arnés en ejecución real: `soporte-caso-creado` con `casoId: "caso-1"`/`"caso-fijo"`, `venta-confirmada`/`comision-calculada`/`token-invalido` con `casoId: "caso-1"` — identificadores de fixture genéricos, no UUIDs reales. Se reprodujo de forma aislada y determinística:

```
$ wc -l data/harness.log
2171 data/harness.log
$ npx vitest run src/build-on-soporte.test.ts
 Test Files  1 passed (1)
      Tests  11 passed (11)
$ wc -l data/harness.log
2180 data/harness.log
```

Las 9 líneas nuevas son exactamente el mismo patrón (`soporte-caso-creado`, `casoId: "caso-1"`/`"caso-fijo"`) ya visto sin ejecutar nada más — confirma que **`npx vitest run src/build-on-soporte.test.ts`, ejecutado solo, ya escribe eventos reales en el archivo de log de producción**.

**Causa raíz** (verificada por lectura directa de código, no solo grep): `src/build-on-soporte.test.ts`'s `makeBaseDeps(db, overrides)` (línea ~117) solo reenvía `logDeps` a `BuildOnSoporteDeps` si el llamador lo pasa explícitamente (línea ~126: `...(overrides.logDeps ? { logDeps: overrides.logDeps } : {})`). De sus ~11 sitios de invocación, solo 2 (describe "forwarda logDeps...") pasan un `fakeLogDeps()` real; el resto omite el campo, así que `buildOnSoporte` (`src/build-on-soporte.ts`) cae al default de `logTurnEvent` — el escritor de archivo real (`DEFAULT_LOG_TURN_EVENT_DEPS`, `src/core/logging/turn-logger.ts`). Mismo patrón, más grave, en `src/build-on-venta.ts`: `logDeps` es opcional (línea ~82, el comentario del propio código dice literalmente "omitir en producción (default: archivo)") y `src/build-on-venta.test.ts` tiene **cero** ocurrencias de `logDeps` en todo el archivo — es decir, *todos* sus tests escriben al archivo real en cada corrida.

Es la MISMA clase de bug que `docs/progreso/v1.2-bot-revision-prs/README.md` ya documentó y arregló — pero solo para `src/build-on-activity.test.ts` (6 tests, ver su sección final). Ese fix nunca se extendió a `build-on-soporte.test.ts` (Hito 4) ni a `build-on-venta.test.ts` (Hito 4), que repiten el mismo defecto estructural. Dado el volumen (`grep` de los cuatro nombres de evento sobre el `data/harness.log` real de este repo: **1250 ocurrencias** sobre 2180 líneas totales a la fecha de este documento — más de la mitad del archivo), esto lleva corriendo, sin detectarse, desde que se escribieron esos archivos de test. No se auditó exhaustivamente el resto de los ~29 archivos que también usan los mismos literales de fixture (`"caso-1"`, `"venta-1"`) — puede haber más casos, no solo estos dos.

No se arregló acá porque está fuera del alcance de la tarea 24 (verificación, no escritura de producción) y porque la instrucción de esta tarea es explícita: reportar, no corregir en silencio. Se dejó una sugerencia de tarea (`task_82cd7bb4`, ver chip de sesión) con el detalle completo para que el Implementer lo resuelva con el mismo patrón ya aprobado por el Reviewer en `build-on-activity.test.ts` (inyectar `fakeLogDeps()` explícito en cada sitio de invocación).

**Nota de higiene, no un bug de esta verificación**: la evidencia real capturada abajo (Entregable A, Entregable B, Rollback) usa `casoId`s reales (UUIDs), fácilmente distinguibles de la contaminación (`"caso-1"`/`"caso-fijo"`/`"venta-1"`), así que la contaminación no invalida ninguna de las capturas de este documento.

## Guion de verificación (tarea 24, `design.md` §10) — resultado real

| Punto | Resultado |
|---|---|
| Entregable A (delegación por roles, `HARNESS_DELEGACION_ROLES` sin definir) | ✅ PR real, cadena Planner→Developer→Reviewer completa, comentario + label + assignee en GitHub, 3 filas en `delegaciones` |
| Aislamiento (`tarea_delegada` sin system prompt/sesión del rol anterior) | ✅ confirmado por inspección directa (texto abajo) |
| Sin efectos sobre el repositorio del arnés | ✅ `git status` limpio tras el ciclo completo |
| Entregable B (`/solicitar` → dictamen → `/aprobar-solicitud` eco → aplica) | ✅ los 4 pasos confirmados con `SELECT` real |
| Rollback (`HARNESS_DELEGACION_ROLES=off`) | ✅ comportamiento equivalente a `v1.4.0`, 0 filas nuevas en `delegaciones` |
| Doc-comments (ADR 46) | ✅ los 4 confirmados actualizados, sin promesas pendientes |
| Suite completa (`npm test` + `npm run typecheck`) | ✅ 1120/1120 verde, 0 errores de tipos |

### Entorno de verificación

Esta verificación corrió **sin TUI** (`npm run dev`/`startTui` requiere un TTY real, no disponible en este entorno — confirmado con `timeout 8 npm run dev` fallando con `Raw mode is not supported on the current process.stdin`). Se usó un driver temporal (`src/_verif24_webhook.ts` / `src/_verif24_comandos.ts`, borrados antes de cerrar esta tarea) que replica el wiring real de `src/main.ts` — mismo orden de imports, mismo `bootstrapHarness()`/`openDatabase("data/harness.db")` (la base REAL del proyecto, no una aislada), mismo `startWebhookServer`/`buildOnComandoEmpleado` — pero invoca `onComandoEmpleado` directamente en vez de montar Ink. Repo de prueba: `JimmyFung123/practicaDeDesarrollo` (mismo que Hito 3). Empleado de prueba creado para el Entregable B: `verif-e2e` / contraseña `claveVerif24!` (credenciales de prueba obvias, no secretas).

### Entregable A — cadena de roles real

`resolveWebhookConfig()` resuelta en el propio arranque del driver: `port=8787 path=/webhooks/github secretPresente=true`. `HARNESS_DELEGACION_ROLES=(sin definir → delegación por roles ACTIVA)`. `botLogin=JimmyF2024` (misma cuenta bot dedicada de Hito 3, evita el loop de auto-comentario).

PR real: rama `verif-hito5-entregable-a` (cambio trivial, un archivo de texto) → **[PR #3](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/3)**. Forwarding real vía `gh webhook forward --repo JimmyFung123/practicaDeDesarrollo --events pull_request,issue_comment --url http://localhost:8787/webhooks/github --secret <GITHUB_WEBHOOK_SECRET>`.

Log estructurado real (`data/harness.log`), ciclo completo bajo `casoId 88294282-02ee-4a9e-a14a-4dccdaa6a5e0`:

```json
{"event":"webhook-recibido","action":"opened","bytes":24586,"casoId":"6e1e6870-aa9d-11f1-9ede-82d9d80444d1","timestamp":"2026-09-07T09:20:56.444Z"}
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"3","actividadId":"094b588d-21bb-4c4d-a5b2-c0623b601d7e","deliveryId":"6e1e6870-aa9d-11f1-9ede-82d9d80444d1","casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"actividad-creada","timestamp":"2026-09-07T09:20:56.447Z"}
{"agentId":"planner","delegacionId":"880a35be-3cf0-4da5-92f5-784d532c0ebd","tareaChars":1609,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-iniciada","timestamp":"2026-09-07T09:20:57.836Z"}
{"agentId":"planner","delegacionId":"880a35be-3cf0-4da5-92f5-784d532c0ebd","sdkSessionId":"811d4d86-f068-491f-8104-c8899cfbd5d5","resultadoChars":1624,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-completada","timestamp":"2026-09-07T09:21:17.637Z"}
{"agentId":"developer","delegacionId":"db19c159-b2c1-4a0c-bb62-d49bf66ff552","tareaChars":2014,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-iniciada","timestamp":"2026-09-07T09:21:17.637Z"}
{"agentId":"developer","delegacionId":"db19c159-b2c1-4a0c-bb62-d49bf66ff552","sdkSessionId":"0c6579ea-0e0f-41df-9bfb-46cdecfd660d","resultadoChars":2522,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-completada","timestamp":"2026-09-07T09:22:18.586Z"}
{"agentId":"reviewer","delegacionId":"8834a3fc-86bf-413c-9032-cb0343ef4c07","tareaChars":2932,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-iniciada","timestamp":"2026-09-07T09:22:18.587Z"}
{"agentId":"reviewer","delegacionId":"8834a3fc-86bf-413c-9032-cb0343ef4c07","sdkSessionId":"61b60ae0-1eda-4b86-99cc-f327d364d15b","resultadoChars":632,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"delegacion-completada","timestamp":"2026-09-07T09:22:29.193Z"}
{"chars":632,"casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"tablero-comentario-publicado","timestamp":"2026-09-07T09:22:29.954Z"}
{"event":"webhook-recibido","action":"created","bytes":11778,"casoId":"a6e5c720-aa9d-11f1-8062-b5eba05ffa2f","timestamp":"2026-09-07T09:22:31.638Z"}
{"eventName":"issue_comment","casoId":"a6e5c720-aa9d-11f1-8062-b5eba05ffa2f","event":"webhook-evento-ignorado","timestamp":"2026-09-07T09:22:31.639Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"88294282-02ee-4a9e-a14a-4dccdaa6a5e0","event":"tablero-actualizado","timestamp":"2026-09-07T09:22:32.448Z"}
```

Nótese la línea `webhook-evento-ignorado` con `eventName: "issue_comment"`: el propio comentario del bot (`JimmyF2024`) volvió como webhook y el filtro anti-loop (Hito 3, `resolveBotLogin`) lo descartó correctamente, sin generar un segundo turno — mismo comportamiento que `v1.2.0`.

Estado real del PR en GitHub tras el ciclo (`gh pr view 3`): `state: OPEN`, `labels: [observaciones-pendientes]`, `assignees: [JimmyFung123]`, un comentario de `JimmyF2024` terminando en `VEREDICTO: observado` — equivalente estructural a `v1.2.0` (comentario + label + assignee reflejando el estado), con la diferencia esperada de que el veredicto lo compone el Reviewer a partir de los hallazgos del Developer, no un solo agente.

`SELECT` real:

```
$ sqlite3 -header -column data/harness.db "SELECT agent_id, sesion_padre_id, sesion_subagente_id, length(tarea_delegada) AS len_tarea, length(resultado) AS len_resultado, created_at FROM delegaciones WHERE caso_id = '88294282-02ee-4a9e-a14a-4dccdaa6a5e0' ORDER BY created_at;"
agent_id             sesion_padre_id                     sesion_subagente_id           len_tarea  len_resultado         created_at
---------  ------------------------------------  ------------------------------------  ---------  -------------  ------------------------
planner                                          f896b141-99c2-472c-9a6c-69dde258294d       1609           1624  2026-09-07T09:20:57.836Z
developer  f896b141-99c2-472c-9a6c-69dde258294d  4784fe32-a812-45f1-8538-0d3ace47ee1d       2014           2522  2026-09-07T09:21:17.637Z
reviewer   4784fe32-a812-45f1-8538-0d3ace47ee1d  c9ea5aaa-961d-4d5e-bcc0-1bdc91739fa3       2932            632  2026-09-07T09:22:18.587Z
```

**Tres filas**, orden `planner, developer, reviewer`; `planner.sesion_padre_id` es `NULL` (primera columna vacía); `developer.sesion_padre_id` = `planner.sesion_subagente_id` y `reviewer.sesion_padre_id` = `developer.sesion_subagente_id` — la cadena está genuinamente encadenada, no solo por orden temporal. Las tres tienen `resultado` con longitud > 0.

### Aislamiento — `tarea_delegada` del Developer y del Reviewer, leído y no confiado

`tarea_delegada` del **Developer** (2014 caracteres) — es el plan del Planner envuelto en una instrucción de rol, SIN ningún system prompt ni mensaje de sesión:

```
Rol delegado: developer — Ejecuta el plan de revisión sobre el código: rastrea impacto y produce hallazgos concretos. No emite veredicto.
Instrucción: Ejecutá el plan de revisión recibido sobre el código: rastreá el impacto de cada ítem del plan (call sites, propagación) y producí hallazgos concretos. No emitas veredicto — esa es tarea exclusiva del Reviewer, más adelante en la cadena.

Plan de revisión — PR #3 (Hito 5, tarea 24)

**Contexto:** cambio de un solo archivo trivial (`verif-hito5-entregable-a.txt`), sin diff disponible — solo metadata. [...]
```

`tarea_delegada` del **Reviewer** (2932 caracteres) — son los hallazgos del Developer envueltos en su propia instrucción de rol, sin rastro del plan crudo del Planner ni de ningún prompt de sistema:

```
Rol delegado: reviewer — Emite el veredicto final de una revisión de PR en una única línea VEREDICTO: aprobado|observado|resuelto.
Instrucción: Juzgá los hallazgos recibidos y emití el veredicto final de esta revisión. [...] No re-investigues el código por tu cuenta.

## Hallazgos — PR #3 (Hito 5, tarea 24)

### 1. `verif-hito5-entregable-a.txt`

**No se pudo localizar el archivo en el árbol de trabajo actual.**
[...]
```

Confirmado por inspección directa (no solo por longitud): ninguna de las dos columnas contiene las cadenas `systemPrompt`, `allowedTools` ni el texto literal de los prompts de sistema de `definitions.ts` — cada rol solo ve el texto de salida del rol anterior, envuelto en su propia instrucción. Esto también expone honestamente una limitación YA CONOCIDA y diferida a `hito-2.1-escritura-delegada` (§15, "trabajo futuro v2.1.0", explícitamente fuera de alcance de este hito): el Developer/Reviewer no tienen un `cwd` de worktree apuntando al repo real de la PR, así que su `Glob`/`Read` corre contra el propio checkout del arnés, no contra `practicaDeDesarrollo` — el propio Reviewer lo declaró honestamente ("no pude localizar el archivo... ni el archivo final está presente en el checkout usado para esta revisión") en vez de alucinar que sí lo revisó. No es un bug nuevo: es exactamente el gap que `hito-2.1-escritura-delegada` (ya con `proposal.md`/specs en el repo, sin aplicar) existe para cerrar.

### Sin efectos sobre el repositorio del arnés

```
$ git status --short
?? openspec/changes/hito-2.0-delegacion-subagentes/
?? openspec/changes/hito-2.1-escritura-delegada/
```

Esas dos carpetas ya estaban sin trackear ANTES de empezar esta verificación (son los propios artefactos SDD del hito, no algo que Planner/Developer/Reviewer hayan escrito). Ningún archivo de código fue tocado por los tres roles durante el ciclo completo — consistente con sus `allowedTools` (`Read`/`Glob` para Planner, `Read`/`Glob`/`Grep` para Developer, `Read` para Reviewer: ninguno incluye `Write`/`Edit`/`Bash`).

### Entregable B — `/solicitar` → dictamen → `/aprobar-solicitud` (eco → aplica)

Empleado `verif-e2e` autenticado (`/login verif-e2e ********` → `Sesión abierta como verif-e2e.`). Comando real:

```
> /solicitar vacaciones "una semana en marzo"
Solicitud 03008078-5186-4434-ae20-cd7fe7317e1d creada (caso c01fd976-0188-4848-9119-ba75877ba0ec). Dictamen: **Dictamen: solicitud incompleta.**

Faltan datos indispensables para evaluar cumplimiento de reglas:
- **Fechas exactas** de inicio y fin (no alcanza con "una semana en marzo")
- **Identificación del solicitante**
- **Año** de referencia (no se especifica)
[...]
```

El validador (`validador-solicitudes`, cuarto rol, ADR 52) emitió dictamen real (no vacío) SIN transicionar el estado — la solicitud queda `pendiente_aprobacion_humana` con `dictamen` NO NULO, exactamente lo que pide el diseño (el dictamen es una opinión, no una decisión automática).

`SELECT` real tras `/solicitar` (antes de cualquier aprobación):

```json
{
  "solicitud": {
    "id": "03008078-5186-4434-ae20-cd7fe7317e1d",
    "caso_id": "c01fd976-0188-4848-9119-ba75877ba0ec",
    "solicitante_id": "verif-e2e",
    "tipo": "vacaciones",
    "estado": "pendiente_aprobacion_humana",
    "dictamen": "**Dictamen: solicitud incompleta.** [...]",
    "resuelta_por": null,
    "resuelta_at": null
  },
  "caso": { "id": "c01fd976-0188-4848-9119-ba75877ba0ec", "tipo": "solicitud_interna", "estado": "pendiente_aprobacion_humana" },
  "acciones": [{ "empleado_id": "verif-e2e", "comando": "/solicitar", "resultado": "creada" }]
}
```

Primer `/aprobar-solicitud 03008078-...` (eco, SIN escribir):

```
> /aprobar-solicitud 03008078-5186-4434-ae20-cd7fe7317e1d  (1ra vez — debe ser SOLO eco)
solicitud 03008078-5186-4434-ae20-cd7fe7317e1d · tipo vacaciones · detalle "una semana en marzo" · caso c01fd976-0188-4848-9119-ba75877ba0ec — repetí el comando para confirmar.
```

Comparación programática de los snapshots de `solicitudes_internas`/`casos`/`registro_acciones_empleado` (mismo `JSON.stringify` byte a byte) ANTES vs. DESPUÉS del eco: **`¿Sin cambios en las 3 tablas tras el eco? true`** — cero escrituras confirmadas.

Segundo `/aprobar-solicitud 03008078-...` (aplica de verdad):

```
> /aprobar-solicitud 03008078-5186-4434-ae20-cd7fe7317e1d  (2da vez — debe aplicar)
Listo: la solicitud 03008078-5186-4434-ae20-cd7fe7317e1d quedó aprobada.
```

`SELECT` final real:

```json
{
  "solicitud": { "id": "03008078-5186-4434-ae20-cd7fe7317e1d", "estado": "aprobada", "resuelta_por": "verif-e2e", "resuelta_at": "2026-09-07T09:18:59.644Z" },
  "caso": { "id": "c01fd976-0188-4848-9119-ba75877ba0ec", "estado": "resuelto", "updated_at": "2026-09-07T09:18:59.644Z" },
  "acciones": [
    { "empleado_id": "verif-e2e", "comando": "/solicitar", "resultado": "creada", "ocurrido_at": "2026-09-07T09:18:44.144Z" },
    { "empleado_id": "verif-e2e", "comando": "/aprobar-solicitud", "resultado": "aprobada", "ocurrido_at": "2026-09-07T09:18:59.644Z" }
  ]
}
```

`solicitud.estado → "aprobada"`, `caso.estado → "resuelto"`, fila nueva en `registro_acciones_empleado` con `comando = "/aprobar-solicitud"` — los cuatro puntos que pide la tarea 24, confirmados.

### Rollback — `HARNESS_DELEGACION_ROLES=off`

Driver reiniciado con `HARNESS_DELEGACION_ROLES=off` en el proceso (confirmado en su propio log de arranque: `[driver] HARNESS_DELEGACION_ROLES=off`). PR real: rama `verif-hito5-rollback` → **[PR #4](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/4)**.

Log estructurado real bajo `casoId 5b9f7a51-8b56-44c4-94ac-ed358bb1268f` — nótese la AUSENCIA total de eventos `delegacion-iniciada`/`delegacion-completada` y la PRESENCIA de `conocimiento-consulta-*` (el camino "off" es el único que monta el Adaptador de Conocimiento, `build-on-activity.ts` línea ~318) y de un único `turno-completado`:

```json
{"proyectoId":"JimmyFung123/practicaDeDesarrollo","referenciaExterna":"4","actividadId":"55b260fe-6fc0-4f1c-8d6c-096cdfb3a88c","deliveryId":"f9a53fe0-aa9d-11f1-8ca1-4c3555fe2fc1","casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"actividad-creada","timestamp":"2026-09-07T09:24:50.658Z"}
{"questionLength":117,"casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"conocimiento-consulta-inicio","timestamp":"2026-09-07T09:25:01.354Z"}
{"durationMs":895,"nodes":16,"casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"conocimiento-consulta-ok","timestamp":"2026-09-07T09:25:02.250Z"}
{"agentId":"agente-conversacional","sdkSessionId":"61e4fe44-f865-4012-85ba-e17c392fe303","casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"turno-completado","timestamp":"2026-09-07T09:26:03.224Z"}
{"nodes":20,"casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"conocimiento-guardado","timestamp":"2026-09-07T09:26:03.509Z"}
{"chars":2860,"casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"tablero-comentario-publicado","timestamp":"2026-09-07T09:26:04.526Z"}
{"estado":"observado","label":"observaciones-pendientes","assignee":"JimmyFung123","casoId":"5b9f7a51-8b56-44c4-94ac-ed358bb1268f","event":"tablero-actualizado","timestamp":"2026-09-07T09:26:06.593Z"}
```

Estado real del PR (`gh pr view 4`): `state: OPEN`, `labels: [observaciones-pendientes]`, `assignees: [JimmyFung123]`, un único comentario terminando en `VEREDICTO: observado` — comportamiento estructuralmente idéntico a `v1.2.0`/`v1.4.0` (un agente, un veredicto, sin plan/hallazgos separados por rol).

`SELECT` real — cero filas en `delegaciones` para este `caso_id`:

```
$ sqlite3 -header -column data/harness.db "SELECT agent_id, sesion_padre_id, sesion_subagente_id FROM delegaciones WHERE caso_id = '5b9f7a51-8b56-44c4-94ac-ed358bb1268f';"
(0 filas)

$ sqlite3 data/harness.db "SELECT COUNT(*) FROM delegaciones;"
4
```

El total de `delegaciones` en toda la base es 4, no 3: la cuarta fila es `validador-solicitudes` del Entregable B (`caso_id c01fd976-...`), no del rollback — confirmado con el volcado completo:

```
agent_id                caso_id                                sesion_padre_id                       sesion_subagente_id                   created_at
validador-solicitudes   c01fd976-0188-4848-9119-ba75877ba0ec                                          3f48e10d-e3b5-4f45-bd64-fd677a86fa79   2026-09-07T09:18:44.145Z
planner                 88294282-02ee-4a9e-a14a-4dccdaa6a5e0                                          f896b141-99c2-472c-9a6c-69dde258294d   2026-09-07T09:20:57.836Z
developer               88294282-02ee-4a9e-a14a-4dccdaa6a5e0   f896b141-99c2-472c-9a6c-69dde258294d   4784fe32-a812-45f1-8538-0d3ace47ee1d   2026-09-07T09:21:17.637Z
reviewer                88294282-02ee-4a9e-a14a-4dccdaa6a5e0   4784fe32-a812-45f1-8538-0d3ace47ee1d   c9ea5aaa-961d-4d5e-bcc0-1bdc91739fa3   2026-09-07T09:22:18.587Z
```

### Doc-comments (ADR 46) — confirmados actualizados

Los cuatro puntos leídos directamente del código real, ninguno promete trabajo pendiente:

- `src/core/ventas/ventas-contract.ts:1-17` (header) — documenta explícitamente la única excepción de import (re-export de `hitl-contract.ts`), sin la palabra "import" en el comentario (para no romper el test "no import statements").
- `src/core/ventas/ventas-contract.ts:49-63` — el bloque re-exporta `CASO_ESTADO_PENDIENTE_APROBACION_HUMANA`/`CASO_ESTADO_RESUELTO` desde `hitl-contract.ts` con el comentario "Hito 5, ADR 42... NO se redeclaran acá".
- `src/core/turn-selector/invoke-model.ts:6-9` y `:99-140` — documenta que el Despachador de Delegación (`dispatch-delegation.ts`) ya existe y resuelve roles explícitamente, sin pasar por `tool_use` del modelo — consistente con lo verificado en el Entregable A.
- `src/core/activity/activity-contract.ts:24-31` — documenta que `solicitud_interna` vive en su propia tabla (`solicitudes_internas`, migración `0008`) y no en `actividades`, "Comentario actualizado por ADR 46".

### Suite completa

```
$ rm -rf dist && npm run typecheck
> tsc --noEmit
(sin salida — 0 errores)

$ npm test
 Test Files  79 passed (79)
      Tests  1120 passed (1120)
```

Confirmado por lectura de código (no auditoría exhaustiva de los 1120 tests, según el propio alcance de la tarea 24): `invoke-model.test.ts` inyecta un `queryFn` fake en vez de golpear la API real (`await invokeModel(agent, context, "hola", hookEngine, queryFn, mcpServers)`), mismo patrón de DI documentado por el módulo — ningún test de la suite invoca el modelo real ni abre un puerto real (los tests de `webhooks`/`web` usan el mismo patrón de servidor inyectable/efímero que ya usaban en `v1.2.0`/`v1.4.0`).

## Qué falta para el cierre real del hito

1. **Tarea 25** (`README.md` raíz — `SUBAGENT_REGISTRY` + interruptor `HARNESS_DELEGACION_ROLES`): no ejecutada en esta sesión, asignada a otra sesión.
2. **Reviewer de cierre del hito completo** (`sdd-verify` + `code-review` contra `tasks.md`, los 6 specs y `design.md`, con atención especial a ADR 48, ADR 52 y RD-5, según la nota de `tasks.md` líneas 186-190): no corrió todavía — no existe `verify-report.md`.
3. **El hallazgo de contaminación de `data/harness.log`** (ver sección de arriba) — sugerencia de tarea ya generada (`task_82cd7bb4`), pendiente de que el humano la acepte o la reasigne.
4. **Checklist de cierre de `AGENTS.md`** y **tag `v2.0.0`**: pendientes del merge a `main`, después de que los puntos 1-2 cierren.
5. **PRs reales de verificación en `practicaDeDesarrollo`**, abiertos y sin mergear a propósito (evidencia de esta tarea, no cambios funcionales): [PR #3](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/3) (Entregable A) y [PR #4](https://github.com/JimmyFung123/practicaDeDesarrollo/pull/4) (Rollback) — quedan a criterio del humano si cerrarlos/mergearlos o dejarlos como constancia histórica (mismo dilema que el propio Reviewer del PR #4 señaló sobre el archivo `.txt` de evidencia).
