> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible (solo Read/Edit/Write/Grep/Glob), misma limitación ya documentada por `proposal.md` y por el spec de `venta-confirmacion`. Este spec se apoya íntegramente en `proposal.md` revisión 3 (ADR 30-33, Success Criteria "Autenticación y sesión") y usa `openspec/changes/hito-1.3-ventas-comisiones/specs/venta-confirmacion/spec.md` como plantilla de formato. `autenticacion-empleado-tui` ya figuraba en `proposal.md` bajo `## Capabilities > New Capabilities` (no hizo falta agregarla).

# Autenticación Empleado TUI Specification

## Purpose

Capability nueva (revisión 3, ADR 30-33). Cubre: alta y rotación de credenciales de empleado por CLI (`empleados:crear`), verificación de contraseña contra un hash scrypt en `/login`, apertura/cierre/vigencia de la sesión en memoria de la TUI, y la regla de qué comandos exigen esa sesión. Incluye los invariantes negativos de la contraseña: **nunca** se persiste en claro, **nunca** aparece en una fila de `registro_acciones_empleado`, **nunca** aparece en un evento de `logTurnEvent`.

**Fuera de alcance de este spec**: roles y permisos sobre qué puede hacer un empleado logueado (capability `reembolso-resolucion-escalacion`), desactivación de empleado, límite de intentos de login / rate limiting, recuperación de contraseña, enmascarado de la entrada en la TUI, sesión persistente entre reinicios o compartida entre procesos, autenticación del adaptador web.

## Requirements

### Requirement: Alta de credencial por CLI con contraseña por stdin

`npm run empleados:crear -- <empleadoId>` SHALL leer la contraseña por `stdin` (nunca por `argv`) y SHALL crear una fila en `credenciales_empleado` con `password_hash` derivado con `scryptSync` y una sal aleatoria por fila, distinto del texto en claro. `created_at` y `updated_at` SHALL quedar iguales en el alta. Un alta sobre un `empleadoId` ya existente SHALL fallar (`exit(1)`) sin modificar el hash existente.

#### Scenario: Alta crea la credencial
- GIVEN un `empleadoId` sin fila en `credenciales_empleado`
- WHEN se corre `empleados:crear -- ana` y la contraseña llega por `stdin`
- THEN se crea la fila con `password_hash` no vacío y distinto de la contraseña
- AND `created_at = updated_at`

#### Scenario: Dos altas con la misma contraseña producen hashes distintos
- GIVEN dos empleados nuevos con idéntica contraseña
- WHEN se da de alta a cada uno
- THEN sus `password_hash` son distintos entre sí (sal aleatoria por fila)

#### Scenario: Alta duplicada no pisa la credencial existente
- GIVEN `ana` ya tiene fila en `credenciales_empleado`
- WHEN se corre `empleados:crear -- ana` de nuevo
- THEN el comando falla (`exit(1)`)
- AND `password_hash` de la fila existente no cambia

### Requirement: Rotación de credencial por CLI

`npm run empleados:crear -- <empleadoId> --rotar` SHALL actualizar `password_hash` y `updated_at` de una fila existente, dejando `created_at` intacto, y SHALL invalidar la contraseña anterior. Sobre un `empleadoId` inexistente, SHALL fallar sin crear ni modificar ninguna fila.

#### Scenario: Rotación reemplaza la contraseña
- GIVEN `ana` tiene una credencial existente
- WHEN se corre `empleados:crear -- ana --rotar` con una contraseña nueva
- THEN `password_hash` y `updated_at` cambian, `created_at` no cambia
- AND la contraseña anterior deja de verificar correctamente

#### Scenario: Rotación sobre id inexistente falla
- GIVEN ningún empleado `beto` en `credenciales_empleado`
- WHEN se corre `empleados:crear -- beto --rotar`
- THEN el comando falla sin crear ni modificar ninguna fila

### Requirement: Verificación de contraseña en `/login`, con respuesta indistinguible

`/login <empleadoId> <password>` SHALL verificar la contraseña contra el hash de `credenciales_empleado` usando `verificarPassword` inyectado. Un `empleadoId` inexistente y una contraseña incorrecta SHALL producir la misma respuesta genérica, sin abrir sesión y sin escribir fila de registro. Una verificación exitosa SHALL abrir la sesión, SHALL responder confirmando qué empleado quedó logueado, y SHALL dejar una fila `comando='/login'`, `resultado='exitosa'`, `venta_id`/`caso_id` en `NULL`.

#### Scenario: Login exitoso abre sesión, confirma identidad y deja fila
- GIVEN `ana` tiene credencial válida
- WHEN corre `/login ana <password correcta>`
- THEN se abre una sesión para `ana` y la respuesta confirma que `ana` quedó logueada
- AND se crea una fila `comando='/login'`, `resultado='exitosa'`, `venta_id` y `caso_id` en `NULL`

#### Scenario: Login con contraseña incorrecta o id inexistente
- GIVEN `ana` existe con otra contraseña, y `zzz` no existe
- WHEN corre `/login ana <incorrecta>` y por separado `/login zzz <cualquiera>`
- THEN ambas respuestas son el mismo mensaje genérico
- AND ninguna abre sesión ni escribe fila
- AND se emite `login-fallido` con el `empleadoId` tipeado en cada caso

