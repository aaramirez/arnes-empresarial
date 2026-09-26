# ¿Es esto la base de un arnés empresarial?

Pregunta directa, respuesta directa: **como patrón arquitectónico y motor de orquestación multi-agente, sí — es una base sólida y genuinamente reutilizable. Como plataforma operable a escala de empresa real, no todavía, y el propio proyecto lo admite por escrito.** El resto de este documento sustenta esa respuesta criterio por criterio, con evidencia verificable en el repo — no solo con el veredicto del propio equipo.

Se evalúan diez dimensiones que cualquier sistema que se llame "empresarial" tiene que sostener tarde o temprano: extensibilidad, corrección del dominio, persistencia/escala, multi-tenencia, seguridad, observabilidad, confiabilidad operacional, calidad de ingeniería, despliegue/operación, y madurez del patrón multi-agente en sí. Cada una con veredicto (**fuerte** / **parcial** / **débil**) y evidencia concreta.

## Resumen ejecutivo

| Dimensión | Veredicto | En una frase |
| --- | --- | --- |
| Extensibilidad arquitectónica | 🟢 Fuerte | Hexagonal real, verificado por grafo de imports, no por lectura |
| Corrección del dominio de negocio | 🟢 Fuerte | Máquinas de estado, CAS, casos borde tratados como decisiones explícitas |
| Persistencia y escala | 🔴 Débil | Un archivo SQLite, un proceso, sin story de escalamiento horizontal |
| Multi-tenencia / gobernanza | 🔴 Débil | Descartada por diseño explícito — no es un descuido, es alcance declarado |
| Seguridad | 🟡 Parcial | Buenas prácticas puntuales (timing-safe, HMAC, scrypt) sin una capa de RBAC ni rate-limiting |
| Observabilidad | 🟡 Parcial | Correlación por `casoId` real; sin métricas, sin tracing, sin rotación de logs |
| Confiabilidad operacional | 🟡 Parcial | Buena degradación local (nunca-rechaza en los puertos); sin retries/circuit breakers a nivel sistema |
| Calidad de ingeniería (tests) | 🟢 Fuerte | ~1 test por archivo de producción, TDD real, bugs encontrados en integración |
| Despliegue y operación | 🔴 Débil | Sin CI/CD, sin contenedor, sin supervisor de proceso, sin plan de backup |
| Madurez del patrón multi-agente | 🟢 Fuerte | Subagentes con profundidad 1 verificada, A2A validado contra agentes externos reales |

## 1. Extensibilidad arquitectónica — 🟢 Fuerte

No es una afirmación de marketing del propio README: el grafo de imports real (`07-mapa-modulos.md`) confirma **cero aristas `core → adapters`** y cero acoplamiento adaptador↔adaptador salvo una excepción documentada. Se agregaron 9 adaptadores a lo largo de 12 hitos (TUI, conocimiento, memoria, A2A, webhooks, tablero, web, git, test-runner) sin que ninguno tocara la forma de otro. Esta es la meta de calidad #1 que el propio arc42 se propuso ("cero cambios fuera de `src/core/agents/` para agregar un agente") y hay evidencia mecánica de que se sostuvo, no solo prosa que lo afirma.

## 2. Corrección del dominio de negocio — 🟢 Fuerte

`src/core/ventas/` es el módulo de dominio más grande del repo y trata casos borde como decisiones explícitas y documentadas, no como accidentes: el borde `>=` vs `>` en la escalación de reembolso, el uso de `.slice(0,7)` sobre ISO-8601 para evitar que un huso horario cambie el mes de una comisión, la respuesta indistinguible entre token vencido/inexistente. Las transiciones de estado (ventas, solicitudes, propuestas, actividades) son *compare-and-swap* reales contra SQLite, no un `if` en memoria — correctas bajo escritura concurrente dentro del límite de un único proceso.

## 3. Persistencia y escala — 🔴 Débil

Este es el punto donde la etiqueta "empresarial" choca más fuerte con la realidad técnica. El arnés persiste **todo** su estado de negocio (casos, ventas, solicitudes, delegaciones, propuestas de cambio, solicitudes A2A entrantes) en **un único archivo SQLite, dentro de un único proceso Node.js**, con modo WAL para lectores concurrentes pero un solo escritor real. No hay:

