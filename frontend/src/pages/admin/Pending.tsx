import { useQuery } from '@tanstack/react-query';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { DataTable } from '@/components/data/DataTable';
import { useFilters } from '@/contexts/FilterContext';

const tabs = [
  { id: 'all',           label: 'All Pending' },
  { id: 'under-7-days',  label: 'Within 7 Days' },
  { id: '7-14-days',     label: 'Within 14 Days' },
  { id: '15-30-days',    label: 'Within 30 Days' },
  { id: '30-60-days',    label: 'Within 2 Months' },
  { id: 'over-60-days',  label: 'Over 2 Months' },
  { id: 'branch',        label: 'By Branch' },
];


export const PendingPage = () => {
  const [sp, setSp] = useSearchParams();
  const type = sp.get('type') || 'all';
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [search, setSearch] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [branch, setBranch] = useState<string>('');

  // Same pattern as Dashboard
  const { filters } = useFilters();
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, v]) => v !== '')
  ) as Record<string, string>;

  // Reset page when tab changes
  useEffect(() => { setPage(1); }, [type, branch]);

  const hasDateFilter = Boolean(activeFilters.fromDate || activeFilters.toDate);

  // If global date filters are applied, force 'all' tab (since temporal tabs conflict)
  useEffect(() => {
    if (hasDateFilter && type !== 'all' && type !== 'branch') {
      const newSp = new URLSearchParams(sp);
      newSp.set('type', 'all');
      setSp(newSp, { replace: true });
    }
  }, [hasDateFilter, type, sp, setSp]);

  const { data: branchesData } = useQuery({
    queryKey: ['pending', 'branches'],
    queryFn: async () => {
      const r = await fetch('/api/pending/branches', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
      return r.json();
    },
    enabled: type === 'branch',
  });

  useEffect(() => {
    if (branchesData?.data) setBranches(branchesData.data);
  }, [branchesData]);

  const { data, isLoading } = useQuery({
    queryKey: ['pending', type, branch, page, limit, search, activeFilters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
        ...activeFilters,
      });

      if (type === 'branch' && branch) {
        const r = await fetch(
          `/api/pending/branch/${encodeURIComponent(branch)}?${params}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        );
        return r.json();
      } else if (type !== 'branch') {
        const r = await fetch(
          `/api/pending/${type}?${params}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } }
        );
        return r.json();
      }
      return { data: [], pagination: null };
    },
    enabled: type !== 'branch' || !!branch,
  });

  const rows = (data?.data?.data || data?.data || []) as Record<string, unknown>[];
  const pagination = data?.data?.pagination || data?.pagination;

  const tableData = useMemo(() => rows.map(r => ({
    regNum:   r.complRegNum || '-',
    district: r.districtName || r.addressDistrict || '-',
    name:     `${r.firstName || ''} ${r.lastName || ''}`.trim() || '-',
    mobile:   r.mobile || '-',
    date:     r.complRegDt ? new Date(String(r.complRegDt)).toLocaleDateString() : '-',
    status:   'Pending',
  })), [rows]);

  const cols = [
    { key: 'regNum',   label: 'Reg. No.',  sortable: true },
    { key: 'district', label: 'District',  sortable: true },
    { key: 'name',     label: 'Name',      sortable: true },
    { key: 'mobile',   label: 'Mobile',    sortable: true },
    { key: 'date',     label: 'Reg. Date', sortable: true },
    { key: 'status',   label: 'Status',    sortable: true },
  ];

  // ── Top-level hook: fetch ALL records for export ──────────────────────────
  const fetchAllPendingForExport = useCallback(async () => {
    const params = new URLSearchParams({
      page: '1',
      limit: String(pagination?.total || 9999),
      search,
      ...activeFilters,
    });
    const url = type === 'branch' && branch
      ? `/api/pending/branch/${encodeURIComponent(branch)}?${params}`
      : `/api/pending/${type}?${params}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    const json = await r.json();
    const allRows = (json?.data?.data || json?.data || []) as Record<string, unknown>[];
    return allRows.map(row => ({
      regNum:   row.complRegNum || '-',
      district: row.districtName || row.addressDistrict || '-',
      name:     `${row.firstName || ''} ${row.lastName || ''}`.trim() || '-',
      mobile:   row.mobile || '-',
      date:     row.complRegDt ? new Date(String(row.complRegDt)).toLocaleDateString() : '-',
      status:   'Pending',
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, branch, search, JSON.stringify(activeFilters), pagination?.total]);

  const pendingExportFilters = {
    tab: type,
    ...(search ? { search } : {}),
    ...(branch ? { branch } : {}),
    ...activeFilters,
  };

  return (
    <Layout>
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div className="tab-list" style={{ marginBottom: 0 }}>
            {tabs.map(t => {
              const isDisabled = hasDateFilter && t.id !== 'all' && t.id !== 'branch';
              return (
                <button 
                  key={t.id} 
                  onClick={() => {
                    if (isDisabled) return;
                    const newSp = new URLSearchParams(sp);
                    newSp.set('type', t.id);
                    setSp(newSp);
                  }}
                  className={`tab-item ${type === t.id ? 'active' : ''}`}
                  disabled={isDisabled}
                  title={isDisabled ? "Clear Global Date Range to use duration tabs" : ""}
                  style={isDisabled ? { background: 'none', border: 'none', cursor: 'not-allowed', opacity: 0.5, fontFamily: 'inherit', fontSize: 'inherit' } : { background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center' }}>
          <input
            className="search-input"
            placeholder="Search pending complaints..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ maxWidth: '280px' }}
          />
          {type === 'branch' && (
            <select
              value={branch}
              onChange={e => setBranch(e.target.value)}
              className="form-select"
              style={{ minWidth: '200px', width: 'auto' }}
            >
              <option value="">Select Branch</option>
              {branches.map(b => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          )}
        </div>

        {isLoading ? (
          <div className="loading-spinner"><svg width="28" height="28" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : tableData.length === 0 ? (
          <div className="empty-state"><p>No pending complaints</p></div>
        ) : (
          <DataTable
            title={`Pending Complaints - ${tabs.find(t => t.id === type)?.label || type}`}
            data={tableData}
            columns={cols.map(c => ({
              ...c,
              render: (row) => {
                if (c.key === 'regNum')  return <span style={{ fontWeight: 500 }}>{String(row.regNum)}</span>;
                if (c.key === 'status')  return <span className="status-badge pending">Pending</span>;
                return String(row[c.key as keyof typeof row] ?? '-');
              },
            }))}
            maxHeight="calc(100vh - 160px)"
            activeFilters={pendingExportFilters}
            onFetchAllForExport={fetchAllPendingForExport}
            pagination={pagination ? {
              page: pagination.page,
              limit,
              total: pagination.total,
              totalPages: pagination.totalPages,
              onPageChange: setPage,
              onLimitChange: (l) => { setLimit(l); setPage(1); }
            } : undefined}
          />
        )}
      </div>
    </Layout>
  );
};

export default PendingPage;
