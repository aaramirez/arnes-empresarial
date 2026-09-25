# Diseño técnico: Comandos de administración de empleados — el gate de `administrador` en el dispatcher, el escritor de rol, y el alta compartida con el CLI

**Entra con**: [`proposal.md`](proposal.md) (ADR 174-179, checkpoint humano resuelto: RD-80 = `/crear-empleado`+`/asignar-rol`; RD-81 = opción (a), residual aceptado con rotación por CLI documentada; ADR 174 ratificado; ADR 179 cerrado, cubierto sin feature nueva; `/estado-bot-prs` de solo lectura **aprobado como enmienda al diferido del ADR 178**) · `autorizacion-empleado/design.md` (ADR 157-162: `roles_empleado`, `RolEmpleadoPort`, `upsertRolEmpleado`, `autorizacion-resolucion.ts` — **consumidos, no reimplementados**).

**Alcance de este documento**: el *cómo* — resuelve **RD-82, RD-83, RD-84** con el código real a la vista, y agrega **ADR 180-185** (techo real verificado: **ADR 179** en `proposal.md:227`; ninguna RD ni ADR ≥ 180 existe en el repo).

**Dependencia dura sin resolver, verificada por `Glob`**: `src/core/auth/` hoy tiene `auth-config.ts`, `credenciales-contract.ts`, `login.ts`, `sesion.ts` — **`rol-contract.ts` y `autorizacion-resolucion.ts` NO existen todavía**. Este diseño asume que `autorizacion-empleado` mergeó (R6 de `proposal.md`) y da las firmas exactas de esos dos archivos por contrato, sin volver a decidirlas.

---

## 1. Resumen de la arquitectura elegida

Dos entradas nuevas en `DESCRIPTORES` (más una tercera, `/estado-bot-prs`, por enmienda del checkpoint), dos `Forma` nuevas, un segundo eje de gateo genérico en el dispatcher (`requiereAdministrador`), un escritor de rol co-ubicado con el lector, y una función de alta de credencial **compartida** entre `/crear-empleado` y `src/empleados.ts`. **`src/main.ts` no se toca** — mismo hallazgo que `autorizacion-empleado/design.md §6`: `credenciales`/`registro`/`reporteStore`/`rolPort` son costuras opcionales resueltas DENTRO de `build-on-comando-empleado.ts` (`:849-865`), y `main.ts:415-425` (verificado) no pasa ninguna explícitamente.

```
 src/empleados.ts (MODIFICADO)
  ├─ altaCredencialEmpleado(db, {empleadoId,password,ahora})  ★ NUEVO, exportada (RD-82)
  ├─ ID_REGEX                                                  pasa a exportarse
  └─ main() "alta" ahora LLAMA a altaCredencialEmpleado — deja de duplicar hash+insert
                    │ import (mismo molde que empleados.test.ts → parseArgsEmpleado)
                    ▼
 src/build-on-comando-empleado.ts (MODIFICADO)
  ├─ manejarCrearEmpleado   → altaCredencialEmpleado(db, ...)
  ├─ manejarAsignarRol      → esAdministrador() + auto-degradación + rolEscritor.asignarRol()
  ├─ manejarEstadoBotPrs    → resolveWebhookConfig/isWebhookEnabled + resolveBoardConfig/isBoardEnabled
  └─ gate genérico (paso 6.5): requiereAdministrador(tipo) → esAdministrador(rolPort, empleadoId)
                    │ calls
                    ▼
 src/core/auth/autorizacion-resolucion.ts (de autorizacion-empleado, MODIFICADO)
  └─ + esAdministrador(rolPort, empleadoId): boolean   ★ NUEVO (RD-84)
                    │ calls
                    ▼
 src/core/auth/rol-contract.ts (de autorizacion-empleado, MODIFICADO)
  └─ + RolEmpleadoEscritorPort { asignarRol(input): void }   ★ NUEVO, co-ubicado (RD-82)
                    │
                    ▼
 src/adapters/memory/repository.ts — reusa upsertRolEmpleado (sin cambios de firma)
 src/core/commands/comando-empleado.ts (MODIFICADO) — 3 descriptores, 3 Forma, requiereAdministrador: boolean
 src/core/commands/registro-acciones-contract.ts (MODIFICADO) — 3 constantes nuevas
```

---

## 2. ADR 180 (RD-82, parte 1): el escritor de rol vive **en `rol-contract.ts`**, junto al lector — no en archivo propio

