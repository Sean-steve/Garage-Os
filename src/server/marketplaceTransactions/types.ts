/**
 * Sprint 24 — Marketplace Transactions & Orders
 *
 * Orders are durable commercial records. Sprint 24 does not implement payment
 * capture or settlement; newly placed orders remain AWAITING_PAYMENT.
 */
export type MarketplaceCartStatus='ACTIVE'|'CHECKED_OUT'|'ABANDONED';
export type MarketplaceOrderStatus='AWAITING_PAYMENT'|'CANCELLED';
export type MarketplacePaymentStatus='NOT_STARTED'|'PENDING';
export type MarketplaceReservationStatus='HELD'|'RELEASED';

export interface MarketplaceCart{
  id:string;
  buyer_user_id:string;
  store_id:string;
  vehicle_id:string|null;
  currency:string|null;
  status:MarketplaceCartStatus;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceCartItem{
  id:string;
  cart_id:string;
  listing_id:string;
  product_id:string;
  quantity:number;
  unit_price_minor_snapshot:number;
  currency:string;
  listing_version_snapshot:number;
  title_snapshot:string;
  added_at:string;
  updated_at:string;
}

export interface MarketplaceCartDetail{
  cart:MarketplaceCart;
  items:MarketplaceCartItem[];
  subtotal_minor:number;
  currency:string|null;
}

export interface MarketplaceCheckoutValidation{
  valid:boolean;
  cart_id:string;
  vehicle_id:string|null;
  subtotal_minor:number;
  currency:string|null;
  item_results:Array<{
    cart_item_id:string;
    listing_id:string;
    product_id:string;
    quantity:number;
    available:boolean;
    price_changed:boolean;
    latest_unit_price_minor:number;
    latest_listing_version:number;
    fitment_status:string|null;
    fitment_confidence:number|null;
    fitment_guaranteed:false|null;
    blocking_reasons:string[];
  }>;
  requires_fitment_acknowledgement:boolean;
  blocking_reasons:string[];
  payment_available:false;
  truth:{
    payment_capture:false;
    seller_fulfillment_before_payment:false;
    inventory_reserved:false;
  };
}

export interface MarketplaceOrder{
  id:string;
  order_number:string;
  buyer_user_id:string;
  store_id:string;
  vehicle_id:string|null;
  cart_id:string;
  status:MarketplaceOrderStatus;
  payment_status:MarketplacePaymentStatus;
  currency:string;
  subtotal_minor:number;
  total_minor:number;
  fulfillment_mode:'PICKUP'|'LOCAL_DELIVERY'|'SHIPPING';
  delivery_name:string|null;
  delivery_phone:string|null;
  delivery_address_json:string|null;
  fitment_acknowledged:boolean;
  fitment_acknowledgement_text:string|null;
  placed_at:string;
  cancelled_at:string|null;
  cancellation_reason:string|null;
  created_at:string;
  updated_at:string;
}

export interface MarketplaceOrderItem{
  id:string;
  order_id:string;
  listing_id:string;
  product_id:string;
  seller_sku:string;
  title:string;
  quantity:number;
  unit_price_minor:number;
  line_total_minor:number;
  currency:string;
  listing_version:number;
  fitment_status:string|null;
  fitment_confidence:number|null;
  fitment_decision_id:string|null;
  created_at:string;
}

export interface MarketplaceOrderDetail{
  order:MarketplaceOrder;
  items:MarketplaceOrderItem[];
  reservations:Array<{
    id:string;
    listing_id:string;
    quantity:number;
    status:MarketplaceReservationStatus;
    held_at:string;
    released_at:string|null;
  }>;
  truth:{
    payment_captured:false;
    payment_available:false;
    seller_fulfillment_available:false;
  };
}

export interface PlaceMarketplaceOrderInput{
  fulfillment_mode:'PICKUP'|'LOCAL_DELIVERY'|'SHIPPING';
  delivery_name?:string|null;
  delivery_phone?:string|null;
  delivery_address?:Record<string,unknown>|null;
  fitment_acknowledged?:boolean;
  fitment_acknowledgement_text?:string|null;
}
