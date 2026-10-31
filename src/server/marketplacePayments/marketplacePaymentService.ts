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
import { marketplaceTransactionRepository } from '../marketplaceTransactions/marketplaceTransactionRepository';
import { marketplacePaymentRepository as repo } from './marketplacePaymentRepository';
import {
  MarketplacePaymentProvider, MarketplaceProviderEvent, MarketplaceProviderEventType,
  MarketplaceRefund, ProviderWebhookInput
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
function money(value:unknown,field:string):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<=0)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be a positive integer minor-unit amount',400);
  return n;
}
function providerKey(value:unknown):string{
  const v=String(value||'').trim().toUpperCase();
  if(!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'provider_key must contain 2-40 uppercase letters, numbers, underscore or hyphen',400);
  return v;
}
function secretEnv(value:unknown):string{
  const v=String(value||'').trim();
  if(!/^[A-Z][A-Z0-9_]{5,120}$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'webhook_secret_env must be a valid environment-variable name',400);
  return v;
}
function idempotency(value:unknown):string{
  const v=String(value||'').trim();
  if(v.length<8||v.length>160)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Idempotency-Key must be 8-160 characters',400);
  return v;
}
function canonicalWebhook(input:ProviderWebhookInput):string{
  return [
    input.provider_event_id,input.event_type,input.provider_payment_id,input.order_id,
    String(input.amount_minor),String(input.currency||'').toUpperCase(),input.refund_id||'',input.provider_refund_id||''
  ].join('|');
}
function secureEqual(a:string,b:string):boolean{
  const aa=Buffer.from(a.toLowerCase(),'utf8'),bb=Buffer.from(b.toLowerCase(),'utf8');
  return aa.length===bb.length&&timingSafeEqual(aa,bb);
}

export class MarketplacePaymentService{
  listActiveProviders(){
    return repo.listProviders().filter(p=>p.status==='ACTIVE').map(p=>({
      provider_key:p.provider_key,display_name:p.display_name,mode:p.mode,supports_refunds:p.supports_refunds
    }));
  }

  listProviders(actor:AuthenticatedActorContext){
    this.requireFinanceRole(actor);
    return repo.listProviders();
  }

