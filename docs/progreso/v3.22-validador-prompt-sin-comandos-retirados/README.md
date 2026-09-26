# Evidencia — v3.22 `validador-prompt-sin-comandos-retirados`

Change: `openspec/changes/validador-prompt-sin-comandos-retirados/`. ADR 303, RD-175. Rama `hito/v3.22-validador-prompt-sin-comandos-retirados`.

## Qué se corrigió

El `systemPrompt` del validador de solicitudes decía que la decisión la toma "un empleado autenticado mediante `/aprobar-solicitud` o `/rechazar-solicitud`", dos comandos dados de baja en v3.10.0 (ADR 210 pto 1). El dictamen del validador se muestra tal cual al solicitante y al administrador, así que el modelo podía repetir un comando que responde "No conozco…". Ahora el prompt dice que decide una persona autorizada, distinta de quien la pidió, y le prohíbe dar comandos, herramientas o pasos. Una guarda de test recorre diez fuentes (diecisiete textos) de agente del núcleo y exige que todo token `/comando` exista en `COMANDOS`.

## Tests automáticos

| Momento | Archivos | Tests |
|---|---|---|
| Línea base (G0.4, `main`) | 162 pasan, 2 skipped | 3324 pasan, 5 skipped |
| Tras la Fase 1 | 163 pasan | 3338 pasan |
| RED de la Fase 2 | 3 fallan, 161 pasan | 3 fallan, 3339 pasan |
| Tras la Fase 3 y 4 | 164 pasan, 2 skipped | 3342 pasan, 5 skipped |

**Observación de estabilidad**: en la primera corrida completa tras 3.1 apareció un segundo rojo que no se reprodujo en tres corridas siguientes; la salida de esa corrida no mostraba el detalle. El diff de esa tarea sólo cambiaba un literal. Si vuelve a aparecer en la Fase 6, se investiga ahí.

Mutaciones M1-M6: [`mutaciones.md`](mutaciones.md).

## Evidencia manual (la ejecuta el humano)

> **Nunca sobre `data/harness.db`.** Todo sobre una copia. El agente no lee la base real. El dictamen es texto del modelo y varía entre corridas: se registra como **observación**, no como assert.

### Paso 1 — Copia de la base

```bash
cp data/harness.db "$TMP/harness-v3.22.db"
```

```bash
export HARNESS_DB_PATH="$TMP/harness-v3.22.db"
```

### Paso 2 — Dictámenes ya persistidos con los comandos viejos (C6: no se reescriben)

```bash
sqlite3 -readonly "$TMP/harness-v3.22.db" "SELECT COUNT(*), SUM(dictamen LIKE '%aprobar-solicitud%' OR dictamen LIKE '%rechazar-solicitud%') FROM solicitudes_internas;"
```

- Total de solicitudes: _pendiente_
- Con `/aprobar-solicitud` o `/rechazar-solicitud` en el dictamen: _pendiente_

### Paso 3 — Tres solicitudes nuevas en el chat web

Arrancar el chat web como indica `docs/Guia-Demostracion-Pasantia.md`, en la misma terminal donde se exportó `HARNESS_DB_PATH`. Iniciar sesión como un empleado **no** administrador y pedir:

1. Vacaciones completas (fechas concretas).
2. Un gasto sin monto.
3. Un trámite ambiguo ("necesito un permiso").

### Paso 4 — Observación de los dictámenes

| # | Respuesta "Solicitud X creada … Dictamen: …" (pegar tal cual) | ¿Nombra un comando? | ¿Da una herramienta o un paso para resolverla? |
|---|---|---|---|
| 1 | _pendiente_ | _pendiente_ | _pendiente_ |
| 2 | _pendiente_ | _pendiente_ | _pendiente_ |
| 3 | _pendiente_ | _pendiente_ | _pendiente_ |

Esperado: ninguno nombra un comando ni da pasos. Si alguno lo hace, se registra como hallazgo (R1 del proposal), sin cambiar el test.

### Paso 5 — Limpieza

La copia en `$TMP` se puede borrar. `data/harness.db` no se tocó.
