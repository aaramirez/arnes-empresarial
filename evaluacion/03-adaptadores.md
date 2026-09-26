# Análisis técnico de `src/adapters/`

Regla estructural verificada en todo el árbol: **ningún adaptador importa de otro adaptador**; toda comunicación cruzada pasa por `src/core/`. Esto explica la duplicación deliberada de pequeños helpers (parseo de env vars, `truncate`, patrones de `FetchFn`) entre adaptadores — deuda aceptada a cambio de desacoplamiento real, no descuido.

## 1. `src/adapters/a2a/` — protocolo A2A (JSON-RPC saliente y entrante)

El módulo más grande del repo (5760 líneas). Implementa ambos lados del protocolo A2A v1.0.0 sobre JSON-RPC 2.0/HTTP.

- **`client.ts`** — `delegarTarea`: **nunca rechaza** (todo desenlace es un `ResultadoA2A` tipado). Secuencia: `GET /.well-known/agent-card.json` → extrae endpoint JSON-RPC exigiendo `protocolBinding === "JSONRPC"` → `SendMessage` → loop de `GetTask` a intervalo fijo hasta estado terminal o timeout → `CancelTask` best-effort. Envía siempre el header `A2A-Version: 1.0`, no exigido por el `.proto` pero sí por el SDK Python de referencia — verificado con `curl` real y documentado como bug encontrado en verificación manual.
- **`server.ts` / `server-config.ts`** — servidor entrante: `GET /.well-known/agent-card.json` público y `POST /a2a` con Bearer. Implementa `SendMessage`/`GetTask`/`CancelTask` con los códigos de error propios de la especificación (`TaskNotFoundError = -32001`, etc., verificados contra la spec real del tag v1.0.0). `GetTask`/`CancelTask` son **síncronos por firma** — un `await` ahí sería error de compilación, no de criterio.
- **`agent-card.ts`** — agent card con una sola skill real (`consulta-arnes`, tag `solo-lectura`).
- **Config notable**: si `pollIntervalMs >= taskTimeoutMs`, ambos caen a su default — porque el loop solo chequea el deadline al inicio de cada iteración, esa combinación haría que el timeout efectivo quedara gobernado por el intervalo de poll.

| Variable | Default | Nota |
| --- | --- | --- |
| `HARNESS_A2A_SALIENTE` | apagado | opt-in real: solo `"on"` activa el cliente |
| `HARNESS_A2A_ENTRANTE_TOKEN` | `""` (deshabilitado) | único gate del servidor entrante |
| `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO` | `4` | tope de turnos concurrentes; excedido ⇒ `REJECTED` |

**Seguridad**: Bearer comparado con `timingSafeEqual` con chequeo de longitud previo. El protocolo A2A v1.0.0 no transporta identidad del emisor — `agente_externo_url` queda `NULL`, la única evidencia es `origen_transporte` (IP de socket), nunca tratada como identidad verificada.

## 2. `src/adapters/memory/` — persistencia SQLite

`db.ts` activa `foreign_keys = ON` y `journal_mode = WAL`. Las 12 migraciones:

| # | Propósito | Tablas/índices |
| --- | --- | --- |
| 0001 | Correlación caso↔sesión SDK (sin duplicar historial conversacional) | `casos`, `sesiones_agente` |
| 0002 | Índice compuesto para el patrón real de acceso | `idx_sesiones_caso_agente` |
| 0003 | Actividades de PR review ligadas a casos | `proyectos`, `responsables`, `actividades` |
| 0004 | Ventas y comisiones; `expires_at` nullable para TTL del link | `vendedores`, `ventas`, `comisiones` |
| 0005 | Auditoría append-only de acciones de empleado, **sin FK** a credenciales a propósito | `registro_acciones_empleado` |
| 0006 | Credenciales (hash scrypt autodescriptivo) | `credenciales_empleado` |
| 0007 | Delegaciones a subagentes, columnas nullable (fila se escribe antes de invocar) | `delegaciones` |
| 0008 | Solicitudes internas, `UNIQUE(caso_id)` hace estructural 1 solicitud↔1 caso | `solicitudes_internas` |
| 0009 | Propuestas de cambio HITL | `propuestas_cambio` |
| 0010 | Delegaciones A2A salientes | `delegaciones_a2a` |
| 0011 | Solicitudes A2A entrantes (dirección opuesta a 0010, sin FK entre ambas) | `solicitudes_a2a_entrantes` |
| 0012 | Índice sobre `estado` para `/ver-solicitudes-a2a` | `idx_solicitudes_a2a_entrantes_estado` |

Convención transversal: todos los campos `estado`/`tipo` son `TEXT` **sin `CHECK`** — el vocabulario canónico vive en el núcleo, nunca en SQL. `repository.ts` (2794 líneas) mapea ~50 funciones exportadas 1:1 sobre estas tablas.

## 3. `src/adapters/git/` — worktrees aislados para escritura delegada

