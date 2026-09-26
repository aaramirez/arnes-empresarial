# Métricas crudas

Todos los datos de esta página fueron obtenidos directamente del working tree y de `git log`/`git tag` el 2026-09-12, con `HEAD` en `main` (limpio, 0 commits desde `v3.4.0`). Sirven como fuente única para los gráficos de `dashboard.html`.

## Inventario de archivos versionados (`git ls-files`)

| Extensión | Archivos |
| --- | --- |
| `.ts` | 237 |
| `.md` | 124 |
| `.txt` | 22 |
| `.tsx` | 6 |
| `.json` | 6 |
| `.docx` | 3 |
| `.gitkeep` | 4 |
| `.yaml` | 1 |
| `.html` | 1 |
| `.pdf` | 1 |

`.ts`/`.tsx` de `src/`: **127 archivos de producción**, **116 archivos `.test.ts`/`.test.tsx`** (casi 1 archivo de test por archivo de producción). **1618** bloques `it(`/`test(` dentro de **457** bloques `describe(`.

## Líneas de código por módulo — `src/core/`

| Módulo | Líneas | Archivos |
| --- | ---: | ---: |
| `ventas/` | 4232 | 23 |
| `turn-selector/` | 4098 | 15 |
| `activity/` | 2610 | 10 |
| `agents/` | 1994 | 12 |
| `propuestas/` | 1573 | 8 |
| `solicitudes/` | 1507 | 6 |
| `commands/` | 1349 | 4 |
| `auth/` | 615 | 8 |
| `skills/` | 615 | 6 |
| `logging/` | 381 | 2 |
| `startup/` | 312 | 2 |
| `concurrency/` | 264 | 2 |
| `hooks/` | 223 | 2 |
| `hitl/` | 175 | 2 |
| `knowledge/` | 123 | 2 |
| `config/` | 111 | 2 |
| `text/` | 109 | 2 |
| **Total core** | **20 291** | **108** |

## Líneas de código por módulo — `src/adapters/`

| Adaptador | Líneas | Archivos |
| --- | ---: | ---: |
| `memory/` | 7869 | 20 |
| `a2a/` | 5760 | 14 |
| `web/` | 2890 | 13 |
| `webhooks/` | 2320 | 13 |
| `tui/` | 2308 | 8 |
| `git/` | 1962 | 10 |
| `knowledge/` | 1587 | 10 |
| `board/` | 1483 | 8 |
| `test-runner/` | 1363 | 8 |
| `notificaciones/` | 809 | 6 |
| `crypto/` | 266 | 2 |
| `shared/` | 89 | 2 |
| **Total adapters** | **28 706** | **114** |

`src/adapters/memory/` es el módulo más grande de todo el repo (esquema SQLite + repositorio + 12 migraciones), seguido por `src/adapters/a2a/` (protocolo JSON-RPC entrante y saliente) y `src/core/ventas/` (el dominio de negocio con más reglas).

## Historial de Git

- **351 commits**, autor único: `JimmyFung123`.
- **12 tags semánticos**: `v1.0.0`, `v1.1.0`, `v1.2.0`, `v1.4.0`, `v2.0.0`, `v2.1.0`, `v2.2.0`, `v3.0.0`, `v3.1.0`, `v3.2.0`, `v3.3.0`, `v3.4.0` — de 2026-08-31 a 2026-09-11.
- **Rango de actividad**: primer commit 2026-08-26, último 2026-09-11 → 17 días de calendario.
- **Tipos de commit** (prefijo conventional commits sobre el asunto): `feat` 200 · `docs` 56 · `fix` 48 · `test` 12 · `refactor` 12 · `chore` 9.
- **Commits por semana ISO**: semana 35 → 28 · semana 36 → 123 · semana 37 → 200.
- **Commits por hora del día** (hora local del autor): concentración marcada entre las 17:00 y las 23:00 (≈224 de 351 commits, el 64%), con una cola secundaria de actividad de madrugada (00:00–04:00, ~64 commits) — compatible con un desarrollador part-time trabajando fuera de horario de oficina tradicional.

## Documentación y trazabilidad de diseño

