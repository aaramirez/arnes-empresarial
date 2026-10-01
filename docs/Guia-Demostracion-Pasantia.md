# Guía de demostración de la pasantía

Guion para presentar el proyecto **"Implementación de un arnés básico con memoria compartida para correr agentes de IA multi turno en un ambiente empresarial"** ante la tutora académica. Cubre, en este orden:

1. Los objetivos específicos 1 a 5 (investigación y base de conocimiento).
2. El objetivo general (memoria compartida).
3. El objetivo específico 6 (agentes, sub-agentes, comandos, hooks) y las skills y el protocolo A2A del cronograma.
4. Los casos de uso empresariales.

Cada bloque se muestra **siempre por los dos canales humanos del arnés**: la **TUI** (terminal) y el **chat conversacional web**. No se usa `curl` ni ninguna llamada HTTP manual.

Esta guía distingue con cuidado lo que **está verificado en el código** de lo que **depende del modelo** (la redacción exacta de las respuestas varía entre corridas). Donde hay una limitación real, se dice tal cual y se indica cómo presentarla. Ver también la sección 8 (brechas conocidas).

## Convenciones

- **Decir**: idea clave para explicar en voz alta.
- **Hacer**: acción concreta (comando o frase a escribir).
- **Mostrar**: archivo o pantalla que se abre.
- **Esperado**: resultado verificable.
- **Si falla**: plan B.
- Los bloques marcados con ★ forman la **versión corta** (aproximadamente 20 minutos). La versión completa dura entre 40 y 50 minutos.

## Mapa: objetivo de la propuesta → bloque de esta guía

| Objetivo de la propuesta | Bloque | Canales | Evidencia principal |
|---|---|---|---|
| 1. Estudio comparativo de arneses | A.1 ★ | Documento + TUI + chat | `cuadro-comparativo-harness-empresarial.html`, `Matriz-Comparativa.md` |
| 2. Lenguajes para el Claude Agent SDK | A.2 | Documento + TUI + chat | `Comparacion de lenguajes.pdf`, `Node-vs-Go.md`, ARC42 |
| 3. Librerías TUI | A.3 | Documento + TUI + chat | `Comparacion-Librerias-TUI.md`, `ink-testing-library` en el repo |
| 4. Funcionamiento del SDK, mensajes y flujos | A.4 | Documento + código + TUI + chat | `Referencia-Claude-Agent-SDK-Mensajes-y-Flujos.md`, ARC42, `invoke-model.ts` |
| 5. Obsidian + Graphify | A.5 ★ | Obsidian + `graphify query` + TUI + chat | `vault-conocimiento/`, `graphify-out/` |
| General: memoria compartida | B ★ | TUI + chat | SQLite `data/harness.db`, `sdkSessionId` en el log |
| 6. Agentes, sub-agentes, comandos, hooks | C ★ | TUI + chat | `src/core/agents/`, `commands/`, `hooks/`, `data/harness.log` |
| Cronograma sem. 5: skills y A2A | C.5 y E ★ | TUI + chat | `.claude/skills/`, `src/adapters/a2a/` |
| Cronograma sem. 6: casos empresariales | D ★ | Chat (+ TUI) | 14 skills, 13 operaciones de negocio |

---

## 0. Antes de empezar

### 0.1 Reglas de oro

1. **Ensayar la demo completa al menos una vez** (sección 0.3). Cada turno con el modelo consume la API real de Anthropic; no existe modo simulado.
2. **Hacerla en esta máquina.** `graphify-out/graph.json` está en `.gitignore`: solo existe localmente. En otro equipo el grafo hay que regenerarlo.
3. **El modelo no es determinista.** No prometer el texto exacto de una respuesta. Lo que sí es exacto y verificable son los **eventos del log** y los **datos** que quedan en la base.
4. **No afirmar de más.** Las limitaciones reales están en la sección 8; presentarlas con naturalidad es parte de la demostración.

### 0.2 Preparación del entorno

**Variables de `.env`** (referencia completa en `docs/Guia-Prueba-Tutor-Empresarial.md`, sección 3):

```
ANTHROPIC_API_KEY=<clave real>
WEB_PORT=8080
HARNESS_A2A_SALIENTE=on
HARNESS_A2A_ENDPOINT_KPI_INCIDENTE=http://localhost:9001
HARNESS_A2A_ENDPOINT_RIESGO_CREDITO=http://localhost:9002
```

Las tres últimas solo hacen falta para el bloque E (A2A).

**Estado limpio** (recomendado para que la demo no choque con datos de ensayos anteriores):

1. Detener el arnés si está corriendo.
2. **Renombrar** (no borrar) `data\harness.db`, `data\harness.db-wal` y `data\harness.db-shm` agregándoles `.bak`. **No tocar `data\harness.log`**: conserva evidencia histórica que se usa en C.2.
3. Crear el único usuario administrador por CLI (el segundo empleado se crea en vivo, en el bloque B):

```bash
npm run empleados:crear -- admin
npm run empleados:crear -- admin --rol administrador
```

**Servidor de prueba A2A** (una terminal aparte, dos instancias):

```bash
node "docs/progreso/v3.16-consulta-kpi-a2a-chat/mock-a2a-kpi.cjs"
```

```powershell
$env:MOCK_PORT="9002"; node "docs/progreso/v3.16-consulta-kpi-a2a-chat/mock-a2a-kpi.cjs"
```

**Distribución de ventanas**:

| Ventana | Contenido | Comando |
|---|---|---|
| Terminal 1 | La TUI | `npm run dev` |
| Terminal 2 | Log en vivo | `Get-Content -Path "data\harness.log" -Wait -Tail 0` |
| Terminal 3 | Mock A2A (dos procesos si se usan ambos destinos) | ver arriba |
| Navegador | Chat web | `http://localhost:8080/chat` |
| Explorador / editor | Archivos a mostrar | ver cada bloque |
| Obsidian (opcional) | Vault | abrir la carpeta `vault-conocimiento` |

### 0.3 Ensayo previo (checklist obligatorio)

- [ ] `npm run dev` arranca sin error y aparece la TUI.
- [ ] En el log aparece `skills-registro-cargado` con `cantidad: 14`.
- [ ] Un turno de texto libre en la TUI deja en el log las líneas `turno-iniciado` y `post-turn-hook-ejecutado`. **Punto crítico**: el `harness.log` histórico no contiene ninguna de las dos, porque son anteriores a los hooks reales. Confirmar que aparecen con el código actual antes de prometerlo.
- [ ] `graphify query "matriz comparativa de arneses"` devuelve nodos con `src=vault-conocimiento/...`.
- [ ] El chat web abre en `/chat` y permite iniciar sesión con `admin`.
- [ ] `/crear-empleado vendedor <clave>` en la TUI funciona y luego `vendedor` puede iniciar sesión en el chat web (comparten la base de credenciales; verificarlo en el ensayo).
- [ ] Una venta registrada por chat y confirmada aparece en `/reporte-comisiones`.
- [ ] `/consultar-kpi` responde con el mock levantado.

