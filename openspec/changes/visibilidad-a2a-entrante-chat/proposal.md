# Propuesta: `ver_solicitudes_a2a` en el chat — visibilidad de sólo lectura de lo que un agente externo le preguntó al arnés

**Origen**: **hallazgo H3a de la sesión de pruebas post-v3.12**. `/ver-solicitudes-a2a [a2aTaskId]` existe **sólo en la TUI** (`src/build-on-comando-empleado.ts:1081-1105`); el empleado que trabaja en el chat web no tiene forma de ver qué le preguntaron desde afuera. Segunda de **tres** propuestas livianas abiertas juntas para que el checkpoint decida corte y orden. Las otras: `consulta-solicitud-propia` (anterior en la serie) y `consulta-kpi-a2a-chat` (siguiente). El **H1** (conocimiento en el chat) vive en `conocimiento-chat-empleado` y **no se toca acá**.

**Rama prevista**: `hito/v3.15-visibilidad-a2a-entrante-chat` · **Tag**: `v3.15.0` · **Progreso**: `docs/progreso/v3.15-visibilidad-a2a-entrante-chat/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`. **La numeración `v3.15.0` es propuesta, no fijada** — depende del orden que apruebe el checkpoint. **La rama se crea DESPUÉS del checkpoint** (AGENTS.md).

> **Nota de proceso**: este ejecutor no tiene herramienta de shell, así que no pudo correrse `graphify query` pese al hook del repo — misma nota que dejaron `ergonomia-canal-empleado` y `devolucion-sin-token-dos-personas`. **Todo lo afirmado abajo está verificado por `Grep`/`Read` con archivo:línea.**

**Techo reverificado por `Grep` en esta fase**: **ADR 233** / **RD-111**; no existe cita de ADR 234-246 ni RD-112+ en el repo. Rangos disjuntos: 234-236 son de H1, 237-239 de `consulta-solicitud-propia`, **esta propuesta abre en ADR 240-242 y RD-116/117**. `sdd-spec`/`sdd-design` deben reverificar (v3.12 no cerró). **No se reabre la colisión 174-187 (RD-94).**

---

## Intent

El comando existe, funciona y está auditado — pero vive detrás de una TUI. Desde v3.9 el canal real del empleado es el chat web, y desde v3.10 las decisiones HITL se resolvieron ahí. **Que la visibilidad del A2A entrante sea el único flujo que obliga a abrir una terminal es una asimetría de canal, no una decisión.**

Lo que hay que mover es poco: la mayor parte del caso de uso ya vive en el núcleo — `SolicitudA2AEntranteStorePort`, `SolicitudA2AEntranteVistaEmpleado`, `TASK_STATES_EN_CURSO` y los límites de paginación están en `src/core/agents/a2a-entrante-contract.ts:12-84`.

**Pero hay un hecho que cambia el perfil de riesgo y que esta propuesta pone en el centro**: en la TUI, `mensajeRecibido` y `resultado` los lee **un humano**. En el chat, los leería **el modelo**, en un turno que tiene tools de **escritura** — y `registrar_venta` **no pide confirmación en dos pasos** (el delta vigente de `herramienta-operaciones-negocio:31-33` enumera exactamente cuatro operaciones confirmadas, y `registrar_venta` no está). **Sería el primer texto de origen externo que entra al contexto de un turno con capacidad de escritura**: superficie de prompt-injection indirecta que hoy el repo no tiene.

**Por qué ahora**: porque el costo marginal es bajo mientras el patrón de "operación conversacional de sólo lectura" está fresco de v3.12, **y porque la decisión de qué campos ve el modelo conviene tomarla acá, en frío, y no cuando aparezca el primer incidente**.

---

## Scope

### In Scope

