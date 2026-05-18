import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { reportsApi } from '@/services/api';
import { DrawerFilters } from '@/components/common/ComplaintsDrawer';

const fmtDate = (v: unknown) => {
  if (!v) return '—';
  const d = new Date(v as string);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000) return '—';
  return d.toLocaleDateString('en-IN');
};

const COLS = [
  { key: '#',                    label: '#',                  w: 44  },
  { key: 'complRegNum',          label: 'Reg. No.',           w: 160 },
  { key: 'complSrno',            label: 'Sr. No.',            w: 90  },
  { key: 'complRegDt',           label: 'Reg. Date',          w: 100 },
  { key: 'firstName',            label: 'First Name',         w: 110 },
  { key: 'lastName',             label: 'Last Name',          w: 110 },
  { key: 'gender',               label: 'Gender',             w: 70  },
  { key: 'age',                  label: 'Age',                w: 55  },
  { key: 'mobile',               label: 'Mobile',             w: 130 },
  { key: 'email',                label: 'Email',              w: 170 },
  { key: 'complainantType',      label: 'Complainant Type',   w: 150 },
  { key: 'addressLine1',         label: 'Address 1',          w: 160 },
  { key: 'addressLine2',         label: 'Address 2',          w: 150 },
  { key: 'addressLine3',         label: 'Address 3',          w: 150 },
  { key: 'village',              label: 'Village',            w: 110 },
  { key: 'tehsil',               label: 'Tehsil',             w: 110 },
  { key: 'addressDistrict',      label: 'Address District',   w: 140 },
  { key: 'addressPs',            label: 'Address PS',         w: 150 },
  { key: 'districtName',         label: 'District (Master)',  w: 150 },
  { key: 'submitPsCd',           label: 'Submit PS Code',     w: 120 },
  { key: 'submitOfficeCd',       label: 'Submit Office Code', w: 140 },
  { key: 'receptionMode',        label: 'Reception Mode',     w: 140 },
  { key: 'branch',               label: 'Branch',             w: 110 },
  { key: 'complaintSource',      label: 'Complaint Source',   w: 150 },
  { key: 'typeOfComplaint',      label: 'Type of Complaint',  w: 150 },
  { key: 'complaintPurpose',     label: 'Complaint Purpose',  w: 150 },
  { key: 'classOfIncident',      label: 'Class of Incident',  w: 150 },
  { key: 'incidentType',         label: 'Incident Type',      w: 130 },
  { key: 'incidentPlc',          label: 'Incident Place',     w: 130 },
  { key: 'incidentFromDt',       label: 'Incident From',      w: 110 },
  { key: 'incidentToDt',         label: 'Incident To',        w: 110 },
  { key: 'crimeCategory',        label: 'Crime Category',     w: 140 },
  { key: 'respondentCategories', label: 'Respondent Cat.',    w: 160 },
  { key: 'statusOfComplaint',    label: 'Status (Raw)',       w: 150 },
  { key: 'statusGroup',          label: 'Status Group',       w: 110 },
  { key: 'disposalDate',         label: 'Disposal Date',      w: 110 },
  { key: 'firNumber',            label: 'FIR No.',            w: 110 },
  { key: 'actionTaken',          label: 'Action Taken',       w: 180 },
  { key: 'ioDetails',            label: 'IO Details',         w: 150 },
  { key: 'createdAt',            label: 'Created At',         w: 140 },
  { key: 'updatedAt',            label: 'Last Synced',        w: 140 },
];
const DATE_COLS = new Set(['complRegDt','incidentFromDt','incidentToDt','disposalDate','createdAt','updatedAt']);
const FROZEN_KEYS = ['#','complRegNum'];
let _acc = 0;
const FROZEN_LEFT: Record<string,number> = {};
for (const c of COLS) { if (FROZEN_KEYS.includes(c.key)) { FROZEN_LEFT[c.key]=_acc; _acc+=c.w; } else break; }
const MIN_W = COLS.reduce((s,c)=>s+c.w,0);

const STATUS_CLR: Record<string,{bg:string;col:string}> = {
  disposed: {bg:'rgba(52,211,153,0.12)',col:'#34d399'},
  pending:  {bg:'rgba(248,113,113,0.12)',col:'#f87171'},
};

