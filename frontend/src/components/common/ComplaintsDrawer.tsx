import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cctnsApi } from '@/services/api';
import './ComplaintsDrawer.css';

// ─── Types ───────────────────────────────────────────────────────────────────
export interface DrawerFilters {
  statusGroup?: string;
  districtIds?: string;
  district?: string;
  policeStationIds?: string;
  officeIds?: string;
  classOfIncident?: string;
  fromDate?: string;
  toDate?: string;
  pendencyAge?: string;
  disposalAge?: string;
  unmappedPs?: string;
  psName?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  statusRaw?: string;
}

interface Props {
  open: boolean;
  title: string;
  filters: DrawerFilters;
  onClose: () => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmtDate = (val: unknown): string => {
  if (!val) return '—';
  const d = new Date(val as string);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '—';
  return d.toLocaleDateString('en-IN');
};

const fmtDateTime = (val: unknown): string => {
  if (!val) return '—';
  const d = new Date(val as string);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '—';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const statusStyle = (group: string) => {
  if (group === 'disposed') return { bg: 'rgba(34,197,94,0.18)', color: '#22c55e' };
  if (group === 'pending')  return { bg: 'rgba(239,68,68,0.18)',  color: '#ef4444' };
  return { bg: 'rgba(234,179,8,0.18)', color: '#eab308' };
};

// All columns — in display order. "Reg. No." (complRegNum) is the frozen first data column.
const ALL_COLS = [
  { key: '#',                    label: '#',                     frozen: true,  width: 48  },
  { key: 'complRegNum',          label: 'Reg. No.',              frozen: true,  width: 150 },
  { key: 'complSrno',            label: 'Sr. No.',               frozen: false, width: 100 },
  { key: 'complRegDt',           label: 'Reg. Date',             frozen: false, width: 110 },
  { key: 'firstName',            label: 'First Name',            frozen: false, width: 120 },
  { key: 'lastName',             label: 'Last Name',             frozen: false, width: 120 },
  { key: 'gender',               label: 'Gender',                frozen: false, width: 80  },
  { key: 'age',                  label: 'Age',                   frozen: false, width: 60  },
  { key: 'mobile',               label: 'Mobile',                frozen: false, width: 120 },
  { key: 'email',                label: 'Email',                 frozen: false, width: 180 },
  { key: 'complainantType',      label: 'Complainant Type',      frozen: false, width: 150 },
  { key: 'addressLine1',         label: 'Address Line 1',        frozen: false, width: 180 },
  { key: 'addressLine2',         label: 'Address Line 2',        frozen: false, width: 180 },
  { key: 'addressLine3',         label: 'Address Line 3',        frozen: false, width: 180 },
  { key: 'village',              label: 'Village',               frozen: false, width: 120 },
  { key: 'tehsil',               label: 'Tehsil',                frozen: false, width: 120 },
  { key: 'addressDistrict',      label: 'Address District',      frozen: false, width: 140 },
  { key: 'addressPs',            label: 'Police Station',        frozen: false, width: 160 },
  { key: 'districtName',         label: 'District (Master)',     frozen: false, width: 150 },
  { key: 'districtMasterId',     label: 'District ID',           frozen: false, width: 100 },
  { key: 'policeStationMasterId',label: 'PS ID',                 frozen: false, width: 80  },
  { key: 'officeMasterId',       label: 'Office ID',             frozen: false, width: 90  },
  { key: 'submitPsCd',           label: 'Submit PS Code',        frozen: false, width: 120 },
  { key: 'submitPsName',         label: 'Submit PS Name',        frozen: false, width: 160 },
  { key: 'submitOfficeCd',       label: 'Submit Office Code',    frozen: false, width: 140 },
  { key: 'submitOfficeName',     label: 'Submit Office Name',    frozen: false, width: 180 },
  { key: 'receptionMode',        label: 'Reception Mode',        frozen: false, width: 140 },
  { key: 'branch',               label: 'Branch',                frozen: false, width: 120 },
  { key: 'complDesc',            label: 'Description',           frozen: false, width: 220 },
  { key: 'complaintSource',      label: 'Complaint Source',      frozen: false, width: 150 },
  { key: 'typeOfComplaint',      label: 'Type of Complaint',     frozen: false, width: 160 },
  { key: 'complaintPurpose',     label: 'Complaint Purpose',     frozen: false, width: 160 },
  { key: 'classOfIncident',      label: 'Class of Incident',     frozen: false, width: 160 },
  { key: 'incidentType',         label: 'Incident Type',         frozen: false, width: 140 },
  { key: 'incidentPlc',          label: 'Incident Place',        frozen: false, width: 140 },
  { key: 'incidentFromDt',       label: 'Incident From',         frozen: false, width: 120 },
  { key: 'incidentToDt',         label: 'Incident To',           frozen: false, width: 120 },
  { key: 'crimeCategory',        label: 'Crime Category',        frozen: false, width: 150 },
  { key: 'respondentCategories', label: 'Respondent Categories', frozen: false, width: 180 },
  { key: 'statusOfComplaint',    label: 'Status (Raw)',          frozen: false, width: 160 },
  { key: 'statusRaw',            label: 'Status (API Raw)',      frozen: false, width: 140 },
  { key: 'statusGroup',          label: 'Status Group',          frozen: false, width: 120 },
  { key: 'disposalDate',         label: 'Disposal Date',         frozen: false, width: 120 },
  { key: 'isDisposedMissingDate',label: 'Missing Disposal Date', frozen: false, width: 160 },
  { key: 'transferDistrictCd',   label: 'Transfer District Cd',  frozen: false, width: 160 },
  { key: 'transferOfficeCd',     label: 'Transfer Office Cd',    frozen: false, width: 150 },
  { key: 'transferPsCd',         label: 'Transfer PS Code',      frozen: false, width: 140 },
  { key: 'firNumber',            label: 'FIR Number',            frozen: false, width: 120 },
  { key: 'actionTaken',          label: 'Action Taken',          frozen: false, width: 200 },
  { key: 'ioDetails',            label: 'IO Details',            frozen: false, width: 160 },
  { key: 'createdAt',            label: 'Created At',            frozen: false, width: 150 },
  { key: 'updatedAt',            label: 'Last Synced',           frozen: false, width: 150 },
];

// Frozen cols pixel offsets (cumulative left positions)
const FROZEN = ALL_COLS.filter(c => c.frozen);
const frozenLeft = (key: string): number => {
  let acc = 0;
  for (const c of FROZEN) {
    if (c.key === key) return acc;
    acc += c.width;
  }
  return 0;
};

// ─── Component ───────────────────────────────────────────────────────────────
export const ComplaintsDrawer = ({ open, title, filters, onClose }: Props) => {
  const [page, setPage]                     = useState(1);
  const [limit]                             = useState(50);
  const [searchQuery, setSearchQuery]       = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [gotoInput, setGotoInput]           = useState('');
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset on open/filter change
  useEffect(() => {
    setPage(1);
    const initialSearch = filters.search || '';
    setSearchQuery(initialSearch);
    setDebouncedSearch(initialSearch);
    setGotoInput('');
  }, [open, filters.statusGroup, filters.districtIds, filters.policeStationIds, filters.search]);

  // Debounce search — resets to page 1, searches WHOLE table (backend handles it)
  useEffect(() => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setPage(1);
    }, 450);
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current); };
  }, [searchQuery]);

  // Escape to close
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape' && open) onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open, onClose]);

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const resolvedStatus =
    filters.statusGroup === 'all'                  ? undefined :
    filters.statusGroup === 'disposed_missing_date' ? 'disposed' :
    filters.statusGroup || undefined;
  const isMissingDate = filters.statusGroup === 'disposed_missing_date';

  const { data, isLoading, isFetching } = useQuery({
    queryKey: [
      'drawer-complaints', page, limit, debouncedSearch,
      filters.statusGroup, filters.districtIds, filters.district,
      filters.policeStationIds, filters.officeIds, filters.classOfIncident,
      filters.fromDate, filters.toDate, filters.pendencyAge, filters.disposalAge,
      filters.unmappedPs, filters.psName, filters.sortBy, filters.sortOrder,
      filters.statusRaw,
    ],
    queryFn: () => cctnsApi.listPaginated({
      page,
      limit,
      search: debouncedSearch || undefined,
      statusGroup: resolvedStatus,
      statusRaw: filters.statusRaw || undefined,
      isDisposedMissingDate: isMissingDate ? 'true' : undefined,
      districtIds:      filters.districtIds      || undefined,
      district:         filters.district         || undefined,
      policeStationIds: (filters.policeStationIds && filters.policeStationIds !== filters.districtIds)
                          ? filters.policeStationIds : undefined,
      officeIds:        filters.officeIds        || undefined,
      classOfIncident:  filters.classOfIncident  || undefined,
      fromDate:         filters.fromDate         || undefined,
      toDate:           filters.toDate           || undefined,
      pendencyAge:      filters.pendencyAge      || undefined,
      disposalAge:      filters.disposalAge      || undefined,
      unmappedPs:       filters.unmappedPs       || undefined,
      psName:           filters.psName           || undefined,
      sortBy:           filters.sortBy           || 'complRegDt',
      sortOrder:        filters.sortOrder        || 'desc',
    }),
    enabled: open,
    staleTime: 30_000,
  });

  const records: any[]  = data?.data?.data       || [];
  const pagination      = data?.data?.pagination;
  const totalCount      = pagination?.total       || 0;
  const totalPages      = pagination?.totalPages  || 1;

  // Go to page
  const handleGoto = () => {
    const n = parseInt(gotoInput, 10);
    if (!isNaN(n) && n >= 1 && n <= totalPages) { setPage(n); setGotoInput(''); }
  };

  // CSV export — all columns
  const handleExportCSV = useCallback(() => {
    if (!records.length) return;
    const cols = ALL_COLS.filter(c => c.key !== '#');
    const headers = cols.map(c => c.label);
    const rows = records.map((r: any) => cols.map(c => {
      const v = r[c.key];
      if (c.key === 'complRegDt' || c.key === 'incidentFromDt' || c.key === 'incidentToDt' || c.key === 'disposalDate') return fmtDate(v);
      if (c.key === 'createdAt'  || c.key === 'updatedAt') return fmtDateTime(v);
      if (c.key === 'isDisposedMissingDate') return v ? 'Yes' : 'No';
      return v ?? '';
    }));
    const csv = [headers, ...rows]
      .map(row => row.map((c: any) => `"${String(c).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `complaints_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }, [records]);

  if (!open) return null;

  return (
    <div className="complaints-drawer-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="complaints-drawer-panel" role="dialog" aria-modal="true" aria-label={title}>

        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="drawer-header">
          <div className="drawer-header-left">
            <div className="drawer-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h2 className="drawer-title">{title}</h2>
              <span className="drawer-subtitle">
                {isLoading ? 'Loading…' : `${totalCount.toLocaleString()} record${totalCount !== 1 ? 's' : ''} found`}
              </span>
            </div>
          </div>

          <div className="drawer-header-right">
            <div className="drawer-badges">
              {filters.statusGroup && filters.statusGroup !== 'all' && (
                <span className="drawer-badge status">
                  {filters.statusGroup === 'disposed_missing_date' ? 'Missing Date'
                    : filters.statusGroup === 'pending'  ? 'Pending'
                    : filters.statusGroup === 'disposed' ? 'Disposed'
                    : filters.statusGroup === 'unknown'  ? 'Status NF'
                    : filters.statusGroup}
                </span>
              )}
              {filters.psName         && <span className="drawer-badge ps">{filters.psName}</span>}
              {filters.classOfIncident && <span className="drawer-badge cat">{filters.classOfIncident}</span>}
              {filters.pendencyAge    && <span className="drawer-badge age">Age: {
                filters.pendencyAge === 'u7' ? 'Within 7 Days'
                : filters.pendencyAge === 'u15' ? 'Within 15 Days'
                : filters.pendencyAge === 'u30' ? 'Within 30 Days'
                : filters.pendencyAge === 'o30' ? 'Within 2 Months'
                : filters.pendencyAge === 'o60' ? 'Over 2 Months'
                : filters.pendencyAge === 'missing' ? 'Date Not Found'
                : filters.pendencyAge
              }</span>}
              {filters.disposalAge    && <span className="drawer-badge age">Disp Age: {
                filters.disposalAge === 'u7' ? 'Within 7 Days'
                : filters.disposalAge === 'u15' ? 'Within 15 Days'
                : filters.disposalAge === 'u30' ? 'Within 30 Days'
                : filters.disposalAge === 'o30' ? 'Within 2 Months'
                : filters.disposalAge === 'o60' ? 'Over 2 Months'
                : filters.disposalAge
              }</span>}
            </div>

            <button className="drawer-btn-export" onClick={handleExportCSV} disabled={!records.length} title="Export current page as CSV">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              <span>Export CSV</span>
            </button>

            <button className="drawer-close-btn" onClick={onClose} aria-label="Close">
              <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Search bar ───────────────────────────────────────────── */}
        <div className="drawer-search-bar">
          <div className="drawer-search-input-wrap">
            <svg className="drawer-search-icon" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              className="drawer-search-input"
              type="text"
              placeholder="Search across all records — complaint no., name, mobile, district…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button className="drawer-search-clear" onClick={() => setSearchQuery('')} title="Clear search">
                <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="drawer-search-meta">
            {debouncedSearch && !isLoading && (
              <span className="drawer-search-tag">
                "{debouncedSearch}" · {totalCount.toLocaleString()} results across all records
              </span>
            )}
            {isFetching && !isLoading && (
              <span className="drawer-fetching-indicator">
                <svg className="drawer-spin" width="14" height="14" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity=".25" />
                  <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity=".75" />
                </svg>
                Searching…
              </span>
            )}
          </div>
        </div>

        {/* ── Table ────────────────────────────────────────────────── */}
        <div className="drawer-table-wrap">
          {isLoading ? (
            <div className="drawer-loading">
              <svg className="drawer-spin" width="32" height="32" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity=".25" />
                <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" opacity=".75" />
              </svg>
              <span>Loading complaints…</span>
            </div>
          ) : records.length === 0 ? (
            <div className="drawer-empty">
              <svg width="48" height="48" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p>No records found for the selected filters.</p>
              {debouncedSearch && <span>Try a different search term or clear the search.</span>}
            </div>
          ) : (
            <table className="drawer-table" style={{ minWidth: ALL_COLS.reduce((s, c) => s + c.width, 0) }}>
              <thead>
                <tr>
                  {ALL_COLS.map(col => {
                    const isLastFrozen = col.frozen && col.key === FROZEN[FROZEN.length - 1].key;
                    return (
                      <th
                        key={col.key}
                        className={[
                          col.frozen ? 'frozen-col' : '',
                          isLastFrozen ? 'frozen-last' : '',
                        ].filter(Boolean).join(' ')}
                        style={{
                          width: col.width,
                          minWidth: col.width,
                          ...(col.frozen ? {
                            position: 'sticky',
                            left: frozenLeft(col.key),
                          } : {}),
                        }}
                      >
                        {col.label}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {records.map((r: any, i: number) => {
                  const { bg, color } = statusStyle(r.statusGroup || '');
                  const rowNum = (page - 1) * limit + i + 1;
                  return (
                    <tr key={r.id ?? i} className="drawer-table-row">
                      {ALL_COLS.map(col => {
                        const isLastFrozen = col.frozen && col.key === FROZEN[FROZEN.length - 1].key;
                        // Build className — CSS handles the solid opaque backgrounds per row stripe
                        const cellClass = [
                          col.frozen ? 'frozen-col' : '',
                          isLastFrozen ? 'frozen-last' : '',
                        ].filter(Boolean).join(' ') || undefined;
                        // Only sticky positioning goes inline; background is fully handled by CSS
                        const cellStyle: React.CSSProperties = col.frozen ? {
                          position: 'sticky',
                          left: frozenLeft(col.key),
                          zIndex: 1,
                        } : {};

                        let content: React.ReactNode = r[col.key] ?? '—';

                        if (col.key === '#') content = <span className="drawer-cell-muted">{rowNum}</span>;
                        else if (col.key === 'complRegNum') content = <span className="drawer-reg-num">{r.complRegNum || '—'}</span>;
                        else if (col.key === 'complRegDt' || col.key === 'incidentFromDt' || col.key === 'incidentToDt' || col.key === 'disposalDate')
                          content = <span className="drawer-cell-muted">{fmtDate(r[col.key])}</span>;
                        else if (col.key === 'createdAt' || col.key === 'updatedAt')
                          content = <span className="drawer-cell-muted">{fmtDateTime(r[col.key])}</span>;
                        else if (col.key === 'statusGroup')
                          content = <span className="drawer-status-badge" style={{ background: bg, color }}>{r.statusGroup || '—'}</span>;
                        else if (col.key === 'statusOfComplaint')
                          content = <span className="drawer-status-badge" style={{ background: bg, color }}>{r.statusOfComplaint || '—'}</span>;
                        else if (col.key === 'isDisposedMissingDate')
                          content = <span style={{ color: r.isDisposedMissingDate ? '#f87171' : '#64748b' }}>{r.isDisposedMissingDate ? 'Yes' : 'No'}</span>;
                        else if (col.key === 'complDesc')
                          content = <div style={{ maxHeight: 80, overflowY: 'auto', fontSize: 11, lineHeight: 1.5 }}>{r.complDesc || '—'}</div>;
                        else if (r[col.key] == null || r[col.key] === '')
                          content = <span className="drawer-cell-muted">—</span>;

                        return <td key={col.key} className={cellClass} style={cellStyle}>{content}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Pagination ───────────────────────────────────────────── */}
        {!isLoading && totalCount > 0 && (
          <div className="drawer-pagination">
            <span className="drawer-pagination-info">
              Page <strong>{page}</strong> of <strong>{totalPages}</strong>
              {' · '}
              <strong>{(page - 1) * limit + 1}–{Math.min(page * limit, totalCount)}</strong> of <strong>{totalCount.toLocaleString()}</strong>
            </span>

            <div className="drawer-pagination-controls">
              <button className="drawer-page-btn" onClick={() => setPage(1)} disabled={page === 1} title="First">«</button>
              <button className="drawer-page-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} title="Prev">‹</button>

              {/* Smart page window */}
              {(() => {
                const window = 5;
                let start = Math.max(1, page - Math.floor(window / 2));
                let end   = Math.min(totalPages, start + window - 1);
                if (end - start + 1 < window) start = Math.max(1, end - window + 1);
                const pages: number[] = [];
                for (let p = start; p <= end; p++) pages.push(p);
                return (
                  <>
                    {start > 1 && <span className="drawer-page-ellipsis">…</span>}
                    {pages.map(pg => (
                      <button key={pg} className={`drawer-page-btn${pg === page ? ' active' : ''}`} onClick={() => setPage(pg)}>{pg}</button>
                    ))}
                    {end < totalPages && <span className="drawer-page-ellipsis">…</span>}
                  </>
                );
              })()}

              <button className="drawer-page-btn" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} title="Next">›</button>
              <button className="drawer-page-btn" onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Last">»</button>

              {/* Go to page */}
              {totalPages > 5 && (
                <div className="drawer-goto">
                  <span className="drawer-goto-label">Go to</span>
                  <input
                    className="drawer-goto-input"
                    type="number"
                    min={1}
                    max={totalPages}
                    value={gotoInput}
                    onChange={e => setGotoInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleGoto(); }}
                    placeholder="pg"
                  />
                  <button className="drawer-goto-btn" onClick={handleGoto}>Go</button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ComplaintsDrawer;
