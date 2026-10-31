import { getDatabase } from '../database/connection';
import {
  MarketplaceCart, MarketplaceCartDetail, MarketplaceCartItem,
  MarketplaceOrder, MarketplaceOrderDetail, MarketplaceOrderItem
} from './types';

function cart(r:any):MarketplaceCart{
  return {id:String(r.id),buyer_user_id:String(r.buyer_user_id),store_id:String(r.store_id),
    vehicle_id:r.vehicle_id?String(r.vehicle_id):null,currency:r.currency?String(r.currency):null,
    status:r.status,created_at:String(r.created_at),updated_at:String(r.updated_at)};
}
function item(r:any):MarketplaceCartItem{
  return {id:String(r.id),cart_id:String(r.cart_id),listing_id:String(r.listing_id),product_id:String(r.product_id),
    quantity:Number(r.quantity),unit_price_minor_snapshot:Number(r.unit_price_minor_snapshot),currency:String(r.currency),
    listing_version_snapshot:Number(r.listing_version_snapshot),title_snapshot:String(r.title_snapshot),
    added_at:String(r.added_at),updated_at:String(r.updated_at)};
}
function order(r:any):MarketplaceOrder{
  return {id:String(r.id),order_number:String(r.order_number),buyer_user_id:String(r.buyer_user_id),
    store_id:String(r.store_id),vehicle_id:r.vehicle_id?String(r.vehicle_id):null,cart_id:String(r.cart_id),
    status:r.status,payment_status:r.payment_status,currency:String(r.currency),
    subtotal_minor:Number(r.subtotal_minor),total_minor:Number(r.total_minor),fulfillment_mode:r.fulfillment_mode,
    delivery_name:r.delivery_name?String(r.delivery_name):null,delivery_phone:r.delivery_phone?String(r.delivery_phone):null,
    delivery_address_json:r.delivery_address_json?String(r.delivery_address_json):null,
    fitment_acknowledged:Boolean(r.fitment_acknowledged),
    fitment_acknowledgement_text:r.fitment_acknowledgement_text?String(r.fitment_acknowledgement_text):null,
    placed_at:String(r.placed_at),cancelled_at:r.cancelled_at?String(r.cancelled_at):null,
    cancellation_reason:r.cancellation_reason?String(r.cancellation_reason):null,
    created_at:String(r.created_at),updated_at:String(r.updated_at)};
}
function orderItem(r:any):MarketplaceOrderItem{
  return {id:String(r.id),order_id:String(r.order_id),listing_id:String(r.listing_id),product_id:String(r.product_id),
    seller_sku:String(r.seller_sku),title:String(r.title),quantity:Number(r.quantity),
    unit_price_minor:Number(r.unit_price_minor),line_total_minor:Number(r.line_total_minor),currency:String(r.currency),
    listing_version:Number(r.listing_version),fitment_status:r.fitment_status?String(r.fitment_status):null,
    fitment_confidence:r.fitment_confidence===null?null:Number(r.fitment_confidence),
    fitment_decision_id:r.fitment_decision_id?String(r.fitment_decision_id):null,created_at:String(r.created_at)};
}