- `docs/ARC42_Harness_Empresarial.md`: 691 líneas — arquitectura completa (arc42).
- `docs/Plan_Implementacion_Harness_Empresarial.md`: 419 líneas — plan por hitos.
- `docs/Investigacion Pre-proyecto/`: 8 documentos (3208 líneas) comparando arquitecturas de referencia (Claude Code, opencode, MEMU, Hive, Codex, DeerFlow, OpenHands, "Pi") — la investigación previa exigida por el objetivo específico 1 del alcance.
- `openspec/changes/`: 13 carpetas de propuestas (una por hito/feature), cada una con `proposal.md`, `design.md`, `tasks.md` y `specs/*/spec.md`; varias incluyen `verify-report*.md` del Reviewer.
- `docs/progreso/`: 12 carpetas de evidencia de cierre, una por hito tageado.
- ADRs numerados citados a través del repo: desde ADR 1 (arc42) hasta al menos ADR 143 (`comando-visibilidad-a2a-entrante`) — ver `05-proceso-sdd.md` para el detalle por hito.

## Configuración expuesta (variables de entorno documentadas en `README.md`)

24 variables de entorno con default *best-effort* documentadas explícitamente (nunca lanzan si están ausentes o son inválidas, salvo los tokens de autenticación que son gates explícitos): `HARNESS_DELEGACION_ROLES`, `HARNESS_ESCRITURA_DELEGADA`, `HARNESS_GIT_BIN`, `HARNESS_GIT_TIMEOUT_MS`, `HARNESS_WORKTREE_ROOT`, `HARNESS_WORKTREE_TTL_MS`, `HARNESS_WORKTREE_TEST_TIMEOUT_MS`, `HARNESS_A2A_SALIENTE`, `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO`, `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE`, `HARNESS_A2A_TOKEN_RIESGO_CREDITO`, `HARNESS_A2A_TOKEN_KPI_INCIDENTE`, `HARNESS_A2A_REQUEST_TIMEOUT_MS`, `HARNESS_A2A_POLL_INTERVAL_MS`, `HARNESS_A2A_TASK_TIMEOUT_MS`, `VENTA_GRANDE_UMBRAL`, `HARNESS_A2A_ENTRANTE_TOKEN`, `HARNESS_A2A_ENTRANTE_PORT`, `HARNESS_A2A_ENTRANTE_PUBLIC_URL`, `HARNESS_A2A_ENTRANTE_MAX_BODY_BYTES`, `HARNESS_A2A_ENTRANTE_MAX_EN_VUELO`.


## Actualización 2026-09-25 — métricas en `v3.21.0`

*(Las tablas de arriba son de `v3.4.0` y se conservan tal cual. Abajo están las mismas métricas en `HEAD` = `49602b4`, junto a la línea base de `v3.4.0` recalculada con el mismo script para que el Δ sea homogéneo. Ver la nota de método en `09-actualizacion-2026-09-25.md`.)*

### Totales

| Métrica | v3.4.0 (recalculado) | v3.21.0 | Δ |
| --- | ---: | ---: | ---: |
| Líneas `.ts/.tsx` en `src/` | 60 112 | 91 345 | +31 233 |
| Archivos de producción | 126 | 167 | +41 |
| Archivos de test | 116 | 164 | +48 |
| Bloques `it()`/`test()` | 1 691 | 2 728 | +1 037 |
| Bloques `describe()` | 471 | 759 | +288 |
| `src/core/` | 20 291 / 108 archivos | 32 297 / 152 | +12 006 |
| `src/adapters/` | 28 566 / 109 | 38 034 / 137 | +9 468 |
| Raíz de `src/` | 11 255 / 25 | 21 014 / 42 | +9 759 |

### `src/core/` en v3.21.0

| Módulo | Líneas | Archivos | Δ líneas vs v3.4.0 |
| --- | ---: | ---: | ---: |
| `ventas/` | 6 050 | 33 | +1 818 |
| `operaciones/` | 5 899 | 6 | nuevo |
| `turn-selector/` | 4 167 | 15 | +69 |
| `agents/` | 4 081 | 22 | +2 087 |
| `activity/` | 2 610 | 10 | 0 |
| `solicitudes/` | 2 165 | 12 | +658 |
| `commands/` | 1 875 | 4 | +526 |
| `propuestas/` | 1 573 | 8 | 0 |
| `auth/` | 1 115 | 12 | +500 |
| `skills/` | 615 | 6 | 0 |
| `hooks/` | 457 | 6 | +234 |
| `logging/` | 381 | 2 | 0 |
| `startup/` | 355 | 2 | +43 |
| `concurrency/` | 264 | 2 | 0 |
| `hitl/` | 175 | 2 | 0 |
| `knowledge/` | 123 | 2 | 0 |
| `config/` | 111 | 2 | 0 |
| `text/` | 109 | 2 | 0 |
| `actividad/` | 103 | 2 | nuevo |
| `conversacion/` | 69 | 2 | nuevo |

