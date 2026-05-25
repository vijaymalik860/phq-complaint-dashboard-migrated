import { useState, useRef, useEffect, useMemo } from 'react';
import { useFilters } from '../../contexts/FilterContext';
import { useQuery } from '@tanstack/react-query';
import { referenceApi } from '../../services/api';

type Option = { id: string; label: string };
const parseCsv = (v: string) => v.split(',').map(s => s.trim()).filter(Boolean);

// ── Icons ─────────────────────────────────────────────────────────────────────
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
    style={{ transition: 'transform 0.2s', transform: open ? 'rotate(180deg)' : 'rotate(0deg)', flexShrink: 0 }}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);
const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);
const CalIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
    <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
    <line x1="3" y1="10" x2="21" y2="10"/>
  </svg>
);

// ── MultiSelect dropdown ───────────────────────────────────────────────────────
const MultiSelectDropdown = ({
  label, icon, isOpen, toggle, allLabel, selectedIds, items,
  onAllClick, onToggleItem, disabled, disabledHint, onMouseEnter, onMouseLeave, loading,
}: {
  label: string; icon?: React.ReactNode; isOpen: boolean; toggle: () => void;
  allLabel: string; selectedIds: string[]; items: Option[];
  onAllClick: () => void; onToggleItem: (id: string) => void;
  disabled?: boolean; disabledHint?: string;
  onMouseEnter?: () => void; onMouseLeave?: () => void; loading?: boolean;
}) => {
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const count = selectedIds.length;

  useEffect(() => {
    if (isOpen) { setSearch(''); setTimeout(() => searchRef.current?.focus(), 60); }
  }, [isOpen]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? items.filter(i => i.label.toLowerCase().includes(q)) : items;
  }, [items, search]);

  const displayText = disabled
    ? (disabledHint ?? allLabel)
    : count === 0 ? allLabel
    : count === 1 ? (items.find(i => i.id === selectedIds[0])?.label ?? `1 selected`)
    : `${count} selected`;

  const hasValue = !disabled && count > 0;

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => { if (!disabled) toggle(); }}
        disabled={disabled}
        title={disabled ? (disabledHint ?? '') : ''}
        onMouseEnter={e => {
          if (disabled) return;
          const el = e.currentTarget;
          if (!hasValue && !isOpen) {
            el.style.background = 'rgba(99,102,241,0.1)';
            el.style.borderColor = '#475569';
            el.style.color = '#e2e8f0';
          }
        }}
        onMouseLeave={e => {
          if (disabled) return;
          const el = e.currentTarget;
          if (!hasValue && !isOpen) {
            el.style.background = 'rgba(255,255,255,0.05)';
            el.style.borderColor = '#2d3f55';
            el.style.color = '#cbd5e1';
          }
        }}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 11px', cursor: disabled ? 'not-allowed' : 'pointer',
          background: hasValue
            ? 'linear-gradient(135deg,rgba(99,102,241,0.22),rgba(139,92,246,0.16))'
            : isOpen
              ? 'var(--bg-hover)'
              : 'var(--bg-input)',
          border: hasValue
            ? '1px solid rgba(99,102,241,0.65)'
            : isOpen
              ? '1px solid var(--primary-light)'
              : '1px solid var(--border)',
          borderRadius: 8,
          color: hasValue ? 'var(--primary-light)' : isOpen ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: 12, fontWeight: hasValue ? 600 : 500,
          whiteSpace: 'nowrap', minWidth: 108, maxWidth: 185,
          transition: 'all 0.18s', outline: 'none',
          opacity: disabled ? 0.4 : 1,
          boxShadow: hasValue
            ? '0 0 0 1px rgba(99,102,241,0.25),0 2px 10px rgba(99,102,241,0.2)'
            : isOpen
              ? '0 0 0 1px rgba(99,102,241,0.15)'
              : 'none',
        }}
      >
        <span style={{ color: hasValue ? 'var(--primary-light)' : isOpen ? 'var(--primary)' : 'var(--text-muted)', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', textAlign: 'left' }}>{displayText}</span>
        {loading && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
            style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0, color: 'var(--text-muted)' }}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.3"/>
            <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
        )}
        {count > 0 && !loading && (
          <span style={{
            background: 'linear-gradient(135deg,rgba(99,102,241,0.5),rgba(139,92,246,0.4))',
            color: '#e0d9ff', borderRadius: 10, padding: '1px 6px',
            fontSize: 10, fontWeight: 700, flexShrink: 0,
            boxShadow: '0 1px 4px rgba(99,102,241,0.3)',
          }}>{count}</span>
        )}
        <ChevronIcon open={isOpen} />
      </button>

      {/* Dropdown panel */}
      {isOpen && !disabled && (
        <div
          onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0,
            minWidth: 240, maxWidth: 320,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10, zIndex: 9999,
            boxShadow: 'var(--shadow-lg)',
            overflow: 'hidden',
          }}
        >
          {/* Search */}
          <div style={{ padding: '8px 8px 6px', borderBottom: '1px solid var(--border)', background: 'var(--bg-dark)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6,
              background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2.5">
                <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
              </svg>
              <input ref={searchRef} type="text" value={search} onChange={e => setSearch(e.target.value)}
                placeholder={`Search ${label.toLowerCase()}…`}
                onMouseDown={e => e.stopPropagation()}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none',
                  fontSize: 12, color: 'var(--text-primary)', minWidth: 0 }}
              />
            </div>
          </div>

          {/* List */}
          <div style={{ maxHeight: 240, overflowY: 'auto' }}>
            {!search && (
              <div onClick={onAllClick} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px',
                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                color: count === 0 ? 'var(--primary)' : 'var(--text-muted)',
                borderBottom: '1px solid var(--border)',
                background: count === 0 ? 'rgba(99,102,241,0.08)' : 'transparent',
                transition: 'background 0.15s',
              }}
                onMouseEnter={e => { if (count !== 0) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = count === 0 ? 'rgba(99,102,241,0.08)' : 'transparent'; }}
              >
                <span style={{
                  width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: count === 0 ? '2px solid var(--primary)' : '2px solid var(--border)',
                  background: count === 0 ? 'var(--primary)' : 'transparent',
                }}>{count === 0 && <CheckIcon />}</span>
                {allLabel}
              </div>
            )}
            {filtered.length === 0 ? (
              <div style={{ padding: '12px 12px', color: 'var(--text-muted)', fontSize: 11, textAlign: 'center' }}>
                No results for "{search}"
              </div>
            ) : filtered.map(item => {
              const sel = selectedIds.includes(item.id);
              return (
                <div key={item.id} onClick={() => onToggleItem(item.id)} style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
                  cursor: 'pointer', fontSize: 12,
                  color: sel ? 'var(--primary-dark)' : 'var(--text-primary)',
                  background: sel ? 'rgba(99,102,241,0.1)' : 'transparent',
                  transition: 'background 0.12s',
                }}
                  onMouseEnter={e => { if (!sel) (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = sel ? 'rgba(99,102,241,0.1)' : 'transparent'; }}
                >
                  <span style={{
                    width: 14, height: 14, borderRadius: 4, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: sel ? '2px solid var(--primary)' : '2px solid var(--border)',
                    background: sel ? 'var(--primary)' : 'transparent', transition: 'all 0.15s',
                  }}>{sel && <CheckIcon />}</span>
                  {item.label}
                </div>
              );
            })}
          </div>

          {count > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: '5px 10px', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={onAllClick} style={{
                background: 'none', border: 'none', color: '#ef4444', fontSize: 11,
                cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
              }}>Clear {count} selected</button>
            </div>
          )}
        </div>
      )}
    </>
  );
};


