import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import api from '../utils/api';

// Fix for default marker icon issues in Leaflet with React
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Custom Icons
const potholeIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const humpIcon = new L.Icon({
  iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// ── Live GPS marker (blue pulsing dot) ────────────────────────────
// Uses a custom DivIcon with an inline SVG for the pulsing effect.
const gpsIcon = new L.DivIcon({
  className: '',
  html: `
    <div style="position:relative;width:24px;height:24px;">
      <div style="
        position:absolute;top:0;left:0;width:24px;height:24px;
        border-radius:50%;background:rgba(59,130,246,0.25);
        animation:gpsPulse 2s ease-in-out infinite;
      "></div>
      <div style="
        position:absolute;top:6px;left:6px;width:12px;height:12px;
        border-radius:50%;background:#3b82f6;
        border:2px solid #fff;box-shadow:0 0 6px rgba(59,130,246,0.6);
      "></div>
    </div>
  `,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  popupAnchor: [0, -14],
});

// Inject the pulse keyframes into the document once
if (typeof document !== 'undefined' && !document.getElementById('gps-pulse-style')) {
  const style = document.createElement('style');
  style.id = 'gps-pulse-style';
  style.textContent = `
    @keyframes gpsPulse {
      0% { transform:scale(1); opacity:1; }
      50% { transform:scale(1.8); opacity:0.3; }
      100% { transform:scale(1); opacity:1; }
    }
  `;
  document.head.appendChild(style);
}

const MapView = () => {
  const [events, setEvents] = useState([]);
  const [activeTickets, setActiveTickets] = useState([]);
  const [gpsPosition, setGpsPosition] = useState(null);

  // Bangalore center
  const defaultCenter = [12.9716, 77.5946];

  const fetchData = async () => {
    try {
      // Fetch events
      const eventRes = await api.get('/events');
      setEvents(eventRes.data);

      // Fetch tickets to filter out resolved events
      const ticketRes = await api.get('/tickets');
      const active = ticketRes.data.filter(t => t.status !== 'resolved');
      setActiveTickets(active);
    } catch (error) {
      console.error("Error fetching map data:", error);
    }
  };

  // ── Fetch live GPS position ─────────────────────────────────────
  const fetchGpsPosition = async () => {
    try {
      const res = await api.get('/gps/latest');
      setGpsPosition(res.data);
    } catch (error) {
      // 404 means no GPS data yet — that's fine, don't log it
      if (error.response?.status !== 404) {
        console.error("Error fetching GPS position:", error);
      }
    }
  };

  useEffect(() => {
    fetchData();
    fetchGpsPosition();
    const dataInterval = setInterval(fetchData, 5000);       // Events/tickets every 5s
    const gpsInterval  = setInterval(fetchGpsPosition, 3000); // GPS every 3s
    return () => {
      clearInterval(dataInterval);
      clearInterval(gpsInterval);
    };
  }, []);

  // Filter events: only show events that have GPS coordinates and belong to an active ticket
  const activeTicketIds = new Set(activeTickets.map(t => t._id));
  const displayEvents = events.filter(e =>
    e.latitude != null && e.longitude != null &&
    (!e.cluster_id || activeTicketIds.has(e.cluster_id))
  );

  return (
    <div className="h-full flex flex-col p-4">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-slate-800">Live Map View</h1>
        <p className="text-sm text-slate-500">Real-time visualization of road conditions.</p>
        
        <div className="flex gap-4 mt-3">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-red-600"></div>
            <span className="text-sm text-slate-600">Pothole</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-green-600"></div>
            <span className="text-sm text-slate-600">Speed Breaker</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full bg-blue-500 animate-pulse"></div>
            <span className="text-sm text-slate-600">Phone GPS</span>
          </div>
        </div>
      </div>

      <div className="flex-1 rounded-2xl overflow-hidden shadow-lg border border-slate-200 z-0">
        <MapContainer center={defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
          {/* ── Anomaly Markers ──────────────────────────────── */}
          {displayEvents.map((event) => (
            <Marker 
              key={event._id} 
              position={[event.latitude, event.longitude]}
              icon={event.type === 'pothole' ? potholeIcon : humpIcon}
            >
              <Popup>
                <div className="p-1">
                  <h3 className="font-bold text-lg capitalize mb-1">{event.type}</h3>
                  <p className="text-sm text-slate-600 mb-1">
                    Severity: <span className="font-semibold capitalize">{event.severity}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {new Date(event.timestamp).toLocaleString()}
                  </p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* ── Live GPS Position Marker ────────────────────── */}
          {gpsPosition && (
            <>
              {/* Accuracy circle */}
              {gpsPosition.accuracy && (
                <CircleMarker
                  center={[gpsPosition.latitude, gpsPosition.longitude]}
                  radius={Math.min(gpsPosition.accuracy, 50)}
                  pathOptions={{
                    color: '#3b82f6',
                    fillColor: '#3b82f6',
                    fillOpacity: 0.08,
                    weight: 1,
                    opacity: 0.3,
                  }}
                />
              )}
              <Marker
                position={[gpsPosition.latitude, gpsPosition.longitude]}
                icon={gpsIcon}
              >
                <Popup>
                  <div className="p-1">
                    <h3 className="font-bold text-lg text-blue-600 mb-1">📱 Phone GPS</h3>
                    <p className="text-sm text-slate-600">
                      Lat: <span className="font-mono font-semibold">{gpsPosition.latitude.toFixed(5)}</span>
                    </p>
                    <p className="text-sm text-slate-600">
                      Lng: <span className="font-mono font-semibold">{gpsPosition.longitude.toFixed(5)}</span>
                    </p>
                    {gpsPosition.accuracy && (
                      <p className="text-sm text-slate-600">
                        Accuracy: <span className="font-semibold">{gpsPosition.accuracy.toFixed(1)}m</span>
                      </p>
                    )}
                    <p className="text-xs text-slate-400 mt-1">
                      {gpsPosition.receivedAt
                        ? new Date(gpsPosition.receivedAt).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                </Popup>
              </Marker>
            </>
          )}
        </MapContainer>
      </div>
    </div>
  );
};

export default MapView;
