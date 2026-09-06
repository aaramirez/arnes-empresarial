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
 * Unión discriminada de los OCHO comandos (ADR 21, 34). `ayuda` no es un
 * comando más: es también el sumidero de todo lo malformado, y por eso el
 * parser NO tiene una rama de error.
 *
 * ★ `login.password` es el ÚNICO campo SECRETO de todo el núcleo. ★ No se
 *   loguea, no se persiste, no se devuelve en ningún `TuiTurnResult`, y no
 *   sobrevive a la llamada a `verificarPassword` (ADR 21 enmienda rev. 3).
 */
export type ComandoEmpleado =
  | { readonly tipo: "login"; readonly empleadoId: string; readonly password: string }
  | { readonly tipo: "logout" }
  | { readonly tipo: "soporte"; readonly consulta: string }
  | { readonly tipo: "devolucion"; readonly token: string; readonly motivo?: string }
  | { readonly tipo: "aprobar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "rechazar_reembolso"; readonly ventaId?: string }
  | { readonly tipo: "reabrir_reembolso"; readonly ventaId?: string }
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
}

type Forma = "sin_argumentos" | "id_opcional" | "id_mas_resto";

interface DescriptorInterno extends DescriptorComando {
  readonly forma: Forma;
}

/** Los ocho descriptores, en el orden en que `/ayuda` los imprime. */
const DESCRIPTORES: readonly DescriptorInterno[] = [
  {
    nombre: "/login",
    uso: "/login <empleadoId> <password>",
    ayuda: "Abre sesión como el empleado indicado.",
    privilegiado: false,
    secreto: true,
    forma: "id_mas_resto",
  },
  {
    nombre: "/logout",
    uso: "/logout",
    ayuda: "Cierra la sesión abierta, si hay una.",
    privilegiado: false,
    secreto: false,
    forma: "sin_argumentos",
  },
  {
    nombre: "/soporte",
    uso: "/soporte <consulta>",
    ayuda: "Envía una consulta al agente de soporte.",
    privilegiado: false,
    secreto: false,
    forma: "id_mas_resto",
  },
  {
    nombre: "/devolucion",
    uso: "/devolucion <token> [motivo]",
    ayuda: "Procesa una devolución con el token de confirmación de la venta.",
    privilegiado: false,
    secreto: false,
    forma: "id_mas_resto",
  },
  {
    nombre: "/aprobar-reembolso",
    uso: "/aprobar-reembolso [ventaId]",
    ayuda: "Aprueba un reembolso escalado (lista los pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    forma: "id_opcional",
  },
  {
    nombre: "/rechazar-reembolso",
    uso: "/rechazar-reembolso [ventaId]",
    ayuda: "Rechaza un reembolso escalado (lista los pendientes si se omite el id).",
    privilegiado: true,
    secreto: false,
    forma: "id_opcional",
  },
  {
    nombre: "/reabrir-reembolso",
    uso: "/reabrir-reembolso [ventaId]",
    ayuda: "Reabre un reembolso previamente rechazado (lista los rechazados si se omite el id).",
    privilegiado: true,
    secreto: false,
    forma: "id_opcional",
  },
  {
    nombre: "/ayuda",
    uso: "/ayuda",
    ayuda: "Lista los comandos disponibles.",
    privilegiado: false,
    secreto: false,
    forma: "sin_argumentos",
  },
];

/** Los ocho descriptores, en el orden en que `/ayuda` los imprime. */
export const COMANDOS: readonly DescriptorComando[] = DESCRIPTORES;

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
 * PURA, sin I/O, sin reloj. Reglas, en orden (ADR 34):
 *  1. `texto.trimStart()` no empieza con `/`  → `undefined` (turno conversacional).
 *  2. Primer token → busca descriptor por `nombre`. No matchea → `{ ayuda, "desconocido", comando }`.
 *  3. Parseo por forma:
 *     · sin argumentos: `/logout`, `/ayuda` (sobrantes ignorados).
 *     · id opcional: primer token del resto, o campo ausente si el resto está vacío.
 *     · id + resto: `split` en el PRIMER espacio; el resto entero con `trim` de bordes.
 *  4. Argumento obligatorio ausente o vacío → `{ ayuda, "argumentos", comando }`.
 *     Obligatorios: `/login` (los DOS), `/soporte` (consulta), `/devolucion` (token).
 *     `motivo` de `/devolucion` y `ventaId` de los tres privilegiados son OPCIONALES.
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
    // Solo /logout llega acá (aparte de /ayuda, ya resuelto arriba).
    return { tipo: "logout" };
  }

  if (descriptor.forma === "id_opcional") {
    const ventaId = restoLinea === undefined ? undefined : splitPrimerEspacio(restoLinea).primero;
    const tipo =
      descriptor.nombre === "/aprobar-reembolso"
        ? "aprobar_reembolso"
        : descriptor.nombre === "/rechazar-reembolso"
          ? "rechazar_reembolso"
          : "reabrir_reembolso";
    return ventaId === undefined ? { tipo } : { tipo, ventaId };
  }

  // forma === "id_mas_resto": /login, /soporte, /devolucion.
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

  // /devolucion <token> [motivo]
  if (restoLinea === undefined) {
    return ayudaArgumentos(comandoToken);
  }
  const { primero: token, resto: motivo } = splitPrimerEspacio(restoLinea);
  return motivo === undefined ? { tipo: "devolucion", token } : { tipo: "devolucion", token, motivo };
}
