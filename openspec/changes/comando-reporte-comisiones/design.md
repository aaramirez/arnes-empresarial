> **Nota de proceso (herramientas)**: el hook de este repo exige `graphify query`/`explain`/`path` antes de leer código fuente. Esta fase corrió **sin herramienta de shell disponible** (solo `Read`/`Grep`/`Glob`/`Write`/`Edit`), misma limitación que la propuesta ya documentó. Se compensó leyendo completos: `src/core/commands/comando-empleado.ts` (444 líneas), `src/core/commands/registro-acciones-contract.ts` (77 líneas), `src/core/ventas/reporte.ts` (251 líneas), `src/reporte-mensual.ts` (110 líneas), `src/adapters/memory/repository.ts:1040-1189` (`listComisionesPorPeriodo`, `listVentasEnReembolsoPendiente`), `src/build-on-comando-empleado.ts:1-100, 230-370, 420-520, 640-732, 1090-1200, 1420-1463` (deps, wiring de puertos, `manejarVerPropuesta`, `manejarConsultarKpi`, preámbulo y switch), `src/adapters/tui/App.tsx` (imports y render de `<Text>`/`<Static>`, grep de `wrap`/`columns`), y `openspec/config.yaml`. Techos confirmados por `grep`: **ADR 115** (`definicion-skills/design.md:189`) y **RD-54** (`definicion-skills/design.md:528`) — nada por encima en `openspec/`. Este diseño abre en **ADR 121** y resuelve **RD-55 a RD-58**, sin abrir RDs nuevas.

# Diseño técnico: `/reporte-comisiones [periodo]` — cableado del Registro de Comandos (v3.2.0)

**Origen**: [`proposal.md`](proposal.md) (ADR 116-120, R1-R7, RD-55 a RD-58) · aprobada por checkpoint humano en su decisión central (ADR 116). No se reabre.

**Rama**: `hito/v3.2-comando-reporte-comisiones` · **Tag**: `v3.2.0` (propuesto) · **Progreso**: `docs/progreso/v3.2-comando-reporte-comisiones/`.

---

## 1. Resumen de la arquitectura elegida

Un descriptor, un handler, un puerto de lectura nuevo de dos métodos, y una función pura nueva — **cero archivos de `src/adapters/*` tocados**, **cero migraciones**, **cero dependencias nuevas**:

```
 ┌── src/core/ (nunca importa de adapters/) ──────────────────────────────┐
 │                                                                        │
 │  commands/comando-empleado.ts        MODIFICADO · descriptor 16,       │
 │                                       Forma "id_opcional_periodo",     │
 │                                       brazo `reporte_comisiones`       │
 │                                                                        │
 │  commands/registro-acciones-contract.ts  MODIFICADO · +1 constante     │
 │                                       `COMANDO_REPORTE_COMISIONES`     │
 │                                                                        │
 │  ventas/reporte.ts                   MODIFICADO (aditivo) · +función   │
 │                                       pura `resolverPeriodoReporte`    │
 │                                       (RD-57). `agruparReporteMensual`/│
 │                                       `formatearReporteMensual` sin    │
 │                                       tocar — R2 vive del lado del     │
 │                                       CONSUMIDOR, no del formato       │
 │                                                                        │
 │  ventas/reporte-contract.ts          ★ NUEVO · `ReporteStorePort`      │
 │                                       (RD-55) — módulo hermano que la  │
 │                                       propuesta ya anticipó            │
 └────────────────────────────────────────────────────────────────────────┘
                                        │ consumido por
 ┌── src/ (build-on-*, wiring, importa de core Y de adapters) ────────────┐
 │                                                                        │
 │  build-on-comando-empleado.ts        MODIFICADO · `reporteStore`       │
 │                                       (default-closure sobre           │
 │                                       repository.ts, RD-55) +          │
 │                                       `manejarReporteComisiones` +     │
 │                                       rama del switch                  │
 └────────────────────────────────────────────────────────────────────────┘
                                        │ reusa tal cual
 ┌── src/adapters/memory/repository.ts — SIN CAMBIOS ─────────────────────┐
 │  listComisionesPorPeriodo(db, periodo) · listVentasEnReembolsoPendiente(db) │
 └────────────────────────────────────────────────────────────────────────┘
```

