import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
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

const MapView = () => {
  const [events, setEvents] = useState([]);
  const [activeTickets, setActiveTickets] = useState([]);

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

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000); // Auto-refresh
    return () => clearInterval(interval);
  }, []);

  // Filter events: only show events that belong to an active ticket, or haven't been clustered (if any)
  const activeTicketIds = new Set(activeTickets.map(t => t._id));
  const displayEvents = events.filter(e => !e.cluster_id || activeTicketIds.has(e.cluster_id));

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
        </div>
      </div>

      <div className="flex-1 rounded-2xl overflow-hidden shadow-lg border border-slate-200 z-0">
        <MapContainer center={defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          
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
        </MapContainer>
      </div>
    </div>
  );
};

export default MapView;