type QFField = 'name'|'mobile'|'district'|'ps'|'address'|'gender'|'complaintNumber';
type QFOp = 'contains'|'equals'|'starts_with';
type QF = { id:number; field:QFField; op:QFOp; value:string };

const QF_FIELDS: {key:QFField;label:string}[] = [
  {key:'complaintNumber',label:'Complaint No.'},
  {key:'name',           label:'Full Name'},
  {key:'mobile',         label:'Mobile'},
  {key:'district',       label:'District'},
  {key:'ps',             label:'Police Station'},
  {key:'address',        label:'Address'},
  {key:'gender',         label:'Gender'},
];
const QF_OPS: {key:QFOp;label:string}[] = [
  {key:'contains',   label:'contains'},
  {key:'equals',     label:'equals'},
  {key:'starts_with',label:'starts with'},
];

export const ByHandBogusTab = ({ activeFilters, openDrawer }: {
  activeFilters: Record<string,string>;
  openDrawer: (title:string, filters:DrawerFilters) => void;
}) => {
  const [page,     setPage]     = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [gotoPage, setGotoPage] = useState('');
  const [search,   setSearch]   = useState('');
  const [debSearch,setDebSearch]= useState('');
  const [appliedFilters, setApplied] = useState<QF[]>([]);
  const [pendingField,   setPField]  = useState<QFField>('name');
  const [pendingOp,      setPOp]     = useState<QFOp>('contains');
  const [pendingValue,   setPValue]  = useState('');
  const [showBuilder,    setShowBuilder] = useState(false);
  const nextId = useRef(1);
  const resetPage = () => setPage(1);

  useEffect(()=>{ const t=setTimeout(()=>{setDebSearch(search);resetPage();},400); return()=>clearTimeout(t); },[search]);
  useEffect(()=>{ setPage(1); },[activeFilters]);

  const params: Record<string,string> = { ...activeFilters, page:String(page), pageSize:String(pageSize) };
  if (debSearch) params.search = debSearch;
  if (appliedFilters.length) params.queryFilters = JSON.stringify(appliedFilters.map(({field,op,value})=>({field,op,value})));

  const { data:apiResp, isLoading, isFetching } = useQuery({
    queryKey: ['byhand-bogus', params],
    queryFn:  () => reportsApi.byhandBogus(params),
    staleTime: 5*60*1000,
    placeholderData: (prev:any)=>prev,
  });
  const result    = (apiResp as any)?.data || {};
  const rows:any[]= result.data       || [];
  const total:number = result.total   || 0;
  const totalPages:number = result.totalPages || 1;

  const addFilter = () => {
    if (!pendingValue.trim()) return;
    setApplied(prev=>[...prev,{id:nextId.current++,field:pendingField,op:pendingOp,value:pendingValue.trim()}]);
    setPValue(''); setShowBuilder(false); resetPage();
  };
  const removeFilter = (id:number) => { setApplied(prev=>prev.filter(f=>f.id!==id)); resetPage(); };

  const handleExportCSV = () => {
    if (!rows.length) return;
    const cols = COLS.filter(c=>c.key!=='#');
    const csv = [cols.map(c=>c.label), ...rows.map((r:any)=>cols.map(c=>DATE_COLS.has(c.key)?fmtDate(r[c.key]):(r[c.key]??'')))]
      .map(row=>row.map((v:any)=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a=document.createElement('a');
    a.href=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'}));
    a.download=`byhand_bogus_${Date.now()}.csv`; a.click();
  };

  const ctrl: React.CSSProperties = {
    background:'#1e293b', border:'1px solid #334155', borderRadius:6,
    color:'#e2e8f0', padding:'5px 9px', fontSize:12, outline:'none', cursor:'pointer',
  };
  const navBtn = (dis:boolean, fn:()=>void, lbl:string) => (
    <button onClick={fn} disabled={dis} style={{
      padding:'3px 8px', background:dis?'rgba(255,255,255,0.04)':'rgba(255,255,255,0.1)',
      color:dis?'#475569':'#e2e8f0', border:'1px solid #334155',
      borderRadius:4, cursor:dis?'not-allowed':'pointer', fontSize:13,
    }}>{lbl}</button>
  );

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>

      {/* ── Controls ───────────────────────────────────────── */}
      <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:10,flexShrink:0}}>
        {/* Search */}
        <div style={{display:'flex',alignItems:'center',gap:6,flex:'1 1 200px',minWidth:160}}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" style={{flexShrink:0}}>
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input type="text" placeholder="Search all records…" value={search}
            onChange={e=>setSearch(e.target.value)}
            style={{...ctrl,flex:1,maxWidth:260,cursor:'text'}}/>
          {isFetching&&!isLoading&&(
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
              style={{flexShrink:0,animation:'spin 0.8s linear infinite',color:'#60a5fa'}}>
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.2"/>
              <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          )}
        </div>

        {/* Add Filter */}
        <button onClick={()=>setShowBuilder(b=>!b)} style={{
          display:'flex',alignItems:'center',gap:5,flexShrink:0,
          padding:'5px 10px',fontSize:11,fontWeight:500,
          background:showBuilder?'rgba(99,102,241,0.2)':'rgba(255,255,255,0.06)',
          border:`1px solid ${showBuilder?'rgba(99,102,241,0.5)':'#334155'}`,
          borderRadius:6,color:showBuilder?'#818cf8':'#94a3b8',cursor:'pointer',
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Add Filter
        </button>

        {/* Export CSV */}
        <button onClick={handleExportCSV} disabled={!rows.length} style={{
          display:'flex',alignItems:'center',gap:5,flexShrink:0,
          padding:'5px 10px',fontSize:11,fontWeight:500,
          background:rows.length?'rgba(99,102,241,0.15)':'rgba(255,255,255,0.03)',
          color:rows.length?'#818cf8':'#475569',
          border:`1px solid ${rows.length?'rgba(99,102,241,0.4)':'#1e293b'}`,
          borderRadius:6,cursor:rows.length?'pointer':'not-allowed',
        }}>
          <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
          </svg>
          Export CSV
        </button>

        {/* Count pill */}
        {!isLoading&&(
          <div style={{marginLeft:'auto',flexShrink:0,display:'flex',alignItems:'center',gap:5,
            background:'rgba(251,146,60,0.12)',border:'1px solid rgba(251,146,60,0.3)',
            borderRadius:20,padding:'3px 12px',fontSize:11,color:'#fb923c',fontWeight:600}}>
            <span>⚠</span>
            {total.toLocaleString()} bogus records
          </div>
        )}
      </div>

      {/* ── Filter builder panel ──────────────────────────── */}
      {showBuilder&&(
        <div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:6,marginBottom:10,
          padding:'8px 10px',background:'rgba(99,102,241,0.08)',border:'1px solid rgba(99,102,241,0.25)',
          borderRadius:8,flexShrink:0}}>
          <select value={pendingField} onChange={e=>setPField(e.target.value as QFField)} style={ctrl}>
            {QF_FIELDS.map(f=><option key={f.key} value={f.key} style={{background:'#1e293b'}}>{f.label}</option>)}
          </select>
          <select value={pendingOp} onChange={e=>setPOp(e.target.value as QFOp)} style={ctrl}>
            {QF_OPS.map(o=><option key={o.key} value={o.key} style={{background:'#1e293b'}}>{o.label}</option>)}
          </select>
          <input type="text" placeholder="Value…" value={pendingValue}
            onChange={e=>setPValue(e.target.value)}
            onKeyDown={e=>e.key==='Enter'&&addFilter()}
            style={{...ctrl,cursor:'text',minWidth:120,flex:'1 1 100px'}}/>
          <button onClick={addFilter} style={{padding:'5px 12px',fontSize:11,fontWeight:600,
            background:'rgba(99,102,241,0.25)',color:'#818cf8',
            border:'1px solid rgba(99,102,241,0.5)',borderRadius:6,cursor:'pointer'}}>Apply</button>
          <button onClick={()=>setShowBuilder(false)} style={{padding:'5px 8px',fontSize:11,
            background:'transparent',color:'#64748b',border:'1px solid #334155',borderRadius:6,cursor:'pointer'}}>✕</button>
        </div>
      )}

      {/* ── Applied filter chips ──────────────────────────── */}
      {appliedFilters.length>0&&(
        <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:10,flexShrink:0}}>
          {appliedFilters.map(f=>(
            <span key={f.id} style={{display:'inline-flex',alignItems:'center',gap:4,
              padding:'2px 8px 2px 10px',borderRadius:20,fontSize:11,
              background:'rgba(96,165,250,0.12)',border:'1px solid rgba(96,165,250,0.3)',color:'#93c5fd'}}>
              <span style={{color:'#60a5fa',fontWeight:600}}>{QF_FIELDS.find(x=>x.key===f.field)?.label}</span>
              <span style={{color:'#475569'}}>{f.op.replace('_',' ')}</span>
              <span>"{f.value}"</span>
              <button onClick={()=>removeFilter(f.id)} style={{background:'none',border:'none',color:'#475569',cursor:'pointer',padding:'0 0 0 4px',fontSize:12,lineHeight:1}}>×</button>
            </span>
          ))}
          <button onClick={()=>{setApplied([]);resetPage();}} style={{padding:'2px 8px',fontSize:11,background:'none',
            color:'#475569',border:'1px solid #334155',borderRadius:20,cursor:'pointer'}}>Clear all</button>
        </div>
      )}

      {/* ── Loading ──────────────────────────────────────── */}
      {isLoading&&(
        <div style={{display:'flex',alignItems:'center',justifyContent:'center',flex:1,gap:10,color:'#64748b'}}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" style={{animation:'spin 0.8s linear infinite'}}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" opacity="0.25"/>
            <path fill="currentColor" opacity="0.75" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <span style={{fontSize:13}}>Loading bogus by-hand complaints…</span>
        </div>
      )}

      {/* ── Table ────────────────────────────────────────── */}
      {!isLoading&&(rows.length===0?(
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#475569'}}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{opacity:0.35,marginBottom:10}}>
            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.58-7 8-7s8 3 8 7"/>
          </svg>
          <div style={{fontSize:13,fontWeight:500}}>No bogus by-hand records found</div>
          <div style={{fontSize:11,marginTop:4,color:'#334155'}}>Try adjusting filters.</div>
        </div>
      ):(
        <>
          <div style={{flex:1,overflowY:'auto',overflowX:'auto',minHeight:0}}>
            <table style={{borderCollapse:'collapse',fontSize:12,minWidth:MIN_W}}>
              <thead style={{position:'sticky',top:0,zIndex:2}}>
                <tr style={{background:'#0f172a',borderBottom:'2px solid #1e293b'}}>
                  {COLS.map(c=>{
                    const frozen=FROZEN_KEYS.includes(c.key);
                    return <th key={c.key} style={{
                      padding:'9px 10px',color:'#94a3b8',fontWeight:600,fontSize:11,
                      whiteSpace:'nowrap',textTransform:'uppercase',letterSpacing:'0.04em',
                      width:c.w,minWidth:c.w,background:'#0f172a',
                      ...(frozen?{position:'sticky',left:FROZEN_LEFT[c.key],zIndex:3,
                        boxShadow:c.key==='complRegNum'?'2px 0 4px rgba(0,0,0,0.4)':undefined}:{}),
                    }}>{c.label}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((r:any,i:number)=>{
                  const sg=(r.statusGroup||'').toLowerCase();
                  const sc=STATUS_CLR[sg]||{bg:'rgba(234,179,8,0.1)',col:'#eab308'};
                  const rowNum=(page-1)*pageSize+i+1;
                  const even=i%2===0;
                  const rowBg=even?'#0b1120':'#0d1829';
                  return (
                    <tr key={r.complRegNum||i} style={{background:rowBg,borderBottom:'1px solid rgba(30,41,59,0.7)'}}
                      onMouseEnter={e=>(e.currentTarget as HTMLTableRowElement).style.background='#162032'}
                      onMouseLeave={e=>(e.currentTarget as HTMLTableRowElement).style.background=rowBg}>
                      {COLS.map(c=>{
                        const frozen=FROZEN_KEYS.includes(c.key);
                        const style: React.CSSProperties={
                          padding:'8px 10px',whiteSpace:'nowrap',
                          ...(frozen?{position:'sticky',left:FROZEN_LEFT[c.key],background:rowBg,zIndex:1,
                            boxShadow:c.key==='complRegNum'?'2px 0 4px rgba(0,0,0,0.3)':undefined}:{}),
                        };
                        let cell:React.ReactNode;
                        if (c.key==='#') cell=<span style={{color:'#475569'}}>{rowNum}</span>;
                        else if (c.key==='complRegNum') cell=<span style={{color:'#60a5fa',cursor:'pointer',textDecoration:'underline',fontWeight:600}}
                          onClick={()=>openDrawer(`Complaint: ${r.complRegNum}`,{search:r.complRegNum} as any)}>{r.complRegNum}</span>;
                        else if (c.key==='mobile') cell=r.mobile
                          ?<span style={{color:'#f87171',fontFamily:'monospace',padding:'2px 5px',background:'rgba(239,68,68,0.1)',borderRadius:3}}>{r.mobile}</span>
                          :<span style={{color:'#ef4444',fontStyle:'italic',fontSize:10}}>NULL</span>;
                        else if (c.key==='statusGroup') cell=<span style={{padding:'2px 8px',borderRadius:4,fontSize:10,fontWeight:600,background:sc.bg,color:sc.col}}>{r.statusGroup||'—'}</span>;
                        else if (DATE_COLS.has(c.key)) cell=<span style={{color:'#94a3b8'}}>{fmtDate(r[c.key])}</span>;
                        else { const val=r[c.key]; cell=val!=null&&val!==''?<span style={{color:'#cbd5e1'}}>{String(val)}</span>:<span style={{color:'#334155'}}>—</span>; }
                        return <td key={c.key} style={style}>{cell}</td>;
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ── Sticky Pagination Footer ── */}
          <div style={{flexShrink:0,display:'flex',alignItems:'center',justifyContent:'space-between',
            flexWrap:'wrap',gap:8,padding:'9px 8px',marginTop:6,
            borderTop:'1px solid #1e293b',background:'#0d1424',
            boxShadow:'0 -4px 20px rgba(0,0,0,0.6)',position:'sticky',bottom:0,zIndex:10}}>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <span style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>Rows:</span>
              <select value={pageSize} onChange={e=>{setPageSize(Number(e.target.value));resetPage();}}
                style={{background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155',borderRadius:4,padding:'3px 5px',fontSize:11,outline:'none'}}>
                {[20,50,100,200].map(n=><option key={n} value={n} style={{background:'#1e293b'}}>{n}</option>)}
              </select>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:11,color:'#64748b',whiteSpace:'nowrap'}}>
                Page <strong style={{color:'#e2e8f0'}}>{page}</strong> / <strong style={{color:'#e2e8f0'}}>{totalPages}</strong>
                <span style={{color:'#475569'}}> · {total.toLocaleString()} total</span>
              </span>
              <div style={{display:'flex',gap:3}}>
                {navBtn(page<=1,         ()=>setPage(1),         '«')}
                {navBtn(page<=1,         ()=>setPage(p=>p-1),   '‹')}
                {navBtn(page>=totalPages,()=>setPage(p=>p+1),   '›')}
                {navBtn(page>=totalPages,()=>setPage(totalPages),'»')}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:3,marginLeft:4,borderLeft:'1px solid #1e293b',paddingLeft:8}}>
                <span style={{fontSize:10,color:'#64748b'}}>Go:</span>
                <input type="number" min={1} max={totalPages} value={gotoPage}
                  onChange={e=>setGotoPage(e.target.value)}
                  onKeyDown={e=>{if(e.key==='Enter'){const p=parseInt(gotoPage,10);if(!isNaN(p)&&p>=1&&p<=totalPages){setPage(p);setGotoPage('');}}}}
                  style={{width:42,background:'#1e293b',color:'#e2e8f0',border:'1px solid #334155',borderRadius:4,padding:'2px 4px',fontSize:11,outline:'none',textAlign:'center'}}/>
                <button onClick={()=>{const p=parseInt(gotoPage,10);if(!isNaN(p)&&p>=1&&p<=totalPages){setPage(p);setGotoPage('');}}}
                  style={{padding:'2px 7px',background:'rgba(99,102,241,0.2)',color:'#818cf8',border:'1px solid rgba(99,102,241,0.4)',borderRadius:4,fontSize:10,cursor:'pointer'}}>Go</button>
              </div>
            </div>
          </div>
        </>
      ))}
    </div>
  );
};
