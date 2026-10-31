/**
 * Sprint 27 — Marketplace Trust, Reviews & Disputes
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
import { marketplaceTrustService } from '../../src/server/marketplaceTrust/marketplaceTrustService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},session_id:'ses_'+userId,
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

describe('Marketplace Trust, Reviews & Disputes (Sprint 27)',()=>{
  let db:any;
  const orgId='org_trust_seller',otherOrg='org_trust_other';
  const seller=actor('usr_trust_seller','seller@trust.test',[membership('usr_trust_seller',orgId,'Trust Seller')]);
  const otherSeller=actor('usr_trust_other','other@trust.test',[membership('usr_trust_other',otherOrg,'Other Seller')]);
  const buyer=actor('usr_trust_buyer','buyer@trust.test');
  const admin=actor('usr_trust_admin','admin@trust.test',[],[PlatformRole.PLATFORM_ADMIN]);
  const trustOps=actor('usr_trust_ops','trust@trust.test',[],[PlatformRole.TRUST_AND_SAFETY]);
  const ordinary=actor('usr_trust_ordinary','ordinary@trust.test');
  const secret='trust-webhook-secret';
  let storeId:string,otherStoreId:string;
  let counter=0;

  beforeEach(()=>{
    process.env.TRUST_WEBHOOK_SECRET=secret;
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);

    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const users=[
      [seller.user_id,seller.email,'Seller','+254701000001'],
      [otherSeller.user_id,otherSeller.email,'Other','+254701000002'],
      [buyer.user_id,buyer.email,'Buyer','+254701000003'],
      [admin.user_id,admin.email,'Admin','+254701000004'],
      [trustOps.user_id,trustOps.email,'Trust','+254701000005'],
      [ordinary.user_id,ordinary.email,'Ordinary','+254701000006'],
    ];
    for(const [id,email,name,phone] of users)user.run(id,email,name,phone,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Trust Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrg,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrg,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    storeId=marketplaceService.createStore(seller,{organization_id:orgId,slug:'trust-parts',display_name:'Trust Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});
    otherStoreId=marketplaceService.createStore(otherSeller,{organization_id:otherOrg,slug:'other-trust',display_name:'Other Trust'}).id;
    marketplaceService.updateStore(otherSeller,otherStoreId,{status:'ACTIVE'});
    marketplacePaymentService.createProvider(admin,{
      provider_key:'TRUSTPAY',display_name:'Trust Test Pay',mode:'TEST',
      webhook_secret_env:'TRUST_WEBHOOK_SECRET',supports_refunds:true
    });
  });

  function makeOrder(opts:{paid?:boolean;complete?:boolean;quantity?:number}={}){
    counter++;
    const paid=opts.paid!==false,complete=opts.complete!==false,quantity=opts.quantity||1;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'TRUST-'+counter,title:'Trust product '+counter,
      description:'Trust certification product.',brand:'Example',condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:250000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:5,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listing.id,quantity);
    const order=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'});
    if(paid){
      marketplacePaymentService.createIntent(buyer,order.order.id,'TRUSTPAY','trust-pay-'+counter+'-idem');
      const event={provider_event_id:'evt-trust-pay-'+counter,event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'trust_pp_'+counter,
        order_id:order.order.id,amount_minor:order.order.total_minor,currency:'KES',occurred_at:'2026-10-31T18:00:00.000Z'};
      marketplacePaymentService.processWebhook('TRUSTPAY',sign(secret,event),event as any);
    }
    if(paid&&complete){
      const f=marketplaceFulfillmentService.startFulfillment(seller,storeId,order.order.id,{});
      marketplaceFulfillmentService.markReady(seller,storeId,f.fulfillment.id,{});
      marketplaceFulfillmentService.confirmReceipt(buyer,order.order.id,{note:'Received'});
    }
    return {order,product,listing};
  }

  it('creates trust schema with no fabricated reviews or disputes',()=>{
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((x:any)=>x.name);
    for(const table of ['marketplace_reviews','marketplace_review_responses','marketplace_review_reports','marketplace_disputes','marketplace_dispute_messages']){
      assert.ok(names.includes(table),table+' must exist');
    }
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_reviews').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_disputes').get() as any).count,0);
  });

  it('rejects reviews without both captured payment and buyer-confirmed fulfillment',()=>{
    const unpaid=makeOrder({paid:false,complete:false});
    assert.throws(
      ()=>marketplaceTrustService.createReview(buyer,unpaid.order.order.id,{target_type:'STORE',rating:5}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
    const paidNotComplete=makeOrder({paid:true,complete:false});
    assert.throws(
      ()=>marketplaceTrustService.createReview(buyer,paidNotComplete.order.order.id,{target_type:'STORE',rating:5}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
  });

  it('creates unique verified store and product reviews only from purchased order facts',()=>{
    const {order}=makeOrder();
    const storeReview=marketplaceTrustService.createReview(buyer,order.order.id,{
      target_type:'STORE',rating:5,title:'Great seller',body:'Order was prepared correctly.'
    });
    assert.equal(storeReview.review.verified_purchase,true);
    assert.equal(storeReview.review.status,'PUBLISHED');
    const productReview=marketplaceTrustService.createReview(buyer,order.order.id,{
      target_type:'PRODUCT',order_item_id:order.items[0].id,rating:4,title:'Good part',body:'Matched the ordered item.'
    });
    assert.equal(productReview.review.product_id,order.items[0].product_id);
    assert.throws(
      ()=>marketplaceTrustService.createReview(buyer,order.order.id,{target_type:'STORE',rating:1}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.CONFLICT
    );
    assert.throws(
      ()=>marketplaceTrustService.createReview(buyer,order.order.id,{target_type:'PRODUCT',order_item_id:'wrong',rating:5}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
  });

  it('publishes factual trust metrics and never creates an opaque trust score',()=>{
    const a=makeOrder();const b=makeOrder();
    marketplaceTrustService.createReview(buyer,a.order.order.id,{target_type:'STORE',rating:5,body:'Five'});
    marketplaceTrustService.createReview(buyer,b.order.order.id,{target_type:'STORE',rating:3,body:'Three'});
    const trust=marketplaceTrustService.getStoreTrust(storeId);
    assert.equal(trust.summary.verified_review_count,2);
    assert.equal(trust.summary.average_rating,4);
    assert.equal(trust.summary.rating_distribution['5'],1);
    assert.equal(trust.summary.rating_distribution['3'],1);
    assert.equal(trust.summary.completed_fulfillment_count,2);
    assert.equal(trust.summary.truth.opaque_trust_score,false);
    assert.equal(trust.summary.truth.disputes_are_context_not_guilt,true);
    assert.equal((trust.summary as any).trust_score,undefined);
  });

  it('allows tenant-scoped seller response but blocks cross-store response',()=>{
    const {order}=makeOrder();
    const r=marketplaceTrustService.createReview(buyer,order.order.id,{target_type:'STORE',rating:5,body:'Good'});
    const response=marketplaceTrustService.respondToReview(seller,storeId,r.review.id,{body:'Thank you for your purchase.'});
    assert.equal(response.status,'PUBLISHED');
    assert.throws(
      ()=>marketplaceTrustService.respondToReview(otherSeller,storeId,r.review.id,{body:'Hijack'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('review reports enter moderation and only Trust & Safety/Admin can decide visibility',()=>{
    const {order}=makeOrder();
    const r=marketplaceTrustService.createReview(buyer,order.order.id,{target_type:'STORE',rating:2,body:'Critical review'});
    const report=marketplaceTrustService.reportReview(seller,storeId,r.review.id,{reason:'Contains a claim we want reviewed'});
    assert.equal(report.status,'OPEN');
    assert.equal(marketplaceTrustService.getStoreTrust(storeId).summary.verified_review_count,0);
    assert.throws(
      ()=>marketplaceTrustService.listReviewModeration(ordinary),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    const queue=marketplaceTrustService.listReviewModeration(trustOps);
    assert.equal(queue.reports.length,1);
    const restored=marketplaceTrustService.moderateReview(trustOps,r.review.id,{action:'PUBLISH',reason:'Review is within policy'});
    assert.equal(restored.review.status,'PUBLISHED');
    assert.equal(marketplaceTrustService.getStoreTrust(storeId).summary.verified_review_count,1);
  });

  it('requires captured payment to open a dispute and enforces one active dispute per order',()=>{
    const unpaid=makeOrder({paid:false,complete:false});
    assert.throws(
      ()=>marketplaceTrustService.openDispute(buyer,unpaid.order.order.id,{category:'OTHER',summary:'No paid transaction'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
    const {order}=makeOrder({paid:true,complete:false});
    const d=marketplaceTrustService.openDispute(buyer,order.order.id,{
      category:'ORDER_NOT_RECEIVED',summary:'The order has not been received.',requested_outcome:'Please investigate.'
    });
    assert.equal(d.dispute.status,'SELLER_RESPONSE_REQUIRED');
    assert.equal(d.messages[0].author_role,'BUYER');
    assert.throws(
      ()=>marketplaceTrustService.openDispute(buyer,order.order.id,{category:'OTHER',summary:'Duplicate'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.CONFLICT
    );
  });

  it('keeps seller dispute access tenant-scoped and moves response into review',()=>{
    const {order}=makeOrder({paid:true,complete:false});
    const d=marketplaceTrustService.openDispute(buyer,order.order.id,{category:'ORDER_NOT_RECEIVED',summary:'Where is the order?'});
    const msg=marketplaceTrustService.addSellerMessage(seller,storeId,d.dispute.id,{body:'We are checking fulfillment records.'});
    assert.equal(msg.author_role,'SELLER');
    const sellerView=marketplaceTrustService.getSellerDispute(seller,storeId,d.dispute.id);
    assert.equal(sellerView.dispute.status,'UNDER_REVIEW');
    assert.throws(
      ()=>marketplaceTrustService.getSellerDispute(otherSeller,storeId,d.dispute.id),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('hides internal Trust & Safety notes from parties',()=>{
    const {order}=makeOrder({paid:true,complete:false});
    const d=marketplaceTrustService.openDispute(buyer,order.order.id,{category:'OTHER',summary:'Need review'});
    marketplaceTrustService.addOpsMessage(trustOps,d.dispute.id,{audience:'INTERNAL',body:'Internal risk note only.'});
    marketplaceTrustService.addOpsMessage(trustOps,d.dispute.id,{audience:'PARTIES',body:'We are reviewing the case.'});
    const buyerView=marketplaceTrustService.getMyDispute(buyer,d.dispute.id);
    assert.equal(buyerView.messages.some((m:any)=>m.body.includes('Internal risk note')),false);
    assert.equal(buyerView.messages.some((m:any)=>m.body.includes('reviewing the case')),true);
    const opsView=marketplaceTrustService.listOpsDisputes(trustOps).find((x:any)=>x.dispute.id===d.dispute.id)!;
    assert.equal(opsView.messages.some((m:any)=>m.body.includes('Internal risk note')),true);
  });

  it('resolves disputes without moving money, inventory, or account state',()=>{
    const {order,listing}=makeOrder({paid:true,complete:false,quantity:2});
    const beforeFinancial=marketplacePaymentService.getBuyerOrderFinance(buyer,order.order.id).financial;
    const beforeStock=(db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listing.id) as any).stock_quantity;
    const beforeAccount=(db.prepare('SELECT account_status FROM users WHERE id=?').get(seller.user_id) as any).account_status;
    const d=marketplaceTrustService.openDispute(buyer,order.order.id,{category:'PAYMENT_REFUND',summary:'I want finance review'});
    marketplaceTrustService.takeDispute(trustOps,d.dispute.id);
    const resolved=marketplaceTrustService.resolveDispute(trustOps,d.dispute.id,{
      resolution_action:'FINANCE_REVIEW',resolution_summary:'Route to the authoritative finance workflow for separate assessment.'
    });
    assert.equal(resolved.dispute.status,'RESOLVED');
    assert.equal(resolved.truth.resolution_does_not_move_money,true);
    assert.equal(resolved.truth.resolution_does_not_change_inventory,true);
    const afterFinancial=marketplacePaymentService.getBuyerOrderFinance(buyer,order.order.id).financial;
    const afterStock=(db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listing.id) as any).stock_quantity;
    const afterAccount=(db.prepare('SELECT account_status FROM users WHERE id=?').get(seller.user_id) as any).account_status;
    assert.equal(afterFinancial.captured_minor,beforeFinancial.captured_minor);
    assert.equal(afterFinancial.refunded_minor,beforeFinancial.refunded_minor);
    assert.equal(afterStock,beforeStock);
    assert.equal(afterAccount,beforeAccount);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_refunds WHERE order_id=?').get(order.order.id) as any).count,0);
  });

  it('counts disputes as contextual facts rather than modifying review rating',()=>{
    const {order}=makeOrder();
    marketplaceTrustService.createReview(buyer,order.order.id,{target_type:'STORE',rating:5,body:'Good purchase'});
    marketplaceTrustService.openDispute(buyer,order.order.id,{category:'OTHER',summary:'Separate later issue'});
    const trust=marketplaceTrustService.getStoreTrust(storeId).summary;
    assert.equal(trust.average_rating,5);
    assert.equal(trust.dispute_count,1);
    assert.equal(trust.open_dispute_count,1);
    assert.equal(trust.truth.disputes_are_context_not_guilt,true);
  });
});
