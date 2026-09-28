import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container) {
  if (!container) return [];
  // offsetParent es null en elementos display:none o sus ancestros -- filtra
  // por ejemplo los inputs de un <form> de AuthModal que no esta activo
  // (mode !== "login"), que siguen en el DOM pero ocultos.
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(
    (el) => el.offsetParent !== null
  );
}

// Unica pieza de accesibilidad de dialogo modal para toda la app --
// AuthModal, GenreSurvey, UserPanel y SavedEvents comparten identico
// gap (sin esto: el foco se escapa al contenido de atras con Tab, nada
// mueve el foco al abrir, Escape no hace nada, cerrar no devuelve el
// foco a quien abrio el modal, y no hay role/aria-modal para lectores
// de pantalla), asi que se resuelve una sola vez aca en vez de 4 veces
// iguales. Un hook, no un <ModalShell>, porque cada modal tiene su
// propia estructura interna (form, tabs, grilla) y lo unico que
// necesitan compartir es comportamiento atado a un ref, no markup.
export function useModalA11y({ onClose, titleId }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    // Quien tenia el foco antes de abrir (tipicamente el boton que
    // dispara el modal) -- se lo devuelve al cerrar en el cleanup.
    const previouslyFocused = document.activeElement;
    const dialog = dialogRef.current;

    // Foco al contenedor del dialogo, no al primer control -- con 4
    // layouts distintos (login con 2 campos, generos con una grilla de
    // chips, tabs de cuenta, grilla de tarjetas) no hay un "primer campo
    // logico" comun, y saltar directo a el podria ser al boton de cerrar
    // en mas de uno. tabIndex=-1 en el div (ver className abajo) lo hace
    // enfocable por JS sin meterlo en el orden normal de Tab.
    dialog?.focus();

    function handleKeyDown(e) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;

      const focusables = getFocusable(dialog);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Ciclo manual: si Shift+Tab esta en el primero (o el foco se salio
      // del dialogo por algun otro medio), vuelve al ultimo: y viceversa
      // al final. Es lo que faltaba -- sin esto Tab sigue el orden normal
      // del documento y termina en el contenido de atras.
      if (e.shiftKey) {
        if (document.activeElement === first || !dialog.contains(document.activeElement)) {
          e.preventDefault();
          last.focus();
        }
      } else if (document.activeElement === last || !dialog.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      // Puede haber desaparecido (ej. el boton de corazon del navbar que
      // abrio "Eventos guardados" sigue ahi, pero por las dudas si algo
      // se desmonto).
      if (previouslyFocused && document.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
  }, [onClose]);

  return {
    dialogRef,
    dialogProps: {
      role: "dialog",
      "aria-modal": true,
      "aria-labelledby": titleId,
      tabIndex: -1,
    },
    // En el div de fondo (el "fixed inset-0 bg-black/60"), no en el panel
    // -- comparar target===currentTarget es lo que distingue "clickeaste
    // el fondo" de "el click en el panel burbujeo hasta aca", sin
    // necesitar un stopPropagation en cada elemento interno del panel.
    backdropProps: {
      onClick: (e) => {
        if (e.target === e.currentTarget) onClose();
      },
    },
  };
}
