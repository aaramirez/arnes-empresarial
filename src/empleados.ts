/**
 * Entrypoint de provisioning de credenciales de empleado (`tui-canal-empleado`,
 * ADR 33). Molde EXACTO de `src/reporte-mensual.ts` (verificado línea por
 * línea): parte pura testeada directo, la base se abre por `resolveDbPath`
 * (mismo resolver y mismo path que `main.ts`, `HARNESS_DB_PATH`/default
 * `data/harness.db`, modo-headless-cierre-limpio RD-122, corre las
 * migraciones si faltan), `db.close()` en un `finally`, guard
 * `isMainModule`, `stdout` legítimo por ser un proceso sin TUI montada.
 *
 * `package.json`'s `empleados:crear` script apunta acá (`tsx
 * src/empleados.ts`). Uso:
 * `npm run empleados:crear -- ana` (alta) o
 * `npm run empleados:crear -- ana --rotar` (rotación), contraseña por stdin,
 * o `npm run empleados:crear -- ana --rol administrador` (asignación de rol,
 * `autorizacion-empleado` ADR 160/RD-79) — **sin** contraseña por stdin,
 * exige que `ana` ya tenga credencial.
 *
 * A diferencia de `main.ts` (que ningún test importa), `empleados.test.ts`
 * SÍ importa este archivo. `parseArgsEmpleado` se testea directo (I/O
 * manual, mismo criterio que `parsePeriodo`); `main()` también se importa y
 * se ejecuta en test para el modo `"asignar-rol"` (invariante de seguridad:
 * nunca crear una fila de rol huérfana), con `openDatabase`/`process.exit`
 * espiados — el guard de `isMainModule` de abajo (comparación
 * `import.meta.url` vs. `process.argv[1]`) es lo que evita que `main()` se
 * dispare como efecto secundario de la sola importación del módulo.
 */
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import { hashPassword } from "./adapters/crypto/password.js";
import { openDatabase } from "./adapters/memory/db.js";
import { resolveDbPath } from "./adapters/memory/config.js";
import {
  buscarCredencialEmpleado,
  CredencialEmpleadoDuplicadaError,
  insertCredencialEmpleado,
  updateCredencialEmpleado,
  upsertRolEmpleado,
} from "./adapters/memory/repository.js";
import { ROLES_EMPLEADO, type RolEmpleado } from "./core/auth/rol-contract.js";

const USO_MENSAJE =
  "Uso: npm run empleados:crear -- <empleadoId> [--rotar | --rol <valor>]  (la contraseña se pide por stdin, salvo con --rol)";

const ROLES_VALIDOS = new Set<string>(ROLES_EMPLEADO);

/** Guarda de FORMA, no de política: este string es la columna de actor de
 *  cada fila de auditoría y se imprime en el eco de `/login`. Un id con
 *  espacios o saltos de línea rompería el parseo posicional de `/login`.
 *  Exportada (comandos-administracion-empleados, tarea 1, ADR 181/RD-82):
 *  `altaCredencialEmpleado` la reusa tal cual, mismo criterio de guarda de
 *  forma para `/crear-empleado` (PR3, bloqueada). */
export const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ParseArgsEmpleadoResult =
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "alta" | "rotar" }
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "asignar-rol"; readonly rol: RolEmpleado }
  | { readonly ok: false; readonly mensaje: string };

/**
 * PURA: recibe `argv`, no lo lee. Reglas (design.md §7, extendidas por §5
 * ADR 160 / RD-79 con el flag de valor `--rol`):
 *  1. Flag desconocida (ni `--rotar` ni `--rol`) → `ok:false`, verificado
 *     ANTES que cualquier otra cosa. Una flag mal escrita en un comando que
 *     escribe credenciales o roles no puede caer en silencio al default.
 *  2. `--rol` repetido (dos o más ocurrencias en `argv`) → `ok:false` con
 *     mensaje explícito ("--rol solo puede especificarse una vez"), verificado
 *     ANTES de resolver su índice — `indexOf` sólo ve la primera ocurrencia,
 *     así que sin este chequeo un segundo `--rol` se cuela como el
 *     `empleadoId` posicional en vez de rechazarse (hallazgo de code-review,
 *     ronda de corrección post-Reviewer de `autorizacion-empleado`).
 *  3. `--rol` y `--rotar` juntos → `ok:false` con mensaje explícito de
 *     incompatibilidad (son dos operaciones distintas, error semántico, no
 *     "flag desconocida").
 *  4. `--rol` presente → su valor (el token siguiente) debe pertenecer a
 *     `ROLES_EMPLEADO`; ausente o inválido → `ok:false`, nunca cae a un rol
 *     por default. Modo `"asignar-rol"`.
 *  5. Primer argumento posicional que no empiece con `--` → `empleadoId`.
 *     Ausente → `ok:false` con el uso.
 *  6. No matchea `ID_REGEX` → `ok:false` con el uso y el motivo.
 *  7. `--rotar` presente en cualquier posición (sin `--rol`) → `modo:
 *     "rotar"`; si no → `"alta"`.
 */
