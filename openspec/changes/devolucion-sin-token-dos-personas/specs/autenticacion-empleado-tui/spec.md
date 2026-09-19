> Nota de proceso: mismo hook de graphify documentado en `proposal.md` (sin herramienta de shell en este ejecutor). Delta escrito contra `openspec/changes/tui-canal-empleado/specs/autenticacion-empleado-tui/spec.md` — última versión que declaró el cuerpo completo de este requirement (los deltas posteriores de `autorizacion-empleado` y `comandos-administracion-empleados` sólo tocaron el párrafo de `Fuera de alcance`, no este requirement). ADR 226: cambia el CRITERIO de vencimiento —de TTL absoluto a inactividad con tope absoluto— no solo el número, molde `Previously` igual que el resto de la serie.

# Delta for Autenticación Empleado TUI

## MODIFIED Requirements

### Requirement: Vigencia y expiración de la sesión por INACTIVIDAD, con TOPE ABSOLUTO

`sesionVigente(sesion, ahora)` SHALL ser un predicado puro. `resolveAuthConfig(env)` SHALL resolver dos variables: una de inactividad (`SESION_TTL_MINUTOS`, default 30, renovada con cada request autenticado) y una de tope absoluto desde el login (nombre y default exactos: RD-111), ambas sin lanzar, acumulando errores ante un valor inválido. `0` SHALL significar sin expiración, en cada una de las dos variables por separado. El tope absoluto SHALL expirar la sesión aunque se la esté usando activamente; la variable de inactividad SHALL NOT expirar una sesión en uso.

(Previously: `sesionVigente` evaluaba un único TTL absoluto sellado en el login — `iniciadaEn + ttlMinutos`, calculado una sola vez, sin renovarse nunca. Una sesión en uso podía vencer en medio de una conversación de soporte, aunque el empleado la estuviera usando activamente. Este change reemplaza ese criterio: ahora hacen falta dos preguntas independientes —"¿hace cuánto no se usa?" y "¿hace cuánto se abrió?"— y la primera es la que expulsaba al empleado sin necesidad.)

#### Scenario: Una sesión en uso no expira por inactividad
- GIVEN una sesión abierta con la variable de inactividad en su default
- WHEN el empleado sigue enviando requests autenticados antes de que venza esa ventana, en una conversación continua
- THEN la sesión sigue vigente en cada request, renovada por la actividad

#### Scenario: Una sesión ociosa expira igual que hoy
- GIVEN una sesión abierta sin ningún request posterior
- WHEN pasa más tiempo que la variable de inactividad
- THEN la sesión deja de estar vigente

#### Scenario: El tope absoluto expira la sesión aunque se la esté usando
- GIVEN una sesión que se renueva por actividad continua más allá del tope absoluto desde el login
- WHEN se evalúa `sesionVigente` pasado ese tope
- THEN la sesión no está vigente, sin importar cuán reciente fue el último request

#### Scenario: `0` sigue significando sin expiración en cada variable por separado
- GIVEN la variable de inactividad en `0` y el tope absoluto con un valor normal, o viceversa
- WHEN se evalúa `sesionVigente` en cualquier momento
- THEN la variable en `0` nunca por sí sola expira la sesión; la otra variable, si no está en `0`, sigue aplicando

#### Scenario: Configuración inválida en cualquiera de las dos variables no lanza
- GIVEN cualquiera de las dos variables con un valor no numérico o negativo
- WHEN se llama `resolveAuthConfig(env)`
- THEN se devuelve un error acumulado sin lanzar una excepción
