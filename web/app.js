const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));
const numFmt = new Intl.NumberFormat("en-US",{maximumFractionDigits:0});
const oneFmt = new Intl.NumberFormat("en-US",{minimumFractionDigits:1,maximumFractionDigits:1});
const compactFmt = new Intl.NumberFormat("en-US",{notation:"compact",maximumFractionDigits:1});

const state = {
  index:null,
  outlet:null,
  selectedCode:"",
  search:"",
  start:"",
  end:"",
  metric:"sales",
  allSort:{key:"category",dir:"asc"},
  projectedSort:{key:"category",dir:"asc"},
};

function valueNum(v){ const n=Number(v); return Number.isFinite(n)?n:0; }
function pct(v){ return Number.isFinite(v)?`${oneFmt.format(v*100)}%`:"—"; }
function money(v){ return numFmt.format(Math.round(valueNum(v))); }
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

function computeAllRows(month){
  const rec=latestRecord(month);
  const sDetail=rec[0] || [];
  const fDetail=rec[1] || [];
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
function allPeriodData(){
  const months=rangeMonths();
  const monthRows={};
  months.forEach(m=>monthRows[m]=computeAllRows(m));
  return {months,monthRows};
}
function metricLabel(){ return state.metric==="sales"?"Sales":state.metric==="ff"?"FF":"Basket"; }
function formatMetric(v){
  if(state.metric==="basket") return basket(v);
  return money(v);
}

function renderOutletOptions(){
  const search=state.search.trim().toLowerCase();
  const list=state.index.outlets.filter(o=>!search || `${o.code} ${o.name}`.toLowerCase().includes(search));
  const current=state.selectedCode;
  $("outlet-select").innerHTML=list.map(o=>`<option value="${esc(o.code)}">${esc(o.code)} — ${esc(o.name)}</option>`).join("");
  if(list.some(o=>o.code===current)) $("outlet-select").value=current;
  else if(list.length){
    state.selectedCode=list[0].code;
    $("outlet-select").value=state.selectedCode;
  }
}
async function loadOutlet(code){
  const meta=state.index.outlets.find(o=>o.code===code);
  if(!meta) return;
  const res=await fetch(meta.file,{cache:"no-store"});
  if(!res.ok) throw new Error(`Could not load outlet ${code}`);
  state.outlet=await res.json();
  state.selectedCode=code;
  renderAll();
}

function kpi(label,value,note="",cls=""){
  return `<article class="kpi ${cls}"><div class="kpi-label">${esc(label)}</div><div class="kpi-value">${esc(value)}</div><div class="kpi-note">${esc(note)}</div></article>`;
}
function renderAllYearKpis(){
  const {months,monthRows}=allPeriodData();
  const gi=state.index.allYearGrandIndex;
  let sales=0,ff=0;
  months.forEach(m=>{sales+=valueNum(monthRows[m].sales[gi]);ff+=valueNum(monthRows[m].ff[gi]);});
  const latest=months.at(-1);
  const prev=months.length>1?months.at(-2):null;
  const latestSales=latest?valueNum(monthRows[latest].sales[gi]):0;
  const prevSales=prev?valueNum(monthRows[prev].sales[gi]):0;
  const growth=prevSales?latestSales/prevSales-1:null;
  const avg=months.length?sales/months.length:0;
  $("all-year-kpis").innerHTML=[
    kpi("Period Sales",money(sales),`${months.length} selected month(s)`,"accent"),
    kpi("Period FF",money(ff),"Grand Total"),
    kpi("Period Basket",ff?basket(sales/ff):"—","Sales ÷ FF"),
    kpi("Avg Monthly Sales",money(avg),"Selected period"),
    kpi("Latest Month Sales",money(latestSales),latest?monthLong(latest):""),
    kpi("Latest MoM Growth",growth===null?"—":pct(growth),prev?`vs ${monthLong(prev)}`:"",growth!==null&&growth>=0?"good":"warn"),
  ].join("");
}

function renderTrend(){
  const {months,monthRows}=allPeriodData();
  const gi=state.index.allYearGrandIndex;
  const values=months.map(m=>monthRows[m][state.metric][gi]);
  $("trend-title").textContent=`Monthly ${metricLabel()} — Grand Total`;
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
    grid+=`<line x1="${padL}" y1="${yy}" x2="${W-padR}" y2="${yy}" class="chart-gridline"/><text x="4" y="${yy+3}" class="chart-y-label">${esc(state.metric==="basket"?oneFmt.format(val):compactFmt.format(val))}</text>`;
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
  const rows=state.index.allYearRows.map((r,i)=>({def:r,index:i}));
  const sk=state.allSort.key, dir=state.allSort.dir==="asc"?1:-1;
  rows.sort((a,b)=>{
    if(sk==="category") return compare(a.def.label,b.def.label)*dir;
    const av=monthRows[sk]?.[state.metric]?.[a.index];
    const bv=monthRows[sk]?.[state.metric]?.[b.index];
    return compare(av,bv)*dir;
  });

  $("all-year-head").innerHTML=[
    `<th class="category ${sk==="category"?"sorted":""}" data-sort="category">Category <span class="sortmark">${sk==="category"?(dir===1?"▲":"▼"):"↕"}</span></th>`,
    ...months.map(m=>`<th class="${sk===m?"sorted":""}" data-sort="${m}">${esc(monthShort(m))} <span class="sortmark">${sk===m?(dir===1?"▲":"▼"):"↕"}</span></th>`)
  ].join("");

  $("all-year-body").innerHTML=rows.map(({def,index})=>{
    const grand=normLabel(def.label)==="grand total";
    const cls=grand?"grand-row":def.kind==="total"?"total-row":"";
    return `<tr class="${cls}"><td class="category">${esc(def.label)}</td>${months.map(m=>`<td class="num">${esc(formatMetric(monthRows[m][state.metric][index]))}</td>`).join("")}</tr>`;
  }).join("");

  $("all-year-table-summary").textContent=`${months.length} month(s) · ${metricLabel()} · ${state.outlet.code} — ${state.outlet.name}`;
  $("all-year-head").querySelectorAll("th[data-sort]").forEach(th=>th.addEventListener("click",()=>{
    const key=th.dataset.sort;
    if(state.allSort.key===key) state.allSort.dir=state.allSort.dir==="asc"?"desc":"asc";
    else state.allSort={key,dir:"asc"};
    renderAllYearTable();
  }));
}
function normLabel(v){return String(v||"").trim().toLowerCase().replace(/\s+/g," ");}

function computeProjectedRows(){
  const end=state.end;
  const lastYear=shiftMonth(end,-12);
  const priorLastYear=shiftMonth(lastYear,-1);
  const target=shiftMonth(end,1);

  const lastYearAll=computeAllRows(lastYear);
  const lastMonthAll=computeAllRows(end);
  const gi=state.index.allYearGrandIndex;

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
  const byExcelRow=new Map();

  state.index.projectedRows.forEach((r,idx)=>{
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
      vals={lyS,lyF,lyB:lyF?lyS/lyF:null,lmS,lmF,lmB:lmF?lmS/lmF:null,pS,pF,pB:pF?pS/pF:null,con:lmGrandSales?lmS/lmGrandSales:0};
    }else{
      const deps=(r.deps||[]).map(d=>result[d]).filter(Boolean);
      const sum=k=>deps.reduce((a,x)=>a+valueNum(x[k]),0);
      const lyS=sum("lyS"),lyF=sum("lyF"),lmS=sum("lmS"),lmF=sum("lmF"),pS=sum("pS"),pF=sum("pF");
      vals={lyS,lyF,lyB:lyF?lyS/lyF:null,lmS,lmF,lmB:lmF?lmS/lmF:null,pS,pF,pB:pF?pS/pF:null,con:lmGrandSales?lmS/lmGrandSales:0};
    }
    vals.dS=vals.pS-vals.lyS;
    vals.dF=vals.pF-vals.lyF;
    vals.dB=(vals.pB===null||vals.lyB===null)?null:vals.pB-vals.lyB;
    result.push({...r,...vals});
    byExcelRow.set(r.excelRow,result.at(-1));
  });

  const grand=result.find(r=>normLabel(r.label)==="grand total") || result.at(-1);
  return {rows:result,grand,lastYear,priorLastYear,lastMonth:end,target,seasonSales,seasonFF,projectedGrandSales,projectedGrandFF};
}
function renderProjected(){
  const p=computeProjectedRows();
  const overallGrowth=p.grand.lyS?p.grand.pS/p.grand.lyS-1:null;
  const mom=p.grand.lmS?p.grand.pS/p.grand.lmS-1:null;

  $("projected-kpis").innerHTML=[
    kpi("Last Year Sales",money(p.grand.lyS),monthLong(p.lastYear)),
    kpi("Last Month Sales",money(p.grand.lmS),monthLong(p.lastMonth)),
    kpi("Projected Sales",money(p.grand.pS),monthLong(p.target),"accent"),
    kpi("Projected YoY Growth",overallGrowth===null?"—":pct(overallGrowth),`vs ${monthLong(p.lastYear)}`,overallGrowth!==null&&overallGrowth>=0?"good":"warn"),
    kpi("Projection MoM",mom===null?"—":pct(mom),`vs ${monthLong(p.lastMonth)}`,mom!==null&&mom>=0?"good":"warn"),
    kpi("Network Seasonal Factor",p.seasonSales===null?"—":pct(p.seasonSales),`${monthLong(p.lastYear)} vs ${monthLong(p.priorLastYear)}`),
  ].join("");

  $("projected-caption").textContent=`${state.outlet.code} — ${state.outlet.name}`;
  $("projection-info").innerHTML=`<strong>Last Year:</strong> ${esc(monthLong(p.lastYear))} &nbsp; | &nbsp; <strong>Last Month:</strong> ${esc(monthLong(p.lastMonth))} &nbsp; | &nbsp; <strong>Projected:</strong> ${esc(monthLong(p.target))} &nbsp; | &nbsp; Network seasonal Sales factor: <strong>${esc(p.seasonSales===null?"N/A":pct(p.seasonSales))}</strong> · FF factor: <strong>${esc(p.seasonFF===null?"N/A":pct(p.seasonFF))}</strong>`;

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
  const rows=[...p.rows].sort((a,b)=>{
    const av=sk==="category"?a.label:a[sk], bv=sk==="category"?b.label:b[sk];
    return compare(av,bv)*dir;
  });

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

  $("projected-table-summary").textContent=`${p.rows.length} rows · ${state.outlet.code} — ${state.outlet.name}`;
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
    lines.push([r.label,...months.map(m=>formatMetric(monthRows[m][state.metric][i]))].map(csvCell).join(","));
  });
  saveCsv(lines.join("\r\n"),`all_year_${state.selectedCode}_${state.start}_${state.end}_${state.metric}.csv`);
}
function downloadProjected(){
  const p=computeProjectedRows();
  const headers=projectedColumns.map(c=>c[1]);
  const lines=[headers.map(csvCell).join(",")];
  p.rows.forEach(r=>lines.push(projectedColumns.map(([k])=>csvCell(projectedCell(r,k))).join(",")));
  saveCsv(lines.join("\r\n"),`projected_zreport_${state.selectedCode}_${p.target}.csv`);
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
  renderAll();
}
function renderAll(){
  if(!state.outlet) return;
  validateRange();
  $("range-pill").textContent=`${monthShort(state.start)} → ${monthShort(state.end)}`;
  $("all-year-caption").textContent=`${state.outlet.code} — ${state.outlet.name}`;
  renderAllYearKpis();
  renderTrend();
  renderAllYearTable();
  renderProjected();
}
function bind(){
  $("outlet-search").addEventListener("input",e=>{
    state.search=e.target.value;
    renderOutletOptions();
  });
  $("outlet-select").addEventListener("change",e=>loadOutlet(e.target.value));
  $("date-start").addEventListener("change",e=>{state.start=e.target.value;validateRange();renderAll();});
  $("date-end").addEventListener("change",e=>{state.end=e.target.value;validateRange();renderAll();});
  document.querySelectorAll("[data-range]").forEach(b=>b.addEventListener("click",()=>setQuickRange(b.dataset.range)));
  $("metric-tabs").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    state.metric=b.dataset.metric;
    $("metric-tabs").querySelectorAll("button").forEach(x=>x.classList.toggle("active",x===b));
    renderAllYearKpis();renderTrend();renderAllYearTable();
  }));
  $("download-all-year").addEventListener("click",downloadAllYear);
  $("download-projected").addEventListener("click",downloadProjected);
}

