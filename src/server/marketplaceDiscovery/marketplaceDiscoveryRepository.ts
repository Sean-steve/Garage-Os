import { getDatabase } from '../database/connection';
import { MarketplaceListingCard } from '../marketplace/types';
import {
  MarketplaceMerchandisingCollection, MarketplaceMerchandisingCollectionDetail,
  MarketplaceMerchandisingItem
} from './types';

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
function collection(r:any):MarketplaceMerchandisingCollection{
  return {
    id:String(r.id),owner_type:r.owner_type,store_id:r.store_id?String(r.store_id):null,slug:String(r.slug),
    title:String(r.title),description:r.description?String(r.description):null,surface:r.surface,
    category_code:r.category_code?String(r.category_code):null,status:r.status,source_label:r.source_label,
    starts_at:r.starts_at?String(r.starts_at):null,ends_at:r.ends_at?String(r.ends_at):null,
    created_by:String(r.created_by),created_at:String(r.created_at),updated_at:String(r.updated_at)
  };
}
function item(r:any):MarketplaceMerchandisingItem{
  return {id:String(r.id),collection_id:String(r.collection_id),listing_id:String(r.listing_id),
    sort_order:Number(r.sort_order),added_by:String(r.added_by),created_at:String(r.created_at)};
}

export class MarketplaceDiscoveryRepository{
  searchRows(criteria:{
    tokens:string[][];category?:string;product_type?:string;condition?:string;brand?:string;currency?:string;
    min_price_minor?:number;max_price_minor?:number;in_stock_only?:boolean;store_slug?:string;
  }):any[]{
    const where=['p.is_discoverable=1'];const params:any[]=[];
    for(const alternatives of criteria.tokens){
      where.push('('+alternatives.map(()=> 'p.search_text LIKE ?').join(' OR ')+')');
      for(const token of alternatives)params.push('%'+token+'%');
    }
    if(criteria.category){where.push('p.category_code=?');params.push(criteria.category.trim().toUpperCase());}
    if(criteria.product_type){where.push('p.product_type=?');params.push(criteria.product_type);}
    if(criteria.condition){where.push('p.condition=?');params.push(criteria.condition);}
    if(criteria.brand){where.push('LOWER(p.brand)=?');params.push(criteria.brand.trim().toLowerCase());}
    if(criteria.currency){where.push('p.currency=?');params.push(criteria.currency.toUpperCase());}
    if(criteria.min_price_minor!==undefined){where.push('p.price_minor>=?');params.push(criteria.min_price_minor);}
    if(criteria.max_price_minor!==undefined){where.push('p.price_minor<=?');params.push(criteria.max_price_minor);}
    if(criteria.in_stock_only){where.push("p.inventory_status IN ('IN_STOCK','LOW_STOCK','MADE_TO_ORDER')");}
    if(criteria.store_slug){where.push('p.store_slug=?');params.push(criteria.store_slug);}
    return getDatabase().prepare(`
      SELECT p.*,
        (SELECT COUNT(*) FROM marketplace_reviews r
          WHERE r.store_id=p.store_id AND r.status='PUBLISHED' AND r.verified_purchase=1) verified_review_count,
        (SELECT AVG(r.rating) FROM marketplace_reviews r
          WHERE r.store_id=p.store_id AND r.status='PUBLISHED' AND r.verified_purchase=1) average_rating
      FROM marketplace_listing_search_projection p
      WHERE ${where.join(' AND ')}
      ORDER BY p.listing_id
      LIMIT 500
    `).all(...params) as any[];
  }
  toCard(r:any){return card(r);}

  createCollection(v:MarketplaceMerchandisingCollection){
    getDatabase().prepare(`
      INSERT INTO marketplace_merchandising_collections
      (id,owner_type,store_id,slug,title,description,surface,category_code,status,source_label,starts_at,ends_at,
       created_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(v.id,v.owner_type,v.store_id,v.slug,v.title,v.description,v.surface,v.category_code,v.status,v.source_label,
      v.starts_at,v.ends_at,v.created_by,v.created_at,v.updated_at);return v;
  }
  updateCollection(v:MarketplaceMerchandisingCollection){
    getDatabase().prepare(`
      UPDATE marketplace_merchandising_collections
      SET slug=?,title=?,description=?,surface=?,category_code=?,status=?,starts_at=?,ends_at=?,updated_at=?
      WHERE id=?
    `).run(v.slug,v.title,v.description,v.surface,v.category_code,v.status,v.starts_at,v.ends_at,v.updated_at,v.id);
    return v;
  }
  getCollection(id:string){
    const r=getDatabase().prepare('SELECT * FROM marketplace_merchandising_collections WHERE id=? LIMIT 1').get(id) as any;
    return r?collection(r):null;
  }
  listStoreCollections(storeId:string){
    return (getDatabase().prepare("SELECT * FROM marketplace_merchandising_collections WHERE owner_type='STORE' AND store_id=? ORDER BY created_at DESC").all(storeId) as any[]).map(collection);
  }
  listPlatformCollections(){
    return (getDatabase().prepare("SELECT * FROM marketplace_merchandising_collections WHERE owner_type='PLATFORM' ORDER BY created_at DESC").all() as any[]).map(collection);
  }
  replaceItems(collectionId:string,values:MarketplaceMerchandisingItem[]){
    const db=getDatabase();db.prepare('DELETE FROM marketplace_merchandising_items WHERE collection_id=?').run(collectionId);
    const stmt=db.prepare(`
      INSERT INTO marketplace_merchandising_items (id,collection_id,listing_id,sort_order,added_by,created_at)
      VALUES (?,?,?,?,?,?)
    `);
    for(const v of values)stmt.run(v.id,v.collection_id,v.listing_id,v.sort_order,v.added_by,v.created_at);
  }
  listItems(collectionId:string){
    return (getDatabase().prepare('SELECT * FROM marketplace_merchandising_items WHERE collection_id=? ORDER BY sort_order,id').all(collectionId) as any[]).map(item);
  }
  detail(v:MarketplaceMerchandisingCollection):MarketplaceMerchandisingCollectionDetail{
    const items=this.listItems(v.id).map(mi=>{
      const row=getDatabase().prepare('SELECT * FROM marketplace_listing_search_projection WHERE listing_id=? AND is_discoverable=1').get(mi.listing_id) as any;
      return row?{merchandising_item:mi,listing:card(row)}:null;
    }).filter(Boolean) as MarketplaceMerchandisingCollectionDetail['items'];
    return {collection:v,items,disclosure:{source_label:v.source_label,paid_placement:false,affects_organic_ranking:false}};
  }
  listActive(args:{surface:string;storeId?:string|null;categoryCode?:string|null;now:string}){
    const where=["status='ACTIVE'","(starts_at IS NULL OR starts_at<=?)","(ends_at IS NULL OR ends_at>=?)","surface=?"];
    const params:any[]=[args.now,args.now,args.surface];
    if(args.storeId){where.push("(store_id=? OR owner_type='PLATFORM')");params.push(args.storeId);}
    if(args.surface==='CATEGORY'&&args.categoryCode){where.push('category_code=?');params.push(args.categoryCode.toUpperCase());}
    return (getDatabase().prepare('SELECT * FROM marketplace_merchandising_collections WHERE '+where.join(' AND ')+' ORDER BY owner_type,created_at DESC').all(...params) as any[]).map(collection);
  }
}
export const marketplaceDiscoveryRepository=new MarketplaceDiscoveryRepository();
