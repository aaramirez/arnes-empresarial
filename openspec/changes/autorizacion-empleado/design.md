# Diseño técnico: Autorización de Empleado — el gate de "resolver lo ajeno" y la prohibición de autoaprobación

**Entra con**: [`proposal.md`](proposal.md) (aprobada por checkpoint humano, ADR 152-156, RD-75 a RD-79) · `specs/autorizacion-empleado/spec.md` (capability nueva) · deltas de `specs/autenticacion-empleado-tui/`, `specs/reembolso-resolucion-escalacion/`, `specs/solicitud-interna-hitl/`, `specs/registro-acciones-empleado/`.

**Alcance de este documento**: el *cómo* — DDL exacto, contratos, firmas, diffs de las funciones núcleo, y la resolución de **RD-75, RD-77, RD-78, RD-79** con el código real a la vista. No es `tasks.md` ni `specs/`.

**Numeración**: el techo real verificado por la propuesta es **ADR 156** / **RD-79**. Este diseño abre en **ADR 157** y no reserva RD nuevas: las cinco quedan resueltas acá (RD-76 ya la había resuelto el checkpoint).

---

## 1. Resumen de la arquitectura elegida

Dos archivos de núcleo nuevos (`src/core/auth/rol-contract.ts`, `src/core/auth/autorizacion-resolucion.ts`), una migración nueva (`0013`, tabla propia), dos funciones núcleo **modificadas** (`resolverEscalacionReembolso`, `resolverSolicitudInterna`) y un dispatcher modificado (`build-on-comando-empleado.ts`). **`src/main.ts` no se toca** — hallazgo verificado en §7. `src/empleados.ts` gana un tercer modo. `src/core/auth/sesion.ts` y `src/core/commands/comando-empleado.ts` no se tocan (invariantes ADR 154 pto 2 y ADR 153 alternativa rechazada 3, confirmados contra el código real).

```
 ┌── src/core/auth/ (nunca importa de adapters/) ──────────────────────────┐
 │  rol-contract.ts              ★ NUEVO · sin imports (ADR 157)          │
 │                                RolEmpleado, RolEmpleadoPort            │
 │  autorizacion-resolucion.ts   ★ NUEVO · importa SOLO rol-contract.js   │
 │                                (ADR 158) puedeResolverAjeno()          │
 │  sesion.ts                    SIN CAMBIOS (ADR 154 pto 2)              │
 └──────────────────────────────────────────────────────────────────────┘
                     │ puedeResolverAjeno(rolPort, empleadoId)
        ┌────────────┴─────────────┐
        ▼                          ▼
 resolver-escalacion-reembolso.ts   resolver-solicitud-interna.ts
  MODIFICADO: +rolPort en deps       MODIFICADO: +rolPort en deps
  +variante "no_autorizado"          +variantes "no_autorizado" /
  (ADR 159)                          "autoaprobacion_prohibida" (ADR 159)
        │                          │
        └────────────┬─────────────┘
                      ▼
        build-on-comando-empleado.ts  MODIFICADO
          · wiring rolPort (costura opcional, molde `credenciales`)
          · 2 ramas nuevas por función, reusan `registrar()` existente
            → NO hay puerto de escritura nuevo (ADR 161)
                      │
                      ▼
        src/adapters/memory/
          migrations/0013_roles_empleado.ts   ★ NUEVO (ADR 157, 162)
          repository.ts                        MODIFICADO: buscarRolEmpleado / upsertRolEmpleado
                      │
        src/empleados.ts   MODIFICADO: modo "asignar-rol" (ADR 160)
```

---

## 2. ADR 157 (RD-75): `roles_empleado` es una **tabla propia**, no una columna — y el argumento decisivo es que el default-deny sale **gratis**

**Contexto**. Las dos opciones, con el código real de `0006_credenciales_empleado.ts` (4 columnas, sin `rol`) y de `credenciales-contract.ts` (`CredencialesEmpleadoPort.buscarCredencial(): CredencialEmpleado | undefined`) a la vista.

**Decisión — tabla propia**:

