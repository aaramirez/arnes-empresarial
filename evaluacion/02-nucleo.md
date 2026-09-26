# Análisis técnico de `src/core/`

Metodología: lectura directa de los 52 archivos fuente no-test de `src/core/` en sus 17 submódulos, más inspección de tests como documentación de contrato. Se verificó con `grep` la regla "`src/core/` nunca importa de `src/adapters/*`": **cero ocurrencias reales de import hacia `adapters/`** en todo el árbol — todas las coincidencias de la búsqueda son referencias en comentarios/doc-strings que documentan la regla, no imports de código. La única relajación documentada es el `import type` de tipos del SDK de Anthropic (`@anthropic-ai/claude-agent-sdk`) en `agents/subagents.ts`, `turn-selector/invoke-model.ts` y `turn-selector/handle-turn.ts` — legítimo porque la regla del repo prohíbe importar de `src/adapters/*` (carpeta propia), no de paquetes npm de terceros, y son tipos erasados en compilación.

## Arquitectura general del núcleo

Patrón repetido en casi todos los módulos de negocio:

- Un `*-contract.ts` (sin imports, o con un único import a otro contrato del núcleo) que declara vocabulario canónico de estado, entidades y puertos (`*StorePort`), síncronos porque `better-sqlite3` lo es.
- Casos de uso (`crear-*`, `resolver-*`, `confirmar-*`, `procesar-*`) que reciben dependencias por parámetro (`deps`), nunca importan adaptadores, y son función pura cuando es posible.
- Inyección de dependencias uniforme: `newId`, `now`, `logEvent` inyectados en casi todo — tests deterministas sin mocks de reloj/UUID.
- Mecanismo de **CAS (compare-and-swap)** vía `UPDATE ... WHERE estado = ... RETURNING` para toda transición de estado concurrente: el núcleo nunca implementa su propia lógica de carrera, solo interpreta `undefined` como "no aplicó".
- HITL (human-in-the-loop) generalizado desde `hitl-contract.ts` (`ResolucionHitlResult<TItem, TAccion, TEstadoFinal>`), reusado por ventas, solicitudes y propuestas.

## `src/core/turn-selector/` — el corazón del sistema

Flujo de un turno de principio a fin (`handle-turn.ts` compone todo):

1. **`resolve-turn.ts`** — `resolveTurn(prompt, candidates)`: hoy trivial (un solo agente registrado, sin ruteo por contenido), toma `candidates[0]`. Lanza `NoAgentAvailableError` si la lista está vacía (estructuralmente inalcanzable en producción tras `bootstrapHarness`).
2. **`assemble-context.ts`** — `assembleContext(memory, casoId, agentId)`: resuelve el `caso` y la sesión SDK a retomar (`resumeSessionId`), vía `MemoryContextPort` inyectado (nunca importa `repository.ts` directo). Lanza `CasoNotResolvedError` si el caso no existe — este módulo nunca crea un caso, solo lee. `resumeSessionId: undefined` cuando el agente nunca participó de ese caso: aísla el contexto por agente dentro del mismo caso (base del Escenario de calidad 2 del arc42).
3. **`invoke-model.ts`** — mapea `AgentDefinition` + contexto a `Options` del SDK (`toQueryOptions`). Dos "fixes de seguridad post-review" documentados directamente en el código:
   - **Fix crítico**: la restricción real de tools es `options.agents[id].tools`, **no** `options.allowedTools` (ese campo solo auto-aprueba, no restringe) — un bug temprano habría dejado el toolset completo del SDK disponible.
   - **Fix 2**: `result/success` con `is_error: true` se trata como fallo — evita persistir un texto de error de API como si fuera una respuesta real.
   - `settingSources: ["project"]` siempre — el turno nunca hereda config de `~/.claude/` del operador. Nota de honestidad explícita en el propio código: `options.skills` es "filtro de contexto, no sandbox" y `options.cwd` es "anclaje de resolución, no aislamiento de proceso".
