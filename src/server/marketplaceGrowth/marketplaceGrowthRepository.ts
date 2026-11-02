import { getDatabase } from '../database/connection';
import {
  MarketplaceCategoryDemand, MarketplaceGrowthComparison, MarketplaceGrowthListingSignal,
  MarketplaceGrowthPeriodSummary, MarketplaceRetentionCohort, MarketplaceRetentionSummary,
  MarketplaceSellerOpportunity
} from './types';

export interface GrowthRange{from:string;to:string;}

function pct(n:number,d:number):number|null{return d>0?Math.round((n/d)*10000)/100:null;}
function delta(current:number,previous:number):number|null{return previous===0?null:Math.round(((current-previous)/previous)*10000)/100;}

interface CaptureRow{order_id:string;buyer_user_id:string;store_id:string;captured_at:string;}

export class MarketplaceGrowthRepository{
  private captures(storeId:string|null):CaptureRow[]{
    const db=getDatabase();
    const clause=storeId?' AND e.store_id=?':'';
    const params=storeId?[storeId]:[];
    return db.prepare(`
      SELECT e.order_id,o.buyer_user_id,e.store_id,MIN(e.created_at) captured_at
      FROM marketplace_settlement_ledger_entries e
      JOIN marketplace_orders o ON o.id=e.order_id
      WHERE e.entry_type='PAYMENT_CAPTURE'${clause}
      GROUP BY e.order_id,o.buyer_user_id,e.store_id
      ORDER BY captured_at,e.order_id
    `).all(...params).map((r:any)=>({
      order_id:String(r.order_id),buyer_user_id:String(r.buyer_user_id),store_id:String(r.store_id),captured_at:String(r.captured_at)
    }));
  }

  periodSummary(storeId:string|null,range:GrowthRange):MarketplaceGrowthPeriodSummary{
    const all=this.captures(storeId);
    const firstByBuyer=new Map<string,string>();
    for(const r of all){
      const key=storeId?r.buyer_user_id:r.buyer_user_id;
      const previous=firstByBuyer.get(key);
      if(!previous||r.captured_at<previous)firstByBuyer.set(key,r.captured_at);
    }
    const period=all.filter(r=>r.captured_at>=range.from&&r.captured_at<=range.to);
    const buyers=new Map<string,number>();
    for(const r of period)buyers.set(r.buyer_user_id,(buyers.get(r.buyer_user_id)||0)+1);
    let fresh=0,returning=0;
    for(const buyer of buyers.keys()){
      const first=firstByBuyer.get(buyer)!;
      if(first>=range.from&&first<=range.to)fresh++; else if(first<range.from)returning++;
    }
    const repeat=[...buyers.values()].filter(n=>n>=2).length;
    return {
      captured_orders:period.length,distinct_paid_buyers:buyers.size,new_paid_buyers:fresh,returning_paid_buyers:returning,
      repeat_paid_buyers_in_period:repeat,repeat_paid_buyer_percent:pct(repeat,buyers.size)
    };
  }

  growthComparison(storeId:string|null,current:GrowthRange,previous:GrowthRange):MarketplaceGrowthComparison{
    const c=this.periodSummary(storeId,current),p=this.periodSummary(storeId,previous);
    return {current:c,previous:p,change:{
      captured_orders_percent:delta(c.captured_orders,p.captured_orders),
      distinct_paid_buyers_percent:delta(c.distinct_paid_buyers,p.distinct_paid_buyers),
      new_paid_buyers_percent:delta(c.new_paid_buyers,p.new_paid_buyers),
      returning_paid_buyers_percent:delta(c.returning_paid_buyers,p.returning_paid_buyers)
    },truth:{paid_truth_source:'SETTLEMENT_LEDGER',zero_baseline_percent_is_null:true}};
  }

