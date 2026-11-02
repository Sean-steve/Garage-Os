/**
 * Sprint 31 — Marketplace Growth, Retention & Seller Intelligence
 *
 * Read-only commercial intelligence from provider-confirmed settlement captures,
 * canonical fulfillment/catalog facts and explicit current saved intent.
 * No browsing/click/search tracking and no opaque growth/churn score.
 */
export interface MarketplaceGrowthWindow{
  from:string;
  to:string;
  timezone:'UTC';
  days:number;
  comparison_from:string;
  comparison_to:string;
}

export interface MarketplaceGrowthPeriodSummary{
  captured_orders:number;
  distinct_paid_buyers:number;
  new_paid_buyers:number;
  returning_paid_buyers:number;
  repeat_paid_buyers_in_period:number;
  repeat_paid_buyer_percent:number|null;
}

export interface MarketplaceGrowthComparison{
  current:MarketplaceGrowthPeriodSummary;
  previous:MarketplaceGrowthPeriodSummary;
  change:{
    captured_orders_percent:number|null;
    distinct_paid_buyers_percent:number|null;
    new_paid_buyers_percent:number|null;
    returning_paid_buyers_percent:number|null;
  };
  truth:{
    paid_truth_source:'SETTLEMENT_LEDGER';
    zero_baseline_percent_is_null:true;
  };
}

export interface MarketplaceRetentionCohort{
  cohort_month:string;
  first_time_paid_buyers:number;
  eligible_30d:number;
  repeated_within_30d:number;
  repeat_30d_percent:number|null;
  eligible_90d:number;
  repeated_within_90d:number;
  repeat_90d_percent:number|null;
}

export interface MarketplaceRetentionSummary{
  cohorts:MarketplaceRetentionCohort[];
  eligible_30d:number;
  repeated_within_30d:number;
  repeat_30d_percent:number|null;
  eligible_90d:number;
  repeated_within_90d:number;
  repeat_90d_percent:number|null;
  truth:{
    cohort_anchor:'FIRST_SETTLEMENT_CAPTURE';
    immature_buyers_excluded:true;
    repeat_purchase_not_subscription_retention:true;
    churn_inferred:false;
  };
}

export interface MarketplaceCategoryDemand{
  category_code:string;
  category_name:string;
  active_published_listings:number;
  current_saved_instances:number;
  captured_orders:number;
  captured_units:number;
  captured_gross:Array<{currency:string;amount_minor:number}>;
  out_of_stock_saved_instances:number;
}

export interface MarketplaceGrowthListingSignal{
  listing_id:string;
  product_id:string;
  title:string;
  seller_sku:string;
  category_code:string;
  listing_status:string;
  inventory_status:string;
  current_saved_count:number;
  captured_orders:number;
  captured_units:number;
  published_verified_review_count:number;
}

export type MarketplaceSellerOpportunityType=
  |'RESTOCK_SAVED_DEMAND'
  |'LOW_STOCK_DEMAND'
  |'SAVED_DEMAND_NO_CAPTURE'
  |'REVIEW_COVERAGE'
  |'PAID_ORDER_FULFILLMENT_BACKLOG'
  |'BUYER_CONFIRMATION_PENDING';

export interface MarketplaceSellerOpportunity{
  type:MarketplaceSellerOpportunityType;
  priority:'HIGH'|'MEDIUM'|'LOW';
  listing_id:string|null;
  title:string;
  evidence:Record<string,number|string|boolean|null>;
  explanation:string;
  suggested_action:string;
  automatic_action:false;
}

export interface MarketplaceSellerGrowthIntelligence{
  store:{id:string;display_name:string;slug:string;status:string};
  window:MarketplaceGrowthWindow;
  growth:MarketplaceGrowthComparison;
  retention:MarketplaceRetentionSummary;
  categories:MarketplaceCategoryDemand[];
  listing_signals:MarketplaceGrowthListingSignal[];
  opportunities:MarketplaceSellerOpportunity[];
  truth:{
    read_only:true;
    opaque_growth_score:false;
    opaque_churn_score:false;
    browsing_history_used:false;
    search_history_used:false;
    hidden_behavioral_profile_used:false;
    explicit_saved_intent_used:true;
    buyer_identities_exposed:false;
    automatic_seller_actions:false;
  };
}

export interface MarketplacePlatformGrowthIntelligence{
  window:MarketplaceGrowthWindow;
  growth:MarketplaceGrowthComparison;
  retention:MarketplaceRetentionSummary;
  categories:MarketplaceCategoryDemand[];
  stores:Array<{
    store_id:string;
    display_name:string;
    status:string;
    growth:MarketplaceGrowthComparison;
    retention:Pick<MarketplaceRetentionSummary,'eligible_30d'|'repeated_within_30d'|'repeat_30d_percent'|'eligible_90d'|'repeated_within_90d'|'repeat_90d_percent'>;
  }>;
  truth:{
    read_only:true;
    opaque_store_ranking:false;
    opaque_growth_score:false;
    churn_inferred:false;
    buyer_identities_exposed:false;
  };
}
