# Hito 1.0 — Esqueleto conversacional: desglose de tareas

**Spec y diseño de origen** (no se duplican acá, se referencian): [`docs/Plan_Implementacion_Harness_Empresarial.md`](../../../docs/Plan_Implementacion_Harness_Empresarial.md#hito-1-esqueleto-conversacional), sección Hito 1; [`docs/ARC42_Harness_Empresarial.md`](../../../docs/ARC42_Harness_Empresarial.md), Nivel 3 (bloques 1.1, 1.2, 1.3, 2.1) y Vista de Ejecución (Escenario 1).

**Entregable funcional a demostrar al cerrar el hito**: el agente conversa por la TUI y recuerda el historial de la sesión (Escenario de ejecución 1 del arc42) — un segundo prompt en la misma sesión debe recuperar el contexto del primero.

**Estado**: checkpoint humano aprobado (2026-08-26). Implementación en curso.

**Nota de alcance — Motor de Hooks**: el Plan de Implementación no lista el Motor de Hooks entre los componentes del Hito 1, pero el Escenario de ejecución 1 del arc42 (criterio de aceptación literal de este hito) incluye el disparo de hooks de post-turno. Decisión validada con el humano: se agrega una versión mínima del Motor de Hooks a este hito (tarea 6) para que el entregable cumpla el escenario tal cual está escrito, en vez de reinterpretarlo.

**Metodología — TDD con `vitest`**: este hito se implementa con TDD (red → green → refactor) en toda tarea con lógica de negocio (4, 6, 7, 8, 9, 10, 11) — el commit de esa tarea incluye su test, escrito antes que la implementación. Excepciones: tarea 1 (setup, no hay lógica que testear), tarea 15 (integración end-to-end — se cubre con la verificación manual de la tarea 16, no con TDD unitario) y tarea 16 (verificación manual, no automatizada).

## Tareas

1. **Setup del proyecto**: inicializar `package.json`, TypeScript, `vitest`, y la estructura de carpetas `src/core/`, `src/adapters/tui/`, `src/adapters/memory/`.
2. **Configuración y credenciales** (Concepto transversal 2): un único punto de carga de `ANTHROPIC_API_KEY` desde variable de entorno. **Debe cargarse antes de importar `@anthropic-ai/claude-agent-sdk`** — el SDK no lee `.env` por su cuenta; cargarla después del import no sirve.
3. **Esquema SQLite inicial**: crear las tablas `casos` y `sesiones_agente` (definidas en el Hito 1 del Plan) + convención de migración. *No duplica el historial conversacional — el SDK ya lo persiste por su cuenta; estas tablas solo correlacionan caso y sesión.*
4. **Adaptador de Memoria Compartida** (I3): funciones para crear/leer/actualizar `casos` y `sesiones_agente`.
5. **Registro de Agentes** (2.1): definir el único agente del MVP en `src/core/agents/definitions.ts` (nombre, system prompt, herramientas permitidas, modelo).
6. **Motor de Hooks mínimo** (`src/core/hooks/`): registro de hooks vacío por ahora, capaz de disparar los puntos pre/post-turno aunque no haya nada registrado todavía — necesario para que el Invocador del Modelo (tarea 9) cumpla el Escenario 1 literal.
7. **Resolución de Turno** (1.1): dado el prompt entrante, resuelve qué agente atiende (con un solo agente es trivial, pero fija el contrato para cuando haya más).
8. **Ensamblador de Contexto** (1.2) — lectura: resuelve vía I3 el caso y la sesión del SDK a retomar (`options.resume`), *antes* de invocar el modelo.
9. **Invocador del Modelo** (1.3): llama al puerto `ModelProvider` vía I5 — integración real con `@anthropic-ai/claude-agent-sdk`, `query({ prompt, options })` — y dispara los hooks de post-turno (Motor de Hooks, tarea 6).
10. **Escritura de cierre de turno** (I3): tras la respuesta del modelo, actualizar el estado del `caso` y guardar el `sdk_session_id` en `sesiones_agente`. **Sin esta tarea el checklist se puede dar por completo y el entregable funcional falla igual** — es el paso que el arc42 marca como el aspecto más notable del Escenario 1: sin la escritura al cierre, el siguiente turno no ve el resultado de este.
11. **Manejo de errores base** (Concepto transversal 1): política mínima para fallos de Memoria y de `ModelProvider`.
12. **Logging y correlación base** (Concepto transversal 3): usar `caso_id` como identificador compartido en los logs.
13. **Secuencia de arranque** (Concepto transversal 5): fijar el orden de carga — Registro de Agentes y Motor de Hooks (Comandos/Skills no se ejercitan todavía en este hito). Se define *antes* de la integración end-to-end (tarea 15), no después.
14. **Adaptador TUI** (I1): entrada/salida por terminal con Ink.
15. **Integración end-to-end**: conectar TUI → Selector de Turno → Memoria + Modelo (con lectura y escritura en I3) → respuesta renderizada en TUI, respetando el orden de arranque fijado en la tarea 13.
16. **Verificación manual del escenario de ejecución 1**: segundo prompt en la misma sesión recupera el historial correctamente (Escenario de calidad 2 del arc42).

Cada tarea es un commit propio, formato `tipo(scope): descripción (Hito 1.0, tarea N)`, según la convención de [`AGENTS.md`](../../../AGENTS.md).

## Después de la tarea 16

- Checkpoint de validación de usabilidad con el tutor (ya previsto en el Plan de Implementación, inmediatamente después del Hito 1).
- Pasa al Reviewer (`sdd-verify` + `code-review`) contra este mismo documento.
- Si aprueba: checklist de cierre de hito en `AGENTS.md`, tag `v1.0.0`, carpeta `docs/progreso/v1.0-esqueleto-conversacional/`.