`src/reporte-mensual.ts` **no se toca** (ADR 118) — ni una línea, ni un import nuevo. Esa restricción es la que fija RD-55 y RD-57 más abajo: no hay refactor compartido posible sin violar una decisión ya aprobada por el checkpoint.

---

## 2. Decisiones de arquitectura (ADR 121-124)

### ADR 121 (RD-55): `ReporteStorePort` de dos métodos en un módulo hermano nuevo, wiring por closure inline — y `parsePeriodo` **NO** sube al núcleo

**Contexto**. Dos preguntas separadas, y la propuesta las ató en la misma RD: (a) qué forma tiene el puerto de lectura del reporte, (b) si `parsePeriodo` (`reporte-mensual.ts:68-83`) se comparte con el comando.

**Decisión**:

1. **Puerto de dos métodos, sin traducción de filas.** `listComisionesPorPeriodo`/`listVentasEnReembolsoPendiente` (`repository.ts:1099`, `:1169`) ya devuelven `ComisionConVentaRow`/`VentaPendienteReembolsoRow` con la MISMA forma, campo a campo, que `ComisionConVenta`/`VentaPendienteReembolso` de `reporte.ts` (comentario explícito en `repository.ts:1046-1053`: *"los shapes se alinean por convención para que el composition root pueda pasar esta lectura directo a `agruparReporteMensual` sin capa de traducción"*). No hace falta un `createReporteStore(db)` con mapeo — el molde correcto es el de `credenciales`/`registro` (`build-on-comando-empleado.ts:648-657`: objeto inline con closures directos sobre `db`), no el de `createSolicitudStore`/`createPropuestaStore` (que sí traducen filas con estados validados).
2. **Vive en `src/core/ventas/reporte-contract.ts`, módulo nuevo.** La propia propuesta lo anticipó (`proposal.md:180`: *"Posible movida de `parsePeriodo` acá o a un módulo hermano"*). Sigue el patrón `{dominio}-contract.ts` de `ventas-contract.ts`/`solicitudes-contract.ts`/`propuestas-contract.ts`: el contrato de puerto vive separado de las funciones puras que lo consumen. `reporte.ts` no gana un import nuevo — es `reporte-contract.ts` el que importa `type { ComisionConVenta, VentaPendienteReembolso }` desde `./reporte.js`, no al revés.
3. **`parsePeriodo` NO se mueve.** Es la consecuencia dura, no una preferencia: **ADR 118 ya fijó, aprobado por el checkpoint, "sin cambios de código en `src/reporte-mensual.ts`"** — ni un refactor que preserve comportamiento cuenta como "cero cambios" si toca una línea del archivo. Mover `parsePeriodo` al núcleo para compartirla exigiría como mínimo cambiar su import en `reporte-mensual.ts`. Eso reabre una decisión que el checkpoint ya cerró. Se resuelve con una **segunda función**, pura y desacoplada (ADR 123, RD-57), y R6 se mitiga con un test de equivalencia, no con código compartido.

**Alternativas consideradas**:
- *`createReporteStore(db)` con traducción de filas, molde de `createSolicitudStore`*: **rechazada** — no hay ningún campo que traducir ni ningún estado que validar (a diferencia de `PropuestaEstadoInvalidoError`). Sería ceremonia sin función.
- *Reusar `VentaStorePort` agregando los dos métodos ahí*: **rechazada** — `VentaStorePort` (`ventas-contract.ts:117`) es el store transaccional de escritura de ventas (CAS, `aprobarReembolso`, etc.); el reporte es 100% lectura y no comparte ninguna invariante con ese puerto. Mezclarlos infla la superficie de un contrato que hoy tiene una sola responsabilidad.
- *Mover `parsePeriodo` a `reporte.ts` y hacer que `reporte-mensual.ts` la importe*: **rechazada por el punto 3** — viola ADR 118 tal como está escrito, no como se podría reinterpretar.

