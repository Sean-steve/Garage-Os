import { getDatabase } from '../database/connection';
import {
  MarketplacePayout, MarketplacePayoutAccount, MarketplacePayoutBatch, MarketplacePayoutCurrencyBalance,
  MarketplacePayoutPolicy, MarketplacePayoutProvider, MarketplacePayoutProviderEvent
} from './types';

const bool=(v:any)=>Boolean(Number(v||0));

export class MarketplacePayoutRepository{
  listProviders():MarketplacePayoutProvider[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_payout_providers ORDER BY provider_key').all() as any[]).map(this.mapProvider);
  }
  listActiveProviders():MarketplacePayoutProvider[]{
    return (getDatabase().prepare("SELECT * FROM marketplace_payout_providers WHERE status='ACTIVE' ORDER BY provider_key").all() as any[]).map(this.mapProvider);
  }
  getProvider(id:string):MarketplacePayoutProvider|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payout_providers WHERE id=?').get(id) as any;
    return r?this.mapProvider(r):null;
  }
  getProviderByKey(key:string):MarketplacePayoutProvider|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payout_providers WHERE provider_key=?').get(key) as any;
    return r?this.mapProvider(r):null;
  }
  createProvider(v:MarketplacePayoutProvider){
    getDatabase().prepare(`
      INSERT INTO marketplace_payout_providers
      (id,provider_key,display_name,mode,status,webhook_secret_env,supports_reversals,created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.provider_key,v.display_name,v.mode,v.status,v.webhook_secret_env,v.supports_reversals?1:0,v.created_by,v.created_at,v.updated_at);
    return v;
  }
  updateProvider(v:MarketplacePayoutProvider){
    getDatabase().prepare(`
      UPDATE marketplace_payout_providers
      SET display_name=?,mode=?,status=?,webhook_secret_env=?,supports_reversals=?,updated_at=?
      WHERE id=?
    `).run(v.display_name,v.mode,v.status,v.webhook_secret_env,v.supports_reversals?1:0,v.updated_at,v.id);
    return v;
  }

  getPolicy(providerId:string,currency:string):MarketplacePayoutPolicy|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payout_policies WHERE provider_id=? AND currency=?').get(providerId,currency) as any;
    return r?this.mapPolicy(r):null;
  }
  upsertPolicy(v:MarketplacePayoutPolicy){
    getDatabase().prepare(`
      INSERT INTO marketplace_payout_policies
      (id,provider_id,currency,minimum_payout_minor,reserve_minor,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(provider_id,currency) DO UPDATE SET
        minimum_payout_minor=excluded.minimum_payout_minor,
        reserve_minor=excluded.reserve_minor,
        updated_by=excluded.updated_by,
        updated_at=excluded.updated_at
    `).run(v.id,v.provider_id,v.currency,v.minimum_payout_minor,v.reserve_minor,v.updated_by,v.created_at,v.updated_at);
    return this.getPolicy(v.provider_id,v.currency)!;
  }
  listPolicies():MarketplacePayoutPolicy[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_payout_policies ORDER BY provider_id,currency').all() as any[]).map(this.mapPolicy);
  }

  createAccount(v:Omit<MarketplacePayoutAccount,'provider_key'|'provider_display_name'>){
    getDatabase().prepare(`
      INSERT INTO marketplace_payout_accounts
      (id,store_id,provider_id,currency,provider_account_ref,account_label,status,registered_by,registered_at,activated_by,activated_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.store_id,v.provider_id,v.currency,v.provider_account_ref,v.account_label,v.status,v.registered_by,v.registered_at,
      v.activated_by,v.activated_at,v.updated_at);
    return this.getAccount(v.id)!;
  }
  getAccount(id:string):MarketplacePayoutAccount|null{
    const r=getDatabase().prepare(`
      SELECT a.*,p.provider_key,p.display_name provider_display_name
      FROM marketplace_payout_accounts a JOIN marketplace_payout_providers p ON p.id=a.provider_id
      WHERE a.id=?
    `).get(id) as any;
    return r?this.mapAccount(r):null;
  }
  getStoreProviderAccount(storeId:string,providerId:string,currency:string):MarketplacePayoutAccount|null{
    const r=getDatabase().prepare(`
      SELECT a.*,p.provider_key,p.display_name provider_display_name
      FROM marketplace_payout_accounts a JOIN marketplace_payout_providers p ON p.id=a.provider_id
      WHERE a.store_id=? AND a.provider_id=? AND a.currency=?
    `).get(storeId,providerId,currency) as any;
    return r?this.mapAccount(r):null;
  }
  listStoreAccounts(storeId:string):MarketplacePayoutAccount[]{
    return (getDatabase().prepare(`
      SELECT a.*,p.provider_key,p.display_name provider_display_name
      FROM marketplace_payout_accounts a JOIN marketplace_payout_providers p ON p.id=a.provider_id
      WHERE a.store_id=? ORDER BY a.currency,p.provider_key
    `).all(storeId) as any[]).map(this.mapAccount);
  }
  listAccounts(limit=200):MarketplacePayoutAccount[]{
    return (getDatabase().prepare(`
      SELECT a.*,p.provider_key,p.display_name provider_display_name
      FROM marketplace_payout_accounts a JOIN marketplace_payout_providers p ON p.id=a.provider_id
      ORDER BY a.registered_at DESC LIMIT ?
    `).all(limit) as any[]).map(this.mapAccount);
  }
  updateAccountStatus(id:string,status:string,activatedBy:string|null,activatedAt:string|null,updatedAt:string){
    getDatabase().prepare(`
      UPDATE marketplace_payout_accounts
      SET status=?,activated_by=?,activated_at=?,updated_at=? WHERE id=?
    `).run(status,activatedBy,activatedAt,updatedAt,id);
    return this.getAccount(id)!;
  }

  createPayout(v:Omit<MarketplacePayout,'provider_key'>){
    getDatabase().prepare(`
      INSERT INTO marketplace_payouts
      (id,payout_number,store_id,payout_account_id,provider_id,idempotency_key,provider_payout_id,amount_minor,currency,status,
       failure_code,failure_message,requested_by,requested_at,processing_at,succeeded_at,failed_at,reversed_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.payout_number,v.store_id,v.payout_account_id,v.provider_id,v.idempotency_key,v.provider_payout_id,
      v.amount_minor,v.currency,v.status,v.failure_code,v.failure_message,v.requested_by,v.requested_at,v.processing_at,
      v.succeeded_at,v.failed_at,v.reversed_at,v.updated_at);
    return this.getPayout(v.id)!;
  }
  getPayout(id:string):MarketplacePayout|null{
    const r=getDatabase().prepare(`
      SELECT po.*,pr.provider_key FROM marketplace_payouts po
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id WHERE po.id=?
    `).get(id) as any;
    return r?this.mapPayout(r):null;
  }
  getPayoutByIdempotency(storeId:string,key:string):MarketplacePayout|null{
    const r=getDatabase().prepare(`
      SELECT po.*,pr.provider_key FROM marketplace_payouts po
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id
      WHERE po.store_id=? AND po.idempotency_key=?
    `).get(storeId,key) as any;
    return r?this.mapPayout(r):null;
  }
  getPayoutByProviderReference(providerId:string,providerPayoutId:string):MarketplacePayout|null{
    const r=getDatabase().prepare(`
      SELECT po.*,pr.provider_key FROM marketplace_payouts po
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id
      WHERE po.provider_id=? AND po.provider_payout_id=?
    `).get(providerId,providerPayoutId) as any;
    return r?this.mapPayout(r):null;
  }
  listStorePayouts(storeId:string,limit=100):MarketplacePayout[]{
    return (getDatabase().prepare(`
      SELECT po.*,pr.provider_key FROM marketplace_payouts po
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id
      WHERE po.store_id=? ORDER BY po.requested_at DESC LIMIT ?
    `).all(storeId,limit) as any[]).map(this.mapPayout);
  }
  listPayouts(limit=200):MarketplacePayout[]{
    return (getDatabase().prepare(`
      SELECT po.*,pr.provider_key FROM marketplace_payouts po
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id
      ORDER BY po.requested_at DESC LIMIT ?
    `).all(limit) as any[]).map(this.mapPayout);
  }
  updatePayout(v:MarketplacePayout){
    getDatabase().prepare(`
      UPDATE marketplace_payouts SET provider_payout_id=?,status=?,failure_code=?,failure_message=?,
        processing_at=?,succeeded_at=?,failed_at=?,reversed_at=?,updated_at=? WHERE id=?
    `).run(v.provider_payout_id,v.status,v.failure_code,v.failure_message,v.processing_at,v.succeeded_at,v.failed_at,v.reversed_at,v.updated_at,v.id);
    return this.getPayout(v.id)!;
  }

  currencyBalances(storeId:string):MarketplacePayoutCurrencyBalance[]{
    const db=getDatabase();
    const ledger=db.prepare(`
      SELECT currency,COALESCE(SUM(amount_minor),0) net
      FROM marketplace_settlement_ledger_entries WHERE store_id=? GROUP BY currency
    `).all(storeId) as any[];
    const payoutRows=db.prepare(`
      SELECT currency,
        COALESCE(SUM(CASE WHEN status='REQUESTED' THEN amount_minor ELSE 0 END),0) requested,
        COALESCE(SUM(CASE WHEN status='PROCESSING' THEN amount_minor ELSE 0 END),0) processing,
        COALESCE(SUM(CASE WHEN status='SUCCEEDED' THEN amount_minor ELSE 0 END),0) paid,
        COALESCE(SUM(CASE WHEN status='REVERSED' THEN amount_minor ELSE 0 END),0) reversed
      FROM marketplace_payouts WHERE store_id=? GROUP BY currency
    `).all(storeId) as any[];
    const map=new Map<string,{net:number;requested:number;processing:number;paid:number;reversed:number}>();
    for(const r of ledger)map.set(String(r.currency),{net:Number(r.net||0),requested:0,processing:0,paid:0,reversed:0});
    for(const r of payoutRows){
      const key=String(r.currency),v=map.get(key)||{net:0,requested:0,processing:0,paid:0,reversed:0};
      v.requested=Number(r.requested||0);v.processing=Number(r.processing||0);v.paid=Number(r.paid||0);v.reversed=Number(r.reversed||0);map.set(key,v);
    }
    return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([currency,v])=>{
      const reserved=v.requested+v.processing;
      const raw=v.net-v.paid-reserved;
      return {
        store_id:storeId,currency,net_receivable_minor:v.net,requested_minor:v.requested,processing_minor:v.processing,
        reserved_minor:reserved,paid_minor:v.paid,reversed_history_minor:v.reversed,
        unallocated_minor:Math.max(0,raw),deficit_minor:Math.max(0,-raw),
        truth:{receivable_source:'SETTLEMENT_LEDGER',paid_source:'VERIFIED_PAYOUT_PROVIDER_EVENTS',receivable_is_payout:false,currencies_not_combined:true}
      };
    });
  }

  createBatch(v:Omit<MarketplacePayoutBatch,'provider_key'>,payoutIds:string[]){
    const db=getDatabase();
    db.prepare(`
      INSERT INTO marketplace_payout_batches
      (id,batch_number,provider_id,currency,status,created_by,created_at,handoff_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.batch_number,v.provider_id,v.currency,v.status,v.created_by,v.created_at,v.handoff_at,v.updated_at);
    const stmt=db.prepare('INSERT INTO marketplace_payout_batch_items (batch_id,payout_id,created_at) VALUES (?,?,?)');
    for(const payoutId of payoutIds)stmt.run(v.id,payoutId,v.created_at);
    return this.getBatch(v.id)!;
  }
  getBatch(id:string):MarketplacePayoutBatch|null{
    const r=getDatabase().prepare(`
      SELECT b.*,p.provider_key FROM marketplace_payout_batches b
      JOIN marketplace_payout_providers p ON p.id=b.provider_id WHERE b.id=?
    `).get(id) as any;
    return r?this.mapBatch(r):null;
  }
  listBatches(limit=100):MarketplacePayoutBatch[]{
    return (getDatabase().prepare(`
      SELECT b.*,p.provider_key FROM marketplace_payout_batches b
      JOIN marketplace_payout_providers p ON p.id=b.provider_id
      ORDER BY b.created_at DESC LIMIT ?
    `).all(limit) as any[]).map(this.mapBatch);
  }
  listBatchPayouts(batchId:string):Array<MarketplacePayout&{provider_account_ref:string}>{
    return (getDatabase().prepare(`
      SELECT po.*,pr.provider_key,a.provider_account_ref
      FROM marketplace_payout_batch_items bi
      JOIN marketplace_payouts po ON po.id=bi.payout_id
      JOIN marketplace_payout_providers pr ON pr.id=po.provider_id
      JOIN marketplace_payout_accounts a ON a.id=po.payout_account_id
      WHERE bi.batch_id=? ORDER BY po.requested_at,po.id
    `).all(batchId) as any[]).map(r=>({...this.mapPayout(r),provider_account_ref:String(r.provider_account_ref)}));
  }
  payoutBatchId(payoutId:string):string|null{
    const r=getDatabase().prepare('SELECT batch_id FROM marketplace_payout_batch_items WHERE payout_id=?').get(payoutId) as any;
    return r?String(r.batch_id):null;
  }
  updateBatchStatus(id:string,status:string,handoffAt:string|null,updatedAt:string){
    getDatabase().prepare('UPDATE marketplace_payout_batches SET status=?,handoff_at=COALESCE(?,handoff_at),updated_at=? WHERE id=?')
      .run(status,handoffAt,updatedAt,id);
    return this.getBatch(id)!;
  }
  recomputeBatchStatus(batchId:string,now:string){
    const rows=getDatabase().prepare(`
      SELECT po.status FROM marketplace_payout_batch_items bi JOIN marketplace_payouts po ON po.id=bi.payout_id WHERE bi.batch_id=?
    `).all(batchId) as any[];
    if(!rows.length)return this.getBatch(batchId);
    const statuses=rows.map(r=>String(r.status));
    let status:string;
    if(statuses.every(s=>s==='SUCCEEDED'))status='SETTLED';
    else if(statuses.some(s=>s==='FAILED'||s==='REVERSED'))status='ATTENTION';
    else{
      const current=this.getBatch(batchId);
      status=current?.status==='DRAFT'?'DRAFT':'HANDOFF_INITIATED';
    }
    return this.updateBatchStatus(batchId,status,null,now);
  }

  getProviderEvent(providerId:string,eventId:string):MarketplacePayoutProviderEvent|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_payout_provider_events WHERE provider_id=? AND provider_event_id=?').get(providerId,eventId) as any;
    return r?this.mapEvent(r):null;
  }
  createProviderEvent(v:MarketplacePayoutProviderEvent){
    getDatabase().prepare(`
      INSERT INTO marketplace_payout_provider_events
      (id,provider_id,provider_event_id,event_type,payout_id,signature_verified,payload_hash,processing_status,processing_message,occurred_at,processed_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.provider_id,v.provider_event_id,v.event_type,v.payout_id,v.signature_verified?1:0,v.payload_hash,v.processing_status,
      v.processing_message,v.occurred_at,v.processed_at);
    return v;
  }
  listProviderEvents(limit=100):MarketplacePayoutProviderEvent[]{
    return (getDatabase().prepare('SELECT * FROM marketplace_payout_provider_events ORDER BY processed_at DESC LIMIT ?').all(limit) as any[]).map(this.mapEvent);
  }
  createReconciliationIssue(v:{id:string;provider_id:string;provider_event_id:string;payout_id:string|null;issue_type:string;details:string;created_at:string}){
    getDatabase().prepare(`
      INSERT INTO marketplace_payout_reconciliation_issues
      (id,provider_id,provider_event_id,payout_id,issue_type,details,status,created_at)
      VALUES (?,?,?,?,?,?,'OPEN',?)
    `).run(v.id,v.provider_id,v.provider_event_id,v.payout_id,v.issue_type,v.details,v.created_at);
  }
  listReconciliationIssues(limit=100){
    return getDatabase().prepare('SELECT * FROM marketplace_payout_reconciliation_issues ORDER BY created_at DESC LIMIT ?').all(limit);
  }

  private mapProvider=(r:any):MarketplacePayoutProvider=>({
    id:String(r.id),provider_key:String(r.provider_key),display_name:String(r.display_name),mode:r.mode,status:r.status,
    webhook_secret_env:String(r.webhook_secret_env),supports_reversals:bool(r.supports_reversals),
    created_by:String(r.created_by),created_at:String(r.created_at),updated_at:String(r.updated_at)
  });
  private mapPolicy=(r:any):MarketplacePayoutPolicy=>({
    id:String(r.id),provider_id:String(r.provider_id),currency:String(r.currency),minimum_payout_minor:Number(r.minimum_payout_minor),
    reserve_minor:Number(r.reserve_minor),updated_by:String(r.updated_by),created_at:String(r.created_at),updated_at:String(r.updated_at)
  });
  private mapAccount=(r:any):MarketplacePayoutAccount=>({
    id:String(r.id),store_id:String(r.store_id),provider_id:String(r.provider_id),provider_key:String(r.provider_key),
    provider_display_name:String(r.provider_display_name),currency:String(r.currency),provider_account_ref:String(r.provider_account_ref),
    account_label:String(r.account_label),status:r.status,registered_by:String(r.registered_by),registered_at:String(r.registered_at),
    activated_by:r.activated_by?String(r.activated_by):null,activated_at:r.activated_at?String(r.activated_at):null,updated_at:String(r.updated_at)
  });
  private mapPayout=(r:any):MarketplacePayout=>({
    id:String(r.id),payout_number:String(r.payout_number),store_id:String(r.store_id),payout_account_id:String(r.payout_account_id),
    provider_id:String(r.provider_id),provider_key:String(r.provider_key),idempotency_key:String(r.idempotency_key),
    provider_payout_id:r.provider_payout_id?String(r.provider_payout_id):null,amount_minor:Number(r.amount_minor),currency:String(r.currency),
    status:r.status,failure_code:r.failure_code?String(r.failure_code):null,failure_message:r.failure_message?String(r.failure_message):null,
    requested_by:String(r.requested_by),requested_at:String(r.requested_at),processing_at:r.processing_at?String(r.processing_at):null,
    succeeded_at:r.succeeded_at?String(r.succeeded_at):null,failed_at:r.failed_at?String(r.failed_at):null,
    reversed_at:r.reversed_at?String(r.reversed_at):null,updated_at:String(r.updated_at)
  });
  private mapBatch=(r:any):MarketplacePayoutBatch=>({
    id:String(r.id),batch_number:String(r.batch_number),provider_id:String(r.provider_id),provider_key:String(r.provider_key),
    currency:String(r.currency),status:r.status,created_by:String(r.created_by),created_at:String(r.created_at),
    handoff_at:r.handoff_at?String(r.handoff_at):null,updated_at:String(r.updated_at)
  });
  private mapEvent=(r:any):MarketplacePayoutProviderEvent=>({
    id:String(r.id),provider_id:String(r.provider_id),provider_event_id:String(r.provider_event_id),event_type:r.event_type,
    payout_id:r.payout_id?String(r.payout_id):null,signature_verified:bool(r.signature_verified),payload_hash:String(r.payload_hash),
    processing_status:r.processing_status,processing_message:r.processing_message?String(r.processing_message):null,
    occurred_at:String(r.occurred_at),processed_at:String(r.processed_at)
  });
}
export const marketplacePayoutRepository=new MarketplacePayoutRepository();
