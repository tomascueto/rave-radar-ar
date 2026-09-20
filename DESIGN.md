---
name: Rave Radar AR
description: Dos mundos visuales coexistentes — "El Mapa de Confianza" (violeta sobre blanco/slate) en ChatPanel/GenreSurvey/AuthModal, y "El Flyer Xerografiado" en LandingPage + Navbar + controles y tarjeta de evento del mapa. Anton y Courier Prime quedan exclusivos de LandingPage (+ Anton también en el wordmark del Navbar); Archivo es la tipografía sans del resto del mundo escopado (Navbar/FilterBar/EventCard), agregada tras feedback real de usuario sobre Courier Prime fuera de la landing. El color/opacidad de los pines y el punto de ubicación del usuario quedan fuera de ambos mundos. Ver el bloque de alcance al inicio de cada mundo antes de aplicar cualquier token.
colors:
  violet-electric: "#7C3AED"
  violet-electric-deep: "#6D28D9"
  violet-mist: "#F5F3FF"
  violet-whisper: "#DDD6FE"
  violet-focus: "#8B5CF6"
  surface: "#FFFFFF"
  ink: "#1E293B"
  ink-muted: "#64748B"
  ink-faint: "#94A3B8"
  line: "#E2E8F0"
  line-strong: "#CBD5E1"
  surface-muted: "#F1F5F9"
  overlay: "rgba(0, 0, 0, 0.5)"
  affinity-strong: "#16A34A"
  affinity-mild: "#86EFAC"
  affinity-none: "#FB923C"
  location-signal: "#3B82F6"
  success-text: "#15803D"
  success-bg: "#F0FDF4"
  error-text: "#DC2626"
  error-bg: "#FEF2F2"
  precision-warning: "#D97706"
  flyer-ground: "#0B0B10"
  flyer-paper: "#F5F1E6"
  flyer-pink: "#FF3D81"
typography:
  display:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "2.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "normal"
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  flyer-display:
    fontFamily: "Anton, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 9vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.92
    letterSpacing: "-0.03em"
  flyer-mono:
    fontFamily: "Courier Prime, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "0.06em"
  flyer-sans:
    fontFamily: "Archivo, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
rounded:
  full: "9999px"
  lg: "0.5rem"
  2xl: "1rem"
  flyer-notch: "18px (clip-path diagonal corner-notch, not border-radius — see LandingPage Shapes)"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.violet-electric}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  button-primary-hover:
    backgroundColor: "{colors.violet-electric-deep}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.violet-electric}"
    rounded: "{rounded.full}"
    padding: "6px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
    padding: "8px 12px"
  chip-active:
    backgroundColor: "{colors.violet-electric}"
    textColor: "{colors.surface}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  chip-inactive:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  flyer-cta:
    backgroundColor: "{colors.violet-electric}"
    textColor: "{colors.flyer-paper}"
    typography: "{typography.flyer-mono}"
    rounded: "{rounded.flyer-notch}"
    padding: "16px 40px"
  flyer-cta-hover:
    backgroundColor: "{colors.violet-electric-deep}"
  flyer-navbar:
    backgroundColor: "{colors.flyer-ground}"
    textColor: "{colors.flyer-paper}"
  flyer-btn-solid:
    backgroundColor: "{colors.violet-electric}"
    textColor: "{colors.flyer-paper}"
    typography: "{typography.flyer-sans}"
    rounded: "{rounded.full}"
    padding: "8px 20px"
  flyer-navbar-cta:
    backgroundColor: "{colors.violet-electric}"
    textColor: "{colors.flyer-paper}"
    typography: "{typography.flyer-sans}"
    rounded: "{rounded.full}"
    padding: "10px 24px"
  flyer-ghost-btn:
    backgroundColor: "transparent"
    textColor: "{colors.flyer-paper}"
    typography: "{typography.flyer-sans}"
    rounded: "{rounded.full}"
    padding: "6px 12px"
  flyer-card:
    backgroundColor: "{colors.flyer-paper}"
    textColor: "{colors.flyer-ground}"
    typography: "{typography.flyer-sans}"
    rounded: "24px (clip-path diagonal corner-notch, top-right — see Shapes)"
    padding: "12px"
  flyer-chip:
    backgroundColor: "rgba(124, 58, 237, 0.12)"
    textColor: "{colors.violet-electric-deep}"
    typography: "{typography.flyer-sans}"
    rounded: "{rounded.full}"
    padding: "2px 8px"
---

# Design System: Rave Radar AR

