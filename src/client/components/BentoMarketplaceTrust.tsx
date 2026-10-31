import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, MessageSquare, RefreshCw, ShieldCheck, Star, Store } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const stars=(n:number)=>'★'.repeat(Math.max(0,Math.min(5,Number(n||0))))+'☆'.repeat(Math.max(0,5-Math.min(5,Number(n||0))));

export const BentoMarketplaceTrust:React.FC<Props>=({actor,onNotify})=>{
  const trustOps=Boolean(actor?.platform_roles?.some((x:string)=>['PLATFORM_ADMIN','TRUST_AND_SAFETY'].includes(x)));
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'buyer'|'seller'|'ops'>('buyer');
  const [busy,setBusy]=useState(false);

  const [orders,setOrders]=useState<any[]>([]);
  const [fulfillments,setFulfillments]=useState<any[]>([]);
  const [myReviews,setMyReviews]=useState<any[]>([]);
  const [myDisputes,setMyDisputes]=useState<any[]>([]);
  const [reviewForms,setReviewForms]=useState<Record<string,{rating:number;title:string;body:string;target:string;order_item_id:string}>>({});
  const [disputeForms,setDisputeForms]=useState<Record<string,{category:string;summary:string;outcome:string}>>({});
  const [buyerMessages,setBuyerMessages]=useState<Record<string,string>>({});

  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [storeTrust,setStoreTrust]=useState<any>(null);
  const [sellerDisputes,setSellerDisputes]=useState<any[]>([]);
  const [sellerResponses,setSellerResponses]=useState<Record<string,string>>({});
  const [sellerReports,setSellerReports]=useState<Record<string,string>>({});
  const [sellerMessages,setSellerMessages]=useState<Record<string,string>>({});

  const [moderation,setModeration]=useState<any[]>([]);
  const [opsDisputes,setOpsDisputes]=useState<any[]>([]);
  const [moderationReason,setModerationReason]=useState<Record<string,string>>({});
  const [resolution,setResolution]=useState<Record<string,{action:string;summary:string}>>({});

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const loadBuyer=useCallback(async()=>{
    const [o,f,r,d]=await Promise.all([
      fetch('/api/v1/marketplace/orders'),fetch('/api/v1/marketplace/fulfillments'),
      fetch('/api/v1/marketplace/reviews/me'),fetch('/api/v1/marketplace/disputes/me')
    ]);
    if(o.ok){const j=await o.json();setOrders((j.data||j).orders||[]);}
    if(f.ok){const j=await f.json();setFulfillments((j.data||j).fulfillments||[]);}
    if(r.ok){const j=await r.json();setMyReviews((j.data||j).reviews||[]);}
    if(d.ok){const j=await d.json();setMyDisputes((j.data||j).disputes||[]);}
  },[]);
  useEffect(()=>{if(view==='buyer')void loadBuyer();},[view,loadBuyer]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json();const list=(j.data||j).stores||[];
    setStores(list);setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadSeller=useCallback(async()=>{
    if(!storeId){setStoreTrust(null);setSellerDisputes([]);return;}
    const [t,d]=await Promise.all([
      fetch('/api/v1/marketplace/stores/'+encodeURIComponent(storeId)+'/trust'),
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/disputes')
    ]);
    if(t.ok){const j=await t.json();setStoreTrust(j.data||j);}
    if(d.ok){const j=await d.json();setSellerDisputes((j.data||j).disputes||[]);}
  },[storeId]);
  useEffect(()=>{if(view==='seller')void loadSeller();},[view,loadSeller]);

  const loadOps=useCallback(async()=>{
    if(!trustOps)return;
    const [r,d]=await Promise.all([
      fetch('/api/v1/marketplace/admin/trust/review-reports'),
      fetch('/api/v1/marketplace/admin/trust/disputes')
    ]);
    if(r.ok){const j=await r.json();setModeration((j.data||j).reports||[]);}
    if(d.ok){const j=await d.json();setOpsDisputes((j.data||j).disputes||[]);}
  },[trustOps]);
  useEffect(()=>{if(view==='ops')void loadOps();},[view,loadOps]);

  async function post(url:string,body:any={}){
    setBusy(true);
    try{
      const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Operation failed');
      onNotify('Marketplace trust state updated.');
      await Promise.all([loadBuyer(),loadSeller(),loadOps()]);
      return j.data||j;
    }catch(err){onNotify((err as Error).message);return null;}finally{setBusy(false);}
  }

  async function createReview(order:any){
    const form=reviewForms[order.id]||{rating:5,title:'',body:'',target:'STORE',order_item_id:''};
    const body:any={target_type:form.target,rating:Number(form.rating),title:form.title,body:form.body};
    if(form.target==='PRODUCT')body.order_item_id=form.order_item_id||order.items?.[0]?.id;
    await post('/api/v1/marketplace/orders/'+order.id+'/reviews',body);
  }
  async function openDispute(order:any){
    const form=disputeForms[order.id]||{category:'ITEM_NOT_AS_DESCRIBED',summary:'',outcome:''};
    await post('/api/v1/marketplace/orders/'+order.id+'/disputes',{
      category:form.category,summary:form.summary,requested_outcome:form.outcome||null
    });
  }
  async function sellerRespond(reviewId:string){
    await post('/api/v1/marketplace/seller/stores/'+storeId+'/reviews/'+reviewId+'/respond',{body:sellerResponses[reviewId]||''});
  }
  async function sellerReport(reviewId:string){
    await post('/api/v1/marketplace/seller/stores/'+storeId+'/reviews/'+reviewId+'/report',{reason:sellerReports[reviewId]||''});
  }
  async function moderate(reviewId:string,action:string){
    await post('/api/v1/marketplace/admin/trust/reviews/'+reviewId+'/moderate',{
      action,reason:moderationReason[reviewId]||('Trust & Safety decision: '+action)
    });
  }
  async function resolveDispute(disputeId:string){
    const v=resolution[disputeId]||{action:'NO_ACTION',summary:''};
    await post('/api/v1/marketplace/admin/trust/disputes/'+disputeId+'/resolve',{
      resolution_action:v.action,resolution_summary:v.summary
    });
  }

  const fulfillmentByOrder=useMemo(()=>new Map(fulfillments.map((x:any)=>[x.fulfillment.order_id,x])),[fulfillments]);
  const reviewedStoreOrders=useMemo(()=>new Set(myReviews.filter((x:any)=>x.review?.target_type==='STORE').map((x:any)=>x.review.order_id)),[myReviews]);
  const disputedOrders=useMemo(()=>new Set(myDisputes.filter((x:any)=>!['RESOLVED','CLOSED'].includes(x.dispute?.status)).map((x:any)=>x.dispute.order_id)),[myDisputes]);

  const nav:Array<['buyer'|'seller'|'ops',string]>=[['buyer','Buyer Trust'],['seller','Seller Trust']];
  if(trustOps)nav.push(['ops','Trust & Safety']);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><ShieldCheck className="h-4 w-4"/>Sprint 27</div><h2 className="mt-2 text-2xl font-bold">Marketplace Trust, Reviews & Disputes</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Verified-purchase reviews, seller responses, explainable trust facts and evidence-aware dispute resolution.</p></div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{nav.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view===id?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>{label}</button>)}</div>
      </div>
      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100">Garage OS does not generate an opaque trust score. Review provenance, ratings, completed orders, returns and disputes remain visible as separate facts. A dispute is context—not proof of guilt.</div>
    </div>

    {view==='buyer'&&<div className="space-y-5">
      {orders.map((d:any)=>{const o=d.order;const f=fulfillmentByOrder.get(o.id);const eligible=f&&['COMPLETED','RETURN_IN_PROGRESS','RETURNED'].includes(f.fulfillment.status);const rf=reviewForms[o.id]||{rating:5,title:'',body:'',target:'STORE',order_item_id:d.items?.[0]?.id||''};const df=disputeForms[o.id]||{category:'ITEM_NOT_AS_DESCRIBED',summary:'',outcome:''};return <article key={o.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <div className="flex flex-wrap justify-between gap-4"><div><p className="text-[10px] uppercase text-slate-500">{o.order_number}</p><h3 className="mt-1 font-bold">{f?.fulfillment?.status?.replaceAll('_',' ')||'FULFILLMENT NOT STARTED'}</h3></div><span className="text-xs text-slate-400">{o.currency} {(o.total_minor/100).toFixed(2)}</span></div>
        {eligible&&!reviewedStoreOrders.has(o.id)&&<div className="mt-4 rounded-lg border border-slate-800 p-4"><div className="flex items-center gap-2 text-sm font-bold"><Star className="h-4 w-4"/>Verified-purchase review</div><div className="mt-3 grid gap-2 md:grid-cols-2"><select value={rf.target} onChange={e=>setReviewForms(v=>({...v,[o.id]:{...rf,target:e.target.value}}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option value="STORE">Store experience</option><option value="PRODUCT">Product</option></select><select value={rf.rating} onChange={e=>setReviewForms(v=>({...v,[o.id]:{...rf,rating:Number(e.target.value)}}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{[5,4,3,2,1].map(n=><option key={n} value={n}>{n} / 5</option>)}</select>{rf.target==='PRODUCT'&&<select value={rf.order_item_id} onChange={e=>setReviewForms(v=>({...v,[o.id]:{...rf,order_item_id:e.target.value}}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{d.items.map((x:any)=><option key={x.id} value={x.id}>{x.title}</option>)}</select>}<input value={rf.title} onChange={e=>setReviewForms(v=>({...v,[o.id]:{...rf,title:e.target.value}}))} placeholder="Review title" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></div><textarea value={rf.body} onChange={e=>setReviewForms(v=>({...v,[o.id]:{...rf,body:e.target.value}}))} placeholder="Describe your verified purchase experience" className="mt-2 min-h-20 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy} onClick={()=>void createReview(d)} className="mt-2 rounded bg-emerald-600 px-3 py-2 text-xs font-semibold">Publish verified review</button></div>}
        {!disputedOrders.has(o.id)&&d.truth?.payment_captured&&<div className="mt-4 rounded-lg border border-slate-800 p-4"><div className="flex items-center gap-2 text-sm font-bold"><AlertTriangle className="h-4 w-4"/>Open dispute</div><div className="mt-3 grid gap-2 md:grid-cols-2"><select value={df.category} onChange={e=>setDisputeForms(v=>({...v,[o.id]:{...df,category:e.target.value}}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{['ORDER_NOT_RECEIVED','ITEM_NOT_AS_DESCRIBED','DAMAGED','FITMENT_MISMATCH','PAYMENT_REFUND','RETURN_REFUND','SELLER_CONDUCT','OTHER'].map(x=><option key={x}>{x}</option>)}</select><input value={df.outcome} onChange={e=>setDisputeForms(v=>({...v,[o.id]:{...df,outcome:e.target.value}}))} placeholder="Requested outcome (optional)" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></div><textarea value={df.summary} onChange={e=>setDisputeForms(v=>({...v,[o.id]:{...df,summary:e.target.value}}))} placeholder="Explain the issue and relevant facts" className="mt-2 min-h-20 w-full rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy||!df.summary.trim()} onClick={()=>void openDispute(d)} className="mt-2 rounded border border-amber-700 px-3 py-2 text-xs text-amber-200">Open dispute</button></div>}
      </article>})}
      <div className="space-y-3"><h3 className="font-bold">My disputes</h3>{myDisputes.map((d:any)=><article key={d.dispute.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{d.dispute.dispute_number}</b><p className="mt-1 text-slate-400">{d.dispute.category.replaceAll('_',' ')}</p></div><span>{d.dispute.status.replaceAll('_',' ')}</span></div><div className="mt-3 space-y-2">{d.messages.map((m:any)=><div key={m.id} className="rounded border border-slate-800 p-2"><b>{m.author_role}</b><p className="mt-1 text-slate-300">{m.body}</p></div>)}</div>{!['RESOLVED','CLOSED'].includes(d.dispute.status)&&<div className="mt-3 flex gap-2"><input value={buyerMessages[d.dispute.id]||''} onChange={e=>setBuyerMessages(v=>({...v,[d.dispute.id]:e.target.value}))} placeholder="Add information" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"/><button disabled={busy} onClick={()=>void post('/api/v1/marketplace/disputes/'+d.dispute.id+'/messages',{body:buyerMessages[d.dispute.id]||''})} className="rounded border border-cyan-700 px-3 py-1 text-cyan-200">Send</button></div>}</article>)}</div>
    </div>}

    {view==='seller'&&<div className="space-y-5">
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Organization</option>{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void loadSeller()} className="rounded-lg border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button></div>
      {storeTrust&&<><div className="grid gap-3 md:grid-cols-4"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">Verified reviews</p><p className="mt-2 text-xl font-bold">{storeTrust.summary.verified_review_count}</p><p className="text-xs text-amber-300">{storeTrust.summary.average_rating===null?'No rating':stars(Math.round(storeTrust.summary.average_rating))+' '+storeTrust.summary.average_rating}</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">Completed fulfillment</p><p className="mt-2 text-xl font-bold">{storeTrust.summary.completed_fulfillment_count}</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">Returns</p><p className="mt-2 text-xl font-bold">{storeTrust.summary.return_request_count}</p></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">Disputes</p><p className="mt-2 text-xl font-bold">{storeTrust.summary.dispute_count}</p><p className="text-xs text-slate-500">Context only — not guilt</p></div></div>
        <div className="space-y-3">{storeTrust.reviews.map((x:any)=><article key={x.review.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{stars(x.review.rating)} {x.review.title||'Verified review'}</b><p className="mt-1 text-slate-300">{x.review.body||'No written comment.'}</p></div><span className="text-emerald-300">VERIFIED PURCHASE</span></div>{x.response?<p className="mt-3 rounded border border-slate-800 p-2 text-slate-300"><b>Seller response:</b> {x.response.body}</p>:<div className="mt-3 flex gap-2"><input value={sellerResponses[x.review.id]||''} onChange={e=>setSellerResponses(v=>({...v,[x.review.id]:e.target.value}))} placeholder="Public response" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"/><button disabled={busy} onClick={()=>void sellerRespond(x.review.id)} className="rounded border border-emerald-700 px-3 py-1 text-emerald-300">Respond</button></div>}<div className="mt-2 flex gap-2"><input value={sellerReports[x.review.id]||''} onChange={e=>setSellerReports(v=>({...v,[x.review.id]:e.target.value}))} placeholder="Report reason" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"/><button disabled={busy} onClick={()=>void sellerReport(x.review.id)} className="rounded border border-rose-800 px-3 py-1 text-rose-300">Report</button></div></article>)}</div></>}
      <div className="space-y-3"><h3 className="font-bold">Disputes</h3>{sellerDisputes.map((d:any)=><article key={d.dispute.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{d.dispute.dispute_number}</b><p className="mt-1 text-slate-400">{d.dispute.summary}</p></div><span>{d.dispute.status.replaceAll('_',' ')}</span></div><div className="mt-3 space-y-2">{d.messages.map((m:any)=><div key={m.id} className="rounded border border-slate-800 p-2"><b>{m.author_role}</b><p className="mt-1">{m.body}</p></div>)}</div>{!['RESOLVED','CLOSED'].includes(d.dispute.status)&&<div className="mt-3 flex gap-2"><input value={sellerMessages[d.dispute.id]||''} onChange={e=>setSellerMessages(v=>({...v,[d.dispute.id]:e.target.value}))} placeholder="Respond with facts/evidence" className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1"/><button disabled={busy} onClick={()=>void post('/api/v1/marketplace/seller/stores/'+storeId+'/disputes/'+d.dispute.id+'/messages',{body:sellerMessages[d.dispute.id]||''})} className="rounded border border-cyan-700 px-3 py-1 text-cyan-200">Respond</button></div>}</article>)}</div>
    </div>}

    {view==='ops'&&trustOps&&<div className="space-y-6">
      <div className="space-y-3"><h3 className="font-bold">Review moderation</h3>{moderation.length?moderation.map((x:any)=><article key={x.report.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{stars(x.review?.rating||0)} {x.review?.title||'Review'}</b><p className="mt-1 text-slate-300">{x.review?.body}</p><p className="mt-2 text-rose-300">Reported: {x.report.reason}</p></div><span>{x.review?.status}</span></div><input value={moderationReason[x.review.id]||''} onChange={e=>setModerationReason(v=>({...v,[x.review.id]:e.target.value}))} placeholder="Moderation rationale" className="mt-3 w-full rounded border border-slate-700 bg-slate-950 px-2 py-1"/><div className="mt-2 flex gap-2"><button disabled={busy} onClick={()=>void moderate(x.review.id,'PUBLISH')} className="rounded border border-emerald-700 px-3 py-1 text-emerald-300">Publish</button><button disabled={busy} onClick={()=>void moderate(x.review.id,'HIDE')} className="rounded border border-amber-700 px-3 py-1 text-amber-300">Hide</button><button disabled={busy} onClick={()=>void moderate(x.review.id,'REMOVE')} className="rounded border border-rose-800 px-3 py-1 text-rose-300">Remove</button></div></article>):<p className="text-xs text-slate-500">No open review reports.</p>}</div>
      <div className="space-y-3"><h3 className="font-bold">Dispute operations</h3>{opsDisputes.map((d:any)=>{const rr=resolution[d.dispute.id]||{action:'NO_ACTION',summary:''};return <article key={d.dispute.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-xs"><div className="flex justify-between gap-3"><div><b>{d.dispute.dispute_number} • {d.dispute.category.replaceAll('_',' ')}</b><p className="mt-1 text-slate-300">{d.dispute.summary}</p><p className="mt-2 text-slate-500">Financial: {d.order_snapshot.financial_status} • Fulfillment: {d.order_snapshot.fulfillment_status||'none'} • Returns: {(d.order_snapshot.return_statuses||[]).join(', ')||'none'}</p></div><span>{d.dispute.status.replaceAll('_',' ')}</span></div><div className="mt-3 space-y-2">{d.messages.map((m:any)=><div key={m.id} className={'rounded border p-2 '+(m.audience==='INTERNAL'?'border-violet-700/40 bg-violet-950/20':'border-slate-800')}><b>{m.author_role} • {m.audience}</b><p className="mt-1">{m.body}</p></div>)}</div>{!['RESOLVED','CLOSED'].includes(d.dispute.status)&&<><button disabled={busy} onClick={()=>void post('/api/v1/marketplace/admin/trust/disputes/'+d.dispute.id+'/take')} className="mt-3 rounded border border-cyan-700 px-3 py-1 text-cyan-200">Take case</button><div className="mt-3 grid gap-2 md:grid-cols-2"><select value={rr.action} onChange={e=>setResolution(v=>({...v,[d.dispute.id]:{...rr,action:e.target.value}}))} className="rounded border border-slate-700 bg-slate-950 px-2 py-1"><option>NO_ACTION</option><option>PARTIES_AGREED</option><option>RETURN_WORKFLOW</option><option>FINANCE_REVIEW</option><option>ACCOUNT_ACTION_REVIEW</option></select><input value={rr.summary} onChange={e=>setResolution(v=>({...v,[d.dispute.id]:{...rr,summary:e.target.value}}))} placeholder="Resolution rationale" className="rounded border border-slate-700 bg-slate-950 px-2 py-1"/></div><button disabled={busy||!rr.summary.trim()} onClick={()=>void resolveDispute(d.dispute.id)} className="mt-2 rounded bg-emerald-600 px-3 py-2 font-semibold">Resolve without moving money/inventory</button></>}</article>})}</div>
    </div>}
  </section>;
};
