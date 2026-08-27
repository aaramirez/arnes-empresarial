# AGENTS.md

Instrucciones para cualquier agente de IA (Claude Code, Cursor, Copilot, etc.) que trabaje en este repositorio. Complementa a [`README.md`](README.md); la arquitectura completa vive en [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md) y el plan de construcción en [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md).

## Reglas técnicas no negociables

Estas decisiones ya están tomadas (ver arc42, Restricciones de la Arquitectura y Sección de Decisiones de Diseño). Ningún agente debe reabrirlas sin pasar por el rol **Spec Author**:

- Lenguaje: TypeScript sobre Node.js 18+.
- Motor de agentes: Claude Agent SDK — sin abstracción de proveedor de modelo en el MVP.
- Arquitectura: hexagonal, monolito modular de un solo paquete (`src/core/` + `src/adapters/*`).
  - `src/core/` nunca importa nada de `src/adapters/*`.
  - Ningún adaptador se comunica directamente con otro adaptador — todo pasa por el núcleo.
- Persistencia: SQLite embebido, sin servidor.
- Interfaz: TUI vía Ink.
- Comunicación entre agentes: protocolo A2A (JSON-RPC).

## Flujo de trabajo con IA: tres roles

Exigencia del tutor empresarial: *"el diseño precede a la implementación"*. Este repo lo implementa como tres roles con responsabilidades separadas — no es negociable que un mismo paso salte roles.

### 1. Spec Author

**Responsabilidad**: por cada hito del [Plan de Implementación](docs/Plan_Implementacion_Harness_Empresarial.md), produce el contrato de lo que se va a construir antes de que se toque una línea de código.

- **Entra con**: el hito correspondiente del plan, los bloques/interfaces del arc42 que involucra, y los hallazgos de hitos previos.
- **Produce**: especificación de requisitos, diseño técnico (ADR si hay una decisión de arquitectura real) y lista de tareas ordenadas.
- **No hace**: no escribe código de producción, no corre tests, no evalúa si un hito anterior quedó bien implementado.
- **Skills a usar**: `sdd-new` (arranca exploración + propuesta) seguido de `sdd-ff` (adelanta propuesta → specs → diseño → tareas de una vez) o `sdd-continue` (fase por fase, si querés revisar cada una). `sdd-propose`/`sdd-spec`/`sdd-design`/`sdd-tasks` no son skills invocables directamente — son sub-agentes que esos comandos usan por dentro.
- **Prerequisito**: `sdd-init` debe haber corrido una vez en el proyecto (detecta stack, activa TDD estricto si aplica). Si no corrió, `sdd-new`/`sdd-ff`/`sdd-continue` lo disparan automáticamente antes de seguir.
- **Artifact store**: `openspec` (no `engram`). Los artefactos del ciclo (propuesta, specs, diseño, tareas) quedan como archivos en `openspec/`, versionados en git — es la única forma de cumplir la exigencia del tutor de que *"el repositorio muestre el proceso de construcción paso a paso"*. `engram` guarda fuera del repo y en esta sesión ni siquiera está disponible.
- **Entrega a**: revisión humana (checkpoint obligatorio, ver Ciclo por hito) y, tras esa aprobación, a Implementer.

### Checkpoint humano (entre Spec Author e Implementer)

**Responsabilidad**: el desarrollador (vos) revisa la especificación, el diseño y las tareas que produjo el Spec Author antes de que se escriba una sola línea de código. Es el único punto del ciclo donde decide una persona, no un agente.

- **Decide**: aprobar tal cual, pedir ajustes al Spec Author, o rechazar el enfoque completo.
- **Por qué acá y no después**: corregir el rumbo en la especificación cuesta minutos; corregirlo después de que el Implementer ya escribió código cuesta un rework completo.
- **No avanza a Implementer sin esta aprobación explícita** — igual de bloqueante que el gate del Reviewer al final del ciclo.

### 2. Implementer

**Responsabilidad**: implementa exactamente lo que el Spec Author definió y el humano aprobó, respetando la arquitectura hexagonal y el stack fijado arriba.

- **Entra con**: la especificación, el diseño y las tareas del hito, ya aprobadas por el checkpoint humano.
- **Produce**: código en `src/core/` o `src/adapters/*` según corresponda, tests, y commits por unidad de trabajo revisable (no un commit gigante por hito).
- **No hace**: no redefine alcance ni diseño. Si algo del spec resulta inviable al implementar, vuelve al Spec Author — no decide unilateralmente un cambio de rumbo.
- **Skills a usar**: `sdd-apply`, `work-unit-commits`.
- **Entrega a**: Reviewer.

### 3. Reviewer

**Responsabilidad**: valida que la implementación cumpla la especificación, el diseño, las tareas y las convenciones técnicas de este archivo. **Gate duro**: sin su aprobación explícita, el hito no cierra.

- **Entra con**: el código implementado + la especificación/diseño/tareas del hito.
- **Produce**: reporte de verificación — aprobación, o rechazo con motivo concreto.
- **No hace**: no corrige hallazgos bloqueantes por su cuenta salvo que sean triviales y explícitamente autorizados; devuelve al Implementer (o al Spec Author, si el problema es de diseño y no de código) en vez de aprobar con reservas.
- **Skills a usar**: `sdd-verify`, `code-review`.
- **Solo tras su aprobación** se permite el commit final, el tag semántico y la carpeta `docs/progreso/vX.Y-nombre/` del hito.

### Ciclo por hito

```
Spec Author → 👤 Checkpoint humano ──✅ aprueba──▶ Implementer → Reviewer ──✅ aprueba──▶ commit + tag + docs/progreso/vX.Y-nombre/
     ▲               │                                  ▲              │
     └──ajustar spec─┘ ❌ rechaza                        └────❌ rechaza┘  (vuelve a Implementer, o a Spec Author si es de diseño)
```