// ── Icons for each filter ──────────────────────────────────────────────────────
const DistrictIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/>
  </svg>
);
const PSIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
  </svg>
);
const OfficeIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/>
  </svg>
);
const ClassIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M4 6h16M4 12h16M4 18h7"/>
  </svg>
);

// ── Main Component ─────────────────────────────────────────────────────────────
export const GlobalFilterBar = () => {
  const { filters, setFilter, resetFilters } = useFilters();
  const [districtOpen, setDistrictOpen] = useState(false);
  const [stationOpen,  setStationOpen]  = useState(false);
  const [officeOpen,   setOfficeOpen]   = useState(false);
  const [classOpen,    setClassOpen]    = useState(false);

  const districtRef = useRef<HTMLDivElement>(null);
  const stationRef  = useRef<HTMLDivElement>(null);
  const officeRef   = useRef<HTMLDivElement>(null);
  const classRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (districtRef.current && !districtRef.current.contains(e.target as Node)) setDistrictOpen(false);
      if (stationRef.current  && !stationRef.current.contains(e.target as Node))  setStationOpen(false);
      if (officeRef.current   && !officeRef.current.contains(e.target as Node))   setOfficeOpen(false);
      if (classRef.current    && !classRef.current.contains(e.target as Node))    setClassOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectedDistrictIds  = parseCsv(filters.districtIds);
  const selectedStationIds   = parseCsv(filters.policeStationIds);
  const selectedOfficeIds    = parseCsv(filters.officeIds);
  const selectedClassValues  = parseCsv(filters.classOfIncident);

  const toggleCsv = (sel: string[], val: string) =>
    sel.includes(val) ? sel.filter(v => v !== val) : [...sel, val];

  // Reference data
  const { data: districts } = useQuery({
    queryKey: ['filter-districts'],
    queryFn: () => referenceApi.districts(),
    staleTime: 10 * 60 * 1000,
  });
  const { data: policeStations, isLoading: psLoading } = useQuery({
    queryKey: ['filter-police-stations', filters.districtIds],
    queryFn: () => referenceApi.policeStations(filters.districtIds || undefined),
    staleTime: 5 * 60 * 1000,
  });
  const { data: offices, isLoading: officeLoading } = useQuery({
    queryKey: ['filter-offices'],
    queryFn: () => referenceApi.offices(),
    staleTime: 5 * 60 * 1000,
  });
  const { data: classes, isLoading: classLoading } = useQuery({
    queryKey: ['filter-class-of-incident'],
    queryFn: () => referenceApi.crimeCategory(),
    staleTime: 10 * 60 * 1000,
  });

  const districtOptions = useMemo<Option[]>(() =>
    (districts?.data || []).map((d: any) => ({ id: String(d.id), label: String(d.name) })), [districts]);
  const stationOptions  = useMemo<Option[]>(() =>
    (policeStations?.data || []).map((ps: any) => ({ id: String(ps.id), label: String(ps.name) })), [policeStations]);
  const officeOptions   = useMemo<Option[]>(() =>
    (offices?.data || []).map((o: any) => ({ id: String(o.id), label: String(o.name) })), [offices]);
  const classOptions    = useMemo<Option[]>(() =>
    (classes?.data || [])
      .filter((v: unknown): v is string => typeof v === 'string' && v.trim().length > 0)
      .map((v: string) => ({ id: v, label: v })),
    [classes]
  );

  // Cascade prune
  useEffect(() => {
    if (!selectedStationIds.length) return;
    const valid = new Set(stationOptions.map(i => i.id));
    const pruned = selectedStationIds.filter(id => valid.has(id));
    if (pruned.length !== selectedStationIds.length) setFilter('policeStationIds', pruned.join(','));
  }, [filters.districtIds, stationOptions]); // eslint-disable-line

  useEffect(() => {
    if (!selectedOfficeIds.length) return;
    const valid = new Set(officeOptions.map(i => i.id));
    const pruned = selectedOfficeIds.filter(id => valid.has(id));
    if (pruned.length !== selectedOfficeIds.length) setFilter('officeIds', pruned.join(','));
  }, [officeOptions]); // eslint-disable-line

  const closeAll = () => { setDistrictOpen(false); setStationOpen(false); setOfficeOpen(false); setClassOpen(false); };

  const hasAnyFilter = selectedDistrictIds.length > 0 || selectedStationIds.length > 0 ||
    selectedOfficeIds.length > 0 || selectedClassValues.length > 0 ||
    filters.fromDate || filters.toDate;

  const totalActiveFilters = selectedDistrictIds.length + selectedStationIds.length +
    selectedOfficeIds.length + selectedClassValues.length +
    (filters.fromDate ? 1 : 0) + (filters.toDate ? 1 : 0);

  return (
    <div className="global-filter-bar">

      {/* ── Date Range ─────────────────────────────────────────────────────── */}
      <div className="filter-group" style={{ gap: 6 }}>
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}><CalIcon /></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="date" value={filters.fromDate}
            onChange={e => setFilter('fromDate', e.target.value)}
            onClick={e => 'showPicker' in HTMLInputElement.prototype && (e.currentTarget as any).showPicker()}
            className="filter-input date-input"
            style={{ cursor: 'pointer' }}
          />
          <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>→</span>
          <input type="date" value={filters.toDate}
            onChange={e => setFilter('toDate', e.target.value)}
            onClick={e => 'showPicker' in HTMLInputElement.prototype && (e.currentTarget as any).showPicker()}
            className="filter-input date-input"
            style={{ cursor: 'pointer' }}
          />
        </div>
        {(filters.fromDate || filters.toDate) && (
          <button onClick={() => { setFilter('fromDate',''); setFilter('toDate',''); }}
            style={{ background:'none',border:'none',color:'var(--text-muted)',cursor:'pointer',fontSize:14,padding:'0 2px',lineHeight:1 }}>
            ×
          </button>
        )}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 20, background: 'var(--border)', flexShrink: 0 }} />

      {/* ── District ───────────────────────────────────────────────────────── */}
      <div ref={districtRef} className="filter-group" style={{ position: 'relative' }}
        onMouseEnter={() => { closeAll(); setDistrictOpen(true); }}>
        <span className="filter-group-label">District</span>
        <MultiSelectDropdown
          label="District" icon={<DistrictIcon />}
          isOpen={districtOpen} toggle={() => { closeAll(); setDistrictOpen(true); }}
          allLabel="All Districts" selectedIds={selectedDistrictIds} items={districtOptions}
          onAllClick={() => { setFilter('districtIds',''); setFilter('policeStationIds',''); }}
          onToggleItem={id => setFilter('districtIds', toggleCsv(selectedDistrictIds, id).join(','))}
          onMouseEnter={() => setDistrictOpen(true)}
          onMouseLeave={() => setTimeout(() => setDistrictOpen(false), 400)}
        />
      </div>

      {/* ── Police Station ─────────────────────────────────────────────────── */}
      <div ref={stationRef} className="filter-group" style={{ position: 'relative' }}
        onMouseEnter={() => { closeAll(); setStationOpen(true); }}>
        <span className="filter-group-label">PS</span>
        <MultiSelectDropdown
          label="Police Station" icon={<PSIcon />}
          isOpen={stationOpen} toggle={() => { closeAll(); setStationOpen(true); }}
          allLabel={selectedDistrictIds.length ? 'All in District' : 'All Stations'}
          selectedIds={selectedStationIds} items={stationOptions} loading={psLoading}
          onAllClick={() => { setFilter('policeStationIds',''); }}
          onToggleItem={id => setFilter('policeStationIds', toggleCsv(selectedStationIds, id).join(','))}
          onMouseEnter={() => setStationOpen(true)}
          onMouseLeave={() => setTimeout(() => setStationOpen(false), 400)}
        />
      </div>

      {/* ── Office ─────────────────────────────────────────────────────────── */}
      <div ref={officeRef} className="filter-group" style={{ position: 'relative' }}
        onMouseEnter={() => { closeAll(); setOfficeOpen(true); }}>
        <span className="filter-group-label">Office</span>
        <MultiSelectDropdown
          label="Office" icon={<OfficeIcon />}
          isOpen={officeOpen} toggle={() => { closeAll(); setOfficeOpen(true); }}
          allLabel="All Offices"
          selectedIds={selectedOfficeIds} items={officeOptions} loading={officeLoading}
          onAllClick={() => setFilter('officeIds','')}
          onToggleItem={id => setFilter('officeIds', toggleCsv(selectedOfficeIds, id).join(','))}
          onMouseEnter={() => setOfficeOpen(true)}
          onMouseLeave={() => setTimeout(() => setOfficeOpen(false), 400)}
        />
      </div>

      {/* ── Class of Incident ──────────────────────────────────────────────── */}
      <div ref={classRef} className="filter-group" style={{ position: 'relative' }}
        onMouseEnter={() => { closeAll(); setClassOpen(true); }}>
        <span className="filter-group-label">Class</span>
        <MultiSelectDropdown
          label="Class of Incident" icon={<ClassIcon />}
          isOpen={classOpen} toggle={() => { closeAll(); setClassOpen(true); }}
          allLabel="All Classes" selectedIds={selectedClassValues} items={classOptions}
          loading={classLoading}
          onAllClick={() => setFilter('classOfIncident','')}
          onToggleItem={v => setFilter('classOfIncident', toggleCsv(selectedClassValues, v).join(','))}
          onMouseEnter={() => setClassOpen(true)}
          onMouseLeave={() => setTimeout(() => setClassOpen(false), 400)}
        />
      </div>

      {/* ── Total active count pill + Reset ────────────────────────────────── */}
      {hasAnyFilter && (
        <>
          <div style={{ width: 1, height: 18, background: 'var(--border)', flexShrink: 0 }} />
          <span style={{
            fontSize: 10, fontWeight: 700, color: 'var(--primary)',
            background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 20, padding: '2px 8px', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
            {totalActiveFilters} active
          </span>
          <button onClick={resetFilters} style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)',
            color: '#f87171', fontSize: 11, fontWeight: 600, transition: 'all 0.2s',
          }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.18)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.08)'; }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
            Reset
          </button>
        </>
      )}
    </div>
  );
};
