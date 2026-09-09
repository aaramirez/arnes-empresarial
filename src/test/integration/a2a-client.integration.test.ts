import { describe, expect, it } from "vitest";
import { createA2AAdapter } from "../../adapters/a2a/index.js";
import {
  DESTINO_A2A_KPI_INCIDENTE,
  DESTINO_A2A_RIESGO_CREDITO,
  TASK_STATE_COMPLETED,
  type ClienteA2APort,
  type DestinoA2AClave,
} from "../../core/agents/a2a-contract.js";

/**
 * Integration test for the outbound A2A client (Hito 6, tarea 7, design.md
 * §10.C, ADR 75 pto 2, 71 pto 7) — segunda vez que un test de este repo toca
 * la RED de verdad (la primera fue `run-tests.integration.test.ts`, contra
 * `git`/`vitest` reales), pero la PRIMERA vez que lo hace contra un servidor
 * HTTP externo real: un agente A2A conforme a la especificación v1.0.0.
 *
 * Molde de `run-tests.integration.test.ts`: `describe.skipIf`, degrada a
 * *skip* y NUNCA a falla cuando la dependencia externa no está disponible.
 *
 * **Diferencia técnica deliberada con ese molde** (documentada en
 * `design.md` §10.C): `run-tests.integration.test.ts` sondea con
 * `execFileSync("git", ["--version"], ...)` — SÍNCRONO, porque
 * `describe.skipIf` necesita un booleano en tiempo de colección y `git
 * --version` puede ejecutarse sin `await`. El sondeo de este archivo es un
 * `GET .well-known/agent-card.json` vía `fetch` — ASÍNCRONO por naturaleza —
 * así que el gate usa **top-level `await`** en este propio archivo (ESM,
 * `"module": "NodeNext"` en `tsconfig.json`, soportado nativamente por
 * Node 20+ y por vitest): `sondearAgentCard` corre ANTES de
 * `describe.skipIf(...)`, con un timeout corto (2 s, `AbortSignal.timeout`)
 * para que un servidor ausente o colgado degrade a skip en segundos, no
 * cuelgue la colección de tests.
 *
 * `sondearAgentCard` NO se conforma con `response.ok`: valida que el cuerpo
 * parsee como JSON y traiga `supportedInterfaces` con al menos una entrada
 * `protocolBinding: "JSONRPC"` — el mismo recorte que `extraerEndpointJsonRpc`
 * de `src/adapters/a2a/client.ts` ya aplica en producción (RD-24 resuelto).
 * Sondear sólo por HTTP 200 arriesgaría un falso positivo (cualquier server
 * HTTP que responda 200 en esa ruta) que convertiría "el agente no habla A2A"
 * en un `describe` que corre y falla espuriamente, en vez de un skip limpio —
 * exactamente lo que ADR 75 pto 2 pide evitar ("sondear el card, no adivinar
 * por variable de entorno").
 *
 * **Cómo correr esto de verdad, contra un agente real**:
 *
 *   1. Cloná `a2aproject/a2a-samples` y levantá el sample `helloworld`
 *      (`samples/python/agents/helloworld`, `python -m venv .venv`,
 *      `python __main__.py`) — o cualquier otro agente conforme a A2A
 *      v1.0.0 que publique su Agent Card en `/.well-known/agent-card.json`
 *      con un transporte JSON-RPC declarado.
 *   2. Exportá `HARNESS_A2A_ENDPOINT_RIESGO_CREDITO=http://localhost:<puerto>`
 *      apuntando a ese sample (sin barra final).
 *   3. Corré `npm test`. Con el sample arriba, este archivo corre sus dos
 *      primeros tests contra la red real.
 *   4. (Opcional, RD-26): levantá un SEGUNDO sample y exportá también
 *      `HARNESS_A2A_ENDPOINT_KPI_INCIDENTE` apuntando a él — el tercer test
 *      de este archivo corre exactamente el mismo código contra ese segundo
 *      destino, sin una línea distinta, como evidencia de que el cliente es
 *      agnóstico al dominio.
 *
 * Sin ninguna de esas dos variables (o con el sample caído / inalcanzable),
 * `A2A_DISPONIBLE` resuelve `false` y el `describe` entero se reporta como
 * **skipped**, nunca como fallo — este es precisamente el estado esperado en
 * CI y en cualquier checkout que no tenga un sample corriendo a mano.
 */

const AGENT_CARD_PROBE_TIMEOUT_MS = 2_000;
const DELEGACION_TIMEOUT_MS = 30_000;

interface SupportedInterfaceLike {
  readonly protocolBinding?: unknown;
}

/**
 * Sondeo asíncrono del Agent Card (design.md §10.C). Cualquier fallo —
 * `baseUrl` ausente/vacío, red caída, timeout, cuerpo no-JSON, o un card sin
 * transporte JSON-RPC declarado — degrada a `false`, NUNCA lanza. Es el único
 * `try/catch` de este archivo que existe para decidir el `skip`, no para
 * clasificar un desenlace de negocio (eso lo hace `client.ts` en producción).
 */