4. **`close-turn.ts`** — escribe `updateCaso` + siempre-INSERT (nunca UPDATE) en `sesiones_agente`, historial acumulativo. Las dos escrituras **no son transaccionales** (el core no tiene handle de `Database`) — límite reconocido, no oculto.
5. **`dispatch-delegation.ts`** — delegación in-process: crea la fila `delegaciones` **antes** de invocar (trazabilidad ante fallo) y la completa después. `despacharCadena` (usado por Planner→Developer→Reviewer) hace fold secuencial: `material` del paso N+1 es el `resultado` (texto) del paso N, nunca su sesión completa.
6. **`dispatch-delegation-a2a.ts`** — hermana externa: **síncrona por turno** (sin cola ni estado `pendiente_a2a`), nunca fabrica un estado falso cuando el transporte falla antes de cualquier respuesta real.

## `src/core/agents/` — registro de agentes y control de seguridad

`AGENT_REGISTRY` (agentes de primer nivel) y `SUBAGENT_REGISTRY` (delegables) son **dos `Map` deliberadamente separados**, no una fusión con flag `delegable: boolean` — para que la resolución de turno nunca dependa del orden de inserción de subagentes.

| Rol | `allowedTools` | Responsabilidad |
| --- | --- | --- |
| `agente-conversacional` | tool de conocimiento + `Skill` | Conversación general con empleado |
| `planner` | `Read`, `Glob` | Plan de revisión de PR, no emite veredicto |
| `developer` | `Read`, `Glob`, `Grep` (o `+Write/Edit` en worktree) | Rastrea impacto / escribe código en worktree aislado |
| `reviewer` | `Read` | Único que emite `VEREDICTO:` |
| `validador-solicitudes` | ninguna (`[]`) | Dictamina sobre solicitud interna, no aprueba/rechaza |

Ninguno de los cuatro subagentes tiene `Agent`/`Task` en su toolset → **estructuralmente imposible que un subagente delegue a su vez** (un solo nivel de profundidad de delegación). `construirDeveloperConEscritura(worktree)` es la única función de todo el repo que agrega `"Write"`/`"Edit"` — siempre como **par indivisible** junto al `cwd` de un `WorktreeAbierto` ya abierto (no acepta un `string` a mano), sin mutar el registro original.

`subagents.ts` acota la tarea delegada a un tope duro (`TAREA_DELEGADA_MAX_CHARS = 8000`) — `InsumoDelegado.material` es siempre texto plano, nunca puede colarse una sesión completa. `a2a-contract.ts` define el vocabulario A2A; `ClienteA2APort.delegar` **nunca rechaza** (el desenlace viaja tipado en `ResultadoA2A`). `a2a-entrante-prompt.ts` declara textualmente en el prompt del subagente la limitación "no podés delegar a otro agente" — garantía de seguridad expresada como instrucción, no solo como ausencia de tool.

**Decisión de seguridad clave**: listar una tool en `allowedTools` la auto-aprueba — no hay HITL por-llamada. El registro de agentes es, por diseño, el punto único de control de seguridad de todo el arnés.

## `src/core/ventas/` — el dominio de negocio más grande

Máquina de estados (seis estados, `TEXT` abierto sin `CHECK` en SQLite — el vocabulario vive en el núcleo, no en SQL):

```
pendiente_confirmacion → { confirmada | rechazada }
confirmada             → { reembolsada | reembolso_pendiente }
reembolso_pendiente    → { reembolsada | reembolso_rechazado }
reembolso_rechazado    → reembolso_pendiente   (reapertura)
```

Todas las transiciones son CAS vía `UPDATE ... WHERE estado = ...`. Piezas notables:

- `token-confirmacion.ts`: tres guardas (inexistente / estado inválido / vencido) que producen una respuesta **indistinguible** hacia afuera — un token vencido y uno inexistente no se pueden diferenciar por la respuesta.
- `comision.ts`: `periodoDeConfirmacion` usa `.slice(0,7)` sobre ISO-8601 UTC en vez de `Date.getMonth()`, para que la zona horaria de la máquina no cambie el mes de una venta confirmada cerca de medianoche.
- `reembolso.ts`: `evaluarReembolso` — el borde exacto es `>=` (no `>`): `monto === umbral` **escala** a un humano en vez de aprobarse sola. Documentado como "el único lugar del hito donde un `<=` en vez de un `<` cambia una decisión de plata".
- `registrar-venta.ts`: el único `await` del camino determinista es la notificación al cliente, después de que cierra la transacción — la razón literal por la que este flujo no necesita cola de concurrencia. Dispara fire-and-forget una consulta de riesgo/crédito A2A para ventas grandes (`monto >= ventaGrandeUmbral`), nunca bloqueante.
- `resolver-escalacion-reembolso.ts`: usa el tipo `SesionEmpleado` (no un `string empleadoId` suelto) para que el invariante "el llamador ya fue autenticado" quede expresado en el tipo, no en un comentario.

## `src/core/propuestas/` y `src/core/solicitudes/` — HITL

**`propuestas/`** gobierna el ciclo de vida de un patch de código generado por el Developer en worktree aislado: tres estados (`pendiente`/`aplicada`/`descartada` — deliberadamente no cuatro; un conflicto de `git apply --check` deja la fila intacta en `pendiente`). `PATCH_MAX_BYTES = 65 536` es tope de **rechazo**, no de truncado (un patch truncado sería inaplicable). `crear-propuesta-cambio.ts` corrige un bug real documentado en el propio código: persistir el patch con `trim()` en vez del original le comía el `\n` final que `git diff` siempre agrega, volviendo el patch inaplicable — "bloqueaba toda propuesta creada por el pipeline real", encontrado en verificación manual.

**`solicitudes/`** (vacaciones, gasto): delega al subagente `validador-solicitudes` con `material` = exclusivamente tipo + detalle (nunca `solicitanteId` ni historial). Degradación de fallo documentada: si la delegación al validador falla, la solicitud ya creada **no se revierte** — el efecto de negocio ya ocurrió, se degrada a un evento de log. `resolver-solicitud-interna.ts` chequea "dueño" para la acción `cancelar` (autoservicio) con un `switch` exhaustivo y guarda `never`, para que un cuarto valor futuro de `AccionSolicitud` sea un error de compilación, no un fallthrough silencioso.

## Mecanismos transversales

- **`hitl-contract.ts`**: un solo archivo, sin imports, con el vocabulario compartido de HITL reusado por ventas/propuestas/solicitudes.
- **`hooks/hook-engine.ts`**: motor de hooks in-process desacoplado a propósito del sistema nativo de hooks del SDK; ejecución secuencial, el primer error corta la cadena (política mínima, deliberada).
- **`skills/`**: única frontera de I/O real de todo `src/core/`, aislada e inyectable (`DescubrirSkillsDeps`). Valida `frontmatter.name === directorio`, ordena resultados alfabéticamente (nunca el orden del filesystem) y **memoiza** el escaneo exitoso a nivel de proceso — el mismo escaneo que valida el arranque es el que consume el primer turno, evitando dos lecturas divergentes.
- **`auth/login.ts`**: mitigación explícita de **timing attack** — si el `empleadoId` no existe, igual corre `verificarPassword` contra un hash dummy (generado con la misma función real, mismos parámetros de costo) e ignora el resultado, para no filtrar por latencia si una cuenta existe. Trade-off documentado: habilita a un atacante sin credenciales forzar trabajo de CPU sostenido, a cambio de cerrar la enumeración de usuarios — sin rate-limiting en el repo.
- **`commands/comando-empleado.ts`**: parser puro de 18 comandos, sin I/O ni reloj. `esComandoPrivilegiado(tipo)` es la única fuente de verdad de qué comandos exigen sesión — un comando nuevo marcado `privilegiado: true` queda protegido automáticamente.
- **`concurrency/keyed-queue.ts`**: cola de serialización por clave, con cuatro garantías testeadas (orden, aislamiento por clave, no contagio de un rechazo, sin fuga de memoria — el borrado de una entrada del `Map` es condicional por identidad para no romper una tarea encolada justo cuando la anterior termina).
- **`logging/turn-logger.ts`**: escribe a archivo (`data/harness.log`), no a `console.log` — corrección documentada de dos rondas: la primera versión a stdout corrompía el renderizado de Ink; mover a stderr tampoco alcanzó, porque una terminal real intercala ambos streams.

