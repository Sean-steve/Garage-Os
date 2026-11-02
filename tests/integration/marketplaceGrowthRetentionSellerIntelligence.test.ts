/**
 * Sprint 31 — Marketplace Growth, Retention & Seller Intelligence
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceEngagementService } from '../../src/server/marketplaceEngagement/marketplaceEngagementService';
import { marketplaceGrowthService } from '../../src/server/marketplaceGrowth/marketplaceGrowthService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z'},session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Marketplace Growth, Retention & Seller Intelligence (Sprint 31)',()=>{
  let db:any,counter=0;
  const orgA='org_growth_a',orgB='org_growth_b';
  const sellerA=actor('usr_growth_seller_a','seller-a@growth.test',[membership('usr_growth_seller_a',orgA,'Growth A')]);
  const sellerB=actor('usr_growth_seller_b','seller-b@growth.test',[membership('usr_growth_seller_b',orgB,'Growth B')]);
  const buyers=[
    actor('usr_growth_buyer1','buyer1@growth.test'),
    actor('usr_growth_buyer2','buyer2@growth.test'),
    actor('usr_growth_buyer3','buyer3@growth.test'),
    actor('usr_growth_buyer4','buyer4@growth.test'),
  ];
  const admin=actor('usr_growth_admin','admin@growth.test',[],[PlatformRole.PLATFORM_ADMIN]);
  let storeA:string,storeB:string;

  beforeEach(()=>{
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);counter=0;
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const people=[
      [sellerA.user_id,sellerA.email,'Seller A','+254705000001'],
      [sellerB.user_id,sellerB.email,'Seller B','+254705000002'],
      ...buyers.map((b,i)=>[b.user_id,b.email,'Buyer '+(i+1),'+25470500000'+(i+3)]),
      [admin.user_id,admin.email,'Platform Admin','+254705000009'],
    ];
    for(const [id,email,name,phone] of people)user.run(id,email,name,phone,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgA,'Growth A','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    org.run(orgB,'Growth B','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+sellerA.user_id,sellerA.user_id,orgA,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    mem.run('mem_'+sellerB.user_id,sellerB.user_id,orgB,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');

    db.prepare('INSERT INTO user_platform_roles (user_id,role,assigned_by,assigned_at) VALUES (?,?,?,?)')
      .run(admin.user_id,PlatformRole.PLATFORM_ADMIN,admin.user_id,'2026-01-01T00:00:00.000Z');

    storeA=marketplaceService.createStore(sellerA,{organization_id:orgA,slug:'growth-a',display_name:'Growth A'}).id;
    marketplaceService.updateStore(sellerA,storeA,{status:'ACTIVE'});
    storeB=marketplaceService.createStore(sellerB,{organization_id:orgB,slug:'growth-b',display_name:'Growth B'}).id;
    marketplaceService.updateStore(sellerB,storeB,{status:'ACTIVE'});

    db.prepare(`
      INSERT INTO marketplace_payment_providers
      (id,provider_key,display_name,mode,status,webhook_secret_env,supports_refunds,created_by,created_at,updated_at)
      VALUES ('mpp_growth','growth-provider','Growth Provider','TEST','ACTIVE','GROWTH_SECRET',1,?,?,?)
    `).run(admin.user_id,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
  });

  function listing(args:{seller?:any;storeId?:string;title:string;categoryId?:string;productType?:'PART'|'TYRE'|'ACCESSORY'|'CONSUMABLE'|'TOOL'|'ELECTRONICS'|'OTHER';price?:number;stock?:number}){
    counter++;const seller=args.seller||sellerA,storeId=args.storeId||storeA;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:args.categoryId||'mcat_brakes',product_type:args.productType||'PART',seller_sku:'GR-'+counter,title:args.title,
      description:args.title+' description',brand:'GrowthBrand',manufacturer_part_number:'GR-MPN-'+counter,condition:'NEW'
    });
    const l=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:args.price||100000,currency:'KES',inventory_tracking:'QUANTITY',
      stock_quantity:args.stock===undefined?20:args.stock,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,l.id);
    return {product,listing:l};
  }

  function order(args:{storeId?:string;buyer:any;item:any;placedAt:string;quantity?:number}){
    counter++;const storeId=args.storeId||storeA,q=args.quantity||1;
    const cartId='mcart_gr_'+counter,orderId='morder_gr_'+counter,itemId='moitem_gr_'+counter;
    db.prepare(`
      INSERT INTO marketplace_carts (id,buyer_user_id,store_id,vehicle_id,currency,status,created_at,updated_at)
      VALUES (?,?,?,NULL,'KES','CHECKED_OUT',?,?)
    `).run(cartId,args.buyer.user_id,storeId,args.placedAt,args.placedAt);
    db.prepare(`
      INSERT INTO marketplace_orders
      (id,order_number,buyer_user_id,store_id,vehicle_id,cart_id,status,payment_status,currency,subtotal_minor,total_minor,
       fulfillment_mode,delivery_name,delivery_phone,delivery_address_json,fitment_acknowledged,fitment_acknowledgement_text,
       placed_at,cancelled_at,cancellation_reason,created_at,updated_at)
      VALUES (?,?,?, ?,NULL,?,'AWAITING_PAYMENT','NOT_STARTED','KES',?,?,'PICKUP',NULL,NULL,NULL,0,NULL,?,NULL,NULL,?,?)
    `).run(orderId,'GR-'+counter,args.buyer.user_id,storeId,cartId,args.item.listing.price_minor*q,args.item.listing.price_minor*q,
      args.placedAt,args.placedAt,args.placedAt);
    db.prepare(`
      INSERT INTO marketplace_order_items
      (id,order_id,listing_id,product_id,seller_sku,title,quantity,unit_price_minor,line_total_minor,currency,listing_version,
       fitment_status,fitment_confidence,fitment_decision_id,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,'KES',1,NULL,NULL,NULL,?)
    `).run(itemId,orderId,args.item.listing.id,args.item.product.id,args.item.product.seller_sku,args.item.product.title,q,
      args.item.listing.price_minor,args.item.listing.price_minor*q,args.placedAt);
    return {id:orderId,itemId,total:args.item.listing.price_minor*q};
  }

  function capture(o:any,storeId:string,at:string){
    const intent='mpi_'+o.id;
    db.prepare(`
      INSERT INTO marketplace_payment_intents
      (id,order_id,provider_id,idempotency_key,provider_payment_id,client_reference,amount_minor,currency,status,
       failure_code,failure_message,created_by,created_at,updated_at)
      VALUES (?,?, 'mpp_growth',?,?,?,?,'KES','SUCCEEDED',NULL,NULL,?,?,?)
    `).run(intent,o.id,'idem_'+o.id,'provider_'+o.id,'client_'+o.id,o.total,admin.user_id,at,at);
    db.prepare(`
      INSERT INTO marketplace_settlement_ledger_entries
      (id,store_id,order_id,payment_intent_id,refund_id,entry_type,amount_minor,currency,created_at)
      VALUES (?,?,?,?,NULL,'PAYMENT_CAPTURE',?,'KES',?)
    `).run('mledger_'+o.id,storeId,o.id,intent,o.total,at);
    return intent;
  }

  function refund(o:any,storeId:string,intent:string,at:string,amount:number){
    const rid='mrefund_'+o.id;
    db.prepare(`
      INSERT INTO marketplace_refunds
      (id,order_id,payment_intent_id,idempotency_key,provider_refund_id,amount_minor,currency,reason,status,requested_by,requested_at,updated_at)
      VALUES (?,?,?,?,?,?,'KES','TEST_REFUND','SUCCEEDED',?,?,?)
    `).run(rid,o.id,intent,'refund-'+o.id,'provider-refund-'+o.id,amount,admin.user_id,at,at);
    db.prepare(`
      INSERT INTO marketplace_settlement_ledger_entries
      (id,store_id,order_id,payment_intent_id,refund_id,entry_type,amount_minor,currency,created_at)
      VALUES (?,?,?,?,?,'REFUND_ADJUSTMENT',?,'KES',?)
    `).run('mledger_ref_'+o.id,storeId,o.id,intent,rid,-amount,at);
  }

  function fulfillment(o:any,status:string,at:string){
    db.prepare(`
      INSERT INTO marketplace_fulfillments
      (id,order_id,store_id,fulfillment_mode,status,carrier_name,service_level,tracking_reference,seller_notes,
       prepared_at,ready_at,dispatched_at,delivery_reported_at,completed_at,created_by,created_at,updated_at)
      VALUES (?,?,?,'PICKUP',?,NULL,NULL,NULL,NULL,?,?,?,?,NULL,?,?,?)
    `).run('mful_'+o.id,o.id,storeA,status,at,at,at,status==='DELIVERY_REPORTED'?at:null,sellerA.user_id,at,at);
  }

  it('compares current growth with the immediately preceding equal-length period using settlement captures only',()=>{
    const p=listing({title:'Growth brake kit'});
    const prior=order({buyer:buyers[3],item:p,placedAt:'2026-06-15T08:00:00.000Z'});capture(prior,storeA,'2026-06-15T09:00:00.000Z');
    const b1a=order({buyer:buyers[0],item:p,placedAt:'2026-08-01T08:00:00.000Z'});capture(b1a,storeA,'2026-08-01T09:00:00.000Z');
    const b1b=order({buyer:buyers[0],item:p,placedAt:'2026-08-20T08:00:00.000Z'});capture(b1b,storeA,'2026-08-20T09:00:00.000Z');
    const b2a=order({buyer:buyers[1],item:p,placedAt:'2026-09-01T08:00:00.000Z'});capture(b2a,storeA,'2026-09-01T09:00:00.000Z');
    const b2b=order({buyer:buyers[1],item:p,placedAt:'2026-10-20T08:00:00.000Z'});capture(b2b,storeA,'2026-10-20T09:00:00.000Z');
    const b3=order({buyer:buyers[2],item:p,placedAt:'2026-10-20T10:00:00.000Z'});capture(b3,storeA,'2026-10-20T11:00:00.000Z');
    const returning=order({buyer:buyers[3],item:p,placedAt:'2026-11-01T08:00:00.000Z'});capture(returning,storeA,'2026-11-01T09:00:00.000Z');
    const unpaid=order({buyer:buyers[2],item:p,placedAt:'2026-11-01T10:00:00.000Z'});assert.ok(unpaid.id);

    const result=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-08-01',to:'2026-11-01'});
    assert.equal(result.growth.current.captured_orders,6);
    assert.equal(result.growth.current.distinct_paid_buyers,4);
    assert.equal(result.growth.current.new_paid_buyers,3);
    assert.equal(result.growth.current.returning_paid_buyers,1);
    assert.equal(result.growth.current.repeat_paid_buyers_in_period,2);
    assert.equal(result.growth.current.repeat_paid_buyer_percent,50);
    assert.equal(result.growth.previous.captured_orders,1);
    assert.equal(result.growth.change.captured_orders_percent,500);
    assert.equal(result.growth.truth.paid_truth_source,'SETTLEMENT_LEDGER');
  });

  it('excludes immature buyers from 30/90-day denominators and never infers churn',()=>{
    const p=listing({title:'Retention filter'});
    const b1a=order({buyer:buyers[0],item:p,placedAt:'2026-08-01T08:00:00.000Z'});capture(b1a,storeA,'2026-08-01T09:00:00.000Z');
    const b1b=order({buyer:buyers[0],item:p,placedAt:'2026-08-20T08:00:00.000Z'});capture(b1b,storeA,'2026-08-20T09:00:00.000Z');
    const b2a=order({buyer:buyers[1],item:p,placedAt:'2026-09-01T08:00:00.000Z'});capture(b2a,storeA,'2026-09-01T09:00:00.000Z');
    const b2b=order({buyer:buyers[1],item:p,placedAt:'2026-10-20T08:00:00.000Z'});capture(b2b,storeA,'2026-10-20T09:00:00.000Z');
    const b3=order({buyer:buyers[2],item:p,placedAt:'2026-10-20T10:00:00.000Z'});capture(b3,storeA,'2026-10-20T11:00:00.000Z');

    const r=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-08-01',to:'2026-11-01'}).retention;
    assert.equal(r.eligible_30d,2);
    assert.equal(r.repeated_within_30d,1);
    assert.equal(r.repeat_30d_percent,50);
    assert.equal(r.eligible_90d,1);
    assert.equal(r.repeated_within_90d,1);
    assert.equal(r.repeat_90d_percent,100);
    assert.equal(r.truth.immature_buyers_excluded,true);
    assert.equal(r.truth.churn_inferred,false);
    assert.equal(r.truth.repeat_purchase_not_subscription_retention,true);
  });

  it('returns null percentage change when the prior comparison baseline is zero',()=>{
    const p=listing({title:'First growth'});
    const o=order({buyer:buyers[0],item:p,placedAt:'2026-11-01T08:00:00.000Z'});capture(o,storeA,'2026-11-01T09:00:00.000Z');
    const g=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-11-01',to:'2026-11-01'}).growth;
    assert.equal(g.previous.captured_orders,0);
    assert.equal(g.change.captured_orders_percent,null);
    assert.equal(g.truth.zero_baseline_percent_is_null,true);
  });

  it('uses explicit current saves for demand intelligence without browsing/search history or saver identities',()=>{
    const out=listing({title:'Saved out of stock',categoryId:'mcat_tyres',productType:'TYRE',stock:0});
    const inStock=listing({title:'Saved no capture',stock:8});
    marketplaceEngagementService.saveListing(buyers[0],out.listing.id,{});
    marketplaceEngagementService.saveListing(buyers[1],out.listing.id,{});
    marketplaceEngagementService.saveListing(buyers[2],inStock.listing.id,{});

    const result=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-10-01',to:'2026-11-01'});
    const tyre=result.categories.find(x=>x.category_code==='TYRES')!;
    assert.equal(tyre.current_saved_instances,2);
    assert.equal(tyre.out_of_stock_saved_instances,2);
    assert.ok(result.opportunities.some(x=>x.type==='RESTOCK_SAVED_DEMAND'&&x.listing_id===out.listing.id));
    assert.ok(result.opportunities.some(x=>x.type==='SAVED_DEMAND_NO_CAPTURE'&&x.listing_id===inStock.listing.id));
    assert.equal(result.truth.browsing_history_used,false);
    assert.equal(result.truth.search_history_used,false);
    assert.equal(result.truth.hidden_behavioral_profile_used,false);
    assert.equal(result.truth.explicit_saved_intent_used,true);
    const json=JSON.stringify(result);
    for(const b of buyers)assert.equal(json.includes(b.user_id),false);
  });

  it('generates deterministic evidence opportunities and excludes refunded orders from fully-paid fulfillment backlog',()=>{
    const p=listing({title:'Opportunity part',stock:2});
    marketplaceEngagementService.saveListing(buyers[0],p.listing.id,{});
    const paid=order({buyer:buyers[0],item:p,placedAt:'2026-10-01T08:00:00.000Z'});capture(paid,storeA,'2026-10-01T09:00:00.000Z');
    const refunded=order({buyer:buyers[1],item:p,placedAt:'2026-10-02T08:00:00.000Z'});const ri=capture(refunded,storeA,'2026-10-02T09:00:00.000Z');refund(refunded,storeA,ri,'2026-10-02T10:00:00.000Z',50000);
    const delivered=order({buyer:buyers[2],item:p,placedAt:'2026-10-03T08:00:00.000Z'});capture(delivered,storeA,'2026-10-03T09:00:00.000Z');fulfillment(delivered,'DELIVERY_REPORTED','2026-10-03T12:00:00.000Z');

    const ops=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-10-01',to:'2026-11-01'}).opportunities;
    const backlog=ops.find(x=>x.type==='PAID_ORDER_FULFILLMENT_BACKLOG')!;
    assert.equal(backlog.evidence.captured_orders_without_fulfillment,1);
    assert.ok(ops.some(x=>x.type==='BUYER_CONFIRMATION_PENDING'));
    assert.ok(ops.some(x=>x.type==='LOW_STOCK_DEMAND'));
    assert.ok(ops.every(x=>x.automatic_action===false));
    assert.match(backlog.suggested_action,/canonical fulfillment workflow/i);
  });

  it('creates review-coverage intelligence only from captured commercial activity without fabricating reviews',()=>{
    const p=listing({title:'Review coverage part'});
    for(let i=0;i<3;i++){
      const o=order({buyer:buyers[i],item:p,placedAt:`2026-10-0${i+1}T08:00:00.000Z`});
      capture(o,storeA,`2026-10-0${i+1}T09:00:00.000Z`);
    }
    const result=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-10-01',to:'2026-11-01'});
    const opportunity=result.opportunities.find(x=>x.type==='REVIEW_COVERAGE'&&x.listing_id===p.listing.id);
    assert.ok(opportunity);
    assert.equal(opportunity!.evidence.captured_orders,3);
    assert.match(opportunity!.suggested_action,/Do not expose buyer identities or fabricate reviews/i);
    assert.equal(Number((db.prepare('SELECT COUNT(*) count FROM marketplace_reviews').get() as any).count),0);
  });

  it('keeps category/listing paid demand capture-qualified and excludes unpaid units',()=>{
    const brakes=listing({title:'Brake demand'});
    const tyres=listing({title:'Tyre demand',categoryId:'mcat_tyres',productType:'TYRE'});
    const paid=order({buyer:buyers[0],item:brakes,placedAt:'2026-10-01T08:00:00.000Z',quantity:2});capture(paid,storeA,'2026-10-01T09:00:00.000Z');
    order({buyer:buyers[1],item:brakes,placedAt:'2026-10-02T08:00:00.000Z',quantity:8});
    const tyrePaid=order({buyer:buyers[2],item:tyres,placedAt:'2026-10-03T08:00:00.000Z'});capture(tyrePaid,storeA,'2026-10-03T09:00:00.000Z');

    const result=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-10-01',to:'2026-11-01'});
    const brake=result.categories.find(x=>x.category_code==='BRAKE_PARTS')!;
    assert.equal(brake.captured_orders,1);
    assert.equal(brake.captured_units,2);
    const signal=result.listing_signals.find(x=>x.listing_id===brakes.listing.id)!;
    assert.equal(signal.captured_orders,1);
    assert.equal(signal.captured_units,2);
  });

  it('enforces seller tenant isolation and admin-only platform aggregation without store ranking',()=>{
    const a=listing({title:'Tenant A'});
    const b=listing({seller:sellerB,storeId:storeB,title:'Tenant B'});
    const ao=order({buyer:buyers[0],item:a,placedAt:'2026-10-01T08:00:00.000Z'});capture(ao,storeA,'2026-10-01T09:00:00.000Z');
    const bo=order({storeId:storeB,buyer:buyers[1],item:b,placedAt:'2026-10-02T08:00:00.000Z'});capture(bo,storeB,'2026-10-02T09:00:00.000Z');

    assert.throws(
      ()=>marketplaceGrowthService.seller(sellerB,storeA,{from:'2026-10-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplaceGrowthService.platform(sellerA,{from:'2026-10-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    const platform=marketplaceGrowthService.platform(admin,{from:'2026-10-01',to:'2026-11-01'});
    assert.equal(platform.growth.current.captured_orders,2);
    assert.equal(platform.stores.length,2);
    assert.equal(platform.truth.opaque_store_ranking,false);
    assert.equal(platform.truth.buyer_identities_exposed,false);
    const json=JSON.stringify(platform);
    for(const buyer of buyers)assert.equal(json.includes(buyer.user_id),false);
  });

  it('does not mutate marketplace authority while reading seller intelligence',()=>{
    const p=listing({title:'Read only part'});
    const o=order({buyer:buyers[0],item:p,placedAt:'2026-10-01T08:00:00.000Z'});capture(o,storeA,'2026-10-01T09:00:00.000Z');
    const before={
      orders:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_orders').get() as any).count),
      ledger:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries').get() as any).count),
      listings:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_listings').get() as any).count),
      saves:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_saved_listings').get() as any).count),
    };
    const result=marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-10-01',to:'2026-11-01'});
    const after={
      orders:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_orders').get() as any).count),
      ledger:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries').get() as any).count),
      listings:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_listings').get() as any).count),
      saves:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_saved_listings').get() as any).count),
    };
    assert.deepEqual(after,before);
    assert.equal(result.truth.read_only,true);
    assert.equal(result.truth.automatic_seller_actions,false);
    assert.equal(Object.prototype.hasOwnProperty.call(result,'growth_score'),false);
    assert.equal(Object.prototype.hasOwnProperty.call(result,'churn_score'),false);
  });

  it('rejects reversed and overlong growth windows',()=>{
    assert.throws(()=>marketplaceGrowthService.seller(sellerA,storeA,{from:'2026-11-02',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR);
    assert.throws(()=>marketplaceGrowthService.seller(sellerA,storeA,{from:'2025-01-01',to:'2026-11-01'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR);
  });
});
