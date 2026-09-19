> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Spec nueva, construida sobre ADR 223/224 de `proposal.md` y sobre los controles ya testeados de `reembolso-resolucion-escalacion` (aprobacion-conversacional-hitl) que esta capability COMPONE en vez de reimplementar. Los escenarios de separación de funciones usan dos sesiones en el mismo test, por instrucción explícita de `proposal.md`.

# Devolución Sin Token Dos Personas Specification

## Purpose

Capability nueva (ADR 223, ADR 224). Compone controles YA EXISTENTES de `reembolso-resolucion-escalacion` (v3.10) en vez de reimplementarlos: garantiza que una devolución iniciada por `ventaId`, sin token, SIEMPRE deja la venta en `reembolso_pendiente` y NUNCA en `reembolsada` sin importar el monto; que el iniciador DEBE ser el vendedor de esa venta; que exige dos turnos y justificación no vacía; que ninguna rama del módulo alcanza `evaluarReembolso` ni `aprobarReembolso`; y que quien inició NO puede cerrar — el cierre exige rol `administrador` distinto del vendedor, vía `resolver_reembolso` sin una línea de diff.

**Fuera de alcance de este spec**: el contrato de lectura (capability `consulta-venta-empleado`), el cierre en sí (capability `reembolso-resolucion-escalacion`, sin cambio de comportamiento), notificación al cliente (no existe canal, ADR 18 pto 4).

## Requirements

### Requirement: `solicitar_devolucion` inicia sobre venta propia y SIEMPRE escala, sin mirar el monto

El sistema SHALL exponer `solicitar_devolucion { ventaId?, motivo? }`. Sin `ventaId`, SHALL operar en modo listado de ventas propias `confirmada`, con cero escrituras. Con `ventaId`, SHALL invocar `store.escalarReembolso` directamente, sin evaluar `monto` en ninguna rama: la venta transiciona `confirmada → reembolso_pendiente` y el caso a `pendiente_aprobacion_humana`, en la misma transacción, con el CAS `WHERE estado = 'confirmada'` intacto.

#### Scenario: Un monto muy por debajo del umbral tampoco se auto-aprueba
- GIVEN una venta propia `confirmada` con `monto` muy por debajo de `REEMBOLSO_UMBRAL`
- WHEN el vendedor invoca `solicitar_devolucion { ventaId, motivo }` y confirma
- THEN `ventas.estado` queda en `reembolso_pendiente` y el caso en `pendiente_aprobacion_humana`
- AND NUNCA `reembolsada`, sin importar cuán bajo sea el monto

#### Scenario: Un `ventaId` inexistente o ya fuera de `confirmada` no escala
- GIVEN un `ventaId` que no existe o cuya venta no está en `confirmada`
- WHEN se invoca `solicitar_devolucion { ventaId, motivo }`
- THEN la operación rechaza sin efecto, sin crear ninguna fila

### Requirement: Ninguna rama del módulo nuevo importa ni invoca `evaluarReembolso` ni `aprobarReembolso`

El módulo de iniciación SHALL NOT importar ni mencionar `evaluarReembolso` ni `aprobarReembolso` del núcleo, en ninguna rama ni bajo ninguna condición de monto. Esta ausencia SHALL verificarse con un test mecánico sobre el archivo fuente del módulo.

#### Scenario: Test mecánico de ausencia
- GIVEN el archivo fuente del módulo nuevo de iniciación
- WHEN se inspeccionan sus imports y llamadas
- THEN no aparece ninguna referencia a `evaluarReembolso` ni a `aprobarReembolso`

### Requirement: Confirmación en dos turnos y `motivo` obligatorio no vacío, o cero escrituras

La iniciación SHALL exigir confirmación en dos turnos (`LlaveConfirmacion`) y un `motivo` no vacío. Un `motivo` ausente o en blanco SHALL rechazar la operación sin escribir la justificación, sin ejecutar el CAS, y sin fila de auditoría de efecto. Cuando ambos turnos y el `motivo` son válidos, la justificación SHALL persistirse ANTES que el CAS; si el CAS no matchea, la fila de justificación queda huérfana pero auditable.

#### Scenario: `motivo` vacío rechaza sin escribir nada
- GIVEN un vendedor invoca `solicitar_devolucion { ventaId, motivo: "" }`
- WHEN se procesa el turno
- THEN la operación rechaza y ni la tabla de justificaciones ni `ventas`/`casos` reciben ninguna escritura

