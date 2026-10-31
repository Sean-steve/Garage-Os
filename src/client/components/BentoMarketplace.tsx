import React,{useCallback,useEffect,useMemo,useState} from 'react';
import { Boxes, Building2, PackageSearch, Plus, RefreshCw, ShieldQuestion, Store, Tag } from 'lucide-react';

interface Props{
  actor:any;
  onNotify?:(message:string)=>void;
}
interface Category{id:string;code:string;name:string;parent_id:string|null;}
interface ListingCard{
  listing_id:string;product_id:string;store_id:string;store_slug:string;store_name:string;
  title:string;description:string;category_code:string;category_name:string;product_type:string;
  brand:string|null;condition:string;price_minor:number;compare_at_price_minor:number|null;currency:string;
  inventory_status:string;fulfillment_modes:string[];primary_media_file_id:string|null;
  authenticity_claim:string;authenticity_verification_status:'NOT_VERIFIED';fitment_status:'UNKNOWN';
}
interface ListingDetail extends ListingCard{
  seller_sku:string;manufacturer_part_number:string|null;warranty_summary:string|null;
  media:Array<{id:string;file_object_id:string;media_role:string;alt_text:string|null;is_primary:boolean}>;
  truth:{fitment_confirmed:false;compatibility_status:'UNKNOWN';checkout_available:false;order_creation_available:false;payment_available:false;authenticity_verified:false};
}
interface StoreEntity{
  id:string;organization_id:string;provider_id:string|null;slug:string;display_name:string;
  description:string|null;support_phone:string|null;support_email:string|null;status:string;
}
const unwrap=(v:any)=>v?.data??v;
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat(undefined,{style:'currency',currency}).format(minor/100);}
  catch{return currency+' '+(minor/100).toFixed(2);}
};

