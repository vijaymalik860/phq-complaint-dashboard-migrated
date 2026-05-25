const getThemeColors = () => {
  const isLight = typeof document !== 'undefined' && document.documentElement.getAttribute('data-theme') === 'light';
  return {
    textColor: isLight ? '#0f172a' : '#f8fafc', // Slate 900 / Slate 50
    textMuted: isLight ? '#475569' : '#94a3b8', // Slate 600 / Slate 400
    splitLine: isLight ? '#e2e8f0' : '#1e293b', // Slate 200 / Slate 800
    axisLine: isLight ? '#cbd5e1' : '#334155',  // Slate 300 / Slate 700
    tooltipBg: isLight ? 'rgba(255, 255, 255, 0.96)' : '#1e293b',
    tooltipBorder: isLight ? '#cbd5e1' : '#334155',
    tooltipText: isLight ? '#0f172a' : '#e2e8f0',
    itemBorder: isLight ? '#ffffff' : '#1e293b',
  };
};

export const getDistrictBarOptions = (data: { district: string; total: number; pending: number; disposed: number; unknown?: number }[]): any => {
  const colors = getThemeColors();
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const item = data[params[0].dataIndex];
        let res = `<div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>`;
        res += `<div style="font-size:11px;color:${colors.textMuted};margin-bottom:4px">Total: <b>${item.total}</b></div>`;
        params.forEach(p => {
          const pct = item.total > 0 ? Math.round((p.value / item.total) * 100) : 0;
          res += `<div style="color:${p.color}">${p.seriesName}: <b>${p.value}</b> (${pct}%)</div>`;
        });
        return res;
      },
    },
    legend: {
      data: ['Pending', 'Disposed', 'Status Not Found'],
      bottom: 0,
      textStyle: { color: colors.textMuted, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: '2%', right: '2%', bottom: '12%', top: '2%', containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: colors.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.splitLine } },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: data.map(d => d.district),
      axisLabel: { fontSize: 10, color: colors.textMuted, interval: 0, width: 80, overflow: 'truncate' },
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisTick: { show: false },
    },
    series: [
      {
        name: 'Pending',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.pending),
        itemStyle: { color: '#fbbf24' },
        barMaxWidth: 20,
      },
      {
        name: 'Disposed',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.disposed),
        itemStyle: { color: '#34d399' },
        barMaxWidth: 20,
      },
      {
        name: 'Status Not Found',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.unknown ?? 0),
        itemStyle: { color: '#64748b', borderRadius: [0, 3, 3, 0] },
        barMaxWidth: 20,
      },
    ],
  };
};

export const getDurationLineOptions = (data: { duration?: string; month?: string; total: number; pending: number; disposed: number; unknown?: number }[]): any => {
  const colors = getThemeColors();
  return {
    tooltip: {
      trigger: 'axis',
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const item = data[params[0].dataIndex];
        let res = `<div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>`;
        res += `<div style="font-size:11px;color:${colors.textMuted};margin-bottom:4px">Total: <b>${item.total}</b></div>`;
        params.forEach(p => {
          const pct = item.total > 0 ? Math.round((p.value / item.total) * 100) : 0;
          res += `<div style="color:${p.color}">${p.seriesName}: <b>${p.value}</b> (${pct}%)</div>`;
        });
        return res;
      }
    },
    legend: {
      data: ['Pending', 'Disposed', 'Status Not Found'],
      bottom: 0,
      textStyle: { color: colors.textMuted, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: '2%', right: '2%', bottom: '12%', top: '2%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.map(d => d.duration || d.month),
      axisLabel: { color: colors.textMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisTick: { show: false },
      boundaryGap: false,
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: colors.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.splitLine } },
      axisLine: { show: false },
    },
    series: [
      {
        name: 'Pending',
        type: 'line',
        data: data.map(d => d.pending),
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#fbbf24', width: 2 },
        itemStyle: { color: '#fbbf24' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(251,191,36,0.3)' }, { offset: 1, color: 'rgba(251,191,36,0)' }] } },
      },
      {
        name: 'Disposed',
        type: 'line',
        data: data.map(d => d.disposed),
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { color: '#34d399', width: 2 },
        itemStyle: { color: '#34d399' },
        areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(52,211,153,0.3)' }, { offset: 1, color: 'rgba(52,211,153,0)' }] } },
      },
      {
        name: 'Status Not Found',
        type: 'line',
        data: data.map(d => d.unknown ?? 0),
        smooth: 0.4,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: '#64748b', width: 1.5, type: 'dashed' },
        itemStyle: { color: '#64748b' },
      },
    ],
  };
};

