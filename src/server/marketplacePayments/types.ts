/**
 * Sprint 25 — Marketplace Payments & Settlement
 *
 * Financial truth is provider-event authoritative. A client request can create
 * an intent or refund request, but cannot self-declare capture/refund success.
 */
export type MarketplacePaymentProviderMode='TEST'|'LIVE';
export type MarketplacePaymentProviderStatus='ACTIVE'|'PAUSED'|'RETIRED';
export type MarketplacePaymentIntentStatus='PENDING'|'SUCCEEDED'|'FAILED'|'PARTIALLY_REFUNDED'|'REFUNDED';
export type MarketplaceRefundStatus='REQUESTED'|'PENDING'|'SUCCEEDED'|'FAILED';
export type MarketplaceProviderEventType='PAYMENT_PENDING'|'PAYMENT_SUCCEEDED'|'PAYMENT_FAILED'|'REFUND_PENDING'|'REFUND_SUCCEEDED'|'REFUND_FAILED';
export type MarketplaceProviderEventProcessing='PROCESSED'|'IGNORED'|'REJECTED';
export type MarketplaceCommercialStatus='AWAITING_PAYMENT'|'PAYMENT_PENDING'|'PAYMENT_FAILED'|'PAID'|'PARTIALLY_REFUNDED'|'REFUNDED'|'CANCELLED';

export interface MarketplacePaymentProvider{
  id:string;
  provider_key:string;
  display_name:string;
  mode:MarketplacePaymentProviderMode;
  status:MarketplacePaymentProviderStatus;
  webhook_secret_env:string;
  supports_refunds:boolean;
  created_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplacePaymentIntent{
  id:string;
  order_id:string;
  provider_id:string;
  provider_key:string;
  idempotency_key:string;
  provider_payment_id:string|null;
  client_reference:string;
  amount_minor:number;
  currency:string;
  status:MarketplacePaymentIntentStatus;
  failure_code:string|null;
  failure_message:string|null;
  created_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceRefund{
  id:string;
  order_id:string;
  payment_intent_id:string;
  idempotency_key:string;
  provider_refund_id:string|null;
  amount_minor:number;
  currency:string;
  reason:string;
  status:MarketplaceRefundStatus;
  requested_by:string;
  requested_at:string;
  updated_at:string;
}

export interface MarketplaceProviderEvent{
  id:string;
  provider_id:string;
  provider_event_id:string;
  event_type:MarketplaceProviderEventType;
  payment_intent_id:string|null;
  refund_id:string|null;
  signature_verified:boolean;
  payload_hash:string;
  processing_status:MarketplaceProviderEventProcessing;
  processing_message:string|null;
  occurred_at:string;
  processed_at:string;
}

export interface MarketplaceSettlementEntry{
  id:string;
  store_id:string;
  order_id:string;
  payment_intent_id:string;
  refund_id:string|null;
  entry_type:'PAYMENT_CAPTURE'|'REFUND_ADJUSTMENT';
  amount_minor:number;
  currency:string;
  created_at:string;
}

export interface MarketplaceFinancialSummary{
  order_id:string;
  commercial_status:MarketplaceCommercialStatus;
  captured_minor:number;
  refunded_minor:number;
  net_paid_minor:number;
  currency:string;
  latest_payment_intent_id:string|null;
  payment_available:boolean;
  refund_available:boolean;
  seller_fulfillment_authorized:boolean;
}

export interface MarketplaceSettlementSummary{
  store_id:string;
  currency:string;
  gross_captured_minor:number;
  refunds_minor:number;
  net_receivable_minor:number;
  settled_minor:0;
  payout_available:false;
}

export interface ProviderWebhookInput{
  provider_event_id:string;
  event_type:MarketplaceProviderEventType;
  provider_payment_id:string;
  order_id:string;
  amount_minor:number;
  currency:string;
  occurred_at:string;
  refund_id?:string|null;
  provider_refund_id?:string|null;
  failure_code?:string|null;
  failure_message?:string|null;
}
