import { useEffect, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Centro por defecto: CABA (ajustar si la mayoria de eventos esta en otra ciudad)
const DEFAULT_CENTER = [-34.6037, -58.3816];
const DEFAULT_ZOOM = 12;

// Tiles estilo "Uber": limpio, minimalista, sin saturacion de colores
const TILE_URL = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}";
const TILE_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, © OpenStreetMap contributors, and the GIS user community';

// Color segun la confianza real de la coordenada (campo `precision` del venue).
function markerStyle(precision) {
  switch (precision) {
    case "exact":
      return { color: "#7C3AED", radius: 9, opacity: 1 };    // violeta, pin fuerte
    case "llm_search":
      return { color: "#2DD4BF", radius: 8, opacity: 1 };    // turquesa, pin fuerte
    case "city":
    default:
      return { color: "#94A3B8", radius: 6, opacity: 0.55 }; // gris, chico, translucido
  }
}

function makeIcon(precision) {
  const { color, radius, opacity } = markerStyle(precision);
  return L.divIcon({
    className: "",
    html: `<div style="
      width:${radius * 2}px;height:${radius * 2}px;
      background:${color};opacity:${opacity};
      border:2px solid white;border-radius:50%;
      box-shadow:0 1px 4px rgba(0,0,0,0.35);
    "></div>`,
    iconSize: [radius * 2, radius * 2],
    iconAnchor: [radius, radius],
  });
}

export default function Map() {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("http://localhost:8000/api/events/map")
      .then((res) => {
        if (!res.ok) throw new Error(`API respondio ${res.status}`);
        return res.json();
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <div className="p-4 text-slate-500">Cargando eventos...</div>;
  if (error) return <div className="p-4 text-red-500">Error: {error}</div>;

  return (
    <div className="h-screen w-screen">
      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        className="h-full w-full"
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} />

        {events.map((ev) => (
          <Marker
            key={ev.id}
            position={[ev.lat, ev.lng]}
            icon={makeIcon(ev.venue_precision)}
          >
            <Popup>
              <div className="text-sm">
                <p className="font-semibold">{ev.name}</p>
                <p className="text-slate-600">{ev.venue_name}</p>
                <p className="text-slate-500">
                  {new Date(ev.date_from).toLocaleDateString("es-AR", {
                    day: "2-digit", month: "2-digit", year: "numeric",
                  })}
                </p>
                {ev.venue_precision === "city" && (
                  <p className="text-xs text-amber-600 mt-1">
                    Ubicacion aproximada (centro de la ciudad)
                  </p>
                )}
                {ev.ticket_url && (
                  <a
                    href={ev.ticket_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-violet-600 underline text-xs"
                  >
                    Comprar entrada
                  </a>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}