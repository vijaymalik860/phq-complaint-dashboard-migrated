import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { ChartCard } from '@/components/charts/ChartCard';
import { DataTable, Column } from '@/components/data/DataTable';
import { getStackedBarOptions, getDistrictBarOptions } from '@/components/charts/Charts';
import { reportsApi } from '@/services/api';
import { useFilters } from '@/contexts/FilterContext';
import { ComplaintsDrawer, DrawerFilters } from '@/components/common/ComplaintsDrawer';
import { ByHandBogusTab } from './ByHandBogusTab';

const tabs = [
  { id: 'district', label: 'District' },
  { id: 'mode-receipt', label: 'Receipt Mode' },
  { id: 'complaint-source', label: 'Complaint Source' },
  { id: 'type-complaint', label: 'Class of Incident' },
  { id: 'type-against', label: 'Type Against' },
  { id: 'status', label: 'Status' },
  { id: 'branch-wise', label: 'Branch' },
  { id: 'oldest-pending', label: 'Oldest Pending' },
  { id: 'habitual-complainants', label: 'Habitual Complainants' },
  { id: 'byhand-bogus', label: 'By Hand + Bogus' },
];

const apiFnMap: Record<string, (params?: Record<string, string>) => Promise<any>> = {
  'district': (p) => reportsApi.district(p),
  'mode-receipt': (p) => reportsApi.modeReceipt(p),
  'complaint-source': (p) => reportsApi.complaintsSource(p),
  'type-complaint': (p) => reportsApi.typeComplaint(p),
  'type-against': (p) => reportsApi.typeAgainst(p),
  'status': (p) => reportsApi.status(p),
  'branch-wise': (p) => reportsApi.branchWise(p),
  'oldest-pending': (p) => reportsApi.oldestPending(p),
};

// ─── Reusable sort dropdown (local to this page) ─────────────────────────────
type SortOpt = { label: string; value: string };
const CHART_SORTS: SortOpt[] = [
  { label: 'By Total ↓', value: 'total' },
  { label: 'By Pending ↓', value: 'pending' },
  { label: 'By Disposed ↓', value: 'disposed' },
  { label: 'A → Z', value: 'az' },
  { label: 'Z → A', value: 'za' },
];

const ChartSortDropdown = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const handleMenuMouseEnter = () => {
    if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
  };

  const handleMenuMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 300);
  };

  const handleButtonClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(prev => !prev);
  };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={handleButtonClick}
        onMouseEnter={e => { setOpen(true); (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.backgroundColor = ''; (e.currentTarget as HTMLElement).style.color = ''; }}
        className="chart-expand-btn"
        title="Sort Options"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="16" y2="12" /><line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        <span>Sort</span>
      </button>
      {open && (
        <div
          style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, backgroundColor: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, boxShadow: 'var(--shadow-md)', zIndex: 9999, minWidth: 180, padding: '4px 0' }}
          onMouseEnter={handleMenuMouseEnter}
          onMouseLeave={handleMenuMouseLeave}
        >
          {CHART_SORTS.map(opt => (
            <div key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{ padding: '7px 14px', fontSize: 12, cursor: 'pointer', color: value === opt.value ? 'var(--primary)' : 'var(--text-secondary)', fontWeight: value === opt.value ? 600 : 400, backgroundColor: value === opt.value ? 'var(--bg-hover)' : 'transparent' }}
              onMouseEnter={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >{opt.label}</div>
          ))}
        </div>
      )}
    </div>
  );
};


// ---------------------------------------------------------------------------
// Habitual Complainants Tab � self-contained component
// ═══════════════════════════════════════════════════════════════════════════
// Habitual Complainants Tab — self-contained component with server pagination
// ═══════════════════════════════════════════════════════════════════════════
type HCSortKey = 'rank' | 'fullName' | 'mobile' | 'districtName' | 'psName' | 'complaintCount' | 'lastComplaintDt';
type HCSortDir = 'asc' | 'desc';

const HC_COLUMNS: { key: HCSortKey; label: string; align?: 'center' | 'right' }[] = [
  { key: 'rank',           label: '#',              align: 'center' },
  { key: 'fullName',       label: 'Complainant'                     },
  { key: 'mobile',         label: 'Mobile'                          },
  { key: 'districtName',   label: 'District'                        },
  { key: 'psName',         label: 'Police Station'                  },
  { key: 'complaintCount', label: 'Complaints',     align: 'center' },
  { key: 'lastComplaintDt',label: 'Last Filed'                      },
];

