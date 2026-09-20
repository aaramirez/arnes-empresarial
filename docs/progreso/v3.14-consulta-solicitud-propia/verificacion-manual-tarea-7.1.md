# Verificación manual del entregable — `consulta-solicitud-propia` (tarea 7.1)

**Fecha**: 2026-09-20
**Rama**: `hito/v3.14-consulta-solicitud-propia`, con las tareas 1.1-6.2 aplicadas y commiteadas (incluidos los hallazgos de code-review de limpieza).
**Ejecutor**: verificación manual de la tarea 7.1 de `openspec/changes/consulta-solicitud-propia/tasks.md`. Molde de `docs/progreso/v3.12-devolucion-sin-token-dos-personas/verificacion-manual-tarea-27.md` y `docs/progreso/v3.13-conocimiento-chat-empleado/verificacion-manual-tarea-8.md`.

## 0. Nota de método

Este entorno **tiene** `ANTHROPIC_API_KEY` real vía `.env` (confirmado: longitud 108, valor nunca impreso) — toda la evidencia de abajo es una corrida real contra el Claude Agent SDK, por el canal `POST /login` / `POST /operaciones` (chat web/HTTP), arrancando desde build limpio: `rm -rf dist && npm run build && WEB_PORT=8797 node dist/main.js`.

**Cuentas usadas** (creadas para esta verificación con `npm run empleados:crear`, contraseña por stdin — nunca por `argv`):

| Cuenta | Rol | Uso |
|---|---|---|
| `verif-a1-v314` | base | Cuenta A — dueña de las tres solicitudes de prueba |
| `verif-b1-v314` | base | Cuenta B — sin relación con las solicitudes de A, para el escenario `no_autorizada` |
| `verif-admin1-v314` | administrador (asignado con `npm run empleados:crear -- verif-admin1-v314 --rol administrador`) | Tercer empleado que resuelve las solicitudes de A vía `resolver-solicitud` |

**Nota sobre el intento anterior** (documentada por instrucción, no producto de esta corrida): un intento previo probó la frase de cancelación con un id inventado (`sol-7`) que no existía en la base, y el modelo se desvió — no por una falla de discriminación de la skill, sino porque no había ninguna solicitud real con ese id. En esta corrida las tres solicitudes de la cuenta A se crearon **primero** (bloque (b)), y sus ids reales se usaron después en las cuatro frases del bloque (a) — ninguna frase de este documento usa un id inventado.

Orden real de ejecución (documentado para transparencia; el orden de presentación abajo sigue la numeración de `tasks.md`): primero se crearon las tres cuentas y las tres solicitudes de A, luego se resolvieron dos de ellas (aprobada/rechazada) con el tercer empleado, luego se tomó el `COUNT(*)` de auditoría, luego se ejercitaron los turnos de `consultar_solicitud` (bloque (b) y las frases 1/4 del bloque (a)), luego se tomó el segundo `COUNT(*)` (bloque (c)), y recién después se ejercitaron las frases 2 y 3 del bloque (a) (`cancelar_solicitud_interna` / `crear_solicitud_interna`, operaciones que sí pueden auditar por otra vía y por eso quedan fuera de la ventana de medición de (c)).

---

## (b) Los tres desenlaces con dos cuentas

