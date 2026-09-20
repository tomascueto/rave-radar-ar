# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dos perfiles con igual prioridad, ambos ravers en Argentina:

- **Descubrimiento casual**: alguien decidiendo a qué evento ir pronto (este finde, esta semana) sin un DJ o género particular en mente — navega el mapa o pregunta en lenguaje natural en el chat.
- **Seguimiento dirigido**: alguien con gustos musicales ya definidos (géneros favoritos, DJs puntuales) que quiere enterarse cuándo/dónde toca lo suyo.

Alcance geográfico: todo el país por igual, sin región prioritaria — cubre lo que las fuentes de scraping traen, no solo Buenos Aires.

## Product Purpose

Centraliza eventos de música electrónica de Argentina, dispersos en múltiples plataformas, en un mapa interactivo geolocalizado, y agrega la capa de inteligencia que ninguna fuente individual ofrece: recomendación personalizada por afinidad de género y búsqueda semántica en lenguaje natural. Éxito = el usuario encuentra un evento relevante y llega al link de compra real en la ticketera original.

## Positioning

Ninguna fuente existente (Jodify, Passline, Resident Advisor, Bombo) combina cobertura multi-plataforma, personalización y búsqueda en lenguaje natural — cada una cubre eventos, pero ninguna recomienda. El mecanismo diferencial es un pipeline RAG híbrido formalizado como agente de grafo de estado (LangGraph) que separa estrictamente lo que se puede resolver con certeza (fechas relativas, percentiles de precio, distancia real vía PostGIS, resolución de entidades vía similitud de trigramas contra la base real) de lo que genuinamente requiere lenguaje natural (segmentar la consulta del usuario, redactar la respuesta final) — nunca le pide a un LLM que adivine o calcule algo objetivamente verificable.

## Operating Context

- El usuario entra a la web app sin instalar nada: ve un mapa con eventos coloreados por afinidad y puede escribir en un chat flotante ("quiero algo de techno este finde cerca de donde estoy") o navegar/filtrar directamente.
- El login es opcional (contraseña propia o Google) y habilita: preferencias de género guardadas y editables, reordenamiento de resultados por afinidad, y permiso de geolocalización del navegador para pedidos de "cerca mío".
- Los eventos se actualizan por scraping periódico de las 4 fuentes; PostgreSQL es la fuente de verdad de disponibilidad (`is_active`), Qdrant se usa solo para la búsqueda semántica.
- Es un Proyecto Final de Carrera (Ingeniería en Sistemas de Información, UNS-DCIC, director Dr. Martín L. Larrea) — se evalúa/demuestra académicamente, todavía sin usuarios de producción reales.

## Capabilities and Constraints

- Backend: FastAPI + PostgreSQL/PostGIS + Qdrant, orquestación del pipeline RAG con LangGraph (grafo de 8 nodos, *stateless* entre turnos de conversación).
- LLM real y vigente: **Gemini 2.5 Flash** (segmentación de la consulta y redacción de la respuesta). El README todavía menciona Claude API/GPT-4o de una decisión de stack anterior — desactualizado; Gemini es lo actual.
- La interpretación de fecha relativa, precio y distancia es 100% determinística (sin LLM); la IA solo se usa para tareas genuinamente lingüísticas: segmentar texto libre, distinguir "cerca mío" de un lugar nombrado, y redactar la respuesta final.
- Distancia real solo puede calcularse cuando el pedido es sobre la posición propia del usuario y el navegador ya compartió su ubicación. Un lugar nombrado ("cerca de Viedma") todavía no se puede geocodificar — limitación conocida, pendiente.
- La respuesta del chat nunca menciona un evento fuera de la lista recuperada, y nunca ve más de 5 eventos en su contexto (evita que el modelo contradiga el conteo real).
- El mapa nunca muestra un evento sin venue o coordenadas resolubles.

## Brand Commitments

Nombre del producto: "Rave Radar AR". Sin guía de marca formal más allá del nombre y el copy ya existente en la UI (ej. CTA "Encontrá tu fiesta" en la landing).

## Evidence on Hand

- Fuentes de datos reales ya integradas: Jodify, Passline, Resident Advisor, Bombo.
- Sin testimonios, casos de estudio, prensa ni benchmarks — no fabricar ninguno.
- Documento de Visión v1.0 (`docs/vision.md`) e informe del proyecto (Google Docs, linkeado desde el README) contienen contexto adicional no volcado acá.

## Product Principles

- Nunca pedirle a un LLM que calcule o adivine algo objetivamente verificable (fecha, precio, distancia, identidad de una entidad) — la IA se reserva para lenguaje genuino.
- El sistema nunca muestra ni menciona un evento que no pueda ubicar en el mapa o que no esté realmente en la lista recuperada.
- La personalización (afinidad de género) reordena resultados, nunca los filtra ni inventa — un usuario logueado ve lo suyo más arriba, nunca ve menos.
- Preferir cortar la búsqueda con un aviso honesto ("no puedo resolver esto todavía") antes que inventar un resultado o un método que no se ejecutó.
