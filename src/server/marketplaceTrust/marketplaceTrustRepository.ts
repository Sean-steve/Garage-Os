import { getDatabase } from '../database/connection';
import {
  MarketplaceReview, MarketplaceReviewResponse, MarketplaceReviewReport,
  MarketplaceTrustSummary, MarketplaceDispute, MarketplaceDisputeMessage, MarketplaceDisputeDetail
} from './types';
import { marketplacePaymentRepository } from '../marketplacePayments/marketplacePaymentRepository';

const review=(r:any):MarketplaceReview=>({
  id:String(r.id),target_type:r.target_type,store_id:String(r.store_id),product_id:r.product_id?String(r.product_id):null,
  order_id:String(r.order_id),order_item_id:r.order_item_id?String(r.order_item_id):null,buyer_user_id:String(r.buyer_user_id),
  rating:Number(r.rating),title:r.title?String(r.title):null,body:r.body?String(r.body):null,verified_purchase:true,
  status:r.status,moderation_reason:r.moderation_reason?String(r.moderation_reason):null,
  created_at:String(r.created_at),updated_at:String(r.updated_at)
});
const response=(r:any):MarketplaceReviewResponse=>({
  id:String(r.id),review_id:String(r.review_id),store_id:String(r.store_id),responder_user_id:String(r.responder_user_id),
  body:String(r.body),status:r.status,created_at:String(r.created_at),updated_at:String(r.updated_at)
});
const report=(r:any):MarketplaceReviewReport=>({
  id:String(r.id),review_id:String(r.review_id),reporter_user_id:String(r.reporter_user_id),
  reporter_store_id:r.reporter_store_id?String(r.reporter_store_id):null,reason:String(r.reason),status:r.status,
  resolution_note:r.resolution_note?String(r.resolution_note):null,created_at:String(r.created_at),
  resolved_at:r.resolved_at?String(r.resolved_at):null
});
const dispute=(r:any):MarketplaceDispute=>({
  id:String(r.id),dispute_number:String(r.dispute_number),order_id:String(r.order_id),store_id:String(r.store_id),
  buyer_user_id:String(r.buyer_user_id),category:r.category,status:r.status,summary:String(r.summary),
  buyer_requested_outcome:r.buyer_requested_outcome?String(r.buyer_requested_outcome):null,
  assigned_to_user_id:r.assigned_to_user_id?String(r.assigned_to_user_id):null,
  resolution_action:r.resolution_action||null,resolution_summary:r.resolution_summary?String(r.resolution_summary):null,
  opened_at:String(r.opened_at),resolved_at:r.resolved_at?String(r.resolved_at):null,
  closed_at:r.closed_at?String(r.closed_at):null,created_at:String(r.created_at),updated_at:String(r.updated_at)
});
const message=(r:any):MarketplaceDisputeMessage=>({
  id:String(r.id),dispute_id:String(r.dispute_id),author_user_id:String(r.author_user_id),author_role:r.author_role,
  audience:r.audience,body:String(r.body),evidence_reference:r.evidence_reference?String(r.evidence_reference):null,
  created_at:String(r.created_at)
});

