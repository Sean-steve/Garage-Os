/**
 * Sprint 28 — Marketplace Search Quality, Merchandising & Recommendations
 *
 * Organic ranking is deterministic and explainable. Merchandising never
 * silently changes organic rank. Vehicle-aware recommendations preserve the
 * Sprint 23 fitment disclaimer and never claim guaranteed compatibility.
 */
import { MarketplaceListingCard, MarketplaceSearchQuery } from '../marketplace/types';
import { FitmentDecision } from '../fitment/types';

export type MarketplaceDiscoverySort='RELEVANCE'|'PRICE_ASC'|'PRICE_DESC'|'RATING';
export type MarketplaceMerchandisingOwner='PLATFORM'|'STORE';
export type MarketplaceMerchandisingSurface='HOME'|'STORE'|'CATEGORY';
export type MarketplaceMerchandisingStatus='DRAFT'|'ACTIVE'|'PAUSED'|'RETIRED';
export type MarketplaceMerchandisingSourceLabel='PLATFORM_CURATED'|'SELLER_CURATED';

export interface MarketplaceDiscoverySearchInput extends MarketplaceSearchQuery{
  vehicle_id?:string;
  include_unknown_fitment?:boolean;
  sort?:MarketplaceDiscoverySort;
}

export interface MarketplaceRankComponent{
  key:'QUERY'|'AVAILABILITY'|'TRUST'|'FITMENT'|'RELATEDNESS';
  score:number;
  reason:string;
}

export interface MarketplaceDiscoveryItem extends MarketplaceListingCard{
  organic_rank:number;
  organic_score:number;
  rank_components:MarketplaceRankComponent[];
  trust:{
    verified_review_count:number;
    average_rating:number|null;
  };
  fitment:FitmentDecision|null;
  merchandising:{
    affects_organic_ranking:false;
    promoted:false;
  };
}

export interface MarketplaceDiscoveryResult{
  items:MarketplaceDiscoveryItem[];
  total:number;
  limit:number;
  offset:number;
  query_normalized:string|null;
  sort:MarketplaceDiscoverySort;
  truth:{
    deterministic_ranking:true;
    ranking_explainable:true;
    merchandising_affects_organic_ranking:false;
    paid_placement_supported:false;
    fitment_guaranteed:false;
    raw_search_history_persisted:false;
  };
}

export interface MarketplaceMerchandisingCollection{
  id:string;
  owner_type:MarketplaceMerchandisingOwner;
  store_id:string|null;
  slug:string;
  title:string;
  description:string|null;
  surface:MarketplaceMerchandisingSurface;
  category_code:string|null;
  status:MarketplaceMerchandisingStatus;
  source_label:MarketplaceMerchandisingSourceLabel;
  starts_at:string|null;
  ends_at:string|null;
  created_by:string;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceMerchandisingItem{
  id:string;
  collection_id:string;
  listing_id:string;
  sort_order:number;
  added_by:string;
  created_at:string;
}

export interface MarketplaceMerchandisingCollectionDetail{
  collection:MarketplaceMerchandisingCollection;
  items:Array<{
    merchandising_item:MarketplaceMerchandisingItem;
    listing:MarketplaceListingCard;
  }>;
  disclosure:{
    source_label:MarketplaceMerchandisingSourceLabel;
    paid_placement:false;
    affects_organic_ranking:false;
  };
}

export interface MarketplaceRecommendationItem extends MarketplaceDiscoveryItem{
  recommendation_reasons:string[];
}
