# Reporte de verificacion -- Reviewer -- modo-headless-cierre-limpio

**Fecha**: 2026-09-21 | **Rama**: hito/v3.17-modo-headless-cierre-limpio | **HEAD revisado**: 56c8303 (tarea 5.2) | **Base**: main @ d73e3129 (tag v3.16.0, confirmado con git merge-base main HEAD)

## Veredicto

**APROBADO**, sin hallazgos bloqueantes. Se documentan 3 hallazgos NO BLOQUEANTES (uno con evidencia propia que matiza una afirmacion del Implementer) y 2 observaciones de proceso. Ninguno requiere volver al Spec Author ni al Implementer antes de cerrar el hijo; se recomienda que el Implementer atienda el hallazgo 1 en un commit de seguimiento (no bloqueante para este cierre).

## Que se corrio, con salida real

Todo corrido por mi, en este checkout, no copiado de los docs de evidencia:

- rm -rf dist && npm run typecheck -> verde, 0 errores
- npm test (Windows) -> Test Files 154 passed | 2 skipped (156) / Tests 3082 passed | 5 skipped (3087)
- npm run build (con prebuild limpiando dist/) -> verde; 0 archivos *.test.* bajo dist/; dist/main.js, dist/empleados.js, dist/reporte-mensual.js existen
- npm test -- env-example -> 9 passed (9); cobertura bidireccional de .env.example verde (no pude leer el archivo directo, permiso denegado por el entorno, igual que a los agentes SDD; lo verifique por el test)
- npm test -- proceso-cierre main.test build-produccion db-path-call-sites -> 127 passed (127)
- npm test -- comandos-administracion-empleados-invariantes -> 10 passed (10); el candado de v3.7 relajado (4.2a) sigue vigilando board/ y env.ts
- Contenedor real node:20-bookworm-slim (Docker, exportado con git archive HEAD a un directorio aislado, npm ci fresco), npx vitest run cierre-headless.integration -> 2 passed (2), incluido el test 27 (H-1)
- Mismo contenedor, npx vitest run (suite completa) -> 1 failed | 151 passed | 4 skipped (Test Files), 4 failed | 3069 passed | 14 skipped (Tests); los 4 fallos son todos en src/adapters/tui/App.test.tsx, archivo NO tocado por este diff (confirmado con git diff main..HEAD --stat -- src/adapters/tui/App.test.tsx -> vacio)

Esto confirma de forma independiente lo que declaran mutaciones-h1-h2.md y evidencia-manual-post-fix.md: el test de integracion por proceso hijo (tareas 3.7/3.7a) corre y pasa en Linux real, y el unico ruido es el flaky preexistente de App.test.tsx, ajeno a este change.

## Diff scope (regla dura AGENTS.md / tasks.md (a)-(f))

git diff main..HEAD --stat: 38 archivos, 5022 inserciones, 42 eliminaciones. Verificado uno por uno contra el alcance declarado:

