# 🎧 Rave Radar AR

**Motor de recomendación de eventos de música electrónica con Inteligencia Artificial**

Proyecto Final de Carrera — Ingeniería en Sistemas de Información  
Universidad Nacional del Sur — DCIC  
Alumno: Tomás Cueto Osácar (L.U. 118781)  
Director: Dr. Martín L. Larrea

---

## ¿Qué es Rave Radar AR?

Rave Radar AR es una plataforma web que centraliza eventos de música electrónica de múltiples fuentes en Argentina, los muestra en un mapa interactivo geolocalizado y utiliza Inteligencia Artificial para recomendar eventos personalizados según los gustos e historial de cada usuario.

El usuario puede consultar en lenguaje natural —*"quiero algo de techno este finde cerca de donde estoy"*— y recibir recomendaciones concretas con links directos a las ticketeras originales.

---

## Problema que resuelve

La información sobre eventos electrónicos en Argentina está fragmentada en plataformas como Jodify, Passline, Bombo y Resident Advisor. Ninguna de ellas ofrece recomendación personalizada ni búsqueda semántica. Este proyecto construye la capa de inteligencia que falta.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Scraping | Python · Playwright · BeautifulSoup |
| Base de datos | PostgreSQL · PostGIS |
| Vector DB | Qdrant |
| Embeddings | OpenAI text-embedding-3-small |
| LLM | Claude API / GPT-4o |
| Orquestación IA | LangChain · LangGraph |
| Herramientas agente | MCP (Model Context Protocol) |
| Backend API | FastAPI |
| Frontend | React · TailwindCSS · Leaflet.js |
| Infraestructura | Docker · Docker Compose |
| Testing | pytest · RAGAS |

---

## Arquitectura del sistema

```
Playwright / BeautifulSoup
         ↓
PostgreSQL + PostGIS  →  Embeddings + Qdrant
                                  ↓
                         LangChain + LangGraph + MCP
                                  ↓
                              FastAPI
                                  ↓
                         React + Leaflet.js
```

---

## Fuentes de datos

- [Jodify](https://www.jodify.com.ar) — agenda especializada en electrónica AR
- [Passline](https://www.passline.com) — ticketera nacional
- [Resident Advisor](https://ra.co/events/ar) — cobertura internacional
- [Bombo](https://wearebombo.com) — red social de eventos electrónicos

---

## Documentación

- 📄 [Informe del proyecto (Google Docs)](https://docs.google.com/document/d/1L77MrmeW4SpiUaYWpEaiw2T9DTEgPAV4BJdXnOopkq0/edit?usp=sharing)
- 📋 [Tablero de tareas (GitHub Projects)](https://github.com/users/tomascueto/projects/1/views/1)
- 📁 [Documento de Visión v1.0](./docs/vision.md)

---

## Estado del proyecto

| Fase | Estado |
|------|--------|
| Propuesta aprobada por el DCIC | ✅ Completo |
| Documento de Visión | ✅ Completo |
| Arquitectura y diseño | 🔄 En curso |
| Pipeline de datos (scrapers) | ⏳ Pendiente |
| Pipeline RAG | ⏳ Pendiente |
| Agente conversacional | ⏳ Pendiente |
| Frontend | ⏳ Pendiente |
| Testing y evaluación | ⏳ Pendiente |

---

## Cómo correr el proyecto localmente

> *Instrucciones disponibles una vez configurado el entorno Docker.*

```bash
# Próximamente
git clone https://github.com/[TU_USUARIO]/rave-radar-ar
cd rave-radar-ar
docker-compose up
```

---

## Licencia

Proyecto académico — Universidad Nacional del Sur, 2025.