Después del ensayo, volver a renombrar la base a estado limpio (paso "Estado limpio") para la demostración real.

---

## 1. Apertura (1–2 minutos)

**Decir**:

> El problema que plantea la propuesta: los agentes de IA autónomos y multi turno pueden desviarse de las normas de la empresa, perder contexto o ejecutar acciones no deseadas. Por eso hace falta un **marco de trabajo controlado y predecible**: un arnés que encapsule la lógica del Claude Agent SDK. Voy a mostrar (1) la investigación que sustenta las decisiones, (2) el arnés funcionando por sus dos canales, la TUI y el chat conversacional, y (3) los casos de uso empresariales sobre ese arnés.

Ideas de fondo para conectar todo el recorrido:

- **Control**: cada turno deja rastro (hooks), las acciones de empleado se auditan, y lo que cada canal puede hacer lo decide qué herramientas tiene registradas ese turno, no el modelo.
- **Predecibilidad**: los comandos administrativos son código determinista; las operaciones de negocio pasan por confirmaciones explícitas y reglas de rol.
- **Memoria compartida**: una base SQLite común más las sesiones del SDK que se reanudan.

---

## 2. Bloque A — Investigación y base de conocimiento (objetivos 1 a 5)

Estructura de cada objetivo: primero el **documento**, después la **misma información consultada a través del arnés**, en la TUI y en el chat. Eso demuestra a la vez el objetivo de investigación y el objetivo 5 (conocimiento disponible para los modelos vía Graphify).

**Preguntas para el arnés** (usar la misma en ambos canales; el chat web requiere iniciar sesión, la TUI acepta texto libre):

| # | Objetivo | Pregunta | Fuente esperada en la cita |
|---|---|---|---|
| Q1 | 1 | ¿Qué arneses se compararon en el estudio y cuál obtuvo el mayor puntaje? | `vault-conocimiento/01-Estudio-Comparativo-Arneses/Matriz-Comparativa.md` (DeerFlow, 9,5/14) |
| Q2 | 2 | ¿Por qué se eligió TypeScript y se descartó Go para programar con el Claude Agent SDK? | `vault-conocimiento/02-Seleccion-Tecnologica/Node-vs-Go.md` |
| Q3 | 3 | ¿Por qué se eligió Ink como librería de TUI frente a blessed? | `vault-conocimiento/02-Seleccion-Tecnologica/Librerias-TUI.md` |
| Q4 | 4 | ¿Qué tipos de mensaje devuelve el Claude Agent SDK y cuáles procesa el arnés? | `vault-conocimiento/03-Arquitectura-Claude-Agent-SDK/Tipos-de-Mensaje-SDK.md` (también `Mensajes-y-Flujos.md`) |
| Q5 | 5 | ¿Qué contiene la base de conocimiento y cómo se conecta con Graphify? | `vault-conocimiento/00-Indice.md` |

**Esperado** para todas: la respuesta cita el archivo y la línea (`src` y `loc`), formato que impone la skill `citar-conocimiento`. Si el vault no tiene información, el arnés debe decirlo en vez de inventar.

**Si falla** (el modelo responde sin citar): pedir "citá la fuente". Plan B determinista, sin modelo: en una terminal ejecutar `graphify query "<la pregunta>"` y mostrar los nodos `NODE ... src=vault-conocimiento/...`. El grafo imprime una advertencia de esquema antiguo (`pre-#1504`); es inofensiva.

### A.1 Objetivo 1 ★ — Estudio comparativo de arneses

**Mostrar**: `docs/Investigacion Pre-proyecto/cuadro-comparativo-harness-empresarial.html`, abrirlo en el navegador.

- Los 14 criterios están en la sección `## 01` (línea 181), la tabla en `## 02` (líneas 202-357), las categorías en `## 03` (línea 360) y el veredicto en `## 04` (línea 396).
- Versión sintetizada en el vault: `Matriz-Comparativa.md` (tabla en la línea 35, veredicto en la línea 52).

**Datos citables** (verificados):

1. **6 harnesses** evaluados contra **14 criterios empresariales** (C1 a C14). memU y OpenHands Canvas quedan fuera del cuadro porque no son harnesses (8 documentos analizados en total).
2. Puntajes sobre 14: DeerFlow **9,5**, OpenCode **9,0**, Hive **9,0**, Pi **6,0**, Codex **5,5**, Claude Code **4,0**. Escala: cumple = 1, parcial = 0,5, ausente = 0.
3. Veredicto: **ningún harness cumple los 14**. La pregunta útil es "¿cuál deja menos por construir?". La recomendación es un harness envuelto (núcleo DeerFlow u OpenCode, memU para memoria, capa propia de auditoría y evaluación).

Documentos de detalle por arnés: `docs/Investigacion Pre-proyecto/` (`ANALISIS-ARQUITECTURA-ClaudeCode.md`, `ARCHITECTURE-opencode.md`, `ARQUITECTURA_HIVE.md`, `ARQUITECTURA_codex.md`, `ARQUITECTURA_deerflow.md`, `ARQUITECTURA-MEMU.md`, `DOCUMENTACION_PROYECTO_OpenHands.md`, `pi-analisis.md`).

**Hacer (TUI y chat)**: Q1.

**Limitación honesta**: Pi Agent Harness aparece en la matriz con su puntaje, pero **no tiene nota propia en el vault** (la nota de la matriz lo declara). Su análisis completo vive solo en `pi-analisis.md` y en el HTML.

### A.2 Objetivo 2 — Lenguajes para el Claude Agent SDK

**Mostrar**:

- `docs/Investigacion Pre-proyecto/Comparacion de lenguajes.pdf` (una página, una tabla).
- `vault-conocimiento/02-Seleccion-Tecnologica/Node-vs-Go.md` (justificación en prosa, sección "Conclusión real del PDF", línea 28).
- `docs/ARC42_Harness_Empresarial.md`, sección "Restricciones Técnicas" (línea 76): la decisión formal.

**Datos citables**:

1. Compara **3 lenguajes** (Python, TypeScript/Node.js, Go) en **16 criterios**: soporte del SDK, ecosistema TUI, concurrencia, curva de aprendizaje, despliegue, rendimiento, MCP, coherencia con el ecosistema Claude, riesgo, cadena de suministro, testing, telemetría, bases de datos, tipado, entre otros.
2. SDK de Claude: Python "nativo", TypeScript "excelente, con soporte oficial", Go "bueno pero requiere adaptadores no oficiales". Coherencia con el ecosistema Claude: alta, alta, baja.
3. Conclusión textual del PDF: "Posible candidato final: TypeScript (Node.js)".

**Hacer (TUI y chat)**: Q2.

**Limitaciones honestas**:

- El PDF es una tabla con una conclusión prudente ("posible candidato"), no un informe extenso. La justificación en prosa está en `Node-vs-Go.md` y en el ARC42. Presentarlo así.
- En el PDF, TypeScript obtiene su peor puntaje en **seguridad de la cadena de suministro** ("bajo"). Tener lista la respuesta si la tutora lo señala: es un riesgo conocido del ecosistema npm que se mitiga fijando versiones con `package-lock.json` y con la política de dependencias del proyecto.

### A.3 Objetivo 3 — Librerías TUI

**Mostrar**: `docs/Investigacion Pre-proyecto/Comparacion-Librerias-TUI.md`, con sus encabezados: candidatas (línea 7), criterios (17), matriz (28), conclusión (38), relevancia para el arnés (48).

**Datos citables**:

1. **5 candidatas** (Ink, blessed/neo-blessed, blessed-contrib, terminal-kit, Enquirer) evaluadas con **6 criterios**.
2. Se elige **Ink** por tres razones: reutiliza el modelo mental de React (ya es dependencia), permite TDD con `ink-testing-library` y no exige redibujado manual ante los eventos incrementales del SDK.
3. `blessed` se descarta por abandono de mantenimiento y por no tener testing de primera clase.

**Verificable en el repo** (mostrar `package.json`):

- `ink@^5.2.1` (línea 26), `react@^18.3.1` (línea 28), `ink-testing-library@^4.0.0` (línea 36); las versiones instaladas coinciden.
- `render` de `ink-testing-library` se usa en `src/adapters/tui/App.test.tsx` y `Banner.test.tsx`.

**Hacer (TUI y chat)**: Q3. La TUI que se está usando en ese momento **es** la prueba de la decisión: mencionarlo.

**Limitaciones honestas**:

- El renglón de "adopción real" de la matriz (npm CLI, Gatsby, Prisma, etc.) no tiene fuente dentro del repo; es conocimiento externo no verificado aquí.
- `start-tui.test.tsx` no usa `ink-testing-library` (usa un stdin simulado a propósito, por una razón documentada en `App.test.tsx`).

### A.4 Objetivo 4 — Funcionamiento del SDK, mensajes y flujos

**Documento principal del objetivo**: `docs/Investigacion Pre-proyecto/Referencia-Claude-Agent-SDK-Mensajes-y-Flujos.md`, elaborado contra los tipos del SDK instalado (0.3.248, `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts`). Contiene: diagrama de la arquitectura del SDK, firma y ciclo de vida de `query()`, el catálogo de **39 tipos de mensaje** (`SDKMessage`: 28 de `type: 'system'` por `subtype` y 11 con `type` propio; el mensaje `result` en su forma de éxito y sus 4 subtipos de error), las opciones relevantes, los 31 eventos de hook nativos, qué consume el arnés de verdad y cinco flujos con diagramas de secuencia. Cada afirmación cita archivo y línea. Síntesis en el vault: `Tipos-de-Mensaje-SDK.md`.

**Mostrar** (en este orden, de lo esquemático a lo concreto; el documento principal se abre primero):

1. `docs/ARC42_Harness_Empresarial.md`:
   - Interfaz I5, "llamadas del Claude Agent SDK hacia la Anthropic Messages API" (líneas 234-241).
   - Bloque 1.3, "Invocador del Modelo" (línea 328).
   - Escenario de ejecución 1 (líneas 401-424): el flujo de un turno.
2. `vault-conocimiento/03-Arquitectura-Claude-Agent-SDK/Mensajes-y-Flujos.md` y `Componentes-e-Interfaces.md`: síntesis de lo anterior.
3. **El código que maneja los mensajes reales del SDK**: `src/core/turn-selector/invoke-model.ts`.
   - Bucle `for await (const message of queryFn(...))` (alrededor de la línea 479), con tres ramas:
     - `system` con `subtype === "init"`: guarda el `session_id`.
     - `result` con `subtype === "success"` y `is_error` falso: guarda el texto de la respuesta.
     - `assistant` con `parent_tool_use_id` no nulo: registra la actividad de un sub-agente.
   - Si falta el `session_id` o el texto, se lanza `ModelResponseIncompleteError`.
   - Las opciones que el arnés entrega al SDK: `agent`, `agents`, `resume`, `allowedTools`, `mcpServers`, `skills`, `cwd`.
   - Comentarios explicativos de los tipos: líneas 59-79 y 156-170.
4. `docs/Plan_Implementacion_Harness_Empresarial.md` (línea 133 en adelante): menciones de `query()` como generador asíncrono de mensajes tipados, `options.resume` con el id de sesión y `mcpServers`.

**Datos citables**:

- Un turno es una iteración sobre el generador que devuelve `query()`. El arnés reconstruye la sesión con `resume` a partir del `sdkSessionId` guardado.
- El arnés **no usa los hooks nativos del SDK** (`options.hooks`): se descartó a propósito y se implementó un motor de hooks propio, en proceso (decisión documentada en el comentario de `invoke-model.ts`, líneas 81-89).

**Hacer (TUI y chat)**: Q4.

**Limitaciones honestas** (el documento las detalla en sus secciones 8, 9.2 y 9.3):

- El catálogo sale de los **tipos instalados**, no de ejecutar `query()` y observar cada mensaje; qué se emite en la práctica se comprueba con los eventos del log.
- El arnés consume solo tres tipos de mensaje y **descarta** `usage`, `total_cost_usd` y `permission_denials`: hoy no se mide el costo por turno.
- Los sub-agentes del arnés corren como turnos del hilo principal orquestados por el propio arnés, por lo que `parent_tool_use_id` casi nunca se puebla.
- Algunos comentarios del código quedaron desactualizados (por ejemplo, sobre las herramientas del agente conversacional); el documento lista las discrepancias.

### A.5 Objetivo 5 ★ — Base de conocimiento en Obsidian, disponible vía Graphify

**Mostrar**:

1. **Obsidian** (si está instalado): abrir la carpeta `vault-conocimiento` como bóveda y mostrar la vista de grafo. Se pueden ver los enlaces entre las notas.
2. Estructura: `00-Indice.md` (punto de entrada), `01-Estudio-Comparativo-Arneses/` (9 notas), `02-Seleccion-Tecnologica/` (2), `03-Arquitectura-Claude-Agent-SDK/` (3), `04-Arnes-Empresarial-Propio/` (1). Son **16 notas**, **15 wikilinks únicos**, **ninguno roto**.
3. `graphify-out/graph.json`: **11.559 nodos**, de los cuales **72** provienen de `vault-conocimiento/` (16 archivos).

**Flujo en tiempo de ejecución: cómo un modelo llega a una nota del vault** (decirlo con estos cinco pasos):

