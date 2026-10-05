import { useCallback, useEffect, useMemo, useState } from "react";

// Se incrusta en el JS en build-time (npm run build). Para cambiarla en prod hay que
// setear VITE_API_URL en la configuración de Vercel y volver a desplegar, no alcanza
// con cambiar el .env local.
const API_BASE = import.meta.env.VITE_API_URL;
const GUEST_KEY = "rr_guest_saved_events";

// El storage de invitado nunca es confiable (version vieja, editado a
// mano desde DevTools, storage corrupto) -- si no parsea, no es un
// array, o tiene algo que no sea string, arranca vacio en vez de romper
// la app.
function readGuestIds() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string");
  } catch {
    return [];
  }
}

function writeGuestIds(ids) {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(ids));
  } catch {
    // Storage lleno, modo privado, etc. -- el estado en memoria sigue
    // funcionando para esta pestaña, simplemente no sobrevive un F5.
  }
}

// Unica abstraccion de "eventos guardados" para toda la app -- EventCard,
// SavedEvents y el Navbar consumen esto, ninguno decide por su cuenta si
// hay sesion o no. Con sesion, guarda/lee contra la cuenta (API); sin
// sesion, contra localStorage. `events` es la lista que ya tiene cargada
// el mapa (App.jsx) -- se reusa para armar el detalle completo del
// listado de invitado sin sumar un endpoint nuevo. `isBroadView` avisa
// cuando esa lista es la mas amplia posible (mapa, filtro "Todos"): la
// poda de IDs de invitado que ya no existen (eventos pasados) SOLO corre
// ahi, para no confundir "no esta en esta vista angosta" (un filtro de
// fecha, una busqueda de chat) con "ya no existe".
export function useSavedEvents({ accessToken, events, isBroadView, eventsLoading }) {
  const isGuest = !accessToken;

  const [guestIds, setGuestIds] = useState(readGuestIds);
  const [accountIds, setAccountIds] = useState(null); // null = todavia no se sabe
  const [accountEvents, setAccountEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);

  // accountIds ?? guestIds (no isGuest ? ... : ...): justo despues de
  // loguearse, accountIds todavia no llego (o esta migrando) -- mostrar
  // guestIds mientras tanto evita un parpadeo de corazones vacios. Una
  // vez que accountIds resuelve (aunque sea un Set vacio, cuenta nueva
  // sin nada guardado), gana siempre el.
  const savedIds = useMemo(() => accountIds ?? new Set(guestIds), [accountIds, guestIds]);

  // Migracion: cuando hay sesion y quedan IDs de invitado en localStorage,
  // se suman a la cuenta (POST idempotente) y SOLO si todos confirman ok
  // se limpia el storage de invitado. Reacciona al estado (accessToken +
  // storage con contenido), no a un submit puntual -- cubre por igual
  // login por email, la vuelta de Google (redirect completo con
  // ?access_token=) y la verificacion de email (mismo mecanismo), porque
  // las tres terminan seteando accessToken en el mismo lugar (App.jsx).
  useEffect(() => {
    if (!accessToken) return;
    const idsToMigrate = readGuestIds();
    if (idsToMigrate.length === 0) return;

    let cancelled = false;
    setMigrating(true);
    Promise.all(
      idsToMigrate.map((id) =>
        fetch(`${API_BASE}/api/users/me/saved-events/${id}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        })
      )
    )
      .then((responses) => {
        if (cancelled) return;
        if (responses.every((res) => res.ok)) {
          writeGuestIds([]);
          setGuestIds([]);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setMigrating(false);
      });

    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  // IDs + listado completo de la cuenta. Se vuelve a pedir cuando termina
  // una migracion (migrating true -> false) para que lo recien migrado
  // aparezca sin esperar un F5.
  useEffect(() => {
    if (!accessToken) {
      setAccountIds(null);
      setAccountEvents([]);
      return;
    }
    if (migrating) return;

    setLoading(true);
    Promise.all([
      fetch(`${API_BASE}/api/users/me/saved-events/ids`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((res) => (res.ok ? res.json() : [])),
      fetch(`${API_BASE}/api/users/me/saved-events`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then((res) => (res.ok ? res.json() : [])),
    ])
      .then(([ids, fullEvents]) => {
        setAccountIds(new Set(ids));
        setAccountEvents(fullEvents);
      })
      .catch(() => {
        setAccountIds(new Set());
        setAccountEvents([]);
      })
      .finally(() => setLoading(false));
  }, [accessToken, migrating]);

  // Poda de storage de invitado -- solo en la vista mas amplia (ver
  // comentario arriba) y solo para SACAR ids que de verdad no aparecen
  // ahi, nunca para agregar nada. eventsLoading en true (arrancando la
  // app, o recien despues de un F5, antes de que el primer fetch del
  // mapa resuelva) tiene que frenar esto -- `events` todavia vale [] en
  // ese momento porque no llego nada, no porque de verdad no haya nada,
  // y sin este chequeo se podaba (borraba) TODO el storage de invitado
  // apenas se entraba a la app.
  useEffect(() => {
    if (!isGuest || !isBroadView || eventsLoading) return;
    const loadedIds = new Set(events.map((ev) => ev.id));
    const current = readGuestIds();
    const pruned = current.filter((id) => loadedIds.has(id));
    if (pruned.length !== current.length) {
      writeGuestIds(pruned);
      setGuestIds(pruned);
    }
  }, [isGuest, isBroadView, eventsLoading, events]);

  // eventData (el objeto completo del evento, si quien llama lo tiene a
  // mano -- EventCard siempre lo tiene) es opcional y SOLO se usa para
  // guardar uno nuevo: accountIds se actualiza optimista igual que antes,
  // pero el detalle completo (accountEvents) recien se trae del server en
  // el proximo fetch. Sin esto, un evento recien guardado no aparecia en
  // "Eventos guardados" hasta ese refetch -- ver savedEvents mas abajo,
  // que ahora filtra accountEvents por accountIds en vez de devolverlo
  // crudo, y por eso necesita que el nuevo id tenga tambien su detalle.
  const toggle = useCallback(
    (eventId, eventData) => {
      if (accessToken) {
        const wasSaved = accountIds?.has(eventId);
        setAccountIds((prev) => {
          const next = new Set(prev || []);
          if (wasSaved) next.delete(eventId);
          else next.add(eventId);
          return next;
        });
        if (!wasSaved && eventData) {
          setAccountEvents((prev) =>
            prev.some((ev) => ev.id === eventId) ? prev : [...prev, eventData]
          );
        }
        fetch(`${API_BASE}/api/users/me/saved-events/${eventId}`, {
          method: wasSaved ? "DELETE" : "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
        return;
      }

      const current = readGuestIds();
      const wasSaved = current.includes(eventId);
      const next = wasSaved ? current.filter((id) => id !== eventId) : [...current, eventId];
      writeGuestIds(next);
      setGuestIds(next);
    },
    [accessToken, accountIds]
  );

  const isSaved = useCallback((eventId) => savedIds.has(eventId), [savedIds]);

  // Se deriva de accountIds (no se devuelve accountEvents crudo) para que
  // reaccione al toggle igual que savedIds/isSaved -- son la misma fuente
  // de verdad. Antes esto devolvia accountEvents tal cual, asi que sacar
  // o agregar un evento desde el corazon actualizaba el contador (savedIds)
  // pero no esta lista, y quedaba desincronizada hasta un F5.
  const savedEvents = useMemo(() => {
    if (isGuest) return events.filter((ev) => guestIds.includes(ev.id));
    return accountEvents.filter((ev) => accountIds?.has(ev.id));
  }, [isGuest, accountEvents, accountIds, events, guestIds]);

  return { savedIds, isSaved, toggle, savedEvents, loading, isGuest, migrating };
}