  retention(storeId:string|null,cohortRange:GrowthRange,observationTo:string):MarketplaceRetentionSummary{
    const captures=this.captures(storeId);
    // Group authoritative capture history by buyer for cohort maturity and repeat-purchase analysis.
    const grouped=new Map<string,CaptureRow[]>();
    for(const r of captures){
      const key=storeId?r.buyer_user_id:r.buyer_user_id;
      const list=grouped.get(key)||[];list.push(r);grouped.set(key,list);
    }
    const cohortMap=new Map<string,{total:number;e30:number;r30:number;e90:number;r90:number}>();
    let e30=0,r30=0,e90=0,r90=0;
    const obs=Date.parse(observationTo);
    for(const rows of grouped.values()){
      rows.sort((a,b)=>a.captured_at.localeCompare(b.captured_at));
      const first=rows[0]?.captured_at;if(!first||first<cohortRange.from||first>cohortRange.to)continue;
      const month=first.slice(0,7),entry=cohortMap.get(month)||{total:0,e30:0,r30:0,e90:0,r90:0};entry.total++;
      const firstMs=Date.parse(first);
      const later=rows.slice(1).map(x=>Date.parse(x.captured_at)).filter(x=>x>firstMs);
      if(firstMs+30*86400000<=obs){
        entry.e30++;e30++;
        if(later.some(x=>x<=firstMs+30*86400000)){entry.r30++;r30++;}
      }
      if(firstMs+90*86400000<=obs){
        entry.e90++;e90++;
        if(later.some(x=>x<=firstMs+90*86400000)){entry.r90++;r90++;}
      }
      cohortMap.set(month,entry);
    }
    const cohorts:MarketplaceRetentionCohort[]=[...cohortMap.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([month,v])=>({
      cohort_month:month,first_time_paid_buyers:v.total,eligible_30d:v.e30,repeated_within_30d:v.r30,repeat_30d_percent:pct(v.r30,v.e30),
      eligible_90d:v.e90,repeated_within_90d:v.r90,repeat_90d_percent:pct(v.r90,v.e90)
    }));
    return {cohorts,eligible_30d:e30,repeated_within_30d:r30,repeat_30d_percent:pct(r30,e30),eligible_90d:e90,repeated_within_90d:r90,
      repeat_90d_percent:pct(r90,e90),truth:{cohort_anchor:'FIRST_SETTLEMENT_CAPTURE',immature_buyers_excluded:true,
        repeat_purchase_not_subscription_retention:true,churn_inferred:false}};
  }

  categories(storeId:string|null,range:GrowthRange):MarketplaceCategoryDemand[]{
    const db=getDatabase();
    const storeWhere=storeId?' WHERE l.store_id=?':'',storeParams=storeId?[storeId]:[];
    const categoryRows=db.prepare(`
      SELECT c.code category_code,c.name category_name,
        SUM(CASE WHEN l.status='PUBLISHED' THEN 1 ELSE 0 END) active_published_listings,
        COALESCE(SUM((SELECT COUNT(*) FROM marketplace_saved_listings s WHERE s.listing_id=l.id)),0) current_saved_instances,
        COALESCE(SUM(CASE WHEN l.status='PUBLISHED' AND l.inventory_status='OUT_OF_STOCK'
          THEN (SELECT COUNT(*) FROM marketplace_saved_listings s2 WHERE s2.listing_id=l.id) ELSE 0 END),0) out_of_stock_saved_instances
      FROM marketplace_listings l
      JOIN marketplace_products p ON p.id=l.product_id
      JOIN marketplace_categories c ON c.id=p.category_id
      ${storeWhere}
      GROUP BY c.code,c.name
    `).all(...storeParams) as any[];

    const paidRows=db.prepare(`
      SELECT c.code category_code,o.currency,COUNT(DISTINCT o.id) captured_orders,COALESCE(SUM(oi.quantity),0) captured_units,
        COALESCE(SUM(oi.line_total_minor),0) gross
      FROM marketplace_order_items oi
      JOIN marketplace_orders o ON o.id=oi.order_id
      JOIN marketplace_products p ON p.id=oi.product_id
      JOIN marketplace_categories c ON c.id=p.category_id
      WHERE o.placed_at<=? AND EXISTS(
        SELECT 1 FROM marketplace_settlement_ledger_entries e
        WHERE e.order_id=o.id AND e.entry_type='PAYMENT_CAPTURE' AND e.created_at>=? AND e.created_at<=?
      ) ${storeId?'AND o.store_id=?':''}
      GROUP BY c.code,o.currency
    `).all(range.to,range.from,range.to,...(storeId?[storeId]:[])) as any[];

    const paidByCat=new Map<string,{orders:number;units:number;gross:Array<{currency:string;amount_minor:number}>}>();
    // SQL rows already aggregate orders by currency. Preserve per-currency money and sum order counts;
    // an order cannot mix currencies, so counts remain additive.
    for(const r of paidRows){
      const current=paidByCat.get(String(r.category_code))||{orders:0,units:0,gross:[]};
      current.units+=Number(r.captured_units||0);
      current.gross.push({currency:String(r.currency),amount_minor:Number(r.gross||0)});
      current.orders+=Number(r.captured_orders||0);
      paidByCat.set(String(r.category_code),current);
    }
    return categoryRows.map(r=>{
      const paid=paidByCat.get(String(r.category_code));
      return {category_code:String(r.category_code),category_name:String(r.category_name),
        active_published_listings:Number(r.active_published_listings||0),current_saved_instances:Number(r.current_saved_instances||0),
        captured_orders:paid?.orders||0,captured_units:paid?.units||0,captured_gross:paid?.gross.sort((a,b)=>a.currency.localeCompare(b.currency))||[],
        out_of_stock_saved_instances:Number(r.out_of_stock_saved_instances||0)};
    }).sort((a,b)=>b.captured_units-a.captured_units||b.current_saved_instances-a.current_saved_instances||a.category_name.localeCompare(b.category_name));
  }

