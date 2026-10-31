import React,{useCallback,useEffect,useMemo,useState} from 'react';
import { AlertTriangle, CheckCircle2, MapPin, Navigation, RefreshCw, ShieldAlert, UsersRound } from 'lucide-react';
import { ActiveTab, VehicleSummary } from '../types';

interface Props{
  vehicles:VehicleSummary[];
  selectedVehicleId:string;
  onSelectVehicle:(id:string)=>void;
  onNavigate:(tab:ActiveTab)=>void;
  onNotify?:(message:string)=>void;
}
interface Journey{
  id:string;vehicle_id:string;status:'PREPARED'|'IN_PROGRESS'|'ARRIVED'|'CANCELLED';
  origin_label:string;destination_label:string;planned_departure_at?:string|null;
  expected_arrival_at?:string|null;purpose?:string|null;pretrip_mission_id:string;
  location_sharing_enabled:boolean;checkins_enabled:boolean;checkin_interval_minutes?:number|null;
  started_at?:string|null;arrived_at?:string|null;cancelled_at?:string|null;
}
interface Aggregate{
  journey:Journey;
  readiness:{
    level:string;start_allowed:boolean;requires_start_acknowledgement:boolean;
    pretrip_mission_status:string;pretrip_progress_percent:number;pretrip_pending_count:number;
    pretrip_concerns_reported:number;pretrip_professional_help_required:number;
    maintenance_overdue_count:number;maintenance_due_count:number;active_issue_count:number;
    critical_issue_count:number;grounding_issue_ids:string[];statement:string;
    actions:Array<{label:string;target_tab:ActiveTab}>;
  };
  contact_shares:Array<{id:string;contact_id:string;share_location_when_available:boolean}>;
  checkins:Array<{id:string;status:string;due_at:string;prompted_at?:string|null;response?:string|null;missed_at?:string|null}>;
  latest_location:{captured_at:string;accuracy_meters?:number|null;expires_at:string}|null;
  escalation_links:Array<{id:string;escalation_type:string;target_reference_id:string;created_at:string}>;
  truth:{
    live_tracking_active:false;crash_detection_active:false;automatic_emergency_escalation_active:false;
    missed_checkin_means_injury:false;journey_status_is_safety_certification:false;
  };
}
interface EmergencyContact{ id:string;display_name:string;relationship_label?:string|null;status:string; }
const unwrap=(v:any)=>v?.data??v;

