/**
 * Entrypoint de provisioning de credenciales de empleado (`tui-canal-empleado`,
 * ADR 33). Molde EXACTO de `src/reporte-mensual.ts` (verificado línea por
 * línea): parte pura testeada directo, `openDatabase("data/harness.db")`
 * (misma función y mismo path que `main.ts`, corre las migraciones si
 * faltan), `db.close()` en un `finally`, guard `isMainModule`, `stdout`
 * legítimo por ser un proceso sin TUI montada.
 *
 * `package.json`'s `empleados:crear` script apunta acá (`tsx
 * src/empleados.ts`). Uso:
 * `npm run empleados:crear -- ana` (alta) o
 * `npm run empleados:crear -- ana --rotar` (rotación), contraseña por stdin.
 *
 * A diferencia de `main.ts` (que ningún test importa), `empleados.test.ts`
 * SÍ importa este archivo para testear `parseArgsEmpleado` directamente. Eso
 * significa que `main()` NO puede dispararse como efecto secundario de la
 * sola importación del módulo — el guard de `isMainModule` de abajo
 * (comparación `import.meta.url` vs. `process.argv[1]`) es lo que lo evita.
 */
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { hashPassword } from "./adapters/crypto/password.js";
import { openDatabase } from "./adapters/memory/db.js";
import {
  CredencialEmpleadoDuplicadaError,
  insertCredencialEmpleado,
  updateCredencialEmpleado,
} from "./adapters/memory/repository.js";

const USO_MENSAJE =
  "Uso: npm run empleados:crear -- <empleadoId> [--rotar]  (la contraseña se pide por stdin)";

/** Guarda de FORMA, no de política: este string es la columna de actor de
 *  cada fila de auditoría y se imprime en el eco de `/login`. Un id con
 *  espacios o saltos de línea rompería el parseo posicional de `/login`. */
const ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export type ParseArgsEmpleadoResult =
  | { readonly ok: true; readonly empleadoId: string; readonly modo: "alta" | "rotar" }
  | { readonly ok: false; readonly mensaje: string };

/**
 * PURA: recibe `argv`, no lo lee. Reglas (design.md §7):
 *  1. Primer argumento posicional que no empiece con `--` → `empleadoId`.
 *     Ausente → `ok:false` con el uso.
 *  2. No matchea `ID_REGEX` → `ok:false` con el uso y el motivo.
 *  3. `--rotar` presente en cualquier posición → `modo: "rotar"`; si no →
 *     `"alta"`.
 *  4. Flag desconocida (`--` seguido de otra cosa) → `ok:false`. Una flag
 *     mal escrita en un comando que CREA credenciales no puede caer en
 *     silencio al modo por defecto.
 */
export function parseArgsEmpleado(argv: readonly string[]): ParseArgsEmpleadoResult {
  const flagsConocidas = new Set(["--rotar"]);
  const flagsPresentes = argv.filter((a) => a.startsWith("--"));

  for (const flag of flagsPresentes) {
    if (!flagsConocidas.has(flag)) {
      return { ok: false, mensaje: `${USO_MENSAJE}\nFlag desconocida: ${flag}` };
    }
  }

  const empleadoId = argv.find((a) => !a.startsWith("--"));
  if (empleadoId === undefined) {
    return { ok: false, mensaje: USO_MENSAJE };
  }

  if (!ID_REGEX.test(empleadoId)) {
    return { ok: false, mensaje: `${USO_MENSAJE}\nempleadoId inválido: "${empleadoId}"` };
  }

  const modo = flagsPresentes.includes("--rotar") ? "rotar" : "alta";
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

async function main(): Promise<void> {
  const parsed = parseArgsEmpleado(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.mensaje}\n`);
    process.exit(1);
    return;
  }

  const password = await leerPasswordDeStdin();
  if (password.trim() === "") {
    process.stderr.write("La contraseña no puede estar vacía\n");
    process.exit(1);
    return;
  }

  const hash = hashPassword(password);
  const db = openDatabase("data/harness.db");
  try {
    const ahora = new Date().toISOString();
    if (parsed.modo === "alta") {
      try {
        insertCredencialEmpleado(db, { empleadoId: parsed.empleadoId, passwordHash: hash, ahora });
      } catch (error) {
        if (error instanceof CredencialEmpleadoDuplicadaError) {
          process.stderr.write(`Ya existe una credencial para "${parsed.empleadoId}"\n`);
          process.exit(1);
          return;
        }
        throw error;
      }
      process.stdout.write(`Empleado ${parsed.empleadoId} creado.\n`);
    } else {
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
