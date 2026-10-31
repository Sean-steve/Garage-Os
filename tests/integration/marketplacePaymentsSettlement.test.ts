/**
 * Sprint 25 — Marketplace Payments & Settlement
 */
import { createHmac } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceTransactionService } from '../../src/server/marketplaceTransactions/marketplaceTransactionService';
import { marketplacePaymentService } from '../../src/server/marketplacePayments/marketplacePaymentService';
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
function signature(secret:string,input:any){
  const canonical=[
    input.provider_event_id,input.event_type,input.provider_payment_id,input.order_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase(),input.refund_id||'',input.provider_refund_id||''
  ].join('|');
  return createHmac('sha256',secret).update(canonical).digest('hex');
}

describe('Marketplace Payments & Settlement (Sprint 25)',()=>{
  let db:any;
  const orgId='org_pay_seller',otherOrgId='org_pay_other';
  const seller=actor('usr_pay_seller','seller@pay.test',[membership('usr_pay_seller',orgId,'Pay Seller')]);
  const otherSeller=actor('usr_pay_other','other@pay.test',[membership('usr_pay_other',otherOrgId,'Other Seller')]);
  const buyer=actor('usr_pay_buyer','buyer@pay.test');
  const admin=actor('usr_pay_admin','admin@pay.test',[],[PlatformRole.PLATFORM_ADMIN]);
  let storeId:string,listingId:string,orderId:string,orderNumber:string,total:number;
  const secret='test-marketplace-webhook-secret';

  beforeEach(()=>{
    process.env.TEST_MARKETPLACE_WEBHOOK_SECRET=secret;
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);

    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    user.run(seller.user_id,seller.email,'Seller','+254700600001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(otherSeller.user_id,otherSeller.email,'Other Seller','+254700600002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(buyer.user_id,buyer.email,'Buyer','+254700600003','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(admin.user_id,admin.email,'Admin','+254700600004','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Pay Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrgId,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    storeId=marketplaceService.createStore(seller,{organization_id:orgId,slug:'pay-parts',display_name:'Pay Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'PAY-FLT-01',title:'Premium oil filter',
      description:'Payment sprint test product.',brand:'Example',condition:'NEW'
    });
    listingId=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:400000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:5,fulfillment_modes:['PICKUP']
    }).id;
    marketplaceService.publishListing(seller,storeId,listingId);

    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,2);
    const placed=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'});
    orderId=placed.order.id;orderNumber=placed.order.order_number;total=placed.order.total_minor;

    marketplacePaymentService.createProvider(admin,{
      provider_key:'TESTPAY',display_name:'Test Provider',mode:'TEST',
      webhook_secret_env:'TEST_MARKETPLACE_WEBHOOK_SECRET',supports_refunds:true
    });
  });

  it('creates normalized payment/refund/settlement schema without seeding a fake financial transaction',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'marketplace_payment_providers','marketplace_payment_intents','marketplace_refunds',
      'marketplace_payment_provider_events','marketplace_inventory_commitments',
      'marketplace_settlement_ledger_entries','marketplace_payment_reconciliation_issues'
    ])assert.ok(tables.includes(table),table+' must exist');
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payment_intents').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries').get() as any).count,0);
  });

  it('creates an idempotent pending intent but never lets the buyer self-declare capture',()=>{
    const a=marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0001');
    const b=marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0001');
    assert.equal(a.intent.id,b.intent.id);
    assert.equal(a.intent.status,'PENDING');
    assert.equal(a.truth.payment_captured,false);
    assert.equal(a.provider_action.type,'EXTERNAL_PROVIDER_HANDOFF_REQUIRED');
    const financial=marketplacePaymentService.getBuyerOrderFinance(buyer,orderId).financial;
    assert.equal(financial.captured_minor,0);
    assert.equal(financial.commercial_status,'PAYMENT_PENDING');
  });

  it('rejects unsigned/invalid provider callbacks without consuming the provider event id',()=>{
    const intent=marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0002').intent;
    const event={provider_event_id:'evt-invalid-1',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_001',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:00:00.000Z'};
    assert.throws(
      ()=>marketplacePaymentService.processWebhook('TESTPAY','bad-signature',event as any),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payment_provider_events').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries').get() as any).count,0);
    assert.equal(marketplacePaymentService.getBuyerOrderFinance(buyer,orderId).financial.captured_minor,0);
    assert.equal(intent.status,'PENDING');
  });

  it('accepts verified capture once, commits held inventory and authorizes seller fulfillment',()=>{
    const intent=marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0003').intent;
    const event={provider_event_id:'evt-capture-1',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_002',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:05:00.000Z'};
    const first=marketplacePaymentService.processWebhook('TESTPAY',signature(secret,event),event as any);
    const second=marketplacePaymentService.processWebhook('TESTPAY',signature(secret,event),event as any);
    assert.equal(first.duplicate,false);assert.equal(second.duplicate,true);
    assert.equal(first.financial.commercial_status,'PAID');
    assert.equal(first.financial.captured_minor,total);
    assert.equal(first.financial.seller_fulfillment_authorized,true);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries WHERE entry_type='PAYMENT_CAPTURE'").get() as any).count,1);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_inventory_commitments WHERE order_id=?').get(orderId) as any).count,1);
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listingId) as any).stock_quantity,3);
    assert.equal(marketplacePaymentService.getBuyerOrderFinance(buyer,orderId).payment_intents[0].id,intent.id);
  });

  it('cannot use pre-payment cancellation after capture and therefore cannot restore sold stock',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0004');
    const event={provider_event_id:'evt-capture-2',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_003',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:10:00.000Z'};
    marketplacePaymentService.processWebhook('TESTPAY',signature(secret,event),event as any);
    assert.throws(
      ()=>marketplaceTransactionService.cancelMyOrder(buyer,orderId,'Try to cancel after capture'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.INVALID_STATE_TRANSITION
    );
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listingId) as any).stock_quantity,3);
  });

  it('routes verified amount mismatch to reconciliation instead of changing financial truth',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0005');
    const event={provider_event_id:'evt-mismatch-1',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_004',
      order_id:orderId,amount_minor:total-1,currency:'KES',occurred_at:'2026-10-31T16:15:00.000Z'};
    const result=marketplacePaymentService.processWebhook('TESTPAY',signature(secret,event),event as any);
    assert.equal(result.event.processing_status,'REJECTED');
    assert.equal(result.financial.captured_minor,0);
    assert.equal((db.prepare("SELECT COUNT(*) count FROM marketplace_payment_reconciliation_issues WHERE status='OPEN'").get() as any).count,1);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_settlement_ledger_entries').get() as any).count,0);
  });

  it('ignores late payment failure after an authoritative capture',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0006');
    const paid={provider_event_id:'evt-capture-3',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_005',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:20:00.000Z'};
    marketplacePaymentService.processWebhook('TESTPAY',signature(secret,paid),paid as any);
    const failed={provider_event_id:'evt-late-fail-1',event_type:'PAYMENT_FAILED',provider_payment_id:'pp_005',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:21:00.000Z',
      failure_code:'LATE',failure_message:'Late stale callback'};
    const result=marketplacePaymentService.processWebhook('TESTPAY',signature(secret,failed),failed as any);
    assert.equal(result.event.processing_status,'IGNORED');
    assert.equal(result.financial.commercial_status,'PAID');
    assert.equal(result.financial.captured_minor,total);
  });

  it('requires provider confirmation for refunds and never restores inventory from financial refund alone',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0007');
    const paid={provider_event_id:'evt-capture-4',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_006',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:25:00.000Z'};
    marketplacePaymentService.processWebhook('TESTPAY',signature(secret,paid),paid as any);

    const requested=marketplacePaymentService.requestRefund(buyer,orderId,{amount_minor:300000,reason:'Return requested'},'idem-refund-0001');
    assert.equal(requested.refund.status,'REQUESTED');
    assert.equal(requested.truth.refund_confirmed,false);
    assert.equal(marketplacePaymentService.getBuyerOrderFinance(buyer,orderId).financial.refunded_minor,0);

    const refundEvent={provider_event_id:'evt-refund-1',event_type:'REFUND_SUCCEEDED',provider_payment_id:'pp_006',
      order_id:orderId,amount_minor:300000,currency:'KES',occurred_at:'2026-10-31T16:30:00.000Z',
      refund_id:requested.refund.id,provider_refund_id:'pr_001'};
    const result=marketplacePaymentService.processWebhook('TESTPAY',signature(secret,refundEvent),refundEvent as any);
    assert.equal(result.financial.commercial_status,'PARTIALLY_REFUNDED');
    assert.equal(result.financial.refunded_minor,300000);
    assert.equal(result.financial.net_paid_minor,total-300000);
    assert.equal((db.prepare('SELECT stock_quantity FROM marketplace_listings WHERE id=?').get(listingId) as any).stock_quantity,3);
    const settlement=marketplacePaymentService.sellerSettlement(seller,storeId);
    assert.equal(settlement.summaries[0].gross_captured_minor,total);
    assert.equal(settlement.summaries[0].refunds_minor,300000);
    assert.equal(settlement.summaries[0].net_receivable_minor,total-300000);
    assert.equal(settlement.truth.payout_available,false);
  });

  it('prevents refund requests above remaining refundable balance',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0008');
    const paid={provider_event_id:'evt-capture-5',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_007',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:35:00.000Z'};
    marketplacePaymentService.processWebhook('TESTPAY',signature(secret,paid),paid as any);
    assert.throws(
      ()=>marketplacePaymentService.requestRefund(buyer,orderId,{amount_minor:total+1,reason:'Too much'},'idem-refund-0002'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
  });

  it('enforces settlement tenant isolation and finance reconciliation authorization',()=>{
    marketplacePaymentService.createIntent(buyer,orderId,'TESTPAY','idem-payment-0009');
    const paid={provider_event_id:'evt-capture-6',event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pp_008',
      order_id:orderId,amount_minor:total,currency:'KES',occurred_at:'2026-10-31T16:40:00.000Z'};
    marketplacePaymentService.processWebhook('TESTPAY',signature(secret,paid),paid as any);
    assert.equal(marketplacePaymentService.sellerSettlement(seller,storeId).summaries.length,1);
    assert.throws(
      ()=>marketplacePaymentService.sellerSettlement(otherSeller,storeId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplacePaymentService.reconciliation(buyer),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.ok(Array.isArray(marketplacePaymentService.reconciliation(admin).events));
  });
});
