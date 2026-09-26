# Diagramas del arnés (v3.21.0)

Quince diagramas interactivos generados con [Archify](https://github.com/tt-a1i/archify) (`9e35d2b`, v2.17.0-dev.1) a partir de fuentes JSON tipadas, sobre el repo en `49602b4` (`v3.21.0`). Cada HTML es autocontenido: se abre directo en el navegador, sin instalar nada. Trae pan/zoom, búsqueda, vistas guiadas, tema claro/oscuro y exportación a PNG/SVG.

Los hechos de cada diagrama salen de un trazado del código con referencias `archivo:línea`, no de la documentación. Los diagramas de arquitectura enlazan cada componente a su archivo en GitHub, en la revisión `49602b4`.

## Arquitectura y estructura

| Diagrama | Tipo | Qué muestra |
| --- | --- | --- |
| [`arquitectura-runtime.html`](arquitectura-runtime.html) | Arquitectura | Los 12 bloques de runtime dentro del proceso único (`main.ts`): canales de entrada, núcleo `turn-selector`, Claude Agent SDK, tools MCP in-process, SQLite y `ops` |
| [`mapa-modulos-nucleo.html`](mapa-modulos-nucleo.html) | Arquitectura | Dependencias reales entre los módulos principales de `core/` (del grafo de imports): los ciclos nuevos `agents ↔ operaciones` y `agents ↔ solicitudes`, el hub `core/agents` (fan-in 16) y `core/auth` (fan-in 11) |
| [`composition-roots.html`](composition-roots.html) | Arquitectura | Los 8 `build-on-*.ts` que instancia `main.ts`, su fan-out y los imports cruzados entre ellos (`comando ↔ activity`) |
| [`delta-v3.4-a-v3.21.html`](delta-v3.4-a-v3.21.html) | Architecture Delta | Comparación antes/después generada por `archify compare`: 3 elementos agregados (el adaptador `ops` y 2 conexiones), 7 cambios y 0 eliminados. Tiene pestañas Before / Delta / After y un modo de revisión paso a paso |

## Máquinas de estado del dominio

| Diagrama | Tipo | Qué muestra |
| --- | --- | --- |
| [`estados-venta.html`](estados-venta.html) | Lifecycle | `pendiente_confirmacion → confirmada → reembolso_pendiente → reembolsada`, con `rechazada` y el ciclo `reembolso_rechazado ↔ reembolso_pendiente` (reabrir). La escalación de reembolso no es una entidad aparte: son estados de la propia venta |
| [`estados-solicitud-interna.html`](estados-solicitud-interna.html) | Lifecycle | `pendiente_aprobacion_humana` → `aprobada` / `rechazada` (solo un administrador que no sea el solicitante) / `cancelada` (solo el autor) |
| [`estados-tarea-a2a.html`](estados-tarea-a2a.html) | Lifecycle | `SUBMITTED → WORKING → COMPLETED`, con `FAILED`, `CANCELED` (CancelTask) y `REJECTED` (sin cupo) |

## Flujos y procesos

| Diagrama | Tipo | Qué muestra |
| --- | --- | --- |
| [`flujo-venta-comision-reporte.html`](flujo-venta-comision-reporte.html) | Dataflow | De `registrar_venta` / `POST /ventas` al email de confirmación, a la comisión (que nace en la misma transacción que la confirmación, al 10 %) y al reporte neto de reembolsos. A2A recibe solo agregados |
| [`cadena-revision-prs.html`](cadena-revision-prs.html) | Workflow | Webhook de GitHub (HMAC + anti-loop) → orquestador → Planner → Developer (worktree aislado + vitest) → Reviewer → veredicto → comentario y labels. El patch solo se aplica con `/aplicar-propuesta` y nunca se pushea |
| [`proceso-sdd.html`](proceso-sdd.html) | Workflow | El ciclo de `AGENTS.md`: Spec Author → checkpoint humano → Implementer → Reviewer → merge + tag, con los dos loops de rechazo |

## Secuencias

| Diagrama | Qué muestra |
| --- | --- |
| [`secuencia-operacion-turno1-pedido.html`](secuencia-operacion-turno1-pedido.html) | Operación en dos turnos (1/2): se pide `resolver_solicitud`, `estaConfirmada` da `false`, se reserva la ranura y se pide confirmar |
| [`secuencia-operacion-turno2-confirmacion.html`](secuencia-operacion-turno2-confirmacion.html) | Operación en dos turnos (2/2): otro `casoId` confirma y corren el gate de rol, el CAS y la auditoría en una sola transacción |
| [`secuencia-a2a-1-envio-y-estado.html`](secuencia-a2a-1-envio-y-estado.html) | A2A entrante (1/2): `SendMessage` devuelve `SUBMITTED` al instante; `GetTask` lee el estado persistido |
| [`secuencia-a2a-2-turno-asincrono.html`](secuencia-a2a-2-turno-asincrono.html) | A2A entrante (2/2): el turno asíncrono de solo lectura |
| [`secuencia-cierre-headless.html`](secuencia-cierre-headless.html) | Cierre ordenado headless: SIGTERM, watchdog, readiness 503, drenaje, cierre de SQLite y `exit 0`, con el gap 9.1 de la TUI |

## Cómo se generaron y verificaron

- `fuentes/*.json`: fuentes tipadas. Editarlas y regenerar es la forma de iterar. `delta-v3.4` y `delta-v3.21` son las dos fotos que alimentan la comparación.
- **Validación**: `archify validate <tipo> <fuente> --quality showcase` aprobó las 16 fuentes con 9/9 checks, 0 errores y 0 warnings de composición.
- **Entrega**: `archify deliver`, con exit 0 en los 14 diagramas y recibo SHA-256. El delta sale de `archify compare`, también con exit 0.
- **Navegador**: `archify visual-check` en Chrome real, a 1440×900, 1600×1000, 1920×1080 y 2048×1320, en tema claro y oscuro. Pasan **14 de 15** sin desborde. El que no pasa es el delta: su plantilla de revisión propia (encabezado, pestañas y panel de cambios, con textos fijos en inglés) desborda en vertical por diseño, y desde la fuente no se puede compactar. Capturas y recibos en [`evidencia-visual/`](evidencia-visual/).
- **Revisión visual**: la hizo el agente sobre las capturas, no una persona. En `estados-venta` las transiciones `rechazar` y `reabrir` se dibujan sobre la misma vertical, con una etiqueta a cada lado.

**Decisiones de forma:**

- Las secuencias largas se partieron en su costura natural en vez de achicar el texto por debajo del mínimo legible.
- En los lifecycles, las transiciones del carril principal las dibuja el propio riel del renderer, y su detalle va en las cards.
- En los ciclos de vida, los literales exactos (`pendiente_confirmacion`, `reembolso_pendiente`, `…_aprobacion_humana`) van como subetiqueta cuando no entran como título.

**Idioma:** todo el contenido está en español. La interfaz fija del visor (leyenda, botones, accesibilidad) queda en inglés, porque Archify solo la localiza a `en` o `zh-CN`.

## Regenerar

Con Archify clonado en `<archify>` y parado en esta carpeta:

```bash
node <archify>/archify/bin/archify.mjs deliver architecture fuentes/<nombre>.architecture.json <nombre>.html --quality showcase --repo-root ../..
node <archify>/archify/bin/archify.mjs deliver <sequence|workflow|lifecycle|dataflow> fuentes/<nombre>.<tipo>.json <nombre>.html --quality showcase
node <archify>/archify/bin/archify.mjs compare architecture fuentes/delta-v3.4.architecture.json fuentes/delta-v3.21.architecture.json delta-v3.4-a-v3.21.html --quality showcase
```