> **Two coexisting worlds.** This project ships two visual systems at once, scoped by surface, not by preference:
> 1. **"El Mapa de Confianza"** — the incumbent, explicitly-provisional utilitarian system. Applies to what's left: `ChatPanel`, `GenreSurvey`, `AuthModal`, and the map's own interactive elements (pin colors/opacity, the user-location dot).
> 2. **"El Flyer Xerografiado"** — a committed, scoped visual-world direction shipped through the full new-work flow, then deliberately extended by the user to the rest of the app's persistent chrome. Applies to `LandingPage` (`frontend/src/App.jsx`), `Navbar` (`frontend/src/Navbar.jsx`), and — inside `frontend/src/Map.jsx` — `FilterBar`, the locate-me button, the loading pill, `EventCard`, and `EventDetailOverlay`'s chrome (prev/next arrows, close button, carousel index badge). Plus its supporting CSS in `frontend/src/index.css` (`.flyer-*` rules, now declared at `:root` so both worlds' files can share them) and self-hosted fonts in `frontend/src/assets/fonts/`.
>
> **Explicitly excluded from world 2, even inside `Map.jsx`:** `affinityColor()`, `NEUTRAL_COLOR`, and the `opacity` line in `makeIcon()` (the event-pin color/opacity system — real functional meaning, not a style choice) and `makeUserLocationIcon()` (the user's own blue location dot). Never restyle these under either world's language.
>
> Sections below up to and including the first **Do's and Don'ts** describe world 1 (Mapa de Confianza) and are unchanged from the incumbent record. World 2 (El Flyer Xerografiado) is documented in its own fully-scoped block starting at **"Scoped World: LandingPage + App Chrome"** near the end of this file. **Do not mix tokens across the boundary**: never apply `flyer-*` colors/fonts/shapes to `ChatPanel`, `GenreSurvey`, `AuthModal`, or the map's pin/location-dot system, and never apply the violet-on-white/rounded-everything system to the components world 2 now owns.

## Overview

**Creative North Star: "El Mapa de Confianza"**

Rave Radar AR se lee hoy como Google Maps para la noche electrónica: utilitario, familiar, sin fricción. La marca vive en un único acento violeta y en detalles funcionales (opacidad de precisión, color de afinidad), no en gestos visuales grandes. El mapa ocupa toda la pantalla; la interfaz flota encima en paneles blancos redondeados, nunca compite con él.

Esto es un estado **confirmado como provisorio**, no una identidad de marca ya decidida. La paleta (violeta + slate + blanco), la tipografía (stack de sistema, sin fuente propia) y la ausencia de dark mode son en gran parte los valores por defecto del scaffold Vite + Tailwind v4, no el resultado de una exploración de identidad deliberada. Documentar esto sirve para que trabajo futuro construya *sobre* lo que hay sin inventar reglas de marca que nadie tomó todavía — y para que una futura pasada de identidad (`/impeccable colorize`, `/impeccable typeset`, o un `new-work` de rediseño) tenga un punto de partida claro en vez de una hoja en blanco.

La única excepción confirmada a este estado provisorio es `LandingPage`, que sí pasó por una exploración de identidad deliberada y comprometida, luego extendida deliberadamente por el usuario a `Navbar` y a los controles/tarjeta de evento del mapa — ver el bloque "Scoped World: LandingPage + App Chrome" más abajo. Es una excepción de alcance, no una promoción de este mood a decisión de marca cerrada.

**Key Characteristics:**
- Un solo acento de marca (violeta) sobre blanco/slate neutro — sin secundario ni terciario todavía.
- Shell map-first a pantalla completa: no hay scroll de página, la UI flota en capas por z-index sobre el mapa.
- Componentes redondeados y de baja decoración; la jerarquía la dan el borde y la sombra suave, no el color.
- Sin dark mode, sin tipografía custom — stack sans del sistema operativo en todas partes (excepto `LandingPage`, `Navbar`, y los controles/tarjeta de evento del mapa, ver mundo escopado).
- Confirmado como provisorio: es un punto de partida funcional, no todavía una decisión de identidad.

## Colors

Sistema de un solo acento (violeta) sobre neutros, más un segundo lenguaje de color completamente separado y no decorativo: la afinidad de género en el mapa.

### Primary
- **Violeta Eléctrico** (`#7C3AED`): el único acento de marca. Botones primarios, links, burbujas de chat del usuario, estados activos (filtro seleccionado, chip de género elegido), foco de marca. Nombra la energía electrónica sin necesitar más color en la interfaz.
- **Violeta Eléctrico Profundo** (`#6D28D9`): estado hover de todo lo anterior — mismo acento, un paso más oscuro, sin cambio de forma ni sombra.
- **Bruma Violeta** (`#F5F3FF`): fondo muy claro para chips/badges secundarios (ej. géneros dentro de la tarjeta de evento).
- **Susurro Violeta** (`#DDD6FE`): borde de 1px en botones secundarios outline (ej. "Iniciar sesión" en la navbar).
- **Foco Violeta** (`#8B5CF6`): color de borde al enfocar un input — el único feedback de foco, no hay ring ni glow.

### Neutral
- **Blanco** (`#FFFFFF`): superficie de fondo para todas las tarjetas, modales, paneles y barras — el sistema no tiene una superficie "casi blanca", es blanco puro.
- **Tinta** (`#1E293B`, slate-800): texto principal, títulos.
- **Tinta Media** (`#64748B`, slate-500): texto secundario (subtítulos, metadatos).
- **Tinta Tenue** (`#94A3B8`, slate-400): texto terciario, placeholders, timestamps.
- **Línea** (`#E2E8F0`, slate-200): bordes y separadores sutiles (header/footer del panel de chat, borde inferior de la navbar).
- **Línea Firme** (`#CBD5E1`, slate-300): borde de inputs.
- **Superficie Tenue** (`#F1F5F9`, slate-100): fondo de chips inactivos y hover de filas neutras.
- **Velo** (`rgba(0, 0, 0, 0.5)`): backdrop de los modales (auth, encuesta de géneros).

### Semantic (afinidad en el mapa — no es la marca)
Un pin de evento nunca usa el violeta de marca para comunicar afinidad; usa esta escala aparte, activa solo cuando hay un usuario logueado con preferencias guardadas:
- **Afinidad Fuerte** (`#16A34A`, green-600): el evento está entre los que más coinciden con los géneros guardados.
- **Afinidad Leve** (`#86EFAC`, green-300): coincide algo, sin ser de los mejores matches.
- **Sin Afinidad** (`#FB923C`, orange-400): no coincide con ningún género preferido.
- **Señal de Ubicación** (`#3B82F6`, blue-500): pin de la posición propia del usuario — deliberadamente por fuera de la paleta violeta/verde/naranja de eventos.

### Named Rules
**The One Accent Rule.** El violeta es el único color de marca en toda la interfaz. Todo lo demás es neutro, o pertenece al lenguaje semántico de afinidad del mapa — que nunca se usa como acento decorativo fuera del mapa. **Scoped exception:** the flyer world adds one additional spot color (fluoro pink `#FF3D81`) under its own tightly-scoped rule — see "Scoped World: LandingPage + App Chrome". The exception does not apply to `ChatPanel`, `GenreSurvey`, `AuthModal`, or the map's pin/location-dot system.

## Typography

**Display Font:** system-ui, -apple-system, "Segoe UI", sans-serif (sin fuente propia cargada)
**Body Font:** el mismo stack de sistema
**Label/Mono Font:** ninguna — no hay una fuente monoespaciada en uso

**Character:** funcional y neutra por completo; toda la jerarquía viene de peso y tamaño, no de un pairing tipográfico distintivo, porque no hay ninguna fuente propia cargada todavía.

### Hierarchy
- **Display** (700, 2.25rem / text-4xl, line-height 1.2): único uso, el título de la landing ("Bienvenido a Rave Radar AR").
- **Title** (600, 1.125rem / text-lg, line-height 1.4): encabezados de modal y del panel de chat.
- **Body** (400, 0.875rem / text-sm, line-height 1.5): texto de mensajes, botones, inputs — el tamaño por defecto de casi toda la interfaz.
- **Label** (500, 0.75rem / text-xs, line-height 1.4): metadatos, timestamps, contador de seleccionados, badges de precisión.

### Named Rules
**The System Stack Rule.** Ninguna fuente propia está cargada; todo texto resuelve al stack sans por defecto del sistema operativo. Tratar esto como una decisión **sin tomar todavía**, no como una elección minimalista deliberada — no inventar una razón de marca para justificarlo hasta que una pasada de tipografía lo confirme o lo reemplace. **Scoped exception:** the flyer world self-hosts three real faces (Anton, Courier Prime, Archivo) — see "Scoped World: LandingPage + App Chrome". This does not retroactively confirm a system-wide typography decision; `ChatPanel`, `GenreSurvey`, and `AuthModal` still have none.

## Layout

Shell de una sola vista a pantalla completa (`h-screen w-screen`): no hay scroll de página, el mapa ocupa el 100% del viewport y toda la UI flota encima en capas fixed/absolute. La jerarquía espacial la define una escala de z-index explícita, no el orden del documento:

- `z-[1000]`: controles del mapa (barra de filtros centrada arriba, botón "centrar en mi ubicación" abajo a la derecha, pill de "Cargando...").
- `z-[1500]`: panel de chat flotante (abajo a la izquierda) y el overlay de detalle/carrusel de evento (centrado).
- `z-[2000]`: modales bloqueantes (login/registro, encuesta de géneros) — con backdrop de velo.
- `z-[3000]`: `LandingPage`, toma la pantalla completa hasta que el usuario entra. (Es el z-index más alto del shell; por debajo de él vive todo el sistema Mapa de Confianza, por encima nunca hay nada.)

Densidad generosa: paneles con `p-5`/`p-6`, listas con `gap-2`/`gap-3`. No hay todavía un tratamiento responsive deliberado — el panel de chat tiene un ancho fijo (`w-96`) que puede no adaptarse bien a pantallas angostas; esto es un vacío observado, no una decisión de layout confirmada.

## Elevation & Depth

El sistema usa sombra + superficie sólida, sin transparencia: toda tarjeta, panel o modal es blanco 100% opaco con `shadow-lg/xl/2xl`, nunca un fondo translúcido o glassmorphism, y los bordes son finos y poco frecuentes. Esto es lo que hay implementado hoy, pero **no está confirmado como regla vinculante todavía** — se documenta como el patrón observado, no como un Named Rule ni como un Do/Don't.

### Shadow Vocabulary (observado, no fijado como regla)
- **Flotante estándar** (`shadow-lg`: `0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)`): controles sobre el mapa (barra de filtros, botón de ubicación, burbuja de apertura del chat).
- **Flotante prominente** (`shadow-xl`: `0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)`): modales, tarjeta de evento.
- **Flotante máximo** (`shadow-2xl`: `0 25px 50px -12px rgb(0 0 0 / 0.25)`): panel de chat abierto, overlay de detalle/carrusel.

## Shapes

Todo redondea — no hay una sola esquina recta en la interfaz. Tres escalones: `rounded-full` (9999px) para cualquier elemento interactivo o en forma de píldora (botones, chips, badges, íconos circulares); `rounded-2xl` (16px) para contenedores elevados (tarjetas, modales, panel de chat); `rounded-lg` (8px) para campos de formulario y etiquetas inline pequeñas. Los bordes, cuando existen, son finos (1px, slate-200/300) y se usan con moderación — la mayoría de la separación viene de sombra y espacio en blanco, no de líneas. Los pines del mapa son el elemento verdaderamente custom del sistema: círculos perfectos con un anillo blanco de 2-3px, una ruptura deliberada respecto al pin/gota por defecto de Google Maps o Leaflet.

### Named Rules
**The No Sharp Corners Rule.** Todo elemento interactivo o contenedor redondea como mínimo a `rounded-lg` (8px); nada en la interfaz tiene una esquina recta de 90°. **Scoped exception:** the `flyer-cta` button (landing CTA + the event card's "Comprar entrada") uses an 18px diagonal corner-notch, and `EventCard` itself uses a matching 24px notch — see "Scoped World: LandingPage + App Chrome". This rule still governs everything that world doesn't own: `ChatPanel`, `GenreSurvey`, `AuthModal`, chips, inputs.

## Components

### Buttons
- **Shape:** píldora (`rounded-full`), siempre.
- **Primary:** fondo Violeta Eléctrico (`#7C3AED`), texto blanco, `font-medium`. El padding escala con la prominencia del botón, no es fijo: `px-8 py-3` en el CTA de la landing, `px-4 py-2` en la mayoría de las acciones, `px-3 py-1.5` en contextos compactos como la navbar.
- **Hover / Focus:** cambio de color sólido a Violeta Profundo (`#6D28D9`); sin cambio de sombra ni de escala.
- **Secondary / Ghost:** fondo transparente, texto Violeta Eléctrico, borde fino de 1px en Susurro Violeta (`#DDD6FE`) — usado en "Iniciar sesión" y en "Continuar con Google" (esta última en slate en vez de violeta).
- **Disabled:** fondo pasa a slate-300, cursor `not-allowed`, sin ningún otro tratamiento.

> Nota: el botón CTA de `LandingPage` (`onEnter`), el botón "Comprar entrada" de `EventCard`, y todos los botones de `Navbar` y de los controles flotantes del mapa (`FilterBar`, ubicación, flechas del carrusel) **no** usan esta especificación de Buttons — usan los componentes `flyer-*` documentados en el mundo escopado más abajo.

### Chips (géneros)
- **Style:** `rounded-full`. Activo: fondo Violeta Eléctrico + texto blanco. Inactivo: fondo Superficie Tenue (slate-100) + texto Tinta Media, hover a slate-200.
- **State:** toggle binario únicamente — no hay estado parcial ni indeterminado.

### Cards / Containers
- **Corner Style:** `rounded-2xl` (16px). **Scoped exception:** `EventCard` moved to the flyer world's notched card — see below.
- **Background:** blanco sólido, siempre (modales, panel de chat).
- **Shadow Strategy:** `shadow-xl` (modales) a `shadow-2xl` (panel de chat, overlay de carrusel) — ver Elevation & Depth.
- **Border:** ninguno en las tarjetas; 1px slate-200 solo en los separadores internos del panel de chat (header/footer).
- **Internal Padding:** generoso — `p-5`/`p-6` en modales.

### Inputs / Fields
- **Style:** borde 1px slate-300, `rounded-lg`, fondo blanco, `text-sm`.
- **Focus:** el borde cambia a Foco Violeta (`#8B5CF6`) — sin ring, sin glow, sin cambio de sombra.
- **Error / Disabled:** el error se muestra en un banner aparte (rojo-50/rojo-600) arriba del campo, nunca como borde rojo sobre el input mismo.

### Navigation
**Scoped exception:** `Navbar` moved to the flyer world in full — see "Scoped World: LandingPage + App Chrome" below. This entry is kept for the record; no component currently uses it.
- ~~Style: barra blanca de `h-14`, borde inferior 1px slate-200. Nombre del producto en `font-semibold` slate-800 a la izquierda, acciones de auth a la derecha.~~

### Map Markers (componente distintivo)
Círculos (`div` icons), no pines/gota — una ruptura deliberada respecto al marcador por defecto de Leaflet/Google Maps.
- **Color** codifica afinidad de género cuando hay un usuario personalizado (verde = coincide, naranja = no coincide); violeta neutro cuando no hay personalización.
- **Opacidad** codifica precisión de ubicación — un venue resuelto solo a nivel ciudad se dibuja al 25% de opacidad; una dirección real, 100%. La precisión nunca se comunica con color, solo con opacidad.
- **Tamaño y borde** crecen cuando el marcador es el evento activo/seleccionado.
- La posición propia del usuario usa un punto azul (`#3B82F6`) con pulso animado — intencionalmente fuera del vocabulario violeta/verde/naranja reservado para eventos.

## Do's and Don'ts

### Do:
- **Do** mantener el violeta (`#7C3AED`) como único color de marca; reservar la escala verde/naranja de afinidad exclusivamente para personalización en el mapa, nunca como acento decorativo en otro lado.
- **Do** redondear todo elemento interactivo como mínimo a `rounded-lg` (8px) — nada en esta interfaz tiene esquina recta, salvo el CTA de `LandingPage` (ver excepción escopada).
- **Do** comunicar precisión de ubicación de un pin por opacidad, nunca por color — el color está reservado para afinidad.
- **Do** mantener el mapa a pantalla completa detrás de la UI flotante; es un shell map-first, no una página con un mapa incrustado.

### Don't:
- **Don't** introducir un segundo color de marca decorativo sin pasar por una exploración de identidad deliberada — el sistema de un solo acento es una decisión confirmada, no un olvido. (`LandingPage`'s pink spot already went through that exploration and is scoped; it is not license to add more color elsewhere.)
- **Don't** dejar que Rave Radar AR se lea como una app de ticketera (Passline/Eventbrite/Resident Advisor) — anti-referencia confirmada; mantener el encuadre de mapa + conversación, no un listado/grid de eventos.
- **Don't** tratar el mood actual (blanco/slate/violeta único, tipografía de sistema) como una identidad de marca ya cerrada — está confirmado como estado provisorio, no una decisión de diseño definitiva; se espera una pasada de identidad futura que revise color, tipografía y potencialmente elevación.
- **Don't** apply any `flyer-*` token, the Anton/Courier Prime/Archivo fonts, the corner-notch shape, the pink spot color, or the dark/paper ground colors from the scoped world below to `ChatPanel`, `GenreSurvey`, `AuthModal`, or the map's pin/location-dot system — those still follow this system.

---

# Scoped World: LandingPage + App Chrome — "El Flyer Xerografiado"

> **SCOPE BOUNDARY.** This world originated on `LandingPage` alone (`frontend/src/App.jsx`, the full-screen welcome view rendered before `onEnter`), run through the full new-work flow (direction "El Flyer Xerografiado", seed `7d2ebe14`), reviewed to a `ship` verdict — see `.impeccable/review/desktop.png` and `.impeccable/review/mobile.png`. No approved comp exists (code-led build, no image generation available) — none is referenced. The user then explicitly directed its extension to the rest of the app's persistent chrome, without rerunning the direction-choice ceremony (the world was already committed; only its reach changed). It now applies to:
> - `LandingPage` (`frontend/src/App.jsx`) — unchanged from the original ship.
> - `Navbar` (`frontend/src/Navbar.jsx`) — the whole component.
> - Inside `frontend/src/Map.jsx`: `FilterBar`, the locate-me button, the loading pill, `EventCard`, and `EventDetailOverlay`'s chrome (prev/next arrows, close button, carousel index badge).
>
> Plus the supporting `.flyer-*` CSS in `frontend/src/index.css` (color tokens now declared at `:root` instead of scoped to `.flyer-landing`, specifically so `Navbar`/`Map.jsx` could reuse them) and self-hosted fonts in `frontend/src/assets/fonts/`.
>
> **Still explicitly out of scope, even inside `Map.jsx`:** `affinityColor()`, `NEUTRAL_COLOR`, and the precision-opacity line in `makeIcon()` — the event-pin color/opacity system carries real functional meaning (genre-affinity match strength, location precision) and must never be restyled under any world's language — and `makeUserLocationIcon()` (the user's own blue pulsing dot, a separate "you are here" signal). `ChatPanel`, `GenreSurvey`, and `AuthModal` were not touched and remain governed by "El Mapa de Confianza" above.

## Overview

**Creative North Star: "El Flyer Xerografiado"**

The entry screen reads as a photocopied/risograph rave flyer, not a generic SaaS splash. Near-black tóner-nocturno ground, a blurred and duotoned city map standing in for the flyer's "how to get there" insert, halftone grain over everything, a single organizing diagonal wedge, and a torn-stub CTA button — deliberately rejecting the centered-hero/clean-gradient default landing pattern.

**Key Characteristics:**
- Dark-only, single-viewport (100dvh), non-scrolling entry screen — no light variant exists or is planned for this surface.
- Reuses the app's existing violet brand ink in a new material role (riso spot color on dark ground) rather than introducing a new primary.
- One reserved second spot color (fluoro pink) used only on two literal glyphs, never decoratively.
- Two self-hosted faces (a condensed-poster display face, a typewriter/mono body face) replace the system-font stack for this surface only.
- One-shot photocopier-sweep entrance animation and a CTA glow-settle, both with `prefers-reduced-motion` fallbacks.

## Colors

### Primary (reused from the global system, new material role)
- **Violeta Eléctrico** (`#7C3AED`) / **Violeta Eléctrico Profundo** (`#6D28D9`, hover): the same brand tokens as the rest of the app, reused here as riso "spot ink" — the CTA fill, the hairline rule under the title, and the duotone gradient's warm end. This surface does not introduce a new primary; it re-contextualizes the incumbent one.

### Secondary
- **Rosa Flúo** (`#FF3D81`): a surface-only accent, reserved exclusively for the title's `¡ !` glyphs and the CTA's `:focus-visible` outline ring. Never used decoratively anywhere else on this surface, and never used outside it.

### Neutral
- **Papel** (`#F5F1E6`): paper-white for all body text, the title, and the halftone dot tint — the surface's "ink on paper" text color.
- **Tóner Nocturno** (`#0B0B10`): near-black ground for the whole surface; also the base of the diagonal-cut wedge and the duotone's cool end.

### Named Rules
**The Reserved Second Ink Rule.** Rosa Flúo (`#FF3D81`) has exactly two jobs in this world, never a third: (1) the landing title's `¡ !` glyphs — its one decorative use, and (2) the `:focus-visible` ring color for every interactive element across the whole flyer world (the landing CTA, and now `Navbar`'s buttons, `FilterBar`, the locate-me button, and the carousel arrows/close button) — a functional accessibility signal, not decoration. This is a scoped, deliberate exception to the global One Accent Rule; it does not authorize a second brand accent, decorative or otherwise, anywhere else in the app.

