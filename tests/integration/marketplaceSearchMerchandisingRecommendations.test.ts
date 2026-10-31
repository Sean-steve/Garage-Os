/**
 * Sprint 28 — Marketplace Search Quality, Merchandising & Recommendations
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceDiscoveryService } from '../../src/server/marketplaceDiscovery/marketplaceDiscoveryService';
import { fitmentService } from '../../src/server/fitment/fitmentService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';
import { PlatformRole } from '../../src/server/identity/types';

function actor(userId:string,email:string,memberships:any[]=[],platformRoles:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:platformRoles,memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Marketplace Search Quality, Merchandising & Recommendations (Sprint 28)',()=>{
  let db:any;
  const orgA='org_disc_a',orgB='org_disc_b';
  const sellerA=actor('usr_disc_seller_a','seller-a@disc.test',[membership('usr_disc_seller_a',orgA,'Discovery A')]);
  const sellerB=actor('usr_disc_seller_b','seller-b@disc.test',[membership('usr_disc_seller_b',orgB,'Discovery B')]);
  const buyer=actor('usr_disc_buyer','buyer@disc.test');
  const admin=actor('usr_disc_admin','admin@disc.test',[],[PlatformRole.PLATFORM_ADMIN]);
  let storeA:string,storeB:string,vehicleId:string,counter=0;

  beforeEach(()=>{
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const users=[
      [sellerA.user_id,sellerA.email,'Seller A','+254702000001'],
      [sellerB.user_id,sellerB.email,'Seller B','+254702000002'],
      [buyer.user_id,buyer.email,'Buyer','+254702000003'],
      [admin.user_id,admin.email,'Admin','+254702000004'],
    ];
    for(const [id,email,name,phone] of users)user.run(id,email,name,phone,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgA,'Discovery A','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(orgB,'Discovery B','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+sellerA.user_id,sellerA.user_id,orgA,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+sellerB.user_id,sellerB.user_id,orgB,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    storeA=marketplaceService.createStore(sellerA,{organization_id:orgA,slug:'discovery-a',display_name:'Discovery A'}).id;
    marketplaceService.updateStore(sellerA,storeA,{status:'ACTIVE'});
    storeB=marketplaceService.createStore(sellerB,{organization_id:orgB,slug:'discovery-b',display_name:'Discovery B'}).id;
    marketplaceService.updateStore(sellerB,storeB,{status:'ACTIVE'});

    vehicleId=vehicleService.createVehicle(buyer,{
      make:'Toyota',model:'Corolla',model_year:2018,trim:'GLi',variant:'1.8',registration_number:'KDG 280A',initial_odometer_value:60000
    }).vehicle.id;
  });

  function makeListing(args:{
    seller?:any;storeId?:string;category?:string;type?:any;title:string;description:string;brand?:string;
    sku?:string;mpn?:string;inventory?:'IN_STOCK'|'LOW_STOCK'|'OUT_OF_STOCK';
  }){
    counter++;const seller=args.seller||sellerA,storeId=args.storeId||storeA;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:args.category||'mcat_brakes',product_type:args.type||'PART',seller_sku:args.sku||('DISC-'+counter),
      title:args.title,description:args.description,brand:args.brand||'ExampleBrand',
      manufacturer_part_number:args.mpn||('MPN-'+counter),condition:'NEW'
    });
    const qty=args.inventory==='OUT_OF_STOCK'?0:args.inventory==='LOW_STOCK'?2:10;
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:100000+counter*1000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:qty,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    return {product,listing};
  }

  it('creates merchandising schema without fabricated shelves or search-history storage',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>String(r.name));
    assert.ok(tables.includes('marketplace_merchandising_collections'));
    assert.ok(tables.includes('marketplace_merchandising_items'));
    assert.equal(tables.some((x:string)=>/search_history|behavioral_profile/.test(x)),false);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_merchandising_collections').get() as any).count,0);
  });

  it('indexes SKU and manufacturer part number and supports automotive spelling aliases',()=>{
    const sku=makeListing({category:'mcat_filters',title:'Premium cabin filter',description:'Cabin filtration product.',sku:'CAB-7788',mpn:'OEM-CF-909'});
    const tyre=makeListing({category:'mcat_tyres',type:'TYRE',title:'All season tyre',description:'Road tyre for passenger vehicle.',sku:'TYR-1'});
    const bySku=marketplaceDiscoveryService.search(buyer,{query:'CAB-7788'});
    assert.equal(bySku.items[0].listing_id,sku.listing.id);
    const byMpn=marketplaceDiscoveryService.search(buyer,{query:'OEM-CF-909'});
    assert.equal(byMpn.items[0].listing_id,sku.listing.id);
    const byAlias=marketplaceDiscoveryService.search(buyer,{query:'tire'});
    assert.equal(byAlias.items.some(x=>x.listing_id===tyre.listing.id),true);
  });

  it('ranks exact/title relevance above description-only matches and exposes score components',()=>{
    const title=makeListing({title:'Ceramic brake pad set',description:'Low dust friction material.'});
    const desc=makeListing({title:'Front axle service kit',description:'Includes a ceramic brake pad set and hardware.'});
    const result=marketplaceDiscoveryService.search(buyer,{query:'ceramic brake pad set'});
    assert.equal(result.items[0].listing_id,title.listing.id);
    assert.equal(result.items.some(x=>x.listing_id===desc.listing.id),true);
    assert.ok(result.items[0].rank_components.some(x=>x.key==='QUERY'));
    assert.ok(result.items[0].rank_components.some(x=>x.key==='AVAILABILITY'));
    assert.equal(result.truth.ranking_explainable,true);
    assert.equal(result.truth.raw_search_history_persisted,false);
  });

  it('keeps merchandising separate from organic ranking and discloses seller curation',()=>{
    const first=makeListing({title:'Brake pad set premium',description:'Brake pad set high friction.'});
    const second=makeListing({title:'Budget pad kit',description:'Budget brake pad set for routine use.'});
    const before=marketplaceDiscoveryService.search(buyer,{query:'brake pad set'}).items.map(x=>x.listing_id);
    const collection=marketplaceDiscoveryService.createSellerCollection(sellerA,storeA,{
      slug:'seller-picks',title:'Seller Picks',description:'Our selected listings.',surface:'STORE'
    });
    marketplaceDiscoveryService.replaceSellerCollectionItems(sellerA,storeA,collection.collection.id,{listing_ids:[second.listing.id,first.listing.id]});
    marketplaceDiscoveryService.updateSellerCollection(sellerA,storeA,collection.collection.id,{status:'ACTIVE'});
    const after=marketplaceDiscoveryService.search(buyer,{query:'brake pad set'}).items.map(x=>x.listing_id);
    assert.deepEqual(after,before);
    const publicShelf=marketplaceDiscoveryService.listPublicCollections('STORE',storeA,null).collections[0];
    assert.equal(publicShelf.disclosure.source_label,'SELLER_CURATED');
    assert.equal(publicShelf.disclosure.paid_placement,false);
    assert.equal(publicShelf.disclosure.affects_organic_ranking,false);
  });

  it('enforces seller storefront-only merchandising and own-listing tenancy',()=>{
    const own=makeListing({title:'Own seller item',description:'Own listing.'});
    const other=makeListing({seller:sellerB,storeId:storeB,title:'Other seller item',description:'Other listing.'});
    assert.throws(
      ()=>marketplaceDiscoveryService.createSellerCollection(sellerA,storeA,{slug:'home-spam',title:'Home spam',surface:'HOME'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
    const collection=marketplaceDiscoveryService.createSellerCollection(sellerA,storeA,{slug:'store-only',title:'Store Only',surface:'STORE'});
    assert.throws(
      ()=>marketplaceDiscoveryService.replaceSellerCollectionItems(sellerA,storeA,collection.collection.id,{listing_ids:[own.listing.id,other.listing.id]}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplaceDiscoveryService.listSellerCollections(sellerB,storeA),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('supports explicitly labeled platform curation without paid placement',()=>{
    const a=makeListing({title:'Platform curated brake kit',description:'Curated item.'});
    const p=marketplaceDiscoveryService.createPlatformCollection(admin,{slug:'home-picks',title:'Home Picks',description:'Platform editorial selection.',surface:'HOME'});
    marketplaceDiscoveryService.replacePlatformCollectionItems(admin,p.collection.id,{listing_ids:[a.listing.id]});
    marketplaceDiscoveryService.updatePlatformCollection(admin,p.collection.id,{status:'ACTIVE'});
    const result=marketplaceDiscoveryService.listPublicCollections('HOME').collections;
    assert.equal(result.length,1);
    assert.equal(result[0].disclosure.source_label,'PLATFORM_CURATED');
    assert.equal(result[0].disclosure.paid_placement,false);
    assert.equal(result[0].items[0].listing.listing_id,a.listing.id);
  });

  it('vehicle-aware search excludes known conflicts and never claims a guarantee',()=>{
    const good=makeListing({title:'Corolla front brake pad',description:'Toyota Corolla brake pad.'});
    const bad=makeListing({title:'Corolla alternate brake pad',description:'Alternative Toyota Corolla pad.'});
    const unknown=makeListing({title:'Corolla generic accessory',description:'No fitment evidence.'});
    fitmentService.createSellerRule(sellerA,storeA,good.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(sellerA,storeA,bad.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(sellerA,storeA,bad.product.id,{
      rule_kind:'EXCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    const search=marketplaceDiscoveryService.search(buyer,{query:'Corolla',vehicle_id:vehicleId,include_unknown_fitment:true});
    assert.equal(search.items.some(x=>x.listing_id===bad.listing.id),false);
    assert.equal(search.items.some(x=>x.listing_id===good.listing.id),true);
    assert.equal(search.items.some(x=>x.listing_id===unknown.listing.id),true);
    assert.equal(search.items.find(x=>x.listing_id===good.listing.id)!.fitment!.guaranteed,false);
    assert.equal(search.truth.fitment_guaranteed,false);
  });

  it('vehicle recommendations include positive evidence only and exclude UNKNOWN/conflict',()=>{
    const good=makeListing({title:'Recommended Corolla filter',description:'Toyota Corolla filter.',category:'mcat_filters'});
    const unknown=makeListing({title:'Unknown Corolla filter',description:'Toyota Corolla filter with no fitment rule.',category:'mcat_filters'});
    const conflict=makeListing({title:'Conflicting Corolla filter',description:'Toyota Corolla filter.',category:'mcat_filters'});
    fitmentService.createSellerRule(sellerA,storeA,good.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(sellerA,storeA,conflict.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(sellerA,storeA,conflict.product.id,{
      rule_kind:'EXCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    const recs=marketplaceDiscoveryService.recommendationsForVehicle(buyer,vehicleId,{category:'FILTERS',limit:20});
    assert.equal(recs.items.some(x=>x.listing_id===good.listing.id),true);
    assert.equal(recs.items.some(x=>x.listing_id===unknown.listing.id),false);
    assert.equal(recs.items.some(x=>x.listing_id===conflict.listing.id),false);
    assert.equal(recs.truth.behavioral_profile_used,false);
    assert.equal(recs.truth.unknown_fitment_recommended,false);
  });

  it('related recommendations are contextual, explainable, and independent from merchandising',()=>{
    const seed=makeListing({title:'Seed brake disc',description:'Brake disc.',brand:'BrandX'});
    const related=makeListing({title:'BrandX brake pads',description:'Brake pads.',brand:'BrandX'});
    const unrelated=makeListing({category:'mcat_filters',title:'Oil filter',description:'Engine oil filter.',brand:'BrandX'});
    const before=marketplaceDiscoveryService.relatedToListing(buyer,seed.listing.id,null,10);
    assert.equal(before.items.some(x=>x.listing_id===related.listing.id),true);
    assert.equal(before.items.some(x=>x.listing_id===unrelated.listing.id),false);
    assert.ok(before.items[0].rank_components.some(x=>x.key==='RELATEDNESS'));

    const shelf=marketplaceDiscoveryService.createPlatformCollection(admin,{slug:'related-does-not-boost',title:'Editorial',surface:'HOME'});
    marketplaceDiscoveryService.replacePlatformCollectionItems(admin,shelf.collection.id,{listing_ids:[related.listing.id]});
    marketplaceDiscoveryService.updatePlatformCollection(admin,shelf.collection.id,{status:'ACTIVE'});
    const after=marketplaceDiscoveryService.relatedToListing(buyer,seed.listing.id,null,10);
    assert.deepEqual(after.items.map(x=>x.listing_id),before.items.map(x=>x.listing_id));
    assert.equal(after.truth.merchandising_affects_recommendations,false);
  });

  it('does not persist raw search history or behavioral profiles when searching/recommending',()=>{
    makeListing({title:'Privacy-safe brake item',description:'Searchable item.'});
    marketplaceDiscoveryService.search(buyer,{query:'privacy-safe'});
    marketplaceDiscoveryService.recommendationsForVehicle(buyer,vehicleId,{limit:10});
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>String(r.name));
    assert.equal(tables.some((x:string)=>/search_history|behavioral_profile|recommendation_profile/.test(x)),false);
  });
});
