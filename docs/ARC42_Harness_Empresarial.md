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

### Caja Blanca bloque de construcción 4: Motor de Hooks

**Responsabilidad**: registra funciones que se disparan en puntos del ciclo de vida del turno (antes/después de una tool call, antes/después del turno completo), sobre el sistema de hooks nativo del Claude Agent SDK.

**Colabora con**: Selector de Turno.

**Ubicación**: *src/core/hooks/*

**Requerimiento satisfecho**: objetivo 6 — "Definición de hooks"

### Caja Blanca bloque de construcción 5: Registro de Skills

**Responsabilidad**: carga desde disco los paquetes de capacidad (skills) y los deja disponibles para que el agente los invoque durante el turno.

**Colabora con**: Selector de Turno.

**Ubicación**: *src/core/skills/*

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

**Nota de versión:** hito posterior — solo hace falta cuando otros agentes externos van a invocar a este arnés.

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

**Riesgo 2: Concurrencia de escritura en SQLite bajo múltiples agentes A2A (v3)**

Descripción: cuando el Servidor A2A esté activo, el proceso puede recibir varias solicitudes externas al mismo tiempo. SQLite serializa escrituras — si dos sesiones distintas escriben en simultáneo, puede haber contención o errores de bloqueo que hoy no están contemplados en el diseño (I3 asume acceso secuencial).

Mitigación: a evaluar en el diseño de v3 (WAL mode de SQLite, cola de escrituras, o migrar a un motor con mejor soporte de concurrencia si el volumen lo justifica).

**Deudas Técnicas**

**Deuda 1: Política concreta de manejo de errores sin especificar**

Descripción: el Concepto Transversal 1 (sección de conceptos transversales) establece que debe existir una convención única de manejo de errores, pero no fija todavía la política concreta (cuántos reintentos, timeouts, cuándo degradar vs. abortar el turno).

Plan: especificar antes de implementar el Invocador del Modelo y el Motor de Hooks, que son los puntos donde más falta hace.

**Deuda 2: Adaptador A2A implementado pero sin ejercitar en v1**

Descripción: el código del Adaptador A2A existe desde el diseño pero no se prueba en un flujo real hasta v2/v3 — riesgo de que quede desactualizado respecto al resto del núcleo para cuando se active.

Plan: cubrir con los Escenarios de ejecución 3 y 4 (sección de vista de ejecución) como base de pruebas apenas se active en v2.

**Deuda 3: Medida de usabilidad sin validar con usuarios reales**

Descripción: el Escenario de calidad 5 (sección de requerimientos de calidad) usa una medida cualitativa por falta de pruebas de usuario; se aceptó conscientemente para el alcance del MVP.

Plan: validar con el tutor u otro usuario real una vez que la TUI esté operativa.

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
