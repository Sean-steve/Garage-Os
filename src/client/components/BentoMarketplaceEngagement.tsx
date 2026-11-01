import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BellOff, Bookmark, RefreshCw, Search, Store, Trash2 } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};

export const BentoMarketplaceEngagement:React.FC<Props>=({actor,onNotify})=>{
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'saved'|'searches'|'alerts'|'preferences'|'seller'>('saved');
  const [summary,setSummary]=useState<any>(null);
  const [saved,setSaved]=useState<any[]>([]);
  const [searches,setSearches]=useState<any[]>([]);
  const [alerts,setAlerts]=useState<any[]>([]);
  const [prefs,setPrefs]=useState<any>(null);
  const [delivery,setDelivery]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerStats,setSellerStats]=useState<any>(null);

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const loadCore=useCallback(async()=>{
    const [s,l,q,a,p]=await Promise.all([
      fetch('/api/v1/marketplace/engagement/summary'),fetch('/api/v1/marketplace/saved-listings'),
      fetch('/api/v1/marketplace/saved-searches'),fetch('/api/v1/marketplace/alerts'),
      fetch('/api/v1/marketplace/alerts/preferences')
    ]);
    if(s.ok){const j=await s.json();setSummary(j.data||j);}
    if(l.ok){const j=await l.json();setSaved((j.data||j).saved_listings||[]);}
    if(q.ok){const j=await q.json();setSearches((j.data||j).saved_searches||[]);}
    if(a.ok){const j=await a.json();setAlerts((j.data||j).alerts||[]);}
    if(p.ok){const j=await p.json(),d=j.data||j;setPrefs(d.preferences);setDelivery(d.delivery_availability);}
  },[]);
  useEffect(()=>{void loadCore();},[loadCore]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json(),list=(j.data||j).stores||[];setStores(list);
    setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadSeller=useCallback(async()=>{
    if(!storeId){setSellerStats(null);return;}
    const r=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/engagement');
    if(r.ok){const j=await r.json();setSellerStats(j.data||j);}
  },[storeId]);
  useEffect(()=>{if(view==='seller')void loadSeller();},[view,loadSeller]);

  async function call(url:string,method:string,body?:any){
    setBusy(true);
    try{
      const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Operation failed');
      await loadCore();onNotify('Marketplace engagement updated.');return j.data||j;
    }catch(err){onNotify((err as Error).message);return null;}finally{setBusy(false);}
  }

  async function evaluate(){
    const result=await call('/api/v1/marketplace/alerts/evaluate-now','POST',{});
    if(result)onNotify('Alert evaluation complete: '+result.alerts_created+' new alert(s).');
  }

  async function savePrefs(){
    if(!prefs)return;
    await call('/api/v1/marketplace/alerts/preferences','PATCH',{
      in_app_enabled:prefs.in_app_enabled,email_requested:prefs.email_requested,
      sms_requested:prefs.sms_requested,push_requested:prefs.push_requested,
      max_alerts_per_day:Number(prefs.max_alerts_per_day),quiet_hours_start:prefs.quiet_hours_start||null,
      quiet_hours_end:prefs.quiet_hours_end||null
    });
  }

  const tabs:Array<['saved'|'searches'|'alerts'|'preferences'|'seller',string]>=[
    ['saved','Saved Items'],['searches','Saved Searches'],['alerts','Alerts'],['preferences','Preferences']
  ];
  if(sellerMemberships.length)tabs.push(['seller','Seller Engagement']);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><Bookmark className="h-4 w-4"/>Sprint 29</div><h2 className="mt-2 text-2xl font-bold">Saved Items, Alerts & Engagement</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Explicit saved intent, durable in-app price/restock/new-match alerts, and privacy-safe seller engagement.</p></div><button disabled={busy} onClick={()=>void evaluate()} className="flex items-center gap-2 rounded-lg border border-cyan-700 px-3 py-2 text-xs text-cyan-200"><RefreshCw className="h-4 w-4"/>Evaluate alerts</button></div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-800 p-3"><p className="text-[10px] uppercase text-slate-500">Saved listings</p><p className="mt-1 text-xl font-bold">{summary?.saved_listing_count||0}</p></div><div className="rounded-xl border border-slate-800 p-3"><p className="text-[10px] uppercase text-slate-500">Active saved searches</p><p className="mt-1 text-xl font-bold">{summary?.active_saved_search_count||0}</p></div><div className="rounded-xl border border-slate-800 p-3"><p className="text-[10px] uppercase text-slate-500">Unread alerts</p><p className="mt-1 text-xl font-bold">{summary?.unread_alert_count||0}</p></div></div>
      <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs text-cyan-100">Browsing history is not persisted. Saved listings/searches exist only after explicit user action. Email, SMS and push delivery are not available yet; requested preferences do not imply delivery.</div>
      <div className="mt-4 flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{tabs.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view===id?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>{label}</button>)}</div>
    </div>

    {view==='saved'&&<div className="grid gap-3 md:grid-cols-2">{saved.map((x:any)=><article key={x.saved.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase text-slate-500">{x.availability}</p><h3 className="mt-1 font-bold">{x.listing?.title||'Listing no longer discoverable'}</h3>{x.listing&&<p className="mt-1 text-xs text-slate-400">{money(x.listing.price_minor,x.listing.currency)} • {x.listing.inventory_status.replaceAll('_',' ')}</p>}</div><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/saved-listings/'+x.saved.id,'DELETE')} className="h-fit rounded border border-rose-900 p-2 text-rose-300"><Trash2 className="h-4 w-4"/></button></div><div className="mt-3 flex flex-wrap gap-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={x.saved.price_drop_alert_enabled} onChange={e=>void call('/api/v1/marketplace/saved-listings/'+x.saved.id,'PATCH',{price_drop_alert_enabled:e.target.checked})}/>Price drops</label><label className="flex items-center gap-2"><input type="checkbox" checked={x.saved.restock_alert_enabled} onChange={e=>void call('/api/v1/marketplace/saved-listings/'+x.saved.id,'PATCH',{restock_alert_enabled:e.target.checked})}/>Restock</label></div><p className="mt-3 text-[10px] text-slate-500">Saved at {money(x.saved.price_minor_at_save,x.listing?.currency||'KES')} • baseline inventory {x.saved.inventory_status_at_save.replaceAll('_',' ')}</p></article>)}</div>}

    {view==='searches'&&<div className="space-y-3">{searches.map((x:any)=><article key={x.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2"><Search className="h-4 w-4"/><h3 className="font-bold">{x.name}</h3></div><p className="mt-2 text-xs text-slate-400">{Object.entries(x.criteria||{}).map(([k,v])=>k+'='+String(v)).join(' • ')||'Broad marketplace search'}{x.vehicle_id?' • vehicle-aware':''}</p></div><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/saved-searches/'+x.id,'DELETE')} className="h-fit rounded border border-rose-900 p-2 text-rose-300"><Trash2 className="h-4 w-4"/></button></div><div className="mt-3 flex gap-3 text-xs"><label className="flex items-center gap-2"><input type="checkbox" checked={x.status==='ACTIVE'} onChange={e=>void call('/api/v1/marketplace/saved-searches/'+x.id,'PATCH',{status:e.target.checked?'ACTIVE':'PAUSED'})}/>Active</label><label className="flex items-center gap-2"><input type="checkbox" checked={x.new_match_alert_enabled} onChange={e=>void call('/api/v1/marketplace/saved-searches/'+x.id,'PATCH',{new_match_alert_enabled:e.target.checked})}/>New-match alerts</label></div></article>)}</div>}

    {view==='alerts'&&<div className="space-y-3">{alerts.length?alerts.map((x:any)=><article key={x.id} className={'rounded-xl border p-4 '+(x.state==='UNREAD'?'border-cyan-700/40 bg-cyan-950/10':'border-slate-800 bg-slate-900/40')}><div className="flex flex-wrap justify-between gap-3"><div><div className="flex items-center gap-2">{x.state==='UNREAD'?<Bell className="h-4 w-4 text-cyan-300"/>:<BellOff className="h-4 w-4 text-slate-500"/>}<h3 className="font-bold">{x.title}</h3></div><p className="mt-2 text-xs text-slate-300">{x.body}</p><p className="mt-2 text-[10px] uppercase text-slate-500">{x.alert_type.replaceAll('_',' ')} • {x.created_at}</p></div><div className="flex gap-2">{x.state==='UNREAD'&&<button disabled={busy} onClick={()=>void call('/api/v1/marketplace/alerts/'+x.id,'PATCH',{state:'READ'})} className="h-fit rounded border border-cyan-800 px-3 py-1 text-xs text-cyan-200">Mark read</button>}{x.state!=='DISMISSED'&&<button disabled={busy} onClick={()=>void call('/api/v1/marketplace/alerts/'+x.id,'PATCH',{state:'DISMISSED'})} className="h-fit rounded border border-slate-700 px-3 py-1 text-xs">Dismiss</button>}</div></div></article>):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No alerts yet.</p>}</div>}

    {view==='preferences'&&prefs&&<div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="grid gap-3 md:grid-cols-2"><label className="flex items-center justify-between rounded border border-slate-800 p-3 text-sm">In-app alerts <input type="checkbox" checked={prefs.in_app_enabled} onChange={e=>setPrefs((p:any)=>({...p,in_app_enabled:e.target.checked}))}/></label><label className="flex items-center justify-between rounded border border-slate-800 p-3 text-sm">Email requested <input type="checkbox" checked={prefs.email_requested} onChange={e=>setPrefs((p:any)=>({...p,email_requested:e.target.checked}))}/></label><label className="flex items-center justify-between rounded border border-slate-800 p-3 text-sm">SMS requested <input type="checkbox" checked={prefs.sms_requested} onChange={e=>setPrefs((p:any)=>({...p,sms_requested:e.target.checked}))}/></label><label className="flex items-center justify-between rounded border border-slate-800 p-3 text-sm">Push requested <input type="checkbox" checked={prefs.push_requested} onChange={e=>setPrefs((p:any)=>({...p,push_requested:e.target.checked}))}/></label></div><div className="grid gap-3 md:grid-cols-3"><label className="text-xs text-slate-400">Daily in-app cap<input type="number" min="1" max="50" value={prefs.max_alerts_per_day} onChange={e=>setPrefs((p:any)=>({...p,max_alerts_per_day:Number(e.target.value)}))} className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"/></label><label className="text-xs text-slate-400">Future delivery quiet start<input value={prefs.quiet_hours_start||''} onChange={e=>setPrefs((p:any)=>({...p,quiet_hours_start:e.target.value}))} placeholder="22:00" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"/></label><label className="text-xs text-slate-400">Future delivery quiet end<input value={prefs.quiet_hours_end||''} onChange={e=>setPrefs((p:any)=>({...p,quiet_hours_end:e.target.value}))} placeholder="07:00" className="mt-1 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2"/></label></div><div className="rounded border border-amber-700/30 bg-amber-950/10 p-3 text-xs text-amber-100">Delivery availability: in-app {String(delivery?.in_app)} • email {String(delivery?.email)} • SMS {String(delivery?.sms)} • push {String(delivery?.push)}. External selections are preferences only until adapters exist.</div><button disabled={busy} onClick={()=>void savePrefs()} className="rounded bg-emerald-600 px-4 py-2 text-xs font-semibold">Save preferences</button></div>}

    {view==='seller'&&sellerMemberships.length>0&&<div className="space-y-4"><div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Store className="h-4 w-4"/><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void loadSeller()} className="rounded border border-slate-700 p-2"><RefreshCw className="h-4 w-4"/></button></div>{sellerStats&&<><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">Total saves across listings</p><p className="mt-1 text-2xl font-bold">{sellerStats.total_saved_instances}</p><p className="mt-1 text-xs text-slate-500">Aggregate only. Saver identities are never exposed.</p></div><div className="space-y-2">{sellerStats.listings.map((x:any)=><div key={x.listing_id} className="flex justify-between rounded border border-slate-800 p-3 text-xs"><span>{x.title} • {x.status}</span><b>{x.saved_count} save(s)</b></div>)}</div></>}</div>}
  </section>;
};
