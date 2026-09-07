> Nota de proceso: mismo criterio sin herramienta de shell disponible documentado en `despacho-delegacion/spec.md`. Este spec se apoya en `proposal.md` (ADR 44), el Plan (líneas 293, 308-320) y `src/core/agents/definitions.ts` / `src/core/turn-selector/invoke-model.ts` como código real verificado.

# Delegación a Subagentes Specification

## Purpose

Capability nueva. Cubre el bloque 2.2 del arc42: la construcción del `tarea_delegada` acotado por rol, la invocación in-process de un subagente contra su propia `AgentDefinition`, y la devolución del resultado al Despachador (`despacho-delegacion`). El aislamiento de contexto del subagente NO se implementa en este módulo — es el comportamiento default del SDK (contexto fresco, solo el prompt de la tarea delegada más su propio system prompt), y esta capability lo aprovecha en vez de reconstruirlo.

**Fuera de alcance de este spec**: resolución del destino de la delegación y manejo del brazo A2A (capability `despacho-delegacion`); delegación anidada (un subagente que delega a otro); interceptar un `tool_use` de delegación emitido por el modelo; reintentos o presupuesto de tokens por subagente.

## Requirements

### Requirement: `tarea_delegada` contiene solo la tarea, nunca el historial del padre

El sistema SHALL construir `tarea_delegada` como texto acotado a la tarea específica del rol invocado. El sistema SHALL NOT incluir en `tarea_delegada` el historial de conversación del agente padre, ni sus resultados de herramientas, ni su system prompt.

#### Scenario: `tarea_delegada` del Developer no contiene el historial del Planner
- GIVEN el Planner ya produjo su salida para un PR
- WHEN el Despachador construye la `tarea_delegada` del Developer
- THEN el texto persistido en `delegaciones.tarea_delegada` contiene únicamente la tarea acotada para el Developer (incluida la salida relevante del Planner que se decide pasar explícitamente)
- AND no contiene el system prompt del Planner ni mensajes de su sesión

### Requirement: Invocación in-process contra la `AgentDefinition` propia del rol

El sistema SHALL invocar cada subagente in-process usando su propia `AgentDefinition` (system prompt, `allowedTools`, modelo), registrada en `options.agents`. La invocación SHALL producir una sesión propia, distinta de la sesión del agente padre.

#### Scenario: El Reviewer se invoca con su propio `allowedTools`
- GIVEN el rol `reviewer` tiene `allowedTools` distinto del rol `developer`
- WHEN el Despachador invoca al subagente `reviewer`
- THEN la invocación usa el `allowedTools` propio del Reviewer, no el del Developer ni el del agente padre

### Requirement: El resultado del subagente vuelve al Despachador sin transformación de negocio

Tras completarse la invocación, el sistema SHALL devolver el resultado (texto de respuesta) al Despachador para que complete la fila de `delegaciones`. Este módulo SHALL NOT decidir transiciones de estado ni parsear veredictos — esa responsabilidad pertenece al orquestador de actividad (`revision-pr-por-roles`).

#### Scenario: Falla de la invocación propaga sin ser tragada
- GIVEN la invocación del subagente rechaza (falla del modelo o del SDK)
- WHEN este módulo recibe el rechazo
- THEN el error propaga hacia el Despachador sin capturarlo ni sustituirlo por un resultado degradado

### Requirement: Un solo nivel de profundidad de delegación

El sistema SHALL soportar exactamente un nivel de delegación: un subagente invocado por este módulo SHALL NOT delegar a su vez a otro subagente dentro del alcance de este hito.

#### Scenario: Un subagente no tiene mecanismo para delegar
- GIVEN un subagente de rol (`planner`, `developer` o `reviewer`) está corriendo
- WHEN se construye su `AgentDefinition`
- THEN su configuración no incluye una vía para invocar la tool `Agent` hacia otro subagente

### Requirement: Tres `AgentDefinition` reales, con `description` obligatorio

El registro de agentes (`definitions.ts`) SHALL declarar tres `AgentDefinition` reales — `planner`, `developer`, `reviewer` — cada uno con `systemPrompt`, `allowedTools` y **`description: string` obligatorio**. `CONVERSATIONAL_AGENT` SHALL conservar su comportamiento actual sin cambios (system prompt, `allowedTools`, ausencia de delegación).

#### Scenario: `options.agents` registra el padre y los tres roles
- GIVEN el registro de agentes incluye `planner`, `developer`, `reviewer` y `CONVERSATIONAL_AGENT`
- WHEN `toQueryOptions` arma las opciones de la invocación
- THEN `options.agents` contiene una entrada por cada uno de los cuatro, cada una con su propio `description`

#### Scenario: `CONVERSATIONAL_AGENT` no gana `allowedTools` de delegación
- GIVEN la TUI conversacional invoca a `CONVERSATIONAL_AGENT`
- WHEN se arma su configuración de invocación
- THEN su `allowedTools` es idéntico al de `v1.4.0`, sin ninguna tool de delegación agregada

### Requirement: `allowedTools` acotado por rol, coherente con ADR 4

Cada rol SHALL declarar su propio `allowedTools`, recortado a lo que ese rol necesita. El sistema SHALL NOT otorgar al Planner o al Developer las mismas herramientas que al Reviewer sin una justificación de caso de uso — otorgar una herramienta sigue siendo auto-aprobarla sin confirmación humana por llamada (ADR 4).

#### Scenario: El Planner no tiene herramientas de escritura
- GIVEN el rol `planner` solo necesita leer y analizar el PR
- WHEN se define su `AgentDefinition`
- THEN su `allowedTools` no incluye herramientas de escritura de archivos ni de ejecución de comandos destructivos

### Requirement: `toMainThreadAgentDescription` se retira; el doc-comment de `invoke-model.ts` se actualiza

Con más de un agente registrado, `description` deja de ser un placeholder de bajo riesgo. El sistema SHALL eliminar `toMainThreadAgentDescription` de `invoke-model.ts` y SHALL derivar `description` desde el campo obligatorio de `AgentDefinition`. El doc-comment de `invoke-model.ts` que afirma que "ningún code path lee este string para tomar una decisión de ruteo" SHALL actualizarse para reflejar que, con subagentes reales, `description` sí es dato de ruteo.

#### Scenario: `toMainThreadAgentDescription` ya no existe
- GIVEN el módulo `invoke-model.ts` de este hito
- WHEN se busca el símbolo `toMainThreadAgentDescription`
- THEN no existe ninguna referencia a esa función en el código ni en sus tests

#### Scenario: `toSdkAgentDefinition` usa el `description` del núcleo
- GIVEN un `AgentDefinition` del núcleo con su campo `description` propio
- WHEN se mapea a la forma del SDK (`SdkAgentDefinition`)
- THEN el `description` resultante es el declarado en `definitions.ts`, no uno sintetizado a partir del `id`
