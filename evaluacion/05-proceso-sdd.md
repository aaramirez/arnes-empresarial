# Auditoría del proceso Spec Author → Checkpoint → Implementer → Reviewer

Alcance revisado: 13 carpetas de `openspec/changes/`, 12 carpetas de `docs/progreso/`, los dos documentos maestros y el historial de tags/commits de cierre. Este documento evalúa el **proceso**, no el código (ver `02-nucleo.md`/`03-adaptadores.md` para eso).

Cadena real de tags: `v1.0.0 → v1.1.0 → v1.2.0 → v1.4.0 → v2.0.0 → v2.1.0 → v2.2.0 → v3.0.0 → v3.1.0 → v3.2.0 → v3.3.0 → v3.4.0`. El salto `v1.2.0 → v1.4.0` (sin `v1.3.0`) es el hito huérfano — ver §2.

## 1. Resultado de cada hito, en orden cronológico

| Hito | Veredicto del Reviewer | Detalle |
| --- | --- | --- |
| v1.0 esqueleto conversacional | **PASS** a la primera | 16/16 tareas, 132/132 tests, 0 CRITICAL |
| v1.1 consulta de conocimiento | **PASS** a la primera | 211 tests, 0 CRITICAL, 1 WARNING no bloqueante |
| v1.2 bot de revisión de PRs | PASS WITH WARNINGS | 477/477 tests; 3 WARNING — ninguno de código (ver §3) |
| v1.3 ventas y comisiones | **RECHAZADO como cierre independiente** | Código completo (30/31 tareas), sin tag — ver §2 |
| v1.4 TUI canal empleado | PASS WITH WARNINGS | 954/954 tests; absorbe el entregable descartado de v1.3 |
| v2.0 delegación a subagentes | PASS, con **1 rechazo real dentro del ciclo** | Tarea 2 rechazada por TDD simulado (ver §3) |
| v2.1 escritura delegada | PASS | Solo `verify-report-pr1.md` conservado; resto aprobado sin archivo propio |
| v2.2 A2A cliente | PASS WITH WARNINGS | 2 bugs reales de protocolo encontrados y corregidos con TDD (ver §3) |
| v3.0 A2A entrante | PASS, con **desvío de proceso documentado** | `chain_strategy` de `design.md` no seguida; PR5 fue 3.4× el forecast |
| v3.1 definición de skills | Sin `verify-report.md` | Evidencia más rica en logs crudos (20 `.txt`); un bug real se corrigió recién en `dbecedb`, fuera del ciclo |
| v3.2 `/reporte-comisiones` | PASS WITH WARNINGS | 1904/1904 tests; 2 WARNING de trazabilidad documental |
| v3.3 `/cancelar-solicitud` | **2 rondas de Reviewer, 1 hallazgo bloqueante real** | Ver §3 — el episodio más riguroso del repo |
| v3.4 `/ver-solicitudes-a2a` | Sin `verify-report.md`, sin `README.md` de evidencia | Tageado igual, según nota propia del repo un día antes |

## 2. El caso que no cerró: `hito-1.3-ventas-comisiones`

`openspec/changes/hito-1.3-ventas-comisiones/NOTA-CIERRE.md` (fechada 2026-09-11, "registrada retroactivamente a pedido del desarrollador") documenta:

- Las 30 tareas de código se implementaron **completas**, cada una con su propio commit.
- La **tarea 31** — verificación manual end-to-end de 20 pasos, la que generaría la evidencia de cierre — nunca se corrió como cierre independiente: *"el checkpoint humano determinó que el resultado no cumplía el estándar esperado del Reviewer para cerrarlo como `v1.3.0`."*
- Consecuencia: sin tag `v1.3.0`, sin carpeta `docs/progreso/`, sin `verify-report.md`.
- El código **no se descartó** — quedó en el árbol (`src/core/ventas/`, `src/adapters/web/`, `src/adapters/notificaciones/`, migración `0004`) y su entregable se demostró como parte de la evidencia de `v1.4.0`.
- Decisión deliberada de **no archivar** el change como si hubiera cerrado, "para no borrar el rastro de que el cierre formal se descartó y por qué".

Dentro del propio proceso declarado, este es el ejemplo más fuerte de que **el checkpoint humano funcionó como gate real**: código completo y funcional fue rechazado como hito propio por no alcanzar el estándar de verificación, en vez de tagearse por inercia.

## 3. Rondas de rechazo del Reviewer — evidencia concreta

Contrario a una lectura superficial ("todo dice PASS"), hay al menos **3 episodios de rechazo real** documentados con evidencia forense:

