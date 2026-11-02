import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BarChart3, CircleDollarSign, PackageCheck, RefreshCw, ShieldCheck, Store, TriangleAlert } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};
const pct=(v:number|null)=>v===null?'—':v.toFixed(2)+'%';

export const BentoMarketplaceAnalytics:React.FC<Props>=({actor,onNotify})=>{
  const isAdmin=Boolean(actor?.platform_roles?.includes('PLATFORM_ADMIN'));
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const today=new Date().toISOString().slice(0,10);
  const initialFrom=new Date(Date.now()-29*86400000).toISOString().slice(0,10);
  const [view,setView]=useState<'seller'|'platform'>(isAdmin&&!sellerMemberships.length?'platform':'seller');
  const [from,setFrom]=useState(initialFrom);
  const [to,setTo]=useState(today);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [seller,setSeller]=useState<any>(null);
  const [platform,setPlatform]=useState<any>(null);
  const [busy,setBusy]=useState(false);

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
    if(!storeId)return;
    setBusy(true);
    try{
      const q=new URLSearchParams({from,to});
      const r=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/analytics?'+q.toString());
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Failed to load seller analytics');
      setSeller(j.data||j);
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  },[storeId,from,to,onNotify]);

  const loadPlatform=useCallback(async()=>{
    if(!isAdmin)return;
    setBusy(true);
    try{
      const q=new URLSearchParams({from,to});
      const r=await fetch('/api/v1/marketplace/admin/analytics?'+q.toString());
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Failed to load platform analytics');
      setPlatform(j.data||j);
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  },[isAdmin,from,to,onNotify]);

  useEffect(()=>{if(view==='seller'&&storeId)void loadSeller();},[view,storeId,loadSeller]);
  useEffect(()=>{if(view==='platform'&&isAdmin)void loadPlatform();},[view,isAdmin,loadPlatform]);

  function dateControls(refresh:()=>void){
    return <div className="flex flex-wrap items-end gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <label className="text-[10px] uppercase text-slate-500">From<input type="date" value={from} onChange={e=>setFrom(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"/></label>
      <label className="text-[10px] uppercase text-slate-500">To<input type="date" value={to} onChange={e=>setTo(e.target.value)} className="mt-1 block rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200"/></label>
      <button disabled={busy} onClick={refresh} className="flex items-center gap-2 rounded border border-cyan-700 px-3 py-2 text-xs text-cyan-200"><RefreshCw className="h-4 w-4"/>Refresh</button>
      <span className="text-[10px] text-slate-500">Analytics windows use UTC.</span>
    </div>;
  }

  function moneyCards(rows:any[]){
    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.length?rows.map((m:any)=><div key={m.currency} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex items-center gap-2"><CircleDollarSign className="h-4 w-4 text-emerald-300"/><b>{m.currency}</b></div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-xs"><div><p className="text-[10px] uppercase text-slate-500">Captured</p><p className="font-bold">{money(m.captured_gross_minor,m.currency)}</p></div><div><p className="text-[10px] uppercase text-slate-500">Refunded</p><p className="font-bold">{money(m.refunded_minor,m.currency)}</p></div><div><p className="text-[10px] uppercase text-slate-500">Net receivable</p><p className="font-bold">{money(m.net_seller_receivable_minor,m.currency)}</p></div></div>
      <p className="mt-3 text-[10px] text-slate-500">Settlement ledger • {m.captured_order_count} captured order(s) • receivable is not payout</p>
    </div>):<p className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">No settlement-ledger activity in this period.</p>}</div>;
  }

  function daily(data:any[]){
    const max=Math.max(1,...data.map((x:any)=>x.orders_placed+x.captured_orders+x.completed_fulfillments));
    return <div className="space-y-2">{data.length?data.slice(-31).map((x:any)=><div key={x.date} className="grid grid-cols-[90px_1fr_auto] items-center gap-3 text-xs"><span className="text-slate-500">{x.date}</span><div className="h-2 overflow-hidden rounded bg-slate-800"><div className="h-full bg-emerald-600" style={{width:Math.min(100,((x.orders_placed+x.captured_orders+x.completed_fulfillments)/max)*100)+'%'}}/></div><span className="text-slate-400">orders {x.orders_placed} • paid {x.captured_orders} • completed {x.completed_fulfillments}</span></div>):<p className="text-sm text-slate-500">No daily activity in this window.</p>}</div>;
  }

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><BarChart3 className="h-4 w-4"/>Sprint 30</div><h2 className="mt-2 text-2xl font-bold">Marketplace Operations Analytics & Seller Performance</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Explainable operating facts across orders, provider-authoritative money, fulfillment, returns, trust, inventory and engagement.</p></div><div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{sellerMemberships.length>0&&<button onClick={()=>setView('seller')} className={'rounded-lg px-3 py-2 text-xs '+(view==='seller'?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>Seller</button>}{isAdmin&&<button onClick={()=>setView('platform')} className={'rounded-lg px-3 py-2 text-xs '+(view==='platform'?'bg-violet-500/15 text-violet-200':'text-slate-400')}>Platform</button>}</div></div>
      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100">No opaque seller score. Order totals are not revenue. Money comes only from the settlement ledger, seller receivable is not payout, disputes are context rather than guilt, and buyer identities are not exposed.</div>
    </div>

    {view==='seller'&&sellerMemberships.length>0&&<div className="space-y-6">
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Store className="h-4 w-4"/><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></div>
      {dateControls(()=>void loadSeller())}
      {seller&&<>
        <div><h3 className="mb-3 font-bold">Settlement-ledger money</h3>{moneyCards(seller.money||[])}</div>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[
          ['Orders',seller.funnel.orders_placed],['Captured',seller.funnel.captured_orders],['Completed',seller.funnel.buyer_confirmed_completed],
          ['Paid buyers',seller.funnel.distinct_paid_buyers],['Repeat buyers',seller.funnel.repeat_paid_buyers],['Current saves',seller.engagement.current_saved_instances]
        ].map(([l,v])=><div key={String(l)} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">{l}</p><p className="mt-1 text-xl font-bold">{v}</p></div>)}</div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Cohort funnel</h3><div className="mt-4 grid grid-cols-3 gap-3 text-center"><div><p className="text-xl font-bold">{pct(seller.funnel.cohort_rates.cart_to_order_percent)}</p><p className="text-[10px] text-slate-500">cart → order</p></div><div><p className="text-xl font-bold">{pct(seller.funnel.cohort_rates.order_to_captured_percent)}</p><p className="text-[10px] text-slate-500">order → captured</p></div><div><p className="text-xl font-bold">{pct(seller.funnel.cohort_rates.captured_to_completed_percent)}</p><p className="text-[10px] text-slate-500">captured → completed</p></div></div><p className="mt-4 text-[10px] text-slate-500">Cohorts start from carts/orders created in the selected period; later authoritative outcomes are evaluated as of now.</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><PackageCheck className="h-4 w-4"/><h3 className="font-bold">Fulfillment & returns</h3></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div>Completed <b className="float-right">{seller.fulfillment.completed_fulfillments}</b></div><div>Avg capture→complete <b className="float-right">{seller.fulfillment.average_capture_to_completion_hours===null?'—':seller.fulfillment.average_capture_to_completion_hours+'h'}</b></div><div>Return requests <b className="float-right">{seller.fulfillment.return_requests}</b></div><div>Completed returns <b className="float-right">{seller.fulfillment.completed_returns}</b></div><div>Received units <b className="float-right">{seller.fulfillment.physically_received_return_units}</b></div><div>Restocked units <b className="float-right">{seller.fulfillment.restocked_return_units}</b></div></div></div>
        </div>
        <div className="rounded-xl border border-amber-800/30 bg-amber-950/10 p-5"><div className="flex items-center gap-2"><TriangleAlert className="h-4 w-4 text-amber-300"/><h3 className="font-bold">Current operational attention</h3></div><div className="mt-4 grid gap-2 md:grid-cols-2">{seller.operations.attention_items.map((x:any)=><div key={x.key} className="rounded border border-amber-900/30 p-3 text-xs"><div className="flex justify-between"><b>{x.key.replaceAll('_',' ')}</b><span>{x.count}</span></div><p className="mt-1 text-slate-500">{x.explanation}</p></div>)}</div></div>
        <div className="grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4"/><h3 className="font-bold">Trust facts</h3></div><div className="mt-4 grid grid-cols-2 gap-3 text-xs"><div>Published verified reviews <b className="float-right">{seller.trust.published_verified_review_count}</b></div><div>Average rating <b className="float-right">{seller.trust.average_published_verified_rating??'—'}</b></div><div>Disputes opened <b className="float-right">{seller.trust.total_disputes}</b></div><div>Open disputes <b className="float-right">{seller.trust.open_disputes}</b></div></div><p className="mt-3 text-[10px] text-slate-500">Dispute counts are operational context, not a guilt or seller-quality score.</p></div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Activity className="h-4 w-4"/><h3 className="font-bold">Daily operating activity</h3></div><div className="mt-4">{daily(seller.daily||[])}</div></div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Listing performance</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[780px] text-left text-xs"><thead className="text-slate-500"><tr><th className="pb-2">Listing</th><th>Inventory</th><th>Paid orders</th><th>Paid units</th><th>Current saves</th><th>Verified rating</th></tr></thead><tbody>{seller.top_listings.map((x:any)=><tr key={x.listing_id} className="border-t border-slate-800"><td className="py-3"><b>{x.title}</b><p className="text-[10px] text-slate-500">{x.seller_sku}</p></td><td>{x.inventory_status.replaceAll('_',' ')}</td><td>{x.captured_order_count}</td><td>{x.captured_units}</td><td>{x.current_saved_count}</td><td>{x.average_published_verified_rating===null?'—':x.average_published_verified_rating+' ('+x.published_verified_review_count+')'}</td></tr>)}</tbody></table></div><p className="mt-3 text-[10px] text-slate-500">Listing gross is based only on orders with authoritative capture; net refunds are kept at settlement-ledger/store level because arbitrary refund allocation to products would be misleading.</p></div>
      </>}
    </div>}

    {view==='platform'&&isAdmin&&<div className="space-y-6">
      {dateControls(()=>void loadPlatform())}
      {platform&&<>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">{[
          ['Stores',platform.stores_total],['Active stores',platform.active_stores],['Orders',platform.orders_placed],
          ['Captured',platform.captured_orders],['Completed',platform.completed_fulfillments],['Verified reviews',platform.published_verified_reviews]
        ].map(([l,v])=><div key={String(l)} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">{l}</p><p className="mt-1 text-xl font-bold">{v}</p></div>)}</div>
        <div><h3 className="mb-3 font-bold">Platform settlement-ledger money</h3>{moneyCards(platform.money||[])}</div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Store operations</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="text-slate-500"><tr><th className="pb-2">Store</th><th>Status</th><th>Orders</th><th>Captured</th><th>Completed</th><th>Open returns</th><th>Open disputes</th></tr></thead><tbody>{platform.store_performance.map((x:any)=><tr key={x.store_id} className="border-t border-slate-800"><td className="py-3 font-semibold">{x.display_name}</td><td>{x.status}</td><td>{x.orders_placed}</td><td>{x.captured_orders}</td><td>{x.completed_fulfillments}</td><td>{x.open_returns}</td><td>{x.open_disputes}</td></tr>)}</tbody></table></div><p className="mt-3 text-[10px] text-slate-500">No platform seller ranking is produced. Open returns/disputes are workload facts, not punitive quality scores.</p></div>
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Daily platform activity</h3><div className="mt-4">{daily(platform.daily||[])}</div></div>
      </>}
    </div>}
  </section>;
};