- **Operación `ver_solicitudes_a2a { a2aTaskId? }`** de **sólo lectura**, **duodécima** del contrato (`OPERACIONES_NEGOCIO` 11 → **12**, `src/core/operaciones/operaciones-contract.ts:71-82`): sin id ⇒ listado de tareas en curso; con id ⇒ detalle.
- ★ **Mover a `src/core/` los textos puros que hoy viven en el archivo raíz**: `formatearLineaSolicitudA2A` (`build-on-comando-empleado.ts:598`), `formatearListadoSolicitudesA2A` (`:614`), `formatearSeccionPaginadaA2A` (`:631`), `formatearDetalleSolicitudA2A` (`:651`) y `mensajeDeMotivoA2A` (`:701`). Son funciones puras; **el dispatcher es núcleo y no puede importar del raíz** (AGENTS.md: `src/core/` nunca importa adaptadores, y el raíz es composition root). La TUI pasa a importarlos del núcleo (ADR 240).
- **Autorización idéntica a la TUI**: exige **sesión vigente, sin rol** — `privilegiado: true`, `requiereAdministrador: false` (`src/core/commands/comando-empleado.ts:296-305`). **El chat no afloja ni endurece ese gate.**
- **Auditoría CONSERVADA**: `RESULTADO_ATENDIDA`/`NO_APLICABLE` (ADR 143), a diferencia de `consultar_venta`/`consultar_solicitud` que no auditan. El motivo original sigue vigente: `resultado` es la respuesta que el arnés le dio a un tercero, construida sobre datos de la empresa.
- **Proyección para el chat, decidida explícitamente** (ADR 241) — **es la decisión central de este change**.
- **Skill nueva** `.claude/skills/ver-solicitudes-a2a/SKILL.md`, auto-descubierta.
- **Conteo 11 → 12** en `README.md`, arc42, specs y tests.

### Out of Scope

- **`/consultar-kpi` (A2A SALIENTE)**: es `consulta-kpi-a2a-chat`, el change siguiente. Perfil de riesgo distinto: sale a un sistema externo.
- **`mcp__consultas__consultar_negocio`** (`src/core/agents/consultas-negocio-tool.ts`): es la tool de sólo lectura que el arnés le expone a un agente **externo** por A2A entrante. **Ya funciona, no se toca, y no debe registrarse en el turno del chat** (criterio vigente de ADR 176 / ADR 180).
- **Cambiar el comando de la TUI en comportamiento.** El movimiento de los formateadores a `core/` es un refactor **sin cambio de salida**: los tests vigentes de la TUI deben seguir pasando sin editarse.
- **Tocar el servidor A2A entrante, el token `HARNESS_A2A_ENTRANTE_TOKEN`, el transporte o el esquema** (tabla de v3.4, migración `0011`). **Cero migraciones.**
- **Responder o actuar sobre una solicitud entrante desde el chat.** Esto es **sólo lectura**. Cualquier acción es otro change y otra conversación de seguridad.
- **Reescribir prompts o `INSTRUCCION_OPERACIONES_EMPLEADO`** (duplicados a propósito, pineados por tests).

---

## Capabilities

> Cada change lleva sus specs en `openspec/changes/<change>/specs/<capability>/spec.md`. **Catálogo verificado por `Glob` en esta fase: 79 archivos.** `sdd-spec` **debe reverificar**.

### New Capabilities

- **`visibilidad-a2a-entrante-chat`** — capability propia, **no** un delta a `visibilidad-a2a-entrante` (v3.4, `comando-visibilidad-a2a-entrante/specs/`). Razón: la spec vigente describe un **comando de TUI leído por un humano**; acá la garantía nueva es *"qué del texto externo llega al contexto del modelo"*, que esa spec no puede afirmar sin desnaturalizarse. **`sdd-spec` debe confirmar este corte al leer la spec vigente** — si resulta redactada sobre el caso de uso y no sobre el canal, un delta puede ser mejor.

### Modified Capabilities

- **`herramienta-operaciones-negocio`** — **versión vigente al arrancar: la de `consulta-solicitud-propia`** (once operaciones), no la de v3.12. Delta con bloque `Previously`: Purpose once → **doce**, enumeración de schemas, y el requirement de auditoría (★ **acá `ver_solicitudes_a2a` es de sólo lectura pero SÍ audita** — es una excepción al patrón de `consultar_venta` y tiene que quedar escrita, no inferida).
- **`visibilidad-a2a-entrante`** (v3.4) — **delta sólo si** algún requirement vigente afirma *"únicamente por comando de TUI"*. **A verificar leyendo.**
- **`turno-empleado-autenticado`** — **sin delta esperado**: no cambia qué servidores MCP se registran ni cómo llega la sesión.

