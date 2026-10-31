import { AuthenticatedActorContext } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { fitmentService } from '../fitment/fitmentService';
import { vehicleService } from '../vehicle/vehicleService';
import { marketplaceTransactionRepository as repo } from './marketplaceTransactionRepository';
import {
  MarketplaceCart, MarketplaceCartDetail, MarketplaceCartItem,
  MarketplaceCheckoutValidation, MarketplaceOrderDetail, MarketplaceOrderItem,
  PlaceMarketplaceOrderInput
} from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function positiveQuantity(value:unknown):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<1||n>999)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'quantity must be an integer from 1 to 999',400);
  return n;
}
function requiredText(value:unknown,field:string,max:number):string{
  const v=String(value||'').trim();
  if(!v)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is required',400);
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is too long',400);
  return v;
}
function optionalText(value:unknown,max:number):string|null{
  if(value===undefined||value===null)return null;
  const v=String(value).trim();
  return v?v.slice(0,max):null;
}

export class MarketplaceTransactionService{
  listMyCarts(actor:AuthenticatedActorContext):MarketplaceCartDetail[]{
    const rows=getDatabase().prepare(
      "SELECT * FROM marketplace_carts WHERE buyer_user_id=? AND status='ACTIVE' ORDER BY updated_at DESC"
    ).all(actor.user_id) as any[];
    return rows.map(r=>repo.detail({
      id:String(r.id),buyer_user_id:String(r.buyer_user_id),store_id:String(r.store_id),
      vehicle_id:r.vehicle_id?String(r.vehicle_id):null,currency:r.currency?String(r.currency):null,
      status:r.status,created_at:String(r.created_at),updated_at:String(r.updated_at)
    }));
  }

  getOrCreateCart(actor:AuthenticatedActorContext,storeId:string,vehicleId?:string|null):MarketplaceCartDetail{
    const store=this.requireActiveStore(storeId);
    let cart=repo.getActiveCart(actor.user_id,store.id);
    if(vehicleId)vehicleService.getVehicleDetails(actor,vehicleId);
    const now=getCurrentUtcIsoString();
    if(!cart){
      cart=repo.createCart({
        id:generateCanonicalId('mcart'),buyer_user_id:actor.user_id,store_id:store.id,
        vehicle_id:vehicleId||null,currency:null,status:'ACTIVE',created_at:now,updated_at:now
      });
      this.event(actor,'marketplace.cart.created',cart.id,{marketplace_cart:cart.id,marketplace_store:store.id},
        {cart_id:cart.id,store_id:store.id});
    }else if(vehicleId!==undefined&&vehicleId!==cart.vehicle_id){
      cart=repo.updateCart({...cart,vehicle_id:vehicleId||null,updated_at:now});
    }
    return repo.detail(cart);
  }

  getCart(actor:AuthenticatedActorContext,cartId:string):MarketplaceCartDetail{
    return repo.detail(this.requireOwnedActiveCart(actor,cartId));
  }

  setCartVehicle(actor:AuthenticatedActorContext,cartId:string,vehicleId:string|null):MarketplaceCartDetail{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    if(vehicleId)vehicleService.getVehicleDetails(actor,vehicleId);
    const updated=repo.updateCart({...cart,vehicle_id:vehicleId,updated_at:getCurrentUtcIsoString()});
    return repo.detail(updated);
  }