1. `src/main.ts` crea un adaptador de conocimiento por cada caso (`createKnowledgeAdapter`).
2. `src/adapters/knowledge/index.ts` registra un servidor MCP en proceso (`createSdkMcpServer`) con la herramienta `query_knowledge_base`.
3. `invoke-model.ts` entrega ese servidor al SDK dentro de `options.mcpServers`. El modelo ve la herramienta como `mcp__knowledge__query_knowledge_base`.
4. Cuando el modelo la invoca, `knowledge-tool.ts` ejecuta `runGraphifyQuery`.
5. `graphify-cli.ts` lanza `graphify query "<pregunta>" --graph graphify-out/graph.json --budget <n>`; las líneas `NODE ... src=... loc=...` vuelven al modelo, que las cita.

**Hacer (TUI y chat)**: Q5, y además una pregunta abierta en el chat, por ejemplo: "¿Qué dice la base de conocimiento sobre los hooks?" (mostrar que responde con cita o admite que no tiene información).

**Limitaciones honestas**:

- Graphify **no es un plugin instalado dentro de Obsidian**: indexa el repositorio completo desde afuera, y el arnés lo consulta por línea de comandos. Es la forma en que "queda disponible para los modelos".
- `.obsidian/` contiene solo `app.json` con `{}`: bóveda mínima, sin plugins ni configuración de grafo.
- Se verificó la conexión modelo → Graphify por lectura de código y por una consulta manual; la respuesta del modelo en vivo se confirma en el ensayo.

---

## 3. Bloque B ★ — Objetivo general: memoria compartida

**Decir** (con precisión, sin exagerar):

> "Memoria compartida" tiene dos partes. Primero, una **base SQLite única** (`data/harness.db`) que comparten todos los canales y procesos: casos, sesiones de agente, empleados, ventas, solicitudes, comisiones. Segundo, el **contexto multi turno de cada conversación**, que no se reconstruye desde la base sino que se delega al SDK con `resume`; el arnés guarda solo el puntero `(caso, agente) → sdkSessionId` en la tabla `sesiones_agente`.

**Lo que se comparte y lo que no** (tener claro por si la tutora pregunta):

| Elemento | ¿Compartido? |
|---|---|
| Datos de negocio (empleados, ventas, solicitudes, comisiones) entre TUI y chat | **Sí**, base SQLite común |
| Contexto multi turno entre mensajes **del mismo canal** | **Sí** (TUI: un caso fijo por corrida; web: puntero de conversación) |
| Contexto conversacional **entre la TUI y el chat** | **No**: cada canal tiene sus sesiones de SDK |
| Contexto entre agentes distintos | **No**: la clave de la sesión incluye el `agentId` |

### B.1 Memoria multi turno en la TUI

**Hacer** (TUI, sin reiniciar el proceso entre los dos mensajes):

1. `Mi nombre es Laura y trabajo en el área de ventas.`
2. `¿Cómo me llamo y en qué área trabajo?`

**Esperado**: la segunda respuesta usa el dato del primer mensaje. **Prueba en el log** (Terminal 2): dos líneas `turno-completado` con el **mismo `casoId` y el mismo `sdkSessionId`**.

**Decir**: si se reinicia la TUI se crea un caso nuevo y la conversación empieza de cero; el comando `/soporte` abre un caso nuevo por consulta y no recuerda las anteriores.

### B.2 Memoria multi turno en el chat web

**Hacer**: iniciar sesión como `admin` en `http://localhost:8080/chat` y enviar dos mensajes seguidos, por ejemplo `Mi nombre es Laura.` y luego `¿Cómo me llamo?`.

**Esperado**: la segunda respuesta usa el dato. **Prueba en el log**: `turno-completado` con el mismo `sdkSessionId` en ambos mensajes y `operaciones-conversacion` con el mismo `conversacionId`.

**Decir** (detalle de diseño): en el chat cada mensaje recibe un `casoId` nuevo —es un invariante de seguridad del ARC42— y lo que se conserva es un **puntero de conversación** al mensaje anterior. La conversación vence a los 30 minutos de inactividad, a los 40 turnos, al cerrar sesión o al recargar la pestaña.

**Limitación honesta**: el log prueba que se reanudó la sesión (`resume`); que el modelo use bien ese historial depende del modelo.

### B.3 Estado compartido entre TUI y chat ★

Es la demostración más clara de memoria compartida. Recorrido:

1. **TUI**, como `admin`: `/login admin <clave>` y luego `/crear-empleado vendedor <clave-vendedor>`.
2. **Chat web**: cerrar sesión si hace falta e iniciar sesión como `vendedor`. **Esperado**: el ingreso funciona. El empleado creado en la TUI existe para el chat porque ambos usan la misma base.
3. **Chat web**, como `vendedor`: `Quiero registrar una venta de $1500 al cliente Gómez (gomez@ejemplo.com), plan Básico, a mi nombre.` Anotar el **token de confirmación** que devuelve.
4. **Chat web**: `El cliente Gómez confirmó la compra por teléfono, el token es <token>.`
5. **TUI**, como `admin`: `/reporte-comisiones`. **Esperado**: aparece la comisión de esa venta. Con el porcentaje por defecto (`COMISION_PORCENTAJE=0,1`), **150** sobre 1500.

**Importante**: `/reporte-comisiones` cuenta **solo ventas confirmadas**. Una venta recién registrada queda en estado "pendiente de confirmación" y no aparece; sin el paso 4 la demostración parecería rota.

**Decir**: una acción hecha por un canal (chat web) es visible por el otro (TUI) porque ambos leen y escriben la misma base.

---

## 4. Bloque C ★ — Objetivo 6: agentes, sub-agentes, comandos, hooks (y skills)

### C.1 Definición de agentes

**Mostrar**: `src/core/agents/definitions.ts`.

- Estructura `AgentDefinition`: `id`, `description`, `systemPrompt`, `allowedTools`, `model`.
- Agente registrado: `agente-conversacional` (línea 121), con `allowedTools` = herramienta de conocimiento, `Skill` y `consultas`.
- `construirAgenteEmpleadoOperaciones()` (línea 255): el mismo agente **más** la herramienta `operaciones`; se arma solo para el chat web y **no está en el registro**.

**Decir**: la frontera de autorización de cada canal es qué **servidores MCP** se registran en ese turno, no la lista `allowedTools`. La TUI en texto libre solo tiene el servidor de conocimiento; el chat web tiene conocimiento y `operaciones`.

**Demostración opcional de contención** (resultado variable): en la **TUI**, texto libre, escribir `Quiero registrar una venta de $1500 al cliente Gómez, plan Básico.` **Esperado**: no se registra ninguna venta, porque la herramienta `operaciones` no existe en ese canal; el modelo suele explicarlo. Hacer luego lo mismo en el **chat web**, donde sí se registra. Es la ilustración concreta del "entorno de contención" de la propuesta.

### C.2 Definición de sub-agentes

**Mostrar**: `src/core/agents/subagents.ts` y la parte de sub-agentes de `definitions.ts`. Registro separado con cuatro sub-agentes:

| Sub-agente | Función | Línea |
|---|---|---|
| `planner` | Analiza el cambio de un PR y produce el plan de revisión | 277 |
| `developer` | Ejecuta el plan sobre el código y produce hallazgos | 291 |
| `reviewer` | Emite el veredicto final en una línea | 306 |
| `validador-solicitudes` | Evalúa si una solicitud interna está completa y emite un dictamen (no aprueba ni rechaza) | 332 |

Ningún sub-agente tiene la herramienta `Agent` ni `Task`: **la delegación es de un solo nivel**, por diseño.

**Demostración en vivo ★ (chat web)**: el sub-agente que se puede ver desde una conversación es `validador-solicitudes`, que se invoca **de forma determinista** al crear una solicitud interna.

1. **Chat web**, como `vendedor`: `Quiero pedir vacaciones del 1 al 10 de octubre.`
2. **Esperado en el log**, en este orden: `solicitud-creada` → `delegacion-iniciada` → `turno-iniciado` → `post-turn-hook-ejecutado` → `delegacion-completada` (con `agentId: validador-solicitudes`) → `solicitud-validada`. La respuesta del chat incluye el dictamen del validador («Solicitud X creada … Dictamen: …»). Desde la v3.22 (ADR 303) su prompt dice que decide una persona autorizada distinta del solicitante y le prohíbe indicar comandos o pasos; una guarda de test (`textos-modelo-sin-comandos.test.ts`) impide que un prompt de agente vuelva a nombrar un comando retirado. El texto del dictamen lo escribe el modelo y varía entre corridas.
3. **Decir**: aquí conviven tres mecanismos del arnés en una sola acción: la operación de negocio, el sub-agente y el hook.

**Cadena Planner → Developer → Reviewer (limitación real, decirla)**: esta cadena **no se dispara desde la TUI ni desde el chat**. Solo corre cuando llega un evento de webhook de GitHub (revisión de PRs). Cómo mostrarla:

- Código: `src/build-on-activity.ts` (interruptor `HARNESS_DELEGACION_ROLES`, activo por defecto) y `cadena-revision.ts`.
- **Evidencia histórica de ejecuciones reales**: el `data/harness.log` conserva líneas de esas corridas. En PowerShell:

```powershell
Select-String -Path "data\harness.log" -Pattern '"agentId":"planner"' | Select-Object -First 3
```

- En la TUI, `/estado-bot-prs` (comando de administrador) muestra el estado del bot de PRs: si el receptor de webhooks escucha y si `GITHUB_TOKEN` está presente, sin revelar valores.

### C.3 Definición de comandos

**Mostrar**: `src/core/commands/comando-empleado.ts`, arreglo de descriptores `DESCRIPTORES` (líneas 202-349). Registrar un comando nuevo significa agregar un descriptor (nombre, uso, ayuda, si es privilegiado, si exige administrador, forma de argumentos, tipo).

**Los 13 comandos reales**:

| Comando | Uso | Requiere sesión | Requiere administrador |
|---|---|---|---|
| `/login` | `/login <empleadoId> <password>` | no | no |
| `/logout` | `/logout` | no | no |
| `/soporte` | `/soporte <consulta>` | no | no |
| `/ver-propuesta` | `/ver-propuesta [propuestaId]` | sí | no |
| `/aplicar-propuesta` | `/aplicar-propuesta <propuestaId>` | sí | no |
| `/descartar-propuesta` | `/descartar-propuesta <propuestaId> [motivo]` | sí | no |
| `/consultar-kpi` | `/consultar-kpi <consulta>` | sí | no |
| `/reporte-comisiones` | `/reporte-comisiones [periodo]` | sí | no |
| `/ver-solicitudes-a2a` | `/ver-solicitudes-a2a [a2aTaskId]` | sí | no |
| `/estado-bot-prs` | `/estado-bot-prs` | sí | no |
| `/asignar-rol` | `/asignar-rol <empleadoId> <rol>` | sí | **sí** |
| `/crear-empleado` | `/crear-empleado <empleadoId> <password>` | sí | **sí** |
| `/ayuda` | `/ayuda` | no | no |

**Hacer en la TUI**:

1. `/ayuda`: lista los comandos.
2. `/login admin <clave>` y luego `/reporte-comisiones`.
3. **Puerta de rol**: `/logout`, `/login vendedor <clave-vendedor>` y `/asignar-rol vendedor administrador`. **Esperado**: rechazado por falta de rol de administrador (el texto exacto puede variar). Evento en el log: `comando-administrativo-no-autorizado`.
4. **Sin sesión**: `/logout` y luego `/reporte-comisiones`. **Esperado**: pide iniciar sesión (evento `comando-privilegiado-sin-sesion`).
5. **Protección contra auto-degradación** (opcional): como `admin` (único administrador), `/asignar-rol admin empleado`. **Esperado**: bloqueado.

**Decir**: los comandos con `/` se interpretan con **código determinista**, sin que el modelo decida qué acción ejecutar. Dos precisiones: `/soporte` sí lanza un turno de modelo, y `/consultar-kpi` termina en una llamada A2A a un tercero. Cada acción de empleado deja un evento `accion-empleado-registrada` (auditoría).

**Nota**: `/solicitar`, `/aprobar-*` y otros comandos de versiones anteriores fueron retirados y reemplazados por operaciones conversacionales del chat (bloque D). No usarlos en la demo.

### C.4 Definición de hooks ★

**Decir**:

> Un hook es un punto de anclaje en el ciclo de vida de un turno donde se engancha código propio sin tocar la lógica del agente. Es el mecanismo técnico que permite observar y controlar sin mezclar esa lógica adentro del agente.

**Mostrar**, en este orden:

1. `src/core/hooks/hook-engine.ts`: dos puntos, `PRE_TURN` y `POST_TURN`; funciones `registerHook` y `triggerHook`. Los handlers de un punto se ejecutan en orden de registro.
2. `src/core/hooks/log-pre-turn-handler.ts` y `log-post-turn-handler.ts`: los dos handlers reales.
3. `src/core/startup/bootstrap.ts` (líneas 98-99): registro de ambos en el motor compartido, al arrancar.
4. `src/core/turn-selector/invoke-model.ts`: `PRE_TURN` se dispara **antes** de llamar al SDK (línea 473) y `POST_TURN` **después** de recibir la respuesta (línea 507).

**Demostración en vivo ★** (Terminal 2 visible): hacer cualquier turno **en la TUI** y otro **en el chat web**. **Esperado** en el log, por cada turno:

- `turno-iniciado` con `agentId` (hook `PRE_TURN`).
- `post-turn-hook-ejecutado` con `agentId`, `sdkSessionId` y `longitudRespuesta` (hook `POST_TURN`).
- `turno-completado` con `agentId` y `sdkSessionId`.

**Puntos a explicar**:

- **Los dos canales usan el mismo motor de hooks**: el objeto que devuelve `bootstrapHarness()` en `main.ts` se pasa tanto a la TUI como al chat web y a las delegaciones. Por eso el mismo hook dispara en ambos.
- **Por qué `PRE_TURN` importa**: `POST_TURN` solo se dispara si el turno termina bien. `PRE_TURN` deja constancia de los turnos que empezaron, incluso si el turno falla después. Comparar en el log la cantidad de líneas `turno-iniciado` contra `post-turn-hook-ejecutado` permite detectar turnos que no terminaron (ver Anexo A).
- **Privacidad**: el hook nunca escribe el texto de la respuesta, solo su longitud.
- **No se duplica la auditoría de negocio**: las acciones de empleado se registran por su propio mecanismo (`accion-empleado-registrada`); los hooks agregan observabilidad técnica de los turnos.

**Limitación honesta**: hoy los hooks registrados hacen **observabilidad** (dejan rastro). El motor admite cualquier handler nuevo (por ejemplo, validaciones o notificaciones), pero no se implementaron más. Si se pregunta: "el mecanismo está completo y probado; los handlers de negocio adicionales son el paso siguiente".

**Prueba complementaria** (no sustituye la demostración en vivo): `npx vitest run src/core/hooks src/core/startup` ejecuta los tests de los hooks y del registro al arranque.

### C.5 Skills

**Mostrar**: la carpeta `.claude/skills/` con **14 skills** y, en el log, el evento de arranque `skills-registro-cargado` con `cantidad: 14` y los nombres.

| Área | Skills |
|---|---|
| Ventas y comisiones | `registrar-venta-conversacional`, `venta-decision`, `consultar-venta`, `reporte-comisiones-conversacional`, `devolucion-conversacional`, `solicitar-devolucion` |
| Solicitudes internas | `solicitud-interna`, `consultar-solicitud`, `cancelar-solicitud`, `resolver-solicitud` |
| Reembolsos | `resolver-reembolso` |
| Conocimiento | `citar-conocimiento` |
| A2A | `consultar-kpi`, `ver-solicitudes-a2a` |

**Decir**: una skill es una instrucción empaquetada que el modelo invoca cuando la petición del empleado coincide con su descripción. Las 13 operaciones de negocio se ejecutan mediante la herramienta `operaciones` (solo en el chat web); si una skill del sistema está mal formada, el arranque falla en lugar de degradarse en silencio.

---

## 5. Bloque D ★ — Casos de uso empresariales

Se ejecutan en el **chat web** (donde viven las operaciones de negocio conversacionales) con dos usuarios: `vendedor` (empleado) y `admin` (administrador). Las reglas de rol obligan a usar dos personas: un administrador nunca puede aprobar lo suyo.

**Recomendación**: mantener dos pestañas del navegador, una con cada sesión, o cerrar e iniciar sesión con el botón de la página cuando el paso lo indique.

**Decir al principio**: hay 13 operaciones de negocio: `registrar_venta`, `resolver_decision_venta`, `consultar_venta`, `consultar_reporte_comisiones`, `procesar_devolucion`, `solicitar_devolucion`, `resolver_reembolso`, `crear_solicitud_interna`, `consultar_solicitud`, `cancelar_solicitud_interna`, `resolver_solicitud`, `consultar_kpi`, `ver_solicitudes_a2a`. Este bloque ejecuta todas ellas (las dos últimas en el bloque E).

### D.1 Ventas y comisiones

Como `vendedor` (si ya se hizo B.3, reutilizar esa venta):

1. **Registrar venta** (`registrar-venta-conversacional`): `Quiero registrar una venta de $1500 al cliente Gómez (gomez@ejemplo.com), plan Básico, a mi nombre.` **Esperado**: confirmación con un **token**; evento `venta-creada`.
2. **Decisión del cliente** (`venta-decision`): `El cliente Gómez confirmó la compra por teléfono, el token es <token>.` **Esperado**: venta confirmada; eventos `venta-confirmada` y `comision-calculada`.
3. **Consultar venta** (`consultar-venta`): `¿Cómo quedó mi venta más reciente?`
4. **Reporte de comisiones** (`reporte-comisiones-conversacional`): `Dame el reporte de comisiones de este mes.` Es el reporte de toda la empresa. **Mostrar el mismo dato en la TUI** con `/reporte-comisiones` (dos canales, mismo resultado).
5. **Venta grande** (opcional, ver bloque E.3): registrar una venta de 5000 o más.

### D.2 Solicitudes internas

Como `vendedor`:

1. `Quiero pedir vacaciones del 1 al 10 de octubre.` (`solicitud-interna`). Esta acción invoca al sub-agente `validador-solicitudes` (ver C.2).
2. `Quiero pedir el reembolso de un gasto: taxi de $25 del martes para visitar al cliente Gómez.` (tipo `gasto`). **No usar "reclamo de comisión"**: la skill lo ofrece, pero el núcleo solo acepta `vacaciones` y `gasto` (`SOLICITUD_TIPOS`, `solicitudes-contract.ts:30`) y lo rechaza con `tipo_desconocido`.
3. `¿Qué solicitudes tengo pendientes?` (`consultar-solicitud`).
4. **Cancelar** la primera (`cancelar-solicitud`): `Quiero cancelar mi pedido de vacaciones.` La skill lista las solicitudes y pide confirmación; responder en un mensaje aparte: `Sí, esa.`
5. Cerrar sesión e iniciar como `admin`: **resolver** la segunda (`resolver-solicitud`): `Aprobame la solicitud de gasto de vendedor.` La skill muestra el detalle y pide confirmación; responder en otro mensaje: `Sí, confirmo.`
6. **Reglas de control** (mostrar una): como `vendedor`, intentar resolver una solicitud ajena es rechazado (solo el administrador puede); y un administrador tampoco puede resolver **su propia** solicitud (`autoaprobacion_prohibida` en la auditoría).

### D.3 Reembolsos

Requiere una venta **confirmada** del `vendedor` (la de D.1).

1. Como `vendedor` (`solicitar-devolucion`): `Quiero iniciar una devolución de mi venta a Gómez, motivo: el cliente se arrepintió.` Confirmar en un mensaje aparte con `Sí, confirmo.` **Esperado**: la devolución **se escala** y queda pendiente de un administrador. Sin token **siempre** escala, sea cual sea el monto: `solicitar-devolucion.ts` no usa el umbral de `REEMBOLSO_UMBRAL` (ADR 223 pto 3). El umbral de 500 solo decide en el camino **con** token (paso 3). Si pedís la devolución sin ser el vendedor, el rechazo (`no_autorizada`) llega en el primer mensaje, antes de pedir confirmación.
2. Como `admin` (`resolver-reembolso`): `Aprobame el reembolso de la devolución que escaló vendedor.` Confirmar con `Sí, confirmo.` Reglas: exige rol de administrador y prohíbe la autoaprobación (se compara con el vendedor de la venta).
3. **Camino alternativo con token** (`devolucion-conversacional`), sobre **otra** venta confirmada **de menos de $500** (registrala y confirmala antes, por ejemplo `Quiero registrar una venta de $300 al cliente Pérez (perez@ejemplo.com), plan Básico, a mi nombre.`): `Quiero procesar la devolución de la venta con token <token>, motivo: cambio de plan.` Se reembolsa en un solo paso, sin aprobación del administrador. Con token, el monto decide: por debajo de `REEMBOLSO_UMBRAL` (500) se reembolsa al instante; desde 500 se escala igual que el paso 1. Por eso no sirve la venta de $1500. No usarlo sobre la misma venta del paso 1 (ya quedó escalada).

