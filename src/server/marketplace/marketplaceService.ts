import { AuthenticatedActorContext, OrganizationType } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { withTransaction } from '../database/transaction';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { getDatabase } from '../database/connection';
import { marketplaceRepository } from './marketplaceRepository';
import {
  CreateMarketplaceListingInput,
  CreateMarketplaceProductInput,
  CreateMarketplaceStoreInput,
  MarketplaceAuthenticityClaim,
  MarketplaceFulfillmentMode,
  MarketplaceInventoryStatus,
  MarketplaceListing,
  MarketplaceListingDetail,
  MarketplaceListingMedia,
  MarketplaceProduct,
  MarketplaceSearchQuery,
  MarketplaceStore,
  MarketplaceStoreStatus,
  UpdateMarketplaceListingInput,
} from './types';

const STORE_ORG_TYPES=new Set<OrganizationType>([
  OrganizationType.MARKETPLACE_SELLER,
  OrganizationType.AUTOMOTIVE_SERVICE_PROVIDER,
  OrganizationType.GARAGE,
]);

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}

function requiredText(value:unknown,field:string,max:number):string{
  const v=String(value||'').trim();
  if(!v) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} is required`,400);
  if(v.length>max) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} is too long`,400);
  return v;
}

function optionalText(value:unknown,max:number):string|null{
  if(value===undefined||value===null)return null;
  const v=String(value).trim();
  return v?v.slice(0,max):null;
}

function currency(value:unknown):string{
  const v=String(value||'').trim().toUpperCase();
  if(!/^[A-Z]{3}$/.test(v)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'currency must be ISO 4217 three-letter code',400);
  return v;
}

