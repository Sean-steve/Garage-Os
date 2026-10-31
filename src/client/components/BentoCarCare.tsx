import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpenCheck, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck, Sparkles, SlidersHorizontal, Wrench } from 'lucide-react';
import { ActiveTab, VehicleSummary } from '../types';

interface Props {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id:string)=>void;
  onNavigate: (tab:ActiveTab)=>void;
  onNotify?: (message:string)=>void;
}

type Priority='CRITICAL'|'HIGH'|'MEDIUM'|'INFO';
interface Dashboard {
  vehicle_id:string;
  maintenance:{overall_status:string;overdue_count:number;due_count:number;approaching_count:number;next_due_item:any};
  active_issue_count:number;
  persistent_issue_count:number;
  guidance:Array<{
    id:string;priority:Priority;title:string;explanation:string;is_diagnosis:false;
    actions:Array<{label:string;target_tab:ActiveTab;target_id?:string;article_slug?:string}>
  }>;
  recommended_missions:Array<{id:string;code:string;title:string;description:string;disclaimer:string;mission_type:string}>;
  active_missions:Mission[];
  safety_statement:string;
}
interface Article {
  id:string;slug:string;content_kind:string;category:string;title:string;summary:string;explanation:string;
  owner_actions:string[];seek_help_when:string[];risk_level:'INFO'|'CAUTION'|'URGENT';
  professional_inspection_required:boolean;roadside_recommended:boolean;booking_recommended:boolean;source_label:string;
}
interface CareProfile {
  id?:string;
  usage_pattern:string;
  annual_distance_band:string;
  road_exposure:string;
  parking_context:string;
  climate_exposures:string[];
  long_trip_frequency:string;
  heavy_load_frequency:string;
  profile_version?:number;
}
interface PersonalizedPlan {
  vehicle_id:string;
  generated_at:string;
  rule_version:string;
  profile:CareProfile|null;
  profile_completeness:'NOT_CONFIGURED'|'PARTIAL'|'CONFIGURED';
  recommendations:Array<{
    id:string;rule_id:string;priority:Priority;title:string;explanation:string;
    evidence:Array<{source_type:string;label:string;value:string|number|boolean|null;source_reference_id?:string}>;
    actions:Array<{label:string;target_tab:ActiveTab;article_slug?:string}>;
    is_diagnosis:false;changes_maintenance_schedule:false;rule_version:string;
  }>;
  recommended_mission_codes:string[];
  data_quality_notes:string[];
  safety_statement:string;
  location_inference_used:false;
  ai_inference_used:false;
}
interface Mission {
  mission:{id:string;status:string};
  template:{code:string;title:string;description:string;disclaimer:string};
  items:Array<{item:{id:string;title:string;instructions:string;check_level:string;safety_level:string;concern_action:string;article_slug?:string|null};progress:{status:string;note?:string|null}}>;
  progress:{total:number;resolved:number;pending:number;percent:number;professional_help_required:number;concerns_reported:number};
  completion_statement:string;
}
const unwrap=(v:any)=>v?.data??v;

