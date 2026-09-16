> Nota de proceso: delta sobre `openspec/changes/hito-3.0-a2a-servidor/specs/servidor-a2a-jsonrpc/spec.md` — la capability real donde vive el requirement del Agent Card (verificado por `Grep`: no existe ninguna capability `agent-card-a2a` en el repo; `proposal.md` marca ese nombre como "a verificar", y el nombre correcto, verificado, es `servidor-a2a-jsonrpc`). Se copió COMPLETO el requirement afectado (`### Requirement:` + sus tres escenarios), verificado línea por línea contra `hito-3.0-a2a-servidor/specs/servidor-a2a-jsonrpc/spec.md:13-30`. Cubre ADR 179.

# Delta for Servidor A2A JSON-RPC

## MODIFIED Requirements

### Requirement: El Agent Card se publica en la URL bien conocida, público y sin autenticación, y enumera exactamente las capacidades reales del turno

El servidor SHALL servir `GET /.well-known/agent-card.json` sin exigir `Authorization`, con `name`, `description`, `version`, `capabilities` con `streaming`/`pushNotifications`/`extendedAgentCard` las tres en `false` explícitamente, `defaultInputModes`/`defaultOutputModes` en `["text/plain"]`, exactamente **una** `skill`, `securitySchemes` declarando un esquema HTTP bearer, y `supportedInterfaces` con **una** entrada de transporte JSON-RPC apuntando a `HARNESS_A2A_ENTRANTE_PUBLIC_URL` (ADR 92, ADR 88 punto 5). `description`, la `description` de la skill y sus `examples` SHALL enumerar **exactamente** las capacidades que el turno puede cumplir en ese momento — hoy, tras este change: estado de proyectos/actividades vía PR o referencia, solicitudes internas pendientes, y ventas/comisiones/reembolsos. El card SHALL NOT prometer una capacidad sin una superficie de datos real que la respalde; en particular, SHALL NOT mencionar "incidentes" mientras no exista una entidad de dominio identificada para ese término (ADR 179 pto 1, RD-84). El tag `"solo-lectura"` (o frase equivalente) SHALL conservarse sin cambio (ADR 96 pto 3). El test literal del card (ADR 96 pto 1, comparación contra objeto completo) SHALL actualizarse en el mismo commit que cualquier cambio de estos campos.

(Previously: el requirement fijaba la forma estructural del card [campos presentes, capabilities en `false`, una skill, una interfaz] sin ninguna restricción sobre el contenido semántico de `description`/`examples`. Esta versión agrega esa restricción — el contenido debe ser exacto y respaldado — porque hoy el card promete "incidentes", "actividades de desarrollo" y "ventas registradas" sin que el turno pudiera cumplir ninguna de las tres antes de este change, deuda documentada en `proposal.md` Aclaración 3.)

#### Scenario: El card se sirve sin `Authorization`
- GIVEN el servidor A2A corriendo con un token configurado
- WHEN se hace `GET /.well-known/agent-card.json` sin header `Authorization`
- THEN la respuesta es `200` con el card completo, no `401`

#### Scenario: Las tres `capabilities` están declaradas en `false`, no omitidas
- GIVEN el card servido
- WHEN se inspecciona el campo `capabilities`
- THEN `streaming`, `pushNotifications` y `extendedAgentCard` están presentes y en `false`, ninguno ausente

#### Scenario: `supportedInterfaces` declara una única entrada JSON-RPC
- GIVEN el card servido
- WHEN se inspecciona `supportedInterfaces`
- THEN hay exactamente una entrada con transporte JSON-RPC apuntando a la URL pública configurada

#### Scenario: Ninguna promesa del card carece de una operación real que la respalde
- GIVEN el card corregido de este change y las cuatro operaciones de `consultar_negocio`
- WHEN se compara cada frase de `description`/`examples` contra las operaciones existentes
- THEN cada una es literalmente respondible por una de las cuatro, y ninguna menciona "incidentes" ni ninguna otra entidad sin superficie de datos

#### Scenario: El card ya no promete "incidentes"
- GIVEN el card servido tras este change
- WHEN se inspeccionan `description`, la `description` de la skill y sus `examples`
- THEN ninguno contiene la palabra "incidentes" ni un ejemplo equivalente, salvo que RD-84 haya identificado una entidad real que lo respalde