### ADR 122 (RD-56): el registro reusa `RESULTADO_ATENDIDA` — no se agrega una constante nueva

**Contexto**. El vocabulario de `resultado` (`registro-acciones-contract.ts:23-34`) ya tiene doce constantes, cada una con un comentario de quién la usa.

**Decisión**. **`RESULTADO_ATENDIDA`**, el mismo valor que usan `/soporte` y `/consultar-kpi` para "la consulta se respondió". `/reporte-comisiones` no tiene una dualidad éxito/fracaso de negocio real: no hay dependencia externa que pueda fallar (a diferencia de `/consultar-kpi`, que depende de un agente A2A y por eso SÍ necesita `RESULTADO_FALLIDA`). Una lectura de SQLite que agrega con dos funciones puras o produce un resultado, o el proceso entero está roto (no es un estado de negocio afirmable). Agregar `"consultada"` sería una constante con la MISMA semántica que `RESULTADO_ATENDIDA` ("la solicitud de información se cumplió"), pagada por todo lector futuro del vocabulario.

**Alternativas consideradas**: *constante propia `RESULTADO_CONSULTADA`*: **rechazada** — cero valor discriminante frente a `RESULTADO_ATENDIDA`; el vocabulario ya documenta con un comentario de una línea quién usa cada constante, y agregar una redundante rompe esa disciplina sin necesidad.

### ADR 123 (RD-57): validación de `YYYY-MM` en el HANDLER vía función pura nueva — período malformado responde con mensaje de uso propio, no `/ayuda motivo "argumentos"`

**Contexto**. El parser (`comando-empleado.ts`) **nunca valida la forma** de ningún id opcional — `ventaId`, `solicitudId` y `propuestaId` pasan como `string` plano, sin regex, sin chequeo de existencia (eso vive en el caso de uso, ver comentario `comando-empleado.ts:29-33`). `periodo` es el primer campo de un `id_opcional_*` que SÍ tiene un formato verificable en el momento del parseo. Cambiar ese precedente en el parser sería una asimetría nueva, no una corrección.

**Decisión**:

1. **El parser trata `periodo` igual que los demás ids opcionales: lo pasa TAL CUAL, sin validar.** Consistente con el precedente literal de `id_opcional_solicitud`/`id_opcional_propuesta` (ADR 56/69) — cero excepciones nuevas en `parsearComando`.
2. **La validación vive en `resolverPeriodoReporte`** (`reporte.ts`, PURA, nueva — ver firma en §3), invocada desde el handler. Reusa el MISMO regex que `PERIODO_REGEX` de `reporte-mensual.ts:51` (`/^\d{4}-(0[1-9]|1[0-2])$/`), **duplicado literal, no importado** (ADR 121 punto 3: `reporte-mensual.ts` no se toca). Un test de equivalencia (`reporte.test.ts`) alimenta el mismo set de strings válidos/inválidos a `parsePeriodo` y a `resolverPeriodoReporte` y afirma que aceptan/rechazan igual — así R6 queda mitigado sin compartir código.
3. **Un período malformado responde con un mensaje de uso propio del handler** (`"Periodo inválido. Formato esperado: YYYY-MM."`), **no** con `{ tipo: "ayuda", motivo: "argumentos" }`. Motivo: `motivo: "argumentos"` es del PARSER, para argumentos OBLIGATORIOS ausentes (`comando-empleado.ts:301-305`) — `periodo` es opcional y el parser ya lo aceptó sintácticamente; rechazarlo es una regla de dominio del handler, mismo nivel que "no existe ninguna propuesta X" en `manejarVerPropuesta:1125`. Enrutarlo por `/ayuda` mezclaría dos categorías de error que el propio parser ya separa.
4. **No se registra fila cuando el período es inválido.** Es un corte ANTES de cualquier lectura — mismo molde que `manejarConsultarKpi` cuando `clienteA2A === undefined` (`build-on-comando-empleado.ts:1164-1166`: *"SIN caso, SIN fila"*). No hay nada que auditar todavía.

