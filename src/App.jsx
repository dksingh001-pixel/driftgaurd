import { useState, useMemo, useEffect } from "react";
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ReferenceLine, Cell, ComposedChart, Line
} from "recharts";

const G = { primary:"#008200",dark:"#005a00",light:"#e8f5e9",accent:"#ffcc00",danger:"#d32f2f",amber:"#f57c00",stable:"#9e9e9e",white:"#ffffff",bg:"#f5f7fa",border:"#e0e0e0",text:"#1a1a1a",muted:"#666" };
const ALL_REGIONS = ["Europe","Americas","APAC","LATAM"];

function mkRng(seed){ let s=seed>>>0; return ()=>{ s=(s*1664525+1013904223)>>>0; return s/0xffffffff; }; }

function generateData(){
  const cfg={
    Europe:  {base:{discLo:0.042,discHi:0.052,cmProb:0.055,cmRate:0.021},drift:{discLo:0.088,discHi:0.118,cmProb:0.22,cmRate:0.078}},
    Americas:{base:{discLo:0.038,discHi:0.048,cmProb:0.048,cmRate:0.018},drift:{discLo:0.072,discHi:0.095,cmProb:0.18,cmRate:0.062}},
    APAC:    {base:{discLo:0.035,discHi:0.045,cmProb:0.04, cmRate:0.016},drift:{discLo:0.037,discHi:0.047,cmProb:0.043,cmRate:0.017}},
    LATAM:   {base:{discLo:0.040,discHi:0.050,cmProb:0.044,cmRate:0.019},drift:{discLo:0.041,discHi:0.051,cmProb:0.046,cmRate:0.019}},
  };
  const rows=[];
  let id=1;
  const base=new Date("2024-09-01");
  const rng=mkRng(42);
  for(const region of ALL_REGIONS){
    const c=cfg[region];
    for(let d=0;d<120;d++){
      const date=new Date(base); date.setDate(base.getDate()+d);
      const isRecent=d>=90;
      const p=isRecent?c.drift:c.base;
      const gross=20000+rng()*80000;
      const discPct=p.discLo+rng()*(p.discHi-p.discLo);
      const net=gross*(1-discPct);
      const isCM=rng()<p.cmProb;
      const cmVal=isCM?gross*(p.cmRate+(rng()-0.5)*0.004):0;
      rows.push({
        TxnId:`TXN${String(id).padStart(5,"0")}`,
        TxnDate:date.toISOString().slice(0,10),
        Region:region,
        GrossValue:+gross.toFixed(2),
        DiscountPct:+discPct.toFixed(4),
        NetValue:+net.toFixed(2),
        IsCreditMemo:isCM,
        CreditMemoValue:+Math.max(0,cmVal).toFixed(2),
        DayIndex:d
      });
      id++;
    }
  }
  return rows;
}
const ALL_DATA = generateData();

function buildRegionBand(data,region,metric){
  const rData=data.filter(r=>r.Region===region);
  const BASELINE_WEEKS=13, TOTAL_WEEKS=17;
  const pts=Array.from({length:TOTAL_WEEKS},(_,w)=>{
    const dayStart=w*7, dayEnd=(w+1)*7;
    const wData=rData.filter(r=>r.DayIndex>=dayStart&&r.DayIndex<dayEnd);
    if(wData.length===0) return{week:`W${w+1}`,rawValue:0,empty:true};
    const net=wData.reduce((s,r)=>s+r.NetValue,0)||1;
    const gross=wData.reduce((s,r)=>s+r.GrossValue,0)||1;
    const val=metric==="cm"
      ?wData.reduce((s,r)=>s+r.CreditMemoValue,0)/net
      :wData.reduce((s,r)=>s+r.DiscountPct*r.GrossValue,0)/gross;
    return{week:`W${w+1}`,rawValue:val*100,empty:false};
  }).filter(p=>!p.empty);
  const baseVals=pts.slice(0,BASELINE_WEEKS).map(p=>p.rawValue).sort((a,b)=>a-b);
  const med=baseVals[Math.floor(baseVals.length/2)];
  const std=Math.sqrt(baseVals.reduce((s,v)=>s+(v-med)**2,0)/baseVals.length)||0.001;
  const lo=med-1.5*std, hi=med+1.5*std;
  return pts.map((p,i)=>({
    week:p.week,
    value:+p.rawValue.toFixed(3),
    med:+med.toFixed(3),
    lo:+lo.toFixed(3),
    hi:+hi.toFixed(3),
    bandHi:+hi.toFixed(3),
    bandLo:+lo.toFixed(3),
    isBaseline:i<BASELINE_WEEKS,
    isAnomaly:p.rawValue>hi
  }));
}

function computeWeeklyPattern(data,region,metric){
  const band=buildRegionBand(data,region,metric);
  const currentWks=band.filter(p=>!p.isBaseline);
  const anomWks=currentWks.filter(p=>p.isAnomaly);
  const count=anomWks.length;
  if(count>=3&&currentWks.every(p=>p.isAnomaly)) return "Repeated";
  if(count>=2) return "Intermittent";
  if(count===1) return "One-off";
  return "One-off";
}

function computeRegionStats(data,regions){
  return regions.map(region=>{
    const rData=data.filter(r=>r.Region===region);
    const base=rData.filter(r=>r.DayIndex<90), curr=rData.filter(r=>r.DayIndex>=90);
    const bNet=base.reduce((s,r)=>s+r.NetValue,0)||1, cNet=curr.reduce((s,r)=>s+r.NetValue,0)||1;
    const bGross=base.reduce((s,r)=>s+r.GrossValue,0)||1, cGross=curr.reduce((s,r)=>s+r.GrossValue,0)||1;
    const bCM=base.reduce((s,r)=>s+r.CreditMemoValue,0), cCM=curr.reduce((s,r)=>s+r.CreditMemoValue,0);
    const bDV=base.reduce((s,r)=>s+r.DiscountPct*r.GrossValue,0), cDV=curr.reduce((s,r)=>s+r.DiscountPct*r.GrossValue,0);
    const bCMR=bCM/bNet, cCMR=cCM/cNet, bDP=bDV/bGross, cDP=cDV/cGross;
    const cmExp=Math.max(0,cCM-bCMR*cNet), dExp=Math.max(0,cDV-bDP*cGross), totalExp=cmExp+dExp;
    const cmRatio=cCMR/(bCMR||0.001), dRatio=cDP/(bDP||0.001);
    let driftStrength, flagged;
    if(region==="Europe"){driftStrength="High";flagged=true;}
    else if(region==="Americas"){driftStrength="Medium";flagged=true;}
    else{driftStrength="Low";flagged=false;}
    const cmPat=computeWeeklyPattern(data,region,"cm");
    const dPat=computeWeeklyPattern(data,region,"disc");
    const pr={"Repeated":3,"Intermittent":2,"One-off":1};
    const pattern=pr[cmPat]>=pr[dPat]?cmPat:dPat;
    return{region,bCMR,cCMR,bDP,cDP,cmExp,dExp,totalExp,driftStrength,flagged,cmRatio,dRatio,pattern};
  }).sort((a,b)=>b.totalExp-a.totalExp).map((r,i)=>({...r,rank:i+1}));
}

function buildWeeklyTrend(data,regions){
  return Array.from({length:17},(_,w)=>{
    const wData=data.filter(r=>regions.includes(r.Region)&&r.DayIndex>=w*7&&r.DayIndex<(w+1)*7);
    const cm=wData.reduce((s,r)=>s+r.CreditMemoValue,0);
    const disc=wData.reduce((s,r)=>s+r.DiscountPct*r.GrossValue,0);
    return{week:`W${w+1}`,cmExposure:+(cm/1000).toFixed(1),discExposure:+(disc/1000).toFixed(1)};
  });
}

const fmt=(n,d=1)=>n>=1e6?`$${(n/1e6).toFixed(d)}M`:n>=1e3?`$${(n/1e3).toFixed(d)}K`:`$${n.toFixed(0)}`;
const pct=n=>`${(n*100).toFixed(1)}%`;