Ningún hito se da por cerrado sin pasar por los tres roles **y** el checkpoint humano, en orden. Saltarse el checkpoint humano, saltarse el Reviewer, o commitear con hallazgos bloqueantes sin resolver, rompe la exigencia explícita del tutor de "diseño antes de implementación, con resultados versionados".

**Regla del loop de rechazo**: si el Reviewer rechaza por un problema de diseño y devuelve al Spec Author, el spec corregido vuelve a pasar por el checkpoint humano antes de llegar de nuevo al Implementer — no hay atajo. El checkpoint humano gatea *toda* versión de la especificación, no solo la primera.

## Convención de commits y versionado

- Conventional commits. Sin atribución de IA en el mensaje.
- El commit y el push los ejecuta siempre el humano. Ningún agente corre `git commit` ni `git push` por su cuenta, ni siquiera con el Reviewer ya aprobado.
- `v1.x` = MVP lineal · `v2.x` = swarm (subagentes + A2A cliente) · `v3.x` = grafo (A2A servidor) — ver ADR 1 en el arc42.

### Convención de ramas

- Una rama por hito: `hito/vX.Y-nombre-corto` — mismo nombre que su carpeta `docs/progreso/vX.Y-nombre/`, para correlacionar directo.
- Se crea desde `main` recién cuando el checkpoint humano aprueba el spec/diseño/tareas del hito (inicio del Implementer) — nunca antes.
- Todos los commits por unidad de trabajo del hito van a esa rama, nunca directo a `main`.
- Al aprobar el Reviewer y completarse el checklist de cierre, el humano mergea `hito/vX.Y-nombre-corto` a `main` y recién ahí crea el tag `vX.Y.Z` sobre `main`.
- Ejemplo para el Hito 1: `hito/v1.0-esqueleto-conversacional`.

### Commits por unidad de trabajo (durante el Implementer)

Cada tarea de `tasks.md` es un commit propio — no un commit gigante al final del hito. Formato:

```
<tipo>(<scope>): <descripción> (Hito X.Y, tarea N)
```

- `<tipo>`: `feat` | `fix` | `test` | `refactor` | `docs` | `chore` (conventional commits estándar).
- `<scope>`: el bloque que toca — `core`, `adapters/tui`, `adapters/knowledge`, `adapters/memory`, `adapters/a2a`.
- Ejemplo real, Hito 1 (`v1.0.0` — esqueleto conversacional): `feat(core): implementa resolucion de turno para agente unico (Hito 1.0, tarea 1)`.

El Implementer arma estos mensajes al proponer cada commit; el humano los ejecuta (ver arriba).

### Checklist de cierre de hito (antes del commit final + tag)

Un hito no cierra solo porque el Reviewer aprobó el código — tiene que cumplir **todo** esto:

- [ ] El Reviewer aprobó explícitamente (`sdd-verify` + `code-review` sin hallazgos bloqueantes).
- [ ] El **entregable funcional** del hito, tal como está definido en la tabla del [Plan de Implementación](docs/Plan_Implementacion_Harness_Empresarial.md#resumen-de-la-secuencia), se puede demostrar de punta a punta — no alcanza con que compile o pasen los tests unitarios.
- [ ] Existe `docs/progreso/vX.Y-nombre/` con evidencia de ese entregable (capturas, logs, o lo que aplique).
- [ ] Se creó el tag semántico `vX.Y.Z` correspondiente.

Recién con las cuatro casillas marcadas, el humano hace el commit final de cierre — mensaje sugerido: `docs: cierra Hito X.Y - <nombre del hito>` (conventional commit `docs`, porque lo que se agrega en ese commit puntual es la carpeta de progreso, no código nuevo).

### Cómo se anuncia cada commit propuesto

Cada vez que se completa una parte de la implementación, el agente que propone el commit nunca entrega solo el mensaje — siempre junto con la **rama** de destino y una etiqueta explícita de si cierra hito o no, evaluada contra el checklist de arriba:

- **Unidad de trabajo parcial** (no cumple las 4 condiciones del checklist todavía): mensaje con el formato de la sección anterior, la rama del hito (`hito/vX.Y-nombre-corto`), más la aclaración *"No es hito completo — falta(n): [lo que del checklist sigue pendiente]"*.
- **Cierre de hito** (cumple las 4 condiciones): mensaje `docs: cierra Hito X.Y - <nombre>`, la rama de destino del merge (`main`), más la aclaración *"Es hito completo — Reviewer aprobado, entregable funcional demostrado, docs/progreso/ creado, listo para tag vX.Y.Z"*.

Ejemplo de la diferencia:

```
Rama: hito/v1.0-esqueleto-conversacional
feat(core): implementa resolucion de turno para agente unico (Hito 1.0, tarea 1)
→ No es hito completo — faltan las tareas 2-16 y la aprobación del Reviewer.

Rama destino: main (merge de hito/v1.0-esqueleto-conversacional)
docs: cierra Hito 1.0 - esqueleto conversacional
→ Es hito completo — Reviewer aprobado, entregable funcional demostrado,
  docs/progreso/v1.0-esqueleto-conversacional/ creado, listo para tag v1.0.0.
```

Nunca se asume un cierre de hito sin marcar explícitamente las 4 casillas del checklist, ni se propone un commit sin decir a qué rama va.

## Mapa de documentación

| Archivo | Contenido |
| --- | --- |
| [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md) | Arquitectura: metas de calidad, bloques, interfaces, ADRs, riesgos |
| [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md) | Plan por hitos, casos de uso, entregables verificables |
| `docs/progreso/vX.Y-nombre/` | Evidencia de cada hito cerrado (se crea al aprobar el Reviewer) |
