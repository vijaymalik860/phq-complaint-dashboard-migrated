import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/layout/Layout';
import { ChartCard } from '@/components/charts/ChartCard';
import { DataTable, Column } from '@/components/data/DataTable';
import { getDistrictBarOptions, getStackedBarOptions } from '@/components/charts/Charts';
import { dashboardApi } from '@/services/api';
import { useFilters } from '@/contexts/FilterContext';

// ─── Reusable Sort Dropdown ───────────────────────────────────────────────────

type SortOption = { label: string; value: string };

const SortDropdown = ({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (val: string) => void;
  options: SortOption[];
}) => {
  const [open, setOpen] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const isMobile = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleMouseLeave = () => {
    if (isMobile) return;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setOpen(false);
    }, 100);
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
    <div
      ref={ref}
      style={{ position: 'relative' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button className="chart-expand-btn" title="Sort Options" onClick={handleClick}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="10" y1="18" x2="14" y2="18" />
        </svg>
        <span>Sort</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: 4,
          backgroundColor: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          boxShadow: 'var(--shadow-md)',
          zIndex: 9999,
          minWidth: 190,
          padding: '4px 0',
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                padding: '7px 14px',
                fontSize: 12,
                cursor: 'pointer',
                color: value === opt.value ? 'var(--primary)' : 'var(--text-secondary)',
                fontWeight: value === opt.value ? 600 : 400,
                backgroundColor: value === opt.value ? 'var(--bg-hover)' : 'transparent',
              }}
              onMouseEnter={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (value !== opt.value) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent'; }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = 'pending' | 'total' | 'disposed' | 'pendPct' | 'az' | 'za';

function sortRows<T extends { pending: number; total: number; disposed: number; pendPct: number }>(
  rows: (T & { district?: string; category?: string })[],
  key: SortKey,
): (T & { district?: string; category?: string })[] {
  return [...rows].sort((a, b) => {
    switch (key) {
      case 'pending': return b.pending - a.pending;
      case 'total': return b.total - a.total;
      case 'disposed': return b.disposed - a.disposed;
      case 'pendPct': return b.pendPct - a.pendPct;
      case 'az': {
        const la = String(a.district ?? a.category ?? '');
        const lb = String(b.district ?? b.category ?? '');
        return la.localeCompare(lb);
      }
      case 'za': {
        const la = String(a.district ?? a.category ?? '');
        const lb = String(b.district ?? b.category ?? '');
        return lb.localeCompare(la);
      }
      default: return 0;
    }
  });
}

const SORT_OPTIONS: SortOption[] = [
  { label: 'By Total ↓', value: 'total' },
  { label: 'By Pending ↓', value: 'pending' },
  { label: 'By Disposed ↓', value: 'disposed' },
  { label: 'By Pend % ↓', value: 'pendPct' },
  { label: 'A → Z', value: 'az' },
  { label: 'Z → A', value: 'za' },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export const HotspotsPage = () => {
  const { filters } = useFilters();
  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''));

  const [districtSort, setDistrictSort] = useState<SortKey>('total');
  const [categorySort, setCategorySort] = useState<SortKey>('total');
  const [districtTableSort, setDistrictTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);
  const [categoryTableSort, setCategoryTableSort] = useState<{ key: string; dir: 'asc' | 'desc' | null } | null>(null);

  const districtColumnsList = [
    { key: 'district', label: 'District' },
    { key: 'total', label: 'Total' },
    { key: 'pending', label: 'Pending' },
    { key: 'disposed', label: 'Disposed' },
    { key: 'pendPct', label: 'Pending %' },
  ];

  const categoryColumnsList = [
    { key: 'category', label: 'Class of Incident' },
    { key: 'total', label: 'Total' },
    { key: 'pending', label: 'Pending' },
    { key: 'disposed', label: 'Disposed' },
    { key: 'pendPct', label: 'Pending %' },
  ];

  const getDistrictSubtitle = () => {
    if (districtTableSort && districtTableSort.key) {
      const col = districtColumnsList.find(c => c.key === districtTableSort.key);
      const dirArrow = districtTableSort.dir === 'asc' ? '↑' : districtTableSort.dir === 'desc' ? '↓' : '';
      return `sorted ${col?.label || districtTableSort.key} ${dirArrow}`;
    }
    return `sorted ${SORT_OPTIONS.find(o => o.value === districtSort)?.label || 'By Total ↓'}`;
  };

  const getCategorySubtitle = () => {
    if (categoryTableSort && categoryTableSort.key) {
      const col = categoryColumnsList.find(c => c.key === categoryTableSort.key);
      const dirArrow = categoryTableSort.dir === 'asc' ? '↑' : categoryTableSort.dir === 'desc' ? '↓' : '';
      return `sorted ${col?.label || categoryTableSort.key} ${dirArrow}`;
    }
    return `sorted ${SORT_OPTIONS.find(o => o.value === categorySort)?.label || 'By Total ↓'}`;
  };

  const { data: dd, isLoading: dl } = useQuery({
    queryKey: ['dashboard', 'district', activeFilters],
    queryFn: () => dashboardApi.districtWise(activeFilters),
  });

  const { data: cd, isLoading: cl } = useQuery({
    queryKey: ['dashboard', 'category', activeFilters],
    queryFn: () => dashboardApi.categoryWise(activeFilters),
  });

  // All rows enriched with pendPct
  const rawDistrictRows = useMemo(
    () =>
      ((dd?.data || []) as any[]).map(r => ({
        ...r,
        pendPct: r.total > 0 ? Math.round((r.pending / r.total) * 100) : 0,
      })),
    [dd],
  );

  const rawCategoryRows = useMemo(
    () =>
      ((cd?.data || []) as any[]).map(r => ({
        ...r,
        pendPct: r.total > 0 ? Math.round((r.pending / r.total) * 100) : 0,
      })),
    [cd],
  );

  // Sorted full datasets — used for both chart preview and table
  const sortedDistrictRows = useMemo(
    () => sortRows(rawDistrictRows, districtSort),
    [rawDistrictRows, districtSort],
  );

  const sortedCategoryRows = useMemo(
    () => sortRows(rawCategoryRows, categorySort),
    [rawCategoryRows, categorySort],
  );

  // ── Column definitions ────────────────────────────────────────────────────

  const districtCols: Column<any>[] = [
    { key: 'district', label: 'District', sortable: true },
    { key: 'total', label: 'Total', sortable: true, align: 'right' },
    { key: 'pending', label: 'Pending', sortable: true, align: 'right' },
    { key: 'disposed', label: 'Disposed', sortable: true, align: 'right' },
    { key: 'pendPct', label: 'Pending %', sortable: true, align: 'center' },
  ];

  const categoryCols: Column<any>[] = [
    { key: 'category', label: 'Class of Incident', sortable: true },
    { key: 'total', label: 'Total', sortable: true, align: 'right' },
    { key: 'pending', label: 'Pending', sortable: true, align: 'right' },
    { key: 'disposed', label: 'Disposed', sortable: true, align: 'right' },
    { key: 'pendPct', label: 'Pending %', sortable: true, align: 'center' },
  ];

  const renderDistrictRow = (c: Column<any>, row: any) => {
    if (c.key === 'district') return <span style={{ fontWeight: 500, fontSize: '13px' }}>{String(row.district)}</span>;
    if (c.key === 'total') return <span style={{ fontWeight: 600 }}>{row.total.toLocaleString()}</span>;
    if (c.key === 'pending') return <span style={{ color: '#fbbf24', fontWeight: 500 }}>{row.pending.toLocaleString()}</span>;
    if (c.key === 'disposed') return <span style={{ color: '#34d399', fontWeight: 500 }}>{row.disposed.toLocaleString()}</span>;
    if (c.key === 'pendPct') return <span className="status-badge pending">{row.pendPct}%</span>;
    return String(row[c.key] ?? '-');
  };

  const renderCategoryRow = (c: Column<any>, row: any) => {
    if (c.key === 'category') return <span style={{ fontWeight: 500, fontSize: '13px' }}>{String(row.category)}</span>;
    if (c.key === 'total') return <span style={{ fontWeight: 600 }}>{row.total.toLocaleString()}</span>;
    if (c.key === 'pending') return <span style={{ color: '#fbbf24', fontWeight: 500 }}>{row.pending.toLocaleString()}</span>;
    if (c.key === 'disposed') return <span style={{ color: '#34d399', fontWeight: 500 }}>{row.disposed.toLocaleString()}</span>;
    if (c.key === 'pendPct') return <span className="status-badge pending">{row.pendPct}%</span>;
    return String(row[c.key] ?? '-');
  };

  // Chart previews — top 25 of sorted, reversed so the bar chart reads highest at top
  const districtChartData = sortedDistrictRows.slice(0, 25).reverse();
  const categoryChartData = sortedCategoryRows.slice(0, 25).reverse();

  return (
    <Layout>
      <div className="page-content">
        {dl || cl ? (
          <div className="loading-spinner">
            <svg width="28" height="28" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          </div>
        ) : (
          <>
            {/* ── Charts Row ─────────────────────────────────────────────────── */}
            <div className="charts-grid" style={{ gap: '16px', marginBottom: '24px' }}>
              <ChartCard
                title="District-wise Hotspots"
                subtitle={getDistrictSubtitle()}
                option={getDistrictBarOptions(districtChartData)}
                fullOption={getDistrictBarOptions([...sortedDistrictRows].reverse())}
                height="320px"
                actions={
                  <div className="chart-actions">
                    <SortDropdown
                      value={districtSort}
                      onChange={v => setDistrictSort(v as SortKey)}
                      options={SORT_OPTIONS}
                    />
                  </div>
                }
              />
              <ChartCard
                title="Class of Incident Hotspots"
                subtitle={getCategorySubtitle()}
                option={getStackedBarOptions(categoryChartData)}
                fullOption={getStackedBarOptions([...sortedCategoryRows].reverse())}
                height="320px"
                actions={
                  <div className="chart-actions">
                    <SortDropdown
                      value={categorySort}
                      onChange={v => setCategorySort(v as SortKey)}
                      options={SORT_OPTIONS}
                    />
                  </div>
                }
              />
            </div>

            {/* ── Full Tables ────────────────────────────────────────────────── */}
            <div className="highlights-tables-grid">

              {/* District table — ALL rows, DataTable handles sort/search/expand */}
              <div className="highlights-section">
                <div className="highlights-section-header">
                  <div>
                    <h3 className="highlights-section-title">District-wise Hotspots</h3>
                    <span className="highlights-section-meta">
                      {sortedDistrictRows.length} districts · {getDistrictSubtitle()}
                    </span>
                  </div>
                </div>
                <DataTable
                  title="District-wise Hotspots"
                  data={sortedDistrictRows}
                  columns={districtCols.map(c => ({
                    ...c,
                    render: (row) => renderDistrictRow(c, row),
                  }))}
                  maxHeight="none"
                  defaultLimit={5}
                  onSort={(key, dir) => key ? setDistrictTableSort({ key, dir }) : setDistrictTableSort(null)}
                  showTotalRow={true}
                  getTotalRow={(data) => {
                    const totals = data.reduce<Record<string, number>>((acc, r) => ({
                      total: acc.total + Number(r.total || 0),
                      pending: acc.pending + Number(r.pending || 0),
                      disposed: acc.disposed + Number(r.disposed || 0),
                    }), { total: 0, pending: 0, disposed: 0 });
                    const grandTotal = totals.total || 1;
                    return {
                      district: '',
                      total: totals.total.toLocaleString(),
                      pending: totals.pending.toLocaleString(),
                      disposed: totals.disposed.toLocaleString(),
                      pendPct: ((totals.pending / grandTotal) * 100).toFixed(1) + '%',
                    };
                  }}
                />
              </div>

              {/* Category table — ALL rows */}
              <div className="highlights-section">
                <div className="highlights-section-header">
                  <div>
                    <h3 className="highlights-section-title">Class of Incident Hotspots</h3>
                    <span className="highlights-section-meta">
                      {sortedCategoryRows.length} categories · {getCategorySubtitle()}
                    </span>
                  </div>
                </div>
                <DataTable
                  title="Class of Incident Hotspots"
                  data={sortedCategoryRows}
                  columns={categoryCols.map(c => ({
                    ...c,
                    render: (row) => renderCategoryRow(c, row),
                  }))}
                  maxHeight="none"
                  defaultLimit={5}
                  onSort={(key, dir) => key ? setCategoryTableSort({ key, dir }) : setCategoryTableSort(null)}
                  showTotalRow={true}
                  getTotalRow={(data) => {
                    const totals = data.reduce<Record<string, number>>((acc, r) => ({
                      total: acc.total + Number(r.total || 0),
                      pending: acc.pending + Number(r.pending || 0),
                      disposed: acc.disposed + Number(r.disposed || 0),
                    }), { total: 0, pending: 0, disposed: 0 });
                    const grandTotal = totals.total || 1;
                    return {
                      category: '',
                      total: totals.total.toLocaleString(),
                      pending: totals.pending.toLocaleString(),
                      disposed: totals.disposed.toLocaleString(),
                      pendPct: ((totals.pending / grandTotal) * 100).toFixed(1) + '%',
                    };
                  }}
                />
              </div>

            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default HotspotsPage;
