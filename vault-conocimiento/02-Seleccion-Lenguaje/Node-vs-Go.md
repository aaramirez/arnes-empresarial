---
tags: [arnes, investigacion, seleccion-lenguaje]
fuente: "docs/Investigacion Pre-proyecto/Comparacion de lenguajes.pdf"
---

# Comparación de lenguajes: Python vs TypeScript (Node.js) vs Go

El PDF fuente compara **tres** lenguajes candidatos para programar con el Claude Agent SDK — Python, TypeScript/Node.js y Go — sobre dieciséis criterios, y concluye con un candidato final explícito.

## Criterios reales de la comparación

- **SDK Claude**: nativo en Python; TypeScript tiene soporte oficial "excelente"; Go requiere adaptadores no oficiales.
- **Librerías y ecosistema de TUI**: Python usa Textual/Rich (fácil y rápido, ecosistema alto); TypeScript necesita React (ecosistema medio); Go usa Bubble Tea (ecosistema alto).
- **Concurrencia (agentes A2A)**: básica en Python, muy buena en TypeScript, excelente en Go.
- **Curva de aprendizaje**: baja en Python, media en TypeScript, media/alta en Go.
- **Despliegue empresarial**: Python requiere gestión de entornos, TypeScript requiere Node instalado, Go compila a binario único estático.
- **Rendimiento**: débil en Python, bueno en TypeScript, excelente en Go.
- **MCP**: nativa en los tres lenguajes.
- **Coherencia con el ecosistema Claude**: alta en Python y TypeScript, baja en Go.
- **Incertidumbre/riesgos del proyecto**: medio en Python y TypeScript, alto en Go.
- **Seguridad de la cadena de suministro**: medio en Python, bajo en TypeScript, alto en Go.
- **Testing**: alto en Python y TypeScript, medio en Go.
- **Telemetría/observabilidad**: alta en los tres.
- **Ecosistema de bases de datos**: alto en Python y TypeScript, medio en Go.
- **Tipado estático**: bajo en Python, alto en TypeScript y Go.
- **Habilidad del pasante con el lenguaje**: medio en Python, alto en TypeScript, bajo en Go — un criterio explícitamente humano, no solo técnico.

## Conclusión real del PDF

El documento cierra con una única línea explícita: **"Posible candidato final: TypeScript (Node.js)"**. Go queda descartado principalmente por su baja coherencia con el ecosistema Claude y la baja habilidad previa del pasante con el lenguaje, pese a ganar en rendimiento, concurrencia y despliegue (binario único estático). Esta decisión quedó luego confirmada como restricción técnica formal en `docs/ARC42_Harness_Empresarial.md`, que además descarta Go explícitamente "por falta de compatibilidad con la SDK de Claude".

## Relevancia para nuestro arnés

Esta comparación es la base directa de la restricción técnica "Lenguaje: TypeScript sobre Node.js" del ARC42 del proyecto (ver [[Vision-General]]) — no es una preferencia estética, sino la síntesis de soporte de SDK, TUI, concurrencia y la habilidad real del equipo disponible.