function moneyMinor(value:unknown,field:string,allowZero=true):number{
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<0||(!allowZero&&n===0)){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} must be a non-negative integer minor-unit amount`,400);
  }
  return n;
}

function slug(value:unknown):string{
  const v=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)||v.length<2||v.length>80){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'slug must contain lowercase letters/numbers separated by hyphens',400);
  }
  return v;
}

function fulfillmentModes(values:unknown):MarketplaceFulfillmentMode[]{
  const allowed=new Set<MarketplaceFulfillmentMode>(['PICKUP','LOCAL_DELIVERY','SHIPPING']);
  const arr=Array.isArray(values)?Array.from(new Set(values.map(String))):[];
  if(arr.some(x=>!allowed.has(x as MarketplaceFulfillmentMode))){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid fulfillment mode',400);
  }
  return arr as MarketplaceFulfillmentMode[];
}

export class MarketplaceService {
  listCategories(){
    return marketplaceRepository.listCategories();
  }

  createStore(actor:AuthenticatedActorContext,input:CreateMarketplaceStoreInput):MarketplaceStore{
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE,{organizationId:input.organization_id});
    const db=getDatabase();
    const org=db.prepare('SELECT id,organization_type,status FROM organizations WHERE id=?').get(input.organization_id) as any;
    if(!org) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Organization not found',404);
    if(org.status!=='ACTIVE') throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Marketplace store requires an active organization',409);
    if(!STORE_ORG_TYPES.has(org.organization_type as OrganizationType)){
      throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Organization type is not eligible to operate a marketplace storefront',409);
    }
    if(input.provider_id){
      const provider=db.prepare('SELECT id,organization_id FROM service_providers WHERE id=?').get(input.provider_id) as any;
      if(!provider||provider.organization_id!==input.organization_id){
        throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Linked provider must belong to the same organization',404);
      }
    }
    const now=getCurrentUtcIsoString();
    const store:MarketplaceStore={
      id:generateCanonicalId('mstore'),organization_id:input.organization_id,
      provider_id:input.provider_id||null,slug:slug(input.slug),
      display_name:requiredText(input.display_name,'display_name',120),
      description:optionalText(input.description,1200),support_phone:optionalText(input.support_phone,40),
      support_email:optionalText(input.support_email,254),status:'DRAFT',created_at:now,updated_at:now
    };
    withTransaction(({db:tx})=>{
      marketplaceRepository.createStore(store);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.store.created',producer:'garage-os-marketplace',correlation_id:store.id,
        subject_ids:{organization:store.organization_id,marketplace_store:store.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{store_id:store.id,organization_id:store.organization_id,status:store.status}
      }),tx);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_STORE_CREATED',
        resource_type:'marketplace_store',resource_id:store.id,correlation_id:store.id,
        source:'MARKETPLACE_API',after_state:{organization_id:store.organization_id,slug:store.slug,status:store.status}
      },tx);
    });
    return store;
  }

  updateStore(actor:AuthenticatedActorContext,storeId:string,input:Partial<CreateMarketplaceStoreInput>&{status?:MarketplaceStoreStatus}):MarketplaceStore{
    const current=this.requireManagedStore(actor,storeId);
    const now=getCurrentUtcIsoString();
    const nextStatus=input.status??current.status;
    if(!['DRAFT','ACTIVE','PAUSED'].includes(nextStatus)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Seller cannot set store to requested status',400);
    }
    const updated:MarketplaceStore={
      ...current,
      provider_id:input.provider_id===undefined?current.provider_id:(input.provider_id||null),
      slug:input.slug===undefined?current.slug:slug(input.slug),
      display_name:input.display_name===undefined?current.display_name:requiredText(input.display_name,'display_name',120),
      description:input.description===undefined?current.description:optionalText(input.description,1200),
      support_phone:input.support_phone===undefined?current.support_phone:optionalText(input.support_phone,40),
      support_email:input.support_email===undefined?current.support_email:optionalText(input.support_email,254),
      status:nextStatus,updated_at:now
    };
    if(updated.provider_id){
      const p=getDatabase().prepare('SELECT organization_id FROM service_providers WHERE id=?').get(updated.provider_id) as any;
      if(!p||p.organization_id!==updated.organization_id){
        throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Linked provider must belong to same organization',404);
      }
    }
    withTransaction(({db})=>{
      if(!marketplaceRepository.updateStore(updated)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Store update failed',409);
      marketplaceRepository.rebuildStoreProjections(storeId,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.store.updated',producer:'garage-os-marketplace',correlation_id:storeId,
        subject_ids:{organization:updated.organization_id,marketplace_store:storeId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{store_id:storeId,status:updated.status}
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_STORE_UPDATED',
        resource_type:'marketplace_store',resource_id:storeId,correlation_id:storeId,source:'MARKETPLACE_API',
        before_state:{slug:current.slug,status:current.status},after_state:{slug:updated.slug,status:updated.status}
      },db);
    });
    return updated;
  }

  listSellerStores(actor:AuthenticatedActorContext,organizationId:string):MarketplaceStore[]{
    assertAuthorized(actor,CanonicalPermission.MARKETPLACE_PRODUCTS_READ,{organizationId});
    return marketplaceRepository.listStoresForOrganization(organizationId);
  }

  createProduct(actor:AuthenticatedActorContext,storeId:string,input:CreateMarketplaceProductInput):MarketplaceProduct{
    const store=this.requireManagedStore(actor,storeId);
    const category=marketplaceRepository.getCategory(input.category_id);
    if(!category) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace category not found',404);
    const allowedTypes=['PART','TYRE','ACCESSORY','CONSUMABLE','TOOL','ELECTRONICS','OTHER'];
    const allowedConditions=['NEW','USED','REMANUFACTURED'];
    const allowedClaims:MarketplaceAuthenticityClaim[]=['SELLER_CLAIMED_OEM','SELLER_CLAIMED_AFTERMARKET','GENERIC','UNKNOWN'];
    if(!allowedTypes.includes(input.product_type)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid product_type',400);
    if(!allowedConditions.includes(input.condition)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid condition',400);
    const claim=input.authenticity_claim||'UNKNOWN';
    if(!allowedClaims.includes(claim)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid authenticity_claim',400);
    const now=getCurrentUtcIsoString();
    const product:MarketplaceProduct={
      id:generateCanonicalId('mprod'),store_id:store.id,category_id:category.id,
      product_type:input.product_type,seller_sku:requiredText(input.seller_sku,'seller_sku',100),
      title:requiredText(input.title,'title',180),description:requiredText(input.description,'description',4000),
      brand:optionalText(input.brand,120),manufacturer_part_number:optionalText(input.manufacturer_part_number,120),
      condition:input.condition,authenticity_claim:claim,authenticity_verification_status:'NOT_VERIFIED',
      warranty_summary:optionalText(input.warranty_summary,1000),status:'DRAFT',fitment_status:'UNKNOWN',
      created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      marketplaceRepository.createProduct(product);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.product.created',producer:'garage-os-marketplace',correlation_id:product.id,
        subject_ids:{organization:store.organization_id,marketplace_store:store.id,marketplace_product:product.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          product_id:product.id,store_id:store.id,category_id:product.category_id,
          fitment_status:'UNKNOWN',authenticity_verification_status:'NOT_VERIFIED'
        }
      }),db);
    });
    return product;
  }

  listSellerProducts(actor:AuthenticatedActorContext,storeId:string){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_READ);
    return marketplaceRepository.listProductsForStore(storeId);
  }

  createListing(actor:AuthenticatedActorContext,storeId:string,productId:string,input:CreateMarketplaceListingInput):MarketplaceListing{
    const store=this.requireManagedStore(actor,storeId);
    const product=marketplaceRepository.getProduct(productId);
    if(!product||product.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace product not found',404);
    if(product.status==='RETIRED') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Retired product cannot be listed',409);
    if(marketplaceRepository.getListingByProduct(productId)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Product already has a listing',409);
    const now=getCurrentUtcIsoString();
    const listing=this.buildListing({
      id:generateCanonicalId('mlist'),storeId,productId,input,status:'DRAFT',version:1,createdAt:now,updatedAt:now
    });
    withTransaction(({db})=>{
      marketplaceRepository.createListing(listing);
      marketplaceRepository.insertPriceSnapshot({
        id:generateCanonicalId('mprice'),listing_id:listing.id,version:listing.version,
        price_minor:listing.price_minor,compare_at_price_minor:listing.compare_at_price_minor,
        currency:listing.currency,inventory_status:listing.inventory_status,captured_reason:'CREATED',
        captured_by:actor.user_id,captured_at:now
      });
      marketplaceRepository.rebuildSearchProjection(listing.id,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.listing.created',producer:'garage-os-marketplace',correlation_id:listing.id,
        subject_ids:{organization:store.organization_id,marketplace_store:storeId,marketplace_product:productId,marketplace_listing:listing.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{listing_id:listing.id,product_id:productId,price_minor:listing.price_minor,currency:listing.currency,status:'DRAFT'}
      }),db);
    });
    return listing;
  }

  updateListing(actor:AuthenticatedActorContext,storeId:string,listingId:string,input:UpdateMarketplaceListingInput):MarketplaceListing{
    const store=this.requireManagedStore(actor,storeId);
    const current=marketplaceRepository.getListing(listingId);
    if(!current||current.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    if(current.status==='RETIRED') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Retired listing is immutable',409);
    const now=getCurrentUtcIsoString();
    const updated=this.buildListing({
      id:current.id,storeId,productId:current.product_id,
      input:{
        price_minor:input.price_minor??current.price_minor,
        compare_at_price_minor:input.compare_at_price_minor===undefined?current.compare_at_price_minor:input.compare_at_price_minor,
        currency:input.currency??current.currency,
        inventory_tracking:input.inventory_tracking??current.inventory_tracking,
        stock_quantity:input.stock_quantity===undefined?current.stock_quantity:input.stock_quantity,
        inventory_status:input.inventory_status??current.inventory_status,
        fulfillment_modes:input.fulfillment_modes??current.fulfillment_modes,
      },
      status:current.status,version:current.version+1,createdAt:current.created_at,updatedAt:now,
      publishedAt:current.published_at,pausedAt:current.paused_at,retiredAt:current.retired_at
    });
    withTransaction(({db})=>{
      if(!marketplaceRepository.updateListing(updated)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Listing changed concurrently',409);
      marketplaceRepository.insertPriceSnapshot({
        id:generateCanonicalId('mprice'),listing_id:listingId,version:updated.version,
        price_minor:updated.price_minor,compare_at_price_minor:updated.compare_at_price_minor,
        currency:updated.currency,inventory_status:updated.inventory_status,captured_reason:'UPDATED',
        captured_by:actor.user_id,captured_at:now
      });
      marketplaceRepository.rebuildSearchProjection(listingId,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.listing.updated',producer:'garage-os-marketplace',correlation_id:listingId,
        subject_ids:{organization:store.organization_id,marketplace_store:storeId,marketplace_listing:listingId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{listing_id:listingId,version:updated.version,price_minor:updated.price_minor,currency:updated.currency,inventory_status:updated.inventory_status}
      }),db);
    });
    return updated;
  }

  publishListing(actor:AuthenticatedActorContext,storeId:string,listingId:string):MarketplaceListing{
    const store=this.requireManagedStore(actor,storeId);
    if(store.status!=='ACTIVE') throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Store must be ACTIVE before publishing listings',409);
    const current=marketplaceRepository.getListing(listingId);
    if(!current||current.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    if(current.status==='RETIRED') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Retired listing cannot be published',409);
    if(current.price_minor<=0) throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Published listing requires a positive price',409);
    if(current.fulfillment_modes.length===0) throw new CanonicalAppError(ErrorCode.BUSINESS_RULE_VIOLATION,'Published listing requires at least one fulfillment mode',409);
    const product=marketplaceRepository.getProduct(current.product_id);
    if(!product||product.status==='RETIRED') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Product is not publishable',409);
    const now=getCurrentUtcIsoString();
    const updated={...current,status:'PUBLISHED' as const,published_at:current.published_at||now,paused_at:null,version:current.version+1,updated_at:now};
    const publishedProduct={...product,status:'PUBLISHED' as const,updated_at:now};
    withTransaction(({db})=>{
      if(!marketplaceRepository.updateListing(updated)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Listing changed concurrently',409);
      marketplaceRepository.updateProduct(publishedProduct);
      marketplaceRepository.insertPriceSnapshot({
        id:generateCanonicalId('mprice'),listing_id:listingId,version:updated.version,
        price_minor:updated.price_minor,compare_at_price_minor:updated.compare_at_price_minor,
        currency:updated.currency,inventory_status:updated.inventory_status,captured_reason:'PUBLISHED',
        captured_by:actor.user_id,captured_at:now
      });
      marketplaceRepository.rebuildSearchProjection(listingId,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.listing.published',producer:'garage-os-marketplace',correlation_id:listingId,
        subject_ids:{organization:store.organization_id,marketplace_store:storeId,marketplace_product:product.id,marketplace_listing:listingId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          listing_id:listingId,product_id:product.id,price_minor:updated.price_minor,currency:updated.currency,
          fitment_status:'UNKNOWN',authenticity_verification_status:'NOT_VERIFIED',
          checkout_available:false,order_creation_available:false,payment_available:false
        }
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'MARKETPLACE_LISTING_PUBLISHED',
        resource_type:'marketplace_listing',resource_id:listingId,correlation_id:listingId,source:'MARKETPLACE_API',
        metadata:{store_id:storeId,price_minor:updated.price_minor,currency:updated.currency,fitment_status:'UNKNOWN'}
      },db);
    });
    return updated;
  }

  pauseListing(actor:AuthenticatedActorContext,storeId:string,listingId:string):MarketplaceListing{
    const store=this.requireManagedStore(actor,storeId);
    const current=marketplaceRepository.getListing(listingId);
    if(!current||current.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    if(current.status!=='PUBLISHED') throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Only a published listing can be paused',409);
    const now=getCurrentUtcIsoString();
    const updated={...current,status:'PAUSED' as const,paused_at:now,version:current.version+1,updated_at:now};
    withTransaction(({db})=>{
      if(!marketplaceRepository.updateListing(updated)) throw new CanonicalAppError(ErrorCode.CONFLICT,'Listing changed concurrently',409);
      marketplaceRepository.rebuildSearchProjection(listingId,now);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.listing.paused',producer:'garage-os-marketplace',correlation_id:listingId,
        subject_ids:{organization:store.organization_id,marketplace_store:storeId,marketplace_listing:listingId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{listing_id:listingId,status:'PAUSED'}
      }),db);
    });
    return updated;
  }

  addListingMedia(actor:AuthenticatedActorContext,storeId:string,listingId:string,input:{
    file_object_id:string;media_role?:'IMAGE'|'DOCUMENT';alt_text?:string|null;sort_order?:number;is_primary?:boolean;
  }):MarketplaceListingMedia{
    this.requireManagedStore(actor,storeId);
    const listing=marketplaceRepository.getListing(listingId);
    if(!listing||listing.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    const file=getDatabase().prepare('SELECT id,owner_id,scan_status,content_type FROM file_objects WHERE id=?').get(input.file_object_id) as any;
    if(!file||file.scan_status!=='AVAILABLE') throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Media file not available',404);
    if(file.owner_id&&file.owner_id!==actor.user_id&&!actor.platform_roles?.includes('PLATFORM_ADMIN' as any)){
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Cannot attach another user\'s file',403);
    }
    const role=input.media_role||'IMAGE';
    if(role==='IMAGE'&&!String(file.content_type).startsWith('image/')){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'IMAGE media requires an image file',400);
    }
    const media:MarketplaceListingMedia={
      id:generateCanonicalId('mmedia'),listing_id:listingId,file_object_id:String(file.id),media_role:role,
      alt_text:optionalText(input.alt_text,240),sort_order:Number.isInteger(input.sort_order)?Number(input.sort_order):0,
      is_primary:Boolean(input.is_primary),created_at:getCurrentUtcIsoString()
    };
    withTransaction(({db})=>{
      marketplaceRepository.addMedia(media);
      marketplaceRepository.rebuildSearchProjection(listingId,media.created_at);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.listing.media.added',producer:'garage-os-marketplace',correlation_id:listingId,
        subject_ids:{marketplace_store:storeId,marketplace_listing:listingId,file_object:media.file_object_id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{listing_id:listingId,media_id:media.id,media_role:role,is_primary:media.is_primary}
      }),db);
    });
    return media;
  }

  search(query:MarketplaceSearchQuery={}){
    const min=query.min_price_minor===undefined?undefined:moneyMinor(query.min_price_minor,'min_price_minor');
    const max=query.max_price_minor===undefined?undefined:moneyMinor(query.max_price_minor,'max_price_minor');
    if(min!==undefined&&max!==undefined&&max<min) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'max_price_minor must be >= min_price_minor',400);
    const limit=Math.max(1,Math.min(50,Math.trunc(query.limit||24)));
    const offset=Math.max(0,Math.trunc(query.offset||0));
    const result=marketplaceRepository.search({
      query:query.query,category:query.category,product_type:query.product_type,condition:query.condition,
      brand:query.brand,currency:query.currency,min_price_minor:min,max_price_minor:max,
      in_stock_only:Boolean(query.in_stock_only),store_slug:query.store_slug,limit,offset
    });
    return {...result,limit,offset,truth:{
      fitment_filter_available:false,fitment_confirmed:false,checkout_available:false,
      order_creation_available:false,payment_available:false
    }};
  }

  getListingDetail(listingId:string):MarketplaceListingDetail{
    const detail=marketplaceRepository.getPublicListingDetail(listingId);
    if(!detail) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    return detail;
  }

  getStorefront(slugValue:string){
    const store=marketplaceRepository.getStoreBySlug(slugValue);
    if(!store||store.status!=='ACTIVE') throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    const org=getDatabase().prepare('SELECT status FROM organizations WHERE id=?').get(store.organization_id) as any;
    if(!org||org.status!=='ACTIVE') throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    return {store,listings:this.search({store_slug:store.slug,limit:50,offset:0}).items,truth:{
      seller_verification_badge_available:false,checkout_available:false
    }};
  }

  getSellerListing(actor:AuthenticatedActorContext,storeId:string,listingId:string){
    this.requireManagedStore(actor,storeId,CanonicalPermission.MARKETPLACE_PRODUCTS_READ);
    const listing=marketplaceRepository.getListing(listingId);
    if(!listing||listing.store_id!==storeId) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace listing not found',404);
    const product=marketplaceRepository.getProduct(listing.product_id)!;
    return {listing,product,media:marketplaceRepository.listMedia(listingId),price_snapshots:marketplaceRepository.listPriceSnapshots(listingId)};
  }

  private buildListing(args:{
    id:string;storeId:string;productId:string;input:CreateMarketplaceListingInput;status:MarketplaceListing['status'];
    version:number;createdAt:string;updatedAt:string;publishedAt?:string|null;pausedAt?:string|null;retiredAt?:string|null;
  }):MarketplaceListing{
    const price=moneyMinor(args.input.price_minor,'price_minor');
    const compare=args.input.compare_at_price_minor===undefined||args.input.compare_at_price_minor===null
      ? null:moneyMinor(args.input.compare_at_price_minor,'compare_at_price_minor');
    if(compare!==null&&compare<price) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'compare_at_price_minor must be >= price_minor',400);
    const tracking=args.input.inventory_tracking||'NONE';
    if(!['NONE','QUANTITY'].includes(tracking)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid inventory_tracking',400);
    let quantity=args.input.stock_quantity===undefined||args.input.stock_quantity===null?null:Number(args.input.stock_quantity);
    if(quantity!==null&&(!Number.isSafeInteger(quantity)||quantity<0)) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'stock_quantity must be a non-negative integer',400);
    let inventory=(args.input.inventory_status||'UNKNOWN') as MarketplaceInventoryStatus;
    if(tracking==='QUANTITY'){
      if(quantity===null) throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Quantity-tracked listing requires stock_quantity',400);
      inventory=quantity===0?'OUT_OF_STOCK':quantity<=3?'LOW_STOCK':'IN_STOCK';
    }else if(!['IN_STOCK','LOW_STOCK','OUT_OF_STOCK','MADE_TO_ORDER','UNKNOWN'].includes(inventory)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid inventory_status',400);
    }
    return {
      id:args.id,store_id:args.storeId,product_id:args.productId,status:args.status,
      price_minor:price,compare_at_price_minor:compare,currency:currency(args.input.currency),
      inventory_tracking:tracking as any,stock_quantity:quantity,inventory_status:inventory,
      fulfillment_modes:fulfillmentModes(args.input.fulfillment_modes),
      published_at:args.publishedAt??null,paused_at:args.pausedAt??null,retired_at:args.retiredAt??null,
      version:args.version,created_at:args.createdAt,updated_at:args.updatedAt
    };
  }

  private requireManagedStore(
    actor:AuthenticatedActorContext,
    storeId:string,
    permission:CanonicalPermission=CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE
  ):MarketplaceStore{
    const store=marketplaceRepository.getStoreById(storeId);
    if(!store) throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace store not found',404);
    assertAuthorized(actor,permission,{organizationId:store.organization_id});
    return store;
  }
}

export const marketplaceService=new MarketplaceService();