### `src/adapters/` en v3.21.0

| Adaptador | Líneas | Archivos | Δ líneas vs v3.4.0 |
| --- | ---: | ---: | ---: |
| `memory/` | 9 104 | 23 | +1 235 |
| `web/` | 7 356 | 23 | +4 466 |
| `a2a/` | 6 176 | 14 | +416 |
| `tui/` | 2 541 | 7 | +233 |
| `webhooks/` | 2 473 | 10 | +293 |
| `git/` | 1 962 | 10 | 0 |
| `ops/` | 1 618 | 10 | nuevo |
| `knowledge/` | 1 587 | 10 | 0 |
| `board/` | 1 483 | 8 | 0 |
| `test-runner/` | 1 363 | 8 | 0 |
| `operaciones/` | 937 | 2 | nuevo |
| `notificaciones/` | 809 | 6 | 0 |
| `consultas/` | 270 | 2 | nuevo |
| `crypto/` | 266 | 2 | 0 |
| `shared/` | 89 | 2 | 0 |

### Historial de Git en v3.21.0

- **755 commits** (+404). Todos los tags son de `JimmyFung123`. Los 2 commits de otro autor son los de esta evaluación.
- **29 tags** (+17), de `v1.0.0` (2026-08-31) a `v3.21.0` (2026-09-25). **31 días de calendario.**
- **Tipos de commit entre los 404 nuevos:** `feat` 145 · `docs` 104 · `test` 89 · `fix` 22 · `refactor` 20 · `ci` 1 · `build` 1, más 22 merges de PR. Los `test` pasan de 12 a **89**: el paso RED de TDD ahora se commitea por separado.
- **Commits por semana ISO (acumulado):** W35 28 · W36 123 · W37 271 · W38 187 · W39 146 (parcial).
- **Commits por hora del día (acumulado, 0–23 h):** `22 32 18 25 12 5 7 1 17 18 2 17 6 6 24 21 45 68 69 77 73 78 67 45`. Entre los 404 nuevos aparece una franja de tarde (14–16 h, 73 commits) que antes casi no existía; la concentración entre las 17 y las 23 h se mantiene.
- **PRs:** del #16 al #35 en el período (22 merges, uno por hito).

### Documentación en v3.21.0

- `docs/ARC42_Harness_Empresarial.md`: de 691 a **1 023** líneas. ADR más alto: **302**. Desde v3.4 solo se agregaron encabezados propios para los ADR 300–302.
- `docs/Plan_Implementacion_Harness_Empresarial.md`: **419 líneas, sin cambios** desde 2026-09-11.
- `README.md`: de 279 a 397 líneas.
- `openspec/changes/`: de 13 a **29** carpetas. `archive/` y `specs/` siguen vacíos, y v3.17 y v3.18 no tienen carpeta.
- `docs/progreso/`: de 12 a **29** carpetas, más `guia-verificacion-v3.5-v3.8.md`. Hay **1 captura PNG** (v3.20) y, desde v3.13, archivos de mutación.
- Nuevo `vault-conocimiento/`: base de conocimiento en Obsidian con la investigación sintetizada (objetivo 5 de la pasantía, `a115e29`).
- `.claude/skills/`: de 1 a **14** skills.
- Nuevo `.env.example`, con un test de cobertura bidireccional contra el código (v3.12).

### Variables de entorno nuevas

`SESION_INACTIVIDAD_MINUTOS` (v3.12); `HARNESS_DB_PATH`, `HARNESS_HEADLESS`, `HARNESS_SHUTDOWN_TIMEOUT_MS`, `WEB_HOST`, `WEBHOOK_HOST`, `HARNESS_A2A_ENTRANTE_HOST` (v3.17); `OPS_PORT`, `OPS_HOST` (v3.18). `SESION_TTL_MINUTOS` cambió su valor por defecto de 30 a 480. Las variables de v3.17 y v3.18 figuran en `.env.example` pero **no en el `README.md`**.
