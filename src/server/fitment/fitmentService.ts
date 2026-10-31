import { AuthenticatedActorContext, PlatformRole } from '../identity/types';
import { assertAuthorized } from '../identity/policyEngine';
import { CanonicalPermission } from '../identity/rbac';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';
import { CanonicalActorType } from '../../shared/types';
import { DataProvenanceClass } from '../../shared/provenance';
import { getCurrentUtcIsoString } from '../domain/time';
import { generateCanonicalId } from '../domain/id';
import { getDatabase } from '../database/connection';
import { withTransaction } from '../database/transaction';
import { createCanonicalEventEnvelope } from '../events/envelope';
import { enqueueOutboxEvent } from '../events/outbox';
import { recordAuditEvent } from '../security/audit';
import { marketplaceService } from '../marketplace/marketplaceService';
import { MarketplaceSearchQuery } from '../marketplace/types';
import { vehicleService } from '../vehicle/vehicleService';
import { VehicleEntity } from '../vehicle/types';
import { fitmentRepository } from './fitmentRepository';
import {
  CreateAuthoritativeFitmentRuleInput,
  CreateFitmentRuleInput,
  CreateFitmentSourceInput,
  FITMENT_DISCLAIMER,
  FITMENT_ENGINE_VERSION,
  FitmentDecision,
  FitmentDecisionStatus,
  FitmentInstallationLink,
  FitmentRuleKind,
  FitmentSource,
  FitmentSourceType,
  FitmentVerificationStatus,
  ProductFitmentRule,
} from './types';

const SOURCE_TYPES:FitmentSourceType[]=['SELLER','MANUFACTURER','CATALOG_PROVIDER','GARAGE_VERIFIED','PLATFORM_CURATED'];
const RULE_KINDS:FitmentRuleKind[]=['INCLUDE','EXCLUDE','GENERIC'];

function actorType(actor:AuthenticatedActorContext):CanonicalActorType{
  return actor.type||CanonicalActorType.VEHICLE_OWNER;
}

function normalized(value:unknown,max=120):string|null{
  if(value===undefined||value===null)return null;
  const v=String(value).trim().replace(/\s+/g,' ');
  if(!v)return null;
  if(v.length>max)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Fitment criterion is too long',400);
  return v;
}

function same(a:string|null|undefined,b:string|null|undefined):boolean{
  return String(a||'').trim().toLocaleLowerCase()===String(b||'').trim().toLocaleLowerCase();
}

function safeYear(value:unknown,field:string):number|null{
  if(value===undefined||value===null||value==='')return null;
  const n=Number(value);
  if(!Number.isInteger(n)||n<1886||n>2100){
    throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,`${field} must be a valid model year`,400);
  }
  return n;
}

export class FitmentService {
  listSources(actor:AuthenticatedActorContext):FitmentSource[]{
    this.requirePlatformAdmin(actor);
    return fitmentRepository.listSources();
  }

