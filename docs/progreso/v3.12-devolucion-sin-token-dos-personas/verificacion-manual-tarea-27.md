# Verificación manual de cierre — `devolucion-sin-token-dos-personas` (tarea 27)

**Fecha**: 2026-09-18
**Rama**: `hito/v3.12-devolucion-sin-token-dos-personas` (tracker, tareas 1-26 mergeadas en cadena desde 5 ramas de slice + 4 commits de limpieza post-Reviewer)
**Ejecutor**: verificación manual del entregable, tarea 27 de `openspec/changes/devolucion-sin-token-dos-personas/tasks.md` — sin código de producción. Molde de `docs/progreso/v3.10-aprobacion-conversacional-hitl/verificacion-manual-tarea-19.md`.

## 0. Nota de método — por qué esta evidencia no pasa por el Claude Agent SDK real

Este entorno no tiene `ANTHROPIC_API_KEY` disponible (verificado: `node -e "console.log(!!process.env.ANTHROPIC_API_KEY)"` → `false`), así que no se puede levantar un turno conversacional real de punta a punta.

La evidencia de abajo invoca `ejecutarOperacion` directamente — el dispatcher REAL que el turno conversacional llama después de que el modelo ya eligió la operación (mismo criterio que la tarea 19 de `aprobacion-conversacional-hitl` y la tarea 12 de `comandos-administracion-empleados`). Todo lo demás es real, sin ningún doble en el camino crítico: SQLite real (`:memory:`, migraciones reales vía `openDatabase`), `createVentaStore` real, `rolPort`/`consultaVentaPropia`/`justificacion`/`registro` reales (closures sobre `db`, mismo molde exacto que `build-on-operaciones-empleado.ts`), y las funciones deterministas reales (`consultarVentaPropia` vía el dispatcher, `solicitarDevolucion`, `resolverEscalacionReembolso`).

El script (`verificacion-tarea-27-temp.ts`, en la raíz del repo durante la corrida) se ejecutó con `npx tsx`, se corrigieron dos errores del propio script durante la corrida (una llamada de más que rompía el ciclo de dos turnos de `beto`, y un borde `<=` en vez de `<` en el bucle de la simulación de sesión — ninguno de los dos era un defecto del código de producción, ambos del script de verificación), se capturó la salida completa (abajo), y se borró — no queda en `git status` ni en el árbol de trabajo.

**Con DOS cuentas**: `vero` (vendedora, dueña de las ventas iniciadas) y `admin` (administradora, sin relación con esas ventas) — más `beto` (empleado base, sin rol) y `ext` (vendedor externo cuyo id colisiona con un empleado real) para los escenarios negativos.

## 1. `consultar_venta` — decisión del cliente sobre una venta puntual, y distinción ajena/inexistente

```
=== consultar_venta: detalle de una venta puntual, con la decision del cliente (estado) ===
- venta venta-1 | cliente cliente-verif-27 | plan plan-x | monto 1000.00 | estado confirmada | caso caso-1 | confirmada 2026-01-01T00:00:00.000Z

=== consultar_venta sobre venta AJENA (vero consulta venta-2, de beto) -> no_autorizada ===
La venta venta-2 no es tuya: no puedo mostrarte su estado.

=== consultar_venta sobre venta INEXISTENTE -> no_encontrada ===
No encontré ninguna venta venta-no-existe.
```

### 1.1 [Success Criterion] Una consulta que muestra la decisión del cliente sobre una venta puntual

✅ El `estado: confirmada` en la respuesta de `venta-1` es, literalmente, la decisión que el cliente tomó sobre el link de confirmación — visible sin que el `token_confirmacion` viaje en ningún momento (la proyección `VentaPropia` no lo declara, verificado también por el test mecánico de la tarea 1/2).

Bonus, no listado como Success Criterion explícito pero cubierto: la venta ajena y la inexistente dan mensajes distinguibles (`no_autorizada` vs `no_encontrada`), consistente con `consulta-venta-empleado` req. 2.

## 2. `solicitar_devolucion` — sin token, dos turnos, venta ajena rechazada

