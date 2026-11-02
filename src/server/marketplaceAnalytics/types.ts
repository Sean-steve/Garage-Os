/**
 * Sprint 30 — Marketplace Operations Analytics & Seller Performance
 *
 * Analytics is a read-only projection over authoritative marketplace facts.
 * No opaque performance score is produced. Money comes only from the Sprint 25
 * settlement ledger and seller receivable is never represented as payout.
 */
export interface MarketplaceAnalyticsWindow{
  from:string;
  to:string;
  timezone:'UTC';
  days:number;
}

export interface MarketplaceMoneyMetric{
  currency:string;
  captured_gross_minor:number;
  refunded_minor:number;
  net_seller_receivable_minor:number;
  captured_order_count:number;
  truth:{
    source:'SETTLEMENT_LEDGER';
    receivable_is_payout:false;
    order_totals_are_not_revenue:true;
  };
}

export interface MarketplaceSellerFunnel{
  carts_created:number;
  carts_checked_out:number;
  orders_placed:number;
  cancelled_pre_payment:number;
  captured_orders:number;
  fulfillment_started:number;
  buyer_confirmed_completed:number;
  distinct_paid_buyers:number;
  repeat_paid_buyers:number;
  cohort_rates:{
    cart_to_order_percent:number|null;
    order_to_captured_percent:number|null;
    captured_to_completed_percent:number|null;
  };
}

export interface MarketplaceSellerOperations{
  unpaid_awaiting_payment:number;
  paid_without_fulfillment:number;
  fulfillment_in_progress:number;
  delivery_reported_waiting_buyer:number;
  open_return_requests:number;
  open_disputes:number;
  low_stock_listings:number;
  out_of_stock_listings:number;
  active_published_listings:number;
  attention_items:Array<{
    key:string;
    count:number;
    severity:'INFO'|'ATTENTION';
    explanation:string;
  }>;
}

export interface MarketplaceSellerFulfillmentMetrics{
  completed_fulfillments:number;
  average_capture_to_completion_hours:number|null;
  return_requests:number;
  completed_returns:number;
  physically_received_return_units:number;
  restocked_return_units:number;
}

export interface MarketplaceSellerTrustMetrics{
  published_verified_review_count:number;
  average_published_verified_rating:number|null;
  rating_distribution:Record<'1'|'2'|'3'|'4'|'5',number>;
  total_disputes:number;
  open_disputes:number;
  truth:{
    disputes_are_context_not_guilt:true;
    opaque_trust_score:false;
    reviews_verified_purchase_only:true;
  };
}

export interface MarketplaceSellerEngagementMetrics{
  current_saved_instances:number;
  saved_listing_count:number;
  truth:{
    aggregate_only:true;
    saver_identities_exposed:false;
    historical_save_events_available:false;
  };
}

export interface MarketplaceListingPerformanceRow{
  listing_id:string;
  product_id:string;
  title:string;
  seller_sku:string;
  listing_status:string;
  inventory_status:string;
  current_saved_count:number;
  captured_order_count:number;
  captured_units:number;
  captured_order_gross:Array<{currency:string;amount_minor:number}>;
  published_verified_review_count:number;
  average_published_verified_rating:number|null;
}

export interface MarketplaceDailyOperationsPoint{
  date:string;
  orders_placed:number;
  captured_orders:number;
  completed_fulfillments:number;
  return_requests:number;
  disputes_opened:number;
  captured_minor_by_currency:Record<string,number>;
  refunded_minor_by_currency:Record<string,number>;
}

export interface MarketplaceSellerAnalytics{
  store:{id:string;display_name:string;slug:string;status:string};
  window:MarketplaceAnalyticsWindow;
  money:MarketplaceMoneyMetric[];
  funnel:MarketplaceSellerFunnel;
  operations:MarketplaceSellerOperations;
  fulfillment:MarketplaceSellerFulfillmentMetrics;
  trust:MarketplaceSellerTrustMetrics;
  engagement:MarketplaceSellerEngagementMetrics;
  top_listings:MarketplaceListingPerformanceRow[];
  daily:MarketplaceDailyOperationsPoint[];
  truth:{
    read_only_projection:true;
    opaque_seller_score:false;
    money_source:'SETTLEMENT_LEDGER';
    receivable_is_payout:false;
    disputes_are_context_not_guilt:true;
    buyer_identities_exposed:false;
    analytics_timezone:'UTC';
  };
}

export interface MarketplacePlatformAnalytics{
  window:MarketplaceAnalyticsWindow;
  stores_total:number;
  active_stores:number;
  money:MarketplaceMoneyMetric[];
  orders_placed:number;
  captured_orders:number;
  completed_fulfillments:number;
  open_returns:number;
  open_disputes:number;
  published_verified_reviews:number;
  store_performance:Array<{
    store_id:string;
    display_name:string;
    status:string;
    orders_placed:number;
    captured_orders:number;
    completed_fulfillments:number;
    open_returns:number;
    open_disputes:number;
    money:MarketplaceMoneyMetric[];
  }>;
  daily:MarketplaceDailyOperationsPoint[];
  truth:{
    read_only_projection:true;
    opaque_store_ranking:false;
    seller_score:false;
    buyer_identities_exposed:false;
    disputes_are_context_not_guilt:true;
    receivable_is_payout:false;
  };
}
