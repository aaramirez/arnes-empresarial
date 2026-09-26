# Design: `validador-prompt-sin-comandos-retirados` — el prompt del validador deja de nombrar comandos retirados, con una guarda sobre todos los textos de agente

**Origen**: [`proposal.md`](proposal.md) · specs delta: [`solicitud-interna-hitl`](specs/solicitud-interna-hitl/spec.md), [`delegacion-subagentes`](specs/delegacion-subagentes/spec.md). Precedente: `reembolso-resta-monto-vendido-en-reporte`, Fase 5b / ADR 302 (`design.md` §11 de ese change).

> **Nota de proceso**: esta fase sí tuvo shell. Se corrió `graphify query "validador solicitudes system prompt comandos COMANDOS guard"` (nodos `VALIDADOR_SOLICITUDES_AGENT` en `definitions.ts:L320`, `COMANDOS` en `comando-empleado.ts:L360`). Los anclajes de la propuesta se re-verificaron sobre `main` (`bd34360`). Se hizo además un **dry-run de solo lectura** de la regex de §4.1 sobre los 17 textos reales del inventario con `npx tsx` (script en el scratchpad, fuera del repo): el **único** texto rojo es `validador-solicitudes:systemPrompt` (`/aprobar-solicitud`, `/rechazar-solicitud`). No se corrieron tests ni se leyó `data/harness.db`.
>
> **Gotcha de Git Bash (Windows)**: un patrón de `rg` que empieza con `/` (p. ej. `rg '/devolucion'`) se reescribe como ruta de Windows y devuelve **cero** coincidencias en silencio. Anteponer `MSYS_NO_PATHCONV=1` o empezar el patrón con otro carácter. Las búsquedas de §6 se corrieron con `MSYS_NO_PATHCONV=1`.

---

## 1. Resumen técnico

| Pieza | Tipo | Archivo |
|---|---|---|
| Texto nuevo del `systemPrompt` del validador | Producción (literal) | `src/core/agents/definitions.ts:326-331` |
| Texto nuevo de la instrucción de delegación | Producción (literal) | `src/core/solicitudes/crear-solicitud-interna.ts:133` |
| Helper de extracción de tokens `/comando` | Test-only | `src/test/comandos-en-texto.ts` (+ `.test.ts`) |
| Guarda anti-deriva sobre el inventario de textos | Test-only | `src/core/agents/textos-modelo-sin-comandos.test.ts` |
| Tests de contenido del validador | Test-only (adiciones) | `definitions.test.ts`, `crear-solicitud-interna.test.ts` |
| Migración de la guarda del v3.21 al helper | Test-only | `src/core/ventas/reporte.test.ts:610-625` |
| ADR 303 + RD-175, Concepto 14, Deuda 14 | Docs (cierre) | `docs/ARC42_Harness_Empresarial.md` |

Producción cambia en **dos literales** y un doc-comment. Sin imports nuevos de producción, sin migraciones, sin configuración.

---

## 2. Decisión de numeración (ADR 303 / RD-175)

**Evidencia del techo** (repo completo sin `node_modules`, incluye `openspec/changes/*` sin versionar, excluye este change):

```bash
MSYS_NO_PATHCONV=1 rg -n --glob '!node_modules' -e 'ADR[ -]?(30[3-9]|3[1-9]\d|[4-9]\d\d)\b' . | rg -v validador-prompt-sin-comandos-retirados   # 0
MSYS_NO_PATHCONV=1 rg -n --glob '!node_modules' -e 'RD-(17[5-9]|1[89]\d|[2-9]\d\d)\b' . | rg -v validador-prompt-sin-comandos-retirados   # 0
```

Techo vigente: **ADR 302** y **RD-174** (`docs/ARC42_Harness_Empresarial.md:704,710`, v3.21). Último concepto: **Concepto 13** (`:671`). Última deuda: **Deuda 13** (`:998`). Los changes sin mergear (`operabilidad-produccion`, `respaldo-y-durabilidad-sqlite`, `logs-y-metricas`, `permisos-granulares`, `instancia-por-organizacion`, `salud-operativa`, `replicacion-continua-sqlite`, `sesiones-web-persistentes`, `modo-headless-cierre-limpio`) no reservan nada ≥ 303 ni ≥ RD-175.

