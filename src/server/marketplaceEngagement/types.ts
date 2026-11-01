/**
 * Sprint 29 — Marketplace Saved Items, Alerts & Engagement
 *
 * Engagement is explicit user intent. Normal browsing/search activity is not
 * persisted as behavioral history. External email/SMS/push delivery remains
 * unavailable until a real adapter exists.
 */
import { MarketplaceListingCard } from '../marketplace/types';
import { MarketplaceDiscoverySearchInput } from '../marketplaceDiscovery/types';

export type MarketplaceSavedSearchStatus='ACTIVE'|'PAUSED';
export type MarketplaceAlertType='SAVED_LISTING_PRICE_DROP'|'SAVED_LISTING_RESTOCK'|'SAVED_SEARCH_NEW_MATCH';
export type MarketplaceAlertState='UNREAD'|'READ'|'DISMISSED';

export interface MarketplaceSavedListing{
  id:string;
  user_id:string;
  listing_id:string;
  price_minor_at_save:number;
  inventory_status_at_save:string;
  last_seen_price_minor:number;
  last_seen_inventory_status:string;
  price_drop_alert_enabled:boolean;
  restock_alert_enabled:boolean;
  saved_at:string;
  updated_at:string;
}

export interface MarketplaceSavedListingDetail{
  saved:MarketplaceSavedListing;
  listing:MarketplaceListingCard|null;
  availability:'DISCOVERABLE'|'UNAVAILABLE';
}

export interface MarketplaceSavedSearch{
  id:string;
  user_id:string;
  name:string;
  criteria:MarketplaceDiscoverySearchInput;
  vehicle_id:string|null;
  new_match_alert_enabled:boolean;
  status:MarketplaceSavedSearchStatus;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceAlertPreferences{
  user_id:string;
  in_app_enabled:boolean;
  email_requested:boolean;
  sms_requested:boolean;
  push_requested:boolean;
  max_alerts_per_day:number;
  quiet_hours_start:string|null;
  quiet_hours_end:string|null;
  updated_at:string;
}

export interface MarketplaceAlert{
  id:string;
  user_id:string;
  alert_type:MarketplaceAlertType;
  listing_id:string|null;
  saved_listing_id:string|null;
  saved_search_id:string|null;
  fingerprint:string;
  title:string;
  body:string;
  state:MarketplaceAlertState;
  created_at:string;
  read_at:string|null;
  dismissed_at:string|null;
}

export interface MarketplaceAlertEvaluationResult{
  user_id:string;
  alerts_created:number;
  saved_listings_evaluated:number;
  saved_searches_evaluated:number;
  limited_by_daily_cap:boolean;
  truth:{
    in_app_authoritative:true;
    external_delivery_attempted:false;
    email_delivery_available:false;
    sms_delivery_available:false;
    push_delivery_available:false;
  };
}

export interface MarketplaceEngagementSummary{
  saved_listing_count:number;
  active_saved_search_count:number;
  unread_alert_count:number;
  truth:{
    browsing_history_persisted:false;
    saved_state_is_explicit_user_intent:true;
    external_delivery_available:false;
  };
}

export interface MarketplaceSellerListingEngagement{
  listing_id:string;
  title:string;
  status:string;
  saved_count:number;
}

export interface MarketplaceSellerEngagement{
  store_id:string;
  total_saved_instances:number;
  listings:MarketplaceSellerListingEngagement[];
  privacy:{
    saver_identities_exposed:false;
    aggregate_only:true;
  };
}
