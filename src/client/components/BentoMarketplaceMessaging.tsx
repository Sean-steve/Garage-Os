import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, CheckCircle2, MessageSquare, RefreshCw, Send, ShieldCheck, Users } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}

export const BentoMarketplaceMessaging:React.FC<Props>=({actor,onNotify})=>{
  const memberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'buyer'|'seller'>(memberships.length?'buyer':'buyer');
  const [prefs,setPrefs]=useState<any>(null);
  const [buyerConversations,setBuyerConversations]=useState<any[]>([]);
  const [buyerNotifications,setBuyerNotifications]=useState<any[]>([]);
  const [selectedId,setSelectedId]=useState('');
  const [thread,setThread]=useState<any>(null);
  const [message,setMessage]=useState('');
  const [classification,setClassification]=useState<'TRANSACTIONAL'|'PROMOTIONAL'>('TRANSACTIONAL');
  const [newContext,setNewContext]=useState({context_type:'LISTING_INQUIRY',context_id:'',subject:''});
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerConversations,setSellerConversations]=useState<any[]>([]);
  const [sellerNotifications,setSellerNotifications]=useState<any[]>([]);
  const [crm,setCrm]=useState<any>(null);
  const [adapters,setAdapters]=useState<any>(null);
  const [busy,setBusy]=useState(false);

  useEffect(()=>{if(!organizationId&&memberships.length)setOrganizationId(memberships[0].organization_id);},[organizationId,memberships]);

  const loadBuyer=useCallback(async()=>{
    const [pr,cr,nr,ar]=await Promise.all([
      fetch('/api/v1/marketplace/communications/preferences'),
      fetch('/api/v1/marketplace/communications/conversations'),
      fetch('/api/v1/marketplace/communications/notifications'),
      fetch('/api/v1/marketplace/communications/adapters')
    ]);
    if(pr.ok){const j=await pr.json();setPrefs((j.data||j).preferences);}
    if(cr.ok){const j=await cr.json();setBuyerConversations((j.data||j).conversations||[]);}
    if(nr.ok){const j=await nr.json();setBuyerNotifications((j.data||j).notifications||[]);}
    if(ar.ok){const j=await ar.json();setAdapters(j.data||j);}
  },[]);
  useEffect(()=>{void loadBuyer();},[loadBuyer]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json(),list=(j.data||j).stores||[];
    setStores(list);setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadSeller=useCallback(async()=>{
    if(!storeId){setSellerConversations([]);setSellerNotifications([]);setCrm(null);return;}
    const [cr,nr,rr]=await Promise.all([
      fetch('/api/v1/marketplace/seller/stores/'+storeId+'/communications/conversations'),
      fetch('/api/v1/marketplace/seller/stores/'+storeId+'/communications/notifications'),
      fetch('/api/v1/marketplace/seller/stores/'+storeId+'/crm')
    ]);
    if(cr.ok){const j=await cr.json();setSellerConversations((j.data||j).conversations||[]);}
    if(nr.ok){const j=await nr.json();setSellerNotifications((j.data||j).notifications||[]);}
    if(rr.ok){const j=await rr.json();setCrm(j.data||j);}
  },[storeId]);
  useEffect(()=>{if(view==='seller')void loadSeller();},[view,loadSeller]);

  const loadThread=useCallback(async(id:string)=>{
    if(!id){setThread(null);return;}
    const r=await fetch('/api/v1/marketplace/communications/conversations/'+id),j=await r.json();
    if(!r.ok){onNotify(j?.error?.message||'Could not load conversation');return;}
    setThread(j.data||j);
  },[onNotify]);
  useEffect(()=>{if(selectedId)void loadThread(selectedId);},[selectedId,loadThread]);

  async function createConversation(){
    if(!newContext.context_id){onNotify('Enter the listing, order, return or dispute ID.');return;}
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/communications/conversations',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({...newContext,subject:newContext.subject||undefined})});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Conversation could not be created');
      const data=j.data||j;setSelectedId(data.conversation.id);setNewContext(v=>({...v,context_id:'',subject:''}));
      onNotify(data.created?'Conversation opened.':'Existing open conversation selected.');await loadBuyer();if(storeId)await loadSeller();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function sendMessage(){
    if(!selectedId||!message.trim())return;
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/communications/conversations/'+selectedId+'/messages',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify({classification,body:message})});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Message could not be sent');
      setMessage('');onNotify(classification==='PROMOTIONAL'
        ?'Promotional message sent under the buyer’s explicit in-app consent.'
        :'Transactional message stored in-app. No external delivery is implied.');
      await loadThread(selectedId);await loadBuyer();if(storeId)await loadSeller();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function savePrefs(){
    if(!prefs)return;setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/communications/preferences',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(prefs)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Preferences could not be saved');
      setPrefs((j.data||j).preferences);onNotify('Communication preferences saved. Channel requests are not delivery claims.');
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function markNotification(id:string,state:'READ'|'DISMISSED',seller=false){
    const url=seller
      ?'/api/v1/marketplace/seller/stores/'+storeId+'/communications/notifications/'+id
      :'/api/v1/marketplace/communications/notifications/'+id;
    const r=await fetch(url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({state})});
    if(r.ok){seller?await loadSeller():await loadBuyer();}
  }

  const conversations=view==='seller'?sellerConversations:buyerConversations;
  const notifications=view==='seller'?sellerNotifications:buyerNotifications;

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-cyan-300"><MessageSquare className="h-4 w-4"/>Sprint 33</div>
          <h2 className="mt-2 text-2xl font-bold">Buyer–Seller Messaging, Notifications & Seller CRM</h2>
          <p className="mt-2 max-w-3xl text-sm text-slate-400">Transactional conversations, explicit promotional consent, delivery truth and relationship summaries grounded in real commerce.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button onClick={()=>{setView('buyer');setSelectedId('');}} className={'rounded-lg px-3 py-2 text-xs '+(view==='buyer'?'bg-cyan-500/15 text-cyan-200':'text-slate-400')}>Buyer inbox</button>
          {memberships.length>0&&<button onClick={()=>{setView('seller');setSelectedId('');}} className={'rounded-lg px-3 py-2 text-xs '+(view==='seller'?'bg-violet-500/15 text-violet-200':'text-slate-400')}>Seller CRM</button>}
        </div>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100"><ShieldCheck className="h-4 w-4 shrink-0 text-cyan-300"/>
        <p>Requested channel ≠ attempted ≠ accepted ≠ delivered. Promotional messaging requires explicit buyer consent and respects quiet hours. Seller CRM uses orders and conversations—not browsing/search history or hidden scores.</p>
      </div>
    </div>

    {view==='buyer'&&<div className="grid gap-5 xl:grid-cols-[1fr_1.45fr]">
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Start a conversation</h3>
          <div className="mt-4 grid gap-2"><select value={newContext.context_type} onChange={e=>setNewContext(v=>({...v,context_type:e.target.value}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">
            <option value="LISTING_INQUIRY">Listing inquiry</option><option value="ORDER">Order</option><option value="RETURN">Return</option><option value="DISPUTE">Dispute</option>
          </select><input value={newContext.context_id} onChange={e=>setNewContext(v=>({...v,context_id:e.target.value}))} placeholder="Context ID" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/>
          <input value={newContext.subject} onChange={e=>setNewContext(v=>({...v,subject:e.target.value}))} placeholder="Optional subject" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/>
          <button disabled={busy} onClick={()=>void createConversation()} className="rounded bg-cyan-600 px-3 py-2 text-xs font-semibold">Open conversation</button></div>
        </div>

        {prefs&&<div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Communication consent</h3>
          <p className="mt-1 text-[10px] text-slate-500">External channel activation is a preference only until a real adapter attempts and a provider confirms delivery.</p>
          <div className="mt-4 space-y-2 text-xs">
            <label className="flex gap-2"><input type="checkbox" checked={prefs.transactional_email_requested} onChange={e=>setPrefs({...prefs,transactional_email_requested:e.target.checked})}/>Request transactional email</label>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.transactional_sms_requested} onChange={e=>setPrefs({...prefs,transactional_sms_requested:e.target.checked})}/>Request transactional SMS</label>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.transactional_push_requested} onChange={e=>setPrefs({...prefs,transactional_push_requested:e.target.checked})}/>Request transactional push</label>
            <div className="my-3 border-t border-slate-800"/>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.promotional_in_app_enabled} onChange={e=>setPrefs({...prefs,promotional_in_app_enabled:e.target.checked})}/>Opt in to seller promotional in-app messages</label>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.promotional_email_opt_in} onChange={e=>setPrefs({...prefs,promotional_email_opt_in:e.target.checked})}/>Opt in to promotional email</label>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.promotional_sms_opt_in} onChange={e=>setPrefs({...prefs,promotional_sms_opt_in:e.target.checked})}/>Opt in to promotional SMS</label>
            <label className="flex gap-2"><input type="checkbox" checked={prefs.promotional_push_opt_in} onChange={e=>setPrefs({...prefs,promotional_push_opt_in:e.target.checked})}/>Opt in to promotional push</label>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2"><input type="time" value={prefs.quiet_hours_start||''} onChange={e=>setPrefs({...prefs,quiet_hours_start:e.target.value||null})} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input type="time" value={prefs.quiet_hours_end||''} onChange={e=>setPrefs({...prefs,quiet_hours_end:e.target.value||null})} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></div>
          <button disabled={busy} onClick={()=>void savePrefs()} className="mt-3 rounded border border-cyan-700 px-3 py-2 text-xs text-cyan-200">Save preferences</button>
        </div>}
      </div>
      <ThreadWorkspace conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} thread={thread} message={message}
        setMessage={setMessage} classification={classification} setClassification={setClassification} seller={false} busy={busy} onSend={sendMessage}/>
    </div>}

    {view==='seller'&&memberships.length>0&&<div className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{memberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select>
        <select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select>
        <button onClick={()=>void loadSeller()} className="rounded border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
        <ThreadWorkspace conversations={conversations} selectedId={selectedId} onSelect={setSelectedId} thread={thread} message={message}
          setMessage={setMessage} classification={classification} setClassification={setClassification} seller busy={busy} onSend={sendMessage}/>
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex gap-2"><Users className="h-4 w-4 text-violet-300"/><h3 className="font-bold">Relationship CRM</h3></div>
            <p className="mt-1 text-[10px] text-slate-500">Derived only from orders and direct conversations. Ordered value is not payment/revenue truth.</p>
            <div className="mt-4 space-y-2">{crm?.relationships?.map((r:any)=><div key={r.buyer_user_id} className="rounded border border-slate-800 p-3 text-xs"><div className="flex justify-between gap-3"><b>{r.buyer_user_id}</b><span>{r.order_count} order{r.order_count===1?'':'s'}</span></div><p className="mt-1 text-[10px] text-slate-500">Last order {new Date(r.last_order_at).toLocaleDateString()} • {r.open_conversation_count} open conversation(s)</p><p className="mt-1 text-[10px] text-slate-400">{r.ordered_value_by_currency.map((x:any)=>x.currency+' '+(x.amount_minor/100).toLocaleString()).join(' • ')}</p></div>)}
            {!crm?.relationships?.length&&<p className="text-xs text-slate-500">No legitimate transaction relationships yet.</p>}</div>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300"/><h3 className="font-bold">External delivery foundation</h3></div>
            <p className="mt-3 text-xs text-slate-400">{adapters?.registered_adapters?.length?adapters.registered_adapters.map((a:any)=>a.provider_key+' '+a.channel).join(', '):'No live email/SMS/push adapter is registered yet. That remains Sprint 40 activation work.'}</p>
          </div>
        </div>
      </div>
    </div>}

    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-amber-300"/><h3 className="font-bold">In-app notifications</h3></div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">{notifications.slice(0,12).map((n:any)=><div key={n.id} className="rounded border border-slate-800 p-3 text-xs"><div className="flex justify-between gap-2"><b>{n.title}</b><span className="text-[9px] text-slate-500">{n.classification}</span></div><p className="mt-1 text-slate-400">{n.body}</p><div className="mt-2 flex items-center justify-between"><span className="text-[9px] text-slate-500">{n.state}</span><div className="flex gap-2">{n.state==='UNREAD'&&<button onClick={()=>void markNotification(n.id,'READ',view==='seller')} className="text-cyan-300">Mark read</button>}<button onClick={()=>void markNotification(n.id,'DISMISSED',view==='seller')} className="text-slate-400">Dismiss</button></div></div></div>)}
      {!notifications.length&&<p className="text-xs text-slate-500">No notifications.</p>}</div>
    </div>
  </section>;
};

