import { getDatabase } from '../database/connection';
import {
  MarketplaceFinancialSummary, MarketplacePaymentIntent, MarketplacePaymentProvider,
  MarketplaceProviderEvent, MarketplaceRefund, MarketplaceSettlementEntry, MarketplaceSettlementSummary
} from './types';

const bool=(v:any)=>Boolean(Number(v||0));
export class MarketplacePaymentRepository{
  listProviders():MarketplacePaymentProvider[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_payment_providers ORDER BY provider_key').all() as any[]).map(this.mapProvider);
  }
  getProviderByKey(key:string):MarketplacePaymentProvider|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payment_providers WHERE provider_key=? LIMIT 1').get(key) as any;
    return r?this.mapProvider(r):null;
  }
  getProvider(id:string):MarketplacePaymentProvider|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payment_providers WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapProvider(r):null;
  }
  createProvider(v:MarketplacePaymentProvider){
    getDatabase().prepare(`
      INSERT INTO marketplace_payment_providers
      (id,provider_key,display_name,mode,status,webhook_secret_env,supports_refunds,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.provider_key,v.display_name,v.mode,v.status,v.webhook_secret_env,v.supports_refunds?1:0,v.created_by,v.created_at,v.updated_at);
    return v;
  }
  updateProvider(v:MarketplacePaymentProvider){
    getDatabase().prepare(`
      UPDATE marketplace_payment_providers SET display_name=?,mode=?,status=?,webhook_secret_env=?,supports_refunds=?,updated_at=?
      WHERE id=?
    `).run(v.display_name,v.mode,v.status,v.webhook_secret_env,v.supports_refunds?1:0,v.updated_at,v.id);
    return v;
  }

  getIntent(id:string):MarketplacePaymentIntent|null{
    const r=getDatabase().prepare(`
      SELECT i.*,p.provider_key FROM marketplace_payment_intents i
      JOIN marketplace_payment_providers p ON p.id=i.provider_id WHERE i.id=? LIMIT 1
    `).get(id) as any;
    return r?this.mapIntent(r):null;
  }
  getIntentByOrderIdempotency(orderId:string,key:string):MarketplacePaymentIntent|null{
    const r=getDatabase().prepare(`
      SELECT i.*,p.provider_key FROM marketplace_payment_intents i
      JOIN marketplace_payment_providers p ON p.id=i.provider_id
      WHERE i.order_id=? AND i.idempotency_key=? LIMIT 1
    `).get(orderId,key) as any;
    return r?this.mapIntent(r):null;
  }
  getIntentForProviderOrder(providerId:string,orderId:string):MarketplacePaymentIntent|null{
    const r=getDatabase().prepare(`
      SELECT i.*,p.provider_key FROM marketplace_payment_intents i
      JOIN marketplace_payment_providers p ON p.id=i.provider_id
      WHERE i.provider_id=? AND i.order_id=? ORDER BY i.created_at DESC LIMIT 1
    `).get(providerId,orderId) as any;
    return r?this.mapIntent(r):null;
  }
  getIntentByProviderPayment(providerId:string,providerPaymentId:string):MarketplacePaymentIntent|null{
    const r=getDatabase().prepare(`
      SELECT i.*,p.provider_key FROM marketplace_payment_intents i
      JOIN marketplace_payment_providers p ON p.id=i.provider_id
      WHERE i.provider_id=? AND i.provider_payment_id=? LIMIT 1
    `).get(providerId,providerPaymentId) as any;
    return r?this.mapIntent(r):null;
  }
  listOrderIntents(orderId:string):MarketplacePaymentIntent[]{
    return (getDatabase().prepare(`
      SELECT i.*,p.provider_key FROM marketplace_payment_intents i
      JOIN marketplace_payment_providers p ON p.id=i.provider_id
      WHERE i.order_id=? ORDER BY i.created_at DESC
    `).all(orderId) as any[]).map(this.mapIntent);
  }
  createIntent(v:MarketplacePaymentIntent){
    getDatabase().prepare(`
      INSERT INTO marketplace_payment_intents
      (id,order_id,provider_id,idempotency_key,provider_payment_id,client_reference,amount_minor,currency,status,
       failure_code,failure_message,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.order_id,v.provider_id,v.idempotency_key,v.provider_payment_id,v.client_reference,v.amount_minor,v.currency,
      v.status,v.failure_code,v.failure_message,v.created_by,v.created_at,v.updated_at);
    return v;
  }
  updateIntent(v:MarketplacePaymentIntent){
    getDatabase().prepare(`
      UPDATE marketplace_payment_intents SET provider_payment_id=?,status=?,failure_code=?,failure_message=?,updated_at=? WHERE id=?
    `).run(v.provider_payment_id,v.status,v.failure_code,v.failure_message,v.updated_at,v.id);
    return v;
  }

  getRefund(id:string):MarketplaceRefund|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_refunds WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapRefund(r):null;
  }
  getRefundByIdempotency(orderId:string,key:string):MarketplaceRefund|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_refunds WHERE order_id=? AND idempotency_key=? LIMIT 1').get(orderId,key) as any;
    return r?this.mapRefund(r):null;
  }
  listOrderRefunds(orderId:string):MarketplaceRefund[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_refunds WHERE order_id=? ORDER BY requested_at DESC').all(orderId) as any[]).map(this.mapRefund);
  }
  createRefund(v:MarketplaceRefund){
    getDatabase().prepare(`
      INSERT INTO marketplace_refunds
      (id,order_id,payment_intent_id,idempotency_key,provider_refund_id,amount_minor,currency,reason,status,requested_by,requested_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.order_id,v.payment_intent_id,v.idempotency_key,v.provider_refund_id,v.amount_minor,v.currency,v.reason,
      v.status,v.requested_by,v.requested_at,v.updated_at);
    return v;
  }
  updateRefund(v:MarketplaceRefund){
    getDatabase().prepare('UPDATE marketplace_refunds SET provider_refund_id=?,status=?,updated_at=? WHERE id=?')
      .run(v.provider_refund_id,v.status,v.updated_at,v.id);
    return v;
  }

  getProviderEvent(providerId:string,eventId:string):MarketplaceProviderEvent|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payment_provider_events WHERE provider_id=? AND provider_event_id=? LIMIT 1')
      .get(providerId,eventId) as any;
    return r?this.mapEvent(r):null;
  }
  createProviderEvent(v:MarketplaceProviderEvent){
    getDatabase().prepare(`
      INSERT INTO marketplace_payment_provider_events
      (id,provider_id,provider_event_id,event_type,payment_intent_id,refund_id,signature_verified,payload_hash,
       processing_status,processing_message,occurred_at,processed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.provider_id,v.provider_event_id,v.event_type,v.payment_intent_id,v.refund_id,v.signature_verified?1:0,
      v.payload_hash,v.processing_status,v.processing_message,v.occurred_at,v.processed_at);
    return v;
  }
  listProviderEvents(limit=100):MarketplaceProviderEvent[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_payment_provider_events ORDER BY processed_at DESC LIMIT ?').all(limit) as any[]).map(this.mapEvent);
  }

  createSettlementEntry(v:MarketplaceSettlementEntry){
    getDatabase().prepare(`
      INSERT OR IGNORE INTO marketplace_settlement_ledger_entries
      (id,store_id,order_id,payment_intent_id,refund_id,entry_type,amount_minor,currency,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.store_id,v.order_id,v.payment_intent_id,v.refund_id,v.entry_type,v.amount_minor,v.currency,v.created_at);
    return v;
  }
  listSettlementEntries(storeId:string):MarketplaceSettlementEntry[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_settlement_ledger_entries WHERE store_id=? ORDER BY created_at DESC').all(storeId) as any[])
      .map(r=>({id:String(r.id),store_id:String(r.store_id),order_id:String(r.order_id),payment_intent_id:String(r.payment_intent_id),
        refund_id:r.refund_id?String(r.refund_id):null,entry_type:r.entry_type,amount_minor:Number(r.amount_minor),
        currency:String(r.currency),created_at:String(r.created_at)}));
  }
  settlementSummary(storeId:string):MarketplaceSettlementSummary[]{
    const rows=getDatabase().prepare(`
      SELECT currency,
        COALESCE(SUM(CASE WHEN entry_type='PAYMENT_CAPTURE' THEN amount_minor ELSE 0 END),0) gross,
        COALESCE(SUM(CASE WHEN entry_type='REFUND_ADJUSTMENT' THEN -amount_minor ELSE 0 END),0) refunds,
        COALESCE(SUM(amount_minor),0) net
      FROM marketplace_settlement_ledger_entries WHERE store_id=? GROUP BY currency ORDER BY currency
    `).all(storeId) as any[];
    return rows.map(r=>({store_id:storeId,currency:String(r.currency),gross_captured_minor:Number(r.gross),
      refunds_minor:Number(r.refunds),net_receivable_minor:Number(r.net),settled_minor:0 as const,payout_available:false as const}));
  }

  createReconciliationIssue(v:{id:string;provider_id:string;provider_event_id:string;order_id:string|null;payment_intent_id:string|null;
    issue_type:string;details:string;created_at:string}){
    getDatabase().prepare(`
      INSERT INTO marketplace_payment_reconciliation_issues
      (id,provider_id,provider_event_id,order_id,payment_intent_id,issue_type,details,status,created_at)
      VALUES (?,?,?,?,?,?,?,'OPEN',?)
    `).run(v.id,v.provider_id,v.provider_event_id,v.order_id,v.payment_intent_id,v.issue_type,v.details,v.created_at);
  }
  listReconciliationIssues(limit=100){
    return getDatabase().prepare('SELECT * FROM marketplace_payment_reconciliation_issues ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  financialSummary(orderId:string):MarketplaceFinancialSummary{
    const order=getDatabase().prepare('SELECT id,status,currency,total_minor FROM marketplace_orders WHERE id=?').get(orderId) as any;
    if(!order)throw new Error('Order not found');
    const capture=getDatabase().prepare(`
      SELECT COALESCE(SUM(amount_minor),0) total FROM marketplace_settlement_ledger_entries
      WHERE order_id=? AND entry_type='PAYMENT_CAPTURE'
    `).get(orderId) as any;
    const refund=getDatabase().prepare(`
      SELECT COALESCE(SUM(-amount_minor),0) total FROM marketplace_settlement_ledger_entries
      WHERE order_id=? AND entry_type='REFUND_ADJUSTMENT'
    `).get(orderId) as any;
    const latest=this.listOrderIntents(orderId)[0]||null;
    const captured=Number(capture?.total||0),refunded=Number(refund?.total||0),net=captured-refunded;
    let commercial:any='AWAITING_PAYMENT';
    if(order.status==='CANCELLED')commercial='CANCELLED';
    else if(captured>=Number(order.total_minor)&&refunded===0)commercial='PAID';
    else if(captured>0&&refunded>=captured)commercial='REFUNDED';
    else if(captured>0&&refunded>0)commercial='PARTIALLY_REFUNDED';
    else if(latest?.status==='FAILED')commercial='PAYMENT_FAILED';
    else if(latest?.status==='PENDING')commercial='PAYMENT_PENDING';
    const providers=Number((getDatabase().prepare("SELECT COUNT(*) count FROM marketplace_payment_providers WHERE status='ACTIVE'").get() as any)?.count||0);
    const provider=latest?this.getProvider(latest.provider_id):null;
    return {order_id:orderId,commercial_status:commercial,captured_minor:captured,refunded_minor:refunded,net_paid_minor:net,
      currency:String(order.currency),latest_payment_intent_id:latest?.id||null,payment_available:providers>0&&order.status!=='CANCELLED'&&captured<Number(order.total_minor),
      refund_available:Boolean(provider?.supports_refunds&&captured>refunded),seller_fulfillment_authorized:commercial==='PAID'};
  }

  private mapProvider=(r:any):MarketplacePaymentProvider=>({id:String(r.id),provider_key:String(r.provider_key),display_name:String(r.display_name),
    mode:r.mode,status:r.status,webhook_secret_env:String(r.webhook_secret_env),supports_refunds:bool(r.supports_refunds),
    created_by:String(r.created_by),created_at:String(r.created_at),updated_at:String(r.updated_at)});
  private mapIntent=(r:any):MarketplacePaymentIntent=>({id:String(r.id),order_id:String(r.order_id),provider_id:String(r.provider_id),
    provider_key:String(r.provider_key),idempotency_key:String(r.idempotency_key),provider_payment_id:r.provider_payment_id?String(r.provider_payment_id):null,
    client_reference:String(r.client_reference),amount_minor:Number(r.amount_minor),currency:String(r.currency),status:r.status,
    failure_code:r.failure_code?String(r.failure_code):null,failure_message:r.failure_message?String(r.failure_message):null,
    created_by:String(r.created_by),created_at:String(r.created_at),updated_at:String(r.updated_at)});
  private mapRefund=(r:any):MarketplaceRefund=>({id:String(r.id),order_id:String(r.order_id),payment_intent_id:String(r.payment_intent_id),
    idempotency_key:String(r.idempotency_key),provider_refund_id:r.provider_refund_id?String(r.provider_refund_id):null,
    amount_minor:Number(r.amount_minor),currency:String(r.currency),reason:String(r.reason),status:r.status,
    requested_by:String(r.requested_by),requested_at:String(r.requested_at),updated_at:String(r.updated_at)});
  private mapEvent=(r:any):MarketplaceProviderEvent=>({id:String(r.id),provider_id:String(r.provider_id),provider_event_id:String(r.provider_event_id),
    event_type:r.event_type,payment_intent_id:r.payment_intent_id?String(r.payment_intent_id):null,refund_id:r.refund_id?String(r.refund_id):null,
    signature_verified:bool(r.signature_verified),payload_hash:String(r.payload_hash),processing_status:r.processing_status,
    processing_message:r.processing_message?String(r.processing_message):null,occurred_at:String(r.occurred_at),processed_at:String(r.processed_at)});
}
export const marketplacePaymentRepository=new MarketplacePaymentRepository();
