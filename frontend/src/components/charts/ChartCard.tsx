import React, { useState } from 'react';
import { BaseChart } from './BaseChart';
import type { EChartsOption } from 'echarts';

interface ChartCardProps {
  title: string;
  subtitle?: React.ReactNode;
  option?: EChartsOption;
  fullOption?: EChartsOption;
  height?: string;
  expandedHeight?: string;
  actions?: React.ReactNode;
  chartActions?: React.ReactNode;
  children?: React.ReactNode;
  noExpand?: boolean;
  viewMode?: 'chart' | 'table';
  onViewModeChange?: (mode: 'chart' | 'table') => void;
  onEvents?: Record<string, (params: any) => void>;
}

/* Compact pill toggle — matches Reports style exactly */
const ViewPill = ({
  viewMode,
  onViewModeChange,
}: {
  viewMode: 'chart' | 'table';
  onViewModeChange: (m: 'chart' | 'table') => void;
}) => (
  <div style={{
    display: 'flex',
    backgroundColor: 'var(--bg-dark)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: 2,
    gap: '2px',
    flexShrink: 0
  }}>
    {(['chart', 'table'] as const).map((m) => (
      <button
        key={m}
        onClick={() => onViewModeChange(m)}
        style={{
          padding: '3px 10px',
          borderRadius: 4,
          border: 'none',
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
          whiteSpace: 'nowrap',
          backgroundColor: viewMode === m ? 'var(--primary)' : 'transparent',
          color: viewMode === m ? '#fff' : 'var(--text-muted)',
          transition: 'all 0.15s ease',
        }}
      >
        {m === 'chart' ? 'Graph' : 'Table'}
      </button>
    ))}
  </div>
);


export const ChartCard = ({
  title,
  subtitle,
  option,
  fullOption,
  height = '280px',
  expandedHeight = 'calc(100vh - 120px)',
  actions,
  chartActions,
  children,
  noExpand,
  viewMode,
  onViewModeChange,
  onEvents,
}: ChartCardProps) => {
  const [expanded, setExpanded] = useState(false);

  const childWithExpandedProp = children && typeof children === 'object' && 'props' in children
    ? React.cloneElement(children as React.ReactElement<any>, { isCardExpanded: expanded })
    : children;

  if (expanded) {
    return (
      <div className="chart-overlay" style={{ zIndex: 400 }}>
        <div className="chart-overlay-header" style={{ padding: '16px 24px', gap: '16px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span className="chart-overlay-title" style={{ fontSize: '18px', fontWeight: 600 }}>{title}</span>
              {viewMode && onViewModeChange && (
                <ViewPill viewMode={viewMode} onViewModeChange={onViewModeChange} />
              )}
            </div>
            {subtitle && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{subtitle}</span>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
            {viewMode === 'chart' && chartActions}
            {actions && <div>{actions}</div>}
            <button className="chart-overlay-close" onClick={() => setExpanded(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Close
            </button>
          </div>
        </div>
        <div className="chart-overlay-body" style={{
          overflowY: 'auto',
          overflowX: 'auto',
          padding: '20px',
          width: '100%',
          maxWidth: '100%',
          margin: 0,
          flex: 1,
          alignItems: 'flex-start',
          justifyContent: 'flex-start'
        }}>
          {childWithExpandedProp
            ? <div style={{ width: '100%', minWidth: '100%' }}>{childWithExpandedProp}</div>
            : <BaseChart option={fullOption || option || {}} height={expandedHeight} onEvents={onEvents} />
          }
        </div>
      </div>
    );
  }

  const showHeader = title || subtitle || actions || chartActions || viewMode;

  return (
    <div className="chart-card">
      {showHeader && (
        <div className="chart-card-header">
          {/* Left: title + subtitle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0, flex: 1 }}>
            {title && <span className="chart-card-title">{title}</span>}
            {subtitle && <span className="chart-card-subtitle">{subtitle}</span>}
          </div>

          {/* Right: controls row — wraps on narrow cards so expand is never hidden */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            flexWrap: 'wrap',
            justifyContent: 'flex-end',
            flexShrink: 0,
          }}>
            {/* Graph / Table pill toggle */}
            {viewMode && onViewModeChange && (
              <ViewPill viewMode={viewMode} onViewModeChange={onViewModeChange} />
            )}

            {/* Chart-specific actions (Sort dropdown) — only when in chart mode */}
            {viewMode !== 'table' && chartActions}

            {/* Legacy actions slot */}
            {actions && <div style={{ flexShrink: 0 }}>{actions}</div>}

            {/* Expand — icon-only, always last, always visible */}
            {!noExpand && (
              <button
                className="chart-expand-btn chart-expand-btn--icon"
                onClick={() => setExpanded(true)}
                title="Expand"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 3 21 3 21 9" />
                  <polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" />
                  <line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      <div className="chart-card-body">
        {children && typeof children !== 'boolean' ? (
          children
        ) : (
          option ? <BaseChart option={option} height={height} onEvents={onEvents} /> : null
        )}
      </div>
    </div>
  );
};