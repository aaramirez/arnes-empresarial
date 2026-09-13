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
 * Unión discriminada de los DIECIOCHO comandos (ADR 21, 34, 56, 69, 85 + uno
 * de `comando-reporte-comisiones`, ADR 117/119 + uno de
 * `comando-cancelar-solicitud`, ADR 127 + uno de
 * `comando-visibilidad-a2a-entrante`, ADR 138). `ayuda` no es un comando más: es
 * también el sumidero de todo lo malformado, y por eso el parser NO tiene
 * una rama de error.
 *
 * ★ `login.password` es el ÚNICO campo SECRETO de todo el núcleo. ★ No se
 *   loguea, no se persiste, no se devuelve en ningún `TuiTurnResult`, y no
 *   sobrevive a la llamada a `verificarPassword` (ADR 21 enmienda rev. 3).
 *
 * `solicitar`/`aprobar_solicitud`/`rechazar_solicitud` son de Hito 5 (§5.7,
 * ADR 56). `tipoSolicitud` es `string` (no un tipo de vocabulario cerrado):
 * este parser es puro y sin imports (comentario de cabecera), y no puede
 * importar `solicitudes-contract.ts` — la validación de `tipoSolicitud` vive
 * en el caso de uso (`crear-solicitud-interna.ts`).
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
  | { readonly tipo: "aprobar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "rechazar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "reabrir_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "solicitar"; readonly tipoSolicitud: string; readonly detalle: string }
  | { readonly tipo: "aprobar_solicitud"; readonly solicitudId?: string }
  | { readonly tipo: "rechazar_solicitud"; readonly solicitudId?: string }
  /** Brazo NUEVO de `comando-cancelar-solicitud` (ADR 127). Mismo shape que
   *  `aprobar_solicitud`/`rechazar_solicitud`: `solicitudId` OPCIONAL, forma
   *  `id_opcional_solicitud` reusada sin cambios. */
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
  /** `"/aprobar-reembolso"`. */
  readonly nombre: string;
  /** `"/aprobar-reembolso [ventaId]"` — una línea de uso. */
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
   * del gate de sesión), no el parser. Scaffolding puro por ahora: ningún
   * descriptor de hoy lo necesita (todos `false`) hasta que
   * `/crear-empleado`/`/asignar-rol` lleguen (PR2/PR3, bloqueadas).
   */
  readonly requiereAdministrador: boolean;
}

/**
 * `"id_opcional_solicitud"` (ADR 56) es una forma distinta de
 * `"id_opcional"`: comparte el mismo patrón de parseo (primer token del
 * resto, o campo ausente si el resto está vacío), pero su clave de payload
 * es `solicitudId`, no `ventaId`. Una forma nueva por SHAPE de payload — no
 * un campo de configuración que obligaría a un cast en el `return` (ver el
 * comentario de la rama `"id_opcional"` más abajo, y el ADR 56 en
 * `design.md`).
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
  | "id_opcional"
  | "id_mas_resto"
  | "id_opcional_solicitud"
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
 * Los quince descriptores (dieciocho tras `comando-visibilidad-a2a-entrante`,
 * menos `/devolucion`, `/solicitar` y `/cancelar-solicitud` — bajados por
 * `operaciones-negocio-conversacionales`, ADR 148 pto 2, tarea 14: los tres
 * eran comandos transaccionales de autoservicio, ahora se resuelven por
 * conversación vía la herramienta `operaciones`, ver spec
 * `herramienta-operaciones-negocio`. Los cinco `/aprobar-*`/`/rechazar-*`/
 * `/reabrir-*` NO bajan: el ADR 151 los declaró candidatos a conversación
 * pero su ejecución sigue BLOQUEADA por el checkpoint), en el orden en que
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
    nombre: "/aprobar-reembolso",
    uso: "/aprobar-reembolso [ventaId]",
    ayuda: "Aprueba un reembolso escalado (lista los pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional",
    tipo: "aprobar_reembolso",
  },
  {
    nombre: "/rechazar-reembolso",
    uso: "/rechazar-reembolso [ventaId]",
    ayuda: "Rechaza un reembolso escalado (lista los pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional",
    tipo: "rechazar_reembolso",
  },
  {
    nombre: "/reabrir-reembolso",
    uso: "/reabrir-reembolso [ventaId]",
    ayuda: "Reabre un reembolso previamente rechazado (lista los rechazados si se omite el id).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional",
    tipo: "reabrir_reembolso",
  },
  {
    nombre: "/aprobar-solicitud",
    uso: "/aprobar-solicitud [solicitudId]",
    ayuda: "Aprueba una solicitud interna pendiente (lista las pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional_solicitud",
    tipo: "aprobar_solicitud",
  },
  {
    nombre: "/rechazar-solicitud",
    uso: "/rechazar-solicitud [solicitudId]",
    ayuda: "Rechaza una solicitud interna pendiente (lista las pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    requiereAdministrador: false,
    forma: "id_opcional_solicitud",
    tipo: "rechazar_solicitud",
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
 * Los quince descriptores (dieciocho tras `comando-visibilidad-a2a-entrante`,
 * menos `/devolucion`, `/solicitar` y `/cancelar-solicitud` — bajados por
 * `operaciones-negocio-conversacionales`, ADR 148 pto 2, tarea 14), en el
 * orden en que `/ayuda` los imprime.
 */
export const COMANDOS: readonly DescriptorComando[] = DESCRIPTORES;

