import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { marketplaceGrowthRepository as repo, GrowthRange } from './marketplaceGrowthRepository';
import { MarketplaceGrowthWindow, MarketplacePlatformGrowthIntelligence, MarketplaceSellerGrowthIntelligence } from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function isoDay(value:string,field:string):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be YYYY-MM-DD',400);
  const parsed=Date.parse(value+'T00:00:00.000Z');
  if(Number.isNaN(parsed))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is invalid',400);
  return value;
}
function growthWindow(input:{from?:unknown;to?:unknown}):{current:GrowthRange;previous:GrowthRange;window:MarketplaceGrowthWindow}{
  const today=getCurrentUtcIsoString().slice(0,10);
  const to=isoDay(input.to===undefined?today:String(input.to),'to');
  const defaultFrom=new Date(Date.parse(to+'T00:00:00.000Z')-89*86400000).toISOString().slice(0,10);
  const from=isoDay(input.from===undefined?defaultFrom:String(input.from),'from');
  const fromMs=Date.parse(from+'T00:00:00.000Z'),toMs=Date.parse(to+'T00:00:00.000Z');
  if(toMs<fromMs)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'to must be on or after from',400);
  const days=Math.floor((toMs-fromMs)/86400000)+1;
  if(days>366)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Growth window cannot exceed 366 days',400);
  const previousToMs=fromMs-86400000,previousFromMs=previousToMs-(days-1)*86400000;
  const previousFrom=new Date(previousFromMs).toISOString().slice(0,10);
  const previousTo=new Date(previousToMs).toISOString().slice(0,10);
  return {
    current:{from:from+'T00:00:00.000Z',to:to+'T23:59:59.999Z'},
    previous:{from:previousFrom+'T00:00:00.000Z',to:previousTo+'T23:59:59.999Z'},
    window:{from,to,timezone:'UTC',days,comparison_from:previousFrom,comparison_to:previousTo}
  };
}
function retentionSummary(storeId:string|null,current:GrowthRange){
  return repo.retention(storeId,current,current.to);
}

export class MarketplaceGrowthService{
  seller(actor:AuthenticatedActorContext,storeId:string,input:{from?:unknown;to?:unknown}={}):MarketplaceSellerGrowthIntelligence{
    const store=marketplaceRepository.getStoreById(storeId);
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_ORDERS_READ,{organizationId:store.organization_id});
    const {current,previous,window}=growthWindow(input);
    const result:MarketplaceSellerGrowthIntelligence={
      store:{id:store.id,display_name:store.display_name,slug:store.slug,status:store.status},
      window,
      growth:repo.growthComparison(storeId,current,previous),
      retention:retentionSummary(storeId,current),
      categories:repo.categories(storeId,current),
      listing_signals:repo.listingSignals(storeId,current),
      opportunities:repo.opportunities(storeId,current),
      truth:{read_only:true,opaque_growth_score:false,opaque_churn_score:false,browsing_history_used:false,search_history_used:false,
        hidden_behavioral_profile_used:false,explicit_saved_intent_used:true,buyer_identities_exposed:false,automatic_seller_actions:false}
    };
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_SELLER_GROWTH_INTELLIGENCE_VIEWED',
      resource_type:'marketplace_store',resource_id:storeId,correlation_id:'growth:'+storeId+':'+window.from+':'+window.to,
      source:'MARKETPLACE_GROWTH_API',metadata:{window_from:window.from,window_to:window.to,buyer_identities_exposed:false,automatic_actions:false}});
    return result;
  }

  platform(actor:AuthenticatedActorContext,input:{from?:unknown;to?:unknown}={}):MarketplacePlatformGrowthIntelligence{
    if(!actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)){
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform administrator access required',403);
    }
    const {current,previous,window}=growthWindow(input);
    const stores=repo.stores().map((s:any)=>{
      const retention=retentionSummary(String(s.id),current);
      return {
        store_id:String(s.id),display_name:String(s.display_name),status:String(s.status),
        growth:repo.growthComparison(String(s.id),current,previous),
        retention:{eligible_30d:retention.eligible_30d,repeated_within_30d:retention.repeated_within_30d,
          repeat_30d_percent:retention.repeat_30d_percent,eligible_90d:retention.eligible_90d,
          repeated_within_90d:retention.repeated_within_90d,repeat_90d_percent:retention.repeat_90d_percent}
      };
    });
    const result:MarketplacePlatformGrowthIntelligence={
      window,growth:repo.growthComparison(null,current,previous),retention:retentionSummary(null,current),
      categories:repo.categories(null,current),stores,
      truth:{read_only:true,opaque_store_ranking:false,opaque_growth_score:false,churn_inferred:false,buyer_identities_exposed:false}
    };
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PLATFORM_GROWTH_INTELLIGENCE_VIEWED',
      resource_type:'marketplace_platform',resource_id:'marketplace',correlation_id:'growth:platform:'+window.from+':'+window.to,
      source:'MARKETPLACE_GROWTH_API',metadata:{window_from:window.from,window_to:window.to,buyer_identities_exposed:false}});
    return result;
  }
}
export const marketplaceGrowthService=new MarketplaceGrowthService();
