import React, { useState, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMapEvents,
  GeoJSON,
  Tooltip,
} from "react-leaflet";
import L from "leaflet";
import * as turf from "@turf/turf";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import "leaflet/dist/leaflet.css";

const defaultCenter = [51.0, 10.0];

function LocationMarker({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e.latlng);
    },
  });
  return null;
}

function App() {
  const [points, setPoints] = useState([]);
  const [radius, setRadius] = useState(2500);
  const [gemeinden, setGemeinden] = useState([]);
  const [suchbegriff, setSuchbegriff] = useState("");
  const [analyse, setAnalyse] = useState([]);
  const [activeIndex, setActiveIndex] = useState(null);
  const mapRef = useRef();

  useEffect(() => {
    fetch("/gemeinden_deutschland.geojson")
      .then((res) => res.json())
      .then((data) => setGemeinden(data.features || []))
      .catch(console.error);
  }, []);

  const handleMapClick = (latlng) => {
    setPoints([...points, { latlng, radius, name: "" }]);
    setActiveIndex(points.length);
  };

  const removeMarker = (index) => {
    const updated = points.filter((_, i) => i !== index);
    setPoints(updated);
    if (index === activeIndex) {
      setAnalyse([]);
      setActiveIndex(null);
    } else if (activeIndex !== null && activeIndex > index) {
      setActiveIndex(activeIndex - 1);
    }
  };

  const handleMarkerDrag = (e, index) => {
    const newLatLng = e.target.getLatLng();
    updateMarkerCoords(index, newLatLng);
  };

  const updateMarkerCoords = (index, newLatLng) => {
    const updated = [...points];
    updated[index].latlng = newLatLng;
    setPoints(updated);
    if (index === activeIndex) startAnalyse(updated[index]);
  };

  const updateMarkerName = (index, name) => {
    const updated = [...points];
    updated[index].name = name;
    setPoints(updated);
  };

  const handleMarkerClick = (index) => {
    setActiveIndex(index);
    startAnalyse(points[index]);
  };

  const handleSuche = async () => {
    if (!suchbegriff) return;
    const coordMatch = suchbegriff.match(/\s*(-?\d+(\.\d+)?)\s*,\s*(-?\d+(\.\d+)?)/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[3]);
      const latlng = L.latLng(lat, lng);
      setPoints([...points, { latlng, radius, name: "" }]);
      setActiveIndex(points.length);
      setTimeout(() => {
        if (mapRef.current) mapRef.current.setView(latlng, 13);
      }, 100);
      return;
    }
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(
        suchbegriff
      )}&format=json&limit=1`
    );
    const data = await res.json();
    if (data.length > 0) {
      const { lat, lon } = data[0];
      const latlng = L.latLng(parseFloat(lat), parseFloat(lon));
      setPoints([...points, { latlng, radius, name: "" }]);
      setActiveIndex(points.length);
      setTimeout(() => {
        if (mapRef.current) mapRef.current.setView(latlng, 13);
      }, 100);
    }
  };

  const formatNumber = (num) =>
    typeof num === "number" ? num.toLocaleString("de-DE") : num;

  const startAnalyse = (point) => {
    if (!gemeinden.length || !point) return;
    const kreis = turf.circle(
      [point.latlng.lng, point.latlng.lat],
      point.radius / 1000,
      { steps: 64, units: "kilometers" }
    );
    const ergebnisse = [];
    gemeinden.forEach((g) => {
      try {
        const schnitt = turf.intersect(kreis, g);
        if (schnitt) {
          const schnittflaeche = turf.area(schnitt);
          const gesammt = turf.area(g);
          ergebnisse.push({
            name: g.properties.GEN || g.properties.name,
            schnittflaeche,
            gesamt: gesammt,
            anteil: schnittflaeche,
          });
        }
      } catch (e) {
        console.warn("Fehler beim Schneiden:", e);
      }
    });
    const totalSchnittflaeche = ergebnisse.reduce((sum, g) => sum + g.schnittflaeche, 0);
    const finalErgebnisse = ergebnisse.map((g) => ({
      ...g,
      schnittflaeche: Math.round(g.schnittflaeche),
      gesamt: Math.round(g.gesamt),
      anteil: ((g.schnittflaeche / totalSchnittflaeche) * 100).toFixed(2),
    }));
    setAnalyse(finalErgebnisse);
  };

  const handlePDF = async () => {
    const element = document.getElementById("karte");
    await new Promise((resolve) => setTimeout(resolve, 500));
    const canvas = await html2canvas(element);
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF();
    pdf.addImage(imgData, "PNG", 10, 10, 180, 100);
    let y = 120;
    analyse.forEach((a) => {
      pdf.text(
        `${a.name}: ${formatNumber(a.schnittflaeche)} m² (${a.anteil}%) von ${formatNumber(a.gesamt)} m²`,
        10,
        y
      );
      y += 8;
    });
    pdf.save("analyse.pdf");
  };

  const summeSchnitt = analyse.reduce((s, a) => s + a.schnittflaeche, 0);

  return (
    <div className="h-screen flex flex-col">
      <div className="p-2 bg-gray-900 text-white flex gap-2 items-center text-sm">
        <span className="font-bold text-lg mr-4">§6 EEG Map</span>
        <input
          type="number"
          value={radius}
          onChange={(e) => setRadius(Number(e.target.value))}
          className="text-black px-1 w-24 rounded"
          placeholder="Radius (m)"
        />
        <input
          value={suchbegriff}
          onChange={(e) => setSuchbegriff(e.target.value)}
          className="text-black px-1 w-64 rounded"
          placeholder="Adresse oder Koordinaten"
        />
        <button onClick={handleSuche} className="bg-black px-2 py-1 rounded">
          Suchen
        </button>
        <button onClick={handlePDF} className="bg-black px-2 py-1 rounded">
          PDF Export
        </button>
        <span>Marker: {points.length}</span>
      </div>

      <div className="relative flex-1" id="karte">
        <MapContainer
          center={defaultCenter}
          zoom={6}
          style={{ height: "100%", width: "100%" }}
          whenCreated={(map) => (mapRef.current = map)}
        >
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <LocationMarker onMapClick={handleMapClick} />
          {gemeinden.length > 0 && (
            <GeoJSON
              data={{ type: "FeatureCollection", features: gemeinden }}
              style={() => ({ color: "#333", weight: 1, fillOpacity: 0.1 })}
            />
          )}
          {points.map((p, i) => (
            <React.Fragment key={i}>
              <Marker
                position={p.latlng}
                draggable
                eventHandlers={{
                  dragend: (e) => handleMarkerDrag(e, i),
                  click: () => handleMarkerClick(i),
                }}
              >
                <Tooltip direction="bottom" offset={[0, 20]} permanent>
                  {p.name || "WKA"}
                </Tooltip>
              </Marker>
              <Circle center={p.latlng} radius={p.radius} />
            </React.Fragment>
          ))}
        </MapContainer>

        {activeIndex !== null && points[activeIndex] && (
          <div
            className="absolute top-16 right-0 text-black p-2 rounded-md shadow-md text-xs space-y-1 max-w-xs bg-gray-100"
            style={{ zIndex: 999 }}
          >
            <div className="flex flex-col gap-1 p-2 border border-gray-300 rounded">
              <input
                type="text"
                value={points[activeIndex].name || ""}
                onChange={(e) => updateMarkerName(activeIndex, e.target.value)}
                placeholder="WKA"
                className="text-xs px-1 border border-gray-400 rounded"
              />
              <input
                type="number"
                value={points[activeIndex].latlng.lat}
                step="0.0001"
                onChange={(e) =>
                  updateMarkerCoords(activeIndex, {
                    lat: parseFloat(e.target.value),
                    lng: points[activeIndex].latlng.lng,
                  })
                }
                className="text-xs px-1 border border-gray-400 rounded"
              />
              <input
                type="number"
                value={points[activeIndex].latlng.lng}
                step="0.0001"
                onChange={(e) =>
                  updateMarkerCoords(activeIndex, {
                    lat: points[activeIndex].latlng.lat,
                    lng: parseFloat(e.target.value),
                  })
                }
                className="text-xs px-1 border border-gray-400 rounded"
              />
              <div className="flex gap-1 justify-end">
                <button
                  className="bg-red-600 hover:bg-red-700 px-1 text-white rounded text-xs"
                  onClick={() => removeMarker(activeIndex)}
                >
                  Löschen
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {analyse.length > 0 && (
        <div className="p-4 bg-gray-100 text-sm overflow-x-auto">
          <table className="table-auto border border-gray-400">
            <thead>
              <tr className="bg-gray-200">
                <th className="px-2 border border-gray-400">Gemeinde</th>
                <th className="px-2 border border-gray-400">Fläche gesamt (m²)</th>
                <th className="px-2 border border-gray-400">Schnittfläche (m²)</th>
                <th className="px-2 border border-gray-400">Anteil (%)</th>
              </tr>
            </thead>
            <tbody>
              {analyse.map((a, i) => (
                <tr key={i}>
                  <td className="px-2 border border-gray-400">{a.name}</td>
                  <td className="px-2 border border-gray-400">{formatNumber(a.gesamt)}</td>
                  <td className="px-2 border border-gray-400">{formatNumber(a.schnittflaeche)}</td>
                  <td className="px-2 border border-gray-400">{a.anteil}</td>
                </tr>
              ))}
              <tr className="bg-gray-200 font-bold">
                <td className="px-2 border border-gray-400">Gesamt</td>
                <td className="px-2 border border-gray-400">-</td>
                <td className="px-2 border border-gray-400">{formatNumber(summeSchnitt)}</td>
                <td className="px-2 border border-gray-400">100.00</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default App;