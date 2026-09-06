# v1.4.0 — Canal TUI para empleados: evidencia de cierre

**Entregable funcional**: un empleado real, provisionado por `npm run empleados:crear` con contraseña hasheada por scrypt, abre sesión en la TUI (`/login`), un comando privilegiado antes/después de esa sesión es rechazado con el gate correcto, una devolución chica se auto-aprueba, y una devolución grande queda escalada y se resuelve — aprobar, rechazar y reabrir — con confirmación en dos pasos, todo dejando fila real en `registro_acciones_empleado` y transición real en `ventas`/`casos`. `/soporte` y un mensaje sin `/` (delegación a `onSubmit`) también se ejercitaron y sí llegaron a invocar el modelo real en esta sesión (ver nota al final).

**Tareas**: [`openspec/changes/tui-canal-empleado/tasks.md`](../../../openspec/changes/tui-canal-empleado/tasks.md) (17/17, Work Unit 1: tareas 1-12, Work Unit 2: tareas 13-17, cada una con commit propio). **Verificación**: [`verify-report.md`](../../../openspec/changes/tui-canal-empleado/verify-report.md) — PASS WITH WARNINGS (0 CRITICAL, 1 WARNING cosmético de redacción en `specs/comando-empleado-tui/spec.md`, ya corregido — el spec dice "ocho comandos" en las tres apariciones verificadas abajo — y 2 SUGGESTION sin impacto funcional).

## Checklist de cierre (`AGENTS.md`)

- [x] Reviewer aprobó explícitamente (`sdd-verify` contra `tasks.md` + los 7 specs + `design.md`) — PASS WITH WARNINGS. El único WARNING (conteo "siete" vs. "ocho" comandos en `specs/comando-empleado-tui/spec.md`) está corregido: las tres apariciones del spec dicen "ocho" (verificado con `grep` en esta sesión).
- [x] Entregable funcional demostrado de punta a punta — guion de 16 pasos, corrido en esta sesión contra un driver in-process real (ver más abajo por qué no se usó una terminal real), con evidencia de TUI, log y SQL para cada paso.
- [x] Esta carpeta (`docs/progreso/v1.4-tui-canal-empleado/`).
- [ ] Tag `v1.4.0` — pendiente, se crea después del merge a `main`.

## Cómo se corrió la demo (sin `tmux` en este entorno)

Este entorno (Windows + Git Bash/MINGW64) no tiene `tmux` ni `pacman`, así que el patrón habitual de `tmux send-keys`/`capture-pane` para manejar una TUI real no funciona acá. En su lugar se montó la TUI real **en proceso**, con `ink-testing-library` (ya es `devDependency` del repo) en vez de una terminal: un script throwaway (`scratch-demo/driver.tsx`, borrado al terminar — no es parte del entregable) que:

1. Abre un SQLite temporal (`.../scratchpad/demo-tui-canal-empleado/data/harness.db`), **nunca** el `data/harness.db` real del repo (confirmado con `git status` al final: cero cambios en `data/`).
2. Reusa **el mismo `openDatabase`** (corre las migraciones reales 0001-0006) y el mismo wiring que arma `src/main.ts`: `bootstrapHarness`, `resolveVentasConfig`, `resolveAuthConfig`, `buildOnSubmit`, `buildOnSoporte`, `buildOnComandoEmpleado`, `createVentaStore`, `createNotificadorAdapter`, `createKnowledgeAdapter` — todos los módulos reales de `src/`, ninguno reimplementado ni stubeado.
3. Siembra datos de negocio con los **casos de uso reales** (`registrarVenta`, `resolverDecisionVenta`, `procesarDevolucion`) — nada de `INSERT` a mano.
4. Monta `<App onSubmit={onComandoEmpleado} />` (el componente TUI real, `src/adapters/tui/App.tsx`) con `render()` de `ink-testing-library`, envía cada comando con `instance.stdin.write(texto + "\r")` (el mismo mecanismo que una tecla Enter real) y registra `instance.lastFrame()` tras cada paso — el equivalente de `tmux capture-pane` para este entorno.
5. `logDeps` de `buildOnComandoEmpleado`/`buildOnSoporte` apunta a un archivo de log temporal (mismo mecanismo que `data/harness.log`, solo que en el scratch dir).

