import { getDatabase } from '../database/connection';
import { MarketplaceListingCard } from '../marketplace/types';
import {
  MarketplaceAlert, MarketplaceAlertPreferences, MarketplaceEngagementSummary,
  MarketplaceSavedListing, MarketplaceSavedListingDetail, MarketplaceSavedSearch,
  MarketplaceSellerEngagement
} from './types';

function parseCriteria(value:unknown):any{
  try{const v=JSON.parse(String(value||'{}'));return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}
}
function parseArray(value:unknown):string[]{
  try{const v=JSON.parse(String(value||'[]'));return Array.isArray(v)?v.map(String):[];}catch{return [];}
}
function card(r:any):MarketplaceListingCard{
  return {
    listing_id:String(r.listing_id),product_id:String(r.product_id),store_id:String(r.store_id),
    store_slug:String(r.store_slug),store_name:String(r.store_name),title:String(r.title),
    description:String(r.description),category_code:String(r.category_code),category_name:String(r.category_name),
    product_type:r.product_type,brand:r.brand?String(r.brand):null,condition:r.condition,
    price_minor:Number(r.price_minor),compare_at_price_minor:r.compare_at_price_minor===null?null:Number(r.compare_at_price_minor),
    currency:String(r.currency),inventory_status:r.inventory_status,fulfillment_modes:parseArray(r.fulfillment_modes_json) as any,
    primary_media_file_id:r.primary_media_file_id?String(r.primary_media_file_id):null,
    authenticity_claim:r.authenticity_claim,authenticity_verification_status:'NOT_VERIFIED',fitment_status:'UNKNOWN'
  };
}
function savedListing(r:any):MarketplaceSavedListing{
  return {
    id:String(r.id),user_id:String(r.user_id),listing_id:String(r.listing_id),
    price_minor_at_save:Number(r.price_minor_at_save),inventory_status_at_save:String(r.inventory_status_at_save),
    last_seen_price_minor:Number(r.last_seen_price_minor),last_seen_inventory_status:String(r.last_seen_inventory_status),
    price_drop_alert_enabled:Boolean(r.price_drop_alert_enabled),restock_alert_enabled:Boolean(r.restock_alert_enabled),
    saved_at:String(r.saved_at),updated_at:String(r.updated_at)
  };
}
function savedSearch(r:any):MarketplaceSavedSearch{
  return {
    id:String(r.id),user_id:String(r.user_id),name:String(r.name),criteria:parseCriteria(r.criteria_json),
    vehicle_id:r.vehicle_id?String(r.vehicle_id):null,new_match_alert_enabled:Boolean(r.new_match_alert_enabled),
    status:r.status,created_at:String(r.created_at),updated_at:String(r.updated_at)
  };
}
function alert(r:any):MarketplaceAlert{
  return {
    id:String(r.id),user_id:String(r.user_id),alert_type:r.alert_type,listing_id:r.listing_id?String(r.listing_id):null,
    saved_listing_id:r.saved_listing_id?String(r.saved_listing_id):null,saved_search_id:r.saved_search_id?String(r.saved_search_id):null,
    fingerprint:String(r.fingerprint),title:String(r.title),body:String(r.body),state:r.state,
    created_at:String(r.created_at),read_at:r.read_at?String(r.read_at):null,dismissed_at:r.dismissed_at?String(r.dismissed_at):null
  };
}
function prefs(r:any):MarketplaceAlertPreferences{
  return {
    user_id:String(r.user_id),in_app_enabled:Boolean(r.in_app_enabled),email_requested:Boolean(r.email_requested),
    sms_requested:Boolean(r.sms_requested),push_requested:Boolean(r.push_requested),max_alerts_per_day:Number(r.max_alerts_per_day),
    quiet_hours_start:r.quiet_hours_start?String(r.quiet_hours_start):null,
    quiet_hours_end:r.quiet_hours_end?String(r.quiet_hours_end):null,updated_at:String(r.updated_at)
  };
}

export class MarketplaceEngagementRepository{
  getProjection(listingId:string){
    return getDatabase().prepare('SELECT * FROM marketplace_listing_search_projection WHERE listing_id=? AND is_discoverable=1 LIMIT 1').get(listingId) as any||null;
  }
  getAnyListingState(listingId:string){
    return getDatabase().prepare(`
      SELECT l.id listing_id,l.store_id,l.price_minor,l.inventory_status,l.status,p.title
      FROM marketplace_listings l JOIN marketplace_products p ON p.id=l.product_id WHERE l.id=? LIMIT 1
    `).get(listingId) as any||null;
  }

