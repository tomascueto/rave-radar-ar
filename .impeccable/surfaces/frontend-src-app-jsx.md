---
version: 1
slug: "frontend-src-app-jsx"
primary_target: "frontend/src/App.jsx"
related_targets: []
---

# Surface: LandingPage (frontend/src/App.jsx)

Scope: solo el componente `LandingPage` (pantalla de bienvenida antes de `onEnter`). Modo: Persuade — el visitante debe entender en segundos que esto es una fiesta, no un dashboard, y presionar el CTA.

Audiencia / job: raver argentino decidiendo si entra a la app en el momento de abrirla. Acción: presionar "Encontrá tu fiesta" → `onEnter()`.

Contrato intocable: `function LandingPage({ onEnter })`, el botón dispara `onEnter` sin cambios de firma. El resto de `App.jsx` (incluido el flujo de auth, mapa, chat) no se toca.

Constraints: mismo proveedor de tiles CARTO (`TILE_URL`, `VITE_CARTO_API_KEY`) que ya usa `Map.jsx`, vía un `MapContainer` de Leaflet no interactivo (`dragging`, `zoomControl`, `scrollWheelZoom` en `false`) detrás del contenido, con blur CSS. Sin assets ni fotos reales de eventos/DJs (no hay ninguno en Evidence on Hand de PRODUCT.md) — cualquier imaginería es sintética/gráfica, no fotográfica.

## Direction contract

THESIS: La pantalla de entrada deja de ser un splash genérico (fondo blanco, título, botón) y se convierte en el objeto que el usuario under ya conoce de memoria: el flyer fotocopiado/risografiado de una fiesta electrónica. Rechaza el arreglo por defecto de landing SaaS (hero centrado, gradiente prolijo, el mismo layout de cualquier categoría) — ver canonCard descartado en la ronda de decisión.

OWN-WORLD: Fondo casi negro (#0B0B10, tono tóner nocturno). Violeta Eléctrico (#7C3AED) heredado del sistema, actuando acá como tinta spot de riso — sigue siendo el único acento de marca (The One Accent Rule se respeta). Un segundo spot ocasional, rosa flúo (#FF3D81), reservado exclusivamente para el signo de exclamación / el acento de urgencia del talón — nunca decorativo en otro lado. Blanco papel (#F5F1E6) para cuerpo de texto y halftone. Tipografía display grande, estilo recorte pegado (mixed case, tracking apretado, gran presencia); cuerpo/tagline en una face condensada limpia, como el "texto chico" del flyer. Mapa CARTO de fondo, blureado y duotonado hacia negro/violeta — nunca a todo color — como el inserto fotocopiado "cómo llegar". Capa de halftone sutil sobre todo el frame. Raises heredados de la ronda: un solo gesto diagonal fuerte organiza la composición (de curved-crease-shell); el hairline que separa título de tagline se dibuja con precisión de regla (de reference-setting-page); el halftone tiene un shimmer óptico muy sutil al cargar (de riley-moire-gallery); el CTA respira con un bloom suave al aparecer (de phosphor-terminal); el CTA banda su microcopy como una etiqueta corta con fecha implícita ("esta noche", de pickling-brine-calendar).

STORY: El visitante entiende en un segundo que hay algo esta noche, que es under, que es real — no un template de SaaS. Cree que el proyecto tiene criterio propio. Acción única: tocar el botón-talón para entrar.

FIRST VIEWPORT: Pantalla completa (100dvh). Mapa CARTO centrado en Buenos Aires de fondo, blureado (~14px) y duotonado hacia negro/violeta; capa de halftone encima. Centrado vertical: título grande estilo recorte ("¡Bienvenido a Rave Radar AR!" o variante que incorpore el signo de exclamación con naturalidad de flyer), un hairline preciso, una tagline corta de una línea, y el botón-talón (forma con corte/dentado, violeta sólido, texto "Encontrá tu fiesta") con el bloom sutil al aparecer. Entrada animada tipo "barrido de fotocopiadora" revelando el contenido de arriba hacia abajo.

FORM: Dirección propia #6 ("El Flyer Xerografiado") de la lista de 7 sistemas visuales del mundo cultural de la audiencia (flyer fotocopiado, lista de puerta, estampa UV, cartel de puerta, VU meter de cabina, scope de radar, dial de radio pirata). Asignada por el sorteo, seed key `7d2ebe14`. Challenger competitivo considerado y no elegido: "La Cola del Cracktro" (demoscene). Pick propio no elegido: "El Cartel de la Puerta".

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.