  addItem(actor:AuthenticatedActorContext,cartId:string,listingId:string,quantityInput:unknown):MarketplaceCartDetail{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    const quantity=positiveQuantity(quantityInput);
    const listing=this.requirePurchasableListing(listingId);
    if(listing.store_id!==cart.store_id)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'A cart can contain listings from one storefront only',409);
    if(cart.currency&&cart.currency!==listing.currency)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'A cart cannot mix currencies',409);
    this.assertQuantityAvailable(listing,quantity);
    const now=getCurrentUtcIsoString();
    const existing=repo.getCartItemByListing(cart.id,listing.id);
    const item:MarketplaceCartItem={
      id:existing?.id||generateCanonicalId('mcitem'),cart_id:cart.id,listing_id:listing.id,product_id:listing.product_id,
      quantity,unit_price_minor_snapshot:listing.price_minor,currency:listing.currency,
      listing_version_snapshot:listing.version,title_snapshot:listing.title,added_at:existing?.added_at||now,updated_at:now
    };
    repo.upsertCartItem(item);
    if(!cart.currency)repo.updateCart({...cart,currency:listing.currency,updated_at:now});
    this.event(actor,'marketplace.cart.item.updated',cart.id,{marketplace_cart:cart.id,marketplace_listing:listing.id},
      {cart_id:cart.id,listing_id:listing.id,quantity});
    return repo.detail(repo.getCart(cart.id)!);
  }

  updateItemQuantity(actor:AuthenticatedActorContext,cartId:string,itemId:string,quantityInput:unknown):MarketplaceCartDetail{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    const item=repo.getCartItem(cart.id,itemId);
    if(!item)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Cart item not found',404);
    return this.addItem(actor,cart.id,item.listing_id,quantityInput);
  }

  removeItem(actor:AuthenticatedActorContext,cartId:string,itemId:string):MarketplaceCartDetail{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    if(!repo.deleteCartItem(cart.id,itemId))throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Cart item not found',404);
    const detail=repo.detail(cart);
    if(detail.items.length===0&&cart.currency)repo.updateCart({...cart,currency:null,updated_at:getCurrentUtcIsoString()});
    return repo.detail(repo.getCart(cart.id)!);
  }

  validateCheckout(actor:AuthenticatedActorContext,cartId:string):MarketplaceCheckoutValidation{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    const items=repo.listCartItems(cart.id);
    const blocking:string[]=[];
    if(!items.length)blocking.push('Cart is empty.');
    const itemResults=items.map(item=>{
      const reasons:string[]=[];
      let listing:any=null;
      try{listing=this.requirePurchasableListing(item.listing_id);}catch(err){
        reasons.push(err instanceof Error?err.message:'Listing is unavailable.');
      }
      let fitmentStatus:string|null=null,fitmentConfidence:number|null=null,fitmentGuaranteed:false|null=null;
      if(listing){
        if(listing.currency!==item.currency)reasons.push('Listing currency changed.');
        const priceChanged=listing.price_minor!==item.unit_price_minor_snapshot||listing.version!==item.listing_version_snapshot;
        if(priceChanged)reasons.push('Price or listing version changed. Refresh the cart item before checkout.');
        try{this.assertQuantityAvailable(listing,item.quantity);}catch(err){reasons.push(err instanceof Error?err.message:'Requested quantity unavailable.');}
        if(cart.vehicle_id){
          const fitment=fitmentService.evaluateListing(actor,item.listing_id,cart.vehicle_id,false);
          fitmentStatus=fitment.status;fitmentConfidence=fitment.confidence;fitmentGuaranteed=false;
          if(fitment.status==='CONFLICT')reasons.push('Fitment evidence conflicts for the selected vehicle.');
          if(fitment.status==='NOT_COMPATIBLE')reasons.push('The product is explicitly not compatible with the selected vehicle.');
        }
        return {
          cart_item_id:item.id,listing_id:item.listing_id,product_id:item.product_id,quantity:item.quantity,
          available:reasons.length===0,price_changed:priceChanged,latest_unit_price_minor:listing.price_minor,
          latest_listing_version:listing.version,fitment_status:fitmentStatus,fitment_confidence:fitmentConfidence,
          fitment_guaranteed:fitmentGuaranteed,blocking_reasons:reasons
        };
      }
      return {cart_item_id:item.id,listing_id:item.listing_id,product_id:item.product_id,quantity:item.quantity,
        available:false,price_changed:false,latest_unit_price_minor:item.unit_price_minor_snapshot,
        latest_listing_version:item.listing_version_snapshot,fitment_status:null,fitment_confidence:null,
        fitment_guaranteed:null,blocking_reasons:reasons};
    });
    for(const row of itemResults)blocking.push(...row.blocking_reasons.map(x=>row.listing_id+': '+x));
    const requiresFitmentAck=Boolean(cart.vehicle_id&&itemResults.some(row=>
      row.fitment_status&&row.fitment_status!=='CONFIRMED'
    ));
    return {
      valid:blocking.length===0,cart_id:cart.id,vehicle_id:cart.vehicle_id,
      subtotal_minor:items.reduce((sum,x)=>sum+x.unit_price_minor_snapshot*x.quantity,0),currency:cart.currency,
      item_results:itemResults,requires_fitment_acknowledgement:requiresFitmentAck,blocking_reasons:blocking,
      payment_available:false,truth:{payment_capture:false,seller_fulfillment_before_payment:false,inventory_reserved:false}
    };
  }

  placeOrder(actor:AuthenticatedActorContext,cartId:string,input:PlaceMarketplaceOrderInput):MarketplaceOrderDetail{
    const cart=this.requireOwnedActiveCart(actor,cartId);
    const validation=this.validateCheckout(actor,cart.id);
    if(!validation.valid)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Checkout validation failed: '+validation.blocking_reasons.join(' | '),409);
    if(validation.requires_fitment_acknowledgement&&!input.fitment_acknowledged){
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Fitment acknowledgement is required for non-confirmed compatibility states',409);
    }
    const mode=String(input.fulfillment_mode||'');
    if(!['PICKUP','LOCAL_DELIVERY','SHIPPING'].includes(mode))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid fulfillment_mode',400);
    const items=repo.listCartItems(cart.id);
    for(const item of items){
      const listing=this.requirePurchasableListing(item.listing_id);
      if(!listing.fulfillment_modes.includes(mode))throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Selected fulfillment mode is not supported by all cart items',409);
    }
    let deliveryName:string|null=null,deliveryPhone:string|null=null,deliveryAddressJson:string|null=null;
    if(mode!=='PICKUP'){
      deliveryName=requiredText(input.delivery_name,'delivery_name',120);
      deliveryPhone=requiredText(input.delivery_phone,'delivery_phone',40);
      if(!input.delivery_address||typeof input.delivery_address!=='object'||Array.isArray(input.delivery_address)){
        throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'delivery_address is required for delivery/shipping',400);
      }
      deliveryAddressJson=JSON.stringify(input.delivery_address);
      if(deliveryAddressJson.length>4000)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'delivery_address is too large',400);
    }
    const fitments=new Map<string,any>();
    if(cart.vehicle_id){
      for(const item of items){
        fitments.set(item.id,fitmentService.evaluateListing(actor,item.listing_id,cart.vehicle_id,true));
      }
    }
    const now=getCurrentUtcIsoString();
    const orderId=generateCanonicalId('morder');
    const orderNumber='GOS-'+now.slice(0,10).replaceAll('-','')+'-'+orderId.slice(-8).toUpperCase();
    const subtotal=validation.subtotal_minor;
    const order={
      id:orderId,order_number:orderNumber,buyer_user_id:actor.user_id,store_id:cart.store_id,
      vehicle_id:cart.vehicle_id,cart_id:cart.id,status:'AWAITING_PAYMENT' as const,payment_status:'NOT_STARTED' as const,
      currency:validation.currency!,subtotal_minor:subtotal,total_minor:subtotal,fulfillment_mode:mode as any,
      delivery_name:deliveryName,delivery_phone:deliveryPhone,delivery_address_json:deliveryAddressJson,
      fitment_acknowledged:Boolean(input.fitment_acknowledged),
      fitment_acknowledgement_text:optionalText(input.fitment_acknowledgement_text,1000),
      placed_at:now,cancelled_at:null,cancellation_reason:null,created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      const latestCart=repo.getCart(cart.id);
      if(!latestCart||latestCart.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.CONFLICT,'Cart was already checked out',409);
      repo.createOrder(order);
      for(const cartItem of items){
        const listing=this.requirePurchasableListing(cartItem.listing_id);
        if(listing.price_minor!==cartItem.unit_price_minor_snapshot||listing.version!==cartItem.listing_version_snapshot){
          throw new CanonicalAppError(ErrorCode.CONFLICT,'A listing changed during checkout. Refresh the cart and retry.',409);
        }
        this.assertQuantityAvailable(listing,cartItem.quantity);
        const product=getDatabase().prepare('SELECT seller_sku,title FROM marketplace_products WHERE id=?').get(cartItem.product_id) as any;
        const fitment=fitments.get(cartItem.id)||null;
        const orderItem:MarketplaceOrderItem={
          id:generateCanonicalId('moitem'),order_id:order.id,listing_id:listing.id,product_id:listing.product_id,
          seller_sku:String(product.seller_sku),title:String(product.title),quantity:cartItem.quantity,
          unit_price_minor:listing.price_minor,line_total_minor:listing.price_minor*cartItem.quantity,currency:listing.currency,
          listing_version:listing.version,fitment_status:fitment?.status||null,fitment_confidence:fitment?.confidence??null,
          fitment_decision_id:fitment?.id||null,created_at:now
        };
        repo.createOrderItem(orderItem);
        if(listing.inventory_tracking==='QUANTITY'){
          const nextQty=listing.stock_quantity-cartItem.quantity;
          const nextStatus=nextQty===0?'OUT_OF_STOCK':nextQty<=3?'LOW_STOCK':'IN_STOCK';
          const changed=getDatabase().prepare(
            'UPDATE marketplace_listings SET stock_quantity=?,inventory_status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND stock_quantity>=?'
          ).run(nextQty,nextStatus,now,listing.id,listing.version,cartItem.quantity);
          if(Number(changed.changes||0)!==1)throw new CanonicalAppError(ErrorCode.CONFLICT,'Inventory changed during checkout',409);
          repo.createReservation({id:generateCanonicalId('mreserve'),order_id:order.id,listing_id:listing.id,
            quantity:cartItem.quantity,status:'HELD',held_at:now});
          marketplaceRepository.rebuildSearchProjection(listing.id,now);
        }
      }
      repo.updateCart({...cart,status:'CHECKED_OUT',updated_at:now});
      getDatabase().prepare(
        'INSERT INTO marketplace_order_status_history (id,order_id,from_status,to_status,actor_id,actor_type,reason,occurred_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(generateCanonicalId('moh'),order.id,null,'AWAITING_PAYMENT',actor.user_id,actorType(actor),'ORDER_PLACED',now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.order.placed',producer:'garage-os-marketplace-orders',correlation_id:order.id,
        subject_ids:{marketplace_order:order.id,marketplace_store:order.store_id,marketplace_cart:cart.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{order_id:order.id,order_number:order.order_number,status:order.status,payment_status:order.payment_status,
          total_minor:order.total_minor,currency:order.currency,inventory_reserved:true,payment_captured:false}
      }),db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_ORDER_PLACED',
        resource_type:'marketplace_order',resource_id:order.id,correlation_id:order.id,source:'MARKETPLACE_ORDER_API',
        after_state:{order_number:order.order_number,status:order.status,payment_status:order.payment_status,total_minor:order.total_minor,currency:order.currency}},db);
    });
    return repo.orderDetail(repo.getOrder(order.id)!);
  }

  listMyOrders(actor:AuthenticatedActorContext):MarketplaceOrderDetail[]{
    return repo.listBuyerOrders(actor.user_id).map(x=>repo.orderDetail(x));
  }

  getMyOrder(actor:AuthenticatedActorContext,orderId:string):MarketplaceOrderDetail{
    const order=repo.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    return repo.orderDetail(order);
  }

  cancelMyOrder(actor:AuthenticatedActorContext,orderId:string,reasonInput:unknown):MarketplaceOrderDetail{
    const order=repo.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    if(order.status!=='AWAITING_PAYMENT')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only awaiting-payment orders can be cancelled in Sprint 24',409);
    const reason=requiredText(reasonInput,'reason',500);
    const now=getCurrentUtcIsoString();
    withTransaction(({db})=>{
      const reservations=getDatabase().prepare(
        "SELECT * FROM marketplace_inventory_reservations WHERE order_id=? AND status='HELD'"
      ).all(order.id) as any[];
      for(const reservation of reservations){
        const listing=getDatabase().prepare('SELECT * FROM marketplace_listings WHERE id=?').get(reservation.listing_id) as any;
        if(listing&&listing.inventory_tracking==='QUANTITY'){
          const nextQty=Number(listing.stock_quantity||0)+Number(reservation.quantity);
          const nextStatus=nextQty===0?'OUT_OF_STOCK':nextQty<=3?'LOW_STOCK':'IN_STOCK';
          getDatabase().prepare(
            'UPDATE marketplace_listings SET stock_quantity=?,inventory_status=?,version=version+1,updated_at=? WHERE id=?'
          ).run(nextQty,nextStatus,now,listing.id);
          marketplaceRepository.rebuildSearchProjection(String(listing.id),now);
        }
      }
      repo.releaseReservations(order.id,now);
      repo.cancelOrder(order.id,reason,now);
      getDatabase().prepare(
        'INSERT INTO marketplace_order_status_history (id,order_id,from_status,to_status,actor_id,actor_type,reason,occurred_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(generateCanonicalId('moh'),order.id,'AWAITING_PAYMENT','CANCELLED',actor.user_id,actorType(actor),reason,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.order.cancelled',producer:'garage-os-marketplace-orders',correlation_id:order.id,
        subject_ids:{marketplace_order:order.id,marketplace_store:order.store_id},actor_id:actor.user_id,actor_type:actorType(actor),
        provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{order_id:order.id,reason,inventory_released:true,payment_captured:false}
      }),db);
    });
    return repo.orderDetail(repo.getOrder(order.id)!);
  }

  listSellerOrders(actor:AuthenticatedActorContext,storeId:string):MarketplaceOrderDetail[]{
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    return repo.listSellerOrders(storeId).map(x=>repo.orderDetail(x));
  }

  getSellerOrder(actor:AuthenticatedActorContext,storeId:string,orderId:string):MarketplaceOrderDetail{
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    const order=repo.getOrder(orderId);
    if(!order||order.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    return repo.orderDetail(order);
  }

  private requireOwnedActiveCart(actor:AuthenticatedActorContext,cartId:string):MarketplaceCart{
    const cart=repo.getCart(cartId);
    if(!cart||cart.buyer_user_id!==actor.user_id||cart.status!=='ACTIVE'){
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Active cart not found',404);
    }
    return cart;
  }
  private requireActiveStore(storeId:string){
    const row=getDatabase().prepare("SELECT * FROM marketplace_stores WHERE id=? AND status='ACTIVE' LIMIT 1").get(storeId) as any;
    if(!row)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Active marketplace store not found',404);
    return {id:String(row.id),organization_id:String(row.organization_id)};
  }
  private requireManagedStore(actor:AuthenticatedActorContext,storeId:string,permission:CanonicalPermission){
    const row=getDatabase().prepare('SELECT id,organization_id FROM marketplace_stores WHERE id=? LIMIT 1').get(storeId) as any;
    if(!row)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,permission,{organizationId:String(row.organization_id)});
    return row;
  }
  private requirePurchasableListing(listingId:string):any{
    const row=getDatabase().prepare(`
      SELECT l.*,p.title,p.status AS product_status,s.status AS store_status
      FROM marketplace_listings l
      JOIN marketplace_products p ON p.id=l.product_id
      JOIN marketplace_stores s ON s.id=l.store_id
      WHERE l.id=? LIMIT 1
    `).get(listingId) as any;
    if(!row||row.status!=='PUBLISHED'||row.product_status!=='PUBLISHED'||row.store_status!=='ACTIVE'){
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Purchasable marketplace listing not found',404);
    }
    row.fulfillment_modes=JSON.parse(String(row.fulfillment_modes_json||'[]'));
    row.price_minor=Number(row.price_minor);row.version=Number(row.version);
    row.stock_quantity=row.stock_quantity===null?null:Number(row.stock_quantity);
    return row;
  }
  private assertQuantityAvailable(listing:any,quantity:number){
    if(!['IN_STOCK','LOW_STOCK','MADE_TO_ORDER'].includes(String(listing.inventory_status))){
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Listing is not currently available to order',409);
    }
    if(listing.inventory_tracking==='QUANTITY'&&(listing.stock_quantity===null||listing.stock_quantity<quantity)){
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Requested quantity exceeds available stock',409);
    }
  }
  private event(actor:AuthenticatedActorContext,type:string,correlationId:string,subjects:Record<string,string>,payload:Record<string,unknown>){
    enqueueOutboxEvent(createCanonicalEventEnvelope({type,producer:'garage-os-marketplace-orders',correlation_id:correlationId,
      subject_ids:subjects,actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,payload}));
  }
}

export const marketplaceTransactionService=new MarketplaceTransactionService();