**Alternativas consideradas**:
- *Regex inline en el parser + `/ayuda motivo "argumentos"`*: **rechazada por el punto 1** — ningún otro `id_opcional_*` valida forma en el parser; inaugurar la excepción justo acá no tiene justificación de dominio, solo conveniencia.
- *Importar `PERIODO_REGEX` desde `reporte-mensual.ts` hacia el core*: **imposible** — `src/core/` nunca importa de `src/` fuera de `core/` (regla no negociable de `AGENTS.md`, `openspec/config.yaml:50`), y `reporte-mensual.ts` vive fuera de `core/`.

### ADR 124 (RD-58): R2 se acepta con wrap de Ink, se documenta el ancho mínimo — truncar o anteponer un aviso violarían el propio Success Criteria de la propuesta

**Contexto**. `formatearReporteMensual` produce líneas de 77 columnas fijas (`reporte.ts:151-156`). `App.tsx:368-376` renderiza la respuesta con `<Text>{agentLabel}: {responseText}</Text>` — **sin `<Box width={...}>`, sin prop de wrap explícita**: es el `<Text>` de Ink puro, que envuelve al ancho de la terminal (confirmado por lectura del componente; cero configuración de ancho en todo `App.tsx`). En una terminal angosta, cada fila de la tabla se corta y reordena, y el layout de columnas deja de alinear.

**Decisión**. **Se acepta el wrap y se documenta un ancho mínimo recomendado (≥80 columnas) en el README**, sin tocar código de presentación. Esta NO es la opción "más simple por pereza" — es la ÚNICA compatible con una decisión que la propia propuesta ya fijó como Success Criteria y que este diseño no puede reabrir:

> *"`/reporte-comisiones 2026-08` con sesión vigente devuelve **exactamente el mismo string** que `npm run reporte:mensual -- --periodo 2026-08` sobre la misma base. Verificado con un test que compara las dos salidas."* (`proposal.md:227`)

Eso fija `responseText` del comando = `formatearReporteMensual(reporte)` **byte a byte**, sin margen para tocarlo del lado del comando:

1. **Truncar** cambiaría el string devuelto — el test de igualdad byte a byte fallaría por construcción. No es una opción disponible, es una contradicción con un Success Criterion ya aprobado.
2. **Anteponer un aviso** (`"⚠ Tu terminal tiene menos de 80 columnas...\n\n" + texto`) también cambia el `responseText` completo — mismo problema. Y `TuiTurnResult` no tiene un segundo campo donde meter un aviso separado del texto del reporte (`{ responseText, agentLabel }`, sin campo de metadata).
3. **Aceptar el wrap** dentro de Ink es entonces la única superficie de decisión real, y coincide con R3 (ya evaluado y aceptado): el listado de `/aprobar-reembolso` sin id ya puede envolver en terminales angostas y nadie lo reportó como bloqueante — es el mismo mecanismo de Ink, la misma superficie.

**Consecuencia verificable**: la medición de ancho que pide el Success Criteria (*"evidencia manual, incluyendo la medición de ancho de R2"*) se documenta en `docs/progreso/v3.2-comando-reporte-comisiones/` como observación (terminal de N columnas ⇒ tabla legible/rota), no como un bug a corregir. El README gana una nota: *"El reporte usa un layout de 77 columnas fijas; en terminales más angostas Ink lo envuelve línea por línea. Recomendado: terminal ≥80 columnas al usar `/reporte-comisiones`."*

