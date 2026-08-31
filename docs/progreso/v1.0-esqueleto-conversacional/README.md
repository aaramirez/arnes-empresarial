# Hito 1.0 — Esqueleto conversacional: evidencia de cierre

**Entregable funcional**: el agente conversa por la TUI y recuerda el historial de la sesión (arc42, Escenario de ejecución 1) — un segundo prompt en la misma sesión debe recuperar el contexto del primero.

**Tareas**: [`openspec/changes/hito-1.0-esqueleto-conversacional/tasks.md`](../../../openspec/changes/hito-1.0-esqueleto-conversacional/tasks.md) (16/16, tareas 1-15 con commit propio `(Hito 1.0, tarea N)`, tarea 16 verificación manual).

## Checklist de cierre (`AGENTS.md`)

- [x] Checkpoint de usabilidad con el tutor.
- [x] Reviewer aprobó explícitamente (`sdd-verify` + `code-review`, sin hallazgos bloqueantes) — ver [`verify-report.md`](../../../openspec/changes/hito-1.0-esqueleto-conversacional/verify-report.md) (`sdd-verify`) y el resumen de `code-review` más abajo.
- [x] Entregable funcional demostrado de punta a punta — demo interactiva en vivo con el tutor, más la evidencia técnica de `data/harness.log`/`data/harness.db` de esta misma sesión (abajo).
- [x] Esta carpeta (`docs/progreso/v1.0-esqueleto-conversacional/`).
- [ ] Tag `v1.0.0` — se crea inmediatamente después de este commit.

## Evidencia técnica del Escenario 1 (recuperación de contexto)

Extracto real de `data/harness.log` (gitignoreado, no versionado — se copia el fragmento relevante acá) de una sesión de 4 turnos dentro del mismo `caso`:

```json
{"agentId":"agente-conversacional","sdkSessionId":"2e4307b4-50c4-4761-ae49-c7aaed98004f","casoId":"ee8443bb-45d0-47b0-a628-d3a316c99218","event":"turno-completado","timestamp":"2026-08-31T08:09:40.469Z"}
{"agentId":"agente-conversacional","sdkSessionId":"2e4307b4-50c4-4761-ae49-c7aaed98004f","casoId":"ee8443bb-45d0-47b0-a628-d3a316c99218","event":"turno-completado","timestamp":"2026-08-31T08:09:55.629Z"}
{"agentId":"agente-conversacional","sdkSessionId":"2e4307b4-50c4-4761-ae49-c7aaed98004f","casoId":"ee8443bb-45d0-47b0-a628-d3a316c99218","event":"turno-completado","timestamp":"2026-08-31T08:10:13.707Z"}
{"agentId":"agente-conversacional","sdkSessionId":"2e4307b4-50c4-4761-ae49-c7aaed98004f","casoId":"ee8443bb-45d0-47b0-a628-d3a316c99218","event":"turno-completado","timestamp":"2026-08-31T08:10:32.277Z"}
```

Corroborado contra `data/harness.db` (mismo `caso_id`, consultado en vivo): 1 fila en `casos` (`estado: "activo"`, `updated_at` avanzando con cada turno) y 4 filas en `sesiones_agente`, **las cuatro con el mismo `sdk_session_id`**:

```json
{
  "casos": { "id": "ee8443bb-45d0-47b0-a628-d3a316c99218", "tipo": "conversacion", "estado": "activo",
             "created_at": "2026-08-31T08:09:26.547Z", "updated_at": "2026-08-31T08:10:32.271Z" },
  "sesiones_agente": [
    { "sdk_session_id": "2e4307b4-...", "created_at": "2026-08-31T08:09:40.465Z" },
    { "sdk_session_id": "2e4307b4-...", "created_at": "2026-08-31T08:09:55.626Z" },
    { "sdk_session_id": "2e4307b4-...", "created_at": "2026-08-31T08:10:13.704Z" },
    { "sdk_session_id": "2e4307b4-...", "created_at": "2026-08-31T08:10:32.274Z" }
  ]
}
```

El mismo `sdk_session_id` reaparece en las 4 filas: cada turno nuevo, `assembleContext` (I3, lectura) resolvió `getLatestSesionAgente` del turno anterior y lo pasó como `options.resume` al SDK — el SDK confirmó continuidad de sesión devolviendo el mismo `session_id`, y `closeTurn` (I3, escritura) lo volvió a persistir. Es la prueba directa de que el segundo (y tercer, y cuarto) prompt de la sesión recuperó el contexto del primero, no una sesión nueva desde cero cada vez. El mismo patrón se repite en otras dos sesiones de la misma corrida (`eacb1b21-...`, 3 turnos; `ef777c5b-...`, 2 turnos).

## Veredicto del Reviewer

**`sdd-verify`** (auditoría completa de las 16 tareas + regla hexagonal): **PASS**. `rm -rf dist && npm run typecheck && npm test && npm run build` limpio — 19 archivos, 132 tests. Sin imports cruzados entre `core`/adaptadores fuera del composition root (`main.ts`, `build-on-submit.ts`). Reporte completo: [`verify-report.md`](../../../openspec/changes/hito-1.0-esqueleto-conversacional/verify-report.md).

**`code-review`** (effort alto, sobre todo `src/`): **PASS**, sin CRITICAL. 3 WARNING, todos casos borde de baja probabilidad que no interceptan el camino feliz del Escenario 1 — quedan como deuda técnica documentada para v1.1:

1. `close-turn.ts` — `updateCaso` + `createSesionAgente` son dos escrituras SQLite independientes, sin transacción (el core no tiene handle de `Database`, por diseño hexagonal). Riesgo: la segunda escritura falla después de que la primera ya commiteó. **Propuesta v1.1**: extender `MemoryWritePort` con una única operación `closeTurn` transaccional implementada en el adaptador.
2. `main.ts` — el `db.close()` en el `finally` no cubre una señal `SIGTERM` externa ni un Ctrl+C con un turno todavía en curso. El OS libera el handle igual al terminar el proceso (no es una fuga persistente entre corridas), pero un turno en vuelo puede perder su escritura de cierre.
3. `main.ts` — `createCaso()` no tiene su propio `try/finally` para cerrar `db` si falla; mitigado en la práctica porque el `catch` externo llama `process.exit(1)` inmediatamente después.

Ninguno de los tres bloquea el cierre de este hito.

## Alcance post-tarea-15

Además de las 16 tareas del checklist, esta sesión sumó pulido del Adaptador TUI (I1) sin tarea numerada (commits `6ccc663`→`ee2b8eb`): spinner animado, banner con `figlet`, diferenciación de roles por color, navegación de historial con flechas, scroll real vía `<Static>` de Ink, limpieza de pantalla compatible con consola legacy de Windows, campo de input con borde, timestamp por turno. Todo commiteado, testeado (TDD) y revisado en la misma auditoría de cierre — ver el detalle en `verify-report.md`.