---

## Approach

**Dos slices**, con el refactor primero para que el PR que agrega superficie sea legible:

1. **Slice 1 — mover textos puros a `core/`** (p. ej. `src/core/agents/a2a-textos.ts`) y reapuntar los imports de la TUI. **Cero cambio de comportamiento**, verificable porque los tests vigentes de la TUI no se editan.
2. **Slice 2 — la operación**: contrato + validación + `case` en el dispatcher + wiring del store (que ya existe: `createSolicitudA2AEntranteStore`, `build-on-comando-empleado.ts:557-571` — es traducción de filas, **se queda en la capa adaptadora**) + auditoría + skill + docs.

**Alternativa rechazada al slice 1**: inyectar las funciones de formato en `EjecutarOperacionDeps` desde el composition root. Evita mover código, pero **mete presentación en las dependencias del núcleo** y vuelve el dispatcher configurable donde hoy es determinista.

---

## ADRs a abrir (240-242)

### ADR 240: Los textos puros del A2A entrante se mueven a `core/`; la traducción de filas se queda en el adaptador

| Alternativa | Tradeoff | Veredicto |
|---|---|---|
| Que el dispatcher importe del archivo raíz | Diff mínimo, **pero viola la regla no negociable de AGENTS.md** (`src/core/` nunca importa fuera del núcleo) | **Rechazada** |
| Inyectar formateadores por `EjecutarOperacionDeps` | No mueve código, **pero** el dispatcher deja de producir texto determinista y la presentación entra al contrato de deps | **Rechazada** |
| **Mover las cinco funciones puras a `core/`, TUI importa de ahí** | **≈100 líneas movidas y churn de imports** (infla el diff sin aportar comportamiento). A cambio: hexagonal intacto, un solo lugar donde vive el vocabulario, y la TUI y el chat no divergen en redacción | **Elegida** |

### ADR 241 ★: Qué del contenido externo llega al contexto del modelo — **decisión del checkpoint**

**Contexto verificado**: `mensajeRecibido` lo escribió un agente externo (autenticado por token, **no confiable**); `resultado` contiene datos de la empresa entregados a un tercero. En el chat ese texto entra al contexto de un modelo que en el mismo turno puede invocar `registrar_venta` **sin confirmación**. Además queda en el transcripto persistido del SDK y en la memoria conversacional de v3.9 (retención ampliada respecto de la TUI, que no persiste el render).

| Opción | Pros | Contras |
|---|---|---|
| **A — Sólo metadatos** (tarea, estado, origen de transporte, fechas; sin `mensajeRecibido` ni `resultado`) | Elimina la superficie de injection de raíz; nada externo entra al contexto | El empleado no ve **lo que preguntaron**, que es justamente lo que quería ver |
| **B — Metadatos + contenido truncado y DELIMITADO** como dato no confiable, con test mecánico de que el marco está | Cubre el caso de uso; la injection queda acotada y el marco es verificable | El marco es una mitigación **probabilística**, no una garantía: un modelo puede ignorarlo |
| **C — Contenido íntegro, como en la TUI** | Paridad exacta de canal, cero decisiones nuevas | Máxima exposición: texto externo sin acotar + tools de escritura sin confirmar, en el mismo turno |

**Recomendación de esta fase: B para `mensajeRecibido` y `resultado`, con tres condiciones** — (1) truncado explícito y visible, (2) delimitador con test mecánico, (3) el rótulo **"origen de transporte"** se conserva literal (ADR 142 pto 1: es una dirección de red, **no** una identidad, y el modelo no debe poder leerlo como autenticación). **Si el checkpoint prefiere A, es una respuesta legítima y más barata: el change se achica.** ★ **No decido esto acá.**

### ADR 242: La autorización y la auditoría del chat son IDÉNTICAS a las de la TUI

