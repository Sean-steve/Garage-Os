import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Car, CircleAlert, Filter, PackageCheck, Plus, RefreshCw, ShieldCheck, Store } from 'lucide-react';
import { VehicleSummary } from '../types';

type FitmentStatus='UNKNOWN'|'GENERIC'|'SELLER_CLAIMED'|'PROBABLE'|'CONFIRMED'|'CONFLICT'|'NOT_COMPATIBLE';

interface Props{
  actor:any;
  vehicles:VehicleSummary[];
  selectedVehicleId:string;
  onSelectVehicle:(id:string)=>void;
  onNotify:(message:string)=>void;
}

const getVehicleId=(vehicle:any)=>String(vehicle?.vehicle_id||vehicle?.id||'');

function fitmentBadge(status:FitmentStatus):string{
  const base='inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-wide ';
  if(status==='CONFIRMED')return base+'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
  if(status==='PROBABLE')return base+'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
  if(status==='SELLER_CLAIMED')return base+'border-amber-500/40 bg-amber-500/10 text-amber-300';
  if(status==='GENERIC')return base+'border-violet-500/40 bg-violet-500/10 text-violet-300';
  if(status==='CONFLICT'||status==='NOT_COMPATIBLE')return base+'border-rose-500/40 bg-rose-500/10 text-rose-300';
  return base+'border-slate-700 bg-slate-900 text-slate-400';
}

function money(minor:number,currency:string):string{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
}