## Paso 1 — provisión real del empleado (`empleados:crear`)

```
$ cd <tempdir>
$ printf "clave-demo-123\n" | node .../node_modules/tsx/dist/cli.mjs .../src/empleados.ts ana
Contraseña: Empleado ana creado.
$ (exit code 0)
```

Fila real resultante (`credenciales_empleado`, hash scrypt real con parámetros del ADR 35):

```json
[
  {
    "empleado_id": "ana",
    "password_hash_preview": "scrypt$16384$8$1$P8b4nZ8s...",
    "created_at": "2026-09-06T01:48:46.962Z",
    "updated_at": "2026-09-06T01:48:46.962Z"
  }
]
```

## Paso 2 — seed real de ventas (vía casos de uso reales, no SQL a mano)

Tres ventas, cada una `registrarVenta` → `resolverDecisionVenta(..., "confirmar")` → (dos de ellas) `procesarDevolucion`:

| Venta | Monto | Umbral (`REEMBOLSO_UMBRAL` default 500) | Resultado de `procesarDevolucion` |
|---|---|---|---|
| A (`45d96c53...`, cliente-a) | 600.00 | ≥ umbral | `escalada` → `reembolso_pendiente` |
| B (`f2f70c6c...`, cliente-b) | 700.00 | ≥ umbral | `escalada` → `reembolso_pendiente` |
| C (`b38380dd...`, cliente-c) | 50.00 | < umbral | (se procesa desde la TUI, paso 5 del guion — auto-aprobada) |

## Guion de demo — resultado real (16 pasos)

| # | Paso | Resultado |
|---|---|---|
| 1 | `/ayuda` (pre-login) | ✅ lista los ocho comandos, `agentLabel: "sistema"` |
| 2 | `/aprobar-reembolso` sin sesión | ✅ rechazado, `comando-privilegiado-sin-sesion`, cero escrituras |
| 3 | `/login ana password-incorrecta` | ✅ `Credenciales inválidas.`, evento `login-fallido` motivo `password` |
| 4 | `/login ana clave-demo-123` | ✅ `Sesión abierta como ana.`, evento `login-exitoso` + fila `registro_acciones_empleado` (`/login`, `exitosa`) |
| 5 | `/devolucion <tokenC> no convencio` | ✅ auto-aprobada de inmediato: `la venta ...335d8d quedó reembolsada` (monto 50 < umbral 500) |
| 6 | `/aprobar-reembolso` sin id | ✅ lista las dos pendientes (ventaA, ventaB) |
| 7 | `/aprobar-reembolso <ventaA>` — paso 1 | ✅ eco: "repetí el comando para confirmar" |
| 8 | `/aprobar-reembolso <ventaA>` — paso 2 | ✅ aplicada: venta → `reembolsada`, caso → `resuelto` |
| 9 | `/rechazar-reembolso <ventaB>` — paso 1 | ✅ eco de confirmación |
| 10 | `/rechazar-reembolso <ventaB>` — paso 2 | ✅ aplicada: venta → `reembolso_rechazado`, caso → `resuelto` |
| 11 | `/reabrir-reembolso <ventaB>` — paso 1 | ✅ eco con nota de rechazo previo ("rechazada por ana el ... reaperturas previas: 0") |
| 12 | `/reabrir-reembolso <ventaB>` — paso 2 | ✅ aplicada: venta → `reembolso_pendiente`, caso → `pendiente_aprobacion_humana` |
| 13 | `/soporte tengo una consulta...` | ✅ SÍ completó — ver nota al final sobre el modelo |
| 14 | mensaje sin `/` (delegación a `onSubmit`) | ✅ SÍ completó — ver nota al final |
| 15 | `/logout` | ✅ `Sesión cerrada.`, evento `logout` |
| 16 | `/aprobar-reembolso` después de logout | ✅ vuelve a rechazar — la sesión realmente se fue |

## Evidencia — frames reales de la TUI (extracto)