**Alternativas consideradas**:
- *Truncar columnas o abreviar nombres*: **rechazada por el punto 1**, y además está explícitamente fuera de alcance (*"Cambiar el formato del reporte... está fuera de alcance"*, `proposal.md:47`).
- *Aviso de ancho mínimo ANTES del texto, aceptando que el test de igualdad se relaje a "contiene" en vez de "es igual"*: **rechazada** — relajar el Success Criteria es una decisión del checkpoint, no de `sdd-design`; el criterio tal como está escrito no deja margen.
- *Renderizar el reporte en un `<Box>` con `overflowX="scroll"` o similar en `App.tsx`*: **rechazada** — tocaría el adaptador TUI, que el Affected Areas de la propuesta marca explícito como "Sin cambios" (`proposal.md:183`: *"El adaptador TUI sigue sin saber que existen los comandos"*), y es exactamente el tipo de "rediseño del formato" que el scope excluye.

---

## 3. Interfaces / firmas concretas

**`src/core/ventas/reporte-contract.ts`** (nuevo):

```ts
import type { ComisionConVenta, VentaPendienteReembolso } from "./reporte.js";

export interface ReporteStorePort {
  listComisionesPorPeriodo(periodo: string): readonly ComisionConVenta[];
  listVentasEnReembolsoPendiente(): readonly VentaPendienteReembolso[];
}
```

**`src/core/ventas/reporte.ts`** (aditivo — nueva función, sin tocar las dos existentes):

```ts
const PERIODO_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/;

export type ResolverPeriodoReporteResult =
  | { readonly ok: true; readonly periodo: string }
  | { readonly ok: false; readonly mensaje: string };

/** RD-57 — regex y default DUPLICADOS de `parsePeriodo` (`reporte-mensual.ts`),
 *  no compartidos (ADR 118, ADR 121 pto 3). `reporte.test.ts` trae el test
 *  de equivalencia que mitiga R6. */
export function resolverPeriodoReporte(
  argumento: string | undefined,
  ahora: string,
): ResolverPeriodoReporteResult {
  if (argumento === undefined) {
    return { ok: true, periodo: ahora.slice(0, 7) };
  }
  if (!PERIODO_REGEX.test(argumento)) {
    return { ok: false, mensaje: "Periodo inválido. Formato esperado: YYYY-MM." };
  }
  return { ok: true, periodo: argumento };
}
```

**`src/core/commands/comando-empleado.ts`** (delta sobre lo existente):

```ts
// Forma:
type Forma = "sin_argumentos" | "id_opcional" | "id_mas_resto"
  | "id_opcional_solicitud" | "id_opcional_propuesta" | "id_opcional_periodo";

// ComandoEmpleado, brazo nuevo antes de "ayuda":
| { readonly tipo: "reporte_comisiones"; readonly periodo?: string }

// DESCRIPTORES, antes de /ayuda:
{
  nombre: "/reporte-comisiones",
  uso: "/reporte-comisiones [periodo]",
  ayuda: "Muestra el reporte mensual de comisiones (mes corriente si se omite el período).",
  privilegiado: true, // ADR 117
  secreto: false,
  forma: "id_opcional_periodo",
  tipo: "reporte_comisiones",
},

// parsearComando, rama nueva calcada de "id_opcional_propuesta":
if (descriptor.forma === "id_opcional_periodo") {
  const periodo = restoLinea === undefined ? undefined : splitPrimerEspacio(restoLinea).primero;
  const tipo = descriptor.tipo;
  return periodo === undefined ? { tipo } : { tipo, periodo };
}
```

**`src/core/commands/registro-acciones-contract.ts`** (delta):

```ts
export const COMANDO_REPORTE_COMISIONES = "/reporte-comisiones"; // v3.2.0
```

**`src/build-on-comando-empleado.ts`** — el cableado pedido:

```ts
// BuildOnComandoEmpleadoDeps, nuevo campo:
/** RD-55 — default: closure directo sobre listComisionesPorPeriodo/listVentasEnReembolsoPendiente (repository.ts). */
readonly reporteStore?: ReporteStorePort;

// Wiring, junto a `credenciales`/`registro` (mismo molde inline, sin createXStore):
const reporteStore: ReporteStorePort =
  deps.reporteStore ?? {
    listComisionesPorPeriodo: (periodo) => listComisionesPorPeriodo(db, periodo),
    listVentasEnReembolsoPendiente: () => listVentasEnReembolsoPendiente(db),
  };

/**
 * `/reporte-comisiones [periodo]` (RD-55/56/57/58). UN SOLO PASO, de solo
 * lectura — mismo molde que `manejarVerPropuesta`: nunca toca
 * `confirmacionPendiente`, nunca es `async` (sin await al modelo, sin
 * transacción). `privilegiado: true` ya lo garantizó el preámbulo (paso 6).
 * Devuelve LITERALMENTE `formatearReporteMensual(...)` sin envolver —
 * ADR 124: cualquier texto agregado rompería el Success Criteria de
 * igualdad byte a byte contra `npm run reporte:mensual`.
 */
function manejarReporteComisiones(
  comando: Extract<ComandoEmpleado, { tipo: "reporte_comisiones" }>,
  ahora: string,
): TuiTurnResult {
  const resuelto = resolverPeriodoReporte(comando.periodo, ahora);
  if (!resuelto.ok) {
    return sistema(resuelto.mensaje); // SIN fila (ADR 123 pto 4)
  }

  const comisiones = reporteStore.listComisionesPorPeriodo(resuelto.periodo);
  const reembolsosPendientes = reporteStore.listVentasEnReembolsoPendiente();
  const reporte = agruparReporteMensual({ periodo: resuelto.periodo, comisiones, reembolsosPendientes });

  registrar({ comando: COMANDO_REPORTE_COMISIONES, resultado: RESULTADO_ATENDIDA }, ahora);
  return sistema(formatearReporteMensual(reporte));
}

// switch (comando.tipo), rama nueva:
case "reporte_comisiones":
  return manejarReporteComisiones(comando, ahora);
```

Nota de tipo: el `switch` mezcla ramas `sync`/`async` hoy (`manejarLogout` es sync, `manejarConsultarKpi` es `async`) porque `buildOnComandoEmpleado` devuelve un `SubmitPromptHandler` cuyo tipo ya tolera `TuiTurnResult | Promise<TuiTurnResult>` — `manejarReporteComisiones` sync encaja sin cambios de tipo.

---

## 4. Flujo de datos

```
"/reporte-comisiones 2026-08"
        │
        ▼
parsearComando (PURO, sin imports)
        │  { tipo: "reporte_comisiones", periodo: "2026-08" }
        ▼
preámbulo: purga sesión/confirmación → log recepción
        │
        ▼
guarda de privilegio (esComandoPrivilegiado === true) ── sin sesión ──▶ "necesita /login" (sin lectura, sin fila)
        │ sesión vigente
        ▼
manejarReporteComisiones
        │
        ├─▶ resolverPeriodoReporte(periodo, ahora) ── inválido ──▶ mensaje de uso (SIN fila)
        │       │ válido
        │       ▼
        ├─▶ reporteStore.listComisionesPorPeriodo(periodo) ──▶ repository.ts SELECT
        ├─▶ reporteStore.listVentasEnReembolsoPendiente() ──▶ repository.ts SELECT
        │       │
        │       ▼
        ├─▶ agruparReporteMensual (PURA) ──▶ formatearReporteMensual (PURA)
        │       │
        │       ▼
        ├─▶ registrar({ COMANDO_REPORTE_COMISIONES, RESULTADO_ATENDIDA }, ahora)
        │       │  (registro_acciones_empleado: comando, empleado_id, resultado — venta_id/caso_id NULL)
        ▼
{ responseText: <texto idéntico al script>, agentLabel: "sistema" }
```

---

## 5. Cambios de archivo