```
=== solicitar_devolucion sobre venta AJENA (vero intenta sobre venta-2, de beto) -> no_autorizada ===
La venta venta-2 no es tuya: no puedo iniciar una devolución sobre ella.

=== solicitar_devolucion SIN TOKEN, dos turnos (eco + confirmacion), sobre venta-1 (propia de vero) ===
[turno 1, eco] Vas a iniciar una devolución para la venta venta-1 (cliente cliente-verif-27, plan plan-x, monto 1000.00, estado confirmada). Esto queda pendiente de aprobación de un administrador distinto — no se devuelve la plata todavía. Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la iniciación.
[turno 2, confirmacion] Listo: la devolución de la venta venta-1 quedó escalada, pendiente de que un administrador distinto la apruebe.
venta-1.estado tras la solicitud = reembolso_pendiente (debe ser reembolso_pendiente, NUNCA reembolsada)
justificaciones_devolucion: {
  venta_id: 'venta-1',
  motivo: 'el cliente se arrepintio del plan nuevo',
  solicitante_id: 'vero'
}
[R13] alguna fila de registro_acciones_empleado contiene el texto del motivo? false (debe ser false)
```

### 2.1 [Success Criterion ★] Una iniciación de devolución sin token, con su justificación escrita (dos turnos, motivo no vacío)

✅ `vero` inicia sobre su propia venta (`venta-1`) sin que el token de confirmación entre en juego en ningún momento — el eco del primer turno repite los datos de la venta tal cual (ADR obligatorio de la tarea 24: "no se devuelve la plata todavía"), y el segundo turno (mismo `ventaId`/`motivo`, `casoIdActual` distinto) escala. La justificación queda en `justificaciones_devolucion`, tabla propia, y **no** aparece ningún rastro del texto del `motivo` en `registro_acciones_empleado` (R13, verificado con un `grep` sobre el JSON completo de todas las filas, no sólo de muestra).

Bonus: `venta-2` (de `beto`) rechazada como `no_autorizada` para `vero` — el gate de alcance del núcleo, no del dispatcher (test mecánico de la tarea 16 ya lo prueba en la suite; acá se confirma en vivo).

## 3. `resolver_reembolso` — cierre por un segundo actor

```
=== resolver_reembolso: 'vero' (rol elevado) intenta aprobar SU PROPIA escalacion -> autoaprobacion_prohibida ===
[turno 1, eco] Vas a aprobar el reembolso de la venta venta-1 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmacion] No podés aprobar el reembolso de tu propia venta, aunque tengas rol elevado.
venta-1.estado tras el intento de autoaprobacion = reembolso_pendiente (debe seguir en reembolso_pendiente)

=== resolver_reembolso: 'beto' (rol base, no vendio esta venta, no es admin) -> no_autorizado ===
[turno 1, eco] Vas a aprobar el reembolso de la venta venta-1 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmacion] No estás autorizado para aprobar esa escalación de reembolso: se requiere rol elevado.
venta-1.estado tras el rechazo de beto = reembolso_pendiente (debe seguir en reembolso_pendiente)

=== resolver_reembolso: 'admin' (administrador DISTINTO de vero) aprueba -> reembolsada ===
[turno 1, eco] Vas a aprobar el reembolso de la venta venta-1 (monto 1000). Confirmá pidiéndomelo de nuevo, en un mensaje aparte, para completar la resolución.
[turno 2, confirmacion] Listo: el reembolso de la venta venta-1 quedó reembolsada y el caso caso-1 en resuelto.
venta-1.estado FINAL = reembolsada (debe ser 'reembolsada')
```

### 3.1 [Success Criterion ★] El mismo vendedor intentando aprobar su propia escalación, y siendo rechazado

✅ `vero`, aunque tiene rol `administrador` asignado, no puede cerrar su propia escalación — `autoaprobacion_prohibida`, cero cambios en `ventas`/`casos` (releído de la DB, no del `Result`).

### 3.2 [Success Criterion] Un empleado base sin rol elevado tampoco puede cerrarla

✅ `beto` (sin fila en `roles_empleado`, rol base por ausencia) → `no_autorizado`.

### 3.3 [Success Criterion] Un administrador distinto aprobándola

✅ `admin` (≠ `vero`) → `ventas.estado = reembolsada`, `casos.estado = resuelto`.

## 4. Colisión de identificadores (R6)

```
=== Colision de identificadores: 'ext' es vendedorId externo (molde POST /ventas) Y ademas empleadoId real con rol elevado ===
venta-3.estado tras iniciar (ext PUEDE iniciar) = reembolso_pendiente
ext intenta cerrar su propia venta -> No podés aprobar el reembolso de tu propia venta, aunque tengas rol elevado.
venta-3.estado tras el intento de ext = reembolso_pendiente (debe seguir en reembolso_pendiente -- ext NO puede cerrarla)
```

