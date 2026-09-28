import { EventCard } from "./Map";
import { useModalA11y } from "./useModalA11y";

// Modal propio para "Eventos guardados" -- antes era una pestaña mas
// adentro de UserPanel ("Tu cuenta"), pero guardar/sacar eventos es una
// accion mucho mas frecuente que editar perfil o seguridad, asi que
// ahora tiene su propio acceso directo (icono de corazon en el Navbar,
// mismo lenguaje que guardar un post en Instagram) en vez de estar
// escondida atras de una pestaña generica.
//
// No hace ningun fetch propio -- savedEvents/loading/isGuest vienen
// resueltos por useSavedEvents (via App.jsx), la unica pieza que sabe si
// hay sesion o no. Disponible para invitados tambien: guardar nunca pide
// login, asi que verlos guardados tampoco.
export default function SavedEvents({
  genreWeights, savedEvents, loading, isGuest, onToggleSaved, onOpenAuth, onClose,
}) {
  const { dialogRef, dialogProps, backdropProps } = useModalA11y({
    onClose,
    titleId: "saved-events-title",
  });

  return (
    <div
      className="fixed inset-0 z-[2000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      {...backdropProps}
    >
      <div
        ref={dialogRef}
        {...dialogProps}
        className="flyer-modal flyer-pop-enter rounded-2xl max-w-2xl w-full h-[600px] max-h-[85vh] flex flex-col"
      >
        <div className="p-5 flyer-modal-border border-b flex items-center justify-between flex-shrink-0">
          <h2 id="saved-events-title" className="flyer-sans font-bold text-lg" style={{ color: "var(--flyer-paper)" }}>
            Eventos guardados
          </h2>
          <button
            onClick={onClose}
            title="Cerrar"
            aria-label="Cerrar"
            className="flyer-text-muted hover:opacity-100 text-xl leading-none transition-opacity"
            style={{ color: "var(--flyer-paper)", opacity: 0.55 }}
          >
            ×
          </button>
        </div>

        <div className="p-5 flex-1 min-h-0 overflow-y-auto">
          {isGuest && (
            <div className="flyer-sans flyer-banner-info text-sm rounded-lg px-3 py-2 mb-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>Estos eventos se guardan solo en este navegador.</span>
              <button
                onClick={onOpenAuth}
                className="font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--flyer-pink)]"
              >
                Creá una cuenta para no perderlos
              </button>
            </div>
          )}

          {loading ? (
            <p className="flyer-sans flyer-text-faint text-sm">Cargando eventos guardados...</p>
          ) : savedEvents.length === 0 ? (
            <p className="flyer-sans flyer-text-faint text-sm">
              Todavía no guardaste ningún evento. Los vas a poder guardar desde su tarjeta en el mapa.
            </p>
          ) : (
            <div className="p-1 -m-1 flex flex-wrap content-start gap-4">
              {savedEvents.map((ev) => (
                <EventCard
                  key={ev.id}
                  ev={ev}
                  genreWeights={genreWeights}
                  isSaved={true}
                  onToggleSave={() => onToggleSaved(ev.id)}
                  onRemove={() => onToggleSaved(ev.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