## Typography

**Display Font:** Anton (self-hosted `frontend/src/assets/fonts/anton-latin-400.woff2`), with `system-ui, sans-serif` fallback. Used in exactly two places: the landing title, and the `Navbar` wordmark — nowhere else, ever (user-confirmed: "linda esa tipografía pero solo para eso").
**Ticket/Mono Font:** Courier Prime, weights 400 and 700 (self-hosted `courier-prime-latin-400.woff2` / `-700.woff2`), with `ui-monospace, monospace` fallback. **`LandingPage` only** — its tagline and CTA label/microcopy.
**UI Sans Font:** Archivo, weights 400/600/700 (self-hosted `archivo-latin-400/600/700.woff2`), with `system-ui, sans-serif` fallback. Everything else this world touches: `Navbar`'s auth actions, `FilterBar`, the loading pill, the carousel index badge, and all of `EventCard`'s text (including its CTA label).

**Character:** the landing keeps its poster-cut-display-over-typewriter pairing exactly as shipped. Everywhere else, a clean workhorse grotesk (Archivo) carries the UI text — added after real user feedback that Courier Prime's typewriter voice read wrong outside the landing's flyer-paper conceit. Operate-mode surfaces (a persistent navbar, a filter bar, a card read while scanning a map) want a legible workhorse face, not a character face; Anton and Courier Prime stay reserved for where their character actually serves the object they're imitating (a poster headline, a printed ticket stub).

