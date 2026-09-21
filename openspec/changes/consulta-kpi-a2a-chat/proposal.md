# Propuesta: `consultar_kpi` en el chat — consultar a un sistema externo desde el canal conversacional

**Origen**: **hallazgo H3b de la sesión de pruebas post-v3.12**. `/consultar-kpi <consulta>` existe **sólo en la TUI** (`src/build-on-comando-empleado.ts:1137-1174`). Tercera y **última** de las tres propuestas livianas abiertas juntas para que el checkpoint decida corte y orden; las anteriores: `consulta-solicitud-propia` y `visibilidad-a2a-entrante-chat`. El **H1** (conocimiento en el chat) vive en `conocimiento-chat-empleado` y **no se toca acá**.

**Rama prevista**: `hito/v3.16-consulta-kpi-a2a-chat` · **Tag**: `v3.16.0` · **Progreso**: `docs/progreso/v3.16-consulta-kpi-a2a-chat/`.

**No es un hito del Plan.** Carpeta descriptiva sin prefijo `hito-X.Y`. **`v3.16.0` es propuesta, no fijada.** **La rama se crea DESPUÉS del checkpoint** (AGENTS.md).

> ★★ **Este es el change de RIESGO MÁS ALTO de los tres.** Es el único que produce un **efecto hacia afuera del arnés**: manda contexto de la empresa a un sistema de terceros, desde una conversación cuyo texto **lo redacta un modelo**. Las tres preguntas de seguridad de abajo están **abiertas a propósito** — esta fase presenta alternativas con tradeoffs y su recomendación, **pero no decide**.

> **Nota de proceso**: este ejecutor no tiene herramienta de shell, así que no pudo correrse `graphify query` pese al hook del repo — misma nota que `ergonomia-canal-empleado` y `devolucion-sin-token-dos-personas`. **Todo lo afirmado abajo está verificado por `Grep`/`Read` con archivo:línea.**

**Techo reverificado por `Grep` en esta fase**: **ADR 233** / **RD-111**; ninguna cita de ADR 234-246 ni RD-112+ existe en el repo. Rangos disjuntos: 234-236 H1, 237-239 `consulta-solicitud-propia`, 240-242 `visibilidad-a2a-entrante-chat`, **esta propuesta abre en ADR 243-246 y RD-118/119/120**. Reverificar en `sdd-spec`. **No se reabre la colisión 174-187 (RD-94).**

---

## Intent

Misma asimetría de canal que el change anterior: la consulta a agentes externos de KPIs/incidentes sólo se puede disparar desde una terminal, mientras el trabajo real del empleado pasó al chat web.

**Pero acá la paridad de canal NO es trivial, y el motivo está escrito en el código**: `manejarConsultarKpi` despacha con **insumo FIJO EN CÓDIGO** y el doc-comment del ADR 85 dice literalmente *"nunca del modelo, nunca de un prompt libre"* (`build-on-comando-empleado.ts:1121-1123`). El único dato variable es `material = comando.consulta` (`:1157`), **que en la TUI lo tipea un humano**. Llevarlo al chat significa que **lo redacta el modelo** — exactamente lo que ese ADR excluyó.

O sea: este change no es "exponer un comando más". **Es decidir si el arnés acepta que un modelo componga el texto que sale hacia un tercero**, y bajo qué control. Por eso se abre como propuesta separada y por eso deja tres decisiones al checkpoint en lugar de resolverlas.

**Por qué ahora**: porque las otras dos propuestas de la serie ya tocan los mismos archivos del contrato y conviene decidir el orden completo de una vez; y porque si la respuesta del checkpoint es *"no, esto se queda en la TUI"*, **eso también es un resultado valioso** y cuesta una conversación, no un rework.

---

## Scope

> ★ El *In Scope* de abajo es **condicional a la decisión del ADR 243**. Si el checkpoint elige catálogo cerrado, el change se achica notablemente (desaparece la confirmación en dos pasos y el dominio nuevo).

### In Scope