  createSource(actor:AuthenticatedActorContext,input:CreateFitmentSourceInput):FitmentSource{
    this.requirePlatformAdmin(actor);
    const sourceType=String(input.source_type||'') as FitmentSourceType;
    if(sourceType==='SELLER'||!SOURCE_TYPES.includes(sourceType)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid authoritative fitment source type',400);
    }
    const providerKey=normalized(input.provider_key,120);
    const displayName=normalized(input.display_name,160);
    if(!providerKey||!displayName){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'display_name and provider_key are required',400);
    }
    const trustRank=input.trust_rank===undefined?70:Number(input.trust_rank);
    if(!Number.isInteger(trustRank)||trustRank<0||trustRank>100){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'trust_rank must be an integer from 0 to 100',400);
    }
    if(input.owner_organization_id){
      const org=getDatabase().prepare('SELECT id FROM organizations WHERE id=?').get(input.owner_organization_id) as any;
      if(!org)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Source organization not found',404);
    }
    const now=getCurrentUtcIsoString();
    const source:FitmentSource={
      id:generateCanonicalId('fitsrc'),source_type:sourceType,display_name:displayName,
      owner_organization_id:input.owner_organization_id||null,provider_key:providerKey,
      verification_authority:Boolean(input.verification_authority),trust_rank:trustRank,
      status:'ACTIVE',created_at:now,updated_at:now
    };
    withTransaction(({db})=>{
      fitmentRepository.createSource(source);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.fitment.source.created',producer:'garage-os-fitment',correlation_id:source.id,
        subject_ids:{fitment_source:source.id},actor_id:actor.user_id,actor_type:actorType(actor),
        provenance_class:DataProvenanceClass.DERIVED_DETERMINISTIC,
        payload:{source_id:source.id,source_type:source.source_type,verification_authority:source.verification_authority,trust_rank:source.trust_rank}
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'FITMENT_SOURCE_CREATED',
        resource_type:'fitment_source',resource_id:source.id,correlation_id:source.id,
        source:'FITMENT_API',after_state:{source_type:source.source_type,provider_key:source.provider_key,verification_authority:source.verification_authority}
      },db);
    });
    return source;
  }

  listSellerRules(actor:AuthenticatedActorContext,storeId:string,productId:string):ProductFitmentRule[]{
    this.requireManagedProduct(actor,storeId,productId,CanonicalPermission.MARKETPLACE_PRODUCTS_READ);
    return fitmentRepository.listRulesForProduct(productId,true);
  }

  createSellerRule(
    actor:AuthenticatedActorContext,
    storeId:string,
    productId:string,
    input:CreateFitmentRuleInput
  ):ProductFitmentRule{
    const product=this.requireManagedProduct(actor,storeId,productId,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE);
    const rule=this.buildRule({
      productId,sourceId:null,sourceType:'SELLER',verificationStatus:'SELLER_ASSERTED',
      input,createdBy:actor.user_id
    });
    return this.persistRule(actor,rule,product.organization_id);
  }

  revokeSellerRule(actor:AuthenticatedActorContext,storeId:string,productId:string,ruleId:string):ProductFitmentRule{
    const product=this.requireManagedProduct(actor,storeId,productId,CanonicalPermission.MARKETPLACE_PRODUCTS_MANAGE);
    const current=fitmentRepository.getRule(ruleId);
    if(!current||current.product_id!==productId||current.source_type!=='SELLER'){
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Seller fitment rule not found',404);
    }
    const now=getCurrentUtcIsoString();
    withTransaction(({db})=>{
      if(!fitmentRepository.revokeRule(ruleId,now)){
        throw new CanonicalAppError(ErrorCode.INVALID_STATE_TRANSITION,'Fitment rule is already revoked',409);
      }
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.fitment.rule.revoked',producer:'garage-os-fitment',correlation_id:ruleId,
        subject_ids:{organization:product.organization_id,marketplace_product:productId,fitment_rule:ruleId},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{rule_id:ruleId,product_id:productId}
      }),db);
    });
    return fitmentRepository.getRule(ruleId)!;
  }

  createAuthoritativeRule(actor:AuthenticatedActorContext,input:CreateAuthoritativeFitmentRuleInput):ProductFitmentRule{
    this.requirePlatformAdmin(actor);
    const product=this.requireProduct(input.product_id);
    const source=fitmentRepository.getSource(String(input.source_id||''));
    if(!source||source.status!=='ACTIVE'){
      throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Active fitment source not found',404);
    }
    if(source.source_type==='SELLER'){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Authoritative rule cannot use SELLER source',400);
    }
    const verification=(input.verification_status||'VERIFIED') as FitmentVerificationStatus;
    if(!['UNVERIFIED','VERIFIED'].includes(verification)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Invalid verification_status',400);
    }
    const rule=this.buildRule({
      productId:input.product_id,sourceId:source.id,sourceType:source.source_type,
      verificationStatus:verification,input,createdBy:actor.user_id
    });
    return this.persistRule(actor,rule,product.organization_id);
  }

  evaluateListing(actor:AuthenticatedActorContext,listingId:string,vehicleId:string,persist=true):FitmentDecision{
    const detail=marketplaceService.getListingDetail(listingId);
    const vehicle=vehicleService.getVehicleDetails(actor,vehicleId).vehicle;
    return this.evaluate(detail.product_id,listingId,vehicle,persist);
  }

  searchForVehicle(
    actor:AuthenticatedActorContext,
    vehicleId:string,
    query:MarketplaceSearchQuery={},
    includeUnknown=false
  ){
    const vehicle=vehicleService.getVehicleDetails(actor,vehicleId).vehicle;
    const result=marketplaceService.search({...query,limit:Math.min(Number(query.limit||50),50),offset:query.offset||0});
    const evaluated=result.items.map((item:any)=>({
      ...item,
      fitment:this.evaluate(item.product_id,item.listing_id,vehicle,false)
    }));
    const compatibilityCounts:Record<FitmentDecisionStatus,number>={
      UNKNOWN:0,GENERIC:0,SELLER_CLAIMED:0,PROBABLE:0,CONFIRMED:0,CONFLICT:0,NOT_COMPATIBLE:0
    };
    for(const item of evaluated)compatibilityCounts[item.fitment.status as FitmentDecisionStatus]+=1;
    const compatible=new Set<FitmentDecisionStatus>(['GENERIC','SELLER_CLAIMED','PROBABLE','CONFIRMED']);
    const items=evaluated.filter((item:any)=>compatible.has(item.fitment.status)||(includeUnknown&&item.fitment.status==='UNKNOWN'));
    return {
      vehicle:{
        id:vehicle.id,display_name:vehicle.display_name,make:vehicle.make,model:vehicle.model,
        model_year:vehicle.model_year,trim:vehicle.trim,variant:vehicle.variant
      },
      items,total:items.length,evaluated_total:evaluated.length,compatibility_counts:compatibilityCounts,
      truth:{
        vehicle_context_required:true,unknown_included:includeUnknown,
        conflicts_excluded_from_compatible_results:true,incompatible_excluded_from_compatible_results:true,
        guaranteed:false,disclaimer:FITMENT_DISCLAIMER
      }
    };
  }

  recordInstallation(actor:AuthenticatedActorContext,vehicleId:string,input:{
    product_id:string;listing_id?:string|null;vehicle_component_id?:string|null;
    installed_at?:string;notes?:string|null;
  }):{installation:FitmentInstallationLink;fitment:FitmentDecision}{
    const vehicle=vehicleService.getVehicleDetails(actor,vehicleId).vehicle;
    const product=this.requireProduct(String(input.product_id||''));
    let listingId=input.listing_id?String(input.listing_id):null;
    if(listingId){
      const listing=getDatabase().prepare(
        'SELECT id,product_id FROM marketplace_listings WHERE id=? LIMIT 1'
      ).get(listingId) as any;
      if(!listing||String(listing.product_id)!==product.id){
        throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Listing does not belong to the supplied product',400);
      }
    }
    const componentId=input.vehicle_component_id?String(input.vehicle_component_id):null;
    if(componentId){
      const component=getDatabase().prepare(
        'SELECT id,vehicle_id FROM vehicle_components WHERE id=? LIMIT 1'
      ).get(componentId) as any;
      if(!component||String(component.vehicle_id)!==vehicleId){
        throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Installed component must belong to the selected vehicle',400);
      }
    }
    const decision=this.evaluate(product.id,listingId,vehicle,true);
    const now=getCurrentUtcIsoString();
    const installedAt=input.installed_at?String(input.installed_at):now;
    if(Number.isNaN(Date.parse(installedAt))){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'installed_at must be an ISO date-time',400);
    }
    const installation:FitmentInstallationLink={
      id:generateCanonicalId('fitinst'),vehicle_id:vehicleId,product_id:product.id,listing_id:listingId,
      vehicle_component_id:componentId,fitment_decision_id:decision.id,
      fitment_status_at_install:decision.status,installation_source:'OWNER_RECORDED',
      verification_status:'UNVERIFIED',notes:normalized(input.notes,1000),
      recorded_by:actor.user_id,installed_at:installedAt,created_at:now
    };
    withTransaction(({db})=>{
      fitmentRepository.createInstallation(installation);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.fitment.installation.recorded',producer:'garage-os-fitment',correlation_id:installation.id,
        subject_ids:{vehicle:vehicleId,marketplace_product:product.id,fitment_installation:installation.id},
        actor_id:actor.user_id,actor_type:actorType(actor),provenance_class:DataProvenanceClass.OWNER_ASSERTED,
        payload:{
          installation_id:installation.id,vehicle_id:vehicleId,product_id:product.id,
          fitment_status_at_install:decision.status,guaranteed:false
        }
      }),db);
    });
    return {installation,fitment:decision};
  }

  listInstallations(actor:AuthenticatedActorContext,vehicleId:string):FitmentInstallationLink[]{
    vehicleService.getVehicleDetails(actor,vehicleId);
    return fitmentRepository.listInstallations(vehicleId);
  }

  private evaluate(productId:string,listingId:string|null,vehicle:VehicleEntity,persist:boolean):FitmentDecision{
    this.requireProduct(productId);
    const rules=fitmentRepository.listRulesForProduct(productId).filter(rule=>this.ruleMatches(rule,vehicle));
    const positives=rules.filter(r=>r.rule_kind==='INCLUDE');
    const exclusions=rules.filter(r=>r.rule_kind==='EXCLUDE');
    const generics=rules.filter(r=>r.rule_kind==='GENERIC');

    let status:FitmentDecisionStatus='UNKNOWN';
    let confidence=0;
    let matched:ProductFitmentRule[]=[];
    let conflicts:ProductFitmentRule[]=[];
    let reason='No structured fitment evidence currently matches this vehicle.';

    if(exclusions.length&&positives.length){
      status='CONFLICT';confidence=0;matched=[...positives,...exclusions];conflicts=[...positives,...exclusions];
      reason='Matching inclusion and exclusion evidence conflict for this vehicle. Treat fitment as unresolved.';
    }else if(exclusions.length){
      status='NOT_COMPATIBLE';confidence=95;matched=exclusions;
      reason='Active fitment evidence explicitly excludes this vehicle configuration.';
    }else if(positives.length){
      matched=positives;
      const authoritative=positives.some(r=>
        r.verification_status==='VERIFIED'&&r.source_verification_authority&&
        (r.source_trust_rank===null||r.source_trust_rank>=80)
      );
      const verified=positives.some(r=>r.verification_status==='VERIFIED');
      const catalog=positives.some(r=>r.source_type==='CATALOG_PROVIDER');
      const seller=positives.some(r=>r.source_type==='SELLER');
      if(authoritative){
        status='CONFIRMED';confidence=95;
        reason='A verified fitment authority has evidence matching this vehicle configuration.';
      }else if(verified||catalog){
        status='PROBABLE';confidence=verified?82:72;
        reason='Structured catalog or verified evidence matches this vehicle, but the source is not configured as final fitment authority.';
      }else if(seller){
        status='SELLER_CLAIMED';confidence=55;
        reason='The seller has asserted compatibility with this vehicle configuration; Garage OS has not independently verified the claim.';
      }else{
        status='PROBABLE';confidence=65;
        reason='Structured fitment evidence matches this vehicle but is not authoritative.';
      }
    }else if(generics.length){
      status='GENERIC';confidence=35;matched=generics;
      reason='The product is described as generic/universal; vehicle-specific installation requirements still need verification.';
    }

    const now=getCurrentUtcIsoString();
    const decision:FitmentDecision={
      id:persist?generateCanonicalId('fitdec'):null,product_id:productId,listing_id:listingId,
      vehicle_id:vehicle.id,status,confidence,guaranteed:false,
      matched_rule_ids:matched.map(r=>r.id),conflict_rule_ids:conflicts.map(r=>r.id),
      reason,disclaimer:FITMENT_DISCLAIMER,engine_version:FITMENT_ENGINE_VERSION,evaluated_at:now
    };
    if(persist){
      withTransaction(({db})=>{
        fitmentRepository.saveDecision(decision);
        enqueueOutboxEvent(createCanonicalEventEnvelope({
          type:'marketplace.fitment.evaluated',producer:'garage-os-fitment',correlation_id:decision.id!,
          subject_ids:{vehicle:vehicle.id,marketplace_product:productId,...(listingId?{marketplace_listing:listingId}:{})},
          actor_type:CanonicalActorType.SYSTEM_WORKER,provenance_class:DataProvenanceClass.DERIVED_DETERMINISTIC,
          payload:{decision_id:decision.id,vehicle_id:vehicle.id,product_id:productId,status,confidence,guaranteed:false}
        }),db);
      });
    }
    return decision;
  }

  private ruleMatches(rule:ProductFitmentRule,vehicle:VehicleEntity):boolean{
    if(rule.rule_kind==='GENERIC')return true;
    if(rule.vehicle_make&&!same(rule.vehicle_make,vehicle.make))return false;
    if(rule.vehicle_model&&!same(rule.vehicle_model,vehicle.model))return false;
    if(rule.year_from!==null&&vehicle.model_year<rule.year_from)return false;
    if(rule.year_to!==null&&vehicle.model_year>rule.year_to)return false;
    if(rule.trim&&!same(rule.trim,vehicle.trim))return false;
    if(rule.variant&&!same(rule.variant,vehicle.variant))return false;
    if(rule.body_type&&!same(rule.body_type,vehicle.body_type))return false;
    if(rule.engine_type&&!same(rule.engine_type,vehicle.engine_type))return false;
    if(rule.fuel_type&&!same(rule.fuel_type,vehicle.fuel_type))return false;
    if(rule.transmission&&!same(rule.transmission,vehicle.transmission))return false;
    if(rule.drive_type&&!same(rule.drive_type,vehicle.drive_type))return false;
    return true;
  }

  private buildRule(args:{
    productId:string;sourceId:string|null;sourceType:FitmentSourceType;
    verificationStatus:FitmentVerificationStatus;input:CreateFitmentRuleInput;createdBy:string;
  }):ProductFitmentRule{
    const kind=String(args.input.rule_kind||'') as FitmentRuleKind;
    if(!RULE_KINDS.includes(kind)){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'rule_kind must be INCLUDE, EXCLUDE or GENERIC',400);
    }
    const yearFrom=safeYear(args.input.year_from,'year_from');
    const yearTo=safeYear(args.input.year_to,'year_to');
    if(yearFrom!==null&&yearTo!==null&&yearTo<yearFrom){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'year_to must be >= year_from',400);
    }
    const criteria={
      vehicle_make:normalized(args.input.vehicle_make),vehicle_model:normalized(args.input.vehicle_model),
      trim:normalized(args.input.trim),variant:normalized(args.input.variant),
      body_type:normalized(args.input.body_type),engine_type:normalized(args.input.engine_type),
      fuel_type:normalized(args.input.fuel_type),transmission:normalized(args.input.transmission),
      drive_type:normalized(args.input.drive_type)
    };
    const hasCriteria=Object.values(criteria).some(Boolean)||yearFrom!==null||yearTo!==null;
    if(kind==='GENERIC'&&hasCriteria){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'GENERIC fitment rules cannot contain vehicle-specific criteria',400);
    }
    if(kind!=='GENERIC'&&!hasCriteria){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'INCLUDE/EXCLUDE fitment rules require at least one vehicle criterion',400);
    }
    const now=getCurrentUtcIsoString();
    return {
      id:generateCanonicalId('fitrule'),product_id:args.productId,source_id:args.sourceId,
      source_type:args.sourceType,rule_kind:kind,...criteria,year_from:yearFrom,year_to:yearTo,
      evidence_reference:normalized(args.input.evidence_reference,500),
      evidence_summary:normalized(args.input.evidence_summary,1200),
      verification_status:args.verificationStatus,status:'ACTIVE',created_by:args.createdBy,
      created_at:now,updated_at:now,source_display_name:null,source_verification_authority:false,source_trust_rank:null
    };
  }

  private persistRule(actor:AuthenticatedActorContext,rule:ProductFitmentRule,organizationId:string):ProductFitmentRule{
    return withTransaction(({db})=>{
      const created=fitmentRepository.createRule(rule);
      enqueueOutboxEvent(createCanonicalEventEnvelope({
        type:'marketplace.fitment.rule.created',producer:'garage-os-fitment',correlation_id:created.id,
        subject_ids:{organization:organizationId,marketplace_product:created.product_id,fitment_rule:created.id},
        actor_id:actor.user_id,actor_type:actorType(actor),
        provenance_class:created.source_type==='SELLER'?DataProvenanceClass.OWNER_ASSERTED:DataProvenanceClass.DERIVED_DETERMINISTIC,
        payload:{
          rule_id:created.id,product_id:created.product_id,source_type:created.source_type,
          rule_kind:created.rule_kind,verification_status:created.verification_status,guaranteed:false
        }
      }),db);
      recordAuditEvent({
        actor_id:actor.user_id,actor_type:actorType(actor),action:'FITMENT_RULE_CREATED',
        resource_type:'marketplace_product_fitment_rule',resource_id:created.id,correlation_id:created.id,
        source:'FITMENT_API',after_state:{
          product_id:created.product_id,source_type:created.source_type,rule_kind:created.rule_kind,
          verification_status:created.verification_status
        }
      },db);
      return created;
    });
  }

  private requireManagedProduct(
    actor:AuthenticatedActorContext,storeId:string,productId:string,
    permission:CanonicalPermission
  ):{id:string;store_id:string;organization_id:string}{
    const row=getDatabase().prepare(`
      SELECT p.id,p.store_id,s.organization_id
      FROM marketplace_products p
      JOIN marketplace_stores s ON s.id=p.store_id
      WHERE p.id=? AND p.store_id=? LIMIT 1
    `).get(productId,storeId) as any;
    if(!row)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace product not found',404);
    assertAuthorized(actor,permission,{organizationId:String(row.organization_id)});
    return {id:String(row.id),store_id:String(row.store_id),organization_id:String(row.organization_id)};
  }

  private requireProduct(productId:string):{id:string;organization_id:string}{
    const row=getDatabase().prepare(`
      SELECT p.id,s.organization_id
      FROM marketplace_products p
      JOIN marketplace_stores s ON s.id=p.store_id
      WHERE p.id=? LIMIT 1
    `).get(productId) as any;
    if(!row)throw new CanonicalAppError(ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE,'Marketplace product not found',404);
    return {id:String(row.id),organization_id:String(row.organization_id)};
  }

  private requirePlatformAdmin(actor:AuthenticatedActorContext):void{
    if(!actor.platform_roles?.includes(PlatformRole.PLATFORM_ADMIN)){
      throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'Platform administrator access required',403);
    }
  }
}

export const fitmentService=new FitmentService();