### Requirement: `resolverLogin` es puro, síncrono, y no expone la contraseña fuera de la verificación

`resolverLogin` SHALL ser una función pura y síncrona que recibe `verificarPassword` como dependencia inyectada. La contraseña SHALL NOT salir de la llamada a `verificarPassword` hacia ningún otro destino (log, fila, valor de retorno).

#### Scenario: Test de `resolverLogin` sin scrypt real
- GIVEN un doble `verificarPassword: vi.fn(() => false)`
- WHEN se llama `resolverLogin` con esa dependencia
- THEN el resultado es `{ resultado: "invalida" }` sin ninguna llamada a `node:crypto` ni a la base

### Requirement: La contraseña y el texto crudo de `/login` nunca se persisten ni se loguean

Ningún valor persistido en `credenciales_empleado` (fuera de `password_hash`) ni en `registro_acciones_empleado`, y ningún evento de `logTurnEvent` (incluidos `comando-empleado-recibido` y el registro de comando desconocido), SHALL contener la contraseña, un prefijo de ella, o su longitud, cuando el comando es `/login`. `logTurnEvent` SHALL recibir el `empleadoId` tipeado y SHALL NOT recibir el segundo argumento posicional del comando.

#### Scenario: Ningún rastro de la contraseña en filas ni eventos
- GIVEN un `/login` exitoso y uno fallido con distintas contraseñas
- WHEN se inspeccionan todas las filas de `registro_acciones_empleado` y todos los eventos emitidos durante ambos intentos
- THEN ninguno contiene la contraseña, un prefijo suyo, ni su longitud

### Requirement: Vigencia y expiración de la sesión por TTL absoluto

`sesionVigente(sesion, ahora)` SHALL ser un predicado puro. `resolveAuthConfig(env)` SHALL resolver `SESION_TTL_MINUTOS` (default 30) sin lanzar, acumulando errores ante un valor inválido. `SESION_TTL_MINUTOS = 0` SHALL significar sin expiración.

#### Scenario: Sesión vigente y vencida según TTL
- GIVEN una sesión abierta en `T` con `SESION_TTL_MINUTOS=30`
- WHEN se evalúa `sesionVigente` en `T+29m` y en `T+31m`
- THEN es vigente en `T+29m` y no vigente en `T+31m`

#### Scenario: TTL en cero nunca expira
- GIVEN `SESION_TTL_MINUTOS=0`
- WHEN pasa cualquier cantidad de tiempo desde el login
- THEN la sesión sigue vigente

#### Scenario: Configuración de TTL inválida no lanza
- GIVEN `SESION_TTL_MINUTOS` con un valor no numérico o negativo
- WHEN se llama `resolveAuthConfig(env)`
- THEN se devuelve un error acumulado sin lanzar una excepción

### Requirement: `/logout` cierra la sesión sin efecto sobre el dominio

`/logout` SHALL cerrar la sesión activa y SHALL NOT dejar fila en `registro_acciones_empleado`. Un comando privilegiado inmediatamente posterior a un `/logout` SHALL responder que hace falta `/login`, sin ningún efecto.

#### Scenario: Logout y comando privilegiado posterior
- GIVEN una sesión activa
- WHEN corre `/logout` y luego `/aprobar-reembolso v-1`
- THEN la sesión queda cerrada, sin fila por el `/logout`
- AND `/aprobar-reembolso v-1` responde que hace falta `/login` y no escribe nada

### Requirement: Los comandos privilegiados exigen sesión vigente y no producen ningún efecto sin ella

`/aprobar-reembolso`, `/rechazar-reembolso` y `/reabrir-reembolso` SHALL NOT ejecutar ninguna escritura en `ventas`, en `casos`, ni en `registro_acciones_empleado` cuando no hay sesión vigente. En ese caso SHALL responder que se requiere `/login` y SHALL emitir `comando-privilegiado-sin-sesion`.

#### Scenario: Sin sesión, los tres comandos privilegiados no tienen efecto
- GIVEN la TUI arrancó sin ningún `/login` previo
- WHEN se ejecutan `/aprobar-reembolso v-1`, `/rechazar-reembolso v-1` y `/reabrir-reembolso v-1`
- THEN ninguno modifica `ventas` ni `casos`
- AND ninguno crea fila en `registro_acciones_empleado`
- AND cada uno emite `comando-privilegiado-sin-sesion`

### Requirement: Los comandos públicos y el camino conversacional no dependen de sesión ni de `EMPLEADO_ID`

`/soporte`, `/devolucion`, `/ayuda` y el texto conversacional SHALL funcionar de forma idéntica exista o no una sesión activa. El sistema SHALL NOT leer la variable de entorno `EMPLEADO_ID` como fuente de identidad en ningún camino.

#### Scenario: La TUI arranca y opera igual sin ningún login
- GIVEN ninguna sesión activa y ninguna credencial dada de alta
- WHEN se ejecuta texto conversacional, `/soporte` y `/devolucion`
- THEN los tres funcionan igual que si hubiera una sesión activa
- AND ninguno consulta `EMPLEADO_ID`