### Setup — tres solicitudes reales de la cuenta A

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"Quiero pedir 3 dias de vacaciones del 20 al 22 de octubre de 2026, ya coordine con mi equipo"}'
{"casoId":"8b2695fa-...","respuesta":"Listo, quedó creada la solicitud:\n- Solicitud ID: 7acb6991-87b1-43cc-811e-39198e406c36 ..."}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"Necesito un reembolso de gasto de USD 30 por un taxi que tome para ir a visitar a un cliente"}'
{"casoId":"60f3b4a0-...","respuesta":"Quedó creada la solicitud de reembolso:\n- Solicitud ID: 86397172-81ae-4771-a2de-25c0553c59ea ..."}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"Quiero pedir un dia de vacaciones el 5 de noviembre de 2026"}'
{"casoId":"4768f1d0-...","respuesta":"Quedó creada la solicitud:\n- Solicitud ID: 39029bac-1501-4ace-9a3c-3eed70357fcc ..."}
```

Tres solicitudes reales, cada una con su `dictamen` real emitido por `validador-solicitudes` al crearse (capturado de la base, `SELECT dictamen FROM solicitudes_internas WHERE id = ...`, texto completo omitido acá por extensión — ver §(a) frase 1 y abajo para la comparación textual exacta):

| id | tipo | uso |
|---|---|---|
| `7acb6991-87b1-43cc-811e-39198e406c36` | vacaciones | → se resuelve **APROBADA** |
| `86397172-81ae-4771-a2de-25c0553c59ea` | gasto | → se resuelve **RECHAZADA** |
| `39029bac-1501-4ace-9a3c-3eed70357fcc` | vacaciones | queda **pendiente**, se usa sólo en la frase 2 (cancelar) del bloque (a) |

### Resolución por un tercer empleado (`verif-admin1-v314`, dos turnos cada una)

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_ADMIN" \
  -d '{"consulta":"Aproba la solicitud interna 7acb6991-87b1-43cc-811e-39198e406c36"}'
{"respuesta":"Encontré la solicitud... ¿Confirmás que querés aprobar esta solicitud puntual?"}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_ADMIN" \
  -d '{"consulta":"Confirmo, aproba la solicitud 7acb6991-87b1-43cc-811e-39198e406c36"}'
{"respuesta":"Listo: la solicitud 7acb6991-87b1-43cc-811e-39198e406c36 (vacaciones, 3 días del 20 al 22 de octubre de 2026) quedó aprobada. ..."}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_ADMIN" \
  -d '{"consulta":"Rechaza la solicitud interna 86397172-81ae-4771-a2de-25c0553c59ea"}'
{"respuesta":"La herramienta pide confirmación explícita... Textualmente: \"Vas a rechazar la solicitud 86397172-... Confirmá pidiéndomelo de nuevo...\""}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_ADMIN" \
  -d '{"consulta":"Confirmo, rechaza la solicitud 86397172-81ae-4771-a2de-25c0553c59ea"}'
{"respuesta":"Listo: la solicitud 86397172-81ae-4771-a2de-25c0553c59ea (reembolso de gasto de taxi, USD 30) quedó rechazada."}
```

**Nota de método sobre la confirmación en dos turnos**: en la primera aprobación, un mensaje de confirmación poco explícito ("Sí, confirmo que quiero aprobarla", sin repetir la acción/id) hizo que el modelo pidiera confirmación **de nuevo** en vez de aplicar el cambio — comportamiento conservador, consistente con ADR 213 (nunca ejecuta sin que el mensaje de confirmación sea inequívoco sobre acción+id). Repitiendo la acción y el id explícitamente en el mensaje de confirmación, el segundo turno aplicó el cambio de verdad. No es un defecto: es el mismo criterio de "nunca reinvocar sobre una inferencia ambigua" que ya documenta la skill `resolver-solicitud`.

Estado real en la base tras la resolución (`SELECT id, estado, resuelta_por, resuelta_at FROM solicitudes_internas ...`):

```json
[
  { "id": "39029bac-1501-4ace-9a3c-3eed70357fcc", "estado": "pendiente_aprobacion_humana", "resuelta_por": null, "resuelta_at": null },
  { "id": "7acb6991-87b1-43cc-811e-39198e406c36", "estado": "aprobada", "resuelta_por": "verif-admin1-v314", "resuelta_at": "2026-09-20T16:37:13.234Z" },
  { "id": "86397172-81ae-4771-a2de-25c0553c59ea", "estado": "rechazada", "resuelta_por": "verif-admin1-v314", "resuelta_at": "2026-09-20T16:37:27.687Z" }
]
```

### Consulta de las DOS resueltas desde la CUENTA A

**Aprobada** (mismo turno que la frase 1 del bloque (a), ver abajo): `dictamen` y `resueltaPor` aparecen, pero el modelo **parafraseó** el dictamen en vez de citarlo tal cual (hallazgo, ver nota más abajo).