export class MarketplaceTrustRepository{
  getReview(id:string){const r=getDatabase().prepare('SELECT * FROM marketplace_reviews WHERE id=? LIMIT 1').get(id) as any;return r?review(r):null;}
  findBuyerReview(targetType:string,orderId:string,productId:string|null){
    const r=getDatabase().prepare(`
      SELECT * FROM marketplace_reviews
      WHERE target_type=? AND order_id=? AND COALESCE(product_id,'')=COALESCE(?,'') LIMIT 1
    `).get(targetType,orderId,productId) as any;return r?review(r):null;
  }
  createReview(v:MarketplaceReview){
    getDatabase().prepare(`
      INSERT INTO marketplace_reviews
      (id,target_type,store_id,product_id,order_id,order_item_id,buyer_user_id,rating,title,body,verified_purchase,status,
       moderation_reason,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)
    `).run(v.id,v.target_type,v.store_id,v.product_id,v.order_id,v.order_item_id,v.buyer_user_id,v.rating,v.title,v.body,
      v.status,v.moderation_reason,v.created_at,v.updated_at);return v;
  }
  updateReview(v:MarketplaceReview){
    getDatabase().prepare('UPDATE marketplace_reviews SET rating=?,title=?,body=?,status=?,moderation_reason=?,updated_at=? WHERE id=?')
      .run(v.rating,v.title,v.body,v.status,v.moderation_reason,v.updated_at,v.id);return v;
  }
  listPublishedReviews(storeId:string,limit=100){
    return (getDatabase().prepare(`
      SELECT * FROM marketplace_reviews WHERE store_id=? AND status='PUBLISHED' ORDER BY created_at DESC LIMIT ?
    `).all(storeId,limit) as any[]).map(review);
  }
  listBuyerReviews(userId:string){
    return (getDatabase().prepare('SELECT * FROM marketplace_reviews WHERE buyer_user_id=? ORDER BY created_at DESC').all(userId) as any[]).map(review);
  }
  getResponse(reviewId:string){const r=getDatabase().prepare('SELECT * FROM marketplace_review_responses WHERE review_id=? LIMIT 1').get(reviewId) as any;return r?response(r):null;}
  upsertResponse(v:MarketplaceReviewResponse){
    getDatabase().prepare(`
      INSERT INTO marketplace_review_responses
      (id,review_id,store_id,responder_user_id,body,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(review_id) DO UPDATE SET body=excluded.body,status=excluded.status,responder_user_id=excluded.responder_user_id,updated_at=excluded.updated_at
    `).run(v.id,v.review_id,v.store_id,v.responder_user_id,v.body,v.status,v.created_at,v.updated_at);
    return this.getResponse(v.review_id)!;
  }
  createReport(v:MarketplaceReviewReport){
    getDatabase().prepare(`
      INSERT INTO marketplace_review_reports
      (id,review_id,reporter_user_id,reporter_store_id,reason,status,resolution_note,created_at,resolved_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.review_id,v.reporter_user_id,v.reporter_store_id,v.reason,v.status,v.resolution_note,v.created_at,v.resolved_at);return v;
  }
  listOpenReports(){
    return (getDatabase().prepare("SELECT * FROM marketplace_review_reports WHERE status='OPEN' ORDER BY created_at").all() as any[]).map(report);
  }
  resolveReport(id:string,status:'RESOLVED'|'DISMISSED',note:string,now:string){
    getDatabase().prepare("UPDATE marketplace_review_reports SET status=?,resolution_note=?,resolved_at=? WHERE id=? AND status='OPEN'")
      .run(status,note,now,id);
    const r=getDatabase().prepare('SELECT * FROM marketplace_review_reports WHERE id=?').get(id) as any;return r?report(r):null;
  }

  trustSummary(storeId:string):MarketplaceTrustSummary{
    const rows=getDatabase().prepare(`
      SELECT rating,COUNT(*) count FROM marketplace_reviews
      WHERE store_id=? AND status='PUBLISHED' AND verified_purchase=1 GROUP BY rating
    `).all(storeId) as any[];
    const dist:any={'1':0,'2':0,'3':0,'4':0,'5':0};
    let total=0,sum=0;
    for(const r of rows){dist[String(r.rating)]=Number(r.count);total+=Number(r.count);sum+=Number(r.rating)*Number(r.count);}
    const fulf=getDatabase().prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN status IN ('COMPLETED','RETURN_IN_PROGRESS','RETURNED') THEN 1 ELSE 0 END),0) completed,
        COALESCE(SUM(CASE WHEN status='RETURNED' THEN 1 ELSE 0 END),0) returned
      FROM marketplace_fulfillments WHERE store_id=?
    `).get(storeId) as any;
    const returns=getDatabase().prepare('SELECT COUNT(*) count FROM marketplace_returns WHERE store_id=?').get(storeId) as any;
    const disputes=getDatabase().prepare(`
      SELECT COUNT(*) total,
        COALESCE(SUM(CASE WHEN status IN ('OPEN','SELLER_RESPONSE_REQUIRED','UNDER_REVIEW') THEN 1 ELSE 0 END),0) open_count,
        COALESCE(SUM(CASE WHEN status IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END),0) resolved_count
      FROM marketplace_disputes WHERE store_id=?
    `).get(storeId) as any;
    return {store_id:storeId,verified_review_count:total,average_rating:total?Math.round((sum/total)*100)/100:null,
      rating_distribution:dist,completed_fulfillment_count:Number(fulf?.completed||0),returned_fulfillment_count:Number(fulf?.returned||0),
      return_request_count:Number(returns?.count||0),dispute_count:Number(disputes?.total||0),open_dispute_count:Number(disputes?.open_count||0),
      resolved_dispute_count:Number(disputes?.resolved_count||0),
      truth:{opaque_trust_score:false,reviews_verified_purchase_only:true,disputes_are_context_not_guilt:true}};
  }