**Contexto**. `RolEmpleadoPort` (lectura) declara *"UNA sola operación, de LECTURA"* y no se toca (ADR 176 pto 1). ADR 174 pto 3 ya fijó el criterio para el caso hermano (`credenciales-contract.ts`): *"el escritor es un contrato aparte, por el mismo criterio... que separó `rol-contract.ts` de `credenciales-contract.ts`"* — esa frase separa **dominios** (autenticación vs. autorización), no obliga a separar **archivos** dentro del mismo dominio.

**Decisión**: `RolEmpleadoEscritorPort` se agrega a `rol-contract.ts`, como una interfaz nueva y aparte de `RolEmpleadoPort` (dos interfaces, un archivo):

```ts
// src/core/auth/rol-contract.ts — agregado, sin nuevos imports (sigue "sin imports")
/**
 * Escritor de rol (ADR 175 pto 5, RD-82). Separado de `RolEmpleadoPort`
 * (lectura) por el mismo criterio del ADR 176 pto 1: mezclar lectura y
 * escritura en un puerto obligaría a que el gate del núcleo
 * (`autorizacion-resolucion.ts`) reciba un puerto que también puede escribir.
 */
export interface RolEmpleadoEscritorPort {
  asignarRol(input: { readonly empleadoId: string; readonly rol: RolEmpleado; readonly ahora: string }): void;
}
```

**Wiring** (`build-on-comando-empleado.ts`, molde exacto de `credenciales`/`rolPort`):

```ts
const rolEscritor: RolEmpleadoEscritorPort =
  deps.rolEscritor ?? { asignarRol: (input) => { upsertRolEmpleado(db, input); } };
```

`upsertRolEmpleado` (ADR 162) **no cambia de firma** — el escritor es un adaptador de una línea sobre la función que ya existe.

**Alternativas consideradas**: *archivo propio* (`rol-escritor-contract.ts`): rechazada — importaría `RolEmpleado` desde `rol-contract.ts` solo para tipar `input.rol`, un cruce de imports que el propio archivo no necesita hoy; co-ubicar mantiene el vocabulario de rol en un solo lugar sin costo de import cruzado.

## 3. ADR 181 (RD-82, parte 2): `/crear-empleado` y `src/empleados.ts` comparten `altaCredencialEmpleado`, una función pura nueva exportada desde `empleados.ts`

**Contexto, con `main()` real a la vista** (`empleados.ts:98-145`): el bloque `modo === "alta"` es exactamente `hashPassword` → `insertCredencialEmpleado` (catch de `CredencialEmpleadoDuplicadaError`) → mensaje. Es la MISMA secuencia que necesita `/crear-empleado`. La alternativa rechazada por la propuesta (invocar el script como subproceso, ADR 174) deja *"compartir una función pura"* como el camino correcto.

**Decisión**: extraer esa secuencia a una función pura-de-efectos-acotados, exportada junto a `parseArgsEmpleado` — mismo molde que ya usa `empleados.test.ts` (importa de `empleados.ts` sin disparar `main()`, gracias al guard `isMainModule`):

```ts
// src/empleados.ts — ID_REGEX pasa a exportarse (era privada); nueva función exportada
export function altaCredencialEmpleado(
  db: Database.Database,
  input: { readonly empleadoId: string; readonly password: string; readonly ahora: string },
): { readonly ok: true } | { readonly ok: false; readonly mensaje: string } {
  if (!ID_REGEX.test(input.empleadoId)) {
    return { ok: false, mensaje: `empleadoId inválido: "${input.empleadoId}"` };
  }
  if (input.password.trim() === "") {
    return { ok: false, mensaje: "La contraseña no puede estar vacía" };
  }
  try {
    insertCredencialEmpleado(db, {
      empleadoId: input.empleadoId,
      passwordHash: hashPassword(input.password),
      ahora: input.ahora,
    });
  } catch (error) {
    if (error instanceof CredencialEmpleadoDuplicadaError) {
      return { ok: false, mensaje: `Ya existe una credencial para "${input.empleadoId}"` };
    }
    throw error;
  }
  return { ok: true };
}
```

