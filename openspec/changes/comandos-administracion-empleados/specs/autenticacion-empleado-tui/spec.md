> Nota de proceso: mismo hook de graphify sin shell disponible. Delta escrito contra `openspec/changes/autorizacion-empleado/specs/autenticacion-empleado-tui/spec.md` — versión vigente (esa versión ya trae un `MODIFIED Purpose` sobre la línea de `Fuera de alcance`). La frase exacta que este change vuelve falsa es la del `## Purpose` original, heredada sin tocar hasta ahora: "alta y rotación de credenciales de empleado **por CLI**" — deja de ser cierta porque la TUI pasa a ser un segundo camino de alta (ADR 174). Se localiza y corrige, mismo criterio que `autorizacion-empleado` aplicó a la línea de `Fuera de alcance`.

# Delta for Autenticación Empleado TUI

## MODIFIED Purpose

Capability nueva (revisión 3, ADR 30-33). Cubre: alta y rotación de credenciales de empleado **por CLI o, desde ADR 174, por el comando `/crear-empleado` de la TUI** (`empleados:crear`, mismo hash y misma guarda de forma en ambos caminos), verificación de contraseña contra un hash scrypt en `/login`, apertura/cierre/vigencia de la sesión en memoria de la TUI, y la regla de qué comandos exigen esa sesión. Incluye los invariantes negativos de la contraseña: **nunca** se persiste en claro, **nunca** aparece en una fila de `registro_acciones_empleado`, **nunca** aparece en un evento de `logTurnEvent` — extendidos al comando `/crear-empleado` (ver requirement nuevo).

**Fuera de alcance de este spec**: roles y permisos sobre qué puede hacer un empleado logueado (capability `autorizacion-empleado`), desactivación de empleado, límite de intentos de login / rate limiting, recuperación de contraseña, enmascarado de la entrada en la TUI, sesión persistente entre reinicios o compartida entre procesos, autenticación del adaptador web, **el gate de rol `administrador` sobre `/crear-empleado` y `/asignar-rol` (capability `administracion-empleados-tui`)**.

(Previously — texto heredado de la versión de `autorizacion-empleado`, que ya había corregido la línea de `Fuera de alcance` para apuntar a `autorizacion-empleado` en vez de `reembolso-resolucion-escalacion`: la primera oración decía "alta y rotación de credenciales de empleado por CLI", afirmando implícitamente que el CLI era el único camino de alta — cierto hasta este change. `credenciales-contract.ts:14-17` sostenía la misma propiedad a nivel de contrato: *"la TUI no puede crear credenciales, y eso es una propiedad del diseño, no un olvido"*. ADR 174 revierte esa propiedad a pedido del stakeholder; el comentario del contrato pasa a apuntar a ese ADR. El resto del párrafo y de `Fuera de alcance` no cambian salvo agregar el gate de administrador como fuera de alcance de esta capability específica.)

Ningún `### Requirement` de autenticación en sí (verificación de `/login`, TTL de sesión, `/logout`, alta y rotación **por CLI**) cambia de cuerpo — ver requirement nuevo para el camino de alta por TUI.

## ADDED Requirements

### Requirement: Alta de credencial desde la TUI extiende, sin relajar, el invariante de no persistencia en claro

`/crear-empleado`, ejecutado por un `administrador` (capability `administracion-empleados-tui`), SHALL crear la credencial con el mismo `scryptSync` y sal aleatoria por fila que `empleados:crear`. La contraseña tipeada como argumento de este comando SHALL NOT persistirse en claro en ninguna columna, SHALL NOT aparecer en ninguna fila de `registro_acciones_empleado`, y SHALL NOT aparecer en ningún evento de `logTurnEvent` — mismo invariante, molde y test que ya cubre `/login` (`build-on-comando-empleado.test.ts:524`), extendido a este segundo comando.

#### Scenario: Ningún rastro de la contraseña tipeada en `/crear-empleado`
- GIVEN un `administrador` ejecuta `/crear-empleado ana <password>`
- WHEN se inspeccionan todas las filas de `registro_acciones_empleado` y todos los eventos emitidos durante el comando
- THEN ninguno contiene la contraseña, un prefijo suyo, ni su longitud
- AND `credenciales_empleado.password_hash` es el único lugar donde queda un derivado de esa contraseña

#### Scenario: El residual de visibilidad en el transcripto no es un incumplimiento de este invariante
- GIVEN que la contraseña tipeada aparece en el transcripto de la TUI (ADR 21 sin tocar, R1 aceptado)
- WHEN se evalúa este requirement
- THEN el invariante que sí se exige — no persistencia en claro, no fila de auditoría, no evento de log — se cumple igual, porque son dos superficies distintas (ADR 174 pto 2)