- src/main.ts: diff = imports del tope (2 lineas) + openDatabase("data/harness.db") reemplazado por openDatabase(resolveDbPath()) + el bloque final (if/else dentro del mismo try, finally SIN un solo hunk, comentario tras el finally + finalizarCierreHeadless()). Cero hunks entre el import y el bloque final. Cero funciones extraidas.
- src/main.test.ts: git show main:src/main.test.ts | wc -l -> 523 lineas exactas. Todo el diff (+1315/-0) es un unico bloque de adiciones que arranca en la linea 523, con solo unos pocos hunks tempranos de vi.mock/imports en la zona de setup (lineas 32-104), NINGUNO dentro del rango de las seis anclas bloqueEntre (lineas 650-673 en la numeracion actual) ni del toContain que las sigue. Confirmado leyendo el diff completo.
- package.json: solo scripts (prebuild, build, start). version intacta (0.1.0). Sin dependencias nuevas.
- src/test/integration/comandos-administracion-empleados-invariantes.integration.test.ts (tarea 4.2a): diff = un unico hunk, el it de las lineas 49-53; saca solo "src/adapters/webhooks/" de diffStat([...]); board/ y env.ts intactos en la lista. Es la unica edicion de un test de un change anterior en todo el hijo, tal como se anuncio.
- Fuera del diff, confirmado por su ausencia en --stat: Dockerfile, compose.yaml, .github/**, src/core/**, AGENTS.md, docs/ARC42_Harness_Empresarial.md, evaluacion/08-evaluacion-empresarial.md, migraciones, adapters/a2a/client.ts.
- .env.example: +29 lineas (6 variables), no pude leer el contenido literal (permiso denegado), pero env-example.test.ts verde en ambas direcciones lo certifica indirectamente.

**Metodologia TDD**: revise git log --oneline main..HEAD completo (37 commits) contra tasks.md; el patron rojo-verde declarado en cada mensaje es coherente con las excepciones documentadas (1.8, 3.1, 3.7, 3.8, 3.8a, 3.9, 4.2a, 4.7, 5.1, 5.1a, 5.2, 5.3). No encontre ningun commit fuera de secuencia ni mensajes que prometan algo que el diff no entrega.

## Los 5 puntos de desvio pedidos -- tratamiento explicito

### 1. Tarea 3.3 -- los dos escenarios de H10 sin verificar (limitacion real o rendicion prematura?)

La limitacion es REAL, la reproduje yo mismo, aislada del resto del codigo. Con un modulo minimo sin exports cuyo top-level await rechaza (mismo patron que startTui(...).waitUntilExit() rechazando), si entre import("./modulo.js") y el primer .catch()/await sobre esa promesa pasa un tick asincrono (como el esperarWiringA2AEntrante con setTimeout que usa dispararImport()), Vitest reporta "Unhandled Rejection" como error de corrida -- reproduje exactamente ese mensaje, con el mismo stack de VitestModuleEvaluator.

Pero la conclusion "no es verificable con esta tecnica" es prematura. Adjuntando un .catch(() => {}) SINCRONO e INMEDIATO, en la misma linea en que se dispara el import() (antes de cualquier await), el "Unhandled Rejection" desaparece por completo y la asercion posterior (await expect(promesaImport).rejects.toThrow(...)) sigue observando el motivo real del rechazo. Lo verifique con tres repros consecutivos (rechazo con setTimeout, rechazo inmediato, y el patron exacto con delay + catch tardio vs. catch inmediato) -- los archivos de repro fueron creados, corridos y BORRADOS al terminar, no quedan en el arbol (confirmado con git status --short tras el borrado).

Severidad: NO BLOQUEANTE. Es comportamiento heredado de v3.16 (main.ts:722-726, camino de fallo de la TUI), sin tests desde entonces (confirmado: git show main:src/main.test.ts no menciona waitUntilExit/rechaza/lanza), y esta rama no lo modifica. Recomendacion: commit de seguimiento del Implementer que agregue los dos escenarios de H10 usando el patron "const p = import(...); p.catch(() => {});" antes del esperarWiringA2AEntrante. No amerita volver al Spec Author (es una tecnica de test, no una decision de diseno).

### 2. Tarea 3.5 (H9/R1) -- prueba la garantia de negocio o es un test que se convencio a si mismo?

Ambas cosas son ciertas, en capas distintas. Confirme leyendo main.test.ts (lineas 1680-1755): el test unitario NO dispara la pila HTTP real -- startWebServer esta mockeado por modulo (vi.mock("./adapters/web/index.js", ...)), el "turno" es un doble de close() controlado a mano (web.resolver()), y la fila se escribe con un INSERT directo (escribirFilaDelTurno), no por el flujo real de consultar_kpi. Esto prueba el MECANISMO (orden de cierre, que db.close() espera al close() del adaptador, el watchdog del presupuesto) pero no prueba, por si solo, que un turno HTTP real mantenga el socket abierto hasta escribir su fila.

Sin embargo, lei docs/progreso/v3.17-modo-headless-cierre-limpio/evidencia-manual.md punto (2): ahi SI corre la pila real -- CLI real (empleados:crear), POST /login, POST /operaciones real, cliente A2A real, SQLite real (solo el modelo LLM esta simulado). Con timestamps reales: 23:11:29.387 accion-empleado-registrada (fila escrita) ANTES de 23:11:29.733 cierre-completado, y en el escenario de presupuesto agotado (HARNESS_SHUTDOWN_TIMEOUT_MS=5000), la fila queda ausente y el vencimiento logueado (exit=1). Esto SI es la garantia de negocio, verificada end-to-end, con evidencia fechada y reproducible (aunque manual, no de CI).

Severidad: NO BLOQUEANTE, pero es una brecha de documentacion: matriz-criterio-evidencia.md (lineas 14-15) apunta a "tarea 3.5, tarea 5.1" para R1 sin aclarar que 3.5 verifica el MECANISMO con dobles y 5.1 verifica la GARANTIA con la pila real. Un lector que solo mire main.test.ts podria creer que el negocio esta probado en CI cuando la prueba end-to-end real es manual. Recomendacion: una linea aclaratoria en la matriz (mismo criterio que ya usan para el ancla/marcador en la Fase 6).

### 3. Tarea 3.7/3.7a -- corrio alguna vez en el runner real de CI?

No, y los propios documentos lo declaran "[no verificado]" sin maquillarlo -- se los tome la palabra y lo verifique yo mismo, de forma independiente, en un contenedor Linux real (no el mismo que uso el Implementer: imagen node:20-bookworm-slim bajada de nuevo, npm ci fresco sobre una copia exportada con git archive HEAD, no sobre su arbol de trabajo). Resultado: 2/2 verde en cierre-headless.integration.test.ts (incluido el test 27 que atrapa H-1), y la suite completa reproduce exactamente el mismo patron de fallos que declaran los docs (4 fallos, todos en App.test.tsx, archivo no tocado por este diff). Esto es evidencia fresca y propia, no una repeticion de lo que dice el documento.

Sigue siendo cierto que nunca corrio en ubuntu-latest de GitHub Actions (el runner real de CI). Es una brecha real, tal como advierte el enunciado de esta revision, pero mi verificacion independiente en un entorno equivalente (Linux, Node 20, contenedor limpio) reduce sustancialmente el riesgo de que sea diferente en CI. Severidad: NO BLOQUEANTE -- se cerrara solo al abrir la PR real contra ubuntu-latest; no hay motivo para creer que el resultado sera distinto.

### 4. Nota de proceso -- commits 4.2/4.4/4.6 sin fila de .env.example

Confirmado en el historico (commit 4962b3d: "documenta WEB_HOST, WEBHOOK_HOST y HARNESS_A2A_ENTRANTE_HOST en .env.example, omitidas en los commits 4.2, 4.4 y 4.6") y en el estado final: npm test -- env-example esta verde en el HEAD actual. El incidente esta declarado con honestidad en tasks.md (nota bajo la tarea 4.2) y no contamina el estado final. Severidad: no es un hallazgo, es un sintoma de proceso ya corregido y ya declarado -- lo dejo registrado porque el enunciado lo pide, no porque requiera accion.

### 5. Tarea 4.2a -- unica edicion de un test de un change anterior

Verificado con git diff main..HEAD -- src/test/integration/comandos-administracion-empleados-invariantes.integration.test.ts: el diff es un unico hunk de 6 lineas (4 modificadas), toca solo el it de las lineas 49-53, saca SOLO "src/adapters/webhooks/" de la lista de diffStat, deja "src/adapters/board/" y "src/core/config/env.ts" intactos, y reescribe el titulo del it para declarar la razon (WEBHOOK_HOST + closeIdleConnections superan el diferido de ADR 178 en su parte webhooks/). Corri el archivo completo (10 passed) y sigue vigilando board/ y env.ts. La justificacion es solida: el slice C toca webhooks/ por diseno (RD-123 + design section 0.2), no por descuido, y la evidencia de mutacion M-C6 (mutaciones-slice-c.md, lineas 214-220) demuestra que tocar board/ o env.ts sigue dando ROJO. Severidad: sin hallazgo. Aprobado tal cual.

## Reglas duras de tasks.md -- verificacion mecanica, no solo por lectura

- (a) main.ts solo imports + linea de resolveDbPath + bloque final -> Cumple (diff leido completo)
- (b) finally byte-identico -> Cumple (el diff no muestra ningun hunk dentro de finally { ... })
- (c) Anclas bloqueEntre intactas -> Cumple (main.test.ts en main tenia exactamente 523 lineas; todo el diff nuevo se agrega despues de esa linea)
- (d) Nada fuera de alcance en el diff -> Cumple (git diff --stat completo revisado linea por linea)
- (e) Tarea gateada (ADR 247) no tocada -> Cumple (AGENTS.md/arc42 ausentes del diff)
- (f) src/core/ no importa adapters/, adaptadores no se importan entre si -> Cumple (ningun archivo de src/core/** aparece en el diff)

## Observaciones de proceso (no bloqueantes)

- Presupuesto de revision: tasks.md (Review Workload Forecast) estimaba aprox. 1035-1445 lineas totales repartidas en 3 PRs encadenadas (stacked-to-main), con el propio documento marcando "400-line budget risk: High" y "Chained PRs recommended: Yes". La revision real fue de un solo golpe, contra 5022 lineas en 38 archivos (39 commits), porque asi se pidio esta tarea. No es un defecto del codigo -- todo lo que revise es correcto -- pero es la prueba de que el riesgo que tasks.md anticipo se concreto: revisar esto de una sola vez es sustancialmente mas costoso que las 3 PRs de <=400 lineas que el propio plan recomendaba. Si el checkpoint humano decide mergear por PRs separadas de todos modos, este reporte sirve como el "PASS" de conjunto; si prefiere trocearlo recien al mergear, no hay problema tecnico en hacerlo asi (los tres slices son independientes por diseno, segun el propio design.md).

## Conclusion

Sin hallazgos CRITICAL. Tres hallazgos WARNING (todos no bloqueantes, dos de ellos ya con evidencia real, propia, corrida en esta sesion, que corrobora o matiza -- nunca contradice de forma grave -- lo que dicen los documentos de evidencia). APROBADO para archivar / mergear, con la recomendacion de que el Implementer agregue los dos escenarios de H10 (hallazgo 1) en un commit de seguimiento cuando convenga, sin que eso bloquee el cierre de este hijo.
