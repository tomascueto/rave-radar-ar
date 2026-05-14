# ADR-002: Selección de base de datos vectorial — Qdrant vs pgvector

**Estado:** Aceptado  
**Fecha:** Mayo 2025  
**Autor:** Tomás Cueto Osácar  

---

## Contexto

El sistema Rave Radar AR requiere almacenar y consultar embeddings de eventos 
musicales para implementar búsqueda semántica. Cuando un usuario realiza una 
consulta en lenguaje natural ("quiero algo de techno este finde cerca de mí"), 
el sistema convierte esa consulta en un vector numérico y busca los eventos 
más similares semánticamente en la base de datos.

Se evaluaron dos alternativas para esta funcionalidad:

1. **pgvector**: extensión de PostgreSQL que agrega soporte nativo para 
   vectores en la base de datos relacional ya utilizada en el proyecto.
2. **Qdrant**: base de datos vectorial dedicada, diseñada específicamente 
   para búsqueda por similitud semántica.

---

## Decisión

Se adopta **Qdrant** como base de datos vectorial del sistema.

---

## Alternativas consideradas

### pgvector

**Ventajas:**
- Elimina un contenedor de infraestructura (todo en PostgreSQL).
- Permite queries híbridas: semánticas + relacionales en una sola sentencia SQL.
- Menor complejidad operativa para un proyecto unipersonal.
- Suficiente para el volumen de datos esperado (miles de eventos).

**Desventajas:**
- Indexado HNSW menos optimizado que Qdrant para alta dimensionalidad.
- Escala peor ante millones de vectores.
- Funcionalidades de filtrado y payload menos avanzadas.
- Menor valor de aprendizaje desde el punto de vista de herramientas 
  modernas de la industria.

### Qdrant

**Ventajas:**
- Base de datos construida específicamente para vectores con índices HNSW 
  optimizados.
- Soporta filtros híbridos (semántico + metadata) en una sola consulta.
- Figura en el Thoughtworks Tech Radar 2025 como tecnología en ascenso, 
  con alta demanda en el mercado laboral.
- Separación explícita de responsabilidades: PostgreSQL maneja datos 
  estructurados, Qdrant maneja datos vectoriales.
- Payloads enriquecidos por vector (se puede almacenar metadata junto 
  al embedding).

**Desventajas:**
- Agrega un contenedor adicional a la infraestructura Docker.
- Requiere sincronización entre PostgreSQL y Qdrant al insertar eventos.
- Curva de aprendizaje adicional.

---

## Consecuencias

### Positivas
- El diseño arquitectónico queda más claro: cada base de datos tiene una 
  responsabilidad única y bien definida (Single Responsibility).
- Se adquiere experiencia con una herramienta moderna y demandada en la industria.
- El sistema está preparado para escalar si el volumen de eventos crece 
  significativamente.

### Negativas / Riesgos
- Se debe implementar un mecanismo de sincronización en el Scraper: 
  al insertar un evento en PostgreSQL, se debe generar su embedding y 
  cargarlo en Qdrant en la misma operación.
- Si Qdrant falla, la búsqueda semántica no está disponible aunque 
  PostgreSQL siga funcionando. Mitigación: el sistema puede degradar 
  gracefully mostrando resultados por filtros tradicionales.

---

## Referencias

- Qdrant documentation: https://qdrant.tech/documentation/
- pgvector GitHub: https://github.com/pgvector/pgvector
- Thoughtworks Tech Radar Vol. 31: https://www.thoughtworks.com/radar
- Lewis et al. (2020) — RAG paper original: https://arxiv.org/abs/2005.11401
