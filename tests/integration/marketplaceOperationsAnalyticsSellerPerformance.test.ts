/**
 * Sprint 30 — Marketplace Operations Analytics & Seller Performance
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceEngagementService } from '../../src/server/marketplaceEngagement/marketplaceEngagementService';
import { marketplaceAnalyticsService } from '../../src/server/marketplaceAnalytics/marketplaceAnalyticsService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z'},session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Marketplace Operations Analytics & Seller Performance (Sprint 30)',()=>{
  let db:any,counter=0;
  const orgA='org_analytics_a',orgB='org_analytics_b';
  const sellerA=actor('usr_analytics_seller_a','seller-a@analytics.test',[membership('usr_analytics_seller_a',orgA,'Analytics A')]);
  const sellerB=actor('usr_analytics_seller_b','seller-b@analytics.test',[membership('usr_analytics_seller_b',orgB,'Analytics B')]);
  const buyer1=actor('usr_analytics_buyer1','buyer1@analytics.test');
  const buyer2=actor('usr_analytics_buyer2','buyer2@analytics.test');
  const admin=actor('usr_analytics_admin','admin@analytics.test',[],[PlatformRole.PLATFORM_ADMIN]);
  let storeA:string,storeB:string;

  beforeEach(()=>{
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const users=[
      [sellerA.user_id,sellerA.email,'Seller A','+254704000001'],
      [sellerB.user_id,sellerB.email,'Seller B','+254704000002'],
      [buyer1.user_id,buyer1.email,'Buyer One','+254704000003'],
      [buyer2.user_id,buyer2.email,'Buyer Two','+254704000004'],
      [admin.user_id,admin.email,'Platform Admin','+254704000005'],
    ];
    for(const [id,email,name,phone] of users)user.run(id,email,name,phone,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgA,'Analytics A','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    org.run(orgB,'Analytics B','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+sellerA.user_id,sellerA.user_id,orgA,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    mem.run('mem_'+sellerB.user_id,sellerB.user_id,orgB,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');

    db.prepare(`
      INSERT INTO user_platform_roles (user_id,role,assigned_by,assigned_at)
      VALUES (?,?,?,?)
    `).run(admin.user_id,PlatformRole.PLATFORM_ADMIN,admin.user_id,'2026-11-01T00:00:00.000Z');

    storeA=marketplaceService.createStore(sellerA,{organization_id:orgA,slug:'analytics-a',display_name:'Analytics A'}).id;
    marketplaceService.updateStore(sellerA,storeA,{status:'ACTIVE'});
    storeB=marketplaceService.createStore(sellerB,{organization_id:orgB,slug:'analytics-b',display_name:'Analytics B'}).id;
    marketplaceService.updateStore(sellerB,storeB,{status:'ACTIVE'});

    db.prepare(`
      INSERT INTO marketplace_payment_providers
      (id,provider_key,display_name,mode,status,webhook_secret_env,supports_refunds,created_by,created_at,updated_at)
      VALUES ('mpp_analytics','analytics-provider','Analytics Provider','TEST','ACTIVE','ANALYTICS_SECRET',1,?,?,?)
    `).run(admin.user_id,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
  });

  function makeListing(args:{seller?:any;storeId?:string;title:string;price?:number;currency?:string;stock?:number}){
    counter++;const seller=args.seller||sellerA,storeId=args.storeId||storeA;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_brakes',product_type:'PART',seller_sku:'AN-'+counter,title:args.title,
      description:args.title+' description',brand:'AnalyticsBrand',manufacturer_part_number:'AN-MPN-'+counter,condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:args.price||100000,currency:args.currency||'KES',inventory_tracking:'QUANTITY',
      stock_quantity:args.stock===undefined?8:args.stock,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    return {product,listing};
  }

  function order(args:{storeId?:string;buyer?:any;listing:any;product:any;placedAt:string;quantity?:number;status?:'AWAITING_PAYMENT'|'CANCELLED'}){
    counter++;const storeId=args.storeId||storeA,buyer=args.buyer||buyer1,q=args.quantity||1;
    const cartId='mcart_an_'+counter,orderId='morder_an_'+counter,itemId='moitem_an_'+counter;
    db.prepare(`
      INSERT INTO marketplace_carts (id,buyer_user_id,store_id,vehicle_id,currency,status,created_at,updated_at)
      VALUES (?,?,?,NULL,?,'CHECKED_OUT',?,?)
    `).run(cartId,buyer.user_id,storeId,args.listing.currency,args.placedAt,args.placedAt);
    db.prepare(`
      INSERT INTO marketplace_orders
      (id,order_number,buyer_user_id,store_id,vehicle_id,cart_id,status,payment_status,currency,subtotal_minor,total_minor,
       fulfillment_mode,delivery_name,delivery_phone,delivery_address_json,fitment_acknowledged,fitment_acknowledgement_text,
       placed_at,cancelled_at,cancellation_reason,created_at,updated_at)
      VALUES (?,?,?, ?,NULL,?,?, 'NOT_STARTED',?,?,?,'PICKUP',NULL,NULL,NULL,0,NULL,?,?,?,?,?)
    `).run(orderId,'AN-'+counter,buyer.user_id,storeId,cartId,args.status||'AWAITING_PAYMENT',args.listing.currency,
      args.listing.price_minor*q,args.listing.price_minor*q,args.placedAt,args.status==='CANCELLED'?args.placedAt:null,
      args.status==='CANCELLED'?'Buyer cancelled':null,args.placedAt,args.placedAt);
    db.prepare(`
      INSERT INTO marketplace_order_items
      (id,order_id,listing_id,product_id,seller_sku,title,quantity,unit_price_minor,line_total_minor,currency,listing_version,
       fitment_status,fitment_confidence,fitment_decision_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,NULL,NULL,NULL,?)
    `).run(itemId,orderId,args.listing.id,args.product.id,args.product.seller_sku,args.product.title,q,args.listing.price_minor,
      args.listing.price_minor*q,args.listing.currency,args.placedAt);
    return {id:orderId,itemId,cartId,total:args.listing.price_minor*q,currency:args.listing.currency,buyerId:buyer.user_id};
  }

  function capture(o:any,storeId:string,at:string,amount=o.total){
    const intent='mpi_'+o.id;
    db.prepare(`
      INSERT INTO marketplace_payment_intents
      (id,order_id,provider_id,idempotency_key,provider_payment_id,client_reference,amount_minor,currency,status,
       failure_code,failure_message,created_by,created_at,updated_at)
      VALUES (?,?, 'mpp_analytics',?,?,?,?,?,'SUCCEEDED',NULL,NULL,?,?,?)
    `).run(intent,o.id,'idem_'+o.id,'provider_'+o.id,'client_'+o.id,amount,o.currency,admin.user_id,at,at);
    db.prepare(`
      INSERT INTO marketplace_settlement_ledger_entries
      (id,store_id,order_id,payment_intent_id,refund_id,entry_type,amount_minor,currency,created_at)
      VALUES (?,?,?,?,NULL,'PAYMENT_CAPTURE',?,?,?)
    `).run('mledger_cap_'+o.id,storeId,o.id,intent,amount,o.currency,at);
    return intent;
  }

  function refund(o:any,storeId:string,intent:string,at:string,amount:number){
    const refundId='mrefund_'+o.id;
    db.prepare(`
      INSERT INTO marketplace_refunds
      (id,order_id,payment_intent_id,idempotency_key,provider_refund_id,amount_minor,currency,reason,status,requested_by,requested_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'RETURN','SUCCEEDED',?,?,?)
    `).run(refundId,o.id,intent,'refund-idem-'+o.id,'provider-refund-'+o.id,amount,o.currency,admin.user_id,at,at);
    db.prepare(`
      INSERT INTO marketplace_settlement_ledger_entries
      (id,store_id,order_id,payment_intent_id,refund_id,entry_type,amount_minor,currency,created_at)
      VALUES (?,?,?,?,?,'REFUND_ADJUSTMENT',?,?,?)
    `).run('mledger_ref_'+o.id,storeId,o.id,intent,refundId,-amount,o.currency,at);
    return refundId;
  }

  function fulfillment(o:any,storeId:string,status:string,createdAt:string,completedAt:string|null=null){
    const id='mful_'+o.id;
    db.prepare(`
      INSERT INTO marketplace_fulfillments
      (id,order_id,store_id,fulfillment_mode,status,carrier_name,service_level,tracking_reference,seller_notes,
       prepared_at,ready_at,dispatched_at,delivery_reported_at,completed_at,created_by,created_at,updated_at)
      VALUES (?,?,?,'PICKUP',?,NULL,NULL,NULL,NULL,?,?,?,?,?,?,?,?)
    `).run(id,o.id,storeId,status,createdAt,createdAt,createdAt,status==='DELIVERY_REPORTED'?createdAt:null,completedAt,
      sellerA.user_id,createdAt,completedAt||createdAt);
    return id;
  }

  it('derives financial KPIs only from settlement ledger and never labels order totals as revenue/payout',()=>{
    const p=makeListing({title:'Ledger brake kit',price:500000});
    const paid=order({listing:p.listing,product:p.product,placedAt:'2026-11-01T08:00:00.000Z'});
    const intent=capture(paid,storeA,'2026-11-01T09:00:00.000Z');
    refund(paid,storeA,intent,'2026-11-01T12:00:00.000Z',125000);
    order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T10:00:00.000Z'});
    const result=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'});
    assert.equal(result.money.length,1);
    assert.equal(result.money[0].captured_gross_minor,500000);
    assert.equal(result.money[0].refunded_minor,125000);
    assert.equal(result.money[0].net_seller_receivable_minor,375000);
    assert.equal(result.money[0].captured_order_count,1);
    assert.equal(result.money[0].truth.receivable_is_payout,false);
    assert.equal(JSON.stringify(result).includes('"revenue"'),false);
    assert.equal(JSON.stringify(result).includes('"payout_minor"'),false);
  });

  it('keeps currencies separate instead of summing unlike money',()=>{
    const kes=makeListing({title:'KES part',price:100000,currency:'KES'});
    const usd=makeListing({title:'USD part',price:2500,currency:'USD'});
    const ko=order({listing:kes.listing,product:kes.product,placedAt:'2026-11-01T08:00:00.000Z'});
    const uo=order({listing:usd.listing,product:usd.product,buyer:buyer2,placedAt:'2026-11-01T09:00:00.000Z'});
    capture(ko,storeA,'2026-11-01T08:30:00.000Z');
    capture(uo,storeA,'2026-11-01T09:30:00.000Z');
    const money=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'}).money;
    assert.deepEqual(money.map(x=>x.currency),['KES','USD']);
    assert.equal(money.find(x=>x.currency==='KES')!.captured_gross_minor,100000);
    assert.equal(money.find(x=>x.currency==='USD')!.captured_gross_minor,2500);
  });

  it('computes explainable order cohort funnel without using legacy payment_status as paid truth',()=>{
    const p=makeListing({title:'Funnel item',price:200000});
    const paid=order({listing:p.listing,product:p.product,placedAt:'2026-11-01T08:00:00.000Z'});
    capture(paid,storeA,'2026-11-01T09:00:00.000Z');
    fulfillment(paid,storeA,'COMPLETED','2026-11-01T10:00:00.000Z','2026-11-01T11:00:00.000Z');
    order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T12:00:00.000Z'});
    order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T13:00:00.000Z',status:'CANCELLED'});
    const result=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'});
    assert.equal(result.funnel.orders_placed,3);
    assert.equal(result.funnel.captured_orders,1);
    assert.equal(result.funnel.cancelled_pre_payment,1);
    assert.equal(result.funnel.buyer_confirmed_completed,1);
    assert.equal(result.funnel.cohort_rates.order_to_captured_percent,33.33);
    assert.equal(result.truth.money_source,'SETTLEMENT_LEDGER');
  });

  it('separates current operational workload states instead of collapsing them into an order status',()=>{
    const low=makeListing({title:'Low stock item',stock:2});
    const out=makeListing({title:'Out stock item',stock:0});
    const noFul=order({listing:low.listing,product:low.product,placedAt:'2026-11-01T08:00:00.000Z'});
    capture(noFul,storeA,'2026-11-01T08:30:00.000Z');
    const delivered=order({listing:low.listing,product:low.product,buyer:buyer2,placedAt:'2026-11-01T09:00:00.000Z'});
    capture(delivered,storeA,'2026-11-01T09:30:00.000Z');
    fulfillment(delivered,storeA,'DELIVERY_REPORTED','2026-11-01T10:00:00.000Z');
    const unpaid=order({listing:out.listing,product:out.product,buyer:buyer2,placedAt:'2026-11-01T11:00:00.000Z'});
    assert.ok(unpaid.id);
    const ops=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'}).operations;
    assert.equal(ops.unpaid_awaiting_payment,1);
    assert.equal(ops.paid_without_fulfillment,1);
    assert.equal(ops.delivery_reported_waiting_buyer,1);
    assert.equal(ops.low_stock_listings,1);
    assert.equal(ops.out_of_stock_listings,1);
    assert.match(ops.attention_items.find(x=>x.key==='DELIVERY_REPORTED_WAITING_BUYER')!.explanation,/not buyer-confirmed/i);
  });

  it('calculates fulfillment time and return quantities from physical return facts',()=>{
    const p=makeListing({title:'Returned part',price:300000});
    const o=order({listing:p.listing,product:p.product,placedAt:'2026-11-01T08:00:00.000Z',quantity:2});
    capture(o,storeA,'2026-11-01T09:00:00.000Z');
    const f=fulfillment(o,storeA,'RETURNED','2026-11-01T10:00:00.000Z','2026-11-01T13:00:00.000Z');
    db.prepare(`
      INSERT INTO marketplace_returns
      (id,return_number,order_id,fulfillment_id,buyer_user_id,store_id,status,reason,seller_decision_reason,
       return_tracking_reference,refund_id,requested_at,reviewed_at,shipped_at,received_at,completed_at,created_at,updated_at)
      VALUES ('mr_an','RET-AN',?,?,?,?,'COMPLETED','Changed mind',NULL,NULL,NULL,?,?,?,?,?,?,?)
    `).run(o.id,f,buyer1.user_id,storeA,'2026-11-01T14:00:00.000Z','2026-11-01T15:00:00.000Z','2026-11-01T16:00:00.000Z',
      '2026-11-01T17:00:00.000Z','2026-11-01T18:00:00.000Z','2026-11-01T14:00:00.000Z','2026-11-01T18:00:00.000Z');
    db.prepare(`
      INSERT INTO marketplace_return_items
      (id,return_id,order_item_id,listing_id,product_id,requested_quantity,received_quantity,restock_quantity,
       condition_at_return,unit_price_minor,refund_amount_minor,notes)
      VALUES ('mri_an','mr_an',?,?,?,2,2,1,'RESTOCKABLE',300000,300000,NULL)
    `).run(o.itemId,p.listing.id,p.product.id);
    const m=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'}).fulfillment;
    assert.equal(m.completed_fulfillments,1);
    assert.equal(m.average_capture_to_completion_hours,4);
    assert.equal(m.return_requests,1);
    assert.equal(m.completed_returns,1);
    assert.equal(m.physically_received_return_units,2);
    assert.equal(m.restocked_return_units,1);
  });

  it('uses only published verified reviews and treats disputes as context without a trust/seller score',()=>{
    const p=makeListing({title:'Trust item'});
    const o=order({listing:p.listing,product:p.product,placedAt:'2026-11-01T08:00:00.000Z'});
    capture(o,storeA,'2026-11-01T08:30:00.000Z');
    const hiddenOrder=order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T09:00:00.000Z'});
    const review=db.prepare(`
      INSERT INTO marketplace_reviews
      (id,target_type,store_id,product_id,order_id,order_item_id,buyer_user_id,rating,title,body,verified_purchase,status,
       moderation_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)
    `);
    review.run('mrev_pub','PRODUCT',storeA,p.product.id,o.id,o.itemId,buyer1.user_id,5,'Great','Good','PUBLISHED',null,'2026-11-01T12:00:00.000Z','2026-11-01T12:00:00.000Z');
    review.run('mrev_hidden','PRODUCT',storeA,p.product.id,hiddenOrder.id,hiddenOrder.itemId,buyer2.user_id,1,'Hidden','Hidden','HIDDEN','moderated','2026-11-01T13:00:00.000Z','2026-11-01T13:00:00.000Z');
    db.prepare(`
      INSERT INTO marketplace_disputes
      (id,dispute_number,order_id,store_id,buyer_user_id,category,status,summary,buyer_requested_outcome,
       assigned_to_user_id,resolution_action,resolution_summary,opened_at,resolved_at,closed_at,created_at,updated_at)
      VALUES ('mdisp_an','DISP-AN',?,?,?,'OTHER','UNDER_REVIEW','Context only',NULL,NULL,NULL,NULL,?,NULL,NULL,?,?)
    `).run(o.id,storeA,buyer1.user_id,'2026-11-01T14:00:00.000Z','2026-11-01T14:00:00.000Z','2026-11-01T14:00:00.000Z');
    const trust=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'}).trust;
    assert.equal(trust.published_verified_review_count,1);
    assert.equal(trust.average_published_verified_rating,5);
    assert.equal(trust.total_disputes,1);
    assert.equal(trust.open_disputes,1);
    assert.equal(trust.truth.disputes_are_context_not_guilt,true);
    const full=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'});
    assert.equal(Object.prototype.hasOwnProperty.call(full,'seller_score'),false);
    assert.equal(Object.prototype.hasOwnProperty.call(full.trust,'trust_score'),false);
    assert.equal(full.truth.opaque_seller_score,false);
    assert.equal(full.trust.truth.opaque_trust_score,false);
  });

  it('listing performance counts captured units but excludes unpaid order units and keeps saves aggregate-only',()=>{
    const p=makeListing({title:'Top seller item',price:150000});
    const paid=order({listing:p.listing,product:p.product,placedAt:'2026-11-01T08:00:00.000Z',quantity:2});
    capture(paid,storeA,'2026-11-01T09:00:00.000Z');
    order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T10:00:00.000Z',quantity:5});
    marketplaceEngagementService.saveListing(buyer1,p.listing.id,{});
    marketplaceEngagementService.saveListing(buyer2,p.listing.id,{});
    const result=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'});
    const row=result.top_listings.find(x=>x.listing_id===p.listing.id)!;
    assert.equal(row.captured_order_count,1);
    assert.equal(row.captured_units,2);
    assert.equal(row.current_saved_count,2);
    assert.equal(row.captured_order_gross[0].amount_minor,300000);
    assert.equal(result.engagement.current_saved_instances,2);
    assert.equal(result.engagement.truth.saver_identities_exposed,false);
    assert.equal(JSON.stringify(result).includes(buyer1.user_id),false);
    assert.equal(JSON.stringify(result).includes(buyer2.user_id),false);
  });

  it('enforces seller tenant isolation and admin-only platform analytics',()=>{
    const a=makeListing({title:'Tenant A'});
    const b=makeListing({seller:sellerB,storeId:storeB,title:'Tenant B'});
    const ao=order({listing:a.listing,product:a.product,placedAt:'2026-11-01T08:00:00.000Z'});
    const bo=order({storeId:storeB,buyer:buyer2,listing:b.listing,product:b.product,placedAt:'2026-11-01T09:00:00.000Z'});
    capture(ao,storeA,'2026-11-01T08:30:00.000Z');capture(bo,storeB,'2026-11-01T09:30:00.000Z');
    assert.throws(
      ()=>marketplaceAnalyticsService.seller(sellerB,storeA,{from:'2026-11-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplaceAnalyticsService.platform(sellerA,{from:'2026-11-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    const platform=marketplaceAnalyticsService.platform(admin,{from:'2026-11-01',to:'2026-11-01'});
    assert.equal(platform.captured_orders,2);
    assert.equal(platform.store_performance.length,2);
    assert.equal(platform.truth.opaque_store_ranking,false);
    assert.equal(JSON.stringify(platform).includes(buyer1.user_id),false);
  });

  it('respects analytics date windows for financial and daily activity facts',()=>{
    const p=makeListing({title:'Windowed part'});
    const old=order({listing:p.listing,product:p.product,placedAt:'2026-10-01T08:00:00.000Z'});
    const current=order({listing:p.listing,product:p.product,buyer:buyer2,placedAt:'2026-11-01T08:00:00.000Z'});
    capture(old,storeA,'2026-10-01T09:00:00.000Z');capture(current,storeA,'2026-11-01T09:00:00.000Z');
    const result=marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'});
    assert.equal(result.money[0].captured_order_count,1);
    assert.equal(result.funnel.orders_placed,1);
    assert.deepEqual(result.daily.map(x=>x.date),['2026-11-01']);
    assert.equal(result.window.timezone,'UTC');
  });

  it('rejects invalid and overlong analytics windows',()=>{
    assert.throws(
      ()=>marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2025-01-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
    assert.throws(
      ()=>marketplaceAnalyticsService.seller(sellerA,storeA,{from:'2026-11-02',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
  });
});
