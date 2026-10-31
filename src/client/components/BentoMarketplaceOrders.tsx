import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Package, RefreshCw, ShoppingCart, Store, Trash2, XCircle } from 'lucide-react';
import { VehicleSummary } from '../types';

interface Props{
  actor:any;
  vehicles:VehicleSummary[];
  selectedVehicleId:string;
  onSelectVehicle:(id:string)=>void;
  onNotify:(message:string)=>void;
}

const vehicleId=(v:any)=>String(v?.vehicle_id||v?.id||'');
const money=(minor:number,currency:string)=>{
  try{return new Intl.NumberFormat('en-KE',{style:'currency',currency}).format(Number(minor||0)/100);}
  catch{return currency+' '+(Number(minor||0)/100).toFixed(2);}
};

export const BentoMarketplaceOrders:React.FC<Props>=({actor,vehicles,selectedVehicleId,onSelectVehicle,onNotify})=>{
  const [view,setView]=useState<'shop'|'carts'|'orders'|'seller'>('shop');
  const [busy,setBusy]=useState(false);
  const [query,setQuery]=useState('');
  const [listings,setListings]=useState<any[]>([]);
  const [carts,setCarts]=useState<any[]>([]);
  const [orders,setOrders]=useState<any[]>([]);
  const [validations,setValidations]=useState<Record<string,any>>({});
  const [fulfillment,setFulfillment]=useState<Record<string,string>>({});
  const [acks,setAcks]=useState<Record<string,boolean>>({});
  const [delivery,setDelivery]=useState<Record<string,{name:string;phone:string;address:string;city:string}>>({});

  const sellerMemberships=useMemo(()=>Array.isArray(actor?.memberships)
    ?actor.memberships.filter((m:any)=>['MARKETPLACE_SELLER','AUTOMOTIVE_SERVICE_PROVIDER','GARAGE'].includes(m.organization_type)&&m.status==='ACTIVE')
    :[],[actor]);
  const [organizationId,setOrganizationId]=useState('');
  const [stores,setStores]=useState<any[]>([]);
  const [storeId,setStoreId]=useState('');
  const [sellerOrders,setSellerOrders]=useState<any[]>([]);

  useEffect(()=>{if(!organizationId&&sellerMemberships.length)setOrganizationId(sellerMemberships[0].organization_id);},[organizationId,sellerMemberships]);

  const fetchShop=useCallback(async()=>{
    const params=new URLSearchParams({limit:'30'});
    if(query.trim())params.set('query',query.trim());
    const res=await fetch('/api/v1/marketplace/search?'+params.toString());
    if(!res.ok)return;
    const json=await res.json();setListings((json.data||json).items||[]);
  },[query]);
  const fetchCarts=useCallback(async()=>{
    const res=await fetch('/api/v1/marketplace/carts');if(!res.ok)return;
    const json=await res.json();setCarts((json.data||json).carts||[]);
  },[]);
  const fetchOrders=useCallback(async()=>{
    const res=await fetch('/api/v1/marketplace/orders');if(!res.ok)return;
    const json=await res.json();setOrders((json.data||json).orders||[]);
  },[]);

  useEffect(()=>{if(view==='shop')void fetchShop();if(view==='carts')void fetchCarts();if(view==='orders')void fetchOrders();},[view,fetchShop,fetchCarts,fetchOrders]);

  const fetchStores=useCallback(async()=>{
    if(!organizationId){setStores([]);setStoreId('');return;}
    const res=await fetch('/api/v1/marketplace/seller/stores?organization_id='+encodeURIComponent(organizationId));
    if(!res.ok)return;const json=await res.json();const list=(json.data||json).stores||[];
    setStores(list);setStoreId(current=>current&&list.some((s:any)=>s.id===current)?current:(list[0]?.id||''));
  },[organizationId]);
  useEffect(()=>{if(view==='seller')void fetchStores();},[view,fetchStores]);

  const fetchSellerOrders=useCallback(async()=>{
    if(!storeId){setSellerOrders([]);return;}
    const res=await fetch('/api/v1/marketplace/seller/stores/'+encodeURIComponent(storeId)+'/orders');
    if(!res.ok)return;const json=await res.json();setSellerOrders((json.data||json).orders||[]);
  },[storeId]);
  useEffect(()=>{if(view==='seller')void fetchSellerOrders();},[view,fetchSellerOrders]);

  async function addToCart(item:any){
    setBusy(true);
    try{
      const cartRes=await fetch('/api/v1/marketplace/carts',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({store_id:item.store_id,vehicle_id:selectedVehicleId||null})});
      const cartJson=await cartRes.json();if(!cartRes.ok)throw new Error(cartJson?.error?.message||'Could not create cart');
      const cart=(cartJson.data||cartJson).cart;
      const itemRes=await fetch('/api/v1/marketplace/carts/'+cart.id+'/items',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({listing_id:item.listing_id,quantity:1})});
      const itemJson=await itemRes.json();if(!itemRes.ok)throw new Error(itemJson?.error?.message||'Could not add item');
      onNotify('Added to cart for '+item.store_name+'.');
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  async function updateQuantity(cartId:string,itemId:string,quantity:number){
    if(quantity<1)return;
    const res=await fetch('/api/v1/marketplace/carts/'+cartId+'/items/'+itemId,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({quantity})});
    const json=await res.json();if(!res.ok){onNotify(json?.error?.message||'Could not update quantity');return;}await fetchCarts();
  }
  async function removeItem(cartId:string,itemId:string){
    await fetch('/api/v1/marketplace/carts/'+cartId+'/items/'+itemId,{method:'DELETE'});await fetchCarts();
  }
  async function validate(cartId:string){
    setBusy(true);
    try{
      const res=await fetch('/api/v1/marketplace/carts/'+cartId+'/validate-checkout',{method:'POST'});
      const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Validation failed');
      setValidations(v=>({...v,[cartId]:json.data||json}));
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }
  async function placeOrder(cart:any){
    const cartId=cart.cart.id;
    const validation=validations[cartId]||null;
    if(!validation){onNotify('Validate checkout first.');return;}
    const mode=fulfillment[cartId]||'PICKUP';
    const d=delivery[cartId]||{name:'',phone:'',address:'',city:''};
    const payload:any={fulfillment_mode:mode,fitment_acknowledged:Boolean(acks[cartId])};
    if(mode!=='PICKUP'){
      payload.delivery_name=d.name;payload.delivery_phone=d.phone;
      payload.delivery_address={address_line:d.address,city:d.city,country:'KE'};
    }
    setBusy(true);
    try{
      const res=await fetch('/api/v1/marketplace/carts/'+cartId+'/place-order',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Order placement failed');
      onNotify('Order placed. Payment is still required before seller fulfillment.');
      setView('orders');await fetchOrders();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }
  async function cancelOrder(orderId:string){
    setBusy(true);
    try{
      const res=await fetch('/api/v1/marketplace/orders/'+orderId+'/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'Buyer cancelled before payment'})});
      const json=await res.json();if(!res.ok)throw new Error(json?.error?.message||'Cancellation failed');
      onNotify('Order cancelled and reserved inventory released.');await fetchOrders();
    }catch(err){onNotify((err as Error).message);}finally{setBusy(false);}
  }

  const nav=[['shop','Shop'],['carts','Carts'],['orders','My Orders'],['seller','Seller Orders']] as const;
  return <section className="space-y-6">
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-emerald-300"><ShoppingCart className="h-4 w-4"/>Sprint 24</div><h2 className="mt-2 text-2xl font-bold">Marketplace Transactions & Orders</h2><p className="mt-2 max-w-3xl text-sm text-slate-400">Durable carts, checkout validation, order snapshots and inventory holds. Orders stop at awaiting payment until the payment authority is implemented.</p></div>
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">{nav.map(([id,label])=><button key={id} onClick={()=>setView(id)} className={'rounded-lg px-3 py-2 text-xs font-semibold '+(view===id?'bg-emerald-500/15 text-emerald-200':'text-slate-400')}>{label}</button>)}</div>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-100"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300"/><p>No payment has been captured in Sprint 24. Seller fulfillment remains unavailable while an order is <b>AWAITING_PAYMENT</b>.</p></div>
    </div>

    {view==='shop'&&<div className="space-y-4">
      <div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search marketplace…" className="min-w-[240px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"/>
        <select value={selectedVehicleId} onChange={e=>onSelectVehicle(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">No vehicle context</option>{vehicles.map((v:any)=><option key={vehicleId(v)} value={vehicleId(v)}>{v.display_name||v.make+' '+v.model} • {v.model_year}</option>)}</select>
        <button onClick={()=>void fetchShop()} className="rounded-lg border border-slate-700 px-4 py-2 text-sm">Search</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{listings.map(item=><article key={item.listing_id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><p className="text-[10px] uppercase tracking-wider text-slate-500">{item.store_name} • {item.category_name}</p><h3 className="mt-2 font-bold">{item.title}</h3><p className="mt-2 text-sm text-slate-400 line-clamp-2">{item.description}</p><div className="mt-4 flex items-end justify-between gap-3"><div><p className="text-lg font-bold">{money(item.price_minor,item.currency)}</p><p className="text-[10px] text-slate-500">{item.inventory_status}</p></div><button disabled={busy} onClick={()=>void addToCart(item)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold disabled:opacity-40">Add to cart</button></div></article>)}</div>
    </div>}

    {view==='carts'&&<div className="space-y-5">{carts.length?carts.map((detail:any)=>{
      const cart=detail.cart;const validation=validations[cart.id];const mode=fulfillment[cart.id]||'PICKUP';const d=delivery[cart.id]||{name:'',phone:'',address:'',city:''};
      return <article key={cart.id} className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-bold">Store cart • {cart.store_id}</h3><p className="mt-1 text-xs text-slate-500">{detail.items.length} item(s) • {cart.vehicle_id?'Vehicle-aware checkout':'No vehicle context'}</p></div><p className="text-lg font-bold">{cart.currency?money(detail.subtotal_minor,cart.currency):'Empty'}</p></div>
        <div className="mt-4 space-y-2">{detail.items.map((item:any)=><div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/40 p-3"><div><p className="text-sm font-semibold">{item.title_snapshot}</p><p className="text-[10px] text-slate-500">{money(item.unit_price_minor_snapshot,item.currency)} each • listing v{item.listing_version_snapshot}</p></div><div className="flex items-center gap-2"><button onClick={()=>void updateQuantity(cart.id,item.id,item.quantity-1)} className="rounded border border-slate-700 px-2">−</button><span className="text-xs">{item.quantity}</span><button onClick={()=>void updateQuantity(cart.id,item.id,item.quantity+1)} className="rounded border border-slate-700 px-2">+</button><button onClick={()=>void removeItem(cart.id,item.id)} className="ml-2 text-rose-300"><Trash2 className="h-4 w-4"/></button></div></div>)}</div>
        <div className="mt-4 flex flex-wrap gap-3"><button disabled={busy||!detail.items.length} onClick={()=>void validate(cart.id)} className="rounded-lg border border-cyan-700 px-4 py-2 text-xs text-cyan-200">Validate checkout</button><select value={mode} onChange={e=>setFulfillment(v=>({...v,[cart.id]:e.target.value}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"><option value="PICKUP">Pickup</option><option value="LOCAL_DELIVERY">Local delivery</option><option value="SHIPPING">Shipping</option></select></div>
        {mode!=='PICKUP'&&<div className="mt-3 grid gap-2 md:grid-cols-2"><input placeholder="Recipient name" value={d.name} onChange={e=>setDelivery(v=>({...v,[cart.id]:{...d,name:e.target.value}}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input placeholder="Phone" value={d.phone} onChange={e=>setDelivery(v=>({...v,[cart.id]:{...d,phone:e.target.value}}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input placeholder="Address" value={d.address} onChange={e=>setDelivery(v=>({...v,[cart.id]:{...d,address:e.target.value}}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/><input placeholder="City" value={d.city} onChange={e=>setDelivery(v=>({...v,[cart.id]:{...d,city:e.target.value}}))} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs"/></div>}
        {validation&&<div className={'mt-4 rounded-xl border p-4 text-xs '+(validation.valid?'border-emerald-500/20 bg-emerald-500/5':'border-rose-500/20 bg-rose-500/5')}><div className="flex items-center gap-2">{validation.valid?<CheckCircle2 className="h-4 w-4 text-emerald-300"/>:<XCircle className="h-4 w-4 text-rose-300"/>}<b>{validation.valid?'Checkout facts validated':'Checkout blocked'}</b></div>{validation.blocking_reasons?.length>0&&<ul className="mt-2 list-disc pl-5 text-rose-200">{validation.blocking_reasons.map((x:string)=><li key={x}>{x}</li>)}</ul>}{validation.requires_fitment_acknowledgement&&<label className="mt-3 flex items-start gap-2 text-amber-100"><input type="checkbox" checked={Boolean(acks[cart.id])} onChange={e=>setAcks(v=>({...v,[cart.id]:e.target.checked}))}/>I acknowledge that compatibility is not confirmed for every item and will verify specifications before installation.</label>}<button disabled={busy||!validation.valid||(validation.requires_fitment_acknowledgement&&!acks[cart.id])} onClick={()=>void placeOrder(detail)} className="mt-3 rounded-lg bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-40">Place awaiting-payment order</button></div>}
      </article>
    }):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No active carts.</p>}</div>}

    {view==='orders'&&<div className="space-y-4">{orders.length?orders.map((detail:any)=><article key={detail.order.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex flex-wrap justify-between gap-4"><div><p className="text-[10px] uppercase tracking-wider text-slate-500">{detail.order.order_number}</p><h3 className="mt-1 font-bold">{detail.order.status.replaceAll('_',' ')}</h3><p className="mt-1 text-xs text-amber-300">Payment: {detail.order.payment_status.replaceAll('_',' ')} • capture unavailable</p></div><p className="text-lg font-bold">{money(detail.order.total_minor,detail.order.currency)}</p></div><div className="mt-4 space-y-2">{detail.items.map((item:any)=><div key={item.id} className="flex justify-between gap-3 text-xs"><span>{item.quantity} × {item.title}</span><span>{money(item.line_total_minor,item.currency)}</span></div>)}</div>{detail.order.status==='AWAITING_PAYMENT'&&<button disabled={busy} onClick={()=>void cancelOrder(detail.order.id)} className="mt-4 rounded-lg border border-rose-800 px-3 py-2 text-xs text-rose-300">Cancel before payment</button>}</article>):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No marketplace orders yet.</p>}</div>}

    {view==='seller'&&<div className="space-y-4"><div className="flex flex-wrap gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4"><select value={organizationId} onChange={e=>setOrganizationId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Organization</option>{sellerMemberships.map((m:any)=><option key={m.organization_id} value={m.organization_id}>{m.organization_name}</option>)}</select><select value={storeId} onChange={e=>setStoreId(e.target.value)} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm"><option value="">Store</option>{stores.map(s=><option key={s.id} value={s.id}>{s.display_name}</option>)}</select><button onClick={()=>void fetchSellerOrders()} className="rounded-lg border border-slate-700 px-3 py-2"><RefreshCw className="h-4 w-4"/></button></div>{sellerOrders.length?sellerOrders.map((detail:any)=><article key={detail.order.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-5"><div className="flex justify-between gap-4"><div><p className="text-[10px] text-slate-500">{detail.order.order_number}</p><h3 className="mt-1 font-bold">{detail.order.status.replaceAll('_',' ')}</h3><p className="mt-1 text-xs text-slate-400">{detail.items.length} line(s) • {detail.order.fulfillment_mode.replaceAll('_',' ')}</p></div><div className="text-right"><p className="font-bold">{money(detail.order.total_minor,detail.order.currency)}</p><span className="mt-2 inline-flex rounded-full border border-amber-500/30 px-2 py-1 text-[10px] text-amber-300">FULFILLMENT LOCKED — PAYMENT NOT AUTHORITATIVE</span></div></div></article>):<p className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">No orders for this storefront.</p>}</div>}
  </section>;
};
