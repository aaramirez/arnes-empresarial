/**
 * Parser puro de comandos de empleado en la TUI (`tui-canal-empleado`, ADR
 * 21, 34). Sin imports, sin I/O, sin reloj — mismo criterio que
 * `src/core/ventas/ventas-contract.ts`: `src/core/` nunca importa de
 * `src/adapters/*`, ni del SDK, ni de Node (regla no negociable de
 * `AGENTS.md`).
 *
 * `/ayuda` NO es un comando más: es también el sumidero de TODO lo
 * malformado. Por eso `parsearComando` NO tiene una rama de error: cualquier
 * texto que empiece con `/` y no matchee un comando conocido, o que matchee
 * uno pero sin sus argumentos obligatorios, devuelve `{ tipo: "ayuda", ... }`
 * (ADR 34).
 */

/** Correlación de log para eventos del canal de comandos que no tienen `casoId` propio. */
export const COMANDO_LOG_CORRELATION_ID = "tui-comando";

export type MotivoAyuda = "solicitada" | "desconocido" | "argumentos";

/**
 * Unión discriminada de los DIECISÉIS comandos finales (ADR 21, 34, 56, 69, 85 +
 * uno de `comando-reporte-comisiones`, ADR 117/119 + uno de
 * `comando-cancelar-solicitud`, ADR 127 + uno de
 * `comando-visibilidad-a2a-entrante`, ADR 138). `ayuda` no es un comando más: es
 * también el sumidero de todo lo malformado, y por eso el parser NO tiene
 * una rama de error.
 *
 * ★ `login.password` es el ÚNICO campo SECRETO de todo el núcleo. ★ No se
 *   loguea, no se persiste, no se devuelve en ningún `TuiTurnResult`, y no
 *   sobrevive a la llamada a `verificarPassword` (ADR 21 enmienda rev. 3).
 *
 * `solicitar` es de Hito 5 (§5.7, ADR 56). `tipoSolicitud` es `string` (no un
 * tipo de vocabulario cerrado): este parser es puro y sin imports (comentario
 * de cabecera), y no puede importar `solicitudes-contract.ts` — la
 * validación de `tipoSolicitud` vive en el caso de uso
 * (`crear-solicitud-interna.ts`).
 *
 * Los CINCO comandos HITL bloqueados por el ADR 151 se dieron de baja por
 * `aprobacion-conversacional-hitl` (ADR 210 pto 1), en dos tareas: `aprobar_
 * solicitud`/`rechazar_solicitud` (Hito 5, §5.7, ADR 56) en la tarea 10, y
 * `aprobar_reembolso`/`rechazar_reembolso`/`reabrir_reembolso`
 * (`tui-canal-empleado`) en la tarea 14 — todos se resuelven ahora por
 * conversación vía la herramienta `operaciones` (`resolver_solicitud`/
 * `resolver_reembolso`, ADR 206). A diferencia de `/devolucion`/`/solicitar`/
 * `/cancelar-solicitud` (`operaciones-negocio-conversacionales`, tarea 14,
 * change anterior), acá se retira el BRAZO DE TIPO completo de los cinco, no
 * solo el descriptor: cero código muerto (R17).
 *
 * `ver_propuesta`/`aplicar_propuesta`/`descartar_propuesta` son de Hito 5.1
 * (§5.9, ADR 69) — mismo precedente que el ADR 56 de arriba: `propuestaId`
 * es `string` plano, sin validar existencia acá (eso vive en el caso de
 * uso). `aplicar_propuesta` NO lleva `motivo?`: a diferencia de
 * `descartar_propuesta`, su `propuestaId` es OBLIGATORIO y el tipo no
 * necesita un campo que nadie lee.
 */