/**
 * ÚNICA fuente de verdad de qué comandos exigen sesión vigente (ADR 28, 32):
 * lee el campo `privilegiado` del descriptor correspondiente en
 * `DESCRIPTORES`, en vez de mantener una lista paralela. El dispatcher
 * (`build-on-comando-empleado.ts`) consulta esta función en el guard de
 * sesión — así un comando nuevo marcado `privilegiado: true` queda
 * protegido automáticamente, sin tocar el guard.
 */
export function esComandoPrivilegiado(tipo: ComandoEmpleado["tipo"]): boolean {
  return DESCRIPTORES.find((d) => d.tipo === tipo)?.privilegiado ?? false;
}

/**
 * ÚNICA fuente de verdad de qué comandos exigen rol `administrador`
 * (comandos-administracion-empleados, ADR 183 parte 1/RD-84) — molde EXACTO
 * de `esComandoPrivilegiado`: lee el campo `requiereAdministrador` del
 * descriptor correspondiente, en vez de mantener una lista paralela. SIN
 * consumidor todavía — el dispatcher no la consulta hasta que el gate de
 * administrador exista (PR2, tarea 5, bloqueada).
 */
export function requiereAdministrador(tipo: ComandoEmpleado["tipo"]): boolean {
  return DESCRIPTORES.find((d) => d.tipo === tipo)?.requiereAdministrador ?? false;
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
 * Payload común a las 5 formas "id opcional de <algo>" (`id_opcional`,
 * `id_opcional_solicitud`, `id_opcional_propuesta`, `id_opcional_periodo`,
 * `id_opcional_a2a_task`; ADR 56, 69, 119, 138): primer token del resto de
 * la línea bajo la clave de payload `key`, o solo `{ tipo }` si no hay
 * resto. `tipo` se recibe ya resuelto por quien llama — `descriptor.tipo`
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
 * PURA, sin I/O, sin reloj. Reglas, en orden (ADR 34, 56, 69, 119, 138):
 *  1. `texto.trimStart()` no empieza con `/`  → `undefined` (turno conversacional).
 *  2. Primer token → busca descriptor por `nombre`. No matchea → `{ ayuda, "desconocido", comando }`.
 *  3. Parseo por forma:
 *     · sin argumentos: `/logout`, `/ayuda` (sobrantes ignorados).
 *     · id opcional (`ventaId`): primer token del resto, o campo ausente si el resto está vacío.
 *     · id opcional de solicitud (`solicitudId`, ADR 56): mismo patrón que "id opcional", clave de payload distinta.
 *     · id opcional de propuesta (`propuestaId`, ADR 69): mismo patrón otra vez, para `/ver-propuesta`.
 *     · id opcional de periodo (`periodo`, ADR 119): mismo patrón otra vez, para `/reporte-comisiones` — el
 *       formato de `periodo` NO se valida acá (ADR 123 pto 1).
 *     · id opcional de tarea A2A (`a2aTaskId`, ADR 56/138): mismo patrón otra vez, para `/ver-solicitudes-a2a`.
 *     · id + resto: `split` en el PRIMER espacio; el resto entero con `trim` de bordes.
 *  4. Argumento obligatorio ausente o vacío → `{ ayuda, "argumentos", comando }`.
 *     Obligatorios: `/login` (los DOS), `/soporte` (consulta), `/aplicar-propuesta` (propuestaId),
 *     `/descartar-propuesta` (propuestaId). (`/devolucion` y `/solicitar` ya no son comandos — bajados por
 *     `operaciones-negocio-conversacionales`, ADR 148 pto 2, tarea 14.)
 *     `motivo` de `/descartar-propuesta`, `ventaId` de los tres de reembolso, `solicitudId` de
 *     los dos de solicitud, `propuestaId` de `/ver-propuesta` y `a2aTaskId` de `/ver-solicitudes-a2a` son
 *     OPCIONALES.
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

  if (descriptor.forma === "id_opcional") {
    return idOpcionalPayload(descriptor.tipo, restoLinea, "ventaId");
  }

  if (descriptor.forma === "id_opcional_solicitud") {
    return idOpcionalPayload(descriptor.tipo, restoLinea, "solicitudId");
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

  // /asignar-rol <empleadoId> <rol> — forma NUEVA "id_mas_resto_rol"
  // (comandos-administracion-empleados, tarea 7, ADR 184): mismo patrón de
  // parseo que "id_mas_resto" (primer token + resto de línea), clave de
  // payload propia (`rol`). El formato de `rol` NO se valida acá (ADR 177
  // pto 2, mismo criterio que `periodo`) — se valida contra
  // `ROLES_EMPLEADO` en el dispatcher.
  if (descriptor.forma === "id_mas_resto_rol") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    const { primero: empleadoId, resto: rol } = splitPrimerEspacio(restoLinea);
    if (rol === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    return { tipo: "asignar_rol", empleadoId, rol };
  }

  // /crear-empleado <empleadoId> <password> — forma NUEVA
  // "id_mas_resto_password" (comandos-administracion-empleados, tarea 8,
  // ADR 184): mismo patrón de parseo que "id_mas_resto_rol"/"id_mas_resto",
  // clave de payload `password`. Molde EXACTO de la rama "/login".
  if (descriptor.forma === "id_mas_resto_password") {
    if (restoLinea === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    const { primero: empleadoId, resto: password } = splitPrimerEspacio(restoLinea);
    if (password === undefined) {
      return ayudaArgumentos(comandoToken);
    }
    return { tipo: "crear_empleado", empleadoId, password };
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