### Hierarchy
- **Display** (Anton 400, `clamp(2.75rem, 9vw, 6rem)`, line-height 0.92, letter-spacing -0.03em, uppercase): the landing title, "¡Bienvenido a Rave Radar AR!" — the pink glyphs are the only color break inside it.
- **Navbar wordmark** (Anton 400, `text-xl`/1.25rem, letter-spacing -0.02em, uppercase): "Rave Radar AR" — the only other place Anton appears.
- **Ticket — Tagline** (Courier Prime 400, `text-sm`/0.875rem, uppercase, tracking 0.08em, `LandingPage` only): the one-line tagline under the hairline rule.
- **Ticket — CTA label** (Courier Prime 700, `text-base`/1rem, uppercase, tracking 0.06em, `LandingPage` only): "Encontrá tu fiesta" on the landing's own entry button.
- **Ticket — CTA microcopy** (Courier Prime 400, `10px`, normal-case, 90% opacity, `LandingPage` only): "Esta noche · Argentina".
- **UI — Event name** (Archivo 700, `text-base`/1rem, uppercase, tracking wide): `EventCard`'s title line — bumped up from an earlier `text-sm` pass after user feedback that it read too small.
- **UI — Body** (Archivo 400, `text-sm`/`text-xs`): venue, date, Navbar's display-name, FilterBar labels.
- **UI — Button/label** (Archivo 600–700, `text-xs`–`text-sm`, usually uppercase except the Navbar login button, which is deliberately sentence-case for a softer read): Navbar actions, `EventCard`'s CTA and chips, the carousel badge.