- **Operación `consultar_kpi`** en `OPERACIONES_NEGOCIO` (12 → **13**, `src/core/operaciones/operaciones-contract.ts:71-82`), con la forma de entrada que fije el **ADR 243** (enum de catálogo **o** texto libre acotado).
- **Reuso del camino A2A que ya existe en el núcleo**: `despacharDelegacionA2A`, `DelegacionA2AStorePort`, `resolverDestinoA2A`, `ClienteA2APort`, `DelegacionA2ANoCompletadaError` (`src/core/turn-selector/dispatch-delegation-a2a.ts`, `src/core/agents/a2a-contract.ts`). **Cero lógica de transporte nueva.**
- ★ **Mover `mensajeDeMotivoA2A` a `core/`** (hoy en `build-on-comando-empleado.ts:701`, función pura): el dispatcher es núcleo y no puede importarla del raíz. **Si `visibilidad-a2a-entrante-chat` salió primero, este movimiento YA está hecho** y este change lo reusa (ADR 240 de ese change).
- **Auditoría** `COMANDO_CONSULTAR_KPI` con `RESULTADO_ATENDIDA`/`FALLIDA`, igual que la TUI (`:1165-1171`).
- **Caso**: reusar el `casoId` del turno de operaciones en vez de crear uno propio — `idx_delegaciones_a2a_caso` **no es UNIQUE** (`0010_delegaciones_a2a.ts:50`), así que es viable. Decisión menor, **RD-118**.
- **Apagado por defecto conservado**: sin `HARNESS_A2A_SALIENTE=on` no hay `clienteA2A` (`main.ts:379-383`), y el dispatcher debe responder el mismo *"desactivado"* **sin caso y sin fila** (`build-on-comando-empleado.ts:1141-1143`) — invariante de rollback a v2.1.0.
- **Manejo explícito del timeout** (ADR 245) y de **qué se le muestra al modelo del `resultado` externo** (ADR 246).
- **Skill nueva** `.claude/skills/consultar-kpi/SKILL.md` + conteo 12 → 13 en README, arc42, specs y tests.

### Out of Scope

- **`/ver-solicitudes-a2a` (A2A ENTRANTE)**: es `visibilidad-a2a-entrante-chat`, el change anterior.
- ★ **`mcp__consultas__consultar_negocio`** (`src/core/agents/consultas-negocio-tool.ts`): esa es la tool de sólo lectura que el arnés **expone** a un agente externo en el turno de A2A **entrante**. **Dirección opuesta, ya funciona, fuera de alcance, y no debe registrarse en el turno del chat** (ADR 176 / ADR 180).
- **Agregar destinos A2A nuevos, endpoints o tokens.** El destino sigue siendo `DESTINO_A2A_KPI_INCIDENTE`.
- **Cambiar el comportamiento del comando de TUI.** Sigue siendo de un solo paso con texto humano.
- **Cualquier operación de ESCRITURA hacia el sistema externo.** Esto es una consulta.
- **Migraciones.** Se usan las tablas de `0010`. Próxima libre sigue siendo `0015`.

---

## Capabilities

> **Catálogo verificado por `Glob` en esta fase: 79 archivos `spec.md`.** `sdd-spec` **debe reverificar**.

### New Capabilities

- **`consulta-kpi-a2a-chat`** — capability propia. La vigente `delegacion-a2a-saliente` (`hito-2.2-a2a-cliente/specs/`) describe el **mecanismo** de despacho; lo nuevo acá es **quién compone el insumo y bajo qué control**, que es una garantía de otra naturaleza.

### Modified Capabilities

- **`herramienta-operaciones-negocio`** — **versión vigente al arrancar: la de `visibilidad-a2a-entrante-chat`** (doce). Purpose doce → **trece**; enumeración de schemas (★ si gana el texto libre, el requirement *"el modelo aporta únicamente identificadores estructurados"* necesita una **excepción nombrada**, molde del `motivo` de `solicitar_devolucion`/RD-106); y el requirement de auditoría.
- **`delegacion-a2a-saliente`** — **delta probable**: afirmar que el insumo puede originarse en el canal conversacional y bajo qué control (ADR 243). **A verificar leyendo la spec vigente.**
- **`confirmacion-operaciones-multislot`** (`aprobacion-conversacional-hitl/specs/`) — **delta sólo si** el ADR 244 elige doble confirmación: habría que agregar un `DominioConfirmacion` nuevo (`operaciones-contract.ts:233-253`).