| Archivo | Acción | Qué cambia |
|---|---|---|
| `src/core/commands/comando-empleado.ts` | Modificado | Descriptor 16, `Forma` nueva, brazo de unión, rama de `parsearComando` |
| `src/core/commands/registro-acciones-contract.ts` | Modificado | `COMANDO_REPORTE_COMISIONES` |
| `src/core/ventas/reporte.ts` | Modificado (aditivo) | +`resolverPeriodoReporte`, +`PERIODO_REGEX` local — cero cambios a `agruparReporteMensual`/`formatearReporteMensual` |
| `src/core/ventas/reporte-contract.ts` | **Nuevo** | `ReporteStorePort` |
| `src/build-on-comando-empleado.ts` | Modificado | `reporteStore` en deps + wiring, `manejarReporteComisiones`, rama del switch |
| `src/core/commands/comando-empleado.test.ts` | Modificado | Tests de descriptor, forma, parseo con/sin período |
| `src/core/ventas/reporte.test.ts` | Modificado | Tests de `resolverPeriodoReporte` + equivalencia con `parsePeriodo` |
| `src/build-on-comando-empleado.test.ts` | Modificado | Tests del handler (ver §6) |
| `README.md` | Modificado | Documenta las dos vías + nota de ancho mínimo (ADR 124) |
| `docs/ARC42_Harness_Empresarial.md` | Modificado | Caja Blanca del Registro de Comandos: 15→16 comandos |
| `openspec/changes/comando-reporte-comisiones/specs/reporte-comisiones-mensual/spec.md` | Nuevo (delta) | Reescribe "único disparador", conserva "nada dispara solo" |
| `src/reporte-mensual.ts` | **Sin cambios** | ADR 118 |
| `src/adapters/memory/repository.ts` | **Sin cambios** | Se reusa tal cual |

---

## 6. Estrategia de testing por categoría

| Capa | Qué se testea | Cómo |
|---|---|---|
| Unit — parser | Descriptor `esComandoPrivilegiado("reporte_comisiones") === true`; `parsearComando` con/sin `periodo`, con espacios extra | `comando-empleado.test.ts`, mismo molde que las pruebas de `id_opcional_propuesta` |
| Unit — core puro | `resolverPeriodoReporte`: default a `ahora.slice(0,7)`, acepta `YYYY-MM` válido, rechaza formato inválido | `reporte.test.ts`, reloj fijo inyectado, sin `new Date()` |
| Unit — equivalencia (R6) | Tabla de strings (`"2026-08"`, `"2026-13"`, `"26-08"`, `""`, `undefined`) alimentada a `parsePeriodo` (importado de `reporte-mensual.ts`) y a `resolverPeriodoReporte`; mismo veredicto ok/mensaje en ambas | `reporte.test.ts`, un `describe.each` sobre la tabla |
| Integration — handler | `/reporte-comisiones` sin sesión ⇒ pide login, cero lecturas (spy en `reporteStore`), cero fila; con sesión y período inválido ⇒ mensaje de uso, cero fila; con sesión y período válido ⇒ fila `COMANDO_REPORTE_COMISIONES`/`RESULTADO_ATENDIDA` sin `venta_id`/`caso_id`; `ventas`/`comisiones`/`casos` idénticas antes/después | `build-on-comando-empleado.test.ts`, DB SQLite real en memoria (mismo patrón que el resto del archivo) |
| Integration — igualdad byte a byte | Misma DB fixture alimenta `manejarReporteComisiones` (vía `onSubmit`) y la llamada directa a `agruparReporteMensual`+`formatearReporteMensual` (el mismo camino que ejercita `reporte-mensual.test.ts`); se comparan los dos strings completos | `build-on-comando-empleado.test.ts`, un solo `expect(...).toBe(...)` sobre las dos salidas — no dos aserciones separadas (Success Criteria) |
| Regresión — script | `reporte-mensual.test.ts` sigue en verde **sin modificarse** | `npm test` completo |
| Type-check | `parsearComando` compila sin imports; `switch (comando.tipo)` exhaustivo tras el brazo nuevo | `npm run typecheck` |

TDD estricto (rojo→verde→refactor) en `resolverPeriodoReporte`, en la rama del parser y en `manejarReporteComisiones` — toda lógica de negocio, por `openspec/config.yaml` (`strict_tdd: true`).

