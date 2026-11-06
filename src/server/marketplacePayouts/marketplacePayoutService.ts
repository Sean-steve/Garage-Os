import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplacePayoutProviderAdapter as adapter } from './payoutProviderAdapter';
import { marketplacePayoutRepository as repo } from './marketplacePayoutRepository';
import {
  MarketplacePayout, MarketplacePayoutAccountStatus, MarketplacePayoutProvider,
  MarketplacePayoutProviderEvent, MarketplacePayoutProviderEventType, MarketplacePayoutWebhookInput
} from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function requiredText(value:unknown,field:string,max:number):string{
  const v=String(value||'').trim();
  if(!v)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is required',400);
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is too long',400);
  return v;
}
function providerKey(value:unknown):string{
  const v=String(value||'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'provider_key must contain 2-40 uppercase letters, numbers, underscore or hyphen',400);
  return v;
}
function secretEnv(value:unknown):string{
  const v=String(value||'').trim();
  if(!/^[A-Z][A-Z0-9_]{5,120}$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'webhook_secret_env must be a valid environment variable name',400);
  return v;
}
function currency(value:unknown):string{
  const v=String(value||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'currency must be a 3-letter code',400);
  return v;
}
function positiveMoney(value:unknown,field:string):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be a positive integer minor-unit amount',400);
  return n;
}
function nonNegativeMoney(value:unknown,field:string):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be a non-negative integer minor-unit amount',400);
  return n;
}
function idempotency(value:unknown):string{
  const v=String(value||'').trim();
  if(v.length<8||v.length>120)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Idempotency-Key must be 8-120 characters',400);
  return v;
}
function providerAccountRef(value:unknown):string{
  const v=requiredText(value,'provider_account_ref',200);
  if(/^[+]?[ds-]{6,}$/.test(v)){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'provider_account_ref must be a provider-issued token/reference, not a raw phone or numeric bank account',400);
  }
  return v;
}
function secureEqual(a:string,b:string):boolean{
  try{
    const aa=Buffer.from(a,'hex'),bb=Buffer.from(b,'hex');
    return aa.length===bb.length&&aa.length>0&&timingSafeEqual(aa,bb);
  }catch{return false;}
}
function canonicalWebhook(input:MarketplacePayoutWebhookInput):string{
  return [
    input.provider_event_id,input.event_type,input.provider_payout_id,input.payout_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase()
  ].join('|');
}

export class MarketplacePayoutService{
  listActiveProviders(){
    return repo.listActiveProviders().map(p=>({
      id:p.id,provider_key:p.provider_key,display_name:p.display_name,mode:p.mode,status:p.status,supports_reversals:p.supports_reversals
    }));
  }

