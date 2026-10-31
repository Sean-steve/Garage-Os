import { AuthenticatedActorContext } from '../identity/types';
import { CanonicalPermission } from '../identity/rbac';
import { assertAuthorized } from '../identity/policyEngine';
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
import { marketplacePaymentRepository } from '../marketplacePayments/marketplacePaymentRepository';
import { marketplaceTrustRepository as repo } from './marketplaceTrustRepository';
import {
  MarketplaceDispute, MarketplaceDisputeCategory, MarketplaceDisputeMessage,
  MarketplaceDisputeResolutionAction, MarketplaceReview, MarketplaceReviewReport
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
function optionalText(value:unknown,max:number):string|null{
  if(value===undefined||value===null)return null;
  const v=String(value).trim();return v?v.slice(0,max):null;
}
function rating(value:unknown):number{
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>5)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'rating must be an integer from 1 to 5',400);
  return n;
}

export class MarketplaceTrustService{
  getStoreTrust(storeId:string){
    const store=getDatabase().prepare('SELECT id,display_name,status FROM marketplace_stores WHERE id=? LIMIT 1').get(storeId) as any;
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    const reviews=repo.listPublishedReviews(storeId,100).map(r=>({review:r,response:repo.getResponse(r.id)}));
    return {store:{id:String(store.id),display_name:String(store.display_name),status:String(store.status)},
      summary:repo.trustSummary(storeId),reviews};
  }

  listMyReviews(actor:AuthenticatedActorContext){
    return repo.listBuyerReviews(actor.user_id).map(r=>({review:r,response:repo.getResponse(r.id)}));
  }