### D.4 Conocimiento con citas

Repetir una de las preguntas Q1 a Q5 en el chat y en la TUI (bloque A). Mostrar que la respuesta cita su fuente (`citar-conocimiento`) o admite que no hay información.

### D.5 Auditoría

Mostrar en el log los eventos que dejó todo el recorrido: `accion-empleado-registrada` (comandos), `venta-creada`, `venta-confirmada`, `comision-calculada`, `solicitud-creada`, `solicitud-validada`. Ver la tabla del Anexo B.

---

## 6. Bloque E ★ — Comunicación A2A (agente a agente)

Antes: el mock del sistema externo levantado (sección 0.2) y las variables de A2A en `.env`.

### E.1 A2A saliente por la TUI

1. `/login admin <clave>`
2. `/consultar-kpi ¿cuáles son los KPIs de este mes?`

**Esperado**: tras unos segundos (el mock simula latencia) vuelve una respuesta con datos. **Log**: `delegacion-a2a-iniciada` y `delegacion-a2a-completada`. Las cuatro consultas posibles son KPIs del mes, incidentes abiertos, incidentes críticos y estado general (no hay consulta libre). **Si falla** (mock apagado): mensaje controlado indicando que no se pudo completar la consulta; el arnés no se rompe (evento `delegacion-a2a-fallida`).

### E.2 A2A saliente por el chat

Como `admin` en el chat web: `Preguntale al agente externo cuáles son los KPIs de este mes.` Misma consulta, otro camino: el modelo invoca la herramienta `operaciones` con la operación `consultar_kpi`. **Diferencia real entre canales**: en la TUI cualquier empleado con sesión puede usar `/consultar-kpi`; en el chat la operación exige rol de administrador.

### E.3 A2A saliente automático: venta grande → "riesgo-credito"

Con `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO` apuntando al segundo mock, registrar en el chat una venta de **5000 o más** (`VENTA_GRANDE_UMBRAL`). El arnés dispara por su cuenta una consulta A2A **sin bloquear** la venta. **Log**: `a2a-riesgo-credito-disparada` (o `a2a-riesgo-credito-fallida`, que no revierte la venta). El mock devuelve texto de KPIs, no un veredicto de crédito real: prueba el mecanismo, no el contenido.

### E.4 A2A entrante

`/ver-solicitudes-a2a` en la TUI, o en el chat: `¿Qué nos preguntaron por A2A últimamente?`. **Limitación honesta**: generar una consulta entrante requiere que un agente externo llame por HTTP al servidor A2A del arnés (activo si `HARNESS_A2A_ENTRANTE_TOKEN` está definido); dentro del repo no hay una forma de generarla desde la TUI o el chat. Si nadie consultó, la lista sale vacía, lo que igualmente demuestra que el mecanismo responde. Los tests de integración `a2a-server.integration.test.ts` y `a2a-client.integration.test.ts` cubren el circuito completo.

---

## 7. Cierre: resumen de cumplimiento

| Objetivo | Estado | Comentario |
|---|---|---|
| General: memoria compartida | Cumplido | SQLite común + sesiones reanudables (bloque B) |
| 1. Estudio comparativo | Cumplido | Pi sin nota propia en el vault |
| 2. Lenguajes | Cumplido | El PDF es una tabla; la justificación en prosa está en `Node-vs-Go.md` y el ARC42 |
| 3. Librerías TUI | Cumplido | Informe dedicado con matriz y conclusión |
| 4. SDK, mensajes y flujos | Cumplido | Referencia dedicada con catálogo de 39 tipos de mensaje, opciones, hooks nativos y flujos; limitaciones en la sección 8 |
| 5. Obsidian + Graphify | Cumplido | Graphify indexa desde afuera, no es plugin de Obsidian |
| 6. Agentes, sub-agentes, comandos, hooks | Cumplido | Hooks: observabilidad; cadena Planner/Developer/Reviewer solo por webhook |
| Skills y A2A (cronograma) | Cumplido | A2A entrante sin generador propio dentro del repo |
| Casos de uso empresariales | Cumplido | 14 skills, 13 operaciones |

Cerrar con: el arnés cumple el planteamiento de la propuesta (control y predecibilidad) porque cada canal tiene un alcance explícito, cada turno deja rastro y las acciones de empleado se auditan.

---

## 8. Brechas conocidas y cómo responderlas

| Brecha | Cómo presentarla |
|---|---|
| Objetivo 4: el catálogo sale de los tipos instalados, no de ejecutar `query()`; el arnés descarta `usage` y costo | "El catálogo está verificado contra el `sdk.d.ts` de la versión instalada; lo que se emite en la práctica se observa en el log; el costo por turno todavía no se mide" |
| Pi Agent Harness sin nota en el vault | "Está en la matriz con su puntaje; su análisis completo está en `pi-analisis.md`" |
| Comparación de lenguajes en formato de tabla | "La tabla es la evidencia; la justificación en prosa está en `Node-vs-Go.md` y en el ARC42" |
| Cadena Planner/Developer/Reviewer no se ve desde TUI/chat | "Corre con eventos de webhook de GitHub; se evidencia con el log histórico y el código. El sub-agente visible desde el chat es `validador-solicitudes`" |
| Hooks solo hacen observabilidad | "El mecanismo de hooks está completo; el handler de negocio adicional es una extensión" |
| A2A entrante sin generador propio | "Se prueba con tests de integración; en vivo requiere un agente externo" |
| `.obsidian/` mínimo y Graphify externo a Obsidian | "Graphify indexa el repositorio; el arnés lo consulta por línea de comandos" |
| `graph.json` no se versiona | "Se regenera con `graphify update .`" |
| Adopción real de Ink sin fuente en el repo | "Dato de contexto externo; la decisión se sostiene en los criterios técnicos verificados" |

---

## 9. Preguntas probables de la tutora

