const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const numFmt = new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
const oneFmt = new Intl.NumberFormat("en-US",{minimumFractionDigits:1,maximumFractionDigits:1});

const state = {
  index:null,
  outlet:null,
  runtimeOutlets:null,
  bound:false,
  selectedCode:"",
  search:"",
  categoryFocus:"",
  start:"",
  end:"",
  metric:"sales",
  networkSummaryMonth:"",
  projectionScope:"outlet",
  projectionMonth:"",
  allSort:{key:"category",dir:"asc"},
  projectedSort:{key:"category",dir:"asc"},
};

function valueNum(v){ const n=Number(v); return Number.isFinite(n)?n:0; }

function formatSnapshotTime(value){
  const parsed=value?new Date(value):null;
  if(!parsed||Number.isNaN(parsed.getTime())) return "unavailable";
  return parsed.toLocaleString("en-GB",{
    day:"2-digit",month:"short",year:"numeric",hour:"numeric",minute:"2-digit",hour12:true,timeZone:"Asia/Dhaka"
  });
}

function showPublicSnapshotTime(value){
  const node=$("public-snapshot-time");
  if(node) node.textContent=`Last snapshot taken: ${formatSnapshotTime(value)}`;
}

function trimNumber(n,maxDecimals=2){
  return new Intl.NumberFormat("en-US",{
    minimumFractionDigits:0,
    maximumFractionDigits:maxDecimals
  }).format(n);
}

