/**
 * Sprint 26 — Marketplace Fulfillment, Delivery & Returns
 */
import { createHmac } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceTransactionService } from '../../src/server/marketplaceTransactions/marketplaceTransactionService';
import { marketplacePaymentService } from '../../src/server/marketplacePayments/marketplacePaymentService';
import { marketplaceFulfillmentService } from '../../src/server/marketplaceFulfillment/marketplaceFulfillmentService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}
function sign(secret:string,input:any){
  const canonical=[input.provider_event_id,input.event_type,input.provider_payment_id,input.order_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase(),input.refund_id||'',input.provider_refund_id||''].join('|');
  return createHmac('sha256',secret).update(canonical).digest('hex');
}

describe('Marketplace Fulfillment, Delivery & Returns (Sprint 26)',()=>{
  let db:any;
  const orgId='org_ful_seller',otherOrg='org_ful_other';
  const seller=actor('usr_ful_seller','seller@ful.test',[membership('usr_ful_seller',orgId,'Ful Seller')]);
  const otherSeller=actor('usr_ful_other','other@ful.test',[membership('usr_ful_other',otherOrg,'Other Seller')]);
  const buyer=actor('usr_ful_buyer','buyer@ful.test');
  const admin=actor('usr_ful_admin','admin@ful.test',[],[PlatformRole.PLATFORM_ADMIN]);
  const secret='fulfillment-webhook-secret';
  let storeId:string;
  let counter=0;

  beforeEach(()=>{
    process.env.FULFILLMENT_WEBHOOK_SECRET=secret;
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);

    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    user.run(seller.user_id,seller.email,'Seller','+254700700001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(otherSeller.user_id,otherSeller.email,'Other','+254700700002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(buyer.user_id,buyer.email,'Buyer','+254700700003','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(admin.user_id,admin.email,'Admin','+254700700004','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Ful Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrg,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrg,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    storeId=marketplaceService.createStore(seller,{organization_id:orgId,slug:'ful-parts',display_name:'Ful Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});
    marketplacePaymentService.createProvider(admin,{
      provider_key:'FULPAY',display_name:'Fulfillment Test Pay',mode:'TEST',
      webhook_secret_env:'FULFILLMENT_WEBHOOK_SECRET',supports_refunds:true
    });
  });

  function makeOrder(mode:'PICKUP'|'LOCAL_DELIVERY'|'SHIPPING'='PICKUP',paid=true,quantity=2){
    counter++;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'FUL-'+counter,
      title:'Fulfillment part '+counter,description:'Fulfillment certification product.',brand:'Example',condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:400000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:5,
      fulfillment_modes:[mode]
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listing.id,quantity);
    const place:any={fulfillment_mode:mode};
    if(mode!=='PICKUP'){
      place.delivery_name='Buyer';place.delivery_phone='+254700700003';
      place.delivery_address={address_line:'Test Road',city:'Nairobi',country:'KE'};
    }
    const order=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,place);
    let intent:any=null;
    if(paid){
      intent=marketplacePaymentService.createIntent(buyer,order.order.id,'FULPAY','ful-pay-'+counter+'-idem').intent;
      const event={provider_event_id:'evt-ful-pay-'+counter,event_type:'PAYMENT_SUCCEEDED',
        provider_payment_id:'ful_pp_'+counter,order_id:order.order.id,amount_minor:order.order.total_minor,currency:'KES',
        occurred_at:'2026-10-31T17:00:00.000Z'};
      marketplacePaymentService.processWebhook('FULPAY',sign(secret,event),event as any);
    }
    return {order,listing,product,intent};
  }

  function completePickup(orderId:string){
    const f=marketplaceFulfillmentService.startFulfillment(seller,storeId,orderId,{seller_notes:'Prepare order'});
    marketplaceFulfillmentService.markReady(seller,storeId,f.fulfillment.id,{});
    return marketplaceFulfillmentService.confirmReceipt(buyer,orderId,{note:'Collected'});
  }

  it('creates fulfillment/return schema without fabricating a fulfillment',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of ['marketplace_fulfillments','marketplace_fulfillment_events','marketplace_returns','marketplace_return_items']){
      assert.ok(tables.includes(table),table+' must exist');
    }
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_fulfillments').get() as any).count,0);
  });

  it('blocks fulfillment until full verified payment and blocks refunded orders from new fulfillment',()=>{
    const unpaid=makeOrder('PICKUP',false);
    assert.throws(
      ()=>marketplaceFulfillmentService.startFulfillment(seller,storeId,unpaid.order.order.id,{}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );

    const paid=makeOrder('PICKUP',true);
    marketplacePaymentService.requestRefund(buyer,paid.order.order.id,{amount_minor:100000,reason:'Pre-fulfillment adjustment'},'pre-ful-refund-1');
    const refund=db.prepare("SELECT * FROM marketplace_refunds WHERE order_id=?").get(paid.order.order.id) as any;
    const ev={provider_event_id:'evt-pre-refund',event_type:'REFUND_SUCCEEDED',provider_payment_id:'ful_pp_'+counter,
      order_id:paid.order.order.id,amount_minor:100000,currency:'KES',occurred_at:'2026-10-31T17:05:00.000Z',
      refund_id:String(refund.id),provider_refund_id:'pre_refund_1'};
    marketplacePaymentService.processWebhook('FULPAY',sign(secret,ev),ev as any);
    assert.throws(
      ()=>marketplaceFulfillmentService.startFulfillment(seller,storeId,paid.order.order.id,{}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
  });

  it('pickup requires seller ready state and buyer confirmation for completion',()=>{
    const {order}=makeOrder('PICKUP',true);
    const started=marketplaceFulfillmentService.startFulfillment(seller,storeId,order.order.id,{});
    assert.equal(started.fulfillment.status,'PREPARING');
    assert.throws(()=>marketplaceFulfillmentService.confirmReceipt(buyer,order.order.id,{}));
    const ready=marketplaceFulfillmentService.markReady(seller,storeId,started.fulfillment.id,{});
    assert.equal(ready.fulfillment.status,'READY_FOR_HANDOFF');
    assert.throws(()=>marketplaceFulfillmentService.dispatch(seller,storeId,started.fulfillment.id,{carrier_name:'X'}));
    const completed=marketplaceFulfillmentService.confirmReceipt(buyer,order.order.id,{note:'Pickup complete'});
    assert.equal(completed.fulfillment.status,'COMPLETED');
    assert.equal(completed.truth.buyer_receipt_confirmed,true);
    assert.ok(completed.events.some((e:any)=>e.event_type==='PICKUP_CONFIRMED'&&e.source_type==='BUYER_CONFIRMED'));
  });

  it('seller delivery report stays distinct from buyer receipt confirmation',()=>{
    const {order}=makeOrder('SHIPPING',true);
    const started=marketplaceFulfillmentService.startFulfillment(seller,storeId,order.order.id,{});
    marketplaceFulfillmentService.markReady(seller,storeId,started.fulfillment.id,{});
    assert.throws(
      ()=>marketplaceFulfillmentService.dispatch(seller,storeId,started.fulfillment.id,{carrier_name:'Courier'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
    const dispatched=marketplaceFulfillmentService.dispatch(seller,storeId,started.fulfillment.id,{
      carrier_name:'Courier',tracking_reference:'TRK-001',service_level:'Next day'
    });
    assert.equal(dispatched.fulfillment.status,'IN_TRANSIT');
    const reported=marketplaceFulfillmentService.reportDelivery(seller,storeId,started.fulfillment.id,{
      recipient_name:'Gate security',proof_reference:'POD-001'
    });
    assert.equal(reported.fulfillment.status,'DELIVERY_REPORTED');
    assert.equal(reported.truth.buyer_receipt_confirmed,false);
    assert.ok(reported.events.some((e:any)=>e.event_type==='DELIVERY_REPORTED'&&e.source_type==='SELLER_RECORDED'));
    const completed=marketplaceFulfillmentService.confirmReceipt(buyer,order.order.id,{note:'Package received'});
    assert.equal(completed.fulfillment.status,'COMPLETED');
    assert.equal(completed.truth.buyer_receipt_confirmed,true);
  });

  it('return request is item-level and cannot exceed purchased/remaining quantities',()=>{
    const {order}=makeOrder('PICKUP',true,2);
    completePickup(order.order.id);
    const orderItem=order.items[0];
    const ret=marketplaceFulfillmentService.requestReturn(buyer,order.order.id,{
      reason:'One unit defective',items:[{order_item_id:orderItem.id,quantity:1}]
    });
    assert.equal(ret.return.status,'REQUESTED');
    assert.equal(ret.items[0].requested_quantity,1);
    assert.throws(
      ()=>marketplaceFulfillmentService.requestReturn(buyer,order.order.id,{
        reason:'Try too many',items:[{order_item_id:orderItem.id,quantity:2}]
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
  });

  it('physical receipt controls restocking and does not confirm a refund',()=>{
    const {order,listing}=makeOrder('PICKUP',true,2);
    completePickup(order.order.id);
    const ret=marketplaceFulfillmentService.requestReturn(buyer,order.order.id,{
      reason:'Return one',items:[{order_item_id:order.items[0].id,quantity:1}]
    });
    marketplaceFulfillmentService.reviewReturn(seller,storeId,ret.return.id,{decision:'APPROVE'});
    const received=marketplaceFulfillmentService.receiveReturn(seller,storeId,ret.return.id,{
      items:[{return_item_id:ret.items[0].id,received_quantity:1,restock_quantity:1,
        condition_at_return:'RESTOCKABLE',notes:'Sealed and sellable'}]
    });
    assert.equal(received.return.status,'RECEIVED');
    assert.equal(received.truth.physical_return_received,true);
    assert.equal(received.truth.inventory_restocked,true);
    assert.equal(received.truth.refund_confirmed,false);
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listing.id) as any).stock_quantity,4);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_refunds WHERE order_id=?').get(order.order.id) as any).count,0);
  });

  it('damaged received goods do not return to available stock',()=>{
    const {order,listing}=makeOrder('PICKUP',true,1);
    completePickup(order.order.id);
    const ret=marketplaceFulfillmentService.requestReturn(buyer,order.order.id,{
      reason:'Damaged part',items:[{order_item_id:order.items[0].id,quantity:1}]
    });
    marketplaceFulfillmentService.reviewReturn(seller,storeId,ret.return.id,{decision:'APPROVE'});
    assert.throws(
      ()=>marketplaceFulfillmentService.receiveReturn(seller,storeId,ret.return.id,{
        items:[{return_item_id:ret.items[0].id,received_quantity:1,restock_quantity:1,condition_at_return:'DAMAGED'}]
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
    marketplaceFulfillmentService.receiveReturn(seller,storeId,ret.return.id,{
      items:[{return_item_id:ret.items[0].id,received_quantity:1,restock_quantity:0,condition_at_return:'DAMAGED'}]
    });
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listing.id) as any).stock_quantity,4);
  });

  it('seller requests refund only after physical receipt; provider confirmation completes a full return',()=>{
    const {order,listing}=makeOrder('PICKUP',true,2);
    completePickup(order.order.id);
    const ret=marketplaceFulfillmentService.requestReturn(buyer,order.order.id,{
      reason:'Full return',items:[{order_item_id:order.items[0].id,quantity:2}]
    });
    marketplaceFulfillmentService.reviewReturn(seller,storeId,ret.return.id,{decision:'APPROVE'});
    const shipped=marketplaceFulfillmentService.markReturnShipped(buyer,ret.return.id,{tracking_reference:'RET-TRK-1'});
    assert.equal(shipped.return.status,'IN_TRANSIT');
    const received=marketplaceFulfillmentService.receiveReturn(seller,storeId,ret.return.id,{
      items:[{return_item_id:ret.items[0].id,received_quantity:2,restock_quantity:2,condition_at_return:'RESTOCKABLE'}]
    });
    assert.equal(received.return.status,'RECEIVED');
    const requested=marketplaceFulfillmentService.requestReturnRefund(seller,storeId,ret.return.id,'return-refund-idem-001');
    assert.equal(requested.return.status,'REFUND_REQUESTED');
    assert.equal(requested.truth.refund_confirmed,false);
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listing.id) as any).stock_quantity,5);

    const refund=db.prepare('SELECT * FROM marketplace_refunds WHERE id=?').get(requested.return.refund_id) as any;
    const event={provider_event_id:'evt-full-return-refund',event_type:'REFUND_SUCCEEDED',
      provider_payment_id:'ful_pp_'+counter,order_id:order.order.id,amount_minor:Number(refund.amount_minor),currency:'KES',
      occurred_at:'2026-10-31T17:30:00.000Z',refund_id:String(refund.id),provider_refund_id:'pr_full_return'};
    marketplacePaymentService.processWebhook('FULPAY',sign(secret,event),event as any);

    const final=marketplaceFulfillmentService.getBuyerReturn(buyer,ret.return.id);
    assert.equal(final.return.status,'COMPLETED');
    assert.equal(final.truth.refund_confirmed,true);
    const ful=marketplaceFulfillmentService.getBuyerFulfillment(buyer,order.order.id)!;
    assert.equal(ful.fulfillment.status,'RETURNED');
    assert.equal(ful.financial.net_paid_minor,0);
  });

  it('once fulfillment starts buyer direct refund is rejected in favor of return workflow',()=>{
    const {order}=makeOrder('PICKUP',true,1);
    marketplaceFulfillmentService.startFulfillment(seller,storeId,order.order.id,{});
    assert.throws(
      ()=>marketplacePaymentService.requestRefund(buyer,order.order.id,{amount_minor:100000,reason:'Skip return'},'buyer-direct-after-ful'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
  });

  it('seller fulfillment and returns remain tenant isolated',()=>{
    const {order}=makeOrder('PICKUP',true,1);
    const started=marketplaceFulfillmentService.startFulfillment(seller,storeId,order.order.id,{});
    assert.throws(
      ()=>marketplaceFulfillmentService.listSellerFulfillments(otherSeller,storeId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplaceFulfillmentService.markReady(otherSeller,storeId,started.fulfillment.id,{}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });
});
