---
tags: [arnes, investigacion, vision-general]
fuente: "docs/ARC42_Harness_Empresarial.md"
---

# Visión general del arnés empresarial propio

El objetivo general del proyecto es implementar un **arnés básico con memoria compartida** para correr agentes de IA multi-turno en un ambiente empresarial, sobre el **Claude Agent SDK** y en **TypeScript/Node.js** (ver [[Node-vs-Go]] para la decisión de lenguaje).

La estrategia de solución es una **arquitectura hexagonal** (puertos y adaptadores): un núcleo de orquestación que desconoce los detalles de UI, persistencia o comunicación entre agentes, conectado a cada uno por un contrato explícito. El detalle completo de los cinco bloques (núcleo + cuatro adaptadores) está en [[Componentes-e-Interfaces]], y el contrato de mensajes entre ellos en [[Mensajes-y-Flujos]].

## Qué incluye el MVP

- **Agentes y subagentes**: registrados en `src/core/agents/`, con delegación in-process equivalente al Task/subagente nativo del SDK.
- **Comandos**: acciones o prompts predefinidos expuestos al empleado (`/reporte-comisiones`, `/ver-solicitudes-a2a`, comandos administrativos con gate de rol, etc.), en `src/core/commands/`.
- **Hooks**: funciones disparadas en puntos del ciclo de vida del turno (antes/después de una tool call, antes/después del turno completo), sobre el sistema de hooks nativo del SDK.
- **Skills**: paquetes de capacidad cargados desde `.claude/skills/<nombre>/SKILL.md`.
- **A2A**: el arnés puede actuar como servidor (agentes externos lo invocan) y como cliente (delega hacia afuera), sobre JSON-RPC — opt-in por token, sin ejercitar en el v1 lineal.
- **Memoria compartida**: estado de negocio (casos) persistido en SQLite embebido, correlacionado con las sesiones que el SDK ya gestiona internamente.

Las restricciones organizacionales (pasantía corta, un solo desarrollador, diseño antes de código, versionamiento semántico) y técnicas quedan documentadas en detalle en el ARC42 completo.

[ARC42 completo](../../docs/ARC42_Harness_Empresarial.md)
