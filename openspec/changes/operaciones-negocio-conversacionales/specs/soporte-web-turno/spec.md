> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin shell disponible). Delta escrito contra `openspec/changes/tui-canal-empleado/specs/soporte-web-turno/spec.md` — versión vigente única, sin revisión posterior. Es el delta que `proposal.md` marcó como "seguro, nombrado por el propio código". Se copió COMPLETO el único requirement de esa spec (`### Requirement:` + su escenario) y se editó, workflow MODIFIED.

# Delta for Soporte Web Turno

## MODIFIED Requirements

### Requirement: El caso de uso de soporte de cliente es invocador-agnóstico entre canales de cliente — no entre `POST /soporte` y `/soporte` de la TUI

El comportamiento de crear un `caso` tipo `soporte` y resolver el turno reusando `CONVERSATIONAL_AGENT` con el prompt de **cliente** SHALL ser idéntico sin importar el canal de cliente anónimo usado (hoy, únicamente `POST /soporte`). **`/soporte` desde la TUI deja de ser un invocador de este caso de uso**: pasa a ser la entrada al turno de empleado autenticado (capability `turno-empleado-autenticado`, ADR 148 pto 6), un turno distinto con prompt distinto y con la herramienta `operaciones` disponible. Ningún requisito de esta capability SHALL seguir redactándose asumiendo que la TUI comparte este caso de uso.

(Previously: "El caso de uso de soporte es invocador-agnóstico... SHALL ser idéntico sin importar si el invocador es POST /soporte (HTTP) o /soporte desde la TUI". Esa equivalencia se rompe a propósito por este change — es la precondición de seguridad del ADR 146.)

#### Scenario: `POST /soporte` sigue siendo cliente, anónimo y sin la herramienta
- GIVEN un `POST /soporte` de un cliente sin identidad de empleado
- WHEN se resuelve el turno
- THEN se usa el prompt de cliente, sin la herramienta `operaciones` en la lista de tools

#### Scenario: `/soporte` de la TUI ya no ejecuta el mismo caso de uso que `POST /soporte`
- GIVEN un empleado con sesión vigente ejecuta `/soporte` desde la TUI
- WHEN se compara con un `POST /soporte` equivalente
- THEN los dos turnos usan prompts distintos y solo el de TUI tiene la herramienta `operaciones` disponible

## ADDED Requirements

### Requirement: La rama de cliente conserva sus dos líneas de seguridad sin cambio

`buildSoportePrompt` de cliente SHALL conservar, sin modificar su texto, las dos líneas que prohíben confirmar, cancelar o reembolsar y que exigen derivar a un humano (`soporte-prompt.ts:65,69`). Un test SHALL demostrar que el turno de cliente sigue sin poder ejecutar ninguna de esas tres acciones tras este change.

#### Scenario: El turno de cliente no puede confirmar, cancelar ni reembolsar tras este change
- GIVEN un `POST /soporte` de cliente pide "cancelame la venta"
- WHEN el turno se resuelve
- THEN la respuesta deriva a un humano, sin que ninguna venta cambie de estado
- AND el prompt usado contiene íntegras las dos líneas de seguridad de `:65` y `:69`