- **¿Qué es exactamente la "memoria compartida"?** La base SQLite común (datos de negocio y punteros de sesión) más la reanudación de sesiones del SDK con `resume`. El historial de conversación lo conserva el SDK, no se reconstruye desde la base. Ver bloque B.
- **¿Por qué dos canales?** Separación deliberada: la TUI es administración determinista y utilidades; el chat es el canal de operaciones de negocio conversacionales. Lo que cada canal puede hacer lo determina qué herramientas se registran en ese turno.
- **¿Qué evita que el agente haga algo indebido?** Las herramientas disponibles por turno, los roles y las confirmaciones explícitas, la prohibición de autoaprobación y el registro de cada acción y cada turno.
- **¿Qué pasa si el modelo falla?** El turno falla de forma controlada (`turno-fallido`); en el chat no avanza la conversación y no se pierde el estado de negocio. `PRE_TURN` deja constancia del intento.
- **¿Se puede agregar un comando, un hook o una skill nuevos?** Comando: un descriptor nuevo en `comando-empleado.ts`. Hook: `registerHook` con un handler. Skill: una carpeta con su `SKILL.md`; el arranque valida el formato.
- **¿Cómo se sabe que funciona y no solo que los tests pasan?** Esta guía: demostración en vivo con el log en tiempo real. Además, la suite automatizada (más de 3.200 tests) y las guías de verificación manual de `docs/progreso/`.
- **¿Por qué el hook no guarda el texto de la respuesta?** Privacidad: el log no tiene control de acceso; solo se registra la longitud y los identificadores.

---

## Anexo A — Comandos útiles de PowerShell (desde la raíz del proyecto)

Seguir el log completo en vivo:

```powershell
Get-Content -Path "data\harness.log" -Wait -Tail 0
```

Seguir solo los eventos de turno y de hooks:

```powershell
Get-Content -Path "data\harness.log" -Wait -Tail 0 | Select-String 'turno-iniciado|post-turn-hook-ejecutado|turno-completado|turno-fallido'
```

Contar turnos iniciados contra turnos terminados (si difieren, hubo turnos que no terminaron):

```powershell
(Select-String -Path "data\harness.log" -Pattern '"event":"turno-iniciado"' -SimpleMatch).Count
(Select-String -Path "data\harness.log" -Pattern '"event":"post-turn-hook-ejecutado"' -SimpleMatch).Count
```

Ver el registro de skills cargadas al arrancar:

```powershell
Select-String -Path "data\harness.log" -Pattern 'skills-registro-cargado' | Select-Object -Last 1
```

Consultar a Graphify sin pasar por el modelo:

```bash
graphify query "matriz comparativa de arneses"
```

## Anexo B — Eventos del log que se pueden señalar

| Evento | Cuándo aparece | Campos clave |
|---|---|---|
| `skills-registro-cargado` | Al arrancar | `cantidad`, `nombres` |
| `turno-iniciado` | Antes de cada llamada al SDK (hook `PRE_TURN`) | `agentId` |
| `post-turn-hook-ejecutado` | Tras una respuesta exitosa (hook `POST_TURN`) | `agentId`, `sdkSessionId`, `longitudRespuesta` |
| `turno-completado` | Al cerrar un turno | `agentId`, `sdkSessionId` |
| `turno-fallido` | Si el turno falla | `agentId`, `stage`, `message` |
| `comando-empleado-recibido` | Cada comando `/` | `tipo` |
| `accion-empleado-registrada` | Acción de empleado auditada | — |
| `login-exitoso` / `login-fallido` / `logout` | Sesión | `empleadoId` |
| `comando-privilegiado-sin-sesion` | Comando que exige sesión, sin sesión | — |
| `comando-administrativo-no-autorizado` | Comando de administrador, sin ese rol | — |
| `operaciones-caso-creado` | Mensaje de chat web | — |
| `operaciones-conversacion` | Mensaje de chat web | `conversacionId` |
| `operaciones-turno-fallido` / `operaciones-timeout` | Falla en el chat | — |
| `venta-creada` / `venta-confirmada` / `comision-calculada` | Ciclo de una venta | — |
| `solicitud-creada` / `solicitud-validada` / `solicitud-validacion-fallida` | Solicitudes internas | — |
| `delegacion-iniciada` / `delegacion-completada` | Delegación a un sub-agente | `agentId` |
| `delegacion-a2a-iniciada` / `-completada` / `-fallida` | A2A saliente | — |
| `a2a-destino-no-configurado` | Destino A2A sin endpoint | — |
| `a2a-riesgo-credito-disparada` / `-fallida` | Venta grande | — |

## Anexo C — Plan B ante problemas

| Problema | Solución |
|---|---|
| El arnés no arranca por la API key | Revisar `ANTHROPIC_API_KEY` en `.env` y reiniciar |
| El chat no abre en `/chat` | Confirmar `WEB_PORT` mayor que 0 y reiniciar; las variables solo se leen al arrancar |
| No aparecen `turno-iniciado` / `post-turn-hook-ejecutado` | Verificar que se mira `data\harness.log` desde la raíz del proyecto y que se ejecuta el código actual (`git log` debe incluir el commit de los hooks) |
| El modelo no cita la fuente | Pedir "citá la fuente" o usar `graphify query` directo |
| `/reporte-comisiones` sale vacío | La venta no está confirmada; hacer el paso de decisión del cliente (D.1, paso 2) |
| `/crear-empleado` dice que ya existe | Se ensayó con ese nombre; usar otro o restaurar el estado limpio (0.2) |
| El mock A2A no responde | Verificar que el proceso está levantado en el puerto configurado; el arnés igual responde con un mensaje controlado |
| El grafo no devuelve notas del vault | Ejecutar `graphify update .` y repetir la consulta |
| La sesión del chat venció | Iniciar sesión de nuevo; vence a los 30 minutos de inactividad |

## Anexo D — Mapa de archivos para abrir durante la demostración

| Tema | Archivo |
|---|---|
| Propuesta | `Pasantia/propuesta_de_pasantia.pdf` |
| Matriz comparativa | `docs/Investigacion Pre-proyecto/cuadro-comparativo-harness-empresarial.html` |
| Lenguajes | `docs/Investigacion Pre-proyecto/Comparacion de lenguajes.pdf` |
| Librerías TUI | `docs/Investigacion Pre-proyecto/Comparacion-Librerias-TUI.md` |
| Arquitectura | `docs/ARC42_Harness_Empresarial.md` |
| Referencia de tipos de mensaje del SDK | `docs/Investigacion Pre-proyecto/Referencia-Claude-Agent-SDK-Mensajes-y-Flujos.md` |
| Manejo de mensajes del SDK | `src/core/turn-selector/invoke-model.ts` |
| Vault | `vault-conocimiento/00-Indice.md` |
| Agentes y sub-agentes | `src/core/agents/definitions.ts`, `subagents.ts` |
| Comandos | `src/core/commands/comando-empleado.ts` |
| Hooks | `src/core/hooks/hook-engine.ts`, `log-pre-turn-handler.ts`, `log-post-turn-handler.ts` |
| Registro de hooks al arrancar | `src/core/startup/bootstrap.ts` |
| Memoria | `src/adapters/memory/` y `src/core/turn-selector/assemble-context.ts` |
| Skills | `.claude/skills/` |
| A2A | `src/adapters/a2a/`, `src/core/turn-selector/dispatch-delegation-a2a.ts` |
| Guía de instalación para el tutor empresarial | `docs/Guia-Prueba-Tutor-Empresarial.md` |