const Badge=({v})=>{
  const c=v==="High"?G.danger:v==="Medium"?G.amber:G.stable;
  return <span style={{background:c,color:"#fff",borderRadius:4,padding:"2px 8px",fontSize:12,fontWeight:700}}>{v}</span>;
};
const PBadge=({v})=>{
  const c=v==="Repeated"?"#7b1fa2":v==="Intermittent"?"#1565c0":"#424242";
  return <span style={{background:c+"22",color:c,border:`1px solid ${c}44`,borderRadius:4,padding:"2px 8px",fontSize:12,fontWeight:600}}>{v}</span>;
};

function Btn({children,onClick,variant="primary",small,style={}}){
  const bg=variant==="primary"?G.primary:"transparent";
  const col=variant==="outline"?G.primary:variant==="ghost"?G.text:G.white;
  const border=variant==="outline"?`2px solid ${G.primary}`:variant==="ghost"?`2px solid ${G.border}`:"none";
  return (
    <button onClick={onClick} style={{background:bg,color:col,border,borderRadius:6,padding:small?"6px 14px":"10px 22px",fontWeight:700,fontSize:small?13:14,cursor:"pointer",letterSpacing:0.3,...style}}>
      {children}
    </button>
  );
}

function Card({children,style={}}){
  return <div style={{background:G.white,borderRadius:10,boxShadow:"0 2px 8px #0001",padding:20,border:`1px solid ${G.border}`,...style}}>{children}</div>;
}

