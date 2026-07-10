import React, { useEffect, useState } from 'react';
import { RefreshCw, Play, CheckCircle, Cpu, MapPin } from 'lucide-react';
import api from '../utils/api';
import { generateMockData, generateSensorWindows } from '../utils/mockGenerator';
import { reverseGeocode } from '../utils/geocode';

// Shows the human-readable address for a coordinate, with the raw lat/lng as a
// subtitle. The address is fetched lazily (and cached) via OpenStreetMap Nominatim.
const LocationCell = ({ latitude, longitude }) => {
  const [state, setState] = useState({ address: null, loading: true });
  const { address, loading } = state;

  useEffect(() => {
    let active = true;
    reverseGeocode(latitude, longitude).then((addr) => {
      if (active) setState({ address: addr, loading: false });
    });
    return () => { active = false; };
  }, [latitude, longitude]);

  return (
    <div className="flex items-start space-x-2">
      <MapPin size={16} className="text-slate-400 mt-0.5 shrink-0" />
      <div>
        <div className="text-sm text-slate-700">
          {loading ? (
            <span className="text-slate-400">Resolving address…</span>
          ) : (
            address || <span className="text-slate-400">Address unavailable</span>
          )}
        </div>
        <div className="text-xs font-mono text-slate-400">
          {latitude.toFixed(5)}, {longitude.toFixed(5)}
        </div>
      </div>
    </div>
  );
};

const AdminPanel = () => {
  const [tickets, setTickets] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const fetchTickets = async () => {
    try {
      setLoading(true);
      const res = await api.get('/tickets');
      setTickets(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleStatusUpdate = async (id, newStatus) => {
    try {
      await api.put(`/tickets/${id}`, { status: newStatus });
      fetchTickets(); // refresh list
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateMock = async () => {
    setGenerating(true);
    await generateMockData();
    await fetchTickets();
    setGenerating(false);
  };

  const handleSimulateSensor = async () => {
    setSimulating(true);
    setLastResult(null);
    const results = await generateSensorWindows(6); // send 6 synthetic windows
    const detected = results.filter(r => r.type && r.type !== 'Smooth');
    setLastResult(`Sent 6 windows → ${detected.length} anomalies detected`);
    await fetchTickets();
    setSimulating(false);
  };

  const filteredTickets = tickets.filter(t => filter === 'all' ? true : t.status === filter);

  return (
    <div className="p-8 h-full flex flex-col">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-800">Admin Panel</h1>
          <p className="text-slate-500 mt-1">Manage reported road conditions and tickets.</p>
        </div>
        
        <div className="flex flex-wrap gap-3">
          <button 
            onClick={fetchTickets}
            className="flex items-center space-x-2 px-4 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
          >
            <RefreshCw size={18} />
            <span>Refresh</span>
          </button>
          <button 
            onClick={handleGenerateMock}
            disabled={generating}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-70"
          >
            {generating ? <RefreshCw className="animate-spin" size={18} /> : <Play size={18} />}
            <span>Generate Mock Data</span>
          </button>
          <button
            onClick={handleSimulateSensor}
            disabled={simulating}
            className="flex items-center space-x-2 px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-70"
            title="Sends synthetic MPU6050 windows through the Signal Processing Engine"
          >
            {simulating ? <RefreshCw className="animate-spin" size={18} /> : <Cpu size={18} />}
            <span>Simulate Sensor Windows</span>
          </button>
        </div>
      </div>

      {lastResult && (
        <div className="mb-4 px-4 py-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl flex items-center space-x-2">
          <Cpu size={16} />
          <span>{lastResult}</span>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 flex-1 overflow-hidden flex flex-col">
        <div className="p-4 border-b border-slate-200 flex space-x-2">
          {['all', 'pending', 'in_progress', 'resolved'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition-colors ${
                filter === f 
                  ? 'bg-slate-800 text-white' 
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-500">Loading tickets...</div>
          ) : filteredTickets.length === 0 ? (
            <div className="p-8 text-center text-slate-500">No tickets found.</div>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600 text-sm">
                  <th className="p-4 font-medium">Ticket ID</th>
                  <th className="p-4 font-medium">Type</th>
                  <th className="p-4 font-medium">Location</th>
                  <th className="p-4 font-medium">Reports</th>
                  <th className="p-4 font-medium">Status</th>
                  <th className="p-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredTickets.map(ticket => (
                  <tr key={ticket._id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="p-4 text-sm font-mono text-slate-500">{ticket._id.substring(ticket._id.length - 8)}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        ticket.issue_type === 'pothole' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ticket.issue_type}
                      </span>
                    </td>
                    <td className="p-4">
                      <LocationCell
                        latitude={ticket.location_center.latitude}
                        longitude={ticket.location_center.longitude}
                      />
                    </td>
                    <td className="p-4 text-sm font-medium text-slate-700">
                      {ticket.number_of_reports}
                    </td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${
                        ticket.status === 'resolved' ? 'bg-emerald-100 text-emerald-800' :
                        ticket.status === 'in_progress' ? 'bg-blue-100 text-blue-800' :
                        'bg-slate-100 text-slate-800'
                      }`}>
                        {ticket.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="p-4 text-right">
                      {ticket.status !== 'resolved' && (
                        <div className="flex justify-end space-x-2">
                          {ticket.status === 'pending' && (
                            <button 
                              onClick={() => handleStatusUpdate(ticket._id, 'in_progress')}
                              className="text-xs px-3 py-1 bg-blue-50 text-blue-600 hover:bg-blue-100 rounded-md font-medium transition-colors"
                            >
                              Start Progress
                            </button>
                          )}
                          <button 
                            onClick={() => handleStatusUpdate(ticket._id, 'resolved')}
                            className="text-xs px-3 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-md font-medium transition-colors flex items-center space-x-1"
                          >
                            <CheckCircle size={14} />
                            <span>Resolve</span>
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminPanel;