---

## Approach

**2-3 slices**, según cómo cierre el ADR 243:

1. **Slice 1 — preparación**: `mensajeDeMotivoA2A` a `core/` (o reuso si ya se movió) + deps A2A (`clienteA2A`, `delegacionA2AStore`) disponibles en el turno de operaciones. `main.ts` ya tiene `clienteA2A` en scope antes de construirlo (`:379`, `:501`). **Sin comportamiento nuevo.**
2. **Slice 2 — la operación**: contrato + validación + `case` + despacho + auditoría + apagado por defecto + manejo de timeout.
3. **Slice 3 — sólo si gana texto libre** (ADR 243 opción B): dominio de confirmación nuevo y el flujo de dos turnos que **repite el texto exacto** antes de enviar.

---

## ADRs a abrir (243-246)

### ★ ADR 243 — ¿Quién compone el texto que sale al tercero? **DECISIÓN DEL CHECKPOINT**

| Opción | Pros | Contras |
|---|---|---|
| **A — Catálogo cerrado** (enum de consultas predefinidas) | **Conserva ADR 85 tal cual**: el insumo sigue siendo fijo en código; respeta el invariante *"el modelo aporta sólo identificadores estructurados"*; sin confirmación extra; el change baja a 2 slices | Rígido: cada consulta nueva es un cambio de código. Puede no cubrir el caso de uso real, que es justamente preguntar en lenguaje natural |
| **B — Texto libre acotado + doble confirmación que repite el texto exacto** | Cubre el caso de uso; el humano ve **literalmente** lo que va a salir antes de que salga | **Rompe ADR 85** y necesita excepción nombrada (molde `motivo`/RD-106); exige extender `DominioConfirmacion`/`AccionConfirmable` con un `itemId` derivado del texto (p. ej. hash) — más complejidad en la ranura de confirmación |
| **C — Texto libre sin confirmación**, paridad literal con la TUI | Diff mínimo | **El modelo redacta y envía a un tercero sin que ningún humano vea el texto.** No recomendada bajo ninguna lectura de ADR 85 |

**Recomendación de esta fase: A para la primera versión**, y B como evolución **si** el catálogo demuestra ser insuficiente con uso real. Razón: A es la única que **no** requiere reabrir un ADR vigente, y "empezar cerrado y abrir con evidencia" es más barato que el camino inverso. ★ **No lo decido acá.**

### ★ ADR 244 — ¿Confirmación humana en dos pasos? **DECISIÓN DEL CHECKPOINT**

Hecho verificado: el delta vigente de `herramienta-operaciones-negocio:31-33` enumera **cuatro** operaciones con confirmación en dos pasos (`cancelar_solicitud_interna`, `resolver_reembolso`, `resolver_solicitud`, `solicitar_devolucion`); **`registrar_venta` y `crear_solicitud_interna` NO confirman**, pese a tener efecto. En la TUI, `/consultar-kpi` es de **un solo paso** (`:1108`).

- **Si gana el catálogo (243-A)**: **un paso**, coherente con la TUI y con `consultar_reporte_comisiones`.
- **Si gana el texto libre (243-B)**: **dos pasos obligatorios**, y el segundo paso debe mostrar **el texto exacto** que se va a enviar. Sin eso, B degrada a C.

### ★ ADR 245 — Timeout: el 504 es un modo de falla REAL, no teórico. **DECISIÓN DEL CHECKPOINT**

**Verificado**: `DEFAULT_A2A_TASK_TIMEOUT_MS = 120_000` (`src/adapters/a2a/config.ts:28`) y `OPERACIONES_TIMEOUT_MS = 120_000` (`src/adapters/web/config.ts:43`) son **exactamente iguales**, y el turno del modelo **suma su propio tiempo encima**. Conclusión: una consulta A2A lenta hace que `POST /operaciones` devuelva **504 con la tarea todavía viva**, y el empleado no sabe si salió o no.