  createReview(actor:AuthenticatedActorContext,orderId:string,input:any){
    const order=this.requireBuyerOrder(actor,orderId);
    const fulfillment=getDatabase().prepare('SELECT status FROM marketplace_fulfillments WHERE order_id=? LIMIT 1').get(order.id) as any;
    if(!fulfillment||!['COMPLETED','RETURN_IN_PROGRESS','RETURNED'].includes(String(fulfillment.status))){
      throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Verified-purchase reviews require buyer-confirmed fulfillment completion',409);
    }
    const financial=marketplacePaymentRepository.financialSummary(order.id);
    if(financial.captured_minor<=0)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Verified-purchase review requires captured payment',409);

    const target=String(input?.target_type||'').toUpperCase();
    if(!['STORE','PRODUCT'].includes(target))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'target_type must be STORE or PRODUCT',400);
    let productId:string|null=null,orderItemId:string|null=null;
    if(target==='PRODUCT'){
      orderItemId=requiredText(input?.order_item_id,'order_item_id',120);
      const item=getDatabase().prepare('SELECT id,product_id FROM marketplace_order_items WHERE id=? AND order_id=? LIMIT 1')
        .get(orderItemId,order.id) as any;
      if(!item)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'order_item_id does not belong to this order',400);
      productId=String(item.product_id);
    }
    if(repo.findBuyerReview(target,order.id,productId))throw new CanonicalAppError(ErrorCode.CONFLICT,'A verified review already exists for this purchase target',409);
    const now=getCurrentUtcIsoString();
    const value:MarketplaceReview={
      id:generateCanonicalId('mreview'),target_type:target as any,store_id:order.store_id,product_id:productId,
      order_id:order.id,order_item_id:orderItemId,buyer_user_id:actor.user_id,rating:rating(input?.rating),
      title:optionalText(input?.title,160),body:optionalText(input?.body,4000),verified_purchase:true,status:'PUBLISHED',
      moderation_reason:null,created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createReview(value);
      this.emit(actor,'marketplace.review.created',value.id,
        {marketplace_review:value.id,marketplace_store:value.store_id,marketplace_order:value.order_id},
        {review_id:value.id,target_type:value.target_type,rating:value.rating,verified_purchase:true,status:value.status},db);
      this.audit(actor,'MARKETPLACE_REVIEW_CREATED','marketplace_review',value.id,{store_id:value.store_id,order_id:value.order_id,
        target_type:value.target_type,rating:value.rating,verified_purchase:true},db);
    });
    return {review:value,response:null};
  }

  updateMyReview(actor:AuthenticatedActorContext,reviewId:string,input:any){
    const current=repo.getReview(reviewId);
    if(!current||current.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Review not found',404);
    if(current.status!=='PUBLISHED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'A moderated review cannot be edited by the author',409);
    const next={...current,rating:input?.rating===undefined?current.rating:rating(input.rating),
      title:input?.title===undefined?current.title:optionalText(input.title,160),
      body:input?.body===undefined?current.body:optionalText(input.body,4000),updated_at:getCurrentUtcIsoString()};
    repo.updateReview(next);
    return {review:next,response:repo.getResponse(next.id)};
  }

  respondToReview(actor:AuthenticatedActorContext,storeId:string,reviewId:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const review=repo.getReview(reviewId);
    if(!review||review.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Review not found',404);
    if(review.status!=='PUBLISHED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only published reviews can receive a public seller response',409);
    const now=getCurrentUtcIsoString();
    const existing=repo.getResponse(review.id);
    const value={id:existing?.id||generateCanonicalId('mreviewresp'),review_id:review.id,store_id,
      responder_user_id:actor.user_id,body:requiredText(input?.body,'body',3000),status:'PUBLISHED' as const,
      created_at:existing?.created_at||now,updated_at:now};
    const saved=repo.upsertResponse(value);
    this.emit(actor,'marketplace.review.response.published',saved.id,{marketplace_review:review.id,marketplace_store:storeId},
      {review_id:review.id,response_id:saved.id},undefined);
    return saved;
  }

  reportReview(actor:AuthenticatedActorContext,storeId:string,reviewId:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const review=repo.getReview(reviewId);
    if(!review||review.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Review not found',404);
    const existing=getDatabase().prepare('SELECT id FROM marketplace_review_reports WHERE review_id=? AND reporter_user_id=?').get(review.id,actor.user_id) as any;
    if(existing)throw new CanonicalAppError(ErrorCode.CONFLICT,'This review has already been reported by this user',409);
    const now=getCurrentUtcIsoString();
    const value:MarketplaceReviewReport={id:generateCanonicalId('mreviewreport'),review_id:review.id,reporter_user_id:actor.user_id,
      reporter_store_id:storeId,reason:requiredText(input?.reason,'reason',2000),status:'OPEN',resolution_note:null,
      created_at:now,resolved_at:null};
    withTransaction(({db})=>{
      repo.createReport(value);
      repo.updateReview({...review,status:'UNDER_REVIEW',moderation_reason:'Seller report pending Trust & Safety review',updated_at:now});
      this.emit(actor,'marketplace.review.reported',value.id,{marketplace_review:review.id,marketplace_store:storeId},
        {review_id:review.id,report_id:value.id,status:'OPEN'},db);
    });
    return value;
  }

  listReviewModeration(actor:AuthenticatedActorContext){
    this.requireReviewModerator(actor);
    return {reports:repo.listOpenReports().map(r=>({report:r,review:repo.getReview(r.review_id)}))};
  }

  moderateReview(actor:AuthenticatedActorContext,reviewId:string,input:any){
    this.requireReviewModerator(actor);
    const review=repo.getReview(reviewId);
    if(!review)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Review not found',404);
    const action=String(input?.action||'').toUpperCase();
    if(!['PUBLISH','HIDE','REMOVE'].includes(action))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'action must be PUBLISH, HIDE or REMOVE',400);
    const now=getCurrentUtcIsoString();
    const status=action==='PUBLISH'?'PUBLISHED':action==='HIDE'?'HIDDEN':'REMOVED';
    const reason=requiredText(input?.reason,'reason',2000);
    const next={...review,status:status as any,moderation_reason:reason,updated_at:now};
    withTransaction(({db})=>{
      repo.updateReview(next);
      getDatabase().prepare(`
        UPDATE marketplace_review_reports SET status=?,resolution_note=?,resolved_at=?
        WHERE review_id=? AND status='OPEN'
      `).run(action==='PUBLISH'?'DISMISSED':'RESOLVED',reason,now,review.id);
      this.emit(actor,'marketplace.review.moderated',review.id,{marketplace_review:review.id,marketplace_store:review.store_id},
        {review_id:review.id,status:next.status,reason},db);
      this.audit(actor,'MARKETPLACE_REVIEW_MODERATED','marketplace_review',review.id,{status:next.status,reason},db);
    });
    return {review:next,response:repo.getResponse(next.id)};
  }

  openDispute(actor:AuthenticatedActorContext,orderId:string,input:any){
    const order=this.requireBuyerOrder(actor,orderId);
    const financial=marketplacePaymentRepository.financialSummary(order.id);
    if(financial.captured_minor<=0)throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Disputes require an order with captured payment',409);
    if(repo.getOpenDisputeForOrder(order.id))throw new CanonicalAppError(ErrorCode.CONFLICT,'An open dispute already exists for this order',409);
    const category=String(input?.category||'').toUpperCase() as MarketplaceDisputeCategory;
    if(!['ORDER_NOT_RECEIVED','ITEM_NOT_AS_DESCRIBED','DAMAGED','FITMENT_MISMATCH','PAYMENT_REFUND','RETURN_REFUND','SELLER_CONDUCT','OTHER'].includes(category)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid dispute category',400);
    }
    const summary=requiredText(input?.summary,'summary',3000);
    const now=getCurrentUtcIsoString(),id=generateCanonicalId('mdispute');
    const value:MarketplaceDispute={id,dispute_number:'DSP-'+now.slice(0,10).replaceAll('-','')+'-'+id.slice(-8).toUpperCase(),
      order_id:order.id,store_id:order.store_id,buyer_user_id:actor.user_id,category,status:'SELLER_RESPONSE_REQUIRED',
      summary,buyer_requested_outcome:optionalText(input?.requested_outcome,1200),assigned_to_user_id:null,
      resolution_action:null,resolution_summary:null,opened_at:now,resolved_at:null,closed_at:null,created_at:now,updated_at:now};
    const initial:MarketplaceDisputeMessage={id:generateCanonicalId('mdmsg'),dispute_id:id,author_user_id:actor.user_id,
      author_role:'BUYER',audience:'PARTIES',body:summary,evidence_reference:optionalText(input?.evidence_reference,500),created_at:now};
    withTransaction(({db})=>{
      repo.createDispute(value);repo.addMessage(initial);
      this.emit(actor,'marketplace.dispute.opened',id,{marketplace_dispute:id,marketplace_order:order.id,marketplace_store:order.store_id},
        {dispute_id:id,dispute_number:value.dispute_number,category,status:value.status},db);
      this.audit(actor,'MARKETPLACE_DISPUTE_OPENED','marketplace_dispute',id,{order_id:order.id,category,status:value.status},db);
    });
    return repo.disputeDetail(value,false);
  }

  listMyDisputes(actor:AuthenticatedActorContext){return repo.listBuyerDisputes(actor.user_id).map(x=>repo.disputeDetail(x,false));}
  getMyDispute(actor:AuthenticatedActorContext,id:string){
    const d=repo.getDispute(id);
    if(!d||d.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    return repo.disputeDetail(d,false);
  }

  listSellerDisputes(actor:AuthenticatedActorContext,storeId:string){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    return repo.listStoreDisputes(storeId).map(x=>repo.disputeDetail(x,false));
  }

  getSellerDispute(actor:AuthenticatedActorContext,storeId:string,id:string){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_READ);
    const d=repo.getDispute(id);
    if(!d||d.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    return repo.disputeDetail(d,false);
  }

  addBuyerMessage(actor:AuthenticatedActorContext,id:string,input:any){
    const d=repo.getDispute(id);
    if(!d||d.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(['RESOLVED','CLOSED'].includes(d.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Resolved/closed disputes cannot receive party messages',409);
    return this.addMessage(actor,d,'BUYER','PARTIES',input);
  }

  addSellerMessage(actor:AuthenticatedActorContext,storeId:string,id:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_ORDERS_MANAGE);
    const d=repo.getDispute(id);
    if(!d||d.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(['RESOLVED','CLOSED'].includes(d.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Resolved/closed disputes cannot receive party messages',409);
    const msg=this.addMessage(actor,d,'SELLER','PARTIES',input);
    if(d.status==='SELLER_RESPONSE_REQUIRED'){
      repo.updateDispute({...d,status:'UNDER_REVIEW',updated_at:getCurrentUtcIsoString()});
    }
    return msg;
  }

  listOpsDisputes(actor:AuthenticatedActorContext){
    this.requireDisputeModerator(actor);
    return repo.listOpsDisputes().map(x=>repo.disputeDetail(x,true));
  }

  takeDispute(actor:AuthenticatedActorContext,id:string){
    this.requireDisputeModerator(actor);
    const d=repo.getDispute(id);
    if(!d)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(['RESOLVED','CLOSED'].includes(d.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Resolved/closed dispute cannot be assigned',409);
    const next={...d,status:'UNDER_REVIEW' as const,assigned_to_user_id:actor.user_id,updated_at:getCurrentUtcIsoString()};
    return repo.disputeDetail(repo.updateDispute(next),true);
  }

  addOpsMessage(actor:AuthenticatedActorContext,id:string,input:any){
    this.requireDisputeModerator(actor);
    const d=repo.getDispute(id);
    if(!d)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(d.status==='CLOSED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Closed dispute cannot receive messages',409);
    const audience=String(input?.audience||'INTERNAL').toUpperCase();
    if(!['PARTIES','INTERNAL'].includes(audience))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'audience must be PARTIES or INTERNAL',400);
    return this.addMessage(actor,d,'TRUST_AND_SAFETY',audience as any,input);
  }

  resolveDispute(actor:AuthenticatedActorContext,id:string,input:any){
    this.requireDisputeModerator(actor);
    const d=repo.getDispute(id);
    if(!d)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(['RESOLVED','CLOSED'].includes(d.status))throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Dispute is already resolved/closed',409);
    const action=String(input?.resolution_action||'').toUpperCase() as MarketplaceDisputeResolutionAction;
    if(!['NO_ACTION','PARTIES_AGREED','RETURN_WORKFLOW','FINANCE_REVIEW','ACCOUNT_ACTION_REVIEW'].includes(action)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid resolution_action',400);
    }
    const summary=requiredText(input?.resolution_summary,'resolution_summary',4000),now=getCurrentUtcIsoString();
    const next={...d,status:'RESOLVED' as const,assigned_to_user_id:d.assigned_to_user_id||actor.user_id,
      resolution_action:action,resolution_summary:summary,resolved_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.updateDispute(next);
      repo.addMessage({id:generateCanonicalId('mdmsg'),dispute_id:d.id,author_user_id:actor.user_id,
        author_role:'TRUST_AND_SAFETY',audience:'PARTIES',body:'Resolution: '+summary,evidence_reference:null,created_at:now});
      this.emit(actor,'marketplace.dispute.resolved',d.id,{marketplace_dispute:d.id,marketplace_order:d.order_id,marketplace_store:d.store_id},
        {dispute_id:d.id,resolution_action:action,resolution_summary:summary,
          money_moved:false,inventory_changed:false},db);
      this.audit(actor,'MARKETPLACE_DISPUTE_RESOLVED','marketplace_dispute',d.id,
        {resolution_action:action,money_moved:false,inventory_changed:false},db);
    });
    return repo.disputeDetail(next,true);
  }

  closeDispute(actor:AuthenticatedActorContext,id:string){
    this.requireDisputeModerator(actor);
    const d=repo.getDispute(id);
    if(!d)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Dispute not found',404);
    if(d.status!=='RESOLVED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only RESOLVED disputes can be closed',409);
    const now=getCurrentUtcIsoString();
    return repo.disputeDetail(repo.updateDispute({...d,status:'CLOSED',closed_at:now,updated_at:now}),true);
  }

  private addMessage(actor:AuthenticatedActorContext,d:MarketplaceDispute,role:'BUYER'|'SELLER'|'TRUST_AND_SAFETY',
    audience:'PARTIES'|'INTERNAL',input:any){
    const msg:MarketplaceDisputeMessage={id:generateCanonicalId('mdmsg'),dispute_id:d.id,author_user_id:actor.user_id,
      author_role:role,audience,body:requiredText(input?.body,'body',5000),
      evidence_reference:optionalText(input?.evidence_reference,500),created_at:getCurrentUtcIsoString()};
    repo.addMessage(msg);return msg;
  }
  private requireBuyerOrder(actor:AuthenticatedActorContext,orderId:string){
    const order=marketplaceTransactionRepository.getOrder(orderId);
    if(!order||order.buyer_user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Order not found',404);
    return order;
  }
  private requireStore(actor:AuthenticatedActorContext,storeId:string,permission:CanonicalPermission){
    const store=getDatabase().prepare('SELECT organization_id FROM marketplace_stores WHERE id=? LIMIT 1').get(storeId) as any;
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,permission,{organizationId:String(store.organization_id)});
  }
  private requireReviewModerator(actor:AuthenticatedActorContext){
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_REVIEWS_MODERATE);
  }
  private requireDisputeModerator(actor:AuthenticatedActorContext){
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_DISPUTES_MODERATE);
  }
  private emit(actor:AuthenticatedActorContext,type:string,correlationId:string,subjects:Record<string,string>,payload:any,db?:any){
    enqueueOutboxEvent(createCanonicalEventEnvelope({type,producer:'garage-os-marketplace-trust',correlation_id:correlationId,
      subject_ids:subjects,actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,payload}),db);
  }
  private audit(actor:AuthenticatedActorContext,action:string,resourceType:string,resourceId:string,after:any,db?:any){
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action,resource_type:resourceType,resource_id:resourceId,
      correlation_id:resourceId,source:'MARKETPLACE_TRUST_API',after_state:after},db);
  }
}
export const marketplaceTrustService=new MarketplaceTrustService();
