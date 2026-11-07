import { MarketplaceExternalChannel, MarketplaceExternalDeliveryState } from './types';

export interface MarketplaceNotificationAttemptInput{
  notification_id:string;
  channel:MarketplaceExternalChannel;
  recipient_reference:string;
  title:string;
  body:string;
  classification:'TRANSACTIONAL'|'PROMOTIONAL';
}

export interface MarketplaceNotificationAttemptResult{
  accepted:boolean;
  provider_message_id?:string|null;
  failure_code?:string|null;
  failure_message?:string|null;
}

export interface MarketplaceVerifiedDeliveryEvent{
  verified:boolean;
  provider_event_id:string;
  provider_message_id:string;
  state:Extract<MarketplaceExternalDeliveryState,'DELIVERED'|'FAILED'|'BOUNCED'>;
  occurred_at:string;
  failure_code?:string|null;
  failure_message?:string|null;
}

export interface MarketplaceNotificationAdapter{
  readonly providerKey:string;
  readonly channel:MarketplaceExternalChannel;
  attempt(input:MarketplaceNotificationAttemptInput):MarketplaceNotificationAttemptResult;
  verifyEvent(signature:string,payload:unknown):MarketplaceVerifiedDeliveryEvent;
}

class MarketplaceNotificationAdapterRegistry{
  private readonly adapters=new Map<string,MarketplaceNotificationAdapter>();
  private key(providerKey:string,channel:MarketplaceExternalChannel){return providerKey.trim().toUpperCase()+':'+channel;}
  register(adapter:MarketplaceNotificationAdapter){this.adapters.set(this.key(adapter.providerKey,adapter.channel),adapter);}
  get(providerKey:string,channel:MarketplaceExternalChannel){return this.adapters.get(this.key(providerKey,channel))||null;}
  list(){return [...this.adapters.values()].map(a=>({provider_key:a.providerKey,channel:a.channel}));}
  clear(){this.adapters.clear();}
}

export const marketplaceNotificationAdapterRegistry=new MarketplaceNotificationAdapterRegistry();
