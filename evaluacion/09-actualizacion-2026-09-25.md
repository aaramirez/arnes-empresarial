# Actualización 2026-09-25 — qué cambió desde la evaluación del 2026-09-12

Segunda pasada del mismo estudio independiente. **No reemplaza** a los documentos `00`–`08`: esos siguen describiendo el repo tal como estaba en `v3.4.0` (351 commits) y se conservan intactos; cada uno recibió al final una sección *"Actualización 2026-09-25"* que remite acá. Este documento concentra el **delta**: los 17 hitos nuevos (`v3.5.0` → `v3.21.0`), los números que se movieron, y qué conclusiones de la primera evaluación se sostienen, cuáles se corrigieron y cuáles empeoraron.

Método idéntico al de la primera pasada, para que las cifras sean comparables: `git log`/`git tag`, `git archive` de `v3.4.0` y de `HEAD` (`49602b4`, merge del PR #35), conteo de líneas con `wc -l` sobre `.ts`/`.tsx` de `src/`, y un grafo de imports relativos extraído mecánicamente de los archivos de producción. La línea base de `v3.4.0` se **recalculó** con el mismo script en vez de copiar los números viejos (ver nota de método al final).

## 1. En una línea

En 13 días (12 → 25 de septiembre) el repo **duplicó sus commits** (351 → 755), sumó **17 hitos tageados** (12 → 29 tags) y ~31 000 líneas de TypeScript, y giró de *"construir el motor"* a *"operar el negocio por conversación y preparar el despliegue"*: roles y separación de funciones, una tool única de operaciones de negocio usada desde web y TUI, chat web del empleado, CI, modo headless, cierre ordenado y endpoints de salud. La regla hexagonal sigue intacta (**0 aristas `core → adapters` en 166 archivos**). El rigor de *verificación* subió (pruebas de mutación, matrices criterio→evidencia, primera captura de pantalla), pero la *trazabilidad documental* se degradó en puntos concretos: dos hitos sin artefactos `openspec/` versionados, el plan maestro sin tocar desde el 11/09, y colisiones de numeración de ADRs.

## 2. Tablero comparativo

| Métrica | 2026-09-12 (`v3.4.0`) | 2026-09-25 (`v3.21.0`) | Δ |
| --- | ---: | ---: | ---: |
| Commits | 351 | 755 | **+404** (+115 %) |
| Tags semánticos | 12 | 29 | **+17** |
| Días de calendario | 17 | 31 | +14 |
| PRs mergeados a `main` (merges) | 13 | 35 | +22 |
| Líneas `.ts/.tsx` en `src/` (total, incl. tests y raíz) | 60 112 | 91 345 | **+31 233** (+52 %) |
| — `src/core/` | 20 291 (108 archivos) | 32 297 (152) | +12 006 |
| — `src/adapters/` | 28 566 (109) | 38 034 (137) | +9 468 |
| — raíz de `src/` (composition roots, CLIs, integración) | 11 255 (25) | 21 014 (42) | +9 759 |
| Archivos de producción / de test | 126 / 116 | 167 / 164 | +41 / +48 |
| Bloques `it()`/`test()` | 1 691 | 2 728 | **+1 037** |
| Bloques `describe()` | 471 | 759 | +288 |
| Módulos de `core/` | 17 | 20 | +3 (`operaciones`, `conversacion`, `actividad`) |
| Adaptadores | 12 carpetas | 15 carpetas | +3 (`operaciones`, `consultas`, `ops`) |
| Migraciones SQLite | 12 | 14 | +2 (`0013_roles_empleado`, `0014_justificaciones_devolucion`) |
| Skills en `.claude/skills/` | 1 | 14 | **+13** |
| Aristas del grafo de módulos | 112 | 168 | +56 |
| Aristas `core → adapters` | 0 | **0** | = |
| `docs/ARC42_Harness_Empresarial.md` | 691 líneas | 1 023 líneas | +332 |
| `docs/Plan_Implementacion_Harness_Empresarial.md` | 419 líneas | 419 líneas | **sin cambios** |
| ADR más alto citado | ~144 | 302 | ~158 números consumidos |
| CI | no existía | `.github/workflows/ci.yml` | nuevo |

## 3. Los 17 hitos nuevos

| Tag | Fecha | Hito | Commits | Qué agregó (resumen) |
| --- | --- | --- | ---: | --- |
| `v3.5.0` | 09-13 | autorización de empleado | 18 | Roles `empleado`/`administrador`; resolver lo ajeno exige admin; autoaprobación prohibida; migración `0013` |
| `v3.6.0` | 09-13 | operaciones conversacionales | 21 | Tool MCP `operacion_negocio` (6 operaciones) sobre HTTP autenticado, `POST /login`, confirmación en dos pasos, 6 skills; se retiran comandos TUI |
| `v3.7.0` | 09-13 | comandos de administración | 16 | `/crear-empleado`, `/asignar-rol` con gate `requiereAdministrador`; `/estado-bot-prs` |
| `v3.8.0` | 09-14 | consultas de negocio A2A entrante | 18 | Tool `consultar_negocio` (4 lecturas) para agentes externos, con recorte de datos personales |
| `v3.9.0` | 09-15 | chat web del empleado | 19 | `GET /chat` en JS vanilla con CSP y sin `innerHTML`, memoria conversacional, logout real |
| `v3.10.0` | 09-16 | aprobación conversacional HITL | 38 | Aprobar/rechazar/reabrir por conversación; cierra la autoaprobación de reembolsos (R7); baja de 5 comandos TUI; **CI** |
| `v3.11.0` | 09-17 | ergonomía del canal | 6 | Eco de venta con nombres; turnos de chat con autor y hora |
| `v3.12.0` | 09-19 | devolución sin token, dos personas | 33 | El vendedor inicia, otro administrador cierra (separación de funciones); `consultar_venta`; expiración de sesión por inactividad; migración `0014`; `.env.example` |
| `v3.13.0` | 09-19 | conocimiento en el chat | 12 | El chat web consulta la base de conocimiento vía MCP |
| `v3.14.0` | 09-20 | consulta de solicitud propia | 23 | `consultar_solicitud` de solo lectura, con gate de propiedad en el núcleo |
| `v3.15.0` | 09-20 | visibilidad A2A entrante en chat | 29 | `ver_solicitudes_a2a`; **marco para texto externo** (escape del delimitador + truncado) contra inyección de prompt |
| `v3.16.0` | 09-21 | consulta de KPIs A2A desde el chat | 27 | A2A saliente desde el chat con catálogo cerrado de 4 consultas, solo administrador, timeouts acotados |
| `v3.17.0` | 09-21 | modo headless y cierre limpio | 45 | `HARNESS_HEADLESS`, cierre ordenado con presupuesto y watchdog, build de producción + `npm start`, `HARNESS_DB_PATH`, host configurable en los listeners |
| `v3.18.0` | 09-22 | salud operativa | 35 | Cuarto listener `ops`: liveness y readiness con política pura `evaluarReadiness` (apagado por defecto) |
| `v3.19.0` | 09-23 | operaciones de negocio en la TUI | 23 | El texto libre de la TUI usa el mismo handler de operaciones que la web |
| `v3.20.0` | 09-24 | enmascarar clave en la TUI | 19 | `/login` y `/crear-empleado` no muestran ni guardan la clave en el historial |
| `v3.21.0` | 09-25 | reembolso neto en reporte | 22 | "Monto vendido" y "Total comisionado" netos de ventas reembolsadas (ADR 301/302) |

Todos los tags son de un único autor (`JimmyFung123`). Los dos únicos commits de otra persona en todo el historial son los de esta propia evaluación (`f3c2a2e` y el merge del PR #16).

**El giro de alcance, en tres fases:**

1. **v3.5–v3.10: gobierno y operación por conversación.** Los comandos slash de la TUI se reemplazan por una única tool MCP de operaciones (`core/operaciones/`, que crece de 0 a **5 899 líneas**, el módulo más grande del núcleo), invocada desde el chat web y, desde v3.19, también desde la TUI. Aparecen roles y reglas de separación de funciones.
2. **v3.11–v3.16: superficie del chat.** Cada hito agrega una operación (el contrato pasa de 6 a 13 operaciones) con su skill. Es la fase de hitos chicos y parejos.
3. **v3.17–v3.18: preparación para operar.** Primer trabajo de infraestructura real: proceso sin TUI, cierre ordenado, build de producción, healthchecks. Son también los dos hitos más grandes del período (45 y 35 commits).

## 4. Qué conclusiones de la primera evaluación cambiaron

### Corregidas o mejoradas (la evaluación anterior quedó desactualizada)

| Hallazgo del 2026-09-12 | Estado hoy | Evidencia |
| --- | --- | --- |
| *"Sin CI/CD"* (`08`, §9) | **Corregido parcialmente**: CI con typecheck + test + build en cada push/PR a `main` | `.github/workflows/ci.yml`, commit `af387e8` (2026-09-15) |
| *"Sin script de `start` de producción; se corre `tsx src/main.ts` a mano"* | **Corregido**: `npm run build` → `npm start` sobre `dist/` | `package.json`, `tsconfig.build.json` (v3.17) |
| *"Sin healthcheck"* | **Corregido**: liveness y readiness en `adapters/ops/` | v3.18; apagado por defecto (`OPS_PORT`) y **sin autenticación** |
| *"Autorización = un booleano `privilegiado`; no hay concepto de rol"* (`08`, §4) | **Corregido parcialmente**: 2 roles, gate de administrador, autoaprobación prohibida, separación de funciones en devoluciones | `core/auth/rol-contract.ts`, `autorizacion-resolucion.ts`, migración `0013` |
| *"Ni una sola captura de pantalla en `docs/progreso/`"* (`05`, §4) | **Corregido**: primera captura | `docs/progreso/v3.20-enmascarar-password-en-tui/captura-login-enmascarado.png` |
| *"La sesión vive solo en memoria; reiniciar desloguea"* | **Sin cambio en persistencia**, pero la sesión ahora vence por TTL (480 min por defecto) y por inactividad (30 min) | `SESION_TTL_MINUTOS`, `SESION_INACTIVIDAD_MINUTOS` (v3.12) |
| *"El rigor documental se relaja en v3.1–v3.4"* (`05`, §7) | **Mixto** (ver §5): la verificación se volvió más rigurosa y la trazabilidad de artefactos, menos | — |
| `adapters/tui` y `adapters/memory` con fan-out 0 (`07`) | `tui` ahora importa de `core/commands` (v3.20, para enmascarar la clave). Está permitido por la regla hexagonal (adaptador → núcleo) | Grafo: `adapters/tui → core/commands` |

### Se sostienen

- **Hexagonal real**: 0 aristas `core → adapters`, y el único acoplamiento adaptador↔adaptador sigue siendo `shared/` (el mismo de antes). El nuevo adaptador `ops` tiene un test de arquitectura que lo verifica en cada corrida (`adapters/ops/arquitectura.test.ts`).
- **Persistencia en un solo archivo SQLite dentro de un solo proceso**: sin backup ni replicación. `respaldo-y-durabilidad-sqlite` aparece citado como change planificado, pero no existe en el repo.
- **Sin rate-limiting**: el propio `src/core/auth/login.ts:38` sigue documentando que no hay *"ninguna capa de rate-limiting"*.
- **Sin métricas, tracing ni rotación de logs.** Lo nuevo son logs de ciclo de vida (hooks PRE/POST_TURN reales) y healthchecks, no métricas.
- **Sin contenedor ni supervisor de proceso** (`Dockerfile` inexistente; `empaquetado-contenedor` citado como planificado pero no versionado).

### Empeoradas o nuevas

1. **Artefactos `openspec/` faltantes en dos hitos enteros.** `v3.17` y `v3.18` no tienen carpeta en `openspec/changes/`, ni ahora ni en el historial (`git log --all`). Sus reportes del Reviewer citan `design.md`, `tasks.md` y specs (`modo-headless-proceso`, `salud-operativa`) que **no están en el repo**. Es la primera vez que un hito tageado no deja su diseño versionado. Choca de frente con `AGENTS.md` (*"artifact store: openspec… es la única forma de cumplir la exigencia del tutor"*).
2. **Changes fantasma.** Otros changes citan `respaldo-y-durabilidad-sqlite`, `slos-y-dashboard`, `permisos-granulares` y `empaquetado-contenedor`, que nunca se versionaron. Hay planificación ocurriendo fuera del repo. El reject de la ronda 1 de v3.20 fue justamente una colisión de número de versión con uno de ellos.
3. **El plan maestro quedó congelado.** `docs/Plan_Implementacion_Harness_Empresarial.md` no cambia desde `ed3eba6` (2026-09-11): los 17 hitos nuevos no figuran en su sección "Estado real de ejecución". En la primera evaluación la queja era que el plan se actualizaba *tarde*; ahora directamente no se actualiza.
4. **Colisiones de numeración de ADRs.** ADR 174 aparece en tres changes distintos (v3.6, v3.7, v3.8), 180–187 se repite entre v3.7 y v3.8, y 227–228 entre v3.11 y v3.12. El propio arc42 lo registra como **Deuda 11**, pero sigue pasando después del registro. La primera evaluación había destacado el "registro correlativo único sin reiniciar numeración"; eso ya no es cierto.
5. **El arc42 dejó de ser el registro central de ADRs.** De ~158 números consumidos desde v3.4, solo **3** (ADR 300, 301 y 302) tienen encabezado propio en `docs/ARC42_Harness_Empresarial.md`. El resto vive disperso en los `design.md` de cada change. v3.17–v3.19 no tocaron el arc42.
6. **`sdd-archive` nunca corrió.** `openspec/changes/archive/` y `openspec/specs/` siguen vacíos (solo `.gitkeep`) con 29 changes acumulados. No existe una especificación viva consolidada del sistema: para saber qué hace hoy la tool de operaciones hay que leer 11 `design.md` en orden, incluidas sus enmiendas.
7. **Deriva de la convención de commits.** 257 de los 404 commits nuevos usan `(<nombre-del-change>, tarea N)` en vez del formato de `AGENTS.md` `(Hito X.Y, tarea N)`; solo 53 lo respetan. El formato canónico reaparece recién hacia v3.19–v3.21.
8. **Código de producción fuera del ciclo.** `ce5d7b8` (*"feat(hooks): registra handlers reales de PRE_TURN y POST_TURN (objetivo 6, pasantia)"*, +349 líneas en `src/core/hooks/`, `startup/`, `turn-selector/invoke-model.ts`) entró sin change en `openspec/` y sin hito, dentro del rango de v3.18. Es el mismo patrón que `dbecedb` en la primera evaluación, ahora con código de producción del núcleo.
9. **Dependencias circulares a nivel módulo dentro de `core/`.** No existían en `v3.4.0`: `core/agents ↔ core/operaciones` (`definitions.ts` importa `OPERACIONES_TOOL_QUALIFIED_NAME` y `ejecutar-operacion.ts` importa 6 archivos de `agents/`), `core/agents ↔ core/solicitudes` y `agents → actividad → activity → agents`. No son ciclos entre archivos (no rompen la carga), pero `core/agents` pasó de fan-in 11 a **16** y ahora también aloja lógica de consultas de negocio (`consultas-negocio-tool.ts`). El cuello de botella que señalaba `07-mapa-modulos.md` creció. Además, dos composition roots se importan entre sí (`build-on-activity ↔ build-on-comando-empleado`).
10. **Bug conocido no aplicado.** El hallazgo 9.1 de v3.19 quedó *"CONFIRMADO y NO APLICADO"*: los turnos de la TUI no entran en el drenaje de cierre de v3.17, así que Ctrl+C cierra la base de datos con un turno todavía en vuelo (`docs/progreso/v3.19-operaciones-negocio-tui/`).

## 5. El proceso SDD en el período: más rigor de verificación, menos trazabilidad

**Lo que mejoró de forma visible:**

- **Pruebas de mutación como evidencia**: desde v3.13 casi todos los hitos traen archivos `verificacion-mutacion-*.md` / `mutaciones*.md`. Se rompe a propósito el código para mostrar que el test lo atrapa. En la primera evaluación no existía nada parecido. En v3.20 el propio Reviewer dejó registrado que una unidad (U4) **no atrapa** la mutación M4: la herramienta se usa también para encontrar huecos, no solo para decorar.
- **Matrices criterio → evidencia** en v3.17 y v3.18 (`matriz-criterio-evidencia.md`): cada criterio de aceptación apunta a su prueba.
- **Commits RED separados**: los commits `test(...)` pasan de 12 (en 351) a **89** (en 404), muchos con el sufijo *"rojo de tipo"*. Esto hace auditable el paso RED de TDD, que en v2.0 había sido el motivo de un rechazo por "TDD simulado".
- **Un PR por hito**: 22 merges en el período (PRs #16–#35), contra 13 en los 12 hitos anteriores.

**Rechazos y re-trabajo reales en el período** (el gate siguió funcionando):

| Hito | Qué frenó | Quién |
| --- | --- | --- |
| v3.8 | 3 bloqueantes (truncado a 20, validación de longitud, estado de actividad); segunda pasada aprobada | code-review |
| v3.9 | `sdd-verify` **RECHAZA** en la 2.ª pasada: el logout invalidaba la confirmación de otra sesión; hubo 3 pasadas | Reviewer |
| v3.12 | El checkpoint humano **rechazó el mecanismo del ADR 223** (token del cliente) y lo reemplazó por "escala siempre" | checkpoint |
| v3.17 | H-1: sin listeners, el proceso salía con código 13 a los 0,84 s; re-trabajo con 3 tareas nuevas | verificación manual → Reviewer |
| v3.18 | 8 hallazgos de code-review, 6 corregidos | code-review |
| v3.19 | W1–W3 remediados en una fase 8 dedicada; el hallazgo 9.1 quedó sin aplicar | Reviewer |
| v3.20 | **REJECT en la ronda 1** por colisión de número de versión; aprobado en la ronda 2 | Reviewer + checkpoint |

**Lo que se debilitó:**

- **Reportes formales del Reviewer versionados: 5 de 17 hitos**. Hay `verify-report.md` en v3.7, v3.15 y v3.20, y `reporte-verificacion-reviewer.md` en v3.17 y v3.18. En los otros 12, la aprobación solo se reconstruye a partir de commits *"hallazgo reviewer"* y de `README.md` de progreso. En v3.21, `tasks.md` dice *"tras la aprobación del Reviewer"* sin el reporte.
- **Artefactos commiteados tarde**: los `openspec/` de v3.11 y v3.12 entraron recién en v3.13, y los de v3.13 y v3.14 en el tag siguiente (commits *"versiona los artefactos de openspec del hito…"*).
- **`tasks.md` desalineado**: en v3.14 las 30 casillas quedaron en `[ ]` con todo el trabajo commiteado.
- **Verificación sin modelo real**: la tarea 19 de v3.10 se verificó llamando a `ejecutarOperacion` directo, sin turno LLM, porque no había `ANTHROPIC_API_KEY`. v3.12 registra *"SDK real no ejercitado"*.
- **Presupuestos de PR**: v3.17 se revisó de una vez (5 022 líneas) cuando el plan pedía 3 PRs; v3.21 entró con `size:exception` (~545 contra un techo de 400). El hallazgo de proceso de la primera evaluación sigue vigente.

**Respuesta a la pregunta abierta de la primera evaluación** (*"¿la relajación en v3.1–v3.4 fue decisión consciente o presión de tiempo?"*): los datos no la cierran, pero muestran que **no fue una tendencia sostenida**. El rigor de verificación subió mucho y la trazabilidad de artefactos se volvió irregular: excelente en unos hitos (v3.17/v3.18 tienen la mejor evidencia de todo el repo) y ausente en otros (esos mismos dos no tienen `openspec/`).

## 6. Scorecard empresarial — antes y ahora

| Dimensión | 2026-09-12 | 2026-09-25 | Qué la movió |
| --- | --- | --- | --- |
| Extensibilidad arquitectónica | 🟢 Fuerte | 🟢 Fuerte *(con alerta)* | 0 aristas `core→adapters` sostenido; alerta por los ciclos nuevos entre módulos del núcleo y por el fan-in de `core/agents` (16) |
| Corrección del dominio | 🟢 Fuerte | 🟢 Fuerte | Separación de funciones, autoaprobación prohibida, reporte neto de reembolsos con ADR propio |
| Persistencia y escala | 🔴 Débil | 🔴 Débil | Sin cambios de fondo; solo se configura la ruta (`HARNESS_DB_PATH`) |
| Multi-tenencia / gobernanza | 🔴 Débil | 🟡 Parcial | Roles, gate de administrador, auditoría de rechazos. Sigue sin haber multi-tenencia (por diseño) |
| Seguridad | 🟡 Parcial | 🟡 Parcial *(mejor)* | + CSP en el chat, sesión con inactividad, clave enmascarada, marco contra inyección de prompt en texto externo. − Sin rate-limiting, tokens compartidos, endpoint `ops` sin autenticación |
| Observabilidad | 🟡 Parcial | 🟡 Parcial | + liveness/readiness, hooks de log PRE/POST_TURN. − sin métricas, tracing ni rotación |
| Confiabilidad operacional | 🟡 Parcial | 🟡 Parcial *(mejor)* | + cierre ordenado con presupuesto y watchdog, readiness. − Deuda 1 sigue abierta; turnos de la TUI fuera del drenaje (9.1) |
| Calidad de ingeniería | 🟢 Fuerte | 🟢 Fuerte *(reforzada)* | +1 037 tests, mutación, commits RED separados, CI |
| Despliegue y operación | 🔴 Débil | 🟡 Parcial | CI, build de producción, `npm start`, modo headless, healthchecks. Faltan contenedor, supervisor y backup |
| Madurez multi-agente | 🟢 Fuerte | 🟢 Fuerte | A2A saliente desde el chat con catálogo cerrado; A2A entrante con consultas de negocio |

**Balance**: de 3 dimensiones rojas se pasa a 1. Las dos que salieron del rojo (gobernanza y despliegue) son exactamente dos de las cinco brechas que la primera evaluación proponía preguntarle al pasante *"cuál atacarías primero"*. En los hechos, el trabajo de v3.5 (roles) y de v3.17–v3.18 (operar sin TUI) es esa respuesta. **Persistencia y escala** es ahora la brecha más visible, y su change (`respaldo-y-durabilidad-sqlite`) existe solo como referencia en otros documentos.

## 7. Preguntas para el pasante

1. ¿Dónde están los `design.md` / `tasks.md` / specs de `v3.17` y `v3.18`? ¿Y los de los changes citados que no están en el repo (`respaldo-y-durabilidad-sqlite`, `slos-y-dashboard`, `permisos-granulares`, `empaquetado-contenedor`)?
2. ¿Por qué no se actualizó `Plan_Implementacion_Harness_Empresarial.md` con los 17 hitos nuevos? ¿Sigue siendo la fuente de verdad del plan?
3. ¿Cuándo se corre `sdd-archive` para consolidar `openspec/specs/`? Con 29 changes abiertos, ¿qué documento describe hoy el comportamiento vigente de la tool de operaciones?
4. El hallazgo 9.1 de v3.19 (Ctrl+C con un turno de TUI en vuelo) está confirmado: ¿qué hito lo toma?
5. `ce5d7b8` agregó código de producción al núcleo fuera del ciclo SDD: ¿fue deliberado, por ser un "objetivo de pasantía" y no un hito?

## Nota de método

- La línea base de `v3.4.0` se recalculó con el mismo script que la de `HEAD`. Da números levemente distintos de los publicados el 12/09 para adaptadores (28 566 contra 28 706 líneas y 109 contra 114 archivos) y tests (1 691 contra 1 618 `it`/`test`): la primera pasada usó otro criterio de filtrado. Para las comparaciones de este documento se usan siempre los números recalculados, así que los Δ son homogéneos. Los números de `v3.4.0` en `06-metricas.md` se conservan tal cual.
- Los conteos de tests son sintácticos (ocurrencias de `it(`, `test(` y `describe(`, incluidas las variantes `.each`/`.skip`/`.only`), no resultados de `vitest run`.
- El detalle por hito proviene de `docs/progreso/`, de `openspec/changes/` y de `git log`/`git diff --stat` entre tags consecutivos.
