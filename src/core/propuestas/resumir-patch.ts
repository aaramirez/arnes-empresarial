/**
 * Resumen de un patch unificado de git y conteo de bytes UTF-8 — PURO, SIN
 * IMPORTS (Hito 5.1, tarea 18, ADR 68, design.md §5.5).
 *
 * `src/core/` no puede importar de Node (regla no negociable de `AGENTS.md`),
 * así que `Buffer.byteLength` está prohibido acá. Y `string.length` es
 * INCORRECTO como conteo de bytes: cuenta unidades UTF-16, no bytes UTF-8 —
 * un patch con acentos, nombres de archivo no-ASCII o contenido binario en
 * base64 se mediría corto y podría persistirse por encima de `PATCH_MAX_BYTES`
 * (`propuestas-contract.ts`) sin que el tope lo detecte.
 *
 * `contarBytesUtf8` es la implementación manual de ese conteo: recorre la
 * string UTF-16 unidad por unidad y clasifica cada code point por rango
 * (1/2/3/4 bytes), igual que la codificación UTF-8 real. Se verifica contra
 * `Buffer.byteLength` desde el TEST (que sí puede importar Node) — este
 * archivo nunca lo hace.
 *
 * `ResumenPatch` repite el shape declarado localmente en
 * `propuestas-contract.ts` (tarea 17) SIN importarlo: ese archivo importa
 * únicamente de `../hitl/hitl-contract.js`, y este archivo no importa nada —
 * importar de uno u otro habría violado la restricción del que importa.
 * Mismos nombres de campo, mismo orden, cero acoplamiento cruzado.
 */

/** Mismo shape que `ResumenPatch` de `propuestas-contract.ts` (tarea 17), sin import cruzado. */
export interface ResumenPatch {
  readonly patchBytes: number;
  readonly archivos: number;
  readonly lineasAgregadas: number;
  readonly lineasEliminadas: number;
}

/**
 * PURA, sin imports de Node. Cuenta bytes UTF-8 de una string UTF-16.
 *
 * Un surrogate alto (0xD800-0xDBFF) seguido de un surrogate bajo VÁLIDO
 * (0xDC00-0xDFFF) se trata como un par (4 bytes, consume dos unidades) — es
 * el camino común de emojis y caracteres fuera del plano básico. Un
 * surrogate alto AL FINAL de la string (sin unidad siguiente), un surrogate
 * alto seguido de algo que NO es un low surrogate válido (p. ej. un BMP
 * normal), y cualquier surrogate bajo huérfano (0xDC00-0xDFFF sin un high
 * surrogate previo) caen en la rama final: 3 bytes, el tamaño de U+FFFD
 * (carácter de reemplazo) al codificar UTF-8 — mismo criterio con el que
 * Node normaliza un surrogate sin pareja. En ese caso la unidad siguiente NO
 * se consume: se procesa en su propia iteración siguiente del loop.
 */
export function contarBytesUtf8(texto: string): number {
  let bytes = 0;
  for (let i = 0; i < texto.length; i += 1) {
    const code = texto.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      i + 1 < texto.length &&
      texto.charCodeAt(i + 1) >= 0xdc00 &&
      texto.charCodeAt(i + 1) <= 0xdfff
    ) {
      bytes += 4; // par surrogate válido: un code point de 4 bytes, consume DOS unidades
      i += 1;
    } else {
      bytes += 3; // incluye surrogates huérfanos (altos sin pareja válida, o bajos sueltos): 3 bytes (U+FFFD al codificar)
    }
  }
  return bytes;
}

/**
 * PURA. Un solo recorrido por líneas del patch unificado:
 *   · `archivos`          = líneas que empiezan con "diff --git "
 *   · `lineasAgregadas`   = empiezan con "+" y NO con "+++"
 *   · `lineasEliminadas`  = empiezan con "-" y NO con "---"
 *   · `patchBytes`        = contarBytesUtf8(patch)
 * No parsea hunks ni valida el formato: es un RESUMEN para el eco y el
 * listado, no un validador — el validador real es `git apply --check`.
 */
export function resumirPatch(patch: string): ResumenPatch {
  const lineas = patch.split("\n");
  let archivos = 0;
  let lineasAgregadas = 0;
  let lineasEliminadas = 0;

  for (const linea of lineas) {
    if (linea.startsWith("diff --git ")) {
      archivos += 1;
    } else if (linea.startsWith("+") && !linea.startsWith("+++")) {
      lineasAgregadas += 1;
    } else if (linea.startsWith("-") && !linea.startsWith("---")) {
      lineasEliminadas += 1;
    }
  }

  return {
    patchBytes: contarBytesUtf8(patch),
    archivos,
    lineasAgregadas,
    lineasEliminadas,
  };
}
