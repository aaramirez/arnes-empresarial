> Base verificada: `openspec/specs/` sólo tiene `.gitkeep`. La capability nace en `hito-2.0-delegacion-subagentes/specs/delegacion-subagentes/spec.md` (su requirement *"Tres `AgentDefinition` reales, con `description` obligatorio"*, `:50`, es el que le da a esta capability la propiedad de `definitions.ts`) y `hito-2.1-escritura-delegada/specs/delegacion-subagentes/spec.md` modifica el de `allowedTools`. Este delta sólo **agrega** un requirement; no toca ninguno de los existentes. **Para `sdd-archive`**: ADDED sobre la capability ya fusionada (hito-2.0 + MODIFIED de hito-2.1). Los tres constructores de prompt del núcleo que se nombran abajo no aparecen en ningún spec vigente (`rg "buildSoportePrompt|buildOperacionesEmpleadoPrompt|buildSolicitudA2APrompt" openspec/changes/*/specs` vacío); este requirement no cambia su comportamiento, sólo los incluye en la misma guarda. Sin shell ni `graphify query` en este ejecutor.

# Delta for Delegación a Subagentes

## ADDED Requirements

### Requirement: Ningún texto fijo de agente del núcleo nombra un comando que no existe

Todo texto fijo que el núcleo le entrega al modelo como definición de agente o como prompt de turno SHALL nombrar sólo comandos de la TUI que estén en el registro de comandos vigente (`COMANDOS`). El inventario cubierto SHALL ser: la `description` y el `systemPrompt` de cada agente de `listAgentDefinitions()` y de `listSubagentDefinitions()`, de `construirAgenteEmpleadoOperaciones()` y de `construirDeveloperConEscritura(...)`; y la salida de `buildSoportePrompt`, `buildOperacionesEmpleadoPrompt` y `buildSolicitudA2APrompt` con una consulta de prueba inerte. Un test SHALL verificarlo en cada corrida de la suite. Un token con forma de comando SHALL ser una barra seguida de una palabra en minúsculas, dígitos o guiones, que no viene inmediatamente después de una letra, un dígito, `_`, `.`, `/` ni `~`. Así, rutas (`src/core`, `./x.js`, `../x`), URLs y alternativas (`y/o`) no cuentan como comandos. Si un texto legítimo produce un falso positivo, el texto SHALL reformularse; la definición del token SHALL NOT aflojarse para ese caso. El contenido variable que aporta el usuario (detalle de una solicitud, consulta, texto A2A) queda fuera de este requirement.

#### Scenario: El inventario completo pasa la guarda
- GIVEN las diez fuentes del inventario (diecisiete textos: `description` y `systemPrompt` de siete agentes, más la salida de tres constructores)
- WHEN se extraen sus tokens con forma de comando
- THEN cada token es el `nombre` de un descriptor de `COMANDOS`

#### Scenario: La guarda no es vacía
- GIVEN el inventario que recorre el test
- WHEN se cuenta
- THEN tiene exactamente diez fuentes con id distinto y diecisiete textos, y ninguno está vacío

#### Scenario: Un comando retirado pone la guarda en rojo
- GIVEN un `systemPrompt` que nombra `/aprobar-solicitud`
- WHEN corre la guarda
- THEN falla e informa el id del texto y el token

#### Scenario: Rutas, URLs y alternativas no son comandos
- GIVEN los textos `src/core/agents`, `./activity-contract.js`, `../commands`, `https://example.com/aprobar`, `y/o`, `` `Write`/`Edit` `` y `~/datos`
- WHEN se extraen los tokens con forma de comando
- THEN no se extrae ninguno

#### Scenario: Un comando vigente con dígitos se reconoce completo
- GIVEN el texto `usá /ver-solicitudes-a2a para verlas`
- WHEN se extraen los tokens
- THEN el único token es `/ver-solicitudes-a2a`, y está en `COMANDOS`