async function sondearAgentCard(baseUrl: string | undefined): Promise<boolean> {
  if (baseUrl === undefined || baseUrl.trim() === "") {
    return false;
  }
  try {
    const response = await fetch(`${baseUrl}/.well-known/agent-card.json`, {
      signal: AbortSignal.timeout(AGENT_CARD_PROBE_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }
    const card = (await response.json()) as { readonly supportedInterfaces?: unknown };
    if (!Array.isArray(card.supportedInterfaces)) {
      return false;
    }
    return (card.supportedInterfaces as readonly unknown[]).some(
      (entrada) =>
        typeof entrada === "object" &&
        entrada !== null &&
        (entrada as SupportedInterfaceLike).protocolBinding === "JSONRPC",
    );
  } catch {
    return false;
  }
}

// Top-level await deliberado (ver doc-comment de arriba) — el gate necesita
// el resultado del sondeo ANTES de que `describe.skipIf` decida colectar o
// saltar el bloque completo.
const A2A_DISPONIBLE = await sondearAgentCard(process.env.HARNESS_A2A_ENDPOINT_RIESGO_CREDITO);

/** No-op deliberado: este test verifica el desenlace real de la delegación, no los eventos que emite. */
function logEventDePrueba(
  _casoId: string,
  _event: string,
  _fields?: Readonly<Record<string, unknown>>,
): void {
  // Intencionalmente vacío.
}

/**
 * Único cuerpo de assertions para los tests 2 y 3 (RD-26): la MISMA función,
 * sin una línea distinta, se llama una vez con `"riesgo-credito"` y —si el
 * segundo destino está configurado— otra vez con `"kpi-incidente"`. Es la
 * evidencia de que el cliente es agnóstico al dominio del destino.
 */
async function verificarDelegacionCompletaContra(
  adapter: ClienteA2APort,
  clave: DestinoA2AClave,
): Promise<void> {
  const resultado = await adapter.delegar({
    clave,
    tarea: "test de integración automatizado: respondé con un saludo breve.",
    casoId: `caso-test-integracion-a2a-${clave}`,
  });

  if (!resultado.ok) {
    throw new Error(
      `se esperaba TASK_STATE_COMPLETED contra "${clave}", pero la delegación no completó: ` +
        `reason="${resultado.reason}", estado=${resultado.estado ?? "(ninguno)"}, ` +
        `detalle=${resultado.detalle ?? "(ninguno)"}`,
    );
  }

  // El estado DEBE ser genuinamente COMPLETED (no una asunción enlatada) — es
  // justo lo que el narrowing de `resultado.ok` de arriba ya garantiza vía el
  // tipo `ResultadoA2AOk`, pero se deja explícito como documentación viva del
  // requirement. El texto de `resultado` puede o no venir vacío (algunos
  // agentes conformes completan sin `artifacts` ni `status.message` — ver
  // `extraerResultado` en `client.ts`); lo que este test exige es el ESTADO,
  // no la prosa del agente externo.
  expect(resultado.estado).toBe(TASK_STATE_COMPLETED);
  expect(typeof resultado.resultado).toBe("string");
  expect(typeof resultado.a2aTaskId).toBe("string");
}

describe.skipIf(!A2A_DISPONIBLE)("cliente A2A (integración contra un agente real)", () => {
  const adapter = createA2AAdapter({ logEvent: logEventDePrueba });

  it("baseUrlDe devuelve la URL configurada para riesgo-credito (sanity, sin red)", () => {
    expect(adapter.baseUrlDe(DESTINO_A2A_RIESGO_CREDITO)).toBe(
      process.env.HARNESS_A2A_ENDPOINT_RIESGO_CREDITO?.trim(),
    );
  });

  it(
    "delegar contra riesgo-credito: Agent Card con transporte JSON-RPC, SendMessage con task.id y status.state conocido, loop de GetTask hasta TASK_STATE_COMPLETED",
    async () => {
      await verificarDelegacionCompletaContra(adapter, DESTINO_A2A_RIESGO_CREDITO);
    },
    DELEGACION_TIMEOUT_MS,
  );

  // RD-26: el MISMO código de arriba, apuntado al segundo destino — sólo
  // corre si ese segundo sample también está configurado. No repite la
  // lógica: llama a la misma función que el test anterior.
  it.skipIf(!process.env.HARNESS_A2A_ENDPOINT_KPI_INCIDENTE)(
    "delegar contra kpi-incidente llega a TASK_STATE_COMPLETED con el mismo código, sin una línea distinta (RD-26)",
    async () => {
      await verificarDelegacionCompletaContra(adapter, DESTINO_A2A_KPI_INCIDENTE);
    },
    DELEGACION_TIMEOUT_MS,
  );
});
