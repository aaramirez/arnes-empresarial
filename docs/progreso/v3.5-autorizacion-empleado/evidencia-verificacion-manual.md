# Evidencia detallada de verificación manual (`autorizacion-empleado`, post-tarea 5.2)

**Referencia**: [`openspec/changes/autorizacion-empleado/tasks.md`](../../../openspec/changes/autorizacion-empleado/tasks.md), sección "Después de la tarea 5.2". Complementa [`README.md`](README.md) de esta misma carpeta (resumen + tabla de 7 pasos). Precedentes seguidos: [`docs/progreso/v3.3-comando-cancelar-solicitud/`](../v3.3-comando-cancelar-solicitud/) (driver de Ink sobre `ink-testing-library`, hallazgo del `stdin.write` en dos llamadas) y [`docs/progreso/v3.4-comando-visibilidad-a2a-entrante/`](../v3.4-comando-visibilidad-a2a-entrante/) (formato de evidencia con SQL crudo).

**Entorno**: Windows 11, Git Bash (MINGW64). Node v24.14.1. `data/harness.db` real del repo **no se tocó en ningún momento** — toda la corrida usó una SQLite bajo el scratchpad de la sesión (`.../scratchpad/demo-v3.5-autorizacion-empleado/data/harness.db`), ya borrada.

## 0. Confirmación de `data/` real del repo, ANTES de empezar

```
$ git status --porcelain data/
(sin salida)
```

## 1. Sembrado de datos (stores reales, sin TUI ni modelo)

Salida real de `driver-v3.5.tsx` al arrancar (`SolicitudStorePort.crearSolicitudConCaso`/`VentaStorePort.crearVentaConCaso`+`escalarReembolso`, todos closures reales sobre `repository.ts`):

```
[seed] sol-carla-1 creada: {"id":"sol-carla-1","casoId":"caso-sol-carla-1","solicitanteId":"carla","tipo":"vacaciones","detalle":"vacaciones de carla - usada en pasos 1 (gate de rol) y 3 (autoservicio)","estado":"pendiente_aprobacion_humana","createdAt":"2026-09-13T06:33:45.457Z","updatedAt":"2026-09-13T06:33:45.457Z"}
[seed] sol-carla-2 creada: {"id":"sol-carla-2","casoId":"caso-sol-carla-2","solicitanteId":"carla","tipo":"vacaciones","detalle":"vacaciones de carla - usada en paso 5 (ana con rol elevado la aprueba)","estado":"pendiente_aprobacion_humana","createdAt":"2026-09-13T06:33:45.460Z","updatedAt":"2026-09-13T06:33:45.460Z"}
[seed] sol-ana-1 creada: {"id":"sol-ana-1","casoId":"caso-sol-ana-1","solicitanteId":"ana","tipo":"vacaciones","detalle":"vacaciones propias de ana - usada en paso 7 (prohibicion de autoaprobacion)","estado":"pendiente_aprobacion_humana","createdAt":"2026-09-13T06:33:45.460Z","updatedAt":"2026-09-13T06:33:45.460Z"}
[seed] venta-carla-1 creada (confirmada): {"id":"venta-carla-1","vendedorId":"carla","clienteId":"cliente-demo-v35","planNuevo":"premium","monto":850,"estado":"confirmada","casoId":"caso-venta-carla-1","tokenConfirmacion":"token-demo-venta-carla-1-v35","createdAt":"2026-09-13T06:33:45.461Z"}
[seed] venta-carla-1 escalada a reembolso_pendiente: {"id":"venta-carla-1","vendedorId":"carla","clienteId":"cliente-demo-v35","planNuevo":"premium","monto":850,"estado":"reembolso_pendiente","casoId":"caso-venta-carla-1","tokenConfirmacion":"token-demo-venta-carla-1-v35","createdAt":"2026-09-13T06:33:45.461Z"}
```

`beto` nunca recibió ninguna fila en `roles_empleado` (rol base por ausencia, ADR 156). `carla` tampoco. `ana` arrancó igual — su fila de rol se crea recién en el paso 4.

## 2. Paso 1 — `beto` (rol base) intenta aprobar la solicitud de `carla`

