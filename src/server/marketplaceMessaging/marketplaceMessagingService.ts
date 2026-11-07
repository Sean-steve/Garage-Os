import { AuthenticatedActorContext } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { withTransaction } from '../database/transaction';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { marketplaceMessagingRepository as repo } from './marketplaceMessagingRepository';
import { marketplaceNotificationAdapterRegistry } from './notificationAdapter';
import {
  MarketplaceCommunicationPreferences, MarketplaceConversation, MarketplaceConversationContext,
  MarketplaceExternalChannel, MarketplaceExternalDelivery, MarketplaceMessageClassification,
  MarketplaceNotification, MarketplaceNotificationState
} from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{return actor.type||CanonicalActorType.VEHICLE_OWNER;}
function required(value:unknown,field:string,max:number){
  const v=String(value||'').trim();
  if(!v)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is required',400);
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is too long',400);
  return v;
}
function bool(value:unknown,current:boolean){return value===undefined?current:Boolean(value);}
function hhmm(value:unknown,field:string):string|null{
  if(value===undefined||value===null||value==='')return null;
  const v=String(value);
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be HH:MM',400);
  return v;
}
function timezone(value:unknown,current:string){
  const v=String(value||current||'UTC').trim();
  try{new Intl.DateTimeFormat('en-GB',{timeZone:v}).format(new Date());return v;}
  catch{throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'timezone must be a valid IANA timezone',400);}
}
function localTime(tz:string){
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());
  const h=parts.find(x=>x.type==='hour')?.value||'00',m=parts.find(x=>x.type==='minute')?.value||'00';
  return h+':'+m;
}
function quiet(p:MarketplaceCommunicationPreferences){
  if(!p.quiet_hours_start||!p.quiet_hours_end)return false;
  if(p.quiet_hours_start===p.quiet_hours_end)return true;
  const t=localTime(p.timezone);
  return p.quiet_hours_start<p.quiet_hours_end
    ?t>=p.quiet_hours_start&&t<p.quiet_hours_end
    :t>=p.quiet_hours_start||t<p.quiet_hours_end;
}

