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


## Actualización 2026-09-25 — hitos 13 a 29

*(La tabla de arriba cubre hasta `v3.4.0`. El detalle de lo que agregó cada hito está en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md), §3.)*

| # | Tag | Fecha | Nombre del hito | Commits desde el tag anterior |
| --- | --- | --- | --- | ---: |
| 13 | `v3.5.0` | 2026-09-13 | Autorización de empleado (roles) | 18 |
| 14 | `v3.6.0` | 2026-09-13 | Operaciones de negocio conversacionales | 21 |
| 15 | `v3.7.0` | 2026-09-13 | Comandos de administración de empleados | 16 |
| 16 | `v3.8.0` | 2026-09-14 | Consultas de negocio por A2A entrante | 18 |
| 17 | `v3.9.0` | 2026-09-15 | Chat web del empleado | 19 |
| 18 | `v3.10.0` | 2026-09-16 | Aprobación conversacional (HITL) | 38 |
| 19 | `v3.11.0` | 2026-09-17 | Ergonomía del canal del empleado | 6 |
| 20 | `v3.12.0` | 2026-09-19 | Devolución sin token, dos personas | 33 |
| 21 | `v3.13.0` | 2026-09-19 | Conocimiento en el chat del empleado | 12 |
| 22 | `v3.14.0` | 2026-09-20 | Consulta de solicitud propia | 23 |
| 23 | `v3.15.0` | 2026-09-20 | Visibilidad A2A entrante en el chat | 29 |
| 24 | `v3.16.0` | 2026-09-21 | Consulta de KPIs A2A desde el chat | 27 |
| 25 | `v3.17.0` | 2026-09-21 | Modo headless y cierre limpio | 45 |
| 26 | `v3.18.0` | 2026-09-22 | Salud operativa | 35 |
| 27 | `v3.19.0` | 2026-09-23 | Operaciones de negocio en la TUI | 23 |
| 28 | `v3.20.0` | 2026-09-24 | Enmascarar clave en la TUI | 19 |
| 29 | `v3.21.0` | 2026-09-25 | Reembolso neto en el reporte de comisiones | 22 |

Total acumulado: **755 commits, 29 tags, 31 días de calendario** (26/08 → 25/09).

**Desvíos frente al plan, actualizados:** los 17 hitos nuevos **no figuran** en `docs/Plan_Implementacion_Harness_Empresarial.md`, que no cambia desde `ed3eba6` (2026-09-11). En la primera pasada el plan documentaba activamente sus propios desvíos; en este período dejó de hacerlo. Ninguno de los 17 hitos tiene un caso de uso formal propio en la lista de "Casos de Uso Empresariales". Varios profundizan casos de uso que ya existían (aprobación de solicitud interna, devolución/reembolso, consolidado de KPIs, agente externo consultando el arnés); v3.17 y v3.18 son infraestructura sin caso de uso asociado.

**Ritmo de commits por día, 12/09 → 25/09:**

```
2026-09-12   2     2026-09-19  34
2026-09-13  69  ← 3 tags (v3.5–v3.7)
2026-09-14  17     2026-09-20  56
2026-09-15  18     2026-09-21  60  ← pico (v3.16 + v3.17)
2026-09-16  24     2026-09-22  22
2026-09-17  37     2026-09-23  23
2026-09-18   1     2026-09-24  38
                   2026-09-25   3
```

Por semana ISO: W35 28 · W36 123 · W37 271 · W38 187 · W39 146 (parcial). Después del pico de W37 el ritmo baja un poco, pero casi todos los días sigue por encima de 20 commits. El único día prácticamente sin actividad es el 18/09.