`ext` es simultáneamente: el `vendedorId` con el que se dio de alta `venta-3` (molde `POST /ventas`, tabla `vendedores`, sin FK a credenciales) y un `empleadoId` real con rol `administrador`. Puede **iniciar** la devolución (el predicado "es dueño" compara strings, y coinciden), pero **no puede cerrarla** — el mismo predicado de autoaprobación dispara igual, sin distinguir "coincidencia externa" de "vendedor interno" (falla cerrado en el dinero, tal como exige R6).

## 5. Auditoría real generada durante la corrida

```
=== RESUMEN de filas de auditoria (registro_acciones_empleado) generadas en esta corrida ===
  empleado=vero comando=operacion:solicitar_devolucion resultado=no_autorizado
  empleado=vero comando=operacion:solicitar_devolucion resultado=escalada
  empleado=vero comando=/aprobar-reembolso resultado=autoaprobacion_prohibida
  empleado=beto comando=/aprobar-reembolso resultado=no_autorizado
  empleado=admin comando=/aprobar-reembolso resultado=aprobada
  empleado=ext comando=operacion:solicitar_devolucion resultado=escalada
  empleado=ext comando=/aprobar-reembolso resultado=autoaprobacion_prohibida
```

`consultar_venta` no dejó ninguna fila (correcto: operación de sólo lectura, `herramienta-operaciones-negocio` "nunca escribe fila de auditoría"). `resolver_reembolso` reusa el literal de comando heredado (`/aprobar-reembolso`) — la migración de v3.10 a v3.12 no cambió el vocabulario de auditoría de ese dominio.

## 6. Sesión por inactividad — no expira mientras se usa, sí por el tope absoluto

```
=== Sesion por inactividad: renovada mientras se usa, vencida por tope absoluto igual ===
sesion inicial: {
  empleadoId: 'vero',
  iniciadaEn: '2026-01-01T00:00:00.000Z',
  expiraEn: '2026-01-01T08:00:00.000Z',
  inactivaEn: '2026-01-01T00:30:00.000Z'
}
  minuto 480 (> tope absoluto 480): sesionVigente = false (debe ser false)
Uso continuo cada 20 min durante 480 minutos: la sesion NUNCA vencio por inactividad = true
expiraEn NUNCA cambio de valor a lo largo de las renovaciones = true
Sesion OCIOSA (sin uso) a los 31 min (> 30 min de inactividad): sesionVigente = false (debe ser false)
```

### 6.1 [Success Criterion] Una sesión que no expira mientras se la usa (conversación larga) pero sí vence por el tope absoluto

✅ Con las funciones puras reales (`sesionVigente`/`renovarSesion` de `src/core/auth/sesion.ts`, sin dobles): una sesión usada cada 20 minutos (menos que la ventana de inactividad de 30) se mantiene vigente durante las 8 horas completas del tope absoluto (`DEFAULT_SESION_TTL_MINUTOS = 480`) — `expiraEn` nunca cambia de valor en ninguna renovación (tope absoluto, no deslizante). Al cruzar el minuto 480, la sesión vence de todos modos, aunque `inactivaEn` siga renovándose. Por el otro lado, una sesión **ociosa** (sin ningún uso) vence a los 31 minutos, exactamente como antes del change (R8 sin empeorar).

Nota de método: esta pieza se verificó con las funciones puras directamente en vez de contra un servidor HTTP real, porque son las mismas dos funciones que consumen los dos escritores obligatorios (`sesion-empleado-store.ts` HTTP, `build-on-comando-empleado.ts` TUI, tareas 21-22) — ya cubiertos con test dedicado en la suite automatizada; esta verificación manual confirma el comportamiento observable del mecanismo, no repite la prueba de wiring.

## 7. `git diff main` — invariantes estructurales de la propuesta

```
$ git diff --stat main -- src/core/ventas/procesar-devolucion.ts src/core/ventas/resolver-escalacion-reembolso.ts
(vacío)

$ git diff --stat main -- src/adapters/web/server.ts src/adapters/web/render.ts src/adapters/web/config.ts
(vacío)

$ git diff --stat main -- src/core/ventas/ventas-contract.ts src/core/auth/autorizacion-resolucion.ts
(vacío)

$ git diff --stat main -- package.json
(vacío — sin dependencias nuevas)

$ grep -rln 'from "../adapters..."' src/core/ --exclude='*.test.ts'
(sin resultados — src/core/ sigue sin importar de src/adapters/*)
```