  listingSignals(storeId:string,range:GrowthRange):MarketplaceGrowthListingSignal[]{
    const db=getDatabase();
    return (db.prepare(`
      SELECT l.id listing_id,l.product_id,p.title,p.seller_sku,c.code category_code,l.status listing_status,l.inventory_status,
        (SELECT COUNT(*) FROM marketplace_saved_listings s WHERE s.listing_id=l.id) current_saved_count,
        COUNT(DISTINCT CASE WHEN cap.order_id IS NOT NULL THEN oi.order_id END) captured_orders,
        COALESCE(SUM(CASE WHEN cap.order_id IS NOT NULL THEN oi.quantity ELSE 0 END),0) captured_units,
        (SELECT COUNT(*) FROM marketplace_reviews r WHERE r.product_id=p.id AND r.status='PUBLISHED' AND r.verified_purchase=1) review_count
      FROM marketplace_listings l JOIN marketplace_products p ON p.id=l.product_id JOIN marketplace_categories c ON c.id=p.category_id
      LEFT JOIN marketplace_order_items oi ON oi.listing_id=l.id
      LEFT JOIN marketplace_orders o ON o.id=oi.order_id
      LEFT JOIN (
        SELECT DISTINCT order_id FROM marketplace_settlement_ledger_entries
        WHERE entry_type='PAYMENT_CAPTURE' AND created_at>=? AND created_at<=?
      ) cap ON cap.order_id=o.id
      WHERE l.store_id=?
      GROUP BY l.id,l.product_id,p.title,p.seller_sku,c.code,l.status,l.inventory_status
      ORDER BY captured_units DESC,current_saved_count DESC,p.title COLLATE NOCASE
    `).all(range.from,range.to,storeId) as any[]).map(r=>({
      listing_id:String(r.listing_id),product_id:String(r.product_id),title:String(r.title),seller_sku:String(r.seller_sku),
      category_code:String(r.category_code),listing_status:String(r.listing_status),inventory_status:String(r.inventory_status),
      current_saved_count:Number(r.current_saved_count||0),captured_orders:Number(r.captured_orders||0),captured_units:Number(r.captured_units||0),
      published_verified_review_count:Number(r.review_count||0)
    }));
  }