export class MarketplaceMessagingService{
  getPreferences(actor:AuthenticatedActorContext){
    const p=repo.getPreferences(actor.user_id)||this.defaultPreferences(actor);
    return {preferences:p,truth:{
      preference_is_not_delivery:true, promotional_consent_must_be_explicit:true,
      external_delivery_requires_registered_adapter:true
    }};
  }
  updatePreferences(actor:AuthenticatedActorContext,input:any){
    const current=repo.getPreferences(actor.user_id)||this.defaultPreferences(actor);
    const start=input?.quiet_hours_start===undefined?current.quiet_hours_start:hhmm(input.quiet_hours_start,'quiet_hours_start');
    const end=input?.quiet_hours_end===undefined?current.quiet_hours_end:hhmm(input.quiet_hours_end,'quiet_hours_end');
    if((start===null)!==(end===null))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'quiet hours require both start and end',400);
    const next:MarketplaceCommunicationPreferences={
      user_id:actor.user_id,
      transactional_email_requested:bool(input?.transactional_email_requested,current.transactional_email_requested),
      transactional_sms_requested:bool(input?.transactional_sms_requested,current.transactional_sms_requested),
      transactional_push_requested:bool(input?.transactional_push_requested,current.transactional_push_requested),
      promotional_in_app_enabled:bool(input?.promotional_in_app_enabled,current.promotional_in_app_enabled),
      promotional_email_opt_in:bool(input?.promotional_email_opt_in,current.promotional_email_opt_in),
      promotional_sms_opt_in:bool(input?.promotional_sms_opt_in,current.promotional_sms_opt_in),
      promotional_push_opt_in:bool(input?.promotional_push_opt_in,current.promotional_push_opt_in),
      quiet_hours_start:start,quiet_hours_end:end,timezone:timezone(input?.timezone,current.timezone),updated_at:getCurrentUtcIsoString()
    };
    repo.upsertPreferences(next);
    this.audit(actor,'MARKETPLACE_COMMUNICATION_PREFERENCES_UPDATED','marketplace_communication_preferences',actor.user_id,{
      promotional_in_app_enabled:next.promotional_in_app_enabled,promotional_email_opt_in:next.promotional_email_opt_in,
      promotional_sms_opt_in:next.promotional_sms_opt_in,promotional_push_opt_in:next.promotional_push_opt_in,
      quiet_hours_enabled:Boolean(start&&end)
    });
    return {preferences:next,truth:{seller_cannot_infer_consent:true,requested_channel_is_not_delivery:true}};
  }

  createConversation(actor:AuthenticatedActorContext,input:any){
    const contextType=String(input?.context_type||'').toUpperCase() as MarketplaceConversationContext;
    if(!['LISTING_INQUIRY','ORDER','RETURN','DISPUTE'].includes(contextType))
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid conversation context',400);
    const contextId=required(input?.context_id,'context_id',128);
    let storeId='',buyerId='',listingId:null|string=null,orderId:null|string=null,returnId:null|string=null,disputeId:null|string=null;
    let defaultSubject='';
    if(contextType==='LISTING_INQUIRY'){
      const x=repo.getListingContext(contextId);
      if(!x||x.status!=='PUBLISHED'||x.store_status!=='ACTIVE')throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Published listing not found',404);
      storeId=String(x.store_id);buyerId=actor.user_id;listingId=String(x.id);defaultSubject='Inquiry: '+String(x.title);
    }else if(contextType==='ORDER'){
      const x=repo.getOrderContext(contextId);if(!x)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
      storeId=String(x.store_id);buyerId=String(x.buyer_user_id);orderId=String(x.id);defaultSubject='Order '+String(x.order_number);
      this.assertParty(actor,storeId,buyerId,false);
    }else if(contextType==='RETURN'){
      const x=repo.getReturnContext(contextId);if(!x)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Return not found',404);
      storeId=String(x.store_id);buyerId=String(x.buyer_user_id);orderId=String(x.order_id);returnId=String(x.id);defaultSubject='Return '+String(x.return_number);
      this.assertParty(actor,storeId,buyerId,false);
    }else{
      const x=repo.getDisputeContext(contextId);if(!x)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
      storeId=String(x.store_id);buyerId=String(x.buyer_user_id);orderId=String(x.order_id);disputeId=String(x.id);defaultSubject='Dispute '+String(x.dispute_number);
      this.assertParty(actor,storeId,buyerId,false);
    }
    const existing=repo.findOpenConversation(buyerId,contextType,contextId);
    if(existing)return {conversation:existing,created:false};
    const now=getCurrentUtcIsoString();
    const c:MarketplaceConversation={id:generateCanonicalId('mconv'),store_id:storeId,buyer_user_id:buyerId,context_type:contextType,
      listing_id:listingId,order_id:orderId,return_id:returnId,dispute_id:disputeId,
      subject:input?.subject?required(input.subject,'subject',160):defaultSubject,status:'OPEN',created_by:actor.user_id,
      created_at:now,updated_at:now,last_message_at:null};
    withTransaction(({db})=>{
      repo.createConversation(c);
      this.emit(actor,'marketplace.communication.conversation.created',c.id,{marketplace_conversation:c.id,marketplace_store:storeId},
        {conversation_id:c.id,context_type:c.context_type,classification:'TRANSACTIONAL'},db);
      this.audit(actor,'MARKETPLACE_CONVERSATION_CREATED','marketplace_conversation',c.id,{store_id:storeId,context_type:c.context_type},db);
    });
    return {conversation:c,created:true};
  }

  listBuyerConversations(actor:AuthenticatedActorContext){return repo.listBuyerConversations(actor.user_id);}
  listSellerConversations(actor:AuthenticatedActorContext,storeId:string){
    this.assertSeller(actor,storeId,false);return repo.listStoreConversations(storeId);
  }
  getConversation(actor:AuthenticatedActorContext,id:string){
    const c=this.authorizedConversation(actor,id,false);
    return {conversation:c,messages:repo.listMessages(id)};
  }
  updateConversation(actor:AuthenticatedActorContext,id:string,input:any){
    const c=this.authorizedConversation(actor,id,true);
    const status=String(input?.status||'').toUpperCase();
    if(!['OPEN','CLOSED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'status must be OPEN or CLOSED',400);
    repo.updateConversationState(c.id,status,getCurrentUtcIsoString());
    return this.getConversation(actor,id);
  }

  sendMessage(actor:AuthenticatedActorContext,id:string,input:any){
    const c=this.authorizedConversation(actor,id,true);
    if(c.status!=='OPEN')throw new CanonicalAppError(ErrorCode.INVALID_STATE,'Conversation is closed',409);
    const senderRole=actor.user_id===c.buyer_user_id?'BUYER':'SELLER';
    const classification=String(input?.classification||'TRANSACTIONAL').toUpperCase() as MarketplaceMessageClassification;
    if(!['TRANSACTIONAL','PROMOTIONAL'].includes(classification))
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid message classification',400);
    if(senderRole==='BUYER'&&classification==='PROMOTIONAL')
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Buyer messages cannot be classified as seller promotion',422);
    const prefs=repo.getPreferences(c.buyer_user_id)||this.defaultPreferencesForUser(c.buyer_user_id,'UTC');
    if(senderRole==='SELLER'&&classification==='PROMOTIONAL'){
      if(c.context_type==='LISTING_INQUIRY')
        throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Promotional outreach requires an existing transaction relationship',422);
      if(!prefs.promotional_in_app_enabled)
        throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Buyer has not opted in to seller promotional in-app messages',422);
      if(quiet(prefs))throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Buyer promotional quiet hours are active',422);
    }
    const body=required(input?.body,'body',4000),now=getCurrentUtcIsoString();
    const m={id:generateCanonicalId('mmsg'),conversation_id:c.id,sender_user_id:actor.user_id,sender_role:senderRole,
      classification,body,created_at:now} as const;
    const n:MarketplaceNotification={id:generateCanonicalId('mnote'),
      recipient_type:senderRole==='BUYER'?'SELLER_STORE':'BUYER_USER',
      recipient_id:senderRole==='BUYER'?c.store_id:c.buyer_user_id,conversation_id:c.id,message_id:m.id,
      classification,title:classification==='PROMOTIONAL'?'Seller message':'New marketplace message',
      body:body.length>180?body.slice(0,177)+'...':body,state:'UNREAD',created_at:now,read_at:null,dismissed_at:null};
    withTransaction(({db})=>{
      repo.createMessage(m as any);repo.touchConversation(c.id,now);repo.createNotification(n);
      this.emit(actor,'marketplace.communication.message.sent',m.id,{marketplace_conversation:c.id,marketplace_message:m.id},
        {message_id:m.id,conversation_id:c.id,sender_role:senderRole,classification,in_app_notification_id:n.id},db);
      this.audit(actor,'MARKETPLACE_MESSAGE_SENT','marketplace_message',m.id,{conversation_id:c.id,sender_role:senderRole,classification},db);
    });
    return {message:m,notification:n,truth:{in_app_persisted:true,external_delivery_attempted:false,classification_explicit:true}};
  }

  listBuyerNotifications(actor:AuthenticatedActorContext){return repo.listBuyerNotifications(actor.user_id);}
  listSellerNotifications(actor:AuthenticatedActorContext,storeId:string){this.assertSeller(actor,storeId,false);return repo.listStoreNotifications(storeId);}
  updateBuyerNotification(actor:AuthenticatedActorContext,id:string,state:MarketplaceNotificationState){
    if(!['READ','DISMISSED'].includes(state))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'state must be READ or DISMISSED',400);
    const n=repo.getNotification(id);
    if(!n||n.recipient_type!=='BUYER_USER'||n.recipient_id!==actor.user_id)
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Notification not found',404);
    const now=getCurrentUtcIsoString();
    return repo.updateNotification({...n,state,read_at:state==='READ'?(n.read_at||now):n.read_at,dismissed_at:state==='DISMISSED'?now:n.dismissed_at});
  }
  updateSellerNotification(actor:AuthenticatedActorContext,storeId:string,id:string,state:MarketplaceNotificationState){
    this.assertSeller(actor,storeId,false);
    if(!['READ','DISMISSED'].includes(state))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'state must be READ or DISMISSED',400);
    const n=repo.getNotification(id);
    if(!n||n.recipient_type!=='SELLER_STORE'||n.recipient_id!==storeId)
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Notification not found',404);
    const now=getCurrentUtcIsoString();
    return repo.updateNotification({...n,state,read_at:state==='READ'?(n.read_at||now):n.read_at,dismissed_at:state==='DISMISSED'?now:n.dismissed_at});
  }

  sellerCrm(actor:AuthenticatedActorContext,storeId:string){
    this.assertSeller(actor,storeId,false);
    return {store_id:storeId,relationships:repo.crm(storeId),truth:{
      source:'MARKETPLACE_ORDERS_AND_CONVERSATIONS',hidden_browsing_or_search_profile_used:false,
      opaque_customer_score_present:false,buyer_contact_details_exposed:false,
      ordered_value_is_not_payment_or_revenue_truth:true,automatic_outreach_available:false
    }};
  }

  adapterCapabilities(){
    return {registered_adapters:marketplaceNotificationAdapterRegistry.list(),truth:{
      requested_channel_is_not_attempted:true,attempted_is_not_delivered:true,
      provider_confirmed_delivery_required:true,live_adapter_activation_deferred_to_sprint_40:true
    }};
  }

  dispatchExternalNotificationInternal(notificationId:string,channel:MarketplaceExternalChannel,providerKey:string,recipientReference:string){
    const n=repo.getNotification(notificationId);if(!n)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Notification not found',404);
    if(n.recipient_type!=='BUYER_USER')return {attempted:false,reason:'SELLER_EXTERNAL_DELIVERY_NOT_CONFIGURED'};
    const p=repo.getPreferences(n.recipient_id)||this.defaultPreferencesForUser(n.recipient_id,'UTC');
    const requested=n.classification==='PROMOTIONAL'
      ?(channel==='EMAIL'?p.promotional_email_opt_in:channel==='SMS'?p.promotional_sms_opt_in:p.promotional_push_opt_in)
      :(channel==='EMAIL'?p.transactional_email_requested:channel==='SMS'?p.transactional_sms_requested:p.transactional_push_requested);
    if(!requested)return {attempted:false,reason:n.classification==='PROMOTIONAL'?'NO_EXPLICIT_PROMOTIONAL_OPT_IN':'CHANNEL_NOT_REQUESTED'};
    if(n.classification==='PROMOTIONAL'&&quiet(p))return {attempted:false,reason:'QUIET_HOURS_ACTIVE'};
    const adapter=marketplaceNotificationAdapterRegistry.get(providerKey,channel);
    if(!adapter)return {attempted:false,reason:'ADAPTER_NOT_CONFIGURED'};
    const now=getCurrentUtcIsoString();
    let d:MarketplaceExternalDelivery={id:generateCanonicalId('mdel'),notification_id:n.id,channel,provider_key:providerKey.toUpperCase(),
      provider_message_id:null,state:'ATTEMPTED',attempt_count:1,attempted_at:now,accepted_at:null,delivered_at:null,failed_at:null,
      bounced_at:null,failure_code:null,failure_message:null,updated_at:now};
    repo.createDelivery(d);
    try{
      const result=adapter.attempt({notification_id:n.id,channel,recipient_reference:recipientReference,title:n.title,body:n.body,classification:n.classification});
      d={...d,provider_message_id:result.provider_message_id||null,state:result.accepted?'ACCEPTED':'FAILED',
        accepted_at:result.accepted?getCurrentUtcIsoString():null,failed_at:result.accepted?null:getCurrentUtcIsoString(),
        failure_code:result.failure_code||null,failure_message:result.failure_message||null,updated_at:getCurrentUtcIsoString()};
    }catch(err){
      d={...d,state:'FAILED',failed_at:getCurrentUtcIsoString(),failure_code:'ADAPTER_ERROR',
        failure_message:err instanceof Error?err.message:'Adapter error',updated_at:getCurrentUtcIsoString()};
    }
    repo.updateDelivery(d);
    return {attempted:true,delivery:d,truth:{recipient_reference_persisted:false,accepted_is_not_delivered:true}};
  }

  processVerifiedProviderEventInternal(providerKey:string,channel:MarketplaceExternalChannel,signature:string,payload:unknown){
    const adapter=marketplaceNotificationAdapterRegistry.get(providerKey,channel);
    if(!adapter)throw new CanonicalAppError(ErrorCode.DEPENDENCY_UNAVAILABLE,'Notification adapter not configured',503);
    const event=adapter.verifyEvent(signature,payload);
    if(!event.verified)throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Provider event signature verification failed',401);
    if(repo.hasDeliveryEvent(providerKey,event.provider_event_id))return {duplicate:true};
    const d=repo.findDelivery(providerKey,event.provider_message_id);
    if(!d)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Provider delivery reference not found',404);
    const now=getCurrentUtcIsoString();
    const next:MarketplaceExternalDelivery={...d,state:event.state,delivered_at:event.state==='DELIVERED'?event.occurred_at:d.delivered_at,
      failed_at:event.state==='FAILED'?event.occurred_at:d.failed_at,bounced_at:event.state==='BOUNCED'?event.occurred_at:d.bounced_at,
      failure_code:event.failure_code||d.failure_code,failure_message:event.failure_message||d.failure_message,updated_at:now};
    withTransaction(()=>{
      repo.createDeliveryEvent({id:generateCanonicalId('mdevent'),provider_key:providerKey,provider_event_id:event.provider_event_id,
        delivery_id:d.id,event_state:event.state,occurred_at:event.occurred_at,processed_at:now});
      repo.updateDelivery(next);
    });
    return {duplicate:false,delivery:next,truth:{provider_event_verified:true,provider_event_authoritative:true}};
  }

  private defaultPreferences(actor:AuthenticatedActorContext){return this.defaultPreferencesForUser(actor.user_id,actor.profile?.timezone||'UTC');}
  private defaultPreferencesForUser(userId:string,tz:string):MarketplaceCommunicationPreferences{
    return {user_id:userId,transactional_email_requested:false,transactional_sms_requested:false,transactional_push_requested:false,
      promotional_in_app_enabled:false,promotional_email_opt_in:false,promotional_sms_opt_in:false,promotional_push_opt_in:false,
      quiet_hours_start:null,quiet_hours_end:null,timezone:tz||'UTC',updated_at:getCurrentUtcIsoString()};
  }
  private assertSeller(actor:AuthenticatedActorContext,storeId:string,manage:boolean){
    const store=marketplaceRepository.getStoreById(storeId);if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,manage?CanonicalPermission.MARKETPLACE_ORDERS_MANAGE:CanonicalPermission.MARKETPLACE_ORDERS_READ,{organizationId:store.organization_id});
  }
  private assertParty(actor:AuthenticatedActorContext,storeId:string,buyerId:string,manage:boolean){
    if(actor.user_id===buyerId)return 'BUYER';
    this.assertSeller(actor,storeId,manage);return 'SELLER';
  }
  private authorizedConversation(actor:AuthenticatedActorContext,id:string,manage:boolean){
    const c=repo.getConversation(id);if(!c)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Conversation not found',404);
    this.assertParty(actor,c.store_id,c.buyer_user_id,manage);return c;
  }
  private emit(actor:AuthenticatedActorContext,type:string,correlationId:string,subjects:Record<string,string>,payload:any,db?:any,
    provenance:DataProvenanceClass=DataProvenanceClass.OWNER_ASSERTED){
    enqueueOutboxEvent(createCanonicalEventEnvelope({type,producer:'garage-os-marketplace-messaging',correlation_id:correlationId,
      subject_ids:subjects,actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:provenance,payload}),db);
  }
  private audit(actor:AuthenticatedActorContext,action:string,resourceType:string,resourceId:string,after:any,db?:any){
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action,resource_type:resourceType,resource_id:resourceId,
      correlation_id:resourceId,source:'MARKETPLACE_MESSAGING_API',after_state:after},db);
  }
}
export const marketplaceMessagingService=new MarketplaceMessagingService();