export type ComandoEmpleado =
  | { readonly tipo: "login"; readonly empleadoId: string; readonly password: string }
  | { readonly tipo: "logout" }
  | { readonly tipo: "soporte"; readonly consulta: string }
  | { readonly tipo: "devolucion"; readonly token: string; readonly motivo?: string }
  | { readonly tipo: "solicitar"; readonly tipoSolicitud: string; readonly detalle: string }
  /** Brazo de `comando-cancelar-solicitud` (ADR 127) — `solicitudId` OPCIONAL.
   *  `aprobar_solicitud`/`rechazar_solicitud` compartían esta misma forma
   *  (`id_opcional_solicitud`) hasta su baja (`aprobacion-conversacional-hitl`,
   *  ADR 210 pto 1, tarea 10) — este brazo es el ÚNICO sobreviviente de esa
   *  forma, aunque tampoco tiene descriptor propio (código muerto desde
   *  `operaciones-negocio-conversacionales`, tarea 14). */
  | { readonly tipo: "cancelar_solicitud"; readonly solicitudId?: string }
  | { readonly tipo: "ver_propuesta"; readonly propuestaId?: string }
  | { readonly tipo: "aplicar_propuesta"; readonly propuestaId: string }
  | { readonly tipo: "descartar_propuesta"; readonly propuestaId: string; readonly motivo?: string }
  /** Brazo NUEVO de Hito 6 (ADR 85). Molde exacto de `soporte`: un solo
   *  campo, el resto entero de la línea, obligatorio. */
  | { readonly tipo: "consultar_kpi"; readonly consulta: string }
  /** Brazo NUEVO de `comando-reporte-comisiones` (ADR 117, 119). Mismo
   *  patrón que `ver_propuesta`: `periodo` es OPCIONAL y su formato NO se
   *  valida acá (ADR 123 pto 1) — eso vive en `resolverPeriodoReporte`, en
   *  otra capa. La ausencia se resuelve al mes corriente en el handler, no
   *  en este parser puro y sin reloj. */
  | { readonly tipo: "reporte_comisiones"; readonly periodo?: string }
  /** Brazo NUEVO de `comando-visibilidad-a2a-entrante` (ADR 56/138). Mismo
   *  patrón que `ver_propuesta`/`reporte_comisiones`: `a2aTaskId` es
   *  OPCIONAL — su ausencia lista las solicitudes A2A entrantes en curso,
   *  su presencia muestra el detalle de una. */
  | { readonly tipo: "ver_solicitudes_a2a"; readonly a2aTaskId?: string }
  /** Brazo NUEVO de `comandos-administracion-empleados` (ADR 185) — enmienda
   *  del checkpoint al diferido del ADR 178 de esa misma propuesta. Sin
   *  argumentos, de solo lectura: nunca escribe, nunca revela un secreto. */
  | { readonly tipo: "estado_bot_prs" }
  /** Brazo NUEVO de `comandos-administracion-empleados` (ADR 184, tarea 7).
   *  `rol` llega como `string` plano — su formato NO se valida acá (ADR 177
   *  pto 2, mismo criterio que `periodo`): se valida contra
   *  `ROLES_EMPLEADO` en el dispatcher. */
  | { readonly tipo: "asignar_rol"; readonly empleadoId: string; readonly rol: string }
  /** Brazo NUEVO de `comandos-administracion-empleados` (ADR 184, tarea 8).
   *  Molde exacto de `login`: `password` es el ÚNICO otro campo SECRETO de
   *  todo el núcleo (comentario de cabecera de este tipo) — a diferencia de
   *  `login.password`, éste es el secreto de OTRA persona (R1 de
   *  `proposal.md`). */
  | { readonly tipo: "crear_empleado"; readonly empleadoId: string; readonly password: string }
  /** `comando` lleva SOLO el primer token (`"/logni"`), NUNCA el resto de la línea. */
  | { readonly tipo: "ayuda"; readonly motivo: MotivoAyuda; readonly comando?: string };

export interface DescriptorComando {
  /** `"/asignar-rol"`. */
  readonly nombre: string;
  /** `"/asignar-rol <empleadoId> <rol>"` — una línea de uso. */
  readonly uso: string;
  /** Una línea de ayuda, en el idioma del resto de los mensajes. */
  readonly ayuda: string;
  /** `true` ⇒ exige sesión vigente (ADR 28, 32). Lo consume el dispatcher, no el parser. */
  readonly privilegiado: boolean;
  /** `true` SOLO para `/login`: su segundo argumento es un secreto, no un identificador opaco. */
  readonly secreto: boolean;
  /**
   * `true` ⇒ exige rol `administrador` (comandos-administracion-empleados,
   * ADR 183 parte 1/RD-84), un eje de gateo DISTINTO de `privilegiado`
   * (ese exige sólo sesión vigente — resignificarlo está prohibido, R4 de
   * `autorizacion-empleado`). Lo consume el dispatcher (paso 6.5, DESPUÉS
   * del gate de sesión), no el parser. Consumidor real: el paso 6.5 de
   * `buildOnComandoEmpleado` en `build-on-comando-empleado.ts` (ya en
   * producción) — hoy `true` solo para `/asignar-rol` y `/crear-empleado`,
   * el resto de los trece descriptores queda en `false`.
   */
  readonly requiereAdministrador: boolean;
}

