import { MapContainer, TileLayer, GeoJSON } from "react-leaflet";
import geoData from "../assets/world-adm1.geojson";

import "leaflet/dist/leaflet.css";

export function MapView() {
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      style={{
        width: "100%",
        height: "100vh"
      }}
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <GeoJSON data={geoData as any} />
    </MapContainer>
  );
}