/**
 * Sprint 23 — Vehicle Compatibility & Fitment (GAR-022)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { fitmentService } from '../../src/server/fitment/fitmentService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,orgId:string,orgName:string,platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,
    memberships:[{
      membership_id:'mem_'+userId,organization_id:orgId,organization_name:orgName,
      organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',
      role:'OWNER',status:'ACTIVE'
    }],
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}

describe('Vehicle Compatibility & Fitment (GAR-022 / Sprint 23)',()=>{
  let db:any;
  const orgId='org_fitment_01',otherOrgId='org_fitment_02';
  const owner=actor('usr_fitment_owner','owner@fitment.test',orgId,'Fitment Seller');
  const other=actor('usr_fitment_other','other@fitment.test',otherOrgId,'Other Seller');
  const admin=actor('usr_fitment_admin','admin@fitment.test',orgId,'Fitment Seller',[PlatformRole.PLATFORM_ADMIN]);
  let storeId:string,productId:string,listingId:string,vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);

    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    user.run(owner.user_id,owner.email,'Fitment Owner','+254700400001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(other.user_id,other.email,'Other Seller','+254700400002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(admin.user_id,admin.email,'Fitment Admin','+254700400003','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Fitment Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrgId,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+owner.user_id,owner.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+other.user_id,other.user_id,otherOrgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+admin.user_id,admin.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const vehicle=vehicleService.createVehicle(owner,{
      make:'Toyota',model:'Corolla',model_year:2018,trim:'GLi',variant:'1.8',
      registration_number:'KDA 123A',initial_odometer_value:81000
    });
    vehicleId=vehicle.vehicle.id;

    const store=marketplaceService.createStore(owner,{
      organization_id:orgId,slug:'fitment-parts-hub',display_name:'Fitment Parts Hub'
    });
    storeId=store.id;
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});

    const product=marketplaceService.createProduct(owner,storeId,{
      category_id:'mcat_brakes',product_type:'PART',seller_sku:'FIT-BRK-001',
      title:'Front brake pad set',description:'Replacement brake pads.',brand:'ExampleBrand',
      manufacturer_part_number:'EB-FIT-1001',condition:'NEW'
    });
    productId=product.id;

    const listing=marketplaceService.createListing(owner,storeId,productId,{
      price_minor:125000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:8,
      fulfillment_modes:['PICKUP']
    });
    listingId=listing.id;
    marketplaceService.publishListing(owner,storeId,listingId);
  });

  it('creates normalized fitment schema while preserving product-global fitment UNKNOWN',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'marketplace_fitment_sources','marketplace_product_fitment_rules',
      'marketplace_fitment_decisions','marketplace_fitment_installations'
    ])assert.ok(tables.includes(table),table+' must exist');

    const product=db.prepare('SELECT fitment_status FROM marketplace_products WHERE id=?').get(productId) as any;
    assert.equal(product.fitment_status,'UNKNOWN');
    assert.throws(()=>db.prepare("UPDATE marketplace_products SET fitment_status='CONFIRMED' WHERE id=?").run(productId));
  });

  it('keeps seller fitment as an explicit seller claim and never a guarantee',()=>{
    const rule=fitmentService.createSellerRule(owner,storeId,productId,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2017,year_to:2019,
      trim:'GLi',evidence_reference:'seller-catalog-42',evidence_summary:'Seller catalog states this range.'
    });
    assert.equal(rule.source_type,'SELLER');
    assert.equal(rule.verification_status,'SELLER_ASSERTED');

    const decision=fitmentService.evaluateListing(owner,listingId,vehicleId,false);
    assert.equal(decision.status,'SELLER_CLAIMED');
    assert.equal(decision.guaranteed,false);
    assert.ok(decision.confidence<80);
  });

  it('supports verified fitment authorities without converting confirmation into a guarantee',()=>{
    const source=fitmentService.createSource(admin,{
      source_type:'MANUFACTURER',display_name:'Example Manufacturer Catalog',
      provider_key:'example-manufacturer',verification_authority:true,trust_rank:95
    });
    fitmentService.createAuthoritativeRule(admin,{
      product_id:productId,source_id:source.id,verification_status:'VERIFIED',
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018,
      trim:'GLi',evidence_reference:'OEM-CAT-2018-COROLLA'
    });

    const decision=fitmentService.evaluateListing(owner,listingId,vehicleId,true);
    assert.equal(decision.status,'CONFIRMED');
    assert.equal(decision.guaranteed,false);
    assert.ok(decision.id);

    const persisted=db.prepare('SELECT guaranteed,decision_status FROM marketplace_fitment_decisions WHERE id=?').get(decision.id) as any;
    assert.equal(persisted.guaranteed,0);
    assert.equal(persisted.decision_status,'CONFIRMED');
    assert.throws(()=>db.prepare('UPDATE marketplace_fitment_decisions SET guaranteed=1 WHERE id=?').run(decision.id));
  });

  it('marks non-authoritative catalog evidence PROBABLE and generic products GENERIC',()=>{
    const catalog=fitmentService.createSource(admin,{
      source_type:'CATALOG_PROVIDER',display_name:'External Fitment Catalog',
      provider_key:'external-catalog-v1',verification_authority:false,trust_rank:85
    });
    fitmentService.createAuthoritativeRule(admin,{
      product_id:productId,source_id:catalog.id,verification_status:'VERIFIED',
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2020
    });
    assert.equal(fitmentService.evaluateListing(owner,listingId,vehicleId,false).status,'PROBABLE');

    const genericProduct=marketplaceService.createProduct(owner,storeId,{
      category_id:'mcat_accessories',product_type:'ACCESSORY',seller_sku:'FIT-GEN-002',
      title:'Universal boot organizer',description:'General storage accessory.',condition:'NEW'
    });
    const genericListing=marketplaceService.createListing(owner,storeId,genericProduct.id,{
      price_minor:300000,currency:'KES',inventory_tracking:'NONE',inventory_status:'IN_STOCK',
      fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(owner,storeId,genericListing.id);
    fitmentService.createSellerRule(owner,storeId,genericProduct.id,{rule_kind:'GENERIC'});
    assert.equal(fitmentService.evaluateListing(owner,genericListing.id,vehicleId,false).status,'GENERIC');
  });

  it('surfaces conflicting include/exclude evidence and excludes conflicts from My Car compatible search',()=>{
    const source=fitmentService.createSource(admin,{
      source_type:'PLATFORM_CURATED',display_name:'Curated Test Source',
      provider_key:'curated-test',verification_authority:true,trust_rank:100
    });
    fitmentService.createAuthoritativeRule(admin,{
      product_id:productId,source_id:source.id,rule_kind:'INCLUDE',
      vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(owner,storeId,productId,{
      rule_kind:'EXCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018,
      evidence_summary:'Seller warns this variant is excluded.'
    });

    const decision=fitmentService.evaluateListing(owner,listingId,vehicleId,false);
    assert.equal(decision.status,'CONFLICT');
    assert.ok(decision.conflict_rule_ids.length>=2);

    const search=fitmentService.searchForVehicle(owner,vehicleId,{query:'brake'},false);
    assert.equal(search.compatibility_counts.CONFLICT,1);
    assert.equal(search.items.some((item:any)=>item.listing_id===listingId),false);
    assert.equal(search.truth.conflicts_excluded_from_compatible_results,true);
  });

  it('can include UNKNOWN results only when the owner explicitly asks for them',()=>{
    const defaultSearch=fitmentService.searchForVehicle(owner,vehicleId,{query:'brake'},false);
    assert.equal(defaultSearch.items.some((item:any)=>item.listing_id===listingId),false);
    assert.equal(defaultSearch.compatibility_counts.UNKNOWN,1);

    const expanded=fitmentService.searchForVehicle(owner,vehicleId,{query:'brake'},true);
    const row=expanded.items.find((item:any)=>item.listing_id===listingId);
    assert.ok(row);
    assert.equal(row.fitment.status,'UNKNOWN');
    assert.equal(expanded.truth.unknown_included,true);
  });

  it('records installation linkage with the fitment state known at installation time',()=>{
    fitmentService.createSellerRule(owner,storeId,productId,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    const recorded=fitmentService.recordInstallation(owner,vehicleId,{
      product_id:productId,listing_id:listingId,notes:'Owner-recorded installation.'
    });
    assert.equal(recorded.fitment.status,'SELLER_CLAIMED');
    assert.equal(recorded.installation.fitment_status_at_install,'SELLER_CLAIMED');
    assert.equal(recorded.installation.verification_status,'UNVERIFIED');

    const history=fitmentService.listInstallations(owner,vehicleId);
    assert.equal(history.length,1);
    assert.equal(history[0].product_id,productId);
  });

  it('enforces seller tenant isolation for fitment management',()=>{
    assert.throws(
      ()=>fitmentService.createSellerRule(other,storeId,productId,{
        rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla'
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });
});
