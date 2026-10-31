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
import { marketplaceTransactionRepository } from '../marketplaceTransactions/marketplaceTransactionRepository';
import { marketplacePaymentRepository } from '../marketplacePayments/marketplacePaymentRepository';
import { marketplacePaymentService } from '../marketplacePayments/marketplacePaymentService';
import { marketplaceFulfillmentRepository as repo } from './marketplaceFulfillmentRepository';
import {
  MarketplaceFulfillment, MarketplaceFulfillmentEventSource, MarketplaceReturn,
  MarketplaceReturnCondition, MarketplaceReturnItem
} from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
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
function qty(value:unknown,field:string):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0||n>999)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be an integer from 0 to 999',400);
  return n;
}

export class MarketplaceFulfillmentService{
  listBuyerFulfillments(actor:AuthenticatedActorContext){
    const rows=getDatabase().prepare(`
      SELECT f.* FROM marketplace_fulfillments f
      JOIN marketplace_orders o ON o.id=f.order_id
      WHERE o.buyer_user_id=? ORDER BY f.created_at DESC
    `).all(actor.user_id) as any[];
    return rows.map(r=>repo.detail(repo.getFulfillment(String(r.id))!,marketplacePaymentRepository.financialSummary(String(r.order_id))));
  }

  getBuyerFulfillment(actor:AuthenticatedActorContext,orderId:string){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    const fulfillment=repo.getByOrder(order.id);
    return fulfillment?repo.detail(fulfillment,marketplacePaymentRepository.financialSummary(order.id)):null;
  }

  listSellerFulfillments(actor:AuthenticatedActorContext,storeId:string){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    return repo.listByStore(storeId).map(f=>repo.detail(f,marketplacePaymentRepository.financialSummary(f.order_id)));
  }