- Story de replicación, backup automático ni recuperación ante desastre para `data/harness.db`.
- Camino de migración a un motor de servidor (Postgres, etc.) — es una decisión de alcance explícita del MVP (`Meta 4: Operabilidad local`), no un olvido, pero sigue siendo el techo real de escala.
- Evidencia de carga real: el propio arc42 marca el Riesgo 2 (concurrencia bajo múltiples fuentes A2A + webhooks) como **"confirmado, sin materializarse"** — probado con 3 `SendMessage` concurrentes + 1 webhook, un volumen de laboratorio, no de producción.

Una "empresa" real, con múltiples equipos o alto volumen concurrente, necesitaría resolver esto antes de operar en serio — y el propio diseño lo sabe (Riesgo 1 y 2 del arc42 quedan explícitamente sin resolver, no ocultos).

## 4. Multi-tenencia y gobernanza — 🔴 Débil (por diseño, no por descuido)

`docs/ARC42_Harness_Empresarial.md`, sección de Restricciones Organizacionales, lo dice con estas palabras: *"Duración fija de una pasantía corta [...] es la razón de fondo por la que se descarta la gobernanza/multi-tenencia en las metas de calidad."* Esto es la evidencia más honesta de todo el repo sobre esta dimensión — el equipo no afirma haber resuelto multi-tenencia, la excluye explícitamente del alcance. Consecuencias concretas verificadas en el código:

- No existe un concepto de "organización" ni "equipo" — todos los empleados comparten el mismo espacio de datos plano.
- Autorización = un único campo booleano `privilegiado` en el descriptor de comando (`comando-empleado.ts`) — no hay roles, permisos granulares ni jerarquía. Confirmado por grep: no hay ningún concepto de "rol" o "role" en `src/core/auth/`.
- La sesión de empleado vive **solo en memoria del proceso** — reiniciar el arnés desloguea a todo el mundo; no hay noción de sesiones concurrentes de distintos operadores sobre el mismo proceso.

## 5. Seguridad — 🟡 Parcial

Lo implementado es de buena calidad puntual: comparaciones `timingSafeEqual` con chequeo de longitud previo en los tres puntos de autenticación Bearer (A2A, Web, y HMAC de Webhooks); mitigación real de timing attack en login (hash dummy con los mismos parámetros de costo); hashing de contraseñas con scrypt autodescriptivo y guarda anti-DoS contra un `N` de costo manipulado; ningún secreto (token, password) llega jamás a un log, verificado a nivel de tipo en `AccionEmpleado`. Pero:

- **Cero rate-limiting** en ningún endpoint HTTP expuesto (confirmado por grep: cero menciones de "rate limit" en todo `src/`) — el propio código de login documenta que su mitigación de timing attack "habilita a un atacante sin credenciales a forzar trabajo de CPU sostenido" precisamente porque no hay una capa de límite de intentos por encima.
- Autenticación es un único token compartido por integración (un token Bearer para A2A entrante, uno para `/ventas`, un secreto HMAC para webhooks) — no hay identidad por-llamador, ni rotación, ni expiración de esos tokens.
- El protocolo A2A v1.0.0 en sí no transporta identidad verificable del emisor externo, y el arnés no compensa eso con una capa propia — lo documenta honestamente (`agente_externo_url` es siempre `NULL`).

Es seguridad de "buenas prácticas de desarrollador", no de "plataforma con superficie de ataque de producción evaluada".

## 6. Observabilidad — 🟡 Parcial

Hay una convención real de correlación (`casoId` como parámetro obligatorio en `logTurnEvent`, no un campo opcional) y un log estructurado en JSON a archivo. Pero es observabilidad de un solo proceso en un solo archivo: sin rotación (confirmado: cero menciones de "rotat"/"logrotate" en el código), sin métricas (no hay integración con Prometheus/OpenTelemetry ni equivalente), sin tracing distribuido, sin dashboard. Suficiente para depurar un incidente puntual leyendo el archivo; insuficiente para operar un sistema en producción con SLOs.