1. **v2.0, tarea 2** (`apply-progress.md`): el Reviewer rechazó la primera pasada por dos hallazgos bloqueantes — el paso RED de TDD fue *reclamado, no ejecutado realmente*, y el comentario de cabecera del archivo quedó desactualizado/falso. El Implementer tuvo que revertir con `git stash`, forzar un RED real y corregir el comentario antes de que se aceptara.

2. **v3.3, primera ronda** (tareas 1-13): hallazgo bloqueante de **diseño real** — `/cancelar-solicitud` sin id reusaba el listado de pendientes sin filtrar por dueño, con `LIMIT 20` aplicado antes de cualquier filtro: *"un empleado con solicitudes propias pendientes podía recibir una lista vacía si 20+ solicitudes ajenas eran más antiguas"* — un bug funcional real, no solo cosmético. Volvió al Spec Author (loop de rechazo de `AGENTS.md`), se aprobó el **ADR 144** en checkpoint humano, y las tareas 15-18 son ese fix.

3. **v3.3, segunda ronda**: confirmó el fix con test real (25 solicitudes ajenas antes de la propia, la propia sigue apareciendo) y encontró **9 hallazgos menores adicionales** (código muerto, mensaje duplicado, huecos de cobertura). De 12 hallazgos totales, 8 se corrigieron en una pasada autorizada por el humano; 1 se dejó por ser decisión de diseño ya aprobada — la tabla completa de hallazgos con severidad y estado en el verify-report es el nivel de trazabilidad más alto de todo el repo.

Adicionalmente, **v2.2 (A2A cliente)** encontró y corrigió con TDD 2 bugs de protocolo reales contra agentes A2A externos reales (header `A2A-Version` faltante; desempaquetado incorrecto del `oneof task/message`) — "22 tests fallando antes del fix, 44/44 pasando después", verificado contra 3 agentes reales, no solo contra dobles.

**Patrón general**: el proceso frenó código real en 2 ocasiones con evidencia forense detallada, y rechazó el cierre completo de un hito entero. El resto de las ~10 verificaciones aprobaron a la primera con WARNINGs cosméticos o de evidencia de demostración incompleta (v1.2: identidad de bot compartida rompe el filtro anti-loop en el entorno de demo — riesgo real, no solo de demo; v1.4: conteo de comandos desalineado entre spec y código; v3.0: presupuesto de PR excedido 3.4×; v3.2/v3.4: trazabilidad documental incompleta).

## 4. Evidencia en `docs/progreso/` — consistencia entre hitos

Patrón dominante: un `README.md` narrativo con fragmentos de log JSON pegados inline. Excepciones notables:

- **v3.1** tiene **20 archivos `.txt`** de stdout/stderr crudo por paso — el único hito con logs de terminal reales versionados, no solo prosa.
- **v3.4** es el único hito **sin `README.md`** de evidencia (solo `evidencia-verificacion-manual.md`) — rompe el patrón justo en el hito más reciente.
- **v1.3** no tiene carpeta (hito descartado, §2).

Hallazgo transversal: en las 12 carpetas existentes **no hay una sola captura de pantalla** — toda la evidencia visual es texto (transcripciones de terminal, fragmentos de log, prosa citando código). Es coherente con un proyecto de TUI corrido en un entorno sin interfaz gráfica capturable por el propio agente, pero significa que la confianza en que la TUI "se ve y comporta como se describe" descansa en la honestidad narrativa del pasante — que, para su crédito, documenta explícitamente sus propias limitaciones de demostración en varios puntos (Ink no corre headless, PAT compartido rompe el filtro anti-loop en demo, timeout end-to-end no probado contra agente real).

## 5. ADRs — rango y ejemplos destacados

Los ADRs numerados van de **ADR 1** (estrategia de entrega incremental, arc42) a al menos **ADR 144** (`comando-cancelar-solicitud`, el hallazgo bloqueante de §3) — un registro correlativo único a través de todo el proyecto, sin reiniciar numeración por hito.

| ADR | Decisión |
| --- | --- |
| 1 | Entrega incremental v1 lineal → v2 swarm → v3 grafo |
| 2 | Monolito modular, no monorepo |
| 3/4 | Servidor MCP in-process (`createSdkMcpServer`) en vez de `McpStdioServerConfig`, priorizando testabilidad TDD |
| 46/48 | FKs `NULL`-ables en `delegaciones` — forzado por no poder registrar una delegación antes de invocar si la FK fuera `NOT NULL` bajo `foreign_keys=ON` |
| 51 | `SUBAGENT_REGISTRY` como `Map` separado de `AGENT_REGISTRY` |
| 67 | `construirDeveloperConEscritura` como único otorgante de `Write`/`Edit`, atado por tipo a un worktree ya abierto |
| 84 | Manejo exhaustivo del noveno `TaskState` (`UNSPECIFIED`) del protocolo A2A |
| 99/100 | `GetTask` genuinamente síncrono; drenaje del servidor con `Promise.allSettled` + `Promise.race` |
| 108 | `skills`/`settingSources` deben ir en el literal inicial de `Options`, nunca detrás de un `if` |
| 144 | El hallazgo bloqueante de `/cancelar-solicitud` — el único ADR que nace directo de un rechazo del Reviewer, no de diseño anticipado |

