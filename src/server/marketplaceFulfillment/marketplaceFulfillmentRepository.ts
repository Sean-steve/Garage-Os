import { getDatabase } from '../database/connection';
import {
  MarketplaceFulfillment, MarketplaceFulfillmentDetail, MarketplaceFulfillmentEvent,
  MarketplaceReturn, MarketplaceReturnDetail, MarketplaceReturnItem
} from './types';

const asFulfillment=(r:any):MarketplaceFulfillment=>({
  id:String(r.id),order_id:String(r.order_id),store_id:String(r.store_id),fulfillment_mode:r.fulfillment_mode,status:r.status,
  carrier_name:r.carrier_name?String(r.carrier_name):null,service_level:r.service_level?String(r.service_level):null,
  tracking_reference:r.tracking_reference?String(r.tracking_reference):null,seller_notes:r.seller_notes?String(r.seller_notes):null,
  prepared_at:r.prepared_at?String(r.prepared_at):null,ready_at:r.ready_at?String(r.ready_at):null,
  dispatched_at:r.dispatched_at?String(r.dispatched_at):null,delivery_reported_at:r.delivery_reported_at?String(r.delivery_reported_at):null,
  completed_at:r.completed_at?String(r.completed_at):null,created_by:String(r.created_by),
  created_at:String(r.created_at),updated_at:String(r.updated_at)
});
const asEvent=(r:any):MarketplaceFulfillmentEvent=>({
  id:String(r.id),fulfillment_id:String(r.fulfillment_id),order_id:String(r.order_id),event_type:String(r.event_type),
  source_type:r.source_type,actor_id:String(r.actor_id),details_json:r.details_json?String(r.details_json):null,occurred_at:String(r.occurred_at)
});
const asReturn=(r:any):MarketplaceReturn=>({
  id:String(r.id),return_number:String(r.return_number),order_id:String(r.order_id),fulfillment_id:String(r.fulfillment_id),
  buyer_user_id:String(r.buyer_user_id),store_id:String(r.store_id),status:r.status,reason:String(r.reason),
  seller_decision_reason:r.seller_decision_reason?String(r.seller_decision_reason):null,
  return_tracking_reference:r.return_tracking_reference?String(r.return_tracking_reference):null,
  refund_id:r.refund_id?String(r.refund_id):null,requested_at:String(r.requested_at),
  reviewed_at:r.reviewed_at?String(r.reviewed_at):null,shipped_at:r.shipped_at?String(r.shipped_at):null,
  received_at:r.received_at?String(r.received_at):null,completed_at:r.completed_at?String(r.completed_at):null,
  created_at:String(r.created_at),updated_at:String(r.updated_at)
});
const asReturnItem=(r:any):MarketplaceReturnItem=>({
  id:String(r.id),return_id:String(r.return_id),order_item_id:String(r.order_item_id),listing_id:String(r.listing_id),
  product_id:String(r.product_id),requested_quantity:Number(r.requested_quantity),received_quantity:Number(r.received_quantity),
  restock_quantity:Number(r.restock_quantity),condition_at_return:r.condition_at_return,unit_price_minor:Number(r.unit_price_minor),
  refund_amount_minor:Number(r.refund_amount_minor),notes:r.notes?String(r.notes):null
});