Sesión vigente, sin rol (verificado: `comando-empleado.ts:303-305`), y fila de auditoría también en la lectura (ADR 143). **Esta propuesta no reabre ninguno de los dos ejes**: exponer el mismo dato por otro canal no es motivo para endurecer ni para aflojar. Si el checkpoint decide que el chat **sí** exija rol, es un cambio de postura y debe escribirse como tal — no colarse.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/agents/a2a-textos.ts` (o equivalente) | **New** | Las 5 funciones puras movidas desde el raíz (ADR 240) |
| `src/build-on-comando-empleado.ts` | Modified | **Sólo imports**: las funciones movidas salen; `createSolicitudA2AEntranteStore` (`:557-571`) **se queda** |
| `src/core/operaciones/operaciones-contract.ts` | Modified | Operación 12 + interfaz `{ a2aTaskId? }` + unión |
| `src/core/operaciones/validar-operacion.ts` | Modified | Las tres tablas |
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | `case` nuevo + dep del store + **auditoría** (ADR 242) |
| `src/adapters/operaciones/index.ts` | Modified | `a2aTaskId` es campo **nuevo** del zod plano + `OPERACIONES_TOOL_DESCRIPTION` |
| `src/build-on-operaciones-empleado.ts` | Modified | Wiring del store de solicitudes entrantes |
| `.claude/skills/ver-solicitudes-a2a/SKILL.md` | **New** | Auto-descubierta |
| `README.md`, arc42 | Modified | Conteo once → doce |
| Servidor A2A, token, esquema, migraciones | **Sin cambio** | **Si aparecen en el diff, el alcance se filtró** |
| Tests de la TUI vigentes | **Sin cambio** | El slice 1 es refactor puro: si un test de TUI hay que editarlo, cambió comportamiento |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★★ | **Prompt-injection indirecta**: texto externo entra por primera vez a un turno con tools de escritura, y `registrar_venta` **no confirma** | **Media, impacto alto** | **ADR 241 — decisión del checkpoint.** Recomendación: opción B (truncado + delimitado + test mecánico del marco). Si se elige C, queda escrito que se asumió el riesgo |
| **R2** | **Retención ampliada**: `resultado` (datos de empresa entregados a terceros) queda en el transcripto del SDK y en la memoria conversacional v3.9 | **Media** | El truncado de ADR 241 la acota. La auditoría (ADR 242) deja rastro de quién lo miró |
| **R3** ★ | **El refactor del slice 1 cambia la salida de la TUI sin querer** | **Media** | Criterio mecánico: **si un test vigente de la TUI necesita editarse, el refactor dejó de ser refactor.** Se para y se revisa |
| **R4** | **`origenTransporte` leído como identidad** por el modelo | **Media** | ADR 241 pto 3: rótulo literal conservado (ADR 142 pto 1), reafirmado en la spec |
| **R5** | **Colisión territorial con la serie**: los tres changes editan `operaciones-contract.ts`, `validar-operacion.ts`, `ejecutar-operacion.ts` y los tests de conteo | **Alta si corren en paralelo** | **Se serializan.** Este va **después** de `consulta-solicitud-propia` (11 → 12) |
| **R6** | **Presupuesto de 400 líneas** | **Alta** (≈400-450 + churn del movimiento) | Dos PRs encadenadas; el churn del slice 1 es mecánico y se revisa rápido |

## Rollback Plan

1. **Cero migraciones, cero columnas, cero escrituras de negocio**: la operación sólo lee (la única escritura es la fila de auditoría, que es aditiva y nunca se borra). **No hay rollback de datos.**
2. **Revertir el slice 2** devuelve el contrato a once operaciones; la TUI sigue funcionando porque el slice 1 no cambió su comportamiento.
3. **Revertir también el slice 1** devuelve las funciones al archivo raíz. Seguro, pero **innecesario**: el movimiento no tiene efecto observable y deja el repo más cerca de la regla hexagonal.
4. **Orden inverso obligatorio** si ya salió `consulta-kpi-a2a-chat` (el conteo es una sola lista `as const`).

## Dependencies

- **BLOQUEANTE — `devolucion-sin-token-dos-personas` (v3.12) mergeado a `main` y tageado `v3.12.0`.** Hoy está en rama, sin mergear.
- **BLOQUEANTE — `consulta-solicitud-propia` (v3.14) mergeado**, por el conteo (11 → 12) y por los tres archivos compartidos del contrato.
- **Relación con `conocimiento-chat-empleado` (v3.13)**: sin dependencia funcional, **sí territorial** sobre `build-on-operaciones-empleado.ts`. Recomendación: que salga antes.
- **Depende de `comando-visibilidad-a2a-entrante` (v3.4, mergeado)**: el store, la vista del empleado, la paginación y la auditoría de lectura.
- **Depende de `hito-3.0-a2a-servidor` y `consultas-negocio-a2a-entrante` (mergeados)**: la tabla de solicitudes entrantes existe y se puebla.
- **Sin dependencias nuevas en `package.json`.**

## Success Criteria

- [ ] **El empleado ve desde el chat, con sesión vigente y SIN rol de administrador, el listado de tareas A2A entrantes en curso y el detalle por `a2aTaskId`.**
- [ ] ★ **Existe un test mecánico que verifica la decisión del ADR 241 tal como la cierre el checkpoint**: si es A, que `mensajeRecibido`/`resultado` **NO** aparecen en la salida; si es B, que aparecen **truncados y dentro del delimitador**.
- [ ] ★ **`git diff` confirma que `src/core/` no importa nada de `src/adapters/*` ni del composition root**, y que las cinco funciones movidas viven en el núcleo (ADR 240).
- [ ] ★ **Los tests vigentes de la TUI pasan SIN editarse** — prueba de que el slice 1 fue refactor y no cambio de comportamiento (R3).
- [ ] **Cada lectura deja fila de auditoría** (`RESULTADO_ATENDIDA`/`NO_APLICABLE`), verificado por test (ADR 242).
- [ ] **El rótulo "origen de transporte" se conserva literal** y ningún texto lo presenta como identidad del solicitante.
- [ ] **`OPERACIONES_NEGOCIO` tiene 12 entradas**, conteo coherente en README, arc42, specs y tests.
- [ ] **Cero migraciones y cero cambios en el servidor A2A / token / esquema**, verificado por `git diff`.
- [ ] **Evidencia manual** en `docs/progreso/v3.15-visibilidad-a2a-entrante-chat/`: listado y detalle desde el chat, más el render equivalente en TUI para mostrar que no divergieron.
- [ ] `npm test` + `npm run typecheck` en verde. **TDD estricto**, rojo inicial en el `toHaveLength(11)`.

---

## Estimación vs presupuesto de review (400 líneas)

| Slice | Contenido | Líneas est. | PR |
|---|---|---|---|
| 1 | Mover 5 funciones puras a `core/` + reapuntar imports + tests de ubicación | ≈ 120-160 (mayormente **churn mecánico**) | PR #1 |
| 2 | Operación 12 + validar + dispatcher + auditoría + wiring + skill + docs | ≈ 280-300 | PR #2, encadenada |
| | **Total** | **≈ 400-450** | **En el límite ⇒ chained PRs** |

**Corte natural**: PR #1 es refactor puro y se revisa leyendo que la salida no cambió — barato aunque tenga líneas. PR #2 concentra **todas** las decisiones de seguridad, que es justo donde se quiere la atención del Reviewer. `sdd-tasks` confirma el forecast.

## Qué necesita el checkpoint

1. ★★ **ADR 241 — ¿qué campos ve el modelo?** A (sólo metadatos) / B (truncado + delimitado, **recomendada**) / C (íntegro como en TUI). **Es la decisión que define este change**: con A, el change se achica y el riesgo desaparece; con C, se asume explícitamente la primera entrada de texto externo a un turno con escritura.
2. ★ **¿Aceptás el refactor de mover los formateadores a `core/`** (≈120-160 líneas de churn sin comportamiento nuevo) **como precio de respetar la regla hexagonal**, o preferís la inyección por deps (rechazada acá, ADR 240)?
3. ★ **¿La operación exige sólo sesión, igual que en la TUI** (recomendado, ADR 242)**, o el chat debería endurecerla a rol `administrador`?** Si es lo segundo, es un cambio de postura y hay que escribirlo.
4. **¿Confirmás el orden en la serie** — después de `consulta-solicitud-propia` y de v3.12 mergeado?
5. **¿Confirmás abrir en ADR 240-242 y RD-116/117**, capability nueva `visibilidad-a2a-entrante-chat` (vs delta a `visibilidad-a2a-entrante`), y `v3.15.0` como número?
