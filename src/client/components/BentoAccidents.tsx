import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Camera, CheckCircle2, FileWarning, RefreshCw, ShieldAlert, Wrench } from 'lucide-react';
import { VehicleSummary } from '../types';

interface Props {
  vehicles: VehicleSummary[];
  selectedVehicleId: string;
  onSelectVehicle: (id: string) => void;
  onNotify?: (message: string) => void;
}

interface AccidentIncident {
  id:string; vehicle_id:string; status:'DRAFT'|'RECORDED'|'REPAIR_IN_PROGRESS'|'CLOSED';
  incident_type:string; severity:string; occurred_at:string; summary:string;
  police_attended:string; injuries_reported:string; vehicle_drivable:string;
  timeline_entry_id?:string|null; created_at:string;
}
interface AccidentAggregate {
  incident:AccidentIncident;
  participants:any[]; witnesses:any[]; damage_observations:any[]; evidence:any[];
  external_references:any[]; handoffs:any[]; addenda:any[];
}
const unwrap=(v:any)=>v?.data??v;

async function readFileBase64(file:File):Promise<string>{
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
    reader.readAsDataURL(file);
  });
}

export const BentoAccidents:React.FC<Props>=({vehicles,selectedVehicleId,onSelectVehicle,onNotify})=>{
  const [records,setRecords]=useState<AccidentIncident[]>([]);
  const [selected,setSelected]=useState<AccidentAggregate|null>(null);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);
  const [form,setForm]=useState({
    incident_type:'COLLISION',severity:'UNKNOWN',
    occurred_at:new Date().toISOString().slice(0,16),summary:'',
    police_attended:'UNKNOWN',injuries_reported:'UNKNOWN',vehicle_drivable:'UNKNOWN'
  });
  const [damage,setDamage]=useState({vehicle_area:'',severity:'UNKNOWN',description:''});

  const notify=(m:string)=>{setMessage(m);onNotify?.(m);};

  const load=useCallback(async()=>{
    if(!selectedVehicleId){setRecords([]);setSelected(null);return;}
    setLoading(true);
    try{
      const res=await fetch('/api/v1/accidents?vehicle_id='+encodeURIComponent(selectedVehicleId));
      const json=await res.json();
      if(!res.ok) throw new Error(json?.error?.message||'Unable to load accident records');
      setRecords(unwrap(json)?.accidents||[]);
    }catch(e){notify(e instanceof Error?e.message:'Unable to load accident records');}
    finally{setLoading(false);}
  },[selectedVehicleId]);

  useEffect(()=>{load();},[load]);

  const openRecord=async(id:string)=>{
    setBusy(true);
    try{
      const res=await fetch('/api/v1/accidents/'+id); const json=await res.json();
      if(!res.ok) throw new Error(json?.error?.message||'Unable to load accident');
      setSelected(unwrap(json));
    }catch(e){notify(e instanceof Error?e.message:'Unable to load accident');}
    finally{setBusy(false);}
  };

  const create=async(e:React.FormEvent)=>{
    e.preventDefault(); if(!selectedVehicleId) return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/accidents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        vehicle_id:selectedVehicleId,incident_type:form.incident_type,severity:form.severity,
        occurred_at:new Date(form.occurred_at).toISOString(),summary:form.summary,
        police_attended:form.police_attended,injuries_reported:form.injuries_reported,
        vehicle_drivable:form.vehicle_drivable
      })});
      const json=await res.json(); if(!res.ok) throw new Error(json?.error?.message||'Unable to create accident draft');
      setSelected(unwrap(json)); setForm({...form,summary:''});
      notify('Accident draft created. Add evidence and damage observations before finalizing.');
      await load();
    }catch(err){notify(err instanceof Error?err.message:'Unable to create accident draft');}
    finally{setBusy(false);}
  };

  const action=async(path:string,body?:any)=>{
    if(!selected) return;
    setBusy(true);
    try{
      const res=await fetch('/api/v1/accidents/'+selected.incident.id+'/'+path,{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:body===undefined?undefined:JSON.stringify(body)
      });
      const json=await res.json(); if(!res.ok) throw new Error(json?.error?.message||'Accident action failed');
      setSelected(unwrap(json)); await load();
    }catch(e){notify(e instanceof Error?e.message:'Accident action failed');}
    finally{setBusy(false);}
  };

  const uploadEvidence=async(file:File)=>{
    if(!selected) return;
    setBusy(true);
    try{
      const dataBase64=await readFileBase64(file);
      const upload=await fetch('/api/v1/uploads',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        filename:file.name,contentType:file.type||'application/octet-stream',dataBase64,classification:'CONFIDENTIAL'
      })});
      const uj=await upload.json(); if(!upload.ok) throw new Error(uj?.error?.message||'Evidence upload failed');
      const stored=unwrap(uj);
      const attach=await fetch('/api/v1/accidents/'+selected.incident.id+'/evidence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        file_id:stored.id,
        evidence_type:file.type.startsWith('image/')?'SCENE_PHOTO':file.type.startsWith('video/')?'VIDEO':'DOCUMENT',
        description:file.name,privacy_class:'PRIVATE'
      })});
      const aj=await attach.json(); if(!attach.ok) throw new Error(aj?.error?.message||'Evidence attachment failed');
      setSelected(unwrap(aj)); notify('Evidence stored privately and attached.');
    }catch(e){notify(e instanceof Error?e.message:'Evidence upload failed');}
    finally{setBusy(false);}
  };

  const vehicle=useMemo(()=>vehicles.find(v=>v.id===selectedVehicleId),[vehicles,selectedVehicleId]);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4">
          <div className="h-12 w-12 rounded-xl bg-amber-500/15 text-amber-300 flex items-center justify-center"><FileWarning className="h-6 w-6"/></div>
          <div><h2 className="text-xl font-bold">Accident Management</h2><p className="text-sm text-slate-400 mt-1">Capture incident facts, preserve evidence, coordinate recovery/repair, and create a controlled Passport record.</p></div>
        </div>
        <button onClick={load} className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold flex items-center gap-2"><RefreshCw className="h-4 w-4"/>Refresh</button>
      </div>
      <div className="mt-4 rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 text-xs text-indigo-200">
        Witnesses, other-party contacts, exact location, injury reports, police/claim references and raw evidence remain private. Only a neutral accident summary is projected to the Vehicle Passport.
      </div>
    </div>

    {message&&<div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{message}</div>}

    <select value={selectedVehicleId} onChange={e=>{onSelectVehicle(e.target.value);setSelected(null);}} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">
      <option value="">Select vehicle</option>
      {vehicles.map(v=><option key={v.id} value={v.id}>{v.display_name||v.make+' '+v.model}{v.registration_number?' • '+v.registration_number:''}</option>)}
    </select>

    {selectedVehicleId&&<div className="grid gap-6 xl:grid-cols-[0.9fr_1.5fr]">
      <form onSubmit={create} className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <h3 className="font-bold">New accident draft</h3>
        <select value={form.incident_type} onChange={e=>setForm({...form,incident_type:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
          <option value="COLLISION">Collision</option><option value="SINGLE_VEHICLE">Single vehicle</option><option value="PARKING_DAMAGE">Parking damage</option><option value="HIT_AND_RUN">Hit and run</option><option value="OTHER">Other</option>
        </select>
        <select value={form.severity} onChange={e=>setForm({...form,severity:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
          {['UNKNOWN','MINOR','MODERATE','MAJOR','TOTAL_LOSS_REPORTED'].map(x=><option key={x}>{x}</option>)}
        </select>
        <input type="datetime-local" value={form.occurred_at} onChange={e=>setForm({...form,occurred_at:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <textarea required placeholder="Describe what happened" value={form.summary} onChange={e=>setForm({...form,summary:e.target.value})} className="min-h-28 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        {[
          ['Police attended','police_attended'],['Injuries reported','injuries_reported'],['Vehicle drivable','vehicle_drivable']
        ].map(([label,key])=><label key={key} className="block text-xs text-slate-400">{label}<select value={(form as any)[key]} onChange={e=>setForm({...form,[key]:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option>UNKNOWN</option><option>YES</option><option>NO</option></select></label>)}
        <button disabled={busy} className="w-full rounded-lg bg-indigo-600 px-4 py-2.5 font-semibold disabled:opacity-50">Create private draft</button>
      </form>

      <div className="space-y-3">
        <h3 className="font-bold">Accident records {vehicle?'• '+vehicle.display_name:''}</h3>
        {loading?<div className="rounded-xl border border-slate-800 p-6 text-sm text-slate-400">Loading…</div>:records.length===0?<div className="rounded-xl border border-slate-800 p-6 text-sm text-slate-500">No accident records are currently recorded for this vehicle.</div>:
          records.map(r=><button key={r.id} onClick={()=>openRecord(r.id)} className="w-full text-left rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <div className="flex justify-between gap-3"><span className="font-semibold">{r.incident_type.replaceAll('_',' ')}</span><span className="text-[10px] rounded-full border border-slate-700 px-2 py-1">{r.status}</span></div>
            <p className="text-xs text-slate-500 mt-2">{new Date(r.occurred_at).toLocaleString()} • {r.severity}</p>
            <p className="text-sm text-slate-300 mt-2">{r.summary}</p>
          </button>)}
      </div>
    </div>}

    {selected&&<div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div><p className="text-xs uppercase tracking-wider text-amber-300">{selected.incident.status}</p><h3 className="text-xl font-bold mt-1">{selected.incident.incident_type.replaceAll('_',' ')}</h3></div>
        <div className="flex gap-2">
          {selected.incident.status==='DRAFT'&&<button disabled={busy} onClick={()=>action('finalize')} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4"/>Finalize</button>}
          {['RECORDED','REPAIR_IN_PROGRESS'].includes(selected.incident.status)&&<button disabled={busy} onClick={()=>action('close',{reason:'OWNER_CONFIRMED_CLOSED'})} className="rounded-lg border border-slate-600 px-4 py-2 text-sm">Close</button>}
        </div>
      </div>

      {selected.incident.timeline_entry_id&&<div className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4 text-xs text-emerald-200">Controlled Vehicle Timeline / Passport record created. Private accident data was not projected.</div>}

      <div className="grid gap-4 md:grid-cols-4">
        {[['Evidence',selected.evidence.length],['Damage',selected.damage_observations.length],['Participants',selected.participants.length],['Witnesses',selected.witnesses.length]].map(([label,count]:any)=><div key={label} className="rounded-xl border border-slate-800 p-4"><p className="text-2xl font-bold">{count}</p><p className="text-xs text-slate-500">{label}</p></div>)}
      </div>

      {selected.incident.status!=='CLOSED'&&<div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 p-4 space-y-3">
          <h4 className="font-semibold flex items-center gap-2"><Camera className="h-4 w-4"/>Private evidence</h4>
          <input type="file" accept="image/*,video/*,application/pdf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadEvidence(f);}} className="block w-full text-xs text-slate-400"/>
          <p className="text-[10px] text-slate-500">Evidence supports the record but does not automatically become externally verified.</p>
        </div>

        <form onSubmit={e=>{e.preventDefault();action('damage-observations',damage).then(()=>setDamage({vehicle_area:'',severity:'UNKNOWN',description:''}));}} className="rounded-xl border border-slate-800 p-4 space-y-2">
          <h4 className="font-semibold flex items-center gap-2"><Wrench className="h-4 w-4"/>Damage observation</h4>
          <input required placeholder="Vehicle area" value={damage.vehicle_area} onChange={e=>setDamage({...damage,vehicle_area:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
          <select value={damage.severity} onChange={e=>setDamage({...damage,severity:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{['UNKNOWN','COSMETIC','MINOR','MODERATE','SEVERE'].map(x=><option key={x}>{x}</option>)}</select>
          <textarea required placeholder="Observed damage" value={damage.description} onChange={e=>setDamage({...damage,description:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
          <button disabled={busy} className="rounded-lg bg-slate-800 px-3 py-2 text-sm">Add observation</button>
        </form>
      </div>}

      <div className="rounded-xl border border-slate-800 p-4">
        <h4 className="font-semibold">Operational handoffs</h4>
        <p className="text-xs text-slate-500 mt-1">Towing, roadside, booking and repair records remain authoritative in their own domains; Accident Management stores only validated links.</p>
        <div className="mt-3 space-y-2">{selected.handoffs.length?selected.handoffs.map((h:any)=><div key={h.id} className="text-xs">{h.handoff_type} • {h.target_reference_id} • {h.status}</div>):<p className="text-xs text-slate-500">No handoffs linked yet.</p>}</div>
      </div>

      {selected.incident.injuries_reported==='YES'&&<div className="rounded-xl border border-rose-900/60 bg-rose-950/20 p-4 text-sm text-rose-200 flex gap-3"><ShieldAlert className="h-5 w-5 shrink-0"/><p>“Injuries reported” is an owner-recorded incident fact, not a medical diagnosis. Seek appropriate emergency or medical help when needed.</p></div>}
    </div>}
  </section>;
};