export const BentoTripGuardian:React.FC<Props>=({vehicles,selectedVehicleId,onSelectVehicle,onNavigate,onNotify})=>{
  const [journeys,setJourneys]=useState<Journey[]>([]);
  const [selected,setSelected]=useState<Aggregate|null>(null);
  const [contacts,setContacts]=useState<EmergencyContact[]>([]);
  const [busy,setBusy]=useState(false);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [ackWarnings,setAckWarnings]=useState(false);
  const [form,setForm]=useState({
    origin_label:'',destination_label:'',planned_departure_at:'',expected_arrival_at:'',
    purpose:'',location_sharing_enabled:false,checkins_enabled:true,checkin_interval_minutes:60,
    contact_ids:[] as string[]
  });
  const notify=(m:string)=>{setMessage(m);onNotify?.(m);};

  const load=useCallback(async()=>{
    if(!selectedVehicleId){setJourneys([]);setSelected(null);return;}
    setLoading(true);
    try{
      const [jRes,cRes]=await Promise.all([
        fetch('/api/v1/trip-guardian/journeys?vehicle_id='+encodeURIComponent(selectedVehicleId)),
        fetch('/api/v1/safety/emergency-circle')
      ]);
      const jJson=await jRes.json(),cJson=await cRes.json();
      if(!jRes.ok) throw new Error(jJson?.error?.message||'Unable to load journeys');
      if(!cRes.ok) throw new Error(cJson?.error?.message||'Unable to load Emergency Circle');
      setJourneys(unwrap(jJson)?.journeys||[]);
      setContacts((unwrap(cJson)?.contacts||[]).filter((x:any)=>x.status==='ACTIVE'));
      if(selected?.journey?.id){
        const d=await fetch('/api/v1/trip-guardian/journeys/'+selected.journey.id);
        if(d.ok)setSelected(unwrap(await d.json()));
      }
    }catch(e){notify(e instanceof Error?e.message:'Unable to load Trip Guardian');}
    finally{setLoading(false);}
  },[selectedVehicleId,selected?.journey?.id]);

  useEffect(()=>{load();},[selectedVehicleId]);

  const open=async(id:string)=>{
    setBusy(true);
    try{
      const res=await fetch('/api/v1/trip-guardian/journeys/'+id);const json=await res.json();
      if(!res.ok)throw new Error(json?.error?.message||'Unable to load journey');
      setSelected(unwrap(json));setAckWarnings(false);
    }catch(e){notify(e instanceof Error?e.message:'Unable to load journey');}
    finally{setBusy(false);}
  };

  const create=async(e:React.FormEvent)=>{
    e.preventDefault();if(!selectedVehicleId)return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/trip-guardian/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        vehicle_id:selectedVehicleId,origin_label:form.origin_label,destination_label:form.destination_label,
        planned_departure_at:form.planned_departure_at?new Date(form.planned_departure_at).toISOString():null,
        expected_arrival_at:form.expected_arrival_at?new Date(form.expected_arrival_at).toISOString():null,
        purpose:form.purpose||null,location_sharing_enabled:form.location_sharing_enabled,
        checkins_enabled:form.checkins_enabled,
        checkin_interval_minutes:form.checkins_enabled?form.checkin_interval_minutes:null,
        contact_ids:form.contact_ids
      })});
      const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Unable to prepare journey');
      setSelected(unwrap(json));
      notify('Journey prepared. Complete or review the linked pre-trip checklist before departure.');
      await load();
    }catch(e){notify(e instanceof Error?e.message:'Unable to prepare journey');}
    finally{setBusy(false);}
  };

  const action=async(path:string,body?:any,success?:string)=>{
    if(!selected)return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/trip-guardian/journeys/'+selected.journey.id+'/'+path,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body)
      });
      const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Journey action failed');
      setSelected(unwrap(json));if(success)notify(success);await load();
    }catch(e){notify(e instanceof Error?e.message:'Journey action failed');}
    finally{setBusy(false);}
  };

  const shareCurrentLocation=()=>{
    if(!selected)return;
    if(!navigator.geolocation){notify('This browser does not expose geolocation.');return;}
    setBusy(true);
    navigator.geolocation.getCurrentPosition(async(pos)=>{
      try{
        const res=await fetch('/api/v1/trip-guardian/journeys/'+selected.journey.id+'/location',{
          method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
            latitude:pos.coords.latitude,longitude:pos.coords.longitude,
            accuracy_meters:pos.coords.accuracy,captured_at:new Date(pos.timestamp).toISOString()
          })
        });
        const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Location snapshot failed');
        notify('One-time trip location snapshot recorded. Live tracking is not active.');
        await open(selected.journey.id);
      }catch(e){notify(e instanceof Error?e.message:'Location snapshot failed');}
      finally{setBusy(false);}
    },err=>{setBusy(false);notify(err.message||'Location permission was not granted.');},{enableHighAccuracy:true,timeout:10000,maximumAge:0});
  };

  const vehicle=useMemo(()=>vehicles.find(v=>v.id===selectedVehicleId),[vehicles,selectedVehicleId]);
  const readinessTone=(level:string)=>level==='CANONICAL_STOP_DRIVING'?'border-rose-800 bg-rose-950/20':level==='ATTENTION_RECORDED'?'border-amber-800 bg-amber-950/15':'border-slate-800 bg-slate-900/50';

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4">
          <div className="h-12 w-12 rounded-xl bg-cyan-500/15 text-cyan-300 flex items-center justify-center"><Navigation className="h-6 w-6"/></div>
          <div><h2 className="text-xl font-bold">Trip Guardian</h2><p className="text-sm text-slate-400 mt-1">Prepare a journey, review vehicle readiness, schedule check-ins, and keep SOS/Roadside close at hand.</p></div>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold flex items-center gap-2"><RefreshCw className="h-4 w-4"/>Refresh</button>
      </div>
      <div className="mt-4 rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs text-indigo-200">
        Foundation mode: no crash detection, no automatic emergency escalation, and no continuous live tracking. A missed check-in only means no response was received.
      </div>
    </div>

    {message&&<div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{message}</div>}

    <select value={selectedVehicleId} onChange={e=>{onSelectVehicle(e.target.value);setSelected(null);}} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
      <option value="">Select vehicle</option>
      {vehicles.map(v=><option key={v.id} value={v.id}>{v.display_name||v.make+' '+v.model}{v.registration_number?' • '+v.registration_number:''}</option>)}
    </select>

    {selectedVehicleId&&<div className="grid gap-6 xl:grid-cols-[0.9fr_1.4fr]">
      <form onSubmit={create} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <h3 className="font-bold">Prepare a journey</h3>
        <input required placeholder="Origin label" value={form.origin_label} onChange={e=>setForm({...form,origin_label:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <input required placeholder="Destination label" value={form.destination_label} onChange={e=>setForm({...form,destination_label:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <label className="block text-xs text-slate-400">Planned departure<input type="datetime-local" value={form.planned_departure_at} onChange={e=>setForm({...form,planned_departure_at:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></label>
        <label className="block text-xs text-slate-400">Expected arrival — owner estimate, not route ETA<input type="datetime-local" value={form.expected_arrival_at} onChange={e=>setForm({...form,expected_arrival_at:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></label>
        <textarea placeholder="Purpose / note (optional)" value={form.purpose} onChange={e=>setForm({...form,purpose:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.checkins_enabled} onChange={e=>setForm({...form,checkins_enabled:e.target.checked})}/>Schedule journey check-ins</label>
        {form.checkins_enabled&&<label className="block text-xs text-slate-400">Check-in interval (minutes)<input type="number" min={15} max={720} value={form.checkin_interval_minutes} onChange={e=>setForm({...form,checkin_interval_minutes:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"/></label>}
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.location_sharing_enabled} onChange={e=>setForm({...form,location_sharing_enabled:e.target.checked})}/>Allow one-time journey location snapshots</label>
        <div>
          <p className="text-xs text-slate-400 mb-2 flex items-center gap-2"><UsersRound className="h-4 w-4"/>Emergency Circle contacts for journey context</p>
          <div className="space-y-2">{contacts.length?contacts.map(c=><label key={c.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={form.contact_ids.includes(c.id)} onChange={e=>setForm({...form,contact_ids:e.target.checked?[...form.contact_ids,c.id]:form.contact_ids.filter(x=>x!==c.id)})}/>{c.display_name}{c.relationship_label?' • '+c.relationship_label:''}</label>):<p className="text-[11px] text-slate-500">No active Emergency Circle contacts configured.</p>}</div>
          <p className="text-[10px] text-slate-500 mt-2">Selecting contacts configures journey context only. Sprint 21 does not claim any contact notification was sent or delivered.</p>
        </div>
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold disabled:opacity-50">Prepare journey + pre-trip check</button>
      </form>

      <div className="space-y-3">
        <h3 className="font-bold">Journeys {vehicle?'• '+vehicle.display_name:''}</h3>
        {loading?<div className="rounded-xl border border-slate-800 p-6 text-sm text-slate-400">Loading…</div>:journeys.length===0?<div className="rounded-xl border border-slate-800 p-6 text-sm text-slate-500">No Trip Guardian journeys recorded for this vehicle.</div>:journeys.map(j=><button key={j.id} onClick={()=>open(j.id)} className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex justify-between gap-3"><span className="font-semibold">{j.origin_label} → {j.destination_label}</span><span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{j.status}</span></div>
          <p className="text-xs text-slate-500 mt-2">{j.expected_arrival_at?'Expected arrival '+new Date(j.expected_arrival_at).toLocaleString():'No expected arrival set'}</p>
        </button>)}
      </div>
    </div>}

    {selected&&<div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div><p className="text-xs uppercase text-cyan-300">{selected.journey.status}</p><h3 className="text-xl font-bold mt-1">{selected.journey.origin_label} → {selected.journey.destination_label}</h3></div>
        <div className="flex flex-wrap gap-2">
          {selected.journey.status==='IN_PROGRESS'&&<button disabled={busy} onClick={()=>action('arrive',undefined,'Arrival recorded. Pending check-ins and trip-location access were closed.')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold">Mark arrived</button>}
          {['PREPARED','IN_PROGRESS'].includes(selected.journey.status)&&<button disabled={busy} onClick={()=>action('cancel',{reason:'OWNER_CANCELLED'},'Journey cancelled.')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Cancel</button>}
        </div>
      </div>

      <div className={'rounded-xl border p-5 '+readinessTone(selected.readiness.level)}>
        <div className="flex justify-between gap-3"><h4 className="font-semibold">Pre-trip readiness review</h4><span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{selected.readiness.level.replaceAll('_',' ')}</span></div>
        <p className="text-xs text-slate-400 mt-2">{selected.readiness.statement}</p>
        <div className="grid gap-3 md:grid-cols-4 mt-4 text-xs">
          <div><span className="text-slate-500">Checklist</span><p className="font-semibold mt-1">{selected.readiness.pretrip_progress_percent}% reviewed</p></div>
          <div><span className="text-slate-500">Pending</span><p className="font-semibold mt-1">{selected.readiness.pretrip_pending_count}</p></div>
          <div><span className="text-slate-500">Maintenance due/overdue</span><p className="font-semibold mt-1">{selected.readiness.maintenance_due_count}/{selected.readiness.maintenance_overdue_count}</p></div>
          <div><span className="text-slate-500">Critical issues</span><p className="font-semibold mt-1">{selected.readiness.critical_issue_count}</p></div>
        </div>
        <div className="flex flex-wrap gap-2 mt-4">
          <button onClick={()=>onNavigate('care')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Open pre-trip checklist</button>
          {selected.readiness.actions.map((a,i)=><button key={i} onClick={()=>onNavigate(a.target_tab)} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">{a.label}</button>)}
        </div>
        {selected.journey.status==='PREPARED'&&<>
          {selected.readiness.requires_start_acknowledgement&&<label className="mt-4 flex gap-2 items-start text-xs text-amber-200"><input type="checkbox" checked={ackWarnings} onChange={e=>setAckWarnings(e.target.checked)}/><span>I acknowledge the recorded readiness warnings/incomplete checks. This acknowledgement does not certify the journey as safe.</span></label>}
          <button disabled={busy||!selected.readiness.start_allowed||(selected.readiness.requires_start_acknowledgement&&!ackWarnings)} onClick={()=>action('start',{acknowledge_readiness_warnings:ackWarnings,acknowledgement_note:ackWarnings?'OWNER_ACKNOWLEDGED_IN_UI':undefined},'Journey started. No trusted-contact delivery or live tracking is implied.')} className="mt-4 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-semibold disabled:opacity-40">Start journey</button>
        </>}
      </div>

      {selected.journey.status==='IN_PROGRESS'&&<div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 p-4">
          <h4 className="font-semibold flex items-center gap-2"><MapPin className="h-4 w-4"/>Location sharing</h4>
          <p className="text-xs text-slate-500 mt-2">One-time snapshots only. Continuous live tracking is not active in Sprint 21.</p>
          <button disabled={busy||!selected.journey.location_sharing_enabled} onClick={shareCurrentLocation} className="mt-3 rounded-lg border border-indigo-800 px-3 py-2 text-xs disabled:opacity-40">Share current location once</button>
          {selected.latest_location&&<p className="text-[10px] text-slate-500 mt-2">Latest snapshot: {new Date(selected.latest_location.captured_at).toLocaleString()} • accuracy {Math.round(selected.latest_location.accuracy_meters||0)}m</p>}
        </div>
        <div className="rounded-xl border border-rose-900/60 bg-rose-950/15 p-4">
          <h4 className="font-semibold flex items-center gap-2 text-rose-200"><ShieldAlert className="h-4 w-4"/>Need help?</h4>
          <p className="text-xs text-rose-200/70 mt-2">SOS is an explicit owner action. Starting it does not itself prove contact delivery or assistance acceptance.</p>
          <div className="flex flex-wrap gap-2 mt-3">
            <button disabled={busy} onClick={()=>action('escalate/sos',{},'SOS activation attempt was acknowledged by the backend. Contact delivery and assistance remain separate truth states.')} className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold">Activate SOS</button>
            <button onClick={()=>onNavigate('roadside')} className="rounded-lg border border-rose-800 px-3 py-2 text-xs">Open Roadside</button>
          </div>
        </div>
      </div>}

      <div className="rounded-xl border border-slate-800 p-4">
        <h4 className="font-semibold">Journey check-ins</h4>
        <p className="text-xs text-slate-500 mt-1">A missed check-in records only that no response was received. It does not infer a crash or injury and does not automatically activate SOS.</p>
        <div className="mt-3 space-y-3">{selected.checkins.length?selected.checkins.map(c=><div key={c.id} className="rounded-lg border border-slate-800 p-3">
          <div className="flex justify-between gap-3 text-xs"><span>Due {new Date(c.due_at).toLocaleString()}</span><span>{c.status}</span></div>
          {c.status==='PENDING'&&selected.journey.status==='IN_PROGRESS'&&<div className="flex flex-wrap gap-2 mt-3">
            {['OKAY','DELAYED','NEED_HELP'].map(r=><button key={r} disabled={busy} onClick={()=>action('checkins/'+c.id+'/respond',{response:r},r==='NEED_HELP'?'Need-help response recorded. SOS was not activated automatically.':undefined)} className="rounded border border-slate-700 px-2 py-1 text-[11px]">{r.replaceAll('_',' ')}</button>)}
          </div>}
        </div>):<p className="text-xs text-slate-500">No journey check-ins scheduled yet.</p>}</div>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400">
        Trusted journey context configured for {selected.contact_shares.length} contact(s). Notification delivery is not claimed. SOS links recorded: {selected.escalation_links.length}.
      </div>
    </div>}
  </section>;
};