## 7. Confiabilidad operacional — 🟡 Parcial

El patrón de "puertos que nunca rechazan" (tablero, notificador, cliente A2A, feedback de conocimiento) es una forma real de resiliencia de aplicación — un fallo de GitHub o de Graphify no tumba un turno. Pero el propio arc42 lo señala como Deuda 1 **sin resolver**: *"no fija todavía la política concreta [de reintentos/timeouts/degradación]"*. No hay circuit breakers, no hay colas de reintento para una entrega A2A o un webhook fallido más allá de lo que ya haga el emisor externo, y el barrido de worktrees huérfanos es la única forma de auto-recuperación que existe — puntual, no un mecanismo general.

## 8. Calidad de ingeniería — 🟢 Fuerte

Esta es la dimensión donde el proyecto más se acerca a un estándar profesional real: 116 archivos de test para 127 de producción, 1618 bloques de test, TDD verificado no solo declarado (al menos un caso de TDD simulado fue detectado y rechazado por el Reviewer, ver `05-proceso-sdd.md`), y — más importante — **varios bugs reales encontrados solo por pruebas de integración contra sistemas reales**, no por unit tests con dobles: el separador de ruta de `git` en Windows, el reporter inexistente de Vitest 4.x, el header `A2A-Version` faltante verificado contra un agente A2A real, el `--` que rompía todas las consultas de Graphify. Esa disciplina de "verificar contra lo real, no confiar en el mock" es la señal más fuerte de ingeniería madura en todo el repo.

## 9. Despliegue y operación — 🔴 Débil

Verificado por inspección directa: no existe carpeta `.github/workflows/`, ni `Dockerfile`, ni `docker-compose.yml`, ni ningún YAML de CI/CD en el repo (la única excepción es un `openspec/config.yaml`, configuración de la herramienta de diseño, no de despliegue). `package.json` no tiene script de `start` de producción, ni de migración explícita fuera de lo que corre `main.ts` al arrancar. Operar esto en producción hoy significa: clonar el repo, poner un `.env`, y correr `tsx src/main.ts` a mano en una máquina — sin supervisor de proceso (`pm2`/`systemd`), sin healthcheck, sin estrategia de rolling restart. Es, otra vez, coherente con la Meta 4 declarada ("operabilidad local"), pero es lo opuesto de lo que "empresarial" suele significar en el sentido de infraestructura.

## 10. Madurez del patrón multi-agente — 🟢 Fuerte

Esta es, probablemente, la parte más valiosa y más genuinamente "de harness" de todo el proyecto — la que justifica mejor la palabra "arnés": el registro de agentes/subagentes con control de seguridad por tool-granting explícito, la delegación con profundidad 1 estructuralmente forzada (ningún subagente tiene `Agent`/`Task` en su toolset), los hooks de ciclo de vida, el sistema de skills descubierto desde disco con tres límites de contenido auditados, y el protocolo A2A implementado en ambos sentidos (cliente y servidor) **y validado contra implementaciones externas reales** (samples oficiales de `a2aproject/a2a-samples`, con bugs de interoperabilidad reales encontrados y corregidos). Esta parte del sistema no es un prototipo de juguete — es una implementación fiel y verificada de un protocolo estándar de comunicación entre agentes.

## Conclusión

La palabra "empresarial" en el nombre del proyecto se sostiene en el sentido de **patrón**: un arnés de agentes con arquitectura hexagonal disciplinada, dominio de negocio real (ventas, solicitudes, revisión de PRs) y comunicación A2A verificada contra agentes externos — todo eso es una base genuinamente reutilizable para construir sobre ella. No se sostiene todavía en el sentido de **plataforma operable**: un solo proceso, un solo archivo SQLite, sin CI/CD, sin RBAC más allá de un booleano, sin story de escalamiento. Y esto último no es un hallazgo oculto de esta auditoría — es exactamente lo que el propio arc42 declara como fuera de alcance de una "pasantía corta". La pregunta que vale la pena hacerle al pasante no es "¿por qué no resolviste esto?", sino **"¿cuál de estas cinco brechas (persistencia, multi-tenencia, seguridad de plataforma, observabilidad, despliegue) elegirías atacar primero si este arnés tuviera que sostener una segunda empresa real mañana?"** — la arquitectura de puertos y adaptadores que ya existe está, de hecho, diseñada para que esa siguiente etapa sea una extensión y no una reescritura.