#### Scenario: El primer turno no ejecuta ningún efecto, solo el segundo confirmado
- GIVEN un vendedor envía `ventaId` y `motivo` válidos sin confirmar
- WHEN el sistema responde con el eco de confirmación
- THEN ninguna fila de justificación ni transición de estado ocurrió todavía

### Requirement: Quien inicia NO puede cerrar — separación de funciones por composición, no por guarda nueva

Una escalación creada por `solicitar_devolucion` SHALL resolverse únicamente con `resolver_reembolso` (capability `reembolso-resolucion-escalacion`), sin código nuevo de guarda. El mismo empleado que inició la escalación SHALL ser rechazado al intentar aprobarla o rechazarla (`autoaprobacion_prohibida`), por el predicado ya existente `venta.vendedorId === sesion.empleadoId`. Un empleado base sin rol elevado SHALL ser rechazado (`no_autorizado`). Un `administrador` distinto del vendedor SHALL poder cerrarla.

#### Scenario: El vendedor que inició no puede aprobar su propia escalación
- GIVEN un vendedor V inicia y confirma `solicitar_devolucion` sobre su venta, quedando `reembolso_pendiente`
- WHEN V invoca `resolver_reembolso { accion: "aprobar", ventaId }` y confirma
- THEN la operación se rechaza (`autoaprobacion_prohibida`), sin excepción lanzada, y `ventas.estado` no cambia

#### Scenario: Un empleado base sin rol elevado tampoco puede cerrarla
- GIVEN la misma escalación `reembolso_pendiente`, y un empleado base B distinto del vendedor
- WHEN B invoca `resolver_reembolso { accion: "aprobar", ventaId }`
- THEN la operación se rechaza (`no_autorizado`), sin efecto

#### Scenario: Un administrador distinto del vendedor sí puede cerrarla
- GIVEN la misma escalación `reembolso_pendiente`, y un administrador A con `empleadoId` distinto del vendedor
- WHEN A invoca `resolver_reembolso { accion: "aprobar", ventaId }` y confirma
- THEN `ventas.estado` pasa a `reembolsada`

### Requirement: La iniciación se escopa a venta propia — intento sobre venta ajena se rechaza

`solicitar_devolucion` SHALL rechazar, sin ninguna escritura, un intento de iniciar sobre una venta cuyo `vendedorId` no coincide con `sesion.empleadoId`, con un resultado distinguible de "venta inexistente".

#### Scenario: Intento sobre venta ajena rechazado
- GIVEN una venta `confirmada` cuyo `vendedorId` no es el del empleado que invoca
- WHEN ese empleado invoca `solicitar_devolucion { ventaId, motivo }`
- THEN se rechaza sin ninguna escritura, con un resultado distinguible de "no existe"

#### Scenario: Colisión de identificadores no habilita el cierre
- GIVEN un `vendedorId` externo (`POST /ventas`) que coincide por colisión con un `empleadoId` real E
- WHEN E invoca `solicitar_devolucion` sobre esa venta y la escalación queda `reembolso_pendiente`
- THEN E puede iniciar, pero al intentar cerrarla con `resolver_reembolso` es rechazado (`autoaprobacion_prohibida`), igual que cualquier otro vendedor

### Requirement: La justificación se persiste en tabla propia, nunca en `registro_acciones_empleado`

La justificación (`ventaId`, `casoId`, `solicitanteId`, `motivo`, `solicitadaAt`) SHALL persistirse en una tabla nueva, correlacionable por `ventaId`/`casoId`. `AccionEmpleado`/`registro_acciones_empleado` SHALL NOT ganar ningún campo de texto libre, y el `motivo` SHALL NOT aparecer en ningún evento de log ni en ninguna fila de auditoría.

#### Scenario: El motivo no aparece en ningún evento de log ni fila de auditoría
- GIVEN una iniciación exitosa con un `motivo` de texto libre
- WHEN se inspeccionan todos los eventos emitidos y todas las filas de `registro_acciones_empleado` del turno
- THEN ninguno contiene el texto del `motivo`

### Requirement: La iniciación es de una sola dirección, sin transición de vuelta a `confirmada`

Una vez que `solicitar_devolucion` mueve la venta a `reembolso_pendiente`, el sistema SHALL NOT ofrecer ninguna transición que la devuelva a `confirmada`. Solo `resolver_reembolso` puede moverla a `reembolsada` o `reembolso_rechazado`.

#### Scenario: No existe camino de vuelta a `confirmada`
- GIVEN una venta en `reembolso_pendiente` por la vía nueva
- WHEN se busca una operación que la regrese a `confirmada`
- THEN ninguna existe en el contrato