```sql
CREATE TABLE IF NOT EXISTS roles_empleado (
  empleado_id TEXT PRIMARY KEY,
  rol         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

Sin `FK` a `credenciales_empleado` (mismo criterio que TODO el resto del esquema de empleado — `0005:11-18`, `0008:12-17`: las filas sobreviven a lo que le pase a la fila que las originó). Sin `CHECK` sobre `rol` (ADR 152 pto 1).

**Los dos criterios de la propuesta, verificados**:

1. **Separa autenticación de autorización en el esquema, espejo de cómo ADR 154 pto 2 las separa en el TIPO.** `SesionEmpleado` (identidad autenticada) y el rol (autorización) ya son dos objetos distintos a propósito; una tabla propia hace que también sean dos tablas distintas, en vez de una columna que mezcla "quién sos" con "qué podés" en la misma fila física.
2. **Permite más de un rol por empleado sin migrar `credenciales_empleado`.** Aunque HOY la PK es `empleado_id` (un rol por fila, igual que la columna), el día que haga falta relajar esa PK a `(empleado_id, rol)` es una migración que **no toca la tabla de autenticación** — con una columna, esa misma evolución obligaría a tocar `credenciales_empleado`.

**El argumento decisivo, encontrado al verificar la mecánica de la migración (no estaba en la propuesta)**: con tabla propia, **el default-deny del ADR 156 sale gratis, sin backfill**. Una fila en `roles_empleado` NO existe hasta que `src/empleados.ts` la crea explícitamente — así que **toda fila de `credenciales_empleado` anterior a esta migración queda, por construcción, sin fila de rol**, que es exactamente el rol BASE (ADR 154 pto 5). No hace falta un `UPDATE roles = 'empleado' WHERE ...` sobre las filas existentes, ni un `DEFAULT` en el esquema: la ausencia misma **es** el default-deny. Con una columna `ALTER TABLE credenciales_empleado ADD COLUMN rol TEXT NOT NULL DEFAULT 'empleado'`, el default-deny también se cumple, pero **cada fila existente queda con un valor explícito** — nunca hay "ausencia de rol" para un empleado con credencial, lo cual friccionaría contra el invariante de ADR 154 pto 5 y el escenario del spec *"Ausencia de fila de rol nunca autoriza"* (que deja de ser un caso alcanzable para credenciales existentes).

**Alternativas consideradas**:

- *Columna `rol` en `credenciales_empleado`*: rechazada por los tres puntos de arriba. Es más simple en el sentido de "una tabla menos", pero paga esa simplicidad con backfill explícito y con mezclar auth/authz en la misma fila.
- *Migración cuenta la cantidad de empleados y hace el `UPDATE` en `0013` en vez de confiar en la ausencia*: rechazada — es exactamente el patrón que la tabla propia hace innecesario, y reintroduce el riesgo de que alguien lo lea como "default allow accidental" si el `UPDATE` se escribe mal (ej. `WHERE 1=1` con el valor equivocado).

---

## 3. ADR 158 (RD-77): un módulo de política compartido, `src/core/auth/autorizacion-resolucion.ts` — decidido con el código real de las dos funciones

**Contexto**. Con `resolver-escalacion-reembolso.ts:107-168` y `resolver-solicitud-interna.ts:132-219` completos a la vista: las dos funciones necesitan la MISMA comparación — *"¿el rol de `sesion.empleadoId`, leído por puerto, con la ausencia cayendo a base, es `administrador`?"* — y esa comparación es exactamente el invariante de seguridad más citado del Success Criteria (ADR 154 pto 5).

**Decisión — módulo compartido, no inline**:

```ts
// src/core/auth/autorizacion-resolucion.ts — sin imports salvo el propio contrato del rol.
import { ROL_ADMINISTRADOR, ROL_EMPLEADO, type RolEmpleadoPort } from "./rol-contract.js";

/**
 * ÚNICO lugar del repo que decide "¿puede resolver lo ajeno?". Los DOS call
 * sites (resolver-escalacion-reembolso.ts, resolver-solicitud-interna.ts)
 * llaman acá en vez de reimplementar la comparación — así el invariante
 * ADR 154 pto 5 (ausencia de fila ⇒ NUNCA autoriza) se prueba UNA sola vez,
 * no dos, y las dos funciones no pueden divergir en su interpretación.
 */