/**
 * `"id_opcional_solicitud"` (ADR 56) fue una forma distinta de
 * `"id_opcional"` — clave de payload `solicitudId`, no `ventaId` — usada por
 * `/aprobar-solicitud`/`/rechazar-solicitud` hasta su baja
 * (`aprobacion-conversacional-hitl`, ADR 210 pto 1, tarea 10). Se RETIRÓ
 * entonces: ningún descriptor la usaba más (`cancelar_solicitud` conserva el
 * brazo de `ComandoEmpleado` pero nunca tuvo descriptor propio desde
 * `operaciones-negocio-conversacionales`, tarea 14 — código muerto
 * preexistente, fuera de alcance de este change).
 *
 * `"id_opcional"` (ADR 21/34) — clave de payload `ventaId` — era la forma de
 * `/aprobar-reembolso`/`/rechazar-reembolso`/`/reabrir-reembolso`, sus TRES
 * únicos usuarios, hasta su baja (`aprobacion-conversacional-hitl`, ADR 210
 * pto 1, tarea 14: se resuelven por conversación vía `resolver_reembolso`,
 * ADR 206). Se RETIRA acá, mismo criterio que `id_opcional_solicitud`
 * arriba: ningún descriptor la usa más. Cero valores no usados en `Forma`
 * (R17).
 *
 * `"id_opcional_propuesta"` (ADR 69) es el mismo precedente otra vez: clave
 * de payload `propuestaId`, para `/ver-propuesta`.
 *
 * `"id_opcional_periodo"` (ADR 119, `comando-reporte-comisiones`) es el
 * mismo precedente otra vez: clave de payload `periodo`, para
 * `/reporte-comisiones`. El formato de `periodo` NO se valida acá (ADR 123
 * pto 1) — eso vive en `resolverPeriodoReporte`, en otra capa.
 *
 * `"id_opcional_a2a_task"` (ADR 56/138, `comando-visibilidad-a2a-entrante`)
 * es el mismo precedente otra vez: clave de payload `a2aTaskId`, para
 * `/ver-solicitudes-a2a`.
 *
 * `"id_mas_resto_rol"` (ADR 184, `comandos-administracion-empleados`, tarea
 * 7) es una `Forma` NUEVA, distinta de `"id_mas_resto"`: mismo patrón de
 * parseo (primer token + resto), clave de payload `rol`, para
 * `/asignar-rol`. El formato de `rol` NO se valida acá (ADR 177 pto 2) —
 * eso vive en el dispatcher, contra `ROLES_EMPLEADO`.
 *
 * `"id_mas_resto_password"` (ADR 184, `comandos-administracion-empleados`,
 * tarea 8) es otra `Forma` NUEVA, mismo patrón otra vez, clave de payload
 * `password`, para `/crear-empleado`. `password` es el resto de línea
 * ENTERO, sin trim salvo el de bordes que ya hace `splitPrimerEspacio`
 * (mismo límite conocido que `/login`, R4).
 */
type Forma =
  | "sin_argumentos"
  | "id_mas_resto"
  | "id_opcional_propuesta"
  | "id_opcional_periodo"
  | "id_opcional_a2a_task"
  | "id_mas_resto_rol"
  | "id_mas_resto_password";

interface DescriptorInterno extends DescriptorComando {
  readonly forma: Forma;
  /** Tipo de `ComandoEmpleado` al que corresponde este descriptor — única fuente de verdad para el guard de privilegio (ADR 28, 32). */
  readonly tipo: ComandoEmpleado["tipo"];
}

/**
 * Los TRECE descriptores finales (dieciocho tras
 * `comando-visibilidad-a2a-entrante`, menos `/devolucion`, `/solicitar` y
 * `/cancelar-solicitud` — bajados por `operaciones-negocio-conversacionales`,
 * ADR 148 pto 2, tarea 14: los tres eran comandos transaccionales de
 * autoservicio, ahora se resuelven por conversación vía la herramienta
 * `operaciones`, ver spec `herramienta-operaciones-negocio`. De los cinco
 * `/aprobar-*`/`/rechazar-*`/`/reabrir-*` que el ADR 151 declaró candidatos a
 * conversación, los CINCO bajaron — `/aprobar-solicitud` y
 * `/rechazar-solicitud` (`aprobacion-conversacional-hitl`, ADR 210 pto 1,
 * tarea 10: se resuelven vía `resolver_solicitud`, ADR 206), y
 * `/aprobar-reembolso`, `/rechazar-reembolso`, `/reabrir-reembolso`
 * (aprobacion-conversacional-hitl, ADR 210 pto 1, tarea 14: se resuelven vía
 * `resolver_reembolso`, ADR 206) — ADR 151 EJECUTADO), en el orden en que
 * `/ayuda` los imprime. Cada tanda nueva va ANTES de `/ayuda`, que sigue
 * último — los descriptores existentes no cambian de orden ni de forma.
 */
