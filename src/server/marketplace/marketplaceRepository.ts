import { getDatabase } from '../database/connection';
import {
  MarketplaceCategory,
  MarketplaceListing,
  MarketplaceListingCard,
  MarketplaceListingDetail,
  MarketplaceListingMedia,
  MarketplacePriceSnapshot,
  MarketplaceProduct,
  MarketplaceStore,
} from './types';

function parseStringArray(value:unknown):string[]{
  try{
    const parsed=JSON.parse(String(value||'[]'));
    return Array.isArray(parsed)?parsed.map(String):[];
  }catch{return [];}
}

export class MarketplaceRepository {
  listCategories():MarketplaceCategory[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_categories WHERE is_active=1 ORDER BY sort_order,name'
    ).all() as any[]).map(r=>({
      id:String(r.id),code:String(r.code),parent_id:r.parent_id?String(r.parent_id):null,
      name:String(r.name),description:r.description?String(r.description):null,
      sort_order:Number(r.sort_order),is_active:Boolean(r.is_active),
      created_at:String(r.created_at),updated_at:String(r.updated_at)
    }));
  }

  getCategory(id:string):MarketplaceCategory|null{
    const r=getDatabase().prepare(
      'SELECT * FROM marketplace_categories WHERE id=? AND is_active=1 LIMIT 1'
    ).get(id) as any;
    return r?{
      id:String(r.id),code:String(r.code),parent_id:r.parent_id?String(r.parent_id):null,
      name:String(r.name),description:r.description?String(r.description):null,
      sort_order:Number(r.sort_order),is_active:Boolean(r.is_active),
      created_at:String(r.created_at),updated_at:String(r.updated_at)
    }:null;
  }

  createStore(store:MarketplaceStore):MarketplaceStore{
    getDatabase().prepare(`
      INSERT INTO marketplace_stores
      (id,organization_id,provider_id,slug,display_name,description,support_phone,support_email,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      store.id,store.organization_id,store.provider_id,store.slug,store.display_name,store.description,
      store.support_phone,store.support_email,store.status,store.created_at,store.updated_at
    );
    return store;
  }

  getStoreById(id:string):MarketplaceStore|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_stores WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapStore(r):null;
  }

  getStoreBySlug(slug:string):MarketplaceStore|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_stores WHERE slug=? LIMIT 1').get(slug) as any;
    return r?this.mapStore(r):null;
  }

  listStoresForOrganization(organizationId:string):MarketplaceStore[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_stores WHERE organization_id=? ORDER BY created_at DESC'
    ).all(organizationId) as any[]).map(this.mapStore);
  }

  updateStore(store:MarketplaceStore):boolean{
    const r=getDatabase().prepare(`
      UPDATE marketplace_stores SET provider_id=?,slug=?,display_name=?,description=?,
        support_phone=?,support_email=?,status=?,updated_at=?
      WHERE id=? AND organization_id=?
    `).run(
      store.provider_id,store.slug,store.display_name,store.description,
      store.support_phone,store.support_email,store.status,store.updated_at,
      store.id,store.organization_id
    );
    return Number(r.changes||0)===1;
  }

  createProduct(product:MarketplaceProduct):MarketplaceProduct{
    getDatabase().prepare(`
      INSERT INTO marketplace_products
      (id,store_id,category_id,product_type,seller_sku,title,description,brand,
       manufacturer_part_number,condition,authenticity_claim,authenticity_verification_status,
       warranty_summary,status,fitment_status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      product.id,product.store_id,product.category_id,product.product_type,product.seller_sku,
      product.title,product.description,product.brand,product.manufacturer_part_number,
      product.condition,product.authenticity_claim,product.authenticity_verification_status,
      product.warranty_summary,product.status,product.fitment_status,product.created_at,product.updated_at
    );
    return product;
  }

  getProduct(id:string):MarketplaceProduct|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_products WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapProduct(r):null;
  }

  listProductsForStore(storeId:string):MarketplaceProduct[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_products WHERE store_id=? ORDER BY created_at DESC'
    ).all(storeId) as any[]).map(this.mapProduct);
  }

  updateProduct(product:MarketplaceProduct):boolean{
    const r=getDatabase().prepare(`
      UPDATE marketplace_products SET category_id=?,product_type=?,seller_sku=?,title=?,description=?,
        brand=?,manufacturer_part_number=?,condition=?,authenticity_claim=?,warranty_summary=?,
        status=?,updated_at=?
      WHERE id=? AND store_id=?
    `).run(
      product.category_id,product.product_type,product.seller_sku,product.title,product.description,
      product.brand,product.manufacturer_part_number,product.condition,product.authenticity_claim,
      product.warranty_summary,product.status,product.updated_at,product.id,product.store_id
    );
    return Number(r.changes||0)===1;
  }

  createListing(listing:MarketplaceListing):MarketplaceListing{
    getDatabase().prepare(`
      INSERT INTO marketplace_listings
      (id,store_id,product_id,status,price_minor,compare_at_price_minor,currency,inventory_tracking,
       stock_quantity,inventory_status,fulfillment_modes_json,published_at,paused_at,retired_at,
       version,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      listing.id,listing.store_id,listing.product_id,listing.status,listing.price_minor,
      listing.compare_at_price_minor,listing.currency,listing.inventory_tracking,listing.stock_quantity,
      listing.inventory_status,JSON.stringify(listing.fulfillment_modes),listing.published_at,
      listing.paused_at,listing.retired_at,listing.version,listing.created_at,listing.updated_at
    );
    return listing;
  }

  getListing(id:string):MarketplaceListing|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_listings WHERE id=? LIMIT 1').get(id) as any;
    return r?this.mapListing(r):null;
  }

  getListingByProduct(productId:string):MarketplaceListing|null{
    const r=getDatabase().prepare(
      'SELECT * FROM marketplace_listings WHERE product_id=? LIMIT 1'
    ).get(productId) as any;
    return r?this.mapListing(r):null;
  }

  listListingsForStore(storeId:string):MarketplaceListing[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_listings WHERE store_id=? ORDER BY created_at DESC'
    ).all(storeId) as any[]).map(this.mapListing);
  }

  updateListing(listing:MarketplaceListing):boolean{
    const r=getDatabase().prepare(`
      UPDATE marketplace_listings SET status=?,price_minor=?,compare_at_price_minor=?,currency=?,
        inventory_tracking=?,stock_quantity=?,inventory_status=?,fulfillment_modes_json=?,
        published_at=?,paused_at=?,retired_at=?,version=?,updated_at=?
      WHERE id=? AND store_id=? AND version<?
    `).run(
      listing.status,listing.price_minor,listing.compare_at_price_minor,listing.currency,
      listing.inventory_tracking,listing.stock_quantity,listing.inventory_status,
      JSON.stringify(listing.fulfillment_modes),listing.published_at,listing.paused_at,
      listing.retired_at,listing.version,listing.updated_at,listing.id,listing.store_id,listing.version
    );
    return Number(r.changes||0)===1;
  }

  insertPriceSnapshot(snapshot:MarketplacePriceSnapshot):void{
    getDatabase().prepare(`
      INSERT INTO marketplace_listing_price_snapshots
      (id,listing_id,version,price_minor,compare_at_price_minor,currency,inventory_status,captured_reason,captured_by,captured_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      snapshot.id,snapshot.listing_id,snapshot.version,snapshot.price_minor,
      snapshot.compare_at_price_minor,snapshot.currency,snapshot.inventory_status,
      snapshot.captured_reason,snapshot.captured_by,snapshot.captured_at
    );
  }

  listPriceSnapshots(listingId:string):MarketplacePriceSnapshot[]{
    return getDatabase().prepare(
      'SELECT * FROM marketplace_listing_price_snapshots WHERE listing_id=? ORDER BY captured_at DESC'
    ).all(listingId) as unknown as MarketplacePriceSnapshot[];
  }

  addMedia(media:MarketplaceListingMedia):MarketplaceListingMedia{
    if(media.is_primary){
      getDatabase().prepare(
        'UPDATE marketplace_listing_media SET is_primary=0 WHERE listing_id=?'
      ).run(media.listing_id);
    }
    getDatabase().prepare(`
      INSERT INTO marketplace_listing_media
      (id,listing_id,file_object_id,media_role,alt_text,sort_order,is_primary,created_at)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      media.id,media.listing_id,media.file_object_id,media.media_role,media.alt_text,
      media.sort_order,media.is_primary?1:0,media.created_at
    );
    return media;
  }

  listMedia(listingId:string):MarketplaceListingMedia[]{
    return (getDatabase().prepare(
      'SELECT * FROM marketplace_listing_media WHERE listing_id=? ORDER BY is_primary DESC,sort_order,id'
    ).all(listingId) as any[]).map(r=>({
      id:String(r.id),listing_id:String(r.listing_id),file_object_id:String(r.file_object_id),
      media_role:r.media_role,alt_text:r.alt_text?String(r.alt_text):null,
      sort_order:Number(r.sort_order),is_primary:Boolean(r.is_primary),created_at:String(r.created_at)
    }));
  }

  removeMedia(listingId:string,mediaId:string):boolean{
    const r=getDatabase().prepare(
      'DELETE FROM marketplace_listing_media WHERE id=? AND listing_id=?'
    ).run(mediaId,listingId);
    return Number(r.changes||0)===1;
  }

  rebuildSearchProjection(listingId:string,updatedAt:string):void{
    const db=getDatabase();
    const row=db.prepare(`
      SELECT
        l.id AS listing_id,l.product_id,l.store_id,s.slug AS store_slug,s.display_name AS store_name,
        s.status AS store_status,o.status AS organization_status,
        p.title,p.description,p.product_type,p.brand,p.condition,p.authenticity_claim,
        p.authenticity_verification_status,p.fitment_status,p.status AS product_status,
        c.code AS category_code,c.name AS category_name,
        l.status AS listing_status,l.price_minor,l.compare_at_price_minor,l.currency,
        l.inventory_status,l.fulfillment_modes_json,
        (SELECT m.file_object_id FROM marketplace_listing_media m
          WHERE m.listing_id=l.id AND m.media_role='IMAGE'
          ORDER BY m.is_primary DESC,m.sort_order,m.id LIMIT 1) AS primary_media_file_id
      FROM marketplace_listings l
      JOIN marketplace_products p ON p.id=l.product_id
      JOIN marketplace_stores s ON s.id=l.store_id
      JOIN organizations o ON o.id=s.organization_id
      JOIN marketplace_categories c ON c.id=p.category_id
      WHERE l.id=?
    `).get(listingId) as any;

    if(!row){
      db.prepare('DELETE FROM marketplace_listing_search_projection WHERE listing_id=?').run(listingId);
      return;
    }

    const discoverable=
      row.store_status==='ACTIVE'&&
      row.organization_status==='ACTIVE'&&
      row.product_status==='PUBLISHED'&&
      row.listing_status==='PUBLISHED';

    const searchText=[
      row.title,row.description,row.brand,row.category_code,row.category_name,row.product_type,row.store_name
    ].filter(Boolean).join(' ').toLowerCase();

    db.prepare(`
      INSERT INTO marketplace_listing_search_projection
      (listing_id,product_id,store_id,store_slug,store_name,title,description,category_code,category_name,
       product_type,brand,condition,price_minor,compare_at_price_minor,currency,inventory_status,
       fulfillment_modes_json,primary_media_file_id,authenticity_claim,authenticity_verification_status,
       fitment_status,search_text,is_discoverable,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(listing_id) DO UPDATE SET
        product_id=excluded.product_id,store_id=excluded.store_id,store_slug=excluded.store_slug,
        store_name=excluded.store_name,title=excluded.title,description=excluded.description,
        category_code=excluded.category_code,category_name=excluded.category_name,
        product_type=excluded.product_type,brand=excluded.brand,condition=excluded.condition,
        price_minor=excluded.price_minor,compare_at_price_minor=excluded.compare_at_price_minor,
        currency=excluded.currency,inventory_status=excluded.inventory_status,
        fulfillment_modes_json=excluded.fulfillment_modes_json,
        primary_media_file_id=excluded.primary_media_file_id,authenticity_claim=excluded.authenticity_claim,
        authenticity_verification_status=excluded.authenticity_verification_status,
        fitment_status=excluded.fitment_status,search_text=excluded.search_text,
        is_discoverable=excluded.is_discoverable,updated_at=excluded.updated_at
    `).run(
      row.listing_id,row.product_id,row.store_id,row.store_slug,row.store_name,row.title,row.description,
      row.category_code,row.category_name,row.product_type,row.brand,row.condition,row.price_minor,
      row.compare_at_price_minor,row.currency,row.inventory_status,row.fulfillment_modes_json,
      row.primary_media_file_id,row.authenticity_claim,row.authenticity_verification_status,
      row.fitment_status,searchText,discoverable?1:0,updatedAt
    );
  }

  rebuildStoreProjections(storeId:string,updatedAt:string):void{
    const rows=getDatabase().prepare('SELECT id FROM marketplace_listings WHERE store_id=?').all(storeId) as any[];
    for(const row of rows)this.rebuildSearchProjection(String(row.id),updatedAt);
  }

  search(criteria:{
    query?:string;category?:string;product_type?:string;condition?:string;brand?:string;
    currency?:string;min_price_minor?:number;max_price_minor?:number;in_stock_only?:boolean;
    store_slug?:string;limit:number;offset:number;
  }):{items:MarketplaceListingCard[];total:number}{
    const where=['is_discoverable=1'];const params:any[]=[];
    if(criteria.query){where.push('search_text LIKE ?');params.push('%'+criteria.query.trim().toLowerCase()+'%');}
    if(criteria.category){where.push('category_code=?');params.push(criteria.category.trim().toUpperCase());}
    if(criteria.product_type){where.push('product_type=?');params.push(criteria.product_type);}
    if(criteria.condition){where.push('condition=?');params.push(criteria.condition);}
    if(criteria.brand){where.push('LOWER(brand)=?');params.push(criteria.brand.trim().toLowerCase());}
    if(criteria.currency){where.push('currency=?');params.push(criteria.currency.toUpperCase());}
    if(criteria.min_price_minor!==undefined){where.push('price_minor>=?');params.push(criteria.min_price_minor);}
    if(criteria.max_price_minor!==undefined){where.push('price_minor<=?');params.push(criteria.max_price_minor);}
    if(criteria.in_stock_only){where.push("inventory_status IN ('IN_STOCK','LOW_STOCK','MADE_TO_ORDER')");}
    if(criteria.store_slug){where.push('store_slug=?');params.push(criteria.store_slug);}
    const sqlWhere=where.join(' AND ');
    const totalRow=getDatabase().prepare(
      'SELECT COUNT(*) AS count FROM marketplace_listing_search_projection WHERE '+sqlWhere
    ).get(...params) as any;
    const rows=getDatabase().prepare(
      'SELECT * FROM marketplace_listing_search_projection WHERE '+sqlWhere+
      ' ORDER BY title COLLATE NOCASE,listing_id LIMIT ? OFFSET ?'
    ).all(...params,criteria.limit,criteria.offset) as any[];
    return {items:rows.map(this.mapCard),total:Number(totalRow?.count||0)};
  }

  getPublicListingDetail(listingId:string):MarketplaceListingDetail|null{
    const r=getDatabase().prepare(
      'SELECT * FROM marketplace_listing_search_projection WHERE listing_id=? AND is_discoverable=1 LIMIT 1'
    ).get(listingId) as any;
    if(!r)return null;
    const p=getDatabase().prepare(
      'SELECT seller_sku,manufacturer_part_number,warranty_summary FROM marketplace_products WHERE id=?'
    ).get(r.product_id) as any;
    const card=this.mapCard(r);
    return {
      ...card,seller_sku:String(p.seller_sku),
      manufacturer_part_number:p.manufacturer_part_number?String(p.manufacturer_part_number):null,
      warranty_summary:p.warranty_summary?String(p.warranty_summary):null,
      media:this.listMedia(listingId),
      truth:{
        fitment_confirmed:false,compatibility_status:'UNKNOWN',checkout_available:true,
        order_creation_available:true,payment_available:false,authenticity_verified:false
      }
    };
  }

  private mapStore=(r:any):MarketplaceStore=>({
    id:String(r.id),organization_id:String(r.organization_id),
    provider_id:r.provider_id?String(r.provider_id):null,slug:String(r.slug),
    display_name:String(r.display_name),description:r.description?String(r.description):null,
    support_phone:r.support_phone?String(r.support_phone):null,
    support_email:r.support_email?String(r.support_email):null,status:r.status,
    created_at:String(r.created_at),updated_at:String(r.updated_at)
  });

  private mapProduct=(r:any):MarketplaceProduct=>({
    id:String(r.id),store_id:String(r.store_id),category_id:String(r.category_id),
    product_type:r.product_type,seller_sku:String(r.seller_sku),title:String(r.title),
    description:String(r.description),brand:r.brand?String(r.brand):null,
    manufacturer_part_number:r.manufacturer_part_number?String(r.manufacturer_part_number):null,
    condition:r.condition,authenticity_claim:r.authenticity_claim,
    authenticity_verification_status:'NOT_VERIFIED',
    warranty_summary:r.warranty_summary?String(r.warranty_summary):null,status:r.status,
    fitment_status:'UNKNOWN',created_at:String(r.created_at),updated_at:String(r.updated_at)
  });

  private mapListing=(r:any):MarketplaceListing=>({
    id:String(r.id),store_id:String(r.store_id),product_id:String(r.product_id),status:r.status,
    price_minor:Number(r.price_minor),compare_at_price_minor:r.compare_at_price_minor===null?null:Number(r.compare_at_price_minor),
    currency:String(r.currency),inventory_tracking:r.inventory_tracking,
    stock_quantity:r.stock_quantity===null?null:Number(r.stock_quantity),
    inventory_status:r.inventory_status,fulfillment_modes:parseStringArray(r.fulfillment_modes_json) as any,
    published_at:r.published_at?String(r.published_at):null,paused_at:r.paused_at?String(r.paused_at):null,
    retired_at:r.retired_at?String(r.retired_at):null,version:Number(r.version),
    created_at:String(r.created_at),updated_at:String(r.updated_at)
  });

  private mapCard=(r:any):MarketplaceListingCard=>({
    listing_id:String(r.listing_id),product_id:String(r.product_id),store_id:String(r.store_id),
    store_slug:String(r.store_slug),store_name:String(r.store_name),title:String(r.title),
    description:String(r.description),category_code:String(r.category_code),category_name:String(r.category_name),
    product_type:r.product_type,brand:r.brand?String(r.brand):null,condition:r.condition,
    price_minor:Number(r.price_minor),compare_at_price_minor:r.compare_at_price_minor===null?null:Number(r.compare_at_price_minor),
    currency:String(r.currency),inventory_status:r.inventory_status,
    fulfillment_modes:parseStringArray(r.fulfillment_modes_json) as any,
    primary_media_file_id:r.primary_media_file_id?String(r.primary_media_file_id):null,
    authenticity_claim:r.authenticity_claim,authenticity_verification_status:'NOT_VERIFIED',
    fitment_status:'UNKNOWN'
  });
}

export const marketplaceRepository=new MarketplaceRepository();