`git-cli.ts` define **diez constructores de argv nombrados**, sin `git(args)` genérico — estructuralmente imposible ejecutar `commit`/`push`/`remote`/`tag` porque no hay parámetro por el que inyectar un subcomando arbitrario. `worktree.ts`: `abrirWorktree` (`worktree add -b <rama> <ruta> HEAD`), `capturarDiff` (nunca toca el índice del checkout real — el worktree tiene el suyo), `cerrarWorktree` **nunca rechaza** (llamado desde `finally`). `barrido.ts` reclama worktrees huérfanos por TTL con doble filtro (ruta + prefijo de rama) para nunca tocar el checkout principal; corrige un bug real de Windows (`git worktree list --porcelain` siempre usa `/`, `resolve()` de Node usa `\` — sin normalizar, el barrido queda silenciosamente noop en Windows).

Config: `HARNESS_GIT_BIN`, `HARNESS_GIT_TIMEOUT_MS` (30s), `HARNESS_WORKTREE_ROOT` (`.harness/worktrees`), `HARNESS_WORKTREE_TTL_MS` (2h).

## 4. `src/adapters/web/` — confirmación de venta por link único

Cuatro rutas: `POST /ventas` (auth), `GET|POST /confirmar/:token` (público), `POST /devolucion`, `POST /soporte`. `render.ts` produce **una sola página genérica** para token inexistente/vencido/ya procesado/decisión inválida — principio anti-oráculo: un atacante no puede distinguir estos casos por la respuesta. `/soporte` corre en `Promise.race` contra un timeout de 120s, con el turno real trackeado para el drenaje al cerrar. Headers de respuesta incluyen `Cache-Control: no-store` y `Referrer-Policy: no-referrer` — el link de confirmación no debe filtrarse ni cachearse.

Config: `WEB_PORT` (`0` = deshabilitado — el gate acá es el puerto, no un token), `VENTAS_API_TOKEN` (`""` ⇒ `/ventas` siempre 401).

## 5. `src/adapters/webhooks/` — ingesta de eventos GitHub

`signature.ts`: verificación HMAC-SHA256 que rechaza (nunca lanza) si el header falta o difiere en longitud **antes** de `timingSafeEqual` (que lanza con buffers de largo distinto). `github-mapper.ts` incluye un **filtro anti-loop real**: cuando el bot comenta un PR, GitHub reenvía ese comentario como evento — sin filtrar por `comment.user.login === botLogin` el proceso reprocesaría su propio eco infinitamente (bug real detectado en verificación end-to-end del Hito 3). El `ack` (202) se emite antes de invocar el handler real, que corre en background.

Config: `GITHUB_WEBHOOK_SECRET` (`""` = deshabilitado, único gate), `WEBHOOK_MAX_BODY_BYTES` (1 MiB).

## 6. `src/adapters/board/` — tablero sobre GitHub Issues

`labels.ts`: `mergeLabels` reemplaza únicamente los cuatro labels administrados por el arnés (`necesita-revision`/`observaciones-pendientes`/`resuelto`/`aprobado`), preservando cualquier label manual del equipo. `index.ts`: try/catch total en los tres métodos del puerto — ningún error de GitHub cruza la frontera. Sin `GITHUB_TOKEN`, degrada a un adaptador no-op que loguea y sigue, sin bloquear el turno.

## 7. `src/adapters/knowledge/` — servidor MCP propio que envuelve la CLI de Graphify

`graphify-cli.ts` documenta una decisión corregida por evidencia empírica: una versión anterior agregaba `--` para blindar preguntas que empiezan con `-`, pero se retiró tras verificar contra el binario real que `--` rompe todas las consultas (se filtra a la pregunta enviada). `knowledge-tool.ts` **nunca lanza ni rechaza**: cualquier falla de la CLI se traduce a texto degradado explícito ("NO HAY CONOCIMIENTO DISPONIBLE"), nunca a una respuesta inventada. El servidor MCP in-process comparte un único `CitedNodesRecorder` por clausura entre la tool de consulta y el feedback de cierre de turno — la coordinación es la variable de clausura compartida, sin otro mecanismo.

## 8. `src/adapters/test-runner/` — el Developer corre su propia suite

Tool única `mcp__worktree__run_tests`, expuesta solo al Developer en worktree. Ejecuta `execFile(process.execPath, [vitestEntrypoint, "run", ...])` — nunca `npm`/shell (en Windows `npm` es `npm.cmd` y Node ≥20 rechaza lanzarlo sin shell). Corrección documentada post-integración: el diseño original pedía `--reporter=basic`, inexistente en Vitest 4.x — descubierto solo por el test de integración real, nunca por los tests unitarios con `execFile` fake. La tool no acepta parámetros: siempre corre la suite completa, decisión deliberada para que el Developer no pueda "elegir" qué tests correr. Cero contacto con `src/adapters/git/` — solo el composition root conoce ambos.

## 9. `src/adapters/tui/` — interfaz Ink

Historial acumulado en `<Static>` de Ink (scrollback real del terminal, no un buffer artificial). `start-tui.tsx` abandona deliberadamente el buffer alterno de pantalla porque rompía el scrollback nativo que `<Static>` necesita — trade-off documentado y confirmado con el usuario.

## 10. `src/adapters/notificaciones/` — email transaccional

Sin `EMAIL_API_KEY`, degrada a un notificador no-op que **loguea el link completo de confirmación** en el evento `email-omitido` — consecuencia documentada y aceptada de que el log de texto contenga links válidos cuando el notificador está apagado, para que la demo funcione sin cuentas externas. El email del cliente (PII) nunca se loguea.

## 11. `src/adapters/crypto/` — hashing de contraseñas

`password.ts`: scrypt con formato autodescriptivo `scrypt$N$r$p$salt$clave`. `verificarPassword` nunca lanza: valida estructura, exige `128*N*r <= 64 MiB` (guarda anti-DoS contra un hash con `N` gigante escrito a mano), y compara con `timingSafeEqual`.

## 12. `src/adapters/shared/exec-file-policy.ts`

Única función compartida entre los tres adaptadores que invocan CLIs (`git`, `test-runner`, `knowledge`): fija `execFile` (nunca shell), `maxBuffer: 10 MiB` y `windowsHide: true`. Es la única excepción documentada a la regla de no compartir código entre adaptadores, por ser infraestructura de proceso, no lógica de dominio.

## Patrones transversales observados

1. **Gate por configuración, nunca excepción de arranque** — todo adaptador de red opcional se apaga silenciosamente ante ausencia del secreto/token, logueando un evento `*-deshabilitado`.
2. **Auth Bearer uniforme** (A2A, Web, HMAC en Webhooks): `timingSafeEqual` con chequeo de longitud previo, `token === ""` siempre rechazo directo — nunca "abierto por defecto".
3. **Servidores HTTP con drenaje al cerrar** (`web`, `webhooks`, `a2a` entrante): `Set` de promesas en vuelo, `close()` en carrera contra un timeout fijo, nunca rechaza.
4. **Nunca lanzar en la frontera de un puerto** — `board`, `notificaciones`, `knowledge`, `test-runner` traducen toda I/O externa fallida a un resultado degradado.
5. **Hallazgos de integración real, no solo unitarios**: al menos tres bugs documentados en el código fueron encontrados únicamente corriendo contra binarios/servicios reales — separadores de ruta de `git` en Windows, el reporter `"basic"` inexistente en Vitest 4.x, el `--` que rompe `graphify query` — evidencia de una capa de tests de integración real, además de los unitarios con dobles.


## Actualización 2026-09-25

*(Lo anterior describe `v3.4.0`. Detalle completo en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md).)*

`src/adapters/` pasó de **28 566 líneas / 109 archivos** (recalculado con el mismo script) a **38 034 / 137** (+9 468).

| Adaptador | v3.4.0 | v3.21.0 | Δ | Qué cambió |
| --- | ---: | ---: | ---: | --- |
| `web/` | 2 890 | 7 356 | **+4 466** | Chat del empleado (JS vanilla, CSP, sin `innerHTML`), login/logout HTTP, stores de sesión, conversación y confirmación |
| `ops/` | — | 1 618 | +1 618 | **Nuevo** (v3.18): liveness/readiness, con test de arquitectura que prohíbe importar de otro adaptador |
| `memory/` | 7 869 | 9 104 | +1 235 | Migraciones `0013_roles_empleado` y `0014_justificaciones_devolucion`, y lecturas nuevas del repositorio |
| `operaciones/` | — | 937 | +937 | **Nuevo** (v3.6): tool MCP `operacion_negocio` |
| `a2a/` | 5 760 | 6 176 | +416 | Configuración con timeouts acotados para el canal conversacional (v3.16), host configurable (v3.17) |
| `webhooks/` | 2 180 | 2 473 | +293 | Host configurable y `closeIdleConnections` en el cierre (v3.17) |
| `consultas/` | — | 270 | +270 | **Nuevo** (v3.8): tool MCP de lecturas para A2A entrante |
| `tui/` | 2 308 | 2 541 | +233 | Enmascarado de la clave (v3.20); primera importación de `core/` (`core/commands`) |
| `board/`, `git/`, `knowledge/`, `test-runner/`, `notificaciones/`, `crypto/`, `shared/` | — | — | 0 | Sin cambios de tamaño |

**Patrones transversales nuevos:**

- **Todos los listeners HTTP** (web, webhooks, A2A entrante y ops) aceptan host configurable (`WEB_HOST`, `WEBHOOK_HOST`, `HARNESS_A2A_ENTRANTE_HOST`, `OPS_HOST`) y se cierran de forma ordenada dentro de un presupuesto (`HARNESS_SHUTDOWN_TIMEOUT_MS`, 70 s por defecto).
- **Test de arquitectura como candado**: `adapters/ops/arquitectura.test.ts` verifica por estructura que el adaptador no importe de otro adaptador ni haga I/O externa. Es la primera vez que la regla hexagonal se *ejecuta* como test en lugar de solo auditarse por grep.
- **Superficie HTTP nueva sin autenticación**: el endpoint `ops` no tiene autenticación por diseño (es de salud). Viene apagado por defecto, pero si se activa conviene exponerlo solo en red interna.