  startFulfillment(actor:AuthenticatedActorContext,storeId:string,orderId:string,input:any){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const order=this.requireStoreOrder(storeId,orderId);
    const existing=repo.getByOrder(order.id);
    if(existing)return repo.detail(existing,marketplacePaymentRepository.financialSummary(order.id));
    const financial=marketplacePaymentRepository.financialSummary(order.id);
    if(financial.captured_minor<order.total_minor||financial.refunded_minor>0||financial.commercial_status!=='PAID'){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Fulfillment requires a fully captured, non-refunded order',409);
    }
    const now=getCurrentUtcIsoString();
    const value:MarketplaceFulfillment={
      id:generateCanonicalId('mfulfill'),order_id:order.id,store_id:order.store_id,fulfillment_mode:order.fulfillment_mode,
      status:'PREPARING',carrier_name:null,service_level:null,tracking_reference:null,
      seller_notes:optionalText(input?.seller_notes,1000),prepared_at:now,ready_at:null,dispatched_at:null,
      delivery_reported_at:null,completed_at:null,created_by:actor.user_id,created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createFulfillment(value);
      this.recordEvent(value,'FULFILLMENT_STARTED','SELLER_RECORDED',actor.user_id,{mode:value.fulfillment_mode},now,db);
      this.outbox(actor,'marketplace.fulfillment.started',value.id,order.store_id,order.id,
        {fulfillment_id:value.id,order_id:order.id,status:value.status,fulfillment_mode:value.fulfillment_mode,payment_authoritative:true},db);
    });
    return repo.detail(value,financial);
  }

  markReady(actor:AuthenticatedActorContext,storeId:string,fulfillmentId:string,input:any){
    const f=this.requireSellerFulfillment(actor,storeId,fulfillmentId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    if(f.status!=='PREPARING')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only PREPARING fulfillment can become ready for handoff',409);
    const now=getCurrentUtcIsoString();
    const next={...f,status:'READY_FOR_HANDOFF' as const,ready_at:now,
      seller_notes:input?.seller_notes===undefined?f.seller_notes:optionalText(input.seller_notes,1000),updated_at:now};
    withTransaction(({db})=>{
      repo.updateFulfillment(next);
      this.recordEvent(next,'READY_FOR_HANDOFF','SELLER_RECORDED',actor.user_id,{mode:next.fulfillment_mode},now,db);
      this.outbox(actor,'marketplace.fulfillment.ready',next.id,next.store_id,next.order_id,
        {fulfillment_id:next.id,order_id:next.order_id,status:next.status},db);
    });
    return repo.detail(next,marketplacePaymentRepository.financialSummary(next.order_id));
  }

  dispatch(actor:AuthenticatedActorContext,storeId:string,fulfillmentId:string,input:any){
    const f=this.requireSellerFulfillment(actor,storeId,fulfillmentId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    if(f.fulfillment_mode==='PICKUP')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Pickup orders are completed by buyer pickup confirmation, not dispatch',409);
    if(f.status!=='READY_FOR_HANDOFF')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Fulfillment must be READY_FOR_HANDOFF before dispatch',409);
    const carrier=requiredText(input?.carrier_name,'carrier_name',120);
    const tracking=f.fulfillment_mode==='SHIPPING'
      ?requiredText(input?.tracking_reference,'tracking_reference',180)
      :optionalText(input?.tracking_reference,180);
    const now=getCurrentUtcIsoString();
    const next={...f,status:'IN_TRANSIT' as const,carrier_name:carrier,service_level:optionalText(input?.service_level,120),
      tracking_reference:tracking,dispatched_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateFulfillment(next);
      this.recordEvent(next,'DISPATCHED','SELLER_RECORDED',actor.user_id,
        {carrier_name:carrier,service_level:next.service_level,tracking_reference:tracking},now,db);
      this.outbox(actor,'marketplace.delivery.dispatched',next.id,next.store_id,next.order_id,
        {fulfillment_id:next.id,order_id:next.order_id,carrier_name:carrier,tracking_reference:tracking,
          source_type:'SELLER_RECORDED',buyer_receipt_confirmed:false},db);
    });
    return repo.detail(next,marketplacePaymentRepository.financialSummary(next.order_id));
  }

  reportDelivery(actor:AuthenticatedActorContext,storeId:string,fulfillmentId:string,input:any){
    const f=this.requireSellerFulfillment(actor,storeId,fulfillmentId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    if(f.fulfillment_mode==='PICKUP')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Pickup orders do not use seller delivery reports',409);
    if(f.status!=='IN_TRANSIT')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only IN_TRANSIT fulfillment can be seller-reported delivered',409);
    const now=getCurrentUtcIsoString();
    const next={...f,status:'DELIVERY_REPORTED' as const,delivery_reported_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateFulfillment(next);
      this.recordEvent(next,'DELIVERY_REPORTED','SELLER_RECORDED',actor.user_id,
        {recipient_name:optionalText(input?.recipient_name,120),proof_reference:optionalText(input?.proof_reference,240),
          note:optionalText(input?.note,500)},now,db);
      this.outbox(actor,'marketplace.delivery.reported',next.id,next.store_id,next.order_id,
        {fulfillment_id:next.id,order_id:next.order_id,source_type:'SELLER_RECORDED',buyer_receipt_confirmed:false},db);
    });
    return repo.detail(next,marketplacePaymentRepository.financialSummary(next.order_id));
  }

  confirmReceipt(actor:AuthenticatedActorContext,orderId:string,input:any){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    const f=repo.getByOrder(order.id);
    if(!f)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Fulfillment not found',404);
    const allowed=f.fulfillment_mode==='PICKUP'
      ?f.status==='READY_FOR_HANDOFF'
      :['IN_TRANSIT','DELIVERY_REPORTED'].includes(f.status);
    if(!allowed)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Fulfillment is not ready for buyer receipt confirmation',409);
    const now=getCurrentUtcIsoString();
    const next={...f,status:'COMPLETED' as const,completed_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateFulfillment(next);
      this.recordEvent(next,f.fulfillment_mode==='PICKUP'?'PICKUP_CONFIRMED':'RECEIPT_CONFIRMED','BUYER_CONFIRMED',actor.user_id,
        {note:optionalText(input?.note,500)},now,db);
      this.outbox(actor,'marketplace.fulfillment.completed',next.id,next.store_id,next.order_id,
        {fulfillment_id:next.id,order_id:next.order_id,fulfillment_mode:next.fulfillment_mode,
          buyer_receipt_confirmed:true,completed_at:now},db);
    });
    return repo.detail(next,marketplacePaymentRepository.financialSummary(next.order_id));
  }

  requestReturn(actor:AuthenticatedActorContext,orderId:string,input:any){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    const f=repo.getByOrder(order.id);
    if(!f||f.status!=='COMPLETED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Returns can be requested only after buyer-confirmed fulfillment completion',409);
    const requested=Array.isArray(input?.items)?input.items:[];
    if(!requested.length)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'At least one return item is required',400);
    const reason=requiredText(input?.reason,'reason',1000);
    const orderItems=getDatabase().prepare('SELECT * FROM marketplace_order_items WHERE order_id=?').all(order.id) as any[];
    const byId=new Map(orderItems.map(x=>[String(x.id),x]));
    const seen=new Set<string>();
    const rows:MarketplaceReturnItem[]=[];
    for(const raw of requested){
      const id=String(raw?.order_item_id||'');
      if(seen.has(id))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Duplicate order_item_id in return request',400);
      seen.add(id);
      const item=byId.get(id);
      if(!item)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Return item does not belong to the order',400);
      const requestedQty=qty(raw?.quantity,'quantity');
      if(requestedQty<1)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Return quantity must be at least 1',400);
      const prior=getDatabase().prepare(`
        SELECT COALESCE(SUM(ri.requested_quantity),0) total
        FROM marketplace_return_items ri JOIN marketplace_returns r ON r.id=ri.return_id
        WHERE ri.order_item_id=? AND r.status!='REJECTED'
      `).get(id) as any;
      const remaining=Number(item.quantity)-Number(prior?.total||0);
      if(requestedQty>remaining)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Return quantity exceeds remaining returnable quantity',409);
      rows.push({
        id:generateCanonicalId('mretitem'),return_id:'',order_item_id:id,listing_id:String(item.listing_id),
        product_id:String(item.product_id),requested_quantity:requestedQty,received_quantity:0,restock_quantity:0,
        condition_at_return:'UNASSESSED',unit_price_minor:Number(item.unit_price_minor),
        refund_amount_minor:Number(item.unit_price_minor)*requestedQty,notes:null
      });
    }
    const now=getCurrentUtcIsoString();
    const returnId=generateCanonicalId('mreturn');
    const value:MarketplaceReturn={
      id:returnId,return_number:'RET-'+now.slice(0,10).replaceAll('-','')+'-'+returnId.slice(-8).toUpperCase(),
      order_id:order.id,fulfillment_id:f.id,buyer_user_id:actor.user_id,store_id:order.store_id,status:'REQUESTED',
      reason,seller_decision_reason:null,return_tracking_reference:null,refund_id:null,requested_at:now,reviewed_at:null,
      shipped_at:null,received_at:null,completed_at:null,created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createReturn(value);
      for(const row of rows)repo.createReturnItem({...row,return_id:returnId});
      repo.updateFulfillment({...f,status:'RETURN_IN_PROGRESS',updated_at:now});
      this.recordEvent(f,'RETURN_REQUESTED','BUYER_CONFIRMED',actor.user_id,
        {return_id:returnId,return_number:value.return_number,reason,item_count:rows.length},now,db);
      this.outbox(actor,'marketplace.return.requested',returnId,order.store_id,order.id,
        {return_id:returnId,return_number:value.return_number,order_id:order.id,status:value.status,
          physical_return_received:false,refund_requested:false},db);
    });
    return repo.returnDetail(value);
  }

  reviewReturn(actor:AuthenticatedActorContext,storeId:string,returnId:string,input:any){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const r=this.requireStoreReturn(storeId,returnId);
    if(r.status!=='REQUESTED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only REQUESTED returns can be reviewed',409);
    const decision=String(input?.decision||'').toUpperCase();
    if(!['APPROVE','REJECT'].includes(decision))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'decision must be APPROVE or REJECT',400);
    const now=getCurrentUtcIsoString();
    const reason=optionalText(input?.reason,1000);
    const next={...r,status:(decision==='APPROVE'?'APPROVED':'REJECTED') as any,seller_decision_reason:reason,reviewed_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateReturn(next);
      const f=repo.getFulfillment(r.fulfillment_id)!;
      if(decision==='REJECT'){
        const open=Number((getDatabase().prepare(
          "SELECT COUNT(*) count FROM marketplace_returns WHERE fulfillment_id=? AND id!=? AND status NOT IN ('REJECTED','COMPLETED')"
        ).get(f.id,r.id) as any)?.count||0);
        if(open===0)repo.updateFulfillment({...f,status:'COMPLETED',updated_at:now});
      }
      this.recordEvent(f,decision==='APPROVE'?'RETURN_APPROVED':'RETURN_REJECTED','SELLER_RECORDED',actor.user_id,
        {return_id:r.id,reason},now,db);
      this.outbox(actor,decision==='APPROVE'?'marketplace.return.approved':'marketplace.return.rejected',r.id,r.store_id,r.order_id,
        {return_id:r.id,order_id:r.order_id,status:next.status,reason},db);
    });
    return repo.returnDetail(next);
  }

  markReturnShipped(actor:AuthenticatedActorContext,returnId:string,input:any){
    const r=repo.getReturn(returnId);
    if(!r||r.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Return not found',404);
    if(r.status!=='APPROVED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only APPROVED returns can be marked in transit',409);
    const now=getCurrentUtcIsoString();
    const next={...r,status:'IN_TRANSIT' as const,return_tracking_reference:optionalText(input?.tracking_reference,180),
      shipped_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateReturn(next);
      const f=repo.getFulfillment(r.fulfillment_id)!;
      this.recordEvent(f,'RETURN_IN_TRANSIT','BUYER_CONFIRMED',actor.user_id,
        {return_id:r.id,tracking_reference:next.return_tracking_reference},now,db);
      this.outbox(actor,'marketplace.return.in_transit',r.id,r.store_id,r.order_id,
        {return_id:r.id,order_id:r.order_id,tracking_reference:next.return_tracking_reference},db);
    });
    return repo.returnDetail(next);
  }

  receiveReturn(actor:AuthenticatedActorContext,storeId:string,returnId:string,input:any){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const r=this.requireStoreReturn(storeId,returnId);
    if(!['APPROVED','IN_TRANSIT'].includes(r.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only approved/in-transit returns can be received',409);
    const items=repo.listReturnItems(r.id);
    const supplied=Array.isArray(input?.items)?input.items:[];
    if(supplied.length!==items.length)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Receipt inspection must include every return item',400);
    const byId=new Map(items.map(x=>[x.id,x]));
    const inspections=supplied.map((raw:any)=>{
      const item=byId.get(String(raw?.return_item_id||''));
      if(!item)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Unknown return_item_id',400);
      const received=qty(raw?.received_quantity,'received_quantity');
      const restock=qty(raw?.restock_quantity,'restock_quantity');
      if(received>item.requested_quantity)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Received quantity exceeds requested return quantity',409);
      if(restock>received)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Restock quantity cannot exceed received quantity',409);
      const condition=String(raw?.condition_at_return||'').toUpperCase() as MarketplaceReturnCondition;
      if(!['RESTOCKABLE','OPENED','DAMAGED','DEFECTIVE'].includes(condition))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid condition_at_return',400);
      if(restock>0&&condition!=='RESTOCKABLE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Only RESTOCKABLE units may be returned to available inventory',409);
      return {item,received,restock,condition,notes:optionalText(raw?.notes,500),refund:item.unit_price_minor*received};
    });
    if(inspections.reduce((s,x)=>s+x.received,0)<1)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'At least one physical unit must be received',409);
    const now=getCurrentUtcIsoString();
    const next={...r,status:'RECEIVED' as const,received_at:now,updated_at:now};
    withTransaction(({db})=>{
      for(const x of inspections){
        repo.updateReturnItemReceipt(x.item.id,x.received,x.restock,x.condition,x.notes,x.refund);
        if(x.restock>0){
          const listing=getDatabase().prepare('SELECT * FROM marketplace_listings WHERE id=?').get(x.item.listing_id) as any;
          if(listing&&listing.inventory_tracking==='QUANTITY'){
            const nextQty=Number(listing.stock_quantity||0)+x.restock;
            const inventoryStatus=nextQty===0?'OUT_OF_STOCK':nextQty<=3?'LOW_STOCK':'IN_STOCK';
            getDatabase().prepare(
              'UPDATE marketplace_listings SET stock_quantity=?,inventory_status=?,version=version+1,updated_at=? WHERE id=?'
            ).run(nextQty,inventoryStatus,now,String(listing.id));
            marketplaceRepository.rebuildSearchProjection(String(listing.id),now);
          }
        }
      }
      repo.updateReturn(next);
      const f=repo.getFulfillment(r.fulfillment_id)!;
      this.recordEvent(f,'RETURN_RECEIVED','SELLER_RECORDED',actor.user_id,
        {return_id:r.id,received_units:inspections.reduce((s,x)=>s+x.received,0),
          restocked_units:inspections.reduce((s,x)=>s+x.restock,0)},now,db);
      this.outbox(actor,'marketplace.return.received',r.id,r.store_id,r.order_id,
        {return_id:r.id,order_id:r.order_id,status:next.status,physical_return_received:true,
          restocked_units:inspections.reduce((s,x)=>s+x.restock,0),refund_confirmed:false},db);
    });
    return repo.returnDetail(next);
  }

  requestReturnRefund(actor:AuthenticatedActorContext,storeId:string,returnId:string,idempotencyKey:unknown){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const r=this.requireStoreReturn(storeId,returnId);
    if(r.status==='REFUND_REQUESTED'&&r.refund_id)return repo.returnDetail(r);
    if(r.status!=='RECEIVED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Refund can be requested only after the physical return is received',409);
    const amount=repo.listReturnItems(r.id).reduce((sum,x)=>sum+x.refund_amount_minor,0);
    if(amount<=0)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'No received item value is eligible for refund',409);
    const result=marketplacePaymentService.requestRefund(actor,r.order_id,{
      amount_minor:amount,reason:'Return '+r.return_number+': '+r.reason
    },idempotencyKey);
    const now=getCurrentUtcIsoString();
    const next={...r,status:'REFUND_REQUESTED' as const,refund_id:result.refund.id,updated_at:now};
    withTransaction(({db})=>{
      repo.updateReturn(next);
      const f=repo.getFulfillment(r.fulfillment_id)!;
      this.recordEvent(f,'RETURN_REFUND_REQUESTED','SELLER_RECORDED',actor.user_id,
        {return_id:r.id,refund_id:result.refund.id,amount_minor:amount,currency:result.refund.currency},now,db);
      this.outbox(actor,'marketplace.return.refund_requested',r.id,r.store_id,r.order_id,
        {return_id:r.id,order_id:r.order_id,refund_id:result.refund.id,amount_minor:amount,refund_confirmed:false},db);
    });
    return repo.returnDetail(next);
  }

  listSellerReturns(actor:AuthenticatedActorContext,storeId:string){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    return repo.listReturnsByStore(storeId).map(x=>repo.returnDetail(x));
  }

  getBuyerReturn(actor:AuthenticatedActorContext,returnId:string){
    const r=repo.getReturn(returnId);
    if(!r||r.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Return not found',404);
    return repo.returnDetail(r);
  }

  private requireManagedStore(actor:AuthenticatedActorContext,storeId:string,permission:CanonicalPermission){
    const row=getDatabase().prepare('SELECT id,organization_id FROM marketplace_stores WHERE id=? LIMIT 1').get(storeId) as any;
    if(!row)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,permission,{organizationId:String(row.organization_id)});
    return row;
  }
  private requireStoreOrder(storeId:string,orderId:string){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    return order;
  }
  private requireSellerFulfillment(actor:AuthenticatedActorContext,storeId:string,fulfillmentId:string,permission:CanonicalPermission){
    this.requireManagedStore(actor,storeId,permission);
    const f=repo.getFulfillment(fulfillmentId);
    if(!f||f.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Fulfillment not found',404);
    return f;
  }
  private requireStoreReturn(storeId:string,returnId:string){
    const r=repo.getReturn(returnId);
    if(!r||r.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Return not found',404);
    return r;
  }
  private recordEvent(f:MarketplaceFulfillment,eventType:string,source:MarketplaceFulfillmentEventSource,actorId:string,details:any,now:string,db:any){
    repo.addEvent({id:generateCanonicalId('mfevt'),fulfillment_id:f.id,order_id:f.order_id,event_type:eventType,
      source_type:source,actor_id:actorId,details_json:details?JSON.stringify(details):null,occurred_at:now});
    recordAuditEvent({actor_id:actorId,actor_type:source==='BUYER_CONFIRMED'?CanonicalActorType.VEHICLE_OWNER:CanonicalActorType.SELLER,
      action:'MARKETPLACE_'+eventType,resource_type:'marketplace_fulfillment',resource_id:f.id,correlation_id:f.id,
      source:'MARKETPLACE_FULFILLMENT_API',after_state:{order_id:f.order_id,event_type:eventType,source_type:source,...details}},db);
  }
  private outbox(actor:AuthenticatedActorContext,type:string,correlationId:string,storeId:string,orderId:string,payload:any,db:any){
    enqueueOutboxEvent(createCanonicalEventEnvelope({
      type,producer:'garage-os-marketplace-fulfillment',correlation_id:correlationId,
      subject_ids:{marketplace_order:orderId,marketplace_store:storeId},
      actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,payload
    }),db);
  }
}
export const marketplaceFulfillmentService=new MarketplaceFulfillmentService();
