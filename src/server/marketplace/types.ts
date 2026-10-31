/**
 * Sprint 22 — Marketplace Foundation (GAR-021)
 *
 * Physical automotive goods only. Fitment/compatibility is deliberately UNKNOWN
 * until GAR-022 / Sprint 23 owns compatibility evidence and decisions.
 */

export type MarketplaceStoreStatus='DRAFT'|'ACTIVE'|'PAUSED'|'SUSPENDED';
export type MarketplaceProductStatus='DRAFT'|'PUBLISHED'|'PAUSED'|'RETIRED';
export type MarketplaceListingStatus='DRAFT'|'PUBLISHED'|'PAUSED'|'RETIRED';
export type MarketplaceProductType='PART'|'TYRE'|'ACCESSORY'|'CONSUMABLE'|'TOOL'|'ELECTRONICS'|'OTHER';
export type MarketplaceProductCondition='NEW'|'USED'|'REMANUFACTURED';
export type MarketplaceInventoryStatus='IN_STOCK'|'LOW_STOCK'|'OUT_OF_STOCK'|'MADE_TO_ORDER'|'UNKNOWN';
export type MarketplaceInventoryTracking='NONE'|'QUANTITY';
export type MarketplaceFulfillmentMode='PICKUP'|'LOCAL_DELIVERY'|'SHIPPING';
export type MarketplaceAuthenticityClaim='SELLER_CLAIMED_OEM'|'SELLER_CLAIMED_AFTERMARKET'|'GENERIC'|'UNKNOWN';
export type MarketplaceAuthenticityVerification='NOT_VERIFIED';
export type MarketplaceFitmentStatus='UNKNOWN';

export interface MarketplaceStore{
  id:string;
  organization_id:string;
  provider_id:string|null;
  slug:string;
  display_name:string;
  description:string|null;
  support_phone:string|null;
  support_email:string|null;
  status:MarketplaceStoreStatus;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceCategory{
  id:string;
  code:string;
  parent_id:string|null;
  name:string;
  description:string|null;
  sort_order:number;
  is_active:boolean;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceProduct{
  id:string;
  store_id:string;
  category_id:string;
  product_type:MarketplaceProductType;
  seller_sku:string;
  title:string;
  description:string;
  brand:string|null;
  manufacturer_part_number:string|null;
  condition:MarketplaceProductCondition;
  authenticity_claim:MarketplaceAuthenticityClaim;
  authenticity_verification_status:MarketplaceAuthenticityVerification;
  warranty_summary:string|null;
  status:MarketplaceProductStatus;
  fitment_status:MarketplaceFitmentStatus;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceListing{
  id:string;
  store_id:string;
  product_id:string;
  status:MarketplaceListingStatus;
  price_minor:number;
  compare_at_price_minor:number|null;
  currency:string;
  inventory_tracking:MarketplaceInventoryTracking;
  stock_quantity:number|null;
  inventory_status:MarketplaceInventoryStatus;
  fulfillment_modes:MarketplaceFulfillmentMode[];
  published_at:string|null;
  paused_at:string|null;
  retired_at:string|null;
  version:number;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceListingMedia{
  id:string;
  listing_id:string;
  file_object_id:string;
  media_role:'IMAGE'|'DOCUMENT';
  alt_text:string|null;
  sort_order:number;
  is_primary:boolean;
  created_at:string;
}

export interface MarketplacePriceSnapshot{
  id:string;
  listing_id:string;
  version:number;
  price_minor:number;
  compare_at_price_minor:number|null;
  currency:string;
  inventory_status:MarketplaceInventoryStatus;
  captured_reason:'CREATED'|'UPDATED'|'PUBLISHED';
  captured_by:string;
  captured_at:string;
}

export interface MarketplaceListingCard{
  listing_id:string;
  product_id:string;
  store_id:string;
  store_slug:string;
  store_name:string;
  title:string;
  description:string;
  category_code:string;
  category_name:string;
  product_type:MarketplaceProductType;
  brand:string|null;
  condition:MarketplaceProductCondition;
  price_minor:number;
  compare_at_price_minor:number|null;
  currency:string;
  inventory_status:MarketplaceInventoryStatus;
  fulfillment_modes:MarketplaceFulfillmentMode[];
  primary_media_file_id:string|null;
  authenticity_claim:MarketplaceAuthenticityClaim;
  authenticity_verification_status:MarketplaceAuthenticityVerification;
  fitment_status:MarketplaceFitmentStatus;
}

export interface MarketplaceListingDetail extends MarketplaceListingCard{
  seller_sku:string;
  manufacturer_part_number:string|null;
  warranty_summary:string|null;
  media:MarketplaceListingMedia[];
  truth:{
    fitment_confirmed:false;
    compatibility_status:'UNKNOWN';
    checkout_available:false;
    order_creation_available:false;
    payment_available:false;
    authenticity_verified:false;
  };
}

export interface MarketplaceSearchQuery{
  query?:string;
  category?:string;
  product_type?:MarketplaceProductType;
  condition?:MarketplaceProductCondition;
  brand?:string;
  currency?:string;
  min_price_minor?:number;
  max_price_minor?:number;
  in_stock_only?:boolean;
  store_slug?:string;
  limit?:number;
  offset?:number;
}

export interface CreateMarketplaceStoreInput{
  organization_id:string;
  provider_id?:string|null;
  slug:string;
  display_name:string;
  description?:string|null;
  support_phone?:string|null;
  support_email?:string|null;
}

export interface CreateMarketplaceProductInput{
  category_id:string;
  product_type:MarketplaceProductType;
  seller_sku:string;
  title:string;
  description:string;
  brand?:string|null;
  manufacturer_part_number?:string|null;
  condition:MarketplaceProductCondition;
  authenticity_claim?:MarketplaceAuthenticityClaim;
  warranty_summary?:string|null;
}

export interface CreateMarketplaceListingInput{
  price_minor:number;
  compare_at_price_minor?:number|null;
  currency:string;
  inventory_tracking?:MarketplaceInventoryTracking;
  stock_quantity?:number|null;
  inventory_status?:MarketplaceInventoryStatus;
  fulfillment_modes?:MarketplaceFulfillmentMode[];
}

export interface UpdateMarketplaceListingInput extends Partial<CreateMarketplaceListingInput>{}
