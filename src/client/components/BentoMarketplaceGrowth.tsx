import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Lightbulb, RefreshCw, Repeat2, Store, TrendingUp, Users } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const pct=(v:number|null)=>v===null?'—':v.toFixed(2)+'%';
const delta=(v:number|null)=>v===null?'—':(v>0?'+':'')+v.toFixed(2)+'%';

export const BentoMarketplaceGrowth:React.FC<Props>=({actor,onNotify})=>{
  const isAdmin=Boolean(actor?.platform_roles?.includes('PLATFORM_ADMIN'));
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const today=new Date().toISOString().slice(0,10);
  const defaultFrom=new Date(Date.now()-89*86400000).toISOString().slice(0,10);
  const [view,setView]=useState<'seller'|'platform'>(isAdmin&&!sellerMemberships.length?'platform':'seller');
  const [from,setFrom]=useState(defaultFrom),[to,setTo]=useState(today);
  const [organizationId,setOrganizationId]=useState(''),[stores,setStores]=useState<any[]>([]),[storeId,setStoreId]=useState('');
  const [seller,setSeller]=useState<any>(null),[platform,setPlatform]=useState<any>(null),[busy,setBusy]=useState(false);

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);
  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;
    const j=await r.json(),list=(j.data||j).stores||[];
    setStores(list);setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{void loadStores();},[loadStores]);

  const loadSeller=useCallback(async()=>{
    if(!storeId)return;setBusy(true);
    try{const q=new URLSearchParams({from,to});const r=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/growth?'+q);
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Failed to load seller growth intelligence');setSeller(j.data||j);
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  },[storeId,from,to,onNotify]);
  const loadPlatform=useCallback(async()=>{
    if(!isAdmin)return;setBusy(true);
    try{const q=new URLSearchParams({from,to});const r=await fetch('/api/v1/marketplace/admin/growth?'+q);
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Failed to load platform growth intelligence');setPlatform(j.data||j);
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  },[isAdmin,from,to,onNotify]);
  useEffect(()=>{if(view==='seller'&&storeId)void loadSeller();},[view,storeId,loadSeller]);
  useEffect(()=>{if(view==='platform'&&isAdmin)void loadPlatform();},[view,isAdmin,loadPlatform]);

  const controls=(refresh:()=>void)=><div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
    <label className="text-[10px] uppercase text-slate-500">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></label>
    <label className="text-[10px] uppercase text-slate-500">To<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></label>
    <button disabled={busy} onClick={refresh} className="flex items-center gap-2 rounded border border-emerald-700 px-3 py-2 text-xs text-emerald-200"><RefreshCw className="h-4 w-4"/>Refresh</button>
    <span className="text-[10px] text-slate-500">Compared with the immediately preceding equal-length UTC period.</span>
  </div>;

  const growthCards=(g:any)=><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{[
    ['Captured orders',g.current.captured_orders,g.change.captured_orders_percent],
    ['Paid buyers',g.current.distinct_paid_buyers,g.change.distinct_paid_buyers_percent],
    ['New paid buyers',g.current.new_paid_buyers,g.change.new_paid_buyers_percent],
    ['Returning paid buyers',g.current.returning_paid_buyers,g.change.returning_paid_buyers_percent],
  ].map(([label,value,change])=><div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
    <p className="text-[10px] uppercase text-slate-500">{label}</p><div className="mt-1 flex items-end justify-between gap-3"><p className="text-2xl font-bold">{value}</p>
    <span className={'flex items-center gap-1 text-xs '+(typeof change==='number'&&change>0?'text-emerald-300':typeof change==='number'&&change<0?'text-rose-300':'text-slate-500')}>{typeof change==='number'&&change>0?<ArrowUpRight className="h-3 w-3"/>:typeof change==='number'&&change<0?<ArrowDownRight className="h-3 w-3"/>:null}{delta(change as number|null)}</span></div></div>)}</div>;

  const retention=(r:any)=><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Repeat2 className="h-4 w-4 text-cyan-300"/><h3 className="font-bold">Repeat-purchase cohorts</h3></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-lg bg-slate-950/60 p-4"><p className="text-[10px] uppercase text-slate-500">30-day mature cohort</p><p className="mt-1 text-xl font-bold">{pct(r.repeat_30d_percent)}</p><p className="text-[10px] text-slate-500">{r.repeated_within_30d} repeat / {r.eligible_30d} eligible</p></div><div className="rounded-lg bg-slate-950/60 p-4"><p className="text-[10px] uppercase text-slate-500">90-day mature cohort</p><p className="mt-1 text-xl font-bold">{pct(r.repeat_90d_percent)}</p><p className="text-[10px] text-slate-500">{r.repeated_within_90d} repeat / {r.eligible_90d} eligible</p></div></div>
    <p className="mt-3 text-[10px] text-slate-500">Only buyers old enough for the measurement window are eligible. This is repeat purchase, not subscription retention, and no churn is inferred.</p>
    <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-xs"><thead className="text-slate-500"><tr><th>Cohort</th><th>First-time buyers</th><th>30d repeat</th><th>90d repeat</th></tr></thead><tbody>{r.cohorts.map((c:any)=><tr key={c.cohort_month} className="border-t border-slate-800"><td className="py-3">{c.cohort_month}</td><td>{c.first_time_paid_buyers}</td><td>{pct(c.repeat_30d_percent)} <span className="text-slate-600">({c.repeated_within_30d}/{c.eligible_30d})</span></td><td>{pct(c.repeat_90d_percent)} <span className="text-slate-600">({c.repeated_within_90d}/{c.eligible_90d})</span></td></tr>)}</tbody></table></div>
  </div>;

  const categories=(rows:any[])=><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Category demand</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-slate-500"><tr><th>Category</th><th>Paid orders</th><th>Paid units</th><th>Current saves</th><th>Published supply</th><th>Saved + out of stock</th></tr></thead><tbody>{rows.map((x:any)=><tr key={x.category_code} className="border-t border-slate-800"><td className="py-3"><b>{x.category_name}</b><p className="text-[10px] text-slate-600">{x.category_code}</p></td><td>{x.captured_orders}</td><td>{x.captured_units}</td><td>{x.current_saved_instances}</td><td>{x.active_published_listings}</td><td>{x.out_of_stock_saved_instances}</td></tr>)}</tbody></table></div><p className="mt-3 text-[10px] text-slate-500">Demand combines provider-confirmed captures with explicit current saves only; browsing/search activity is not used.</p></div>;

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><TrendingUp className="h-4 w-4"/>Sprint 31</div><h2 className="mt-2 text-2xl font-bold">Marketplace Growth, Retention & Seller Intelligence</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Commercial growth and repeat-purchase intelligence from settlement captures plus explicit saved demand.</p></div><div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{sellerMemberships.length>0&&<button onClick={()=>setView('seller')} className={'rounded-lg px-3 py-2 text-xs '+(view==='seller'?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>Seller</button>}{isAdmin&&<button onClick={()=>setView('platform')} className={'rounded-lg px-3 py-2 text-xs '+(view==='platform'?'bg-violet-500/15 text-violet-200':'text-slate-400')}>Platform</button>}</div></div>
      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100">No growth score, churn score, hidden behavioral profile, page-view tracking or search-history profiling. Intelligence is read-only and never auto-discounts, auto-messages buyers or changes inventory/fulfillment.</div>
    </div>

    {view==='seller'&&sellerMemberships.length>0&&<div className="space-y-6"><div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Store className="h-4 w-4"/><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></div>
      {controls(()=>void loadSeller())}
      {seller&&<><div><h3 className="mb-3 font-bold">Commercial growth</h3>{growthCards(seller.growth)}</div>
        <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Users className="h-4 w-4 text-indigo-300"/><p className="mt-2 text-[10px] uppercase text-slate-500">In-period repeat buyers</p><p className="text-2xl font-bold">{seller.growth.current.repeat_paid_buyers_in_period}</p><p className="text-[10px] text-slate-500">{pct(seller.growth.current.repeat_paid_buyer_percent)} of paid buyers</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Activity className="h-4 w-4 text-cyan-300"/><p className="mt-2 text-[10px] uppercase text-slate-500">Current opportunities</p><p className="text-2xl font-bold">{seller.opportunities.length}</p><p className="text-[10px] text-slate-500">Deterministic evidence cards</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Lightbulb className="h-4 w-4 text-amber-300"/><p className="mt-2 text-[10px] uppercase text-slate-500">Automatic actions</p><p className="text-2xl font-bold">0</p><p className="text-[10px] text-slate-500">Seller remains in control</p></div></div>
        {retention(seller.retention)}
        <div className="rounded-xl border border-amber-800/30 bg-amber-950/10 p-5"><div className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-300"/><h3 className="font-bold">Seller opportunities</h3></div><div className="mt-4 grid gap-3 lg:grid-cols-2">{seller.opportunities.length?seller.opportunities.map((o:any,i:number)=><div key={o.type+':'+(o.listing_id||i)} className="rounded-lg border border-amber-900/30 bg-slate-950/30 p-4"><div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-amber-300">{o.type.replaceAll('_',' ')}</p><h4 className="mt-1 font-semibold">{o.title}</h4></div><span className="rounded-full border border-slate-700 px-2 py-1 text-[9px]">{o.priority}</span></div><p className="mt-2 text-xs text-slate-400">{o.explanation}</p><p className="mt-2 text-xs text-slate-300">{o.suggested_action}</p><p className="mt-2 text-[10px] text-slate-600">No automatic action.</p></div>):<p className="text-sm text-slate-500">No deterministic opportunity currently meets the evidence rules.</p>}</div></div>
        {categories(seller.categories)}
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Listing demand signals</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead className="text-slate-500"><tr><th>Listing</th><th>Category</th><th>Inventory</th><th>Paid orders</th><th>Paid units</th><th>Current saves</th><th>Verified reviews</th></tr></thead><tbody>{seller.listing_signals.map((x:any)=><tr key={x.listing_id} className="border-t border-slate-800"><td className="py-3"><b>{x.title}</b><p className="text-[10px] text-slate-600">{x.seller_sku}</p></td><td>{x.category_code}</td><td>{x.inventory_status.replaceAll('_',' ')}</td><td>{x.captured_orders}</td><td>{x.captured_units}</td><td>{x.current_saved_count}</td><td>{x.published_verified_review_count}</td></tr>)}</tbody></table></div></div>
      </>}</div>}

    {view==='platform'&&isAdmin&&<div className="space-y-6">{controls(()=>void loadPlatform())}{platform&&<><div><h3 className="mb-3 font-bold">Marketplace growth</h3>{growthCards(platform.growth)}</div>{retention(platform.retention)}{categories(platform.categories)}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Store growth facts</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="text-slate-500"><tr><th>Store</th><th>Status</th><th>Captured orders</th><th>Paid buyers</th><th>New</th><th>Returning</th><th>30d repeat</th><th>90d repeat</th></tr></thead><tbody>{platform.stores.map((x:any)=><tr key={x.store_id} className="border-t border-slate-800"><td className="py-3 font-semibold">{x.display_name}</td><td>{x.status}</td><td>{x.growth.current.captured_orders}</td><td>{x.growth.current.distinct_paid_buyers}</td><td>{x.growth.current.new_paid_buyers}</td><td>{x.growth.current.returning_paid_buyers}</td><td>{pct(x.retention.repeat_30d_percent)}</td><td>{pct(x.retention.repeat_90d_percent)}</td></tr>)}</tbody></table></div><p className="mt-3 text-[10px] text-slate-500">Rows are not ranked or scored. Platform intelligence is aggregate-only and does not expose buyer identities.</p></div>
    </>}</div>}
  </section>;
};
