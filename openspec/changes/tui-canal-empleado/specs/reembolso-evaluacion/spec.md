> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible. Delta escrito contra `openspec/changes/hito-1.3-ventas-comisiones/specs/reembolso-evaluacion/spec.md` (el spec archivado en `openspec/specs/` todavía no existe — solo `.gitkeep` — así que esa es la fuente de la versión "actual"), siguiendo `proposal.md` (ADR 23, 27 enmienda rev. 3, `## Capabilities > Modified Capabilities`).

# Delta for Reembolso Evaluación

## MODIFIED Requirements

### Requirement: Devolución requiere una venta confirmada

`POST /devolucion` (y `/devolucion` desde la TUI, mismo caso de uso — capability `comando-empleado-tui`) SHALL operar únicamente sobre ventas con `estado = 'confirmada'`. Sobre cualquier otro estado — incluido el nuevo `reembolso_rechazado` — SHALL rechazar sin efecto.
(Previously: no distinguía `reembolso_rechazado` porque ese estado no existía.)

#### Scenario: Devolución sobre venta no confirmada
- GIVEN una venta en `pendiente_confirmacion` o `rechazada`
- WHEN llega una solicitud de devolución para esa venta
- THEN se rechaza sin efecto
- AND `ventas.estado` no cambia

#### Scenario: Devolución sobre una escalación ya rechazada no reabre nada
- GIVEN una venta en `reembolso_rechazado`
- WHEN llega una solicitud de `/devolucion` (HTTP o TUI) para esa venta
- THEN se rechaza con `no_aplicable`, sin efecto
- AND la única forma de moverla de `reembolso_rechazado` sigue siendo `/reabrir-reembolso` (capability `reembolso-resolucion-escalacion`)

## ADDED Requirements

### Requirement: El caso de uso de devolución es invocador-agnóstico

El comportamiento de `procesarDevolucion` (auto-aprobación bajo el umbral, escalación sobre el umbral) SHALL ser idéntico sin importar si el invocador es `POST /devolucion` (HTTP) o `/devolucion` desde la TUI. Ningún requisito de esta capability SHALL redactarse en términos del transporte HTTP.

#### Scenario: Mismo comportamiento desde la TUI
- GIVEN `/devolucion <token>` se ejecuta desde la TUI sobre una venta bajo el umbral, y una solicitud equivalente vía `POST /devolucion`
- WHEN se comparan ambos caminos
- THEN los dos dejan la venta en `reembolsada` con la misma secuencia y las mismas guardas

### Requirement: El resultado de la devolución expone `ventaId`/`casoId` sin ensanchar la secuencia

`DevolucionResult` SHALL incluir `ventaId` y `casoId` en las ramas donde la venta se conoce (incluida la de token no encontrado, donde ambos SHALL ser `undefined`/`NULL`). Este ensanche SHALL NOT modificar la secuencia, las guardas ni los efectos de `procesarDevolucion`, y SHALL NOT afectar a consumidores que solo leen `resultado` (por ejemplo el adaptador web).

#### Scenario: El retorno incluye los ids sin cambiar el efecto
- GIVEN una devolución que escala (monto sobre el umbral)
- WHEN `procesarDevolucion` completa
- THEN el resultado incluye `ventaId` y `casoId` de la venta escalada
- AND el efecto de dominio (transición de estado) es idéntico al de antes de este change

### Requirement: El esquema de `ventas` no cambia con este change

Este change SHALL NOT modificar el esquema de la tabla `ventas` (columnas ni tipos). El sexto estado (`reembolso_rechazado`) es un valor de texto adicional sobre una columna `estado` ya abierta (`TEXT` sin `CHECK`), no un cambio de esquema.

#### Scenario: `ventas` conserva su esquema
- GIVEN el esquema de `ventas` antes de este change
- WHEN se aplica este change
- THEN las columnas y tipos de `ventas` son idénticos
- AND el nuevo estado `reembolso_rechazado` circula como un valor más de la columna `estado` existente

## REMOVED Requirements

### Requirement: Cierre de la escalación fuera de alcance de este hito

(Reason: este change agrega el camino de producto que cierra y reabre la escalación — ver capability `reembolso-resolucion-escalacion`. `reembolso_pendiente` deja de ser un estado sin salida.)