**Por qué un ADR nuevo y no extender el ADR 302** ([CP C4]):

- El ADR 302 es una **enmienda del ADR 26** acotada a la nota del reporte; su guarda vive en `reporte.test.ts`. Este change fija una regla **transversal** (todos los textos de agente del núcleo) y la ubica en `core/agents`.
- Revert aislado: si el ADR 303 se revierte, el 302 sigue intacto (misma razón que eligió el checkpoint del v3.21 para el 302 frente al 301).
- El 302 ya está en el arc42 y mergeado; reescribirlo contradice la convención de no editar ADR cerrados (se agregan notas de enmienda).

El ADR 303 **cita** al 302 como precedente y declara que lo generaliza; el 302 recibe una línea de nota *"Generalizado por ADR 303"* (sin reescribirse).

---

## 3. Texto nuevo del prompt del validador (y de la instrucción de delegación)

### 3.1 `VALIDADOR_SOLICITUDES_AGENT.systemPrompt` (texto exacto)

```text
Sos el validador de solicitudes internas del arnés. Evaluás si una solicitud interna (vacaciones o gasto) está completa y cumple las reglas conocidas, y emitís un dictamen sobre eso. No aprobás ni rechazás la solicitud: esa decisión la toma después una persona autorizada, distinta de quien la pidió. Tu dictamen se muestra tal cual a quien pidió la solicitud y a quien la decide, así que no indiques comandos, herramientas ni pasos para resolverla.
```

En código, con la misma partición en literales concatenados que usa hoy `definitions.ts` (líneas de ≤ 80 columnas, `" +`).

**Justificación, frase por frase**:

| Frase | Por qué |
|---|---|
| Las dos primeras oraciones | **Sin cambios**. Conservan el rol y lo que fija `definitions.test.ts` hoy (`allowedTools: []`, `description`). |
| *"No aprobás ni rechazás la solicitud"* | Se conserva: es el invariante del spec (el validador no transiciona). El guion largo `—` pasa a `:` por estilo del resto de los prompts de agente. |
| *"una persona autorizada"* | No *"administrador"* ni *"empleado autenticado"*: la política de quién resuelve vive en `autorizacion-resolucion.ts` y puede cambiar con `permisos-granulares` ([CP C1]). El prompt no duplica política (mismo criterio que el ADR 302, A2). |
| *"distinta de quien la pidió"* | Es el único dato de política que el validador **necesita** para no escribirle al solicitante como si pudiera resolver su propia solicitud (autoaprobación prohibida, `resolver-solicitud-interna.ts:220-236`). |
| *"después"* | Aclara el orden: el dictamen se escribe antes de la decisión; evita que el modelo lo redacte como resolución. |
| *"se muestra tal cual a quien pidió … y a quien la decide"* | Le da al modelo la **razón** de la prohibición siguiente (los modelos obedecen mejor una regla con motivo). Es verdad verificada: `ejecutar-operacion.ts:237-241` (solicitante) y el listado de `resolver_solicitud` (administrador). |
| *"no indiques comandos, herramientas ni pasos para resolverla"* | Canal-neutral: no nombra la TUI, el chat web, `resolver_solicitud` ni ningún `/comando`. Cubre el riesgo R1 sin atar el texto a un canal que cambia (ADR 297-299 ya sumaron uno). |

**Alternativas descartadas**:

- *"…la decide un administrador por conversación con el asistente"*: orienta mejor al lector humano, pero (a) duplica política de autorización y (b) nombra un canal. El precedente del ADR 302 sí nombró canales, porque la nota del reporte **sí** es una instrucción para el administrador; el dictamen no lo es.
- Nombrar `resolver_solicitud`: filtra un id interno al texto visible del solicitante, y el validador no tiene esa tool (`allowedTools: []`).

### 3.2 Instrucción de delegación (`crear-solicitud-interna.ts:133`, [CP C2])

