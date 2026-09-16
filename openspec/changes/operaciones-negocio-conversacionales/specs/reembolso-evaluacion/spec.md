> Nota de proceso: mismo hook de graphify que documenta `proposal.md` (sin shell disponible). Delta escrito contra `openspec/changes/tui-canal-empleado/specs/reembolso-evaluacion/spec.md` — versión vigente. **Hallazgo de esta fase, no anticipado por `proposal.md`**: esta capability NO figuraba en la lista de "Modified Capabilities > candidatas" del proposal, pero tiene un requirement estructuralmente idéntico al de `soporte-web-turno` que sí fue marcado como delta seguro — "El caso de uso de devolución es invocador-agnóstico... SHALL ser idéntico sin importar si el invocador es POST /devolucion (HTTP) o /devolucion desde la TUI" — exhaustivo sobre canal, estilo exacto que el criterio de `proposal.md` exige verificar. `/devolucion` de la TUI es una de las tres bajas firmes (ADR 148 pto 2), así que esa equivalencia queda rota igual que en `soporte-web-turno`. Es la instancia concreta de R9 ("aparecen deltas no previstos") — se reporta como riesgo al orquestador.

# Delta for Reembolso Evaluación

## MODIFIED Requirements

### Requirement: El caso de uso de devolución es invocador-agnóstico entre `POST /devolucion` y la herramienta — no entre `POST /devolucion` y `/devolucion` de la TUI

El comportamiento de `procesarDevolucion` (auto-aprobación bajo el umbral, escalación sobre el umbral) SHALL ser idéntico sin importar si el invocador es `POST /devolucion` (HTTP) o la operación `procesar_devolucion` de la herramienta `operaciones` (capability `herramienta-operaciones-negocio`) desde un turno de empleado autenticado. **`/devolucion` desde la TUI deja de existir** como invocador tras este change (ADR 148 pto 2) — ningún requisito de esta capability SHALL seguir redactándose asumiendo ese comando.

(Previously: la equivalencia se afirmaba entre `POST /devolucion` y `/devolucion` de la TUI. Ese segundo invocador se quita; el nuevo invocador equivalente es la herramienta conversacional, no un comando.)

#### Scenario: Mismo comportamiento desde la herramienta que desde HTTP
- GIVEN `procesar_devolucion` se invoca desde la herramienta sobre una venta bajo el umbral, y una solicitud equivalente vía `POST /devolucion`
- WHEN se comparan ambos caminos
- THEN los dos dejan la venta en `reembolsada` con la misma secuencia y las mismas guardas

#### Scenario: `/devolucion` ya no se reconoce como comando de la TUI
- GIVEN el texto `/devolucion <token>` en la TUI tras este change
- WHEN `parsearComando` lo procesa
- THEN no matchea ningún comando — la única vía conversacional es la herramienta `operaciones`

### Requirement: Devolución requiere una venta confirmada

`POST /devolucion` y la operación `procesar_devolucion` de la herramienta `operaciones` SHALL operar únicamente sobre ventas con `estado = 'confirmada'`. Sobre cualquier otro estado — incluido `reembolso_rechazado` — SHALL rechazar sin efecto.

(Previously: mencionaba "/devolucion desde la TUI, mismo caso de uso — capability comando-empleado-tui" como segundo invocador; ese comando se quita y el segundo invocador pasa a ser la herramienta.)

#### Scenario: Devolución sobre venta no confirmada
- GIVEN una venta en `pendiente_confirmacion` o `rechazada`
- WHEN llega una solicitud de devolución (HTTP o herramienta) para esa venta
- THEN se rechaza sin efecto
- AND `ventas.estado` no cambia

#### Scenario: Devolución sobre una escalación ya rechazada no reabre nada
- GIVEN una venta en `reembolso_rechazado`
- WHEN llega una solicitud de devolución (HTTP o herramienta) para esa venta
- THEN se rechaza con `no_aplicable`, sin efecto
- AND la única forma de moverla de `reembolso_rechazado` sigue siendo `/reabrir-reembolso` (capability `reembolso-resolucion-escalacion`, sin cambio en este change)