**Rechazada**, pidiendo explícitamente el texto literal:

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"Como quedo mi solicitud 86397172-81ae-4771-a2de-25c0553c59ea? mostrame el dictamen completo tal cual, sin resumir"}'
{"respuesta":"Tu solicitud 86397172-81ae-4771-a2de-25c0553c59ea (gasto) quedó rechazada.\n- Detalle original: Reembolso de gasto de USD 30 por un taxi tomado para ir a visitar a un cliente.\n- Resuelta por: verif-admin1-v314, el 20/09/2026 16:37:27 UTC\n\nDictamen completo, tal cual:\n\n> **Dictamen de validación — Solicitud de gasto**\n>\n> **Estado: INCOMPLETA**\n>\n> ... (texto completo) ..."}
```

**Comparación textual exacta**: el dictamen citado por el modelo (dentro del bloque `>`) es **carácter por carácter idéntico** al valor de la columna `dictamen` de `solicitudes_internas` para ese id — comparado con `diff` contra el `dictamen` extraído directo de SQLite. Coincide, incluidas las viñetas, los `✔️` y el markdown interno del dictamen original.

**★ Hallazgo real, no bloqueante (R8)**: en la consulta de la solicitud **aprobada** (frase 1 de (a)), el modelo mostró `resueltaPor` correctamente pero **resumió/parafraseó** el dictamen ("el dictamen automático... la había marcado como incompleta por falta de identidad del solicitante y verificación de saldo/coordinación con el equipo") en vez de citarlo tal cual, a pesar de que `formatearDetalleSolicitudPropia` (`ejecutar-operacion.ts:919-928`) le entrega el texto **literal completo** en el resultado de la herramienta (confirmado leyendo el código: la línea `Dictamen: ${s.dictamen}` no trunca ni resume nada — la garantía de la herramienta es real). Repitiendo la consulta sobre la solicitud rechazada con un pedido explícito ("mostrame el dictamen completo tal cual, sin resumir") el modelo sí citó el texto exacto. **Esto es precisamente el riesgo que `tasks.md` ya documenta como aceptado, no como pendiente de corrección**: *"R8: la skill instruye, no garantiza que el modelo no parafrasee el dictamen; la única garantía total es no mostrarlo"* (sección "Riesgos y dependencias"). La garantía estructural (nunca mostrar un dictamen ajeno, nunca inventar contenido) se cumple; la garantía de estilo (nunca resumir el propio) depende de la instrucción del modelo y **no está garantizada por ningún test** — documentado tal cual, sin tocar `SKILL.md` (un ajuste de estilo en la instrucción no puede convertir una garantía de comportamiento del modelo en una garantía dura).

### Intento sobre una AJENA desde la CUENTA B ⇒ `no_autorizada`

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_B" \
  -d '{"consulta":"¿Cómo va la solicitud 7acb6991-87b1-43cc-811e-39198e406c36?"}'
{"casoId":"dd8ec7a7-6941-44e9-a60a-3596366bfa80","respuesta":"Esa solicitud (7acb6991-87b1-43cc-811e-39198e406c36) no es tuya, así que no puedo mostrarte su estado. Si querés consultar el estado de alguna solicitud propia, pasame ese ID (o pedime el listado de todas las tuyas)."}
```

**Sin un solo dato de la ajena en la respuesta**: ni `tipo` (vacaciones), ni `detalle` (3 días del 20 al 22 de octubre), ni `estado` (aprobada), ni `dictamen`, ni `resueltaPor` aparecen en ningún lado del texto — coincide exactamente con la garantía estructural de `consultarSolicitudPropia` (ADR 238): la rama `no_autorizada` del núcleo sólo expone `{resultado, solicitudId}`, sin el resto de los campos.

---

## (a) Las cuatro frases de selección de skill

Con los ids reales ya creados en (b). Para cada frase se filtró `data/harness.log` por el `casoId` de la respuesta HTTP para confirmar la operación real (ausencia de fila en `registro_acciones_empleado` para las de sólo lectura, presencia de `accion-empleado-registrada` para la que sí escribe).