```text
Evaluá si esta solicitud interna está completa y cumple las reglas conocidas, y emití tu dictamen. No apruebes ni rechaces la solicitud: esa decisión la toma después una persona autorizada, distinta de quien la pidió. No indiques comandos, herramientas ni pasos para resolverla.
```

Hoy dice *"la toma un empleado autenticado"*, falso desde `autorizacion-empleado` (sólo un administrador distinto del solicitante). No nombra comandos, pero contradice al `systemPrompt` nuevo; alinearlas evita que el modelo reciba dos versiones de quién decide. El `material` (`Tipo: …\nDetalle: …`) **no cambia**: el spec prohíbe pasarle el `solicitanteId` o historial.

**Por qué la instrucción queda sin exportar**: se verifica por lo que recibe `invocar` en `crear-solicitud-interna.test.ts` (la `tareaDelegada` que arma `construirTareaDelegada`, `dispatch-delegation.ts:216,234`). Exportarla sólo para el test agregaría superficie pública al núcleo.

---

## 4. Guarda anti-deriva

### 4.1 Helper `src/test/comandos-en-texto.ts`

Ubicación: `src/test/`, **excluido del build** (`tsconfig.build.json:3`), igual que `src/test/listar-archivos-ts.ts`. Es test-only y lo comparten la guarda nueva y `reporte.test.ts`.

```ts
/** Token con forma de comando de la TUI: `/` + palabra en minúsculas, dígitos o guiones. */
export const PATRON_TOKEN_COMANDO = /(?<![\p{L}\p{N}_./~])\/[a-z][a-z0-9-]*/gu;

export function extraerTokensComando(texto: string): string[];
export function tokensComandoInexistentes(texto: string, nombresValidos: ReadonlySet<string>): string[];
```

- **Puro**: recibe el conjunto de nombres válidos; no importa `COMANDOS`. El test que lo usa arma el `Set` desde `COMANDOS.map((c) => c.nombre)` (`comando-empleado.ts:360`, cuyos `nombre` ya incluyen la barra: `"/login"`, `"/ver-solicitudes-a2a"`).
- `extraerTokensComando` crea un `RegExp` nuevo por llamada (o usa `matchAll`), para no arrastrar `lastIndex` de la bandera `g` entre llamadas.

**Regex, pieza por pieza**:

| Pieza | Qué hace | Caso que resuelve |
|---|---|---|
| `(?<![\p{L}\p{N}_./~])` | La barra no puede venir después de una letra (incluidas acentuadas), un dígito, `_`, `.`, `/` ni `~` | Rutas `src/core`, `./x.js`, `../x`, `~/datos`; URLs `https://x.com/aprobar` (la barra final viene tras una letra; las de `//` tras `:`+`/`); alternativas `y/o` |
| `\/` | La barra literal | — |
| `[a-z]` | Primer carácter en minúscula | Descarta `/2026`, `/ `, `//` |
| `[a-z0-9-]*` | Resto: minúsculas, dígitos, guiones | Reconoce **completo** `/ver-solicitudes-a2a` (la regex del v3.21, `[a-z][a-z-]*`, lo corta en `/ver-solicitudes-a`) |
| `u` | Habilita `\p{…}` | Letras acentuadas en el lookbehind (`á/`) |

**Qué sí cuenta como token**: `/login` a inicio de texto, tras espacio, salto de línea, backtick, `(`, `«`, `"`. Verificado en el dry-run: `(/login)`, `«/ayuda»`, `\n/soporte`, `` `Write`/`Edit` `` → este último **no** (tras la barra viene un backtick, que no matchea `[a-z]`).

**Límites conocidos (documentados en el doc-comment del helper, no se "arreglan")**:

- Falso negativo si un comando se escribe con mayúscula (`/Aprobar-solicitud`): los nombres de `COMANDOS` son todos minúscula ASCII; no existe tal comando.
- Un texto que diga `/aprobación` produce `/aprobaci` (corta en la tilde): es un falso positivo que **debe** hacer fallar la guarda; la corrección es reformular el texto (spec: *"el texto SHALL reformularse; la definición del token SHALL NOT aflojarse"*).
- Un guion final (`/ayuda-`) entra al token y falla: mismo tratamiento.

