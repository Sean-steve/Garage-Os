/**
 * Sprint 26 — Marketplace Fulfillment, Delivery & Returns
 *
 * Physical fulfillment truth is separate from financial truth. Seller-recorded
 * dispatch/delivery claims remain distinguishable from buyer-confirmed receipt.
 */
export type MarketplaceFulfillmentStatus=
  'PREPARING'|'READY_FOR_HANDOFF'|'IN_TRANSIT'|'DELIVERY_REPORTED'|'COMPLETED'|'RETURN_IN_PROGRESS'|'RETURNED';

export type MarketplaceFulfillmentEventSource='SELLER_RECORDED'|'BUYER_CONFIRMED'|'SYSTEM_DERIVED';
export type MarketplaceReturnStatus=
  'REQUESTED'|'APPROVED'|'REJECTED'|'IN_TRANSIT'|'RECEIVED'|'REFUND_REQUESTED'|'COMPLETED';
export type MarketplaceReturnCondition='UNASSESSED'|'RESTOCKABLE'|'OPENED'|'DAMAGED'|'DEFECTIVE';

export interface MarketplaceFulfillment{
  id:string;
  order_id:string;
  store_id:string;
  fulfillment_mode:'PICKUP'|'LOCAL_DELIVERY'|'SHIPPING';
  status:MarketplaceFulfillmentStatus;
  carrier_name:string|null;
  service_level:string|null;
  tracking_reference:string|null;
  seller_notes:string|null;
  prepared_at:string|null;
  ready_at:string|null;
  dispatched_at:string|null;
  delivery_reported_at:string|null;
  completed_at:string|null;
  created_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceFulfillmentEvent{
  id:string;
  fulfillment_id:string;
  order_id:string;
  event_type:string;
  source_type:MarketplaceFulfillmentEventSource;
  actor_id:string;
  details_json:string|null;
  occurred_at:string;
}

export interface MarketplaceReturn{
  id:string;
  return_number:string;
  order_id:string;
  fulfillment_id:string;
  buyer_user_id:string;
  store_id:string;
  status:MarketplaceReturnStatus;
  reason:string;
  seller_decision_reason:string|null;
  return_tracking_reference:string|null;
  refund_id:string|null;
  requested_at:string;
  reviewed_at:string|null;
  shipped_at:string|null;
  received_at:string|null;
  completed_at:string|null;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceReturnItem{
  id:string;
  return_id:string;
  order_item_id:string;
  listing_id:string;
  product_id:string;
  requested_quantity:number;
  received_quantity:number;
  restock_quantity:number;
  condition_at_return:MarketplaceReturnCondition;
  unit_price_minor:number;
  refund_amount_minor:number;
  notes:string|null;
}

export interface MarketplaceReturnDetail{
  return:MarketplaceReturn;
  items:MarketplaceReturnItem[];
  financial_refund_status:string|null;
  financial_refund_amount_minor:number|null;
  truth:{
    physical_return_received:boolean;
    inventory_restocked:boolean;
    refund_requested:boolean;
    refund_confirmed:boolean;
  };
}

export interface MarketplaceFulfillmentDetail{
  fulfillment:MarketplaceFulfillment;
  events:MarketplaceFulfillmentEvent[];
  returns:MarketplaceReturnDetail[];
  financial:{
    commercial_status:string;
    captured_minor:number;
    refunded_minor:number;
    net_paid_minor:number;
  };
  truth:{
    payment_authoritative:boolean;
    seller_dispatch_is_buyer_receipt:false;
    buyer_receipt_confirmed:boolean;
    return_available:boolean;
  };
}
