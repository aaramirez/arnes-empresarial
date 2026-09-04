import { describe, expect, it } from "vitest";
import type { VentaPublica } from "../../core/ventas/ventas-contract.js";
import { escapeHtml, renderConfirmacionHtml, renderLinkInvalidoHtml, renderResultadoHtml } from "./render.js";

describe("escapeHtml", () => {
  it("escapa exactamente & < > \" ' a sus entidades", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("no toca caracteres fuera del set (no escapa de mas)", () => {
    expect(escapeHtml("plan-pro 123 ñoño")).toBe("plan-pro 123 ñoño");
  });

  it("reemplaza & primero para no doble-escapar entidades ya generadas", () => {
    // Si `<` se reemplazara antes que `&`, "<" -> "&lt;" y luego el paso de
    // `&` volveria a escapar ese "&" generado, produciendo "&amp;lt;".
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
  });

  it("escapa un string con los cinco caracteres combinados, en orden", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});

describe("renderConfirmacionHtml", () => {
  const ventaBase: VentaPublica = {
    planAnterior: "plan-basico",
    planNuevo: "plan-pro",
    monto: 1000,
  };

  it("incluye plan anterior, plan nuevo y monto en el HTML", () => {
    const html = renderConfirmacionHtml(ventaBase, "tok-123");

    expect(html).toContain("plan-basico");
    expect(html).toContain("plan-pro");
    expect(html).toContain("1000");
  });

  it("no incluye plan anterior cuando esta ausente", () => {
    const venta: VentaPublica = { planNuevo: "plan-pro", monto: 500 };

    const html = renderConfirmacionHtml(venta, "tok-123");

    expect(html).not.toContain("plan-basico");
  });

  it("escapa un planNuevo con <script> (XSS almacenado)", () => {
    const venta: VentaPublica = {
      planNuevo: '<script>alert("xss")</script>',
      monto: 1000,
    };

    const html = renderConfirmacionHtml(venta, "tok-123");

    expect(html).not.toContain("<script>alert(\"xss\")</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapa un planAnterior con <script> (XSS almacenado)", () => {
    const venta: VentaPublica = {
      planAnterior: "<img src=x onerror=alert(1)>",
      planNuevo: "plan-pro",
      monto: 1000,
    };

    const html = renderConfirmacionHtml(venta, "tok-123");

    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });

  it("arma el action con encodeURIComponent del token, NO con escapeHtml", () => {
    const token = "abc&def<>\"'";

    const html = renderConfirmacionHtml(ventaBase, token);

    expect(html).toContain(`action="/confirmar/${encodeURIComponent(token)}"`);
    // Si se hubiera usado escapeHtml en vez de encodeURIComponent, el `&`
    // habria salido como `&amp;` en el action en vez de `%26`.
    expect(html).not.toContain("/confirmar/abc&amp;def");
  });

  it("usa method=post en el formulario", () => {
    const html = renderConfirmacionHtml(ventaBase, "tok-123");

    expect(html).toContain('method="post"');
  });

  it("tiene un unico formulario con dos botones submit que comparten name=decision y difieren en value", () => {
    const html = renderConfirmacionHtml(ventaBase, "tok-123");

    const formCount = (html.match(/<form/g) ?? []).length;
    expect(formCount).toBe(1);

    expect(html).toContain('name="decision"');
    expect(html).toContain('value="confirmar"');
    expect(html).toContain('value="rechazar"');

    const submitCount = (html.match(/type="submit"/g) ?? []).length;
    expect(submitCount).toBe(2);
  });

  it("no contiene caso_id ni cliente_id en el HTML de salida, ni aunque el objeto recibido los traiga en runtime", () => {
    const ventaConCamposFiltrados = {
      planAnterior: "plan-basico",
      planNuevo: "plan-pro",
      monto: 1000,
      casoId: "caso-super-secreto",
      clienteId: "cliente-super-secreto",
    } as unknown as VentaPublica;

    const html = renderConfirmacionHtml(ventaConCamposFiltrados, "tok-123");

    expect(html).not.toContain("caso_id");
    expect(html).not.toContain("cliente_id");
    expect(html).not.toContain("caso-super-secreto");
    expect(html).not.toContain("cliente-super-secreto");
  });

  it("no contiene el token crudo sin encodear en ningun lado si el token trae caracteres especiales", () => {
    const token = "tok con espacio";

    const html = renderConfirmacionHtml(ventaBase, token);

    expect(html).not.toContain("tok con espacio");
    expect(html).toContain(encodeURIComponent(token));
  });
});

describe("renderResultadoHtml", () => {
  it("devuelve una pagina distinta para confirmada y para rechazada", () => {
    const confirmada = renderResultadoHtml("confirmada");
    const rechazada = renderResultadoHtml("rechazada");

    expect(confirmada).not.toBe(rechazada);
    expect(confirmada.toLowerCase()).toContain("confirmada");
    expect(rechazada.toLowerCase()).toContain("rechazada");
  });

  it("no expone ningun monto de comision (sin secuencias de digitos tipo monto en el HTML)", () => {
    // No se prohibe cualquier digito suelto (p.ej. "utf-8" del boilerplate de
    // pagina), sino secuencias de 2+ digitos, que es la forma que tomaria
    // cualquier monto de comision filtrado.
    expect(renderResultadoHtml("confirmada")).not.toMatch(/\d{2,}/);
    expect(renderResultadoHtml("rechazada")).not.toMatch(/\d{2,}/);
  });
});

describe("renderLinkInvalidoHtml", () => {
  it("no toma parametros", () => {
    expect(renderLinkInvalidoHtml.length).toBe(0);
  });

  it("es identico llamado N veces", () => {
    const primera = renderLinkInvalidoHtml();
    const segunda = renderLinkInvalidoHtml();
    const tercera = renderLinkInvalidoHtml();

    expect(primera).toBe(segunda);
    expect(segunda).toBe(tercera);
  });
});