const DESCRIPTORES = [
  {
    nombre: "/login",
    uso: "/login <empleadoId> <password>",
    ayuda: "Abre sesión como el empleado indicado.",
    privilegiado: false,
    secreto: true,
    requiereAdministrador: false,
    forma: "id_mas_resto",
    tipo: "login",
  },
  {
    nombre: "/logout",
    uso: "/logout",
    ayuda: "Cierra la sesión abierta, si hay una.",
    privilegiado: false,
    secreto: false,
    requiereAdministrador: false,
    forma: "sin_argumentos",
    tipo: "logout",
  },
  {
    nombre: "/soporte",
    uso: "/soporte <consulta>",
    ayuda: "Envía una consulta al agente de soporte.",
    privilegiado: false,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_mas_resto",
    tipo: "soporte",
  },
  {
    nombre: "/ver-propuesta",
    uso: "/ver-propuesta [propuestaId]",
    ayuda: "Muestra una propuesta de cambio pendiente (lista las pendientes si se omite el id).",
    // `privilegiado: true` aunque no escriba nada: muestra el contenido
    // íntegro de un patch — código propietario del repo — y el spec de
    // `propuesta-cambio-hitl` solo garantiza el canal TUI autenticado (ADR
    // 69). Marcarlo `true` acá ES la implementación: `esComandoPrivilegiado`
    // es la única fuente de verdad que consulta el guard del dispatcher.
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional_propuesta",
    tipo: "ver_propuesta",
  },
  {
    nombre: "/aplicar-propuesta",
    uso: "/aplicar-propuesta <propuestaId>",
    ayuda: "Aplica el patch de una propuesta de cambio aprobada.",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_mas_resto",
    tipo: "aplicar_propuesta",
  },
  {
    nombre: "/descartar-propuesta",
    uso: "/descartar-propuesta <propuestaId> [motivo]",
    ayuda: "Descarta una propuesta de cambio pendiente sin aplicarla.",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_mas_resto",
    tipo: "descartar_propuesta",
  },
  {
    nombre: "/consultar-kpi",
    uso: "/consultar-kpi <consulta>",
    ayuda: "Consulta al agente externo de KPIs/incidentes y espera su respuesta.",
    // `privilegiado: true` — no es una decisión nueva: mismo criterio ya
    // escrito para `/ver-propuesta` arriba. Manda contexto de la empresa a
    // un tercero externo (ADR 85).
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_mas_resto",
    tipo: "consultar_kpi",
  },
  {
    nombre: "/reporte-comisiones",
    uso: "/reporte-comisiones [periodo]",
    ayuda: "Muestra el reporte mensual de comisiones (mes corriente si se omite el periodo).",
    // `privilegiado: true` (ADR 117) — mismo criterio que `/consultar-kpi` y
    // `/ver-propuesta` arriba: es de solo lectura, pero expone información
    // de negocio (comisiones, ventas en reembolso pendiente) que solo debe
    // ver un empleado con sesión vigente.
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional_periodo",
    tipo: "reporte_comisiones",
  },
  {
    nombre: "/ver-solicitudes-a2a",
    uso: "/ver-solicitudes-a2a [a2aTaskId]",
    ayuda: "Muestra las solicitudes A2A entrantes en curso (o el detalle de una, si se pasa el id de tarea).",
    // `privilegiado: true` (ADR 138) — mismo criterio ya escrito para
    // `/ver-propuesta`, `/consultar-kpi` y `/reporte-comisiones` arriba: el
    // `resultado` de una tarea COMPLETED es la respuesta real que el arnés
    // le dio a un tercero, construida sobre datos de la empresa.
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional_a2a_task",
    tipo: "ver_solicitudes_a2a",
  },
  {
    nombre: "/estado-bot-prs",
    uso: "/estado-bot-prs",
    ayuda: "Muestra si el bot de revisión de PRs está escuchando y si GITHUB_TOKEN está configurado (sin revelar valores).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "sin_argumentos",
    tipo: "estado_bot_prs",
  },
  {
    nombre: "/asignar-rol",
    uso: "/asignar-rol <empleadoId> <rol>",
    ayuda: "Asigna el rol indicado (empleado | administrador) a un empleado existente.",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: true,
    forma: "id_mas_resto_rol",
    tipo: "asignar_rol",
  },
  {
    nombre: "/crear-empleado",
    uso: "/crear-empleado <empleadoId> <password>",
    ayuda: "Da de alta una credencial de empleado nueva.",
    privilegiado: true,
    secreto: true,
    requiereAdministrador: true,
    forma: "id_mas_resto_password",
    tipo: "crear_empleado",
  },
  {
    nombre: "/ayuda",
    uso: "/ayuda",
    ayuda: "Lista los comandos disponibles.",
    privilegiado: false,
    secreto: false,
    requiereAdministrador: false,
    forma: "sin_argumentos",
    tipo: "ayuda",
  },
] as const satisfies readonly DescriptorInterno[];

