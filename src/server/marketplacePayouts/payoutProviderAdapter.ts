import { MarketplacePayout, MarketplacePayoutBatch, MarketplacePayoutProvider } from './types';

/**
 * Sprint 32 payout adapter contract.
 *
 * No live provider is fabricated here. Sprint 40 activates concrete outbound
 * adapters. Until then Finance can prepare a truthful provider handoff payload
 * while provider callbacks remain the only authority for processing/success.
 */
export interface MarketplacePayoutProviderAdapter{
  prepareBatchHandoff(
    provider:MarketplacePayoutProvider,
    batch:MarketplacePayoutBatch,
    payouts:Array<MarketplacePayout&{provider_account_ref:string}>
  ):{
    type:'EXTERNAL_PROVIDER_HANDOFF_REQUIRED';
    execution_performed:false;
    provider_key:string;
    batch_reference:string;
    currency:string;
    payouts:Array<{
      payout_id:string;
      payout_number:string;
      provider_account_ref:string;
      amount_minor:number;
      currency:string;
    }>;
  };
}

export class ManualPayoutProviderHandoffAdapter implements MarketplacePayoutProviderAdapter{
  prepareBatchHandoff(provider:MarketplacePayoutProvider,batch:MarketplacePayoutBatch,payouts:Array<MarketplacePayout&{provider_account_ref:string}>){
    return {
      type:'EXTERNAL_PROVIDER_HANDOFF_REQUIRED' as const,
      execution_performed:false as const,
      provider_key:provider.provider_key,
      batch_reference:batch.batch_number,
      currency:batch.currency,
      payouts:payouts.map(p=>({
        payout_id:p.id,payout_number:p.payout_number,provider_account_ref:p.provider_account_ref,
        amount_minor:p.amount_minor,currency:p.currency
      }))
    };
  }
}
export const marketplacePayoutProviderAdapter=new ManualPayoutProviderHandoffAdapter();