export function puedeResolverAjeno(rolPort: RolEmpleadoPort, empleadoId: string): boolean {
  const rol = rolPort.buscarRol(empleadoId) ?? ROL_EMPLEADO;
  return rol === ROL_ADMINISTRADOR;
}
```

**Por qué no inline (dos copias de dos líneas)**: es la trampa que ADR 153 alternativa rechazada 2 ya nombró como candidata a RD-77. Con el código real a la vista, la comparación es corta, pero es un **invariante de seguridad con su propio escenario de spec** (*"Ausencia de fila de rol nunca autoriza"*). Inline, ese escenario se testearía dos veces, contra dos copias del `??`, y una futura edición de una sola copia (ej. un fix que cambie `??` por un chequeo distinto) dejaría a la otra función con una semántica diferente sin que ningún test lo note — las dos funciones tienen suites separadas y ninguna importa a la otra. Con el módulo, hay UN test (`autorizacion-resolucion.test.ts`) que prueba la ausencia una sola vez, y los dos call sites quedan estructuralmente forzados a compartir la misma interpretación.

**Precedente del repo**: es el mismo criterio que ya usa `hitl-contract.ts` para compartir `MOTIVO_CAS`/`MOTIVO_NO_ENCONTRADA`/`ResolucionHitlResult` entre los dos dominios — un módulo chico, sin imports salvo lo estrictamente necesario, cuando dos "funciones hermanas" necesitan la MISMA decisión. Se lo pone en `src/core/auth/` (no en `src/core/hitl/`) porque es sobre ROL, no sobre el estado HITL genérico.

**Alternativas consideradas**:

- *Inline en cada función*: rechazada arriba.
- *Método en `RolEmpleadoPort` mismo (`puedeResolverAjeno` como parte del puerto)*: rechazada — mezclaría "leer un dato" (responsabilidad del puerto) con "decidir una política" (responsabilidad del núcleo), y un adaptador futuro (ej. un puerto que lea de otro storage) tendría que reimplementar la política en vez de heredarla.

---

## 4. ADR 159 (RD-78): orden de evaluación — el gate de rol y la prohibición de autoaprobación se evalúan **después** de `!confirmado`, extendiendo (no reemplazando) el molde `no_es_dueno`

**Contexto, verificado línea por línea contra el código real**:

- `resolver-solicitud-interna.ts:44-47` (`esAccionAutoservicio`, solo `cancelar`) y `:177-184` (el chequeo de dueño, que devuelve `no_es_dueno` **antes** de `if (!confirmado)`, línea 186).
- El listado SIN id de `/aprobar-solicitud`/`/rechazar-solicitud` (`:150-159`) usa `soloPropias = esAccionAutoservicio(accion)` → **false** para `aprobar`/`rechazar`, así que ya hoy — antes de este change — ese listado devuelve **todas** las solicitudes de la organización con `detalle` completo, sin filtro de dueño ni de rol. Confirmado también por el delta spec: *"ver la solicitud no requiere rol elevado, sólo resolverla"*.

**Esto cambia la pregunta de RD-78**: el molde `no_es_dueno` está ANTES de `!confirmado` porque el listado de `/cancelar-solicitud` es *soloPropias* — sin ese chequeo temprano, pedir la confirmación de una solicitud ajena (`requiere_confirmacion` con `item: solicitud` completo) sería la ÚNICA forma de ver un dato que el listado de cancelar nunca expone. **Para `aprobar`/`rechazar` esa condición no se cumple**: el `detalle` de cualquier solicitud ajena ya es visible por el listado sin id, tenga el que mira rol elevado o no. Adelantar el gate nuevo antes de `!confirmado` no compraría confidencialidad adicional — solo le impediría a un empleado sin rol ver el eco de confirmación de una acción que de todos modos no va a poder ejecutar.

**Decisión — el gate de rol y la prohibición de autoaprobación se evalúan DESPUÉS de `if (!confirmado)`, en el mismo punto donde hoy se arma `resolucionInput`** (justo antes del CAS), en este orden:

1. `esAccionAutoservicio` + dueño (sin cambios, solo `cancelar`, sigue antes de `!confirmado`).
2. `!confirmado` → `requiere_confirmacion` (sin cambios: un empleado sin rol elevado sigue viendo el eco, igual que ya podía ver el `detalle` por el listado).
3. **Para `aprobar`/`rechazar`/`reabrir` (todo lo que NO es autoservicio)**:
   a. **Gate de rol primero.** `!puedeResolverAjeno(rolPort, empleadoId)` → `no_autorizado`.
   b. **Prohibición de autoaprobación segundo** (solo solicitudes): `solicitud.solicitanteId === sesion.empleadoId` → `autoaprobacion_prohibida`.
4. CAS (sin cambios).

**Por qué el gate de rol va ANTES que la autoaprobación (3a antes que 3b), y no al revés**: son preguntas independientes (ADR 155), pero el orden decide qué mensaje ve cada actor y ninguno de los dos órdenes filtra nada que el actor no supiera ya (si es SU solicitud, ya lo sabe):
   - Empleado con **rol base** que pide su propia solicitud → 3a rechaza primero con `no_autorizado`. Mensaje correcto y completo: **no tiene autorización para resolver NADA**, sea suyo o ajeno — decirle "es autoaprobación" sería incompleto, porque aunque no fuera su solicitud, tampoco podría resolverla.
   - Empleado con **rol elevado** que pide su propia solicitud → 3a pasa (tiene rol), 3b rechaza con `autoaprobacion_prohibida`. Mensaje correcto: la ÚNICA razón del rechazo es la autoaprobación.
   - El orden inverso (autoaprobación primero) daría, para el primer caso, un mensaje técnicamente verdadero pero incompleto ("no podés aprobar la tuya") que sugeriría que SÍ podría aprobar la de otro — falso.

**Deviación explícita del molde `no_es_dueno` — y por qué es necesaria, no un capricho**: `no_es_dueno` (`:58-61`) NO lleva `casoId`, a propósito — nunca escribe una fila de auditoría por su cuenta, así que no lo necesita. Las variantes nuevas (`no_autorizado`, `autoaprobacion_prohibida`) SÍ necesitan `casoId`, porque el dispatcher las usa para escribir la fila de auditoría vía `registrar()` (ADR 161) — que exige `casoId` para correlacionar, igual que ya hace con `MOTIVO_CAS`. RD-78 pide extender el molde, no clonarlo bit a bit: se extiende agregando el campo que el nuevo requisito (fila de auditoría del rechazo, ausente en `no_es_dueno`) exige.

```ts
// resolver-solicitud-interna.ts — unión ampliada
export type ResolverSolicitudResult =
  | ResolucionHitlResult<SolicitudInterna, AccionSolicitud, SolicitudEstado>
  | { readonly resultado: "no_es_dueno"; readonly accion: AccionSolicitud; readonly itemId: string }
  | { readonly resultado: "no_autorizado"; readonly accion: AccionSolicitud; readonly itemId: string; readonly casoId: string }
  | { readonly resultado: "autoaprobacion_prohibida"; readonly accion: AccionSolicitud; readonly itemId: string; readonly casoId: string };
```

```ts
// resolver-escalacion-reembolso.ts — unión ampliada (un solo miembro nuevo; sin autoaprobación, ADR 155 pto 3 / R7)
export type ResolverEscalacionResult =
  | /* listado | requiere_confirmacion | aplicada | no_aplicable — sin cambios */
  | { readonly resultado: "no_autorizado"; readonly accion: AccionEscalacion; readonly ventaId: string; readonly casoId: string };
```

**Diff exacto de `resolverEscalacionReembolso`** (inserción entre el bloque `!confirmado` y `resolucionInput`, `resolver-escalacion-reembolso.ts:139-144`):

```ts
  if (!confirmado) {
    logEvent(venta.casoId, "reembolso-resolucion-solicitada", { accion, ventaId, monto: venta.monto });
    return { resultado: "requiere_confirmacion", accion, venta };
  }

  if (!puedeResolverAjeno(deps.rolPort, sesion.empleadoId)) {
    logEvent(venta.casoId, "reembolso-resolucion-no-autorizada", { accion, ventaId, empleadoId: sesion.empleadoId });
    return { resultado: "no_autorizado", accion, ventaId, casoId: venta.casoId };
  }

  const resolucionInput: ResolucionEscalacionInput = { /* sin cambios */ };