/**
 * Los TRECE descriptores finales (dieciocho tras
 * `comando-visibilidad-a2a-entrante`, menos `/devolucion`, `/solicitar` y
 * `/cancelar-solicitud` — bajados por `operaciones-negocio-conversacionales`,
 * ADR 148 pto 2, tarea 14 — y menos los cinco comandos HITL de
 * `/aprobar-*`/`/rechazar-*`/`/reabrir-*` — bajados por
 * `aprobacion-conversacional-hitl`, ADR 210 pto 1, tareas 10 y 14), en el
 * orden en que `/ayuda` los imprime.
 */
export const COMANDOS: readonly DescriptorComando[] = DESCRIPTORES;

/**
 * Índice por `tipo`, construido UNA sola vez a nivel de módulo (code-review
 * de `comandos-administracion-empleados`, hallazgo 7): `esComandoPrivilegiado`,
 * `requiereAdministrador` y `nombreComando` hacían cada una su propio
 * `DESCRIPTORES.find()` — hasta tres recorridos lineales por comando
 * despachado con gate de administrador. No cambia ninguna firma pública: las
 * tres siguen recibiendo `tipo` y devolviendo lo mismo, solo que ahora
 * resuelven el descriptor con `Map.get` (O(1)) en vez de `Array.find`
 * (O(n)). `DESCRIPTORES` es literal y fijo en build time, así que el `Map`
 * no necesita invalidarse nunca.
 */
const DESCRIPTOR_POR_TIPO: ReadonlyMap<ComandoEmpleado["tipo"], DescriptorInterno> = new Map(
  DESCRIPTORES.map((d) => [d.tipo, d] as const),
);

/**
 * ÚNICA fuente de verdad de qué comandos exigen sesión vigente (ADR 28, 32):
 * lee el campo `privilegiado` del descriptor correspondiente en
 * `DESCRIPTORES`, en vez de mantener una lista paralela. El dispatcher
 * (`build-on-comando-empleado.ts`) consulta esta función en el guard de
 * sesión — así un comando nuevo marcado `privilegiado: true` queda
 * protegido automáticamente, sin tocar el guard.
 */
export function esComandoPrivilegiado(tipo: ComandoEmpleado["tipo"]): boolean {
  return DESCRIPTOR_POR_TIPO.get(tipo)?.privilegiado ?? false;
}

/**
 * ÚNICA fuente de verdad de qué comandos exigen rol `administrador`
 * (comandos-administracion-empleados, ADR 183 parte 1/RD-84) — molde EXACTO
 * de `esComandoPrivilegiado`: lee el campo `requiereAdministrador` del
 * descriptor correspondiente, en vez de mantener una lista paralela.
 * Consumidor real: el paso 6.5 de `buildOnComandoEmpleado`
 * (`build-on-comando-empleado.ts`), el gate de administrador, ya en
 * producción — corre DESPUÉS del guard de sesión del paso 6.
 */
export function requiereAdministrador(tipo: ComandoEmpleado["tipo"]): boolean {
  return DESCRIPTOR_POR_TIPO.get(tipo)?.requiereAdministrador ?? false;
}

/**
 * ÚNICA fuente de verdad para traducir `tipo` (valor interno, p. ej.
 * `"asignar_rol"`) al `nombre` público del comando (`"/asignar-rol"`) — molde
 * EXACTO de `esComandoPrivilegiado`/`requiereAdministrador`: lee el campo
 * `nombre` del descriptor correspondiente en `DESCRIPTORES`, en vez de
 * mantener una tabla paralela `tipo -> COMANDO_*` (code-review de
 * `comandos-administracion-empleados`, hallazgo 1: el gate de administrador
 * en `build-on-comando-empleado.ts` escribía `comando.tipo` crudo en la fila
 * de auditoría de un rechazo, en vez del vocabulario `/comando` que usan las
 * demás filas de `registrar()`). Fallback a `tipo` si no hay descriptor —
 * no debería ocurrir para ningún `ComandoEmpleado["tipo"]` real, pero evita
 * perder la fila entera por un `undefined`.
 */
export function nombreComando(tipo: ComandoEmpleado["tipo"]): string {
  return DESCRIPTOR_POR_TIPO.get(tipo)?.nombre ?? tipo;
}