## 6. Desvíos entre lo planeado y lo ejecutado

El commit `ed3eba6` (*"docs: corrige registro de cierre de v1.3/v2.0 y actualiza plan con estado real"*, 2026-09-11) documenta retroactivamente estos desvíos en el propio plan:

- **Hito 4 (v1.3.0) nunca cerró** — descartado por el checkpoint (§2).
- **5 hitos no contemplados** se insertaron: v1.4.0, v2.1.0, y la tanda v3.1.0–v3.4.0 — corriendo la numeración de tags planeada (el Hito 6 del plan, previsto `v2.1.0`, terminó siendo `v2.2.0`).
- **`chain_strategy` de `design.md` no seguida en la práctica**: 4 hitos (v2.0, v2.1, v2.2, v3.0) declararon una estrategia de sub-ramas por PR que en los hechos nunca se usó — todos corrieron como una única rama de tracker con un solo PR a `main` (constatado explícitamente en el propio `verify-report-pr5.md` de v3.0).
- **Presupuestos de revisión sistemáticamente superados**: v3.0 PR5 fue 3.4× el forecast de líneas de `design.md`.
- **El propio plan quedó desactualizado un día completo**: la nota de `ed3eba6` decía que a v3.4 "le falta `verify-report.md` y tag" — el tag se creó igual unas horas después, sin ese artefacto.
- **Fix post-cierre fuera del ciclo formal**: el commit `dbecedb` (posterior a v3.4.0) corrige un defecto real de v3.1 sin abrir un nuevo change en `openspec/` — se aparta del propio principio "todo pasa por Spec Author → checkpoint".
- **Tracking mixto en git**: en `comando-reporte-comisiones`, `tasks.md` quedó commiteado pero `proposal.md`/`design.md`/`specs/` no — el propio Reviewer lo describe como "parece accidental, no decidido".

## 7. Balance del rigor del proceso

**Fortalezas verificables:**

- El checkpoint humano actuó como gate real de forma contundente al menos una vez: rechazó cerrar un hito con 30/31 tareas completas, y lo documentó retroactivamente en vez de borrar el rastro.
- Al menos un rechazo con evidencia forense de TDD simulado, detectado y corregido.
- Un hallazgo bloqueante de diseño con impacto funcional real fue devuelto al Spec Author, resuelto con un ADR propio y re-verificado con test dedicado.
- Verificación de campo contra sistemas reales (3 agentes A2A externos) encontró bugs que el testing unitario no había capturado.
- Honestidad reiterada sobre limitaciones de demostración, en vez de ocultarlas.

**Debilidades del rigor real:**

- El proceso se volvió más laxo hacia el final: los dos últimos hitos tageados (v3.1, v3.4) carecen de `verify-report.md` versionado — la aprobación, si ocurrió, no dejó el mismo rastro escrito que los 10 hitos anteriores.
- La mayoría de los "PASS" reales son "PASS WITH WARNINGS", con al menos un punto de demostración humana pendiente sin mecanismo que fuerce su cierre.
- El proceso declarado en `design.md` (ramas por PR, presupuestos de línea) no se cumplió en la práctica en 4 de los últimos 5 hitos grandes — detectado, pero no corregido, solo anotado como "hallazgo de proceso".
- La cobertura del plan original se desvió sustancialmente (4 hitos enteros no contemplados, un hito descartado, dos renumeraciones en cadena) sin que el plan se actualizara hasta el día anterior al cierre del último hito — la trazabilidad plan-vs-ejecución fue reconstruida retroactivamente, no mantenida en paralelo.

**Lectura para el tutor**: el proceso de tres roles + checkpoint no fue teatro — hay al menos tres episodios verificables donde efectivamente cambió el resultado (un hito completo descartado, una tarea rehecha por TDD falso, un bug de diseño real corregido con su propio ADR). Al mismo tiempo, el rigor documental se relaja visiblemente en la fase final (v3.1–v3.4), justo cuando los hitos se vuelven más chicos y frecuentes — vale la pena preguntarle al pasante si esa relajación fue una decisión consciente de "menor ceremonia para cambios chicos" o simple presión de tiempo hacia el final de la pasantía.
