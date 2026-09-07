> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `exploration.md` y `proposal.md` de este mismo change. Este spec se apoya en `proposal.md` (ADR 58, 59, 60), en `AGENTS.md` línea 78 (cita literal), y usa `openspec/changes/tui-canal-empleado/specs/reembolso-resolucion-escalacion/spec.md` y `openspec/changes/hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md` como plantilla de formato (two-step confirm, CAS transaccional, vocabulario HITL). No hay spec previa de esta capability — es un spec completo, no una delta.

# Propuesta de Cambio HITL Specification

## Purpose

Capability nueva. Cubre ADR 58, 59 y 60: la persistencia de la propuesta de cambio que produce el Developer en el worktree aislado (capability `escritura-aislada-worktree`), su máquina de estados, el juicio del Reviewer sobre los **bytes persistidos** (no el worktree vivo), y los tres comandos TUI privilegiados que la muestran, aplican o descartan con confirmación humana en dos pasos y auditoría append-only. El límite duro de "aplicar" es `git apply` sobre el working tree — commit, push y apertura de PR siguen prohibidos por regla de proyecto, no por límite técnico: *"El commit y el push los ejecuta siempre el humano. Ningún agente corre `git commit` ni `git push` por su cuenta, ni siquiera con el Reviewer ya aprobado"* (`AGENTS.md` línea 78).

**Fuera de alcance de este spec**: el ciclo de vida del worktree (abrir/capturar/cerrar, barrido de huérfanos, la tool de tests) — capability `escritura-aislada-worktree`; un sandbox de sistema operativo real — `options.cwd` es **anclaje de alcance**, no aislamiento de proceso; la garantía dura es la topología (`git diff` dentro del worktree → confirmación humana → `git apply`), y esta capability no promete más que eso; resolución automática de conflictos, `rebase` o reintento del patch contra otra base; que el Reviewer edite el patch (juzga bytes inmutables); aplicar propuestas desde el webhook o la web pública (`registro_acciones_empleado.empleado_id` es `NOT NULL`, un webhook no autentica a un empleado); política de quién puede aplicar qué (cualquier empleado autenticado, misma limitación aceptada de ADR 28).

## Requirements

### Requirement: Tabla propia `propuestas_cambio` con máquina de estados de tres valores

El sistema SHALL persistir cada patch capturado en una tabla propia `propuestas_cambio`, con `estado ∈ {pendiente_aprobacion_humana, aplicada, descartada}`, `caso_id NOT NULL`, `delegacion_id` nullable (precedente ADR 48: la evidencia no se pierde por una constraint), `base_commit NOT NULL`, `patch NOT NULL` y sus contadores (`patch_bytes`, `archivos`, `lineas_agregadas`, `lineas_eliminadas`). El sistema SHALL NOT reusar la tabla `delegaciones` ni `actividades` para este propósito. El sistema SHALL NOT declarar un cuarto estado `no_aplicable` en esta tabla: ningún camino de código lo alcanza — un conflicto de `git apply --check` deja la fila intacta en `pendiente_aprobacion_humana` (ver el requirement de `/aplicar-propuesta`) y un patch que excede el tope no crea fila (ver el requirement del tope de 64 KB), así que un cuarto valor sería vocabulario que promete una transición que nunca ocurre.

> **Decisión del checkpoint humano.** Una versión previa de este spec fijaba cuatro valores. `sdd-design` detectó, al bajar la máquina a firmas, que ningún camino escribía el cuarto (RD-12 de `design.md`), y el checkpoint eligió **bajar la máquina a tres** en vez de forzar un escritor artificial. El desenlace `no_aplicable` **sigue existiendo** en otro plano y no se toca: es el tag de resultado de `ResolucionHitlResult` (`hitl-contract.ts`, ADR 50 de `v2.0.0`), que describe el resultado de una *invocación* del resolvedor — "no encontrada" o "el CAS no matcheó" — y nunca fue un estado persistido. Son dos cosas distintas con el mismo nombre; sólo desaparece la del `estado` de esta tabla.

#### Scenario: Un diff capturado crea una fila en estado inicial
- GIVEN el Developer completó su turno en el worktree y el diff se capturó sin exceder el tope
- WHEN se persiste la propuesta
- THEN se crea una fila en `propuestas_cambio` con `estado = pendiente_aprobacion_humana`, `base_commit` no vacío, `patch` no vacío y los contadores coincidentes con el patch

#### Scenario: Una propuesta sin delegación de origen es igualmente persistible
- GIVEN una propuesta se crea sin una fila de `delegaciones` que la origine
- WHEN se inserta en `propuestas_cambio`
- THEN `delegacion_id` queda `NULL` y la fila se persiste igual

### Requirement: Tope de 64 KB con rechazo — nunca truncado