async function init(){
  try{
    const res=await fetch("data/index.json",{cache:"no-store"});
    if(!res.ok) throw new Error(`Could not load dashboard index (${res.status})`);
    state.index=await res.json();
    state.start=state.index.defaultRange.start;
    state.end=state.index.defaultRange.end;
    $("date-start").min=state.index.meta.earliestActualMonth;
    $("date-start").max=state.index.meta.latestActualMonth;
    $("date-end").min=state.index.meta.earliestActualMonth;
    $("date-end").max=state.index.meta.latestActualMonth;
    $("date-start").value=state.start;
    $("date-end").value=state.end;

    $("source-pill").textContent=`${numFmt.format(state.index.meta.outletCount)} outlets · ${state.index.meta.sourceWorkbook}`;
    $("source-pill").title=`Actual months: ${state.index.meta.earliestActualMonth} to ${state.index.meta.latestActualMonth}\nAll Year header horizon includes ${state.index.meta.futureHeaderMonthCount} future month(s).`;

    state.selectedCode=state.index.outlets.find(o=>o.code==="D109")?.code || state.index.outlets[0]?.code || "";
    renderOutletOptions();
    bind();
    if(state.selectedCode) await loadOutlet(state.selectedCode);
  }catch(err){
    document.body.innerHTML=`<div style="padding:36px;font-family:Segoe UI,Arial;background:#070a0d;color:#fff;min-height:100vh"><h2>Dashboard could not load</h2><p>${esc(err.message)}</p><p>Run <code>python scripts/build.py</code> and deploy the generated <code>site</code> folder.</p></div>`;
  }
}
init();
