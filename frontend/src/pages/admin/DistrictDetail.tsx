import { useState, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import * as XLSX from 'xlsx';
import { Layout } from '@/components/layout/Layout';
import { ChartCard } from '@/components/charts/ChartCard';
import { getStackedBarOptions } from '@/components/charts/Charts';
import { DataTable, Column } from '@/components/data/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import { ComplaintsDrawer, DrawerFilters } from '@/components/common/ComplaintsDrawer';

// ─── Mini sort dropdown ─────────────────────────────────────────────────────
const CAT_SORTS = [
  { label: 'By Pending ↓', value: 'pending' },
  { label: 'By Total ↓', value: 'total' },
  { label: 'By Disposed ↓', value: 'disposed' },
  { label: 'A → Z', value: 'az' },
  { label: 'Z → A', value: 'za' },
];
const CatSortDropdown = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleMouseLeave = () => {
    if (isMobile) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 200);
  };

  const handleMouseEnter = () => {
    if (isMobile) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(true);
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button className="chart-expand-btn" title="Sort Options" onClick={handleClick}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        <span>Sort</span>
      </button>
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, backgroundColor: '#1e293b', border: '1px solid #334155', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', zIndex: 9999, minWidth: 180, padding: '4px 0' }}
          onMouseEnter={() => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }}
          onMouseLeave={() => { }}
        >
          {CAT_SORTS.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: value === opt.value ? '#60a5fa' : '#cbd5e1', fontWeight: value === opt.value ? 600 : 400, backgroundColor: value === opt.value ? 'rgba(51,65,85,0.6)' : 'transparent' }}
              onMouseEnter={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = '#334155'; }}
              onMouseLeave={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const StatCard = ({ label, value, subValue, colorClass, onClick }: { label: string; value: string | number; subValue?: string; colorClass: string; onClick?: () => void }) => (
  <div
    className={`stat-card ${colorClass}`}
    onClick={onClick}
    style={{ cursor: onClick ? 'pointer' : undefined, transition: 'transform 0.15s, box-shadow 0.15s' }}
    onMouseEnter={(e) => { if (onClick) { (e.currentTarget as HTMLElement).style.transform = 'scale(1.025)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 8px 32px rgba(0,0,0,0.35)'; } }}
    onMouseLeave={(e) => { if (onClick) { (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; } }}
    title={onClick ? 'Click to view these complaints' : undefined}
  >
    <div className="stat-card-label">{label}</div>
    <div className="stat-card-value">{value}</div>
    {subValue && <div className="text-xs mt-1 opacity-80">{subValue}</div>}
    {onClick && (
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.7, display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" />
        </svg>
        Click to view complaints
      </div>
    )}
  </div>
);

export const DistrictDetail = () => {
  const { district } = useParams<{ district: string }>();
  const navigate = useNavigate();
  const [catSort, setCatSort] = useState<string>('pending');
  const [psTableSort, setPsTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);
  const [pendencyTableSort, setPendencyTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);
  const [disposalTableSort, setDisposalTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);

  // Drawer state
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; filters: DrawerFilters }>({ open: false, title: '', filters: {} });
  const openDrawer = (title: string, drawerFilters: DrawerFilters) => setDrawer({ open: true, title, filters: drawerFilters });
  const closeDrawer = () => setDrawer(d => ({ ...d, open: false }));

  const { filters } = useFilters();
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''));

  const { data, isLoading } = useQuery({
    queryKey: ['district-analysis', district, activeFilters],
    queryFn: async () => {
      const params = new URLSearchParams(activeFilters as Record<string, string>);
      const r = await fetch(`/api/dashboard/district-analysis/${district}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      });
      return r.json();
    },
    enabled: !!district
  });

  const policeStations = data?.data?.policeStations || [];
  const rawCategories = data?.data?.categories || [];

  // Sort categories for the chart
  const categories = [...rawCategories].sort((a: any, b: any) => {
    if (catSort === 'az') return String(a.category).localeCompare(String(b.category));
    if (catSort === 'za') return String(b.category).localeCompare(String(a.category));
    if (catSort === 'total') return b.total - a.total;
    if (catSort === 'disposed') return b.disposed - a.disposed;
    return b.pending - a.pending; // default
  });

  // Aggregates — disposed = ALL records with statusGroup=disposed (with + without date)
  const totalReceived = policeStations.reduce((sum: number, ps: any) => sum + ps.total, 0);
  const totalPending = policeStations.reduce((sum: number, ps: any) => sum + ps.pending, 0);
  const totalDisposed = policeStations.reduce((sum: number, ps: any) => sum + ps.disposed, 0);
  const totalMissingDates = policeStations.reduce((sum: number, ps: any) => sum + (ps.missingDates || 0), 0);
  const totalDisposedWithDate = totalDisposed - totalMissingDates;
  const totalUnknown = policeStations.reduce((sum: number, ps: any) => sum + (ps.unknown || 0), 0);
  // Aggregate total disposal days from raw ps data using actual counts and days
  // avgDisposalDays from backend is null when no real data exists — do not treat null as 0
  const totalDisposedDays = policeStations.reduce((sum: number, ps: any) => {
    const withDate = (ps.disposed || 0) - (ps.missingDates || 0);
    return sum + (typeof ps.avgDisposalDays === 'number' ? ps.avgDisposalDays * withDate : 0);
  }, 0);
  const avgDisposalTime: number | null = totalDisposedWithDate > 0
    ? Math.round(totalDisposedDays / totalDisposedWithDate)
    : null;

  // ── Police Station Summary Table ──────────────────────────────────────────
  const psCols: Column<any>[] = [
    { key: 'ps', label: 'Police Station', sortable: true },
    { key: 'total', label: 'Total', sortable: true, align: 'center' },
    { key: 'disposed', label: 'Disposed', sortable: true, align: 'center' },
    { key: 'missingDates', label: 'Disposed but Date Not Found', sortable: true, align: 'center' },
    { key: 'pending', label: 'Pending', sortable: true, align: 'center' },
    { key: 'unknown', label: 'Status Not Found', sortable: true, align: 'center' },
    { key: 'u7', label: 'Within 7 Days', sortable: true, align: 'center' },
    { key: 'u15', label: 'Within 15 Days', sortable: true, align: 'center' },
    { key: 'u30', label: 'Within 30 Days', sortable: true, align: 'center' },
    { key: 'o30', label: 'Within 2 Months', sortable: true, align: 'center' },
    { key: 'o60', label: 'Over 2 Months', sortable: true, align: 'center' },
    { key: 'avgDisposalDays', label: 'Avg. Disposal (Days)', sortable: true, align: 'center' },
  ];

  const buildDrawerFilters = (psName: string, psId: string | null | undefined, statusGroup: string, extraParams: Record<string, string> = {}): DrawerFilters => {
    const f: DrawerFilters = {};
    if (filters.districtIds) f.districtIds = filters.districtIds;
    if (filters.officeIds) f.officeIds = filters.officeIds;
    if (filters.classOfIncident) f.classOfIncident = filters.classOfIncident;
    if (filters.fromDate) f.fromDate = filters.fromDate;
    if (filters.toDate) f.toDate = filters.toDate;
    if (district) f.district = district;
    if (psId) {
      f.policeStationIds = psId;
      if (psName && psName !== 'Unmapped') f.psName = psName;
    } else if (psName === 'Unmapped') {
      f.unmappedPs = 'true';
    } else if (psName) {
      f.psName = psName;
    }
    f.statusGroup = statusGroup;
    if (extraParams.pendencyAge) f.pendencyAge = extraParams.pendencyAge;
    if (extraParams.disposalAge) f.disposalAge = extraParams.disposalAge;
    return f;
  };

  const ClickableCell = ({ value, psName, psId, statusGroup, color, fw, extra, drawerTitle }: { value: any, psName: string, psId?: string | null, statusGroup: string, color?: string, fw?: any, extra?: Record<string, string>, drawerTitle?: string }) => (
    (typeof value === 'number' && value > 0) || (typeof value === 'string' && value !== '0' && value !== '0%') ? (
      <span
        onClick={(e) => { e.stopPropagation(); openDrawer(drawerTitle || `${psName} — ${statusGroup}`, buildDrawerFilters(psName, psId, statusGroup, extra)); }}
        className="hover:underline cursor-pointer"
        style={{ color, fontWeight: fw }}
      >
        {value}
      </span>
    ) : (
      <span style={{ color, fontWeight: fw }}>{value}</span>
    )
  );

  const renderPsCell = (col: Column<any>, row: any) => {
    if (col.key === 'ps') return <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.ps}</span>;
    if (col.key === 'total') return <ClickableCell value={row.total} psName={row.ps} psId={row.psId} statusGroup="all" color="#60a5fa" />;
    if (col.key === 'disposed') return <ClickableCell value={row.disposed} psName={row.ps} psId={row.psId} statusGroup="disposed" color="#4ade80" />;
    if (col.key === 'missingDates') return <ClickableCell value={row.missingDates ?? 0} psName={row.ps} psId={row.psId} statusGroup="disposed_missing_date" color="#fbbf24" />;
    if (col.key === 'pending') return <ClickableCell value={row.pending} psName={row.ps} psId={row.psId} statusGroup="pending" color="#fbbf24" />;
    if (col.key === 'unknown') return <ClickableCell value={row.unknown ?? 0} psName={row.ps} psId={row.psId} statusGroup="unknown" color="#94a3b8" />;
    if (col.key === 'u7') return <ClickableCell value={row.u7} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u7' }} color="var(--text-muted)" />;
    if (col.key === 'u15') return <ClickableCell value={row.u15} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u15' }} color="#eab308" />;
    if (col.key === 'u30') return <ClickableCell value={row.u30} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u30' }} color="#fb923c" fw={500} />;
    if (col.key === 'o30') return <ClickableCell value={row.o30} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'o30' }} color="#ef4444" fw="bold" />;
    if (col.key === 'o60') return <ClickableCell value={row.o60 || 0} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'o60' }} color="#b91c1c" fw="bold" />;
    if (col.key === 'avgDisposalDays') {
      const val = row.avgDisposalDays;
      return <span style={{ color: '#c084fc' }}>{typeof val === 'number' ? `${val}d` : '—'}</span>;
    }
    return row[col.key];
  };

  // ── Pendency Ageing Matrix (Days) ─────────────────────────────────────────
  const pendencyCols: Column<any>[] = [
    { key: 'ps', label: 'Police Station', sortable: true },
    { key: 'pending', label: 'Total', sortable: true, align: 'center' },
    { key: 'u7', label: 'Within 7 Days', sortable: true, align: 'center' },
    { key: 'u15', label: 'Within 15 Days', sortable: true, align: 'center' },
    { key: 'u30', label: 'Within 30 Days', sortable: true, align: 'center' },
    { key: 'o30', label: 'Within 2 Months', sortable: true, align: 'center' },
    { key: 'o60', label: 'Over 2 Months', sortable: true, align: 'center' },
  ];

  const renderPendencyDays = (col: Column<any>, row: any) => {
    const total = row.pending || 1;
    if (col.key === 'ps') return <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.ps}</span>;
    if (col.key === 'pending') return <ClickableCell value={row.pending} psName={row.ps} psId={row.psId} statusGroup="pending" color="#60a5fa" />;
    if (col.key === 'u7') return <span style={{ color: 'var(--text-muted)' }}><ClickableCell value={row.u7} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u7' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.u7 || 0) * 100 / total)}%)</span></span>;
    if (col.key === 'u15') return <span style={{ color: '#eab308' }}><ClickableCell value={row.u15} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u15' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.u15 || 0) * 100 / total)}%)</span></span>;
    if (col.key === 'u30') return <span style={{ color: '#fb923c', fontWeight: 500 }}><ClickableCell value={row.u30} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'u30' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.u30 || 0) * 100 / total)}%)</span></span>;
    if (col.key === 'o30') return <span style={{ color: '#ef4444', fontWeight: 'bold' }}><ClickableCell value={row.o30} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'o30' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.o30 || 0) * 100 / total)}%)</span></span>;
    if (col.key === 'o60') return <span style={{ color: '#b91c1c', fontWeight: 'bold' }}><ClickableCell value={row.o60 || 0} psName={row.ps} psId={row.psId} statusGroup="pending" extra={{ pendencyAge: 'o60' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.o60 || 0) * 100 / total)}%)</span></span>;
    return row[col.key];
  };

  // ── Disposal Time Matrix (Days) ───────────────────────────────────────────
  const disposalCols: Column<any>[] = [
    { key: 'ps', label: 'Police Station', sortable: true },
    { key: 'disposed', label: 'Total Disposed', sortable: true, align: 'center' },
    { key: 'missingDates', label: 'Date Not Found', sortable: true, align: 'center' },
    { key: 'du7', label: 'Within 7 Days', sortable: true, align: 'center' },
    { key: 'du15', label: 'Within 15 Days', sortable: true, align: 'center' },
    { key: 'du30', label: 'Within 30 Days', sortable: true, align: 'center' },
    { key: 'do30', label: 'Within 2 Months', sortable: true, align: 'center' },
    { key: 'do60', label: 'Over 2 Months', sortable: true, align: 'center' },
  ];

  const renderDisposalDays = (col: Column<any>, row: any) => {
    const disposedWithDate = row.disposed || 0;
    const disposedNoDate = row.missingDates || 0;
    const denominator = disposedWithDate || 1;
    if (col.key === 'ps') return <span style={{ fontWeight: 500, color: 'var(--text-main)' }}>{row.ps}</span>;
    if (col.key === 'disposed') return <ClickableCell value={disposedWithDate} psName={row.ps} psId={row.psId} statusGroup="disposed" color="#4ade80" />;
    if (col.key === 'missingDates') return <ClickableCell value={disposedNoDate} psName={row.ps} psId={row.psId} statusGroup="disposed_missing_date" color="#fbbf24" />;
    if (col.key === 'du7') return <span style={{ color: '#4ade80' }}><ClickableCell value={row.du7} psName={row.ps} psId={row.psId} statusGroup="disposed" extra={{ disposalAge: 'u7' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.du7 || 0) * 100 / denominator)}%)</span></span>;
    if (col.key === 'du15') return <span style={{ color: '#a3e635' }}><ClickableCell value={row.du15} psName={row.ps} psId={row.psId} statusGroup="disposed" extra={{ disposalAge: 'u15' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.du15 || 0) * 100 / denominator)}%)</span></span>;
    if (col.key === 'du30') return <span style={{ color: '#eab308' }}><ClickableCell value={row.du30} psName={row.ps} psId={row.psId} statusGroup="disposed" extra={{ disposalAge: 'u30' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.du30 || 0) * 100 / denominator)}%)</span></span>;
    if (col.key === 'do30') return <span style={{ color: '#ef4444', fontWeight: 'bold' }}><ClickableCell value={row.do30} psName={row.ps} psId={row.psId} statusGroup="disposed" extra={{ disposalAge: 'o30' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.do30 || 0) * 100 / denominator)}%)</span></span>;
    if (col.key === 'do60') return <span style={{ color: '#b91c1c', fontWeight: 'bold' }}><ClickableCell value={row.do60 || 0} psName={row.ps} psId={row.psId} statusGroup="disposed" extra={{ disposalAge: 'o60' }} color="inherit" /> <span style={{ fontSize: '11px', opacity: 0.6 }}>({Math.round((row.do60 || 0) * 100 / denominator)}%)</span></span>;
    return row[col.key];
  };

  const matrixCardStyle = { backgroundColor: '#1e293b', borderRadius: '8px', padding: '20px', border: '1px solid #334155', display: 'flex', flexDirection: 'column' as const };

  const getCategorySubtitle = () => {
    return `sorted ${CAT_SORTS.find(o => o.value === catSort)?.label || 'By Pending ↓'}`;
  };

  const getPendencySubtitle = () => {
    if (pendencyTableSort && pendencyTableSort.key) {
      const col = pendencyCols.find(c => c.key === pendencyTableSort.key);
      const dirArrow = pendencyTableSort.dir === 'asc' ? '↑' : pendencyTableSort.dir === 'desc' ? '↓' : '';
      return `sorted by ${col?.label || pendencyTableSort.key} ${dirArrow}`;
    }
    return 'sorted by default';
  };

  const getDisposalSubtitle = () => {
    if (disposalTableSort && disposalTableSort.key) {
      const col = disposalCols.find(c => c.key === disposalTableSort.key);
      const dirArrow = disposalTableSort.dir === 'asc' ? '↑' : disposalTableSort.dir === 'desc' ? '↓' : '';
      return `sorted by ${col?.label || disposalTableSort.key} ${dirArrow}`;
    }
    return 'sorted by default';
  };

  const getPsSubtitle = () => {
    if (psTableSort && psTableSort.key) {
      const col = psCols.find(c => c.key === psTableSort.key);
      const dirArrow = psTableSort.dir === 'asc' ? '↑' : psTableSort.dir === 'desc' ? '↓' : '';
      return `sorted by ${col?.label || psTableSort.key} ${dirArrow}`;
    }
    return 'sorted by default';
  };

  return (
    <Layout>
      <div className="page-content space-y-6">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px', marginBottom: '8px' }}>
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/admin/dashboard')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 18px',
                background: 'linear-gradient(135deg, #334155 0%, #1e293b 100%)',
                border: '1px solid #475569',
                borderRadius: '999px',
                color: '#cbd5e1',
                fontSize: '14px',
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #475569 0%, #334155 100%)';
                (e.currentTarget as HTMLButtonElement).style.color = '#f1f5f9';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#94a3b8';
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.background = 'linear-gradient(135deg, #334155 0%, #1e293b 100%)';
                (e.currentTarget as HTMLButtonElement).style.color = '#cbd5e1';
                (e.currentTarget as HTMLButtonElement).style.borderColor = '#475569';
              }}
            >
              <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
              Back
            </button>
            <h1 className="text-2xl font-bold text-slate-100">{district} District Analysis</h1>
          </div>
          <div className="dashboard-export-buttons">
            <button
              className="btn-primary dashboard-export-btn"
              onClick={() => {
                const wb = XLSX.utils.book_new();

                // Sheet 1: Executive Summary
                const execSummary = [{
                  'Metric': 'District', 'Value': district
                }, {
                  'Metric': 'Total Received', 'Value': totalReceived
                }, {
                  'Metric': 'Total Disposed', 'Value': totalDisposed
                }, {
                  'Metric': 'Disposed (Date Not Found)', 'Value': totalMissingDates
                }, {
                  'Metric': 'Total Pending', 'Value': totalPending
                }, {
                  'Metric': 'Status Not Found', 'Value': totalUnknown
                }, {
                  'Metric': 'Disposed (% of Total)', 'Value': `${Math.round((totalDisposed / (totalReceived || 1)) * 100)}%`
                }, {
                  'Metric': 'Pending (% of Total)', 'Value': `${Math.round((totalPending / (totalReceived || 1)) * 100)}%`
                }, {
                  'Metric': 'Avg. Disposal Time (Days)', 'Value': avgDisposalTime
                }];
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(execSummary), 'Overview');

                // Sheet 2: Police Station Summary
                const psSummary = policeStations.map((ps: any) => ({
                  'Police Station': ps.ps,
                  'Total': ps.total,
                  'Disposed (With Date)': ps.disposed,
                  'Disposed (Date Not Found)': ps.missingDates ?? 0,
                  'Pending': ps.pending,
                  'Status Not Found': ps.unknown ?? 0,
                  'Disposed %': `${Math.round((ps.disposed / (ps.total || 1)) * 100)}%`,
                  'Pending %': `${Math.round((ps.pending / (ps.total || 1)) * 100)}%`,
                  'Status Not Found %': `${Math.round(((ps.unknown || 0) / (ps.total || 1)) * 100)}%`,
                  'Within 7 Days (Pending)': ps.u7,
                  'Within 15 Days (Pending)': ps.u15,
                  'Within 30 Days (Pending)': ps.u30,
                  '> 30 Days (Pending)': ps.o30,
                  'Avg Disposal (Days)': ps.avgDisposalDays
                }));
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(psSummary), 'PS Summary');

                // Sheet 3: Category Breakdown
                const catSummary = categories.map((cat: any) => ({
                  'Category': cat.category,
                  'Total': cat.total,
                  'Disposed': cat.disposed,
                  'Pending': cat.pending,
                  'Status Not Found': cat.unknown ?? 0,
                  'Disposed %': `${Math.round((cat.disposed / (cat.total || 1)) * 100)}%`,
                  'Pending %': `${Math.round((cat.pending / (cat.total || 1)) * 100)}%`,
                }));
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catSummary), 'Category Breakdown');

                // Sheet 4: Disposal Time Matrix
                const psDisposal = policeStations.map((ps: any) => ({
                  'Police Station': ps.ps,
                  'Disposed (With Date)': ps.disposed,
                  'Disposed (Date Not Found)': ps.missingDates ?? 0,
                  'Within 7 Days (Disposed)': ps.du7,
                  'Within 15 Days (Disposed)': ps.du15,
                  'Within 30 Days (Disposed)': ps.du30,
                  '> 30 Days (Disposed)': ps.do30
                }));
                XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(psDisposal), 'Disposal Matrix');

                // Write as binary array and download via Blob to avoid corruption
                const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
                const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${district}_District_Analysis.xlsx`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              }}
              style={{ width: 'auto', margin: 0, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#10b981', borderColor: '#059669' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              Export Excel
            </button>
            <button
              className="btn-primary dashboard-export-btn"
              onClick={() => window.print()}
              style={{ width: 'auto', margin: 0, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Export PDF
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="loading-spinner"><svg width="28" height="28" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : (
          <>
            <div className="stats-grid">
              <StatCard label="Total Received" value={totalReceived.toLocaleString()} colorClass="blue" onClick={() => openDrawer(`${district} — All`, { district: district!, statusGroup: 'all', ...Object.fromEntries(Object.entries(filters).filter(([_,v])=>v!=='')) })} />
              <StatCard
                label="Total Disposed"
                value={totalDisposed.toLocaleString()}
                subValue={`${Math.round((totalDisposed / (totalReceived || 1)) * 100)}% of Total | ${totalDisposedWithDate.toLocaleString()} with date | ${totalMissingDates.toLocaleString()} without date`}
                colorClass="green"
                onClick={() => openDrawer(`${district} — Disposed`, { district: district!, statusGroup: 'disposed', ...Object.fromEntries(Object.entries(filters).filter(([_,v])=>v!=='')) })}
              />
              <StatCard
                label="Total Pending"
                value={totalPending.toLocaleString()}
                subValue={`${Math.round((totalPending / (totalReceived || 1)) * 100)}% of Total Received`}
                colorClass="red"
                onClick={() => openDrawer(`${district} — Pending`, { district: district!, statusGroup: 'pending', ...Object.fromEntries(Object.entries(filters).filter(([_,v])=>v!=='')) })}
              />
              <StatCard
                label="Disposed but Date Not Found"
                value={totalMissingDates.toLocaleString()}
                subValue={`${Math.round((totalMissingDates / (totalReceived || 1)) * 100)}% of Total Received`}
                colorClass="yellow"
                onClick={() => openDrawer(`${district} — Date Not Found`, { district: district!, statusGroup: 'disposed_missing_date', ...Object.fromEntries(Object.entries(filters).filter(([_,v])=>v!=='')) })}
              />
              <StatCard
                label="Status Not Found"
                value={totalUnknown.toLocaleString()}
                subValue={`${Math.round((totalUnknown / (totalReceived || 1)) * 100)}% of Total Received`}
                colorClass="yellow"
                onClick={() => openDrawer(`${district} — Status NF`, { district: district!, statusGroup: 'unknown', ...Object.fromEntries(Object.entries(filters).filter(([_,v])=>v!=='')) })}
              />
              <StatCard
                label="Avg. Disposal Time"
                value={avgDisposalTime !== null ? `${avgDisposalTime} Days` : '—'}
                subValue="Only for records where date was found"
                colorClass="purple"
              />
            </div>

            {/* PS Summary + Category Chart */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 bg-slate-800 rounded-lg p-5 border border-slate-700" style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ marginBottom: '8px' }}>
                  <h2 className="text-lg font-bold text-slate-100">Police Station Breakdown &amp; Ageing</h2>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{getPsSubtitle()}</span>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                  <DataTable
                    title="Police Station Breakdown & Ageing"
                    data={policeStations}
                    columns={psCols.map(c => ({ ...c, render: (row) => renderPsCell(c, row) }))}
                    maxHeight="400px"
                    onSort={(key, dir) => key ? setPsTableSort({ key, dir }) : setPsTableSort(null)}
                    showTotalRow={true}
                    getTotalRow={(data) => {
                      const totals = data.reduce<Record<string, number>>((acc, r) => ({
                        total: acc.total + Number(r.total || 0),
                        disposed: acc.disposed + Number(r.disposed || 0),
                        missingDates: acc.missingDates + Number(r.missingDates || 0),
                        pending: acc.pending + Number(r.pending || 0),
                        unknown: acc.unknown + Number(r.unknown || 0),
                        u7: acc.u7 + Number(r.u7 || 0),
                        u15: acc.u15 + Number(r.u15 || 0),
                        u30: acc.u30 + Number(r.u30 || 0),
                        o30: acc.o30 + Number(r.o30 || 0),
                        o60: acc.o60 + Number(r.o60 || 0),
                      }), { total: 0, disposed: 0, missingDates: 0, pending: 0, unknown: 0, u7: 0, u15: 0, u30: 0, o30: 0, o60: 0 });
                      return {
                        ps: '',
                        total: totals.total.toLocaleString(),
                        disposed: totals.disposed.toLocaleString(),
                        missingDates: totals.missingDates.toLocaleString(),
                        pending: totals.pending.toLocaleString(),
                        unknown: totals.unknown.toLocaleString(),
                        u7: totals.u7.toLocaleString(),
                        u15: totals.u15.toLocaleString(),
                        u30: totals.u30.toLocaleString(),
                        o30: totals.o30.toLocaleString(),
                        o60: totals.o60.toLocaleString(),
                        avgDisposalDays: '-',
                      };
                    }}
                  />
                </div>
              </div>
              <div className="lg:col-span-1">
                <ChartCard
                  title="Complaints by Class of Incident"
                  subtitle={getCategorySubtitle()}
                  option={getStackedBarOptions(categories.slice(0, 12).reverse())}
                  fullOption={getStackedBarOptions([...categories].reverse())}
                  height="450px"
                  actions={
                    <div className="chart-actions">
                      <CatSortDropdown
                        value={catSort}
                        onChange={v => setCatSort(v)}
                      />
                    </div>
                  }
                />
              </div>
            </div>

            {/* Pendency Ageing Matrix */}
            <div className="dashboard-matrices-grid">
              <div style={{ ...matrixCardStyle, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h2 className="text-lg font-bold text-slate-100">Pendency Ageing Matrix</h2>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>{getPendencySubtitle()}</span>
                  </div>
                </div>
                <DataTable
                  title="Pendency Ageing Matrix"
                  data={policeStations}
                  columns={pendencyCols.map(c => ({ ...c, render: (row) => renderPendencyDays(c, row) }))}
                  maxHeight="350px"
                  onSort={(key, dir) => key ? setPendencyTableSort({ key, dir }) : setPendencyTableSort(null)}
                  showTotalRow={true}
                  getTotalRow={(data) => {
                    const totals = data.reduce<Record<string, number>>((acc, r) => ({
                      pending: acc.pending + Number(r.pending || 0),
                      u7: acc.u7 + Number(r.u7 || 0),
                      u15: acc.u15 + Number(r.u15 || 0),
                      u30: acc.u30 + Number(r.u30 || 0),
                      o30: acc.o30 + Number(r.o30 || 0),
                      o60: acc.o60 + Number(r.o60 || 0),
                    }), { pending: 0, u7: 0, u15: 0, u30: 0, o30: 0, o60: 0 });
                    return {
                      ps: '',
                      pending: totals.pending.toLocaleString(),
                      u7: totals.u7.toLocaleString(),
                      u15: totals.u15.toLocaleString(),
                      u30: totals.u30.toLocaleString(),
                      o30: totals.o30.toLocaleString(),
                      o60: totals.o60.toLocaleString(),
                    };
                  }}
                />
              </div>

              {/* Disposal Time Matrix */}
              <div style={{ ...matrixCardStyle, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <h2 className="text-lg font-bold text-slate-100">Disposal Time Matrix</h2>
                    <span style={{ fontSize: '12px', color: '#94a3b8' }}>{getDisposalSubtitle()}</span>
                  </div>
                </div>
                <DataTable
                  title="Disposal Time Matrix"
                  data={policeStations}
                  columns={disposalCols.map(c => ({ ...c, render: (row) => renderDisposalDays(c, row) }))}
                  maxHeight="350px"
                  onSort={(key, dir) => key ? setDisposalTableSort({ key, dir }) : setDisposalTableSort(null)}
                  showTotalRow={true}
                  getTotalRow={(data) => {
                    const totals = data.reduce<Record<string, number>>((acc, r) => ({
                      disposed: acc.disposed + Number(r.disposed || 0),
                      missingDates: acc.missingDates + Number(r.missingDates || 0),
                      du7: acc.du7 + Number(r.du7 || 0),
                      du15: acc.du15 + Number(r.du15 || 0),
                      du30: acc.du30 + Number(r.du30 || 0),
                      do30: acc.do30 + Number(r.do30 || 0),
                      do60: acc.do60 + Number(r.do60 || 0),
                    }), { disposed: 0, missingDates: 0, du7: 0, du15: 0, du30: 0, do30: 0, do60: 0 });
                    return {
                      ps: '',
                      disposed: totals.disposed.toLocaleString(),
                      missingDates: totals.missingDates.toLocaleString(),
                      du7: totals.du7.toLocaleString(),
                      du15: totals.du15.toLocaleString(),
                      du30: totals.du30.toLocaleString(),
                      do30: totals.do30.toLocaleString(),
                      do60: totals.do60.toLocaleString(),
                    };
                  }}
                />
              </div>
            </div>
          </>
        )}
      </div>

      <ComplaintsDrawer
        open={drawer.open}
        title={drawer.title}
        filters={drawer.filters}
        onClose={closeDrawer}
      />
    </Layout>
  );
};

export default DistrictDetail;
