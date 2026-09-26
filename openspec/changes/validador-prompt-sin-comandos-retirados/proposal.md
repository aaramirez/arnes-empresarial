# Propuesta: el prompt del validador de solicitudes deja de nombrar comandos retirados, con una guarda sobre todos los textos de agente

**Origen**: hallazgo del orquestador tras cerrar v3.21 (misma clase de deriva que corrigió el ADR 302 en la nota del reporte).

**Rama prevista**: `hito/v3.22-validador-prompt-sin-comandos-retirados`. `v3.22` está libre: `rg "v3\.2[2-9]"` sólo encuentra una mención especulativa en `reembolso-resta-monto-vendido-en-reporte/design.md:314`. La rama se crea **después** del checkpoint (AGENTS.md).

**No es un hito del Plan.** Es una corrección de coherencia entre el catálogo de comandos y lo que el núcleo le dice al modelo.

> **Nota de proceso**: este ejecutor no tiene shell, así que **no pudo correr `graphify query`** pese al hook, ni `sqlite3 -readonly`. Todo `archivo:línea` se verificó con `Read`/`Grep` sobre `main` (`bd34360`). `sdd-apply` debe re-`Grep`ear los anclajes antes de tocar. **Actualización (fase design, con shell)**: se corrió `graphify query`, se re-verificaron anclajes y techo, y un dry-run de la regex sobre los textos reales confirmó que sólo el validador queda rojo (`design.md`, nota de proceso).

**Numeración**: este change abre **ADR 303** y **RD-175**. Techo reverificado sobre todo el repo (sin `node_modules`, incluidos los changes sin versionar): `ADR[ -]?(30[3-9]|3[1-9]\d|[4-9]\d\d)` y `RD-(17[5-9]|1[89]\d|[2-9]\d\d)` → **0 coincidencias**. El 302 y la RD-174 son del v3.21 y ya están en el arc42 (`ARC42:704,710`). Los changes sin mergear (`operabilidad-produccion`, `respaldo-y-durabilidad-sqlite`, `logs-y-metricas`, `permisos-granulares`, `instancia-por-organizacion`, `salud-operativa`, `replicacion-continua-sqlite`, `sesiones-web-persistentes`, `modo-headless-cierre-limpio`) usan el rango 2xx y no reservan nada en 300+.

---

## Intent

**Qué pasa hoy**: `VALIDADOR_SOLICITUDES_AGENT.systemPrompt` (`src/core/agents/definitions.ts:326-331`) termina con *"esa decisión la toma un empleado autenticado mediante `/aprobar-solicitud` o `/rechazar-solicitud`"*. Esos dos comandos **se dieron de baja en v3.10.0** (`aprobacion-conversacional-hitl`, ADR 210 pto 1, tarea 10). Hoy una solicitud se resuelve **por conversación** con la operación `resolver_solicitud` (ADR 206), en dos mensajes, y sólo la resuelve un administrador que **no** es el solicitante (`autorizacion-resolucion.ts:10-13`, `resolver-solicitud-interna.ts:220-236`). Si alguien tipea `/aprobar-solicitud`, recibe *"No conozco…"* (`comando-empleado.test.ts:628-644`).

**Causa raíz**: `aprobacion-conversacional-hitl` tocó `definitions.ts` sólo en `INSTRUCCION_OPERACIONES_EMPLEADO` (su `design.md:362`), no en el prompt del validador. Ningún test fija ese texto, así que nada se puso rojo.

**Impacto (tres caminos)**:

1. **El solicitante lo lee**. El validador corre en **cada** alta (`crear-solicitud-interna.ts:127-141`) y su dictamen se muestra tal cual: *"Solicitud X creada (caso Y). Dictamen: …"* (`ejecutar-operacion.ts:232-242`), también en el detalle (`:956-962`). Si el modelo repite el comando, el empleado recibe una instrucción muerta.
2. **El administrador también**. El dictamen está a la vista del agente de operaciones en el listado de `resolver_solicitud` (`aprobacion-conversacional-hitl/design.md:370`). Un dictamen con `/aprobar-solicitud` invita al agente a sugerir ese comando.
3. **Contradicción en la demo**: la guía de demostración dice que los `/aprobar-*` están retirados.

**Éxito**: ningún texto fijo que el núcleo le entrega al modelo nombra un comando que no esté en `COMANDOS`, y una guarda de test lo impide en adelante.

---

## Scope

### In Scope