  createProvider(actor:AuthenticatedActorContext,input:any):MarketplacePaymentProvider{
    this.requireFinanceRole(actor);
    const key=providerKey(input.provider_key);
    if(repo.getProviderByKey(key))throw new CanonicalAppError(ErrorCode.CONFLICT,'Payment provider key already exists',409);
    const mode=String(input.mode||'TEST').toUpperCase();
    if(!['TEST','LIVE'].includes(mode))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid provider mode',400);
    const now=getCurrentUtcIsoString();
    const value:MarketplacePaymentProvider={
      id:generateCanonicalId('mpayprov'),provider_key:key,display_name:requiredText(input.display_name,'display_name',120),
      mode:mode as any,status:'ACTIVE',webhook_secret_env:secretEnv(input.webhook_secret_env),
      supports_refunds:Boolean(input.supports_refunds),created_by:actor.user_id,created_at:now,updated_at:now
    };
    repo.createProvider(value);
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYMENT_PROVIDER_CREATED',
      resource_type:'marketplace_payment_provider',resource_id:value.id,correlation_id:value.id,source:'MARKETPLACE_PAYMENT_API',
      after_state:{provider_key:value.provider_key,mode:value.mode,status:value.status,supports_refunds:value.supports_refunds}});
    return value;
  }

  updateProvider(actor:AuthenticatedActorContext,providerId:string,input:any):MarketplacePaymentProvider{
    this.requireFinanceRole(actor);
    const current=repo.getProvider(providerId);
    if(!current)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payment provider not found',404);
    const mode=input.mode===undefined?current.mode:String(input.mode).toUpperCase();
    const status=input.status===undefined?current.status:String(input.status).toUpperCase();
    if(!['TEST','LIVE'].includes(mode))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid provider mode',400);
    if(!['ACTIVE','PAUSED','RETIRED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid provider status',400);
    const updated={...current,
      display_name:input.display_name===undefined?current.display_name:requiredText(input.display_name,'display_name',120),
      mode:mode as any,status:status as any,
      webhook_secret_env:input.webhook_secret_env===undefined?current.webhook_secret_env:secretEnv(input.webhook_secret_env),
      supports_refunds:input.supports_refunds===undefined?current.supports_refunds:Boolean(input.supports_refunds),
      updated_at:getCurrentUtcIsoString()
    };
    return repo.updateProvider(updated);
  }

  createIntent(actor:AuthenticatedActorContext,orderId:string,providerKeyInput:unknown,idempotencyKey:unknown){
    const order=this.requireBuyerOrder(actor,orderId);
    if(order.status==='CANCELLED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Cancelled orders cannot be paid',409);
    const financial=repo.financialSummary(order.id);
    if(financial.captured_minor>=order.total_minor)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Order is already fully paid',409);
    const provider=repo.getProviderByKey(providerKey(providerKeyInput));
    if(!provider||provider.status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Selected payment provider is unavailable',409);
    const key=idempotency(idempotencyKey);
    const existing=repo.getIntentByOrderIdempotency(order.id,key);
    if(existing)return this.intentResponse(existing);
    const active=repo.listOrderIntents(order.id).find(x=>x.status==='PENDING');
    if(active)return this.intentResponse(active);
    const now=getCurrentUtcIsoString();
    const intent={
      id:generateCanonicalId('mpay'),order_id:order.id,provider_id:provider.id,provider_key:provider.provider_key,
      idempotency_key:key,provider_payment_id:null,client_reference:order.order_number,
      amount_minor:order.total_minor,currency:order.currency,status:'PENDING' as const,failure_code:null,failure_message:null,
      created_by:actor.user_id,created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createIntent(intent);
      getDatabase().prepare("UPDATE marketplace_orders SET payment_status='PENDING',updated_at=? WHERE id=?").run(now,order.id);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.payment.intent.created',producer:'garage-os-marketplace-payments',correlation_id:intent.id,
        subject_ids:{marketplace_order:order.id,marketplace_payment_intent:intent.id,marketplace_store:order.store_id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{payment_intent_id:intent.id,order_id:order.id,provider_key:provider.provider_key,amount_minor:intent.amount_minor,
          currency:intent.currency,status:'PENDING',payment_captured:false}
      }),db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PAYMENT_INTENT_CREATED',
        resource_type:'marketplace_payment_intent',resource_id:intent.id,correlation_id:intent.id,source:'MARKETPLACE_PAYMENT_API',
        after_state:{order_id:order.id,provider_key:provider.provider_key,amount_minor:intent.amount_minor,currency:intent.currency,status:intent.status}},db);
    });
    return this.intentResponse(intent);
  }

  getBuyerOrderFinance(actor:AuthenticatedActorContext,orderId:string){
    const order=this.requireBuyerOrder(actor,orderId);
    return {financial:repo.financialSummary(order.id),payment_intents:repo.listOrderIntents(order.id),refunds:repo.listOrderRefunds(order.id)};
  }

  requestRefund(actor:AuthenticatedActorContext,orderId:string,input:any,idempotencyKey:unknown){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    const platformFinance=this.hasFinanceRole(actor);
    const isBuyer=order.buyer_user_id===actor.user_id;
    if(!isBuyer&&!platformFinance){
      const store=getDatabase().prepare('SELECT organization_id FROM marketplace_stores WHERE id=?').get(order.store_id) as any;
      if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
      assertAuthorized(actor,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE,{organizationId:String(store.organization_id)});
    }
    if(isBuyer){
      const fulfillment=getDatabase().prepare('SELECT status FROM marketplace_fulfillments WHERE order_id=? LIMIT 1').get(order.id) as any;
      if(fulfillment){
        throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Once physical fulfillment has started, buyer refunds must use the return workflow',409);
      }
    }
    const key=idempotency(idempotencyKey);
    const existing=repo.getRefundByIdempotency(order.id,key);
    if(existing)return {refund:existing,provider_action_required:existing.status==='REQUESTED'};
    const financial=repo.financialSummary(order.id);
    if(financial.captured_minor<=0)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'No captured payment is available to refund',409);
    const intent=repo.listOrderIntents(order.id).find(x=>['SUCCEEDED','PARTIALLY_REFUNDED'].includes(x.status));
    if(!intent)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'No refundable payment intent exists',409);
    const provider=repo.getProvider(intent.provider_id);
    if(!provider?.supports_refunds)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Payment provider does not support refunds',409);
    const pendingRow=getDatabase().prepare(
      "SELECT COALESCE(SUM(amount_minor),0) total FROM marketplace_refunds WHERE order_id=? AND status IN ('REQUESTED','PENDING')"
    ).get(order.id) as any;
    const refundable=financial.captured_minor-financial.refunded_minor-Number(pendingRow?.total||0);
    const amount=money(input.amount_minor,'amount_minor');
    if(amount>refundable)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Refund amount exceeds currently refundable amount',409);
    const now=getCurrentUtcIsoString();
    const refund:MarketplaceRefund={
      id:generateCanonicalId('mrefund'),order_id:order.id,payment_intent_id:intent.id,idempotency_key:key,
      provider_refund_id:null,amount_minor:amount,currency:order.currency,reason:requiredText(input.reason,'reason',500),
      status:'REQUESTED',requested_by:actor.user_id,requested_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createRefund(refund);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.refund.requested',producer:'garage-os-marketplace-payments',correlation_id:refund.id,
        subject_ids:{marketplace_order:order.id,marketplace_payment_intent:intent.id,marketplace_refund:refund.id,marketplace_store:order.store_id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{refund_id:refund.id,order_id:order.id,amount_minor:refund.amount_minor,currency:refund.currency,
          status:refund.status,refund_confirmed:false}
      }),db);
    });
    return {refund,provider_action_required:true,truth:{refund_confirmed:false,inventory_restored:false}};
  }

  processWebhook(providerKeyInput:string,signature:string,input:ProviderWebhookInput){
    const provider=repo.getProviderByKey(providerKey(providerKeyInput));
    if(!provider||provider.status==='RETIRED')throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Payment provider not found',404);
    const secret=process.env[provider.webhook_secret_env];
    if(!secret)throw new CanonicalAppError(ErrorCode.DEPENDENCY_UNAVAILABLE,'Payment provider webhook secret is not configured',503);
    const supplied=String(signature||'').trim().replace(/^sha256=/i,'');
    const expected=createHmac('sha256',secret).update(canonicalWebhook(input)).digest('hex');
    if(!supplied||!secureEqual(supplied,expected))throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Invalid payment provider signature',401);
    const prior=repo.getProviderEvent(provider.id,input.provider_event_id);
    if(prior)return {duplicate:true,event:prior,financial:prior.payment_intent_id?repo.financialSummary(repo.getIntent(prior.payment_intent_id)!.order_id):null};

    const now=getCurrentUtcIsoString();
    const payloadHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const intent=repo.getIntentByProviderPayment(provider.id,input.provider_payment_id)||
      repo.getIntentForProviderOrder(provider.id,input.order_id);
    if(!intent){
      const event=this.recordRejectedEvent(provider.id,input,payloadHash,'UNKNOWN_PAYMENT_INTENT',null,null,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpayissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        order_id:input.order_id||null,payment_intent_id:null,issue_type:'UNKNOWN_PAYMENT_INTENT',details:'Verified provider event could not be matched to an intent',created_at:now});
      return {duplicate:false,event,financial:null};
    }
    const isPaymentEvent=input.event_type.startsWith('PAYMENT_');
    if(intent.order_id!==input.order_id||intent.currency!==String(input.currency||'').toUpperCase()||(isPaymentEvent&&intent.amount_minor!==Number(input.amount_minor))){
      const event=this.recordRejectedEvent(provider.id,input,payloadHash,'AMOUNT_CURRENCY_OR_ORDER_MISMATCH',intent.id,null,now);
      repo.createReconciliationIssue({id:generateCanonicalId('mpayissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
        order_id:input.order_id,payment_intent_id:intent.id,issue_type:'PAYMENT_FACT_MISMATCH',
        details:'Provider event order/amount/currency did not match the payment intent',created_at:now});
      return {duplicate:false,event,financial:repo.financialSummary(intent.order_id)};
    }
    if(intent.provider_payment_id&&intent.provider_payment_id!==input.provider_payment_id){
      const event=this.recordRejectedEvent(provider.id,input,payloadHash,'PROVIDER_PAYMENT_ID_MISMATCH',intent.id,null,now);
      return {duplicate:false,event,financial:repo.financialSummary(intent.order_id)};
    }

    let refund:MarketplaceRefund|null=null;
    if(input.event_type.startsWith('REFUND_')){
      if(!input.refund_id){
        const event=this.recordRejectedEvent(provider.id,input,payloadHash,'REFUND_ID_REQUIRED',intent.id,null,now);
        return {duplicate:false,event,financial:repo.financialSummary(intent.order_id)};
      }
      refund=repo.getRefund(input.refund_id);
      if(!refund||refund.payment_intent_id!==intent.id||refund.amount_minor!==Number(input.amount_minor)){
        const event=this.recordRejectedEvent(provider.id,input,payloadHash,'REFUND_MISMATCH',intent.id,refund?.id||null,now);
        repo.createReconciliationIssue({id:generateCanonicalId('mpayissue'),provider_id:provider.id,provider_event_id:input.provider_event_id,
          order_id:intent.order_id,payment_intent_id:intent.id,issue_type:'REFUND_MISMATCH',
          details:'Verified refund event did not match the requested refund facts',created_at:now});
        return {duplicate:false,event,financial:repo.financialSummary(intent.order_id)};
      }
    }

    let processedMessage='Processed';
    withTransaction(({db})=>{
      const bound={...intent,provider_payment_id:intent.provider_payment_id||input.provider_payment_id,updated_at:now};
      const beforeFinancial=repo.financialSummary(intent.order_id);
      if(input.event_type==='PAYMENT_PENDING'){
        if(beforeFinancial.captured_minor>0)processedMessage='Ignored after authoritative capture';
        else repo.updateIntent({...bound,status:'PENDING'});
      }else if(input.event_type==='PAYMENT_FAILED'){
        if(beforeFinancial.captured_minor>0)processedMessage='Ignored after authoritative capture';
        else repo.updateIntent({...bound,status:'FAILED',failure_code:input.failure_code||'PROVIDER_DECLINED',
          failure_message:input.failure_message||'Payment provider reported failure'});
      }else if(input.event_type==='PAYMENT_SUCCEEDED'){
        repo.updateIntent({...bound,status:'SUCCEEDED',failure_code:null,failure_message:null});
        const order=marketplaceTransactionRepository.getOrder(intent.order_id)!;
        repo.createSettlementEntry({id:generateCanonicalId('msettle'),store_id:order.store_id,order_id:order.id,payment_intent_id:intent.id,
          refund_id:null,entry_type:'PAYMENT_CAPTURE',amount_minor:intent.amount_minor,currency:intent.currency,created_at:now});
        const reservations=getDatabase().prepare("SELECT id FROM marketplace_inventory_reservations WHERE order_id=? AND status='HELD'").all(order.id) as any[];
        for(const reservation of reservations){
          getDatabase().prepare(`
            INSERT OR IGNORE INTO marketplace_inventory_commitments
            (id,reservation_id,order_id,payment_intent_id,committed_at) VALUES (?,?,?,?,?)
          `).run(generateCanonicalId('micommit'),String(reservation.id),order.id,intent.id,now);
        }
      }else if(refund&&input.event_type==='REFUND_PENDING'){
        repo.updateRefund({...refund,provider_refund_id:input.provider_refund_id||refund.provider_refund_id,status:'PENDING',updated_at:now});
      }else if(refund&&input.event_type==='REFUND_FAILED'){
        repo.updateRefund({...refund,provider_refund_id:input.provider_refund_id||refund.provider_refund_id,status:'FAILED',updated_at:now});
      }else if(refund&&input.event_type==='REFUND_SUCCEEDED'){
        repo.updateRefund({...refund,provider_refund_id:input.provider_refund_id||refund.provider_refund_id,status:'SUCCEEDED',updated_at:now});
        const order=marketplaceTransactionRepository.getOrder(intent.order_id)!;
        repo.createSettlementEntry({id:generateCanonicalId('msettle'),store_id:order.store_id,order_id:order.id,payment_intent_id:intent.id,
          refund_id:refund.id,entry_type:'REFUND_ADJUSTMENT',amount_minor:-refund.amount_minor,currency:refund.currency,created_at:now});
        const refundTotal=Number((getDatabase().prepare(
          "SELECT COALESCE(SUM(amount_minor),0) total FROM marketplace_refunds WHERE payment_intent_id=? AND status='SUCCEEDED'"
        ).get(intent.id) as any)?.total||0);
        repo.updateIntent({...bound,status:refundTotal>=intent.amount_minor?'REFUNDED':'PARTIALLY_REFUNDED'});

        const linkedReturn=getDatabase().prepare(
          "SELECT id,fulfillment_id,order_id,store_id FROM marketplace_returns WHERE refund_id=? AND status='REFUND_REQUESTED' LIMIT 1"
        ).get(refund.id) as any;
        if(linkedReturn){
          getDatabase().prepare(
            "UPDATE marketplace_returns SET status='COMPLETED',completed_at=?,updated_at=? WHERE id=?"
          ).run(now,now,String(linkedReturn.id));
          const orderUnits=Number((getDatabase().prepare(
            'SELECT COALESCE(SUM(quantity),0) total FROM marketplace_order_items WHERE order_id=?'
          ).get(String(linkedReturn.order_id)) as any)?.total||0);
          const returnedUnits=Number((getDatabase().prepare(`
            SELECT COALESCE(SUM(ri.received_quantity),0) total
            FROM marketplace_return_items ri
            JOIN marketplace_returns r ON r.id=ri.return_id
            WHERE r.order_id=? AND r.status='COMPLETED'
          `).get(String(linkedReturn.order_id)) as any)?.total||0);
          const fulfillmentStatus=orderUnits>0&&returnedUnits>=orderUnits?'RETURNED':'COMPLETED';
          getDatabase().prepare(
            'UPDATE marketplace_fulfillments SET status=?,updated_at=? WHERE id=?'
          ).run(fulfillmentStatus,now,String(linkedReturn.fulfillment_id));
          getDatabase().prepare(`
            INSERT INTO marketplace_fulfillment_events
            (id,fulfillment_id,order_id,event_type,source_type,actor_id,details_json,occurred_at)
            VALUES (?,?,?,?,?,?,?,?)
          `).run(generateCanonicalId('mfevt'),String(linkedReturn.fulfillment_id),String(linkedReturn.order_id),
            'RETURN_REFUND_CONFIRMED','SYSTEM_DERIVED','payment-provider:'+provider.provider_key,
            JSON.stringify({return_id:String(linkedReturn.id),refund_id:refund.id,amount_minor:refund.amount_minor,
              fulfillment_status:fulfillmentStatus}),now);
          enqueueOutboxEvent(createCanonicalEventEnvelope({
            type:'marketplace.return.completed',producer:'garage-os-marketplace-payments',correlation_id:String(linkedReturn.id),
            subject_ids:{marketplace_order:String(linkedReturn.order_id),marketplace_store:String(linkedReturn.store_id),
              marketplace_return:String(linkedReturn.id),marketplace_refund:refund.id},
            actor_id:'payment-provider:'+provider.provider_key,actor_type:CanonicalActorType.SYSTEM_WORKER,
            provenance_class:DataProvenanceClass.EXTERNALLY_VERIFIED,
            payload:{return_id:String(linkedReturn.id),refund_id:refund.id,refund_confirmed:true,
              fulfillment_status:fulfillmentStatus}
          }),db);
        }
      }else{
        processedMessage='Event type ignored';
      }

      const event:MarketplaceProviderEvent={
        id:generateCanonicalId('mpayevt'),provider_id:provider.id,provider_event_id:input.provider_event_id,event_type:input.event_type,
        payment_intent_id:intent.id,refund_id:refund?.id||null,signature_verified:true,payload_hash:payloadHash,
        processing_status:processedMessage==='Processed'?'PROCESSED':'IGNORED',processing_message:processedMessage,
        occurred_at:requiredText(input.occurred_at,'occurred_at',80),processed_at:now
      };
      repo.createProviderEvent(event);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:this.domainEventType(input.event_type),producer:'garage-os-marketplace-payments',correlation_id:event.id,
        subject_ids:{marketplace_order:intent.order_id,marketplace_payment_intent:intent.id,...(refund?{marketplace_refund:refund.id}:{})},
        actor_id:'payment-provider:'+provider.provider_key,actor_type:CanonicalActorType.SYSTEM_WORKER,
        provenance_class:DataProvenanceClass.EXTERNALLY_VERIFIED,
        payload:{provider_key:provider.provider_key,provider_event_id:input.provider_event_id,event_type:input.event_type,
          order_id:intent.order_id,payment_intent_id:intent.id,refund_id:refund?.id||null,amount_minor:Number(input.amount_minor),
          currency:String(input.currency).toUpperCase(),signature_verified:true}
      }),db);
      recordAuditEvent({actor_id:'payment-provider:'+provider.provider_key,actor_type:CanonicalActorType.SYSTEM_WORKER,
        action:'MARKETPLACE_PAYMENT_PROVIDER_EVENT_PROCESSED',resource_type:'marketplace_payment_provider_event',resource_id:event.id,
        correlation_id:event.id,source:'MARKETPLACE_PAYMENT_WEBHOOK',after_state:{event_type:event.event_type,provider_event_id:event.provider_event_id,
          payment_intent_id:intent.id,refund_id:refund?.id||null,signature_verified:true,processing_status:event.processing_status}},db);
    });

    const event=repo.getProviderEvent(provider.id,input.provider_event_id)!;
    return {duplicate:false,event,financial:repo.financialSummary(intent.order_id)};
  }

  sellerSettlement(actor:AuthenticatedActorContext,storeId:string){
    const store=getDatabase().prepare('SELECT organization_id FROM marketplace_stores WHERE id=?').get(storeId) as any;
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    if(!this.hasFinanceRole(actor)){
      assertAuthorized(actor,CanonicalPermission.MARKETPLACE_ORDERS_READ,{organizationId:String(store.organization_id)});
    }
    return {summaries:repo.settlementSummary(storeId),entries:repo.listSettlementEntries(storeId),
      truth:{payout_available:false,settlement_ledger_authoritative:true,bank_transfer_executed:false}};
  }

  reconciliation(actor:AuthenticatedActorContext){
    this.requireFinanceRole(actor);
    return {events:repo.listProviderEvents(100),issues:repo.listReconciliationIssues(100)};
  }

  private intentResponse(intent:any){
    return {intent,provider_action:{type:'EXTERNAL_PROVIDER_HANDOFF_REQUIRED',client_reference:intent.client_reference},
      truth:{payment_captured:repo.financialSummary(intent.order_id).captured_minor>0,client_cannot_mark_paid:true}};
  }
  private requireBuyerOrder(actor:AuthenticatedActorContext,orderId:string){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    return order;
  }
  private hasFinanceRole(actor:AuthenticatedActorContext){
    return actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)||actor.platform_roles?.includes(PlatformRole.FINANCE_OPERATOR);
  }
  private requireFinanceRole(actor:AuthenticatedActorContext){
    if(!this.hasFinanceRole(actor))throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform finance role required',403);
  }
  private recordRejectedEvent(providerId:string,input:ProviderWebhookInput,payloadHash:string,message:string,intentId:string|null,refundId:string|null,now:string){
    const event:MarketplaceProviderEvent={id:generateCanonicalId('mpayevt'),provider_id:providerId,provider_event_id:input.provider_event_id,
      event_type:input.event_type,payment_intent_id:intentId,refund_id:refundId,signature_verified:true,payload_hash:payloadHash,
      processing_status:'REJECTED',processing_message:message,occurred_at:String(input.occurred_at||now),processed_at:now};
    repo.createProviderEvent(event);return event;
  }
  private domainEventType(type:MarketplaceProviderEventType){
    if(type==='PAYMENT_SUCCEEDED')return 'marketplace.payment.captured';
    if(type==='PAYMENT_FAILED')return 'marketplace.payment.failed';
    if(type==='PAYMENT_PENDING')return 'marketplace.payment.pending';
    if(type==='REFUND_SUCCEEDED')return 'marketplace.refund.confirmed';
    if(type==='REFUND_FAILED')return 'marketplace.refund.failed';
    return 'marketplace.refund.pending';
  }
}

export const marketplacePaymentService=new MarketplacePaymentService();
