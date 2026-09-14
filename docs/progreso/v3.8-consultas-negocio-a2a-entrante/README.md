# v3.8.0 — `consultas-negocio-a2a-entrante`: evidencia de cierre

**Entregable funcional**: un agente A2A externo que envía `consultar_negocio` al turno entrante recibe, para las cuatro operaciones de sólo lectura (`reporte_comisiones`, `estado_actividad`, `solicitudes_pendientes`, `reembolsos_pendientes`), datos reales de negocio recortados de identidad/datos personales — nunca una generalidad ni una excepción propagada, y nunca una herramienta de escritura del sistema (`mcp__operaciones__*`, `mcp__conocimiento__*` con `feedback`, etc.) accesible desde ese canal.

**Tareas**: [`openspec/changes/consultas-negocio-a2a-entrante/tasks.md`](../../../openspec/changes/consultas-negocio-a2a-entrante/tasks.md) — 15 tareas en 6 Work Units encadenadas (PR1-PR6), todas commiteadas en `hito/v3.8-consultas-negocio-a2a-entrante`. PR5 (cableado, tareas 7-10) esperó el merge real de `operaciones-negocio-conversacionales` a `main`, confirmado en el historial antes de abrirse (gate de `tasks.md`, verificado de forma independiente por el Reviewer — ver más abajo).

## Ciclo de Reviewer — dos pasadas

### Primera pasada (`sdd-verify` + `code-review --level high`, diff completo `since main`)

- `sdd-verify` sobre PR6 (tareas 11-15): **APROBADO**, 0 CRITICAL, 1 WARNING no bloqueante (trazabilidad TDD no verificable por git history en tareas 11-12 — mismo patrón de granularidad de commit que toda la serie).
- `code-review` sobre el diff completo: **3 hallazgos CONFIRMED de correctness**, bloqueantes, en código de PR3/PR5 (tareas 4 y 10) que no habían sido capturados por el `sdd-verify` de esas PRs en su momento:
  1. `solicitudes_pendientes`/`reembolsos_pendientes` truncaban el total a 20 en silencio (`LIMIT` por defecto de `repository.ts`, sin indicio de truncamiento en la respuesta).
  2. `validarConsultaNegocio` no validaba tipo ni longitud de `periodo`/`proyectoId`/`referenciaExterna` — regresión de una clase de bug que su módulo hermano (`validar-operacion.ts`) ya había cerrado tras un hallazgo previo de Reviewer.
  3. El comentario de `main.ts` decía castear `ActividadEstado` con "el mismo criterio" que `toPortActividad`, pero ese cast no validaba nada — al revés de lo que el comentario afirmaba.
- 5 hallazgos adicionales no bloqueantes (PII con recorte estructural sólo en un puerto de tres, `consultarSeguro` sin atrapar promesas rechazadas, dos de simplificación de código, y 4 commits de PR5 con atribución de IA prohibida por `CLAUDE.md`/`AGENTS.md:77`) — quedaron marcados como deuda declarada, no arreglados en esta ronda por decisión explícita del checkpoint.

### Fix del Implementer (commits `855075d`, `1a13880`)

Los 3 hallazgos bloqueantes se arreglaron con TDD real (test que falla primero, mínimo cambio para pasar):

- **Hallazgo 1**: `main.ts` ahora pasa `limite: LIMITE_ALTO_CONSULTAS_A2A_ENTRANTE` (10 000, valor nuevo justificado en comentario — no existía convención previa de "límite alto" para replicar) a `listSolicitudesInternas`/`listEscalacionesReembolso`. Test en `main.test.ts` siembra >20 filas y confirma el total real.
- **Hallazgo 2**: `MAX_STRING_LENGTH = 256` (mismo valor que `validar-operacion.ts`, duplicado a propósito por independencia de módulos hermanos) aplicado a los tres campos string de `validarConsultaNegocio`.
- **Hallazgo 3**: el closure de `actividadPort` ahora valida `estado` contra `ACTIVIDAD_ESTADOS` y lanza `ActividadTipoEstadoInvalidoError` (reusada, no duplicada) ante un dato corrupto — capturado de forma segura por `consultarSeguro` río abajo, sin romper el contrato "nunca lanza" de la tool.

De paso se corrigió un mecanismo de espera basado en `setImmediate` en un test nuevo de `main.test.ts` que resultó no confiable en checkouts con árbol de módulos grande (se reemplazó por `setTimeout`) — no es un bug de lógica de negocio, es robustez del test.

### Segunda pasada — **APROBADO**

Verificación directa (no basada en el reporte del Implementer) de los 3 fixes contra el código commiteado, más:

```
npm test
 Test Files  133 passed | 1 skipped (134)
      Tests  2336 passed | 3 skipped (2339)

npm run typecheck
  (sin salida, sin errores)

rg -n "from \"\.\./\.\./adapters|from \"\.\./adapters|from \"adapters/" src/core --glob '*.ts' | grep -v '\.test\.ts'
  → sin resultados
```

Los 5 hallazgos no bloqueantes de la primera pasada siguen abiertos como deuda declarada (no se pidió arreglarlos en esta ronda) — ver detalle en la sección anterior.

## Verificación del entregable de punta a punta

Ver [`evidencia-verificacion-manual-tarea-15.md`](evidencia-verificacion-manual-tarea-15.md) para el detalle completo: SQLite real en memoria, wiring **idéntico** al de `main.ts` (mismos closures, mismas funciones de `repository.ts`), datos sembrados con nombres/ids marcados como "secretos" para confirmar en negativo que el recorte de datos personales sigue vigente contra el wiring real. Las tres preguntas de `examples` del Agent Card (tarea 11) responden con datos reales y agregados — cierra el "Hallazgo 1" documentado en `docs/progreso/v3.0-a2a-servidor/evidencia-verificacion-manual.md:124-126`. Esa corrida es anterior a los 2 commits de fix de esta sección; los números que reporta (2325 passed, 2 fallas ambientales) no incluyen los tests nuevos de los 3 hallazgos del Reviewer — la cifra final y vigente es la de arriba (2336 passed, 0 fallas).

**Limitación de entorno ya documentada en la serie** (`docs/progreso/v3.0-a2a-servidor/`, `docs/progreso/v3.7-comandos-administracion-empleados/`): no hay verificación end-to-end contra una invocación real del modelo/Anthropic API vía A2A — este entorno de ejecución no tiene sesión interactiva ni budget de red para eso. La verificación cubre la lógica de negocio real (puertos, validación, recorte, composición de `mcpServers`) con datos reales, no con dobles.

## Checklist de cierre de hito (`AGENTS.md`)

- [x] El Reviewer aprobó explícitamente (`sdd-verify` + `code-review`, segunda pasada, sin hallazgos bloqueantes pendientes).
- [x] El entregable funcional se demuestra de punta a punta (sección anterior + `evidencia-verificacion-manual-tarea-15.md`) — no sólo compila y pasan los tests unitarios.
- [x] Existe `docs/progreso/v3.8-consultas-negocio-a2a-entrante/` con evidencia (este documento + la evidencia de tarea 15).
- [ ] Tag semántico `v3.8.0` — pendiente de creación por el checkpoint (número exacto y momento del tag, criterio de `tasks.md`: "valor exacto lo fija el checkpoint junto al tag de cierre"; `agent-card.ts` usa `"3.1.0"` como valor de trabajo del Agent Card, no necesariamente el mismo número de tag del repo).

Con las tres primeras casillas marcadas, falta sólo la decisión del checkpoint sobre el tag para dar el hito por cerrado según el checklist de `AGENTS.md`.
