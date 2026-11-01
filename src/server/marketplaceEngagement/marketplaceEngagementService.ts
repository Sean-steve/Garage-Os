import { AuthenticatedActorContext } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { authService } from '../identity/authService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { withTransaction } from '../database/transaction';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { marketplaceDiscoveryService } from '../marketplaceDiscovery/marketplaceDiscoveryService';
import { MarketplaceDiscoverySearchInput } from '../marketplaceDiscovery/types';
import { marketplaceEngagementRepository as repo } from './marketplaceEngagementRepository';
import {
  MarketplaceAlert, MarketplaceAlertEvaluationResult, MarketplaceAlertPreferences,
  MarketplaceAlertState, MarketplaceSavedListing, MarketplaceSavedSearch, MarketplaceSavedSearchStatus
} from './types';

const AVAILABLE_INVENTORY=new Set(['IN_STOCK','LOW_STOCK','MADE_TO_ORDER']);

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function requiredText(value:unknown,field:string,max:number):string{
  const v=String(value||'').trim();
  if(!v)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is required',400);
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is too long',400);
  return v;
}
function bool(value:unknown,defaultValue:boolean){
  return value===undefined?defaultValue:Boolean(value);
}
function timeOrNull(value:unknown,field:string):string|null{
  if(value===undefined||value===null||value==='')return null;
  const v=String(value);
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(v))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be HH:MM in 24-hour time',400);
  return v;
}
function cleanCriteria(input:any):MarketplaceDiscoverySearchInput{
  const c:MarketplaceDiscoverySearchInput={};
  if(input?.query!==undefined)c.query=String(input.query).trim().slice(0,160);
  if(input?.category!==undefined)c.category=String(input.category).trim().slice(0,80);
  if(input?.product_type!==undefined)c.product_type=String(input.product_type) as any;
  if(input?.condition!==undefined)c.condition=String(input.condition) as any;
  if(input?.brand!==undefined)c.brand=String(input.brand).trim().slice(0,120);
  if(input?.currency!==undefined)c.currency=String(input.currency).trim().toUpperCase().slice(0,3);
  if(input?.min_price_minor!==undefined)c.min_price_minor=Number(input.min_price_minor);
  if(input?.max_price_minor!==undefined)c.max_price_minor=Number(input.max_price_minor);
  if(input?.in_stock_only!==undefined)c.in_stock_only=Boolean(input.in_stock_only);
  if(input?.store_slug!==undefined)c.store_slug=String(input.store_slug).trim().slice(0,80);
  return c;
}

export class MarketplaceEngagementService{
  summary(actor:AuthenticatedActorContext){return repo.summary(actor.user_id);}

  listSavedListings(actor:AuthenticatedActorContext){return repo.listSavedListings(actor.user_id);}

