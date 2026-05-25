import React, { useState, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export interface Column<T> {
  key: string;
  label: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
}

export interface PaginationProps {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onLimitChange: (limit: number) => void;
}

interface Props<T> {
  data: T[];
  columns: Column<T>[];
  maxHeight?: string;
  onRowClick?: (row: T) => void;
  title?: string;
  pagination?: PaginationProps;
  /** Optional: async function to fetch ALL records for export. If not provided, only current page is exported. */
  onFetchAllForExport?: () => Promise<Record<string, unknown>[]>;
  /** Optional: describe active filters as key-value pairs for export filename/sheet metadata */
  activeFilters?: Record<string, string>;
  /** Optional: default number of rows to show. If set, shows a toggle to show all/limited rows */
  defaultLimit?: number;
  /** Optional: when true, table expands to fill available space (used by ChartCard expand) */
  forceFullHeight?: boolean;
  /** Optional: true when parent ChartCard is in expanded mode */
  isCardExpanded?: boolean;
  /** Optional: hide the title bar completely (for use inside ChartCard) */
  hideTitleBar?: boolean;
  /** Optional: hide the expand button - ChartCard already has one */
  noExpand?: boolean;
  /** Optional: callback when table sort changes */
  onSort?: (key: string | null, direction: 'asc' | 'desc' | null) => void;
  /** Optional: show a total row at the bottom of the table */
  showTotalRow?: boolean;
  /** Optional: function to compute total row values */
  getTotalRow?: (data: T[]) => Record<string, React.ReactNode>;
  /** Optional: callback when search input changes (for server-side search) */
  onSearch?: (query: string) => void;
  /** Optional: current search query (for server-side search) */
  searchValue?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function sanitizeFilename(name: string) {
  return name.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, '_');
}

function buildFilename(title: string, filters: Record<string, string> | undefined, ext: string) {
  const parts = [title];
  if (filters) {
    const active = Object.entries(filters)
      .filter(([, v]) => v && v !== '')
      .map(([k, v]) => `${k}-${v}`)
      .join('_');
    if (active) parts.push(active);
  }
  parts.push(new Date().toISOString().slice(0, 10)); // YYYY-MM-DD
  return sanitizeFilename(parts.join('_')) + '.' + ext;
}

function rowToPlain<T extends Record<string, unknown>>(
  row: T,
  columns: Column<T>[]
): Record<string, string> {
  const obj: Record<string, string> = {};
  columns.forEach(col => {
    const val = row[col.key];
    obj[col.label] = val === null || val === undefined ? '-' : String(val);
  });
  return obj;
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  maxHeight = 'calc(100vh - 220px)',
  onRowClick,
  title = 'Data View',
  pagination,
  onFetchAllForExport,
  activeFilters,
  defaultLimit,
  noExpand = false,
  forceFullHeight = false,
  isCardExpanded = false,
  hideTitleBar = false,
  onSort,
  showTotalRow = false,
  getTotalRow,
  onSearch,
  searchValue,
}: Props<T>) {
  const effectiveMaxHeight = forceFullHeight || isCardExpanded ? 'calc(100vh - 140px)' : maxHeight;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc' | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [localSearchQuery, setLocalSearchQuery] = useState('');
  const [exporting, setExporting] = useState<'excel' | 'pdf' | null>(null);
  const [showAllRows, setShowAllRows] = useState(false);
  const [gotoPage, setGotoPage] = useState('');
  const exportBtnRef = useRef<HTMLButtonElement>(null);

  const actualSearchQuery = searchValue !== undefined ? searchValue : localSearchQuery;

  const handleSearchChange = (val: string) => {
    if (onSearch) {
      onSearch(val);
    } else {
      setLocalSearchQuery(val);
    }
  };

  const handleSort = (key: string) => {
    let newKey: string | null = key;
    let newDir: 'asc' | 'desc' | null = 'asc';
    if (sortKey !== key) { newKey = key; newDir = 'asc'; }
    else if (sortDir === 'asc') newDir = 'desc';
    else if (sortDir === 'desc') { newKey = null; newDir = null; }
    setSortKey(newKey);
    setSortDir(newDir);
    onSort?.(newKey, newDir);
  };

  const filteredData = useMemo(() => {
    if (onSearch) return data; // If server-side search, data is already filtered
    if (!actualSearchQuery) return data;
    const lowerQuery = actualSearchQuery.toLowerCase();
    return data.filter(row =>
      columns.some(col => String(row[col.key] ?? '').toLowerCase().includes(lowerQuery))
    );
  }, [data, columns, actualSearchQuery, onSearch]);

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return filteredData;
    return [...filteredData].sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [filteredData, sortKey, sortDir]);

  // Apply default limit if set (only when not in full height/expanded mode)
  const displayData = useMemo(() => {
    if (forceFullHeight || isCardExpanded || expanded || showAllRows) return sorted;
    if (defaultLimit) return sorted.slice(0, defaultLimit);
    return sorted;
  }, [sorted, defaultLimit, showAllRows, forceFullHeight, isCardExpanded, expanded]);

  // ─── Excel Export ────────────────────────────────────────────────────────

  const handleExportExcel = async () => {
    setExporting('excel');
    try {
      let exportRows: Record<string, unknown>[];

      if (onFetchAllForExport && pagination && pagination.total > data.length) {
        // Fetch full dataset from server
        exportRows = await onFetchAllForExport();
      } else {
        exportRows = sorted as Record<string, unknown>[];
      }

      const sheetData = exportRows.map(row => rowToPlain(row as T, columns));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetData);

      // Auto-size columns
      const colWidths = columns.map(col => ({
        wch: Math.max(col.label.length + 2, 15),
      }));
      ws['!cols'] = colWidths;

      // Add metadata row at top (filters applied)
      if (activeFilters) {
        const meta = Object.entries(activeFilters)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}: ${v}`)
          .join('  |  ');
        if (meta) {
          XLSX.utils.sheet_add_aoa(ws, [[`Filters: ${meta}`]], { origin: -1 });
        }
      }
      XLSX.utils.sheet_add_aoa(ws, [[`Exported: ${new Date().toLocaleString('en-IN')}  |  Total Records: ${exportRows.length}`]], { origin: -1 });

      XLSX.utils.book_append_sheet(wb, ws, title.substring(0, 31));
      XLSX.writeFile(wb, buildFilename(title, activeFilters, 'xlsx'));
    } catch (err) {
      console.error('Excel export failed', err);
      alert('Export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  // ─── PDF Export ─────────────────────────────────────────────────────────

  const handleExportPDF = async () => {
    setExporting('pdf');
    try {
      let exportRows: Record<string, unknown>[];

      if (onFetchAllForExport && pagination && pagination.total > data.length) {
        exportRows = await onFetchAllForExport();
      } else {
        exportRows = sorted as Record<string, unknown>[];
      }

      // Decide orientation: landscape if many columns or wide columns
      const orientation: 'landscape' | 'portrait' = columns.length > 6 ? 'landscape' : 'portrait';

      const doc = new jsPDF({
        orientation,
        unit: 'mm',
        format: 'a4',
      });

      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // ── Header on every page (via didDrawPage hook in autoTable) ──
      const drawHeader = () => {
        doc.setFillColor(15, 23, 42); // dark navy
        doc.rect(0, 0, pageWidth, 18, 'F');

        doc.setFontSize(12);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text(title, 10, 11);

        if (activeFilters) {
          const filterStr = Object.entries(activeFilters)
            .filter(([, v]) => v)
            .map(([k, v]) => `${k}: ${v}`)
            .join('  |  ');
          if (filterStr) {
            doc.setFontSize(7);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(170, 190, 220);
            doc.text(`Filters: ${filterStr}`, 10, 16);
          }
        }

        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(170, 190, 220);
        doc.text(
          `Exported: ${new Date().toLocaleString('en-IN')}  |  Total Records: ${exportRows.length}`,
          pageWidth - 10,
          11,
          { align: 'right' }
        );
      };

      const headers = columns.map(c => c.label);
      const bodyRows = exportRows.map(row =>
        columns.map(col => {
          const val = row[col.key];
          return val === null || val === undefined ? '-' : String(val);
        })
      );

      autoTable(doc, {
        head: [headers],
        body: bodyRows,
        startY: 22,
        margin: { top: 22, left: 8, right: 8, bottom: 14 },
        styles: {
          fontSize: columns.length > 8 ? 6.5 : 8,
          cellPadding: 2.5,
          overflow: 'linebreak',
          lineColor: [220, 230, 242],
          lineWidth: 0.2,
        },
        headStyles: {
          fillColor: [19, 32, 53],
          textColor: [220, 235, 255],
          fontStyle: 'bold',
          fontSize: columns.length > 8 ? 7 : 8.5,
          halign: 'center',
        },
        alternateRowStyles: {
          fillColor: [240, 244, 250],
        },
        bodyStyles: {
          textColor: [30, 40, 60],
        },
        columnStyles: Object.fromEntries(
          columns.map((col, i) => [
            i,
            {
              halign: (col.align as 'left' | 'center' | 'right' | undefined) || 'left',
              // Use minimal cell widths if many columns, else auto
              cellWidth: columns.length > 8 ? 'wrap' : 'auto',
            },
          ])
        ),
        tableWidth: 'auto',
        didDrawPage: (hookData) => {
          drawHeader();

          // Footer: page X of Y
          const totalPages = (doc.internal as unknown as { getNumberOfPages: () => number }).getNumberOfPages();
          const currentPage = hookData.pageNumber;
          doc.setFontSize(8);
          doc.setTextColor(120, 130, 150);
          doc.setFont('helvetica', 'normal');
          doc.text(
            `Page ${currentPage} of ${totalPages}`,
            pageWidth / 2,
            pageHeight - 6,
            { align: 'center' }
          );
          doc.text(title, 8, pageHeight - 6);
        },
        showHead: 'everyPage',
        tableLineColor: [200, 215, 230],
        tableLineWidth: 0.3,
      });

      doc.save(buildFilename(title, activeFilters, 'pdf'));
    } catch (err) {
      console.error('PDF export failed', err);
      alert('PDF export failed. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderTable = (isExpanded: boolean) => {
    const isFullHeight = isExpanded || forceFullHeight || isCardExpanded;
    return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
      {/* Top Header Controls - hide when hideTitleBar is true in normal view */}
      <div style={{ display: hideTitleBar && !isFullHeight ? 'none' : 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: '10px' }}>
        {/* Export Buttons */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flex: 1 }}>
          <button
            ref={exportBtnRef}
            onClick={handleExportExcel}
            disabled={exporting !== null}
            title={onFetchAllForExport && pagination
              ? `Export all ${pagination.total} records to Excel`
              : `Export ${data.length} records to Excel`}
            style={{ padding: '6px 12px', fontSize: '12px', background: exporting === 'excel' ? '#059669' : '#10b981', color: '#fff', border: 'none', borderRadius: '6px', cursor: exporting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: exporting && exporting !== 'excel' ? 0.6 : 1, transition: 'background 0.2s' }}
          >
            {exporting === 'excel' ? (
              <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Exporting…</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg> Excel (All {pagination ? pagination.total : data.length})</>
            )}
          </button>

          <button
            onClick={handleExportPDF}
            disabled={exporting !== null}
            title={onFetchAllForExport && pagination
              ? `Export all ${pagination.total} records to PDF`
              : `Export ${data.length} records to PDF`}
            style={{ padding: '6px 12px', fontSize: '12px', background: exporting === 'pdf' ? '#2563eb' : '#3b82f6', color: '#fff', border: 'none', borderRadius: '6px', cursor: exporting ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '6px', opacity: exporting && exporting !== 'pdf' ? 0.6 : 1, transition: 'background 0.2s' }}
          >
            {exporting === 'pdf' ? (
              <><span style={{ display: 'inline-block', width: 12, height: 12, border: '2px solid #fff', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} /> Generating…</>
            ) : (
              <><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg> PDF (All {pagination ? pagination.total : data.length})</>
            )}
          </button>

          {exporting && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
              Fetching all records…
            </span>
          )}
          
          {/* Toggle button for limited rows - hide when in expanded view */}
          {defaultLimit && data.length > defaultLimit && !isCardExpanded && (
            <button
              onClick={() => setShowAllRows(!showAllRows)}
              style={{
                padding: '5px 10px',
                fontSize: '11px',
                background: showAllRows ? '#6366f1' : '#475569',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                marginLeft: '8px',
              }}
              title={showAllRows ? `Show only ${defaultLimit} rows` : `Show all ${data.length} rows`}
            >
              {showAllRows ? `Show Top ${defaultLimit}` : `Show All (${data.length})`}
            </button>
          )}
        </div>

        {/* Table Title (Middle) - hide when inside ChartCard or in expanded view */}
        {title && !isFullHeight && !isCardExpanded && !hideTitleBar && (
          <div style={{ textAlign: 'center', fontSize: '15px', fontWeight: 600, color: 'var(--text-primary)', padding: '0 10px' }}>
            {title}
          </div>
        )}

        {/* Pagination Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', flex: 1, justifyContent: 'flex-end' }}>
          {pagination && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Rows per page:</span>
              <select
                value={pagination.limit}
                onChange={(e) => pagination.onLimitChange(Number(e.target.value))}
                style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px 6px', fontSize: '12px', outline: 'none' }}
              >
                <option value={20} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>20</option>
                <option value={50} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>50</option>
                <option value={100} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>100</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                Page <strong style={{ color: 'var(--text-primary)' }}>{pagination.page}</strong> of{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{pagination.totalPages}</strong>
                <span style={{ color: 'var(--text-muted)' }}> ({pagination.total} total)</span>
              </span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button
                  disabled={pagination.page <= 1}
                  onClick={() => pagination.onPageChange(pagination.page - 1)}
                  style={{ padding: '4px 8px', background: pagination.page <= 1 ? 'var(--bg-input)' : 'var(--bg-hover)', opacity: pagination.page <= 1 ? 0.5 : 1, color: pagination.page <= 1 ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', cursor: pagination.page <= 1 ? 'not-allowed' : 'pointer' }}
                >
                  ←
                </button>
                <button
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => pagination.onPageChange(pagination.page + 1)}
                  style={{ padding: '4px 8px', background: pagination.page >= pagination.totalPages ? 'var(--bg-input)' : 'var(--bg-hover)', opacity: pagination.page >= pagination.totalPages ? 0.5 : 1, color: pagination.page >= pagination.totalPages ? 'var(--text-muted)' : 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', cursor: pagination.page >= pagination.totalPages ? 'not-allowed' : 'pointer' }}
                >
                  →
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '8px', borderLeft: '1px solid var(--border)', paddingLeft: '12px' }}>
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Go to:</span>
                <input
                  type="number"
                  min={1}
                  max={pagination.totalPages}
                  value={gotoPage}
                  onChange={(e) => setGotoPage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const p = parseInt(gotoPage, 10);
                      if (!isNaN(p) && p >= 1 && p <= pagination.totalPages) {
                        pagination.onPageChange(p);
                        setGotoPage('');
                      }
                    }
                  }}
                  style={{ width: '50px', background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: '4px', padding: '4px', fontSize: '12px', outline: 'none', textAlign: 'center' }}
                />
                <button
                  onClick={() => {
                    const p = parseInt(gotoPage, 10);
                    if (!isNaN(p) && p >= 1 && p <= pagination.totalPages) {
                      pagination.onPageChange(p);
                      setGotoPage('');
                    }
                  }}
                  style={{ padding: '4px 8px', background: 'rgba(99,102,241,0.2)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.4)', borderRadius: '4px', fontSize: '11px', cursor: 'pointer' }}
                >
                  Go
                </button>
              </div>
            </div>
            </>
          )}
        </div>
      </div>

      {/* Table Scroll Area */}
      <div style={{ overflowX: 'auto', overflowY: 'auto', flex: 1, maxHeight: isFullHeight ? 'calc(100vh - 140px)' : effectiveMaxHeight, minHeight: isFullHeight ? '200px' : '120px' }}>
        <table className="data-table" style={isFullHeight ? { fontSize: '15px' } : undefined}>
          <thead>
            <tr>
              {columns.map((col, colIdx) => (
                <th
                  key={col.key}
                  style={{
                    width: col.width,
                    cursor: col.sortable ? 'pointer' : 'default',
                    textAlign: col.align,
                    fontSize: isFullHeight ? '13px' : undefined,
                    padding: isFullHeight ? '18px 24px' : undefined,
                    ...(colIdx === 0 ? {
                      position: 'sticky',
                      left: 0,
                      zIndex: 20,
                      backgroundColor: 'var(--bg-dark)',
                      boxShadow: '2px 0 6px rgba(0,0,0,0.6)',
                    } : {}),
                  }}
                  onClick={() => col.sortable && handleSort(col.key)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                    {col.label}
                    {col.sortable && (
                      <span style={{ fontSize: '9px', opacity: sortKey === col.key ? 1 : 0.3 }}>
                        {sortKey === col.key ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
                      </span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayData.length > 0 ? (
              displayData.map((row, i) => (
                <tr key={i} onClick={() => onRowClick?.(row)} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
                  {columns.map((col, colIdx) => (
                    <td
                      key={col.key}
                      onClick={() => onRowClick?.(row)}
                      style={{
                        textAlign: col.align,
                        padding: isFullHeight ? '18px 24px' : undefined,
                        cursor: onRowClick ? 'pointer' : 'default',
                        ...(colIdx === 0 ? {
                          position: 'sticky',
                          left: 0,
                          zIndex: 10,
                          backgroundColor: 'var(--bg-dark)',
                          boxShadow: '2px 0 6px rgba(0,0,0,0.6)',
                        } : {}),
                      }}
                    >
                      {col.render ? col.render(row) : String(row[col.key] ?? '-')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>
                  No records found.
                </td>
              </tr>
            )}
            {showTotalRow && getTotalRow && sorted.length > 0 && (
              <tr style={{ fontWeight: 700, borderTop: '2px solid #3b82f6' }}>
                {columns.map((col, colIdx) => {
                  const totalValue = getTotalRow(sorted)[col.key];
                  return (
                    <td
                      key={col.key}
                      style={{
                        textAlign: col.align,
                        padding: isFullHeight ? '14px 24px' : '10px 16px',
                        color: colIdx === 0 ? 'var(--text-primary)' : 'var(--primary)',
                        ...(colIdx === 0 ? {
                          position: 'sticky',
                          left: 0,
                          zIndex: 15,
                          backgroundColor: 'var(--bg-dark)',
                          boxShadow: '2px -2px 6px rgba(0,0,0,0.5)',
                        } : {}),
                      }}
                    >
                      {colIdx === 0 ? 'Total' : totalValue}
                    </td>
                  );
                })}
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
  };

  const overlayContent = expanded ? (
    <div className="chart-overlay" style={{ zIndex: 9999 }}>
      <div className="chart-overlay-header" style={{ padding: '16px 40px', gap: '20px' }}>
        <span className="chart-overlay-title" style={{ fontSize: '1.2rem', fontWeight: 600, flexShrink: 0 }}>
          {title}
          <span style={{ fontSize: '14px', color: 'var(--text-muted)', fontWeight: 400, marginLeft: '12px' }}>
            ({sorted.length} record{sorted.length !== 1 ? 's' : ''}{pagination ? ` of ${pagination.total} total` : ''})
          </span>
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '20px', flex: 1, justifyContent: 'flex-end' }}>
          <div style={{ width: '280px', position: 'relative' }}>
            <input
              type="text"
              placeholder={onSearch ? "Search all records..." : "Search in table..."}
              value={actualSearchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 16px 8px 36px',
                borderRadius: '6px',
                background: 'var(--bg-input)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                fontSize: '13px',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              onFocus={(e) => e.target.style.borderColor = 'var(--primary-light)'}
              onBlur={(e) => e.target.style.borderColor = 'var(--border)'}
            />
            <svg style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>

          <button className="chart-overlay-close" onClick={() => { setExpanded(false); handleSearchChange(''); }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            Close
          </button>
        </div>
      </div>
      <div className="chart-overlay-body" style={{ display: 'flex', flexDirection: 'column', padding: '0 40px 20px 40px', maxWidth: '100%', margin: '0', width: '100%', alignItems: 'stretch' }}>
        {renderTable(true)}
      </div>
    </div>
  ) : null;

  return (
    <>
      <div className="card data-table-container" style={{ position: 'relative', display: 'flex', flexDirection: 'column', overflow: 'hidden', width: '100%', maxWidth: '100%' }}>
        {!noExpand && (
          <button
            onClick={() => setExpanded(true)}
            className="table-expand-btn"
            title="Expand Table"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
            </svg>
          </button>
        )}
        {renderTable(false)}
      </div>
      {expanded && typeof document !== 'undefined' && createPortal(overlayContent, document.body)}
    </>
  );
}