- **Texto nuevo del prompt del validador** (`definitions.ts:326-331`). Conserva el rol (evalúa, dictamina, no aprueba ni rechaza), quita los comandos y le pide al modelo que no dé instrucciones de resolución, porque el dictamen lo lee el solicitante. Texto exacto en `design.md` §3.
- **Instrucción de delegación** (`crear-solicitud-interna.ts:133`): alinear *"la toma un empleado autenticado"* con el prompt nuevo (**[CP C2]**). Hoy no nombra comandos, pero dice algo falso desde `autorizacion-empleado`.
- **Helper de test compartido** `src/test/comandos-en-texto.ts` (extracción de tokens `/comando` y diferencia contra `COMANDOS`), con su propio test de tabla. Precedente: `src/test/listar-archivos-ts.ts`, excluido del build (`tsconfig.build.json:3`).
- **Guarda anti-deriva** sobre todos los textos de agente del núcleo: `listAgentDefinitions()`, `listSubagentDefinitions()`, `construirAgenteEmpleadoOperaciones()`, `construirDeveloperConEscritura(fakeWorktree)`, más `buildSoportePrompt`, `buildOperacionesEmpleadoPrompt` y `buildSolicitudA2APrompt` (**[CP C3]**). Mira `systemPrompt` **y** `description`.
- **Migrar la guarda del v3.21** (`reporte.test.ts:610-625`) al helper (**[CP C5]**). Su regex (`[a-z][a-z-]*`) corta `/ver-solicitudes-a2a` en `/ver-solicitudes-a`: bug latente, hoy invisible porque el reporte no nombra ese comando.
- **ADR 303 + RD-175** y deltas de spec (ver Capabilities).
- Evidencia manual (observación, no assert) en `docs/progreso/v3.22-validador-prompt-sin-comandos-retirados/`.

### Out of Scope (van a la Deuda 14 del arc42, ver `design.md` §8)

- **Dictámenes ya persistidos** en `solicitudes_internas.dictamen` que puedan contener los comandos. Son registro histórico de la salida del LLM; no se reescriben (**[CP C6]**). La evidencia manual los cuenta en una copia de la base.
- `.claude/skills/devolucion-conversacional/SKILL.md:8` (*"Reemplaza al comando `/devolucion …`"*): lo presenta como reemplazado, riesgo bajo. Un SKILL.md tampoco entra en la guarda automática porque su prosa produce falsos positivos (`registrar-venta-conversacional/SKILL.md:44`, *"`vendedorId`/la"*).
- `buildActivityPrompt` (`core/activity/activity-prompt.ts:99`): su audiencia es la revisión de PRs y mete rutas de archivos del PR, que son contenido variable.
- Descripciones de tools (`src/adapters/operaciones/index.ts`, `src/adapters/consultas/index.ts`): verificadas limpias con `Grep`; una guarda desde `core` tendría que importar adapters.
- Comentarios desactualizados que no llegan al modelo (`resolver-solicitud-interna.ts:198`, `build-on-comando-empleado.ts:39-40`, `tui-port.ts:28`) y las constantes de auditoría `COMANDO_APROBAR_SOLICITUD`/`COMANDO_RECHAZAR_SOLICITUD` (`registro-acciones-contract.ts:15-16`), que etiquetan filas históricas del registro.
- `docs/Guia-Demostracion-Pasantia.md` (sin versionar).

---

## Capabilities

### New Capabilities

- Ninguna.

### Modified Capabilities

| Capability | Última versión vigente | Qué cambia |
|---|---|---|
| `solicitud-interna-hitl` | `hito-2.0-delegacion-subagentes/specs/solicitud-interna-hitl/spec.md:28-41`. Los deltas posteriores (`comando-cancelar-solicitud`, `autorizacion-empleado`, `aprobacion-conversacional-hitl`) **no** tocan este requirement | MODIFIED *"El subagente validador emite un dictamen sin transicionar automáticamente"*: lo que recibe el validador no nombra comandos inexistentes y dice que la decisión la toma una persona autorizada distinta del solicitante |
| `delegacion-subagentes` | `hito-2.0-delegacion-subagentes/specs/delegacion-subagentes/spec.md` + MODIFIED de `hito-2.1-escritura-delegada` | ADDED: ningún texto fijo de agente del núcleo nombra un comando que no esté en `COMANDOS`; la guarda lo verifica |

---

## Approach