`main()`'s rama `"alta"` pasa a **llamar** a `altaCredencialEmpleado` en vez de repetir el cuerpo — cero duplicación de la validación de forma o del `try`/`catch`. `build-on-comando-empleado.ts` importa la misma función. **Lo que NO se comparte, a conciencia**: `leerPasswordDeStdin()` (I/O de terminal, no aplica a la TUI) y el `process.exit` (el dispatcher devuelve `TuiTurnResult`, nunca termina el proceso).

**Alternativas consideradas**: *duplicar el cuerpo en el dispatcher* (molde de `resolvePositiveNumber` en `webhooks/config.ts`, duplicación aceptada entre adaptadores): rechazada acá porque esta secuencia SÍ tiene un dueño natural sin cruzar la regla de "un adaptador no importa de otro" — `empleados.ts` no es un adaptador, es un entrypoint, y `build-on-comando-empleado.ts` ya importa libremente de fuera de `src/core/`.

## 4. ADR 182 (RD-83): auto-degradación **prohibida sin excepción** (no hay conteo) — y `/ayuda` sigue listando los dos comandos a todo el mundo

**Contexto**. ADR 175 pto 4 ofrece el fallback explícitamente: *"si el conteo resulta caro o ambiguo, prohibir la auto-degradación sin más"*. El conteo real exigiría una tercera operación de puerto (`contarAdministradores`) que **ninguna otra pieza del sistema necesita** — rompería el molde de `RolEmpleadoPort` (una sola operación de lectura, ADR 176 pto 1) o forzaría un cuarto contrato solo para este chequeo.

**Decisión — prohibición absoluta, sin conteo**: un `administrador` nunca puede asignarse a sí mismo un rol distinto de `administrador`, sin importar cuántos administradores existan. Cubre el 100% del modo de falla de R3 (nunca hay un momento en que el único admin se degrade) a costa de bloquear el caso legítimo, más raro, de "hay dos administradores y uno quiere bajarse solo" — que sigue disponible **con otro administrador ejecutando el comando**, o por CLI (`empleados:crear -- <id> --rol empleado`, fuera de este change).

```ts
if (comando.empleadoId === sesion.empleadoId && comando.rol !== ROL_ADMINISTRADOR) {
  registrar({ comando: COMANDO_ASIGNAR_ROL, resultado: RESULTADO_AUTODEGRADACION_PROHIBIDA }, ahora);
  return sistema("No podés quitarte a vos mismo el rol de administrador.");
}
```

**`/ayuda` a un empleado con rol base**: sigue listando `/crear-empleado` y `/asignar-rol` **siempre**, igual que hoy lista `/aprobar-reembolso` a quien no tiene sesión. **No es la analogía de `no_es_dueno`** (ese caso oculta el *contenido* de un ítem ajeno, no la *existencia* del comando) — es la analogía correcta, más simple: `formatearAyuda()` (`comando-empleado.ts:342`) es estática y **ya** no filtra por `privilegiado` ni por sesión; agregar un filtro por rol solo para estos dos comandos sería inconsistente y exigiría pasarle `rolPort`/`sesion` a una función hoy pura y sin dependencias. **Ocultar el comando no protege nada** (el gate real está en el dispatcher, no en la lista) y **lo haría es mentir sobre qué existe** — mismo argumento, en espejo, que usó RD-83 para preferir "rechazar sin filtrar" al decidir sobre datos.

**Alternativa considerada**: *conteo real vía `SELECT COUNT(*) FROM roles_empleado WHERE rol = 'administrador'`*: no descartada por costo (es SQLite local, trivial) sino por **superficie de contrato**: agregaría una cuarta operación de puerto para bajar un riesgo que la prohibición absoluta ya cierra al 100 % en el escenario que R3 nombra.

## 5. ADR 183 (RD-84): `requiereAdministrador: boolean` en `DescriptorComando` — la política vive en `autorizacion-resolucion.ts`, el dispatcher solo la consulta

**Contexto**. `privilegiado`/`secreto` ya son el molde de campo booleano por descriptor, consumido por una función de acceso (`esComandoPrivilegiado`) — nunca un `if` inline en el dispatcher. ADR 175 alternativa 2 deja `requiereAdministrador` "no descartada" por ser simétrica.

**Decisión**: se adopta el campo, simétrico, con su propia función de acceso, y la política ("¿alcanza el rol?") vive en `autorizacion-resolucion.ts` — **no se reimplementa la comparación de rol en el dispatcher**:

```ts
// comando-empleado.ts — DescriptorComando gana un campo; los 15+1 descriptores existentes declaran `false`
readonly requiereAdministrador: boolean;

export function requiereAdministrador(tipo: ComandoEmpleado["tipo"]): boolean {
  return DESCRIPTORES.find((d) => d.tipo === tipo)?.requiereAdministrador ?? false;
}
```

```ts
// src/core/auth/autorizacion-resolucion.ts (de autorizacion-empleado) — función nueva, mismo archivo
// Nombre DISTINTO de puedeResolverAjeno a propósito: hoy coinciden en implementación
// (dos roles), pero responden preguntas de política distintas — si aparece un
// tercer rol, cada una cambia de forma independiente sin tocar la otra.
export function esAdministrador(rolPort: RolEmpleadoPort, empleadoId: string): boolean {
  const rol = rolPort.buscarRol(empleadoId) ?? ROL_EMPLEADO;
  return rol === ROL_ADMINISTRADOR;
}
```

**Dispatcher — paso 6.5, DESPUÉS del gate de sesión existente (`:1714-1718`, sin cambios) y ANTES del `switch`**:

```ts
if (requiereAdministrador(comando.tipo)) {
  const empleadoId = (sesion as SesionEmpleado).empleadoId; // sesión ya garantizada por 6
  if (!esAdministrador(rolPort, empleadoId)) {
    logEvent(COMANDO_LOG_CORRELATION_ID, "comando-administrativo-no-autorizado", { tipo: comando.tipo, empleadoId });
    registrar({ comando: comando.tipo, resultado: RESULTADO_NO_AUTORIZADO }, ahora);
    return sistema("Ese comando requiere rol administrador.");
  }
}
```

`RESULTADO_NO_AUTORIZADO` se **reusa** de `autorizacion-empleado` (ADR 161) — mismo significado exacto ("no alcanza el rol"), un solo vocabulario de resultados de rechazo en todo el repo.

**Alternativa considerada**: *`if` inline en `manejarCrearEmpleado`/`manejarAsignarRol`*: rechazada — duplicaría el chequeo dos veces (uno por handler) en vez de una vez en el punto de entrada, y un tercer comando administrativo futuro tendría que acordarse de repetirlo en vez de heredarlo por descriptor.

## 6. ADR 184: `Forma` — `id_mas_resto_password` e `id_mas_resto_rol`, precedente de ADR 177 concretado

```ts
// comando-empleado.ts — dos brazos nuevos de ComandoEmpleado
| { readonly tipo: "crear_empleado"; readonly empleadoId: string; readonly password: string }
| { readonly tipo: "asignar_rol"; readonly empleadoId: string; readonly rol: string }

// Forma — dos variantes nuevas, mismo patrón de parseo que "id_mas_resto" (primer token + resto),
// clave de payload propia (ADR 177 pto 1)
type Forma = /* ...siete existentes... */ | "id_mas_resto_password" | "id_mas_resto_rol";
```

```ts
// parsearComando — dos ramas nuevas, molde EXACTO de la rama "/login"
if (descriptor.nombre === "/crear-empleado") {
  if (restoLinea === undefined) return ayudaArgumentos(comandoToken);
  const { primero: empleadoId, resto: password } = splitPrimerEspacio(restoLinea);
  if (password === undefined) return ayudaArgumentos(comandoToken);
  return { tipo: "crear_empleado", empleadoId, password };
}
if (descriptor.nombre === "/asignar-rol") {
  if (restoLinea === undefined) return ayudaArgumentos(comandoToken);
  const { primero: empleadoId, resto: rol } = splitPrimerEspacio(restoLinea);
  if (rol === undefined) return ayudaArgumentos(comandoToken);
  return { tipo: "asignar_rol", empleadoId, rol };
}
```

`rol` llega como `string` plano — se valida contra `ROLES_EMPLEADO` en el dispatcher (ADR 177 pto 2, mismo criterio que `periodo`). Descriptores (van ANTES de `/ayuda`, regla `:134-136`):

| `nombre` | `uso` | `privilegiado` | `secreto` | `requiereAdministrador` | `forma` |
|---|---|---|---|---|---|
| `/crear-empleado` | `/crear-empleado <empleadoId> <password>` | `true` | **`true`** (2º tras `/login`) | `true` | `id_mas_resto_password` |
| `/asignar-rol` | `/asignar-rol <empleadoId> <rol>` | `true` | `false` | `true` | `id_mas_resto_rol` |