El sistema SHALL rechazar, sin persistir, cualquier patch que exceda `PATCH_MAX_BYTES` (65 536 bytes). El sistema SHALL NOT truncar el patch para hacerlo caber dentro del tope. Al exceder el tope, el sistema SHALL emitir un evento con `patchBytes` y SHALL cerrar el worktree igual, sin crear fila.

#### Scenario: Patch dentro del tope se persiste íntegro
- GIVEN un patch de 40 KB capturado en el worktree
- WHEN se evalúa contra `PATCH_MAX_BYTES`
- THEN se crea la fila en `propuestas_cambio` con el patch completo, sin recorte

#### Scenario: Patch que excede el tope no crea fila
- GIVEN un patch de 100 KB capturado en el worktree
- WHEN se evalúa contra `PATCH_MAX_BYTES`
- THEN no se crea ninguna fila en `propuestas_cambio`
- AND se emite un evento con `patchBytes = 102400` (o el valor real en bytes)
- AND el worktree se cierra igual

### Requirement: El Reviewer juzga el patch persistido, nunca el worktree vivo

El material que el Reviewer consume para emitir su veredicto SHALL leerse de vuelta de la base (`obtenerPropuesta(id)`) después de que la fila fue insertada y el worktree cerrado. El sistema SHALL NOT construir la `tarea_delegada` del Reviewer a partir de una variable en memoria ni del estado del worktree.

#### Scenario: El worktree ya no existe cuando el Reviewer opina
- GIVEN la secuencia `capturarDiff → tope → INSERT → cerrar` ya completó
- WHEN se arma el eslabón del Reviewer
- THEN el patch que recibe proviene de una lectura de `propuestas_cambio`, no de una referencia en memoria al diff recién capturado

#### Scenario: Patch grande produce revisión parcial declarada, no un rechazo
- GIVEN `propuestas_cambio.patch_bytes` excede `TAREA_DELEGADA_MAX_CHARS` (8 000, invariante ya vigente de v2.0.0)
- WHEN se construye la `tarea_delegada` del Reviewer
- THEN el texto se trunca al límite vigente, se emite el evento `propuesta-revision-parcial`, y el aviso aparece en el eco de `/ver-propuesta`/`/aplicar-propuesta`
- AND el ciclo de revisión completa igual: el veredicto del Reviewer queda declarado como **cota inferior**, no como gate único — el humano ve siempre los bytes completos en `/ver-propuesta`

### Requirement: `/ver-propuesta` es de solo lectura

`/ver-propuesta` sin argumento SHALL listar las propuestas en `pendiente_aprobacion_humana`, acotado por un límite de listado. `/ver-propuesta <propuestaId>` SHALL mostrar el resumen y el patch paginado. Ningún camino de este comando SHALL producir una escritura.

#### Scenario: Listado sin argumento
- GIVEN al menos una propuesta en `pendiente_aprobacion_humana`
- WHEN se ejecuta `/ver-propuesta` sin id
- THEN se listan las pendientes, acotadas por el límite configurado, sin ninguna escritura

#### Scenario: Detalle con argumento no escribe nada
- GIVEN una propuesta con id conocido
- WHEN se ejecuta `/ver-propuesta <propuestaId>`
- THEN se muestra el resumen (`base_commit`, archivos, `+N/-M`, aviso de revisión parcial si aplica) y el patch paginado
- AND no se escribe ningún cambio de estado ni fila de auditoría

### Requirement: `/aplicar-propuesta` exige sesión vigente y confirmación en dos pasos; "aplicar" termina en `git apply`

`/aplicar-propuesta <propuestaId>` SHALL exigir una `SesionEmpleado` vigente. El primer llamado SHALL mostrar un eco (id, `base_commit`, archivos, `+N/-M`, aviso de revisión parcial si aplica) sin ejecutar ninguna escritura. El segundo llamado (confirmado) SHALL ejecutar, en este orden: `git apply --check` (verifica sin mutar el working tree) → si pasa, una transacción única que hace el CAS `pendiente_aprobacion_humana → aplicada`, actualiza el `caso` y crea una fila en `registro_acciones_empleado` → recién entonces `git apply` sobre el working tree real. El sistema SHALL NOT ejecutar `git add`, `git commit`, `git push`, abrir un PR, ni cambiar de rama, en ningún paso de este flujo.

#### Scenario: Primer llamado no ejecuta nada
- GIVEN una propuesta `pendiente_aprobacion_humana` y sesión vigente
- WHEN se ejecuta `/aplicar-propuesta <propuestaId>` por primera vez
- THEN se devuelve el eco sin escribir en `propuestas_cambio`, `casos` ni `registro_acciones_empleado`

#### Scenario: Confirmación exitosa aplica el patch y dejar auditoría en una transacción
- GIVEN el eco ya se mostró y `git apply --check` pasa contra el checkout real
- WHEN se confirma `/aplicar-propuesta <propuestaId>`
- THEN el CAS a `aplicada`, la actualización del `caso` y la fila de `registro_acciones_empleado` ocurren en una única transacción
- AND recién después de esa transacción se ejecuta `git apply` sobre el working tree
- AND no se ejecuta `git add`, `git commit`, `git push` ni se abre ningún PR

