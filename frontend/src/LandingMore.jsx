import { useEffect, useRef, useState } from "react";

// Dibujado, no emoji -- mismo criterio que RadarIcon/HeartIcon de Map.jsx.
// Se redefine acá (en vez de importar de Map.jsx) para no acoplar esta
// seccion nueva al módulo del mapa real por un ícono.
function RadarGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.3" opacity="0.35" />
      <circle cx="12" cy="12" r="5.5" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
      <path d="M12 12L12 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    </svg>
  );
}

function ChatGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M4 5.5h16v10H9.5L5 19v-3.5H4v-10Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M7.5 9.5h9M7.5 12.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function HeartGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 20.5s-7.5-4.6-9.8-9.1C.6 8.1 1.7 4.8 5 3.7c2.1-.7 4.3.1 5.5 2 .2.3.5.3.7 0 1.2-1.9 3.4-2.7 5.5-2 3.3 1.1 4.4 4.4 2.8 7.7-2.3 4.5-9.8 9.1-9.8 9.1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Firma de movimiento de esta seccion (ver surface brief, FORM): revela
// cada bloque una sola vez al entrar en viewport, misma curva en todas
// -- una gramatica, no un efecto por bloque. Respeta prefers-reduced-motion
// mostrando el contenido ya asentado en vez de animarlo.
function Reveal({ children, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={`flyer-reveal ${visible ? "flyer-reveal-visible" : ""} ${className}`}>
      {children}
    </div>
  );
}

const FEATURES = [
  {
    icon: RadarGlyph,
    title: "Mapa en vivo, no un listado",
    body:
      "Cada pin es un evento real ubicado en el mapa -- nunca se muestra uno sin venue o coordenadas reales. Si guardaste tus géneros favoritos, el color del pin te dice de un vistazo qué tan bien coincide, antes de abrir la tarjeta. Se actualiza por scraping periódico de Jodify, Passline, Resident Advisor y Bombo.",
  },
  {
    icon: ChatGlyph,
    title: "Le preguntás como a una persona",
    body: null,
    demoLabel: "Ejemplo",
    demo: [
      { who: "vos", text: "“techno esta noche cerca mío”" },
      { who: "radar", text: "3 eventos -- ordenados por distancia real y por tus géneros guardados" },
    ],
  },
  {
    icon: HeartGlyph,
    title: "Guardá lo tuyo",
    body:
      "Iniciá sesión con tu mail o con Google, guardá eventos con un toque, y editá tus géneros favoritos cuando quieras -- reordenan resultados, nunca los ocultan.",
  },
];

const FAQ = [
  {
    q: "¿Hay que registrarse para usarlo?",
    a: "No. Podés explorar el mapa y usar el chat sin cuenta. Iniciar sesión solo suma guardar tus géneros, reordenar resultados por afinidad, y guardar eventos.",
  },
  {
    q: "¿De dónde salen los eventos?",
    a: "Se scrapean periódicamente de Jodify, Passline, Resident Advisor y Bombo -- ninguno se carga a mano.",
  },
  {
    q: "¿Cubre todo el país?",
    a: "Sí, no hay una región priorizada: se muestra lo que las fuentes traen, sea de la provincia que sea.",
  },
  {
    q: "¿La IA puede inventar un evento?",
    a: "No. El chat nunca menciona algo que no esté realmente en la base y ubicado en el mapa; si no puede resolver un pedido, te lo dice en vez de inventar.",
  },
];

// Contenido que sigue debajo del hero de LandingPage al scrollear -- ya no
// es una pagina/ruta aparte (ver App.jsx: LandingPage monta esto
// directamente despues de la seccion h-screen del hero). onEnter es la
// misma prop que ya usa el CTA del hero, asi que "entrar" desde cualquiera
// de los dos botones hace exactamente lo mismo.
export default function LandingMore({ onEnter }) {
  return (
    <div className="max-w-3xl mx-auto px-6">
      <section className="min-h-[50vh] flex flex-col justify-center gap-4 py-16">
        <h1 className="flyer-sans font-bold uppercase tracking-tight text-3xl sm:text-4xl leading-tight" style={{ color: "var(--flyer-paper)" }}>
          Más que un mapa de fiestas
        </h1>
        <p className="flyer-sans text-base sm:text-lg max-w-xl" style={{ color: "rgba(245, 241, 230, 0.75)" }}>
          Centraliza los eventos de música electrónica de Argentina que hoy están repartidos en
          varias plataformas, y le suma lo que ninguna trae sola: recomendación personalizada y
          búsqueda en lenguaje natural.
        </p>
      </section>

      <section className="flex flex-col gap-10 pb-20">
        {FEATURES.map((feature, i) => {
          const Icon = feature.icon;
          return (
            <Reveal key={feature.title} className={i % 2 === 1 ? "sm:ml-10" : "sm:mr-10"}>
              <div className="flyer-card p-6 flex flex-col gap-3 max-w-xl">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "rgba(124, 58, 237, 0.12)", color: "var(--flyer-violet-deep)" }}
                >
                  <Icon className="w-6 h-6" />
                </div>
                <h2 className="flyer-sans flyer-card-ink font-bold uppercase tracking-wide text-lg">
                  {feature.title}
                </h2>
                {feature.body && (
                  <p className="flyer-sans flyer-card-ink-muted text-sm leading-relaxed">{feature.body}</p>
                )}
                {feature.demo && (
                  <div className="flyer-sans text-sm leading-relaxed flex flex-col gap-1.5 mt-1">
                    {feature.demoLabel && (
                      <p className="flyer-card-ink-muted uppercase tracking-wide text-xs font-semibold">
                        {feature.demoLabel}
                      </p>
                    )}
                    {feature.demo.map((line, idx) => (
                      <p key={idx} className="flyer-card-ink-muted">
                        <span
                          className="font-bold uppercase tracking-wide text-xs mr-2"
                          style={{ color: "var(--flyer-violet-deep)" }}
                        >
                          {line.who}
                        </span>
                        {line.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </Reveal>
          );
        })}
      </section>

      <Reveal className="pb-20">
        <h3 className="flyer-sans font-bold uppercase tracking-wide text-xl mb-6" style={{ color: "var(--flyer-paper)" }}>
          Preguntas frecuentes
        </h3>
        <div>
          {FAQ.map((item) => (
            <div key={item.q} className="py-4" style={{ borderTop: "1px solid rgba(124, 58, 237, 0.25)" }}>
              <p className="flyer-sans font-semibold text-sm sm:text-base" style={{ color: "var(--flyer-paper)" }}>
                {item.q}
              </p>
              <p className="flyer-sans text-sm mt-1.5 leading-relaxed" style={{ color: "rgba(245, 241, 230, 0.7)" }}>
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      <Reveal className="pb-24 flex flex-col items-center text-center gap-4">
        <button
          onClick={onEnter}
          className="flyer-cta flyer-sans uppercase tracking-[0.04em] font-bold text-base px-10 py-4 transition-colors"
        >
          Encontrá tu fiesta
        </button>
      </Reveal>
    </div>
  );
}