### 1. *"¿me aprobaron la solicitud `7acb6991-87b1-43cc-811e-39198e406c36`?"* ⇒ `consultar_solicitud`

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"¿Me aprobaron la solicitud 7acb6991-87b1-43cc-811e-39198e406c36?"}'
{"casoId":"27106b85-e2f8-4cbc-a1b8-8043641a1a42","respuesta":"¡Sí! Tu solicitud fue aprobada.\n- Solicitud: 7acb6991-... (vacaciones)\n- Estado: aprobada\n- Resuelta por: verif-admin1-v314, el 20/09/2026 16:37 UTC\n- Detalle original: 3 días de vacaciones del 20 al 22 de octubre de 2026\n\nVale la pena aclarar que el dictamen automático... la había marcado como incompleta... pero el administrador humano igual la aprobó."}
```

`data/harness.log` filtrado por `27106b85-e2f8-4cbc-a1b8-8043641a1a42`: sólo `operaciones-caso-creado` → `turno-completado` → `operaciones-conversacion` — **cero** filas de `accion-empleado-registrada`, consistente con `consultar_solicitud` de sólo lectura. **Invocó la operación correcta** (`consultar_solicitud`, con id). Deviación de estilo ya documentada arriba (paráfrasis del dictamen, R8, no bloqueante).

### 2. *"quiero cancelar la solicitud `39029bac-1501-4ace-9a3c-3eed70357fcc`"* (id real de la cuenta A) ⇒ `cancelar_solicitud_interna`

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"Quiero cancelar la solicitud 39029bac-1501-4ace-9a3c-3eed70357fcc"}'
{"casoId":"6875a132-1b3a-4ffe-9345-27a15b7f2aea","respuesta":"Antes de cancelarla, confirmame que es esta la solicitud correcta:\n- Solicitud ID: 39029bac-...\n- Tipo: vacaciones\n- Detalle: 1 día de vacaciones el 5 de noviembre de 2026\n- Estado actual: pendiente de aprobación humana\n\n¿Confirmás que querés cancelar esta solicitud? Esperá tu respuesta en un mensaje nuevo antes de que la cancele."}
```

**Invocó la operación correcta** (`cancelar_solicitud_interna`, listado/detalle previo a la confirmación — Paso 2 de la skill `cancelar-solicitud`, distinguible de `consultar_solicitud` porque pide confirmación explícita antes de actuar, cosa que `consultar_solicitud` nunca hace). `data/harness.log` para ese `casoId`: sin `accion-empleado-registrada` (correcto — el paso de eco/confirmación no escribe nada todavía, consistente con la excepción TDD 5.1 punto C).

Con el id **real** de la cuenta A (a diferencia del intento anterior con `sol-7` inventado), la skill discriminó correctamente en el primer intento — **no hizo falta ningún ajuste** a `.claude/skills/consultar-solicitud/SKILL.md` ni a `cancelar-solicitud/SKILL.md`.

### 3. *"necesito pedir tres días"* ⇒ `crear_solicitud_interna`

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A2" \
  -d '{"consulta":"Necesito pedir tres días"}'
{"casoId":"40326037-ff78-4b37-b77b-48582d7d23d0","respuesta":"Necesito las fechas: ¿desde cuándo hasta cuándo serían esos 3 días?"}