Cambio de texto en dos constantes del núcleo, sin imports nuevos de producción. La garantía duradera es la guarda: un test recorre el inventario de textos que llegan al modelo y exige que todo token con forma `/comando` sea el `nombre` de un descriptor de `COMANDOS`. Así, el próximo change que baje un comando se pone rojo en el mismo PR, sin depender de que alguien se acuerde. El ADR 303 generaliza al resto de los prompts la regla que el ADR 302 fijó sólo para la nota del reporte.

**Por qué el prompt no nombra `resolver_solicitud` ni el canal**: el validador tiene `allowedTools: []` (`definitions.test.ts:288-292`) y no resuelve nada. Su lector es el solicitante, que **nunca** puede resolver su propia solicitud. Nombrar la operación filtraría un id interno al texto visible, y nombrar canales ata el prompt a algo que cambia (ADR 297-299 ya agregaron un canal). La instrucción que importa es *"no indiques comandos ni pasos"*.

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/agents/definitions.ts` | Modified | Prompt del validador (`:326-331`) y su doc-comment |
| `src/core/solicitudes/crear-solicitud-interna.ts` | Modified | Instrucción de delegación (`:133`), [CP C2] |
| `src/test/comandos-en-texto.ts` (+ `.test.ts`) | New | Helper de test compartido |
| `src/core/agents/textos-modelo-sin-comandos.test.ts` | New | Guarda sobre el inventario de textos |
| `src/core/agents/definitions.test.ts`, `src/core/solicitudes/crear-solicitud-interna.test.ts` | Modified | Tests del contenido del validador y de lo que recibe (sólo adiciones) |
| `src/core/ventas/reporte.test.ts` | Modified | La guarda del v3.21 usa el helper, [CP C5] |
| `docs/ARC42_Harness_Empresarial.md` | Modified (cierre) | Concepto 14, ADR 303, Deuda 14 |
| `comando-empleado.ts`, `ejecutar-operacion.ts`, `invoke-model.ts`, `soporte-prompt.ts`, `a2a-entrante-prompt.ts`, adapters, migraciones, SKILL.md | **Sin cambios** | Si aparecen en el diff, el change se salió del alcance |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| R1 | El LLM sigue inventando un comando o un procedimiento en el dictamen | Baja | El prompt le prohíbe dar pasos. La evidencia manual lo observa (no es determinista, no se afirma) |
| R2 | Falso positivo de la guarda (una ruta o un `x/y` leídos como comando) | Media a futuro | Regex con lookbehind que excluye letras, dígitos, `_`, `.`, `/` y `~`, con test de tabla. Un falso positivo se resuelve reformulando el texto, no aflojando la regex (`design.md` §4) |
| R3 | Falso negativo: un comando retirado en un texto que la guarda no recorre | Media | Inventario explícito con conteo fijo (no vacuidad). Lo que queda afuera está listado en la Deuda 14 |
| R4 | Dictámenes viejos con los comandos siguen visibles | Cierta si existen | Se cuentan en la evidencia; no se reescriben ([CP C6]) |
| R5 | `permisos-granulares` cambia quién puede resolver | Media | El texto dice *"persona autorizada"*, no *"administrador"*: no duplica la política ([CP C1]) |

## Rollback Plan

`git revert` de los commits del change. No hay migración, datos ni configuración. Revertido, el prompt vuelve a nombrar los comandos y la guarda desaparece.

## Dependencies

- Checkpoint humano (AGENTS.md). Sin dependencias npm nuevas. Sin dependencia de código con los changes sin mergear.

## Success Criteria

- [ ] El prompt del validador no contiene `/aprobar-solicitud`, `/rechazar-solicitud`, `resolver_solicitud` ni *"empleado autenticado"*, y dice que la decisión la toma una persona autorizada distinta de quien la pidió.
- [ ] La guarda recorre las **diez** fuentes (diecisiete textos) del inventario (`design.md` §4.2) y todos pasan.
- [ ] El helper reconoce `/ver-solicitudes-a2a` completo y no confunde rutas, URLs ni `y/o`.
- [ ] `allowedTools` y `description` del validador no cambian.
- [ ] Mutaciones M1-M6 registradas (rojo con la mutación, verde revertida).
- [ ] Evidencia manual con al menos tres dictámenes nuevos observados y el conteo de dictámenes viejos con comandos.
- [ ] `npm test`, `npm run typecheck` y `npm run build` en verde. **Strict TDD**.

## Estimación

≈ 220-320 líneas (`design.md` §7). **Riesgo de superar 400: Bajo.** Una sola PR.