---

## 7. Registro de auditoría — confirmado

**Sí, este comando escribe fila.** Alineado con `/consultar-kpi` (ADR 117 pto 4), no con `/ver-propuesta` (que hoy no registra, drift preexistente reportado al checkpoint, no corregido por este change). Constante nueva necesaria: **`COMANDO_REPORTE_COMISIONES = "/reporte-comisiones"`** en `registro-acciones-contract.ts`. Ningún `RESULTADO_*` nuevo (ADR 122): se reusa `RESULTADO_ATENDIDA`, ya importado en `build-on-comando-empleado.ts`. La fila lleva `comando`, `empleado_id` (de la sesión vigente), `resultado: "atendida"`, `ocurrido_at` — `venta_id`/`caso_id`/`propuesta_id` quedan `NULL` (columnas ya nullable, cero migración). No se registra en el camino de período inválido ni en el de sesión ausente (ADR 123 pto 4).

---

## 8. Migración / rollout

No aplica. Cero migraciones (verificado contra `0004`/`0005`/`0006`), cero dependencias nuevas, cero flags de feature. Aditivo y reversible borrando código (rollback plan de la propuesta, sin cambios).

---

## 9. Review Workload Forecast

Estimación por archivo (líneas agregadas, la mayoría aditivas — casi cero líneas borradas salvo el delta de spec):

| Archivo | Líneas est. |
|---|---|
| `comando-empleado.ts` | ~28 |
| `registro-acciones-contract.ts` | ~2 |
| `reporte.ts` | ~25 |
| `reporte-contract.ts` (nuevo) | ~18 |
| `build-on-comando-empleado.ts` | ~45 |
| `README.md` | ~22 |
| `docs/ARC42_Harness_Empresarial.md` | ~18 |
| `specs/reporte-comisiones-mensual/spec.md` (delta) | ~20 |
| **Subtotal implementación + docs + spec** | **~178** |
| `comando-empleado.test.ts` | ~30 |
| `reporte.test.ts` | ~45 |
| `build-on-comando-empleado.test.ts` (el más pesado: 6 escenarios, incluida la comparación byte a byte con fixture de DB) | ~130 |
| **Subtotal tests** | **~205** |
| **Total estimado** | **~383 líneas** |

**Decisión needed before apply**: No
**Chained PRs recommended**: No
**400-line budget risk**: Medium — el estimado (~383) queda por debajo de las 400 pero con margen angosto (~4%), y `build-on-comando-empleado.test.ts` es la partida con más incertidumbre (el escenario de igualdad byte a byte necesita fixture de DB compartida con `reporte-mensual.test.ts`, que puede crecer si hace falta más de un vendedor para ejercitar el orden `DESC`/desempate).

**Recomendación operativa para `sdd-apply`**: un solo PR es viable, pero si el diff real de `build-on-comando-empleado.test.ts` crece más allá de lo estimado (p. ej. por fixtures más grandes), separar `README.md` + `docs/ARC42_Harness_Empresarial.md` + el delta de spec (~60 líneas, cero riesgo de romper nada, revisión trivial) en un PR de documentación aparte es la salida de menor fricción — son independientes del código y no bloquean el mergeo del código funcional. No hacen falta PRs encadenados con dependencia secuencial: la separación posible es por TIPO de contenido (código+tests vs. docs+spec), no por dependencia técnica.

---

## 10. Preguntas abiertas

- [ ] **Pregunta 3 del checkpoint** (¿corregir "los ocho comandos" en `comando-empleado-tui/spec.md`?) sigue sin resolver — es decisión de `sdd-spec`/checkpoint, no de este diseño. Si se decide que SÍ, agrega un archivo más a §5 sin afectar el forecast de forma material (~5 líneas).
- [ ] El tamaño final de la fixture de DB para el test de igualdad byte a byte (§6) puede mover el forecast de §9 unos puntos porcentuales — a confirmar en `sdd-tasks`/`sdd-apply` con el diff real.