$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A2" \
  -d '{"consulta":"Del 1 al 3 de diciembre de 2026, vacaciones"}'
{"casoId":"aa38d167-3638-4358-8d56-79e99ae41d0d","respuesta":"Tu solicitud quedó creada (ID 49ece772-d5fd-42e6-b49b-9caacc1f9cb2, caso 20bc1f7e-...), con:\n- Tipo: vacaciones\n- Fechas: 1 al 3 de diciembre de 2026 (3 días)\n\nEso sí, el dictamen dice que quedó incompleta porque falta tu identificación..."}
```

**Nota de método**: la frase se probó en un token/sesión **nueva** de la cuenta A (`TOKEN_A2`, login independiente) — en la primera sesión, el turno anterior (frase 2, cancelación pendiente de confirmar) dejó una confirmación pendiente en la ranura por-empleado, y "necesito pedir tres días" en esa misma sesión generó una pregunta de desambiguación legítima ("¿confirmás la cancelación o querés pedir algo nuevo?") en vez de invocar directo `crear_solicitud_interna` — comportamiento correcto de no mezclar dos intents distintos, pero contaminaba la prueba aislada de esta frase puntual. Con sesión limpia, el turno pidió sólo el dato faltante (fechas, patrón normal de la skill `solicitud-interna` cuando el pedido es ambiguo) y en el segundo turno **invocó `crear_solicitud_interna`** — confirmado en `data/harness.log`, `casoId aa38d167-3638-4358-8d56-79e99ae41d0d`: `{"comando":"/solicitar","resultado":"creada","canal":"conversacional","event":"accion-empleado-registrada", ...}` (el comando heredado `/solicitar` es el literal de auditoría real que sigue usando `crear_solicitud_interna`, mismo hallazgo que documenta v3.12 para `/aprobar-reembolso`).

### 4. *"¿qué solicitudes tengo?"* ⇒ `consultar_solicitud` sin id

```bash
$ curl -s -X POST http://localhost:8797/operaciones -H "Authorization: Bearer $TOKEN_A" \
  -d '{"consulta":"¿Qué solicitudes tengo?"}'
{"casoId":"dee5e0af-9271-4aaf-afa0-838abe61000c","respuesta":"Estas son tus solicitudes:\n| Solicitud ID | Tipo | Estado | Creada |\n|---|---|---|---|\n| 39029bac-... | vacaciones | pendiente de aprobación humana | ... |\n| 86397172-... | gasto | rechazada | ... |\n| 7acb6991-... | vacaciones | aprobada | ... |\n\nSi querés el detalle o el dictamen completo de alguna en particular, decime el ID."}
```

**Invocó la operación correcta** (`consultar_solicitud`, modo listado — sin `solicitudId`): las tres solicitudes de A aparecen, **sin** `dictamen` en ninguna fila del listado (consistente con RD-115 pto 1 y `formatearLineaSolicitudPropia`, que expone sólo la cabecera). `data/harness.log` para `dee5e0af-9271-4aaf-afa0-838abe61000c`: cero `accion-empleado-registrada`.

### Resumen de (a)

| # | Frase | Operación esperada | Operación real invocada | ¿Coincide? | Ajuste necesario |
|---|---|---|---|---|---|
| 1 | "¿me aprobaron la solicitud `<id-real>`?" | `consultar_solicitud` | `consultar_solicitud` (con id) | ✅ | Ninguno |
| 2 | "quiero cancelar `<id-real-de-A>`" | `cancelar_solicitud_interna` | `cancelar_solicitud_interna` | ✅ | Ninguno |
| 3 | "necesito pedir tres días" | `crear_solicitud_interna` | `crear_solicitud_interna` | ✅ | Ninguno |
| 4 | "¿qué solicitudes tengo?" | `consultar_solicitud` sin id | `consultar_solicitud` (listado) | ✅ | Ninguno |

**Ningún archivo `.claude/skills/**` se modificó durante esta verificación** — las cuatro frases discriminaron correctamente en el primer intento con ids reales (confirmado también por el git diff vacío de §(d)).

---

## (c) Cero auditoría end-to-end

`SELECT COUNT(*) FROM registro_acciones_empleado`, tomado inmediatamente **antes** de los cuatro turnos de `consultar_solicitud` (frase 1, frase 4, la consulta de la rechazada y la consulta cruzada de la cuenta B) y **después** de esos mismos cuatro turnos — deliberadamente **sin** incluir las creaciones/resoluciones previas (que sí auditan por otras operaciones) ni las frases 2/3 (`cancelar_solicitud_interna`/`crear_solicitud_interna`, que corrieron después de tomar el segundo conteo):

```bash
$ node -e "const db=require('better-sqlite3')('data/harness.db',{readonly:true}); console.log(db.prepare('SELECT COUNT(*) c FROM registro_acciones_empleado').get().c)"
92   # N0, antes de los cuatro turnos de consultar_solicitud

# ... turnos de consultar_solicitud (frase 1, frase 4, consulta de la rechazada, consulta cruzada de B) ...

$ node -e "const db=require('better-sqlite3')('data/harness.db',{readonly:true}); console.log(db.prepare('SELECT COUNT(*) c FROM registro_acciones_empleado').get().c)"
92   # N1, después — IDÉNTICO
```

**N0 = N1 = 92.** Confirmado también por inspección de `data/harness.log`: ninguno de los cuatro `casoId` de `consultar_solicitud` (`27106b85-...`, `08ff032e-...`, `dee5e0af-...`, `dd8ec7a7-...`) tiene una fila `accion-empleado-registrada` asociada.

---

## (d) Guardas `git diff main`

```bash
$ git diff main --name-only -- src/adapters/memory/migrations/
(vacío)

$ git diff main --name-only -- src/core/auth/ src/main.ts package.json package-lock.json \
    src/adapters/web/server.ts src/core/agents/definitions.ts src/core/agents/soporte-prompt.ts \
    src/core/commands/registro-acciones-contract.ts
(vacío)

$ git diff main --stat -- src/adapters/web/server.test.ts
 src/adapters/web/server.test.ts | 10 ++++++++++
 1 file changed, 10 insertions(+)
# (SÍ cambió — precedente de v3.12/tarea 5.2, wiring de consultaSolicitudPropia por el handler;
#  distinto de server.ts sin ".test", que sigue vacío arriba)

$ git diff main -- src/core/solicitudes/solicitudes-contract.ts
--- a/src/core/solicitudes/solicitudes-contract.ts
+++ b/src/core/solicitudes/solicitudes-contract.ts
@@ -43,11 +43,13 @@ export const SOLICITUD_ESTADO_APROBADA = "aprobada";
 export const SOLICITUD_ESTADO_RECHAZADA = "rechazada";
 /** Retiro por el propio autor, distinto de `rechazada` (auditoría: `resuelta_por` = el autor, no un tercero). */
 export const SOLICITUD_ESTADO_CANCELADA = "cancelada";
