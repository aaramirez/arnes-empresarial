# Plantilla

Enero 2023

**Acerca de arc42**

arc42, La plantilla de documentación para arquitectura de sistemas y de software.

Por Dr. Gernot Starke, Dr. Peter Hruschka y otros contribuyentes.

Revisión de la plantilla: 7.0 ES (basada en asciidoc), Enero 2017

© Reconocemos que este documento utiliza material de la plantilla de arquitectura arc42, [https://www.arc42.org](https://www.arc42.org). Creada por Dr. Peter Hruschka y Dr. Gernot Starke.

# Introducción y Metas

## Vista de Requerimientos

Objetivo general: implementar un arnés básico con memoria compartida para correr agentes de IA multi-turno en un ambiente empresarial.

Objetivos específicos:

- Realizar un estudio comparativo de los arneses existentes e identificar las funcionalidades principales, diferenciación y herramientas disponibles.

- Realizar una investigación sobre los lenguajes existentes para programar con el Claude Agent SDK y comparar las funcionalidades disponibles para decidir el lenguaje a utilizar.

- Identificar las librerías existentes para implementar interfaces de usuario a través del terminal (TUI).

- Investigar sobre el funcionamiento exacto del Claude Agent SDK, mensajes y flujos principales.

- Crear base de conocimiento en Obsidian con el resultado de toda la investigación y dejar disponible a los modelos a través de Graphify.

- Crear el arnés básico con TUI que maneje:

- Definición de agentes, sub agentes

- Definición de comandos

- Definición de hooks

- Definición de Skills

- Comunicación entre agentes A2A

- Crear agentes que modelen distintas arquitecturas de agentes aplicado a problemas reales en las empresas.

## Metas de Calidad

| Meta de calidad | Categoría (ISO/IEC 25010) | Motivación |
| --- | --- | --- |
| Extensibilidad del núcleo | Mantenibilidad | El catálogo de agentes y arquitecturas soportadas crecerá de forma incremental; el núcleo debe absorber nuevas implementaciones sin requerir cambios estructurales. |
| Corrección funcional multi-turno | Fiabilidad / Adecuación funcional | El sistema gestiona conversaciones de múltiples turnos con memoria compartida entre agentes; el aislamiento correcto del contexto por agente es un requisito funcional, no opcional. |
| Observabilidad de las respuestas | Mantenibilidad | Cada respuesta debe poder trazarse a la fuente consultada y a la herramienta invocada — condición necesaria para operar el sistema en un entorno empresarial. |
| Operabilidad local | Portabilidad | El arnés debe desplegarse y ejecutarse sin infraestructura adicional, reduciendo el costo de puesta en marcha y mantenimiento. |
| Usabilidad de la interfaz operativa (TUI) | Usabilidad | La interfaz de terminal es un entregable explícito del alcance (objetivos 3 y 6); debe dar retroalimentación clara del estado del agente y tener una curva de aprendizaje baja para quien la opera. |
| Interoperabilidad vía A2A | Compatibilidad | La comunicación entre agentes se implementa sobre el protocolo A2A, diseñado justamente para interoperar con agentes de otros orígenes — no es lo mismo que la extensibilidad interna del núcleo. |

## Partes interesadas (Stakeholders)

| Rol/Nombre | Contacto | Expectativas |
| --- | --- | --- |
| Tutor Empresarial | Alexander Ramirez/ ar@conectados.ai | Diseño antes de código, resultados versionados, arquitectura con módulos e interfaces claras |
| Desarrollador | Jimmy Fung /jimmyfung14@gmail.com | Un arnés reutilizable donde, terminado el MVP, puedas agregar nuevos agentes/arquitecturas sin reescribir el núcleo |

# Restricciones de la Arquitectura

## Restricciones Organizacionales

| Restricción | Origen |
| --- | --- |
| Duración fija de una pasantía corta | Limita el alcance a un "arnés básico", no a una plataforma empresarial completa — es la razón de fondo por la que se descarta la gobernanza/multi-tenencia en las metas de calidad. |
| El diseño precede a la implementación, con versionamiento semántico y tags en GitHub | Exigencia explícita por el tutor empresarial. |
| Desarrollo individual (un solo desarrollador) | Acota el tamaño razonable de cada hito — no hay paralelización de equipo |
| El repositorio debe mostrar el proceso de construcción paso a paso, componente por componente, con un directorio de progreso por cada versión de funcionalidad cerrada (docs/progreso/vX.Y-nombre/, alineado a los tags de git) | Exigencia explícita del tutor empresarial. |

## Restricciones Técnicas

| Restricción | Origen |
| --- | --- |
| Lenguaje: TypeScript sobre Node.js | Decidido en el objetivo específico 2 del alcance, además de descartar Go por falta de compatibilidad con la SDK de Claude. |
| Motor y proveedor de modelo: Claude Agent SDK (Anthropic) | Mandado por el alcance para el MVP; no descarta incorporar otros proveedores en iteraciones posteriores. |
| Interfaz: TUI vía Ink | Objetivos específicos 3 y 6 del alcance |
| Base de conocimiento: Obsidian indexado con Graphify | Objetivo específico 5 del alcance |
| Comunicación entre agentes: protocolo A2A | Objetivo específico 6 del alcance |
| Persistencia de memoria compartida: SQLite (embebido, sin servidor) | Sostiene el requisito de "memoria compartida" del objetivo general sin contradecir la meta de Operabilidad local; Postgres/Redis/Qdrant quedan fuera de este MVP. |

# Alcance y Contexto del Sistema

## Contexto de Negocio

![contexto-negocio.png](arc42_media/contexto-negocio.png)

**Explicación**: el empleado formula una consulta y espera una respuesta correcta y trazable. La base de conocimiento contiene políticas y procedimientos internos (sintéticos, para esta fase). El proveedor de modelo aporta el razonamiento; el arnés depende de su disponibilidad. Los otros agentes participan cuando el escenario requiere coordinación.

Este primer escenario de consulta de políticas es el punto de partida del objetivo específico 7 (agentes que modelan distintas arquitecturas aplicadas a problemas reales); iteraciones posteriores a este MVP agregarán agentes para otros problemas empresariales, sobre las variantes swarm y grafo que ya prevé la Vista de Bloques.

## Contexto Técnico

![contexto-tecnico.png](arc42_media/contexto-tecnico.png)

| Entrada/Salida | Canal | Formato |
| --- | --- | --- |
| Consulta del empleado | TUI (teclado) | Texto en lenguaje natural |
| Respuesta del agente | TUI (pantalla) | Texto renderizado + fuente citada |
| Consulta a la base de conocimiento | MCP (servidor propio) → CLI de Graphify | Texto plano estructurado. |
| Llamada al modelo | Claude Agent SDK → Anthropic API | HTTPS / Messages API |
| Mensaje entre agentes | A2A | JSON-RPC |

# Estrategia de solución

La estrategia de solución combina un motor de razonamiento mínimo (Claude Agent SDK) con una arquitectura de puertos y adaptadores: el núcleo desconoce los detalles de la interfaz de usuario, la persistencia o la comunicación con otros agentes, y se conecta a cada uno a través de un contrato explícito. Esto prioriza la extensión futura sobre la completitud inmediata — coherente con el alcance de un MVP de pasantía corta.

## Decisiones estratégicas

| Decisión | Justificación |
| --- | --- |
| Arquitectura hexagonal (puertos y adaptadores) | Sostiene la Meta 1 (Extensibilidad): el núcleo de razonamiento queda desacoplado de TUI, persistencia, conocimiento y comunicación entre agentes — cada uno es un adaptador reemplazable. |
| Claude Agent SDK como motor, sin abstracción de proveedor en el MVP | Mandado por el alcance (Restricción técnica); el puerto de proveedor de modelo se define en la Vista de Bloques para no bloquear una extensión futura, aunque solo se implemente un adaptador (Claude) por ahora. |
| TUI como única interfaz de usuario | Objetivos 3 y 6 del alcance; sostiene la Meta 5 (Usabilidad) sin la complejidad de una capa web que el alcance no pide. |
| Persistencia embebida (SQLite), no infraestructura de servidor | Sostiene la Meta 4 (Operabilidad local) sin sacrificar el requisito de memoria compartida del objetivo general. |
| Conocimiento delegado a Graphify, sin base vectorial propia | Evita resolver dos veces el mismo problema de recuperación; reutiliza una herramienta que ya es objetivo específico del alcance. |
| Comunicación entre agentes vía protocolo A2A estándar | Sostiene la Meta 6 (Interoperabilidad): permite que agentes de otro origen participen sin adaptación especial, no un bus propietario. |

# Vista de Bloques

## Sistema General de Caja Blanca

![vista-bloques-nivel1.png](arc42_media/vista-bloques-nivel1.png)

Motivación: el arnés se organiza como un núcleo rodeado de cuatro adaptadores intercambiables — la arquitectura hexagonal que declaramos en la Sección 4. Cada adaptador traduce entre el lenguaje del núcleo y el sistema externo con el que habla

Bloques de construcción contenidos

El sistema completo se descompone en cinco bloques: un núcleo de orquestación y cuatro adaptadores. Cada adaptador traduce entre el núcleo y un sistema externo concreto (interfaz de usuario, conocimiento, memoria compartida, comunicación entre agentes). Ningún adaptador conoce a los demás — solo al núcleo.

Interfases importantes

Todas las interfaces pasan por el núcleo; ningún adaptador se comunica directamente con otro. Esto mantiene bajo el acoplamiento y sostiene la Meta 1 (Extensibilidad): reemplazar un adaptador no afecta al resto del sistema.

### Caja Negra 1: Núcleo de Orquestación

**Propósito/Responsabilidad**: declara y registra agentes, subagentes, comandos, hooks y skills sobre las primitivas nativas del Claude Agent SDK; resuelve qué agente atiende el turno activo; expone el puerto ModelProvider.

**Interfase(s)**: I1, I2, I3, I4 e I5 (ver catálogo de interfaces más abajo).

Ubicación Archivo/Directorio: *src/core/*

Requerimientos Satisfechos: Objetivo específico 6 (agentes, subagentes, comandos, hooks, skills); Meta 1 (Extensibilidad); Meta 2 (Corrección funcional multi-turno).

Riesgos/Incidentes Abiertos: el puerto *ModelProvider* tiene un solo adaptador implementado (Claude); un segundo proveedor puede exigir un loop de razonamiento propio si no es compatible con el modelo de ejecución del SDK.

### Caja Negra 2: Adaptador TUI

Propósito/Responsabilidad: entrada/salida por terminal, construida con Ink.

**Interfase(s)**: I1 (con el Núcleo).

**Ubicación Archivo/Directorio:** *src/adapters/tui/*

**Requerimientos Satisfechos:** Objetivos específicos 3 y 6; Meta 5 (Usabilidad).

**Riesgos/Incidentes Abiertos:** ninguno abierto por ahora.

### Caja Negra 3: Adaptador de Conocimiento

**Propósito/Responsabilidad:** traduce consultas del núcleo en invocaciones a la CLI de Graphify (graphify query), expuesta al Núcleo mediante un servidor MCP propio que envuelve esa CLI — Graphify en sí es una herramienta de línea de comandos, no un servidor MCP nativo.

**Interfase(s):** I2 (con el Núcleo).

**Ubicación Archivo/Directorio:** *src/adapters/knowledge/*

**Requerimientos Satisfechos:** Objetivo específico 5; Meta 3 (Observabilidad).

**Riesgos/Incidentes Abiertos:** ninguno abierto.

### Caja Negra 4: Adaptador de Memoria Compartida

**Propósito/Responsabilidad:** persiste el estado de negocio compartido entre agentes (casos) y su correlación con las sesiones que el Claude Agent SDK ya gestiona internamente; distintos agentes leen/escriben el mismo estado de caso en SQLite.

**Interfase(s):** I3 (con el Núcleo).

**Ubicación Archivo/Directorio:** *src/adapters/memory/*

**Requerimientos Satisfechos:** Objetivo general (memoria compartida); Meta 2; Meta 4 (Operabilidad local).

**Riesgos/Incidentes Abiertos:** ninguno abierto.

### Caja Negra 5: Adaptador A2A

**Propósito/Responsabilidad:** expone el arnés como agente A2A servidor, y permite actuar como cliente hacia agentes externos.

**Interfase(s):** I4 (con el Núcleo).

**Ubicación Archivo/Directorio:** src/adapters/a2a/

**Requerimientos Satisfechos:** Objetivo específico 6 (A2A); Meta 6 (Interoperabilidad).

**Riesgos/Incidentes Abiertos:** sin ejercitar en el v1 (el MVP lineal no lo activa todavía); queda listo para las variantes swarm/grafo posteriores que persigue el objetivo específico 7.

### Catálogo de interfaces

## Interfase 1 (I1): Núcleo ↔ Adaptador TUI

Extremos: Núcleo de Orquestación ↔ Adaptador TUI.

**Qué transporta:** prompt del empleado (entrada) / respuesta renderizada con estado del agente (salida).

**Formato**: texto en lenguaje natural, canal interno del mismo proceso Node.js.

## Interfase 2 (I2): Núcleo ↔ Adaptador de Conocimiento

Extremos: Núcleo de Orquestación ↔ Adaptador de Conocimiento.

**Qué transporta:** consulta (query) hacia el vault / resultado con fuente y fragmento citado.

**Formato**: Texto plano estructurado, vía un servidor MCP propio que envuelve la CLI de Graphify.

## Interfase 3 (I3): Núcleo ↔ Adaptador de Memoria Compartida

Extremos: Núcleo de Orquestación ↔ Adaptador de Memoria Compartida.

**Qué transporta:** lectura/escritura del estado de negocio compartido (casos) y su correlación con las sesiones que gestiona el Claude Agent SDK.

**Formato**: consultas SQL sobre el archivo SQLite local.

## Interfase 4 (I4): Núcleo ↔ Adaptador A2A

Extremos: Núcleo de Orquestación ↔ Adaptador A2A.

**Qué transporta:** delegación/coordinación con agentes externos.

**Formato**: JSON-RPC sobre el protocolo A2A.

## Interfase 5 (I5): Núcleo ↔ puerto *ModelProvider*

Extremos: Núcleo de Orquestación ↔ puerto *ModelProvider*.

**Qué transporta:** solicitud de razonamiento (prompt + herramientas disponibles) / respuesta del modelo (texto y/o tool calls).

**Formato**: llamadas del Claude Agent SDK hacia la Anthropic Messages API (HTTPS).

## Nivel 2

## Diagrama del Nivel 2

![vista-bloques-nivel2.png](arc42_media/vista-bloques-nivel2.png)

### Caja Blanca bloque de construcción 1: Selector de Turno (Orquestador de Sesión)

**Responsabilidad**: recibe el prompt entrante (I1); recupera contexto vía memoria compartida (I3) y conocimiento cuando corresponde (I2); consulta el Registro de Agentes para resolver quién atiende; dispara los hooks correspondientes; invoca al modelo por el puerto *ModelProvider* (I5); si el agente decide delegar, usa el Adaptador A2A (I4).

**Colabora con**: los otros cuatro bloques de esta caja blanca.

**Ubicación**: *src/core/turn-selector.ts*

### Caja Blanca bloque de construcción 2: Registro de Agentes y Subagentes

**Responsabilidad**: declara la configuración de cada agente/subagente disponible (nombre, system prompt, herramientas permitidas, modelo). Satisface la delegación in-process, equivalente al Task/subagente nativo del Claude Agent SDK.

**Colabora con**: Selector de Turno (lo consulta para resolver el agente activo).

**Ubicación**: *src/core/agents/*

**Requerimiento satisfecho**: objetivo 6 — "Definición de agentes, sub agentes".

### Caja Blanca bloque de construcción 3: Registro de Comandos

**Responsabilidad**: declara los comandos que el arnés expone al empleado, mapeando cada uno a una acción o a un prompt predefinido.

**Colabora con**: Selector de Turno.

**Ubicación**: *src/core/commands/*

**Requerimiento satisfecho**: objetivo 6 — "Definición de comandos".

**Nota (v3.2.0)**: `/reporte-comisiones` (comando-reporte-comisiones, ADR 116) es el primer comando privilegiado que expone un flujo de negocio de solo lectura ya existente fuera de la TUI (`npm run reporte:mensual`) — el reporte de comisiones deja de ser el único flujo de negocio del arnés que corre por fuera de este registro.

**Nota (v3.4.0)**: `/ver-solicitudes-a2a [a2aTaskId]` (comando-visibilidad-a2a-entrante, ADR 139-143) es un comando privilegiado de sólo lectura sobre `solicitudes_a2a_entrantes`. Sin argumento lista las solicitudes A2A entrantes en curso; con `a2aTaskId` muestra el detalle de una. El protocolo A2A v1.0.0 no transporta la identidad del agente externo que originó la solicitud, así que la columna correspondiente se rotula "origen de transporte" — nunca "agente" ni "solicitante" — y `agente_externo_url` es siempre `NULL` en este hito. El comando es puramente de lectura: no ofrece ningún remedio activo sobre una fila huérfana (cancelarla, o un barrido de arranque que la reconcilie), eso queda fuera de su alcance.

**Nota (v3.6.0, `operaciones-negocio-conversacionales`, ADR 148 pto 2)**: los tres comandos transaccionales de autoservicio (`/devolucion`, `/solicitar`, `/cancelar-solicitud`) se dieron de baja de `DESCRIPTORES` — quedan **quince**. Se resuelven ahora por conversación, vía la herramienta `operaciones` del turno de empleado autenticado (Concepto Transversal 7). Los cinco comandos administrativos/HITL (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`) **no** bajan: el ADR 151 los declaró candidatos a pasar a conversación, pero esa ejecución sigue **BLOQUEADA** por decisión del checkpoint. `build-on-comando-empleado.ts` no se modificó por este change (ADR 172 pto 3) — el dispatcher conserva sus ramas para los tres comandos dados de baja, ahora inalcanzables porque el parser ya no los produce.

**Nota (v3.7.0, `comandos-administracion-empleados`, ADR 174-185)**: `DESCRIPTORES` queda en **dieciocho** con tres comandos nuevos, todos insertados inmediatamente antes de `/ayuda`, que sigue último:

- **`/estado-bot-prs`** (`privilegiado: true`, **`requiereAdministrador: false`**) — de solo lectura, sin gate de rol; enmienda del checkpoint al diferido del ADR 178 de esta misma propuesta (configuración del bot de PRs desde la TUI sigue diferida; esto es sólo un "¿está andando?"). Responde si el listener de webhooks está escuchando (puerto/path) y si `GITHUB_TOKEN` está configurado, ambos sin revelar valores. No escribe en `registro_acciones_empleado`.
- **`/crear-empleado <empleadoId> <password>`** (`privilegiado: true`, `secreto: true`, `requiereAdministrador: true`) — reusa `altaCredencialEmpleado` (extraída de `src/empleados.ts`, ADR 181): mismo hash `scrypt` y misma guarda de forma (`ID_REGEX`) que el CLI. Revierte, a pedido del stakeholder, la propiedad de diseño original de `credenciales-contract.ts` ("la TUI no puede crear credenciales", ADR 174) — ver Concepto Transversal 8 y Riesgo 5 (R1) para el residual aceptado y su mitigación.
- **`/asignar-rol <empleadoId> <rol>`** (`privilegiado: true`, `requiereAdministrador: true`) — escribe con `upsertRolEmpleado` (ADR 176), el mismo mecanismo que ya usa `autorizacion-empleado`; sin migración, tabla ni vocabulario de rol nuevos. Auto-degradación del último `administrador` **prohibida sin excepción, sin conteo** (ADR 182).

Como corrección asociada (tarea 3): la rama genérica de `parsearComando` para la forma `"sin_argumentos"` — que hasta acá tenía un único consumidor (`/logout`) y devolvía su tipo hardcodeado — pasa a devolver el tipo del descriptor encontrado, ahora que un segundo comando comparte esa forma.

### Caja Blanca bloque de construcción 4: Motor de Hooks

**Responsabilidad**: registra funciones que se disparan en puntos del ciclo de vida del turno (antes/después de una tool call, antes/después del turno completo), sobre el sistema de hooks nativo del Claude Agent SDK.

**Colabora con**: Selector de Turno.

**Ubicación**: *src/core/hooks/*

**Requerimiento satisfecho**: objetivo 6 — "Definición de hooks"

### Caja Blanca bloque de construcción 5: Registro de Skills

**Responsabilidad**: carga desde disco los paquetes de capacidad (skills) y los deja disponibles para que el agente los invoque durante el turno.

**Colabora con**: Selector de Turno.

**Ubicación**: dos ubicaciones distintas, no una — corrección de `definicion-skills` (ADR 104 pto 1) a lo que esta entrada afirmaba antes. El **código** del cargador vive en *src/core/skills/* (`skill-frontmatter.ts`, `descubrir-skills.ts`, `skills-habilitadas.ts`); el **contenido** de cada skill vive en *.claude/skills/\<nombre\>/SKILL.md*, fuera de `src/`. La ubicación única bajo `src/core/skills/*` que esta entrada daba a entender antes era incorrecta contra el SDK real: un `SKILL.md` ahí nunca sería descubierto, por bien escrito que esté el cargador — el SDK sólo escanea `.claude/skills/` (y `~/.claude/skills/`, acotado luego por `settingSources: ["project"]`).

**Requerimiento satisfecho**: objetivo 6 — "Definición de Skills".

## Nivel 3

### Caja Blanca Bloque de Construcción 1.1: Resolución de Turno

**Responsabilidad**: dado el prompt entrante, decide qué agente o subagente atiende (consulta el Registro de Agentes).

**Colabora con**: Registro de Agentes y Subagentes.

**Ubicación**: *src/core/turn-selector/resolve-turn.ts*

### Caja Blanca Bloque de Construcción 1.2: Ensamblador de Contexto

**Responsabilidad:** combina el historial de memoria compartida (I3) y, si corresponde, resultados de la base de conocimiento (I2), en el contexto que recibe el modelo.

**Colabora con:** Adaptador de Memoria, Adaptador de Conocimiento.

**Ubicación:** *src/core/turn-selector/assemble-context.ts*

### Caja Blanca Bloque de Construcción 1.3: Invocador del Modelo

**Responsabilidad:** llama al puerto *ModelProvider* (I5) con el contexto ensamblado; procesa la respuesta (texto y/o tool calls); dispara los hooks correspondientes.

**Colabora con:** puerto ModelProvider, Motor de Hooks.

**Ubicación:** *src/core/turn-selector/invoke-model.ts*

### Caja Blanca Bloque de Construcción 1.4: Despachador de Delegación

**Responsabilidad:** si el agente activo decide delegar, resuelve si es un subagente in-process (Registro de Agentes) o un agente externo (Adaptador A2A, I4), y lo despacha.

**Colabora con:** Registro de Agentes, Adaptador A2A.

**Ubicación:** *src/core/turn-selector/dispatch-delegation.ts*

### Caja Blanca Bloque de Construcción 2.1: Definición y Carga de Agentes

**Responsabilidad:** declara la configuración de cada agente de primer nivel (nombre, system prompt, herramientas permitidas, modelo) y los carga al iniciar el arnés.

**Colabora con:** Selector de Turno (Resolución de Turno lo consulta).

**Ubicación:** *src/core/agents/definitions.ts*

**Nota de versión:** es lo único que necesita el v1 (MVP lineal) — con un solo agente definido, ese hito ya cierra.

### Caja Blanca Bloque de Construcción 2.2: Delegación a Subagentes

**Responsabilidad:** habilita que un agente activo invoque subagentes in-process, con contexto propio acotado — el Task/subagente nativo del Claude Agent SDK.

**Colabora con:** Despachador de Delegación (dentro del Selector de Turno).

**Ubicación:** *src/core/agents/subagents.ts*

**Nota de versión:** no se ejercita en v1; es la pieza que habilita v2 (swarm).

**Nota**: a diferencia de los bloques 1.x y 2.x (que abren piezas del Núcleo), los siguientes dos abren el Adaptador A2A (un bloque del Nivel 1); se incluyen acá de forma pragmática, sin agregar una sección de Nivel 2 aparte.

### Caja Blanca Bloque de Construcción 3.1: Cliente A2A

**Responsabilidad:** permite que el Núcleo delegue en agentes externos cuando el Despachador de Delegación lo decide.

**Colabora con:** Despachador de Delegación (I4).

**Ubicación:** *src/adapters/a2a/client.ts*

**Nota de versión:** necesario para v2 (swarm) — el arnés delegando hacia afuera.

### Caja Blanca Bloque de Construcción 3.2: Servidor A2A

**Responsabilidad:** expone el arnés como agente invocable por otros agentes A2A externos, traduciendo sus solicitudes a un turno del Núcleo.

**Colabora con:** Núcleo de Orquestación (entrada externa, no desde el Empleado).

**Ubicación:** *src/adapters/a2a/server.ts*

**Nota de versión:** implementado en v3 (Hito 7) — `startA2AServer` (`src/adapters/a2a/server-index.ts`) es opt-in por token (`HARNESS_A2A_ENTRANTE_TOKEN`): sin token, ningún puerto se abre y el comportamiento es idéntico al de `v2.2.0`.

**Nota (v3.4.0)**: este bloque describe únicamente el camino de **escritura** de `solicitudes_a2a_entrantes` (lo que el Servidor A2A recibe y persiste). Desde v3.4.0 existe además un camino de **lectura** sobre la misma tabla — `/ver-solicitudes-a2a [a2aTaskId]` — pero ese comando vive en el Registro de Comandos (bloque de construcción 3, no éste) y no toca nada de lo descripto acá: `startA2AServer`, `src/adapters/a2a/server.ts` y `src/build-on-a2a-entrante.ts` permanecen sin cambios. Ver la nota v3.4.0 del bloque 3.

**Nota (v3.8.0, `consultas-negocio-a2a-entrante`, ADR 174-187)**: hasta esta versión, el turno A2A entrante sólo podía delegar en el servidor de conocimiento (`mcp__conocimiento__*`) — el Agent Card prometía consultar "proyectos", "incidentes", "solicitudes internas" y "ventas registradas", pero ningún turno real podía responder eso con datos concretos (deuda documentada en `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`, "Hallazgo 1"). Esta versión agrega un segundo servidor MCP, `mcp__consultas__consultar_negocio`, con **cuatro** operaciones de sólo lectura y agregadas, ninguna con identidad de empleado:

- **Estado de actividad/PR** por `(proyectoId, referenciaExterna)` — estado y última actualización, nunca el `id` interno ni el responsable.
- **Solicitudes internas pendientes** — conteo total y desglose por tipo, nunca `solicitanteId` ni el texto libre de `detalle`.
- **Reporte de comisiones por período** — total comisionado y conteos agregados del período, nunca la tabla completa por vendedor (esa tabla completa sigue siendo exclusiva de `/reporte-comisiones`, con sesión de empleado vigente).
- **Reembolsos pendientes de aprobación** — conteo total y monto sumado, nunca `vendedorId`/`vendedorNombre`/`clienteId` por fila.

**Qué NO puede hacer un agente externo por esta vía**: ninguna de las cuatro operaciones escribe — `BuildOnA2AEntranteDeps` pasa de ocho a **nueve** campos (el noveno, `createConsultas`, es una segunda fábrica de sólo lectura) sin ganar ningún puerto de escritura, invariante verificado por test de firma. Tampoco hay resolución de identidad por llamador: el bearer del token A2A autentica la conexión, no a una persona, así que ninguna operación puede filtrar "mis solicitudes" o "mis ventas" — sólo agregados del dominio completo. El `mcpServers` de este turno sigue siendo el conjunto exacto `{conocimiento, consultas}`, nunca incluye `mcp__operaciones__*` (el servidor de escritura del turno de Empleado autenticado), verificado por un test de igualdad de conjunto, no de contención.

**Nota histórica de proceso**: esta PR (tareas 11-15 de `consultas-negocio-a2a-entrante`) estuvo gateada durante el desarrollo — no podía abrirse hasta que `operaciones-negocio-conversacionales` mergeara a `main`, porque el test de conjunto exacto de `mcpServers` necesita que `mcp__operaciones__*` exista de verdad para poder afirmar su ausencia contra un servidor real, no uno hipotético. Ver `openspec/changes/consultas-negocio-a2a-entrante/tasks.md`, sección "Orden de merge y gating obligatorio".

# Vista de Ejecución

## Escenario de ejecución 1: Turno conversacional básico

**Secuencia del escenario**:

- El Empleado escribe un prompt en la TUI.

- Adaptador TUI envía el prompt al Núcleo por I1.

- Resolución de Turno (1.1) consulta Definición y Carga de Agentes (2.1) para determinar qué agente atiende.

- El Ensamblador de Contexto resuelve, vía I3 (Adaptador de Memoria Compartida), el caso y la sesión del SDK a retomar — el historial de turnos en sí lo recupera el Claude Agent SDK internamente al invocar el modelo (I5).

- El Invocador del Modelo llama al puerto ModelProvider vía I5 (Claude Agent SDK → Anthropic API).

- El modelo devuelve una respuesta en texto, sin tool calls de delegación.

- Invocador del Modelo dispara los hooks de post-turno correspondientes (Motor de Hooks).

- El Núcleo actualiza el estado del caso en memoria compartida vía I3 — el SDK ya persiste el turno en sí por su cuenta.

- La respuesta vuelve al Adaptador TUI por I1 y se renderiza al Empleado.

**Aspectos notables**: este escenario es el único con dos accesos a I3 en la misma vuelta — lectura antes de invocar el modelo, escritura después. Ese patrón de "leer, razonar, escribir" dentro del mismo turno es lo que sostiene la Meta 2 (corrección funcional multi-turno): sin la escritura al cierre, el siguiente turno no vería el resultado de este. También es el único punto de la secuencia que cruza a un sistema externo real (Anthropic API vía I5); todo lo demás ocurre in-process.

## Escenario de ejecución 2: Consulta a la base de conocimiento

**Secuencia del escenario**:

- Continúa desde el paso 4 del Escenario 1: el Ensamblador de Contexto determina que el turno requiere conocimiento del vault (el agente activo tiene la herramienta habilitada).

- Ensamblador de Contexto envía la consulta al Adaptador de Conocimiento vía I2.

- El Adaptador de Conocimiento invoca la CLI de Graphify (graphify query) desde el servidor MCP propio que la envuelve.

- Graphify devuelve una lista de nodos en texto plano, cada uno con su archivo y ubicación de origen (src/loc) — la fuente citable.

- El Adaptador de Conocimiento devuelve el resultado al Ensamblador de Contexto vía I2.

- El Ensamblador de Contexto incorpora el fragmento citado al contexto que recibirá el modelo.

- Continúa como el Escenario 1 desde el paso 5 (Invocador del Modelo).

**Aspectos notables**: I2 es el único punto de todo el sistema donde se adjunta la fuente citada al contexto — es la interfaz que hace posible la Meta 3 (Observabilidad de las respuestas). Además, el Adaptador de Conocimiento no reimplementa recuperación de información: delega el trabajo pesado a la CLI de Graphify, expuesta mediante un servidor MCP propio, tal como se decidió en la Sección 4 ("Conocimiento delegado a Graphify, sin base vectorial propia").

## Escenario de ejecución 3: Delegación a un subagente

**Secuencia del escenario**:

- Como variante del paso 6 del Escenario 1: en vez de una respuesta final, el modelo devuelve una tool call que representa una decisión de delegar.

- El Selector de Turno pasa el control al Despachador de Delegación.

- El Despachador resuelve que la delegación es in-process y consulta Delegación a Subagentes, que a su vez usa Definición y Carga de Agentes para instanciar la configuración del subagente.

- El subagente corre su propio ciclo de Resolución de Turno → Ensamblador de Contexto → Invocador del Modelo, pero con un contexto propio y acotado — no hereda el historial completo del agente padre.

- El subagente devuelve su resultado al Despachador de Delegación.

- El Despachador entrega el resultado al Invocador del Modelo del agente padre, que lo incorpora como resultado de tool call y continúa el turno.

- El turno del agente padre cierra como en el Escenario 1 (hooks, escritura en memoria compartida, respuesta a la TUI).

**Aspectos notables**: el aislamiento de contexto del paso 4 es la pieza clave — un subagente con visibilidad total del historial del padre volvería impredecible cuál agente "dijo" qué, rompiendo la Meta 2. Nota de alcance: este escenario documenta el comportamiento que habilita Delegación a Subagentes, marcado en el Nivel 3 como necesario recién para v2 (swarm); no se ejercita en el MVP lineal v1.

## Escenario de ejecución 4: Comunicación A2A saliente

**Secuencia del escenario:**

- Igual que el Escenario 3 hasta el paso 2 (Despachador de Delegación recibe la decisión de delegar).

- El Despachador resuelve que el destino es un agente externo y lo pasa al Cliente A2A vía I4.

- El Cliente A2A empaqueta la solicitud como mensaje JSON-RPC del protocolo A2A y la envía al agente externo.

- El agente externo procesa la solicitud y devuelve su resultado, también en JSON-RPC.

- El Cliente A2A entrega el resultado al Despachador de Delegación vía I4.

- Continúa como el Escenario 3 desde el paso 6 (el resultado se incorpora como tool result y el turno del padre cierra normal).

**Aspectos notables**: a diferencia de la delegación a subagentes (in-process, mismo límite de confianza), esta cruza un límite de proceso y de confianza real — el Núcleo trata la respuesta del agente externo como cualquier resultado de herramienta, no como algo privilegiado. Este escenario cubre solo el rol cliente (el arnés delegando hacia afuera); el rol servidor (Servidor A2A — el arnés recibiendo solicitudes externas) es simétrico pero no se documenta acá porque, igual que el cliente A2A, queda marcado como hito posterior en el Nivel 3, sin ejercitarse en v1.

# Vista de Despliegue

## Nivel de infraestructura 1

**Diagrama General**

![vista-despliegue-nivel1.png](arc42_media/vista-despliegue-nivel1.png)

Motivación

El arnés se despliega como un único proceso Node.js en el entorno local del empleado o de un servidor interno de la empresa — no requiere contenedores, orquestador ni servicios separados. Esta decisión es consecuencia directa de la Meta 4 (Operabilidad local) y de la persistencia embebida definida en la Sección 2: todo el estado vive en un archivo SQLite junto al proceso, sin infraestructura adicional que aprovisionar o mantener.

Características de Calidad/Rendimiento

El único punto de latencia externa real es la llamada a la Anthropic API (I5); las consultas a Graphify (I2) y la persistencia en SQLite (I3) ocurren en la misma red local o el mismo disco, sin agregar latencia de red significativa. La comunicación A2A (I4) es la única interfaz que, al activarse desde v2, introduce dependencia de red hacia procesos externos fuera del control del arnés.

Mapeo de los Bloques de Construcción a Infraestructura

| Bloque de construcción | Elemento de infraestructura |
| --- | --- |
| Núcleo de Orquestación + los 4 Adaptadores | Proceso Node.js único |
| Adaptador de Memoria Compartida | Archivo SQLite en disco local |
| Adaptador de Conocimiento | Vault de Obsidian, vía CLI de Graphify detrás de un servidor MCP propio (local o red interna) |
| Adaptador A2A | Red (JSON-RPC hacia agentes externos, desde v2) |
| Puerto ModelProvider (dentro del Núcleo) | Anthropic API por Internet (HTTPS) |

## Nivel de Infraestructura 2

No se abre un Nivel 2 de infraestructura: todos los bloques corren dentro del mismo proceso, sobre una única máquina — no hay contenedores, clústeres ni servicios desplegados por separado que justifiquen un diagrama propio. Si una iteración futura separa el Adaptador A2A en su propio proceso para exponerlo como servidor accesible desde otras máquinas, ese sería el primer candidato a un elemento de Nivel 2.

## Nota de despliegue: provisioning del rol elevado (v3.5, `autorizacion-empleado`)

La migración `0013` (tabla `roles_empleado`) dejó a **todos** los empleados existentes en rol base por ausencia de fila (default deny, sin backfill — ADR 156/157 de `autorizacion-empleado`). Consecuencia operativa, no un detalle de implementación: al mergear este change, **nadie puede aprobar un reembolso escalado ni una solicitud interna hasta que alguien reciba el rol elevado por CLI**.

Comando exacto para asignar el rol elevado a un `empleadoId` que ya tiene credencial:

```
npm run empleados:crear -- <empleadoId> --rol administrador
```

**Ya ejecutado en este entorno**: el primer `administrador` es el empleado **`jimmy`**, resuelto por el checkpoint humano (ADR 156 pto 3) y asignado con el comando de arriba antes del cierre de este change. Cualquier entorno nuevo que reciba este merge (otro checkout, un ambiente de staging, etc.) necesita repetir esa asignación sobre su propio `empleadoId` administrador antes de que quede alguien operando reembolsos o solicitudes.

# Conceptos Transversales (Cross-cutting)

Los siguientes conceptos atraviesan varios bloques de construcción a la vez: si no se deciden una sola vez, cada adaptador los resolvería de forma distinta y el sistema quedaría inconsistente.

## Concepto 1: Manejo de errores

El Núcleo (vía su puerto ModelProvider) y dos de los cuatro adaptadores (Conocimiento, Memoria) dependen de un sistema externo que puede fallar (Anthropic API, Graphify, SQLite). A esto se suman los puntos de extensión internos — hooks y skills — que también pueden fallar en tiempo de ejecución. Sin una convención única, cada bloque decidiría por su cuenta si reintenta, si aborta el turno, o si degrada la respuesta — inconsistente y no trazable. (Memoria es local, pero el archivo puede estar bloqueado/corrupto igual.)

## Concepto 2: Configuración y credenciales

Todas las interfaces con el exterior (I2, I4, I5) necesitan algo configurable: la API key de Anthropic, el endpoint de Graphify, la ruta del archivo SQLite. Sin un mecanismo único (por ejemplo: variables de entorno + un solo punto de carga), cada adaptador terminaría leyendo configuración a su manera.

## Concepto 3: Convención de logging y correlación de turnos

La Meta 3 (Observabilidad) exige trazar cada respuesta a su fuente — pero eso solo funciona en la práctica si el Núcleo, el Adaptador de Conocimiento y el de Memoria comparten un mismo identificador de turno/sesión en sus logs. Si no, "trazable" queda en la meta y no en el código.

## Concepto 4: Modelo de datos del turno/mensaje

El Ensamblador de Contexto arma el turno que recibirá el modelo (prompt, herramientas disponibles, resultado de conocimiento si corresponde) y el Invocador del Modelo lo entrega al Claude Agent SDK vía I5 — pero hoy nadie fija la forma exacta de ese paquete. El Adaptador de Memoria (I3) queda fuera de este concepto en su forma final: el SDK persiste el turno en sí por su cuenta; I3 solo correlaciona caso y sesión. Sin una convención única entre Ensamblador e Invocador, el Ensamblador podría producir una estructura que el Invocador no espera. Es cross-cutting genuino entre esos dos bloques.

## Concepto 5: Secuencia de arranque del proceso

Registro de Agentes, Registro de Comandos, Motor de Hooks y Registro de Skills se cargan "al iniciar el arnés", pero no hay ningún lado que diga en qué orden, ni qué pasa si un comando referencia un agente que todavía no cargó, o si un hook necesita registrarse antes de que el Selector de Turno acepte el primer prompt. Toca a los cuatro registros del Nivel 2 a la vez — cross-cutting real.

## Concepto 6: Autenticación vs. autorización de empleado (v3.5, `autorizacion-empleado`)

Hasta v3.4 el arnés solo sabía responder *quién sos*: `/login` verifica una contraseña contra un hash scrypt y abre una `SesionEmpleado` con TTL (Hito `tui-canal-empleado`, ADR 30-32). Ninguna función del núcleo sabía responder *qué podés* — cualquier empleado con sesión vigente podía resolver la escalación de reembolso o la solicitud interna de cualquier otro, e incluso aprobar la suya propia. Desde v3.5 (`autorizacion-empleado`) las dos preguntas están separadas a propósito, en objetos, tablas y momentos de lectura distintos:

- **Autenticación** (*quién sos*) — sin cambios: `src/core/auth/sesion.ts` sigue siendo `{ empleadoId, iniciadaEn, expiraEn? }`, producida únicamente por `resolverLogin`, y no se tocó ni una línea en este change.
- **Autorización** (*qué podés*) — nueva: un **rol de empleado enumerado** con exactamente dos valores, `empleado` (base) y `administrador` (elevado), vive en su propia tabla `roles_empleado` (`empleado_id TEXT PRIMARY KEY, rol TEXT NOT NULL, created_at, updated_at`; migración `0013`, aditiva, sin `CHECK`, sin FK — mismo criterio que el resto del esquema de empleado, cuyas filas sobreviven a lo que le pase a quien las originó).
- **Cómo se lee**: por un puerto de una sola operación (`RolEmpleadoPort.buscarRol(empleadoId)`), en el momento exacto de la decisión — **nunca cacheado en `SesionEmpleado`**. Consecuencia deliberada: quitarle el rol elevado a un empleado tiene efecto **inmediato**, sin esperar a que su sesión expire (una sesión sin `expiraEn` puede no expirar nunca).
- **Qué gatea**: únicamente la pregunta *"¿puede resolver lo ajeno?"*, evaluada por el único punto de decisión del repo (`puedeResolverAjeno`, `src/core/auth/autorizacion-resolucion.ts`) desde adentro de las dos funciones deterministas afectadas — `resolverEscalacionReembolso` (aprobar/rechazar/reabrir una escalación de reembolso ajena) y `resolverSolicitudInterna` (aprobar/rechazar una solicitud interna ajena). Un `empleado_id` sin fila en `roles_empleado` cae al rol base, nunca al elevado (default deny, sin backfill: la ausencia de fila **es** la denegación).
- **Prohibición de autoaprobación** — independiente del rol: `aprobar`/`rechazar` una solicitud interna cuyo `solicitante_id` sea el propio `sesion.empleadoId` se rechaza **aunque el empleado tenga rol `administrador`**. Es separación de funciones, no un tercer valor de rol. Previously: hasta v3.9 esta prohibición no aplicaba a la escalación de reembolso (Deuda 5, R7, declarada). **Desde v3.10 (`aprobacion-conversacional-hitl`) `resolverEscalacionReembolso` tiene la prohibición hermana** (comparación `venta.vendedorId === sesion.empleadoId`) — ver Concepto 10 y Deuda 5 (CERRADA).
- **Lo que NO cambió**: `esAccionAutoservicio` (que permite a cualquier empleado cancelar su propia solicitud) sigue siendo la única fuente de verdad para ese caso; el campo `privilegiado` de `comando-empleado.ts` (que solo exige sesión vigente) no se resignificó — los comandos de solo lectura siguen respondiendo con cualquier sesión activa, sin exigir rol elevado.

## Concepto 7: Operaciones de negocio por conversación y superficie HTTP de empleado (v3.6, `operaciones-negocio-conversacionales`)

Hasta v3.5 el único camino conversacional de negocio era la TUI (`/soporte`, `/devolucion`, `/solicitar`, etc., todos comandos de terminal). v3.6 agrega una **segunda superficie**, HTTP, dedicada al empleado autenticado — no reemplaza a la TUI, la complementa con un canal que no depende de tener el proceso Ink abierto localmente.

- **Siete operaciones de negocio, una sola herramienta MCP in-process** (`operaciones`, molde `adapters/knowledge/knowledge-tool.ts`): `registrar_venta`, `resolver_decision_venta`, `procesar_devolucion`, `crear_solicitud_interna`, `cancelar_solicitud_interna`, `resolver_solicitud` y `consultar_reporte_comisiones`. Cada una valida su input contra un schema tipado y delega el 100% del cálculo a una función determinista **ya existente**, sin modificarla — el modelo aporta identificadores estructurados (`token`, `solicitudId`, `periodo`, etc.), nunca un monto, porcentaje ni veredicto (excepción única y auditada: `monto` de `registrar_venta`, que viaja del input a `registrarVenta` sin ninguna operación aritmética intermedia).
- **Dos rutas HTTP nuevas, autenticadas, NO vía TUI**: `POST /login` (credenciales de empleado → token opaco) y `POST /operaciones` (`Authorization: Bearer <token>` → invoca el turno de empleado con la herramienta `operaciones` habilitada). `POST /soporte` (cliente, anónimo) **nunca** tiene esta herramienta — es el riesgo dominante del change (R1), cerrado con un test de regresión explícito que reconfirma la ausencia de `operaciones` en el `allowedTools` efectivo de ese turno cada vez que corre la suite.
- **Confirmación humana explícita para `cancelar_solicitud_interna`**: un `casoId` de origen (`origenCasoId`) hace estructuralmente imposible que la misma invocación se autoconfirme en el mismo turno — la confirmación exige un turno conversacional posterior y distinto.
- **Baja de los tres comandos TUI de autoservicio** (`/devolucion`, `/solicitar`, `/cancelar-solicitud`, ADR 148 pto 2): se resuelven ahora por conversación vía esta misma herramienta. Previously: hasta v3.9, los cinco comandos administrativos/HITL (`/aprobar-*`, `/rechazar-*`, `/reabrir-*`) no se tocaban y el ADR 151 seguía **BLOQUEADO** por decisión del checkpoint, heredado tal cual de v3.2/v3.5 (R10, ya cerrado — ver Riesgo 3). **Desde v3.10 (`aprobacion-conversacional-hitl`) el ADR 151 está EJECUTADO**: los cinco comandos bajaron de la TUI y sus transiciones se resuelven por `resolver_solicitud`/`resolver_reembolso` en esta misma herramienta — ver Concepto 10.
- **R12, heredada y aceptada, no un bug pendiente**: `consultar_reporte_comisiones` no tiene gate de rol ni admite escopar por vendedor — mismo comportamiento que ya tenía `/reporte-comisiones` por TUI. El checkpoint aceptó explícitamente esta herencia al aprobar la Enmienda 5 del change (ver Riesgo 4, R12).

## Concepto 8: Administración de empleados desde la TUI (v3.7, `comandos-administracion-empleados`)

El reparto de canales que `operaciones-negocio-conversacionales` empezó a ejecutar (chat = trabajo transaccional del empleado, TUI = administración) se completa por el lado de administración: dar de alta un empleado y asignarle rol dejan de exigir salir del arnés (`npm run empleados:crear`) y pasan a ser comandos de la TUI (`/crear-empleado`, `/asignar-rol`), gateados por rol `administrador`.

- **Un segundo eje de gateo, distinto de `privilegiado`** (ADR 175, 183): el dispatcher evalúa, en orden fijo, (1) sesión vigente (`privilegiado: true`, guarda existente, sin tocar) y recién después (2) rol `administrador` (`requiereAdministrador: true`, gate nuevo, paso 6.5). `privilegiado` **no se resignifica** — sigue significando únicamente "exige sesión vigente" (R4 de `autorizacion-empleado`, heredada literal). La política ("¿alcanza el rol?") vive en `autorizacion-resolucion.ts` (`esAdministrador`), el mismo módulo que ya resuelve "¿puede resolver lo ajeno?" (Concepto Transversal 6) — no se duplica un segundo cálculo inline en el dispatcher.
- **`RolEmpleadoPort` (lectura, ADR 162) no se toca.** El escritor (`RolEmpleadoEscritorPort.asignarRol`) es un contrato nuevo, co-ubicado en el mismo archivo (`rol-contract.ts`, ADR 180) — dos interfaces, un archivo, ninguna mezcla de lectura y escritura en un solo puerto.
- **Auto-degradación del último `administrador`, prohibida SIN excepción y SIN conteo** (ADR 182): un `administrador` nunca puede asignarse a sí mismo un rol distinto de `administrador`, sin importar cuántos administradores existan — se prefirió la prohibición absoluta a un cuarto contrato de puerto (`contarAdministradores`) solo para bajar un riesgo que la prohibición ya cierra al 100%. Con dos o más administradores, cualquiera de los otros sí puede degradar al resto.
- **`/crear-empleado` reusa `altaCredencialEmpleado`** (extraída de `src/empleados.ts`, ADR 181) — mismo hash `scrypt`, misma guarda de forma (`ID_REGEX`), sin un segundo camino de escritura SQL para `credenciales_empleado`. `src/empleados.ts` no se elimina ni se deprecia: sigue siendo el único camino de **bootstrap** del primer `administrador` (antes de que exista uno, nadie puede ejecutar `/asignar-rol`) y el único camino de **rotación**.
- **ADR 174 — la TUI pasa a poder crear credenciales**, revirtiendo a pedido explícito del stakeholder la propiedad de diseño original de `credenciales-contract.ts:14-17` ("la TUI no puede crear credenciales, y eso es una propiedad del diseño, no un olvido"). Lo que esa propiedad protegía se separa en dos superficies distintas: (a) que la contraseña no quede en el historial del shell ni en la tabla de procesos — **cambia de forma, no desaparece** (ver Riesgo 5, R1); (b) que la contraseña nunca se persista en claro — se **conserva íntegro**: mismo hash, nunca en una fila de `registro_acciones_empleado`, nunca en un evento de log (mismo invariante que ya cubría `/login`, extendido a `/crear-empleado`).
- **Todo rechazo por rol insuficiente o por auto-degradación deja fila distinguible en `registro_acciones_empleado`**, con el `registrar()`/`RegistroAccionesEmpleadoPort` ya existentes (ADR 161) — ningún método de puerto nuevo.
- **Dos capacidades pedidas por el stakeholder quedaron diferidas, con motivo verificado y nombre propio** — ver Deuda 7 (ADR 178) y Deuda 8 (ADR 179).

## Concepto 9: Chat web de empleado con memoria conversacional real (v3.9, `chat-web-empleado`)

El reparto de canales que `operaciones-negocio-conversacionales` (v3.6) inauguró —*"chat = trabajo transaccional del empleado, TUI = administración"*— y que `comandos-administracion-empleados` (v3.7) completó por el lado de administración, se cierra ahora por el lado de chat: la interfaz que v3.6 dejó sólo consumible por `curl` (`POST /login`, `POST /operaciones`) pasa a tener una pantalla real, con memoria conversacional real como requisito no negociable del stakeholder.

- **Interfaz servida por el mismo listener HTTP, sin adaptador nuevo**: tres rutas públicas en la cadena de ruteo existente de `server.ts` (`GET /chat`, `GET /chat/app.js`, `GET /chat/app.css`), molde de `GET /confirmar/:token`. **Primer JavaScript de cliente del repo** (ADR 191): vanilla, sin bundler y sin ninguna dependencia nueva en `package.json` — verificado que `react-dom` nunca estuvo instalado, así que "ya tenemos React" no aplicaba a web.
- **Memoria conversacional real, resuelta enteramente en el composition root, sin tocar el núcleo compartido por los cuatro turnos**: `build-on-operaciones-empleado.ts` sigue generando un `casoId` nuevo por mensaje (`newId()` intacto) — la memoria se logra con un decorador de `MemoryPort` que redirige `getLatestSesionAgente` hacia el `casoId` del turno anterior de la misma conversación, resuelto por un `ConversacionEmpleadoStore` nuevo (`Map` por token de sesión, rotación perezosa por inactividad o techo de turnos). `src/core/turn-selector/` y `src/core/operaciones/` quedan **sin ninguna línea modificada** — verificado por `git diff --stat` vacío contra ambos directorios.
- **El invariante de confirmación humana de `cancelar_solicitud_interna` (Concepto Transversal 7, arc42 `:566` histórico) se conserva sin relajarse**: como el `casoId` sigue siendo nuevo por mensaje, el predicado `pendiente.origenCasoId !== casoIdActual` de `confirmacion-operaciones-store.ts` no necesitó tocarse. Queda cubierto con un test que falla si dos invocaciones del mismo mensaje llegan a autoconfirmarse — el riesgo estructural del change, cerrado sin atajos.
- **Defensa de XSS como invariante de spec, no como cuidado de implementación**: el texto de `respuesta` —generado por el modelo— se inserta siempre por `textContent`/`createTextNode`, nunca por `innerHTML` ni equivalentes, verificado con un test mecánico sobre el string fuente del asset de cliente y un test en negativo con `<script>`/`<img onerror=...>`. Las respuestas HTML del chat llevan `Content-Security-Policy` sin `unsafe-inline`, servida por `respondHtmlChat` —helper hermano de `responderHtml` que no lo modifica— así que `GET /confirmar/:token` sigue sin CSP.
- **El token de sesión vive en memoria de la pestaña**, nunca en `localStorage`/`sessionStorage`/la URL — se pierde al cerrar la pestaña, a propósito. `POST /logout` (ruta nueva, en la raíz) invalida la sesión **en el servidor**, no sólo en el cliente: limpia sesión, conversación y confirmación pendiente, en ese orden.
- **`POST /operaciones` y `POST /login` no cambiaron de contrato**: `handleOperaciones` sólo ganó la resolución de la ranura de conversación (simétrica a la de confirmación) y una línea de log sin el token; `handleLogin` no tiene ninguna línea modificada.

**Enmienda al Concepto Transversal 4 (modelo de datos del turno/mensaje)**: hasta esta versión, "una conversación" y "un caso" eran sinónimos en todo el arnés. A partir de acá, **sólo para el turno de empleado por HTTP**, una conversación es una **cadena de N `casos` ligados por `sesion_agente`**: el `casoId` sigue siendo nuevo por mensaje, pero `ConversacionEmpleadoStore` guarda el puntero al último `casoId` cerrado con éxito de cada sesión, y ese puntero es lo que redirige `getLatestSesionAgente` al armar el turno siguiente. `/soporte` (cliente), la TUI y el turno A2A entrante **siguen con un caso por turno**, sin cambio.

**Deuda declarada por este change** — ver Riesgo 6 (R11), Riesgo 7 (R5), el addendum de v3.9 al Riesgo 4 (R12) y Deuda 9-11 (RD-91/92/94) más abajo.

## Concepto 10: Ejecución del ADR 151 y cierre de R7 — aprobación conversacional HITL (v3.10, `aprobacion-conversacional-hitl`)

El ADR 151 (`operaciones-negocio-conversacionales`, v3.6) decidió mover los cinco comandos HITL de la TUI (`/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`, `/aprobar-solicitud`, `/rechazar-solicitud`) al canal conversacional, pero quedó **BLOQUEADO** hasta que `autorizacion-empleado` (v3.5) cerrara el modelo de rol (R10, Riesgo 3). Con esa condición cumplida, `aprobacion-conversacional-hitl` **ejecuta el ADR 151**:

- **Dos operaciones nuevas** en la herramienta `operaciones` (ocho en total): `resolver_solicitud { accion: "aprobar"|"rechazar", solicitudId? }` y `resolver_reembolso { accion: "aprobar"|"rechazar"|"reabrir", ventaId? }`. `accion` es una **elección de operación**, no un veredicto calculado — mismo criterio que `resolver_decision_venta.decision` ya usaba. El gate de rol (`puedeResolverAjeno`) se **hereda por delegación**: el dispatcher (`ejecutar-operacion.ts`) nunca lo reimplementa, verificado por un test mecánico que falla si el archivo importa `autorizacion-resolucion` o menciona `puedeResolverAjeno`, `vendedorId` o `empleadoId` juntos.
- **Baja total de los cinco comandos de TUI**, en el mismo PR que el alta de su dominio (ADR 148 alternativa 2, mismo criterio que v3.6): `DESCRIPTORES` pasa de dieciocho a **trece**. El reparto de canales que `operaciones-negocio-conversacionales` inauguró (chat = trabajo transaccional, TUI = administración) queda **completo**: ningún comando transaccional sigue en la TUI.
- ★ **R7 (Deuda 5) queda CERRADA** — ver Deuda 5 actualizada más abajo.
- **Ranura de confirmación generalizada a multi-slot** (`Map` de `Map`s por `(empleadoId, dominio, itemId)`, con `accion` como parte del PREDICADO, no de la llave): un cambio de acción sobre el mismo ítem (por ejemplo, pedir "rechazá V1" y después "aprobá V1") reemplaza la ranura pendiente y exige un eco y una confirmación nuevos — nunca ejecuta la acción vieja ni la nueva sin confirmar. `handleLogout` limpia TODAS las ranuras pendientes del empleado (antes limpiaba sólo una).
- **Prompt y skills**: `INSTRUCCION_OPERACIONES_EMPLEADO` (`definitions.ts`), `buildOperacionesEmpleadoPrompt` (`soporte-prompt.ts`) y `OPERACIONES_TOOL_DESCRIPTION` (`adapters/operaciones/index.ts`) suman una instrucción explícita: la `accion` tiene que salir de una frase inequívoca del empleado, nunca deducida del contexto ni del dictamen de una solicitud. Dos skills nuevas (`resolver-reembolso`, `resolver-solicitud`), moldeadas sobre `cancelar-solicitud`, con un paso previo de pedir la acción antes de listar (el listado de reembolso depende de la acción elegida).

**Deuda declarada por este change**: ninguna nueva más allá del residual de R11 — ver Riesgo 8 (R11) más abajo.

## Concepto 11: Devolución sin token y sin que el cliente vuelva a intervenir — dos personas (v3.12, `devolucion-sin-token-dos-personas`)

Hasta v3.11 la única credencial que autorizaba una devolución era el `token_confirmacion` de la venta (ADR 22) — si el empleado lo perdía, o el cliente ya no estaba disponible para repetirlo, no había camino de negocio para devolver. `devolucion-sin-token-dos-personas` abre un segundo camino, por `ventaId`, sin depender del cliente: dos operaciones nuevas en la herramienta `operaciones` (diez en total), `consultar_venta { ventaId? }` (sólo lectura, escopada a venta propia, proyección que EXCLUYE `token_confirmacion` siempre) y `solicitar_devolucion { ventaId?, motivo? }` (escala SIEMPRE a `store.escalarReembolso`, sin mirar el monto, sin importar ni mencionar `evaluarReembolso`/`aprobarReembolso` en ninguna rama — test mecánico de ausencia). El cierre lo sigue haciendo `resolver_reembolso` de v3.10, **sin una línea de diff**.

- ★ **El ADR 22 queda ENMENDADO** — no derogado en la práctica, con estas tres líneas:
  - **Qué se abre**: un camino de iniciación por `ventaId` (`solicitar_devolucion`), que el ADR 22 original prohibía sin matiz ("sólo el token" autoriza una devolución).
  - **Qué lo reemplaza**: escalación forzada (nunca auto-aprueba, sea cual sea el monto) + un `administrador` **distinto del vendedor** que cierra + confirmación en **dos turnos** + `motivo` obligatorio no vacío, persistido en tabla propia (`justificaciones_devolucion`).
  - **Quién es ahora el dueño de la prueba**: antes, "el cliente autorizó" (poseer el token era la prueba). Ahora, "dos empleados distintos, uno administrador, quedaron registrados" — el vendedor que pide y el administrador que aprueba, cada uno con su fila de auditoría.
- ★ **Invariante correlacionado — advertencia para cualquier refactor futuro**: los tres controles que v3.10 (`aprobacion-conversacional-hitl`) ya dejó probados — el predicado `puedeResolverAjeno` (Concepto Transversal 6), la prohibición de autoaprobación del ADR 211 (`venta.vendedorId === sesion.empleadoId` ⇒ `autoaprobacion_prohibida`), y la confirmación en dos turnos (`LlaveConfirmacion`) — **son ahora la MITAD del control de la devolución sin token**, no un detalle heredado de paso. `solicitar_devolucion` no reimplementa ninguno de los tres: los compone, apoyándose en que `resolver_reembolso` los sigue aplicando sin cambio. **Si un refactor futuro relaja cualquiera de los tres, deroga este change en silencio** — sin que ningún test de `devolucion-sin-token-dos-personas` lo detecte, porque ese change nunca los reescribió.
- ★ **Precondición OPERATIVA, no de software (R5b)**: la vía nueva **necesita al menos dos empleados, uno de ellos con rol `administrador` que no sea el vendedor**. Con un solo usuario, o si el único `administrador` es también el vendedor, el mecanismo no se puede ejercer — falla **cerrada**, misma restricción que ya regía para todo reembolso sobre el umbral desde v3.10 (no es deuda nueva), pero este change la vuelve más frecuente porque ahora también aplica a montos chicos.
- **R12 reconfirmada sin cambio** (Riesgo 4, más abajo): `consultar_reporte_comisiones` sigue sin gate de rol ni escopado por vendedor. `devolucion-sin-token-dos-personas` no la agrava ni la resuelve — `consultar_venta`, la operación de lectura nueva de este change, **sí** nace escopada a venta propia, y eso no contradice R12: son dos lecturas distintas (un reporte agregado ya confirmado vs. una venta individual que alimenta un camino de dinero), y heredar la laxitud de una no obligaba a fabricarla en la otra.
- ★ **Cambio de postura del TTL de sesión — DECISIÓN, no un ajuste de paso**: `SESION_TTL_MINUTOS` pasa de 30 a **480** como default, sin cambiar de significado (sigue siendo el tope absoluto, no renovable). Lo que hace ese default subible es una variable nueva, `SESION_INACTIVIDAD_MINUTOS` (default 30 — la sesión ociosa sigue muriendo exactamente cuando moría antes de este change), y un campo nuevo de sesión (`inactivaEn`), renovado en los dos escritores de la sesión (HTTP, dentro de `buscar()`; TUI, dentro del paso de purga del turno). Antes de este change, una conversación larga de más de 30 minutos perdía la sesión aunque se la estuviera usando activamente — ahora sólo la pierde por inactividad real o por el tope absoluto de 480 minutos.

**Deuda declarada por este change**: ninguna nueva — ver Riesgo 9 (R5b) más abajo, aceptado y falla cerrado, no una deuda pendiente de resolver.

**Addendum v3.14 (`consulta-solicitud-propia`)**: la herramienta `operaciones` llega a **once** operaciones — la nueva es `consultar_solicitud { solicitudId? }`, sólo lectura y escopada a solicitud propia (mismo criterio de proyección que `consultar_venta`), con el gate de propiedad viviendo en el núcleo (ADR 238) y sin fila de auditoría en ninguna rama.

**Addendum v3.15 (`visibilidad-a2a-entrante-chat`)**: la herramienta `operaciones` llega a **doce** operaciones — la nueva es `ver_solicitudes_a2a { a2aTaskId? }`, sólo lectura y de alcance organizacional (no escopada al empleado, a diferencia de `consultar_venta`/`consultar_solicitud`), que expone desde el chat las solicitudes que un agente externo le hizo al arnés vía A2A entrante.

**Addendum v3.16 (`consulta-kpi-a2a-chat`)**: la herramienta `operaciones` llega a **trece** operaciones — la nueva es `consultar_kpi { consultaId }`, que despacha por el camino A2A saliente del núcleo una consulta de KPI (clave de un catálogo cerrado) al destino `kpi-incidente`. Es la **única operación con efecto fuera del arnés** (manda contexto de la empresa a un tercero) y por eso exige rol `administrador`. Los conteos de "diez", "once" y "doce" de esta sección describen el estado de v3.12, v3.14 y v3.15; el estado vigente desde `v3.16.0` es trece.

# Decisiones de Diseño

## ADR 1: Estrategia de entrega incremental (v1 lineal → v2 swarm → v3 grafo)

**Contexto**: El tutor empresarial exige que el diseño preceda a la implementación, con versionamiento y tags en GitHub, y que el repositorio muestre el proceso de construcción paso a paso (Restricción Organizacional, Sección 2). En la Vista de Bloques ya identificamos que Delegación a Subagentes, Cliente A2A y Servidor A2A no son necesarios para un primer MVP funcional.

**Decisión**: Se define una hoja de ruta de tres hitos:

- v1 (MVP lineal): un solo agente definido, turno básico sin delegación, consulta a conocimiento. Cierra el objetivo general y los objetivos 2, 3, 4, 5, y 6 parcial (agentes, comandos, hooks, skills — sin subagentes ni A2A).

- v2 (swarm): habilita Delegación a Subagentes y Cliente A2A — el arnés delega hacia adentro y hacia afuera. Cierra el resto del objetivo 6 y comienza el objetivo 7.

- v3 (grafo): habilita Servidor A2A — el arnés puede recibir invocaciones de otros agentes, no solo iniciarlas. Completa el objetivo 7.

Cada hito cierra con un tag semántico (v1.0.0, v2.0.0, v3.0.0) y un directorio docs/progreso/vX.Y-nombre/.

**Alternativas consideradas**:

- Entregar todo el alcance de una sola vez: rechazada — contradice la exigencia explícita del tutor y no permite validar el núcleo antes de sumar la complejidad multi-agente.

- Hitos por bloque de construcción en vez de por capacidad (ej. "primero todo el Adaptador TUI"): rechazada — un adaptador solo, sin el núcleo que lo consuma, no es un incremento demostrable.

**Consecuencias**: v2 y v3 dependen de que v1 cierre primero. Si el tiempo de la pasantía se agota antes de v2, el MVP lineal sigue siendo un entregable completo y coherente por sí mismo, no un producto a medio construir.

## ADR 2: Monolito modular vs. monorepo

**Contexto**: El tutor sugirió a Pi como referencia de arquitectura, cuyo código está organizado como monorepo con paquetes independientes (cada uno versionable y publicable por separado). Esto planteó la pregunta de qué convención de carpetas usar para separar el Núcleo de los cuatro adaptadores ya definidos en la Vista de Bloques.

**Decisión**: Organizar el código como un monolito modular de un solo paquete — carpetas src/core/ y src/adapters/* — en vez de un monorepo con paquetes independientes.

**Alternativas consideradas**:

- Monorepo con paquetes npm independientes: rechazada — el alcance es un MVP de pasantía corta con un solo desarrollador; la sobrecarga de versionar y publicar cada paquete por separado no se justifica sin un caso real de reutilización externa.

**Consecuencias**: Si en el futuro se necesita reutilizar un adaptador (p. ej. el A2A) en otro proyecto, migrar de monolito modular a monorepo es un refactor de carpetas, no un cambio de arquitectura — las fronteras de puertos y adaptadores ya están definidas independientemente de cómo se empaquetan.

# Requerimientos de Calidad

## Árbol de Calidad

**Mantenibilidad**

- Extensibilidad del núcleo (Meta 1)

- Observabilidad de las respuestas (Meta 3)

**Fiabilidad / Adecuación funcional**

- Corrección funcional multi-turno (Meta 2)

**Portabilidad**

- Operabilidad local (Meta 4)

**Usabilidad**

- Usabilidad de la interfaz operativa TUI (Meta 5)

**Compatibilidad**

- Interoperabilidad vía A2A (Meta 6)

## Escenarios de calidad

**Escenario 1: Extensibilidad del núcleo**

Estímulo: se agrega un nuevo agente al catálogo (Definición y Carga de Agentes).

Respuesta esperada: el nuevo agente queda disponible sin modificar el Selector de Turno, el Ensamblador de Contexto, ni ningún adaptador.

Medida: cero cambios fuera de src/core/agents/ para agregar un agente.

Escenario 2: Corrección funcional multi-turno

Estímulo: el empleado envía un segundo prompt en la misma sesión, después de que el primero generó una respuesta.

Respuesta esperada: el Ensamblador de Contexto resuelve vía I3 la sesión del SDK a retomar (options.resume), que aporta el historial completo de ese agente; el contexto de un agente no se mezcla con el de otro que haya participado en el mismo caso.

Medida: el modelo recibe el historial completo del agente correspondiente en el segundo turno; ningún mensaje de otro agente aparece en su contexto.

Escenario 3: Observabilidad de las respuestas

Estímulo: el empleado hace una consulta que requiere la base de conocimiento (Escenario de ejecución 2).

Respuesta esperada: la respuesta final incluye la fuente citada del vault de Obsidian, no solo el texto generado por el modelo.

Medida: el 100% de las respuestas que consultan I2 incluyen la referencia a la fuente en el texto renderizado (salida por I1).

Escenario 4: Operabilidad local

Estímulo: se instala el arnés en una máquina nueva, sin infraestructura previa.

Respuesta esperada: el proceso arranca y queda operativo sin necesidad de levantar contenedores, servicios externos propios, ni una base de datos con servidor.

Medida: el único requisito de arranque es tener Node.js instalado y las credenciales de la Anthropic API configuradas.

Escenario 5: Usabilidad de la interfaz operativa (TUI)

Estímulo: un empleado sin experiencia previa con el arnés abre la TUI por primera vez.

Respuesta esperada: la interfaz muestra el estado del agente (esperando entrada, procesando, delegando) de forma visible en todo momento.

Medida: el empleado puede identificar en qué estado está el agente sin consultar documentación externa. (Medida cualitativa — a validar con feedback real del tutor u otro usuario; la usabilidad no se presta a un número duro en este MVP sin pruebas de usuario.)

**Escenario 6: Interoperabilidad vía A2A**

Estímulo: un agente externo, de otro origen, envía una solicitud A2A al arnés (desde v3, cuando el Servidor A2A está activo).

Respuesta esperada: el arnés traduce la solicitud JSON-RPC (I4) a un turno del Núcleo sin requerir adaptación especial del agente externo, más allá de cumplir el protocolo A2A estándar.

Medida: la solicitud se procesa usando el mismo Selector de Turno que atiende al Empleado — no existe un camino de código separado para solicitudes A2A.

# Riesgos y deuda técnica

**Riesgos**

**Riesgo 1: Dependencia de un solo proveedor de modelo**

Descripción: el puerto *ModelProvider* tiene un solo adaptador implementado (Claude Agent SDK). Un segundo proveedor puede exigir un loop de razonamiento propio si no es compatible con el modelo de ejecución del SDK — no sería solo "agregar un adaptador más", como sí sería con el Adaptador de Conocimiento o el de Memoria.

Mitigación: no se resuelve en este MVP; se documenta como decisión aceptada en el ADR de la sección de decisiones de diseño si se retoma en una iteración futura.

**Riesgo 2: Concurrencia de escritura en SQLite bajo múltiples agentes A2A (v3) — CONFIRMADO, sin materializarse en el escenario probado**

Descripción: cuando el Servidor A2A está activo, el proceso puede recibir varias solicitudes externas al mismo tiempo, y esas escrituras pueden solaparse con las de otras fuentes (por ejemplo, un webhook de PR sobre el mismo proyecto). SQLite serializa escrituras — si dos sesiones distintas escriben en simultáneo, puede haber contención o errores de bloqueo.

Evidencia: `src/test/integration/a2a-server.integration.test.ts` (Hito 7, tarea 17, design.md §10.D + §10.C fila de concurrencia) ejercita 3 `SendMessage` concurrentes contra el servidor A2A entrante real **más** un turno de actividad de webhook (`buildOnActivity`) sobre el mismo `proyectoId`, ambos con el mismo `db` real (no `:memory:` aislado por lado) y el mismo `handleTurn` con un delay idéntico para las dos fuentes. El test afirma tiempo total de ejecución muy por debajo de la suma secuencial de las cuatro invocaciones (evidencia de entrelazado real, no sólo del resultado final), y verifica al cierre: `N` filas en `solicitudes_a2a_entrantes`, todas `TASK_STATE_COMPLETED` con `caso_id` no nulo; exactamente 1 fila de actividad para el `proyectoId` del webhook; y `N + 1` filas totales en `casos`, sin ninguna fila cruzada ni perdida entre las dos fuentes.

Alcance de la confirmación: el escenario probado (3 `SendMessage` + 1 webhook, turno de negocio mockeado con `handleTurn`) no reprodujo contención ni error de bloqueo — el turno A2A entrante es de lectura y no usa `KeyedQueue` (ADR 90 pto 7), y el webhook de actividad sigue serializado por su propia `KeyedQueue` por `proyectoId`. No queda probado el comportamiento bajo un volumen de escritura mayor al de este escenario; si el volumen real lo exige, sigue pendiente evaluar WAL mode de SQLite, cola de escrituras, o un motor con mejor soporte de concurrencia.

**Riesgo 3 (R10): Ausencia de modelo de autorización — CERRADO en v3.5 (`autorizacion-empleado`)**

Descripción: `tui-canal-empleado` (v1.4.0) dejó documentado, en tres lugares distintos (`proposal.md:65,586` y el encabezado de la migración `0006_credenciales_empleado.ts:11-16`), que autenticar a un empleado no implica saber qué puede hacer: cualquier empleado con sesión vigente podía aprobar el reembolso escalado de cualquier venta, resolver la solicitud interna de cualquier compañero, y **aprobar la suya propia**. `operaciones-negocio-conversacionales` nombró esta deuda **R10** y bloqueó su propio ADR 151 (mover los comandos privilegiados a conversación) hasta que se cerrara — decisión del checkpoint humano.

Cierre: con `autorizacion-empleado` (v3.5), el gate de autorización (`puedeResolverAjeno`) queda dentro de `resolverEscalacionReembolso` y `resolverSolicitudInterna`, y la prohibición de autoaprobación queda dentro de `resolverSolicitudInterna` (Concepto Transversal 6). Evidencia: los tests de las tareas 2.2 y 3.1 de `autorizacion-empleado/tasks.md` demuestran, con un empleado de rol base, que ni la escalación de reembolso ni la solicitud interna ajenas se pueden resolver — un escenario que antes de este change pasaba en verde y ahora falla por diseño — y que un empleado con rol `administrador` sí puede, salvo sobre su propia solicitud.

**Riesgo 4 (R12): `consultar_reporte_comisiones` sin gate de rol ni escopado por vendedor — ACEPTADA por checkpoint, no es un bug pendiente (v3.6, `operaciones-negocio-conversacionales`)**

Descripción: la sexta operación de la herramienta `operaciones` (Concepto Transversal 7) reusa verbatim el pipeline de `manejarReporteComisiones` (`resolverPeriodoReporte`/`agruparReporteMensual`/`formatearReporteMensual`) — sin gate de rol y sin ningún parámetro que permita escopar el resultado a un vendedor o empleado en particular. Cualquier empleado con sesión vigente que invoque `consultar_reporte_comisiones` (o el comando TUI `/reporte-comisiones`, que ya tenía el mismo comportamiento) ve el reporte completo de todos los vendedores del período.

Mitigación/cierre: no aplica — es una **herencia deliberada**, no un hallazgo nuevo. `/reporte-comisiones` (TUI, desde v3.2.0) ya tenía exactamente este comportamiento; la Enmienda 5 del change `operaciones-negocio-conversacionales` lo hizo explícito para el segundo canal (HTTP) y el checkpoint lo aceptó sin pedir un gate de rol ni un filtro por vendedor. Queda documentada para que una futura revisión de "quién puede ver el reporte de qué" encuentre la decisión ya tomada, en vez de tratarla como un descuido de este change.

**Addendum v3.9 (`chat-web-empleado`)**: esta herencia **no se agrava**, pero el canal se ensancha — de "HTTP autenticado que hay que saber armar con `curl`" a "una caja de texto en una pantalla de chat". `consultar_reporte_comisiones` sigue sin gate de rol y sin escopar por vendedor, ahora detrás de la interfaz de menor fricción que el arnés tiene. El checkpoint reconfirmó explícitamente que sigue aceptando este riesgo en el canal de chat, con el mismo criterio con que lo aceptó al aprobar la Enmienda 5 de v3.6.

**Addendum v3.12 (`devolucion-sin-token-dos-personas`)**: **reconfirmada sin cambio.** `consultar_venta`, la operación de lectura nueva de este change, nace escopada a venta propia — pero eso no reabre ni resuelve R12: son lecturas de naturaleza distinta (un reporte agregado de comisiones ya confirmadas vs. una venta individual puntual que alimenta un camino de dinero, ADR 223). `consultar_reporte_comisiones` sigue exactamente como en el addendum de v3.9, sin gate de rol y sin escopado por vendedor.

**Riesgo 6 (R11): `options.resume` a una sesión del SDK que el SDK ya no tiene — DECLARADA, sin reintento automático a propósito (v3.9, `chat-web-empleado`)**

Descripción: si el SDK pierde la sesión a la que apunta `options.resume` (poda de su store en disco, cambio de `cwd`), todos los mensajes siguientes de esa conversación fallan con `502`, sin recuperación automática.

Por qué no se reintenta: prohibido a propósito (ADR 196 pto 9 de `chat-web-empleado/design.md`) — la falla puede ocurrir DESPUÉS de que la tool ya ejecutó una operación de negocio (`registrar_venta`, `procesar_devolucion`), y un reintento automático la duplicaría. Es la misma clase de decisión que ya rige el resto del arnés: nunca reintentar un turno cuya tool pudo haber tenido efecto.

Salida actual, única: logout + login, que abre una conversación nueva. Es una limitación de cliente **declarada**, con copy explícito del `502` en la UI en vez de prometer una recuperación que no existe. Condición de disparo para revisitarla: que el hito quiera un botón explícito de "empezar conversación nueva" en vez de depender del logout completo (`design.md` §18 de `chat-web-empleado`).

**Riesgo 7 (R5): Sesiones y conversaciones sin evicción periódica en `Map`s de proceso — DECLARADA, no resuelta (v3.9, `chat-web-empleado`)**

Descripción: `SesionEmpleadoStore` (desde v3.6) y el `ConversacionEmpleadoStore` nuevo de v3.9 filtran entradas vencidas al leer (`buscar`/`paraSesion`), pero nunca las borran del `Map` si nadie vuelve a pedirlas — es la misma fuga de memoria lenta que la Aclaración 2 pto 6 de `chat-web-empleado/proposal.md` ya había nombrado para las sesiones antes de este change. `casos` y `sesiones_agente` también crecen una fila por mensaje, y el chat multiplica el volumen de mensajes frente a `curl`.

Mitigación en este change: `POST /logout` (ADR 195/202) limpia sesión, conversación y confirmación pendiente cuando el empleado cierra sesión explícitamente — pero eso no ataca el caso de una sesión abandonada sin logout.

Cierre: no aplica en este change — queda **declarada, no arrastrada en silencio**. Condición de disparo: un change propio que agregue evicción periódica (timer o barrido en el acceso) a los `Map`s de proceso del adaptador web, y una revisión del crecimiento sin límite de `casos`/`sesiones_agente`.

**Riesgo 5 (R1): `/crear-empleado` deja la contraseña de OTRA persona visible en el transcripto de la TUI — ACEPTADA por checkpoint, con procedimiento de mitigación obligatorio (v3.7, `comandos-administracion-empleados`)**

Descripción: `/crear-empleado <empleadoId> <password>` tipea la contraseña como argumento de la línea de comandos de la TUI, sin enmascarar (`tui-port.ts`/`App.tsx`/`start-tui.tsx` no se tocan, ADR 21 de `tui-canal-empleado` sin modificar). El residual que `tui-canal-empleado` ya había aceptado para `/login` (**R14**: la propia contraseña del empleado, visible en su propio transcripto) se extiende acá a un caso más delicado: la contraseña visible es la de **otra** persona, tipeada por un `administrador`.

Lo que NO se relaja pese a este residual (ADR 174 pto 2): la contraseña sigue sin persistirse en claro (mismo hash `scrypt` que el CLI), sigue sin aparecer en ninguna fila de `registro_acciones_empleado`, y sigue sin aparecer en ningún evento de `logTurnEvent` — invariante ya testeado para `/login` (`build-on-comando-empleado.test.ts:524`) y extendido a `/crear-empleado`. El residual se acota a UNA sola superficie: el transcripto de la sesión de TUI de quien ejecuta el comando.

Mitigación, obligatoria — **procedimiento de rotación por CLI**: inmediatamente después de comunicar la contraseña inicial al empleado nuevo por un canal fuera de banda (no por el mismo transcripto), el `administrador` rota esa contraseña con `npm run empleados:crear -- <empleadoId> --rotar` (contraseña nueva por `stdin`, nunca por `argv` — ADR 33 pto 2). Tras la rotación, la contraseña que quedó visible en el transcripto deja de ser válida.

Condición de disparo para levantar el residual, no para mitigarlo más: que exista enmascarado de entrada en la TUI (RD-81 de `proposal.md`, que reabre ADR 21 de `tui-canal-empleado` — `tui-port.ts`/`App.tsx`/`start-tui.tsx`, explícitamente fuera de alcance de este change).

**Riesgo 8 (R11): Falso positivo por colisión improbable entre `vendedorId` y `empleadoId` en la prohibición de autoaprobación de reembolso — DECLARADA, residual aceptado, falla cerrado (v3.10, `aprobacion-conversacional-hitl`)**

Descripción: el mecanismo que cierra R7 (Deuda 5) compara `venta.vendedorId === sesion.empleadoId` sin ligar `vendedores` y `credenciales_empleado`/`roles_empleado` por esquema (no hay FK entre esos dos espacios de identidades). Si un `vendedorId` externo, del payload de `POST /ventas`, coincidiera por casualidad con un `empleadoId` real del arnés, el predicado daría un falso positivo: ese `administrador` no podría resolver **esa venta puntual** por el canal conversacional, aunque no sea su propia venta.

Por qué se acepta: es improbable (exige una colisión exacta de strings entre dos padrones administrados aparte, sin normalización de mayúsculas ni espacios en ningún punto del viaje del dato), **no es un hueco de seguridad** — falla cerrado, deniega de más, nunca permite una autoaprobación real — y el operador tiene salida por el canal de siempre (otro administrador resuelve la venta, o se usa `POST /ventas`/soporte para el caso puntual). Prohibido "arreglarlo" relajando el predicado: reduciría la garantía real (que sí puede dispararse en el camino de producción que este change construye) a cambio de eliminar un falso positivo de probabilidad despreciable.

Cierre: no aplica — queda **declarada, no arrastrada en silencio**, mismo tratamiento que el resto de los residuales de esta serie (Riesgo 5/R1, Riesgo 6/R11 de `chat-web-empleado`). Condición de disparo: si algún día se liga `vendedores` con `credenciales_empleado`/`roles_empleado` por otra razón (ver Deuda 5, ya cerrada, para el motivo por el que esa ligadura no hacía falta para R7), este residual desaparece como efecto colateral.

**Riesgo 9 (R5b): La devolución sin token exige al menos dos empleados, uno administrador que no sea el vendedor — precondición OPERATIVA, ACEPTADA, falla cerrado (v3.12, `devolucion-sin-token-dos-personas`)**

Descripción: `solicitar_devolucion` siempre escala, sin excepción, y sólo `resolver_reembolso` — con el predicado de separación de funciones intacto (Riesgo 3/R10, Concepto Transversal 6) — puede cerrarla. Si la organización tiene un solo `administrador` y ese mismo `administrador` es el vendedor de la venta, o si no tiene ningún `administrador`, esa venta puntual **no se puede devolver por la vía nueva**: el vendedor que la inició siempre choca contra `autoaprobacion_prohibida` al intentar cerrarla, sin excepción posible.

Por qué se acepta: no es deuda nueva — es exactamente la misma restricción que ya rige, desde v3.10, para todo reembolso escalado sobre el umbral (`aprobacion-conversacional-hitl`). Este change la hace **operativamente más frecuente**, porque ahora también aplica a montos chicos que antes se auto-aprobaban sin pasar por un administrador. Falla **cerrada**: nunca se resuelve relajando el gate de separación de funciones — la salida es organizacional (dar de alta un segundo `administrador` con `/asignar-rol`, Concepto 8), no de software.

Cierre: no aplica — es una **precondición operativa declarada**, no un bug pendiente. Queda anotada acá y en la evidencia manual de este change (`docs/progreso/v3.12-devolucion-sin-token-dos-personas/`) para que un despliegue con un solo empleado no la descubra en producción como una sorpresa.

**Deudas Técnicas**

**Deuda 1: Política concreta de manejo de errores sin especificar**

Descripción: el Concepto Transversal 1 (sección de conceptos transversales) establece que debe existir una convención única de manejo de errores, pero no fija todavía la política concreta (cuántos reintentos, timeouts, cuándo degradar vs. abortar el turno).

Plan: especificar antes de implementar el Invocador del Modelo y el Motor de Hooks, que son los puntos donde más falta hace.

**Deuda 2: Adaptador A2A implementado pero sin ejercitar en v1 — CERRADA en v3**

Descripción: el código del Adaptador A2A existía desde el diseño pero no se probaba en un flujo real — riesgo de que quedara desactualizado respecto al resto del núcleo para cuando se activara.

Cierre: con el Servidor A2A entrante del Hito 7 (v3.0.0), el adaptador queda ejercitado extremo a extremo por `src/test/integration/a2a-server.integration.test.ts` (Hito 7, tarea 17): levanta el servidor real en puerto efímero, lo consulta con el Cliente A2A propio del Hito 6 (`delegarTarea`, sin modificarlo y sin tocar `DESTINOS_A2A`), y recorre el ciclo completo `GET` del Agent Card → `SendMessage` → loop real de `GetTask` → `TASK_STATE_COMPLETED` con el texto del resultado — el primer test del proyecto que ejercita ese loop contra un socket real, no con reloj inyectado. El test corre en CI y no degrada a *skip* (a diferencia del test de integración del Cliente A2A saliente del Hito 6, que sí depende de un sample externo). Ya no queda código de este adaptador sin ejercitar en un flujo real.

**Deuda 3: Medida de usabilidad sin validar con usuarios reales**

Descripción: el Escenario de calidad 5 (sección de requerimientos de calidad) usa una medida cualitativa por falta de pruebas de usuario; se aceptó conscientemente para el alcance del MVP.

Plan: validar con el tutor u otro usuario real una vez que la TUI esté operativa.

**Deuda 4: Definición de Skills del objetivo específico 6 sin implementar — CERRADA en v3.1**

Descripción: el objetivo específico 6 del alcance ("Crear el arnés básico con TUI que maneje... Definición de Skills") lista Skills junto con agentes/subagentes, comandos, hooks y A2A. De esos cinco, Agentes/subagentes (v2.0.0), Comandos (v1.4.0), Hooks (Motor de Hooks propio, Hito 1 tarea 6, invocado en `invoke-model.ts`) y A2A (cliente v2.2.0, servidor v3.0) están implementados y ejercitados. **Skills nunca se implementó**: `Options.skills` del Claude Agent SDK no se lee ni se popula en ningún punto de `src/core` — confirmado por auditoría (grep completo sobre `src/core`) y por el propio comentario de `invoke-model.test.ts` ("`skills`, `plugins`, `uuid`... que `invokeModel` nunca lee").

Cierre: con `definicion-skills` (v3.1.0), el Registro de Skills queda implementado y ejercitado de punta a punta. El cargador (`src/core/skills/skill-frontmatter.ts` + `descubrir-skills.ts` + `skills-habilitadas.ts`) descubre `.claude/skills/<nombre>/SKILL.md` desde disco real, con DI de filesystem (molde `turn-logger.ts`) y valida el frontmatter contra una whitelist de exactamente dos campos (`name`/`description`, tope 1024 — más estricta que el SDK, a propósito, ADR 110). Es el **tercer** registro que fija `bootstrapHarness` (después de Agentes y Hooks), con la misma semántica degrada/aborta que el resto del arnés (`HarnessBootstrapError`, ADR 111). `toQueryOptions`/`invokeModel` (`src/core/turn-selector/invoke-model.ts`) emiten `skills` y `settingSources: ["project"]` dentro del literal inicial de `Options` — nunca detrás de un `if`, nunca `'all'`, nunca omitidos (ADR 108). Al menos una skill real y versionada (`citar-conocimiento`, `.claude/skills/citar-conocimiento/SKILL.md`) queda entregada dentro de este mismo change, sujeta a los tres límites del ADR 106. `src/test/integration/skills.integration.test.ts` ejercita el invariante negativo contra disco real (una skill plantada fuera de `.claude/skills/` nunca aparece habilitada) y verifica RD-48 (que `process.cwd()` y la raíz derivada de `import.meta.url` resuelven la misma base). Ya no queda ninguna de las cinco capacidades del objetivo específico 6 sin implementar.

**Deuda 5 (R7): Autoaprobación de reembolso por el propio vendedor — CERRADA en v3.10 (`aprobacion-conversacional-hitl`)**

Descripción original: el gate de `autorizacion-empleado` (v3.5) exigía rol `administrador` para resolver una escalación de reembolso ajena, pero no podía impedir que un vendedor con ese rol aprobara el reembolso escalado de **su propia venta**. La prohibición de autoaprobación (Concepto Transversal 6) sólo aplicaba a solicitudes internas, no a escalaciones de reembolso, porque `vendedores` (`id`, `nombre`, `created_at`) y `credenciales_empleado`/`roles_empleado` (`empleado_id`) son **dos espacios de identidades sin ninguna ligadura por esquema** — ni FK, ni columna, ni código que traduzca un `vendedor_id` a un `empleado_id`. Se había declarado que cerrarla exigía esa ligadura, deliberadamente **fuera de alcance** de `autorizacion-empleado` (ADR 155 pto 3 de esa propuesta).

★ **Cierre, con el mecanismo escrito**: esa premisa —que cerrar R7 exigía ligar tablas— resultó incompleta. `aprobacion-conversacional-hitl` verificó que el canal conversacional **ya escribe `vendedorId = sesion.empleadoId` literal** al registrar una venta (`ejecutar-operacion.ts:334`, ADR 171 pto 2): para toda venta nacida del canal conversacional, `vendedorId` y `empleadoId` **ya son el mismo espacio de identidad**, sin necesidad de FK ni migración. R7 se cierra con una **comparación directa**, no con ligadura de tablas: `venta.vendedorId === sesion.empleadoId`, evaluada dentro de `resolverEscalacionReembolso` inmediatamente después del gate de rol y antes del CAS, devolviendo un miembro nuevo de la unión (`autoaprobacion_prohibida`) — molde literal de la prohibición equivalente que `resolverSolicitudInterna` ya tenía (`:229-236`). Cero migración, cero provisioning, cero backfill, cero cambio de store/puerto/query/firma.

El control queda verificado en los **dos sentidos**, no sólo en el positivo: dispara sobre una venta dada de alta por el canal conversacional (el vendedor es el mismo empleado que intenta aprobar), y **no** dispara sobre una venta de `POST /ventas` (identidad externa, sin sesión de empleado detrás) — sin el segundo escenario el control no se distinguiría de un fixture complaciente que pasa en verde sin proteger nada en producción.

Residual aceptado, nombrado con dueño: ver Riesgo 8 (R11) — falso positivo por colisión improbable de strings entre los dos padrones, falla cerrado, no bloqueante. La ligadura de `vendedores` con `credenciales_empleado`/`roles_empleado` por esquema sigue sin existir y **ya no es condición para nada relacionado con R7**; si se hace algún día, será para unificar identidades por otro motivo.

**Deuda 6: Exposición de datos en vista previa antes del gate de autorización — DECLARADA, no resuelta**

Descripción: el paso de "requiere confirmación" (`confirmado === false`) de `resolverEscalacionReembolso` (`resolver-escalacion-reembolso.ts`, paso D de la secuencia documentada en su cabecera, design.md ADR 159/RD-78) y el eco análogo de `resolverSolicitudInterna` (`resolver-solicitud-interna.ts`, mismo punto de la secuencia) devuelven el detalle completo (monto, caso, ítem) de una venta o solicitud **ajena** antes de que corra el gate de rol (`puedeResolverAjeno`) — cualquier empleado autenticado puede ver esos datos con solo tipear el comando, sin permiso para resolverlo y sin necesidad de confirmar.

Por qué existe: es el orden que `design.md` (ADR 159/RD-78) ya fijó a propósito — el gate de rol se evalúa recién en el punto donde se arma la escritura real (justo antes del CAS), no antes del eco de confirmación. Ese orden no es un descuido: adelantar el gate no compraría confidencialidad adicional en `resolverSolicitudInterna` (el listado sin id de `aprobar`/`rechazar` ya expone el mismo detalle a cualquier empleado, con o sin rol elevado), y mantiene el molde único de "eco antes de confirmar" compartido entre ambas funciones.

Cierre: no aplica — **el checkpoint humano decidió, en la revisión de `autorizacion-empleado`, declarar esta exposición como deuda técnica y no reordenar el gate**. No se modifica ningún archivo de `src/` por este hallazgo; el orden D-antes-que-E permanece exactamente como lo fijó `design.md`. Queda documentada para que una futura revisión de este mismo tema encuentre la decisión ya tomada y su justificación, en vez de reabrirla.

**Deuda 7 (ADR 178): Configuración del bot de PRs desde la TUI — DIFERIDA, con dos motivos verificados y condición de disparo escrita (v3.7, `comandos-administracion-empleados`)**

Descripción: el stakeholder pidió poder configurar `GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `WEBHOOK_PORT` y `WEBHOOK_PATH` desde la TUI. Dos hallazgos, verificados leyendo el código y no el documento: (a) `startWebhookServer` se llama **una** vez, al arrancar el proceso (`main.ts`), y `isWebhookEnabled` decide ahí mismo si se abre el puerto — un comando de TUI en runtime no puede abrir ni cerrar ese puerto; (b) `GITHUB_WEBHOOK_SECRET` y `GITHUB_TOKEN` son secretos **recuperables** (se usan en claro, no hasheados), y este repo no tiene ningún precedente de persistir un secreto recuperable — `credenciales_empleado.password_hash` es `scrypt` precisamente porque nunca hace falta recuperarlo.

Mitigación parcial, sí entregada: `/estado-bot-prs`, comando de solo lectura que responde si el listener está escuchando (puerto/path) y si `GITHUB_TOKEN` está presente, sin revelar ningún valor — atiende el "¿está andando?" sin tocar ningún secreto.

Condición de disparo, dos partes conjuntas: (a) una decisión tomada sobre dónde viven los secretos de integración de este arnés (`.env`, un gestor externo, o una bóveda propia con cifrado en reposo); (b) que el requerimiento se exprese sobre **qué** hace falta configurar en caliente — hoy el pedido es "que se pueda desde la TUI", no "que el listener arranque y pare sin reiniciar el proceso", que son dos changes de tamaño muy distinto.

**Deuda 8 (ADR 179): "Configuración por usuario, sin `.env`" — DIFERIDA por falta de referente verificable, no por tamaño (v3.7, `comandos-administracion-empleados`)**

Descripción: se buscó en los tres lugares donde podría existir una noción de configuración por empleado y el resultado fue negativo en los tres: ninguna de las tablas del esquema es de preferencias o settings, `src/core/config/env.ts` enumera todas las variables del sistema y todas son de proceso (globales), y ese mismo archivo declara explícitamente que la identidad de empleado nunca viene de configuración.

Hipótesis con más respaldo, no confirmada: "configuración del arnés para un usuario, sin `.env`" se lee como el paraguas de los otros pedidos de esta propuesta (alta de empleado, rol, bot de PRs) y no como una cuarta capacidad propia — construir un framework genérico de settings con cero settings conocidos sería infraestructura sin consumidor (mismo anti-patrón ya rechazado por nombre en `hito-2.2/design.md §15`).

Condición de disparo: que el stakeholder nombre al menos una cosa concreta que hoy sea global y deba pasar a ser por usuario (candidatas nombradas para ayudar a esa respuesta, no como alcance: `SESION_TTL_MINUTOS` por empleado, idioma/verbosidad de las respuestas de la TUI, o destinatario de notificaciones).

**Deuda 9 (RD-91, ADR 205 cuando se dispare): Migración del token a cookie `HttpOnly` — DIFERIDA, con forma escrita (v3.9, `chat-web-empleado`)**

Descripción: el token de sesión del chat vive en memoria de la pestaña (ADR 193) porque el adaptador web no parsea ni emite cookies en ninguna ruta hoy. La cookie `HttpOnly` + `Secure` + `SameSite=Strict` es la mitigación estructuralmente correcta del riesgo de XSS del Concepto 9 (ni un XSS exitoso puede leer una cookie `HttpOnly`), pero cambia el contrato de `POST /login` — fuera de alcance de v3.9.

Forma exacta para el change futuro, ya escrita para que no arranque de cero (`chat-web-empleado/design.md` §11): (1) `POST /login` **suma** `Set-Cookie: sesion=<token>; HttpOnly; Secure; SameSite=Strict; Path=/` sin quitar `token` del body, como ventana de compatibilidad para los consumidores `curl`; (2) `handleOperaciones` acepta la cookie o el header, con precedencia de la cookie; (3) con cookie hace falta sumar defensa CSRF (`Origin`/`Sec-Fetch-Site` en `/operaciones` y `/logout`, porque `SameSite=Strict` solo no alcanza en navegadores viejos); (4) el cliente deja de guardar el token y el ADR 193 se cierra; (5) recién en un tercer paso se puede quitar el token del body.

Condición de disparo: que el despliegue tenga TLS (sin `Secure` la cookie es peor que el estado actual) o que el adaptador gane parseo de cookies por otra necesidad.

**Deuda 10 (RD-92): Streaming incremental de la respuesta del chat — DIFERIDA, change propio (v3.9, `chat-web-empleado`)**

Descripción: `POST /operaciones` responde `{casoId, respuesta}` de una sola vez; el chat muestra la respuesta completa recién cuando el turno termina, sin token-por-token.

Por qué es change propio y no de la UI: `invokeModel` ya itera los mensajes del SDK pero acumula y devuelve al final (`invoke-model.ts:454-473`). Habilitar streaming exige (1) un callback de chunk en `InvokeModelResult`/`HandleTurnDeps`, (2) que `handleTurn` lo propague, y (3) que `/operaciones` responda `text/event-stream` en vez de JSON — un cambio de contrato que arrastra a los cuatro turnos del arnés si se resuelve en `invokeModel`, no sólo al de empleado.

Condición de disparo: que el costo de un cambio de contrato compartido por los cuatro turnos se justifique frente al beneficio de UX — evaluación que corresponde a un change propio, no a una extensión de v3.9.

**Deuda 11 (RD-94): Colisión de numeración ADR 174-187 — DIFERIDA, recomendación de forma escrita (v3.9, `chat-web-empleado`)**

Descripción: el rango ADR 174-187 quedó asignado **tres veces** a decisiones distintas y no relacionadas, porque `consultas-negocio-a2a-entrante`, `comandos-administracion-empleados` y `operaciones-negocio-conversacionales` se escribieron en paralelo y cada uno verificó el techo de numeración correctamente en su momento, sin reverificarlo al mergear. Hoy, *"ADR 180"* significa tres cosas distintas según el archivo que lo cite (`consultas-negocio-tool.ts:5`, `comandos-administracion-empleados/design.md`, `build-on-comando-empleado.ts:378`).

Recomendación para el change futuro que la resuelva (`chat-web-empleado/design.md` §11): **no renumerar** — hay ADRs citados en doc-comments de código vivo (`ejecutar-operacion.ts:92,160,...`, `build-on-comando-empleado.ts:378`) y renumerar rompería esas citas verificables. En su lugar, **prefijar por change en las citas nuevas** (`ADR 180 (consultas-negocio-a2a-entrante)`) y agregar una tabla de equivalencias a este arc42 que liste los tres usos de cada número colisionado.

Cierre: no aplica en v3.9 — este change **abrió su propia numeración en ADR 189**, por encima del máximo absoluto verificado, precisamente para no agregar una cuarta capa a la colisión. La colisión existente queda declarada, no resuelta.

# Glosario

| Término | Definición |
| --- | --- |
| TUI (Terminal User Interface) | Interfaz de usuario que corre dentro de una terminal de texto, en vez de una ventana gráfica o navegador. |
| MCP (Model Context Protocol) | Protocolo estándar para que un modelo de IA consulte fuentes de datos externas (en este proyecto, Graphify) de forma estructurada. |
| A2A (Agent2Agent) | Protocolo estándar de comunicación entre agentes de IA de distintos orígenes, sobre JSON-RPC. |
| JSON-RPC | Formato de mensajes para invocar funciones remotas usando JSON; es el formato sobre el que corre A2A en este proyecto. |
| ADR (Architecture Decision Record) | Documento breve que registra una decisión de arquitectura, sus alternativas consideradas y sus consecuencias. |
| ISO/IEC 25010 | Norma internacional que define las características de calidad de un producto de software (fiabilidad, mantenibilidad, usabilidad, etc.), usada en este documento para categorizar las Metas de Calidad. |
| MVP (Minimum Viable Product) | Versión mínima de un producto con la funcionalidad suficiente para ser útil y evaluable, sin todas las capacidades planeadas a largo plazo. |
| Vault | La carpeta raíz de un proyecto de Obsidian, donde se organiza toda la base de conocimiento en archivos Markdown enlazados entre sí. |
| Graphify | Herramienta de línea de comandos que indexa un vault de Obsidian en un grafo de conocimiento; se expone a los modelos de IA mediante un servidor MCP propio que envuelve su CLI, no de forma nativa. |
| Arquitectura hexagonal (puertos y adaptadores) | Patrón de arquitectura donde el núcleo de la lógica no depende de ningún sistema externo directamente, sino de contratos (puertos); cada sistema externo se conecta mediante un adaptador que implementa ese contrato. |
| Puerto | En arquitectura hexagonal, el contrato que define cómo el núcleo espera comunicarse con el exterior, sin conocer los detalles de implementación. |
| Adaptador | En arquitectura hexagonal, la implementación concreta de un puerto para un sistema externo específico. |
| Caja Negra | En arc42, la descripción de un bloque de construcción solo por su responsabilidad e interfaces, sin mostrar su estructura interna. |
| Caja Blanca | En arc42, la descomposición interna de un bloque de construcción, mostrando de qué sub-bloques está hecho. |
| Turno | Un intercambio único de solicitud-respuesta entre el empleado (u otro agente) y el arnés, dentro de una sesión multi-turno. |
|  |  |
