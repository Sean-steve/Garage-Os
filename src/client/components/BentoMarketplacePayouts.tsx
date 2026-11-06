import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Landmark, RefreshCw, ShieldCheck, WalletCards } from 'lucide-react';

interface Props{actor:any;onNotify:(message:string)=>void;}
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};
const idem=(prefix:string)=>prefix+'-'+Date.now()+'-'+Math.random().toString(36).slice(2,10);

export const BentoMarketplacePayouts:React.FC<Props>=({actor,onNotify})=>{
  const financeRole=Boolean(actor?.platform_roles?.some((x:string)=>['PLATFORM_ADMIN','FINANCE_OPERATOR'].includes(x)));
  const memberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'seller'|'finance'>(memberships.length?'seller':'finance');
  const [providers,setProviders]=useState<any[]>([]);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [dashboard,setDashboard]=useState<any>(null);
  const [busy,setBusy]=useState(false);
  const [accountForm,setAccountForm]=useState({provider_id:'',currency:'KES',provider_account_ref:'',account_label:''});
  const [amounts,setAmounts]=useState<Record<string,string>>({});

  const [admin,setAdmin]=useState<any>(null);
  const [providerForm,setProviderForm]=useState({provider_key:'',display_name:'',mode:'TEST',webhook_secret_env:'',supports_reversals:true});
  const [policyForm,setPolicyForm]=useState({provider_id:'',currency:'KES',minimum_payout_minor:'100000',reserve_minor:'0'});
  const [selectedPayouts,setSelectedPayouts]=useState<Set<string>>(new Set());

  useEffect(()=>{if(!organizationId&&memberships.length)setOrganizationId(memberships[0].organization_id);},[organizationId,memberships]);

  const loadProviders=useCallback(async()=>{
    const r=await fetch('/api/v1/marketplace/payouts/providers');if(!r.ok)return;
    const j=await r.json(),list=(j.data||j).providers||[];setProviders(list);
    setAccountForm(v=>({...v,provider_id:v.provider_id||list[0]?.id||''}));
  },[]);
  useEffect(()=>{void loadProviders();},[loadProviders]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json(),list=(j.data||j).stores||[];
    setStores(list);setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void loadStores();},[view,loadStores]);

  const loadDashboard=useCallback(async()=>{
    if(!storeId){setDashboard(null);return;}
    const r=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/payouts');
    const j=await r.json();if(!r.ok){onNotify(j?.error?.message||'Could not load payout dashboard');return;}setDashboard(j.data||j);
  },[storeId,onNotify]);
  useEffect(()=>{if(view==='seller')void loadDashboard();},[view,loadDashboard]);

  const loadAdmin=useCallback(async()=>{
    if(!financeRole)return;
    const r=await fetch('/api/v1/marketplace/admin/payouts');const j=await r.json();
    if(!r.ok){onNotify(j?.error?.message||'Could not load finance operations');return;}
    const data=j.data||j;setAdmin(data);
    setPolicyForm(v=>({...v,provider_id:v.provider_id||data.providers?.[0]?.id||''}));
  },[financeRole,onNotify]);
  useEffect(()=>{if(view==='finance')void loadAdmin();},[view,loadAdmin]);

  async function registerAccount(){
    if(!storeId||!accountForm.provider_id||!accountForm.provider_account_ref||!accountForm.account_label){onNotify('Complete the payout account form.');return;}
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/payout-accounts',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(accountForm)
      });const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Could not register payout account');
      setAccountForm(v=>({...v,provider_account_ref:'',account_label:''}));
      onNotify('Payout account registered for finance review. No raw bank/mobile-money secret was stored.');
      await loadDashboard();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function requestPayout(option:any){
    const amount=Math.round(Number(amounts[option.payout_account_id]||0)*100);
    if(!amount){onNotify('Enter a payout amount.');return;}
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/payouts',{
        method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':idem('payout')},
        body:JSON.stringify({payout_account_id:option.payout_account_id,amount_minor:amount})
      });const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Payout request failed');
      onNotify('Payout requested. Money is reserved, not marked paid, until the payout provider confirms success.');
      setAmounts(v=>({...v,[option.payout_account_id]:''}));await loadDashboard();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function createProvider(){
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/admin/payouts/providers',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(providerForm)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Provider creation failed');
      setProviderForm({provider_key:'',display_name:'',mode:'TEST',webhook_secret_env:'',supports_reversals:true});
      onNotify('Payout provider registered. Actual success still requires a signed provider event.');await loadAdmin();await loadProviders();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function setPolicy(){
    const minimum=Math.round(Number(policyForm.minimum_payout_minor||0)),reserve=Math.round(Number(policyForm.reserve_minor||0));
    if(!policyForm.provider_id||minimum<=0||reserve<0){onNotify('Enter a provider and valid minor-unit policy amounts.');return;}
    setBusy(true);try{
      const r=await fetch('/api/v1/marketplace/admin/payouts/providers/'+policyForm.provider_id+'/policy',{
        method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({currency:policyForm.currency,minimum_payout_minor:minimum,reserve_minor:reserve})
      });const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Policy update failed');
      onNotify('Payout policy updated.');await loadAdmin();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function reviewAccount(id:string,status:'ACTIVE'|'PAUSED'|'RETIRED'){
    const r=await fetch('/api/v1/marketplace/admin/payouts/accounts/'+id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
    const j=await r.json();if(!r.ok){onNotify(j?.error?.message||'Account review failed');return;}onNotify('Payout account '+status.toLowerCase()+'.');await loadAdmin();
  }

  async function createBatch(){
    const ids=[...selectedPayouts];if(!ids.length){onNotify('Select requested payouts for a batch.');return;}
    const selected=(admin?.payouts||[]).filter((p:any)=>selectedPayouts.has(p.id));
    const providerId=selected[0]?.provider_id,currency=selected[0]?.currency;
    if(selected.some((p:any)=>p.provider_id!==providerId||p.currency!==currency)){onNotify('A batch must use one provider and one currency.');return;}
    const r=await fetch('/api/v1/marketplace/admin/payouts/batches',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({provider_id:providerId,currency,payout_ids:ids})});
    const j=await r.json();if(!r.ok){onNotify(j?.error?.message||'Batch creation failed');return;}
    setSelectedPayouts(new Set());onNotify('Payout batch created. No transfer has been claimed.');await loadAdmin();
  }

  async function handoff(batchId:string){
    const r=await fetch('/api/v1/marketplace/admin/payouts/batches/'+batchId+'/handoff',{method:'POST'});
    const j=await r.json();if(!r.ok){onNotify(j?.error?.message||'Handoff preparation failed');return;}
    const data=j.data||j;
    onNotify(data.provider_action?.execution_performed===false
      ?'Provider handoff prepared. Garage OS still waits for signed provider callbacks.'
      :'Handoff prepared.');
    await loadAdmin();
  }

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><WalletCards className="h-4 w-4"/>Sprint 32</div><h2 className="mt-2 text-2xl font-bold">Seller Payouts, Balances & Financial Operations</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Settlement-ledger receivables, governed payout requests and provider-authoritative transfer truth.</p></div>
        <div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{memberships.length>0&&<button onClick={()=>setView('seller')} className={'rounded-lg px-3 py-2 text-xs '+(view==='seller'?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>Seller</button>}{financeRole&&<button onClick={()=>setView('finance')} className={'rounded-lg px-3 py-2 text-xs '+(view==='finance'?'bg-violet-500/15 text-violet-200':'text-slate-400')}>Finance Ops</button>}</div>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100"><ShieldCheck className="h-4 w-4 shrink-0 text-cyan-300"/><p>Receivable is not payout. Requested/processing payouts reserve balance; only an HMAC-verified provider <b>PAYOUT_SUCCEEDED</b> event counts as transferred money. Currencies are never combined.</p></div>
    </div>

    {view==='seller'&&memberships.length>0&&<div className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{memberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void loadDashboard()} className="rounded border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button></div>
      {dashboard&&<><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{dashboard.balances.map((b:any)=><div key={b.currency} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4"><p className="text-[10px] uppercase text-slate-500">{b.currency} balance</p><p className="mt-2 text-xl font-bold">{money(b.unallocated_minor,b.currency)}</p><div className="mt-2 space-y-1 text-[10px] text-slate-500"><p>Receivable {money(b.net_receivable_minor,b.currency)}</p><p>Reserved {money(b.reserved_minor,b.currency)}</p><p>Provider-confirmed paid {money(b.paid_minor,b.currency)}</p>{b.deficit_minor>0&&<p className="text-rose-300">Deficit {money(b.deficit_minor,b.currency)}</p>}</div></div>)}</div>

      <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Register payout account</h3><p className="mt-1 text-[10px] text-slate-500">Use only a provider-issued token/reference. Do not enter a raw phone number, bank account number, PIN or secret.</p><div className="mt-4 grid gap-2"><select value={accountForm.provider_id} onChange={e=>setAccountForm(v=>({...v,provider_id:e.target.value}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{providers.map(p=><option key={p.id} value={p.id}>{p.display_name} • {p.mode}</option>)}</select><input value={accountForm.currency} maxLength={3} onChange={e=>setAccountForm(v=>({...v,currency:e.target.value.toUpperCase()}))} placeholder="KES" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={accountForm.account_label} onChange={e=>setAccountForm(v=>({...v,account_label:e.target.value}))} placeholder="Account label" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={accountForm.provider_account_ref} onChange={e=>setAccountForm(v=>({...v,provider_account_ref:e.target.value}))} placeholder="Provider-issued account token/reference" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy} onClick={()=>void registerAccount()} className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold">Register for review</button></div><div className="mt-4 space-y-2">{dashboard.accounts.map((a:any)=><div key={a.id} className="flex justify-between rounded border border-slate-800 p-3 text-xs"><span>{a.account_label} • {a.provider_display_name} • {a.currency}</span><span className="text-slate-400">{a.status.replaceAll('_',' ')}</span></div>)}</div></div>
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Request payout</h3><div className="mt-4 space-y-3">{dashboard.payout_options.length?dashboard.payout_options.map((o:any)=><div key={o.payout_account_id} className="rounded-lg border border-slate-800 p-4"><div className="flex justify-between text-xs"><b>{o.account_label} • {o.provider_display_name}</b><span>{o.currency}</span></div><p className="mt-1 text-[10px] text-slate-500">Requestable after reserve: {money(o.requestable_minor,o.currency)} • Min {money(o.policy.minimum_payout_minor,o.currency)} • Reserve {money(o.policy.reserve_minor,o.currency)}</p><div className="mt-3 flex gap-2"><input type="number" min="0" step="0.01" value={amounts[o.payout_account_id]||''} onChange={e=>setAmounts(v=>({...v,[o.payout_account_id]:e.target.value}))} placeholder="Amount" className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button disabled={busy||o.requestable_minor<o.policy.minimum_payout_minor} onClick={()=>void requestPayout(o)} className="rounded border border-emerald-700 px-3 py-2 text-xs text-emerald-200 disabled:opacity-40">Request</button></div></div>):<p className="text-xs text-slate-500">No active provider account with a configured payout policy.</p>}</div></div></div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Payout history</h3><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="text-slate-500"><tr><th>Payout</th><th>Provider</th><th>Amount</th><th>Status</th><th>Requested</th></tr></thead><tbody>{dashboard.payouts.map((p:any)=><tr key={p.id} className="border-t border-slate-800"><td className="py-3">{p.payout_number}</td><td>{p.provider_key}</td><td>{money(p.amount_minor,p.currency)}</td><td>{p.status}</td><td>{new Date(p.requested_at).toLocaleString()}</td></tr>)}</tbody></table></div></div></>}</div>}

    {view==='finance'&&financeRole&&admin&&<div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Landmark className="h-4 w-4"/><h3 className="font-bold">Payout providers</h3></div><div className="mt-4 grid gap-2 md:grid-cols-2"><input value={providerForm.provider_key} onChange={e=>setProviderForm(v=>({...v,provider_key:e.target.value}))} placeholder="Provider key" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={providerForm.display_name} onChange={e=>setProviderForm(v=>({...v,display_name:e.target.value}))} placeholder="Display name" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={providerForm.webhook_secret_env} onChange={e=>setProviderForm(v=>({...v,webhook_secret_env:e.target.value}))} placeholder="Webhook secret ENV" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><select value={providerForm.mode} onChange={e=>setProviderForm(v=>({...v,mode:e.target.value}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option>TEST</option><option>LIVE</option></select></div><label className="mt-3 flex gap-2 text-xs"><input type="checkbox" checked={providerForm.supports_reversals} onChange={e=>setProviderForm(v=>({...v,supports_reversals:e.target.checked}))}/>Supports provider-confirmed reversals</label><button disabled={busy} onClick={()=>void createProvider()} className="mt-3 rounded bg-emerald-600 px-3 py-2 text-xs">Register provider</button><div className="mt-4 space-y-2">{admin.providers.map((p:any)=><div key={p.id} className="flex justify-between rounded border border-slate-800 p-3 text-xs"><span>{p.display_name} • {p.provider_key}</span><span>{p.mode} • {p.status}</span></div>)}</div></div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Payout policy</h3><p className="mt-1 text-[10px] text-slate-500">Amounts are entered in minor units here to avoid UI rounding ambiguity.</p><div className="mt-4 grid gap-2"><select value={policyForm.provider_id} onChange={e=>setPolicyForm(v=>({...v,provider_id:e.target.value}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{admin.providers.map((p:any)=><option key={p.id} value={p.id}>{p.display_name}</option>)}</select><input value={policyForm.currency} onChange={e=>setPolicyForm(v=>({...v,currency:e.target.value.toUpperCase()}))} maxLength={3} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={policyForm.minimum_payout_minor} onChange={e=>setPolicyForm(v=>({...v,minimum_payout_minor:e.target.value}))} placeholder="Minimum payout minor" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={policyForm.reserve_minor} onChange={e=>setPolicyForm(v=>({...v,reserve_minor:e.target.value}))} placeholder="Reserve minor" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><button onClick={()=>void setPolicy()} className="rounded border border-emerald-700 px-3 py-2 text-xs text-emerald-200">Save policy</button></div></div></div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><h3 className="font-bold">Payout account review</h3><div className="mt-4 space-y-2">{admin.accounts.map((a:any)=><div key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 p-3 text-xs"><span>{a.account_label} • {a.provider_display_name} • {a.currency} • {a.status.replaceAll('_',' ')}</span><div className="flex gap-2">{a.status!=='ACTIVE'&&a.status!=='RETIRED'&&<button onClick={()=>void reviewAccount(a.id,'ACTIVE')} className="rounded border border-emerald-700 px-2 py-1 text-emerald-300">Activate</button>}{a.status==='ACTIVE'&&<button onClick={()=>void reviewAccount(a.id,'PAUSED')} className="rounded border border-amber-700 px-2 py-1 text-amber-300">Pause</button>}{a.status!=='RETIRED'&&<button onClick={()=>void reviewAccount(a.id,'RETIRED')} className="rounded border border-rose-800 px-2 py-1 text-rose-300">Retire</button>}</div></div>)}</div></div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold">Requested payouts & batches</h3><p className="text-[10px] text-slate-500">Batch handoff does not mark a payout processing or successful.</p></div><button onClick={()=>void createBatch()} className="rounded border border-violet-700 px-3 py-2 text-xs text-violet-200">Create batch from selected</button></div><div className="mt-4 space-y-2">{admin.payouts.filter((p:any)=>p.status==='REQUESTED').map((p:any)=><label key={p.id} className="flex items-center gap-3 rounded border border-slate-800 p-3 text-xs"><input type="checkbox" checked={selectedPayouts.has(p.id)} onChange={e=>setSelectedPayouts(s=>{const n=new Set(s);e.target.checked?n.add(p.id):n.delete(p.id);return n;})}/><span className="flex-1">{p.payout_number} • {p.provider_key}</span><b>{money(p.amount_minor,p.currency)}</b></label>)}</div><div className="mt-5 space-y-2">{admin.batches.map((b:any)=><div key={b.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 p-3 text-xs"><span>{b.batch_number} • {b.provider_key} • {b.currency} • {b.status.replaceAll('_',' ')}</span>{['DRAFT','HANDOFF_INITIATED'].includes(b.status)&&<button onClick={()=>void handoff(b.id)} className="rounded border border-cyan-700 px-2 py-1 text-cyan-300">Prepare / repeat handoff</button>}</div>)}</div></div>

      <div className="grid gap-5 lg:grid-cols-2"><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300"/><h3 className="font-bold">Provider events</h3></div><div className="mt-3 space-y-2">{admin.events.slice(0,20).map((e:any)=><div key={e.id} className="rounded border border-slate-800 p-3 text-xs"><b>{e.event_type}</b><p className="text-slate-500">{e.processing_status} • {e.provider_event_id}</p></div>)}</div></div><div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex gap-2"><AlertTriangle className="h-4 w-4 text-amber-300"/><h3 className="font-bold">Reconciliation</h3></div><div className="mt-3 space-y-2">{admin.issues.slice(0,20).map((i:any)=><div key={i.id} className="rounded border border-rose-900/30 bg-rose-950/10 p-3 text-xs"><b>{i.issue_type}</b><p className="mt-1 text-slate-400">{i.details}</p></div>)}</div></div></div>
    </div>}
  </section>;
};