## Actualización 2026-09-25 — el veredicto, revisado

*(Lo anterior es el veredicto sobre `v3.4.0` y se conserva completo. Detalle y evidencia en [`09-actualizacion-2026-09-25.md`](09-actualizacion-2026-09-25.md), §6.)*

| Dimensión | 2026-09-12 | 2026-09-25 | Qué la movió |
| --- | --- | --- | --- |
| Extensibilidad arquitectónica | 🟢 Fuerte | 🟢 Fuerte *(con alerta)* | Se sostienen las 0 aristas `core→adapters`; la alerta son los ciclos nuevos entre módulos del núcleo y el fan-in 16 de `core/agents` |
| Corrección del dominio | 🟢 Fuerte | 🟢 Fuerte | Separación de funciones, autoaprobación prohibida, reporte neto de reembolsos con ADR propio |
| Persistencia y escala | 🔴 Débil | 🔴 Débil | Sin cambios de fondo; solo se volvió configurable la ruta (`HARNESS_DB_PATH`) |
| Multi-tenencia / gobernanza | 🔴 Débil | **🟡 Parcial** | Roles `empleado`/`administrador`, gate de administrador, auditoría de rechazos. Sigue sin haber multi-tenencia (por diseño) |
| Seguridad | 🟡 Parcial | 🟡 Parcial *(mejor)* | A favor: CSP en el chat, sesión con TTL e inactividad, clave enmascarada, marco contra inyección de prompt en texto externo. En contra: sigue sin rate-limiting (`login.ts:38`), los tokens siguen compartidos y el endpoint `ops` no tiene autenticación |
| Observabilidad | 🟡 Parcial | 🟡 Parcial | A favor: liveness/readiness y hooks de log PRE/POST_TURN. En contra: sin métricas, tracing ni rotación |
| Confiabilidad operacional | 🟡 Parcial | 🟡 Parcial *(mejor)* | A favor: cierre ordenado con presupuesto y watchdog, readiness. En contra: la Deuda 1 sigue abierta y los turnos de la TUI quedan fuera del drenaje (hallazgo 9.1 de v3.19) |
| Calidad de ingeniería | 🟢 Fuerte | 🟢 Fuerte *(reforzada)* | +1 037 tests, pruebas de mutación, commits RED separados, CI |
| Despliegue y operación | 🔴 Débil | **🟡 Parcial** | CI (typecheck + test + build), build de producción, `npm start`, modo headless, healthchecks. Faltan contenedor, supervisor de proceso y backup |
| Madurez multi-agente | 🟢 Fuerte | 🟢 Fuerte | A2A saliente desde el chat con catálogo cerrado; A2A entrante con consultas de negocio de solo lectura |

**Conclusión, actualizada.** De tres dimensiones en rojo se pasó a una. La pregunta que cerraba este documento (*"¿cuál de estas cinco brechas elegirías atacar primero?"*) ya tiene una respuesta en los hechos: el pasante atacó **gobernanza** (v3.5, v3.7, v3.10, v3.12) y **despliegue/operación** (CI, v3.17, v3.18), y dejó **persistencia** para un change que por ahora solo existe como referencia (`respaldo-y-durabilidad-sqlite`). La etiqueta "empresarial" se sostiene hoy un poco mejor también en el sentido de *plataforma*: el arnés puede correr sin terminal, reportar su salud y apagarse limpio. El techo real sigue siendo el mismo: **un archivo SQLite dentro de un proceso, sin backup**.

La nueva pregunta para el pasante es de proceso más que de arquitectura: *¿cómo se reconstruye, dentro de seis meses, por qué v3.17 y v3.18 se diseñaron como se diseñaron, si sus `design.md` no están en el repo y el plan maestro no los menciona?*
