# Evaluación del repo `arnes-empresarial`

Estudio técnico independiente del repositorio, generado el 2026-09-12 a partir del código fuente, la documentación versionada (`docs/`, `AGENTS.md`, `README.md`), el rastro de diseño (`openspec/`) y el historial de Git. Excluye deliberadamente el contenido interno de `.git/` (se usa solo su metadata vía comandos `git log`/`git tag`).

Este proyecto es una pasantía corta: **Alexander Ramírez** (`ar@conectados.ai`) es el tutor empresarial, **Jimmy Fung** es el único desarrollador. El objetivo de esta carpeta es dar al tutor una vista de conjunto — qué se construyó, cómo, en qué orden y con qué rigor de proceso — sin tener que reconstruirla leyendo 351 commits y ~40k líneas a mano.

## Cómo leer esta carpeta

| Documento | Contenido |
| --- | --- |
| [`01-arquitectura.md`](01-arquitectura.md) | Qué es el sistema, arquitectura hexagonal, bloques e interfaces |
| [`02-nucleo.md`](02-nucleo.md) | Análisis técnico de `src/core/` (orquestación, dominio de negocio) |
| [`03-adaptadores.md`](03-adaptadores.md) | Análisis técnico de `src/adapters/` (integraciones externas) |
| [`04-historia-hitos.md`](04-historia-hitos.md) | Línea de tiempo real de los 12 hitos tageados, desvíos vs. lo planeado |
| [`05-proceso-sdd.md`](05-proceso-sdd.md) | Auditoría del proceso Spec Author → Checkpoint → Implementer → Reviewer |
| [`06-metricas.md`](06-metricas.md) | Todos los números crudos (LOC, commits, tests) que alimentan los gráficos |
| [`07-mapa-modulos.md`](07-mapa-modulos.md) | Grafo de dependencias real entre módulos (extraído mecánicamente de los imports) |
| [`08-evaluacion-empresarial.md`](08-evaluacion-empresarial.md) | Veredicto crítico: ¿es esto la base de un arnés *empresarial*, en serio? |
| [`dashboard.html`](dashboard.html) | Artefacto visual 1/3 — arquitectura, módulos y métricas de código |
| [`proceso.html`](proceso.html) | Artefacto visual 2/3 — auditoría del proceso Spec Author/Checkpoint/Implementer/Reviewer |
| [`mapa-modulos.html`](mapa-modulos.html) | Artefacto visual 3/3 — grafo de dependencias y scorecard de madurez empresarial |
| [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md) | **Actualización 2026-09-25** — delta v3.4.0 → v3.21.0: 17 hitos nuevos, métricas antes/después, conclusiones corregidas y nuevas |
| [`cambios.html`](cambios.html) | Artefacto visual 4/4 (agregado 2026-09-25) — comparativo antes/después |
| [`diagramas/`](diagramas/) | 15 diagramas Archify (agregado 2026-09-25): arquitectura, módulos, composition roots, delta v3.4→v3.21, máquinas de estado, flujo de datos, workflows y secuencias |

Los tres HTML están también publicados como Artifact interactivo (enlazados entre sí): **https://claude.ai/code/artifact/c3f4b54e-3316-4e9a-8a2d-3d953f2bdc97** — abrí ese link para navegarlos con gráficos interactivos (hover, tema claro/oscuro); los archivos de esta carpeta son la copia versionada del mismo contenido.

## Resumen de una línea

Arnés (harness) de agentes de IA en TypeScript sobre el Claude Agent SDK, arquitectura hexagonal estricta (núcleo sin dependencia de adaptadores, verificado), que en ~17 días de desarrollo (26 ago – 11 sep 2026) acumuló 351 commits, 12 hitos tageados (v1.0.0 → v3.4.0), ~40k líneas de TypeScript (127 archivos de producción + 116 de test, 1618 tests) y un rastro de diseño completo en `openspec/` para cada hito — con al menos un hito (v1.3, ventas y comisiones) rechazado explícitamente por el checkpoint humano y reabsorbido en el siguiente.


## Actualización 2026-09-25

Segunda pasada del estudio, con `HEAD` en `49602b4` (merge del PR #35, `v3.21.0`). **Todo lo anterior de esta carpeta se conserva sin cambios** y describe el repo en `v3.4.0`. Cada documento `01`–`08` recibió al final una sección *"Actualización 2026-09-25"* con lo que cambió en su tema. El delta completo está en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md) y su versión visual en [`cambios.html`](cambios.html).

**Resumen de una línea, actualizado:** en 13 días más (12 → 25 de septiembre) el repo pasó de 351 a **755 commits** y de 12 a **29 tags** (`v3.5.0` → `v3.21.0`), y sumó ~31 000 líneas (60 112 → 91 345 en `src/`) y ~1 000 tests (1 691 → 2 728 bloques `it`/`test`). Giró de construir el motor a operar el negocio por conversación (tool única de operaciones, roles, chat web) y a preparar el despliegue (CI, modo headless, cierre ordenado, healthchecks). La regla hexagonal sigue intacta. Mejoró el rigor de verificación (mutación, matrices criterio→evidencia) y retrocedió la trazabilidad: dos hitos sin `openspec/`, el plan maestro congelado desde el 11/09 y colisiones de numeración de ADRs.