export const BentoCarCare:React.FC<Props>=({vehicles,selectedVehicleId,onSelectVehicle,onNavigate,onNotify})=>{
  const [dashboard,setDashboard]=useState<Dashboard|null>(null);
  const [articles,setArticles]=useState<Article[]>([]);
  const [selectedArticle,setSelectedArticle]=useState<Article|null>(null);
  const [personalized,setPersonalized]=useState<PersonalizedPlan|null>(null);
  const [profileDraft,setProfileDraft]=useState<CareProfile>({
    usage_pattern:'UNKNOWN',annual_distance_band:'UNKNOWN',road_exposure:'UNKNOWN',
    parking_context:'UNKNOWN',climate_exposures:[],long_trip_frequency:'UNKNOWN',heavy_load_frequency:'UNKNOWN'
  });
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const notify=(m:string)=>{setMessage(m);onNotify?.(m);};

  const load=useCallback(async()=>{
    if(!selectedVehicleId){setDashboard(null);setPersonalized(null);return;}
    setLoading(true);
    try{
      const [dRes,aRes,pRes]=await Promise.all([
        fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/dashboard'),
        fetch('/api/v1/car-care/articles'),
        fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/personalized')
      ]);
      const dJson=await dRes.json(),aJson=await aRes.json(),pJson=await pRes.json();
      if(!dRes.ok) throw new Error(dJson?.error?.message||'Unable to load Car Care');
      if(!aRes.ok) throw new Error(aJson?.error?.message||'Unable to load care guidance');
      if(!pRes.ok) throw new Error(pJson?.error?.message||'Unable to load personalized care');
      setDashboard(unwrap(dJson));
      setArticles(unwrap(aJson)?.articles||[]);
      const plan=unwrap(pJson) as PersonalizedPlan;
      setPersonalized(plan);
      setProfileDraft(plan.profile||{
        usage_pattern:'UNKNOWN',annual_distance_band:'UNKNOWN',road_exposure:'UNKNOWN',
        parking_context:'UNKNOWN',climate_exposures:[],long_trip_frequency:'UNKNOWN',heavy_load_frequency:'UNKNOWN'
      });
    }catch(e){notify(e instanceof Error?e.message:'Unable to load Car Care');}
    finally{setLoading(false);}
  },[selectedVehicleId]);

  useEffect(()=>{load();},[load]);

  const startMission=async(code:string)=>{
    if(!selectedVehicleId) return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/missions',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({template_code:code})
      });
      const json=await res.json(); if(!res.ok) throw new Error(json?.error?.message||'Unable to start care mission');
      notify('Care mission ready. Owner checks do not replace professional inspection.');
      await load();
    }catch(e){notify(e instanceof Error?e.message:'Unable to start care mission');}
    finally{setBusy(false);}
  };

  const saveProfile=async()=>{
    if(!selectedVehicleId) return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/profile',{
        method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(profileDraft)
      });
      const json=await res.json();
      if(!res.ok) throw new Error(json?.error?.message||'Unable to save care profile');
      notify('Care profile saved. Personalization uses only the context you explicitly configured.');
      await load();
    }catch(e){notify(e instanceof Error?e.message:'Unable to save care profile');}
    finally{setBusy(false);}
  };

  const refreshPersonalization=async()=>{
    if(!selectedVehicleId) return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/personalized/evaluate',{method:'POST'});
      const json=await res.json();
      if(!res.ok) throw new Error(json?.error?.message||'Unable to refresh personalized care');
      setPersonalized(unwrap(json));
      notify('Personalized care refreshed from current recorded evidence.');
    }catch(e){notify(e instanceof Error?e.message:'Unable to refresh personalized care');}
    finally{setBusy(false);}
  };

  const handlePersonalizedAction=(a:{target_tab:ActiveTab;article_slug?:string})=>{
    if(a.target_tab==='care'&&a.article_slug){
      const found=articles.find(x=>x.slug===a.article_slug);
      if(found){setSelectedArticle(found);return;}
    }
    onNavigate(a.target_tab);
  };

  const updateItem=async(missionId:string,itemId:string,status:string)=>{
    setBusy(true);
    try{
      const res=await fetch('/api/v1/vehicles/'+selectedVehicleId+'/car-care/missions/'+missionId+'/items/'+itemId+'/progress',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})
      });
      const json=await res.json(); if(!res.ok) throw new Error(json?.error?.message||'Unable to update care mission');
      await load();
    }catch(e){notify(e instanceof Error?e.message:'Unable to update care mission');}
    finally{setBusy(false);}
  };

  const vehicle=useMemo(()=>vehicles.find(v=>v.id===selectedVehicleId),[vehicles,selectedVehicleId]);
  const tone=(p:Priority)=>p==='CRITICAL'?'border-rose-800/70 bg-rose-950/20':p==='HIGH'?'border-amber-800/60 bg-amber-950/15':p==='MEDIUM'?'border-indigo-800/60 bg-indigo-950/15':'border-slate-800 bg-slate-900/50';

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4">
          <div className="h-12 w-12 rounded-xl bg-emerald-500/15 text-emerald-300 flex items-center justify-center"><Wrench className="h-6 w-6"/></div>
          <div>
            <h2 className="text-xl font-bold">Car Care Center</h2>
            <p className="text-sm text-slate-400 mt-1">Understand your car, keep up with routine care, and move directly into the right Garage OS workflow.</p>
          </div>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold flex items-center gap-2"><RefreshCw className="h-4 w-4"/>Refresh</button>
      </div>
      <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs text-slate-400">
        Car Care explains observations and surfaces existing vehicle records. It does not diagnose faults or certify roadworthiness.
      </div>
    </div>

    {message&&<div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{message}</div>}

    <select value={selectedVehicleId} onChange={e=>onSelectVehicle(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
      <option value="">Select vehicle</option>
      {vehicles.map(v=><option key={v.id} value={v.id}>{v.display_name||v.make+' '+v.model}{v.registration_number?' • '+v.registration_number:''}</option>)}
    </select>

    {loading?<div className="rounded-xl border border-slate-800 p-8 text-sm text-slate-400">Loading Car Care…</div>:dashboard&&<>
      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-xl border border-slate-800 p-4"><p className="text-xs text-slate-500">Maintenance</p><p className="text-xl font-bold mt-1">{dashboard.maintenance.overall_status}</p></div>
        <div className="rounded-xl border border-slate-800 p-4"><p className="text-xs text-slate-500">Overdue</p><p className="text-xl font-bold mt-1">{dashboard.maintenance.overdue_count}</p></div>
        <div className="rounded-xl border border-slate-800 p-4"><p className="text-xs text-slate-500">Active issues</p><p className="text-xl font-bold mt-1">{dashboard.active_issue_count}</p></div>
        <div className="rounded-xl border border-slate-800 p-4"><p className="text-xs text-slate-500">Persistent issues</p><p className="text-xl font-bold mt-1">{dashboard.persistent_issue_count}</p></div>
      </div>

      {personalized&&<div className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-300"/><h3 className="font-bold">Personalized for this vehicle</h3></div>
          <button disabled={busy} onClick={refreshPersonalization} className="rounded-lg border border-indigo-800 px-3 py-2 text-xs font-semibold disabled:opacity-50">Refresh evidence plan</button>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
          <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-slate-400"/><h4 className="font-semibold">Your care context</h4></div>
          <p className="text-xs text-slate-500 mt-2">Optional and owner-configured. No GPS, address, city or hidden location inference is used.</p>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 mt-4">
            {[
              ['Usage pattern','usage_pattern',['UNKNOWN','OCCASIONAL','DAILY_COMMUTE','MIXED','LONG_DISTANCE','LIGHT_COMMERCIAL']],
              ['Annual distance','annual_distance_band',['UNKNOWN','UNDER_5000_KM','KM_5000_10000','KM_10000_20000','KM_20000_30000','OVER_30000_KM']],
              ['Road exposure','road_exposure',['UNKNOWN','PAVED_MOSTLY','MIXED','ROUGH_ROADS_FREQUENT']],
              ['Parking','parking_context',['UNKNOWN','GARAGED','COVERED_OUTDOOR','OUTDOOR_EXPOSED','MIXED']],
              ['Long trips','long_trip_frequency',['UNKNOWN','RARE','OCCASIONAL','MONTHLY','FREQUENT']],
              ['Heavy loads','heavy_load_frequency',['UNKNOWN','NEVER','OCCASIONAL','FREQUENT']]
            ].map(([label,key,options]:any)=><label key={key} className="text-xs text-slate-400">{label}
              <select value={(profileDraft as any)[key]} onChange={e=>setProfileDraft({...profileDraft,[key]:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
                {options.map((o:string)=><option key={o} value={o}>{o.replaceAll('_',' ')}</option>)}
              </select>
            </label>)}
          </div>
          <div className="mt-4">
            <p className="text-xs text-slate-400 mb-2">Environmental exposure you choose to report</p>
            <div className="flex flex-wrap gap-2">
              {['DUSTY','HOT','HUMID','HEAVY_RAIN','COASTAL_SALT','COLD'].map(x=>{
                const active=profileDraft.climate_exposures.includes(x);
                return <button type="button" key={x} onClick={()=>setProfileDraft({...profileDraft,climate_exposures:active?profileDraft.climate_exposures.filter(v=>v!==x):[...profileDraft.climate_exposures.filter(v=>v!=='NONE_REPORTED'),x]})}
                  className={'rounded-full border px-3 py-1.5 text-[11px] '+(active?'border-indigo-500 bg-indigo-500/15 text-indigo-200':'border-slate-700 text-slate-400')}>{x.replaceAll('_',' ')}</button>;
              })}
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap mt-4">
            <p className="text-[10px] text-slate-500">Profile: {personalized.profile_completeness.replaceAll('_',' ')} • Rule set: {personalized.rule_version}</p>
            <button disabled={busy} onClick={saveProfile} className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold disabled:opacity-50">Save care profile</button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {personalized.recommendations.map(rec=><article key={rec.id} className={'rounded-xl border p-5 '+tone(rec.priority)}>
            <div className="flex justify-between gap-3">
              <h4 className="font-semibold">{rec.title}</h4>
              <span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{rec.priority}</span>
            </div>
            <p className="text-sm text-slate-400 mt-2">{rec.explanation}</p>
            <div className="mt-3 space-y-1">
              {rec.evidence.map((e,i)=><p key={i} className="text-[10px] text-slate-500">{e.label}: <span className="text-slate-300">{String(e.value)}</span></p>)}
            </div>
            <p className="text-[10px] text-slate-500 mt-3">Rule: {rec.rule_id} • Diagnosis: NO • Maintenance schedule changed: NO</p>
            <div className="flex flex-wrap gap-2 mt-4">{rec.actions.map((a,i)=><button key={i} onClick={()=>handlePersonalizedAction(a)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">{a.label}</button>)}</div>
          </article>)}
          {personalized.recommendations.length===0&&<div className="rounded-xl border border-slate-800 p-5 text-sm text-slate-500">No additional personalized care recommendations are currently generated from the configured profile and recorded evidence.</div>}
        </div>

        {personalized.data_quality_notes.length>0&&<div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
          <p className="text-xs font-semibold">Data notes</p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">{personalized.data_quality_notes.map(x=><li key={x}>• {x}</li>)}</ul>
        </div>}
      </div>}

      <div>
        <div className="flex items-center gap-2 mb-3"><CircleAlert className="h-5 w-5 text-amber-300"/><h3 className="font-bold">What needs attention</h3></div>
        <div className="grid gap-4 lg:grid-cols-2">
          {dashboard.guidance.map(card=><article key={card.id} className={'rounded-xl border p-5 '+tone(card.priority)}>
            <div className="flex items-center justify-between gap-3">
              <h4 className="font-semibold">{card.title}</h4>
              <span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{card.priority}</span>
            </div>
            <p className="text-sm text-slate-400 mt-2">{card.explanation}</p>
            <p className="text-[10px] text-slate-500 mt-3">Diagnosis: NO • source-backed guidance only</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {card.actions.map((a,i)=><button key={i} onClick={()=>onNavigate(a.target_tab)} className="rounded-lg border border-slate-700 bg-slate-950/50 px-3 py-2 text-xs font-semibold">{a.label}</button>)}
            </div>
          </article>)}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3"><CheckCircle2 className="h-5 w-5 text-emerald-300"/><h3 className="font-bold">Care missions</h3></div>
        {dashboard.active_missions.length===0&&<div className="grid gap-3 md:grid-cols-3">
          {dashboard.recommended_missions.map(t=><article key={t.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <p className="text-xs uppercase text-slate-500">{t.mission_type.replaceAll('_',' ')}</p>
            <h4 className="font-semibold mt-1">{t.title}</h4>
            <p className="text-xs text-slate-400 mt-2">{t.description}</p>
            <p className="text-[10px] text-amber-300/80 mt-3">{t.disclaimer}</p>
            <button disabled={busy} onClick={()=>startMission(t.code)} className="mt-4 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold disabled:opacity-50">Start mission</button>
          </article>)}
        </div>}
        <div className="space-y-4">
          {dashboard.active_missions.map(m=><article key={m.mission.id} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <div className="flex items-start justify-between gap-4">
              <div><h4 className="font-semibold">{m.template.title}</h4><p className="text-xs text-slate-500 mt-1">{m.progress.percent}% reviewed • {m.progress.pending} pending</p></div>
              <span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{m.mission.status}</span>
            </div>
            <p className="text-[10px] text-amber-300/80 mt-3">{m.template.disclaimer}</p>
            <div className="mt-4 space-y-3">
              {m.items.map(x=><div key={x.item.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex justify-between gap-3"><p className="text-sm font-semibold">{x.item.title}</p><span className="text-[10px] text-slate-500">{x.item.check_level.replaceAll('_',' ')}</span></div>
                <p className="text-xs text-slate-400 mt-2">{x.item.instructions}</p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {x.item.check_level==='OWNER_SAFE_CHECK'?<>
                    <button disabled={busy} onClick={()=>updateItem(m.mission.id,x.item.id,'COMPLETED')} className="rounded border border-emerald-800 px-2 py-1 text-[11px] text-emerald-300">Checked / no concern</button>
                    <button disabled={busy} onClick={()=>updateItem(m.mission.id,x.item.id,'CONCERN_REPORTED')} className="rounded border border-amber-800 px-2 py-1 text-[11px] text-amber-300">Concern found</button>
                    <button disabled={busy} onClick={()=>updateItem(m.mission.id,x.item.id,'PROFESSIONAL_HELP_REQUIRED')} className="rounded border border-indigo-800 px-2 py-1 text-[11px] text-indigo-300">Need professional help</button>
                  </>:<>
                    <button disabled={busy} onClick={()=>updateItem(m.mission.id,x.item.id,'PROFESSIONAL_HELP_REQUIRED')} className="rounded border border-indigo-800 px-2 py-1 text-[11px] text-indigo-300">Arrange professional help</button>
                    <button disabled={busy} onClick={()=>updateItem(m.mission.id,x.item.id,'SKIPPED')} className="rounded border border-slate-700 px-2 py-1 text-[11px]">Not applicable / skip</button>
                  </>}
                  {x.item.concern_action!=='NONE'&&x.progress.status!=='PENDING'&&<button onClick={()=>onNavigate(
                    x.item.concern_action==='OPEN_MAINTENANCE'?'maintenance':
                    x.item.concern_action==='OPEN_ROADSIDE'?'roadside':
                    x.item.concern_action==='OPEN_BOOKINGS'?'bookings':
                    x.item.concern_action==='OPEN_PROVIDERS'?'providers':'issues'
                  )} className="rounded border border-slate-700 px-2 py-1 text-[11px]">Open next step</button>}
                </div>
                <p className="text-[10px] text-slate-500 mt-2">Current: {x.progress.status.replaceAll('_',' ')}</p>
              </div>)}
            </div>
          </article>)}
        </div>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-3"><BookOpenCheck className="h-5 w-5 text-indigo-300"/><h3 className="font-bold">Learn & understand</h3></div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {articles.map(a=><button key={a.id} onClick={()=>setSelectedArticle(a)} className="text-left rounded-xl border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-700">
            <div className="flex justify-between gap-3"><span className="text-[10px] uppercase text-slate-500">{a.content_kind.replaceAll('_',' ')}</span><span className="text-[10px]">{a.risk_level}</span></div>
            <p className="font-semibold mt-2">{a.title}</p><p className="text-xs text-slate-400 mt-1">{a.summary}</p>
          </button>)}
        </div>
      </div>

      {selectedArticle&&<div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex justify-between gap-4"><div><p className="text-xs uppercase text-slate-500">{selectedArticle.category}</p><h3 className="text-xl font-bold mt-1">{selectedArticle.title}</h3></div><button onClick={()=>setSelectedArticle(null)} className="text-xs text-slate-400">Close</button></div>
        <p className="text-sm text-slate-300 mt-4">{selectedArticle.explanation}</p>
        <div className="grid gap-5 md:grid-cols-2 mt-5">
          <div><p className="text-xs font-bold text-emerald-300">Owner actions</p><ul className="mt-2 space-y-2 text-sm text-slate-400">{selectedArticle.owner_actions.map(x=><li key={x}>• {x}</li>)}</ul></div>
          <div><p className="text-xs font-bold text-amber-300">Seek help when</p><ul className="mt-2 space-y-2 text-sm text-slate-400">{selectedArticle.seek_help_when.map(x=><li key={x}>• {x}</li>)}</ul></div>
        </div>
        <div className="flex gap-2 flex-wrap mt-5">
          {selectedArticle.roadside_recommended&&<button onClick={()=>onNavigate('roadside')} className="rounded-lg border border-rose-800 px-3 py-2 text-xs">Roadside assistance</button>}
          {selectedArticle.booking_recommended&&<button onClick={()=>onNavigate('bookings')} className="rounded-lg border border-indigo-800 px-3 py-2 text-xs">Book inspection/service</button>}
          <button onClick={()=>onNavigate('issues')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Record/review issue</button>
        </div>
        <p className="text-[10px] text-slate-500 mt-4">Source: {selectedArticle.source_label}. This content explains possibilities and next actions; it is not a diagnosis.</p>
      </div>}

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400 flex gap-3">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-300"/><p>{dashboard.safety_statement}</p>
      </div>
    </>}
  </section>;
};