  saveListing(actor:AuthenticatedActorContext,listingId:string,input:any={}){
    const existing=repo.getSavedListing(actor.user_id,listingId);
    if(existing)return {saved:existing,detail:repo.listSavedListings(actor.user_id).find(x=>x.saved.id===existing.id)!};
    const projection=repo.getProjection(listingId);
    if(!projection)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Discoverable marketplace listing not found',404);
    const now=getCurrentUtcIsoString();
    const v:MarketplaceSavedListing={
      id:generateCanonicalId('msaved'),user_id:actor.user_id,listing_id:listingId,
      price_minor_at_save:Number(projection.price_minor),inventory_status_at_save:String(projection.inventory_status),
      last_seen_price_minor:Number(projection.price_minor),last_seen_inventory_status:String(projection.inventory_status),
      price_drop_alert_enabled:bool(input?.price_drop_alert_enabled,true),restock_alert_enabled:bool(input?.restock_alert_enabled,true),
      saved_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      repo.createSavedListing(v);
      this.emit(actor,'marketplace.engagement.listing.saved',v.id,{marketplace_listing:listingId,marketplace_saved_listing:v.id},
        {saved_listing_id:v.id,listing_id:listingId,price_drop_alert_enabled:v.price_drop_alert_enabled,restock_alert_enabled:v.restock_alert_enabled},db);
      this.audit(actor,'MARKETPLACE_LISTING_SAVED','marketplace_saved_listing',v.id,{listing_id:listingId},db);
    });
    return {saved:v,detail:repo.listSavedListings(actor.user_id).find(x=>x.saved.id===v.id)!};
  }

  updateSavedListing(actor:AuthenticatedActorContext,id:string,input:any){
    const current=repo.getSavedListingById(id);
    if(!current||current.user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Saved listing not found',404);
    const next={...current,price_drop_alert_enabled:bool(input?.price_drop_alert_enabled,current.price_drop_alert_enabled),
      restock_alert_enabled:bool(input?.restock_alert_enabled,current.restock_alert_enabled),updated_at:getCurrentUtcIsoString()};
    repo.updateSavedListing(next);return next;
  }

  removeSavedListing(actor:AuthenticatedActorContext,id:string){
    const current=repo.getSavedListingById(id);
    if(!current||current.user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Saved listing not found',404);
    if(!repo.removeSavedListing(actor.user_id,id))throw new CanonicalAppError(ErrorCode.CONFLICT,'Saved listing removal failed',409);
    return {removed:true,id};
  }

  listSavedSearches(actor:AuthenticatedActorContext){return repo.listSavedSearches(actor.user_id);}

  createSavedSearch(actor:AuthenticatedActorContext,input:any){
    const criteria=cleanCriteria(input?.criteria||{});
    const vehicleId=input?.vehicle_id?String(input.vehicle_id):null;
    const preview=marketplaceDiscoveryService.search(actor,{...criteria,vehicle_id:vehicleId||undefined,
      include_unknown_fitment:vehicleId?false:true,limit:50,offset:0});
    const now=getCurrentUtcIsoString();
    const v:MarketplaceSavedSearch={id:generateCanonicalId('msearch'),user_id:actor.user_id,
      name:requiredText(input?.name,'name',120),criteria,vehicle_id:vehicleId,
      new_match_alert_enabled:bool(input?.new_match_alert_enabled,true),status:'ACTIVE',created_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.createSavedSearch(v);
      for(const item of preview.items)repo.markSearchMatch(v.id,item.listing_id,now,now);
      this.emit(actor,'marketplace.engagement.search.saved',v.id,{marketplace_saved_search:v.id},
        {saved_search_id:v.id,name:v.name,vehicle_context:Boolean(vehicleId),baseline_match_count:preview.items.length},db);
      this.audit(actor,'MARKETPLACE_SEARCH_SAVED','marketplace_saved_search',v.id,
        {vehicle_context:Boolean(vehicleId),criteria_keys:Object.keys(criteria)},db);
    });
    return {saved_search:v,baseline_match_count:preview.items.length,truth:{
      explicit_user_intent:true,browsing_history_persisted:false,existing_results_do_not_trigger_alerts:true
    }};
  }

  updateSavedSearch(actor:AuthenticatedActorContext,id:string,input:any){
    const current=repo.getSavedSearch(id);
    if(!current||current.user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Saved search not found',404);
    const status=(input?.status===undefined?current.status:String(input.status).toUpperCase()) as MarketplaceSavedSearchStatus;
    if(!['ACTIVE','PAUSED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'status must be ACTIVE or PAUSED',400);
    const next={...current,name:input?.name===undefined?current.name:requiredText(input.name,'name',120),
      new_match_alert_enabled:bool(input?.new_match_alert_enabled,current.new_match_alert_enabled),status,updated_at:getCurrentUtcIsoString()};
    repo.updateSavedSearch(next);return next;
  }

  removeSavedSearch(actor:AuthenticatedActorContext,id:string){
    const current=repo.getSavedSearch(id);
    if(!current||current.user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Saved search not found',404);
    if(!repo.removeSavedSearch(actor.user_id,id))throw new CanonicalAppError(ErrorCode.CONFLICT,'Saved search removal failed',409);
    return {removed:true,id};
  }

  getPreferences(actor:AuthenticatedActorContext){
    const p=repo.getPreferences(actor.user_id)||this.defaultPreferences(actor.user_id);
    return {preferences:p,delivery_availability:{
      in_app:true,email:false,sms:false,push:false
    },truth:{external_delivery_attempted:false,external_channels_require_real_adapters:true}};
  }

  updatePreferences(actor:AuthenticatedActorContext,input:any){
    const current=repo.getPreferences(actor.user_id)||this.defaultPreferences(actor.user_id);
    const cap=input?.max_alerts_per_day===undefined?current.max_alerts_per_day:Number(input.max_alerts_per_day);
    if(!Number.isInteger(cap)||cap<1||cap>50)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'max_alerts_per_day must be 1 to 50',400);
    const start=input?.quiet_hours_start===undefined?current.quiet_hours_start:timeOrNull(input.quiet_hours_start,'quiet_hours_start');
    const end=input?.quiet_hours_end===undefined?current.quiet_hours_end:timeOrNull(input.quiet_hours_end,'quiet_hours_end');
    if((start===null)!==(end===null))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'quiet hours require both start and end',400);
    const next:MarketplaceAlertPreferences={user_id:actor.user_id,
      in_app_enabled:bool(input?.in_app_enabled,current.in_app_enabled),
      email_requested:bool(input?.email_requested,current.email_requested),
      sms_requested:bool(input?.sms_requested,current.sms_requested),
      push_requested:bool(input?.push_requested,current.push_requested),
      max_alerts_per_day:cap,quiet_hours_start:start,quiet_hours_end:end,updated_at:getCurrentUtcIsoString()};
    repo.upsertPreferences(next);
    return {preferences:next,delivery_availability:{in_app:true,email:false,sms:false,push:false},
      truth:{requested_external_channels_do_not_imply_delivery:true,external_delivery_attempted:false}};
  }

  listAlerts(actor:AuthenticatedActorContext,state?:string){
    if(state&&!['UNREAD','READ','DISMISSED'].includes(state))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid alert state',400);
    return repo.listAlerts(actor.user_id,state);
  }
  updateAlertState(actor:AuthenticatedActorContext,id:string,state:MarketplaceAlertState){
    if(!['READ','DISMISSED'].includes(state))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'state must be READ or DISMISSED',400);
    const current=repo.getAlert(id);
    if(!current||current.user_id!==actor.user_id)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Alert not found',404);
    const now=getCurrentUtcIsoString();
    const next={...current,state,read_at:state==='READ'?(current.read_at||now):current.read_at,dismissed_at:state==='DISMISSED'?now:current.dismissed_at};
    repo.updateAlert(next);return next;
  }

  evaluateForUser(actor:AuthenticatedActorContext,onlyListingId?:string):MarketplaceAlertEvaluationResult{
    const prefs=repo.getPreferences(actor.user_id)||this.defaultPreferences(actor.user_id);
    let alertsCreated=0,savedListingsEvaluated=0,savedSearchesEvaluated=0,limited=false;
    const dayStart=getCurrentUtcIsoString().slice(0,10)+'T00:00:00.000Z';
    let used=repo.alertCountSince(actor.user_id,dayStart);
    const canAlert=()=>prefs.in_app_enabled&&used<prefs.max_alerts_per_day;
    const commitAlert=(a:MarketplaceAlert)=>{
      if(!canAlert()){limited=used>=prefs.max_alerts_per_day;return false;}
      const created=repo.createAlert(a);
      if(created){used++;alertsCreated++;this.emit(actor,'marketplace.engagement.alert.created',a.id,
        {...(a.listing_id?{marketplace_listing:a.listing_id}:{}),marketplace_alert:a.id},
        {alert_id:a.id,alert_type:a.alert_type,delivery_channel:'IN_APP',external_delivery_attempted:false},undefined,
        DataProvenanceClass.DERIVED_DETERMINISTIC);}
      return created;
    };

    for(const detail of repo.listSavedListings(actor.user_id)){
      if(onlyListingId&&detail.saved.listing_id!==onlyListingId)continue;
      savedListingsEvaluated++;
      const s=detail.saved,current=repo.getAnyListingState(s.listing_id);
      if(!current)continue;
      const discoverable=Boolean(repo.getProjection(s.listing_id));
      const price=Number(current.price_minor),inventory=String(current.inventory_status);
      let alertCondition=false,delivered=false;
      if(discoverable&&s.price_drop_alert_enabled&&price<s.last_seen_price_minor){
        alertCondition=true;
        delivered=commitAlert(this.buildAlert(actor.user_id,'SAVED_LISTING_PRICE_DROP',s.listing_id,s.id,null,
          'saved:'+s.id+':price:'+price,'Price dropped on '+String(current.title),
          'Price decreased from '+s.last_seen_price_minor+' to '+price+' minor units.'));
      }
      if(discoverable&&s.restock_alert_enabled&&!AVAILABLE_INVENTORY.has(s.last_seen_inventory_status)&&AVAILABLE_INVENTORY.has(inventory)){
        alertCondition=true;
        delivered=commitAlert(this.buildAlert(actor.user_id,'SAVED_LISTING_RESTOCK',s.listing_id,s.id,null,
          'saved:'+s.id+':restock:'+inventory+':'+String(current.status),'Back in stock: '+String(current.title),
          'Your saved listing is available again ('+inventory.replaceAll('_',' ').toLowerCase()+').'))||delivered;
      }
      if(!alertCondition||delivered){
        repo.updateSavedListing({...s,last_seen_price_minor:price,last_seen_inventory_status:inventory,updated_at:getCurrentUtcIsoString()});
      }
    }

    for(const search of repo.listSavedSearches(actor.user_id)){
      if(search.status!=='ACTIVE'||!search.new_match_alert_enabled)continue;
      savedSearchesEvaluated++;
      const result=marketplaceDiscoveryService.search(actor,{...search.criteria,vehicle_id:search.vehicle_id||undefined,
        include_unknown_fitment:search.vehicle_id?false:true,limit:50,offset:0});
      const now=getCurrentUtcIsoString();
      for(const item of result.items){
        if(onlyListingId&&item.listing_id!==onlyListingId)continue;
        if(repo.hasSearchMatch(search.id,item.listing_id)){repo.markSearchMatch(search.id,item.listing_id,now,null);continue;}
        const created=commitAlert(this.buildAlert(actor.user_id,'SAVED_SEARCH_NEW_MATCH',item.listing_id,null,search.id,
          'search:'+search.id+':listing:'+item.listing_id,'New match for '+search.name,
          item.title+' now matches your explicitly saved marketplace search.'));
        if(created)repo.markSearchMatch(search.id,item.listing_id,now,now);
        if(!canAlert()){limited=used>=prefs.max_alerts_per_day;break;}
      }
    }
    return {user_id:actor.user_id,alerts_created:alertsCreated,saved_listings_evaluated:savedListingsEvaluated,
      saved_searches_evaluated:savedSearchesEvaluated,limited_by_daily_cap:limited,truth:{
        in_app_authoritative:true,external_delivery_attempted:false,email_delivery_available:false,
        sms_delivery_available:false,push_delivery_available:false
      }};
  }

  evaluateListingChangeInternal(listingId:string){
    const users=new Set<string>([...repo.listSavedListingOwners(listingId),...repo.listActiveSavedSearchUsers()]);
    const results:MarketplaceAlertEvaluationResult[]=[];
    for(const userId of users){
      const actor=authService.getActorContextById(userId);
      if(!actor||actor.account_status!=='ACTIVE')continue;
      results.push(this.evaluateForUser(actor,listingId));
    }
    return {listing_id:listingId,users_evaluated:results.length,alerts_created:results.reduce((n,r)=>n+r.alerts_created,0)};
  }

  sellerEngagement(actor:AuthenticatedActorContext,storeId:string){
    const store=marketplaceRepository.getStoreById(storeId);
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_PRODUCTS_READ,{organizationId:store.organization_id});
    return repo.sellerEngagement(storeId);
  }

  private defaultPreferences(userId:string):MarketplaceAlertPreferences{
    return {user_id:userId,in_app_enabled:true,email_requested:false,sms_requested:false,push_requested:false,
      max_alerts_per_day:20,quiet_hours_start:null,quiet_hours_end:null,updated_at:getCurrentUtcIsoString()};
  }
  private buildAlert(userId:string,type:MarketplaceAlert['alert_type'],listingId:string|null,savedListingId:string|null,
    savedSearchId:string|null,fingerprint:string,title:string,body:string):MarketplaceAlert{
    return {id:generateCanonicalId('malert'),user_id:userId,alert_type:type,listing_id:listingId,
      saved_listing_id:savedListingId,saved_search_id:savedSearchId,fingerprint,title,body,state:'UNREAD',
      created_at:getCurrentUtcIsoString(),read_at:null,dismissed_at:null};
  }
  private emit(actor:AuthenticatedActorContext,type:string,correlationId:string,subjects:Record<string,string>,payload:any,db?:any,
    provenance:DataProvenanceClass=DataProvenanceClass.OWNER_ASSERTED){
    enqueueOutboxEvent(createCanonicalEventEnvelope({type,producer:'garage-os-marketplace-engagement',correlation_id:correlationId,
      subject_ids:subjects,actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:provenance,payload}),db);
  }
  private audit(actor:AuthenticatedActorContext,action:string,resourceType:string,resourceId:string,after:any,db?:any){
    recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action,resource_type:resourceType,resource_id:resourceId,
      correlation_id:resourceId,source:'MARKETPLACE_ENGAGEMENT_API',after_state:after},db);
  }
}
export const marketplaceEngagementService=new MarketplaceEngagementService();