export const BentoMarketplace:React.FC<Props>=({actor,onNotify})=>{
  const [mode,setMode]=useState<'SHOP'|'SELLER'>('SHOP');
  const [categories,setCategories]=useState<Category[]>([]);
  const [items,setItems]=useState<ListingCard[]>([]);
  const [total,setTotal]=useState(0);
  const [selected,setSelected]=useState<ListingDetail|null>(null);
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('');
  const [productType,setProductType]=useState('');
  const [inStockOnly,setInStockOnly]=useState(false);
  const [loading,setLoading]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState<string|null>(null);

  const eligibleMemberships=useMemo(()=>(
    Array.isArray(actor?.memberships)?actor.memberships.filter((m:any)=>
      ['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&
      m.status==='ACTIVE'
    ):[]
  ),[actor]);
  const [sellerOrgId,setSellerOrgId]=useState<string>('');
  const [stores,setStores]=useState<StoreEntity[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerProducts,setSellerProducts]=useState<any[]>([]);
  const [sellerListings,setSellerListings]=useState<any[]>([]);
  const [storeForm,setStoreForm]=useState({display_name:'',slug:'',description:''});
  const [productForm,setProductForm]=useState({
    category_id:'',product_type:'PART',seller_sku:'',title:'',description:'',brand:'',
    manufacturer_part_number:'',condition:'NEW',authenticity_claim:'UNKNOWN',warranty_summary:''
  });
  const [listingForm,setListingForm]=useState({
    product_id:'',price_major:'',currency:'KES',inventory_tracking:'QUANTITY',
    stock_quantity:1,fulfillment_modes:['PICKUP'] as string[]
  });

  const notify=(m:string)=>{setMessage(m);onNotify?.(m);};

  const loadCategories=useCallback(async()=>{
    const r=await fetch('/api/v1/marketplace/categories');
    if(r.ok){const j=unwrap(await r.json());setCategories(j.categories||[]);}
  },[]);

  const search=useCallback(async()=>{
    setLoading(true);
    try{
      const p=new URLSearchParams();
      if(query.trim())p.set('query',query.trim());
      if(category)p.set('category',category);
      if(productType)p.set('product_type',productType);
      if(inStockOnly)p.set('in_stock_only','true');
      p.set('limit','50');
      const r=await fetch('/api/v1/marketplace/search?'+p.toString());
      const j=await r.json();
      if(!r.ok)throw new Error(j?.error?.message||'Marketplace search failed');
      const d=unwrap(j);setItems(d.items||[]);setTotal(d.total||0);
    }catch(e){notify(e instanceof Error?e.message:'Marketplace search failed');}
    finally{setLoading(false);}
  },[query,category,productType,inStockOnly]);

  useEffect(()=>{loadCategories();search();},[]);
  useEffect(()=>{
    if(!sellerOrgId&&eligibleMemberships.length)setSellerOrgId(eligibleMemberships[0].organization_id);
  },[eligibleMemberships,sellerOrgId]);

  const loadSeller=useCallback(async()=>{
    if(!sellerOrgId){setStores([]);setStoreId('');return;}
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(sellerOrgId));
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Unable to load seller stores');
      const list=unwrap(j)?.stores||[];setStores(list);
      const chosen=list.find((s:any)=>s.id===storeId)||list[0];
      setStoreId(chosen?.id||'');
      if(chosen){
        const [pr,lr]=await Promise.all([
          fetch('/api/v1/marketplace/seller/stores/'+chosen.id+'/products'),
          fetch('/api/v1/marketplace/seller/stores/'+chosen.id+'/listings')
        ]);
        const pj=await pr.json(),lj=await lr.json();
        if(pr.ok)setSellerProducts(unwrap(pj)?.products||[]);
        if(lr.ok)setSellerListings(unwrap(lj)?.listings||[]);
      }else{setSellerProducts([]);setSellerListings([]);}
    }catch(e){notify(e instanceof Error?e.message:'Unable to load seller workspace');}
    finally{setBusy(false);}
  },[sellerOrgId,storeId]);

  useEffect(()=>{if(mode==='SELLER'&&sellerOrgId)loadSeller();},[mode,sellerOrgId]);

  const openListing=async(id:string)=>{
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/listings/'+id);const j=await r.json();
      if(!r.ok)throw new Error(j?.error?.message||'Listing not found');
      setSelected(unwrap(j));
    }catch(e){notify(e instanceof Error?e.message:'Listing not found');}
    finally{setBusy(false);}
  };

  const createStore=async(e:React.FormEvent)=>{
    e.preventDefault();if(!sellerOrgId)return;
    setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        organization_id:sellerOrgId,display_name:storeForm.display_name,slug:storeForm.slug,description:storeForm.description||null
      })});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Store creation failed');
      const s=unwrap(j);setStoreId(s.id);notify('Storefront created as DRAFT. Activate it only when ready for public discovery.');
      await loadSeller();
    }catch(e){notify(e instanceof Error?e.message:'Store creation failed');}
    finally{setBusy(false);}
  };

  const setStoreStatus=async(status:'ACTIVE'|'PAUSED')=>{
    if(!storeId)return;setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status})});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Store update failed');
      notify('Store status updated to '+status+'.');await loadSeller();await search();
    }catch(e){notify(e instanceof Error?e.message:'Store update failed');}
    finally{setBusy(false);}
  };

  const createProduct=async(e:React.FormEvent)=>{
    e.preventDefault();if(!storeId)return;setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/products',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
        ...productForm,brand:productForm.brand||null,manufacturer_part_number:productForm.manufacturer_part_number||null,
        warranty_summary:productForm.warranty_summary||null
      })});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Product creation failed');
      const p=unwrap(j);setListingForm(v=>({...v,product_id:p.id}));
      notify('Catalog product created. Fitment remains UNKNOWN until Sprint 23 evidence is implemented.');
      await loadSeller();
    }catch(e){notify(e instanceof Error?e.message:'Product creation failed');}
    finally{setBusy(false);}
  };

  const createListing=async(e:React.FormEvent)=>{
    e.preventDefault();if(!storeId||!listingForm.product_id)return;setBusy(true);
    try{
      const price=Number(listingForm.price_major);
      if(!Number.isFinite(price)||price<0)throw new Error('Enter a valid price.');
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/products/'+listingForm.product_id+'/listing',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
          price_minor:Math.round(price*100),currency:listingForm.currency,
          inventory_tracking:listingForm.inventory_tracking,
          stock_quantity:listingForm.inventory_tracking==='QUANTITY'?Number(listingForm.stock_quantity):null,
          fulfillment_modes:listingForm.fulfillment_modes
        })
      });
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Listing creation failed');
      notify('Listing created as DRAFT. No checkout/order exists in Sprint 22.');await loadSeller();
    }catch(e){notify(e instanceof Error?e.message:'Listing creation failed');}
    finally{setBusy(false);}
  };

  const publish=async(listingId:string)=>{
    if(!storeId)return;setBusy(true);
    try{
      const r=await fetch('/api/v1/marketplace/seller/stores/'+storeId+'/listings/'+listingId+'/publish',{method:'POST'});
      const j=await r.json();if(!r.ok)throw new Error(j?.error?.message||'Publish failed');
      notify('Listing published. Compatibility is still UNKNOWN and authenticity is not verified.');await loadSeller();await search();
    }catch(e){notify(e instanceof Error?e.message:'Publish failed');}
    finally{setBusy(false);}
  };

  const activeStore=stores.find(s=>s.id===storeId);

  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex gap-4">
          <div className="h-12 w-12 rounded-xl bg-violet-500/15 text-violet-300 flex items-center justify-center"><Store className="h-6 w-6"/></div>
          <div><h2 className="text-xl font-bold">Automotive Marketplace</h2><p className="text-sm text-slate-400 mt-1">Browse parts, tyres, accessories and automotive goods from Garage OS sellers.</p></div>
        </div>
        <div className="flex gap-2">
          <button onClick={()=>setMode('SHOP')} className={'rounded-lg px-3 py-2 text-xs border '+(mode==='SHOP'?'border-violet-500 bg-violet-500/15':'border-slate-700')}>Shop</button>
          <button onClick={()=>setMode('SELLER')} className={'rounded-lg px-3 py-2 text-xs border '+(mode==='SELLER'?'border-violet-500 bg-violet-500/15':'border-slate-700')}>Seller Studio</button>
        </div>
      </div>
      <div className="mt-4 rounded-xl border border-amber-900/50 bg-amber-950/15 p-4 text-xs text-amber-200">
        Sprint 22 foundation: vehicle fitment is not yet evaluated. “Compatibility: UNKNOWN” is intentional. Checkout, orders and payments are not available until their owning sprint.
      </div>
    </div>
    {message&&<div className="rounded-xl border border-slate-700 bg-slate-900 p-3 text-sm">{message}</div>}

    {mode==='SHOP'&&<>
      <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 grid gap-3 md:grid-cols-5">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products…" className="md:col-span-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <select value={category} onChange={e=>setCategory(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">All categories</option>{categories.map(c=><option key={c.id} value={c.code}>{c.name}</option>)}</select>
        <select value={productType} onChange={e=>setProductType(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">All goods</option>{['PART','TYRE','ACCESSORY','CONSUMABLE','TOOL','ELECTRONICS','OTHER'].map(x=><option key={x}>{x}</option>)}</select>
        <button onClick={search} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold flex justify-center items-center gap-2"><PackageSearch className="h-4 w-4"/>Search</button>
        <label className="md:col-span-5 flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={inStockOnly} onChange={e=>setInStockOnly(e.target.checked)}/>Show available-stock / made-to-order listings only</label>
      </div>
      <div className="flex justify-between text-xs text-slate-500"><span>{total} published listing(s)</span><button onClick={search} className="flex gap-1 items-center"><RefreshCw className="h-3 w-3"/>Refresh</button></div>
      {loading?<div className="rounded-xl border border-slate-800 p-8 text-sm text-slate-500">Searching marketplace…</div>:items.length===0?<div className="rounded-xl border border-slate-800 p-8 text-sm text-slate-500">No published marketplace listings match these filters.</div>:<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map(i=><button key={i.listing_id} onClick={()=>openListing(i.listing_id)} className="text-left rounded-xl border border-slate-800 bg-slate-900/50 p-5 hover:border-slate-700">
        <div className="flex justify-between gap-3"><span className="text-[10px] text-violet-300 uppercase">{i.category_name}</span><span className="text-[10px] text-slate-500">{i.inventory_status.replaceAll('_',' ')}</span></div>
        <h3 className="font-semibold mt-2">{i.title}</h3><p className="text-xs text-slate-500 mt-1">{i.brand||'Brand not specified'} • {i.condition}</p>
        <p className="text-lg font-bold mt-4">{money(i.price_minor,i.currency)}</p>
        <div className="mt-4 flex flex-wrap gap-2"><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px]">Fitment: UNKNOWN</span><span className="rounded-full border border-slate-700 px-2 py-1 text-[10px]">Authenticity: NOT VERIFIED</span></div>
        <p className="text-[10px] text-slate-500 mt-3">Sold by {i.store_name}</p>
      </button>)}</div>}

      {selected&&<div className="rounded-2xl border border-slate-700 bg-slate-900 p-6">
        <div className="flex justify-between gap-4"><div><p className="text-xs text-violet-300">{selected.category_name}</p><h3 className="text-xl font-bold mt-1">{selected.title}</h3></div><button onClick={()=>setSelected(null)} className="text-xs text-slate-400">Close</button></div>
        <p className="text-sm text-slate-400 mt-3">{selected.description}</p><p className="text-2xl font-bold mt-4">{money(selected.price_minor,selected.currency)}</p>
        <div className="grid gap-3 md:grid-cols-2 mt-5 text-xs">
          <div className="rounded-lg border border-slate-800 p-3"><span className="text-slate-500">Seller SKU</span><p className="mt-1">{selected.seller_sku}</p></div>
          <div className="rounded-lg border border-slate-800 p-3"><span className="text-slate-500">Part number</span><p className="mt-1">{selected.manufacturer_part_number||'Not specified'}</p></div>
          <div className="rounded-lg border border-amber-900/50 p-3"><span className="text-amber-300">Vehicle compatibility</span><p className="mt-1 font-semibold">UNKNOWN — not evaluated yet</p></div>
          <div className="rounded-lg border border-amber-900/50 p-3"><span className="text-amber-300">Authenticity</span><p className="mt-1">Seller claim: {selected.authenticity_claim.replaceAll('_',' ')} • NOT VERIFIED</p></div>
        </div>
        {selected.warranty_summary&&<div className="mt-4 rounded-lg border border-slate-800 p-3 text-xs"><span className="text-slate-500">Seller warranty summary</span><p className="mt-1">{selected.warranty_summary}</p></div>}
        <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950/40 p-4 text-xs text-slate-400 flex gap-2"><ShieldQuestion className="h-4 w-4 shrink-0"/>No order, payment or checkout action exists in Sprint 22. Listing details are discovery/catalog information only.</div>
      </div>}
    </>}

    {mode==='SELLER'&&<div className="space-y-6">
      {eligibleMemberships.length===0?<div className="rounded-xl border border-slate-800 p-6 text-sm text-slate-500">Your account has no active marketplace-seller, garage or automotive-service organization membership.</div>:<>
        <div className="rounded-xl border border-slate-800 p-4">
          <label className="text-xs text-slate-400">Seller organization<select value={sellerOrgId} onChange={e=>{setSellerOrgId(e.target.value);setStoreId('');}} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2">{eligibleMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name} • {m.role}</option>)}</select></label>
        </div>

        {stores.length===0?<form onSubmit={createStore} className="rounded-xl border border-slate-800 p-5 space-y-3">
          <h3 className="font-bold flex items-center gap-2"><Building2 className="h-4 w-4"/>Create storefront</h3>
          <input required placeholder="Store display name" value={storeForm.display_name} onChange={e=>setStoreForm({...storeForm,display_name:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
          <input required placeholder="store-slug" value={storeForm.slug} onChange={e=>setStoreForm({...storeForm,slug:e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
          <textarea placeholder="Store description" value={storeForm.description} onChange={e=>setStoreForm({...storeForm,description:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
          <button disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold">Create draft store</button>
        </form>:<>
          <div className="rounded-xl border border-slate-800 p-5">
            <div className="flex justify-between gap-4 flex-wrap"><div><p className="text-xs text-slate-500">Storefront</p><h3 className="font-bold mt-1">{activeStore?.display_name}</h3><p className="text-xs text-slate-500 mt-1">/{activeStore?.slug} • {activeStore?.status}</p></div><div className="flex gap-2">{activeStore?.status!=='ACTIVE'&&<button disabled={busy} onClick={()=>setStoreStatus('ACTIVE')} className="rounded-lg bg-emerald-700 px-3 py-2 text-xs">Activate store</button>}{activeStore?.status==='ACTIVE'&&<button disabled={busy} onClick={()=>setStoreStatus('PAUSED')} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Pause store</button>}</div></div>
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <form onSubmit={createProduct} className="rounded-xl border border-slate-800 p-5 space-y-3">
              <h3 className="font-bold flex gap-2 items-center"><Boxes className="h-4 w-4"/>Add catalog product</h3>
              <select required value={productForm.category_id} onChange={e=>setProductForm({...productForm,category_id:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Choose category</option>{categories.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <div className="grid grid-cols-2 gap-3"><select value={productForm.product_type} onChange={e=>setProductForm({...productForm,product_type:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{['PART','TYRE','ACCESSORY','CONSUMABLE','TOOL','ELECTRONICS','OTHER'].map(x=><option key={x}>{x}</option>)}</select><select value={productForm.condition} onChange={e=>setProductForm({...productForm,condition:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm">{['NEW','USED','REMANUFACTURED'].map(x=><option key={x}>{x}</option>)}</select></div>
              <input required placeholder="Seller SKU" value={productForm.seller_sku} onChange={e=>setProductForm({...productForm,seller_sku:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <input required placeholder="Product title" value={productForm.title} onChange={e=>setProductForm({...productForm,title:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <textarea required placeholder="Description" value={productForm.description} onChange={e=>setProductForm({...productForm,description:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <div className="grid grid-cols-2 gap-3"><input placeholder="Brand" value={productForm.brand} onChange={e=>setProductForm({...productForm,brand:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input placeholder="Manufacturer part no." value={productForm.manufacturer_part_number} onChange={e=>setProductForm({...productForm,manufacturer_part_number:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></div>
              <select value={productForm.authenticity_claim} onChange={e=>setProductForm({...productForm,authenticity_claim:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="UNKNOWN">Authenticity unknown</option><option value="SELLER_CLAIMED_OEM">Seller claims OEM</option><option value="SELLER_CLAIMED_AFTERMARKET">Seller claims aftermarket</option><option value="GENERIC">Generic</option></select>
              <textarea placeholder="Warranty summary (seller-provided)" value={productForm.warranty_summary} onChange={e=>setProductForm({...productForm,warranty_summary:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
              <p className="text-[10px] text-amber-300">Do not enter vehicle compatibility in title/metadata as a verified claim. Sprint 23 owns structured fitment.</p>
              <button disabled={busy} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold flex gap-2 items-center"><Plus className="h-4 w-4"/>Create product</button>
            </form>

            <form onSubmit={createListing} className="rounded-xl border border-slate-800 p-5 space-y-3">
              <h3 className="font-bold flex gap-2 items-center"><Tag className="h-4 w-4"/>Create listing</h3>
              <select required value={listingForm.product_id} onChange={e=>setListingForm({...listingForm,product_id:e.target.value})} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Choose product</option>{sellerProducts.filter(p=>p.status!=='RETIRED').map(p=><option key={p.id} value={p.id}>{p.seller_sku} • {p.title}</option>)}</select>
              <div className="grid grid-cols-2 gap-3"><input required type="number" min="0" step="0.01" placeholder="Price" value={listingForm.price_major} onChange={e=>setListingForm({...listingForm,price_major:e.target.value})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/><input value={listingForm.currency} maxLength={3} onChange={e=>setListingForm({...listingForm,currency:e.target.value.toUpperCase()})} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></div>
              <label className="text-xs text-slate-400">Stock quantity<input type="number" min={0} value={listingForm.stock_quantity} onChange={e=>setListingForm({...listingForm,stock_quantity:Number(e.target.value)})} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/></label>
              <div><p className="text-xs text-slate-400 mb-2">Fulfillment</p><div className="flex flex-wrap gap-2">{['PICKUP','LOCAL_DELIVERY','SHIPPING'].map(x=>{const active=listingForm.fulfillment_modes.includes(x);return <button type="button" key={x} onClick={()=>setListingForm({...listingForm,fulfillment_modes:active?listingForm.fulfillment_modes.filter(v=>v!==x):[...listingForm.fulfillment_modes,x]})} className={'rounded-full border px-3 py-1.5 text-[11px] '+(active?'border-violet-500 bg-violet-500/15':'border-slate-700')}>{x.replaceAll('_',' ')}</button>})}</div></div>
              <button disabled={busy||!listingForm.product_id} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold">Create draft listing</button>
            </form>
          </div>

          <div className="rounded-xl border border-slate-800 p-5">
            <h3 className="font-bold">Seller listings</h3>
            <div className="mt-3 space-y-3">{sellerListings.length?sellerListings.map((row:any)=><div key={row.listing.id} className="rounded-lg border border-slate-800 bg-slate-950/30 p-4 flex justify-between gap-4 flex-wrap"><div><p className="font-semibold">{row.product?.title||row.listing.product_id}</p><p className="text-xs text-slate-500 mt-1">{money(row.listing.price_minor,row.listing.currency)} • {row.listing.inventory_status} • {row.listing.status}</p><p className="text-[10px] text-amber-300 mt-1">Fitment UNKNOWN • authenticity NOT VERIFIED</p></div>{row.listing.status!=='PUBLISHED'&&row.listing.status!=='RETIRED'&&<button disabled={busy||activeStore?.status!=='ACTIVE'} onClick={()=>publish(row.listing.id)} className="rounded-lg border border-emerald-800 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40">Publish</button>}</div>):<p className="text-sm text-slate-500">No listings yet.</p>}</div>
          </div>
        </>}
      </>}
    </div>}
  </section>;
};