  opportunities(storeId:string,range:GrowthRange):MarketplaceSellerOpportunity[]{
    const signals=this.listingSignals(storeId,range),ops:MarketplaceSellerOpportunity[]=[];
    for(const s of signals){
      if(s.listing_status==='PUBLISHED'&&s.inventory_status==='OUT_OF_STOCK'&&s.current_saved_count>0){
        ops.push({type:'RESTOCK_SAVED_DEMAND',priority:'HIGH',listing_id:s.listing_id,title:s.title,
          evidence:{current_saved_count:s.current_saved_count,captured_units:s.captured_units,inventory_status:s.inventory_status},
          explanation:'Explicit current saves exist while the published listing is out of stock.',
          suggested_action:'Review replenishment or listing availability. Do not imply scarcity beyond current inventory truth.',automatic_action:false});
      }else if(s.listing_status==='PUBLISHED'&&s.inventory_status==='LOW_STOCK'&&(s.current_saved_count>0||s.captured_units>0)){
        ops.push({type:'LOW_STOCK_DEMAND',priority:'MEDIUM',listing_id:s.listing_id,title:s.title,
          evidence:{current_saved_count:s.current_saved_count,captured_units:s.captured_units,inventory_status:s.inventory_status},
          explanation:'The listing has explicit saved or captured demand and is currently low stock.',
          suggested_action:'Review replenishment based on actual supply constraints.',automatic_action:false});
      }
      if(s.listing_status==='PUBLISHED'&&s.current_saved_count>0&&s.captured_units===0&&s.inventory_status!=='OUT_OF_STOCK'){
        ops.push({type:'SAVED_DEMAND_NO_CAPTURE',priority:'LOW',listing_id:s.listing_id,title:s.title,
          evidence:{current_saved_count:s.current_saved_count,captured_units:0},
          explanation:'Users explicitly saved this listing, but no provider-confirmed purchase capture occurred in the selected period.',
          suggested_action:'Review listing clarity, price, fitment evidence and fulfillment options; no automatic discount is recommended.',automatic_action:false});
      }
      if(s.captured_orders>=3&&s.published_verified_review_count===0){
        ops.push({type:'REVIEW_COVERAGE',priority:'LOW',listing_id:s.listing_id,title:s.title,
          evidence:{captured_orders:s.captured_orders,published_verified_review_count:0},
          explanation:'Multiple captured orders exist without published verified-purchase review coverage.',
          suggested_action:'Review the post-purchase review experience. Do not expose buyer identities or fabricate reviews.',automatic_action:false});
      }
    }
    const backlog=getDatabase().prepare(`
      SELECT
        SUM(CASE WHEN EXISTS(SELECT 1 FROM marketplace_settlement_ledger_entries e WHERE e.order_id=o.id AND e.entry_type='PAYMENT_CAPTURE')
          AND NOT EXISTS(SELECT 1 FROM marketplace_fulfillments f WHERE f.order_id=o.id) THEN 1 ELSE 0 END) paid_backlog,
        SUM(CASE WHEN EXISTS(SELECT 1 FROM marketplace_fulfillments f WHERE f.order_id=o.id AND f.status='DELIVERY_REPORTED') THEN 1 ELSE 0 END) delivery_waiting
      FROM marketplace_orders o WHERE o.store_id=?
    `).get(storeId) as any;
    const paidBacklog=Number(backlog?.paid_backlog||0),deliveryWaiting=Number(backlog?.delivery_waiting||0);
    if(paidBacklog>0)ops.push({type:'PAID_ORDER_FULFILLMENT_BACKLOG',priority:'HIGH',listing_id:null,title:'Captured orders awaiting fulfillment',
      evidence:{captured_orders_without_fulfillment:paidBacklog},explanation:'Provider-confirmed captured orders do not yet have fulfillment records.',
      suggested_action:'Start the canonical fulfillment workflow; analytics must not mutate fulfillment state.',automatic_action:false});
    if(deliveryWaiting>0)ops.push({type:'BUYER_CONFIRMATION_PENDING',priority:'MEDIUM',listing_id:null,title:'Delivery reported, buyer confirmation pending',
      evidence:{delivery_reported_waiting_buyer:deliveryWaiting},explanation:'Seller-reported delivery is not buyer-confirmed receipt.',
      suggested_action:'Monitor the canonical fulfillment workflow. Do not mark receipt on behalf of the buyer.',automatic_action:false});
    const weight={HIGH:0,MEDIUM:1,LOW:2};
    return ops.sort((a,b)=>weight[a.priority]-weight[b.priority]||a.title.localeCompare(b.title));
  }

  stores(){
    return getDatabase().prepare('SELECT id,display_name,status FROM marketplace_stores ORDER BY display_name COLLATE NOCASE').all() as any[];
  }
}
export const marketplaceGrowthRepository=new MarketplaceGrowthRepository();
