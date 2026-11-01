import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bookmark, Car, ListFilter, RefreshCw, Search, Sparkles, Store } from 'lucide-react';

interface Props{
  actor:any;vehicles:any[];selectedVehicleId:string;onSelectVehicle:(id:string)=>void;onNotify:(message:string)=>void;
}
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};

export const BentoMarketplaceDiscovery:React.FC<Props>=({actor,vehicles,selectedVehicleId,onSelectVehicle,onNotify})=>{
  const isAdmin=Boolean(actor?.platform_roles?.includes('PLATFORM_ADMIN'));
  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [view,setView]=useState<'search'|'recommendations'|'merchandising'>('search');
  const [busy,setBusy]=useState(false);

  const [query,setQuery]=useState('');
  const [sort,setSort]=useState('RELEVANCE');
  const [useVehicle,setUseVehicle]=useState(false);
  const [results,setResults]=useState<any[]>([]);
  const [searchTruth,setSearchTruth]=useState<any>(null);
  const [homeCollections,setHomeCollections]=useState<any[]>([]);
  const [related,setRelated]=useState<any[]>([]);

  const [recommendations,setRecommendations]=useState<any[]>([]);

  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerListings,setSellerListings]=useState<any[]>([]);
  const [sellerCollections,setSellerCollections]=useState<any[]>([]);
  const [selectedListingIds,setSelectedListingIds]=useState<string[]>([]);
  const [sellerForm,setSellerForm]=useState({slug:'',title:'',description:''});

  const [platformCollections,setPlatformCollections]=useState<any[]>([]);
  const [platformForm,setPlatformForm]=useState({slug:'',title:'',description:'',surface:'HOME',category_code:'',listing_ids:''});

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const searchMarketplace=useCallback(async()=>{
    const p=new URLSearchParams();
    if(query.trim())p.set('query',query.trim());
    p.set('sort',sort);p.set('limit','24');
    if(useVehicle&&selectedVehicleId){p.set('vehicle_id',selectedVehicleId);p.set('include_unknown_fitment','true');}
    const r=await fetch('/api/v1/marketplace/search?'+p.toString());
    if(!r.ok)return;
    const j=await r.json(),data=j.data||j;setResults(data.items||[]);setSearchTruth(data.truth||null);
  },[query,sort,useVehicle,selectedVehicleId]);

  const loadHome=useCallback(async()=>{
    const r=await fetch('/api/v1/marketplace/merchandising?surface=HOME');
    if(!r.ok)return;const j=await r.json();setHomeCollections((j.data||j).collections||[]);
  },[]);
  useEffect(()=>{if(view==='search')void Promise.all([searchMarketplace(),loadHome()]);},[view,searchMarketplace,loadHome]);

  const loadRecommendations=useCallback(async()=>{
    if(!selectedVehicleId){setRecommendations([]);return;}
    const r=await fetch('/api/v1/marketplace/recommendations/vehicle/'+encodeURIComponent(selectedVehicleId)+'?limit=18');
    if(!r.ok)return;const j=await r.json();setRecommendations((j.data||j).items||[]);
  },[selectedVehicleId]);
  useEffect(()=>{if(view==='recommendations')void loadRecommendations();},[view,loadRecommendations]);

  const loadStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!r.ok)return;const j=await r.json(),list=(j.data||j).stores||[];setStores(list);
    setStoreId(s=>s&&list.some((x:any)=>x.id===s)?s:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='merchandising')void loadStores();},[view,loadStores]);

  const loadSellerMerch=useCallback(async()=>{
    if(!storeId){setSellerListings([]);setSellerCollections([]);return;}
    const [l,c]=await Promise.all([
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/listings'),
      fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/merchandising')
    ]);
    if(l.ok){const j=await l.json();setSellerListings((j.data||j).listings||[]);}
    if(c.ok){const j=await c.json();setSellerCollections((j.data||j).collections||[]);}
  },[storeId]);
  useEffect(()=>{if(view==='merchandising')void loadSellerMerch();},[view,loadSellerMerch]);

  const loadPlatformMerch=useCallback(async()=>{
    if(!isAdmin)return;const r=await fetch('/api/v1/marketplace/admin/merchandising');
    if(!r.ok)return;const j=await r.json();setPlatformCollections((j.data||j).collections||[]);
  },[isAdmin]);
  useEffect(()=>{if(view==='merchandising')void loadPlatformMerch();},[view,loadPlatformMerch]);

  async function jsonCall(url:string,method:string,body:any){
    setBusy(true);
    try{
      const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Operation failed');
      onNotify('Marketplace discovery updated.');return j.data||j;
    }catch(err){onNotify((err as Error).message);return null;}finally{setBusy(false);}
  }

  async function showRelated(listingId:string){
    const suffix=useVehicle&&selectedVehicleId?'?vehicle_id='+encodeURIComponent(selectedVehicleId):'';
    const r=await fetch('/api/v1/marketplace/recommendations/listings/'+listingId+suffix);
    if(!r.ok)return;const j=await r.json();setRelated((j.data||j).items||[]);
  }

  async function saveListing(listingId:string){
    await jsonCall('/api/v1/marketplace/listings/'+listingId+'/save','POST',{
      price_drop_alert_enabled:true,restock_alert_enabled:true
    });
  }

  async function saveCurrentSearch(){
    const name=query.trim()?('Search: '+query.trim()).slice(0,120):'Marketplace search';
    await jsonCall('/api/v1/marketplace/saved-searches','POST',{
      name,
      criteria:{query:query.trim()||undefined},
      vehicle_id:useVehicle&&selectedVehicleId?selectedVehicleId:null,
      new_match_alert_enabled:true
    });
  }

  async function createSellerCollection(){
    if(!storeId||!sellerForm.slug||!sellerForm.title||!selectedListingIds.length){onNotify('Choose a store, title, slug and at least one listing.');return;}
    const created=await jsonCall('/api/v1/marketplace/seller/stores/'+storeId+'/merchandising','POST',{
      slug:sellerForm.slug,title:sellerForm.title,description:sellerForm.description,surface:'STORE'
    });
    if(!created?.collection?.id)return;
    await jsonCall('/api/v1/marketplace/seller/stores/'+storeId+'/merchandising/'+created.collection.id+'/items','PUT',{listing_ids:selectedListingIds});
    await jsonCall('/api/v1/marketplace/seller/stores/'+storeId+'/merchandising/'+created.collection.id,'PATCH',{status:'ACTIVE'});
    setSellerForm({slug:'',title:'',description:''});setSelectedListingIds([]);await loadSellerMerch();
  }

  async function createPlatformCollection(){
    const ids=platformForm.listing_ids.split(',').map(x=>x.trim()).filter(Boolean);
    if(!platformForm.slug||!platformForm.title||!ids.length){onNotify('Add title, slug and listing IDs.');return;}
    const created=await jsonCall('/api/v1/marketplace/admin/merchandising','POST',{
      slug:platformForm.slug,title:platformForm.title,description:platformForm.description,
      surface:platformForm.surface,category_code:platformForm.surface==='CATEGORY'?platformForm.category_code:undefined
    });
    if(!created?.collection?.id)return;
    await jsonCall('/api/v1/marketplace/admin/merchandising/'+created.collection.id+'/items','PUT',{listing_ids:ids});
    await jsonCall('/api/v1/marketplace/admin/merchandising/'+created.collection.id,'PATCH',{status:'ACTIVE'});
    setPlatformForm({slug:'',title:'',description:'',surface:'HOME',category_code:'',listing_ids:''});await loadPlatformMerch();await loadHome();
  }

  function cards(items:any[],recommendation=false){
    return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((x:any)=><article key={x.listing_id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex justify-between gap-3"><div><p className="text-[10px] uppercase text-slate-500">#{x.organic_rank||'—'} • {x.store_name}</p><h3 className="mt-1 font-bold">{x.title}</h3><p className="mt-1 text-xs text-slate-400">{x.brand||'Unbranded'} • {x.category_name}</p></div><p className="text-sm font-bold">{money(x.price_minor,x.currency)}</p></div>
      <div className="mt-3 flex flex-wrap gap-2 text-[10px]"><span className="rounded border border-slate-700 px-2 py-1">score {x.organic_score}</span><span className="rounded border border-emerald-800 px-2 py-1 text-emerald-300">{x.inventory_status.replaceAll('_',' ')}</span>{x.trust?.average_rating!==null&&<span className="rounded border border-amber-800 px-2 py-1 text-amber-300">★ {x.trust.average_rating} ({x.trust.verified_review_count})</span>}{x.fitment&&<span className="rounded border border-cyan-800 px-2 py-1 text-cyan-300">{x.fitment.status.replaceAll('_',' ')} • not guaranteed</span>}</div>
      <div className="mt-3 space-y-1 text-[10px] text-slate-500">{(x.rank_components||[]).map((r:any,i:number)=><p key={i}><b className="text-slate-400">{r.key} {r.score>=0?'+':''}{r.score}:</b> {r.reason}</p>)}</div>
      {recommendation&&(x.recommendation_reasons||[]).length>0&&<div className="mt-3 rounded border border-cyan-500/20 bg-cyan-500/5 p-2 text-[10px] text-cyan-100">{x.recommendation_reasons.join(' ')}</div>}
      <div className="mt-3 flex gap-2"><button disabled={busy} onClick={()=>void saveListing(x.listing_id)} className="flex items-center gap-1 rounded border border-emerald-800 px-3 py-1 text-xs text-emerald-300"><Bookmark className="h-3 w-3"/>Save</button>{!recommendation&&<button onClick={()=>void showRelated(x.listing_id)} className="rounded border border-slate-700 px-3 py-1 text-xs">Related items</button>}</div>
    </article>)}</div>;
  }

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><Sparkles className="h-4 w-4"/>Sprint 28</div><h2 className="mt-2 text-2xl font-bold">Search Quality, Merchandising & Recommendations</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Explainable organic ranking, disclosed curated shelves and vehicle-aware recommendations without hidden paid boosts.</p></div><div className="flex gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{([['search','Search'],['recommendations','Recommendations'],['merchandising','Merchandising']] as const).map(([id,label])=><button key={id} onClick={()=>setView(id)} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view===id?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>{label}</button>)}</div></div>
      <div className="mt-5 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4 text-xs text-cyan-100">Organic search is deterministic and explainable. Curated shelves are labeled, do not alter organic rank, and Sprint 28 supports no paid placement. Vehicle recommendations exclude known fitment conflicts/incompatibilities and are never guarantees.</div>
    </div>

    {view==='search'&&<div className="space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><div className="flex min-w-[260px] flex-1 items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3"><Search className="h-4 w-4 text-slate-500"/><input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')void searchMarketplace();}} placeholder="Search title, brand, SKU or part number" className="w-full bg-transparent py-2 text-sm outline-none"/></div><select value={sort} onChange={e=>setSort(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option>RELEVANCE</option><option>PRICE_ASC</option><option>PRICE_DESC</option><option>RATING</option></select><label className="flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs"><input type="checkbox" checked={useVehicle} onChange={e=>setUseVehicle(e.target.checked)}/>Vehicle context</label>{useVehicle&&<select value={selectedVehicleId} onChange={e=>onSelectVehicle(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{vehicles.map(v=><option key={v.id} value={v.id}>{v.display_name}</option>)}</select>}<button disabled={busy} onClick={()=>void searchMarketplace()} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold">Search</button><button disabled={busy} onClick={()=>void saveCurrentSearch()} className="flex items-center gap-1 rounded-lg border border-cyan-700 px-3 py-2 text-xs text-cyan-200"><Bookmark className="h-3.5 w-3.5"/>Save search</button></div>
      {homeCollections.length>0&&<div className="space-y-3"><h3 className="font-bold">Curated shelves</h3>{homeCollections.map((c:any)=><div key={c.collection.id} className="rounded-xl border border-violet-700/30 bg-violet-950/10 p-4"><div className="flex justify-between gap-3"><div><b>{c.collection.title}</b><p className="text-xs text-slate-400">{c.collection.description}</p></div><span className="h-fit rounded border border-violet-700 px-2 py-1 text-[10px] text-violet-200">{c.disclosure.source_label.replaceAll('_',' ')} • NOT PAID • NO RANK BOOST</span></div><div className="mt-3 flex flex-wrap gap-2">{c.items.map((i:any)=><span key={i.listing.listing_id} className="rounded border border-slate-700 px-2 py-1 text-xs">{i.listing.title}</span>)}</div></div>)}</div>}
      {searchTruth&&<p className="text-xs text-slate-500">Ranking explainable: {String(searchTruth.ranking_explainable)} • paid placement: {String(searchTruth.paid_placement_supported)} • raw search history persisted: {String(searchTruth.raw_search_history_persisted)}</p>}
      {cards(results)}
      {related.length>0&&<div className="space-y-3"><h3 className="font-bold">Related recommendations</h3>{cards(related,true)}</div>}
    </div>}

    {view==='recommendations'&&<div className="space-y-5"><div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><Car className="h-4 w-4"/><select value={selectedVehicleId} onChange={e=>onSelectVehicle(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{vehicles.map(v=><option key={v.id} value={v.id}>{v.display_name}</option>)}</select><button onClick={()=>void loadRecommendations()} className="rounded-lg border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button><p className="text-xs text-slate-500">Unknown/conflicting/incompatible fitment is not recommended.</p></div>{recommendations.length?cards(recommendations,true):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No current recommendations have positive fitment evidence for this vehicle.</p>}</div>}

    {view==='merchandising'&&<div className="space-y-6">
      {sellerMemberships.length>0&&<div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex items-center gap-2"><Store className="h-4 w-4"/><h3 className="font-bold">Seller storefront shelves</h3></div><div className="flex flex-wrap gap-2"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs">{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select></div><div className="grid gap-2 md:grid-cols-2"><input value={sellerForm.title} onChange={e=>setSellerForm(v=>({...v,title:e.target.value}))} placeholder="Shelf title" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={sellerForm.slug} onChange={e=>setSellerForm(v=>({...v,slug:e.target.value}))} placeholder="shelf-slug" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={sellerForm.description} onChange={e=>setSellerForm(v=>({...v,description:e.target.value}))} placeholder="Description" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs md:col-span-2"/></div><div className="grid gap-2 md:grid-cols-2">{sellerListings.filter((x:any)=>x.listing?.status==='PUBLISHED').map((x:any)=><label key={x.listing.id} className="flex items-center gap-2 rounded border border-slate-800 p-2 text-xs"><input type="checkbox" checked={selectedListingIds.includes(x.listing.id)} onChange={e=>setSelectedListingIds(v=>e.target.checked?[...v,x.listing.id]:v.filter(id=>id!==x.listing.id))}/>{x.product?.title}</label>)}</div><button disabled={busy} onClick={()=>void createSellerCollection()} className="rounded bg-emerald-600 px-3 py-2 text-xs font-semibold">Create disclosed seller shelf</button><div className="space-y-2">{sellerCollections.map((c:any)=><div key={c.collection.id} className="flex justify-between rounded border border-slate-800 p-3 text-xs"><span>{c.collection.title} • {c.items.length} listings</span><span className="text-violet-300">{c.disclosure.source_label} • {c.collection.status}</span></div>)}</div></div>}

      {isAdmin&&<div className="space-y-4 rounded-xl border border-violet-800/40 bg-violet-950/10 p-5"><div className="flex items-center gap-2"><ListFilter className="h-4 w-4"/><h3 className="font-bold">Platform curation</h3></div><div className="grid gap-2 md:grid-cols-2"><input value={platformForm.title} onChange={e=>setPlatformForm(v=>({...v,title:e.target.value}))} placeholder="Collection title" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input value={platformForm.slug} onChange={e=>setPlatformForm(v=>({...v,slug:e.target.value}))} placeholder="collection-slug" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><select value={platformForm.surface} onChange={e=>setPlatformForm(v=>({...v,surface:e.target.value}))} className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option>HOME</option><option>CATEGORY</option></select>{platformForm.surface==='CATEGORY'&&<input value={platformForm.category_code} onChange={e=>setPlatformForm(v=>({...v,category_code:e.target.value}))} placeholder="Category code" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/>}<input value={platformForm.listing_ids} onChange={e=>setPlatformForm(v=>({...v,listing_ids:e.target.value}))} placeholder="Listing IDs, comma separated" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs md:col-span-2"/><input value={platformForm.description} onChange={e=>setPlatformForm(v=>({...v,description:e.target.value}))} placeholder="Description" className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs md:col-span-2"/></div><button disabled={busy} onClick={()=>void createPlatformCollection()} className="rounded bg-violet-700 px-3 py-2 text-xs font-semibold">Create platform-curated shelf</button><div className="space-y-2">{platformCollections.map((c:any)=><div key={c.collection.id} className="flex justify-between rounded border border-violet-900/40 p-3 text-xs"><span>{c.collection.title} • {c.collection.surface} • {c.items.length} listings</span><span className="text-violet-300">{c.disclosure.source_label} • {c.collection.status}</span></div>)}</div></div>}
    </div>}
  </section>;
};