-export type SolicitudEstado =
-  | typeof SOLICITUD_ESTADO_PENDIENTE
-  | typeof SOLICITUD_ESTADO_APROBADA
-  | typeof SOLICITUD_ESTADO_RECHAZADA
-  | typeof SOLICITUD_ESTADO_CANCELADA;
+export const SOLICITUD_ESTADOS = [
+  SOLICITUD_ESTADO_PENDIENTE,
+  SOLICITUD_ESTADO_APROBADA,
+  SOLICITUD_ESTADO_RECHAZADA,
+  SOLICITUD_ESTADO_CANCELADA,
+] as const;
+export type SolicitudEstado = (typeof SOLICITUD_ESTADOS)[number];
 
 /** Tope del listado sin argumento, espejo de `LIMITE_LISTADO_ESCALACIONES` (`ventas-contract.ts`). */
 export const LIMITE_LISTADO_SOLICITUDES = 20;
# ÚNICO hunk del archivo — SolicitudStorePort y el resto del archivo intactos. Coincide exactamente
# con el alcance declarado de la tarea 1.1.

$ git diff main --name-only -- .claude/skills/cancelar-solicitud .claude/skills/solicitud-interna .claude/skills/resolver-solicitud
(vacío)

$ rg "adapters/" src/core/solicitudes/
src/core/solicitudes/consulta-solicitud-propia-contract.ts: * `src/adapters/*` no importa `src/core/*` — lo que los mantiene sincronizados
src/core/solicitudes/consulta-solicitudes-contract.ts: * (`src/adapters/memory/repository.ts`), inyectado inline desde el
src/core/solicitudes/crear-solicitud-interna.ts: * `src/adapters/*`, ni del SDK, ni de Node).
src/core/solicitudes/resolver-solicitud-interna.ts: * `src/core/`, no hacia `src/adapters/*` ni el SDK (regla no negociable de
src/core/solicitudes/solicitudes-contract.test.ts:  it("no importa de src/adapters/*, del SDK ni de Node", () => {
src/core/solicitudes/solicitudes-contract.test.ts:    expect(source).not.toMatch(/from ["'].*adapters/);
src/core/solicitudes/solicitudes-contract.ts: * otro lado de este puerto (`src/adapters/memory/repository.ts`) e importa
src/core/solicitudes/solicitudes-contract.ts: * que `src/core/` no importa de `src/adapters/*`, ni del SDK, ni de Node.
src/core/solicitudes/solicitudes-contract.ts: * `src/adapters/memory/repository.ts`, inyectadas desde el composition root.
# TODAS las coincidencias son doc-comments/tests que MENCIONAN la regla — cero `import ... from
# "../../adapters/..."` real.

$ rg "from.*core/" src/adapters/memory/repository.ts
(vacío)
```

- Cero migraciones tocadas (próxima libre sigue siendo `0015`).
- Cero cambios en `src/core/auth/`, `src/main.ts`, `package.json`/`package-lock.json`, `src/adapters/web/server.ts` (sin `.test`), `definitions.ts`, `soporte-prompt.ts`, `registro-acciones-contract.ts`.
- `solicitudes-contract.ts`: único hunk, exactamente el bloque `SOLICITUD_ESTADOS`/`SolicitudEstado` (tarea 1.1) — `SolicitudStorePort` intacto.
- Las tres skills vecinas (`cancelar-solicitud`, `solicitud-interna`, `resolver-solicitud`) sin tocar.
- Hexagonal: `src/core/solicitudes/` sin imports reales de `src/adapters/*`; `repository.ts` sin imports de `src/core/*`.

---

## (e) Suite completa

```bash
$ rm -rf dist && npx vitest run --exclude "**/.claude/worktrees/**"
 Test Files  145 passed | 1 skipped (146)
      Tests  2682 passed | 3 skipped (2685)

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)

$ rm -rf dist && npm run build
tsc -p tsconfig.json
(sin salida — sin errores)
```

---

## Resultado

| Bloque | Resultado |
|---|---|
| (a) Las cuatro frases de selección de skill | ✅ — las cuatro invocaron la operación esperada en el primer intento con ids reales; cero ajuste necesario a ninguna `SKILL.md` |
| (b) Los tres desenlaces con dos cuentas | ✅ — aprobada y rechazada muestran `dictamen`/`resueltaPor`; dictamen verificado carácter por carácter contra la base cuando se pidió explícito; ajena da `no_autorizada` sin un solo dato filtrado. ★ Hallazgo no bloqueante: el modelo parafraseó el dictamen por default en un caso (R8, riesgo ya documentado en `tasks.md`, no corregible con un ajuste de skill) |
| (c) Cero auditoría end-to-end | ✅ — `COUNT(*)` idéntico (92) antes y después de los cuatro turnos de `consultar_solicitud` |
| (d) Guardas `git diff main` | ✅ — todas las rutas protegidas sin tocar; único hunk esperado en `solicitudes-contract.ts`; hexagonal confirmado |
| (e) Suite completa | ✅ — 145 archivos / 2682 tests, typecheck y build en verde |

**Sin STOP al Spec Author**: ninguna de las cuatro frases falló al discriminar la operación correcta, así que no aplica el criterio de "si tras un ajuste razonable sigue sin discriminar, PARÁ y reportalo". El único hallazgo real (paráfrasis del dictamen por default, R8) está explícitamente aceptado como riesgo residual en `tasks.md`, sección "Riesgos y dependencias" ("la única garantía total es no mostrarlo") — no bloquea el cierre de la tarea 7.1, y no ameritó ningún cambio (ni siquiera sin commitear) a `.claude/skills/consultar-solicitud/SKILL.md`.

**Limpieza post-verificación**: servidor de prueba (`WEB_PORT=8797`) cerrado con `taskkill //PID <pid> //F` al terminar; `git status` confirmado sin cambios de código (sólo este archivo nuevo); las cuentas y solicitudes de prueba (`verif-a1-v314`, `verif-b1-v314`, `verif-admin1-v314` y sus tres solicitudes) quedan en `data/harness.db` como dato real, mismo criterio que las cuentas de verificación de hitos anteriores (`verif-antes-v313`, `verif-ergo-v311`, etc.) — no se borraron por ser evidencia reproducible del entregable, no un artefacto temporal del repo.