```

**Diff exacto de `resolverSolicitudInterna`** (inserción entre el bloque `!confirmado` y `resolucionInput`, `resolver-solicitud-interna.ts:186-191`):

```ts
  if (!confirmado) {
    logEvent(solicitud.casoId, "solicitud-resolucion-solicitada", { accion, solicitudId });
    return { resultado: "requiere_confirmacion", accion, item: solicitud };
  }

  if (!esAccionAutoservicio(accion)) {
    if (!puedeResolverAjeno(deps.rolPort, sesion.empleadoId)) {
      logEvent(solicitud.casoId, "solicitud-resolucion-no-autorizada", { accion, solicitudId, empleadoId: sesion.empleadoId });
      return { resultado: "no_autorizado", accion, itemId: solicitudId, casoId: solicitud.casoId };
    }
    if (solicitud.solicitanteId === sesion.empleadoId) {
      logEvent(solicitud.casoId, "solicitud-autoaprobacion-rechazada", { accion, solicitudId, empleadoId: sesion.empleadoId });
      return { resultado: "autoaprobacion_prohibida", accion, itemId: solicitudId, casoId: solicitud.casoId };
    }
  }

  const resolucionInput: ResolucionSolicitudInput = { /* sin cambios */ };
```

Ambos `ResolverEscalacionDeps`/`ResolverSolicitudDeps` ganan un campo **requerido** (no opcional): `readonly rolPort: RolEmpleadoPort;` — ADR 153 pto 1 ("reciben el rol, o el puerto, por deps"). Ser requerido (no con default) es intencional: es el gancho que vuelve **imposible de compilar** cualquier test o call site que "olvide" pasar el puerto — mismo criterio de "inexpresable, no testeado" que `definicion-skills` ADR 108 aplicó a `skills`/`settingSources`.

**Consecuencia de TDD explícita (Success Criteria de la propuesta)**: los fixtures existentes de `resolver-escalacion-reembolso.test.ts` y `resolver-solicitud-interna.test.ts` dejan de compilar hasta que inyecten un `rolPort` — es la forma concreta en que "el test rojo hoy pasa en verde" se vuelve, literalmente, un error de tipos antes que un test que falla en runtime.

---

## 5. ADR 160 (RD-79): `src/empleados.ts` gana un **tercer modo**, `"asignar-rol"`, disparado por un flag de valor `--rol <valor>` que NUNCA se combina con `--rotar`

**Contexto, con `parseArgsEmpleado` real (`:53-74`) a la vista**: hoy es exhaustivo sobre `{"--rotar"}`, con la regla dura *"flag desconocida ⇒ error, nunca cae al default"* (`:49-51` del comentario), y el modo se decide por presencia/ausencia de `--rotar`.

**Decisión**. Tres modos, cada uno con **una sola intención de escritura**, sin combinarse entre sí:

| Invocación | Modo | Escribe |
|---|---|---|
| `empleados:crear -- ana` | `alta` | `credenciales_empleado` (INSERT). Sin `--rol` ⇒ el nuevo empleado queda SIN fila en `roles_empleado` ⇒ rol base por ausencia (ADR 154 pto 5), gratis. |
| `empleados:crear -- ana --rotar` | `rotar` | `credenciales_empleado` (UPDATE). Sin cambios de comportamiento. |
| `empleados:crear -- ana --rol administrador` | `asignar-rol` | `roles_empleado` (UPSERT). **No** pide contraseña, **no** toca `credenciales_empleado`. Exige que `ana` YA tenga credencial — si no, error, mismo molde que `rotar` sobre un `empleadoId` inexistente. |
| `empleados:crear -- ana --rotar --rol administrador` | — | **Error explícito**: "`--rol` y `--rotar` no se combinan". |

**Por qué NO combinar `--rol` con `alta`/`rotar` en una sola escritura**: cada modo mapea a **una** sentencia SQL sobre **una** tabla — `alta`/`rotar` sobre `credenciales_empleado`, `asignar-rol` sobre `roles_empleado` — sin escritura doble en un solo invocación. Es la misma disciplina que ya tiene el archivo (una intención por invocación) y evita la pregunta ambigua "si `--rol` falla después de que `alta` ya insertó la credencial, ¿quedó a medias?" — con modos disjuntos, esa pregunta no existe.

**Por qué el día del merge (ADR 156 pto 3) esto alcanza**: el primer `administrador` (el pasante) puede recibir su rol con **una sola invocación** de `asignar-rol` sobre su `empleadoId` existente — no hace falta pasar por `rotar` para tocar el rol.

**Diff exacto de `parseArgsEmpleado`** — preserva la regla dura y la extiende:

```ts
import { ROLES_EMPLEADO, type RolEmpleado } from "./core/auth/rol-contract.js";

export type ParseArgsEmpleadoResult =
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "alta" | "rotar" }
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "asignar-rol"; readonly rol: RolEmpleado }
  | { readonly ok: false; readonly mensaje: string };

const ROLES_VALIDOS = new Set<string>(ROLES_EMPLEADO);

