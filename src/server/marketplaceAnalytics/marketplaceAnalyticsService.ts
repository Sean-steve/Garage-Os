import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { getCurrentUtcIsoString } from '../domain/time';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { marketplaceAnalyticsRepository as repo, AnalyticsRange } from './marketplaceAnalyticsRepository';
import { MarketplaceAnalyticsWindow, MarketplacePlatformAnalytics, MarketplaceSellerAnalytics } from './types';

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function isoDay(value:string,field:string):string{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be YYYY-MM-DD',400);
  const parsed=Date.parse(value+'T00:00:00.000Z');
  if(Number.isNaN(parsed))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is invalid',400);
  return value;
}
function windowFrom(input:{from?:unknown;to?:unknown}):{range:AnalyticsRange;window:MarketplaceAnalyticsWindow}{
  const today=getCurrentUtcIsoString().slice(0,10);
  const to=isoDay(input.to===undefined?today:String(input.to),'to');
  const defaultFrom=new Date(Date.parse(to+'T00:00:00.000Z')-29*86400000).toISOString().slice(0,10);
  const from=isoDay(input.from===undefined?defaultFrom:String(input.from),'from');
  const fromMs=Date.parse(from+'T00:00:00.000Z'),toMs=Date.parse(to+'T00:00:00.000Z');
  if(toMs<fromMs)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'to must be on or after from',400);
  const days=Math.floor((toMs-fromMs)/86400000)+1;
  if(days>366)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Analytics window cannot exceed 366 days',400);
  return {range:{from:from+'T00:00:00.000Z',to:to+'T23:59:59.999Z'},window:{from,to,timezone:'UTC',days}};
}

export class MarketplaceAnalyticsService{
  seller(actor:AuthenticatedActorContext,storeId:string,input:{from?:unknown;to?:unknown}={}):MarketplaceSellerAnalytics{
    const store=marketplaceRepository.getStoreById(storeId);
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_ORDERS_READ,{organizationId:store.organization_id});
    const {range,window}=windowFrom(input);
    const result:MarketplaceSellerAnalytics={
      store:{id:store.id,display_name:store.display_name,slug:store.slug,status:store.status},
      window,money:repo.money(storeId,range),funnel:repo.funnel(storeId,range),operations:repo.operations(storeId),
      fulfillment:repo.fulfillment(storeId,range),trust:repo.trust(storeId,range),engagement:repo.engagement(storeId),
      top_listings:repo.topListings(storeId,range,10),daily:repo.daily(storeId,range),
      truth:{read_only_projection:true,opaque_seller_score:false,money_source:'SETTLEMENT_LEDGER',receivable_is_payout:false,
        disputes_are_context_not_guilt:true,buyer_identities_exposed:false,analytics_timezone:'UTC'}
    };
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_SELLER_ANALYTICS_VIEWED',
      resource_type:'marketplace_store',resource_id:storeId,correlation_id:'analytics:'+storeId+':'+window.from+':'+window.to,
      source:'MARKETPLACE_ANALYTICS_API',metadata:{window_from:window.from,window_to:window.to,buyer_identities_exposed:false}});
    return result;
  }

  platform(actor:AuthenticatedActorContext,input:{from?:unknown;to?:unknown}={}):MarketplacePlatformAnalytics{
    if(!actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)){
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform administrator access required',403);
    }
    const {range,window}=windowFrom(input),counts=repo.platformCounts(range);
    const result:MarketplacePlatformAnalytics={
      window,...counts,money:repo.money(null,range),store_performance:repo.platformStoreRows(range),daily:repo.daily(null,range),
      truth:{read_only_projection:true,opaque_store_ranking:false,seller_score:false,buyer_identities_exposed:false,
        disputes_are_context_not_guilt:true,receivable_is_payout:false}
    };
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_PLATFORM_ANALYTICS_VIEWED',
      resource_type:'marketplace_platform',resource_id:'marketplace',correlation_id:'analytics:platform:'+window.from+':'+window.to,
      source:'MARKETPLACE_ANALYTICS_API',metadata:{window_from:window.from,window_to:window.to,buyer_identities_exposed:false}});
    return result;
  }
}
export const marketplaceAnalyticsService=new MarketplaceAnalyticsService();
