# Verificación por mutación manual — catálogo, whitelist, techos, instrucción, zod y persistencia (tarea 12.2)

Misma mecánica que 12.1: mutación temporal, copia del original aparte (nunca `git checkout`/`stash`), corrida de los
tests que deben atraparla, restauración con `cmp` byte a byte idéntico y vuelta a verde. Los nombres "test N" de la
tarea no siempre están en el título del test: se indica el título real.

| # | Archivo mutado | Mutación | Test que la atrapó (rojo) | Verde tras revertir |
|---|---|---|---|---|
| M4 | `core/agents/consultas-kpi-catalogo.ts` | `return "Listado de incidentes " + "abiertos.";` (y variante con plantilla `${"abiertos"}`) | test 3: "el cuerpo de materialDeConsultaKpi no usa backtick, ${ ni + (nada interpola)" — `expected ... not to match /`\|\$\{\|\+/` (1 failed, 25 passed) | 26/26 |
| M5 | ídem | `estado_general` devuelve el material de `kpis_del_mes` | test 5: "es total: ... dos claves nunca comparten material" — `expected 3 to be 4`; y "estado_general ⇒ material literal pineado" (2 failed) | 26/26 |
| M6 | `adapters/a2a/config.ts` | `let taskTimeoutMs = base.taskTimeoutMs;` (sin `Math.min`) | "con la base en defaults aplica los tres techos" — `expected 120000 to be 30000` (test 1); "con una base mixta toma el minimo" — `expected 90000 to be 30000` (2c); "test 2: la espera total ... cabe en la mitad" — `expected 145500 to be <= 60000` (3 failed, 34 passed) | 37/37 |
| M7 | ídem | fallback de la guarda: `taskTimeoutMs = DEFAULT_A2A_TASK_TIMEOUT_MS;` | "test 2: la espera total ..." — `expected 145500 to be <= 60000`; "test 2b: ... cae a los techos del CANAL" — `expected 120000 to be 30000` (2 failed) | 37/37 |
| M8 | `core/operaciones/validar-operacion.ts` | se borra la fila `consultar_kpi` de `VALORES_PERMITIDOS_POR_OPERACION` | 6.1 negativos (6: vacío, espacios, inventada, mayúsculas, espacio antes/después: `expected {...} to be undefined`); 7b: `expected undefined to be defined`; 8.1-(iii) (`index.test.ts`, 3 casos: `ejecutar` no debe invocarse); test estructural: `operación 'consultar_kpi' tiene el campo 'consultaId' pero NO fila` (13 failed en 2 archivos) | 598/598 |
| M9 | `core/operaciones/ejecutar-operacion.ts` | la guarda `esConsultaKpiConocida` se reemplaza por `if (false as boolean)`, fila de la 4.ª tabla intacta | test 10 "clave desconocida (sin pasar por validarOperacion)": `expected 'No se pudo establecer comunicación co…' to be 'No conozco esa consulta.'`; test 18 rama clave desconocida; integración test 31 "clave fuera del catalogo forzada al dispatcher". **6.1/7b (`validar-operacion.test.ts`) y `index.test.ts` PASAN** (3 failed en 2 archivos; 367 passed) | 370/370 |
| M10 | `build-on-comando-empleado.ts:1050` | una coma: `"...KPIs/incidentes, y devolvé..."` | test 5b "el fuente de la TUI contiene la instrucción exactamente una vez": `expected 1 to be 2`. `build-on-comando-empleado.test.ts` NO lo detecta (116 tests, 1 failed) | 116/116 |
| M11 | `adapters/operaciones/index.ts:110` | `consultaId: z.enum(CONSULTAS_KPI),` (sin `.optional()`) | test 20b en las **doce** operaciones (resolver_decision_venta ... ver_solicitudes_a2a: `expected false to be true`), test 20 (`shape.consultaId ... ACEPTA undefined`) y `.unwrap is not a function` del test 4 (24 failed) | 425/425 |
| M12 | `ejecutar-operacion.ts` | `createCaso(...)` dentro del `try`: (a) llamada literal sin db (lanza y cae al `catch`); (b) llamada real con la db (handle inyectado por `globalThis` en `sembrar()` del test de integración, ambos archivos restaurados) | (a) test 12(c) `not to match /createCaso/` y test 28 (`expected 'No pude completar la consulta...' to contain 'CENTINELA-KPI-9d41c7e2'`), 29, 30 y la batería 24/13/14/16 (33 failed); (b) test 28: `expected 3 to be 2` (`despues.casos` = casos + 1) | 157/157 y 7/7 |
| M13 | `ejecutar-operacion.ts:1099` | `casoId: "caso-nuevo-mutante"` en vez de `input.casoIdActual` (al despachar) | test 28 (`expected 'No pude completar...' to contain 'CENTINELA...'`), 29 y 30 (`vi.fn() to be called 2 times, but got 0 times`), y test 24 x4 (7 failed) | 157/157 |

## Evidencia extra sobre tests señalados como débiles
- **"idéntico entre dos llamadas"** (catálogo): por sí solo es `f(x) === f(x)`. Mutación X1 (`[.., String(Math.random())].join("")`) lo hace fallar
  (`'Listado de incidentes abiertos.0.1501…' to be '…0.2539…'`): detecta no-determinismo, pero **no** una interpolación determinista
  (esa la atrapan el material pineado y el test de `+`/backtick).
- **Fórmula de `esperaTotalMaximaMs`**: el test "test 2: ... es la formula" recomputa `3*request + task + poll` con los campos derivados. Mutación X2
  (`Math.min(config.taskTimeoutMs, 5_000)` en la fórmula) falla con `expected 30500 to be 55500`: no es tautológico.

## Confirmación
`cmp` idéntico tras cada mutación (incluidas M12(b) con dos archivos). `git diff HEAD -- src` vacío al terminar; `git status --short` y
`git diff | sha256sum` idénticos a los del inicio. `npm run typecheck` verde; `npm test`: 150 archivos pasan | 1 omitido; 2906 tests pasan | 3 omitidos.
