/**
 * Sprint 27 — Marketplace Trust, Reviews & Disputes
 *
 * Trust is expressed through auditable facts and verified-purchase provenance.
 * No opaque aggregate "trust score" is persisted.
 */
export type MarketplaceReviewTarget='STORE'|'PRODUCT';
export type MarketplaceReviewStatus='PUBLISHED'|'UNDER_REVIEW'|'HIDDEN'|'REMOVED';
export type MarketplaceReviewReportStatus='OPEN'|'RESOLVED'|'DISMISSED';
export type MarketplaceDisputeStatus='OPEN'|'SELLER_RESPONSE_REQUIRED'|'UNDER_REVIEW'|'RESOLVED'|'CLOSED';
export type MarketplaceDisputeCategory=
  'ORDER_NOT_RECEIVED'|'ITEM_NOT_AS_DESCRIBED'|'DAMAGED'|'FITMENT_MISMATCH'|'PAYMENT_REFUND'|
  'RETURN_REFUND'|'SELLER_CONDUCT'|'OTHER';
export type MarketplaceDisputeMessageAudience='PARTIES'|'INTERNAL';
export type MarketplaceDisputeResolutionAction=
  'NO_ACTION'|'PARTIES_AGREED'|'RETURN_WORKFLOW'|'FINANCE_REVIEW'|'ACCOUNT_ACTION_REVIEW';

export interface MarketplaceReview{
  id:string;
  target_type:MarketplaceReviewTarget;
  store_id:string;
  product_id:string|null;
  order_id:string;
  order_item_id:string|null;
  buyer_user_id:string;
  rating:number;
  title:string|null;
  body:string|null;
  verified_purchase:true;
  status:MarketplaceReviewStatus;
  moderation_reason:string|null;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceReviewResponse{
  id:string;
  review_id:string;
  store_id:string;
  responder_user_id:string;
  body:string;
  status:'PUBLISHED'|'REMOVED';
  created_at:string;
  updated_at:string;
}

export interface MarketplaceReviewReport{
  id:string;
  review_id:string;
  reporter_user_id:string;
  reporter_store_id:string|null;
  reason:string;
  status:MarketplaceReviewReportStatus;
  resolution_note:string|null;
  created_at:string;
  resolved_at:string|null;
}

export interface MarketplaceTrustSummary{
  store_id:string;
  verified_review_count:number;
  average_rating:number|null;
  rating_distribution:Record<'1'|'2'|'3'|'4'|'5',number>;
  completed_fulfillment_count:number;
  returned_fulfillment_count:number;
  return_request_count:number;
  dispute_count:number;
  open_dispute_count:number;
  resolved_dispute_count:number;
  truth:{
    opaque_trust_score:false;
    reviews_verified_purchase_only:true;
    disputes_are_context_not_guilt:true;
  };
}

export interface MarketplaceDispute{
  id:string;
  dispute_number:string;
  order_id:string;
  store_id:string;
  buyer_user_id:string;
  category:MarketplaceDisputeCategory;
  status:MarketplaceDisputeStatus;
  summary:string;
  buyer_requested_outcome:string|null;
  assigned_to_user_id:string|null;
  resolution_action:MarketplaceDisputeResolutionAction|null;
  resolution_summary:string|null;
  opened_at:string;
  resolved_at:string|null;
  closed_at:string|null;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceDisputeMessage{
  id:string;
  dispute_id:string;
  author_user_id:string;
  author_role:'BUYER'|'SELLER'|'TRUST_AND_SAFETY';
  audience:MarketplaceDisputeMessageAudience;
  body:string;
  evidence_reference:string|null;
  created_at:string;
}

export interface MarketplaceDisputeDetail{
  dispute:MarketplaceDispute;
  messages:MarketplaceDisputeMessage[];
  order_snapshot:{
    order_number:string;
    currency:string;
    total_minor:number;
    financial_status:string;
    captured_minor:number;
    refunded_minor:number;
    fulfillment_status:string|null;
    return_statuses:string[];
  };
  truth:{
    resolution_does_not_move_money:true;
    resolution_does_not_change_inventory:true;
    finance_action_requires_finance_workflow:true;
  };
}