#### Scenario: `git apply --check` que falla no quema el CAS ni transiciona la fila
- GIVEN `base_commit` ya no coincide con el estado actual de `main` (el repo avanzó)
- WHEN se confirma `/aplicar-propuesta <propuestaId>`
- THEN `git apply --check` falla y el comando informa el conflicto al empleado, citando `base_commit`
- AND el `estado` de la propuesta permanece en `pendiente_aprobacion_humana` — no transiciona a `aplicada` ni a ningún otro valor
- AND no se escribe fila en `registro_acciones_empleado` ni se toca el `caso`
- AND el patch persistido queda intacto, de modo que la propuesta sigue siendo aplicable si el humano actualiza su checkout y vuelve a intentar

#### Scenario: Sin sesión vigente se rechaza sin efecto
- GIVEN no hay sesión vigente en el canal
- WHEN se ejecuta `/aplicar-propuesta <propuestaId>`
- THEN el comando se rechaza sin listar ni aplicar ningún cambio

### Requirement: "Aplicar" nunca commitea, pushea ni abre PR — invariante verificable, no una promesa

El sistema SHALL garantizar que ningún camino de código, en ningún estado, ejecute `git commit`, `git push` o cree un pull request como parte de resolver una propuesta de cambio. Esta prohibición SHALL ser verificable por inspección de los constructores de argv del adaptador subyacente (capability `escritura-aislada-worktree`), no solo por convención documental.

#### Scenario: Después de aplicar, el checkout real queda con cambios sin stagear
- GIVEN una propuesta recién aplicada
- WHEN se inspecciona `git status` del checkout real inmediatamente después
- THEN los archivos modificados aparecen como cambios sin stagear (`working tree`, no `staged`), sin ningún commit nuevo en el historial

#### Scenario: No existe una vía de código hacia commit/push
- GIVEN el conjunto completo de funciones que el comando `/aplicar-propuesta` puede invocar
- WHEN se inspeccionan sus firmas
- THEN ninguna acepta un parámetro que resulte en `git commit`, `git push`, `git remote` o la creación de un PR

### Requirement: `/descartar-propuesta` exige sesión vigente y confirmación en dos pasos, con motivo y auditoría

`/descartar-propuesta <propuestaId>` SHALL ser un comando privilegiado que exige `SesionEmpleado` vigente y confirmación en dos pasos. La confirmación SHALL ejecutar, en una única transacción, el CAS `pendiente_aprobacion_humana → descartada` con `motivo` y una fila en `registro_acciones_empleado`.

#### Scenario: Descarte exitoso deja motivo y auditoría en una transacción
- GIVEN una propuesta `pendiente_aprobacion_humana` y sesión vigente
- WHEN se confirma `/descartar-propuesta <propuestaId>` con un motivo
- THEN el `estado` pasa a `descartada` con ese `motivo`, y se crea una fila en `registro_acciones_empleado`, ambas en la misma transacción

#### Scenario: Sin sesión vigente se rechaza
- GIVEN no hay sesión vigente en el canal
- WHEN se ejecuta `/descartar-propuesta <propuestaId>`
- THEN el comando se rechaza sin aplicar ningún cambio de estado

### Requirement: Sólo la TUI con empleado autenticado puede resolver una propuesta

El sistema SHALL exigir que toda resolución de una propuesta (aplicar o descartar) quede asociada a un `empleado_id` no nulo en `registro_acciones_empleado`. El sistema SHALL NOT exponer un camino de resolución desde el webhook de GitHub ni desde ningún canal no autenticado.

#### Scenario: Un webhook no puede resolver una propuesta
- GIVEN un evento de webhook de GitHub llega al sistema
- WHEN se procesa ese evento
- THEN no existe ningún comando o handler alcanzable desde ese camino que aplique o descarte una propuesta de cambio

### Requirement: Ranura única `confirmacionPendiente` compartida entre los tres dominios HITL

El sistema SHALL reusar la única ranura `confirmacionPendiente` (reembolso, solicitud interna, propuesta de cambio) para armar la confirmación en dos pasos de `/aplicar-propuesta` y `/descartar-propuesta`. El sistema SHALL NOT introducir una segunda ranura dedicada a propuestas.

#### Scenario: Una confirmación de reembolso pendiente bloquea armar una de propuesta al mismo tiempo
- GIVEN un empleado tiene una confirmación pendiente de `/aprobar-reembolso` sin completar
- WHEN el mismo empleado ejecuta el primer paso de `/aplicar-propuesta <propuestaId>`
- THEN la nueva confirmación reemplaza a la anterior en la única ranura, y solo una acción destructiva queda armada a la vez
