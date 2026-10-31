/**
 * Sprint 22 — Marketplace Foundation (GAR-021)
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string,orgId:string,orgName:string,role='OWNER'){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],
    memberships:[{
      membership_id:'mem_'+userId,organization_id:orgId,organization_name:orgName,
      organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',
      role,status:'ACTIVE'
    }],
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}

describe('Marketplace Foundation (GAR-021 / Sprint 22)',()=>{
  let db:any;
  const orgId='org_market_01',otherOrgId='org_market_02';
  const owner=actor('usr_market_owner','owner@market.test',orgId,'Market Seller');
  const other=actor('usr_market_other','other@market.test',otherOrgId,'Other Seller');
  let storeId:string;
  let productId:string;
  let listingId:string;

  beforeEach(()=>{
    resetDatabaseInstance();
    db=getDatabase({memory:true});
    runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    user.run(owner.user_id,owner.email,'Market Owner','+254700300001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(other.user_id,other.email,'Other Seller','+254700300002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Market Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrgId,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+owner.user_id,owner.user_id,orgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+other.user_id,other.user_id,otherOrgId,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const store=marketplaceService.createStore(owner,{
      organization_id:orgId,slug:'garage-parts-hub',display_name:'Garage Parts Hub',
      description:'Automotive parts and accessories'
    });
    storeId=store.id;
    productId='';
    listingId='';
  });

  function createProduct(){
    const product=marketplaceService.createProduct(owner,storeId,{
      category_id:'mcat_brakes',product_type:'PART',seller_sku:'BRK-001',
      title:'Front brake pad set',description:'Replacement front brake pad set.',
      brand:'ExampleBrand',manufacturer_part_number:'EB-1001',condition:'NEW',
      authenticity_claim:'SELLER_CLAIMED_AFTERMARKET',warranty_summary:'Seller states a 6 month warranty.'
    });
    productId=product.id;
    return product;
  }

  function createListing(overrides:any={}){
    if(!productId)createProduct();
    const listing=marketplaceService.createListing(owner,storeId,productId,{
      price_minor:125000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:8,
      fulfillment_modes:['PICKUP','LOCAL_DELIVERY'],...overrides
    });
    listingId=listing.id;
    return listing;
  }

  it('creates normalized marketplace schema and category taxonomy without premature order/payment tables',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of [
      'marketplace_stores','marketplace_categories','marketplace_products','marketplace_listings',
      'marketplace_listing_media','marketplace_listing_price_snapshots','marketplace_listing_search_projection'
    ]) assert.ok(tables.includes(table),table+' must exist');
    assert.equal(tables.includes('marketplace_orders'),false);
    assert.equal(tables.includes('marketplace_payments'),false);
    const categories=marketplaceService.listCategories();
    assert.ok(categories.some((c:any)=>c.code==='PARTS'));
    assert.ok(categories.some((c:any)=>c.code==='TYRES'));
    assert.ok(categories.some((c:any)=>c.code==='BRAKE_PARTS'&&c.parent_id==='mcat_parts'));
  });

  it('keeps storefront draft/private until seller explicitly activates it',()=>{
    const store=marketplaceService.listSellerStores(owner,orgId)[0];
    assert.equal(store.status,'DRAFT');
    const product=createProduct();
    const listing=createListing();
    assert.equal(product.status,'DRAFT');
    assert.equal(listing.status,'DRAFT');
    assert.equal(marketplaceService.search({}).total,0);
  });

  it('forces product fitment to UNKNOWN and authenticity to NOT_VERIFIED',()=>{
    const product=createProduct();
    assert.equal(product.fitment_status,'UNKNOWN');
    assert.equal(product.authenticity_verification_status,'NOT_VERIFIED');
    assert.equal(product.authenticity_claim,'SELLER_CLAIMED_AFTERMARKET');

    assert.throws(
      ()=>db.prepare("UPDATE marketplace_products SET fitment_status='CONFIRMED' WHERE id=?").run(product.id)
    );
    assert.throws(
      ()=>db.prepare("UPDATE marketplace_products SET authenticity_verification_status='VERIFIED' WHERE id=?").run(product.id)
    );
  });

  it('stores money as integer minor units with ISO currency and preserves the initial price snapshot',()=>{
    const listing=createListing();
    assert.equal(listing.price_minor,125000);
    assert.equal(listing.currency,'KES');
    assert.equal(Number.isInteger(listing.price_minor),true);
    const snapshots=db.prepare(
      'SELECT * FROM marketplace_listing_price_snapshots WHERE listing_id=? ORDER BY captured_at'
    ).all(listing.id) as any[];
    assert.equal(snapshots.length,1);
    assert.equal(snapshots[0].captured_reason,'CREATED');
    assert.equal(snapshots[0].price_minor,125000);
  });

  it('derives truthful stock status for quantity-tracked listings',()=>{
    const zero=createListing({stock_quantity:0});
    assert.equal(zero.inventory_status,'OUT_OF_STOCK');

    // A second product is required because one canonical listing belongs to one product.
    const p2=marketplaceService.createProduct(owner,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'FLT-002',
      title:'Oil filter',description:'Replacement oil filter.',condition:'NEW'
    });
    const low=marketplaceService.createListing(owner,storeId,p2.id,{
      price_minor:90000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:2,
      inventory_status:'IN_STOCK',fulfillment_modes:['PICKUP']
    });
    assert.equal(low.inventory_status,'LOW_STOCK');
  });

  it('requires active store, positive price and fulfillment before public publication',()=>{
    const listing=createListing();
    assert.throws(
      ()=>marketplaceService.publishListing(owner,storeId,listing.id),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );

    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    const noFulfillProduct=marketplaceService.createProduct(owner,storeId,{
      category_id:'mcat_accessories',product_type:'ACCESSORY',seller_sku:'ACC-003',
      title:'Boot organizer',description:'Vehicle storage organizer.',condition:'NEW'
    });
    const noFulfill=marketplaceService.createListing(owner,storeId,noFulfillProduct.id,{
      price_minor:250000,currency:'KES',inventory_tracking:'NONE',inventory_status:'IN_STOCK',
      fulfillment_modes:[]
    });
    assert.throws(
      ()=>marketplaceService.publishListing(owner,storeId,noFulfill.id),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
  });

  it('publishes only through seller workflow and exposes explicit no-fitment/no-checkout truth',()=>{
    createProduct();const listing=createListing();
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    const published=marketplaceService.publishListing(owner,storeId,listing.id);
    assert.equal(published.status,'PUBLISHED');

    const search=marketplaceService.search({});
    assert.equal(search.total,1);
    assert.equal(search.items[0].fitment_status,'UNKNOWN');
    assert.equal(search.items[0].authenticity_verification_status,'NOT_VERIFIED');
    assert.equal(search.truth.fitment_confirmed,false);
    assert.equal(search.truth.checkout_available,false);
    assert.equal(search.truth.order_creation_available,false);
    assert.equal(search.truth.payment_available,false);

    const detail=marketplaceService.getListingDetail(listing.id);
    assert.equal(detail.truth.compatibility_status,'UNKNOWN');
    assert.equal(detail.truth.fitment_confirmed,false);
    assert.equal(detail.truth.authenticity_verified,false);
    assert.equal(detail.truth.checkout_available,false);
    assert.equal(detail.truth.order_creation_available,false);
    assert.equal(detail.truth.payment_available,false);
  });

  it('updates price/inventory with versioning and rebuilds the discovery projection',()=>{
    createProduct();const listing=createListing();
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    marketplaceService.publishListing(owner,storeId,listing.id);
    const current=marketplaceService.getSellerListing(owner,storeId,listing.id).listing;
    const updated=marketplaceService.updateListing(owner,storeId,listing.id,{
      price_minor:119900,stock_quantity:2,currency:'KES'
    });
    assert.equal(updated.version,current.version+1);
    assert.equal(updated.inventory_status,'LOW_STOCK');
    const detail=marketplaceService.getListingDetail(listing.id);
    assert.equal(detail.price_minor,119900);
    assert.equal(detail.inventory_status,'LOW_STOCK');

    const history=marketplaceService.getSellerListing(owner,storeId,listing.id).price_snapshots;
    assert.ok(history.length>=3);
    assert.ok(history.some((s:any)=>s.captured_reason==='PUBLISHED'));
    assert.ok(history.some((s:any)=>s.captured_reason==='UPDATED'&&s.price_minor===119900));
  });

  it('supports deterministic buyer search filters only over discoverable listings',()=>{
    createProduct();const listing=createListing();
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    marketplaceService.publishListing(owner,storeId,listing.id);

    assert.equal(marketplaceService.search({query:'brake'}).total,1);
    assert.equal(marketplaceService.search({category:'BRAKE_PARTS'}).total,1);
    assert.equal(marketplaceService.search({brand:'ExampleBrand'}).total,1);
    assert.equal(marketplaceService.search({product_type:'TYRE'}).total,0);
    assert.equal(marketplaceService.search({min_price_minor:130000}).total,0);
    assert.equal(marketplaceService.search({max_price_minor:125000}).total,1);
  });

  it('removes listings from public discovery when listing or store is paused',()=>{
    createProduct();const listing=createListing();
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    marketplaceService.publishListing(owner,storeId,listing.id);
    assert.equal(marketplaceService.search({}).total,1);

    marketplaceService.pauseListing(owner,storeId,listing.id);
    assert.equal(marketplaceService.search({}).total,0);

    marketplaceService.publishListing(owner,storeId,listing.id);
    assert.equal(marketplaceService.search({}).total,1);
    marketplaceService.updateStore(owner,storeId,{status:'PAUSED'});
    assert.equal(marketplaceService.search({}).total,0);
  });

  it('attaches only available actor-owned media and projects the primary image reference',()=>{
    createProduct();const listing=createListing();
    db.prepare(`
      INSERT INTO file_objects
      (id,storage_key,filename,content_type,size_bytes,scan_status,owner_id,data_classification,metadata,created_at,updated_at)
      VALUES (?,?,?,?,?,'AVAILABLE',?,'INTERNAL','{}',?,?)
    `).run('file_market_01','objects/file_market_01.jpg','brakes.jpg','image/jpeg',1000,owner.user_id,
      '2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    marketplaceService.addListingMedia(owner,storeId,listing.id,{
      file_object_id:'file_market_01',media_role:'IMAGE',alt_text:'Brake pad product image',is_primary:true
    });
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    marketplaceService.publishListing(owner,storeId,listing.id);
    const detail=marketplaceService.getListingDetail(listing.id);
    assert.equal(detail.primary_media_file_id,'file_market_01');
    assert.equal(detail.media.length,1);
  });

  it('enforces organization tenant isolation for seller management',()=>{
    assert.throws(
      ()=>marketplaceService.listSellerStores(other,orgId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
    assert.throws(
      ()=>marketplaceService.createProduct(other,storeId,{
        category_id:'mcat_parts',product_type:'PART',seller_sku:'X',title:'Cross tenant',
        description:'Forbidden product',condition:'NEW'
      }),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('publishing event truth never claims fitment, authenticity, order or payment capability',()=>{
    createProduct();const listing=createListing();
    marketplaceService.updateStore(owner,storeId,{status:'ACTIVE'});
    marketplaceService.publishListing(owner,storeId,listing.id);
    const row=db.prepare(
      "SELECT payload FROM outbox_events WHERE type='marketplace.listing.published' AND correlation_id=? ORDER BY created_at DESC LIMIT 1"
    ).get(listing.id) as any;
    assert.ok(row);
    const payload=JSON.parse(row.payload);
    assert.equal(payload.fitment_status,'UNKNOWN');
    assert.equal(payload.authenticity_verification_status,'NOT_VERIFIED');
    assert.equal(payload.checkout_available,false);
    assert.equal(payload.order_creation_available,false);
    assert.equal(payload.payment_available,false);
  });
});