const ThreadWorkspace:React.FC<any>=({conversations,selectedId,onSelect,thread,message,setMessage,classification,setClassification,seller,busy,onSend})=>
  <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
    <div className="grid min-h-[520px] gap-4 md:grid-cols-[240px_1fr]">
      <div className="space-y-2 border-r border-slate-800 pr-3"><h3 className="mb-3 font-bold">Conversations</h3>{conversations.map((c:any)=><button key={c.id} onClick={()=>onSelect(c.id)} className={'w-full rounded-lg border p-3 text-left text-xs '+(selectedId===c.id?'border-cyan-700 bg-cyan-500/5':'border-slate-800')}><b className="block truncate">{c.subject}</b><span className="mt-1 block text-[9px] text-slate-500">{c.context_type.replaceAll('_',' ')} • {c.status}</span></button>)}{!conversations.length&&<p className="text-xs text-slate-500">No conversations yet.</p>}</div>
      <div className="flex min-w-0 flex-col">{thread?<><div className="border-b border-slate-800 pb-3"><h3 className="font-bold">{thread.conversation.subject}</h3><p className="text-[10px] text-slate-500">{thread.conversation.context_type.replaceAll('_',' ')} • {thread.conversation.status}</p></div>
        <div className="flex-1 space-y-3 overflow-y-auto py-4">{thread.messages.map((m:any)=><div key={m.id} className={'max-w-[85%] rounded-xl border p-3 text-xs '+(m.sender_role==='SELLER'?'ml-auto border-violet-800 bg-violet-950/20':'border-slate-700 bg-slate-950')}><div className="mb-1 flex justify-between gap-4 text-[9px] uppercase text-slate-500"><span>{m.sender_role}</span><span>{m.classification}</span></div><p>{m.body}</p></div>)}</div>
        {thread.conversation.status==='OPEN'&&<div className="border-t border-slate-800 pt-3">{seller&&<select value={classification} onChange={e=>setClassification(e.target.value)} className="mb-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-[10px]"><option value="TRANSACTIONAL">Transactional</option><option value="PROMOTIONAL">Promotional — consent required</option></select>}<div className="flex gap-2"><textarea value={message} onChange={e=>setMessage(e.target.value)} placeholder="Write a message…" className="min-h-20 flex-1 resize-none rounded border border-slate-700 bg-slate-950 p-3 text-xs"/><button disabled={busy||!message.trim()} onClick={()=>void onSend()} className="self-end rounded bg-cyan-600 p-3 disabled:opacity-40"><Send className="h-4 w-4"/></button></div></div>}</>:<div className="flex flex-1 items-center justify-center text-xs text-slate-500">Select a conversation.</div>}</div>
    </div>
  </div>;