## Observaciones para la evaluación

1. **Disciplina hexagonal real, no solo declarativa** — verificada por grep, no solo por lectura del README.
2. **Seguridad como invariante de tipo, no de disciplina** — `SesionEmpleado` en vez de `string`, construcción del Developer con escritura como par indivisible, subagentes sin `Agent`/`Task` en su toolset.
3. **Toda concurrencia de estado se resuelve en el store vía CAS**; el único mecanismo de concurrencia explícito del núcleo (`KeyedQueue`) sirve para serializar I/O, no transiciones de negocio.
4. **Distinción consistente de puertos** "nunca rechaza" (tablero, notificador, feedback de conocimiento, cliente A2A) vs. "falla ruidosamente" (los `*StorePort`) — documentada en cada contrato, refleja qué efectos son cosméticos vs. canónicos.
5. **Trazabilidad de decisiones**: casi todos los archivos citan un ADR o un hallazgo de code-review concreto para justificar una decisión no obvia — señal de un proceso de revisión activo con bugs reales corregidos, no solo comentarios aspiracionales.


## Actualización 2026-09-25

*(Lo anterior describe `v3.4.0`. Detalle completo en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md).)*

`src/core/` pasó de **20 291 líneas / 108 archivos / 17 módulos** a **32 297 / 152 / 20** (+12 006 líneas). Dónde creció:

| Módulo | v3.4.0 | v3.21.0 | Δ | Por qué |
| --- | ---: | ---: | ---: | --- |
| `operaciones/` | — | 5 899 | **+5 899** | Nuevo (v3.6). Contrato, validador y `ejecutar-operacion.ts`, que despacha las 13 operaciones |
| `agents/` | 1 994 | 4 081 | +2 087 | Tool de consultas de negocio (v3.8), catálogo de KPIs (v3.16), textos A2A y marco de texto externo (v3.15), prompts extendidos |
| `ventas/` | 4 232 | 6 050 | +1 818 | Devolución sin token con dos personas (v3.12), consulta de venta propia, reporte neto de reembolsos (v3.21) |
| `solicitudes/` | 1 507 | 2 165 | +658 | Consulta de solicitud propia (v3.14), puerto de consulta para A2A |
| `commands/` | 1 349 | 1 875 | +526 | Gate `requiereAdministrador` (v3.7), enmascarado de secretos (v3.20) |
| `auth/` | 615 | 1 115 | +500 | Roles y política de autorización (v3.5) |
| `hooks/` | 223 | 457 | +234 | Handlers reales PRE_TURN/POST_TURN (`ce5d7b8`, fuera del ciclo SDD) |
| `turn-selector/` | 4 098 | 4 167 | +69 | Prácticamente estable: la tubería del turno no cambió de forma |

**Lectura:** el crecimiento no está en el motor de orquestación (`turn-selector/` queda casi igual), sino en el **dominio y la política**: qué puede hacer cada empleado, con qué confirmación y con qué auditoría. Es la señal de que la tubería diseñada en v1/v2 soportó 17 hitos de funcionalidad sin cambiar de forma.

**Alerta nueva:** `core/agents` ya no es solo el registro de agentes. También aloja lógica de consultas de negocio (`consultas-negocio-tool.ts`, que importa de `ventas/`, `solicitudes/` y `actividad/`), y `core/operaciones` importa 6 archivos de `agents/`. El resultado son **dependencias circulares a nivel módulo** que no existían en v3.4.0 (`agents ↔ operaciones`, `agents ↔ solicitudes`). Ver la actualización de `07-mapa-modulos.md`.

**Reglas de negocio nuevas destacables:**

- Autoaprobación prohibida, incluso para un administrador (v3.5; en reembolsos, desde v3.10).
- Separación de funciones en las devoluciones sin token: el vendedor inicia y otro administrador cierra (v3.12).
- Gate de propiedad en el núcleo para las consultas propias (v3.14).
- Reporte de comisiones neto de reembolsos, derivado al leer y sin tocar la tabla `comisiones` (v3.21).