export function parseArgsEmpleado(argv: readonly string[]): ParseArgsEmpleadoResult {
  const flagsConocidas = new Set(["--rotar", "--rol"]);
  const flagsPresentes = argv.filter((a) => a.startsWith("--"));

  for (const flag of flagsPresentes) {
    if (!flagsConocidas.has(flag)) {
      return { ok: false, mensaje: `${USO_MENSAJE}\nFlag desconocida: ${flag}` };
    }
  }

  const rolIndex = argv.indexOf("--rol");
  const tieneRotar = argv.includes("--rotar");

  if (rolIndex !== -1 && tieneRotar) {
    return { ok: false, mensaje: `${USO_MENSAJE}\n--rol y --rotar no se combinan: son dos operaciones distintas.` };
  }

  if (rolIndex !== -1) {
    const valor = argv[rolIndex + 1];
    if (valor === undefined || !ROLES_VALIDOS.has(valor)) {
      return {
        ok: false,
        mensaje: `${USO_MENSAJE}\n--rol requiere un valor: ${ROLES_EMPLEADO.join(" | ")}.`,
      };
    }
    const empleadoId = argv.find((token, i) => i !== rolIndex && i !== rolIndex + 1 && !token.startsWith("--"));
    if (empleadoId === undefined) {
      return { ok: false, mensaje: USO_MENSAJE };
    }
    if (!ID_REGEX.test(empleadoId)) {
      return { ok: false, mensaje: `${USO_MENSAJE}\nempleadoId inválido: "${empleadoId}"` };
    }
    return { ok: true, empleadoId, modo: "asignar-rol", rol: valor as RolEmpleado };
  }

  const empleadoId = argv.find((a) => !a.startsWith("--"));
  if (empleadoId === undefined) {
    return { ok: false, mensaje: USO_MENSAJE };
  }
  if (!ID_REGEX.test(empleadoId)) {
    return { ok: false, mensaje: `${USO_MENSAJE}\nempleadoId inválido: "${empleadoId}"` };
  }
  return { ok: true, empleadoId, modo: tieneRotar ? "rotar" : "alta" };
}
```

Reglas preservadas: (a) flag desconocida ⇒ error, verificado ANTES de mirar nada más; (b) `--rol` sin valor, o con un valor fuera de `ROLES_EMPLEADO`, ⇒ error explícito, nunca cae a un rol por default; (c) sin `empleadoId` ⇒ error con el mismo `USO_MENSAJE`; (d) `ID_REGEX` se aplica igual en los tres modos.

**`main()` gana una rama** (`src/empleados.ts:98-145`): para `modo === "asignar-rol"`, **no llama a `leerPasswordDeStdin()`** — va derecho a `openDatabase`, verifica `buscarCredencialEmpleado(db, empleadoId)`; `undefined` ⇒ `"No existe el empleado \"${empleadoId}\"."`, exit 1 (mismo mensaje/molde que `rotar`); si existe, `upsertRolEmpleado(db, { empleadoId, rol: parsed.rol, ahora })` y `stdout`: `` `Rol de ${empleadoId} actualizado a ${parsed.rol}.` ``.

**Qué pasa al asignar rol a un `empleadoId` inexistente (segunda mitad de RD-79)**: **error, exit 1**, nunca crea una credencial "vacía" ni una fila de rol huérfana — mismo criterio que `rotar` sobre un empleado que no existe. Un rol sin credencial detrás no tiene a quién autenticar.

**Alternativas consideradas**:

- *Comando separado* (`empleados:asignar-rol`): rechazada — un segundo script para una sola tabla nueva es ceremonia; `parseArgsEmpleado` ya es el único parser de este archivo y extenderlo mantiene un solo punto de entrada.
- *`--rol` combinable con `alta`* (crear + asignar rol en un solo paso): rechazada por la razón de "una escritura por invocación" de arriba; además el caso de uso real del día del merge (ADR 156 pto 3) es sobre un `empleadoId` que probablemente YA existe.
- *Tercer flag booleano por rol* (`--administrador`): rechazada — no escala a un tercer rol futuro sin agregar un flag por valor, mientras que `--rol <valor>` ya absorbe cualquier miembro futuro de `ROLES_EMPLEADO` sin tocar el parser.

---

## 6. ADR 161: la fila de auditoría de un rechazo se escribe con el mecanismo que **ya existe** (`registrar()` + `RegistroAccionesEmpleadoPort`) — **no** un método de puerto nuevo

**Contexto, hallazgo verificado leyendo `build-on-comando-empleado.ts` completo**: el dispatcher YA tiene el mecanismo exacto para "escribir una fila de `registro_acciones_empleado` fuera de una transacción de dominio, cuando el CAS no matcheó" — es literalmente el caso `resultado.motivo === MOTIVO_CAS` de `manejarEscalacion`/`manejarResolucionSolicitud` (`:1096-1110`, `:1252-1265`), que llama al helper local `registrar()` (`:925-942`), el cual envuelve `registro.registrarAccion(...)` (`RegistroAccionesEmpleadoPort`, `registro-acciones-contract.ts:78-79`) y **degrada a un log si falla, nunca propaga** (ADR 40 ya vigente).

**Esto es exactamente la forma de la fila que ADR 155 pto 4 y la spec de `registro-acciones-empleado` piden para un rechazo**: una fila sin transición de dominio, escrita FUERA de cualquier transacción, con degradación en vez de propagación. **No hace falta un método nuevo en `VentaStorePort`/`SolicitudStorePort`** — inventar uno duplicaría un mecanismo que ya existe para resolver el mismo problema (fila sin CAS).

**Decisión**: las funciones núcleo (`resolverEscalacionReembolso`/`resolverSolicitudInterna`) **NO escriben** en el rechazo — igual que `no_es_dueno`/`no_aplicable` hoy, solo `logEvent`. El **dispatcher** es quien, al recibir `no_autorizado`/`autoaprobacion_prohibida`, llama a `registrar(...)` — exactamente el mismo patrón que ya usa para `MOTIVO_CAS`.

```ts
// registro-acciones-contract.ts — dos constantes nuevas, junto a las existentes
export const RESULTADO_NO_AUTORIZADO = "no_autorizado"; // /aprobar-reembolso, /rechazar-reembolso, /reabrir-reembolso, /aprobar-solicitud, /rechazar-solicitud
export const RESULTADO_AUTOAPROBACION_PROHIBIDA = "autoaprobacion_prohibida"; // /aprobar-solicitud, /rechazar-solicitud
```

```ts
// build-on-comando-empleado.ts — manejarEscalacion, rama "Coincide" (tras la línea 1088)
if (resultado.resultado === "no_autorizado") {
  registrar(
    { comando: ACCION_ESCALACION_INFO[accion].comando, ventaId: ventaIdInput, casoId: resultado.casoId, resultado: RESULTADO_NO_AUTORIZADO },
    ahora,
  );
  return sistema(`No estás autorizado para ${accion} esa escalación de reembolso: se requiere rol elevado.`);
}
```

```ts
// build-on-comando-empleado.ts — manejarResolucionSolicitud, rama "Coincide" (tras la línea 1246)
if (resultado.resultado === "no_autorizado") {
  registrar({ comando: ACCION_SOLICITUD_COMANDO[accion], casoId: resultado.casoId, resultado: RESULTADO_NO_AUTORIZADO }, ahora);
  return sistema(`No estás autorizado para ${accion} esa solicitud: se requiere rol elevado.`);
}
if (resultado.resultado === "autoaprobacion_prohibida") {
  registrar({ comando: ACCION_SOLICITUD_COMANDO[accion], casoId: resultado.casoId, resultado: RESULTADO_AUTOAPROBACION_PROHIBIDA }, ahora);
  return sistema(`No podés ${accion} tu propia solicitud, aunque tengas rol elevado.`);
}
```

Ambas ramas van **antes** de `if (resultado.resultado === "no_aplicable")` en cada función (orden de `if` sin efecto funcional entre variantes disjuntas, pero se agrupan junto a `"aplicada"` por legibilidad).

**Actualización de comentario requerida** (`registro-acciones-contract.ts:75-76`): hoy dice *"Las filas de los TRES comandos de resolución NO pasan por acá: viajan dentro de la transacción del CAS"* — deja de ser exacto sin matiz: las filas de una resolución **exitosa** siguen viajando en la transacción; un **intento rechazado** por rol o autoaprobación sí pasa por este puerto, igual que ya pasa un intento rechazado por CAS-no-matcheado.

**Consecuencia verificada, corrigiendo la tabla *Affected Areas* de la propuesta**: **`src/main.ts` no necesita ningún cambio.** `credenciales`, `registro` y `reporteStore` en `BuildOnComandoEmpleadoDeps` son costuras OPCIONALES con default construido DENTRO de `build-on-comando-empleado.ts` (`:849-865`), y `main.ts` (`:415-425`) verificado — **no pasa ninguna de las tres**. `rolPort` sigue el MISMO molde: costura opcional, default `{ buscarRol: (id) => { const row = buscarRolEmpleado(db, id); return row ? (row.rol as RolEmpleado) : undefined; } }`. La entrada "Modificado: el puerto de rol entra en las deps" de la tabla *Affected Areas* de `proposal.md` queda corregida por este hallazgo — no aplica.

**Alternativas consideradas**:

- *Nuevo método en `VentaStorePort`/`SolicitudStorePort`* (`registrarIntentoNoAutorizado`): rechazada — duplica `RegistroAccionesEmpleadoPort` para el mismo problema, y obligaría a tocar DOS contratos de puerto (`ventas-contract.ts`, `solicitudes-contract.ts`) por un concern que es de auditoría, no de ventas ni de solicitudes.
- *Escribir la fila DENTRO de la función núcleo*, pasándole `registro: RegistroAccionesEmpleadoPort` por `deps`: rechazada — rompería "PURA y SÍNCRONA, sin escrituras salvo por `store`" documentado en el header de ambos archivos, y desalinearía el rechazo por rol del rechazo por CAS (que hoy, deliberadamente, también se escribe afuera).

---

## 7. ADR 162: el rol se lee por puerto — contrato exacto y wiring

```ts
// src/core/auth/rol-contract.ts — sin imports, molde exacto de credenciales-contract.ts
export const ROL_EMPLEADO = "empleado";
export const ROL_ADMINISTRADOR = "administrador";
export const ROLES_EMPLEADO = [ROL_EMPLEADO, ROL_ADMINISTRADOR] as const;
export type RolEmpleado = (typeof ROLES_EMPLEADO)[number];