## 7. ADR 185: `/estado-bot-prs` — enmienda del checkpoint al diferido del ADR 178, solo lectura, cero secretos impresos

**Contexto, verificado**: `webhooks/config.ts` exporta `resolveWebhookConfig(env)` → `{secret, port, path, maxBodyBytes}` e `isWebhookEnabled(config)` → `config.secret.trim() !== ""`; `board/config.ts` exporta el mismo par (`resolveBoardConfig`/`isBoardEnabled`) para `GITHUB_TOKEN`. Ninguna de las dos funciones expone el valor del secreto — solo booleans/número/string de config no sensible.

**Decisión**: comando de solo lectura, `privilegiado: true` (exige sesión, mismo criterio que `/consultar-kpi`/`/reporte-comisiones`) y **`requiereAdministrador: false`** — no hay secreto ni escritura que proteger, mismo nivel que los otros tres comandos de solo-lectura-privilegiada ya existentes.

```ts
function manejarEstadoBotPrs(): TuiTurnResult {
  const webhook = resolveWebhookConfig();
  const board = resolveBoardConfig();
  const listener = isWebhookEnabled(webhook)
    ? `escuchando en :${webhook.port}${webhook.path}`
    : "deshabilitado (sin GITHUB_WEBHOOK_SECRET)";
  return sistema(`Bot de PRs — listener: ${listener}. GITHUB_TOKEN: ${isBoardEnabled(board) ? "presente" : "ausente"}.`);
}
```

Sin `registrar()`: es una lectura, mismo criterio que `/reporte-comisiones`/`/consultar-kpi` (no escriben en `registro_acciones_empleado`).

**★ Consecuencia sobre el conteo de `DESCRIPTORES` de la propuesta**: `Success Criteria` de `proposal.md:304` dice *"diecisiete entradas"* asumiendo dos comandos nuevos. Con `/estado-bot-prs` ratificado por el checkpoint, **son tres**: `DESCRIPTORES` queda en **dieciocho**, no diecisiete (partiendo de los quince de la Aclaración 2). **Se marca acá como corrección explícita, no como omisión** — `sdd-tasks`/`sdd-spec` deben leer "dieciocho" donde la propuesta dice "diecisiete".

---

## 8. Testing (TDD estricto)

| Archivo | Qué se agrega |
|---|---|
| `comando-empleado.test.ts` | `parsearComando` para las tres formas nuevas: argumentos completos, `password`/`rol` ausente ⇒ `ayuda/"argumentos"`; `requiereAdministrador` en los 18 descriptores (15 `false`, 3 `true`/`false` según tabla). |
| `empleados.test.ts` | `altaCredencialEmpleado`: alta exitosa; `empleadoId` inválido; password vacía; duplicado ⇒ mismos mensajes que hoy. `main()` "alta" delega en la función (test de no-regresión). |
| `rol-contract.test.ts` (de `autorizacion-empleado`, extendido) | `RolEmpleadoEscritorPort` es una interfaz de una operación (test de forma, molde `*-contract.test.ts`). |
| `autorizacion-resolucion.test.ts` (extendido) | `esAdministrador`: `administrador` explícito ⇒ `true`; `empleado`/ausencia ⇒ `false`. |
| `build-on-comando-empleado.test.ts` | ★ Rol base ejecuta `/crear-empleado`/`/asignar-rol` ⇒ rechazo + fila `no_autorizado`; ★ rol base intenta `/asignar-rol <sí-mismo> administrador` (ya tiene ese rol, caso trivial) vs. administrador único intenta degradarse ⇒ `autodegradacion_prohibida`; alta exitosa ⇒ fila `exitosa`, password NUNCA en el evento ni en la fila (molde `:524`); `/asignar-rol` a `empleadoId` inexistente ⇒ error sin fila; `/estado-bot-prs` sin `GITHUB_WEBHOOK_SECRET`/`GITHUB_TOKEN` ⇒ "deshabilitado"/"ausente", nunca imprime el valor; `git diff` de `sesion.ts` vacío. |

## 9. Archivos — resumen

