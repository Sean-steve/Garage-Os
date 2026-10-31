import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, PackageCheck, RefreshCw, RotateCcw, Store, Truck } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const idem=(prefix:string)=>prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,9);

export const BentoMarketplaceFulfillment:React.FC<Props>=({actor,onNotify})=>{
  const [view,setView]=useState<'buyer'|'seller'>('buyer');
  const [busy,setBusy]=useState(false);
  const [buyerFulfillments,setBuyerFulfillments]=useState<any[]>([]);
  const [buyerOrders,setBuyerOrders]=useState<any[]>([]);
  const [returnForms,setReturnForms]=useState<Record<string,{reason:string;qtys:Record<string,number>}>>({});
  const [returnTracking,setReturnTracking]=useState<Record<string,string>>({});

  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerOrders,setSellerOrders]=useState<any[]>([]);
  const [sellerFulfillments,setSellerFulfillments]=useState<any[]>([]);
  const [sellerReturns,setSellerReturns]=useState<any[]>([]);
  const [carrier,setCarrier]=useState<Record<string,string>>({});
  const [tracking,setTracking]=useState<Record<string,string>>({});
  const [proof,setProof]=useState<Record<string,string>>({});

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const loadBuyer=useCallback(async()=>{
    const [f,o]=await Promise.all([fetch('/api/v1/marketplace/fulfillments'),fetch('/api/v1/marketplace/orders')]);
    if(f.ok){const j=await f.json();setBuyerFulfillments((j.data||j).fulfillments||[]);}
    if(o.ok){const j=await o.json();setBuyerOrders((j.data||j).orders||[]);}
  },[]);
  useEffect(()=>{if(view==='buyer')void loadBuyer();},[view,loadBuyer]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;
    const j=await r.json();const list=(j.data||j).stores||[];
    setStores(list);setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadSeller=useCallback(async()=>{
    if(!storeId){setSellerOrders([]);setSellerFulfillments([]);setSellerReturns([]);return;}
    const [o,f,r]=await Promise.all([
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/orders'),
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/fulfillments'),
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/returns')
    ]);
    if(o.ok){const j=await o.json();setSellerOrders((j.data||j).orders||[]);}
    if(f.ok){const j=await f.json();setSellerFulfillments((j.data||j).fulfillments||[]);}
    if(r.ok){const j=await r.json();setSellerReturns((j.data||j).returns||[]);}
  },[storeId]);
  useEffect(()=>{if(view==='seller')void loadSeller();},[view,loadSeller]);

  async function call(url:string,body:any={},method='POST'){
    setBusy(true);
    try{
      const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:method==='GET'?undefined:JSON.stringify(body)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Operation failed');
      onNotify('Marketplace fulfillment updated.');
      await Promise.all([loadBuyer(),loadSeller()]);
      return j.data||j;
    }catch(err){onNotify((err as Error).message);return null;}finally{setBusy(false);}
  }

  async function requestReturn(orderId:string){
    const form=returnForms[orderId]||{reason:'',qtys:{}};
    const items=Object.entries(form.qtys).filter(([,q])=>Number(q)>0).map(([order_item_id,q])=>({order_item_id,quantity:Number(q)}));
    if(!form.reason.trim()||!items.length){onNotify('Add a return reason and at least one item quantity.');return;}
    await call('/api/v1/marketplace/orders/'+orderId+'/returns',{reason:form.reason,items});
  }

  async function requestReturnRefund(returnId:string){
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/returns/'+returnId+'/request-refund',{
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idem('return-refund')},body:'{}'
      });
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Refund request failed');
      onNotify('Return refund requested. Provider confirmation is still required.');
      await loadSeller();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  const orderMap=useMemo(()=>Object.fromEntries(buyerOrders.map((x:any)=>[x.order.id,x])),[buyerOrders]);
  const sellerFulfillmentByOrder=useMemo(()=>new Map(sellerFulfillments.map((x:any)=>[x.fulfillment.order_id,x])),[sellerFulfillments]);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><PackageCheck className="h-4 w-4"/>Sprint 26</div><h2 className="mt-2 text-2xl font-bold">Fulfillment, Delivery & Returns</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Paid-order preparation, handoff, seller-recorded delivery, buyer-confirmed receipt, physical return inspection and refund handoff.</p></div>
        <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1"><button onClick={()=>setView('buyer')} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view==='buyer'?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>Buyer</button><button onClick={()=>setView('seller')} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view==='seller'?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>Seller</button></div>
      </div>
      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100">Seller delivery reports are not buyer receipt confirmation. Refunds do not restore stock; only seller-recorded physical receipt with RESTOCKABLE quantities does.</div>
    </div>

    {view==='buyer'&&<div className="space-y-5">{buyerFulfillments.length?buyerFulfillments.map((d:any)=>{
      const f=d.fulfillment;const order=orderMap[f.order_id];const form=returnForms[f.order_id]||{reason:'',qtys:{}};
      return <article key={f.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap justify-between gap-4"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{order?.order?.order_number||f.order_id}</p><h3 className="mt-1 font-bold">{f.status.replaceAll('_',' ')}</h3><p className="mt-1 text-xs text-slate-400">{f.fulfillment_mode.replaceAll('_',' ')}{f.carrier_name?' • '+f.carrier_name:''}{f.tracking_reference?' • '+f.tracking_reference:''}</p></div><span className={'h-fit rounded-full border px-2 py-1 text-[10px] '+(d.truth?.buyer_receipt_confirmed?'border-emerald-500/30 text-emerald-300':'border-amber-500/30 text-amber-300')}>{d.truth?.buyer_receipt_confirmed?'RECEIPT CONFIRMED':'RECEIPT NOT CONFIRMED'}</span></div>
        <div className="mt-4 space-y-2">{(d.events||[]).slice(-5).map((e:any)=><div key={e.id} className="flex justify-between gap-3 rounded-lg border border-slate-800 p-3 text-xs"><span>{e.event_type.replaceAll('_',' ')}</span><span className="text-slate-500">{e.source_type.replaceAll('_',' ')}</span></div>)}</div>
        {((f.fulfillment_mode==='PICKUP'&&f.status==='READY_FOR_HANDOFF')||(['IN_TRANSIT','DELIVERY_REPORTED'].includes(f.status)))&&<button disabled={busy} onClick={()=>void call('/api/v1/marketplace/orders/'+f.order_id+'/fulfillment/confirm-receipt',{note:'Buyer confirmed physical receipt'})} className="mt-4 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold">Confirm receipt</button>}
        {f.status==='COMPLETED'&&order&&<div className="mt-5 border-t border-slate-800 pt-4"><div className="flex items-center gap-2"><RotateCcw className="h-4 w-4"/><h4 className="text-sm font-bold">Request a return</h4></div><input value={form.reason} onChange={e=>setReturnForms(v=>({...v,[f.order_id]:{...form,reason:e.target.value}}))} placeholder="Reason for return" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><div className="mt-2 space-y-2">{(order.items||[]).map((item:any)=><div key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 p-3 text-xs"><span>{item.title} • bought {item.quantity}</span><input type="number" min="0" max={item.quantity} value={form.qtys[item.id]||0} onChange={e=>setReturnForms(v=>({...v,[f.order_id]:{...form,qtys:{...form.qtys,[item.id]:Number(e.target.value)}}}))} className="w-20 rounded border border-slate-700 bg-slate-950 px-2 py-1"/></div>)}</div><button disabled={busy} onClick={()=>void requestReturn(f.order_id)} className="mt-3 rounded-lg border border-rose-800 px-4 py-2 text-xs text-rose-300">Request return</button></div>}
        {(d.returns||[]).map((ret:any)=><div key={ret.return.id} className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{ret.return.return_number}</b><p className="mt-1 text-slate-400">{ret.return.status.replaceAll('_',' ')}</p></div><span>{ret.financial_refund_status||'NO REFUND YET'}</span></div>{ret.return.status==='APPROVED'&&<div className="mt-3 flex gap-2"><input value={returnTracking[ret.return.id]||''} onChange={e=>setReturnTracking(v=>({...v,[ret.return.id]:e.target.value}))} placeholder="Return tracking (optional)" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"/><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/returns/'+ret.return.id+'/ship',{tracking_reference:returnTracking[ret.return.id]||null})} className="rounded border border-cyan-700 px-3 py-1 text-cyan-200">Mark sent</button></div>}</div>)}
      </article>;
    }):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No fulfillment has started yet.</p>}</div>}

    {view==='seller'&&<div className="space-y-5">
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Organization</option>{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void loadSeller()} className="rounded-lg border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button></div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Store className="h-4 w-4"/><h3 className="font-bold">Paid orders ready for fulfillment</h3></div><div className="mt-3 space-y-2">{sellerOrders.filter((o:any)=>o.truth?.seller_fulfillment_available&&!sellerFulfillmentByOrder.has(o.order.id)).map((o:any)=><div key={o.order.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 p-3 text-xs"><div><b>{o.order.order_number}</b><p className="text-slate-500">{o.order.fulfillment_mode.replaceAll('_',' ')}</p></div><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/orders/'+o.order.id+'/fulfillment',{seller_notes:'Fulfillment accepted'})} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold">Start fulfillment</button></div>)}{!sellerOrders.some((o:any)=>o.truth?.seller_fulfillment_available&&!sellerFulfillmentByOrder.has(o.order.id))&&<p className="text-xs text-slate-500">No newly paid orders waiting.</p>}</div></div>

      <div className="space-y-3">{sellerFulfillments.map((d:any)=>{const f=d.fulfillment;return <article key={f.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex flex-wrap justify-between gap-4"><div><h3 className="font-bold">{f.status.replaceAll('_',' ')}</h3><p className="text-xs text-slate-500">{f.order_id} • {f.fulfillment_mode.replaceAll('_',' ')}</p></div><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px]">{d.financial?.commercial_status}</span></div>
        {f.status==='PREPARING'&&<button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/fulfillments/'+f.id+'/ready')} className="mt-3 rounded-lg border border-emerald-700 px-3 py-2 text-xs text-emerald-300">Mark ready</button>}
        {f.status==='READY_FOR_HANDOFF'&&f.fulfillment_mode!=='PICKUP'&&<div className="mt-3 flex flex-wrap gap-2"><input value={carrier[f.id]||''} onChange={e=>setCarrier(v=>({...v,[f.id]:e.target.value}))} placeholder="Carrier / delivery team" className="min-w-[180px] flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={tracking[f.id]||''} onChange={e=>setTracking(v=>({...v,[f.id]:e.target.value}))} placeholder={f.fulfillment_mode==='SHIPPING'?'Tracking required':'Tracking optional'} className="min-w-[180px] flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/fulfillments/'+f.id+'/dispatch',{carrier_name:carrier[f.id],tracking_reference:tracking[f.id]||null})} className="rounded bg-cyan-700 px-3 py-2 text-xs">Dispatch</button></div>}
        {f.status==='IN_TRANSIT'&&<div className="mt-3 flex gap-2"><input value={proof[f.id]||''} onChange={e=>setProof(v=>({...v,[f.id]:e.target.value}))} placeholder="Proof/reference (optional)" className="flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/fulfillments/'+f.id+'/report-delivery',{proof_reference:proof[f.id]||null})} className="rounded border border-cyan-700 px-3 py-2 text-xs text-cyan-200">Report delivered</button></div>}
      </article>})}</div>

      <div className="space-y-3"><h3 className="font-bold">Returns</h3>{sellerReturns.length?sellerReturns.map((d:any)=><article key={d.return.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 text-xs"><div className="flex flex-wrap justify-between gap-3"><div><b>{d.return.return_number}</b><p className="mt-1 text-slate-400">{d.return.reason}</p></div><span>{d.return.status.replaceAll('_',' ')}</span></div>
        {d.return.status==='REQUESTED'&&<div className="mt-3 flex gap-2"><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/returns/'+d.return.id+'/review',{decision:'APPROVE',reason:'Return approved for inspection'})} className="rounded border border-emerald-700 px-3 py-2 text-emerald-300">Approve</button><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/returns/'+d.return.id+'/review',{decision:'REJECT',reason:'Return rejected by seller review'})} className="rounded border border-rose-800 px-3 py-2 text-rose-300">Reject</button></div>}
        {['APPROVED','IN_TRANSIT'].includes(d.return.status)&&<div className="mt-3 flex flex-wrap gap-2"><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/returns/'+d.return.id+'/receive',{items:d.items.map((x:any)=>({return_item_id:x.id,received_quantity:x.requested_quantity,restock_quantity:x.requested_quantity,condition_at_return:'RESTOCKABLE',notes:'Received and inspected as restockable'}))})} className="rounded border border-emerald-700 px-3 py-2 text-emerald-300">Receive & restock all</button><button disabled={busy} onClick={()=>void call('/api/v1/marketplace/seller/stores/'+storeId+'/returns/'+d.return.id+'/receive',{items:d.items.map((x:any)=>({return_item_id:x.id,received_quantity:x.requested_quantity,restock_quantity:0,condition_at_return:'DAMAGED',notes:'Received but not restockable'}))})} className="rounded border border-amber-700 px-3 py-2 text-amber-300">Receive as damaged</button></div>}
        {d.return.status==='RECEIVED'&&<button disabled={busy} onClick={()=>void requestReturnRefund(d.return.id)} className="mt-3 rounded bg-emerald-600 px-3 py-2 font-semibold">Request provider refund</button>}
        {d.return.status==='REFUND_REQUESTED'&&<p className="mt-3 text-amber-300">Physical return is received. Refund awaits provider confirmation.</p>}
        {d.return.status==='COMPLETED'&&<p className="mt-3 text-emerald-300"><CheckCircle2 className="mr-1 inline h-4 w-4"/>Return and refund confirmed.</p>}
      </article>):<p className="text-xs text-slate-500">No returns for this store.</p>}</div>
    </div>}
  </section>;
};