const SortIcon = ({ active, dir }: { active: boolean; dir: HCSortDir }) => (
  <span style={{ fontSize: '9px', opacity: active ? 1 : 0.3, flexShrink: 0 }}>
    {active ? (dir === 'asc' ? '▲' : '▼') : '⇅'}
  </span>
);

const HabitualComplainantsTab = ({ activeFilters, openDrawer }: {
  activeFilters: Record<string, string>;
  openDrawer: (title: string, filters: DrawerFilters) => void;
}) => {
  // ── State ────────────────────────────────────────────────────────────────
  const [searchText,    setSearchText]    = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [minComplaints, setMinComplaints] = useState(2);
  const [sortKey,       setSortKey]       = useState<HCSortKey>('complaintCount');
  const [sortDir,       setSortDir]       = useState<HCSortDir>('desc');
  const [page,          setPage]          = useState(1);
  const [pageSize,      setPageSize]      = useState(50);
  const [gotoPage,      setGotoPage]      = useState('');
  const [mobileFilter,  setMobileFilter]  = useState<'all'|'valid'|'invalid'>('all');

  // Query builder filters
  type QFField = 'name'|'mobile'|'district'|'ps'|'address'|'gender';
  type QFOp    = 'contains'|'equals'|'starts_with';
  type QF      = { id: number; field: QFField; op: QFOp; value: string };
  const [appliedFilters, setAppliedFilters] = useState<QF[]>([]);
  const [pendingField,   setPendingField]   = useState<QFField>('name');
  const [pendingOp,      setPendingOp]      = useState<QFOp>('contains');
  const [pendingValue,   setPendingValue]   = useState('');
  const [showBuilder,    setShowBuilder]    = useState(false);
  const nextId = useRef(1);

  const QF_FIELDS: { key: QFField; label: string }[] = [
    { key: 'name',     label: 'Full Name'      },
    { key: 'mobile',   label: 'Mobile'         },
    { key: 'district', label: 'District'       },
    { key: 'ps',       label: 'Police Station' },
    { key: 'address',  label: 'Address'        },
    { key: 'gender',   label: 'Gender'         },
  ];
  const QF_OPS: { key: QFOp; label: string }[] = [
    { key: 'contains',    label: 'contains'    },
    { key: 'equals',      label: 'equals'      },
    { key: 'starts_with', label: 'starts with' },
  ];

  const resetPage = () => setPage(1);

  // Debounce search → sends to server
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(searchText); resetPage(); }, 400);
    return () => clearTimeout(t);
  }, [searchText]);

  // Reset page when global filters change
  useEffect(() => { setPage(1); }, [activeFilters]);

  // Build API params
  const params: Record<string, string> = {
    ...activeFilters,
    page:          String(page),
    pageSize:      String(pageSize),
    minComplaints: String(minComplaints),
  };
  if (debouncedSearch)        params.search       = debouncedSearch;
  if (mobileFilter !== 'all') params.mobileFilter = mobileFilter;
  if (appliedFilters.length)  params.queryFilters = JSON.stringify(
    appliedFilters.map(({ field, op, value }) => ({ field, op, value }))
  );

  const { data: apiResp, isLoading, isFetching } = useQuery({
    queryKey: ['habitual-complainants', params],
    queryFn:  () => reportsApi.habitualComplainants(params),
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev: any) => prev,
  });

  const paginatedResult = (apiResp as any)?.data || {};
  const serverRows:  any[]  = paginatedResult?.data       || [];
  const total:       number = paginatedResult?.total      || 0;
  const totalPages:  number = paginatedResult?.totalPages || 1;

  // Client-side sort only (search/filter are server-side)
  const sorted = useMemo(() => {
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...serverRows].sort((a, b) => {
      if (sortKey === 'complaintCount')  return sign * (a.complaintCount - b.complaintCount);
      if (sortKey === 'lastComplaintDt') return sign * (a.lastComplaintDt || '').localeCompare(b.lastComplaintDt || '');
      return sign * String(a[sortKey] || '').toLowerCase().localeCompare(String(b[sortKey] || '').toLowerCase());
    });
  }, [serverRows, sortKey, sortDir]);

  const maxCount   = useMemo(() => Math.max(...sorted.map(r => r.complaintCount), 1), [sorted]);
  const rankOffset = (page - 1) * pageSize;

  const handleSort = (key: HCSortKey) => {
    if (key === 'rank') return;
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir(key === 'complaintCount' ? 'desc' : 'asc'); }
  };

  const addFilter = () => {
    if (!pendingValue.trim()) return;
    setAppliedFilters(prev => [...prev, { id: nextId.current++, field: pendingField, op: pendingOp, value: pendingValue.trim() }]);
    setPendingValue('');
    setShowBuilder(false);
    resetPage();
  };
  const removeFilter = (id: number) => { setAppliedFilters(prev => prev.filter(f => f.id !== id)); resetPage(); };

  const rankColor = (r: number) => r === 1 ? '#fbbf24' : r === 2 ? '#94a3b8' : r === 3 ? '#cd7f32' : '#1e293b';

  // Client-side mobile validity (mirrors backend SQL rules)
  const FAKE_MOBILES = new Set(['1234567890','0987654321','9876543210','1111111111','2222222222',
    '3333333333','4444444444','5555555555','6666666666','7777777777','8888888888','9999999999','0000000000']);
  const isValidIndianMobile = (m: string): boolean => {
    if (!m || !/^[6-9][0-9]{9}$/.test(m)) return false;  // 10 digits, starts 6-9
    if (/^(.)\1{9}$/.test(m)) return false;               // all-same-digit
    if (/0{8}/.test(m)) return false;                     // 8+ consecutive zeros (e.g. 9900000000)
    if (FAKE_MOBILES.has(m)) return false;                 // known fakes
    return true;
  };


  const navBtn = (disabled: boolean, onClick: () => void, label: string) => (
    <button disabled={disabled} onClick={onClick} style={{
      padding: '3px 8px', background: disabled ? 'var(--bg-input)' : 'var(--bg-hover)',
      opacity: disabled ? 0.4 : 1,
      color: disabled ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)',
      borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 13,
    }}>{label}</button>
  );

  const ctrlStyle: React.CSSProperties = {
    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6,
    color: 'var(--text-primary)', padding: '5px 9px', fontSize: 12, outline: 'none', cursor: 'pointer',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>

      {/* ── Controls row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 10, flexShrink: 0 }}>

        {/* Search — server-side, all columns */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '1 1 200px', minWidth: 160 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input
            type="text" placeholder="Search all records…"
            value={searchText} onChange={e => setSearchText(e.target.value)}
            style={{ ...ctrlStyle, flex: 1, maxWidth: 260, cursor: 'text' }}
          />
          {isFetching && !isLoading && (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              style={{ flexShrink: 0, animation: 'spin 0.8s linear infinite', color: '#60a5fa' }}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          )}
        </div>

        {/* Min Complaints */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <label style={{ fontSize: 11, color: '#64748b', whiteSpace: 'nowrap' }}>Min</label>
          <select value={minComplaints} onChange={e => { setMinComplaints(Number(e.target.value)); resetPage(); }} style={ctrlStyle}>
            {[2,3,5,10,20].map(n => <option key={n} value={n} style={{ background: '#1e293b' }}>{n}+</option>)}
          </select>
        </div>

        {/* Mobile Validity Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexShrink: 0, borderRadius: 7, overflow: 'hidden', border: '1px solid #334155' }}>
          {([
            { key: 'all',     label: 'All Mobiles',    icon: '📱' },
            { key: 'valid',   label: 'Valid Mobile',   icon: '✓' },
            { key: 'invalid', label: 'Invalid Mobile', icon: '✗' },
          ] as const).map((opt, idx) => {
            const isActive = mobileFilter === opt.key;
            const activeColor =
              opt.key === 'valid'   ? { bg: 'rgba(52,211,153,0.18)', border: 'rgba(52,211,153,0.5)', text: '#34d399' } :
              opt.key === 'invalid' ? { bg: 'rgba(239,68,68,0.18)',  border: 'rgba(239,68,68,0.5)',  text: '#f87171' } :
                                      { bg: 'rgba(99,102,241,0.18)', border: 'rgba(99,102,241,0.4)', text: '#818cf8' };
            return (
              <button key={opt.key} onClick={() => { setMobileFilter(opt.key); resetPage(); }} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', fontSize: 11, fontWeight: isActive ? 600 : 400,
                background:  isActive ? activeColor.bg  : 'rgba(255,255,255,0.04)',
                color:       isActive ? activeColor.text : '#64748b',
                border: 'none',
                borderRight: idx < 2 ? '1px solid #334155' : 'none',
                cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.15s',
              }}>
                <span style={{ fontSize: opt.key === 'all' ? 10 : 12, lineHeight: 1 }}>{opt.icon}</span>
                {opt.label}
              </button>
            );
          })}
        </div>

        {/* Add Filter button */}
        <button onClick={() => setShowBuilder(b => !b)} style={{
          display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0,
          padding: '5px 10px', fontSize: 11, fontWeight: 500,
          background: showBuilder ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)',
          border: `1px solid ${showBuilder ? 'rgba(99,102,241,0.5)' : '#334155'}`,
          borderRadius: 6, color: showBuilder ? '#818cf8' : '#94a3b8', cursor: 'pointer',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Filter
        </button>

        {/* Count pill */}
        {!isLoading && (
          <div style={{ marginLeft: 'auto', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 5,
            background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.25)',
            borderRadius: 20, padding: '3px 12px', fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a5 5 0 100 10A5 5 0 0012 2zM4 20c0-4 3.58-7 8-7s8 3 8 7H4z"/></svg>
            {total.toLocaleString()} found
          </div>
        )}
      </div>

      {/* ── Filter builder panel ───────────────────────────────────────────── */}
      {showBuilder && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 10,
          padding: '8px 10px', background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)',
          borderRadius: 8, flexShrink: 0 }}>
          <select value={pendingField} onChange={e => setPendingField(e.target.value as QFField)} style={ctrlStyle}>
            {QF_FIELDS.map(f => <option key={f.key} value={f.key} style={{ background: '#1e293b' }}>{f.label}</option>)}
          </select>
          <select value={pendingOp} onChange={e => setPendingOp(e.target.value as QFOp)} style={ctrlStyle}>
            {QF_OPS.map(o => <option key={o.key} value={o.key} style={{ background: '#1e293b' }}>{o.label}</option>)}
          </select>
          <input
            type="text" placeholder="Value…" value={pendingValue}
            onChange={e => setPendingValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addFilter()}
            style={{ ...ctrlStyle, cursor: 'text', minWidth: 120, flex: '1 1 100px' }}
          />
          <button onClick={addFilter} style={{
            padding: '5px 12px', fontSize: 11, fontWeight: 600,
            background: 'rgba(99,102,241,0.25)', color: '#818cf8',
            border: '1px solid rgba(99,102,241,0.5)', borderRadius: 6, cursor: 'pointer',
          }}>Apply</button>
          <button onClick={() => setShowBuilder(false)} style={{
            padding: '5px 8px', fontSize: 11, background: 'transparent',
            color: '#64748b', border: '1px solid #334155', borderRadius: 6, cursor: 'pointer',
          }}>✕</button>
        </div>
      )}

      {/* ── Applied filter chips ───────────────────────────────────────────── */}
      {appliedFilters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, flexShrink: 0 }}>
          {appliedFilters.map(f => (
            <span key={f.id} style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              padding: '2px 8px 2px 10px', borderRadius: 20, fontSize: 11,
              background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)', color: '#93c5fd',
            }}>
              <span style={{ color: '#60a5fa', fontWeight: 600 }}>{QF_FIELDS.find(x => x.key === f.field)?.label}</span>
              <span style={{ color: '#475569' }}>{f.op.replace('_',' ')}</span>
              <span>"{f.value}"</span>
              <button onClick={() => removeFilter(f.id)} style={{
                background: 'none', border: 'none', color: '#475569', cursor: 'pointer',
                padding: '0 0 0 4px', fontSize: 12, lineHeight: 1,
              }}>×</button>
            </span>
          ))}
          <button onClick={() => { setAppliedFilters([]); resetPage(); }} style={{
            padding: '2px 8px', fontSize: 11, background: 'none',
            color: '#475569', border: '1px solid #334155', borderRadius: 20, cursor: 'pointer',
          }}>Clear all</button>
        </div>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {isLoading && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 10, color: '#64748b' }}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" style={{ animation: 'spin 0.8s linear infinite' }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
            <path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span style={{ fontSize: 13 }}>Analysing complainant patterns…</span>
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      {!isLoading && (sorted.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#475569' }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.35, marginBottom: 10 }}>
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/>
          </svg>
          <div style={{ fontSize: 13, fontWeight: 500 }}>No habitual complainants found</div>
          <div style={{ fontSize: 11, marginTop: 4, color: '#334155' }}>Try adjusting filters or lowering the minimum complaint count.</div>
        </div>
      ) : (
        <>
          {/* Scrollable table */}
          <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', minHeight: 0 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2 }}>
                <tr style={{ background: '#0f172a', borderBottom: '2px solid #1e293b' }}>
                  {HC_COLUMNS.map(col => (
                    <th key={col.key} onClick={() => handleSort(col.key)} style={{
                      padding: '9px 11px', textAlign: col.align || 'left', background: '#0f172a',
                      color: sortKey === col.key ? '#60a5fa' : '#64748b', fontWeight: 600,
                      cursor: col.key === 'rank' ? 'default' : 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {col.label}
                        {col.key !== 'rank' && <SortIcon active={sortKey === col.key} dir={sortDir} />}
                      </span>
                    </th>
                  ))}
                  <th style={{ padding: '9px 11px', textAlign: 'center', color: '#64748b', fontWeight: 600, background: '#0f172a' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r, i) => {
                  const rank = rankOffset + i + 1;
                  const bg   = i % 2 === 0 ? '#111827' : '#0f172a';
                  return (
                    <tr key={r.mobile} style={{ background: bg, borderBottom: '1px solid #1e293b', transition: 'background 0.1s' }}
                      onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = '#1e293b'}
                      onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = bg}>
                      <td style={{ padding: '8px 11px', textAlign: 'center' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 24, height: 24, borderRadius: '50%', background: rankColor(rank),
                          color: rank <= 3 ? '#000' : '#64748b', fontSize: rank > 99 ? 8 : 10, fontWeight: 700 }}>
                          {rank}
                        </span>
                      </td>
                      <td style={{ padding: '8px 11px' }}>
                        <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{r.fullName}</div>
                        {r.gender  && <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 1 }}>{r.gender}</div>}
                        {r.address && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.address}</div>}
                      </td>
                      <td style={{ padding: '8px 11px', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                          <span style={{ fontFamily: 'monospace', color: 'var(--primary)' }}>{r.mobile}</span>
                          {isValidIndianMobile(r.mobile) ? (
                            <span title="Valid Indian mobile number"
                              style={{ fontSize: 9, color: 'var(--success)', fontWeight: 700, lineHeight: 1,
                                border: '1px solid var(--border)', borderRadius: 3,
                                padding: '1px 3px', flexShrink: 0 }}>✓</span>
                          ) : (
                            <span title="Invalid / unverifiable mobile number"
                              style={{ fontSize: 9, color: 'var(--danger)', fontWeight: 700, lineHeight: 1,
                                border: '1px solid var(--border)', borderRadius: 3,
                                padding: '1px 3px', flexShrink: 0 }}>✗</span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '8px 11px', color: 'var(--text-secondary)' }}>{r.districtName || '—'}</td>
                      <td style={{ padding: '8px 11px', color: 'var(--text-secondary)' }}>{r.psName || '—'}</td>
                      <td style={{ padding: '8px 11px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                          <span style={{ minWidth: 26, textAlign: 'right', fontWeight: 700, fontSize: 13,
                            color: r.complaintCount >= 10 ? '#ef4444' : r.complaintCount >= 5 ? '#f97316' : '#fbbf24' }}>
                            {r.complaintCount}
                          </span>
                          <div style={{ flex: 1, background: '#1e293b', borderRadius: 3, height: 5, minWidth: 40 }}>
                            <div style={{ height: '100%', borderRadius: 3,
                              width: `${Math.round((r.complaintCount / maxCount) * 100)}%`,
                              background: r.complaintCount >= 10 ? 'linear-gradient(90deg,#ef4444,#fca5a5)'
                                        : r.complaintCount >= 5  ? 'linear-gradient(90deg,#f97316,#fed7aa)'
                                        :                          'linear-gradient(90deg,#fbbf24,#fef08a)',
                              transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '8px 11px', color: '#64748b', whiteSpace: 'nowrap' }}>{r.lastComplaintDt || '—'}</td>
                      <td style={{ padding: '8px 11px', textAlign: 'center' }}>
                        <button onClick={() => openDrawer(`${r.fullName} (${r.mobile})`, { search: r.mobile } as DrawerFilters)}
                          style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.3)',
                            borderRadius: 5, color: '#60a5fa', padding: '3px 9px', fontSize: 11, cursor: 'pointer', fontWeight: 500 }}>
                          View All
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Sticky Pagination Footer ──── */}
          <div style={{
            flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 8, padding: '9px 8px', marginTop: 6,
            borderTop: '1px solid #1e293b',
            background: '#0d1424',   /* solid — no transparency */
            boxShadow: '0 -4px 20px rgba(0,0,0,0.6)',
            position: 'sticky', bottom: 0, zIndex: 10,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Rows:</span>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); resetPage(); }}
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '3px 5px', fontSize: 11, outline: 'none' }}>
                {[20,50,100,200].map(n => <option key={n} value={n} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{n}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                Page <strong style={{ color: 'var(--text-primary)' }}>{page}</strong> / <strong style={{ color: 'var(--text-primary)' }}>{totalPages}</strong>
                <span style={{ color: 'var(--text-muted)' }}> · {total.toLocaleString()} total</span>
              </span>
              <div style={{ display: 'flex', gap: 3 }}>
                {navBtn(page<=1,          ()=>setPage(1),          '«')}
                {navBtn(page<=1,          ()=>setPage(p=>p-1),     '‹')}
                {navBtn(page>=totalPages, ()=>setPage(p=>p+1),     '›')}
                {navBtn(page>=totalPages, ()=>setPage(totalPages),  '»')}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4, borderLeft: '1px solid var(--border)', paddingLeft: 8 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Go:</span>
                <input type="number" min={1} max={totalPages} value={gotoPage}
                  onChange={e => setGotoPage(e.target.value)}
                  onKeyDown={e => { if (e.key==='Enter') { const p=parseInt(gotoPage,10); if(!isNaN(p)&&p>=1&&p<=totalPages){setPage(p);setGotoPage('');} } }}
                  style={{ width: 42, background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px', fontSize: 11, outline: 'none', textAlign: 'center' }}
                />
                <button onClick={() => { const p=parseInt(gotoPage,10); if(!isNaN(p)&&p>=1&&p<=totalPages){setPage(p);setGotoPage('');} }}
                  style={{ padding: '2px 7px', background: 'rgba(99,102,241,0.15)', color: 'var(--primary)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 4, fontSize: 10, cursor: 'pointer' }}>
                  Go
                </button>
              </div>
            </div>
          </div>
        </>
      ))}
    </div>
  );
};




export const ReportsPage = () => {
  const [sp] = useSearchParams();
  const type = sp.get('type') || 'district';
  const [chartSort, setChartSort] = useState<string>('total');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [tableSort, setTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);

  // Drawer state
  const [drawer, setDrawer] = useState<{ open: boolean; title: string; filters: DrawerFilters }>({ open: false, title: '', filters: {} });
  const openDrawer = (title: string, drawerFilters: DrawerFilters) => setDrawer({ open: true, title, filters: drawerFilters });
  const closeDrawer = () => setDrawer(d => ({ ...d, open: false }));

  const reportColumnsList = [
    { key: 'name', label: 'Name' },
    { key: 'total', label: 'Total' },
    { key: 'pending', label: 'Pending' },
    { key: 'disposed', label: 'Disposed' },
    { key: 'pendPct', label: 'Pending %' },
    { key: 'dispPct', label: 'Disposed %' },
  ];

  const getReportSubtitle = () => {
    if (viewMode === 'table' && tableSort && tableSort.key) {
      const col = reportColumnsList.find(c => c.key === tableSort.key);
      const dirArrow = tableSort.dir === 'asc' ? '↑' : tableSort.dir === 'desc' ? '↓' : '';
      return `sorted ${col?.label || tableSort.key} ${dirArrow}`;
    }
    return `sorted ${CHART_SORTS.find(o => o.value === chartSort)?.label || 'By Total ↓'}`;
  };

  const handleViewModeChange = (newMode: 'chart' | 'table') => {
    if (newMode === 'chart') {
      setTableSort(null);
    }
    setViewMode(newMode);
  };

  // Same pattern as Dashboard — read global filters, strip empty values
  const { filters } = useFilters();
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, v]) => v !== '')
  ) as Record<string, string>;

  const [oldestDistrict, setOldestDistrict] = useState<{ id: string, name: string } | null>(null);

  // Reset drill-down when tab changes
  useEffect(() => {
    setOldestDistrict(null);
  }, [type]);

  const { data, isLoading } = useQuery({
    queryKey: ['reports', type, activeFilters, oldestDistrict?.id],   // re-fetches on any filter change
    queryFn: () => {
      if (type === 'oldest-pending' && oldestDistrict) {
        return apiFnMap[type]({ ...activeFilters, districtMasterId: oldestDistrict.id });
      }
      return (apiFnMap[type] || apiFnMap['district'])(activeFilters);
    },
  });

  const rows = data?.data || [];
  const total = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || r.count || 0), 0);
  const pend = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.pending || 0), 0);
  const disp = rows.reduce((s: number, r: Record<string, unknown>) => s + Number(r.disposed || 0), 0);

  const tableData = useMemo(() => {
    const mapped = rows.map((r: Record<string, unknown>, i: number) => {
      const tot = Number(r.total || r.count || 0);
      const p = Number(r.pending || 0);
      const d = Number(r.disposed || 0);
      const rawName = String(
        r.district || r.branch || r.mode || r.status ||
        r.natureOfIncident || r.typeAgainst || r.actionTaken ||
        r.complaintSource || r.typeOfComplaint || ''
      );
      const displayName =
        type === 'status' && (!rawName || rawName.trim() === '')
          ? 'Status Not Found'
          : rawName || `Item ${i + 1}`;
      return {
        name: displayName,
        total: tot,
        pending: p,
        disposed: d,
        pendPct: tot > 0 ? Math.round((p / tot) * 100) + '%' : '0%',
        dispPct: tot > 0 ? Math.round((d / tot) * 100) + '%' : '0%',
      };
    });
    return [...mapped].sort((a, b) => {
      if (chartSort === 'az') return a.name.localeCompare(b.name);
      if (chartSort === 'za') return b.name.localeCompare(a.name);
      if (chartSort === 'pending') return b.pending - a.pending;
      if (chartSort === 'disposed') return b.disposed - a.disposed;
      return b.total - a.total; // default
    });
  }, [rows, type, chartSort]);

  const columns: Column<typeof tableData[0]>[] = [
    { key: 'name', label: 'Name', sortable: true },
    { key: 'total', label: 'Total', sortable: true, align: 'right' },
    { key: 'pending', label: 'Pending', sortable: true, align: 'right' },
    { key: 'disposed', label: 'Disposed', sortable: true, align: 'right' },
    { key: 'pendPct', label: 'Pending %', sortable: true, align: 'center' },
    { key: 'dispPct', label: 'Disposed %', sortable: true, align: 'center' },
  ];

  // Chart preview: top 25 sorted rows reversed so highest appears at the top of horizontal bar
  const chartRows = tableData.slice(0, 25).reverse();

  const chartOption = useMemo(() => {
    if (type === 'district' || type === 'branch-wise')
      return getDistrictBarOptions(chartRows.map(d => ({ ...d, district: d.name })));
    return getStackedBarOptions(chartRows.map(d => ({
      category: type === 'status' && (!d.name || d.name.trim() === '') ? 'Unknown Status' : d.name,
      total: d.total,
      pending: d.pending,
      disposed: d.disposed,
    })));
  }, [chartRows, type]);

  const fullChartOption = useMemo(() => {
    const allRowsRev = [...tableData].reverse();
    if (type === 'district' || type === 'branch-wise')
      return getDistrictBarOptions(allRowsRev.map(d => ({ ...d, district: d.name })));
    return getStackedBarOptions(allRowsRev.map(d => ({
      category: type === 'status' && (!d.name || d.name.trim() === '') ? 'Unknown Status' : d.name,
      total: d.total,
      pending: d.pending,
      disposed: d.disposed,
    })));
  }, [tableData, type]);

  return (
    <Layout>
      <div className="page-content">
        <div className="tab-list">
          {tabs.map(t => (
            <Link key={t.id} to={`?type=${t.id}`} className={`tab-item ${type === t.id ? 'active' : ''}`}>{t.label}</Link>
          ))}
        </div>

        {isLoading ? (
          <div className="loading-spinner"><svg width="28" height="28" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : type === 'byhand-bogus' ? (
          <ByHandBogusTab
            activeFilters={activeFilters}
            openDrawer={openDrawer}
          />
        ) : type === 'habitual-complainants' ? (
          <HabitualComplainantsTab
            activeFilters={activeFilters}
            openDrawer={openDrawer}
          />
        ) : type === 'oldest-pending' ? (
          <div>
            {oldestDistrict && (
              <button
                onClick={() => setOldestDistrict(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#60a5fa',
                  cursor: 'pointer',
                  marginBottom: '16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '14px',
                  fontWeight: 500
                }}
              >
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back to Districts
              </button>
            )}
            <DataTable
              title={oldestDistrict ? `PS wise Oldest Pending Complaints - ${oldestDistrict.name}` : "Oldest Pending Complaints - Districts"}
              data={rows.map((r: any) => ({
                id: r.id,
                name: r.name || 'Unmapped',
                oldestDate: r.oldestDate ? r.oldestDate.split('T')[0] : 'N/A',
                complaintNumber: r.complaintNumber || 'N/A'
              }))}
              columns={[
                { key: 'name', label: oldestDistrict ? 'Police Station' : 'District', sortable: true },
                { key: 'oldestDate', label: 'Oldest Complaint Date', sortable: true },
                {
                  key: 'complaintNumber',
                  label: 'Complaint Number',
                  sortable: true,
                  render: (row: any) => row.complaintNumber && row.complaintNumber !== 'N/A' ? (
                    <span
                      style={{ color: '#60a5fa', textDecoration: 'underline', cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrawer(`Complaint: ${row.complaintNumber}`, { search: row.complaintNumber, statusGroup: 'pending', ...activeFilters } as DrawerFilters);
                      }}
                    >
                      {row.complaintNumber}
                    </span>
                  ) : (row.complaintNumber || 'N/A')
                }
              ]}
              maxHeight="calc(100vh - 160px)"
              onRowClick={!oldestDistrict ? (row: any) => { if (row.id) setOldestDistrict({ id: row.id, name: row.name }); } : undefined}
            />
          </div>
        ) : (
          <>
            <div className="summary-row">
              <div className="summary-item">
                <span className="summary-value">{total.toLocaleString()}</span>
                <span className="summary-label">Total Received</span>
              </div>
              <div className="summary-item pending">
                <span className="summary-value">{pend.toLocaleString()}</span>
                <span className="summary-label">Pending {total > 0 ? `(${(pend / total * 100).toFixed(1)}%)` : ''}</span>
              </div>
              <div className="summary-item disposed">
                <span className="summary-value">{disp.toLocaleString()}</span>
                <span className="summary-label">Disposed {total > 0 ? `(${(disp / total * 100).toFixed(1)}%)` : ''}</span>
              </div>
            </div>

            <ChartCard
              title={tabs.find(t => t.id === type)?.label || 'Report'}
              subtitle={getReportSubtitle()}
              option={chartOption}
              fullOption={fullChartOption}
              height="400px"
              viewMode={viewMode}
              onViewModeChange={handleViewModeChange}
              chartActions={
                <ChartSortDropdown
                  value={chartSort}
                  onChange={v => setChartSort(v)}
                />
              }
            >
              {viewMode === 'table' && (
                <DataTable
                  data={tableData}
                  columns={columns.map(c => ({
                    ...c,
                    render: (row) => {
                      if (c.key === 'name') return <span style={{ fontWeight: 500 }}>{String(row.name)}</span>;
                      if (c.key === 'total') return <span style={{ fontWeight: 600 }}>{String(row.total)}</span>;
                      if (c.key === 'pending') return <span style={{ color: '#fbbf24' }}>{String(row.pending)}</span>;
                      if (c.key === 'disposed') return <span style={{ color: '#34d399' }}>{String(row.disposed)}</span>;
                      if (c.key === 'pendPct') return <span style={{ color: '#fbbf24' }}>{String(row.pendPct)}</span>;
                      if (c.key === 'dispPct') return <span style={{ color: '#34d399' }}>{String(row.dispPct)}</span>;
                      return String(row[c.key as keyof typeof row] ?? '-');
                    },
                  }))}
                  maxHeight="calc(100vh - 400px)"
                  onSort={(key, dir) => key ? setTableSort({ key, dir }) : setTableSort(null)}
                  hideTitleBar={true}
                  showTotalRow={true}
                  getTotalRow={(data) => {
                    const totals = data.reduce<Record<string, number>>((acc, r) => ({
                      total: acc.total + Number(r.total || 0),
                      pending: acc.pending + Number(r.pending || 0),
                      disposed: acc.disposed + Number(r.disposed || 0),
                    }), { total: 0, pending: 0, disposed: 0 });
                    const grandTotal = totals.total || 1;
                    return {
                      name: '',
                      total: totals.total.toLocaleString(),
                      pending: totals.pending.toLocaleString(),
                      disposed: totals.disposed.toLocaleString(),
                      pendPct: ((totals.pending / grandTotal) * 100).toFixed(1) + '%',
                      dispPct: ((totals.disposed / grandTotal) * 100).toFixed(1) + '%',
                    };
                  }}
                />
              )}
            </ChartCard>
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

export default ReportsPage;