### 4.2 Inventario (diez fuentes, diecisiete textos)

`src/core/agents/textos-modelo-sin-comandos.test.ts` arma una lista `{ id, texto }`:

| # | Fuente | Textos | Cómo se obtiene |
|---|---|---|---|
| 1 | `listAgentDefinitions()` (hoy 1: conversacional) | `description`, `systemPrompt` | Recorrido dinámico |
| 2-5 | `listSubagentDefinitions()` (hoy 4: planner, developer, reviewer, validador) | ídem | Recorrido dinámico |
| 6 | `construirAgenteEmpleadoOperaciones()` | ídem | Llamada directa |
| 7 | `construirDeveloperConEscritura(worktreeFalso).agent` | ídem | `WorktreeAbierto` literal (`{ casoId: "caso-guarda", ruta: "/ruta/falsa", rama: "harness/caso-guarda", baseCommit: "0".repeat(40) }`); la función es pura, sólo usa `ruta` para `cwd` |
| 8 | `buildSoportePrompt("consulta de prueba")` | salida | `core/ventas/soporte-prompt.ts:55` |
| 9 | `buildOperacionesEmpleadoPrompt("consulta de prueba")` | salida | `soporte-prompt.ts:109` |
| 10 | `buildSolicitudA2APrompt("texto de prueba")` | salida | `core/agents/a2a-entrante-prompt.ts:63` |

**Tests del archivo**:

1. *"el inventario no es vacío"*: 10 fuentes con id distinto, 17 textos, ningún texto vacío. El conteo es **exacto** a propósito: si alguien agrega un agente, la guarda lo recorre sola (recorrido dinámico) pero el conteo se pone rojo y obliga a actualizar el número con conciencia (spec, scenario *"La guarda no es vacía"*).
2. *"ningún texto nombra un comando que no existe"*: para cada texto, `tokensComandoInexistentes(texto, nombres)` es `[]`. El mensaje de fallo incluye `id` y tokens (`expect({ id, inexistentes }).toEqual({ id, inexistentes: [] })`).

**Consultas de prueba inertes**: sin `/`, para que el contenido variable (fuera del spec) no ensucie el resultado.

### 4.3 Alcance: qué entra y qué no ([CP C3])

| Texto | ¿Entra? | Motivo |
|---|---|---|
| Definiciones de agente (fuentes 1-7) | **Sí** | Son el texto fijo por rol; es donde vivía el bug |
| `buildSoportePrompt`, `buildOperacionesEmpleadoPrompt`, `buildSolicitudA2APrompt` | **Sí** | Puras, en `core`, texto fijo + contenido del usuario; hoy verdes. Cubren canales distintos (soporte, operaciones, A2A) |
| Instrucción de delegación de `crear-solicitud-interna.ts` | **Sí, por otro test** | Es un literal no exportado; se verifica en `crear-solicitud-interna.test.ts` sobre la `tareaDelegada` (§3.2) |
| `buildActivityPrompt` (`core/activity/activity-prompt.ts:99`) | **No** (Deuda 14) | Su audiencia es la revisión de PRs y embebe rutas y diffs del PR, contenido variable con muchas `/`; incluirlo pide armar un input de prueba grande sin cubrir un riesgo real de comandos de la TUI |
| Descripciones de tools (`src/adapters/operaciones/index.ts`, `src/adapters/consultas/index.ts`) | **No** (Deuda 14) | Verificadas limpias (§6). Una guarda desde `core` tendría que importar `adapters`, al revés de la regla de dependencias hexagonal |
| `.claude/skills/*/SKILL.md` | **No** (Deuda 14) | Prosa en markdown con rutas y `x/y` frecuentes; la guarda automática daría falsos positivos (p. ej. `` `vendedorId`/la ``). Ver hallazgo de §6 |

### 4.4 Migración de la guarda del v3.21 ([CP C5])