```
[02:33:45] Vos: /login beto clave-beto-1
sistema: Sesión abierta como beto. Vence 2026-09-13T07:03:45.538Z.
[02:33:45] Vos: /aprobar-solicitud sol-carla-1
sistema: solicitud sol-carla-1 · tipo vacaciones · detalle vacaciones de carla - usada en pasos 1
(gate de rol) y 3 (autoservicio) · caso caso-sol-carla-1 — repetí el comando para confirmar.
[02:33:45] Vos: /aprobar-solicitud sol-carla-1
sistema: No estás autorizado para aprobar esa solicitud: se requiere rol elevado.
```

Consulta **directa** a la base:

```json
[SQL] registro_acciones_empleado tras paso 1: [{"comando":"/aprobar-solicitud","resultado":"no_autorizado","empleado_id":"beto","caso_id":"caso-sol-carla-1"}]
[SQL] solicitudes_internas sol-carla-1 tras paso 1 (debe seguir pendiente): [{"id":"sol-carla-1","estado":"pendiente_aprobacion_humana","resuelta_por":null}]
```

`resultado` es byte por byte `"no_autorizado"` — el valor exacto de la constante `RESULTADO_NO_AUTORIZADO` (`src/core/commands/registro-acciones-contract.ts:39`), confirmado más abajo (sección 8). La solicitud **no** transicionó — sigue `pendiente_aprobacion_humana`, sin `resuelta_por`.

## 3. Paso 2 — `beto` intenta aprobar el reembolso de `carla`

```
[02:33:45] Vos: /aprobar-reembolso venta-carla-1
sistema: venta venta-carla-1 · cliente cliente-demo-v35 · monto 850.00 · caso caso-venta-carla-1 —
repetí el comando para confirmar.
[02:33:45] Vos: /aprobar-reembolso venta-carla-1
sistema: No estás autorizado para aprobar esa escalación de reembolso: se requiere rol elevado.
```

```json
[SQL] registro_acciones_empleado tras paso 2: [{"comando":"/aprobar-reembolso","resultado":"no_autorizado","empleado_id":"beto","venta_id":"venta-carla-1","caso_id":"caso-venta-carla-1"}]
[SQL] ventas venta-carla-1 tras paso 2 (debe seguir reembolso_pendiente): [{"id":"venta-carla-1","estado":"reembolso_pendiente"}]
```

Mismo resultado que el paso 1: `no_autorizado`, venta intacta.

```
[02:33:45] Vos: /logout
sistema: Sesión cerrada.
```

## 4. Paso 3 — `carla` cancela SU PROPIA solicitud (autoservicio, rol base)

`sol-carla-1` sigue `pendiente_aprobacion_humana` después del intento fallido de `beto` en el paso 1 (ese intento nunca escribió sobre `solicitudes_internas`), así que la misma solicitud sirve para este paso sin necesidad de sembrar una segunda.

```
[02:33:45] Vos: /login carla clave-carla-1
sistema: Sesión abierta como carla. Vence 2026-09-13T07:03:45.751Z.
[02:33:45] Vos: /cancelar-solicitud sol-carla-1
sistema: solicitud sol-carla-1 · tipo vacaciones · detalle vacaciones de carla - usada en pasos 1
(gate de rol) y 3 (autoservicio) · caso caso-sol-carla-1 — repetí el comando para confirmar.
[02:33:45] Vos: /cancelar-solicitud sol-carla-1
sistema: Listo: la solicitud sol-carla-1 quedó cancelada.
```

```json
[SQL] solicitudes_internas sol-carla-1 tras paso 3 (debe quedar cancelada): [{"id":"sol-carla-1","estado":"cancelada","resuelta_por":"carla"}]
```

`esAccionAutoservicio` (`resolver-solicitud-interna.ts:47`) sigue intacto: `cancelar` sobre lo propio funciona igual que antes de este change, sin pasar por el gate de rol.

```
[02:33:45] Vos: /logout
sistema: Sesión cerrada.
```

## 5. Paso 4 — asignar rol `administrador` a `ana` con el CLI real, EN MEDIO de la demo

La sesión de Ink (el mismo proceso, el mismo `render()`) sigue montada — no se reinició nada. El CLI corre como **subproceso** contra la MISMA SQLite:

```
$ node "<repo>/node_modules/tsx/dist/cli.mjs" "<repo>/src/empleados.ts" ana --rol administrador
Rol de ana asignado: administrador.
```

```json
[SQL] roles_empleado tras paso 4: [{"empleado_id":"ana","rol":"administrador"}]
```

## 6. Paso 5 — `ana` (rol recién elevado) aprueba la solicitud de `carla`

```
[02:33:46] Vos: /login ana clave-ana-1
sistema: Sesión abierta como ana. Vence 2026-09-13T07:03:46.128Z.
[02:33:46] Vos: /aprobar-solicitud sol-carla-2
sistema: solicitud sol-carla-2 · tipo vacaciones · detalle vacaciones de carla - usada en paso 5
(ana con rol elevado la aprueba) · caso caso-sol-carla-2 — repetí el comando para confirmar.
[02:33:46] Vos: /aprobar-solicitud sol-carla-2
sistema: Listo: la solicitud sol-carla-2 quedó aprobada.
```

```json
[SQL] solicitudes_internas sol-carla-2 tras paso 5 (debe quedar aprobada, resuelta_por=ana): [{"id":"sol-carla-2","estado":"aprobada","resuelta_por":"ana"}]
```

**Esto es la verificación de punta a punta de que el cambio de rol tiene efecto sin reiniciar sesión**: `ana` había iniciado sesión (paso 5) DESPUÉS de que el CLI le asignara el rol (paso 4), en el mismo proceso donde `beto`/`carla` ya habían operado con rol base. El diseño lo permite porque `rolPort` (`build-on-comando-empleado.ts`, default inline) hace `buscarRolEmpleado(db, empleadoId)` — una lectura SQL fresca — en **cada** llamada a `puedeResolverAjeno`, nunca cachea el rol en la `SesionEmpleado` ni en el closure del dispatcher.

## 7. Paso 6 — `ana` aprueba el reembolso de `carla`

```
[02:33:46] Vos: /aprobar-reembolso venta-carla-1
sistema: venta venta-carla-1 · cliente cliente-demo-v35 · monto 850.00 · caso caso-venta-carla-1 —
repetí el comando para confirmar.
[02:33:46] Vos: /aprobar-reembolso venta-carla-1
sistema: Listo: la venta venta-carla-1 quedó en reembolsada y el caso caso-venta-carla-1 en
resuelto.
```

```json
[SQL] ventas venta-carla-1 tras paso 6 (debe quedar reembolsada): [{"id":"venta-carla-1","estado":"reembolsada"}]
[SQL] registro_acciones_empleado /aprobar-reembolso tras paso 6: [{"comando":"/aprobar-reembolso","resultado":"no_autorizado","empleado_id":"beto","venta_id":"venta-carla-1"},{"comando":"/aprobar-reembolso","resultado":"aprobada","empleado_id":"ana","venta_id":"venta-carla-1"}]
```

Las dos filas, en orden de ocurrencia: el intento rechazado de `beto` (paso 2) y la aplicación real de `ana` (este paso) — ambas sobre la MISMA venta, sin resembrar nada, confirmando que el intento rechazado nunca mutó el estado.

## 8. Paso 7 — `ana` (rol elevado) intenta aprobar SU PROPIA solicitud

```
[02:33:46] Vos: /aprobar-solicitud sol-ana-1
sistema: solicitud sol-ana-1 · tipo vacaciones · detalle vacaciones propias de ana - usada en paso 7
(prohibicion de autoaprobacion) · caso caso-sol-ana-1 — repetí el comando para confirmar.
[02:33:46] Vos: /aprobar-solicitud sol-ana-1
sistema: No podés aprobar tu propia solicitud, aunque tengas rol elevado.
```

```json
[SQL] solicitudes_internas sol-ana-1 tras paso 7 (debe seguir pendiente): [{"id":"sol-ana-1","estado":"pendiente_aprobacion_humana","resuelta_por":null}]
[SQL] registro_acciones_empleado /aprobar-solicitud tras paso 7 (fila autoaprobacion_prohibida): [{"comando":"/aprobar-solicitud","resultado":"no_autorizado","empleado_id":"beto","caso_id":"caso-sol-carla-1"},{"comando":"/aprobar-solicitud","resultado":"aprobada","empleado_id":"ana","caso_id":"caso-sol-carla-2"},{"comando":"/aprobar-solicitud","resultado":"autoaprobacion_prohibida","empleado_id":"ana","caso_id":"caso-sol-ana-1"}]
```

