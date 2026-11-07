/**
 * Sprint 33 — Buyer–Seller Messaging, Notifications & Seller CRM Foundation
 *
 * Communication intent, provider attempts and provider-confirmed delivery are
 * separate facts. CRM projections use legitimate commercial relationships only.
 */
export type MarketplaceConversationContext='LISTING_INQUIRY'|'ORDER'|'RETURN'|'DISPUTE';
export type MarketplaceConversationStatus='OPEN'|'CLOSED';
export type MarketplaceMessageClassification='TRANSACTIONAL'|'PROMOTIONAL';
export type MarketplaceMessageSenderRole='BUYER'|'SELLER';
export type MarketplaceNotificationRecipientType='BUYER_USER'|'SELLER_STORE';
export type MarketplaceNotificationState='UNREAD'|'READ'|'DISMISSED';
export type MarketplaceExternalChannel='EMAIL'|'SMS'|'PUSH';
export type MarketplaceExternalDeliveryState='ATTEMPTED'|'ACCEPTED'|'DELIVERED'|'FAILED'|'BOUNCED';

export interface MarketplaceConversation{
  id:string; store_id:string; buyer_user_id:string; context_type:MarketplaceConversationContext;
  listing_id:string|null; order_id:string|null; return_id:string|null; dispute_id:string|null;
  subject:string; status:MarketplaceConversationStatus; created_by:string;
  created_at:string; updated_at:string; last_message_at:string|null;
}
export interface MarketplaceMessage{
  id:string; conversation_id:string; sender_user_id:string; sender_role:MarketplaceMessageSenderRole;
  classification:MarketplaceMessageClassification; body:string; created_at:string;
}
export interface MarketplaceCommunicationPreferences{
  user_id:string;
  transactional_email_requested:boolean; transactional_sms_requested:boolean; transactional_push_requested:boolean;
  promotional_in_app_enabled:boolean; promotional_email_opt_in:boolean; promotional_sms_opt_in:boolean; promotional_push_opt_in:boolean;
  quiet_hours_start:string|null; quiet_hours_end:string|null; timezone:string; updated_at:string;
}
export interface MarketplaceNotification{
  id:string; recipient_type:MarketplaceNotificationRecipientType; recipient_id:string;
  conversation_id:string; message_id:string; classification:MarketplaceMessageClassification;
  title:string; body:string; state:MarketplaceNotificationState;
  created_at:string; read_at:string|null; dismissed_at:string|null;
}
export interface MarketplaceExternalDelivery{
  id:string; notification_id:string; channel:MarketplaceExternalChannel; provider_key:string;
  provider_message_id:string|null; state:MarketplaceExternalDeliveryState; attempt_count:number;
  attempted_at:string; accepted_at:string|null; delivered_at:string|null; failed_at:string|null; bounced_at:string|null;
  failure_code:string|null; failure_message:string|null; updated_at:string;
}
export interface MarketplaceCrmRelationship{
  buyer_user_id:string; first_order_at:string; last_order_at:string; order_count:number;
  ordered_value_by_currency:Array<{currency:string;amount_minor:number}>;
  open_conversation_count:number; last_message_at:string|null;
}