/** Texto de `/ayuda`: encabezado + una línea `uso — ayuda` por descriptor. PURA. */
export function formatearAyuda(comandos: readonly DescriptorComando[] = COMANDOS): string {
  const lineas = comandos.map((d) => `${d.uso} — ${d.ayuda}`);
  return ["Comandos disponibles:", ...lineas].join("\n");
}

function ayudaDesconocido(comando: string): ComandoEmpleado {
  return { tipo: "ayuda", motivo: "desconocido", comando };
}

function ayudaArgumentos(comando: string): ComandoEmpleado {
  return { tipo: "ayuda", motivo: "argumentos", comando };
}

/** `split` en el PRIMER espacio; el resto entero con `trim` de bordes (ADR 34, forma "id + resto"). */
function splitPrimerEspacio(texto: string): { readonly primero: string; readonly resto?: string } {
  const idx = texto.indexOf(" ");
  if (idx === -1) {
    return { primero: texto };
  }
  const primero = texto.slice(0, idx);
  const resto = texto.slice(idx + 1).trim();
  return resto === "" ? { primero } : { primero, resto };
}

/**
 * Payload común a las 3 formas "id opcional de <algo>" (`id_opcional_
 * propuesta`, `id_opcional_periodo`, `id_opcional_a2a_task`; ADR 69, 119,
 * 138 — `id_opcional_solicitud` se retiró en `aprobacion-conversacional-hitl`,
 * ADR 210 pto 1, tarea 10; `id_opcional` se retiró en la tarea 14 de esa
 * misma serie, sus tres únicos usuarios de reembolso dados de baja): primer
 * token del resto de la línea bajo la clave de payload `key`, o solo
 * `{ tipo }` si no hay resto. `tipo` se recibe ya resuelto por quien llama —
 * `descriptor.tipo`
 * es la ÚNICA fuente de verdad (viene de DESCRIPTORES, igual que
 * `esComandoPrivilegiado`) — gracias a que `DESCRIPTORES` está tipado como
 * `as const satisfies readonly DescriptorInterno[]`, TypeScript narrowea
 * `descriptor.tipo` a los literales reales de cada forma en el sitio de la
 * llamada, sin necesitar ningún cast ahí. El formato de `key` (p. ej.
 * `periodo`, ADR 123 pto 1) NO se valida acá: eso es responsabilidad de
 * otra capa.
 */
function idOpcionalPayload<T extends string, K extends string>(
  tipo: T,
  restoLinea: string | undefined,
  key: K,
): { readonly tipo: T } | ({ readonly tipo: T } & Record<K, string>) {
  const valor = restoLinea === undefined ? undefined : splitPrimerEspacio(restoLinea).primero;
  return valor === undefined ? { tipo } : ({ tipo, [key]: valor } as { readonly tipo: T } & Record<K, string>);
}

/**
 * Payload común a las dos formas "id + resto OBLIGATORIO, con clave propia"
 * (`id_mas_resto_rol`, `id_mas_resto_password`; comandos-administracion-empleados,
 * ADR 184, tareas 7/8; code-review, hallazgo 6 — antes duplicado inline en
 * cada rama): `empleadoId` es el primer token del resto de la línea, y el
 * segundo `split` de ese resto (otra vez en el primer espacio) va bajo la
 * clave de payload `key` — a diferencia de `idOpcionalPayload`, acá los DOS
 * campos son OBLIGATORIOS: `restoLinea` ausente, o su segundo token ausente,
 * devuelve `{ ayuda, "argumentos", comando }` (regla 4 del comentario de
 * `parsearComando`). `tipo` se recibe ya resuelto por quien llama —
 * `descriptor.tipo` es la ÚNICA fuente de verdad, mismo criterio que
 * `idOpcionalPayload`. El formato de `key` (p. ej. `rol`) NO se valida acá:
 * eso es responsabilidad de otra capa (ADR 177 pto 2).
 */
function idMasRestoObligatorioPayload<T extends string, K extends string>(
  tipo: T,
  comandoToken: string,
  restoLinea: string | undefined,
  key: K,
): ComandoEmpleado | ({ readonly tipo: T; readonly empleadoId: string } & Record<K, string>) {
  if (restoLinea === undefined) {
    return ayudaArgumentos(comandoToken);
  }
  const { primero: empleadoId, resto: valor } = splitPrimerEspacio(restoLinea);
  if (valor === undefined) {
    return ayudaArgumentos(comandoToken);
  }
  return { tipo, empleadoId, [key]: valor } as { readonly tipo: T; readonly empleadoId: string } & Record<K, string>;
}

