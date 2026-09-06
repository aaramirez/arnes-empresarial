import type { VentaPublica } from "../../core/ventas/ventas-contract.js";

/**
 * HTML por función pura (Hito 4, tarea 16, ADR 20, design.md §4.5). Único
 * import: `VentaPublica` de `core/ventas/ventas-contract.js` — nada de
 * `config.ts`, `payloads.ts` ni ningún otro archivo de este mismo adaptador,
 * a propósito: este módulo no necesita saber de rutas, tokens de auth ni
 * body parsing, solo transformar datos ya validados en texto.
 *
 * Regla no negociable de las tres funciones de página (ADR 20, punto 2):
 * TODO valor dinámico que venga de fuera (plan, monto, token) pasa por
 * `escapeHtml` o `encodeURIComponent` antes de concatenarse — nunca crudo.
 */

/**
 * `&`, `<`, `>`, `"`, `'` → entidades. Aplicado a TODO valor dinámico (ADR
 * 20, punto 2).
 *
 * `&` se reemplaza SIEMPRE primero: si `<` se reemplazara antes, el `&` de
 * la entidad `&lt;` recién generada volvería a escaparse en el paso de `&`,
 * produciendo `&amp;lt;` — doble escapado. Reemplazar `&` primero sobre el
 * texto crudo evita ese problema porque para cuando se generan entidades
 * nuevas, el paso de `&` ya pasó.
 */
export function escapeHtml(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Envoltorio de página común: doctype, charset, título — sin datos dinámicos adentro. */
function pagina(titulo: string, cuerpo: string): string {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>${titulo}</title>
</head>
<body>
${cuerpo}
</body>
</html>`;
}

/**
 * Página de confirmación: detalle de la venta (plan anterior si existe, plan
 * nuevo, monto) y UN formulario con DOS botones `submit` que comparten
 * `name="decision"` y difieren en `value` (`confirmar` / `rechazar`).
 *
 * `action="/confirmar/${encodeURIComponent(token)}"` — `encodeURIComponent`,
 * NO `escapeHtml`: es un contexto de URL, no de texto (ADR 20, punto 3).
 * `method="post"`.
 *
 * `venta` es `VentaPublica`: sin token, sin `caso_id`, sin `cliente_id`. Lo
 * que no se le pasa a esta función no puede filtrarse a la página — se
 * destructuran únicamente los tres campos del tipo, nunca se serializa el
 * objeto completo, así que un campo extra que llegara en runtime (violando
 * el tipo) tampoco se filtra.
 */
export function renderConfirmacionHtml(venta: VentaPublica, token: string): string {
  const { planAnterior, planNuevo, monto } = venta;
  const action = `/confirmar/${encodeURIComponent(token)}`;
  const montoFormateado = escapeHtml(monto.toFixed(2));

  const filaPlanAnterior =
    planAnterior !== undefined
      ? `<p>Plan anterior: <strong>${escapeHtml(planAnterior)}</strong></p>\n`
      : "";

  const cuerpo = `<h1>Confirmá tu venta</h1>
${filaPlanAnterior}<p>Plan nuevo: <strong>${escapeHtml(planNuevo)}</strong></p>
<p>Monto: <strong>${montoFormateado}</strong></p>
<form action="${action}" method="post">
<button type="submit" name="decision" value="confirmar">Confirmar</button>
<button type="submit" name="decision" value="rechazar">Rechazar</button>
</form>`;

  return pagina("Confirmá tu venta", cuerpo);
}

/**
 * Página de resultado: "confirmada" o "rechazada", sin montos de comisión
 * (el cliente no tiene por qué ver cuánto cobra el vendedor). `resultado` es
 * un literal cerrado (`"confirmada" | "rechazada"`), no un string libre —
 * no hay forma de que un valor dinámico arbitrario llegue acá.
 */
export function renderResultadoHtml(resultado: "confirmada" | "rechazada"): string {
  const cuerpo =
    resultado === "confirmada"
      ? "<h1>Venta confirmada</h1>\n<p>Gracias, tu confirmación quedó registrada.</p>"
      : "<h1>Venta rechazada</h1>\n<p>Registramos que rechazaste esta venta.</p>";

  return pagina(resultado === "confirmada" ? "Venta confirmada" : "Venta rechazada", cuerpo);
}

/**
 * LA página genérica. Un solo texto para inexistente, vencido, ya procesado y
 * decisión inválida. Sin ningún dato del servidor adentro — no tiene
 * parámetros a propósito: una función sin entrada no puede filtrar nada
 * (R6: sin oráculos, spec `venta-confirmacion`).
 */
export function renderLinkInvalidoHtml(): string {
  return pagina(
    "Enlace no válido",
    "<h1>Enlace no válido</h1>\n<p>Este enlace no es válido, ya fue usado o venció.</p>",
  );
}
