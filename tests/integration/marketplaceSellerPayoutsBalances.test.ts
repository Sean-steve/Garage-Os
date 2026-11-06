/**
 * Sprint 32 — Seller Payouts, Balances & Financial Operations
 */
import { createHmac } from 'node:crypto';
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceTransactionService } from '../../src/server/marketplaceTransactions/marketplaceTransactionService';
import { marketplacePaymentService } from '../../src/server/marketplacePayments/marketplacePaymentService';
import { marketplacePayoutService } from '../../src/server/marketplacePayouts/marketplacePayoutService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-11-06T00:00:00.000Z',updated_at:'2026-11-06T00:00:00.000Z'},session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}
function paymentSignature(secret:string,input:any){
  const canonical=[
    input.provider_event_id,input.event_type,input.provider_payment_id,input.order_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase(),input.refund_id||'',input.provider_refund_id||''
  ].join('|');
  return createHmac('sha256',secret).update(canonical).digest('hex');
}
function payoutSignature(secret:string,input:any){
  const canonical=[
    input.provider_event_id,input.event_type,input.provider_payout_id,input.payout_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase()
  ].join('|');
  return createHmac('sha256',secret).update(canonical).digest('hex');
}

describe('Seller Payouts, Balances & Financial Operations (Sprint 32)',()=>{
  let db:any,counter=0;
  const orgId='org_payout_seller',otherOrgId='org_payout_other';
  const seller=actor('usr_payout_seller','seller@payout.test',[membership('usr_payout_seller',orgId,'Payout Seller')]);
  const otherSeller=actor('usr_payout_other','other@payout.test',[membership('usr_payout_other',otherOrgId,'Other Seller')]);
  const buyer=actor('usr_payout_buyer','buyer@payout.test');
  const buyer2=actor('usr_payout_buyer2','buyer2@payout.test');
  const admin=actor('usr_payout_admin','admin@payout.test',[],[PlatformRole.PLATFORM_ADMIN]);
  const finance=actor('usr_payout_finance','finance@payout.test',[],[PlatformRole.FINANCE_OPERATOR]);
  const paymentSecret='sprint32-payment-secret',payoutSecret='sprint32-payout-secret';
  let storeId:string,payoutProvider:any;

  beforeEach(()=>{
    process.env.S32_PAYMENT_WEBHOOK_SECRET=paymentSecret;
    process.env.S32_PAYOUT_WEBHOOK_SECRET=payoutSecret;
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);counter=0;

    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const users=[
      [seller.user_id,seller.email,'Seller','+254706000001'],
      [otherSeller.user_id,otherSeller.email,'Other Seller','+254706000002'],
      [buyer.user_id,buyer.email,'Buyer','+254706000003'],
      [buyer2.user_id,buyer2.email,'Buyer Two','+254706000004'],
      [admin.user_id,admin.email,'Admin','+254706000005'],
      [finance.user_id,finance.email,'Finance','+254706000006'],
    ];
    for(const [id,email,name,phone] of users)user.run(id,email,name,phone,'2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Payout Seller','2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z');
    org.run(otherOrgId,'Other Seller','2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,orgId,'2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrgId,'2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z','2026-11-06T00:00:00.000Z');

    storeId=marketplaceService.createStore(seller,{organization_id:orgId,slug:'payout-parts',display_name:'Payout Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});

    marketplacePaymentService.createProvider(admin,{
      provider_key:'S32PAY',display_name:'Sprint 32 Payment Provider',mode:'TEST',
      webhook_secret_env:'S32_PAYMENT_WEBHOOK_SECRET',supports_refunds:true
    });
    payoutProvider=marketplacePayoutService.createProvider(admin,{
      provider_key:'S32OUT',display_name:'Sprint 32 Payout Provider',mode:'TEST',
      webhook_secret_env:'S32_PAYOUT_WEBHOOK_SECRET',supports_reversals:true
    });
    marketplacePayoutService.setPolicy(admin,payoutProvider.id,{currency:'KES',minimum_payout_minor:100000,reserve_minor:200000});
    marketplacePayoutService.setPolicy(admin,payoutProvider.id,{currency:'USD',minimum_payout_minor:1000,reserve_minor:500});
  });

  function createPaidOrder(args:{currency?:string;price?:number;quantity?:number;buyerActor?:any}={}){
    counter++;
    const currency=args.currency||'KES',price=args.price??400000,quantity=args.quantity??2,buyerActor=args.buyerActor||buyer;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'OUT-'+counter,title:'Payout test part '+counter,
      description:'Sprint 32 payout certification product.',brand:'Example',condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:price,currency,inventory_tracking:'QUANTITY',stock_quantity:20,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    const cart=marketplaceTransactionService.getOrCreateCart(buyerActor,storeId,null);
    marketplaceTransactionService.addItem(buyerActor,cart.cart.id,listing.id,quantity);
    const placed=marketplaceTransactionService.placeOrder(buyerActor,cart.cart.id,{fulfillment_mode:'PICKUP'});
    const intent=marketplacePaymentService.createIntent(buyerActor,placed.order.id,'S32PAY','pay-idem-'+counter+'-0000').intent;
    const event={provider_event_id:'pay-event-'+counter,event_type:'PAYMENT_SUCCEEDED',provider_payment_id:'pay-provider-'+counter,
      order_id:placed.order.id,amount_minor:placed.order.total_minor,currency,occurred_at:'2026-11-06T10:00:00.000Z'};
    marketplacePaymentService.processWebhook('S32PAY',paymentSignature(paymentSecret,event),event as any);
    return {order:placed.order,intent,listing};
  }

  function activeAccount(cur='KES'){
    const registered=marketplacePayoutService.registerAccount(seller,storeId,{
      provider_id:payoutProvider.id,currency:cur,provider_account_ref:'acct_token_'+cur.toLowerCase()+'_s32',
      account_label:cur+' settlement account'
    });
    marketplacePayoutService.reviewAccount(admin,registered.id,{status:'ACTIVE'});
    return registered;
  }

  function payoutEvent(payout:any,eventType:string,eventId:string,providerPayoutId='provider-payout-001',overrides:any={}){
    return {provider_event_id:eventId,event_type:eventType,provider_payout_id:providerPayoutId,payout_id:payout.id,
      amount_minor:payout.amount_minor,currency:payout.currency,occurred_at:'2026-11-06T12:00:00.000Z',...overrides};
  }

  it('creates normalized payout schema without seeding fake payout providers, accounts or transfers',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'marketplace_payout_providers','marketplace_payout_policies','marketplace_payout_accounts','marketplace_payouts',
      'marketplace_payout_batches','marketplace_payout_batch_items','marketplace_payout_provider_events',
      'marketplace_payout_reconciliation_issues'
    ])assert.ok(tables.includes(table),table+' must exist');
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payouts').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payout_provider_events').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payout_accounts').get() as any).count,0);
  });

  it('registers provider references only, requires finance activation and redacts the reference from dashboards',()=>{
    assert.throws(
      ()=>marketplacePayoutService.registerAccount(seller,storeId,{
        provider_id:payoutProvider.id,currency:'KES',provider_account_ref:'0712345678',account_label:'Raw phone'
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
    const registered=marketplacePayoutService.registerAccount(seller,storeId,{
      provider_id:payoutProvider.id,currency:'KES',provider_account_ref:'acct_token_safe_001',account_label:'Primary account'
    });
    assert.equal(registered.status,'PENDING_REVIEW');
    assert.equal(Object.prototype.hasOwnProperty.call(registered,'provider_account_ref'),false);
    assert.throws(
      ()=>marketplacePayoutService.reviewAccount(buyer,registered.id,{status:'ACTIVE'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    const activated=marketplacePayoutService.reviewAccount(finance,registered.id,{status:'ACTIVE'});
    assert.equal(activated.status,'ACTIVE');
    assert.equal(Object.prototype.hasOwnProperty.call(activated,'provider_account_ref'),false);
    const sellerJson=JSON.stringify(marketplacePayoutService.sellerDashboard(seller,storeId));
    const adminJson=JSON.stringify(marketplacePayoutService.adminOverview(admin));
    assert.equal(sellerJson.includes('acct_token_safe_001'),false);
    assert.equal(adminJson.includes('acct_token_safe_001'),false);
    assert.equal(sellerJson.includes(payoutSecret),false);
  });

  it('derives requestable balance from settlement ledger and applies reserve/minimum policy without combining currencies',()=>{
    const kes=createPaidOrder();
    const usd=createPaidOrder({currency:'USD',price:5000,quantity:1,buyerActor:buyer2});
    assert.equal(kes.order.total_minor,800000);
    assert.equal(usd.order.total_minor,5000);
    activeAccount('KES');
    activeAccount('USD');
    const dashboard=marketplacePayoutService.sellerDashboard(seller,storeId);
    assert.deepEqual(dashboard.balances.map((b:any)=>b.currency),['KES','USD']);
    const kb=dashboard.balances.find((b:any)=>b.currency==='KES');
    const ub=dashboard.balances.find((b:any)=>b.currency==='USD');
    assert.equal(kb.net_receivable_minor,800000);assert.equal(kb.paid_minor,0);assert.equal(kb.reserved_minor,0);
    assert.equal(ub.net_receivable_minor,5000);
    const ko=dashboard.payout_options.find((o:any)=>o.currency==='KES');
    const uo=dashboard.payout_options.find((o:any)=>o.currency==='USD');
    assert.equal(ko.requestable_minor,600000);
    assert.equal(uo.requestable_minor,4500);
    assert.equal(kb.truth.receivable_is_payout,false);
    assert.equal(kb.truth.currencies_not_combined,true);
  });

  it('creates idempotent payout requests that reserve funds but do not mark money transferred',()=>{
    createPaidOrder();const account=activeAccount('KES');
    assert.throws(
      ()=>marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:99999},'payout-low-0001'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
    assert.throws(
      ()=>marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:600001},'payout-high-001'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
    const a=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-idem-0001');
    const b=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-idem-0001');
    assert.equal(a.payout.id,b.payout.id);
    assert.equal(a.payout.status,'REQUESTED');
    assert.equal(a.truth.payout_completed,false);
    const dash=marketplacePayoutService.sellerDashboard(seller,storeId);
    const balance=dash.balances.find((x:any)=>x.currency==='KES');
    assert.equal(balance.requested_minor,300000);
    assert.equal(balance.processing_minor,0);
    assert.equal(balance.paid_minor,0);
    assert.equal(balance.unallocated_minor,500000);
    assert.equal(dash.payout_options[0].requestable_minor,300000);
  });

  it('rejects invalid payout signatures before consuming provider event ids or changing money truth',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-sign-0001').payout;
    const event=payoutEvent(payout,'PAYOUT_SUCCEEDED','out-invalid-001');
    assert.throws(
      ()=>marketplacePayoutService.processWebhook('S32OUT','bad-signature',event as any),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_payout_provider_events').get() as any).count,0);
    assert.equal((db.prepare("SELECT status FROM marketplace_payouts WHERE id=?").get(payout.id) as any).status,'REQUESTED');
    assert.equal(marketplacePayoutService.sellerDashboard(seller,storeId).balances[0].paid_minor,0);
  });

  it('batch handoff remains non-authoritative; verified processing/success is idempotent and late failure cannot downgrade success',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-flow-0001').payout;
    const batch=marketplacePayoutService.createBatch(admin,{provider_id:payoutProvider.id,currency:'KES',payout_ids:[payout.id]}).batch;
    const handoff=marketplacePayoutService.initiateBatchHandoff(finance,batch.id);
    assert.equal(handoff.provider_action.execution_performed,false);
    assert.equal(handoff.truth.provider_accepted,false);
    assert.equal(handoff.truth.payouts_marked_processing,false);
    assert.equal(marketplacePayoutService.sellerDashboard(seller,storeId).payouts[0].status,'REQUESTED');

    const processing=payoutEvent(payout,'PAYOUT_PROCESSING','out-processing-001');
    const p1=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,processing),processing as any);
    assert.equal(p1.payout.status,'PROCESSING');
    assert.equal(p1.balance.processing_minor,300000);

    const success=payoutEvent(payout,'PAYOUT_SUCCEEDED','out-success-001');
    const first=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,success),success as any);
    const duplicate=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,success),success as any);
    assert.equal(first.duplicate,false);assert.equal(duplicate.duplicate,true);
    assert.equal(first.payout.status,'SUCCEEDED');
    assert.equal(first.balance.paid_minor,300000);
    assert.equal(first.balance.processing_minor,0);

    const lateFail=payoutEvent(payout,'PAYOUT_FAILED','out-late-fail-001','provider-payout-001',{failure_code:'LATE',failure_message:'stale'});
    const failed=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,lateFail),lateFail as any);
    assert.equal(failed.event.processing_status,'IGNORED');
    assert.equal(failed.payout.status,'SUCCEEDED');

    const settled=marketplacePaymentService.sellerSettlement(seller,storeId);
    assert.equal(settled.summaries[0].settled_minor,300000);
    assert.equal(settled.truth.bank_transfer_executed,true);
    assert.equal(settled.truth.receivable_is_payout,false);
    assert.equal(marketplacePayoutService.adminOverview(admin).batches[0].status,'SETTLED');
  });

  it('provider-confirmed reversal removes paid state and reopens requestable balance',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-rev-0001').payout;
    const success=payoutEvent(payout,'PAYOUT_SUCCEEDED','out-success-rev-001');
    marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,success),success as any);
    let dash=marketplacePayoutService.sellerDashboard(seller,storeId);
    assert.equal(dash.balances[0].paid_minor,300000);
    assert.equal(dash.payout_options[0].requestable_minor,300000);

    const reversal=payoutEvent(payout,'PAYOUT_REVERSED','out-reversal-001');
    const result=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,reversal),reversal as any);
    assert.equal(result.payout.status,'REVERSED');
    dash=marketplacePayoutService.sellerDashboard(seller,storeId);
    assert.equal(dash.balances[0].paid_minor,0);
    assert.equal(dash.balances[0].reversed_history_minor,300000);
    assert.equal(dash.balances[0].unallocated_minor,800000);
    assert.equal(dash.payout_options[0].requestable_minor,600000);
  });

  it('routes verified payout fact mismatches and invalid transition contradictions to reconciliation without mutating payout state',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:300000},'payout-mismatch-001').payout;
    const mismatch=payoutEvent(payout,'PAYOUT_SUCCEEDED','out-mismatch-001','provider-payout-mismatch',{amount_minor:299999});
    const mismatchResult=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,mismatch),mismatch as any);
    assert.equal(mismatchResult.event.processing_status,'REJECTED');
    assert.equal(marketplacePayoutService.sellerDashboard(seller,storeId).payouts[0].status,'REQUESTED');

    const fail=payoutEvent(payout,'PAYOUT_FAILED','out-failed-001','provider-payout-002');
    marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,fail),fail as any);
    const lateSuccess=payoutEvent(payout,'PAYOUT_SUCCEEDED','out-late-success-001','provider-payout-002');
    const contradiction=marketplacePayoutService.processWebhook('S32OUT',payoutSignature(payoutSecret,lateSuccess),lateSuccess as any);
    assert.equal(contradiction.event.processing_status,'REJECTED');
    assert.equal(contradiction.payout.status,'FAILED');

    const overview=marketplacePayoutService.adminOverview(admin);
    assert.equal(overview.issues.length,2);
    assert.ok(overview.issues.some((x:any)=>x.issue_type==='PAYOUT_FACT_MISMATCH'));
    assert.ok(overview.issues.some((x:any)=>x.issue_type==='LATE_SUCCESS_AFTER_TERMINAL_STATE'));
  });

  it('enforces seller tenant isolation and finance-only provider, account-review and batch operations',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:200000},'payout-auth-0001').payout;
    assert.throws(
      ()=>marketplacePayoutService.sellerDashboard(otherSeller,storeId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplacePayoutService.registerAccount(otherSeller,storeId,{provider_id:payoutProvider.id,currency:'USD',provider_account_ref:'acct_token_other',account_label:'Other'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplacePayoutService.adminOverview(buyer),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplacePayoutService.createBatch(seller,{provider_id:payoutProvider.id,currency:'KES',payout_ids:[payout.id]}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    const batch=marketplacePayoutService.createBatch(finance,{provider_id:payoutProvider.id,currency:'KES',payout_ids:[payout.id]});
    assert.equal(batch.batch.status,'DRAFT');
  });

  it('does not expose webhook secret values or claim live outbound payout execution',()=>{
    createPaidOrder();const account=activeAccount('KES');
    const payout=marketplacePayoutService.requestPayout(seller,storeId,{payout_account_id:account.id,amount_minor:200000},'payout-secrets-001').payout;
    const batch=marketplacePayoutService.createBatch(admin,{provider_id:payoutProvider.id,currency:'KES',payout_ids:[payout.id]}).batch;
    const handoff=marketplacePayoutService.initiateBatchHandoff(admin,batch.id);
    const publicProviders=marketplacePayoutService.listActiveProviders();
    assert.equal(Object.prototype.hasOwnProperty.call(publicProviders[0],'webhook_secret_env'),false);
    assert.equal(JSON.stringify(marketplacePayoutService.sellerDashboard(seller,storeId)).includes(payoutSecret),false);
    assert.equal(JSON.stringify(marketplacePayoutService.adminOverview(admin)).includes(payoutSecret),false);
    assert.equal(handoff.provider_action.type,'EXTERNAL_PROVIDER_HANDOFF_REQUIRED');
    assert.equal(handoff.provider_action.execution_performed,false);
    assert.equal(handoff.truth.payouts_marked_paid,false);
  });
});