/**
 * PURA, sin I/O, sin reloj. Reglas, en orden (ADR 34, 56, 69, 119, 138):
 *  1. `texto.trimStart()` no empieza con `/`  → `undefined` (turno conversacional).
 *  2. Primer token → busca descriptor por `nombre`. No matchea → `{ ayuda, "desconocido", comando }`.
 *  3. Parseo por forma:
 *     · sin argumentos: `/logout`, `/ayuda` (sobrantes ignorados).
 *     · id opcional de propuesta (`propuestaId`, ADR 69): primer token del resto, o campo ausente si el resto está vacío, para `/ver-propuesta`.
 *     · id opcional de periodo (`periodo`, ADR 119): mismo patrón otra vez, para `/reporte-comisiones` — el
 *       formato de `periodo` NO se valida acá (ADR 123 pto 1).
 *     · id opcional de tarea A2A (`a2aTaskId`, ADR 56/138): mismo patrón otra vez, para `/ver-solicitudes-a2a`.
 *     · id + resto: `split` en el PRIMER espacio; el resto entero con `trim` de bordes.
 *  4. Argumento obligatorio ausente o vacío → `{ ayuda, "argumentos", comando }`.
 *     Obligatorios: `/login` (los DOS), `/soporte` (consulta), `/aplicar-propuesta` (propuestaId),
 *     `/descartar-propuesta` (propuestaId). (`/devolucion`, `/solicitar`, `/cancelar-solicitud` ya no son
 *     comandos — bajados por `operaciones-negocio-conversacionales`, ADR 148 pto 2, tarea 14; los CINCO
 *     comandos HITL —`/aprobar-solicitud`/`/rechazar-solicitud`/`/aprobar-reembolso`/`/rechazar-reembolso`/
 *     `/reabrir-reembolso`— tampoco — bajados por `aprobacion-conversacional-hitl`, ADR 210 pto 1, tareas
 *     10 y 14.)
 *     `motivo` de `/descartar-propuesta`, `propuestaId` de `/ver-propuesta` y `a2aTaskId` de
 *     `/ver-solicitudes-a2a` son OPCIONALES.
 *  5. `/ayuda` explícito → `{ ayuda, "solicitada" }`.
 *
 * LÍMITE CONOCIDO Y TESTEADO (R4, resuelto por ADR 34): una contraseña con
 * espacios INTERNOS se tipea sin problema; una que empiece o termine con
 * espacio NO, porque el `trim` de bordes se la come.
 */