| Archivo | Acción | Resumen |
|---|---|---|
| `src/empleados.ts` | Modificar | `altaCredencialEmpleado` exportada (ADR 181), `ID_REGEX` exportada, `main()` la reusa |
| `src/core/auth/rol-contract.ts` | Modificar (de `autorizacion-empleado`) | + `RolEmpleadoEscritorPort` (ADR 180) |
| `src/core/auth/autorizacion-resolucion.ts` | Modificar (de `autorizacion-empleado`) | + `esAdministrador` (ADR 183) |
| `src/core/commands/comando-empleado.ts` | Modificar | 3 descriptores, 2 `Forma`, campo `requiereAdministrador` + `requiereAdministrador()` (ADR 183, 184, 185) |
| `src/core/commands/registro-acciones-contract.ts` | Modificar | + `COMANDO_CREAR_EMPLEADO`, `COMANDO_ASIGNAR_ROL`, `RESULTADO_AUTODEGRADACION_PROHIBIDA` |
| `src/build-on-comando-empleado.ts` | Modificar | wiring `rolEscritor`, gate 6.5 genérico, `manejarCrearEmpleado`/`manejarAsignarRol`/`manejarEstadoBotPrs` |
| `src/adapters/memory/repository.ts` | Sin cambios | `upsertRolEmpleado`/`insertCredencialEmpleado` se reusan tal cual (ADR 180, 181) |
| `src/main.ts` | Sin cambios | Verificado `:415-425` — mismo hallazgo que `autorizacion-empleado/design.md §6` |
| `docs/ARC42_*.md`, `README.md` | Modificar | Los tres comandos, la reversión de ADR 174, R1 con su procedimiento de rotación, ADR 178/179 como deuda con nombre |

## 10. Migración / Rollout

Sin migración propia (Success Criterion de `proposal.md`). Consume `0013` de `autorizacion-empleado`. Nota de despliegue: toda credencial creada por `/crear-empleado` queda con contraseña visible en el transcripto de la TUI (RD-81 opción (a), ratificada) — **procedimiento obligatorio**: rotar por CLI (`empleados:crear -- <id> --rotar`) inmediatamente después de comunicar la contraseña inicial fuera de banda.

> **Nota de reemplazo (2026-09-24)**: Reemplazado por ADR 300 (`enmascarar-password-en-tui`): la contraseña ya no se ve en el transcripto; la rotación pasa de obligatoria a recomendada, porque el administrador sigue conociendo la clave inicial (R9). Ver RD-81 (comandos-administracion-empleados).

## 11. Open Questions

- [ ] No bloqueante: el texto exacto de los mensajes `sistema(...)` (arriba, ilustrativos) puede ajustarse por copy.
- [ ] **`sdd-spec` debe propagar la corrección de ADR 185 §7** (dieciocho descriptores, no diecisiete) a los Success Criteria antes de `sdd-tasks`.
- [ ] Orden de merge (R6/R7 de `proposal.md`) sigue siendo decisión operativa del checkpoint, no de este documento.

---

**Nota de proceso**: hook de `graphify query`/`explain` exigido y sin herramienta de shell disponible (solo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que `proposal.md` y que `autorizacion-empleado/design.md`. Se compensó con lectura íntegra y verificación puntual de: `src/empleados.ts` (153 líneas, completo), `src/core/auth/credenciales-contract.ts` (completo), `src/adapters/webhooks/config.ts` (completo), `src/core/commands/comando-empleado.ts:1-480` (`DescriptorComando`, `DESCRIPTORES`, `Forma`, `parsearComando`, `formatearAyuda`), `src/build-on-comando-empleado.ts:843-975,1690-1760` (wiring de deps, `registrar()`, `manejarLogin`, el bucle de dispatch y el gate de sesión existente), `src/adapters/memory/repository.ts:1523-1612` (`insertCredencialEmpleado`, `updateCredencialEmpleado`, `buscarCredencialEmpleado`), `src/adapters/board/config.ts` (grep de `GITHUB_TOKEN`, confirmando `resolveBoardConfig`/`isBoardEnabled`), `src/main.ts:415-425` (confirmando que `buildOnComandoEmpleado` no recibe `credenciales`/`registro`/`rolPort` explícitos), `Glob` de `src/core/auth/*.ts` (confirmando que `rol-contract.ts`/`autorizacion-resolucion.ts` no existen aún — dependencia dura no satisfecha), `openspec/changes/comandos-administracion-empleados/proposal.md` **íntegro** (341 líneas) y `openspec/changes/autorizacion-empleado/design.md` **íntegro** (483 líneas). Se recomienda correr `graphify update .` una vez persistido este archivo.