export function parseArgsEmpleado(argv: readonly string[]): ParseArgsEmpleadoResult {
  const flagsConocidas = new Set(["--rotar", "--rol"]);
  const flagsPresentes = argv.filter((a) => a.startsWith("--"));

  for (const flag of flagsPresentes) {
    if (!flagsConocidas.has(flag)) {
      return { ok: false, mensaje: `${USO_MENSAJE}\nFlag desconocida: ${flag}` };
    }
  }

  const rolOcurrencias = argv.filter((a) => a === "--rol").length;
  if (rolOcurrencias > 1) {
    return { ok: false, mensaje: `${USO_MENSAJE}\n--rol solo puede especificarse una vez.` };
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

  const modo = tieneRotar ? "rotar" : "alta";
  return { ok: true, empleadoId, modo };
}

/**
 * `node:readline` sobre `process.stdin`, UNA línea, cero dependencias. El
 * prompt va a **stderr**, no a stdout: así `echo "$PASS" | npm run
 * empleados:crear -- ana` y una redirección de stdout siguen siendo
 * limpias. ★ NUNCA por `argv` (ADR 33 punto 2): `argv` queda en el
 * historial del shell y en la tabla de procesos. ★ Residual declarado: la
 * línea tipeada SE VE en la terminal (R14, aceptado por el checkpoint) —
 * apagar el eco pide modo raw y no vale la pena acá.
 */
async function leerPasswordDeStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  process.stderr.write("Contraseña: ");
  try {
    for await (const linea of rl) {
      return linea;
    }
    return "";
  } finally {
    rl.close();
  }
}

/**
 * Función pura-de-efectos-acotados, exportada (comandos-administracion-empleados,
 * tarea 1, ADR 181/RD-82): extrae la secuencia que hoy vive en el cuerpo de
 * `main()`'s rama `"alta"` (`hashPassword` → `insertCredencialEmpleado` →
 * catch de `CredencialEmpleadoDuplicadaError`) para que `/crear-empleado`
 * (PR3, bloqueada) la reuse SIN invocar el script como subproceso —
 * alternativa rechazada por `proposal.md` ADR 174 (meter `child_process` en
 * el camino de un comando de la TUI, con la contraseña por `stdin` o
 * `argv`). `main()` pasa a LLAMAR a esta función en vez de repetir su
 * cuerpo. Lo que NO se comparte, a conciencia: `leerPasswordDeStdin()` (I/O
 * de terminal, no aplica a la TUI) y el `process.exit` (el dispatcher de la
 * TUI devuelve `TuiTurnResult`, nunca termina el proceso).
 */
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

/**
 * Exportada (a diferencia del resto del archivo, que solo exportaba
 * `parseArgsEmpleado`) porque `"asignar-rol"` necesita test de integración:
 * es un invariante de seguridad (nunca crear una fila de rol huérfana sobre
 * un `empleadoId` inexistente) que amerita verificación real, no solo
 * manual — mismo criterio de excepción que ya usa `build-on-activity.test.ts`
 * al espiar `getCasoById` para forzar un caso no alcanzable por el flujo
 * normal.
 */
export async function main(): Promise<void> {
  const parsed = parseArgsEmpleado(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.mensaje}\n`);
    process.exit(1);
    return;
  }

  if (parsed.modo === "asignar-rol") {
    const db = openDatabase(resolveDbPath());
    try {
      const credencial = buscarCredencialEmpleado(db, parsed.empleadoId);
      if (credencial === undefined) {
        process.stderr.write(`No existe el empleado "${parsed.empleadoId}".\n`);
        process.exit(1);
        return;
      }
      const ahora = new Date().toISOString();
      upsertRolEmpleado(db, { empleadoId: parsed.empleadoId, rol: parsed.rol, ahora });
      process.stdout.write(`Rol de ${parsed.empleadoId} asignado: ${parsed.rol}.\n`);
    } finally {
      db.close();
    }
    return;
  }

  const password = await leerPasswordDeStdin();
  if (password.trim() === "") {
    process.stderr.write("La contraseña no puede estar vacía\n");
    process.exit(1);
    return;
  }

  const db = openDatabase(resolveDbPath());
  try {
    const ahora = new Date().toISOString();
    if (parsed.modo === "alta") {
      const resultado = altaCredencialEmpleado(db, { empleadoId: parsed.empleadoId, password, ahora });
      if (!resultado.ok) {
        process.stderr.write(`${resultado.mensaje}\n`);
        process.exit(1);
        return;
      }
      process.stdout.write(`Empleado ${parsed.empleadoId} creado.\n`);
    } else {
      const hash = hashPassword(password);
      const rotada = updateCredencialEmpleado(db, {
        empleadoId: parsed.empleadoId,
        passwordHash: hash,
        ahora,
      });
      if (rotada === undefined) {
        process.stderr.write(`No existe el empleado "${parsed.empleadoId}".\n`);
        process.exit(1);
        return;
      }
      process.stdout.write(`Contraseña de ${parsed.empleadoId} rotada.\n`);
    }
  } finally {
    db.close();
  }
}

const isMainModule =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  await main();
}