export class MarketplaceFulfillmentRepository{
  getFulfillment(id:string):MarketplaceFulfillment|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_fulfillments WHERE id=? LIMIT 1').get(id) as any;
    return r?asFulfillment(r):null;
  }
  getByOrder(orderId:string):MarketplaceFulfillment|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_fulfillments WHERE order_id=? LIMIT 1').get(orderId) as any;
    return r?asFulfillment(r):null;
  }
  listByStore(storeId:string):MarketplaceFulfillment[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_fulfillments WHERE store_id=? ORDER BY created_at DESC').all(storeId) as any[]).map(asFulfillment);
  }
  createFulfillment(v:MarketplaceFulfillment){
    getDatabase().prepare(`
      INSERT INTO marketplace_fulfillments
      (id,order_id,store_id,fulfillment_mode,status,carrier_name,service_level,tracking_reference,seller_notes,
       prepared_at,ready_at,dispatched_at,delivery_reported_at,completed_at,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.order_id,v.store_id,v.fulfillment_mode,v.status,v.carrier_name,v.service_level,v.tracking_reference,
      v.seller_notes,v.prepared_at,v.ready_at,v.dispatched_at,v.delivery_reported_at,v.completed_at,v.created_by,v.created_at,v.updated_at);
    return v;
  }
  updateFulfillment(v:MarketplaceFulfillment){
    getDatabase().prepare(`
      UPDATE marketplace_fulfillments SET status=?,carrier_name=?,service_level=?,tracking_reference=?,seller_notes=?,
        prepared_at=?,ready_at=?,dispatched_at=?,delivery_reported_at=?,completed_at=?,updated_at=? WHERE id=?
    `).run(v.status,v.carrier_name,v.service_level,v.tracking_reference,v.seller_notes,v.prepared_at,v.ready_at,
      v.dispatched_at,v.delivery_reported_at,v.completed_at,v.updated_at,v.id);
    return v;
  }
  addEvent(v:MarketplaceFulfillmentEvent){
    getDatabase().prepare(`
      INSERT INTO marketplace_fulfillment_events
      (id,fulfillment_id,order_id,event_type,source_type,actor_id,details_json,occurred_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(v.id,v.fulfillment_id,v.order_id,v.event_type,v.source_type,v.actor_id,v.details_json,v.occurred_at);
    return v;
  }
  listEvents(fulfillmentId:string):MarketplaceFulfillmentEvent[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_fulfillment_events WHERE fulfillment_id=? ORDER BY occurred_at,id').all(fulfillmentId) as any[]).map(asEvent);
  }

  createReturn(v:MarketplaceReturn){
    getDatabase().prepare(`
      INSERT INTO marketplace_returns
      (id,return_number,order_id,fulfillment_id,buyer_user_id,store_id,status,reason,seller_decision_reason,
       return_tracking_reference,refund_id,requested_at,reviewed_at,shipped_at,received_at,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.return_number,v.order_id,v.fulfillment_id,v.buyer_user_id,v.store_id,v.status,v.reason,v.seller_decision_reason,
      v.return_tracking_reference,v.refund_id,v.requested_at,v.reviewed_at,v.shipped_at,v.received_at,v.completed_at,v.created_at,v.updated_at);
    return v;
  }
  updateReturn(v:MarketplaceReturn){
    getDatabase().prepare(`
      UPDATE marketplace_returns SET status=?,seller_decision_reason=?,return_tracking_reference=?,refund_id=?,
        reviewed_at=?,shipped_at=?,received_at=?,completed_at=?,updated_at=? WHERE id=?
    `).run(v.status,v.seller_decision_reason,v.return_tracking_reference,v.refund_id,v.reviewed_at,v.shipped_at,
      v.received_at,v.completed_at,v.updated_at,v.id);
    return v;
  }
  getReturn(id:string):MarketplaceReturn|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_returns WHERE id=? LIMIT 1').get(id) as any;
    return r?asReturn(r):null;
  }
  listReturnsByOrder(orderId:string):MarketplaceReturn[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_returns WHERE order_id=? ORDER BY requested_at DESC').all(orderId) as any[]).map(asReturn);
  }
  listReturnsByStore(storeId:string):MarketplaceReturn[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_returns WHERE store_id=? ORDER BY requested_at DESC').all(storeId) as any[]).map(asReturn);
  }
  createReturnItem(v:MarketplaceReturnItem){
    getDatabase().prepare(`
      INSERT INTO marketplace_return_items
      (id,return_id,order_item_id,listing_id,product_id,requested_quantity,received_quantity,restock_quantity,
       condition_at_return,unit_price_minor,refund_amount_minor,notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.return_id,v.order_item_id,v.listing_id,v.product_id,v.requested_quantity,v.received_quantity,
      v.restock_quantity,v.condition_at_return,v.unit_price_minor,v.refund_amount_minor,v.notes);
    return v;
  }
  updateReturnItemReceipt(id:string,received:number,restock:number,condition:string,notes:string|null){
    getDatabase().prepare(`
      UPDATE marketplace_return_items SET received_quantity=?,restock_quantity=?,condition_at_return=?,notes=? WHERE id=?
    `).run(received,restock,condition,notes,id);
  }
  listReturnItems(returnId:string):MarketplaceReturnItem[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_return_items WHERE return_id=? ORDER BY id').all(returnId) as any[]).map(asReturnItem);
  }
  returnDetail(v:MarketplaceReturn):MarketplaceReturnDetail{
    const items=this.listReturnItems(v.id);
    const refund=v.refund_id?getDatabase().prepare('SELECT status,amount_minor FROM marketplace_refunds WHERE id=?').get(v.refund_id) as any:null;
    return {return:v,items,financial_refund_status:refund?String(refund.status):null,
      financial_refund_amount_minor:refund?Number(refund.amount_minor):null,
      truth:{physical_return_received:Boolean(v.received_at),inventory_restocked:items.some(x=>x.restock_quantity>0),
        refund_requested:Boolean(v.refund_id),refund_confirmed:Boolean(refund?.status==='SUCCEEDED')}};
  }

  detail(v:MarketplaceFulfillment,financial:any):MarketplaceFulfillmentDetail{
    const returns=this.listReturnsByOrder(v.order_id).map(x=>this.returnDetail(x));
    return {fulfillment:v,events:this.listEvents(v.id),returns,
      financial:{commercial_status:String(financial.commercial_status),captured_minor:Number(financial.captured_minor),
        refunded_minor:Number(financial.refunded_minor),net_paid_minor:Number(financial.net_paid_minor)},
      truth:{payment_authoritative:Number(financial.captured_minor)>0,seller_dispatch_is_buyer_receipt:false,
        buyer_receipt_confirmed:Boolean(v.completed_at),return_available:v.status==='COMPLETED'}};
  }
}
export const marketplaceFulfillmentRepository=new MarketplaceFulfillmentRepository();