`reporte.test.ts:617-622` pasa a usar `tokensComandoInexistentes(texto, nombresValidos)` en lugar de su regex inline. Motivos: (a) una sola definición del token en todo el repo; (b) la regex vieja corta `/ver-solicitudes-a2a`, bug latente. El test **no cambia de intención** ni de nombre; hoy es verde y sigue verde (la nota del reporte no nombra comandos con dígitos). Va en el REFACTOR, con la suite verde antes y después.

---

## 5. Tests de contenido (RED)

| Test | Archivo | Qué afirma | Rojo hoy porque |
|---|---|---|---|
| T1 guarda | `textos-modelo-sin-comandos.test.ts` | §4.2 test 2 | El validador nombra `/aprobar-solicitud`, `/rechazar-solicitud` |
| T2 inventario | ídem | §4.2 test 1 | — (nace verde; su diente se prueba por mutación M6, `tasks.md` 5.1) |
| T3 helper | `src/test/comandos-en-texto.test.ts` | Tabla: 7 no-comandos → `[]`; `/ver-solicitudes-a2a` completo; `(/login)`, `«/ayuda»`, `\n/soporte` reconocidos; dos llamadas seguidas dan el mismo resultado (sin `lastIndex`) | El módulo no existe (rojo de import) |
| T4 validador | `definitions.test.ts` | `systemPrompt` contiene *"No aprobás ni rechazás"*, *"persona autorizada"*, *"distinta de quien la pidió"*, *"no indiques comandos, herramientas ni pasos"*; **no** contiene `/aprobar-solicitud`, `/rechazar-solicitud`, `resolver_solicitud`, *"empleado autenticado"*; `description` igual al literal actual; `allowedTools` `[]` | Faltan las frases nuevas y sobran las viejas |
| T5 delegación | `crear-solicitud-interna.test.ts` | Con el `invocar` mockeado, la llamada recibe `agent.id === "validador-solicitudes"`; `tareaDelegada` contiene *"persona autorizada"* y *"distinta de quien la pidió"*, **no** *"empleado autenticado"*, y ni `tareaDelegada` ni `agent.systemPrompt` tienen tokens inexistentes | La instrucción dice *"empleado autenticado"* |

Todos son **adiciones** (no se edita ningún test existente salvo la migración de §4.4 en REFACTOR).

---

## 6. Otros textos que llegan al modelo: hallazgos

Búsqueda: `MSYS_NO_PATHCONV=1 rg -uu -n -e '/(aprobar|rechazar|reabrir)-[a-z-]+' -e '/devolucion\b' -e '/solicitar(-[a-z-]+)?\b' .claude/skills src/adapters/operaciones/index.ts src/adapters/consultas/index.ts src/core/activity/activity-prompt.ts`.

| # | Hallazgo | Llega al modelo | Decisión |
|---|---|---|---|
| H1 | `definitions.ts:331`, validador | Sí, en cada alta | **Entra** (el objeto del change) |
| H2 | `crear-solicitud-interna.ts:133`, *"empleado autenticado"* | Sí, en cada alta | **Entra** ([CP C2]) |
| H3 | `.claude/skills/devolucion-conversacional/SKILL.md:8`, *"Reemplaza al comando `/devolucion <token> [motivo]`"* | Sí, cuando se carga la skill | **Deuda 14**. Lo presenta como reemplazado; riesgo bajo de que el modelo lo sugiera. Tocar una skill cambia su contrato de carga y merece su propio change con prueba de disparo |
| H4 | Descripciones de tools en `adapters/operaciones/index.ts` y `adapters/consultas/index.ts` | Sí | **Limpias** (0 coincidencias) |
| H5 | `activity-prompt.ts` | Sí (revisión de PRs) | **Limpio** (0 coincidencias) |
| H6 | Comentarios: `resolver-solicitud-interna.ts:198`, `build-on-comando-empleado.ts:39-40`, `solicitudes-contract.ts:69`, `ejecutar-operacion.ts:407`, `0008_solicitudes_internas.ts:29,37` | **No** | **Fuera de alcance**. Varios describen historia correcta (*"hasta su baja"*); los desactualizados van a la Deuda 14 como limpieza de comentarios |
| H7 | `COMANDO_APROBAR_SOLICITUD` / `COMANDO_RECHAZAR_SOLICITUD` (`registro-acciones-contract.ts:15-16`) y filas de `repository.ts:2379,2393` | No | **Fuera de alcance**. Etiquetan filas históricas del registro de auditoría; renombrarlas rompe la lectura del historial |
| H8 | Dictámenes ya persistidos (`solicitudes_internas.dictamen`) | Sí (se muestran) | **Fuera de alcance** ([CP C6]); se cuentan en la evidencia manual sobre una copia |