Las TRES filas de `/aprobar-solicitud` de toda la demo, en orden: `no_autorizado` (beto, ajena), `aprobada` (ana, ajena, rol elevado), `autoaprobacion_prohibida` (ana, **propia**, mismo rol elevado). El rol elevado de `ana` alcanzó para lo ajeno (paso 5) pero **no** para lo propio (este paso) — el orden RD-78 (`resolver-solicitud-interna.ts:215-236`: rol primero, autoaprobación después) resuelve `puedeResolverAjeno` en `true` y aun así corta en el segundo chequeo.

```
[02:33:46] Vos: /logout
sistema: Sesión cerrada.
```

## 9. Vocabulario exacto de las dos constantes, y snapshot final completo

```
[constantes] RESULTADO_NO_AUTORIZADO = "no_autorizado"
[constantes] RESULTADO_AUTOAPROBACION_PROHIBIDA = "autoaprobacion_prohibida"
```

(Impresas por el propio driver leyendo la constante REAL importada de `registro-acciones-contract.ts`, no un literal escrito a mano en el driver — cualquier drift entre el código y este documento se hubiera visto acá.)

Snapshot final de **todas** las filas de `registro_acciones_empleado` de esta demo, en orden de ocurrencia:

```json
[
  {"comando":"/login","resultado":"exitosa","empleado_id":"beto","venta_id":null,"caso_id":null},
  {"comando":"/aprobar-solicitud","resultado":"no_autorizado","empleado_id":"beto","venta_id":null,"caso_id":"caso-sol-carla-1"},
  {"comando":"/aprobar-reembolso","resultado":"no_autorizado","empleado_id":"beto","venta_id":"venta-carla-1","caso_id":"caso-venta-carla-1"},
  {"comando":"/login","resultado":"exitosa","empleado_id":"carla","venta_id":null,"caso_id":null},
  {"comando":"/cancelar-solicitud","resultado":"cancelada","empleado_id":"carla","venta_id":null,"caso_id":"caso-sol-carla-1"},
  {"comando":"/login","resultado":"exitosa","empleado_id":"ana","venta_id":null,"caso_id":null},
  {"comando":"/aprobar-solicitud","resultado":"aprobada","empleado_id":"ana","venta_id":null,"caso_id":"caso-sol-carla-2"},
  {"comando":"/aprobar-reembolso","resultado":"aprobada","empleado_id":"ana","venta_id":"venta-carla-1","caso_id":"caso-venta-carla-1"},
  {"comando":"/aprobar-solicitud","resultado":"autoaprobacion_prohibida","empleado_id":"ana","venta_id":null,"caso_id":"caso-sol-ana-1"}
]
```

Nueve filas, ninguna huérfana, cada una atribuible a una sesión autenticada real (ADR 27/37) — exactamente los 7 pasos de comando (3 logins + 6 resoluciones, una de ellas — el `/cancelar-solicitud` de `carla` — sin gate de rol de por medio).

## 10. Verificaciones estáticas

### 10.1 Blast radius — `sesion.ts`/`comando-empleado.ts` sin diff contra `main`

```
$ git diff --stat main -- src/core/auth/sesion.ts src/core/commands/comando-empleado.ts
(sin salida)
```

Mismo invariante que el propio `tasks.md` (tarea 4.2) pide verificar como "test de regresión explícito" — confirmado también por esta sesión, no sólo heredado del Reviewer.

### 10.2 `npm run typecheck`

```
$ npx tsc --noEmit
(sin salida — 0 errores)
```

### 10.3 `npx vitest run` — suite completa

```
$ npx vitest run
 RUN  v4.1.11

No existe el empleado "ana".
Rol de ana asignado: administrador.

 Test Files  118 passed (118)
      Tests  2021 passed (2021)
   Start at  02:34:22
   Duration  7.05s (transform 8.50s, setup 0ms, import 22.23s, tests 30.07s, environment 29ms)
```