| Alternativa | Tradeoff |
|---|---|
| **Timeout de tarea más corto para este canal** (p. ej. la mitad del de operaciones) | Simple, sin estado nuevo; a cambio, consultas legítimamente lentas fallan antes. **Recomendada para v1** |
| **Asincronía**: despachar y devolver "en curso", consultar después | Correcta de verdad, **pero** introduce un flujo nuevo (polling/consulta posterior) y probablemente otra operación. Fuera de presupuesto acá |
| **Subir `OPERACIONES_TIMEOUT_MS`** | Empeora el problema: cuelga el chat entero por una dependencia externa. **Rechazada** |

### ADR 246 — Qué del `resultado` externo llega al contexto del modelo

Mismo riesgo que el ADR 241 del change anterior, **agravado**: acá el texto externo llega como **respuesta a la propia operación**, en el mismo turno en que el modelo puede invocar `registrar_venta` (sin confirmación). Mitigación mínima: **resultado truncado y delimitado como dato no confiable, nunca como instrucción**, con test mecánico de que el marco está. **Coherencia obligatoria con la decisión del ADR 241** — si el checkpoint eligió "sólo metadatos" allá, sostenerlo acá; si eligió truncado+delimitado, reusar el mismo marco.

---

## Affected Areas

| Área | Impacto | Descripción |
|---|---|---|
| `src/core/agents/a2a-textos.ts` (o equivalente) | New/Reused | `mensajeDeMotivoA2A` movida del raíz — **ya hecho si salió `visibilidad-a2a-entrante-chat`** |
| `src/core/operaciones/operaciones-contract.ts` | Modified | Operación 13 + interfaz (forma según ADR 243) + posible `DominioConfirmacion` nuevo (ADR 244) |
| `src/core/operaciones/validar-operacion.ts` | Modified | Las tres tablas |
| `src/core/operaciones/ejecutar-operacion.ts` | Modified | `case` **asíncrono** con despacho A2A, `catch` explícito, auditoría, camino "desactivado" |
| `src/adapters/operaciones/index.ts` | Modified | Campo nuevo en el zod plano (enum o texto acotado) + `OPERACIONES_TOOL_DESCRIPTION` |
| `src/build-on-operaciones-empleado.ts` | Modified | `clienteA2A` (opcional) + `delegacionA2AStore` en deps |
| `src/main.ts` | Modified | Pasar `clienteA2A`/store al turno de operaciones (ya están en scope, `:379`, `:501`) |
| `src/adapters/a2a/config.ts` o el sitio del timeout | Modified | Según ADR 245 |
| `src/build-on-comando-empleado.ts` | Modified | Sólo imports (si mueve `mensajeDeMotivoA2A`). **El comando de TUI no cambia de comportamiento** |
| `.claude/skills/consultar-kpi/SKILL.md` | **New** | Auto-descubierta |
| Destinos A2A, endpoints, tokens, esquema, migraciones | **Sin cambio** | **Si aparecen en el diff, el alcance se filtró** |

## Risks

