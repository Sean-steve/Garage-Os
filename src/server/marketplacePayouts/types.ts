/**
 * Sprint 32 — Seller Payouts, Balances & Financial Operations
 *
 * The settlement ledger represents seller receivable truth.
 * Payout success is a separate provider-authoritative fact.
 */
export type MarketplacePayoutProviderMode='TEST'|'LIVE';
export type MarketplacePayoutProviderStatus='ACTIVE'|'PAUSED'|'RETIRED';
export type MarketplacePayoutAccountStatus='PENDING_REVIEW'|'ACTIVE'|'PAUSED'|'RETIRED';
export type MarketplacePayoutStatus='REQUESTED'|'PROCESSING'|'SUCCEEDED'|'FAILED'|'REVERSED';
export type MarketplacePayoutBatchStatus='DRAFT'|'HANDOFF_INITIATED'|'SETTLED'|'ATTENTION';
export type MarketplacePayoutProviderEventType='PAYOUT_PROCESSING'|'PAYOUT_SUCCEEDED'|'PAYOUT_FAILED'|'PAYOUT_REVERSED';
export type MarketplacePayoutProviderEventProcessing='PROCESSED'|'IGNORED'|'REJECTED';

export interface MarketplacePayoutProvider{
  id:string;
  provider_key:string;
  display_name:string;
  mode:MarketplacePayoutProviderMode;
  status:MarketplacePayoutProviderStatus;
  webhook_secret_env:string;
  supports_reversals:boolean;
  created_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplacePayoutPolicy{
  id:string;
  provider_id:string;
  currency:string;
  minimum_payout_minor:number;
  reserve_minor:number;
  updated_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplacePayoutAccount{
  id:string;
  store_id:string;
  provider_id:string;
  provider_key:string;
  provider_display_name:string;
  currency:string;
  provider_account_ref:string;
  account_label:string;
  status:MarketplacePayoutAccountStatus;
  registered_by:string;
  registered_at:string;
  activated_by:string|null;
  activated_at:string|null;
  updated_at:string;
}

export interface MarketplacePayout{
  id:string;
  payout_number:string;
  store_id:string;
  payout_account_id:string;
  provider_id:string;
  provider_key:string;
  idempotency_key:string;
  provider_payout_id:string|null;
  amount_minor:number;
  currency:string;
  status:MarketplacePayoutStatus;
  failure_code:string|null;
  failure_message:string|null;
  requested_by:string;
  requested_at:string;
  processing_at:string|null;
  succeeded_at:string|null;
  failed_at:string|null;
  reversed_at:string|null;
  updated_at:string;
}

export interface MarketplacePayoutBatch{
  id:string;
  batch_number:string;
  provider_id:string;
  provider_key:string;
  currency:string;
  status:MarketplacePayoutBatchStatus;
  created_by:string;
  created_at:string;
  handoff_at:string|null;
  updated_at:string;
}

export interface MarketplacePayoutProviderEvent{
  id:string;
  provider_id:string;
  provider_event_id:string;
  event_type:MarketplacePayoutProviderEventType;
  payout_id:string|null;
  signature_verified:boolean;
  payload_hash:string;
  processing_status:MarketplacePayoutProviderEventProcessing;
  processing_message:string|null;
  occurred_at:string;
  processed_at:string;
}

export interface MarketplacePayoutCurrencyBalance{
  store_id:string;
  currency:string;
  net_receivable_minor:number;
  requested_minor:number;
  processing_minor:number;
  reserved_minor:number;
  paid_minor:number;
  reversed_history_minor:number;
  unallocated_minor:number;
  deficit_minor:number;
  truth:{
    receivable_source:'SETTLEMENT_LEDGER';
    paid_source:'VERIFIED_PAYOUT_PROVIDER_EVENTS';
    receivable_is_payout:false;
    currencies_not_combined:true;
  };
}

export interface MarketplacePayoutOption{
  payout_account_id:string;
  provider_id:string;
  provider_key:string;
  provider_display_name:string;
  currency:string;
  account_label:string;
  policy:{
    minimum_payout_minor:number;
    reserve_minor:number;
  };
  requestable_minor:number;
  truth:{
    account_activation_source:'FINANCE_RECORDED';
    provider_account_ref_exposed:false;
  };
}

export interface MarketplaceSellerPayoutDashboard{
  store_id:string;
  balances:MarketplacePayoutCurrencyBalance[];
  payout_options:MarketplacePayoutOption[];
  accounts:Array<Omit<MarketplacePayoutAccount,'provider_account_ref'>>;
  payouts:MarketplacePayout[];
  truth:{
    settlement_ledger_authoritative:true;
    payout_provider_event_authoritative:true;
    browser_cannot_mark_paid:true;
    raw_bank_or_mobile_money_secrets_stored:false;
  };
}

export interface MarketplacePayoutWebhookInput{
  provider_event_id:string;
  event_type:MarketplacePayoutProviderEventType;
  provider_payout_id:string;
  payout_id:string;
  amount_minor:number;
  currency:string;
  occurred_at:string;
  failure_code?:string|null;
  failure_message?:string|null;
}