export const BentoFitment:React.FC<Props>=({actor,vehicles,selectedVehicleId,onSelectVehicle,onNotify})=>{
  const [mode,setMode]=useState<'car'|'seller'>('car');
  const [loading,setLoading]=useState(false);
  const [includeUnknown,setIncludeUnknown]=useState(false);
  const [result,setResult]=useState<any>(null);
  const [query,setQuery]=useState('');

  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [products,setProducts]=useState<any[]>([]);
  const [productId,setProductId]=useState('');
  const [rules,setRules]=useState<any[]>([]);
  const [ruleForm,setRuleForm]=useState({
    rule_kind:'INCLUDE',vehicle_make:'',vehicle_model:'',year_from:'',year_to:'',trim:'',variant:'',
    evidence_reference:'',evidence_summary:''
  });

  useEffect(()=>{
    if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);
  },[organizationId,sellerMemberships]);

  const fetchCompatible=useCallback(async()=>{
    if(!selectedVehicleId)return;
    setLoading(true);
    try{
      const params=new URLSearchParams();
      if(query.trim())params.set('query',query.trim());
      if(includeUnknown)params.set('include_unknown','true');
      const url='/api/v1/marketplace/fitment/vehicles/'+encodeURIComponent(selectedVehicleId)+'/search?'+params.toString();
      const res=await fetch(url);
      const json=await res.json();
      if(!res.ok)throw new Error(json?.error?.message||'Unable to evaluate compatibility');
      setResult(json.data||json);
    }catch(err){onNotify((err as Error).message);}
    finally{setLoading(false);}
  },[selectedVehicleId,query,includeUnknown,onNotify]);

  useEffect(()=>{if(mode==='car'&&selectedVehicleId)void fetchCompatible();},[mode,selectedVehicleId,includeUnknown,fetchCompatible]);

  const fetchStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const res=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!res.ok)return;
    const json=await res.json();
    const list=(json.data||json).stores||[];
    setStores(list);
    setStoreId(current=>current&&list.some((s:any)=>s.id===current)?current:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(mode==='seller')void fetchStores();},[mode,fetchStores]);

  const fetchProducts=useCallback(async()=>{
    if(!storeId){setProducts([]);setProductId('');return;}
    const res=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/products');
    if(!res.ok)return;
    const json=await res.json();
    const list=(json.data||json).products||[];
    setProducts(list);
    setProductId(current=>current&&list.some((p:any)=>p.id===current)?current:(list[0]?.id||''));
  },[storeId]);
  useEffect(()=>{if(mode==='seller')void fetchProducts();},[mode,fetchProducts]);

  const fetchRules=useCallback(async()=>{
    if(!storeId||!productId){setRules([]);return;}
    const res=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/products/'+encodeURIComponent(productId)+'/fitment/rules');
    if(!res.ok)return;
    const json=await res.json();
    setRules((json.data||json).rules||[]);
  },[storeId,productId]);
  useEffect(()=>{if(mode==='seller')void fetchRules();},[mode,fetchRules]);

  async function createRule(event:React.FormEvent){
    event.preventDefault();
    if(!storeId||!productId)return;
    const payload:any={rule_kind:ruleForm.rule_kind};
    if(ruleForm.rule_kind!=='GENERIC'){
      for(const key of ['vehicle_make','vehicle_model','trim','variant','evidence_reference','evidence_summary'] as const){
        if(ruleForm[key].trim())payload[key]=ruleForm[key].trim();
      }
      if(ruleForm.year_from)payload.year_from=Number(ruleForm.year_from);
      if(ruleForm.year_to)payload.year_to=Number(ruleForm.year_to);
    }else{
      if(ruleForm.evidence_reference.trim())payload.evidence_reference=ruleForm.evidence_reference.trim();
      if(ruleForm.evidence_summary.trim())payload.evidence_summary=ruleForm.evidence_summary.trim();
    }
    setLoading(true);
    try{
      const url='/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/products/'+encodeURIComponent(productId)+'/fitment/rules';
      const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const json=await res.json();
      if(!res.ok)throw new Error(json?.error?.message||'Could not save fitment rule');
      onNotify('Structured seller fitment claim saved.');
      setRuleForm({...ruleForm,evidence_reference:'',evidence_summary:''});
      await fetchRules();
    }catch(err){onNotify((err as Error).message);}
    finally{setLoading(false);}
  }

  async function revoke(ruleId:string){
    setLoading(true);
    try{
      const url='/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/products/'+encodeURIComponent(productId)+'/fitment/rules/'+encodeURIComponent(ruleId)+'/revoke';
      const res=await fetch(url,{method:'POST'});
      const json=await res.json();
      if(!res.ok)throw new Error(json?.error?.message||'Could not revoke fitment rule');
      onNotify('Fitment claim revoked.');
      await fetchRules();
    }catch(err){onNotify((err as Error).message);}
    finally{setLoading(false);}
  }

  const selected=vehicles.find(v=>getVehicleId(v)===selectedVehicleId) as any;

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-300"><BadgeCheck className="h-4 w-4"/>GAR-022</div>
          <h2 className="mt-2 text-2xl font-bold">Vehicle Compatibility & Fitment</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Fitment is evaluated for a specific product and vehicle. Seller claims, catalog evidence, verified authorities, exclusions and conflicts remain visibly distinct.</p>
        </div>
        <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button onClick={()=>setMode('car')} className={'rounded-lg px-4 py-2 text-xs font-semibold '+(mode==='car'?'bg-cyan-500/15 text-cyan-200':'text-slate-400')}>My Car</button>
          <button onClick={()=>setMode('seller')} className={'rounded-lg px-4 py-2 text-xs font-semibold '+(mode==='seller'?'bg-violet-500/15 text-violet-200':'text-slate-400')}>Fitment Studio</button>
        </div>
      </div>
      <div className="mt-5 flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-100">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300"/>
        <p>Confirmed means the current evidence matches a source configured as a verified fitment authority. It is still not a purchase or installation guarantee.</p>
      </div>
    </div>

    {mode==='car'&&<div className="grid gap-5 xl:grid-cols-[320px_1fr]">
      <aside className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
        <h3 className="flex items-center gap-2 font-bold"><Car className="h-4 w-4 text-cyan-300"/>My Car → Compatible Parts</h3>
        <label className="block text-xs text-slate-400">Vehicle
          <select value={selectedVehicleId} onChange={e=>onSelectVehicle(e.target.value)} className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
            {vehicles.map((v:any)=><option key={getVehicleId(v)} value={getVehicleId(v)}>{v.display_name||v.make+' '+v.model} • {v.model_year}</option>)}
          </select>
        </label>
        {selected&&<div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 text-xs"><p className="font-semibold text-slate-200">{selected.make} {selected.model} {selected.model_year}</p><p className="mt-1 text-slate-500">{selected.trim||'Trim not recorded'}</p></div>}
        <label className="block text-xs text-slate-400">Search products
          <div className="mt-2 flex gap-2"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="brakes, filters, tyres…" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><button onClick={()=>void fetchCompatible()} className="rounded-lg border border-slate-700 px-3"><Filter className="h-4 w-4"/></button></div>
        </label>
        <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={includeUnknown} onChange={e=>setIncludeUnknown(e.target.checked)}/>Include unknown fitment</label>
        <button disabled={loading||!selectedVehicleId} onClick={()=>void fetchCompatible()} className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/>Evaluate catalog</button>
        {result?.compatibility_counts&&<div className="grid grid-cols-2 gap-2 text-[10px]">{Object.entries(result.compatibility_counts).map(([key,value]:any)=><div key={key} className="rounded-lg border border-slate-800 p-2"><p className="text-slate-500">{key.replaceAll('_',' ')}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div>}
      </aside>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="mb-4 flex items-center justify-between gap-4"><div><h3 className="font-bold">Compatible catalog</h3><p className="mt-1 text-xs text-slate-500">{result?String(result.total)+' shown from '+String(result.evaluated_total)+' evaluated listings':'Select a vehicle to evaluate published marketplace inventory.'}</p></div><PackageCheck className="h-5 w-5 text-cyan-300"/></div>
        <div className="grid gap-4 md:grid-cols-2">
          {result?.items?.length?result.items.map((item:any)=><article key={item.listing_id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{item.category_name} • {item.brand||'Unbranded'}</p><h4 className="mt-1 font-bold">{item.title}</h4></div><span className={fitmentBadge(item.fitment.status)}>{item.fitment.status.replaceAll('_',' ')}</span></div>
            <p className="mt-3 text-lg font-bold">{money(item.price_minor,item.currency)}</p>
            <p className="mt-2 text-xs leading-5 text-slate-400">{item.fitment.reason}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-slate-500"><span>Confidence {item.fitment.confidence}%</span><span>•</span><span>Evidence rules {item.fitment.matched_rule_ids.length}</span><span>•</span><span>Guaranteed: no</span></div>
            {item.fitment.status==='SELLER_CLAIMED'&&<p className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-200">Seller-asserted compatibility. Not independently verified by Garage OS.</p>}
          </article>):<div className="md:col-span-2 rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No compatible listings match the current vehicle and filters.</div>}
        </div>
      </div>
    </div>}

    {mode==='seller'&&<div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
          <h3 className="flex items-center gap-2 font-bold"><Store className="h-4 w-4 text-violet-300"/>Seller context</h3>
          <div className="mt-4 space-y-3">
            <select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Choose organization</option>{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select>
            <select value={storeId} onChange={e=>setStoreId(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Choose storefront</option>{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select>
            <select value={productId} onChange={e=>setProductId(e.target.value)} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Choose product</option>{products.map(p=><option key={p.id} value={p.id}>{p.seller_sku} • {p.title}</option>)}</select>
          </div>
          <p className="mt-4 text-[10px] leading-5 text-slate-500">Seller-entered rules are permanently classified as SELLER_ASSERTED. Only governed platform sources can create verified fitment evidence.</p>
        </div>

        <form onSubmit={createRule} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5 lg:col-span-2">
          <h3 className="flex items-center gap-2 font-bold"><Plus className="h-4 w-4 text-violet-300"/>Structured fitment claim</h3>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="text-xs text-slate-400">Rule<select value={ruleForm.rule_kind} onChange={e=>setRuleForm({...ruleForm,rule_kind:e.target.value})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="INCLUDE">Fits / Include</option><option value="EXCLUDE">Does not fit / Exclude</option><option value="GENERIC">Generic / Universal</option></select></label>
            {ruleForm.rule_kind!=='GENERIC'&&<>
              <input placeholder="Make" value={ruleForm.vehicle_make} onChange={e=>setRuleForm({...ruleForm,vehicle_make:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <input placeholder="Model" value={ruleForm.vehicle_model} onChange={e=>setRuleForm({...ruleForm,vehicle_model:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <div className="grid grid-cols-2 gap-2"><input type="number" placeholder="Year from" value={ruleForm.year_from} onChange={e=>setRuleForm({...ruleForm,year_from:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input type="number" placeholder="Year to" value={ruleForm.year_to} onChange={e=>setRuleForm({...ruleForm,year_to:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></div>
              <input placeholder="Trim (optional)" value={ruleForm.trim} onChange={e=>setRuleForm({...ruleForm,trim:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <input placeholder="Variant (optional)" value={ruleForm.variant} onChange={e=>setRuleForm({...ruleForm,variant:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
            </>}
            <input placeholder="Evidence reference" value={ruleForm.evidence_reference} onChange={e=>setRuleForm({...ruleForm,evidence_reference:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm md:col-span-2"/>
            <textarea placeholder="Evidence summary / fitment notes" value={ruleForm.evidence_summary} onChange={e=>setRuleForm({...ruleForm,evidence_summary:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm md:col-span-2"/>
          </div>
          <button disabled={loading||!productId} className="mt-4 flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold disabled:opacity-40"><ShieldCheck className="h-4 w-4"/>Save seller claim</button>
        </form>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-5">
        <div className="flex items-center justify-between"><div><h3 className="font-bold">Fitment evidence</h3><p className="mt-1 text-xs text-slate-500">Active and revoked rules remain visible for traceability.</p></div><button onClick={()=>void fetchRules()} className="rounded-lg border border-slate-700 p-2"><RefreshCw className="h-4 w-4"/></button></div>
        <div className="mt-4 space-y-3">
          {rules.length?rules.map((rule:any)=><div key={rule.id} className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
            <div><div className="flex flex-wrap gap-2"><span className={fitmentBadge(rule.verification_status==='VERIFIED'?'CONFIRMED':'SELLER_CLAIMED')}>{rule.verification_status}</span><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px]">{rule.rule_kind}</span>{rule.status==='REVOKED'&&<span className="rounded-full border border-rose-500/30 px-2 py-1 text-[10px] text-rose-300">REVOKED</span>}</div><p className="mt-3 text-sm font-semibold">{rule.rule_kind==='GENERIC'?'Generic / universal claim':(rule.vehicle_make||'*')+' '+(rule.vehicle_model||'*')+' • '+(rule.year_from||'*')+'–'+(rule.year_to||'*')}</p><p className="mt-1 text-[10px] text-slate-500">{rule.source_display_name||rule.source_type} • authority: {rule.source_verification_authority?'yes':'no'}</p>{rule.evidence_summary&&<p className="mt-2 text-xs text-slate-400">{rule.evidence_summary}</p>}</div>
            {rule.status==='ACTIVE'&&rule.source_type==='SELLER'&&<button disabled={loading} onClick={()=>void revoke(rule.id)} className="rounded-lg border border-rose-900 px-3 py-2 text-xs text-rose-300">Revoke</button>}
          </div>):<p className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">No structured fitment rules for the selected product.</p>}
        </div>
      </div>
    </div>}
  </section>;
};
