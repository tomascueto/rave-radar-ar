import { useState } from "react";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_CENTER, TILE_ATTRIBUTION, TILE_URL } from "./Map";

// Mismo pin violeta que el resto de la app (.flyer-pin, ver Map.jsx/
// App.jsx LandingPin) -- reproducido aca en vez de importado: makeIcon en
// Map.jsx esta atado a la logica de afinidad/color de match, que no
// aplica a un candidato de coordenadas puesto a mano por un admin.
function makeCandidateIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="flyer-pin" style="
      width:30px;height:30px;
      background:var(--flyer-violet);
      border:3px solid white;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
    "></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function ClickCapture({ onPick }) {
  useMapEvents({
    click(e) {
      onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

// Mapa chico de "clickear para elegir una coordenada" -- reusa el mismo
// setup de Leaflet que el mapa principal (mismo proveedor de tiles,
// mismo centro por default, ver Map.jsx), pero sin ninguno de sus
// controles/chrome propios: aca la unica interaccion es clickear para
// mover el marcador candidato. Nunca guarda nada por su cuenta -- eso
// vive en el boton de confirmar del modal que lo usa (ver
// EditEventModal), asi un click accidental no dispara ningun PUT/POST.
export default function AdminLocationPicker({ initialPosition, onChange, height = 280 }) {
  const [marker, setMarker] = useState(initialPosition || null);

  function handlePick(coords) {
    setMarker(coords);
    onChange(coords);
  }

  return (
    <div style={{ height }} className="rounded-xl overflow-hidden">
      <MapContainer
        center={marker || initialPosition || DEFAULT_CENTER}
        zoom={marker || initialPosition ? 15 : 12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTRIBUTION} maxZoom={20} />
        <ClickCapture onPick={handlePick} />
        {marker && <Marker position={[marker.lat, marker.lng]} icon={makeCandidateIcon()} />}
      </MapContainer>
    </div>
  );
}