## 8. `npm test`, `npm run typecheck`, lint

```
$ rm -rf dist && npx vitest run --exclude "**/.claude/worktrees/**"
 Test Files  1 failed | 142 passed | 1 skipped (144)
      Tests  2 failed | 2617 passed | 3 skipped (2622)

$ npm run typecheck
tsc --noEmit
(sin salida — sin errores)

$ npm run lint
→ no existe script "lint" en package.json — N/A para este proyecto (mismo hallazgo que hitos anteriores)
```

**Nota de entorno, no de este change**: el checkout tenía un worktree registrado en `.claude/worktrees/agent-a2a4dfe48ac7fdf6d/` (de otra sesión de Claude Code sobre este mismo repo). `vitest.config.ts` sólo excluye `.harness/**` de la colección de tests — no `.claude/worktrees/**` — así que un `npm test` corrido tal cual en este entorno mientras ese worktree existe duplica/rompe el conteo (síntoma idéntico al de `dist/` sin limpiar, pero de otra causa). Se excluyó manualmente para esta corrida con `--exclude`. **No se tocó ni se borró ese worktree** (podía pertenecer a una sesión activa de otra persona) y **no se modificó `vitest.config.ts`** (está fuera del alcance de esta tarea 27, es una pieza de infraestructura compartida, no del change `devolucion-sin-token-dos-personas`) — queda anotado como hallazgo de infraestructura para una tarea aparte.

**Los 2 tests que fallan son la deuda ya adjudicada por el Reviewer** (`comandos-administracion-empleados-invariantes.integration.test.ts`, comparación `git diff --stat main` contra `sesion.ts` y `migrations/`, diseño de test de un hito v3.7 ya cerrado que no escala a evolución futura legítima de esas rutas) — no son nuevos ni bloqueantes.

## 9. Resultado

| # | Success Criterion (`proposal.md`) | Resultado |
|---|---|---|
| 1 | Una iniciación de devolución sin token, con su justificación escrita (dos turnos, motivo no vacío) | ✅ §2.1 |
| 2 | ★ El mismo vendedor intentando aprobar su propia escalación y siendo rechazado | ✅ §3.1 |
| 3 | Un administrador distinto aprobándola | ✅ §3.3 |
| 4 | Un intento sobre una venta ajena rechazado (no_autorizada, distinguible de "no existe") | ✅ §1 (consultar_venta), §2 (solicitar_devolucion) |
| 5 | Una consulta (consultar_venta) que muestra la decisión del cliente sobre una venta puntual | ✅ §1.1 |
| 6 | Una sesión que no expira mientras se la usa (conversación larga) pero sí vence por el tope absoluto | ✅ §6.1 |
| — | Bonus: empleado base sin rol elevado tampoco puede cerrarla | ✅ §3.2 |
| — | Bonus: colisión de identificadores no habilita el cierre (R6) | ✅ §4 |
| — | `git diff main`: archivos protegidos sin tocar; `package.json` sin dependencias nuevas; `src/core/` sin imports de `src/adapters/*` | ✅ §7 |
| — | `npm test`, `npm run typecheck` en verde (lint N/A); 2 fallos preexistentes ya adjudicados | ✅ §8 |

**Hallazgo de método, no bloqueante** (mismo patrón que la tarea 19 de `aprobacion-conversacional-hitl`): esta verificación no ejercitó el Claude Agent SDK real (sin `ANTHROPIC_API_KEY` en este entorno) — se detuvo en `ejecutarOperacion`, el dispatcher real. Las tres superficies de prompt (tarea 24) y las dos skills nuevas (tarea 25) que instruyen al modelo ya están verificadas por contenido exacto en la suite automatizada — lo que esta verificación no cubre es la elección real del modelo en runtime.

**Hallazgo de infraestructura, no bloqueante, fuera de alcance de este change**: `vitest.config.ts` excluye `.harness/**` pero no `.claude/worktrees/**` — un `npm test` corrido mientras hay un worktree de otra sesión de Claude Code abierto en ese directorio infla/rompe el conteo. Ver nota de §8.
