import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CreditCard, RefreshCw, ShieldCheck, Store, WalletCards } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};
const idem=(prefix:string)=>prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);

export const BentoMarketplacePayments:React.FC<Props>=({actor,onNotify})=>{
  const financeRole=Boolean(actor?.platform_roles?.some((x:string)=>['PLATFORM_ADMIN','FINANCE_OPERATOR'].includes(x)));
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'buyer'|'seller'|'admin'>('buyer');
  const [orders,setOrders]=useState<any[]>([]);
  const [providers,setProviders]=useState<any[]>([]);
  const [finance,setFinance]=useState<Record<string,any>>({});
  const [selectedProvider,setSelectedProvider]=useState<Record<string,string>>({});
  const [handoffs,setHandoffs]=useState<Record<string,any>>({});
  const [refundAmount,setRefundAmount]=useState<Record<string,string>>({});
  const [refundReason,setRefundReason]=useState<Record<string,string>>({});
  const [busy,setBusy]=useState(false);

  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [settlement,setSettlement]=useState<any>(null);

  const [adminProviders,setAdminProviders]=useState<any[]>([]);
  const [reconciliation,setReconciliation]=useState<any>({events:[],issues:[]});
  const [providerForm,setProviderForm]=useState({provider_key:'',display_name:'',mode:'TEST',webhook_secret_env:'',supports_refunds:true});

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const loadBuyer=useCallback(async()=>{
    const [o,p]=await Promise.all([fetch('/api/v1/marketplace/orders'),fetch('/api/v1/marketplace/payments/providers')]);
    if(o.ok){const j=await o.json();const list=(j.data||j).orders||[];setOrders(list);
      const pairs=await Promise.all(list.map(async(d:any)=>{
        const r=await fetch('/api/v1/marketplace/orders/'+d.order.id+'/finance');
        if(!r.ok)return [d.order.id,null];const x=await r.json();return [d.order.id,x.data||x];
      }));setFinance(Object.fromEntries(pairs));
    }
    if(p.ok){const j=await p.json();const list=(j.data||j).providers||[];setProviders(list);}
  },[]);
  useEffect(()=>{if(view==='buyer')void loadBuyer();},[view,loadBuyer]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json();const list=(j.data||j).stores||[];setStores(list);
    setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadSettlement=useCallback(async()=>{
    if(!storeId){setSettlement(null);return;}
    const r=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/settlement');
    if(!r.ok)return;const j=await r.json();setSettlement(j.data||j);
  },[storeId]);
  useEffect(()=>{if(view==='seller')void loadSettlement();},[view,loadSettlement]);

  const loadAdmin=useCallback(async()=>{
    if(!financeRole)return;
    const [p,r]=await Promise.all([
      fetch('/api/v1/marketplace/admin/payments/providers'),
      fetch('/api/v1/marketplace/admin/payments/reconciliation')
    ]);
    if(p.ok){const j=await p.json();setAdminProviders((j.data||j).providers||[]);}
    if(r.ok){const j=await r.json();setReconciliation(j.data||j);}
  },[financeRole]);
  useEffect(()=>{if(view==='admin')void loadAdmin();},[view,loadAdmin]);

  async function createIntent(order:any){
    const providerKey=selectedProvider[order.id]||providers[0]?.provider_key;
    if(!providerKey){onNotify('No active payment provider is configured.');return;}
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/orders/'+order.id+'/payments/intents',{
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idem('pay')},
        body:JSON.stringify({provider_key:providerKey})
      });
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Could not create payment intent');
      setHandoffs(v=>({...v,[order.id]:j.data||j}));
      onNotify('Payment intent created. Capture will be accepted only from the signed provider webhook.');
      await loadBuyer();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function requestRefund(order:any,available:number){
    const amount=Math.round(Number(refundAmount[order.id]||0)*100);
    if(!amount||amount>available){onNotify('Enter a valid refund amount within the refundable balance.');return;}
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/orders/'+order.id+'/refunds',{
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idem('refund')},
        body:JSON.stringify({amount_minor:amount,reason:refundReason[order.id]||'Buyer refund request'})
      });
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Refund request failed');
      onNotify('Refund requested. Financial reversal waits for verified provider confirmation.');
      await loadBuyer();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function createProvider(){
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/admin/payments/providers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(providerForm)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Provider creation failed');
      setProviderForm({provider_key:'',display_name:'',mode:'TEST',webhook_secret_env:'',supports_refunds:true});
      onNotify('Provider registered. Configure the named webhook secret in the runtime environment before accepting callbacks.');
      await loadAdmin();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  const nav:Array<['buyer'|'seller'|'admin',string]>=[['buyer','Buyer Payments'],['seller','Seller Settlement']];
  if(financeRole)nav.push(['admin','Finance Ops']);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><CreditCard className="h-4 w-4"/>Sprint 25</div><h2 className="mt-2 text-2xl font-bold">Marketplace Payments & Settlement</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Provider-authoritative capture, signed/idempotent webhooks, refunds, inventory commitment and seller receivable accounting.</p></div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{nav.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view===id?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>{label}</button>)}</div>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100"><ShieldCheck className="h-4 w-4 shrink-0 text-cyan-300"/><p>A browser request cannot mark an order paid. Capture/refund truth changes only after an HMAC-verified provider event. Seller payout remains unavailable until a payout rail is implemented.</p></div>
    </div>

    {view==='buyer'&&<div className="space-y-4">{orders.length?orders.map((detail:any)=>{
      const f=finance[detail.order.id]?.financial||detail.financial||{};
      const refundable=Math.max(0,Number(f.captured_minor||0)-Number(f.refunded_minor||0));
      const handoff=handoffs[detail.order.id];
      return <article key={detail.order.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap justify-between gap-4"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{detail.order.order_number}</p><h3 className="mt-1 font-bold">{String(f.commercial_status||'AWAITING_PAYMENT').replaceAll('_',' ')}</h3><p className="mt-1 text-xs text-slate-400">Captured {money(f.captured_minor||0,detail.order.currency)} • Refunded {money(f.refunded_minor||0,detail.order.currency)}</p></div><p className="text-lg font-bold">{money(detail.order.total_minor,detail.order.currency)}</p></div>
        {f.payment_available&&<div className="mt-4 flex flex-wrap gap-2"><select value={selectedProvider[detail.order.id]||providers[0]?.provider_key||''} onChange={e=>setSelectedProvider(v=>({...v,[detail.order.id]:e.target.value}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{providers.map(p=><option key={p.provider_key} value={p.provider_key}>{p.display_name} • {p.mode}</option>)}</select><button disabled={busy||!providers.length} onClick={()=>void createIntent(detail.order)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold disabled:opacity-40">Create payment intent</button></div>}
        {handoff&&<div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-100"><b>External provider handoff required.</b><br/>Client reference: {handoff.intent?.client_reference}. Garage OS is waiting for the signed provider callback; this screen cannot self-confirm payment.</div>}
        {refundable>0&&finance[detail.order.id]?.refunds!==undefined&&<div className="mt-4 border-t border-slate-800 pt-4"><p className="text-xs font-semibold">Refundable balance: {money(refundable,detail.order.currency)}</p><div className="mt-2 flex flex-wrap gap-2"><input type="number" min="0" step="0.01" value={refundAmount[detail.order.id]||''} onChange={e=>setRefundAmount(v=>({...v,[detail.order.id]:e.target.value}))} placeholder="Refund amount" className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={refundReason[detail.order.id]||''} onChange={e=>setRefundReason(v=>({...v,[detail.order.id]:e.target.value}))} placeholder="Reason" className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy} onClick={()=>void requestRefund(detail.order,refundable)} className="rounded-lg border border-rose-800 px-3 py-2 text-xs text-rose-300">Request refund</button></div></div>}
      </article>;
    }):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No marketplace orders.</p>}</div>}

    {view==='seller'&&<div className="space-y-4"><div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Organization</option>{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void loadSettlement()} className="rounded-lg border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button></div>
      {settlement&&<><div className="grid gap-3 md:grid-cols-3">{(settlement.summaries||[]).map((s:any)=><div key={s.currency} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">{s.currency}</p><p className="mt-2 text-lg font-bold">{money(s.net_receivable_minor,s.currency)}</p><p className="mt-1 text-xs text-slate-400">Gross {money(s.gross_captured_minor,s.currency)} • Refunds {money(s.refunds_minor,s.currency)}</p></div>)}</div><div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-100"><WalletCards className="mr-2 inline h-4 w-4"/>Receivable ledger is authoritative. Actual seller payout/transfer is not yet available.</div></>}</div>}

    {view==='admin'&&financeRole&&<div className="space-y-5"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Store className="h-4 w-4"/><h3 className="font-bold">Payment Provider Registry</h3></div><div className="mt-4 grid gap-2 md:grid-cols-2"><input value={providerForm.provider_key} onChange={e=>setProviderForm(v=>({...v,provider_key:e.target.value}))} placeholder="Provider key e.g. SASAPAY" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={providerForm.display_name} onChange={e=>setProviderForm(v=>({...v,display_name:e.target.value}))} placeholder="Display name" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={providerForm.webhook_secret_env} onChange={e=>setProviderForm(v=>({...v,webhook_secret_env:e.target.value}))} placeholder="Webhook secret ENV name" className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><select value={providerForm.mode} onChange={e=>setProviderForm(v=>({...v,mode:e.target.value}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option>TEST</option><option>LIVE</option></select></div><label className="mt-3 flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={providerForm.supports_refunds} onChange={e=>setProviderForm(v=>({...v,supports_refunds:e.target.checked}))}/>Provider supports refunds</label><button disabled={busy} onClick={()=>void createProvider()} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold">Register provider</button><div className="mt-4 space-y-2">{adminProviders.map(p=><div key={p.id} className="flex justify-between rounded-lg border border-slate-800 p-3 text-xs"><span>{p.display_name} • {p.provider_key}</span><span className="text-slate-400">{p.mode} • {p.status}</span></div>)}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Reconciliation</h3><p className="mt-1 text-xs text-slate-500">{reconciliation.issues?.length||0} open/recorded issues • {reconciliation.events?.length||0} recent verified provider events</p><div className="mt-3 space-y-2">{(reconciliation.issues||[]).slice(0,20).map((x:any)=><div key={x.id} className="rounded-lg border border-rose-900/40 bg-rose-950/20 p-3 text-xs"><b>{x.issue_type}</b><p className="mt-1 text-slate-400">{x.details}</p></div>)}</div></div>
    </div>}
  </section>;
};
