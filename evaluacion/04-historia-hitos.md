# Historia real de hitos

Fuente: `git tag`, `git log`, `docs/Plan_Implementacion_Harness_Empresarial.md` (sección "Estado real de ejecución", actualizada 2026-09-11) y `docs/progreso/`.

## Línea de tiempo tageada

| # | Tag | Fecha (commit del tag) | Nombre del hito | Commits desde el tag anterior |
| --- | --- | --- | --- | --- |
| 1 | `v1.0.0` | 2026-08-31 | Esqueleto conversacional | 31 |
| 2 | `v1.1.0` | 2026-09-01 | Consulta de conocimiento | 16 |
| 3 | `v1.2.0` | 2026-09-03 | Bot de revisión de PRs | 32 |
| — | *(sin tag)* | — | Ventas y comisiones (v1.3) — **rechazado como cierre independiente** | — |
| 4 | `v1.4.0` | 2026-09-06 | TUI canal empleado (absorbió el entregable de v1.3) | 59 |
| 5 | `v2.0.0` | 2026-09-07 | Delegación a subagentes | 26 |
| 6 | `v2.1.0` | 2026-09-08 | Escritura delegada (no contemplado en el plan original) | 56 |
| 7 | `v2.2.0` | 2026-09-09 | Comunicación A2A saliente (cliente) | 39 |
| 8 | `v3.0.0` | 2026-09-10 | Comunicación A2A entrante (servidor) | 22 |
| 9 | `v3.1.0` | 2026-09-10 | Definición de Skills | 17 |
| 10 | `v3.2.0` | 2026-09-11 | Comando `/reporte-comisiones` | 12 |
| 11 | `v3.3.0` | 2026-09-11 | Comando `/cancelar-solicitud` | 23 |
| 12 | `v3.4.0` | 2026-09-11 | Comando `/ver-solicitudes-a2a` (visibilidad A2A entrante) | 18 |

Total: **351 commits**, un solo autor (`JimmyFung123`), **12 tags** en **17 días de calendario** (26 de agosto al 11 de septiembre de 2026) — el primer commit es del 26/08, el primer tag del 31/08.

## Desvíos frente al plan original

`docs/Plan_Implementacion_Harness_Empresarial.md` fijó 7 hitos numerados. La ejecución real se desvió en dos formas documentadas explícitamente en el propio plan (sección "Estado real de ejecución"):

1. **Hito 4 (v1.3.0 — Ventas y comisiones) nunca se tageó.** El checkpoint humano determinó que el resultado no cumplía el estándar del Reviewer y no lo cerró como hito independiente; el entregable de ventas/comisiones quedó demostrado dentro de la evidencia de `v1.4.0`. Ver detalle completo en `05-proceso-sdd.md` y `openspec/changes/hito-1.3-ventas-comisiones/NOTA-CIERRE.md`.
2. **Se insertaron 5 hitos no contemplados en el plan original**: `v1.4.0` (tui-canal-empleado), `v2.1.0` (escritura-delegada) y la tanda `v3.1.0`–`v3.4.0` (definición de skills, dos comandos de negocio y un comando de visibilidad A2A). Esto corrió la numeración de los tags planeados: el Hito 6 del plan ("Comunicación A2A saliente") estaba previsto como `v2.1.0` y terminó siendo `v2.2.0` porque `v2.1.0` ya estaba tomado por `escritura-delegada`.

El plan documenta esto activamente (no es un hallazgo de esta auditoría, es una nota que el propio equipo mantiene actualizada) — señal de que la trazabilidad plan↔ejecución se toma en serio incluso cuando la ejecución se aparta del guion.

## Ritmo de commits por día

```
2026-08-26   5     2026-09-04  26
2026-08-27   6     2026-09-05  28
2026-08-28   4     2026-09-06  18
2026-08-29   2     2026-09-07  57   ← pico (cierre v2.0.0)
2026-08-30  11     2026-09-08  30
2026-08-31  17     2026-09-09  42
2026-09-01  12     2026-09-10  24
2026-09-02  16     2026-09-11  47   ← 4 tags el mismo día (v3.1–v3.4)
2026-09-03   6
```

El ritmo casi se duplica en la segunda mitad del proyecto (semana ISO 37: 200 commits vs. 28 en la semana 35) — coherente con hitos cada vez más chicos y enfocados (comandos puntuales) en la fase v3, en vez de bloques de arquitectura nuevos como en v1/v2.

## Los 12 casos de uso empresariales que el plan se propuso demostrar

Agrupados por el hito que los cierra (`docs/Plan_Implementacion_Harness_Empresarial.md`, sección "Casos de Uso Empresariales"):

- **Hito 2 (conocimiento)**: consulta de política interna · consulta gerencial con historial · onboarding de empleado nuevo.
- **Hito 3 (PRs)**: bot de revisión de PRs · aprobación de solicitud interna · gestión de incidentes de IT.
- **Hito 4 (ventas)**: confirmación de venta y comisión · soporte por web · devolución/reembolso.
- **Hito 5 (subagentes)**: bot de PRs con roles (Planner/Developer/Reviewer) · solicitud interna con HITL.
- **Hito 6 (A2A saliente)**: incidente técnico coordinado · consolidado ejecutivo de KPIs · riesgo/crédito antes de venta grande.
- **Hito 7 (A2A entrante)**: agente externo (ej. Compras) consultando el arnés.

Los cuatro hitos "extra" de la fase v3 (skills, reporte de comisiones, cancelar solicitud, visibilidad A2A) no estaban en esta lista original — son extensiones reales del alcance que el plan reconoce como pendientes de formalizar con su propio caso de uso.
