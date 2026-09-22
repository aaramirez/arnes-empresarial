# Reporte de verificación — Reviewer — `salud-operativa` (hito/v3.18-salud-operativa)

Verificación en dos partes, según `AGENTS.md` (Reviewer usa `sdd-verify` + `code-review`):

1. `code-review` (esfuerzo alto, 8 ángulos + verificación 1-voto) sobre `git diff main...HEAD` completo (3470 líneas, 20 archivos).
2. `sdd-verify` sobre el cumplimiento de especificación, diseño y tareas.

## 1. `code-review` — resultado

8 hallazgos sobrevivieron verificación. Resolución:

| # | Hallazgo | Severidad | Resolución |
|---|---|---|---|
| 1 | `resolvePositiveNumber` aceptaba `OPS_PORT` no entero o fuera de rango TCP sin `puertoInvalido` | correctness (CONFIRMED) | **fixed** — `178866c`, `0b50da1` |
| 2 | `baseUtilizable()` traga errores del probe sin loguear nada; el diseño no cita evento equivalente para el motivo `base` | correctness (PLAUSIBLE) | **no_change_needed** — no se toca el logging (rompería `design.md §5.5`/S7); documentado como límite declarado |
| 3 | Matriz de evidencia sin fila para "listener caído post-arranque no detectado" | test-coverage (CONFIRMED) | **fixed** — `c77af74` |
| 4 | `listarArchivosTs` duplicada verbatim en 2 archivos nuevos | reuse (CONFIRMED) | **fixed** — `3045194`, `0b50da1` |
| 5 | Headers de respuesta repetidos inline 3x en `server.ts` | reuse | **fixed** — `59bd1ab` |
| 6 | `puertoInvalido` re-derivaba el guard de `resolvePositiveNumber` | simplification | **fixed** — `178866c`, `0b50da1` |
| 7 | `listenersCaidos` como `Set<string>` cuando solo se lee `.size` | simplification | **fixed** — `43308e3` |
| 8 | Router arma `${method} ${url}` por request en la ruta más caliente | efficiency | **skipped** — patrón deliberado del `switch` (tarea 2.2, "abierto a rutas nuevas"), severidad mínima |

4 candidatos adicionales fueron **REFUTED** en verificación 1-voto (arranque secuencial de `ops` por TDZ real, costo de la sonda aceptado como K5, ausencia de short-circuit en `evaluarReadiness` también K5, `db.prepare` unconditional ya cubierto por test S19) — el diseño resistió el escrutinio adversarial en esos cuatro puntos.

## 2. `sdd-verify` — resultado

**Evidencia de ejecución real** (reverificada de forma independiente): `npm run typecheck`, `npm test` (3208 passed | 5 skipped), `npm run build` — los tres verdes con `dist/` limpio antes. `git log --oneline main..HEAD` → 26 commits (Fases 1-4 + las 6 correcciones de code-review). `git diff main -- src/core/ src/adapters/{web,webhooks,a2a}/ Dockerfile compose.yaml .github/ package.json AGENTS.md docs/ARC42_Harness_Empresarial.md evaluacion/08-evaluacion-empresarial.md` → vacío (S20 cumplido, reverificado tras las correcciones).

**Cobertura de requisitos**: los 22 requisitos de `specs/salud-operativa/spec.md` (S1-S22) y los 3 escenarios nuevos + `estaCerrando()` de `specs/modo-headless-proceso/spec.md` (H3′/H13) tienen test real pasando, verificado test por test contra el código (tabla completa en el reporte del agente, disponible en la conversación de la sesión que cerró este hito).

**Reglas duras de `tasks.md`** (anclas `bloqueEntre` de `main.test.ts`, cero funciones extraídas de `main.ts`, `src/adapters/ops/` sin imports cruzados): intactas tras las 6 correcciones del `code-review`.

**Observaciones no bloqueantes**:
1. `ops/arquitectura.test.ts` verifica `^\s*import\b` en el escenario de `readiness.ts` (S5) pero no agrega el chequeo literal de `require(` que la spec también menciona — riesgo real nulo (archivo puro de 38 líneas sin ninguna palabra `require`), cosmético.
2. `S18` describe "un conjunto `listenersCaidos`"; la implementación final usa un contador (refactor del propio Reviewer, hallazgo 7 de arriba) — equivalente en comportamiento observable, diverge solo del texto literal del diseño original.

**Hueco de evidencia manual (SIGTERM en Windows)**: `docs/progreso/v3.18-salud-operativa/evidencia-manual.md` documenta que el escenario de `SIGTERM` con turno en vuelo no pudo verificarse con un proceso real en Windows (intento real con `kill -TERM`/`taskkill //F`, causa documentada: Windows no tiene semántica POSIX de señales). Evaluado como **no bloqueante**: el criterio crítico O6 ("`503` antes de que resuelva el primer `close()`") está probado con mayor precisión por el test unitario de `main.test.ts` (reloj falso, cero resoluciones en el mismo tick síncrono) de lo que cualquier medición manual de pared podría dar, y el límite de entorno ya estaba declarado en `design.md`/`spec.md` antes de implementar, no es un descubrimiento tardío. Aceptado explícitamente por el checkpoint humano al cierre de este hito.

## Veredicto final

**APROBADO CON OBSERVACIONES** (ninguna bloqueante). El change no vuelve a Implementer ni a Spec Author.

Checklist de cierre (`AGENTS.md`):
- [x] Reviewer aprobó explícitamente (`sdd-verify` + `code-review`, sin hallazgos bloqueantes).
- [x] Entregable funcional demostrado de punta a punta (`docs/progreso/v3.18-salud-operativa/evidencia-manual.md`, con el límite de entorno de Windows/SIGTERM aceptado explícitamente por el checkpoint).
- [x] `docs/progreso/v3.18-salud-operativa/` existe con evidencia (mutaciones de los slices B/C/D, evidencia manual, matriz criterio-evidencia, este reporte).
- [x] Tag semántico `v3.18.0` — a crear inmediatamente después de este commit, sobre `main`, tras el merge.
