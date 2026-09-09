import { describe, expect, it } from "vitest";
import { extraerEndpointJsonRpc } from "./client.js";
import type { A2AServerConfig } from "./server-config.js";
import { construirAgentCard } from "./agent-card.js";

function makeConfig(overrides: Partial<A2AServerConfig> = {}): A2AServerConfig {
  return {
    token: "secreto",
    port: 8888,
    publicUrl: "http://localhost:8888",
    maxBodyBytes: 65_536,
    maxEnVuelo: 4,
    ...overrides,
  };
}

describe("construirAgentCard", () => {
  it("emite el objeto entero exacto esperado (ADR 96)", () => {
    const card = construirAgentCard(makeConfig());

    expect(card).toEqual({
      name: "Arnés Empresarial",
      description:
        "Arnés de agentes de IA de una empresa. Responde consultas sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas.",
      version: "3.0.0",
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "consulta-arnes",
          name: "Consulta al arnés empresarial",
          description:
            "Respondé una consulta en lenguaje natural sobre el estado de proyectos, actividades de desarrollo, incidentes, solicitudes internas y ventas registradas en el arnés. Es una consulta de sólo lectura: el arnés no modifica nada a pedido de un agente externo.",
          tags: ["consulta", "estado", "proyectos", "incidentes", "solo-lectura"],
          examples: [
            "¿En qué estado está la revisión del PR 42 del proyecto X?",
            "¿Qué incidentes abiertos hay hoy?",
            "¿Cuántas ventas quedaron pendientes de confirmación esta semana?",
          ],
        },
      ],
      supportedInterfaces: [{ protocolBinding: "JSONRPC", url: "http://localhost:8888/a2a" }],
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    });
  });

  it("las tres capabilities están presentes como claves explícitas, no sólo con valor falsy", () => {
    const card = construirAgentCard(makeConfig());

    expect("streaming" in card.capabilities).toBe(true);
    expect("pushNotifications" in card.capabilities).toBe(true);
    expect("extendedAgentCard" in card.capabilities).toBe(true);
    expect(card.capabilities.streaming).toBe(false);
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.capabilities.extendedAgentCard).toBe(false);
  });

  it("emite exactamente una skill", () => {
    const card = construirAgentCard(makeConfig());

    expect(card.skills).toHaveLength(1);
    expect(card.skills[0]?.id).toBe("consulta-arnes");
  });

  it("emite exactamente una entrada de supportedInterfaces, JSONRPC, con url no vacío, y esa url la reconoce extraerEndpointJsonRpc del Cliente A2A real", () => {
    const card = construirAgentCard(makeConfig({ publicUrl: "https://a2a.example.com" }));

    expect(card.supportedInterfaces).toHaveLength(1);
    const [entrada] = card.supportedInterfaces;
    expect(entrada?.protocolBinding).toBe("JSONRPC");
    expect(entrada?.url).not.toBe("");

    const endpoint = extraerEndpointJsonRpc(card);
    expect(endpoint).toBe("https://a2a.example.com/a2a");
  });

  it("version es exactamente 3.0.0", () => {
    const card = construirAgentCard(makeConfig());

    expect(card.version).toBe("3.0.0");
  });

  it("no emite preferredTransport ni additionalInterfaces (ADR 96 pto 6)", () => {
    const card = construirAgentCard(makeConfig());

    expect("preferredTransport" in card).toBe(false);
    expect("additionalInterfaces" in card).toBe(false);
  });

  it("normaliza publicUrl distinta en supportedInterfaces[0].url", () => {
    const card = construirAgentCard(makeConfig({ publicUrl: "http://otro-host:9999" }));

    expect(card.supportedInterfaces[0]?.url).toBe("http://otro-host:9999/a2a");
  });
});