function KPI({label,value,sub,color}){
  return (
    <Card style={{flex:1,minWidth:160}}>
      <div style={{fontSize:12,color:G.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>{label}</div>
      <div style={{fontSize:26,fontWeight:800,color:color||G.text,margin:"6px 0 2px"}}>{value}</div>
      {sub&&<div style={{fontSize:12,color:G.muted}}>{sub}</div>}
    </Card>
  );
}

function HeinLogo({dark=false,height=52}){
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
      <svg height={height} viewBox="0 0 260 80" xmlns="http://www.w3.org/2000/svg">
        <polygon points="26,4 30,17 44,17 33,26 37,39 26,30 15,39 19,26 8,17 22,17" fill="#CC0000" stroke="#aa0000" strokeWidth="0.5"/>
        <text x="58" y="52" fontFamily="'Arial Black','Arial',sans-serif" fontWeight="900" fontSize="46" fill={dark?"#ffffff":"#008200"} letterSpacing="1">Heineken</text>
        <text x="246" y="24" fontFamily="Arial" fontSize="14" fill={dark?"#ffffff":"#008200"}>®</text>
      </svg>
    </div>
  );
}

function Processing({steps,onDone}){
  const [cur,setCur]=useState(0);
  const [p,setP]=useState(0);
  useEffect(()=>{
    let step=0, pct=0;
    const dur=3400, perStep=dur/steps.length, tick=40, inc=100/(perStep/tick);
    const iv=setInterval(()=>{
      pct+=inc;
      if(pct>=100){
        pct=0; step++;
        if(step>=steps.length){ clearInterval(iv); setP(100); setCur(steps.length-1); setTimeout(onDone,250); return; }
        setCur(step);
      }
      setP(Math.min(pct,100));
    },tick);
    return()=>clearInterval(iv);
  },[]);
  const overall=Math.round(((cur+(p/100))/steps.length)*100);
  return (
    <div style={{minHeight:"100vh",background:"#0a1628",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:28}}>
      <div style={{textAlign:"center"}}>
        <HeinLogo dark height={44}/>
        <div style={{fontSize:11,color:"#aaa",letterSpacing:2,textTransform:"uppercase",marginTop:6}}>Financial Control Accelerator</div>
      </div>
      <div style={{width:500,background:"#ffffff0d",borderRadius:14,padding:28,border:"1px solid #ffffff15"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{color:"#fff",fontWeight:700,fontSize:14}}>Processing…</span>
          <span style={{color:G.accent,fontWeight:800}}>{overall}%</span>
        </div>
        <div style={{height:5,background:"#ffffff15",borderRadius:3,overflow:"hidden",marginBottom:22}}>
          <div style={{height:"100%",background:`linear-gradient(90deg,${G.primary},${G.accent})`,width:`${overall}%`,borderRadius:3,transition:"width 0.15s"}}/>
        </div>
        {steps.map((s,i)=>{
          const done=i<cur||(i===cur&&p>=100), active=i===cur&&p<100;
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10,opacity:i>cur?0.3:1}}>
              <div style={{width:22,height:22,borderRadius:"50%",flexShrink:0,background:done?G.primary:active?"#ffffff22":"#ffffff11",border:`2px solid ${done?G.primary:active?G.accent:"#fff2"}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                {done?<span style={{color:"#fff",fontSize:12,fontWeight:900}}>✓</span>:active?<div style={{width:7,height:7,borderRadius:"50%",background:G.accent}}/>:null}
              </div>
              <div style={{flex:1}}>
                <div style={{color:done?"#888":active?"#fff":"#555",fontSize:13,fontWeight:active?700:400}}>{s.label}</div>
                {active&&<div style={{height:2,background:"#ffffff15",borderRadius:1,marginTop:3,overflow:"hidden"}}><div style={{height:"100%",background:G.accent,width:`${p}%`,transition:"width 0.08s"}}/></div>}
                {done&&<div style={{fontSize:11,color:"#4a8a4a",marginTop:1}}>{s.done}</div>}
                {active&&<div style={{fontSize:11,color:"#aaa",marginTop:1}}>{s.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScreenLogin({onLogin}){
  const [email,setEmail]=useState("demo@heineken.com");
  const [pass,setPass]=useState("demo1234");
  return (
    <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${G.dark} 0%,${G.primary} 60%,#004d00 100%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{position:"absolute",inset:0,backgroundImage:"radial-gradient(circle at 20% 80%,#ffffff08 0%,transparent 50%),radial-gradient(circle at 80% 20%,#ffcc0015 0%,transparent 50%)"}}/>
      <div style={{width:400,background:"#fff",borderRadius:16,padding:"36px 36px 28px",boxShadow:"0 20px 60px #0005",position:"relative"}}>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{background:"#fff",padding:"10px 16px",borderRadius:10,display:"inline-block",marginBottom:10}}><HeinLogo height={44}/></div>
          <div style={{height:2,background:`linear-gradient(90deg,transparent,${G.accent},transparent)`,margin:"10px 0"}}/>
          <div style={{fontWeight:800,fontSize:15,color:G.dark}}>DriftGuard</div>
          <div style={{fontSize:11,color:G.muted,letterSpacing:1,textTransform:"uppercase"}}>Regional Drift Monitoring · Credit Memos & Discounts</div>
        </div>
        <div style={{marginBottom:14}}>
          <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:4}}>Email</label>
          <input value={email} onChange={e=>setEmail(e.target.value)} style={{width:"100%",padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,boxSizing:"border-box"}}/>
        </div>
        <div style={{marginBottom:20}}>
          <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:4}}>Password</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} style={{width:"100%",padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,boxSizing:"border-box"}}/>
        </div>
        <Btn onClick={onLogin} style={{width:"100%",padding:"12px",fontSize:15}}>Sign In</Btn>
        <div style={{textAlign:"center",marginTop:12,fontSize:12,color:G.muted}}>Demo credentials pre-filled</div>
        <div style={{marginTop:14,padding:"10px 14px",background:G.light,borderRadius:6,fontSize:12,color:G.dark,borderLeft:`3px solid ${G.primary}`}}>
          <strong>Demo Instance</strong> — Heineken Regional Monitoring
        </div>
      </div>
    </div>
  );
}

function ScreenLanding({onStart}){
  return (
    <div style={{minHeight:"100vh",background:G.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:40}}>
      <div style={{textAlign:"center",maxWidth:620}}>
        <div style={{background:G.white,display:"inline-block",padding:"12px 24px",borderRadius:12,marginBottom:20,boxShadow:"0 2px 12px #0001"}}><HeinLogo height={44}/></div>
        <h1 style={{fontSize:34,fontWeight:900,color:G.text,lineHeight:1.2,margin:"0 0 10px"}}>Behavioral Drift Monitor<br/><span style={{color:G.primary}}>Credit Notes & Discount Intelligence</span></h1>
        <p style={{color:G.muted,fontSize:15,marginBottom:30,lineHeight:1.6}}>Detect anomalies in credit memo and discount behavior before they become audit findings.</p>
        <div style={{display:"flex",gap:14,justifyContent:"center",flexWrap:"wrap"}}>
          <Btn onClick={onStart} style={{fontSize:15,padding:"13px 32px"}}>▶ Start Demo</Btn>
          <Btn variant="outline" onClick={onStart} style={{fontSize:15,padding:"13px 32px"}}>▷ View Sample Story (2 min)</Btn>
        </div>
        <div style={{marginTop:40,display:"flex",gap:32,justifyContent:"center",flexWrap:"wrap"}}>
          {[["480","Transactions"],["4","Regions"],["120","Day Baseline"],["Real-time","Detection"]].map(([v,l])=>(
            <div key={l} style={{textAlign:"center"}}><div style={{fontWeight:900,fontSize:22,color:G.primary}}>{v}</div><div style={{fontSize:12,color:G.muted}}>{l}</div></div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ScreenScenario({onRun,activeRegions,setActiveRegions}){
  const [company,setCompany]=useState("Heineken");
  const [currency,setCurrency]=useState("USD");
  const allOn=ALL_REGIONS.every(r=>activeRegions.includes(r));
  const toggle=r=>setActiveRegions(prev=>prev.includes(r)?prev.filter(x=>x!==r):[...prev,r]);
  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:40}}>
      <div style={{maxWidth:700,margin:"0 auto"}}>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:12,color:G.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Step 1 of 4</div>
          <h2 style={{fontSize:26,fontWeight:900,color:G.dark,margin:0}}>Configure Monitoring Scenario</h2>
        </div>
        <Card style={{padding:28}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Company</label>
              <select value={company} onChange={e=>setCompany(e.target.value)} style={{width:"100%",padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,background:"#fff"}}>
                {["Heineken","P&G","Unilever","Nestle","AB InBev"].map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                <label style={{fontSize:12,fontWeight:700,color:G.dark,textTransform:"uppercase",letterSpacing:0.5}}>Regions</label>
                <button onClick={()=>setActiveRegions(allOn?[]:ALL_REGIONS)} style={{fontSize:11,color:G.primary,background:"none",border:"none",cursor:"pointer",fontWeight:600}}>{allOn?"Deselect all":"Select all"}</button>
              </div>
              <div style={{border:`1px solid ${G.border}`,borderRadius:6,background:"#fff",padding:"8px 12px",display:"flex",flexDirection:"column",gap:6}}>
                {ALL_REGIONS.map(r=>{
                  const on=activeRegions.includes(r);
                  return (
                    <label key={r} style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer",padding:"4px 0"}}>
                      <div onClick={()=>toggle(r)} style={{width:18,height:18,borderRadius:4,border:`2px solid ${on?G.primary:G.border}`,background:on?G.primary:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",transition:"all 0.15s"}}>
                        {on&&<span style={{color:"#fff",fontSize:12,fontWeight:900,lineHeight:1}}>✓</span>}
                      </div>
                      <span style={{fontSize:14,fontWeight:600,color:on?G.dark:G.muted}}>{r}</span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Historical Baseline</label>
              <div style={{padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,background:G.light,fontWeight:600}}>90 Days (fixed)</div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Current Window</label>
              <div style={{padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,background:G.light,fontWeight:600}}>Last 30 Days (fixed)</div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Currency</label>
              <div style={{display:"flex",gap:8}}>
                {["USD","EUR"].map(c=>(
                  <button key={c} onClick={()=>setCurrency(c)} style={{flex:1,padding:"10px",border:`2px solid ${currency===c?G.primary:G.border}`,borderRadius:6,background:currency===c?G.light:"#fff",fontWeight:700,color:currency===c?G.primary:G.muted,cursor:"pointer"}}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{fontSize:12,fontWeight:700,color:G.dark,display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Exposure Method</label>
              <div style={{padding:"10px 12px",border:`1px solid ${G.border}`,borderRadius:6,fontSize:14,background:G.light,fontWeight:600}}>Net Impact Difference</div>
            </div>
          </div>
          <div style={{borderTop:`1px solid ${G.border}`,paddingTop:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,color:G.muted}}>{activeRegions.length} region{activeRegions.length!==1?"s":""} selected · {activeRegions.length*120} rows in scope</div>
            <Btn onClick={onRun} style={{padding:"12px 32px",fontSize:15}}>Run Monitoring →</Btn>
          </div>
        </Card>
      </div>
    </div>
  );
}

function ScreenSnapshot({onView,activeRegions}){
  const filtered=ALL_DATA.filter(r=>activeRegions.includes(r.Region));
  const sample=filtered.slice(0,5);
  const invCount=filtered.filter(r=>!r.IsCreditMemo).length;
  const cmCount=filtered.filter(r=>r.IsCreditMemo).length;
  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:40}}>
      <div style={{maxWidth:900,margin:"0 auto"}}>
        <div style={{marginBottom:24}}>
          <div style={{fontSize:12,color:G.muted,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>Step 2 of 4</div>
          <h2 style={{fontSize:26,fontWeight:900,color:G.dark,margin:0}}>Data Snapshot</h2>
        </div>
        <Card style={{marginBottom:20,padding:20,background:G.light,border:`1px solid ${G.primary}44`}}>
          <div style={{display:"flex",gap:28,flexWrap:"wrap",alignItems:"center"}}>
            {[[`${invCount}`,"Invoices"],[`${cmCount}`,"Credit Memos"],[`${activeRegions.length}`,"Regions"],["120 days","Period"],[`${filtered.length}`,"Total Rows"]].map(([v,l])=>(
              <div key={l}><span style={{fontWeight:900,color:G.primary,fontSize:18}}>{v}</span> <span style={{color:G.dark,fontSize:13,fontWeight:600}}>{l}</span></div>
            ))}
          </div>
        </Card>
        <Card style={{overflowX:"auto"}}>
          <div style={{fontWeight:700,fontSize:14,marginBottom:12,color:G.dark}}>Data loaded for 120 days</div>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead>
              <tr style={{background:G.dark,color:"#fff"}}>
                {["TxnId","TxnDate","Region","NetValue","DiscountPct","IsCreditMemo","CreditMemoValue"].map(h=>(
                  <th key={h} style={{padding:"8px 10px",textAlign:"left",fontWeight:700,letterSpacing:0.3}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sample.map((r,i)=>(
                <tr key={r.TxnId} style={{background:i%2?G.bg:G.white}}>
                  <td style={{padding:"8px 10px",fontFamily:"monospace",color:G.primary}}>{r.TxnId}</td>
                  <td style={{padding:"8px 10px"}}>{r.TxnDate}</td>
                  <td style={{padding:"8px 10px",fontWeight:600}}>{r.Region}</td>
                  <td style={{padding:"8px 10px"}}>${r.NetValue.toLocaleString()}</td>
                  <td style={{padding:"8px 10px"}}>{(r.DiscountPct*100).toFixed(1)}%</td>
                  <td style={{padding:"8px 10px"}}><span style={{color:r.IsCreditMemo?G.danger:G.stable,fontWeight:700}}>{r.IsCreditMemo?"YES":"NO"}</span></td>
                  <td style={{padding:"8px 10px"}}>{r.CreditMemoValue>0?`$${r.CreditMemoValue.toLocaleString()}`:"—"}</td>
                </tr>
              ))}
              <tr><td colSpan={7} style={{padding:"6px 10px",color:G.muted,fontSize:11,fontStyle:"italic"}}>… {filtered.length-5} more rows loaded</td></tr>
            </tbody>
          </table>
        </Card>
        <div style={{marginTop:20,display:"flex",justifyContent:"flex-end"}}><Btn onClick={onView}>View Results →</Btn></div>
      </div>
    </div>
  );
}

function ScreenExec({stats,weeklyTrend,onRegions,onExplain}){
  const flagged=stats.filter(s=>s.flagged).length;
  const totalExp=stats.reduce((s,r)=>s+r.totalExp,0);
  const cmExp=stats.reduce((s,r)=>s+r.cmExp,0);
  const dExp=stats.reduce((s,r)=>s+r.dExp,0);
  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:32}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
          <div>
            <div style={{fontSize:12,color:G.muted,letterSpacing:1,textTransform:"uppercase"}}>Step 3 of 4 · Executive Overview</div>
            <h2 style={{fontSize:24,fontWeight:900,color:G.dark,margin:"4px 0 0"}}>Monitoring Results — Heineken</h2>
          </div>
          <div style={{fontSize:12,color:G.muted}}>Baseline: 90 days · Current: Last 30 days</div>
        </div>
        <div style={{display:"flex",gap:16,marginBottom:22,flexWrap:"wrap"}}>
          <KPI label="Total Exposure" value={fmt(totalExp)} sub="Net impact vs baseline" color={G.danger}/>
          <KPI label="Regions Flagged" value={`${flagged} / ${stats.length}`} sub={`${stats.filter(s=>s.driftStrength==="High").length} high severity`} color={G.amber}/>
          <KPI label="Dominant Driver" value={cmExp>dExp?"Credit Memo Drift":"Discount Drift"} sub={`CM: ${fmt(cmExp)} · Disc: ${fmt(dExp)}`} color={G.primary}/>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1.6fr 1fr",gap:20,marginBottom:20}}>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:14,color:G.dark}}>Exposure Trend — Last 17 Weeks</div>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={weeklyTrend} margin={{top:4,right:10,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="gCM" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor={G.danger} stopOpacity={0.35}/><stop offset="95%" stopColor={G.danger} stopOpacity={0}/></linearGradient>
                  <linearGradient id="gD" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#1565c0" stopOpacity={0.25}/><stop offset="95%" stopColor="#1565c0" stopOpacity={0}/></linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="week" tick={{fontSize:10}} interval={2}/>
                <YAxis tick={{fontSize:11}} tickFormatter={v=>`$${v}K`}/>
                <Tooltip formatter={(v,n)=>[`$${v}K`,n]}/>
                <Legend verticalAlign="bottom" height={26} iconType="square" formatter={v=><span style={{fontSize:12,color:G.text}}>{v}</span>}/>
                <ReferenceLine x="W14" stroke={G.primary} strokeDasharray="4 2" label={{value:"▸ Monitor Start",fontSize:10,fill:G.primary,position:"top"}}/>
                <Area type="monotone" dataKey="cmExposure" name="Credit Memo Drift ($K)" stroke={G.danger} fill="url(#gCM)" strokeWidth={2}/>
                <Area type="monotone" dataKey="discExposure" name="Discount Drift ($K)" stroke="#1565c0" fill="url(#gD)" strokeWidth={2}/>
              </AreaChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <div style={{fontWeight:700,fontSize:14,marginBottom:14,color:G.dark}}>Exposure Split by Driver</div>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={[{name:"Credit Memo",value:+(cmExp/1000).toFixed(1)},{name:"Discount",value:+(dExp/1000).toFixed(1)}]} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis type="number" tick={{fontSize:11}} tickFormatter={v=>`$${v}K`}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:12}} width={90}/>
                <Tooltip formatter={v=>`$${v}K`}/>
                <Bar dataKey="value" radius={[0,4,4,0]} label={{position:"right",fontSize:11,formatter:v=>`$${v}K`}}>
                  <Cell fill={G.danger}/><Cell fill="#1565c0"/>
                </Bar>
              </BarChart>
            </ResponsiveContainer>
            <div style={{marginTop:8,fontSize:12,color:G.muted,borderTop:`1px solid ${G.border}`,paddingTop:8}}>
              CM drift accounts for <strong style={{color:G.danger}}>{(cmExp/(cmExp+dExp)*100).toFixed(0)}%</strong> of total exposure
            </div>
          </Card>
        </div>
        <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
          <Btn variant="outline" onClick={()=>onExplain(stats.find(s=>s.flagged)?.region||stats[0].region)}>View Explainability</Btn>
          <Btn onClick={onRegions}>See Flagged Regions →</Btn>
        </div>
      </div>
    </div>
  );
}

function ScreenRanking({stats,onRegionClick,onBack}){
  const [view,setView]=useState("Combined");
  const flagged=stats.filter(s=>s.flagged).length;
  const totalExp=stats.reduce((s,r)=>s+r.totalExp,0);
  const getExp=s=>view==="View by Credit Memo"?s.cmExp:view==="View by Discount"?s.dExp:s.totalExp;
  const sorted=[...stats].sort((a,b)=>getExp(b)-getExp(a));
  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:32}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
          <div>
            <h2 style={{fontSize:22,fontWeight:900,color:G.dark,margin:0}}>Region Drift Ranking</h2>
            <div style={{fontSize:12,color:G.muted,marginTop:2}}>Baseline: Last 90 Days · Current Window: Last 30 Days</div>
          </div>
          <Btn variant="outline" small onClick={onBack}>← Back</Btn>
        </div>
        <div style={{display:"flex",gap:14,marginBottom:14,flexWrap:"wrap"}}>
          {[["Total Regions",`${stats.length}`],["Regions Flagged",`${flagged}`],["Total Exposure",fmt(totalExp)],["Dominant Driver","Credit Memo Drift"]].map(([l,v])=>(
            <div key={l} style={{background:G.white,border:`1px solid ${G.border}`,borderRadius:8,padding:"8px 16px",fontSize:13}}>
              <span style={{color:G.muted}}>{l}: </span><strong style={{color:G.dark}}>{v}</strong>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8,marginBottom:14}}>
          {["View by Credit Memo","View by Discount","Combined"].map(t=>(
            <button key={t} onClick={()=>setView(t)} style={{padding:"7px 16px",borderRadius:20,border:`1.5px solid ${view===t?G.primary:G.border}`,background:view===t?G.primary:"#fff",color:view===t?"#fff":G.muted,fontWeight:600,fontSize:12,cursor:"pointer",transition:"all 0.15s"}}>{t}</button>
          ))}
        </div>
        <Card style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead>
              <tr style={{background:G.dark,color:"#fff"}}>
                {["Rank","Region",view==="View by Discount"?"Discount %":"Credit Memo Rate",view==="Combined"?"Discount %":null,"Drift Strength","Exposure ($)","Pattern","Action"].filter(Boolean).map(h=>(
                  <th key={h} style={{padding:"10px 12px",textAlign:"left",fontWeight:700,fontSize:12,whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((s,i)=>{
                const exp=getExp(s);
                return (
                  <tr key={s.region} onClick={()=>s.flagged&&onRegionClick(s.region)} style={{background:i%2?G.bg:G.white,cursor:s.flagged?"pointer":"default",borderLeft:s.flagged?`3px solid ${s.driftStrength==="High"?G.danger:G.amber}`:"3px solid transparent"}}>
                    <td style={{padding:"12px"}}><span style={{fontWeight:900,fontSize:15,color:G.primary}}>#{i+1}</span></td>
                    <td style={{padding:"12px",fontWeight:700,color:G.dark}}>{s.region}</td>
                    {view!=="View by Discount"&&<td style={{padding:"12px"}}><div style={{fontWeight:700,color:s.flagged?G.danger:G.text}}>{pct(s.cCMR)}</div><div style={{fontSize:11,color:G.muted}}>↑ from {pct(s.bCMR)}</div></td>}
                    {view==="View by Discount"&&<td style={{padding:"12px"}}><div style={{fontWeight:700,color:s.dRatio>1.4?G.amber:G.text}}>{pct(s.cDP)}</div><div style={{fontSize:11,color:G.muted}}>from {pct(s.bDP)}</div></td>}
                    {view==="Combined"&&<td style={{padding:"12px"}}><div style={{fontWeight:700,color:s.dRatio>1.3?G.amber:G.text}}>{pct(s.cDP)}</div><div style={{fontSize:11,color:G.muted}}>{s.dRatio>1.3?`↑ from ${pct(s.bDP)}`:"within range"}</div></td>}
                    <td style={{padding:"12px"}}><Badge v={s.driftStrength}/></td>
                    <td style={{padding:"12px",fontWeight:700,color:exp>50000?G.danger:G.text}}>{fmt(exp)}</td>
                    <td style={{padding:"12px"}}><PBadge v={s.pattern}/></td>
                    <td style={{padding:"12px"}}>{s.flagged?<Btn small variant="outline" onClick={e=>{e.stopPropagation();onRegionClick(s.region)}}>Explain</Btn>:<span style={{color:G.stable,fontSize:12}}>Stable</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}

const AnomalyDot=(props)=>{
  const{cx,cy,payload}=props;
  if(!cx||!cy) return null;
  if(payload?.isAnomaly) return (
    <g>
      <circle cx={cx} cy={cy} r={12} fill={G.danger} opacity={0.15}/>
      <circle cx={cx} cy={cy} r={7} fill={G.danger} opacity={0.3}/>
      <circle cx={cx} cy={cy} r={4} fill={G.danger} stroke="#fff" strokeWidth={2}/>
    </g>
  );
  return <circle cx={cx} cy={cy} r={4} fill={G.primary} stroke="#fff" strokeWidth={1.5}/>;
};

function ScreenExplain({region,stats,onBack,onEvidence}){
  const [tab,setTab]=useState("cm");
  const s=stats.find(x=>x.region===region)||stats[0];
  const reg=region||stats[0].region;
  const cmBand=useMemo(()=>buildRegionBand(ALL_DATA,reg,"cm"),[reg]);
  const dBand=useMemo(()=>buildRegionBand(ALL_DATA,reg,"disc"),[reg]);
  const data=tab==="cm"?cmBand:dBand;
  const curr=tab==="cm"?s.cCMR:s.cDP;
  const base=tab==="cm"?s.bCMR:s.bDP;
  const ratio=tab==="cm"?s.cmRatio:s.dRatio;
  const exp=tab==="cm"?s.cmExp:s.dExp;
  const anomCount=data.filter(d=>d.isAnomaly).length;
  const isDisc=tab==="disc";

  const CustomTooltip=({active,payload,label})=>{
    if(!active||!payload?.length) return null;
    const pt=payload.find(p=>p.dataKey==="value");
    const isA=pt?.payload?.isAnomaly;
    return (
      <div style={{background:"#fff",border:`2px solid ${isA?G.danger:G.primary}`,borderRadius:8,padding:"10px 14px",boxShadow:"0 4px 16px #0002",minWidth:170}}>
        <div style={{fontWeight:700,marginBottom:6}}>{label}</div>
        {payload.filter(p=>["value","med","bandHi","bandLo"].includes(p.dataKey)).map(e=>(
          <div key={e.dataKey} style={{fontSize:12,color:e.dataKey==="value"?(isA?G.danger:G.primary):G.muted,fontWeight:e.dataKey==="value"?700:400,marginBottom:2}}>
            {e.dataKey==="value"?"Actual":e.dataKey==="med"?"Baseline Median":e.dataKey==="bandHi"?"Band High":"Band Low"}: {e.value?.toFixed(2)}%
          </div>
        ))}
        {isA&&<div style={{marginTop:6,fontSize:11,fontWeight:800,color:G.danger,borderTop:`1px solid ${G.danger}44`,paddingTop:4}}>⚠ OUTSIDE NORMAL BAND</div>}
      </div>
    );
  };

  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:32}}>
      <div style={{maxWidth:1000,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div>
            <div style={{fontSize:12,color:G.muted,letterSpacing:1,textTransform:"uppercase"}}>Explainability · {reg}</div>
            <h2 style={{fontSize:22,fontWeight:900,color:G.dark,margin:"4px 0 0"}}>Why was {reg} flagged?</h2>
          </div>
          <Btn variant="outline" small onClick={onBack}>← Region Ranking</Btn>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:18}}>
          {[["cm","📋 Credit Memo Drift"],["disc","🏷 Discount Drift"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{padding:"8px 20px",borderRadius:6,border:`2px solid ${tab===k?G.primary:G.border}`,background:tab===k?G.primary:"#fff",color:tab===k?"#fff":G.muted,fontWeight:700,fontSize:13,cursor:"pointer"}}>{l}</button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1.9fr 1fr",gap:20,marginBottom:20}}>
          <Card>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div>
                <div style={{fontWeight:700,fontSize:14,color:G.dark}}>{tab==="cm"?"Credit Memo Rate":"Discount %"} — 17-Week View</div>
                <div style={{fontSize:11,color:G.muted,marginTop:2}}>Green shaded = normal band · Red dots = anomaly weeks outside band</div>
              </div>
              {anomCount>0&&<div style={{background:G.danger,color:"#fff",borderRadius:4,padding:"4px 10px",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>⚠ {anomCount} Anomaly Week{anomCount>1?"s":""}</div>}
            </div>
            <ResponsiveContainer width="100%" height={270}>
              <ComposedChart data={data} margin={{top:10,right:12,left:0,bottom:0}}>
                <defs>
                  <linearGradient id="normalBand" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={G.primary} stopOpacity={0.18}/>
                    <stop offset="100%" stopColor={G.primary} stopOpacity={0.04}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                <XAxis dataKey="week" tick={{fontSize:10}} interval={2}/>
                <YAxis tick={{fontSize:11}} tickFormatter={v=>`${v}%`} domain={isDisc?[0,12]:['auto','auto']} ticks={isDisc?[0,2,4,6,8,10,12]:undefined}/>
                <Tooltip content={<CustomTooltip/>}/>
                <Legend verticalAlign="bottom" height={32} iconType="square" formatter={v=><span style={{fontSize:11,color:G.text}}>{v}</span>}/>
                <ReferenceLine x="W14" stroke="#aaa" strokeDasharray="4 2" label={{value:"Monitoring starts",fontSize:10,fill:"#888",position:"top"}}/>
                <Area type="monotone" dataKey="bandHi" name="Band Upper" stroke={G.primary} strokeWidth={1} strokeDasharray="4 3" fill="url(#normalBand)" fillOpacity={1} legendType="none"/>
                <Area type="monotone" dataKey="bandLo" name="Band Lower" stroke={G.primary} strokeWidth={1} strokeDasharray="4 3" fill="#f5f7fa" fillOpacity={1} legendType="none"/>
                <Line type="monotone" dataKey="med" name="Baseline Median" stroke={G.primary} strokeWidth={2} strokeDasharray="6 3" dot={false} activeDot={false}/>
                <Line type="monotone" dataKey="value" name="Actual Rate" stroke={G.primary} strokeWidth={2.5} dot={<AnomalyDot/>} activeDot={{r:5}}/>
              </ComposedChart>
            </ResponsiveContainer>
            <div style={{display:"flex",gap:18,fontSize:11,color:G.muted,marginTop:6,paddingTop:6,borderTop:`1px solid ${G.border}`}}>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:24,height:3,background:G.primary,display:"inline-block",borderRadius:1}}/>Actual Rate</span>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:24,height:3,background:G.primary,display:"inline-block",borderRadius:1,opacity:0.5}}/>Baseline Median</span>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:10,height:10,borderRadius:"50%",background:G.danger,display:"inline-block"}}/>Anomaly week</span>
              <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:14,height:10,background:G.primary+"33",display:"inline-block",borderRadius:2}}/>Normal band</span>
            </div>
          </Card>
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Card style={{background:"#fff5f5",border:`1.5px solid ${G.danger}55`}}>
              <div style={{fontSize:11,fontWeight:700,color:G.danger,marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>⚠ Why Flagged</div>
              <div style={{fontSize:13,color:G.text,lineHeight:1.7}}>
                Current 30-day {tab==="cm"?"credit memo rate":"discount %"} is <strong style={{color:G.danger,fontSize:16}}>{ratio.toFixed(1)}×</strong> above the historical median.<br/><br/>
                <strong>92%</strong> of historical weeks fall within the normal band.
              </div>
            </Card>
            <Card>
              <div style={{fontSize:11,fontWeight:700,color:G.dark,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Exposure Calculation</div>
              <div style={{fontSize:12,color:G.muted,lineHeight:2}}>
                <div>Expected rate: <strong>{pct(base)}</strong></div>
                <div>Actual rate: <strong style={{color:G.danger}}>{pct(curr)}</strong></div>
                <div>Drift multiple: <strong style={{color:G.danger}}>{ratio.toFixed(1)}×</strong></div>
              </div>
              <div style={{marginTop:8,padding:"8px 12px",background:G.danger+"11",borderRadius:6,fontWeight:700,color:G.danger,fontSize:14,borderLeft:`3px solid ${G.danger}`}}>Financial Exposure = {fmt(exp)}</div>
            </Card>
            <Card>
              <div style={{fontSize:11,fontWeight:700,color:G.dark,marginBottom:8,textTransform:"uppercase",letterSpacing:0.5}}>Drift Assessment</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}><Badge v={s.driftStrength}/><PBadge v={s.pattern}/></div>
              <div style={{fontSize:11,color:G.muted,marginTop:8}}>Based on {anomCount} anomaly week{anomCount!==1?"s":""} in the monitoring period</div>
            </Card>
          </div>
        </div>
        <div style={{display:"flex",gap:12,justifyContent:"flex-end"}}>
          <Btn variant="outline" onClick={onBack}>← Back to Ranking</Btn>
          <Btn onClick={()=>onEvidence(reg)} style={{background:G.accent,color:G.dark}}>📄 Generate Evidence Pack</Btn>
        </div>
      </div>
    </div>
  );
}

function ScreenEvidence({region,stats,onBack}){
  const s=stats.find(x=>x.region===region)||stats[0];
  const reg=region||stats[0].region;
  const ref=useMemo(()=>`DG-${reg.substring(0,3).toUpperCase()}-${Date.now().toString().slice(-5)}`,[reg]);
  const today=new Date().toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  const cmBand=useMemo(()=>buildRegionBand(ALL_DATA,reg,"cm"),[reg]);
  const dBand=useMemo(()=>buildRegionBand(ALL_DATA,reg,"disc"),[reg]);

  const exportPDF=()=>{
    const makeBarRows=(band,color,anomColor)=>{
      const maxV=Math.max(...band.map(x=>x.value).filter(v=>isFinite(v)&&v>0));
      const bandHiPct=Math.min((band[0].hi/maxV)*100,100).toFixed(1);
      return band.map(p=>{
        const w=((p.value/maxV)*100).toFixed(1);
        const isA=p.isAnomaly;
        return `<div style="display:flex;align-items:center;gap:8px;margin:3px 0">
          <div style="width:28px;font-size:10px;color:#666;text-align:right;flex-shrink:0">${p.week}</div>
          <div style="flex:1;height:18px;background:#f0f0f0;border-radius:3px;overflow:visible;position:relative">
            <div style="height:100%;width:${w}%;background:${isA?anomColor:color};border-radius:3px;display:flex;align-items:center;justify-content:flex-end;padding-right:4px;min-width:2px">
              <span style="font-size:9px;color:#fff;font-weight:700;white-space:nowrap">${p.value.toFixed(2)}%</span>
            </div>
            <div style="position:absolute;top:-2px;left:${bandHiPct}%;width:2px;height:22px;background:${color};opacity:0.8;border-radius:1px"></div>
          </div>
          <div style="width:60px;font-size:10px;font-weight:700;color:${isA?anomColor:"#888"};flex-shrink:0">${isA?"⚠ ANOMALY":"OK"}</div>
        </div>`;
      }).join("");
    };

    const html=`<!DOCTYPE html><html><head><title>DriftGuard Evidence Pack — ${reg}</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a;background:#fff;padding:36px 44px;max-width:860px;margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:3px solid #008200;margin-bottom:18px}.logo-text{font-size:26px;font-weight:900;color:#008200}.logo-star{color:#cc0000;margin-right:4px}.logo-sub{font-size:11px;color:#666;margin-top:2px}h2{color:#005a00;font-size:13px;font-weight:800;margin:18px 0 8px;padding-bottom:4px;border-bottom:2px solid #e8f5e9;text-transform:uppercase;letter-spacing:.6px}.meta{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:12px 0}.mbox{background:#f5f7fa;border-radius:6px;padding:8px 12px;border-left:3px solid #008200}.mbox .ml{font-size:9px;color:#999;text-transform:uppercase;letter-spacing:.5px}.mbox .mv{font-size:13px;font-weight:700;color:#005a00;margin-top:2px}.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:10px 0}.kpi{border-radius:8px;padding:12px 10px;text-align:center}.kv{font-size:20px;font-weight:900}.kl{font-size:10px;color:#666;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}th{background:#005a00;color:#fff;padding:7px 10px;text-align:left;font-size:11px}td{padding:7px 10px;border-bottom:1px solid #f0f0f0}.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:10px 0}.chart-box{background:#f9fafb;border:1px solid #e8e8e8;border-radius:8px;padding:12px}.chart-title{font-size:11px;font-weight:700;color:#333;margin-bottom:8px}.ph{color:#d32f2f;font-weight:700}.pm{color:#f57c00;font-weight:700}.pl{color:#008200;font-weight:700}.footer{margin-top:28px;padding-top:10px;border-top:1px solid #eee;font-size:10px;color:#aaa;display:flex;justify-content:space-between}.print-btn{display:block;text-align:center;margin:24px auto 0}@media print{.print-btn{display:none}body{padding:20px}}</style>
</head><body>
<div class="top"><div><div class="logo-text"><span class="logo-star">★</span>Heineken</div><div class="logo-sub">DriftGuard · Financial Control Accelerator</div></div>
<div style="text-align:right;font-size:11px;color:#666"><div>Reference: <strong>${ref}</strong></div><div style="margin-top:2px">${today}</div><div style="color:#d32f2f;font-weight:700;margin-top:3px">⛔ CONFIDENTIAL — Internal Audit Only</div></div></div>
<div class="meta"><div class="mbox"><div class="ml">Region</div><div class="mv">${reg}</div></div><div class="mbox"><div class="ml">Monitoring Period</div><div class="mv">Last 30 Days</div></div><div class="mbox"><div class="ml">Baseline Period</div><div class="mv">90-Day Historical</div></div><div class="mbox"><div class="ml">Drift Strength</div><div class="mv" style="color:${s.driftStrength==="High"?"#d32f2f":"#f57c00"}">${s.driftStrength}</div></div></div>
<h2>Executive Summary</h2>
<p style="font-size:13px;line-height:1.75;color:#333">Region <strong>${reg}</strong> has been flagged with <strong style="color:${s.driftStrength==="High"?"#d32f2f":"#f57c00"}">${s.driftStrength} drift strength</strong>. Total financial exposure stands at <strong style="color:#d32f2f">${fmt(s.totalExp)}</strong>. Credit memo rate rose from <strong>${pct(s.bCMR)}</strong> to <strong style="color:#d32f2f">${pct(s.cCMR)}</strong> (${s.cmRatio.toFixed(1)}× baseline). Discount % moved from <strong>${pct(s.bDP)}</strong> to <strong style="color:#f57c00">${pct(s.cDP)}</strong> (${s.dRatio.toFixed(1)}× baseline).</p>
<div class="kpis">
<div class="kpi" style="background:#fff0f0;border:1.5px solid #d32f2f44"><div class="kv" style="color:#d32f2f">${fmt(s.totalExp)}</div><div class="kl">Total Exposure</div></div>
<div class="kpi" style="background:#fff8e1;border:1.5px solid #f57c0044"><div class="kv" style="color:#f57c00">${s.cmRatio.toFixed(1)}×</div><div class="kl">CM Drift Multiple</div></div>
<div class="kpi" style="background:#fff8e1;border:1.5px solid #f57c0044"><div class="kv" style="color:#f57c00">${s.dRatio.toFixed(1)}×</div><div class="kl">Disc Drift Multiple</div></div>
<div class="kpi" style="background:#e8f5e9;border:1.5px solid #00820044"><div class="kv" style="color:#008200">${s.pattern}</div><div class="kl">Drift Pattern</div></div>
</div>
<h2>Weekly Drift Charts</h2>
<div class="charts">
<div class="chart-box"><div class="chart-title">Credit Memo Rate — vs Baseline Band</div>${makeBarRows(cmBand,"#008200","#d32f2f")}</div>
<div class="chart-box"><div class="chart-title">Discount % — vs Baseline Band</div>${makeBarRows(dBand,"#1565c0","#f57c00")}</div>
</div>
<h2>Recommended Actions</h2>
<table><thead><tr><th>#</th><th>Action</th><th>Priority</th><th>Owner</th><th>Due</th></tr></thead><tbody>
<tr><td>1</td><td>Initiate credit memo audit for ${reg} — review all approvals from last 30 days</td><td class="ph">High</td><td>Regional Controller</td><td>5 days</td></tr>
<tr style="background:#f9f9f9"><td>2</td><td>Review customer discount agreements — verify no unauthorized rate changes</td><td class="pm">Medium</td><td>Sales Finance</td><td>14 days</td></tr>
<tr><td>3</td><td>Set automated alert at ${pct(s.bCMR*1.5)} for CM rate going forward</td><td class="pl">Low</td><td>Finance Systems</td><td>Next cycle</td></tr>
</tbody></table>
<div class="footer"><span>Generated by DriftGuard · Ref: ${ref}</span><span>${today} · © Heineken Internal Use Only</span></div>
<div class="print-btn"><button onclick="window.print()" style="background:#008200;color:#fff;border:none;padding:12px 36px;border-radius:6px;font-size:14px;font-weight:700;cursor:pointer">🖨 Print / Save as PDF</button></div>
</body></html>`;
    const blob=new Blob([html],{type:"text/html"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.target="_blank"; a.rel="noopener";
    document.body.appendChild(a); a.click();
    document.body.removeChild(a);
    setTimeout(()=>URL.revokeObjectURL(url),5000);
  };

  return (
    <div style={{minHeight:"100vh",background:G.bg,padding:32}}>
      <div style={{maxWidth:880,margin:"0 auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <div>
            <div style={{fontSize:12,color:G.muted,letterSpacing:1,textTransform:"uppercase"}}>Evidence Pack · {reg}</div>
            <h2 style={{fontSize:22,fontWeight:900,color:G.dark,margin:"4px 0 0"}}>Audit-Ready Report Preview</h2>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn variant="outline" small onClick={onBack}>← Back</Btn>
            <Btn small onClick={exportPDF} style={{background:G.accent,color:G.dark}}>⬇ Export PDF</Btn>
          </div>
        </div>
        <Card style={{borderTop:`4px solid ${G.primary}`,marginBottom:16}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{width:42,height:42,borderRadius:8,background:G.primary,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontWeight:900,fontSize:17}}>DG</span></div>
              <div><div style={{fontWeight:900,fontSize:17,color:G.dark}}>DriftGuard — Evidence Pack</div><div style={{fontSize:11,color:G.muted}}>Financial Control Accelerator · Heineken</div></div>
            </div>
            <div style={{textAlign:"right",fontSize:11,color:G.muted}}>
              <div>Ref: <strong>{ref}</strong></div><div>{today}</div>
              <div style={{marginTop:2,color:G.danger,fontWeight:700}}>⛔ CONFIDENTIAL</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:14}}>
            {[["Region",reg],["Period","Last 30 days"],["Baseline","90 days"],["Drift Strength",s.driftStrength]].map(([l,v])=>(
              <div key={l} style={{background:G.bg,borderRadius:6,padding:"8px 12px",borderLeft:`3px solid ${G.primary}`}}>
                <div style={{fontSize:10,color:G.muted,textTransform:"uppercase",letterSpacing:0.5}}>{l}</div>
                <div style={{fontWeight:700,fontSize:13,color:l==="Drift Strength"?(s.driftStrength==="High"?G.danger:G.amber):G.dark}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10}}>
            {[[fmt(s.totalExp),"Total Exposure",G.danger],[`${s.cmRatio.toFixed(1)}×`,"CM Multiple",G.amber],[`${s.dRatio.toFixed(1)}×`,"Disc Multiple",G.amber],[s.pattern,"Pattern",G.primary]].map(([v,l,c])=>(
              <div key={l} style={{background:c+"0f",border:`1.5px solid ${c}33`,borderRadius:8,padding:"12px",textAlign:"center"}}>
                <div style={{fontWeight:900,fontSize:20,color:c}}>{v}</div>
                <div style={{fontSize:11,color:G.muted,marginTop:2}}>{l}</div>
              </div>
            ))}
          </div>
        </Card>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
          {[
            {band:cmBand,title:"Credit Memo Rate — Weekly",anomColor:G.danger,normColor:"#008200",fixedMax:null},
            {band:dBand,title:"Discount % — Weekly",anomColor:G.amber,normColor:"#1565c0",fixedMax:12}
          ].map(({band,title,anomColor,normColor,fixedMax})=>{
            const vals=band.map(b=>b.value).filter(v=>isFinite(v)&&v>0);
            const dataMax=vals.length>0?Math.max(...vals):5;
            const maxVal=fixedMax?Math.max(fixedMax,dataMax*1.05):dataMax*1.2;
            const safeHi=isFinite(band[0]?.hi)?band[0].hi:0;
            return (
              <Card key={title}>
                <div style={{fontWeight:700,fontSize:13,color:G.dark,marginBottom:6}}>{title}</div>
                {fixedMax&&<div style={{fontSize:11,color:G.muted,marginBottom:8}}>Y-axis 0–12% to show full anomaly scale</div>}
                <ResponsiveContainer width="100%" height={fixedMax?220:160}>
                  <BarChart data={band} margin={{top:4,right:52,left:8,bottom:0}}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
                    <XAxis dataKey="week" tick={{fontSize:9}} interval={2}/>
                    <YAxis tick={{fontSize:10}} tickFormatter={v=>`${(+v).toFixed(1)}%`} domain={[0,maxVal]} ticks={fixedMax?[0,2,4,6,8,10,12]:undefined} width={36}/>
                    <Tooltip formatter={(v,n,p)=>[`${(+v).toFixed(2)}%`,p.payload.isAnomaly?"⚠ Anomaly":"Normal"]}/>
                    <ReferenceLine y={safeHi} stroke={normColor} strokeDasharray="5 3" strokeWidth={1.5} label={{value:`Band Hi: ${safeHi.toFixed(2)}%`,fontSize:9,fill:normColor,position:"right"}}/>
                    <Bar dataKey="value" radius={[3,3,0,0]} isAnimationActive={false} label={{position:"top",fontSize:9,formatter:v=>v>=dataMax*0.85?`${(+v).toFixed(1)}%`:""}}>
                      {band.map((e,i)=><Cell key={i} fill={e.isAnomaly?anomColor:normColor} opacity={e.isAnomaly?1:0.45}/>)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </Card>
            );
          })}
        </div>
        <Card style={{marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:13,color:G.dark,marginBottom:10}}>Recommended Actions</div>
          <table style={{width:"100%",fontSize:12,borderCollapse:"collapse"}}>
            <thead><tr style={{background:G.dark,color:"#fff"}}>{["#","Action","Priority","Owner","Due"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontSize:11}}>{h}</th>)}</tr></thead>
            <tbody>
              {[["1",`Initiate credit memo audit for ${reg} — review approvals from last 30 days`,"High","Regional Controller","5 days"],
                ["2","Review customer discount agreements — check for unauthorized changes","Medium","Sales Finance","14 days"],
                ["3",`Set alert threshold at ${pct(s.bCMR*1.5)} for credit memo rate`,"Low","Finance Systems","Next cycle"]].map(([n,a,p,o,d],i)=>(
                <tr key={n} style={{background:i%2?G.bg:G.white}}>
                  <td style={{padding:"7px 10px",fontWeight:700,color:G.primary}}>{n}</td>
                  <td style={{padding:"7px 10px"}}>{a}</td>
                  <td style={{padding:"7px 10px"}}><span style={{color:p==="High"?G.danger:p==="Medium"?G.amber:G.primary,fontWeight:700}}>{p}</span></td>
                  <td style={{padding:"7px 10px",color:G.muted}}>{o}</td>
                  <td style={{padding:"7px 10px",color:G.muted}}>{d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <div style={{textAlign:"center",paddingBottom:20}}>
          <Btn onClick={exportPDF} style={{padding:"13px 48px",fontSize:15,background:G.accent,color:G.dark}}>⬇ Export as PDF</Btn>
          <div style={{fontSize:11,color:G.muted,marginTop:8}}>Opens in new tab → use browser Print → "Save as PDF"</div>
        </div>
      </div>
    </div>
  );
}

function NavBar({screen,onNav}){
  const steps=[["scenario","Scenario"],["snapshot","Snapshot"],["exec","Overview"],["ranking","Ranking"],["explain","Explainability"],["evidence","Evidence"]];
  const idx=steps.findIndex(([k])=>k===screen);
  if(idx===-1) return null;
  return (
    <div style={{background:G.white,borderBottom:`1px solid ${G.border}`,padding:"0 24px",display:"flex",alignItems:"center",height:44,position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 4px #0001"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,marginRight:24}}>
        <div style={{width:24,height:24,borderRadius:4,background:G.primary,display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{color:"#fff",fontWeight:900,fontSize:10}}>DG</span></div>
        <span style={{fontWeight:800,color:G.dark,fontSize:13}}>DriftGuard</span>
      </div>
      <div style={{display:"flex",alignItems:"center",flex:1}}>
        {steps.map(([k,l],i)=>(
          <div key={k} style={{display:"flex",alignItems:"center"}}>
            <button onClick={()=>i<=idx&&onNav(k)} style={{padding:"0 10px",height:44,border:"none",background:"none",cursor:i<=idx?"pointer":"default",fontWeight:i===idx?800:500,fontSize:12,color:i===idx?G.primary:i<idx?G.dark:G.stable,borderBottom:i===idx?`2px solid ${G.primary}`:"2px solid transparent"}}>{i+1}. {l}</button>
            {i<steps.length-1&&<span style={{color:G.border,fontSize:13}}>›</span>}
          </div>
        ))}
      </div>
      <div style={{fontSize:11,color:G.muted}}>🍺 Heineken · Demo</div>
    </div>
  );
}

const PROC={
  landing_to_scenario:[{label:"Authenticating session",done:"Session verified",detail:"Checking permissions..."},{label:"Loading Heineken profile",done:"Profile loaded",detail:"Fetching regional config..."},{label:"Initialising monitoring engine",done:"Engine ready",detail:"Loading baseline parameters..."}],
  scenario_to_snapshot:[{label:"Connecting to SAP data source",done:"SAP connection established",detail:"Querying transaction tables..."},{label:"Extracting 120-day transaction history",done:"480 rows extracted",detail:"Filtering by region and date..."},{label:"Validating data integrity",done:"All records validated",detail:"Checking for nulls and gaps..."},{label:"Staging data for analysis",done:"Data staged",detail:"Partitioning baseline vs current..."}],
  snapshot_to_exec:[{label:"Computing 90-day baseline medians",done:"Baseline per region computed",detail:"Calculating credit memo rates..."},{label:"Calculating current 30-day metrics",done:"Current window metrics ready",detail:"Comparing against baseline bands..."},{label:"Running drift detection",done:"Drift scores computed",detail:"Europe & Americas flagged..."},{label:"Quantifying financial exposure",done:"Exposure identified",detail:"Net impact difference method..."},{label:"Generating executive summary",done:"Report ready",detail:"Building visualisations..."}],
  exec_to_ranking:[{label:"Ranking regions by exposure",done:"4 regions ranked",detail:"Sorting by drift strength..."},{label:"Classifying drift patterns",done:"Patterns classified",detail:"Repeated / Intermittent / One-off..."}],
  ranking_to_explain:[{label:"Loading region drill-down",done:"Region data loaded",detail:"Fetching weekly transactions..."},{label:"Computing historical bands",done:"Bands computed (90-day)",detail:"±1.5 standard deviations..."},{label:"Identifying anomaly weeks",done:"Anomaly weeks flagged",detail:"Weeks outside operating band..."}],
  explain_to_evidence:[{label:"Compiling audit evidence",done:"Evidence compiled",detail:"Attaching weekly data tables..."},{label:"Generating recommended actions",done:"Actions generated",detail:"Prioritised by risk level..."},{label:"Preparing export package",done:"Pack ready",detail:"Formatting charts and tables..."}],
};

export default function App(){
  const [screen,setScreen]=useState("login");
  const [proc,setProc]=useState(null);
  const [selRegion,setSelRegion]=useState(null);
  const [activeRegions,setActiveRegions]=useState([...ALL_REGIONS]);
  const filteredData=useMemo(()=>ALL_DATA.filter(r=>activeRegions.includes(r.Region)),[activeRegions]);
  const stats=useMemo(()=>computeRegionStats(filteredData,activeRegions),[filteredData,activeRegions]);
  const weekly=useMemo(()=>buildWeeklyTrend(filteredData,activeRegions),[filteredData,activeRegions]);

  const go=(from,to,regionOverride)=>{
    const key=`${from}_to_${to}`;
    const steps=PROC[key];
    if(steps){
      setProc({steps,onDone:()=>{setProc(null);if(regionOverride!==undefined)setSelRegion(regionOverride);setScreen(to);}});
    } else {
      if(regionOverride!==undefined) setSelRegion(regionOverride);
      setScreen(to);
    }
  };
  const navTo=s=>{
    const order=["scenario","snapshot","exec","ranking","explain","evidence"];
    const cur=order.indexOf(screen), tgt=order.indexOf(s);
    if(tgt<cur) setScreen(s); else go(screen,s);
  };

  if(proc) return <Processing steps={proc.steps} onDone={proc.onDone}/>;
  return (
    <div style={{fontFamily:"'Segoe UI',system-ui,sans-serif",background:G.bg,minHeight:"100vh"}}>
      <NavBar screen={screen} onNav={navTo}/>
      {screen==="login"&&<ScreenLogin onLogin={()=>go("login","landing")}/>}
      {screen==="landing"&&<ScreenLanding onStart={()=>go("landing","scenario")}/>}
      {screen==="scenario"&&<ScreenScenario onRun={()=>go("scenario","snapshot")} activeRegions={activeRegions} setActiveRegions={setActiveRegions}/>}
      {screen==="snapshot"&&<ScreenSnapshot onView={()=>go("snapshot","exec")} activeRegions={activeRegions}/>}
      {screen==="exec"&&<ScreenExec stats={stats} weeklyTrend={weekly} onRegions={()=>go("exec","ranking")} onExplain={r=>go("exec","explain",r)}/>}
      {screen==="ranking"&&<ScreenRanking stats={stats} onRegionClick={r=>go("ranking","explain",r)} onBack={()=>setScreen("exec")}/>}
      {screen==="explain"&&<ScreenExplain region={selRegion} stats={stats} onBack={()=>setScreen("ranking")} onEvidence={r=>go("explain","evidence",r)}/>}
      {screen==="evidence"&&<ScreenEvidence region={selRegion} stats={stats} onBack={()=>setScreen("explain")}/>}
    </div>
  );
}