export class MarketplaceTransactionRepository{
  getActiveCart(buyerUserId:string,storeId:string):MarketplaceCart|null{
    const r=getDatabase().prepare(
      "SELECT * FROM marketplace_carts WHERE buyer_user_id=? AND store_id=? AND status='ACTIVE' LIMIT 1"
    ).get(buyerUserId,storeId) as any;
    return r?cart(r):null;
  }
  getCart(id:string):MarketplaceCart|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_carts WHERE id=? LIMIT 1').get(id) as any;
    return r?cart(r):null;
  }
  createCart(value:MarketplaceCart){getDatabase().prepare(
    'INSERT INTO marketplace_carts (id,buyer_user_id,store_id,vehicle_id,currency,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(value.id,value.buyer_user_id,value.store_id,value.vehicle_id,value.currency,value.status,value.created_at,value.updated_at);return value;}
  updateCart(value:MarketplaceCart){getDatabase().prepare(
    'UPDATE marketplace_carts SET vehicle_id=?,currency=?,status=?,updated_at=? WHERE id=?'
  ).run(value.vehicle_id,value.currency,value.status,value.updated_at,value.id);return value;}
  listCartItems(cartId:string):MarketplaceCartItem[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_cart_items WHERE cart_id=? ORDER BY added_at,id').all(cartId) as any[]).map(item);
  }
  getCartItem(cartId:string,itemId:string):MarketplaceCartItem|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_cart_items WHERE cart_id=? AND id=? LIMIT 1').get(cartId,itemId) as any;
    return r?item(r):null;
  }
  getCartItemByListing(cartId:string,listingId:string):MarketplaceCartItem|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_cart_items WHERE cart_id=? AND listing_id=? LIMIT 1').get(cartId,listingId) as any;
    return r?item(r):null;
  }
  upsertCartItem(value:MarketplaceCartItem):MarketplaceCartItem{
    getDatabase().prepare(`
      INSERT INTO marketplace_cart_items
      (id,cart_id,listing_id,product_id,quantity,unit_price_minor_snapshot,currency,listing_version_snapshot,title_snapshot,added_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(cart_id,listing_id) DO UPDATE SET
        quantity=excluded.quantity,unit_price_minor_snapshot=excluded.unit_price_minor_snapshot,
        currency=excluded.currency,listing_version_snapshot=excluded.listing_version_snapshot,
        title_snapshot=excluded.title_snapshot,updated_at=excluded.updated_at
    `).run(value.id,value.cart_id,value.listing_id,value.product_id,value.quantity,value.unit_price_minor_snapshot,
      value.currency,value.listing_version_snapshot,value.title_snapshot,value.added_at,value.updated_at);
    return this.getCartItemByListing(value.cart_id,value.listing_id)!;
  }
  deleteCartItem(cartId:string,itemId:string):boolean{
    return Number(getDatabase().prepare('DELETE FROM marketplace_cart_items WHERE cart_id=? AND id=?').run(cartId,itemId).changes||0)===1;
  }
  detail(cartValue:MarketplaceCart):MarketplaceCartDetail{
    const items=this.listCartItems(cartValue.id);
    return {cart:cartValue,items,subtotal_minor:items.reduce((sum,x)=>sum+x.unit_price_minor_snapshot*x.quantity,0),
      currency:cartValue.currency};
  }

  createOrder(value:MarketplaceOrder):MarketplaceOrder{
    getDatabase().prepare(`
      INSERT INTO marketplace_orders
      (id,order_number,buyer_user_id,store_id,vehicle_id,cart_id,status,payment_status,currency,subtotal_minor,total_minor,
       fulfillment_mode,delivery_name,delivery_phone,delivery_address_json,fitment_acknowledged,fitment_acknowledgement_text,
       placed_at,cancelled_at,cancellation_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(value.id,value.order_number,value.buyer_user_id,value.store_id,value.vehicle_id,value.cart_id,value.status,
      value.payment_status,value.currency,value.subtotal_minor,value.total_minor,value.fulfillment_mode,value.delivery_name,
      value.delivery_phone,value.delivery_address_json,value.fitment_acknowledged?1:0,value.fitment_acknowledgement_text,
      value.placed_at,value.cancelled_at,value.cancellation_reason,value.created_at,value.updated_at);
    return value;
  }
  createOrderItem(value:MarketplaceOrderItem):MarketplaceOrderItem{
    getDatabase().prepare(`
      INSERT INTO marketplace_order_items
      (id,order_id,listing_id,product_id,seller_sku,title,quantity,unit_price_minor,line_total_minor,currency,listing_version,
       fitment_status,fitment_confidence,fitment_decision_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(value.id,value.order_id,value.listing_id,value.product_id,value.seller_sku,value.title,value.quantity,
      value.unit_price_minor,value.line_total_minor,value.currency,value.listing_version,value.fitment_status,
      value.fitment_confidence,value.fitment_decision_id,value.created_at);
    return value;
  }
  createReservation(value:{id:string;order_id:string;listing_id:string;quantity:number;status:'HELD';held_at:string}){
    getDatabase().prepare(
      'INSERT INTO marketplace_inventory_reservations (id,order_id,listing_id,quantity,status,held_at) VALUES (?,?,?,?,?,?)'
    ).run(value.id,value.order_id,value.listing_id,value.quantity,value.status,value.held_at);
  }
  getOrder(id:string):MarketplaceOrder|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_orders WHERE id=? LIMIT 1').get(id) as any;
    return r?order(r):null;
  }
  getOrderByNumber(number:string):MarketplaceOrder|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_orders WHERE order_number=? LIMIT 1').get(number) as any;
    return r?order(r):null;
  }
  listBuyerOrders(userId:string):MarketplaceOrder[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_orders WHERE buyer_user_id=? ORDER BY placed_at DESC').all(userId) as any[]).map(order);
  }
  listSellerOrders(storeId:string):MarketplaceOrder[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_orders WHERE store_id=? ORDER BY placed_at DESC').all(storeId) as any[]).map(order);
  }
  orderDetail(value:MarketplaceOrder):MarketplaceOrderDetail{
    const items=(getDatabase().prepare('SELECT * FROM marketplace_order_items WHERE order_id=? ORDER BY id').all(value.id) as any[]).map(orderItem);
    const reservations=(getDatabase().prepare('SELECT id,listing_id,quantity,status,held_at,released_at FROM marketplace_inventory_reservations WHERE order_id=? ORDER BY id').all(value.id) as any[])
      .map(r=>({id:String(r.id),listing_id:String(r.listing_id),quantity:Number(r.quantity),status:r.status,
        held_at:String(r.held_at),released_at:r.released_at?String(r.released_at):null}));
    return {order:value,items,reservations,truth:{payment_captured:false,payment_available:false,seller_fulfillment_available:false}};
  }
  cancelOrder(orderId:string,reason:string,now:string){
    getDatabase().prepare(
      "UPDATE marketplace_orders SET status='CANCELLED',cancelled_at=?,cancellation_reason=?,updated_at=? WHERE id=? AND status='AWAITING_PAYMENT'"
    ).run(now,reason,now,orderId);
  }
  releaseReservations(orderId:string,now:string){
    getDatabase().prepare(
      "UPDATE marketplace_inventory_reservations SET status='RELEASED',released_at=? WHERE order_id=? AND status='HELD'"
    ).run(now,orderId);
  }
}

export const marketplaceTransactionRepository=new MarketplaceTransactionRepository();
