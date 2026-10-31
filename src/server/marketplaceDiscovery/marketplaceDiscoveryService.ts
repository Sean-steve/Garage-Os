import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplaceRepository } from '../marketplace/marketplaceRepository';
import { fitmentService } from '../fitment/fitmentService';
import { marketplaceDiscoveryRepository as repo } from './marketplaceDiscoveryRepository';
import {
  MarketplaceDiscoveryItem, MarketplaceDiscoveryResult, MarketplaceDiscoverySearchInput,
  MarketplaceDiscoverySort, MarketplaceMerchandisingCollection, MarketplaceMerchandisingItem,
  MarketplaceMerchandisingSurface, MarketplaceMerchandisingStatus, MarketplaceRankComponent,
  MarketplaceRecommendationItem
} from './types';

const FITMENT_POSITIVE=new Set(['GENERIC','SELLER_CLAIMED','PROBABLE','CONFIRMED']);
const FITMENT_BLOCKED=new Set(['CONFLICT','NOT_COMPATIBLE']);

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}
function requiredText(value:unknown,field:string,max:number):string{
  const v=String(value||'').trim();
  if(!v)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is required',400);
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' is too long',400);
  return v;
}
function optionalText(value:unknown,max:number):string|null{
  if(value===undefined||value===null)return null;
  const v=String(value).trim();return v?v.slice(0,max):null;
}
function slug(value:unknown):string{
  const v=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)||v.length<2||v.length>80){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'slug must contain lowercase letters/numbers separated by hyphens',400);
  }
  return v;
}
function dateOrNull(value:unknown,field:string):string|null{
  if(value===undefined||value===null||value==='')return null;
  const v=String(value);
  if(Number.isNaN(Date.parse(v)))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be an ISO date-time',400);
  return new Date(v).toISOString();
}
function money(value:unknown,field:string):number|undefined{
  if(value===undefined||value===null||value==='')return undefined;
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,field+' must be a non-negative minor-unit integer',400);
  return n;
}
function normalizeQuery(value:unknown):string{
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9\-_. ]+/g,' ').replace(/\s+/g,' ').slice(0,160);
}
function tokenAlternatives(token:string):string[]{
  const aliases:Record<string,string[]>={
    tyre:['tyre','tire'],tire:['tire','tyre'],headlamp:['headlamp','headlight'],headlight:['headlight','headlamp'],
    windscreen:['windscreen','windshield'],windshield:['windshield','windscreen']
  };
  return aliases[token]||[token];
}
function rankScore(value:number){return Math.round(value*100)/100;}

export class MarketplaceDiscoveryService{
  search(actor:AuthenticatedActorContext,input:MarketplaceDiscoverySearchInput={}):MarketplaceDiscoveryResult{
    const query=normalizeQuery(input.query);
    const tokens=query?query.split(' ').filter(Boolean).slice(0,10):[];
    const min=money(input.min_price_minor,'min_price_minor'),max=money(input.max_price_minor,'max_price_minor');
    if(min!==undefined&&max!==undefined&&max<min)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'max_price_minor must be >= min_price_minor',400);
    const limit=Math.max(1,Math.min(50,Math.trunc(Number(input.limit||24))));
    const offset=Math.max(0,Math.trunc(Number(input.offset||0)));
    const sort=(input.sort||'RELEVANCE') as MarketplaceDiscoverySort;
    if(!['RELEVANCE','PRICE_ASC','PRICE_DESC','RATING'].includes(sort))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid discovery sort',400);

    const rows=repo.searchRows({
      tokens:tokens.map(tokenAlternatives),category:input.category,product_type:input.product_type,condition:input.condition,
      brand:input.brand,currency:input.currency,min_price_minor:min,max_price_minor:max,
      in_stock_only:Boolean(input.in_stock_only),store_slug:input.store_slug
    });