**2021/2021 en verde, 118/118 archivos, cero fallos.** Coincide EXACTAMENTE con el número reportado por el Reviewer — verificado en esta sesión sobre la rama `hito/v3.5-autorizacion-empleado`, no asumido. Las dos líneas `No existe el empleado "ana".` / `Rol de ana asignado: administrador.` son salida de consola esperada de `empleados.test.ts` (ejercita `main()` en modo `"asignar-rol"` contra una base en memoria propia del test, sin relación con la SQLite de este driver) — no son un error ni un warning.

A diferencia de v3.3 (sección 7.5 de su evidencia) y v3.4 (sección "Suite completa"), que documentaron `run-tests.integration.test.ts` fallando por una rama de `git worktree` (`harness/caso-caso-run-tests-verde`) colgada de una corrida anterior, **esta corrida no mostró ningún fallo preexistente**. No se investigó la causa de la ausencia de ese fallo (fuera de alcance de esta tarea, que es de verificación, no de mantenimiento del entorno de test) — se deja constancia honesta de que, en este momento puntual, la suite completa corrió 100% en verde.

## 11. Hallazgo de entorno — `tsx` y JSX fuera del árbol del repo

Al importar dinámicamente `src/adapters/tui/App.tsx` desde un script (`driver-v3.5.tsx`) ubicado bajo el scratchpad de la sesión (fuera de cualquier `tsconfig.json` alcanzable por búsqueda ascendente desde esa carpeta), la primera corrida falló así:

```
ERROR  React is not defined
 C:/Users/.../src/adapters/tui/App.tsx:754:3
 754:   return (
 755:     <Box flexDirection="column">
```

`tsconfig.json` del repo fija `"jsx": "react-jsx"` (runtime automático, no requiere `React` en scope) — pero `tsx`, al no encontrar ningún `tsconfig.json` alcanzable desde la ubicación del **entry point** (el propio `driver-v3.5.tsx`, en el scratchpad), transformó TODO el JSX del proceso —incluido el de `App.tsx`, pese a que ese archivo sí vive bajo el `tsconfig.json` real del repo— con el pragma clásico (`React.createElement` implícito, sin import). La corrección fue invocar `tsx` con el flag `--tsconfig <repo>/tsconfig.json` explícito, apuntando al `tsconfig.json` real. Con eso, el render funcionó sin cambios de código.

Distinto del hallazgo de `stdin.write` en dos llamadas (documentado por v3.3 y reproducido tal cual acá, sección 2 en adelante) — ese es un comportamiento de Ink/`ink-testing-library`, agnóstico de dónde vive el driver. Éste es específico de correr el throwaway **fuera** del árbol del repo (v3.3/v3.4 corrían su `scratch-demo/` anidado dentro del repo, donde la búsqueda ascendente de `tsconfig.json` siempre encontraba el real).

## 12. Confirmación final — `data/` real del repo intacto, sin procesos colgados

```
$ git status --porcelain data/
(sin salida)
```

Antes y después de toda la corrida (sección 0 de este documento y esta misma sección). La SQLite, el log, el driver, la junction de `node_modules` y el `tsconfig.json`/`package.json` del scratch vivieron enteramente bajo el scratchpad de la sesión, ya borrados.

```
$ tasklist //FI "IMAGENAME eq node.exe"
```

Al finalizar la demo (CLI de asignación de rol y el propio driver terminan y salen solos, sin servidor de fondo) no quedó ningún proceso `node`/`tsx` **originado por esta demo**. Se observaron dos procesos `node.exe` preexistentes corriendo `tsx src/main.ts` contra el checkout real del repo (verificados con `Get-CimInstance Win32_Process` — su línea de comando apunta a `src/main.ts` desde la raíz del repo, nunca a `driver-v3.5.tsx` ni a nada bajo el scratchpad) — **no fueron iniciados por esta sesión de verificación** (que nunca ejecutó `src/main.ts`, sólo `src/empleados.ts` y el driver throwaway) y se dejaron intactos a propósito: terminarlos hubiera sido una acción destructiva sobre un proceso ajeno a esta tarea, fuera del alcance de una verificación que promete no tocar nada más que lo suyo.