function bdCompact(v){
  const n=valueNum(v);
  const sign=n<0?"-":"";
  const a=Math.abs(n);

  // Bangladesh display convention requested for the dashboard:
  // 1,00,00,000+  -> Cr.
  // 1,00,000+     -> Lac
  // 10,000+       -> K
  // below 10,000  -> exact value
  if(a>=10000000) return `${sign}${trimNumber(a/10000000,2)} Cr.`;
  if(a>=100000)   return `${sign}${trimNumber(a/100000,2)} Lac`;
  if(a>=10000)    return `${sign}${trimNumber(a/1000,2)}K`;
  return `${sign}${trimNumber(a,2)}`;
}
function pct(v){ return Number.isFinite(v)?`${oneFmt.format(v*100)}%`:"—"; }
function money(v){ return bdCompact(v); }
function basket(v){ return Number.isFinite(v)?oneFmt.format(v):"—"; }
function monthLong(k){ return new Date(`${k}-01T00:00:00`).toLocaleDateString("en-US",{month:"long",year:"numeric"}); }
function monthShort(k){ return new Date(`${k}-01T00:00:00`).toLocaleDateString("en-US",{month:"short",year:"2-digit"}); }
function shiftMonth(k,offset){
  const [y,m]=k.split("-").map(Number);
  const d=new Date(y,m-1+offset,1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function rangeMonths(){
  return state.index.actualMonths.filter(m=>m>=state.start && m<=state.end);
}
function latestRecord(month){ return state.outlet?.months?.[month] || [[],[]]; }

function computeRowsFromDetail(sDetail=[],fDetail=[]){
  const s=[], f=[];
  state.index.allYearRows.forEach((r,i)=>{
    if(r.kind==="detail"){
      s[i]=valueNum(sDetail[r.detailIndex]);
      f[i]=valueNum(fDetail[r.detailIndex]);
    }else{
      s[i]=(r.deps||[]).reduce((a,d)=>a+valueNum(s[d]),0);
      f[i]=(r.deps||[]).reduce((a,d)=>a+valueNum(f[d]),0);
    }
  });
  return {sales:s,ff:f,basket:s.map((v,i)=>f[i]?v/f[i]:null)};
}
function computeOutletRows(month){
  const rec=latestRecord(month);
  return computeRowsFromDetail(rec[0] || [],rec[1] || []);
}
function selectedNetworkSummary(){
  if(!state.networkSummaryMonth) return null;
  return (state.index.networkMonthSummaries || []).find(x=>x.month===state.networkSummaryMonth) || null;
}
function networkSummaryForMonth(month){
  return (state.index.networkMonthSummaries || []).find(x=>x.month===month) || null;
}
function computeNetworkRows(month){
  const summary=networkSummaryForMonth(month);
  if(!summary) return computeRowsFromDetail([],[]);
  return computeRowsFromDetail(summary.sales || [],summary.ff || []);
}
function projectionScopeLabel(){
  if(state.projectionScope==="all") return "All outlets";
  return state.outlet ? `${state.outlet.code} — ${state.outlet.name}` : "Selected outlet";
}
function allPeriodData(){
  const summary=selectedNetworkSummary();
  if(summary){
    return {
      months:[summary.month],
      monthRows:{[summary.month]:computeRowsFromDetail(summary.sales || [],summary.ff || [])},
      summary
    };
  }
  const months=rangeMonths();
  const monthRows={};
  months.forEach(m=>monthRows[m]=computeOutletRows(m));
  return {months,monthRows,summary:null};
}
function metricLabel(){ return state.metric==="sales"?"Sales":state.metric==="ff"?"FF":"Basket"; }
function formatMetric(v){
  if(state.metric==="basket") return basket(v);
  return money(v);
}

function outletSearchText(o){
  return `${o.code} ${o.name}`.toLowerCase();
}

function matchingOutlets(query){
  const q=String(query||"").trim().toLowerCase();
  if(!q) return [];
  const terms=q.split(/\s+/).filter(Boolean);

  return state.index.outlets
    .filter(o=>terms.every(t=>outletSearchText(o).includes(t)))
    .sort((a,b)=>{
      const ac=a.code.toLowerCase(), bc=b.code.toLowerCase();
      const an=a.name.toLowerCase(), bn=b.name.toLowerCase();
      const as=ac===q?0:ac.startsWith(q)?1:an.startsWith(q)?2:3;
      const bs=bc===q?0:bc.startsWith(q)?1:bn.startsWith(q)?2:3;
      return as-bs || a.code.localeCompare(b.code,undefined,{numeric:true,sensitivity:"base"});
    });
}

function searchableCategories(){
  return (state.index.allYearRows || [])
    .filter(r=>normLabel(r.label)!=="grand total")
    .map(r=>({label:r.label,kind:r.kind}));
}

function matchingCategories(query){
  const q=String(query||"").trim().toLowerCase();
  if(!q) return [];
  const terms=q.split(/\s+/).filter(Boolean);

  return searchableCategories()
    .filter(c=>terms.every(t=>c.label.toLowerCase().includes(t)))
    .sort((a,b)=>{
      const al=a.label.toLowerCase(), bl=b.label.toLowerCase();
      const as=al===q?0:al.startsWith(q)?1:2;
      const bs=bl===q?0:bl.startsWith(q)?1:2;
      return as-bs || a.label.localeCompare(b.label,undefined,{sensitivity:"base"});
    });
}

function hideOutletSuggestions(){
  $("outlet-search-suggestions").classList.add("hidden");
  $("outlet-search-suggestions").innerHTML="";
}

function hideCategorySuggestions(){
  $("category-search-suggestions").classList.add("hidden");
  $("category-search-suggestions").innerHTML="";
}

function renderOutletSuggestions(){
  const q=$("outlet-search").value.trim();
  const box=$("outlet-search-suggestions");

  if(!q){
    hideOutletSuggestions();
    return;
  }

  const matches=matchingOutlets(q);
  if(!matches.length){
    box.innerHTML=`<div class="suggestion-empty">No matching outlet found</div>`;
    box.classList.remove("hidden");
    return;
  }

  const visible=matches.slice(0,40);
  box.innerHTML=visible.map(o=>`
    <button type="button" class="suggestion-item suggestion-outlet" data-code="${esc(o.code)}" role="option">
      <span class="suggestion-badge outlet-badge">OUTLET</span>
      <span class="suggestion-main">
        <strong>${esc(o.code)}</strong>
        <span>${esc(o.name)}</span>
      </span>
    </button>
  `).join("")+
  (matches.length>visible.length
    ? `<div class="suggestion-more">${numFmt.format(matches.length-visible.length)} more outlet result(s) — keep typing to narrow</div>`
    : "");

  box.classList.remove("hidden");

  box.querySelectorAll(".suggestion-item").forEach(btn=>{
    btn.addEventListener("mousedown",e=>{
      e.preventDefault();
      selectSearchOutlet(btn.dataset.code);
    });
  });
}

function renderCategorySuggestions(){
  const q=$("category-search").value.trim();
  const box=$("category-search-suggestions");

  if(!q){
    hideCategorySuggestions();
    return;
  }

  const matches=matchingCategories(q);
  if(!matches.length){
    box.innerHTML=`<div class="suggestion-empty">No matching category found</div>`;
    box.classList.remove("hidden");
    return;
  }

  box.innerHTML=matches.slice(0,30).map(c=>`
    <button type="button" class="suggestion-item suggestion-category" data-label="${esc(c.label)}" role="option">
      <span class="suggestion-badge category-badge">${c.kind==="total"?"GROUP":"CATEGORY"}</span>
      <span class="suggestion-main">
        <strong>${esc(c.label)}</strong>
        <span>${c.kind==="total"?"Category group / total":"Category performance"}</span>
      </span>
    </button>
  `).join("");

  box.classList.remove("hidden");

  box.querySelectorAll(".suggestion-item").forEach(btn=>{
    btn.addEventListener("mousedown",e=>{
      e.preventDefault();
      selectSearchCategory(btn.dataset.label);
    });
  });
}

function selectSearchOutlet(code){
  const o=state.index.outlets.find(x=>x.code===code);
  if(!o) return;

  // Keep the selected category active while changing outlets.
  $("outlet-search").value=`${o.code} — ${o.name}`;
  hideOutletSuggestions();
  loadOutlet(code);
}

function selectSearchCategory(label){
  const row=(state.index.allYearRows || []).find(r=>normLabel(r.label)===normLabel(label));
  if(!row) return;

  state.categoryFocus=row.label;
  $("category-search").value=row.label;
  hideCategorySuggestions();
  syncProjectionFromTopControls();
  renderAll();
}

function clearCategoryFocus(){
  if(!state.categoryFocus) return;
  state.categoryFocus="";
  syncProjectionFromTopControls();
  renderAll();
}

function focusedAllYearIndex(){
  if(!state.categoryFocus) return state.index.allYearGrandIndex;
  const idx=(state.index.allYearRows || []).findIndex(r=>normLabel(r.label)===normLabel(state.categoryFocus));
  return idx>=0 ? idx : state.index.allYearGrandIndex;
}

function focusedAllYearLabel(){
  if(!state.categoryFocus) return "Grand Total";
  return state.categoryFocus;
}

function focusedProjectedRow(p){
  if(!state.categoryFocus) return p.grand;
  return p.rows.find(r=>normLabel(r.label)===normLabel(state.categoryFocus)) || p.grand;
}

function renderNetworkMonthOptions(){
  const summaries=[...(state.index.networkMonthSummaries || [])].sort((a,b)=>a.month.localeCompare(b.month));
  $("network-month-select").innerHTML=
    `<option value="">Selected outlet / date range</option>`+
    summaries.map(s=>`<option value="${esc(s.month)}">${esc(monthLong(s.month))} — ${numFmt.format(s.outletCount || 0)} outlets</option>`).join("");
  $("network-month-select").value=state.networkSummaryMonth;
}

function renderProjectionControls(){
  const months=[...(state.index.actualMonths || [])].sort();
  $("projection-month").innerHTML=months.map(m=>`<option value="${esc(m)}">${esc(monthLong(m))}</option>`).join("");
  if(!state.projectionMonth || !months.includes(state.projectionMonth)){
    state.projectionMonth=state.end || months.at(-1) || "";
  }
  $("projection-month").value=state.projectionMonth;
  $("projection-scope").value=state.projectionScope;
}

/*
  Auto-sync rule:
  - Real outlet selection => Projection Scope = Selected outlet.
  - All-outlet Month Summary selection => Projection Scope = All outlets
    and Projection Last Month = that selected summary month.
  - Returning All-outlet Month Summary to "Selected outlet / date range"
    => Projection Scope = Selected outlet and Last Month = current To Month.
  - Category selection keeps the same scope/month context, but refreshes
    Dashboard 02 for that category.
  Manual Projection Scope / Last Month changes remain possible afterward.
  A later change in the top command-center controls auto-syncs again.
*/
function syncProjectionFromTopControls(){
  const summary=selectedNetworkSummary();

  if(summary){
    state.projectionScope="all";
    state.projectionMonth=summary.month;
  }else{
    state.projectionScope="outlet";
    state.projectionMonth=state.end;
  }

  renderProjectionControls();
}

async function loadOutlet(code){
  const meta=state.index.outlets.find(o=>o.code===code);
  if(!meta) return;
  $("outlet-search").value=`${meta.code} — ${meta.name}`;
  if(state.runtimeOutlets?.[code]){
    state.outlet=state.runtimeOutlets[code];
  }else{
    const sharedOutlet=await window.ZReportDrive?.loadOutlet?.(code);
    if(sharedOutlet){
      state.outlet=sharedOutlet;
    }else{
      if(!meta.file) throw new Error(`Could not load shared outlet ${code}`);
      const res=await fetch(meta.file,{cache:"no-store"});
      if(!res.ok) throw new Error(`Could not load outlet ${code}`);
      state.outlet=await res.json();
    }
  }
  state.selectedCode=code;
  syncProjectionFromTopControls();
  renderAll();
}

function kpi(label,value,note="",cls=""){
  return `<article class="kpi ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></article>`;
}
function renderAllYearKpis(){
  const {months,monthRows,summary}=allPeriodData();
  const fi=focusedAllYearIndex();
  const focus=focusedAllYearLabel();
  let sales=0,ff=0;
  months.forEach(m=>{sales+=valueNum(monthRows[m].sales[fi]);ff+=valueNum(monthRows[m].ff[fi]);});
  const latest=months.at(-1);
  const prev=months.length>1?months.at(-2):null;
  const latestSales=latest?valueNum(monthRows[latest].sales[fi]):0;
  const prevSales=prev?valueNum(monthRows[prev].sales[fi]):0;
  const growth=prevSales?latestSales/prevSales-1:null;
  const avg=months.length?sales/months.length:0;
  $("all-year-kpis").innerHTML=[
    kpi("Period Sales",money(sales),summary?`${focus} · ${monthLong(summary.month)}`:`${focus} · ${months.length} month(s)`,"accent"),
    kpi("Period FF",money(ff),focus),
    kpi("Period Basket",ff?basket(sales/ff):"—","Sales ÷ FF"),
    kpi("Avg Monthly Sales",money(avg),focus),
    kpi("Latest Month Sales",money(latestSales),latest?monthLong(latest):""),
    kpi("Latest MoM Growth",growth===null?"—":pct(growth),prev?`vs ${monthLong(prev)}`:"",growth!==null&&growth>=0?"good":"warn"),
  ].join("");
}

function renderTrend(){
  const {months,monthRows}=allPeriodData();
  const fi=focusedAllYearIndex();
  const focus=focusedAllYearLabel();
  const values=months.map(m=>monthRows[m][state.metric][fi]);
  $("trend-title").textContent=`Monthly ${metricLabel()} — ${focus}`;
  $("trend-value").textContent=values.length?formatMetric(values.at(-1)):"—";
  if(!values.length){
    $("trend-chart").innerHTML=`<div class="empty">No months in selected range.</div>`;return;
  }

  const W=1200,H=205,padL=58,padR=20,padT=14,padB=34;
  const nums=values.map(v=>v===null?0:valueNum(v));
  let min=Math.min(...nums), max=Math.max(...nums);
  if(min===max){min=0;max=max||1;}
  const x=i=>padL+(W-padL-padR)*(nums.length===1?.5:i/(nums.length-1));
  const y=v=>padT+(H-padT-padB)*(1-(v-min)/(max-min));
  const points=nums.map((v,i)=>`${x(i)},${y(v)}`).join(" ");
  const area=`${padL},${H-padB} ${points} ${x(nums.length-1)},${H-padB}`;
  let grid="";
  for(let i=0;i<5;i++){
    const yy=padT+(H-padT-padB)*i/4;
    const val=max-(max-min)*i/4;
    grid+=`<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" class="chart-gridline"/><text x="4" y="${yy+3}" class="chart-y-label">${esc(state.metric==="basket"?oneFmt.format(val):bdCompact(val))}</text>`;
  }
  const step=Math.max(1,Math.ceil(months.length/10));
  const labels=months.map((m,i)=>(i%step===0||i===months.length-1)?`<text x="${x(i)}" y="${H-8}" text-anchor="middle" class="chart-label">${esc(monthShort(m))}</text>`:"").join("");
  const dots=nums.map((v,i)=>`<circle cx="${x(i)}" cy="${y(v)}" r="3.2" class="chart-point"><title>${esc(monthLong(months[i]))}: ${esc(formatMetric(values[i]))}</title></circle>`).join("");
  $("trend-chart").innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${grid}<polygon points="${area}" class="chart-area"/><polyline points="${points}" class="chart-line"/>${dots}${labels}</svg>`;
}

function compare(a,b){
  if(typeof a==="number"&&typeof b==="number") return a-b;
  if(a===null&&b!==null) return -1;
  if(a!==null&&b===null) return 1;
  return String(a??"").localeCompare(String(b??""),undefined,{numeric:true,sensitivity:"base"});
}
function renderAllYearTable(){
  const {months,monthRows}=allPeriodData();
  let rows=state.index.allYearRows.map((r,i)=>({def:r,index:i}));
  if(state.categoryFocus){
    rows=rows.filter(x=>normLabel(x.def.label)===normLabel(state.categoryFocus));
  }
  const grandRows=rows.filter(x=>normLabel(x.def.label)==="grand total");
  rows=rows.filter(x=>normLabel(x.def.label)!=="grand total");
  const sk=state.allSort.key, dir=state.allSort.dir==="asc"?1:-1;
  rows.sort((a,b)=>{
    if(sk==="category") return compare(a.def.label,b.def.label)*dir;
    const av=monthRows[sk]?.[state.metric]?.[a.index];
    const bv=monthRows[sk]?.[state.metric]?.[b.index];
    return compare(av,bv)*dir;
  });
  rows.push(...grandRows);

  $("all-year-head").innerHTML=[
    `<th class="category ${sk==="category"?"sorted":""}" data-sort="category">Category <span class="sortmark">${sk==="category"?(dir===1?"▲":"▼"):"↕"}</span></th>`,
    ...months.map(m=>`<th class="${sk===m?"sorted":""}" data-sort="${m}">${esc(monthShort(m))} <span class="sortmark">${sk===m?(dir===1?"▲":"▼"):"↕"}</span></th>`)
  ].join("");

  $("all-year-body").innerHTML=rows.map(({def,index})=>{
    const grand=normLabel(def.label)==="grand total";
    const cls=grand?"grand-row":def.kind==="total"?"total-row":"";
    return `<tr class="${cls}"><td class="category">${esc(def.label)}</td>${months.map(m=>`<td class="num">${esc(formatMetric(monthRows[m][state.metric][index]))}</td>`).join("")}</tr>`;
  }).join("");

  const summary=selectedNetworkSummary();
  const focusSuffix=state.categoryFocus?` · Category: ${state.categoryFocus}`:"";
  $("all-year-table-summary").textContent=(summary
    ? `${monthLong(summary.month)} · ${metricLabel()} · All outlets · ${numFmt.format(summary.outletCount || 0)} outlets`
    : `${months.length} month(s) · ${metricLabel()} · ${state.outlet.code} — ${state.outlet.name}`)+focusSuffix;
  $("all-year-head").querySelectorAll("th[data-sort]").forEach(th=>th.addEventListener("click",()=>{
    const key=th.dataset.sort;
    if(state.allSort.key===key) state.allSort.dir=state.allSort.dir==="asc"?"desc":"asc";
    else state.allSort={key,dir:"asc"};
    renderAllYearTable();
  }));
}
function normLabel(v){return String(v||"").trim().toLowerCase().replace(/\s+/g," ");}

function computeProjectedRows(){
  const end=state.projectionMonth || state.end;
  const lastYear=shiftMonth(end,-12);
  const priorLastYear=shiftMonth(lastYear,-1);
  const target=shiftMonth(end,1);

  const useAll=state.projectionScope==="all";
  const lastYearAll=useAll ? computeNetworkRows(lastYear) : computeOutletRows(lastYear);
  const lastMonthAll=useAll ? computeNetworkRows(end) : computeOutletRows(end);
  const gi=state.index.allYearGrandIndex;

  // Seasonal factor remains network-based, matching the workbook model.
  const netLY=state.index.networkTotals[lastYear]||[0,0];
  const netPrev=state.index.networkTotals[priorLastYear]||[0,0];
  const seasonSales=netPrev[0]?netLY[0]/netPrev[0]-1:null;
  const seasonFF=netPrev[1]?netLY[1]/netPrev[1]-1:null;

  const lmGrandSales=valueNum(lastMonthAll.sales[gi]);
  const lmGrandFF=valueNum(lastMonthAll.ff[gi]);
  const projectedGrandSales=seasonSales===null?0:lmGrandSales*(1+seasonSales);
  const projectedGrandFF=seasonFF===null?0:lmGrandFF*(1+seasonFF);

  const detailRowsByLabel=new Map(
    state.index.allYearRows.map((r,i)=>[normLabel(r.label),{def:r,index:i}])
  );

  const result=[];

  state.index.projectedRows.forEach((r)=>{
    let vals;
    if(r.kind==="detail"){
      const ay=detailRowsByLabel.get(normLabel(r.label));
      const ai=ay?.index;
      const lyS=ai===undefined?0:valueNum(lastYearAll.sales[ai]);
      const lyF=ai===undefined?0:valueNum(lastYearAll.ff[ai]);
      const lmS=ai===undefined?0:valueNum(lastMonthAll.sales[ai]);
      const lmF=ai===undefined?0:valueNum(lastMonthAll.ff[ai]);
      const pS=lmGrandSales?lmS/lmGrandSales*projectedGrandSales:0;
      const pF=lmGrandFF?lmF/lmGrandFF*projectedGrandFF:0;
      vals={
        lyS,lyF,lyB:lyF?lyS/lyF:null,
        lmS,lmF,lmB:lmF?lmS/lmF:null,
        pS,pF,pB:pF?pS/pF:null,
        con:lmGrandSales?lmS/lmGrandSales:0
      };
    }else{
      const deps=(r.deps||[]).map(d=>result[d]).filter(Boolean);
      const sum=k=>deps.reduce((a,x)=>a+valueNum(x[k]),0);
      const lyS=sum("lyS"),lyF=sum("lyF"),
            lmS=sum("lmS"),lmF=sum("lmF"),
            pS=sum("pS"),pF=sum("pF");
      vals={
        lyS,lyF,lyB:lyF?lyS/lyF:null,
        lmS,lmF,lmB:lmF?lmS/lmF:null,
        pS,pF,pB:pF?pS/pF:null,
        con:lmGrandSales?lmS/lmGrandSales:0
      };
    }
    vals.dS=vals.pS-vals.lyS;
    vals.dF=vals.pF-vals.lyF;
    vals.dB=(vals.pB===null||vals.lyB===null)?null:vals.pB-vals.lyB;
    result.push({...r,...vals});
  });

  const grand=result.find(r=>normLabel(r.label)==="grand total") || result.at(-1);
  return {
    rows:result,grand,lastYear,priorLastYear,lastMonth:end,target,
    seasonSales,seasonFF,projectedGrandSales,projectedGrandFF,
    scope:useAll?"all":"outlet"
  };
}

function renderProjected(){
  const p=computeProjectedRows();
  const focusRow=focusedProjectedRow(p);
  const focusLabel=state.categoryFocus || "Grand Total";
  const overallGrowth=focusRow.lyS?focusRow.pS/focusRow.lyS-1:null;
  const mom=focusRow.lmS?focusRow.pS/focusRow.lmS-1:null;

  $("projected-kpis").innerHTML=[
    kpi("Last Year Sales",money(focusRow.lyS),`${focusLabel} · ${monthLong(p.lastYear)}`),
    kpi("Last Month Sales",money(focusRow.lmS),`${focusLabel} · ${monthLong(p.lastMonth)}`),
    kpi("Projected Sales",money(focusRow.pS),`${focusLabel} · ${monthLong(p.target)}`,"accent"),
    kpi("Projected YoY Growth",overallGrowth===null?"—":pct(overallGrowth),`vs ${monthLong(p.lastYear)}`,overallGrowth!==null&&overallGrowth>=0?"good":"warn"),
    kpi("Projection MoM",mom===null?"—":pct(mom),`vs ${monthLong(p.lastMonth)}`,mom!==null&&mom>=0?"good":"warn"),
    kpi("Network Seasonal Factor",p.seasonSales===null?"—":pct(p.seasonSales),`${monthLong(p.lastYear)} vs ${monthLong(p.priorLastYear)}`),
  ].join("");

  const scopeLabel=projectionScopeLabel();
  $("projected-caption").textContent=`${scopeLabel} · Last Month: ${monthLong(p.lastMonth)}${state.categoryFocus?` · Category: ${state.categoryFocus}`:""}`;
  $("projection-info").innerHTML=`<strong>Scope:</strong> ${esc(scopeLabel)} &nbsp; | &nbsp; <strong>Last Year:</strong> ${esc(monthLong(p.lastYear))} &nbsp; | &nbsp; <strong>Last Month:</strong> ${esc(monthLong(p.lastMonth))} &nbsp; | &nbsp; <strong>Projected:</strong> ${esc(monthLong(p.target))} &nbsp; | &nbsp; Network seasonal Sales factor: <strong>${esc(p.seasonSales===null?"N/A":pct(p.seasonSales))}</strong> · FF factor: <strong>${esc(p.seasonFF===null?"N/A":pct(p.seasonFF))}</strong>`;

  renderProjectedTable(p);
}

const projectedColumns=[
  ["category","Category","text"],
  ["lyS","Sales","number"],["lyF","FF","number"],["lyB","Basket","number"],
  ["lmS","Sales","number"],["lmF","FF","number"],["lmB","Basket","number"],
  ["pS","Sales","number"],["pF","FF","number"],["pB","Basket","number"],
  ["dS","Δ Sales","number"],["dF","Δ FF","number"],["dB","Δ Basket","number"],
  ["con","Con %","number"],
];
function projectedCell(row,key){
  if(key==="category") return row.label;
  if(key==="lyB"||key==="lmB"||key==="pB"||key==="dB") return row[key]===null?"—":basket(row[key]);
  if(key==="con") return pct(row[key]);
  if(key==="lyS"||key==="lmS"||key==="pS"||key==="dS") return money(row[key]);
  return money(row[key]);
}
function deltaClass(key,v){
  if(!["dS","dF","dB"].includes(key)||v===null) return "";
  return valueNum(v)>0?"delta-positive":valueNum(v)<0?"delta-negative":"delta-neutral";
}
function renderProjectedTable(p){
  const sk=state.projectedSort.key, dir=state.projectedSort.dir==="asc"?1:-1;
  let rows=[...p.rows];
  if(state.categoryFocus){
    rows=rows.filter(r=>normLabel(r.label)===normLabel(state.categoryFocus));
  }
  const grandRows=rows.filter(r=>normLabel(r.label)==="grand total");
  rows=rows.filter(r=>normLabel(r.label)!=="grand total");
  rows.sort((a,b)=>{
    const av=sk==="category"?a.label:a[sk], bv=sk==="category"?b.label:b[sk];
    return compare(av,bv)*dir;
  });
  rows.push(...grandRows);

  const top=`<tr><th rowspan="2" class="category" data-sort="category">Category <span class="sortmark">${sk==="category"?(dir===1?"▲":"▼"):"↕"}</span></th>
    <th colspan="3" class="group-blue">LAST YEAR · ${esc(monthShort(p.lastYear))}</th>
    <th colspan="3" class="group-blue">LAST MONTH · ${esc(monthShort(p.lastMonth))}</th>
    <th colspan="3" class="group-green">PROJECTED · ${esc(monthShort(p.target))}</th>
    <th colspan="3" class="group-red">GROWTH / DE-GROWTH vs LAST YEAR</th>
    <th rowspan="2" data-sort="con">Con % <span class="sortmark">${sk==="con"?(dir===1?"▲":"▼"):"↕"}</span></th></tr>`;
  const sub=`<tr>${projectedColumns.slice(1,13).map(([key,label])=>`<th data-sort="${key}" class="${sk===key?"sorted":""}">${esc(label)} <span class="sortmark">${sk===key?(dir===1?"▲":"▼"):"↕"}</span></th>`).join("")}</tr>`;
  $("projected-head").innerHTML=top+sub;

  $("projected-body").innerHTML=rows.map(r=>{
    const grand=normLabel(r.label)==="grand total";
    const cls=grand?"grand-row":r.kind==="total"?"total-row":"";
    return `<tr class="${cls}">${projectedColumns.map(([key])=>{
      if(key==="category") return `<td class="category">${esc(r.label)}</td>`;
      return `<td class="num ${deltaClass(key,r[key])}">${esc(projectedCell(r,key))}</td>`;
    }).join("")}</tr>`;
  }).join("");

  $("projected-table-summary").textContent=`${rows.length} row(s) · ${projectionScopeLabel()} · Last Month ${monthLong(p.lastMonth)}${state.categoryFocus?` · Category: ${state.categoryFocus}`:""}`;
  $("projected-head").querySelectorAll("th[data-sort]").forEach(th=>th.addEventListener("click",()=>{
    const key=th.dataset.sort;
    if(state.projectedSort.key===key) state.projectedSort.dir=state.projectedSort.dir==="asc"?"desc":"asc";
    else state.projectedSort={key,dir:"asc"};
    renderProjected();
  }));
}

function csvCell(v){ return `"${String(v??"").replaceAll('"','""')}"`; }
function downloadAllYear(){
  const {months,monthRows}=allPeriodData();
  const lines=[[`Category`,...months.map(monthShort)].map(csvCell).join(",")];
  state.index.allYearRows.forEach((r,i)=>{
    if(state.categoryFocus && normLabel(r.label)!==normLabel(state.categoryFocus)) return;
    lines.push([r.label,...months.map(m=>{
      const v=monthRows[m][state.metric][i];
      return v===null||v===undefined?"":v;
    })].map(csvCell).join(","));
  });
  saveCsv(lines.join("\r\n"),`all_year_${state.selectedCode}_${state.start}_${state.end}_${state.metric}.csv`);
}
function downloadProjected(){
  const p=computeProjectedRows();
  const headers=projectedColumns.map(c=>c[1]);
  const lines=[headers.map(csvCell).join(",")];
  p.rows.forEach(r=>{
    if(state.categoryFocus && normLabel(r.label)!==normLabel(state.categoryFocus)) return;
    lines.push(projectedColumns.map(([k])=>{
      if(k==="category") return csvCell(r.label);
      const v=r[k];
      return csvCell(v===null||v===undefined?"":v);
    }).join(","));
  });
  const scopeName=state.projectionScope==="all"?"ALL_OUTLETS":state.selectedCode;
  saveCsv(lines.join("\r\n"),`projected_zreport_${scopeName}_${p.lastMonth}_to_${p.target}.csv`);
}
function saveCsv(text,name){
  const blob=new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
}

function validateRange(){
  const min=state.index.meta.earliestActualMonth, max=state.index.meta.latestActualMonth;
  if(state.start<min) state.start=min;
  if(state.end>max) state.end=max;
  if(state.start>state.end) state.start=state.end;
  $("date-start").value=state.start;
  $("date-end").value=state.end;
}
function setQuickRange(n){
  const end=state.end;
  if(n==="all") state.start=state.index.meta.earliestActualMonth;
  else state.start=shiftMonth(end,-(Number(n)-1));
  validateRange();
  syncProjectionFromTopControls();
  renderAll();
}
function renderAll(){
  if(!state.outlet) return;
  validateRange();
  const summary=selectedNetworkSummary();
  $("range-pill").textContent=summary
    ? `All outlets · ${monthShort(summary.month)}`
    : `${monthShort(state.start)} → ${monthShort(state.end)}`;
  $("all-year-caption").textContent=summary
    ? `All Outlets — ${monthLong(summary.month)} · ${numFmt.format(summary.outletCount || 0)} outlets`
    : `${state.outlet.code} — ${state.outlet.name}`;
  renderAllYearKpis();
  renderTrend();
  renderAllYearTable();
  renderProjected();
}
function resetAllFilters(){
  // Restore original dashboard defaults.
  state.start=state.index.defaultRange.start;
  state.end=state.index.defaultRange.end;
  state.networkSummaryMonth="";
  state.categoryFocus="";
  state.projectionScope="outlet";
  state.projectionMonth=state.end;

  // Return to the default internal outlet used by the dashboard.
  const defaultCode=state.index.outlets.find(o=>o.code==="D109")?.code || state.index.outlets[0]?.code || "";
  state.selectedCode=defaultCode;

  // Clear visible search inputs.
  $("outlet-search").value="";
  $("category-search").value="";
  hideOutletSuggestions();
  hideCategorySuggestions();

  // Restore top controls.
  $("network-month-select").value="";
  $("date-start").value=state.start;
  $("date-end").value=state.end;

  renderNetworkMonthOptions();
  renderProjectionControls();

  if(defaultCode){
    loadOutlet(defaultCode).then(()=>{
      // loadOutlet writes the selected outlet into the search field; clear it again
      // so Reset returns to the blank "Enter outlet code/name" state.
      $("outlet-search").value="";
      hideOutletSuggestions();
    });
  }else{
    renderAll();
  }
}

function bind(){
  $("outlet-search").addEventListener("input",()=>{
    if(!$("outlet-search").value.trim()){
      hideOutletSuggestions();
      return;
    }
    renderOutletSuggestions();
  });
  $("outlet-search").addEventListener("focus",()=>{
    if($("outlet-search").value.trim()) renderOutletSuggestions();
  });
  $("outlet-search").addEventListener("keydown",e=>{
    if(e.key==="Escape"){
      hideOutletSuggestions();
      return;
    }
    if(e.key==="Enter"){
      const first=$("outlet-search-suggestions").querySelector(".suggestion-item");
      if(first){
        e.preventDefault();
        selectSearchOutlet(first.dataset.code);
      }
    }
  });

  $("category-search").addEventListener("input",()=>{
    if(!$("category-search").value.trim()){
      hideCategorySuggestions();
      clearCategoryFocus();
      return;
    }
    renderCategorySuggestions();
  });
  $("category-search").addEventListener("focus",()=>{
    if($("category-search").value.trim()) renderCategorySuggestions();
  });
  $("category-search").addEventListener("keydown",e=>{
    if(e.key==="Escape"){
      hideCategorySuggestions();
      return;
    }
    if(e.key==="Enter"){
      const first=$("category-search-suggestions").querySelector(".suggestion-item");
      if(first){
        e.preventDefault();
        selectSearchCategory(first.dataset.label);
      }
    }
  });

  document.addEventListener("mousedown",e=>{
    if(!e.target.closest(".outlet-search")) hideOutletSuggestions();
    if(!e.target.closest(".category-search")) hideCategorySuggestions();
  });
  $("reset-filters").addEventListener("click",resetAllFilters);

  $("network-month-select").addEventListener("change",e=>{
    state.networkSummaryMonth=e.target.value;
    syncProjectionFromTopControls();
    renderAll();
  });
  $("projection-scope").addEventListener("change",e=>{
    state.projectionScope=e.target.value;
    renderProjected();
  });
  $("projection-month").addEventListener("change",e=>{
    state.projectionMonth=e.target.value;
    renderProjected();
  });
  $("date-start").addEventListener("change",e=>{
    state.start=e.target.value;
    validateRange();
    syncProjectionFromTopControls();
    renderAll();
  });
  $("date-end").addEventListener("change",e=>{
    state.end=e.target.value;
    validateRange();
    syncProjectionFromTopControls();
    renderAll();
  });
  document.querySelectorAll("[data-range]").forEach(b=>b.addEventListener("click",()=>setQuickRange(b.dataset.range)));
  $("metric-tabs").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    state.metric=b.dataset.metric;
    $("metric-tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));
    renderAllYearKpis();renderTrend();renderAllYearTable();
  }));
  $("download-all-year").addEventListener("click",downloadAllYear);
  $("download-projected").addEventListener("click",downloadProjected);
}

async function activateDataset(bundle,{keepSelection=false}={}){
  const index=bundle?.index || bundle;
  if(!index?.outlets?.length) throw new Error("The Z-Report dataset is empty.");
  showPublicSnapshotTime(bundle?.savedAt || bundle?.cloudUpdatedAt || index.meta?.generatedAt);
  const previousCode=keepSelection ? state.selectedCode : "";
  state.index=index;
  state.runtimeOutlets=bundle?.outlets || null;
  state.start=index.defaultRange.start;
  state.end=index.defaultRange.end;
  state.networkSummaryMonth="";
  state.categoryFocus="";
  state.projectionScope="outlet";
  state.projectionMonth=state.end;
  $("date-start").min=index.meta.earliestActualMonth;
  $("date-start").max=index.meta.latestActualMonth;
  $("date-end").min=index.meta.earliestActualMonth;
  $("date-end").max=index.meta.latestActualMonth;
  $("date-start").value=state.start;
  $("date-end").value=state.end;
  $("category-search").value="";
  $("source-pill").textContent=`${numFmt.format(index.meta.outletCount)} outlets · ${index.meta.sourceWorkbook}`;
  $("source-pill").title=`Actual months: ${index.meta.earliestActualMonth} to ${index.meta.latestActualMonth}\nAll Year header horizon includes ${index.meta.futureHeaderMonthCount} future month(s).`;
  state.selectedCode=index.outlets.some(o=>o.code===previousCode)
    ? previousCode
    : index.outlets.find(o=>o.code==="D109")?.code || index.outlets[0]?.code || "";
  renderNetworkMonthOptions();
  renderProjectionControls();
  if(!state.bound){ bind(); state.bound=true; }
  if(state.selectedCode){
    await loadOutlet(state.selectedCode);
    $("outlet-search").value="";
    hideOutletSuggestions();
  }
}

async function init(){
  try{
    const cached=await window.ZReportDrive.restore();
    if(cached){
      await activateDataset(cached);
    }else{
      const res=await fetch("data/index.json",{cache:"no-store"});
      if(!res.ok) throw new Error(`Could not load the retained dashboard snapshot (${res.status})`);
      await activateDataset(await res.json());
    }
    window.ZReportDrive.bind({
      onData: driveSnapshot=>activateDataset(driveSnapshot,{keepSelection:true}).catch(console.error),
      onStatus: status=>{
        const button=$("drive-reconnect");
        if(button) button.textContent=status.kind==="reading"?"Working…":"Reconnect Google Drive";
      },
    });
    await window.ZReportDrive.refresh({interactive:false});
  }catch(err){
    const owner=window.DashboardDriveOwner?.isOwner?.();
    const guidance=owner
      ? "Use Drive setup to connect the shared Google Drive folder containing the current Z-Report workbook."
      : "No published snapshot is currently available.";
    const detail=owner ? err.message : "The latest published dashboard data could not be loaded.";
    document.body.innerHTML=`<div style="padding:36px;font-family:Segoe UI,Arial;background:#070a0d;color:#fff;min-height:100vh"><h2>Dashboard could not load</h2><p>${esc(detail)}</p><p>${esc(guidance)}</p></div>`;
  }
}
init();