export const getPieOptions = (data: { name: string; value: number }[]): any => {
  const colors = getThemeColors();
  const total = data.reduce((s, d) => s + d.value, 0);
  return {
    tooltip: {
      trigger: 'item' as const,
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText, fontSize: 12 },
      formatter: (p: any) => `<b>${p.name}</b><br/>Count: ${p.value} (${p.percent.toFixed(1)}%)`,
    },
    legend: {
      orient: 'vertical' as const,
      right: 8,
      top: 'center',
      textStyle: { color: colors.textMuted, fontSize: 11 },
    },
    color: ['#818cf8', '#fbbf24', '#34d399', '#f87171', '#60a5fa', '#a78bfa', '#2dd4bf', '#fb923c'],
    graphic: [
      { type: 'text', left: '28%', top: '38%', style: { text: String(total), fill: colors.textColor, fontSize: 20, fontWeight: 'bold' } },
      { type: 'text', left: '28%', top: '50%', style: { text: 'Total', fill: colors.textMuted, fontSize: 11 } },
    ],
    series: [{
      type: 'pie',
      radius: ['38%', '65%'],
      center: ['32%', '50%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 4, borderColor: colors.itemBorder, borderWidth: 2 },
      label: { show: false },
      labelLine: { show: false },
      data: data.map(d => ({ name: d.name, value: d.value })),
    }],
  };
};

export const getStackedBarOptions = (data: { category: string; total: number; pending: number; disposed: number; unknown?: number }[]): any => {
  const colors = getThemeColors();
  return {
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      backgroundColor: colors.tooltipBg,
      borderColor: colors.tooltipBorder,
      textStyle: { color: colors.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const item = data[params[0].dataIndex];
        let res = `<div style="font-weight:600;margin-bottom:4px">${params[0].name}</div>`;
        res += `<div style="font-size:11px;color:${colors.textMuted};margin-bottom:4px">Total: <b>${item.total}</b></div>`;
        params.forEach(p => {
          const pct = item.total > 0 ? Math.round((p.value / item.total) * 100) : 0;
          res += `<div style="color:${p.color}">${p.seriesName}: <b>${p.value}</b> (${pct}%)</div>`;
        });
        return res;
      },
    },
    legend: {
      data: ['Pending', 'Disposed', 'Status Not Found'],
      bottom: 0,
      textStyle: { color: colors.textMuted, fontSize: 11 },
      itemWidth: 12,
      itemHeight: 8,
    },
    grid: { left: '2%', right: '4%', bottom: '12%', top: '2%', containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: colors.textMuted, fontSize: 10 },
      splitLine: { lineStyle: { color: colors.splitLine } },
      axisLine: { show: false },
    },
    yAxis: {
      type: 'category',
      data: data.map(d => d.category),
      axisLabel: { color: colors.textMuted, fontSize: 10 },
      axisLine: { lineStyle: { color: colors.axisLine } },
      axisTick: { show: false },
    },
    series: [
      {
        name: 'Pending',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.pending),
        itemStyle: { color: '#fbbf24', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 20,
      },
      {
        name: 'Disposed',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.disposed),
        itemStyle: { color: '#34d399', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 20,
      },
      {
        name: 'Unknown Status',
        type: 'bar',
        stack: 'total',
        data: data.map(d => d.unknown ?? 0),
        itemStyle: { color: '#64748b', borderRadius: [3, 3, 0, 0] },
        barMaxWidth: 20,
      },
    ],
  };
};