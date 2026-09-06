> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md` y por el spec de `venta-confirmacion`. Este spec se apoya íntegramente en `proposal.md` (ADR 27, 28 y su enmienda de la revisión 3, ADR 32) y usa `openspec/changes/hito-1.3-ventas-comisiones/specs/venta-confirmacion/spec.md` como plantilla de formato.

# Registro Acciones Empleado Specification

## Purpose

Capability nueva. Cubre qué acción de un empleado en la TUI deja rastro en `registro_acciones_empleado`, con qué datos, bajo qué garantía de atomicidad, y qué **nunca** se guarda. Es transversal a los siete comandos (ADR 27, 28, 32).

**Fuera de alcance de este spec**: lectura/exportación del registro (`/auditoria`, columna en el reporte mensual), verificación de identidad y sesión (capability `autenticacion-empleado-tui`), las transiciones de dominio que producen cada fila (capability `reembolso-resolucion-escalacion`).

## Requirements

### Requirement: `empleado_id` es siempre `NOT NULL` y siempre proviene de una sesión autenticada

Toda fila de `registro_acciones_empleado` SHALL tener `empleado_id` no nulo. El único origen válido de ese valor SHALL ser el `empleadoId` de una sesión vigente abierta por `/login`; ningún `empleadoId` provisto directamente por el usuario (por ejemplo, como argumento de un comando) SHALL llegar a la función de escritura del registro.

#### Scenario: Ninguna fila con atribución anónima o no autenticada
- GIVEN cualquier secuencia de comandos que produzca una fila de registro
- WHEN se inspecciona `registro_acciones_empleado`
- THEN cada fila tiene `empleado_id` no nulo
- AND ese valor coincide con el `empleadoId` de la sesión que estaba vigente al momento de la acción, nunca con un valor tipeado como argumento de comando

### Requirement: Cada comando deja el rastro definido en su vocabulario, con `venta_id`/`caso_id` nullable según corresponda

Por comando: `/login` exitoso SHALL escribir `resultado='exitosa'` con `venta_id`/`caso_id` en `NULL`; `/soporte` SHALL escribir `venta_id` en `NULL` y `caso_id` del caso de soporte creado; `/devolucion` SHALL escribir `venta_id`/`caso_id` de la venta resuelta por el token, o ambos en `NULL` si el token no matchea ninguna venta; `/aprobar-reembolso`, `/rechazar-reembolso` y `/reabrir-reembolso` SHALL escribir `venta_id`/`caso_id` de la venta resuelta. `/logout`, `/ayuda`, un comando desconocido, un intento de login fallido, y el primer paso de una confirmación de dos pasos SHALL NOT dejar fila.

#### Scenario: Login exitoso deja fila sin venta ni caso
- GIVEN una verificación de contraseña exitosa
- WHEN se abre la sesión
- THEN se crea una fila `comando='/login'`, `resultado='exitosa'`, `venta_id` y `caso_id` en `NULL`

#### Scenario: Devolución con token inexistente deja fila sin rastro del token
- GIVEN un `/devolucion <token>` cuyo token no matchea ninguna venta
- WHEN se procesa el comando
- THEN se crea una fila con `venta_id` y `caso_id` en `NULL`, `resultado='no_aplicable'`
- AND ningún campo de la fila contiene el token

### Requirement: Los comandos públicos dejan fila solo con sesión vigente; los privilegiados nunca dejan fila sin ella

`/soporte` y `/devolucion` SHALL dejar fila únicamente cuando hay sesión vigente al momento de ejecutarse, usando el `empleado_id` de esa sesión; sin sesión, SHALL ejecutar el mismo efecto de dominio pero SHALL NOT dejar fila, y SHALL emitir `accion-empleado-sin-sesion`. Los tres comandos privilegiados SHALL NOT dejar fila jamás sin sesión vigente, porque en ese caso tampoco tienen efecto de dominio que registrar.

#### Scenario: Soporte con y sin sesión
- GIVEN una sesión vigente en un caso y ninguna sesión en otro
- WHEN se ejecuta `/soporte <consulta>` en cada caso
- THEN con sesión se crea la fila con el `empleado_id` de esa sesión
- AND sin sesión el caso de soporte se crea igual pero no hay fila, y se emite `accion-empleado-sin-sesion`

### Requirement: Atomicidad — las resoluciones escriben su fila en la transacción; los demás, después

`aprobarEscalacionReembolso`, `rechazarEscalacionReembolso` y `reabrirEscalacionReembolso` SHALL escribir su fila de registro en la **misma transacción** que el CAS de `ventas` y la actualización de `casos`: no SHALL existir una transición exitosa sin su fila, ni una fila sin su transición. `/login`, `/soporte`, `/devolucion` y los intentos `no_aplicable` de esos caminos SHALL escribir su fila **después** del efecto, fuera de esa transacción.

#### Scenario: Fila y transición son atómicas en una resolución
- GIVEN una aprobación de escalación confirmada
- WHEN se ejecuta `aprobarEscalacionReembolso`
- THEN el cambio de `ventas.estado`, el de `casos.estado` y la fila de registro ocurren en la misma transacción

### Requirement: El registro nunca contiene el token, la contraseña, ni contenido del cliente

Ninguna fila de `registro_acciones_empleado` SHALL contener el `token_confirmacion`, una contraseña o un derivado suyo, el texto de una consulta de `/soporte`, ni el `motivo` de una `/devolucion`.

#### Scenario: Ausencia verificada de datos sensibles
- GIVEN un conjunto de acciones que incluye un `/login`, un `/soporte` con consulta, y un `/devolucion` con motivo
- WHEN se inspeccionan todas las filas producidas
- THEN ninguna contiene el `token_confirmacion`, la contraseña, el texto de la consulta ni el motivo

### Requirement: Un ciclo de escalación/rechazo/reapertura/aprobación deja una historia legible y atribuida

El ciclo `escalada → rechazada → reabierta → aprobada` sobre una misma venta SHALL producir cuatro filas legibles en `registro_acciones_empleado`, en orden cronológico, cada una con el `empleado_id` autenticado del empleado que la ejecutó.

#### Scenario: Historia completa de cuatro filas con dos empleados distintos
- GIVEN una venta se escala mediante `/devolucion` ejecutado por un empleado con sesión, luego `ana` la rechaza, `beto` la reabre y `ana` la aprueba, cada acción con su propia sesión autenticada por su propio `/login`
- WHEN se leen en orden las filas de esa venta
- THEN hay cuatro filas (`escalada`, `rechazada`, `reabierta`, `aprobada`) que narran la secuencia en orden cronológico
- AND cada una tiene el `empleado_id` autenticado correspondiente
- AND el estado final de la venta es `reembolsada`
