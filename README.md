# Arnés Empresarial

Arnés (harness) básico con memoria compartida para correr agentes de IA multi-turno en un ambiente empresarial, construido sobre el **Claude Agent SDK**. Proyecto de pasantía corta — diseño primero, versionado incremental, arquitectura de puertos y adaptadores.

> **Estado actual:** fase de diseño. Este repositorio contiene la documentación de arquitectura (arc42) y el plan de implementación por hitos; el código todavía no se ha escrito.

## Objetivo

Implementar un arnés que permita:

- Definir agentes, subagentes, comandos, hooks y skills.
- Sostener memoria compartida entre agentes (estado de negocio por caso, no solo historial conversacional).
- Consultar una base de conocimiento propia (Obsidian + Graphify) con fuente citable.
- Comunicarse con agentes externos vía el protocolo **A2A**.
- Correr localmente, sin infraestructura de servidor.

Todo aplicado sobre casos de uso reales de empresa: revisión de PRs, aprobación de solicitudes, gestión de incidentes, confirmación de ventas y comisiones, entre otros.

## Arquitectura

Arquitectura hexagonal (puertos y adaptadores): un núcleo de orquestación desacoplado de la interfaz de usuario, la persistencia, el conocimiento y la comunicación entre agentes.

```
                     ┌─────────────────────┐
       Adaptador     │                     │   Adaptador de
         TUI  ───────┤   Núcleo de         ├─────  Memoria
       (Ink)         │   Orquestación      │       Compartida
                      │                     │       (SQLite)
                      └──────────┬──────────┘
                                 │
            ┌────────────────────────────────────┐
            │                                     │
    Adaptador de Conocimiento              Adaptador A2A
    (MCP propio → Graphify CLI)         (JSON-RPC, entrante/saliente)
```

| Bloque | Responsabilidad | Ubicación prevista |
| --- | --- | --- |
| Núcleo de Orquestación | Resuelve el turno activo, registra agentes/comandos/hooks/skills, expone el puerto `ModelProvider` | `src/core/` |
| Adaptador TUI | Entrada/salida por terminal (Ink) | `src/adapters/tui/` |
| Adaptador de Conocimiento | Traduce consultas a la CLI de Graphify vía un servidor MCP propio | `src/adapters/knowledge/` |
| Adaptador de Memoria Compartida | Persiste el estado de negocio (casos) correlacionado con las sesiones del SDK | `src/adapters/memory/` |
| Adaptador A2A | Expone/consume el arnés como agente A2A | `src/adapters/a2a/` |

Detalle completo de bloques, interfaces, escenarios de ejecución, decisiones de diseño (ADRs) y riesgos: [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md).

## Stack técnico

| Decisión | Elección |
| --- | --- |
| Lenguaje | TypeScript sobre Node.js |
| Motor de agentes | Claude Agent SDK (Anthropic) |
| Interfaz | TUI vía Ink |
| Base de conocimiento | Obsidian, indexado con Graphify (vía servidor MCP propio) |
| Comunicación entre agentes | Protocolo A2A (JSON-RPC) |
| Persistencia | SQLite embebido, sin servidor |

## Hoja de ruta

Entrega incremental en tres hitos mayores, cada uno cerrando con un tag semántico y una carpeta `docs/progreso/vX.Y-nombre/`:

| Versión | Hito | Caso(s) de uso | Entregable |
| --- | --- | --- | --- |
| v1.0.0 | Esqueleto conversacional | — (fundación) | El agente conversa por TUI y recuerda el historial de la sesión |
| v1.1.0 | Consulta de conocimiento | Consulta de política interna, onboarding | Responde con fuente citada del vault |
| v1.2.0 | Bot de revisión de PRs | Revisión de PRs, incidentes de IT | Un PR real dispara revisión automática; el tablero se actualiza solo |
| v1.3.0 | Ventas y comisiones | Confirmación de venta, soporte, reembolsos | Cliente confirma por web; reporte comparativo mensual |
| v2.0.0 | Delegación a subagentes | Bot de PRs con roles separados, HITL | Delegación interna entre roles |
| v2.1.0 | Comunicación A2A saliente | Incidente coordinado, KPIs, riesgo/crédito | El agente delega en un agente externo |
| v3.0.0 | Comunicación A2A entrante | Arnés invocable desde otras áreas | Cierra el objetivo específico 7 por completo |

Plan detallado hito por hito, con estructura de datos, integraciones concretas y conceptos transversales: [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md).

## Documentación

| Documento | Contenido |
| --- | --- |
| [`docs/ARC42_Harness_Empresarial.md`](docs/ARC42_Harness_Empresarial.md) | Arquitectura completa (arc42): metas de calidad, restricciones, vista de bloques, vista de ejecución, vista de despliegue, ADRs, riesgos y deuda técnica |
| [`docs/Plan_Implementacion_Harness_Empresarial.md`](docs/Plan_Implementacion_Harness_Empresarial.md) | Plan de implementación por hitos, con casos de uso empresariales y entregables verificables |

## Stakeholders

| Rol | Contacto |
| --- | --- |
| Tutor Empresarial | Alexander Ramirez — ar@conectados.ai |
| Desarrollador | Jimmy Fung — jimmyfung14@gmail.com |