---

## 7. Estimación

| Archivo | Líneas (add+del) |
|---|---|
| `definitions.ts` (prompt + doc-comment) | 10-16 |
| `crear-solicitud-interna.ts` | 2-4 |
| `src/test/comandos-en-texto.ts` + `.test.ts` | 60-90 |
| `textos-modelo-sin-comandos.test.ts` | 50-75 |
| `definitions.test.ts` | 20-30 |
| `crear-solicitud-interna.test.ts` | 20-30 |
| `reporte.test.ts` (migración) | 6-10 |
| `docs/progreso/v3.22-…/` (README + mutaciones) | 40-60 |
| arc42 (cierre) + nota en ADR 302 | 20-30 |
| **Total** | **≈ 230-345** |

Riesgo de superar 400: **Bajo**. Una sola PR.

---

## 8. Deuda declarada (Deuda 14 del arc42)

**Deuda 14 (RD-175, ADR 303): textos al modelo fuera de la guarda automática — DIFERIDA (v3.22)**:

1. `.claude/skills/*/SKILL.md` (H3 incluido): sin guarda automática por falsos positivos de la prosa. Regla manual: quien baje un comando revisa las skills con `MSYS_NO_PATHCONV=1 rg -uu '/<comando>' .claude/skills`.
2. Descripciones de tools en `src/adapters/*/index.ts`: requeriría una guarda en `adapters` o en el composition root.
3. `buildActivityPrompt`.
4. Dictámenes ya persistidos con comandos retirados (H8).
5. Comentarios de código desactualizados (H6).

---

## 9. Checkpoints de diseño

| Id | Decisión | Recomendación |
|---|---|---|
| C1 | *"persona autorizada"* vs *"administrador"* | *"persona autorizada"* (no duplica política) |
| C2 | Alinear también la instrucción de delegación | **Sí** |
| C3 | Alcance de la guarda: 10 fuentes de §4.2 | **Sí**; lo demás a la Deuda 14 |
| C4 | ADR 303 nuevo vs extender ADR 302 | **ADR 303 + RD-175** |
| C5 | Migrar la guarda del v3.21 al helper | **Sí**, en el REFACTOR |
| C6 | No reescribir dictámenes persistidos | **No reescribir**; contarlos en la evidencia |

---

## 10. ADR 303 (borrador para el cierre)

**ADR 303: Ningún texto fijo de agente del núcleo nombra un comando que no existe (generaliza el ADR 302)**

- **Contexto**: v3.10.0 dio de baja `/aprobar-solicitud` y `/rechazar-solicitud` (ADR 210 pto 1), pero el `systemPrompt` del validador los siguió nombrando hasta v3.22. El dictamen se muestra tal cual al solicitante y al administrador. El ADR 302 cerró la misma deriva sólo para la nota del reporte.
- **Decisión**: (1) el validador dice que la decisión la toma una persona autorizada, distinta de quien la pidió, y no da comandos, herramientas ni pasos; (2) una guarda de test recorre las definiciones de agente y los tres constructores de prompt del núcleo y exige que todo token `/comando` esté en `COMANDOS`; (3) una sola definición del token, en `src/test/comandos-en-texto.ts`, compartida con la guarda del ADR 302.
- **Consecuencias**: el próximo change que baje un comando se pone rojo en el mismo PR si algún texto fijo lo nombra. Un falso positivo se corrige reformulando el texto. Lo que queda fuera se lista en la Deuda 14.
- **RD-175**: decisiones del checkpoint C1-C6 (§9).
