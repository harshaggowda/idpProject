import React, { useEffect, useState } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import api from '../utils/api';

const StatCard = ({ title, value, icon, colorClass }) => (
  <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 flex items-center space-x-4 transition-transform hover:-translate-y-1 duration-300">
    <div className={`p-4 rounded-xl ${colorClass}`}>
      {icon}
    </div>
    <div>
      <p className="text-sm font-medium text-slate-500">{title}</p>
      <h3 className="text-3xl font-bold text-slate-800 mt-1">{value}</h3>
    </div>
  </div>
);

const Dashboard = () => {
  const [stats, setStats] = useState({
    totalPotholes: 0,
    totalHumps: 0,
    activeTickets: 0,
    resolvedTickets: 0
  });
  const [loading, setLoading] = useState(true);

  const fetchStats = async () => {
    try {
      const response = await api.get('/tickets/stats');
      setStats(response.data);
    } catch (error) {
      console.error("Error fetching stats", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 5000); // Auto-refresh every 5s
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Loading dashboard...</div>;
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-800">Overview Dashboard</h1>
        <p className="text-slate-500 mt-2">Real-time statistics of road conditions.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard 
          title="Total Potholes" 
          value={stats.totalPotholes} 
          icon={<AlertCircle size={28} className="text-red-600" />} 
          colorClass="bg-red-50"
        />
        <StatCard 
          title="Speed Breakers" 
          value={stats.totalHumps} 
          icon={<AlertTriangle size={28} className="text-amber-600" />} 
          colorClass="bg-amber-50"
        />
        <StatCard 
          title="Active Tickets" 
          value={stats.activeTickets} 
          icon={<Clock size={28} className="text-blue-600" />} 
          colorClass="bg-blue-50"
        />
        <StatCard 
          title="Resolved Tickets" 
          value={stats.resolvedTickets} 
          icon={<CheckCircle2 size={28} className="text-emerald-600" />} 
          colorClass="bg-emerald-50"
        />
      </div>

      <div className="mt-12 bg-white rounded-2xl shadow-sm border border-slate-100 p-8 text-center">
        <h3 className="text-xl font-semibold text-slate-700 mb-4">System Status</h3>
        <div className="inline-flex items-center space-x-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span>Monitoring active and receiving data</span>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
