import { useQuery } from '@tanstack/react-query';
import { useState, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Layout } from '@/components/layout/Layout';
import { Button } from '@/components/common/Button';
import { DataTable, Column } from '@/components/data/DataTable';
import { useFilters } from '@/contexts/FilterContext';
import * as XLSX from 'xlsx';

export const ComplaintsPage = () => {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Same pattern as Dashboard — global filters drive the data
  const { filters } = useFilters();
  const activeFilters = Object.fromEntries(
    Object.entries(filters).filter(([_, v]) => v !== '')
  ) as Record<string, string>;

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['complaints', page, limit, search, activeFilters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
        search,
        ...activeFilters,
      });
      const r = await fetch(`/api/complaints?${params}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      });
      return r.json();
    },
  });

  const complaints  = data?.data?.data || [];
  const pagination  = data?.data?.pagination || data?.pagination;

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const wb   = XLSX.read(new Uint8Array(ev.target?.result as ArrayBuffer), { type: 'array' });
        const data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
        await fetch('/api/import/complaints', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
          body: JSON.stringify(data),
        });
        refetch();
        alert('Import successful!');
      } catch { alert('Import failed'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const tableData = complaints.map((c: Record<string, unknown>) => ({
    regNum:   c.complRegNum || '-',
    district: String(c.districtName || c.addressDistrict || '-'),
    name:     `${c.firstName || ''} ${c.lastName || ''}`.trim(),
    mobile:   c.mobile || '-',
    date:     c.complRegDt ? new Date(String(c.complRegDt)).toLocaleDateString() : '-',
    status:   c.statusOfComplaint || 'Pending',
    id:       c.id,
  }));

  const cols: Column<typeof tableData[0]>[] = [
    { key: 'regNum',   label: 'Reg. No.',  sortable: true },
    { key: 'district', label: 'District',  sortable: true },
    { key: 'name',     label: 'Name',      sortable: true },
    { key: 'mobile',   label: 'Mobile',    sortable: true },
    { key: 'date',     label: 'Reg. Date', sortable: true },
    { key: 'status',   label: 'Status',    sortable: true },
    { key: 'action',   label: 'Action',    width: '60px' },
  ];

  // ── Top-level hook: fetch ALL complaints for export ───────────────────────
  const fetchAllComplaintsForExport = useCallback(async () => {
    const params = new URLSearchParams({
      page: '1',
      limit: String(pagination?.total || 9999),
      search,
      ...activeFilters,
    });
    const r = await fetch(`/api/complaints?${params}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
    });
    const json = await r.json();
    const allRows = (json?.data?.data || json?.data || []) as Record<string, unknown>[];
    return allRows.map((c) => ({
      regNum:   c.complRegNum || '-',
      district: String(c.districtName || c.addressDistrict || '-'),
      name:     `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      mobile:   c.mobile || '-',
      date:     c.complRegDt ? new Date(String(c.complRegDt)).toLocaleDateString() : '-',
      status:   c.statusOfComplaint || 'Pending',
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, JSON.stringify(activeFilters), pagination?.total]);

  const complaintsExportFilters = {
    ...(search ? { search } : {}),
    ...activeFilters,
  };

  return (
    <Layout>
      <div className="page-content">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px', gap: '12px' }}>
          <input
            className="search-input"
            placeholder="Search by name, mobile, reg. no..."
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            style={{ maxWidth: '280px' }}
          />
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            <input type="file" ref={fileInputRef} onChange={handleImport} accept=".xlsx,.xls" className="hidden" />
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>Import</Button>
            <Link to="/admin/complaints/add"><Button>Add</Button></Link>
          </div>
        </div>

        {isLoading ? (
          <div className="loading-spinner"><svg width="28" height="28" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg></div>
        ) : tableData.length === 0 ? (
          <div className="empty-state"><p>No complaints found</p></div>
        ) : (
          <DataTable
            title="All Complaints"
            data={tableData}
            columns={cols.map(c => ({
              ...c,
              render: (row) => {
                if (c.key === 'regNum') return <span style={{ fontWeight: 500 }}>{String(row.regNum)}</span>;
                if (c.key === 'status') {
                  const d = String(row.status).toLowerCase().includes('disposed');
                  return <span className={`status-badge ${d ? 'disposed' : 'pending'}`}>{String(row.status)}</span>;
                }
                if (c.key === 'action') {
                  return <Link to={`/admin/complaints/${row.id}`} style={{ color: '#a5b4fc', textDecoration: 'none', fontWeight: 500 }}>View</Link>;
                }
                return String(row[c.key as keyof typeof row] ?? '-');
              },
            }))}
            maxHeight="calc(100vh - 160px)"
            activeFilters={complaintsExportFilters}
            onFetchAllForExport={fetchAllComplaintsForExport}
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

export default ComplaintsPage;