  getSavedListing(userId:string,listingId:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_saved_listings WHERE user_id=? AND listing_id=? LIMIT 1').get(userId,listingId) as any;
    return r?savedListing(r):null;
  }
  getSavedListingById(id:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_saved_listings WHERE id=? LIMIT 1').get(id) as any;
    return r?savedListing(r):null;
  }
  createSavedListing(v:MarketplaceSavedListing){
    getDatabase().prepare(`
      INSERT INTO marketplace_saved_listings
      (id,user_id,listing_id,price_minor_at_save,inventory_status_at_save,last_seen_price_minor,last_seen_inventory_status,
       price_drop_alert_enabled,restock_alert_enabled,saved_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.user_id,v.listing_id,v.price_minor_at_save,v.inventory_status_at_save,v.last_seen_price_minor,
      v.last_seen_inventory_status,v.price_drop_alert_enabled?1:0,v.restock_alert_enabled?1:0,v.saved_at,v.updated_at);return v;
  }
  updateSavedListing(v:MarketplaceSavedListing){
    getDatabase().prepare(`
      UPDATE marketplace_saved_listings SET last_seen_price_minor=?,last_seen_inventory_status=?,
        price_drop_alert_enabled=?,restock_alert_enabled=?,updated_at=? WHERE id=? AND user_id=?
    `).run(v.last_seen_price_minor,v.last_seen_inventory_status,v.price_drop_alert_enabled?1:0,v.restock_alert_enabled?1:0,
      v.updated_at,v.id,v.user_id);return v;
  }
  removeSavedListing(userId:string,id:string){
    return Number(getDatabase().prepare('DELETE FROM marketplace_saved_listings WHERE id=? AND user_id=?').run(id,userId).changes||0)===1;
  }
  listSavedListings(userId:string):MarketplaceSavedListingDetail[]{
    const rows=getDatabase().prepare('SELECT * FROM marketplace_saved_listings WHERE user_id=? ORDER BY saved_at DESC').all(userId) as any[];
    return rows.map(r=>{
      const s=savedListing(r),p=this.getProjection(s.listing_id);
      return {saved:s,listing:p?card(p):null,availability:p?'DISCOVERABLE':'UNAVAILABLE'} as MarketplaceSavedListingDetail;
    });
  }
  listSavedListingOwners(listingId:string){
    return (getDatabase().prepare('SELECT DISTINCT user_id FROM marketplace_saved_listings WHERE listing_id=?').all(listingId) as any[]).map(r=>String(r.user_id));
  }

  createSavedSearch(v:MarketplaceSavedSearch){
    getDatabase().prepare(`
      INSERT INTO marketplace_saved_searches
      (id,user_id,name,criteria_json,vehicle_id,new_match_alert_enabled,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.user_id,v.name,JSON.stringify(v.criteria),v.vehicle_id,v.new_match_alert_enabled?1:0,v.status,v.created_at,v.updated_at);return v;
  }
  getSavedSearch(id:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_saved_searches WHERE id=? LIMIT 1').get(id) as any;
    return r?savedSearch(r):null;
  }
  listSavedSearches(userId:string){
    return (getDatabase().prepare('SELECT * FROM marketplace_saved_searches WHERE user_id=? ORDER BY created_at DESC').all(userId) as any[]).map(savedSearch);
  }
  updateSavedSearch(v:MarketplaceSavedSearch){
    getDatabase().prepare(`
      UPDATE marketplace_saved_searches SET name=?,criteria_json=?,vehicle_id=?,new_match_alert_enabled=?,status=?,updated_at=?
      WHERE id=? AND user_id=?
    `).run(v.name,JSON.stringify(v.criteria),v.vehicle_id,v.new_match_alert_enabled?1:0,v.status,v.updated_at,v.id,v.user_id);return v;
  }
  removeSavedSearch(userId:string,id:string){
    return Number(getDatabase().prepare('DELETE FROM marketplace_saved_searches WHERE id=? AND user_id=?').run(id,userId).changes||0)===1;
  }
  listActiveSavedSearchUsers(){
    return (getDatabase().prepare("SELECT DISTINCT user_id FROM marketplace_saved_searches WHERE status='ACTIVE' AND new_match_alert_enabled=1").all() as any[]).map(r=>String(r.user_id));
  }
  markSearchMatch(savedSearchId:string,listingId:string,now:string,alertedAt:string|null){
    getDatabase().prepare(`
      INSERT INTO marketplace_saved_search_matches (saved_search_id,listing_id,first_seen_at,last_seen_at,alerted_at)
      VALUES (?,?,?,?,?)
      ON CONFLICT(saved_search_id,listing_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,
        alerted_at=COALESCE(marketplace_saved_search_matches.alerted_at,excluded.alerted_at)
    `).run(savedSearchId,listingId,now,now,alertedAt);
  }
  hasSearchMatch(savedSearchId:string,listingId:string){
    return Boolean(getDatabase().prepare('SELECT 1 FROM marketplace_saved_search_matches WHERE saved_search_id=? AND listing_id=? LIMIT 1').get(savedSearchId,listingId));
  }

  getPreferences(userId:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_alert_preferences WHERE user_id=? LIMIT 1').get(userId) as any;
    return r?prefs(r):null;
  }
  upsertPreferences(v:MarketplaceAlertPreferences){
    getDatabase().prepare(`
      INSERT INTO marketplace_alert_preferences
      (user_id,in_app_enabled,email_requested,sms_requested,push_requested,max_alerts_per_day,quiet_hours_start,quiet_hours_end,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET in_app_enabled=excluded.in_app_enabled,email_requested=excluded.email_requested,
        sms_requested=excluded.sms_requested,push_requested=excluded.push_requested,max_alerts_per_day=excluded.max_alerts_per_day,
        quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,updated_at=excluded.updated_at
    `).run(v.user_id,v.in_app_enabled?1:0,v.email_requested?1:0,v.sms_requested?1:0,v.push_requested?1:0,
      v.max_alerts_per_day,v.quiet_hours_start,v.quiet_hours_end,v.updated_at);return v;
  }

  createAlert(v:MarketplaceAlert){
    try{
      getDatabase().prepare(`
        INSERT INTO marketplace_alerts
        (id,user_id,alert_type,listing_id,saved_listing_id,saved_search_id,fingerprint,title,body,state,created_at,read_at,dismissed_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `).run(v.id,v.user_id,v.alert_type,v.listing_id,v.saved_listing_id,v.saved_search_id,v.fingerprint,
        v.title,v.body,v.state,v.created_at,v.read_at,v.dismissed_at);return true;
    }catch(err:any){
      if(String(err?.message||err).toLowerCase().includes('unique'))return false;
      throw err;
    }
  }
  listAlerts(userId:string,state?:string){
    const rows=state
      ?getDatabase().prepare('SELECT * FROM marketplace_alerts WHERE user_id=? AND state=? ORDER BY created_at DESC').all(userId,state)
      :getDatabase().prepare('SELECT * FROM marketplace_alerts WHERE user_id=? ORDER BY created_at DESC LIMIT 200').all(userId);
    return (rows as any[]).map(alert);
  }
  getAlert(id:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_alerts WHERE id=? LIMIT 1').get(id) as any;return r?alert(r):null;
  }
  updateAlert(v:MarketplaceAlert){
    getDatabase().prepare('UPDATE marketplace_alerts SET state=?,read_at=?,dismissed_at=? WHERE id=? AND user_id=?')
      .run(v.state,v.read_at,v.dismissed_at,v.id,v.user_id);return v;
  }
  alertCountSince(userId:string,since:string){
    const r=getDatabase().prepare('SELECT COUNT(*) count FROM marketplace_alerts WHERE user_id=? AND created_at>=?').get(userId,since) as any;
    return Number(r?.count||0);
  }

  summary(userId:string):MarketplaceEngagementSummary{
    const saved=getDatabase().prepare('SELECT COUNT(*) count FROM marketplace_saved_listings WHERE user_id=?').get(userId) as any;
    const searches=getDatabase().prepare("SELECT COUNT(*) count FROM marketplace_saved_searches WHERE user_id=? AND status='ACTIVE'").get(userId) as any;
    const unread=getDatabase().prepare("SELECT COUNT(*) count FROM marketplace_alerts WHERE user_id=? AND state='UNREAD'").get(userId) as any;
    return {saved_listing_count:Number(saved?.count||0),active_saved_search_count:Number(searches?.count||0),unread_alert_count:Number(unread?.count||0),
      truth:{browsing_history_persisted:false,saved_state_is_explicit_user_intent:true,external_delivery_available:false}};
  }

  sellerEngagement(storeId:string):MarketplaceSellerEngagement{
    const rows=getDatabase().prepare(`
      SELECT l.id listing_id,p.title,l.status,COUNT(s.id) saved_count
      FROM marketplace_listings l
      JOIN marketplace_products p ON p.id=l.product_id
      LEFT JOIN marketplace_saved_listings s ON s.listing_id=l.id
      WHERE l.store_id=?
      GROUP BY l.id,p.title,l.status
      ORDER BY saved_count DESC,p.title COLLATE NOCASE
    `).all(storeId) as any[];
    return {store_id:storeId,total_saved_instances:rows.reduce((n,r)=>n+Number(r.saved_count||0),0),
      listings:rows.map(r=>({listing_id:String(r.listing_id),title:String(r.title),status:String(r.status),saved_count:Number(r.saved_count||0)})),
      privacy:{saver_identities_exposed:false,aggregate_only:true}};
  }
}
export const marketplaceEngagementRepository=new MarketplaceEngagementRepository();