  createDispute(v:MarketplaceDispute){
    getDatabase().prepare(`
      INSERT INTO marketplace_disputes
      (id,dispute_number,order_id,store_id,buyer_user_id,category,status,summary,buyer_requested_outcome,assigned_to_user_id,
       resolution_action,resolution_summary,opened_at,resolved_at,closed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.dispute_number,v.order_id,v.store_id,v.buyer_user_id,v.category,v.status,v.summary,v.buyer_requested_outcome,
      v.assigned_to_user_id,v.resolution_action,v.resolution_summary,v.opened_at,v.resolved_at,v.closed_at,v.created_at,v.updated_at);return v;
  }
  updateDispute(v:MarketplaceDispute){
    getDatabase().prepare(`
      UPDATE marketplace_disputes SET status=?,assigned_to_user_id=?,resolution_action=?,resolution_summary=?,
        resolved_at=?,closed_at=?,updated_at=? WHERE id=?
    `).run(v.status,v.assigned_to_user_id,v.resolution_action,v.resolution_summary,v.resolved_at,v.closed_at,v.updated_at,v.id);return v;
  }
  getDispute(id:string){const r=getDatabase().prepare('SELECT * FROM marketplace_disputes WHERE id=? LIMIT 1').get(id) as any;return r?dispute(r):null;}
  getOpenDisputeForOrder(orderId:string){
    const r=getDatabase().prepare("SELECT * FROM marketplace_disputes WHERE order_id=? AND status NOT IN ('RESOLVED','CLOSED') ORDER BY opened_at DESC LIMIT 1").get(orderId) as any;
    return r?dispute(r):null;
  }
  listBuyerDisputes(userId:string){
    return (getDatabase().prepare('SELECT * FROM marketplace_disputes WHERE buyer_user_id=? ORDER BY opened_at DESC').all(userId) as any[]).map(dispute);
  }
  listStoreDisputes(storeId:string){
    return (getDatabase().prepare('SELECT * FROM marketplace_disputes WHERE store_id=? ORDER BY opened_at DESC').all(storeId) as any[]).map(dispute);
  }
  listOpsDisputes(){
    return (getDatabase().prepare("SELECT * FROM marketplace_disputes WHERE status!='CLOSED' ORDER BY opened_at").all() as any[]).map(dispute);
  }
  addMessage(v:MarketplaceDisputeMessage){
    getDatabase().prepare(`
      INSERT INTO marketplace_dispute_messages
      (id,dispute_id,author_user_id,author_role,audience,body,evidence_reference,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(v.id,v.dispute_id,v.author_user_id,v.author_role,v.audience,v.body,v.evidence_reference,v.created_at);return v;
  }
  listMessages(disputeId:string,includeInternal:boolean){
    const sql=includeInternal
      ?'SELECT * FROM marketplace_dispute_messages WHERE dispute_id=? ORDER BY created_at,id'
      :"SELECT * FROM marketplace_dispute_messages WHERE dispute_id=? AND audience='PARTIES' ORDER BY created_at,id";
    return (getDatabase().prepare(sql).all(disputeId) as any[]).map(message);
  }
  disputeDetail(v:MarketplaceDispute,includeInternal=false):MarketplaceDisputeDetail{
    const order=getDatabase().prepare('SELECT order_number,currency,total_minor FROM marketplace_orders WHERE id=?').get(v.order_id) as any;
    const financial=marketplacePaymentRepository.financialSummary(v.order_id);
    const fulfillment=getDatabase().prepare('SELECT status FROM marketplace_fulfillments WHERE order_id=?').get(v.order_id) as any;
    const returns=getDatabase().prepare('SELECT status FROM marketplace_returns WHERE order_id=? ORDER BY requested_at').all(v.order_id) as any[];
    return {dispute:v,messages:this.listMessages(v.id,includeInternal),
      order_snapshot:{order_number:String(order.order_number),currency:String(order.currency),total_minor:Number(order.total_minor),
        financial_status:financial.commercial_status,captured_minor:financial.captured_minor,refunded_minor:financial.refunded_minor,
        fulfillment_status:fulfillment?String(fulfillment.status):null,return_statuses:returns.map(x=>String(x.status))},
      truth:{resolution_does_not_move_money:true,resolution_does_not_change_inventory:true,finance_action_requires_finance_workflow:true}};
  }
}
export const marketplaceTrustRepository=new MarketplaceTrustRepository();