| # | Riesgo | Prob. | Mitigación |
|---|---|---|---|
| **R1** ★★ | **El modelo compone el texto que sale a un tercero**, contra el criterio explícito de ADR 85 (`:1121-1123`) | **Alta si se elige 243-B/C** | **ADR 243 + 244 — decisión del checkpoint.** Recomendación: catálogo cerrado en v1 |
| **R2** ★★ | **Fuga de contexto de la empresa hacia afuera**: el insumo viaja a un sistema de terceros y el arnés no lo controla después | **Media, impacto alto** | Catálogo cerrado la acota estructuralmente; texto libre la acota **sólo** con confirmación humana que muestre el texto exacto |
| **R3** ★ | **504 con la tarea viva**: timeouts iguales (120 s ambos) + tiempo del modelo | **Alta** | **ADR 245.** Sin decisión explícita, el modo de falla aparece en la primera demo lenta |
| **R4** ★ | **Prompt-injection por el `resultado`** del agente externo, en un turno con `registrar_venta` sin confirmación | **Media, impacto alto** | **ADR 246**, coherente con el 241 del change anterior; test mecánico del marco |
| **R5** | **Autorización insuficiente**: hoy es sólo sesión, sin rol (`comando-empleado.ts:269-277`), justificado porque *"manda contexto de la empresa a un tercero"* — **en el chat ese argumento es más fuerte, no más débil** | **Media** | Pregunta abierta al checkpoint (pto 4): ¿exige `administrador` en el chat? |
| **R6** | **Romper el invariante de apagado por defecto** (sin `HARNESS_A2A_SALIENTE=on` no debe crearse caso ni fila) | **Media** | Test mecánico del camino "desactivado": cero caso, cero fila |
| **R7** | **Colisión territorial con la serie** (mismos tres archivos del contrato + tests de conteo) | **Alta si corre en paralelo** | **Último de la serie**, se serializa (12 → 13) |
| **R8** | **Presupuesto de 400 líneas** | **Alta** (≈450-550) | 2-3 PRs encadenadas |

## Rollback Plan

1. **Cero migraciones, cero columnas.** Las escrituras nuevas son filas en `delegaciones_a2a`, `casos` y auditoría — **aditivas, nunca destructivas**.
2. ★ **Lo que NO se puede revertir**: una consulta ya enviada **ya salió del arnés**. El rollback impide consultas futuras; no recupera contexto entregado a un tercero. **Esa asimetría es el argumento de fondo para decidir el ADR 243 del lado conservador.**
3. **Apagado inmediato sin deploy**: quitar `HARNESS_A2A_SALIENTE=on` desactiva el camino entero (mismo invariante que la TUI, `:1141-1143`). **Es el rollback operativo real y debe estar probado.**
4. **Revertir el slice 2/3** devuelve el contrato a doce operaciones; la TUI sigue funcionando.
5. **Orden inverso** si hubiera changes posteriores sobre el contrato.

## Dependencies

- **BLOQUEANTE — `devolucion-sin-token-dos-personas` (v3.12) mergeado a `main` y tageado `v3.12.0`.** Hoy está en rama, sin mergear.
- **BLOQUEANTE — `consulta-solicitud-propia` (v3.14) y `visibilidad-a2a-entrante-chat` (v3.15) mergeados**, por el conteo (13) y por los tres archivos compartidos. Del segundo se reusa además el movimiento de `mensajeDeMotivoA2A` a `core/` y, sobre todo, **la decisión del ADR 241** sobre contenido externo — este change debe ser **coherente**, no contradecirla.
- **Relación con `conocimiento-chat-empleado` (v3.13)**: sin dependencia funcional, **sí territorial** sobre `build-on-operaciones-empleado.ts`, donde van las deps A2A nuevas.
- **Depende de `hito-2.2-a2a-cliente` (mergeado)**: `ClienteA2APort`, `despacharDelegacionA2A`, `resolverDestinoA2A`, configuración de destinos.
- **Depende de `aprobacion-conversacional-hitl` (v3.10, mergeado)** — **sólo si el ADR 244 elige doble confirmación**: la ranura multi-slot es la base.
- **Sin dependencias nuevas en `package.json`.**

## Success Criteria

