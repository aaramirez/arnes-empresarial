> Nota de proceso: mismo hook de graphify aplica; sin herramienta de shell disponible en este ejecutor, no se pudo correr `graphify query`/`explain`. Delta basado en `proposal.md` (ADR 5, *Consecuencias*, hallazgo R1) y en `openspec/changes/hito-1.1-consulta-conocimiento/specs/knowledge/spec.md` (spec base de la capability existente).

# Delta for Knowledge Query

**Esto es una MODIFICACIÓN de la capability `knowledge-query` ya existente (Hito 2), no una capability nueva.** El contrato de la tool `query_knowledge_base` y del `KnowledgeFeedbackPort` NO cambia — ningún requisito del spec base de `hito-1.1-consulta-conocimiento/specs/knowledge/spec.md` se reemplaza. Lo que cambia es el ciclo de vida del adaptador: pasa de instanciarse una vez por proceso a una vez por `caso`, para eliminar el cruce de citas entre turnos concurrentes (bug latente, R1 de la propuesta de este hito). Por eso este delta usa `ADDED Requirements` — agrega una garantía observable nueva sobre concurrencia, sin editar el texto de los requisitos existentes.

**Fuera de alcance de este delta**: cualquier cambio al contrato de `query_knowledge_base`, a `CitedNodesRecorder`, o al mecanismo de `graphify save-result` — todos siguen intactos tal como los describe el spec base.

## ADDED Requirements

### Requirement: Aislamiento de citas entre turnos concurrentes

El adaptador de conocimiento SHALL instanciarse una vez por `caso` (no una vez por proceso). Cada instancia SHALL tener su propio `CitedNodesRecorder`, de modo que las citas registradas por un turno NUNCA sean visibles ni drenadas por `saveTurnResult` de otro turno concurrente.

#### Scenario: Dos turnos concurrentes no cruzan citas
- GIVEN un turno de webhook y un turno de TUI se resuelven de forma concurrente, cada uno consultando `query_knowledge_base` con preguntas distintas
- WHEN ambos turnos concluyen y cada uno invoca `saveTurnResult`
- THEN las citas drenadas para el turno de webhook corresponden únicamente a los nodos consultados por ese turno
- AND las citas drenadas para el turno de TUI corresponden únicamente a los nodos consultados por ese turno
- AND ningún nodo citado por un turno aparece en el resultado guardado del otro

#### Scenario: Turno aislado no ve estado residual de un turno anterior
- GIVEN un turno previo del mismo proceso ya citó nodos y completó `saveTurnResult`
- WHEN un turno nuevo (para otro `caso`) invoca `query_knowledge_base`
- THEN el `CitedNodesRecorder` del turno nuevo comienza vacío, sin citas heredadas del turno anterior

### Requirement: Costo de instanciación por caso no degrada el turno

Instanciar el adaptador de conocimiento por `caso` (en vez de por proceso) SHALL NOT introducir un efecto global compartido entre instancias (por ejemplo, un servidor MCP singleton o estado de módulo mutable fuera del propio `caso`).

#### Scenario: Instancias independientes sin estado compartido
- GIVEN se crean dos instancias del adaptador de conocimiento para dos `caso`s distintos en el mismo proceso
- WHEN ambas se usan de forma concurrente
- THEN ninguna operación de una instancia observa o modifica el estado interno de la otra