/**
 * UNA sola operación, de LECTURA, síncrona. `undefined` = ausencia de fila,
 * NUNCA un tercer valor — la interpretación de esa ausencia (ADR 154 pto 5)
 * vive en `autorizacion-resolucion.ts`, no acá ni en el adaptador: así el
 * invariante de seguridad no depende de que un adaptador futuro lo copie bien.
 */
export interface RolEmpleadoPort {
  buscarRol(empleadoId: string): RolEmpleado | undefined;
}
```

**`src/adapters/memory/repository.ts` — dos funciones nuevas**, molde exacto de `buscarCredencialEmpleado`/`updateCredencialEmpleado` (`:1554-1611`):

```ts
export interface RolEmpleadoRow {
  readonly empleadoId: string;
  readonly rol: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** `SELECT ... WHERE empleado_id = ?`. `undefined` = sin fila (ADR 154 pto 5: el núcleo decide que eso es rol base, no este adaptador). */
export function buscarRolEmpleado(db: Database.Database, empleadoId: string): RolEmpleadoRow | undefined;

/**
 * UPSERT (`ON CONFLICT(empleado_id) DO UPDATE`, molde ya usado en este
 * archivo — `:347`, `:392`, `:702`). `created_at` se fija SOLO en el INSERT
 * inicial; `updated_at` se pisa siempre — mismo criterio de `0006`/ADR 156
 * pto 4 (un cambio de rol es un evento auditable).
 */
export function upsertRolEmpleado(
  db: Database.Database,
  input: { readonly empleadoId: string; readonly rol: string; readonly ahora: string },
): RolEmpleadoRow;
```

**Wiring en `build-on-comando-empleado.ts`** (junto a `credenciales`, `:849-856`):

```ts
const rolPort: RolEmpleadoPort =
  deps.rolPort ??
  {
    buscarRol: (empleadoId) => {
      const row = buscarRolEmpleado(db, empleadoId);
      return row ? (row.rol as RolEmpleado) : undefined;
    },
  };
```

`BuildOnComandoEmpleadoDeps` gana `readonly rolPort?: RolEmpleadoPort;` (costura de test opcional, junto a `credenciales`/`registro`). Los TRES call sites de `resolverEscalacionReembolso` (líneas 1041, 1059, 1085) y los TRES de `resolverSolicitudInterna` (líneas 1195, 1213, 1243) agregan `rolPort` al objeto `deps` inline.

---

## 8. Migración `0013` y `migrations/index.ts`

```ts
// src/adapters/memory/migrations/0013_roles_empleado.ts
export const migration0013RolesEmpleado = {
  id: "0013_roles_empleado",
  sql: `
CREATE TABLE IF NOT EXISTS roles_empleado (
  empleado_id TEXT PRIMARY KEY,
  rol         TEXT NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
`,
};
```

`migrations/index.ts`: una línea de `import` + una entrada **al final** del array (`migrations`), después de `migration0012IdxSolicitudesA2AEntrantesEstado`. Ninguna de las doce entradas previas se edita ni se reordena (`index.ts:20-23`, convención confirmada).

---

## 9. Componentes — mapa capability → módulos

| Capability | Módulos | ¿1:1? |
|---|---|---|
| `autorizacion-empleado` | `rol-contract.ts` + `autorizacion-resolucion.ts` + `migrations/0013_roles_empleado.ts` + `repository.ts` (`buscarRolEmpleado`/`upsertRolEmpleado`) + `registro-acciones-contract.ts` (2 constantes) + `src/empleados.ts` (modo `asignar-rol`) | 1:N — es la capability con el modelo y el provisioning |
| `reembolso-resolucion-escalacion` | `resolver-escalacion-reembolso.ts` (gate) | 1:1 |
| `solicitud-interna-hitl` | `resolver-solicitud-interna.ts` (gate + autoaprobación) | 1:1 |
| `registro-acciones-empleado` | `registro-acciones-contract.ts` (constantes) + `build-on-comando-empleado.ts` (`registrar()` reusado) | Sin módulo propio nuevo — el mecanismo ya existía |

---

## 10. Testing (TDD estricto)

| Archivo | Qué se agrega/cambia |
|---|---|
| `rol-contract.test.ts` | Nuevo. `ROLES_EMPLEADO` tiene exactamente 2 miembros. Cero imports del archivo (molde de los `*-contract.test.ts` existentes). |
| `autorizacion-resolucion.test.ts` | Nuevo. `puedeResolverAjeno`: rol `administrador` explícito ⇒ `true`; rol `empleado` explícito ⇒ `false`; **puerto devuelve `undefined` ⇒ `false`** (el test que hace el invariante de ADR 154 pto 5 verificable). |
| `resolver-escalacion-reembolso.test.ts` | **Modificado**: todos los fixtures inyectan `rolPort`. Nuevo: rol base + `confirmado:true` sobre las tres acciones ⇒ `no_autorizado`, sin tocar `ventas.estado`/`casos.estado`. Rol elevado ⇒ comportamiento idéntico al de antes del change (regresión). |
| `resolver-solicitud-interna.test.ts` | **Modificado**: fixtures con `rolPort`. Nuevos: rol base + `aprobar` ajena ⇒ `no_autorizado`; rol elevado + solicitud propia ⇒ `autoaprobacion_prohibida`; rol base + `cancelar` propia ⇒ sigue aplicando (gate no la toca); rol elevado + ajena ⇒ aplica igual que antes. |
| `empleados.test.ts` | **Modificado**: `parseArgsEmpleado` — `--rol administrador` solo ⇒ `modo: "asignar-rol"`; `--rol` sin valor / con valor inválido ⇒ `ok:false`; `--rol` + `--rotar` juntos ⇒ `ok:false`; flag desconocida sigue rechazando primero. |
| `repository.test.ts` (o colocado de `roles_empleado`) | `buscarRolEmpleado` sobre tabla vacía ⇒ `undefined`; `upsertRolEmpleado` dos veces sobre el mismo `empleadoId` ⇒ `created_at` no cambia, `updated_at` sí (mismo test que ya existe para `updateCredencialEmpleado`). |
| `build-on-comando-empleado.test.ts` | **Modificado**: rol base confirma `/aprobar-reembolso` ⇒ mensaje de no autorizado + fila en `registro_acciones_empleado` con `resultado: "no_autorizado"`; rol elevado + solicitud propia confirma `/aprobar-solicitud` ⇒ fila `"autoaprobacion_prohibida"`; `git diff` de `sesion.ts`/`comando-empleado.ts` vacío (test de regresión explícito, Success Criteria). |
| `migrations/index.test.ts` (o equivalente) | `0013` aplica sobre una BD con filas previas de `credenciales_empleado` ⇒ cero filas en `roles_empleado` tras migrar (verificación directa del default-deny sin backfill, ADR 157). |

---

## 11. Archivos — resumen

| Archivo | Acción | Resumen |
|---|---|---|
| `src/core/auth/rol-contract.ts` | Crear | `RolEmpleado`, `RolEmpleadoPort` (ADR 157, 162) |
| `src/core/auth/autorizacion-resolucion.ts` | Crear | `puedeResolverAjeno` (ADR 158) |
| `src/adapters/memory/migrations/0013_roles_empleado.ts` | Crear | Tabla `roles_empleado` (ADR 157) |
| `src/adapters/memory/migrations/index.ts` | Modificar | +1 import, +1 entrada final |
| `src/adapters/memory/repository.ts` | Modificar | `buscarRolEmpleado`, `upsertRolEmpleado` (ADR 162) |
| `src/core/ventas/resolver-escalacion-reembolso.ts` | Modificar | +`rolPort` en deps, +`no_autorizado` (ADR 159) |
| `src/core/solicitudes/resolver-solicitud-interna.ts` | Modificar | +`rolPort` en deps, +`no_autorizado`/`autoaprobacion_prohibida` (ADR 159) |
| `src/core/commands/registro-acciones-contract.ts` | Modificar | +2 constantes `RESULTADO_*`, comentario `:75-76` actualizado (ADR 161) |
| `src/build-on-comando-empleado.ts` | Modificar | wiring `rolPort`, 2 ramas nuevas × 2 funciones, reusa `registrar()` (ADR 161, 162) |
| `src/empleados.ts` | Modificar | modo `asignar-rol`, `parseArgsEmpleado` extendido (ADR 160) |
| `src/main.ts` | **Sin cambios** | Verificado — corrige *Affected Areas* de `proposal.md` (ADR 161) |
| `src/core/auth/sesion.ts` | Sin cambios | ADR 154 pto 2, confirmado |
| `src/core/commands/comando-empleado.ts` | Sin cambios | ADR 153 alt. rechazada 3, confirmado |
| `docs/ARC42_Harness_Empresarial.md`, `README.md` | Modificar | Autenticación vs. autorización, R10 cerrada, R7 documentada como deuda |

---

## 12. Migración / Rollout

Sin pasos nuevos respecto de `proposal.md` — `0013` es aditiva y no requiere `down`. La nota de despliegue (empleado_id concreto del primer `administrador`) queda para la carpeta de progreso (ADR 156 pto 3), no para este documento. Operacionalmente, el comando exacto es:

```
npm run empleados:crear -- <empleadoId-del-pasante> --rol administrador
```

sobre un `empleadoId` que YA tiene credencial (si no la tiene, `empleados:crear -- <empleadoId>` primero, sin `--rol`, y luego el comando de arriba).

## 13. Open Questions

Ninguna bloqueante — las cinco RD (75, 77, 78, 79, y la ya resuelta 76) quedan resueltas en este documento. Un punto no-bloqueante para `sdd-tasks`: el texto exacto de los mensajes `sistema(...)` de rechazo (arriba, ilustrativos) puede ajustarse por copy sin impacto arquitectónico.

---

**Nota de proceso**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Edit`/`Write`/`Grep`/`Glob`), misma limitación ya documentada por `proposal.md` y por los cinco `spec.md` de este change. Se compensó con lectura directa e íntegra de: `src/core/solicitudes/resolver-solicitud-interna.ts` (219 líneas), `src/core/ventas/resolver-escalacion-reembolso.ts` (168 líneas), `src/core/auth/credenciales-contract.ts`, `src/core/auth/sesion.ts`, `src/empleados.ts` (153 líneas), `src/core/ventas/ventas-contract.ts`, `src/core/solicitudes/solicitudes-contract.ts`, `src/core/commands/registro-acciones-contract.ts`, `src/adapters/memory/migrations/index.ts`, `src/adapters/memory/migrations/0006_credenciales_empleado.ts`, `src/adapters/memory/repository.ts:1310-1630` (registro de acciones + CAS transaccional de escalación + credenciales) y `:340-392,700-702` (precedente de `ON CONFLICT`), `src/build-on-comando-empleado.ts:281-350,840-880,895-1270,1690-1735` (deps, wiring, las dos funciones `manejar*`, la guarda de sesión), `src/main.ts:395-425` (verificado que `credenciales`/`registro`/`reporteStore` NO se pasan explícitamente — la base del hallazgo del ADR 161), `src/core/commands/comando-empleado.ts` (grep de `privilegiado`), y los dos `design.md` de referencia (`definicion-skills`, `hito-1.2-bot-revision-prs`) para el formato y el nivel de rigor. Toda cita de línea en este documento corresponde a los archivos tal como existían al momento de esta lectura. Se recomienda correr `graphify update .` una vez persistido este archivo.
