> Nota de proceso: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Este ejecutor corrió sin herramienta de shell disponible. Delta escrito contra `openspec/changes/hito-1.3-ventas-comisiones/specs/soporte-web-turno/spec.md` (el spec archivado en `openspec/specs/` todavía no existe — solo `.gitkeep` — así que esa es la fuente de la versión "actual"), siguiendo `proposal.md` (`## Capabilities > Modified Capabilities`: "sin cambio de contrato ni de comportamiento... se lista para que sdd-spec verifique que el requisito sigue redactado en términos del caso de uso y no del transporte HTTP").

# Delta for Soporte Web Turno

## ADDED Requirements

### Requirement: El caso de uso de soporte es invocador-agnóstico

El comportamiento de crear un `caso` tipo `soporte` y resolver el turno reusando `CONVERSATIONAL_AGENT` SHALL ser idéntico sin importar si el invocador es `POST /soporte` (HTTP) o `/soporte` desde la TUI (capability `comando-empleado-tui`). Ningún requisito de esta capability SHALL redactarse en términos del transporte HTTP.

#### Scenario: Mismo comportamiento desde la TUI
- GIVEN `/soporte <consulta>` se ejecuta desde la TUI, reusando el mismo `buildOnSoporte` que sirve a `POST /soporte`
- WHEN se compara con una consulta equivalente vía `POST /soporte`
- THEN ambos crean un `caso` tipo `soporte`, invocan `CONVERSATIONAL_AGENT` con el mismo criterio, y devuelven la respuesta del agente
- AND no se duplica la construcción de `createKnowledge`
