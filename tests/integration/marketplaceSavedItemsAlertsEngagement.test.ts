/**
 * Sprint 29 — Marketplace Saved Items, Alerts & Engagement
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceEngagementService } from '../../src/server/marketplaceEngagement/marketplaceEngagementService';
import { runMarketplaceAlertEvaluationJob } from '../../src/server/jobs/marketplaceEngagementJob';
import { fitmentService } from '../../src/server/fitment/fitmentService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string,memberships:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-11-01T00:00:00.000Z',updated_at:'2026-11-01T00:00:00.000Z'},session_id:'ses_'+userId,
  } as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Marketplace Saved Items, Alerts & Engagement (Sprint 29)',()=>{
  let db:any;
  const orgA='org_eng_a',orgB='org_eng_b';
  const sellerA=actor('usr_eng_seller_a','seller-a@eng.test',[membership('usr_eng_seller_a',orgA,'Engagement A')]);
  const sellerB=actor('usr_eng_seller_b','seller-b@eng.test',[membership('usr_eng_seller_b',orgB,'Engagement B')]);
  const buyer=actor('usr_eng_buyer','buyer@eng.test');
  const buyer2=actor('usr_eng_buyer2','buyer2@eng.test');
  let storeA:string,storeB:string,vehicleId:string,counter=0;

  beforeEach(()=>{
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    const users=[
      [sellerA.user_id,sellerA.email,'Seller A','+254703000001'],
      [sellerB.user_id,sellerB.email,'Seller B','+254703000002'],
      [buyer.user_id,buyer.email,'Buyer','+254703000003'],
      [buyer2.user_id,buyer2.email,'Buyer 2','+254703000004'],
    ];
    for(const [id,email,name,phone] of users)user.run(id,email,name,phone,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgA,'Engagement A','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    org.run(orgB,'Engagement B','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+sellerA.user_id,sellerA.user_id,orgA,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');
    mem.run('mem_'+sellerB.user_id,sellerB.user_id,orgB,'2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z','2026-11-01T00:00:00.000Z');

    storeA=marketplaceService.createStore(sellerA,{organization_id:orgA,slug:'engagement-a',display_name:'Engagement A'}).id;
    marketplaceService.updateStore(sellerA,storeA,{status:'ACTIVE'});
    storeB=marketplaceService.createStore(sellerB,{organization_id:orgB,slug:'engagement-b',display_name:'Engagement B'}).id;
    marketplaceService.updateStore(sellerB,storeB,{status:'ACTIVE'});

    vehicleId=vehicleService.createVehicle(buyer,{
      make:'Toyota',model:'Corolla',model_year:2018,trim:'GLi',variant:'1.8',
      registration_number:'KDH 290A',initial_odometer_value:70000
    }).vehicle.id;
  });

  function makeListing(args:{
    seller?:any;storeId?:string;title:string;description?:string;category?:string;stock?:number;price?:number;
  }){
    counter++;const seller=args.seller||sellerA,storeId=args.storeId||storeA;
    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:args.category||'mcat_brakes',product_type:'PART',seller_sku:'ENG-'+counter,
      title:args.title,description:args.description||args.title,brand:'Example',manufacturer_part_number:'ENG-MPN-'+counter,
      condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:args.price||200000,currency:'KES',inventory_tracking:'QUANTITY',
      stock_quantity:args.stock===undefined?8:args.stock,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);
    return {product,listing};
  }

  it('creates engagement schema with no fabricated saved state or alerts',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>String(r.name));
    for(const table of ['marketplace_saved_listings','marketplace_saved_searches','marketplace_saved_search_matches',
      'marketplace_alert_preferences','marketplace_alerts'])assert.ok(tables.includes(table),table+' must exist');
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_saved_listings').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_saved_searches').get() as any).count,0);
    assert.equal((db.prepare('SELECT COUNT(*) count FROM marketplace_alerts').get() as any).count,0);
    assert.equal(tables.some((x:string)=>/browsing_history|search_history|behavioral_profile/.test(x)),false);
  });

  it('saves a discoverable listing with explicit price/inventory baseline and is idempotent',()=>{
    const {listing}=makeListing({title:'Saved brake pads',price:240000,stock:5});
    const first=marketplaceEngagementService.saveListing(buyer,listing.id,{});
    const second=marketplaceEngagementService.saveListing(buyer,listing.id,{});
    assert.equal(first.saved.id,second.saved.id);
    assert.equal(first.saved.price_minor_at_save,240000);
    assert.equal(first.saved.inventory_status_at_save,'IN_STOCK');
    assert.equal(first.saved.price_drop_alert_enabled,true);
    assert.equal(marketplaceEngagementService.summary(buyer).saved_listing_count,1);
  });

  it('creates one deduplicated price-drop alert and listing updates enqueue durable evaluation',()=>{
    const {listing}=makeListing({title:'Price alert pads',price:300000,stock:6});
    marketplaceEngagementService.saveListing(buyer,listing.id,{price_drop_alert_enabled:true});
    db.prepare("DELETE FROM job_instances WHERE job_name='marketplace.engagement.alert.evaluate'").run();

    marketplaceService.updateListing(sellerA,storeA,listing.id,{price_minor:250000});
    const jobs=db.prepare("SELECT * FROM job_instances WHERE job_name='marketplace.engagement.alert.evaluate'").all() as any[];
    assert.equal(jobs.length,1);
    assert.equal(JSON.parse(jobs[0].payload).listing_id,listing.id);

    const first=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(first.alerts_created,1);
    const alert=marketplaceEngagementService.listAlerts(buyer)[0];
    assert.equal(alert.alert_type,'SAVED_LISTING_PRICE_DROP');
    assert.equal(first.truth.external_delivery_attempted,false);

    const second=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(second.alerts_created,0);
    assert.equal(marketplaceEngagementService.listAlerts(buyer).length,1);
  });

  it('generates restock only when availability transitions from unavailable to available',()=>{
    const {listing}=makeListing({title:'Restock part',price:100000,stock:0});
    marketplaceEngagementService.saveListing(buyer,listing.id,{restock_alert_enabled:true,price_drop_alert_enabled:false});
    marketplaceService.updateListing(sellerA,storeA,listing.id,{stock_quantity:9});
    const result=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(result.alerts_created,1);
    assert.equal(marketplaceEngagementService.listAlerts(buyer)[0].alert_type,'SAVED_LISTING_RESTOCK');
    assert.equal(marketplaceEngagementService.evaluateForUser(buyer).alerts_created,0);
  });

  it('saved searches baseline current results and alert only on later new matches',()=>{
    const existing=makeListing({title:'Ceramic brake pad baseline',description:'Ceramic brake pad'});
    const saved=marketplaceEngagementService.createSavedSearch(buyer,{
      name:'Ceramic pads',criteria:{query:'ceramic brake pad'},new_match_alert_enabled:true
    });
    assert.equal(saved.baseline_match_count,1);
    assert.equal(marketplaceEngagementService.listAlerts(buyer).length,0);

    const fresh=makeListing({title:'Ceramic brake pad new arrival',description:'New ceramic brake pad'});
    const result=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(result.alerts_created,1);
    const alerts=marketplaceEngagementService.listAlerts(buyer);
    assert.equal(alerts[0].alert_type,'SAVED_SEARCH_NEW_MATCH');
    assert.equal(alerts[0].listing_id,fresh.listing.id);
    assert.notEqual(alerts[0].listing_id,existing.listing.id);
  });

  it('vehicle-aware saved search preserves fitment exclusion and does not alert conflict/unknown matches',()=>{
    const saved=marketplaceEngagementService.createSavedSearch(buyer,{
      name:'My Corolla filters',criteria:{query:'Corolla filter'},vehicle_id:vehicleId,new_match_alert_enabled:true
    });
    assert.equal(saved.baseline_match_count,0);

    const good=makeListing({title:'Corolla filter fit',description:'Corolla filter',category:'mcat_filters'});
    fitmentService.createSellerRule(sellerA,storeA,good.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    const unknown=makeListing({title:'Corolla filter unknown',description:'Corolla filter',category:'mcat_filters'});
    const conflict=makeListing({title:'Corolla filter conflict',description:'Corolla filter',category:'mcat_filters'});
    fitmentService.createSellerRule(sellerA,storeA,conflict.product.id,{
      rule_kind:'INCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    fitmentService.createSellerRule(sellerA,storeA,conflict.product.id,{
      rule_kind:'EXCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });

    const result=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(result.alerts_created,1);
    const listingIds=marketplaceEngagementService.listAlerts(buyer).map(x=>x.listing_id);
    assert.equal(listingIds.includes(good.listing.id),true);
    assert.equal(listingIds.includes(unknown.listing.id),false);
    assert.equal(listingIds.includes(conflict.listing.id),false);
  });

  it('enforces daily alert cap without losing the suppressed saved-item baseline',()=>{
    const a=makeListing({title:'Daily cap item A',price:300000});
    const b=makeListing({title:'Daily cap item B',price:400000});
    marketplaceEngagementService.saveListing(buyer,a.listing.id,{price_drop_alert_enabled:true,restock_alert_enabled:false});
    marketplaceEngagementService.saveListing(buyer,b.listing.id,{price_drop_alert_enabled:true,restock_alert_enabled:false});
    marketplaceEngagementService.updatePreferences(buyer,{max_alerts_per_day:1});
    marketplaceService.updateListing(sellerA,storeA,a.listing.id,{price_minor:250000});
    marketplaceService.updateListing(sellerA,storeA,b.listing.id,{price_minor:350000});
    const first=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(first.alerts_created,1);
    assert.equal(first.limited_by_daily_cap,true);

    marketplaceEngagementService.updatePreferences(buyer,{max_alerts_per_day:2});
    const second=marketplaceEngagementService.evaluateForUser(buyer);
    assert.equal(second.alerts_created,1);
    assert.equal(marketplaceEngagementService.listAlerts(buyer).length,2);
  });

  it('stores external-channel preferences without claiming or attempting external delivery',()=>{
    const updated=marketplaceEngagementService.updatePreferences(buyer,{
      email_requested:true,sms_requested:true,push_requested:true,quiet_hours_start:'22:00',quiet_hours_end:'07:00'
    });
    assert.equal(updated.preferences.email_requested,true);
    assert.equal(updated.delivery_availability.email,false);
    assert.equal(updated.delivery_availability.sms,false);
    assert.equal(updated.delivery_availability.push,false);
    assert.equal(updated.truth.external_delivery_attempted,false);
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>String(r.name));
    assert.equal(tables.some((x:string)=>/marketplace.*delivery_attempt/.test(x)),false);
  });

  it('background worker evaluates listing changes with reconstructed actor context',async()=>{
    const {listing}=makeListing({title:'Worker price alert',price:500000});
    marketplaceEngagementService.saveListing(buyer,listing.id,{price_drop_alert_enabled:true,restock_alert_enabled:false});
    marketplaceService.updateListing(sellerA,storeA,listing.id,{price_minor:450000});
    await runMarketplaceAlertEvaluationJob({listing_id:listing.id},'corr-test-worker');
    const alerts=marketplaceEngagementService.listAlerts(buyer);
    assert.equal(alerts.length,1);
    assert.equal(alerts[0].alert_type,'SAVED_LISTING_PRICE_DROP');
  });

  it('supports read/dismiss lifecycle with user ownership isolation',()=>{
    const {listing}=makeListing({title:'Alert lifecycle',price:200000});
    marketplaceEngagementService.saveListing(buyer,listing.id,{price_drop_alert_enabled:true});
    marketplaceService.updateListing(sellerA,storeA,listing.id,{price_minor:180000});
    marketplaceEngagementService.evaluateForUser(buyer);
    const alert=marketplaceEngagementService.listAlerts(buyer)[0];
    const read=marketplaceEngagementService.updateAlertState(buyer,alert.id,'READ');
    assert.equal(read.state,'READ');
    assert.ok(read.read_at);
    assert.throws(
      ()=>marketplaceEngagementService.updateAlertState(buyer2,alert.id,'DISMISSED'),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
    const dismissed=marketplaceEngagementService.updateAlertState(buyer,alert.id,'DISMISSED');
    assert.equal(dismissed.state,'DISMISSED');
    assert.ok(dismissed.dismissed_at);
  });

  it('seller engagement is aggregate-only and tenant-scoped',()=>{
    const a=makeListing({title:'Popular saved listing'});
    const b=makeListing({seller:sellerB,storeId:storeB,title:'Other store listing'});
    marketplaceEngagementService.saveListing(buyer,a.listing.id,{});
    marketplaceEngagementService.saveListing(buyer2,a.listing.id,{});
    marketplaceEngagementService.saveListing(buyer,b.listing.id,{});

    const stats=marketplaceEngagementService.sellerEngagement(sellerA,storeA);
    assert.equal(stats.total_saved_instances,2);
    assert.equal(stats.listings.find(x=>x.listing_id===a.listing.id)!.saved_count,2);
    assert.equal(stats.privacy.saver_identities_exposed,false);
    assert.equal(JSON.stringify(stats).includes(buyer.user_id),false);
    assert.equal(JSON.stringify(stats).includes(buyer2.user_id),false);

    assert.throws(
      ()=>marketplaceEngagementService.sellerEngagement(sellerB,storeA),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('paused saved search produces no new-match alert until reactivated',()=>{
    marketplaceEngagementService.createSavedSearch(buyer,{name:'Paused brakes',criteria:{query:'paused brake'},new_match_alert_enabled:true});
    const saved=marketplaceEngagementService.listSavedSearches(buyer)[0];
    marketplaceEngagementService.updateSavedSearch(buyer,saved.id,{status:'PAUSED'});
    makeListing({title:'Paused brake product',description:'paused brake'});
    assert.equal(marketplaceEngagementService.evaluateForUser(buyer).alerts_created,0);
    marketplaceEngagementService.updateSavedSearch(buyer,saved.id,{status:'ACTIVE'});
    assert.equal(marketplaceEngagementService.evaluateForUser(buyer).alerts_created,1);
  });
});