Frame inicial (banner, sin turnos):

```
  _      _       _     _
 | |    (_)     | |   | |
 | |     _  __ _| |__ | |_
 | |    | |/ _` | '_ \| __|
 | |____| | (_| | | | | |_
 |______|_|\__, |_| |_|\__|
            __/ |
           |___/
arnés empresarial de IA
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│>                                                                                                 │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Pasos 2-4 (gate de privilegio → login fallido → login exitoso):

```
[21:48:55] Vos: /aprobar-reembolso
sistema: Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>.
[21:48:55] Vos: /login ana password-incorrecta
sistema: Credenciales inválidas.
[21:48:55] Vos: /login ana clave-demo-123
sistema: Sesión abierta como ana. Vence 2026-09-06T02:18:55.875Z.
```

Pasos 7-8 (confirmación en dos pasos, `/aprobar-reembolso`):

```
[21:48:56] Vos: /aprobar-reembolso 45d96c53-d710-43f8-8553-1716f02a32d4
sistema: venta 45d96c53-d710-43f8-8553-1716f02a32d4 · cliente cliente-a · monto 600.00 · caso
26891c99-a72d-41ad-a5b5-a73aab5a30b5 — repetí el comando para confirmar.
[21:48:56] Vos: /aprobar-reembolso 45d96c53-d710-43f8-8553-1716f02a32d4
sistema: Listo: la venta 45d96c53-d710-43f8-8553-1716f02a32d4 quedó en reembolsada y el caso
26891c99-a72d-41ad-a5b5-a73aab5a30b5 en resuelto.
```

Pasos 9-12 (rechazar → reabrir, mismo caso, ciclo completo):

```
[21:48:56] Vos: /rechazar-reembolso f2f70c6c-f6ff-4264-9915-8c271be6692f
sistema: venta f2f70c6c-f6ff-4264-9915-8c271be6692f · cliente cliente-b · monto 700.00 · caso
1104b8dd-648f-4292-8e9e-348bb39878af — repetí el comando para confirmar.
[21:48:56] Vos: /rechazar-reembolso f2f70c6c-f6ff-4264-9915-8c271be6692f
sistema: Listo: la venta f2f70c6c-f6ff-4264-9915-8c271be6692f quedó en reembolso_rechazado y el caso
 1104b8dd-648f-4292-8e9e-348bb39878af en resuelto.
[21:48:56] Vos: /reabrir-reembolso f2f70c6c-f6ff-4264-9915-8c271be6692f
sistema: venta f2f70c6c-f6ff-4264-9915-8c271be6692f · cliente cliente-b · monto 700.00 · caso
1104b8dd-648f-4292-8e9e-348bb39878af — repetí el comando para confirmar. rechazada por ana el
2026-09-06T01:48:56.615Z · reaperturas previas: 0.
[21:48:56] Vos: /reabrir-reembolso f2f70c6c-f6ff-4264-9915-8c271be6692f
sistema: Listo: la venta f2f70c6c-f6ff-4264-9915-8c271be6692f quedó en reembolso_pendiente y el caso
 1104b8dd-648f-4292-8e9e-348bb39878af en pendiente_aprobacion_humana.
```

Pasos 15-16 (logout real, la sesión no sobrevive):

```
[21:49:15] Vos: /logout
sistema: Sesión cerrada.
[21:49:15] Vos: /aprobar-reembolso
sistema: Ese comando necesita una sesión activa. Usá /login <empleadoId> <password>.
```

## Evidencia — `registro_acciones_empleado` real (orden cronológico)

```json
[
  { "id": "661ec8ce-...", "empleado_id": "ana", "comando": "/login", "venta_id": null, "caso_id": null, "resultado": "exitosa", "ocurrido_at": "2026-09-06T01:48:55.842Z" },
  { "id": "fd3bdbbf-...", "empleado_id": "ana", "comando": "/devolucion", "venta_id": "b38380dd-...335d8d", "caso_id": "a6480a63-...053e", "resultado": "reembolsada", "ocurrido_at": "2026-09-06T01:48:55.996Z" },
  { "id": "48871418-...", "empleado_id": "ana", "comando": "/aprobar-reembolso", "venta_id": "45d96c53-...a32d4", "caso_id": "26891c99-...a30b5", "resultado": "aprobada", "ocurrido_at": "2026-09-06T01:48:56.368Z" },
  { "id": "39768c67-...", "empleado_id": "ana", "comando": "/rechazar-reembolso", "venta_id": "f2f70c6c-...6692f", "caso_id": "1104b8dd-...78af", "resultado": "rechazada", "ocurrido_at": "2026-09-06T01:48:56.615Z" },
  { "id": "b5a34e8c-...", "empleado_id": "ana", "comando": "/reabrir-reembolso", "venta_id": "f2f70c6c-...6692f", "caso_id": "1104b8dd-...78af", "resultado": "reabierta", "ocurrido_at": "2026-09-06T01:48:56.864Z" },
  { "id": "8d0ca6dc-...", "empleado_id": "ana", "comando": "/soporte", "venta_id": null, "caso_id": "9080da10-...9696", "resultado": "atendida", "ocurrido_at": "2026-09-06T01:48:56.989Z" }
]
```

Seis filas, seis comandos distintos, `empleado_id` siempre `"ana"` (de la sesión, nunca tipeado — invariante ADR 37), `venta_id`/`caso_id` presentes solo cuando corresponde, cero rastro de contraseña/token/consulta en ninguna columna.

## Evidencia — `ventas` y `casos`, estado final

```
$ SELECT id, cliente_id, monto, estado, token_confirmacion FROM ventas ORDER BY monto;
id                                     cliente_id   monto   estado                token_confirmacion
b38380dd-e822-4579-be9c-341255335d8d   cliente-c    50      reembolsada           338b3cff-db61-4a47-bb18-2c292b31ed07
45d96c53-d710-43f8-8553-1716f02a32d4   cliente-a    600     reembolsada           d5a98454-b294-4921-bb21-035480a6875a
f2f70c6c-f6ff-4264-9915-8c271be6692f   cliente-b    700     reembolso_pendiente   9b8e4d50-7e13-4623-9ce1-d0c36d685785

$ SELECT id, tipo, estado FROM casos WHERE tipo IN ('venta','soporte') ORDER BY tipo;
id                                     tipo      estado
9080da10-b60b-4b44-836d-a395a9b69696   soporte   activo
26891c99-a72d-41ad-a5b5-a73aab5a30b5   venta     resuelto
1104b8dd-648f-4292-8e9e-348bb39878af   venta     pendiente_aprobacion_humana
a6480a63-3bd7-47ec-aeb1-b1ba84d3053e   venta     activo
```

Los tres estados finales son exactamente los esperados por el guion: venta A terminó `reembolsada`/`resuelto` (aprobada), venta B terminó `reembolso_pendiente`/`pendiente_aprobacion_humana` (reabierta al final del guion, a propósito — deja el ciclo completo demostrado en vez de terminar en un estado ya visto), venta C (`activo`, la del `/devolucion` auto-aprobado, cuyo caso nunca escaló y por eso nunca se movió de `activo`).

## Evidencia — eventos reales de `logTurnEvent` (JSON, líneas reales del log temporal)

```json
{"tipo":"aprobar_reembolso","casoId":"tui-comando","event":"comando-privilegiado-sin-sesion","timestamp":"2026-09-06T01:48:55.563Z"}
{"empleadoId":"ana","motivo":"password","casoId":"auth","event":"login-fallido","timestamp":"2026-09-06T01:48:55.718Z"}
{"empleadoId":"ana","expiraEn":"2026-09-06T02:18:55.875Z","casoId":"auth","event":"login-exitoso","timestamp":"2026-09-06T01:48:55.875Z"}
{"comando":"/login","resultado":"exitosa","casoId":"tui-comando","event":"accion-empleado-registrada","timestamp":"2026-09-06T01:48:55.876Z"}
{"accion":"aprobar","cantidad":2,"casoId":"tui-comando","event":"reembolso-listado","timestamp":"2026-09-06T01:48:56.120Z"}
{"accion":"aprobar","ventaId":"45d96c53-d710-43f8-8553-1716f02a32d4","monto":600,"casoId":"26891c99-a72d-41ad-a5b5-a73aab5a30b5","event":"reembolso-resolucion-solicitada","timestamp":"2026-09-06T01:48:56.244Z"}
{"ventaId":"45d96c53-d710-43f8-8553-1716f02a32d4","monto":600,"empleadoId":"ana","casoId":"26891c99-a72d-41ad-a5b5-a73aab5a30b5","event":"reembolso-escalacion-aprobada","timestamp":"2026-09-06T01:48:56.368Z"}
{"ventaId":"f2f70c6c-f6ff-4264-9915-8c271be6692f","monto":700,"empleadoId":"ana","casoId":"1104b8dd-648f-4292-8e9e-348bb39878af","event":"reembolso-escalacion-rechazada","timestamp":"2026-09-06T01:48:56.615Z"}
{"ventaId":"f2f70c6c-f6ff-4264-9915-8c271be6692f","monto":700,"empleadoId":"ana","casoId":"1104b8dd-648f-4292-8e9e-348bb39878af","event":"reembolso-escalacion-reabierta","timestamp":"2026-09-06T01:48:56.864Z"}
{"tipo":"logout","casoId":"tui-comando","event":"comando-empleado-recibido","timestamp":"2026-09-06T01:49:15.730Z"}
{"empleadoId":"ana","casoId":"tui-comando","event":"logout","timestamp":"2026-09-06T01:49:15.730Z"}
{"tipo":"aprobar_reembolso","casoId":"tui-comando","event":"comando-privilegiado-sin-sesion","timestamp":"2026-09-06T01:49:15.856Z"}
```

Todos los eventos nuevos de este hito documentados en `turn-logger.ts` (`comando-empleado-recibido`, `login-exitoso`/`-fallido`, `comando-privilegiado-sin-sesion`, `accion-empleado-registrada`, `reembolso-listado`, `reembolso-resolucion-solicitada`, `reembolso-escalacion-aprobada`/`-rechazada`/`-reabierta`, `logout`) se observaron realmente en esta corrida. `sesion-expirada` **no** se observó — el guion no esperó los 30 minutos del `SESION_TTL_MINUTOS` default para forzar una expiración real; queda como el único evento del vocabulario nuevo sin ejercitar en esta sesión (comportamiento cubierto por test unitario, no por esta demo manual).

## Nota honesta — `/soporte` y la delegación a `onSubmit` SÍ invocaron el modelo real

El plan original asumía que, sin `ANTHROPIC_API_KEY` en `.env` ni en el entorno de shell (confirmado antes de esta sesión), el único comando que llama al modelo (`/soporte`) fallaría de forma esperada, y que habría que documentar esa falla como limitación ambiental — igual que v1.2 documentó su paso 9 no verificable.

Eso **no fue lo que pasó**: tanto `/soporte` (paso 13) como el mensaje sin `/` que delega a `onSubmit`/`handleTurn` (paso 14) completaron con una respuesta real y coherente del agente conversacional (`agentLabel: "soporte"` y `"agente-conversacional"` respectivamente, eventos `turno-completado` y `soporte-caso-creado` reales en el log). La razón más probable: `@anthropic-ai/claude-agent-sdk` puede autenticarse contra la sesión/credenciales ambientales de esta propia herramienta (Claude Code) en vez de depender exclusivamente de `ANTHROPIC_API_KEY` en el proceso — no se investigó el mecanismo exacto porque está fuera del alcance de este change, y no se fabricó ninguna respuesta: la transcripción de abajo es la respuesta real capturada.

Respuesta real de `/soporte`:

```
soporte: ¡Hola! Con gusto lo ayudo, pero antes necesito entender un poco mejor qué está buscando.

Le comento de entrada una limitación importante: no tengo acceso a su cuenta ni al detalle de sus
compras, así que no puedo consultar, confirmar, cancelar ni reembolsar nada desde acá.
[...]
```

Respuesta real de la delegación (mensaje sin `/`):

```
agente-conversacional: ¡Hola! Todo bien, no hace falta que sea un comando para que te ayude.

¿En qué te puedo dar una mano? Si tenés alguna consulta sobre políticas, procesos o algo de la
empresa, tiro mano a la base de conocimiento interna. Si es otra cosa, contame no más.
```

**Consecuencia para el veredicto**: esto es un resultado *mejor* que el esperado, no peor — los ocho comandos y la delegación conversacional se verificaron end-to-end sin ningún gap, incluido el único camino que llama al modelo. No hay ningún paso del guion sin verificar manualmente en esta sesión (a diferencia de `sesion-expirada`, que es una omisión de alcance del guion, no una limitación del entorno).

**Advertencia explícita — esto NO es evidencia de que el camino de producción funcione sin credencial propia**: la llamada real al modelo en los pasos 13-14 se autenticó con las credenciales ambientales de la sesión de Claude Code que ejecutó esta demo, no con una `ANTHROPIC_API_KEY` propia del proceso (que seguía sin existir, confirmado antes y después de la corrida). Dos consecuencias concretas:

1. **Esta demo consumió uso real de la API de Anthropic** facturado contra la sesión/cuenta de Claude Code usada para correrla, no contra ninguna credencial de este proyecto. No era el objetivo de la tarea y no se pidió explícitamente para eso.
2. **El camino "proceso sin ninguna credencial disponible" no quedó probado.** En un entorno de producción real (fuera de una sesión de Claude Code, sin esas credenciales ambientales) — que es el entorno para el que este código está pensado — `/soporte` y la delegación conversacional dependen de que `ANTHROPIC_API_KEY` esté configurada de verdad en `.env`/el entorno del proceso. Si falta ahí, el comportamiento (código de error del SDK, mensaje al usuario, qué queda logueado) **no se verificó en esta sesión** y sigue siendo una laguna real de cobertura manual, distinta de `sesion-expirada`.

No se investigó el mecanismo exacto de esta autenticación ambiental porque cae fuera del alcance de este change; se deja constancia acá para que no se lea como validación del comportamiento en un entorno de producción sin `ANTHROPIC_API_KEY`.

## `npm test` / `npx tsc --noEmit` (re-corridos en esta sesión)

```
$ npx tsc --noEmit
(sin salida — cero errores de tipos)

$ npx vitest run
 Test Files  72 passed (72)
      Tests  954 passed (954)
   Duration  3.97s
```

Coincide exactamente con lo reportado por `verify-report.md` (72 archivos, 954 tests, 0 errores).

## Limpieza

El driver (`scratch-demo/driver.tsx`), el DB temporal, el log temporal y el archivo de frames capturados vivieron en `.../Temp/.../scratchpad/demo-tui-canal-empleado/` y en `scratch-demo/` dentro del repo — ambos borrados al cerrar esta verificación. `git status` confirma cero cambios en `data/harness.db`/`data/harness.log` reales del repo.

## Adenda (2026-09-06) — code review posterior al cierre + reverificación manual

Después del cierre de arriba, una pasada de Reviewer (`/code-review`, nivel `high`, 8 ángulos + verificación) sobre el commit de cierre encontró **10 hallazgos no bloqueantes** (duplicación, eficiencia, y dos de seguridad) — ninguno invalida la aprobación de `sdd-verify` ni el entregable funcional ya demostrado arriba, pero se cerraron todos con el mismo ciclo Implementer → Reviewer antes de dar por definitivo este hito. Tres commits, todos sobre `hito/v1.4-tui-canal-empleado`:

| Commit | Contenido |
|---|---|
| `948e605` | Fixes #1-10 originales: `esComandoPrivilegiado` (única fuente de verdad del guard de privilegio), timing attack mitigado en `/login` (hash dummy), `maxmem` explícito en `scryptSync`, `MAX_SESION_TTL_MINUTOS`, `LEFT JOIN` en `listEscalacionesReembolso` (reemplaza dos subqueries correlacionadas), `Record<AccionEscalacion,...>` en `build-on-comando-empleado.ts`, reuso de `resolveNumeroValidado`, duplicación documentada `calcularExpiraEn`/`calcularExpiresAt`, reuso de `formatMoney`. |
| `45235b9` | Reviewer encontró 2 hallazgos **CONFIRMED** sobre ese mismo commit: `DUMMY_PASSWORD_HASH` tenía el costo scrypt hardcodeado (podía desincronizarse de `SCRYPT_N/R/P` si rotan) y `VENTA_TOKEN_TTL_HORAS` se había quedado sin el mismo techo que `SESION_TTL_MINUTOS` ya tenía. Ambos corregidos con TDD (rojo confirmado antes de implementar). |
| `bdc1350` | Los 6 hallazgos **PLAUSIBLE** restantes: `listEscalacionesReembolso` seguía haciendo table scan completo pese al `LEFT JOIN` (verificado con `EXPLAIN QUERY PLAN`, corregido con un único subquery correlacionado + `JOIN` por clave primaria — cero duplicación y `SEARCH` por índice en las dos partes), invariante `tipo`↔`nombre` de `comando-empleado.ts` sin atar (agregado test de convención), duplicación en `ACCION_ESCALACION_INFO` (factorizada), y dos hallazgos documentados como trade-off/duplicación aceptada en vez de forzar un cambio de diseño fuera de alcance de un cleanup de Reviewer (amplificación de CPU en el timing-attack fix; `resolvePositiveNumber` duplicado en 5 adaptadores — no se sube a `src/core/` porque violaría la regla no negociable de `AGENTS.md` de que un adaptador no importa a otro). |

**Reverificación manual del entregable, después de los tres commits** (no solo `npm test` — correr la app real): sin `tmux` ni TTY en este entorno para manejar Ink interactivamente, se armó un driver in-process (`manual-test-hito4.ts`, borrado al terminar) que usa **las mismas funciones de composición reales que `main.ts`** — `buildOnVenta`, `buildOnComandoEmpleado`, `openDatabase`, `hashPassword`/`verificarPassword` reales — contra una SQLite real (no `:memory:` de test), sin ningún mock. Cubre Hito 4 (`v1.3.0`, ventas y comisiones) end-to-end además del canal de este hito:

1. `POST /ventas` (dos ventas reales, $100 y $500) → confirmación → cálculo de comisión.
2. `POST /devolucion`: la de $100 (bajo `REEMBOLSO_UMBRAL`) se auto-aprueba; la de $500 escala a un humano.
3. Reporte mensual (`agruparReporteMensual`/`formatearReporteMensual`) formatea el monto correctamente.
4. Canal TUI de empleado, sesión completa: `/login` con empleado inexistente (camino del `dummyPasswordHash` inyectado, fix #1) → inválida; `/login` con password incorrecta → inválida; `/login` real → sesión abierta; `/aprobar-reembolso` (listar) → aparece la venta escalada; `/rechazar-reembolso` (eco + confirmar); `/reabrir-reembolso` (listar rechazados, eco + confirmar) — el eco mostró **"rechazada por ana.qa el ... · reaperturas previas: 0"**, confirmando en vivo que el `JOIN` reescrito de `bdc1350` sigue trayendo `rechazadaPor`/`rechazadaAt` correctamente; `/aprobar-reembolso` (eco + confirmar) → venta `reembolsada`, caso `resuelto`; `/logout`.

**Resultado: 22/22 verificaciones en verde.** Un fallo en la primera corrida fue un bug del script de prueba (esperaba `rechazadaPor` en el *listado*, cuando por diseño `formatearLineaEscalacion` solo lo muestra en el *eco de confirmación*) — corregido y reconfirmado, no era un defecto de la app.

`npx tsc --noEmit` sin salida (cero errores) y `npx vitest run` — `72 archivos, 978 tests` (954 del cierre original + 24 tests nuevos de los tres commits del Reviewer) — todos en verde al momento de esta adenda.

**Limpieza**: `manual-test-hito4.ts` y su base SQLite temporal (`manual-test-hito4.db`, en la raíz del repo) se borraron al terminar; `git status` confirma árbol de trabajo limpio.
