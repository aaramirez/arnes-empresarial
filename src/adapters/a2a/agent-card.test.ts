import { describe, expect, it } from "vitest";
import { extraerEndpointJsonRpc } from "./client.js";
import type { A2AServerConfig } from "./server-config.js";
import { construirAgentCard } from "./agent-card.js";
import {
  CONSULTAS_NEGOCIO_OPERACIONES,
  OPERACION_ESTADO_ACTIVIDAD,
  OPERACION_REPORTE_COMISIONES,
  OPERACION_SOLICITUDES_PENDIENTES,
} from "../../core/agents/consultas-negocio-tool.js";

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
        "Arnés de agentes de IA de una empresa. Responde consultas de sólo lectura sobre el estado de actividades de desarrollo (PRs), solicitudes internas pendientes, el reporte de comisiones por período y los reembolsos pendientes de aprobación.",
      version: "3.1.0",
      capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      skills: [
        {
          id: "consulta-arnes",
          name: "Consulta al arnés empresarial",
          description:
            "Respondé una consulta en lenguaje natural sobre el estado de actividades de desarrollo, solicitudes internas pendientes, comisiones por período y reembolsos pendientes de aprobación. Es una consulta de sólo lectura y agregada: el arnés no modifica nada a pedido de un agente externo ni devuelve datos personales de empleados o clientes.",
          tags: ["consulta", "estado", "solicitudes", "solo-lectura"],
          examples: [
            "¿En qué estado está la revisión del PR 42 del proyecto X?",
            "¿Cuántas solicitudes internas quedaron pendientes de aprobación?",
            "¿Cuál fue el total comisionado en el período actual?",
          ],
        },
      ],
      supportedInterfaces: [{ protocolBinding: "JSONRPC", url: "http://localhost:8888/a2a" }],
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
    });
  });

  it("tags no contiene 'incidentes' ni 'proyectos' (ADR 185 pto 1 y 3, tarea 11)", () => {
    const card = construirAgentCard(makeConfig());
    const tags = card.skills[0]?.tags ?? [];

    expect(tags).not.toContain("incidentes");
    expect(tags).not.toContain("proyectos");
    expect(tags).toContain("solicitudes");
    expect(tags).toContain("solo-lectura");
  });

  it("cada example es literalmente respondible por una de las 4 operaciones reales de consultar_negocio (punto obligatorio 6)", () => {
    const card = construirAgentCard(makeConfig());
    const examples = card.skills[0]?.examples ?? [];

    const exampleAOperacion: Record<string, (typeof CONSULTAS_NEGOCIO_OPERACIONES)[number]> = {
      "¿En qué estado está la revisión del PR 42 del proyecto X?": OPERACION_ESTADO_ACTIVIDAD,
      "¿Cuántas solicitudes internas quedaron pendientes de aprobación?":
        OPERACION_SOLICITUDES_PENDIENTES,
      "¿Cuál fue el total comisionado en el período actual?": OPERACION_REPORTE_COMISIONES,
    };

    expect(examples).toHaveLength(3);
    for (const example of examples) {
      const operacion = exampleAOperacion[example];
      expect(operacion, `example sin operación real que lo respalde: "${example}"`).toBeDefined();
      expect(CONSULTAS_NEGOCIO_OPERACIONES).toContain(operacion);
    }
  });

  it("ninguna description ni example menciona 'incidentes' (RD-84, spec servidor-a2a-jsonrpc)", () => {
    const card = construirAgentCard(makeConfig());
    const skill = card.skills[0];
    const textos = [card.description, skill?.description ?? "", ...(skill?.examples ?? [])];

    for (const texto of textos) {
      expect(texto.toLowerCase()).not.toContain("incidente");
    }
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

  it("version es exactamente 3.1.0 (minor, capacidad nueva compatible hacia atras, ADR 185 pto 4)", () => {
    const card = construirAgentCard(makeConfig());

    expect(card.version).toBe("3.1.0");
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
