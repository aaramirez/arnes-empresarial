> Nota de proceso: spec nueva, sin delta previo — verificado por `Glob`. Cubre ADR 174, 176, 177 de `proposal.md`. Es el invariante de composición, distinto en naturaleza de `consultas-negocio-a2a` (lógica pura vs. cableado), mismo criterio que `definicion-skills` separó `registro-skills` de `habilitacion-skills-turno`.

# Turno A2A Entrante Solo Lectura Specification

## Purpose

Capability nueva. El `mcpServers` del turno A2A entrante contiene exclusivamente servidores MCP de sólo lectura, y `BuildOnA2AEntranteDeps` — aun con nueve campos tras la enmienda del ADR 174 al ADR 98 — no gana ningún puerto de escritura. Ambas garantías están cubiertas por tests mecánicos, no por convención (ADR 176).

**Fuera de alcance de este spec**: el contrato de la tool en sí (schema, traducción, recorte de datos) — capability `consultas-negocio-a2a`.

## Requirements

### Requirement: `mcpServers` del turno entrante es exactamente `{conocimiento, consultas}` — conjunto cerrado, blindado por test de igualdad

El sistema SHALL componer el `mcpServers` del turno A2A entrante como la unión exacta del servidor de conocimiento y el servidor de consultas de negocio nuevo, y SHALL NOT incluir ningún otro servidor MCP, en particular `mcp__operaciones__*` del change `operaciones-negocio-conversacionales`. Existe un test mecánico de **igualdad de conjunto**, nunca `contains` (ADR 176 pto 2).

#### Scenario: El conjunto de `mcpServers` del turno entrante es exactamente dos
- GIVEN el composition root del turno A2A entrante para un caso cualquiera
- WHEN se inspecciona el `mcpServers` resultante
- THEN contiene exactamente los servidores de conocimiento y de consultas, y ningún otro

#### Scenario: El test falla si aparece el servidor de operaciones del change hermano
- GIVEN una versión hipotética de `build-on-a2a-entrante.ts` que agrega `mcp__operaciones__*` a su `mcpServers`
- WHEN corre el test de conjunto exacto del ADR 176
- THEN el test falla

#### Scenario: El servidor de operaciones no es alcanzable desde el turno entrante aunque comparta `allowedTools`
- GIVEN `CONVERSATIONAL_AGENT.allowedTools` incluye tanto `mcp__consultas__*` como `mcp__operaciones__*` (tras mergear el change hermano)
- WHEN se ejecuta un turno A2A entrante real y el modelo intenta invocar cualquier tool de `mcp__operaciones__*`
- THEN la invocación falla porque su servidor no está en el `mcpServers` de ese turno — no llega a ejecutar ninguna función de escritura

### Requirement: `BuildOnA2AEntranteDeps` tiene exactamente nueve campos, ninguno de escritura

El sistema SHALL exponer `BuildOnA2AEntranteDeps` con nueve campos: los ocho vigentes más `createConsultas: (casoId: string) => ConsultasNegocioAdapter` (ADR 174). Ninguno de los nueve campos SHALL ser un puerto de escritura del dominio: ni `VentaStorePort`, `ActivityStorePort`, `ActivityBoardPort`, `SolicitudStorePort`, `escritura`/`WorktreePort`, `ClienteA2APort`, `notifier` ni `KeyedQueue` (ADR 174 pto 4, ADR 177).

#### Scenario: La firma tiene exactamente nueve campos, ninguno de escritura
- GIVEN la firma de `BuildOnA2AEntranteDeps`
- WHEN se cuenta y se inspecciona cada campo
- THEN son exactamente nueve y ninguno es un puerto de escritura del dominio

#### Scenario: `createConsultas` devuelve un adaptador sin método con efecto
- GIVEN el adaptador devuelto por `createConsultas(casoId)`
- WHEN se inspeccionan sus puertos de consulta subyacentes
- THEN ninguno expone un método que cree, modifique, apruebe, rechace o cancele una entidad de negocio

### Requirement: El módulo de composición no gana ningún import de escritura

El test de lista de imports de `build-on-a2a-entrante.ts` (heredado del ADR 98 pto 3) SHALL crecer de forma aditiva y nombrada con el import de `createConsultas`, y SHALL NOT relajarse a `contains`.

#### Scenario: El import nuevo es nombrado y aditivo
- GIVEN la lista de imports esperada de `build-on-a2a-entrante.ts` antes de este change
- WHEN se agrega el import de `createConsultas`
- THEN la lista sigue siendo una aserción de igualdad exacta, con el import nuevo nombrado explícitamente
