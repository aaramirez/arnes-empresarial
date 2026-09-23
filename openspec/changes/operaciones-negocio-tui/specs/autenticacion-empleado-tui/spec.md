> Nota de proceso: sin shell ni `graphify query` (ver `specs/comando-empleado-tui/spec.md`). Delta escrito contra `openspec/changes/tui-canal-empleado/specs/autenticacion-empleado-tui/spec.md:103-133` (no hay spec principal archivada). El requirement *"Los comandos públicos y el camino conversacional no dependen de sesión..."* (`:124-132`) **queda falso** con este change: afirma que el texto conversacional funciona "de forma idéntica exista o no una sesión activa", y con sesión vigente ahora va al turno de operaciones. Por eso se **MODIFICA**. Existen otras dos copias de la capability (`autorizacion-empleado`, `comandos-administracion-empleados`); `Grep` confirma que **no** contienen ese requirement, sólo la copia de `tui-canal-empleado`. No se toca el párrafo *"Fuera de alcance"* (`:9`), que modifica `sesiones-web-persistentes`: **sin solape de texto**. Si se combinaran al archivar, ambos deltas convivirían en la misma capability sin conflicto.

# Delta for Autenticación Empleado TUI

## MODIFIED Requirements

### Requirement: Los comandos públicos y el camino conversacional no dependen de sesión ni de `EMPLEADO_ID`

`/soporte`, `/devolucion` y `/ayuda` SHALL funcionar de forma idéntica exista o no una sesión activa. El texto conversacional SHALL funcionar sin sesión exactamente como antes de este change (delegado a `onSubmit`, sin exigir login); con sesión vigente SHALL ser atendido por el turno de operaciones (capability `comando-empleado-tui`). El sistema SHALL NOT leer la variable de entorno `EMPLEADO_ID` como fuente de identidad en ningún camino.

(Previously: `/soporte`, `/devolucion`, `/ayuda` **y el texto conversacional** funcionaban "de forma idéntica exista o no una sesión activa"; el texto con sesión vigente ahora se rutea distinto.)

#### Scenario: La TUI arranca y opera sin ningún login
- GIVEN ninguna sesión activa y ninguna credencial dada de alta
- WHEN se ejecuta texto conversacional, `/soporte` y `/devolucion`
- THEN los tres funcionan como antes de este change, sin exigir login
- AND ninguno consulta `EMPLEADO_ID`

#### Scenario: Los comandos públicos no cambian con sesión
- GIVEN una sesión vigente
- WHEN se ejecutan `/soporte` y `/devolucion`
- THEN funcionan igual que sin sesión

## ADDED Requirements

### Requirement: Abrir, cerrar o vencer la sesión termina el estado conversacional y de confirmación de operaciones

Con `operacionesTui` presente, la expiración de la sesión, `/logout` y la entrada a `/login` (aunque el login luego falle, porque un `/login` fallido también destruye la sesión vigente) SHALL eliminar la memoria conversacional de la clave vigente, si existe, y llamar `confirmacionStore.limpiarEmpleado(empleadoId)` con el `empleadoId` de la sesión saliente, si la hay. Además, un `/login` exitoso SHALL llamar `limpiarEmpleado` con el `empleadoId` nuevo, de modo que un login arranque con la confirmación vacía (ADR 298, RD-170). La expiración SHALL detectarse en el paso de purga del dispatcher, antes de parsear el comando. Ninguna de estas limpiezas SHALL escribir filas en `registro_acciones_empleado`. El dispatcher SHALL NOT mostrar aviso alguno por el solo hecho de expirar la sesión (D2).

#### Scenario: `/logout` limpia ambos estados sin fila de registro
- GIVEN una sesión con conversación y una confirmación pendiente
- WHEN se ejecuta `/logout`
- THEN se elimina la memoria y se llama `limpiarEmpleado(empleadoId)`
- AND no se escribe fila en `registro_acciones_empleado`

#### Scenario: La expiración limpia ambos estados
- GIVEN una sesión vencida con una confirmación pendiente y memoria
- WHEN llega cualquier entrada (texto o slash)
- THEN la purga elimina la memoria y llama `limpiarEmpleado(empleadoId)` antes de despachar la entrada

#### Scenario: Una confirmación pendiente no sobrevive a un re-login
- GIVEN una confirmación pendiente del empleado `ana` de un login anterior
- WHEN `ana` ejecuta `/login` de nuevo y envía la confirmación
- THEN `limpiarEmpleado(ana)` fue llamado en el login y no hay nada que confirmar

#### Scenario: Un `/login` fallido con sesión vigente también limpia
- GIVEN una sesión vigente de `ana` con memoria y una confirmación pendiente
- WHEN `ana` ejecuta `/login` con credenciales inválidas
- THEN se llama `limpiarEmpleado(ana)` y se elimina la memoria antes de resolver el login
- AND el siguiente texto sin `/` se delega a `onSubmit`

#### Scenario: Expirar no agrega mensaje
- GIVEN una sesión que vence a mitad de la conversación
- WHEN se envía el siguiente texto
- THEN el texto se delega a `onSubmit` y el dispatcher no antepone ni agrega ningún aviso de expiración