  listProviders(actor:AuthenticatedActorContext){
    this.requireFinanceRole(actor);
    return repo.listProviders();
  }
  createProvider(actor:AuthenticatedActorContext,input:any){
    this.requireFinanceRole(actor);
    const key=providerKey(input.provider_key);
    if(repo.getProviderByKey(key))throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout provider key already exists',409);
    const now=getCurrentUtcIsoString();
    const provider:MarketplacePayoutProvider={
      id:generateCanonicalId('mpoutprov'),provider_key:key,display_name:requiredText(input.display_name,'display_name',120),
      mode:String(input.mode||'TEST').toUpperCase()==='LIVE'?'LIVE':'TEST',status:'ACTIVE',
      webhook_secret_env:secretEnv(input.webhook_secret_env),supports_reversals:Boolean(input.supports_reversals),
      created_by:actor.user_id,created_at:now,updated_at:now
    };
    repo.createProvider(provider);
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_PROVIDER_CREATED',
      resource_type:'marketplace_payout_provider',resource_id:provider.id,correlation_id:provider.id,source:'MARKETPLACE_PAYOUT_API',
      after_state:{provider_key:provider.provider_key,mode:provider.mode,status:provider.status,supports_reversals:provider.supports_reversals}});
    return provider;
  }
  updateProvider(actor:AuthenticatedActorContext,providerId:string,input:any){
    this.requireFinanceRole(actor);
    const current=repo.getProvider(providerId);
    if(!current)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout provider not found',404);
    const status=String(input.status??current.status).toUpperCase();
    if(!['ACTIVE','PAUSED','RETIRED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid payout provider status',400);
    const mode=String(input.mode??current.mode).toUpperCase();
    if(!['TEST','LIVE'].includes(mode))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid payout provider mode',400);
    const next:MarketplacePayoutProvider={...current,
      display_name:input.display_name===undefined?current.display_name:requiredText(input.display_name,'display_name',120),
      mode:mode as any,status:status as any,
      webhook_secret_env:input.webhook_secret_env===undefined?current.webhook_secret_env:secretEnv(input.webhook_secret_env),
      supports_reversals:input.supports_reversals===undefined?current.supports_reversals:Boolean(input.supports_reversals),
      updated_at:getCurrentUtcIsoString()
    };
    repo.updateProvider(next);
    return next;
  }

  setPolicy(actor:AuthenticatedActorContext,providerId:string,input:any){
    this.requireFinanceRole(actor);
    const provider=repo.getProvider(providerId);
    if(!provider)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout provider not found',404);
    const cur=currency(input.currency),minimum=positiveMoney(input.minimum_payout_minor,'minimum_payout_minor'),
      reserve=nonNegativeMoney(input.reserve_minor??0,'reserve_minor'),now=getCurrentUtcIsoString();
    const existing=repo.getPolicy(providerId,cur);
    const policy=repo.upsertPolicy({
      id:existing?.id||generateCanonicalId('mpoutpol'),provider_id:providerId,currency:cur,minimum_payout_minor:minimum,
      reserve_minor:reserve,updated_by:actor.user_id,created_at:existing?.created_at||now,updated_at:now
    });
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_POLICY_UPDATED',
      resource_type:'marketplace_payout_policy',resource_id:policy.id,correlation_id:policy.id,source:'MARKETPLACE_PAYOUT_API',
      after_state:{provider_id:providerId,currency:cur,minimum_payout_minor:minimum,reserve_minor:reserve}});
    return policy;
  }
  listPolicies(actor:AuthenticatedActorContext){this.requireFinanceRole(actor);return repo.listPolicies();}

  registerAccount(actor:AuthenticatedActorContext,storeId:string,input:any){
    const store=this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const provider=repo.getProvider(String(input.provider_id||''));
    if(!provider||provider.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Selected payout provider is unavailable',409);
    const cur=currency(input.currency);
    const existing=repo.getStoreProviderAccount(storeId,provider.id,cur);
    if(existing)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'A payout account already exists for this provider and currency',409);
    const now=getCurrentUtcIsoString();
    const account=repo.createAccount({
      id:generateCanonicalId('mpoutacc'),store_id:storeId,provider_id:provider.id,currency:cur,
      provider_account_ref:providerAccountRef(input.provider_account_ref),account_label:requiredText(input.account_label,'account_label',80),
      status:'PENDING_REVIEW',registered_by:actor.user_id,registered_at:now,activated_by:null,activated_at:null,updated_at:now
    });
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_ACCOUNT_REGISTERED',
      resource_type:'marketplace_payout_account',resource_id:account.id,correlation_id:account.id,source:'MARKETPLACE_PAYOUT_API',
      after_state:{store_id:storeId,provider_id:provider.id,currency:cur,status:account.status,provider_reference_redacted:true,
        organization_id:String(store.organization_id)}});
    return this.redactAccount(account);
  }

  reviewAccount(actor:AuthenticatedActorContext,accountId:string,input:any){
    this.requireFinanceRole(actor);
    const account=repo.getAccount(accountId);
    if(!account)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout account not found',404);
    const status=String(input.status||'').toUpperCase() as MarketplacePayoutAccountStatus;
    if(!['ACTIVE','PAUSED','RETIRED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'status must be ACTIVE, PAUSED or RETIRED',400);
    const now=getCurrentUtcIsoString();
    const next=repo.updateAccountStatus(account.id,status,status==='ACTIVE'?(account.activated_by||actor.user_id):account.activated_by,
      status==='ACTIVE'?(account.activated_at||now):account.activated_at,now);
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_ACCOUNT_REVIEWED',
      resource_type:'marketplace_payout_account',resource_id:account.id,correlation_id:account.id,source:'MARKETPLACE_PAYOUT_API',
      before_state:{status:account.status},after_state:{status:next.status,provider_reference_redacted:true}});
    return next;
  }

  sellerDashboard(actor:AuthenticatedActorContext,storeId:string){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    const balances=repo.currencyBalances(storeId);
    const accounts=repo.listStoreAccounts(storeId);
    const payoutOptions=accounts.filter(a=>a.status==='ACTIVE').flatMap(a=>{
      const provider=repo.getProvider(a.provider_id),policy=repo.getPolicy(a.provider_id,a.currency);
      if(!provider||provider.status!=='ACTIVE'||!policy)return [];
      const balance=balances.find(b=>b.currency===a.currency);
      const requestable=Math.max(0,Number(balance?.unallocated_minor||0)-policy.reserve_minor);
      return [{
        payout_account_id:a.id,provider_id:a.provider_id,provider_key:a.provider_key,provider_display_name:a.provider_display_name,
        currency:a.currency,account_label:a.account_label,
        policy:{minimum_payout_minor:policy.minimum_payout_minor,reserve_minor:policy.reserve_minor},
        requestable_minor:requestable,
        truth:{account_activation_source:'FINANCE_RECORDED' as const,provider_account_ref_exposed:false as const}
      }];
    });
    return {
      store_id:storeId,balances,payout_options:payoutOptions,accounts:accounts.map(a=>this.redactAccount(a)),payouts:repo.listStorePayouts(storeId),
      truth:{settlement_ledger_authoritative:true as const,payout_provider_event_authoritative:true as const,
        browser_cannot_mark_paid:true as const,raw_bank_or_mobile_money_secrets_stored:false as const}
    };
  }

  requestPayout(actor:AuthenticatedActorContext,storeId:string,input:any,idempotencyKey:unknown){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const key=idempotency(idempotencyKey);
    const existing=repo.getPayoutByIdempotency(storeId,key);
    if(existing)return {payout:existing,balance:this.balanceFor(storeId,existing.currency),duplicate:true};
    const account=repo.getAccount(requiredText(input.payout_account_id,'payout_account_id',100));
    if(!account||account.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout account not found',404);
    if(account.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout account is not active',409);
    const provider=repo.getProvider(account.provider_id);
    if(!provider||provider.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout provider is unavailable',409);
    const policy=repo.getPolicy(provider.id,account.currency);
    if(!policy)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout policy is not configured for this provider and currency',409);
    const amount=positiveMoney(input.amount_minor,'amount_minor');
    if(amount<policy.minimum_payout_minor)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout amount is below the configured minimum',409);
    let created!:MarketplacePayout;
    withTransaction(({db})=>{
      const duplicate=repo.getPayoutByIdempotency(storeId,key);
      if(duplicate){created=duplicate;return;}
      const balance=this.balanceFor(storeId,account.currency);
      const requestable=Math.max(0,balance.unallocated_minor-policy.reserve_minor);
      if(amount>requestable)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout amount exceeds currently requestable balance after reserves',409);
      const now=getCurrentUtcIsoString(),id=generateCanonicalId('mpayout');
      created=repo.createPayout({
        id,payout_number:'PO-'+now.slice(2,10).replaceAll('-','')+'-'+id.slice(-8).toUpperCase(),
        store_id:storeId,payout_account_id:account.id,provider_id:provider.id,idempotency_key:key,provider_payout_id:null,
        amount_minor:amount,currency:account.currency,status:'REQUESTED',failure_code:null,failure_message:null,
        requested_by:actor.user_id,requested_at:now,processing_at:null,succeeded_at:null,failed_at:null,reversed_at:null,updated_at:now
      });
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.payout.requested',producer:'garage-os-marketplace-payouts',correlation_id:created.id,
        subject_ids:{marketplace_store:storeId,marketplace_payout:created.id,marketplace_payout_account:account.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{payout_id:created.id,amount_minor:created.amount_minor,currency:created.currency,status:created.status,
          provider_key:provider.provider_key,payout_completed:false}
      }),db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_REQUESTED',
        resource_type:'marketplace_payout',resource_id:created.id,correlation_id:created.id,source:'MARKETPLACE_PAYOUT_API',
        after_state:{store_id:storeId,provider_key:provider.provider_key,amount_minor:amount,currency:account.currency,status:'REQUESTED'}},db);
    });
    return {payout:created,balance:this.balanceFor(storeId,account.currency),duplicate:false,
      truth:{payout_completed:created.status==='SUCCEEDED',provider_confirmation_required:true}};
  }

  adminOverview(actor:AuthenticatedActorContext){
    this.requireFinanceRole(actor);
    return {
      providers:repo.listProviders(),policies:repo.listPolicies(),accounts:repo.listAccounts(),payouts:repo.listPayouts(),
      batches:repo.listBatches(),events:repo.listProviderEvents(),issues:repo.listReconciliationIssues(),
      truth:{provider_events_authoritative:true,receivable_is_not_payout:true,raw_secrets_exposed:false}
    };
  }

  createBatch(actor:AuthenticatedActorContext,input:any){
    this.requireFinanceRole(actor);
    const provider=repo.getProvider(requiredText(input.provider_id,'provider_id',100));
    if(!provider||provider.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout provider is unavailable',409);
    const cur=currency(input.currency);
    const ids=Array.isArray(input.payout_ids)?[...new Set(input.payout_ids.map((x:any)=>String(x)))]:[];
    if(!ids.length||ids.length>100)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'payout_ids must contain 1-100 unique payouts',400);
    const payouts=ids.map(id=>repo.getPayout(id));
    if(payouts.some(p=>!p))throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'One or more payouts were not found',404);
    for(const p of payouts as MarketplacePayout[]){
      if(p.provider_id!==provider.id||p.currency!==cur)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'All payouts in a batch must share provider and currency',409);
      if(p.status!=='REQUESTED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only REQUESTED payouts may be batched',409);
      if(repo.payoutBatchId(p.id))throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'A payout is already assigned to a batch',409);
      const account=repo.getAccount(p.payout_account_id);
      if(!account||account.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'All batched payouts require active payout accounts',409);
    }
    const now=getCurrentUtcIsoString(),id=generateCanonicalId('mpoutbatch');
    const batch=withTransaction(({db})=>{
      const created=repo.createBatch({
        id,batch_number:'PB-'+now.slice(2,10).replaceAll('-','')+'-'+id.slice(-8).toUpperCase(),provider_id:provider.id,
        currency:cur,status:'DRAFT',created_by:actor.user_id,created_at:now,handoff_at:null,updated_at:now
      },ids);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.payout.batch.created',producer:'garage-os-marketplace-payouts',correlation_id:created.id,
        subject_ids:{marketplace_payout_batch:created.id},actor_id:actor.user_id,actor_type:actorType(actor),
        provenance_class:DataProvenanceClass.SYSTEM_DERIVED,
        payload:{batch_id:created.id,provider_key:provider.provider_key,currency:cur,payout_count:ids.length}
      }),db);
      return created;
    });
    return {batch,payouts:repo.listBatchPayouts(batch.id).map(({provider_account_ref,...p})=>p)};
  }

  initiateBatchHandoff(actor:AuthenticatedActorContext,batchId:string){
    this.requireFinanceRole(actor);
    const batch=repo.getBatch(batchId);
    if(!batch)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout batch not found',404);
    if(!['DRAFT','HANDOFF_INITIATED'].includes(batch.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only an unsettled payout batch can be handed off',409);
    const provider=repo.getProvider(batch.provider_id);
    if(!provider||provider.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout provider is unavailable',409);
    const payouts=repo.listBatchPayouts(batch.id);
    if(!payouts.length)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payout batch is empty',409);
    if(payouts.some(p=>p.status!=='REQUESTED'))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Batch contains payout state that cannot be handed off',409);
    const handoff=adapter.prepareBatchHandoff(provider,batch,payouts);
    const now=getCurrentUtcIsoString();
    const updated=batch.status==='HANDOFF_INITIATED'?batch:repo.updateBatchStatus(batch.id,'HANDOFF_INITIATED',now,now);
    if(batch.status!=='HANDOFF_INITIATED'){
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYOUT_BATCH_HANDOFF_INITIATED',
        resource_type:'marketplace_payout_batch',resource_id:batch.id,correlation_id:batch.id,source:'MARKETPLACE_PAYOUT_API',
        after_state:{provider_key:provider.provider_key,payout_count:payouts.length,execution_performed:false}});
    }
    return {batch:updated,provider_action:handoff,truth:{provider_accepted:false,payouts_marked_paid:false,payouts_marked_processing:false}};
  }

  processWebhook(providerKeyInput:string,signature:string,input:MarketplacePayoutWebhookInput){
    const provider=repo.getProviderByKey(providerKey(providerKeyInput));
    if(!provider||provider.status==='RETIRED')throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payout provider not found',404);
    const secret=process.env[provider.webhook_secret_env];
    if(!secret)throw new CanonicalAppError(ErrorCode.DEPENDENCY_UNAVAILABLE,'Payout provider webhook secret is not configured',503);
    const supplied=String(signature||'').trim().replace(/^sha256=/i,'');
    const expected=createHmac('sha256',secret).update(canonicalWebhook(input)).digest('hex');
    if(!supplied||!secureEqual(supplied,expected))throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Invalid payout provider signature',401);

    const prior=repo.getProviderEvent(provider.id,requiredText(input.provider_event_id,'provider_event_id',160));
    if(prior)return {duplicate:true,event:prior,payout:prior.payout_id?repo.getPayout(prior.payout_id):null};

    const now=getCurrentUtcIsoString(),payloadHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const payout=repo.getPayoutByProviderReference(provider.id,String(input.provider_payout_id||''))||repo.getPayout(String(input.payout_id||''));
    if(!payout||payout.provider_id!==provider.id){
      const event=this.rejectEvent(provider,input,payloadHash,'UNKNOWN_PAYOUT',null,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpoutissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        payout_id:null,issue_type:'UNKNOWN_PAYOUT',details:'Verified provider event could not be matched to a payout',created_at:now});
      return {duplicate:false,event,payout:null};
    }
    if(payout.id!==input.payout_id||payout.amount_minor!==Number(input.amount_minor)||payout.currency!==String(input.currency||'').toUpperCase()){
      const event=this.rejectEvent(provider,input,payloadHash,'PAYOUT_FACT_MISMATCH',payout.id,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpoutissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        payout_id:payout.id,issue_type:'PAYOUT_FACT_MISMATCH',details:'Provider event payout/amount/currency did not match the payout request',created_at:now});
      return {duplicate:false,event,payout};
    }
    if(payout.provider_payout_id&&payout.provider_payout_id!==input.provider_payout_id){
      const event=this.rejectEvent(provider,input,payloadHash,'PROVIDER_PAYOUT_ID_MISMATCH',payout.id,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpoutissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        payout_id:payout.id,issue_type:'PROVIDER_PAYOUT_ID_MISMATCH',details:'Provider payout reference changed for an existing payout',created_at:now});
      return {duplicate:false,event,payout};
    }
    if(input.event_type==='PAYOUT_REVERSED'&&!provider.supports_reversals){
      const event=this.rejectEvent(provider,input,payloadHash,'REVERSAL_UNSUPPORTED',payout.id,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpoutissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        payout_id:payout.id,issue_type:'REVERSAL_UNSUPPORTED',details:'Provider reported payout reversal but is not configured to support reversals',created_at:now});
      return {duplicate:false,event,payout};
    }
    if(input.event_type==='PAYOUT_SUCCEEDED'&&['FAILED','REVERSED'].includes(payout.status)){
      return this.rejectContradiction(provider,input,payloadHash,payout,'LATE_SUCCESS_AFTER_TERMINAL_STATE',now);
    }
    if(input.event_type==='PAYOUT_REVERSED'&&!['SUCCEEDED','REVERSED'].includes(payout.status)){
      return this.rejectContradiction(provider,input,payloadHash,payout,'REVERSAL_BEFORE_SUCCESS',now);
    }

    let processing:'PROCESSED'|'IGNORED'='PROCESSED',message='Processed',updated=payout;
    withTransaction(({db})=>{
      const bound={...payout,provider_payout_id:payout.provider_payout_id||requiredText(input.provider_payout_id,'provider_payout_id',160),updated_at:now};
      if(input.event_type==='PAYOUT_PROCESSING'){
        if(payout.status!=='REQUESTED'){processing='IGNORED';message='Ignored after payout left REQUESTED state';}
        else updated=repo.updatePayout({...bound,status:'PROCESSING',processing_at:now,failure_code:null,failure_message:null});
      }else if(input.event_type==='PAYOUT_SUCCEEDED'){
        if(payout.status==='SUCCEEDED'){processing='IGNORED';message='Payout already succeeded';}
        else updated=repo.updatePayout({...bound,status:'SUCCEEDED',processing_at:payout.processing_at||now,succeeded_at:now,
          failed_at:null,reversed_at:null,failure_code:null,failure_message:null});
      }else if(input.event_type==='PAYOUT_FAILED'){
        if(['SUCCEEDED','REVERSED','FAILED'].includes(payout.status)){processing='IGNORED';message='Ignored after terminal payout state';}
        else updated=repo.updatePayout({...bound,status:'FAILED',failed_at:now,
          failure_code:input.failure_code||'PROVIDER_FAILED',failure_message:input.failure_message||'Payout provider reported failure'});
      }else if(input.event_type==='PAYOUT_REVERSED'){
        if(payout.status==='REVERSED'){processing='IGNORED';message='Payout already reversed';}
        else updated=repo.updatePayout({...bound,status:'REVERSED',reversed_at:now,failure_code:null,failure_message:null});
      }

      const event:MarketplacePayoutProviderEvent={
        id:generateCanonicalId('mpoutevt'),provider_id:provider.id,provider_event_id:input.provider_event_id,event_type:input.event_type,
        payout_id:payout.id,signature_verified:true,payload_hash:payloadHash,processing_status:processing,processing_message:message,
        occurred_at:requiredText(input.occurred_at,'occurred_at',80),processed_at:now
      };
      repo.createProviderEvent(event);
      const batchId=repo.payoutBatchId(payout.id);if(batchId)repo.recomputeBatchStatus(batchId,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:this.domainEventType(input.event_type),producer:'garage-os-marketplace-payouts',correlation_id:event.id,
        subject_ids:{marketplace_store:payout.store_id,marketplace_payout:payout.id,...(batchId?{marketplace_payout_batch:batchId}:{})},
        actor_id:'payout-provider:'+provider.provider_key,actor_type:CanonicalActorType.SYSTEM_WORKER,
        provenance_class:DataProvenanceClass.EXTERNALLY_VERIFIED,
        payload:{provider_key:provider.provider_key,provider_event_id:input.provider_event_id,payout_id:payout.id,
          amount_minor:payout.amount_minor,currency:payout.currency,status:updated.status,signature_verified:true}
      }),db);
      recordAuditEvent({actor_id:'payout-provider:'+provider.provider_key,actor_type:CanonicalActorType.SYSTEM_WORKER,
        action:'MARKETPLACE_PAYOUT_PROVIDER_EVENT_PROCESSED',resource_type:'marketplace_payout_provider_event',resource_id:event.id,
        correlation_id:event.id,source:'MARKETPLACE_PAYOUT_WEBHOOK',
        after_state:{provider_event_id:event.provider_event_id,event_type:event.event_type,payout_id:payout.id,
          processing_status:event.processing_status,payout_status:updated.status,signature_verified:true}},db);
    });
    return {duplicate:false,event:repo.getProviderEvent(provider.id,input.provider_event_id)!,payout:repo.getPayout(payout.id)!,
      balance:this.balanceFor(payout.store_id,payout.currency)};
  }

  private rejectContradiction(provider:MarketplacePayoutProvider,input:MarketplacePayoutWebhookInput,payloadHash:string,payout:MarketplacePayout,issue:string,now:string){
    const event=this.rejectEvent(provider,input,payloadHash,issue,payout.id,now);
    repo.createReconciliationIssue({id:generateCanonicalId('mpoutissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
      payout_id:payout.id,issue_type:issue,details:'Verified payout provider event contradicted a terminal payout state',created_at:now});
    return {duplicate:false,event,payout};
  }
  private rejectEvent(provider:MarketplacePayoutProvider,input:MarketplacePayoutWebhookInput,payloadHash:string,message:string,payoutId:string|null,now:string){
    const event:MarketplacePayoutProviderEvent={
      id:generateCanonicalId('mpoutevt'),provider_id:provider.id,provider_event_id:requiredText(input.provider_event_id,'provider_event_id',160),
      event_type:input.event_type,payout_id:payoutId,signature_verified:true,payload_hash:payloadHash,processing_status:'REJECTED',
      processing_message:message,occurred_at:String(input.occurred_at||now),processed_at:now
    };
    repo.createProviderEvent(event);return event;
  }
  private domainEventType(type:MarketplacePayoutProviderEventType){
    if(type==='PAYOUT_PROCESSING')return 'marketplace.payout.processing';
    if(type==='PAYOUT_SUCCEEDED')return 'marketplace.payout.succeeded';
    if(type==='PAYOUT_FAILED')return 'marketplace.payout.failed';
    return 'marketplace.payout.reversed';
  }
  private balanceFor(storeId:string,cur:string){
    return repo.currencyBalances(storeId).find(b=>b.currency===cur)||{
      store_id:storeId,currency:cur,net_receivable_minor:0,requested_minor:0,processing_minor:0,reserved_minor:0,paid_minor:0,
      reversed_history_minor:0,unallocated_minor:0,deficit_minor:0,
      truth:{receivable_source:'SETTLEMENT_LEDGER' as const,paid_source:'VERIFIED_PAYOUT_PROVIDER_EVENTS' as const,
        receivable_is_payout:false as const,currencies_not_combined:true as const}
    };
  }
  private requireStore(actor:AuthenticatedActorContext,storeId:string,permission:CanonicalPermission){
    const store=getDatabase().prepare('SELECT id,organization_id FROM marketplace_stores WHERE id=?').get(storeId) as any;
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    if(!this.hasFinanceRole(actor))assertAuthorized(actor,permission,{organizationId:String(store.organization_id)});
    return store;
  }
  private redactAccount(account:any){
    const {provider_account_ref,...safe}=account;
    return safe;
  }
  private hasFinanceRole(actor:AuthenticatedActorContext){
    return actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)||actor.platform_roles?.includes(PlatformRole.FINANCE_OPERATOR);
  }
  private requireFinanceRole(actor:AuthenticatedActorContext){
    if(!this.hasFinanceRole(actor))throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform finance role required',403);
  }
}
export const marketplacePayoutService=new MarketplacePayoutService();