    let candidates=rows.map(row=>this.rankBase(row,query,tokens));
    // Evaluate the strongest deterministic candidates before vehicle fitment to bound work.
    candidates.sort((a,b)=>b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    if(input.vehicle_id){
      const fitmentCandidates=candidates.slice(0,150);
      const includeUnknown=input.include_unknown_fitment!==false;
      const evaluated:MarketplaceDiscoveryItem[]=[];
      for(const item of fitmentCandidates){
        const decision=fitmentService.evaluateListing(actor,item.listing_id,input.vehicle_id,false);
        if(FITMENT_BLOCKED.has(decision.status))continue;
        if(decision.status==='UNKNOWN'&&!includeUnknown)continue;
        const fitScore=this.fitmentScore(decision.status);
        const components=[...item.rank_components];
        if(fitScore!==0)components.push({key:'FITMENT',score:fitScore,reason:'Vehicle fitment evidence: '+decision.status.replaceAll('_',' ').toLowerCase()+'.'});
        evaluated.push({...item,fitment:decision,rank_components:components,organic_score:rankScore(item.organic_score+fitScore)});
      }
      candidates=evaluated;
    }

    this.sortItems(candidates,sort);
    const total=candidates.length;
    const page=candidates.slice(offset,offset+limit).map((item,index)=>({...item,organic_rank:offset+index+1}));
    return {items:page,total,limit,offset,query_normalized:query||null,sort,truth:{
      deterministic_ranking:true,ranking_explainable:true,merchandising_affects_organic_ranking:false,
      paid_placement_supported:false,fitment_guaranteed:false,raw_search_history_persisted:false
    }};
  }

  recommendationsForVehicle(actor:AuthenticatedActorContext,vehicleId:string,input:MarketplaceDiscoverySearchInput={}){
    const result=this.search(actor,{...input,vehicle_id:vehicleId,include_unknown_fitment:false,sort:'RELEVANCE',
      limit:Math.min(Number(input.limit||12),24),offset:0});
    const items=result.items.filter(x=>x.fitment&&FITMENT_POSITIVE.has(x.fitment.status)).map(x=>this.asRecommendation(x,[
      'Vehicle-aware recommendation from current structured fitment evidence.',
      'Known conflict and NOT_COMPATIBLE decisions are excluded.',
      'Compatibility is not guaranteed; verify specifications before purchase.'
    ]));
    return {vehicle_id:vehicleId,items,total:items.length,truth:{...result.truth,
      behavioral_profile_used:false,vehicle_context_used:true,unknown_fitment_recommended:false}};
  }

