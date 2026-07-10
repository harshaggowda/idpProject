import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  FileText, Sparkles, Loader2, Copy, Check, Download,
  RefreshCw, AlertTriangle, BarChart3,
} from 'lucide-react';
import api from '../utils/api';
import { downloadReportPdf } from '../utils/reportPdf';

// ── Time-range options ──────────────────────────────────────────
const RANGES = [
  { key: '24h', label: '24 Hours' },
  { key: '7d',  label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

// ── Markdown → styled React (no typography plugin needed) ───────
const mdComponents = {
  h1: ({ node, ...p }) => <h1 className="text-2xl font-bold text-slate-800 mt-2 mb-4 pb-2 border-b border-slate-200" {...p} />,
  h2: ({ node, ...p }) => <h2 className="text-xl font-bold text-blue-700 mt-6 mb-3" {...p} />,
  h3: ({ node, ...p }) => <h3 className="text-lg font-semibold text-slate-700 mt-4 mb-2" {...p} />,
  p:  ({ node, ...p }) => <p className="text-slate-600 leading-relaxed mb-3" {...p} />,
  ul: ({ node, ...p }) => <ul className="list-disc pl-6 mb-3 space-y-1 text-slate-600" {...p} />,
  ol: ({ node, ...p }) => <ol className="list-decimal pl-6 mb-3 space-y-1 text-slate-600" {...p} />,
  li: ({ node, ...p }) => <li className="leading-relaxed" {...p} />,
  strong: ({ node, ...p }) => <strong className="font-semibold text-slate-800" {...p} />,
  hr: () => <hr className="my-5 border-slate-200" />,
  table: ({ node, ...p }) => (
    <div className="overflow-x-auto my-4">
      <table className="min-w-full text-sm border border-slate-200 rounded-lg" {...p} />
    </div>
  ),
  thead: ({ node, ...p }) => <thead className="bg-slate-50" {...p} />,
  th: ({ node, ...p }) => <th className="text-left font-semibold text-slate-700 px-3 py-2 border-b border-slate-200" {...p} />,
  td: ({ node, ...p }) => <td className="px-3 py-2 border-b border-slate-100 text-slate-600" {...p} />,
};

// ── Small stat chip for the summary strip ───────────────────────
const StatChip = ({ label, value }) => (
  <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className="text-xl font-bold text-slate-800 mt-0.5">{value}</p>
  </div>
);

const AIReport = () => {
  const [range, setRange]       = useState('24h');
  const [loading, setLoading]   = useState(false);
  const [report, setReport]     = useState(null);   // { markdown, summary, ... }
  const [error, setError]       = useState(null);
  const [copied, setCopied]     = useState(false);
  const [hasRun, setHasRun]     = useState(false);

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get('/reports/generate', { params: { range } });
      setReport(res.data);
      if (!res.data.markdown) {
        setError(res.data.message || 'AI report generation unavailable.');
      }
    } catch (err) {
      console.error('Report generation failed', err);
      setReport(null);
      setError('Could not reach the report service. Please try again.');
    } finally {
      setLoading(false);
      setHasRun(true);
    }
  };

  const handleCopy = async () => {
    if (!report?.markdown) return;
    try {
      await navigator.clipboard.writeText(report.markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — silently ignore */
    }
  };

  const handlePdf = () => {
    if (!report?.markdown) return;
    downloadReportPdf(report.markdown, {
      timeRange: report.summary?.timeRange,
      generatedAt: report.generatedAt,
    });
  };

  const s = report?.summary?.statistics;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
            <Sparkles className="text-blue-600" size={30} />
            AI Civic Report Generator
          </h1>
          <p className="text-slate-500 mt-2">
            Professional municipal road condition reports generated from aggregated analytics.
          </p>
        </div>
      </div>

      {/* ── Controls ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
        <div className="flex flex-wrap items-center gap-4 justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-500 mr-1">Time Range</span>
            <div className="inline-flex bg-slate-100 rounded-xl p-1">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  disabled={loading}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    range === r.key
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={generate}
            disabled={loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium shadow-lg shadow-blue-500/30 hover:bg-blue-700 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <><Loader2 size={18} className="animate-spin" /> Generating…</>
            ) : hasRun ? (
              <><RefreshCw size={18} /> Regenerate</>
            ) : (
              <><Sparkles size={18} /> Generate Report</>
            )}
          </button>
        </div>
      </div>

      {/* ── Loading skeleton ────────────────────────────────────── */}
      {loading && (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-slate-100 flex flex-col items-center justify-center text-center">
          <Loader2 size={40} className="animate-spin text-blue-600 mb-4" />
          <p className="text-slate-700 font-medium">Analysing road data and drafting report…</p>
          <p className="text-slate-400 text-sm mt-1">Aggregating events, then calling the AI analyst.</p>
        </div>
      )}

      {/* ── Error / AI-unavailable banner (analytics may still show) ─ */}
      {!loading && error && (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 mb-6 flex items-start gap-3">
          <AlertTriangle className="text-amber-600 shrink-0 mt-0.5" size={22} />
          <div>
            <p className="font-semibold text-amber-800">{error}</p>
            {report?.summary && (
              <p className="text-amber-700 text-sm mt-1">
                The analytics summary below is still available.
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Analytics summary strip ─────────────────────────────── */}
      {!loading && s && (
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={18} className="text-slate-400" />
            <h3 className="font-semibold text-slate-700">
              Analytics Summary · {report.summary.timeRange}
            </h3>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatChip label="Total Events"   value={s.totalEvents} />
            <StatChip label="Potholes"       value={s.potholes} />
            <StatChip label="Speed Breakers" value={s.speedBreakers} />
            <StatChip label="High Severity"  value={s.highSeverity} />
            <StatChip label="Avg Confidence" value={`${s.averageConfidence}%`} />
            <StatChip label="Hotspots"       value={report.summary.highestRiskAreas?.length ?? 0} />
          </div>
        </div>
      )}

      {/* ── Markdown report ─────────────────────────────────────── */}
      {!loading && report?.markdown && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          {/* toolbar */}
          <div className="flex items-center justify-between px-6 py-3 border-b border-slate-100 bg-slate-50">
            <div className="flex items-center gap-2 text-slate-500">
              <FileText size={18} />
              <span className="text-sm font-medium">Generated Report</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-200 transition-all"
              >
                {copied ? <><Check size={16} className="text-emerald-600" /> Copied</> : <><Copy size={16} /> Copy</>}
              </button>
              <button
                onClick={handlePdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-slate-800 hover:bg-slate-900 transition-all"
              >
                <Download size={16} /> Download PDF
              </button>
            </div>
          </div>

          {/* body */}
          <div className="p-8">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {report.markdown}
            </ReactMarkdown>
          </div>
        </div>
      )}

      {/* ── Empty state ─────────────────────────────────────────── */}
      {!loading && !hasRun && (
        <div className="bg-white rounded-2xl p-12 shadow-sm border border-slate-100 text-center">
          <div className="inline-flex p-4 rounded-2xl bg-blue-50 mb-4">
            <FileText size={32} className="text-blue-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700">No report generated yet</h3>
          <p className="text-slate-500 mt-1 max-w-md mx-auto">
            Pick a time range and click <span className="font-medium">Generate Report</span> to
            produce a professional municipal road infrastructure report.
          </p>
        </div>
      )}
    </div>
  );
};

export default AIReport;