export function parsearComando(texto: string): ComandoEmpleado | undefined {
  if (!texto.trimStart().startsWith("/")) {
    return undefined;
  }

  const { primero: comandoToken, resto: restoLinea } = splitPrimerEspacio(texto.trimStart());
  const descriptor = DESCRIPTORES.find((d) => d.nombre === comandoToken);

  if (descriptor === undefined) {
    return ayudaDesconocido(comandoToken);
  }

  if (descriptor.nombre === "/ayuda") {
    return { tipo: "ayuda", motivo: "solicitada" };
  }

  if (descriptor.forma === "sin_argumentos") {
    // /logout y /estado-bot-prs llegan acá (aparte de /ayuda, ya resuelto
    // arriba). ★ Corrección (comandos-administracion-empleados, tarea 3):
    // antes devolvía hardcodeado `{ tipo: "logout" }` porque /logout era el
    // ÚNICO consumidor de esta forma — con un segundo comando (/estado-bot-prs)
    // eso ruteaba silenciosamente a logout. Ahora devuelve el tipo genérico
    // del descriptor, la misma fuente de verdad que ya usa `idOpcionalPayload`.
    return { tipo: descriptor.tipo };
  }

  if (descriptor.forma === "id_opcional_propuesta") {
    return idOpcionalPayload(descriptor.tipo, restoLinea, "propuestaId");
  }

  if (descriptor.forma === "id_opcional_periodo") {
    return idOpcionalPayload(descriptor.tipo, restoLinea, "periodo");
  }

  if (descriptor.forma === "id_opcional_a2a_task") {
    return idOpcionalPayload(descriptor.tipo, restoLinea, "a2aTaskId");
  }

  // /asignar-rol <empleadoId> <rol> — forma "id_mas_resto_rol"
  // (comandos-administracion-empleados, tarea 7, ADR 184): mismo patrón de
  // parseo que "id_mas_resto" (primer token + resto de línea), clave de
  // payload propia (`rol`) — extraído a `idMasRestoObligatorioPayload`
  // (code-review, hallazgo 6), mismo helper que "id_mas_resto_password". El
  // formato de `rol` NO se valida acá (ADR 177 pto 2, mismo criterio que
  // `periodo`) — se valida contra `ROLES_EMPLEADO` en el dispatcher.
  if (descriptor.forma === "id_mas_resto_rol") {
    return idMasRestoObligatorioPayload(descriptor.tipo, comandoToken, restoLinea, "rol");
  }

  // /crear-empleado <empleadoId> <password> — forma "id_mas_resto_password"
  // (comandos-administracion-empleados, tarea 8, ADR 184): mismo patrón de
  // parseo que "id_mas_resto_rol"/"id_mas_resto", clave de payload
  // `password`, mismo helper `idMasRestoObligatorioPayload` (code-review,
  // hallazgo 6). Molde EXACTO de la rama "/login" en cuanto a shape.
  if (descriptor.forma === "id_mas_resto_password") {
    return idMasRestoObligatorioPayload(descriptor.tipo, comandoToken, restoLinea, "password");
  }

  // forma === "id_mas_resto": /login, /soporte, /aplicar-propuesta,
  // /descartar-propuesta, /consultar-kpi. (/devolucion y /solicitar
  // también eran de esta forma — bajados por
  // `operaciones-negocio-conversacionales`, ADR 148 pto 2, tarea 14.)
  if (descriptor.nombre === "/soporte") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    return { tipo: "soporte", consulta: restoLinea };
  }

  if (descriptor.nombre === "/login") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    const { primero: empleadoId, resto: password } = splitPrimerEspacio(restoLinea);
    if (password === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    return { tipo: "login", empleadoId, password };
  }

  // /aplicar-propuesta <propuestaId> — rama PROPIA (ADR 69), no comparte con
  // /descartar-propuesta: a diferencia de esa, `propuestaId` es OBLIGATORIO
  // y no hay `motivo` que parsear del resto.
  if (descriptor.nombre === "/aplicar-propuesta") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    const { primero: propuestaId } = splitPrimerEspacio(restoLinea);
    return { tipo: "aplicar_propuesta", propuestaId };
  }

  // /descartar-propuesta <propuestaId> [motivo] — rama PROPIA (ADR 69).
  if (descriptor.nombre === "/descartar-propuesta") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    const { primero: propuestaId, resto: motivo } = splitPrimerEspacio(restoLinea);
    return motivo === undefined
      ? { tipo: "descartar_propuesta", propuestaId }
      : { tipo: "descartar_propuesta", propuestaId, motivo };
  }

  // /consultar-kpi <consulta> — rama PROPIA (ADR 85), calcada de /soporte.
  // ★ Es el último descriptor de forma "id_mas_resto": todos los que existen
  // hoy (/login, /soporte, /aplicar-propuesta, /descartar-propuesta,
  // /consultar-kpi) tienen rama explícita arriba — no queda ningún
  // fallthrough implícito (el que existía para /devolucion se quitó junto
  // con su descriptor, `operaciones-negocio-conversacionales`, ADR 148 pto
  // 2, tarea 14). Un descriptor id_mas_resto nuevo sin su rama explícita cae
  // en la red de seguridad de abajo, como "desconocido" — no falla en
  // compilación, pero tampoco se parsea en silencio como otra cosa.
  if (descriptor.nombre === "/consultar-kpi") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    return { tipo: "consultar_kpi", consulta: restoLinea };
  }

  // Red de seguridad: nunca debería llegar acá con los descriptores de hoy
  // (los cinco de forma "id_mas_resto" tienen rama explícita arriba).
  return ayudaDesconocido(comandoToken);
}

const NOMBRES_SECRETOS: ReadonlySet<string> = new Set(
  DESCRIPTORES.filter((d) => d.secreto).map((d) => d.nombre),
);

function inicioTramoSecreto(texto: string): number | undefined {
  const inicio = texto.length - texto.trimStart().length;
  const linea = texto.slice(inicio);
  const finComando = linea.indexOf(" ");
  if (finComando === -1 || !NOMBRES_SECRETOS.has(linea.slice(0, finComando))) {
    return undefined;
  }
  const resto = linea.slice(finComando + 1);
  const inicioId = resto.length - resto.trimStart().length;
  const finId = resto.indexOf(" ", inicioId);
  if (finId === -1) {
    return undefined;
  }
  const inicioTramo = inicio + finComando + 1 + finId + 1;
  return inicioTramo < texto.length ? inicioTramo : undefined;
}

export function enmascararSecreto(texto: string): string {
  const inicio = inicioTramoSecreto(texto);
  return inicio === undefined ? texto : texto.slice(0, inicio) + "*".repeat(texto.length - inicio);
}

export function contieneSecreto(texto: string): boolean {
  return inicioTramoSecreto(texto) !== undefined;
}