  relatedToListing(actor:AuthenticatedActorContext,listingId:string,vehicleId?:string|null,limit=12){
    const seed=getDatabase().prepare(
      'SELECT * FROM marketplace_listing_search_projection WHERE listing_id=? AND is_discoverable=1 LIMIT 1'
    ).get(listingId) as any;
    if(!seed)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    const result=this.search(actor,{category:String(seed.category_code),vehicle_id:vehicleId||undefined,
      include_unknown_fitment:vehicleId?false:true,limit:50,offset:0,sort:'RELEVANCE'});
    const items=result.items.filter(x=>x.listing_id!==listingId).map(item=>{
      let boost=20;const reasons=['Same marketplace category: '+String(seed.category_name)+'.'];
      if(seed.brand&&item.brand&&String(seed.brand).toLowerCase()===String(item.brand).toLowerCase()){
        boost+=12;reasons.push('Same brand as the viewed listing.');
      }
      if(vehicleId&&item.fitment)reasons.push('Vehicle fitment evidence: '+item.fitment.status.replaceAll('_',' ').toLowerCase()+'.');
      const components=[...item.rank_components,{key:'RELATEDNESS' as const,score:boost,reason:reasons.join(' ')}];
      return this.asRecommendation({...item,organic_score:rankScore(item.organic_score+boost),rank_components:components},reasons);
    });
    items.sort((a,b)=>b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    return {seed_listing_id:listingId,vehicle_id:vehicleId||null,items:items.slice(0,Math.max(1,Math.min(24,limit))).map((x,i)=>({...x,organic_rank:i+1})),
      truth:{deterministic:true,merchandising_affects_recommendations:false,paid_placement_supported:false,
        behavioral_profile_used:false,fitment_guaranteed:false}};
  }

  listPublicCollections(surface:MarketplaceMerchandisingSurface,storeId?:string|null,categoryCode?:string|null){
    if(!['HOME','STORE','CATEGORY'].includes(surface))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid merchandising surface',400);
    if(surface==='STORE'&&!storeId)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'store_id is required for STORE surface',400);
    if(surface==='CATEGORY'&&!categoryCode)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'category is required for CATEGORY surface',400);
    return {collections:repo.listActive({surface,storeId,categoryCode,now:getCurrentUtcIsoString()}).map(x=>repo.detail(x)),
      truth:{paid_placement_supported:false,affects_organic_ranking:false,source_labels_required:true}};
  }

  listSellerCollections(actor:AuthenticatedActorContext,storeId:string){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_READ);
    return repo.listStoreCollections(storeId).map(x=>repo.detail(x));
  }
  createSellerCollection(actor:AuthenticatedActorContext,storeId:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE);
    return this.createCollection(actor,'STORE',storeId,input);
  }
  updateSellerCollection(actor:AuthenticatedActorContext,storeId:string,id:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE);
    const current=repo.getCollection(id);
    if(!current||current.owner_type!=='STORE'||current.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Collection not found',404);
    return this.updateCollection(actor,current,input);
  }
  replaceSellerCollectionItems(actor:AuthenticatedActorContext,storeId:string,id:string,input:any){
    this.requireStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE);
    const current=repo.getCollection(id);
    if(!current||current.owner_type!=='STORE'||current.store_id!==storeId)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Collection not found',404);
    return this.replaceItems(actor,current,input?.listing_ids);
  }

  listPlatformCollections(actor:AuthenticatedActorContext){this.requirePlatformAdmin(actor);return repo.listPlatformCollections().map(x=>repo.detail(x));}
  createPlatformCollection(actor:AuthenticatedActorContext,input:any){this.requirePlatformAdmin(actor);return this.createCollection(actor,'PLATFORM',null,input);}
  updatePlatformCollection(actor:AuthenticatedActorContext,id:string,input:any){
    this.requirePlatformAdmin(actor);const current=repo.getCollection(id);
    if(!current||current.owner_type!=='PLATFORM')throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Collection not found',404);
    return this.updateCollection(actor,current,input);
  }
  replacePlatformCollectionItems(actor:AuthenticatedActorContext,id:string,input:any){
    this.requirePlatformAdmin(actor);const current=repo.getCollection(id);
    if(!current||current.owner_type!=='PLATFORM')throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Collection not found',404);
    return this.replaceItems(actor,current,input?.listing_ids);
  }

  private rankBase(row:any,query:string,tokens:string[]):MarketplaceDiscoveryItem{
    const components:MarketplaceRankComponent[]=[];
    let score=0;
    if(query){
      const title=String(row.title||'').toLowerCase(),brand=String(row.brand||'').toLowerCase(),
        category=String(row.category_name||'').toLowerCase(),description=String(row.description||'').toLowerCase(),
        store=String(row.store_name||'').toLowerCase(),searchText=String(row.search_text||'').toLowerCase();
      let qScore=0;
      if(title===query)qScore+=70;
      else if(title.startsWith(query))qScore+=45;
      else if(title.includes(query))qScore+=32;
      if(brand===query)qScore+=18;
      if(category===query||String(row.category_code||'').toLowerCase()===query)qScore+=14;
      for(const token of tokens){
        const alternatives=tokenAlternatives(token);
        if(alternatives.some(x=>title.includes(x)))qScore+=14;
        else if(alternatives.some(x=>brand.includes(x)))qScore+=8;
        else if(alternatives.some(x=>category.includes(x)))qScore+=6;
        else if(alternatives.some(x=>description.includes(x)))qScore+=3;
        else if(alternatives.some(x=>store.includes(x)))qScore+=2;
        else if(alternatives.some(x=>searchText.includes(x)))qScore+=4;
      }
      score+=qScore;components.push({key:'QUERY',score:qScore,reason:'Deterministic title, brand, category, description and part-reference relevance.'});
    }
    const availabilityScores:Record<string,number>={IN_STOCK:12,LOW_STOCK:8,MADE_TO_ORDER:6,UNKNOWN:0,OUT_OF_STOCK:-12};
    const aScore=availabilityScores[String(row.inventory_status)]??0;score+=aScore;
    components.push({key:'AVAILABILITY',score:aScore,reason:'Inventory state: '+String(row.inventory_status).replaceAll('_',' ').toLowerCase()+'.'});
    const reviewCount=Number(row.verified_review_count||0),avg=row.average_rating===null||row.average_rating===undefined?null:Number(row.average_rating);
    const trustScore=avg===null?0:(avg*1.5)+Math.min(reviewCount,20)*0.2;score+=trustScore;
    components.push({key:'TRUST',score:rankScore(trustScore),reason:avg===null?'No published verified-purchase rating yet.':
      reviewCount+' verified review(s), average '+rankScore(avg)+'/5.'});
    return {...repo.toCard(row),organic_rank:0,organic_score:rankScore(score),rank_components:components,
      trust:{verified_review_count:reviewCount,average_rating:avg===null?null:rankScore(avg)},fitment:null,
      merchandising:{affects_organic_ranking:false,promoted:false}};
  }
  private fitmentScore(status:string){
    const scores:Record<string,number>={CONFIRMED:40,PROBABLE:30,GENERIC:18,SELLER_CLAIMED:12,UNKNOWN:0};
    return scores[status]??0;
  }
  private sortItems(items:MarketplaceDiscoveryItem[],sort:MarketplaceDiscoverySort){
    if(sort==='PRICE_ASC')items.sort((a,b)=>a.price_minor-b.price_minor||b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    else if(sort==='PRICE_DESC')items.sort((a,b)=>b.price_minor-a.price_minor||b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    else if(sort==='RATING')items.sort((a,b)=>(b.trust.average_rating||0)-(a.trust.average_rating||0)||b.trust.verified_review_count-a.trust.verified_review_count||b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    else items.sort((a,b)=>b.organic_score-a.organic_score||a.listing_id.localeCompare(b.listing_id));
    items.forEach((x,i)=>x.organic_rank=i+1);
  }
  private asRecommendation(item:MarketplaceDiscoveryItem,reasons:string[]):MarketplaceRecommendationItem{
    return {...item,recommendation_reasons:reasons};
  }

  private createCollection(actor:AuthenticatedActorContext,owner:'PLATFORM'|'STORE',storeId:string|null,input:any){
    const surface=String(input?.surface||'').toUpperCase() as MarketplaceMerchandisingSurface;
    if(owner==='STORE'&&surface!=='STORE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Seller collections are storefront-only and cannot affect global/category merchandising',409);
    if(owner==='PLATFORM'&&!['HOME','CATEGORY'].includes(surface))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Platform surface must be HOME or CATEGORY',400);
    const category=surface==='CATEGORY'?requiredText(input?.category_code,'category_code',80).toUpperCase():null;
    if(category&&!marketplaceRepository.listCategories().some(x=>x.code===category))throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace category not found',404);
    const starts=dateOrNull(input?.starts_at,'starts_at'),ends=dateOrNull(input?.ends_at,'ends_at');
    if(starts&&ends&&Date.parse(ends)<Date.parse(starts))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'ends_at must be after starts_at',400);
    const now=getCurrentUtcIsoString();
    const v:MarketplaceMerchandisingCollection={id:generateCanonicalId('mcollection'),owner_type:owner,store_id:storeId,
      slug:slug(input?.slug),title:requiredText(input?.title,'title',160),description:optionalText(input?.description,1200),
      surface,category_code:category,status:'DRAFT',source_label:owner==='PLATFORM'?'PLATFORM_CURATED':'SELLER_CURATED',
      starts_at:starts,ends_at:ends,created_by:actor.user_id,created_at:now,updated_at:now};
    withTransaction(({db})=>{
      repo.createCollection(v);this.emit(actor,'marketplace.merchandising.collection.created',v.id,v.store_id,{collection_id:v.id,
        owner_type:v.owner_type,surface:v.surface,source_label:v.source_label,paid_placement:false,affects_organic_ranking:false},db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_MERCHANDISING_COLLECTION_CREATED',
        resource_type:'marketplace_merchandising_collection',resource_id:v.id,correlation_id:v.id,source:'MARKETPLACE_DISCOVERY_API',
        after_state:{owner_type:v.owner_type,store_id:v.store_id,surface:v.surface,source_label:v.source_label,status:v.status}},db);
    });
    return repo.detail(v);
  }
  private updateCollection(actor:AuthenticatedActorContext,current:MarketplaceMerchandisingCollection,input:any){
    if(current.status==='RETIRED')throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Retired collection is immutable',409);
    const status=(input?.status===undefined?current.status:String(input.status).toUpperCase()) as MarketplaceMerchandisingStatus;
    if(!['DRAFT','ACTIVE','PAUSED','RETIRED'].includes(status))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid collection status',400);
    const surface=input?.surface===undefined?current.surface:String(input.surface).toUpperCase() as MarketplaceMerchandisingSurface;
    if(current.owner_type==='STORE'&&surface!=='STORE')throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Seller collections are storefront-only',409);
    if(current.owner_type==='PLATFORM'&&!['HOME','CATEGORY'].includes(surface))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Platform surface must be HOME or CATEGORY',400);
    const category=surface==='CATEGORY'
      ?(input?.category_code===undefined?current.category_code:requiredText(input.category_code,'category_code',80).toUpperCase())
      :null;
    if(category&&!marketplaceRepository.listCategories().some(x=>x.code===category))throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace category not found',404);
    const starts=input?.starts_at===undefined?current.starts_at:dateOrNull(input.starts_at,'starts_at');
    const ends=input?.ends_at===undefined?current.ends_at:dateOrNull(input.ends_at,'ends_at');
    if(starts&&ends&&Date.parse(ends)<Date.parse(starts))throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'ends_at must be after starts_at',400);
    if(status==='ACTIVE'&&repo.listItems(current.id).length===0)throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Collection needs at least one discoverable listing before activation',409);
    const next={...current,slug:input?.slug===undefined?current.slug:slug(input.slug),
      title:input?.title===undefined?current.title:requiredText(input.title,'title',160),
      description:input?.description===undefined?current.description:optionalText(input.description,1200),
      surface,category_code:category,status,starts_at:starts,ends_at:ends,updated_at:getCurrentUtcIsoString()};
    withTransaction(({db})=>{
      repo.updateCollection(next);this.emit(actor,'marketplace.merchandising.collection.updated',next.id,next.store_id,
        {collection_id:next.id,status:next.status,surface:next.surface,source_label:next.source_label,affects_organic_ranking:false},db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_MERCHANDISING_COLLECTION_UPDATED',
        resource_type:'marketplace_merchandising_collection',resource_id:next.id,correlation_id:next.id,source:'MARKETPLACE_DISCOVERY_API',
        after_state:{status:next.status,surface:next.surface,source_label:next.source_label}},db);
    });
    return repo.detail(next);
  }
  private replaceItems(actor:AuthenticatedActorContext,current:MarketplaceMerchandisingCollection,listingIdsInput:unknown){
    const ids=Array.isArray(listingIdsInput)?Array.from(new Set(listingIdsInput.map(String).filter(Boolean))):[];
    if(ids.length>50)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'A merchandising collection may contain at most 50 listings',400);
    const now=getCurrentUtcIsoString();const items:MarketplaceMerchandisingItem[]=[];
    ids.forEach((id,index)=>{
      const row=getDatabase().prepare('SELECT listing_id,store_id,is_discoverable FROM marketplace_listing_search_projection WHERE listing_id=?').get(id) as any;
      if(!row||!Boolean(row.is_discoverable))throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Every merchandising item must be a currently discoverable listing',409);
      if(current.owner_type==='STORE'&&String(row.store_id)!==current.store_id)throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Seller collection can include only listings from its own store',403);
      items.push({id:generateCanonicalId('mcollectionitem'),collection_id:current.id,listing_id:id,sort_order:index,
        added_by:actor.user_id,created_at:now});
    });
    withTransaction(({db})=>{
      repo.replaceItems(current.id,items);this.emit(actor,'marketplace.merchandising.items.replaced',current.id,current.store_id,
        {collection_id:current.id,item_count:items.length,affects_organic_ranking:false,paid_placement:false},db);
      recordAuditEvent({actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_MERCHANDISING_ITEMS_REPLACED',
        resource_type:'marketplace_merchandising_collection',resource_id:current.id,correlation_id:current.id,source:'MARKETPLACE_DISCOVERY_API',
        after_state:{item_count:items.length,listing_ids:items.map(x=>x.listing_id),affects_organic_ranking:false}},db);
    });
    return repo.detail(current);
  }
  private requireStore(actor:AuthenticatedActorContext,storeId:string,permission:CanonicalPermission){
    const store=marketplaceRepository.getStoreById(storeId);
    if(!store)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,permission,{organizationId:store.organization_id});return store;
  }
  private requirePlatformAdmin(actor:AuthenticatedActorContext){
    if(!actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN))throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform administrator access required',403);
  }
  private emit(actor:AuthenticatedActorContext,type:string,correlationId:string,storeId:string|null,payload:any,db:any){
    enqueueOutboxEvent(createCanonicalEventEnvelope({type,producer:'garage-os-marketplace-discovery',correlation_id:correlationId,
      subject_ids:{...(storeId?{marketplace_store:storeId}:{}),marketplace_merchandising_collection:correlationId},
      actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,payload}),db);
  }
}
export const marketplaceDiscoveryService=new MarketplaceDiscoveryService();