### Named Rules
**The Self-Hosted-Only Rule.** All three faces (Anton, Courier Prime, Archivo) are shipped as local woff2 files in `frontend/src/assets/fonts/`, never a CDN/Google Fonts `<link>` — a real fix made during finish review after an un-self-hosted regression, extended to Archivo when it was added. Scoped to this world; `ChatPanel`, `GenreSurvey`, and `AuthModal` still deliberately load no custom font (System Stack Rule, above).
**The Two-Voice Rule.** Anton/Courier Prime (the "printed flyer" voice) and Archivo (the "screen UI" voice) never mix inside the same component. `LandingPage` speaks only the first voice; `Navbar`'s wordmark is the one Anton exception inside an otherwise Archivo component; `EventCard` and the map's floating chrome speak only Archivo — including `EventCard`'s CTA, which reuses `flyer-cta`'s shape/color but not its landing-instance font.

## Elevation & Depth

No conventional shadow vocabulary — depth here comes from a stacked flat-layer background system, not from box-shadow elevation (the CTA's glow-settle is the one shadow-like exception, treated as a one-shot motion effect, not a reusable elevation token):
- A non-interactive Leaflet `MapContainer` (same CARTO provider as the rest of the app, `TILE_URL`/`TILE_ATTRIBUTION` imported from `Map.jsx`) at a local framing constant `LANDING_MAP_CENTER = [-34.5951, -58.4436]`, zoom 16 — chosen empirically over three tuning rounds to keep large flat map-fill features (river, park/lake) from surviving the filter stack as a visible band.
- `grayscale(1) brightness(0.58) contrast(1.2) blur(13px)` filter on the map layer.
- A `mix-blend-mode: multiply` violet-to-ink diagonal duotone gradient (`.flyer-duotone`) over the map.
- `.flyer-diagonal-cut`: a solid-ink wedge (`clip-path` polygon, 0.62 opacity) — the surface's one deliberate organizing diagonal gesture.
- `.flyer-content-scrim`: a soft-edged vertical band (~0.62 peak opacity) — the actual, load-bearing contrast guarantee for all text on this surface, engineered independently of the map/duotone layer after a real contrast bug was found and fixed during finish review. Measured via pixel-sampling: paper-on-background runs 16.8–17.4:1 throughout the content column against a 4.5:1 floor.
- A halftone dot-grain layer (`.flyer-halftone`, `mix-blend-mode: overlay`, 0.35 opacity) with a subtle one-shot shimmer on load (`.flyer-halftone-live`).
- `.flyer-scanbar`: a one-shot photocopier-sweep entrance animation; `.flyer-cta-bloom`: a glow-settle animation on the CTA. Both honor `prefers-reduced-motion` (animation disabled, end-state styles applied statically).

## Shapes

- **CTA corner-notch** (`.flyer-cta`, `clip-path: polygon(0 0, calc(100% - 18px) 0, 100% 18px, 100% 100%, 0 100%)`): an 18px diagonal corner cut, standing in for the "torn ticket stub" silhouette. Used by the landing CTA and `EventCard`'s "Comprar entrada" — the two real purchase/conversion actions in the app. Compact utility buttons (`Navbar`'s "Iniciar sesión", `FilterBar`'s pills) deliberately do **not** get the notch — see `.flyer-btn-solid` below; the notch stays rare on purpose.
- **Card corner-notch** (`.flyer-card`, 24px, same corner): `EventCard`'s own silhouette — the card reads as a cut ticket stub, not a rounded panel. `.flyer-card-image` echoes it at 20px on the flyer photo.
- **Diagonal wedge** (`.flyer-diagonal-cut`, `LandingPage` only): the one organizing diagonal in the landing's composition (see Elevation & Depth); not a repeatable shape primitive, a singular compositional gesture — never reused on other surfaces.
- **Hairline rule**: a 1px solid Violeta Eléctrico divider (`.flyer-rule`, `w-24`, `LandingPage` only) between title and tagline — drawn with ruler precision, no texture.
- Everything else this world touches (`Navbar` buttons, `FilterBar`, the locate-me pill, carousel arrows/close/badge) stays `rounded-full`, same radius language as the rest of the app — only the two named notches above break the No Sharp Corners Rule.

## Components

### Flyer CTA (signature component)
- **Shape:** 18px diagonal corner-notch (`clip-path`, see Shapes) — not the app-wide pill/rounded scale. Shared by both instances below.
- **Fill:** Violeta Eléctrico (`#7C3AED`), text Papel (`#F5F1E6`) — shared by both instances.
- **Landing instance:** Courier Prime bold uppercase label + normal-case 10px microcopy sub-line; `px-10 py-4` padding; `scale(0.97) translateY(1px)` active state; `flyer-cta-bloom` glow-settle entrance (1.1s, delayed 0.5s, `prefers-reduced-motion`-safe).
- **`EventCard` instance ("Comprar entrada"):** Archivo bold uppercase label, no microcopy sub-line, no bloom entrance, no active-scale — a calmer, repeatable instance for a component the user scans many of, not a one-time hero moment. `py-2.5` padding.
- **Focus-visible:** 2px Rosa Flúo (`#FF3D81`) outline, 4px offset, on both instances — see the Reserved Second Ink Rule above.

### Background System (signature component, `LandingPage` only)
Described fully in Elevation & Depth: blurred/duotoned non-interactive map → diagonal ink wedge → content scrim (the real contrast guarantee) → halftone grain → one-shot scanbar sweep. Not reused elsewhere — `Navbar` and the map's floating controls use flat solid `flyer-ink`, no background-system stack.

### Navbar
- **Style:** `flyer-navbar` — solid Tóner Nocturno, 1px bottom border in Violeta Eléctrico at 45% opacity (a persistent, quieter echo of the landing's hairline rule, not the same element).
- **Wordmark:** "Rave Radar AR" set in `flyer-title` (Anton, uppercase, -0.02em tracking) at `text-xl` — the one Anton exception inside this otherwise-Archivo component; see the Two-Voice Rule.
- **Logged out:** `.flyer-navbar-cta` — solid violet pill (`rounded-full`, not notched), Archivo bold, sentence case ("Iniciar sesión", not shouted caps), a real `box-shadow` (`0 8px 20px -6px rgba(124,58,237,0.55)`, offset+blur, not a flat halo) that grows and lifts (`translateY(-1px)`) on hover. Redesigned after user feedback asking for "algo más lindo"; deliberately its own class, separate from `.flyer-btn-solid`, so `FilterBar`'s compact active pill doesn't inherit this button's extra weight.
- **Logged in:** avatar keeps `rounded-full` (a photo, not UI chrome — exempt from the shape system by design) with a thin violet border; display name and "Preferencias"/"Salir" are Archivo; the latter use `.flyer-ghost-btn` (transparent, 1px violet-45% border, violet-tinted hover fill).

### Map Chrome (`FilterBar`, locate-me button, loading pill, `EventDetailOverlay` chrome)
- **Pills/buttons:** `.flyer-pill` (dark translucent background, thin violet border, same floating-shadow values as the incumbent system's Elevation vocabulary above) or `.flyer-icon-btn`/`.flyer-badge` for circular controls and the carousel index badge. Active filter uses `.flyer-btn-solid` (the compact violet pill — not `.flyer-navbar-cta`); inactive filters use `.flyer-pill-text` (paper at 70% opacity, violet-tinted hover). All Archivo.
- **Scope reminder:** this is styling only, around the map — `makeIcon()`'s color/opacity logic and `makeUserLocationIcon()` render *inside* the Leaflet canvas and are untouched; see the SCOPE BOUNDARY note above.

### Event Card (signature component)
The one deliberately **light** surface in this world — every other component above is dark-ground. Redesigned after the first pass shipped it dark and the user asked for a light card with a bigger name and different typography; see the Two-Ground Exception below.
- **Shape:** `.flyer-card` — 24px corner-notch (top-right), unchanged from the first pass.
- **Background:** Papel (`#F5F1E6`), not Tóner Nocturno. `box-shadow: 0 25px 50px -12px rgb(0 0 0 / 0.35)` — lighter than the dark-card version, since a light card needs less shadow to separate from the live map.
- **Flyer image:** `.flyer-card-image`, 20px matching notch, `object-cover`, `h-28`.
- **Name:** `.flyer-card-ink` (solid Tóner Nocturno text) + Archivo 700, uppercase, `text-base` (1rem — up from an earlier `text-sm`/0.875rem pass per user feedback that it read too small) — still treated as lineup text, not a headline: deliberately not Anton, whose character would fight legibility on long multi-artist strings at card scale.
- **Venue / date:** `.flyer-card-ink-muted` (Tóner Nocturno at 62% opacity) + Archivo 400, normal case.
- **Genre chips:** `.flyer-chip` — violet at 12% background, 40%-opacity violet border, **Violeta Eléctrico Profundo text** (`#6D28D9` — dark enough to read on a light tint; the old paper-colored text from the dark-card pass would be nearly invisible here), `rounded-full`. Same shape/color family the user confirmed they liked in the first pass — only the text color changed, to survive the background flip.
- **Precision warning:** `.flyer-warning`, now `#92400E` (amber-800) — the earlier `#FBBF24` was tuned for the dark ground and reads too light on Papel; re-verified at 6.2:1.
- **CTA:** the `flyer-cta` component's `EventCard` instance (see above) — Archivo, no bloom, no landing-only flourishes.

### Named Rules
**The Two-Ground Exception.** `EventCard` is light (Papel); every other flyer-world surface (`LandingPage`, `Navbar`, `FilterBar`, map chrome) is dark (Tóner Nocturno). This is a confirmed, deliberate split — not drift, not two worlds fighting — because a card read while scanning a live, full-color map benefits from reading as a physical light object on that map, the way the dark landing benefits from reading as a lit screen in a dark room. Don't "fix" this into one ground color; don't add a light variant to any of the dark components, or a dark variant to `EventCard`, without new user direction.

## Do's and Don'ts

### Do:
- **Do** keep Rosa Flúo (`#FF3D81`) confined to the landing title's `¡ !` glyphs (decorative) and every flyer-world element's `:focus-visible` ring (functional) — see the Reserved Second Ink Rule.
- **Do** self-host Anton, Courier Prime, and Archivo from `frontend/src/assets/fonts/`; never load any of them from a CDN.
- **Do** keep the Two-Voice Rule: Anton/Courier Prime only on `LandingPage` (+ Anton on the `Navbar` wordmark); Archivo everywhere else this world touches.
- **Do** keep the Two-Ground Exception: `EventCard` is light (Papel); `LandingPage`/`Navbar`/map chrome are dark (Tóner Nocturno). Both are confirmed, neither is a mistake to reconcile.
- **Do** treat `.flyer-content-scrim` as load-bearing for text contrast on `LandingPage` — do not remove or weaken it independently of the duotone/map layers underneath.
- **Do** keep the diagonal-notch shape reserved for exactly two components (`flyer-cta`, `flyer-card`) — everything else in this world stays `rounded-full`, so the notch keeps reading as a deliberate signature rather than a general corner style.
- **Do** keep this world scoped to the components listed in the SCOPE BOUNDARY above — reusing any part of it on `ChatPanel`, `GenreSurvey`, or `AuthModal` is a new design decision, not an extension of this one.

### Don't:
- **Don't** apply Anton, Courier Prime, Archivo, Rosa Flúo, Tóner Nocturno (`#0B0B10`), Papel (`#F5F1E6`), or the corner-notch shape to `ChatPanel`, `GenreSurvey`, `AuthModal`, or the map's pin/location-dot system — that would silently overwrite the global Mapa de Confianza system these are scoped exceptions to.
- **Don't** use Courier Prime or Anton on `Navbar`'s auth actions, `FilterBar`, or `EventCard` — that regressed once already (real user feedback: "la tipografía de las cards, no me gustan") and was replaced with Archivo everywhere outside `LandingPage`/the wordmark.
- **Don't** add the corner-notch to any component beyond `flyer-cta` and `flyer-card` without a deliberate reason — it is a two-component signature, not a general shape option.
- **Don't** "fix" the Two-Ground Exception by making `EventCard` dark again, or any other component light — both grounds are confirmed, independently, by the user.
- **Don't** treat `LandingPage`/`Navbar`/map chrome's dark stance as evidence `ChatPanel`, `GenreSurvey`, or `AuthModal` should get a dark mode — those remain untouched, white, System Stack Rule.
- **Don't** add a third spot color to this world without going back through a deliberate identity pass — the two-ink (violet + pink) budget is as confirmed and as tight as the global One Accent Rule is everywhere else.
- **Don't** restyle `affinityColor()`, `NEUTRAL_COLOR`, the precision-opacity line in `makeIcon()`, or `makeUserLocationIcon()` under this world's language, ever — see the SCOPE BOUNDARY note at the top of this section.
