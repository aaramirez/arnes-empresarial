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