- [ ] **El empleado consulta al agente externo de KPIs/incidentes desde el chat y recibe la respuesta**, con la forma de entrada que fije el ADR 243.
- [ ] ★ **Existe un test mecánico que verifica el control elegido en ADR 243**: si catálogo, que **ningún texto libre del modelo** llega al insumo; si texto libre, que **sin confirmación previa no hay despacho** y que el segundo paso mostró el texto exacto.
- [ ] ★ **Sin `HARNESS_A2A_SALIENTE=on`, la operación responde "desactivada" y NO crea caso ni fila**, verificado por test (R6).
- [ ] ★ **Una consulta que excede el timeout produce un mensaje de falla legible, no un 504 del chat**, verificado por test con reloj/cliente falso (ADR 245).
- [ ] ★ **El `resultado` externo llega al contexto del modelo con el tratamiento del ADR 246**, con test mecánico del marco — y **coherente con el ADR 241** del change anterior.
- [ ] **Cada invocación deja fila de auditoría** (`RESULTADO_ATENDIDA`/`FALLIDA`) y **nunca con el detalle crudo del error adentro** (criterio vigente, `:1171`).
- [ ] **`git diff` confirma que `src/core/` no importa del composition root ni de `src/adapters/*`**, y cero destinos/tokens/endpoints nuevos.
- [ ] **`OPERACIONES_NEGOCIO` tiene 13 entradas**, conteo coherente en README, arc42, specs y tests.
- [ ] **El comando `/consultar-kpi` de la TUI sigue comportándose igual**, con sus tests vigentes **sin editar**.
- [ ] **Evidencia manual** en `docs/progreso/v3.16-consulta-kpi-a2a-chat/`: consulta exitosa, consulta con A2A apagado, y consulta que agota el timeout.
- [ ] `npm test` + `npm run typecheck` en verde. **TDD estricto**, rojo inicial en el `toHaveLength(12)`.

---

## Estimación vs presupuesto de review (400 líneas)

| Slice | Contenido | Líneas est. | PR |
|---|---|---|---|
| 1 | `mensajeDeMotivoA2A` a `core/` (o reuso) + deps A2A en el turno de operaciones | ≈ 80-120 | PR #1 |
| 2 | Operación 13 + validar + dispatcher async + auditoría + apagado + timeout | ≈ 280-320 | PR #2, encadenada |
| 3 | **Sólo si ADR 243-B**: dominio de confirmación + flujo de dos turnos con eco del texto | ≈ 120-150 | PR #3, encadenada |
| | **Total** | **≈ 450-550** (≈ 380-440 si gana el catálogo) | **Supera 400 ⇒ chained PRs** |

**Corte natural**: PR #2 concentra el efecto externo y es donde el Reviewer debe poner el foco; PR #3 **existe o no según la decisión del checkpoint**, así que el forecast real de `sdd-tasks` depende del ADR 243. **Si gana el catálogo, el change puede caber en 2 PRs y rozar el presupuesto sin excepción.**

## Qué necesita el checkpoint

1. ★★ **ADR 243 — ¿catálogo cerrado de consultas, o texto libre redactado por el modelo con doble confirmación que repite el texto exacto?** Recomendación: **catálogo en v1**, porque es la única opción que **no reabre ADR 85** y porque lo que sale a un tercero **no se puede revertir** (Rollback pto 2). **No lo decido acá.**
2. ★★ **ADR 244 — ¿confirmación humana en dos pasos?** Ligada al pto 1: catálogo ⇒ un paso; texto libre ⇒ **dos pasos obligatorios**, o degrada a "el modelo manda solo".
3. ★ **ADR 245 — ¿cómo se resuelve el choque de timeouts** (`DEFAULT_A2A_TASK_TIMEOUT_MS` y `OPERACIONES_TIMEOUT_MS` valen los dos 120 s, verificado)**: timeout de tarea más corto para este canal (recomendado) o asincronía con consulta posterior (más correcto, fuera de presupuesto)?**
4. ★ **¿Exige rol `administrador` en el chat?** En la TUI es sólo sesión, y la justificación escrita de `privilegiado` es *"manda contexto de la empresa a un tercero"* — argumento que en el chat pesa **más**. **Recomendación de esta fase: SÍ exigir `administrador`** mientras el control del pto 1 no sea el catálogo cerrado.
5. **¿Este change se hace, o `/consultar-kpi` se queda en la TUI?** Es una respuesta legítima: **es el único de los tres con efecto externo irreversible**, y postergarlo no bloquea a los otros dos.
6. **¿Confirmás abrir en ADR 243-246 y RD-118/119/120**, el orden (último de la serie) y `v3.16.0` como número?
