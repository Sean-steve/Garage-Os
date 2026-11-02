import { getDatabase } from '../database/connection';
import {
  MarketplaceDailyOperationsPoint, MarketplaceListingPerformanceRow, MarketplaceMoneyMetric,
  MarketplaceSellerEngagementMetrics, MarketplaceSellerFulfillmentMetrics, MarketplaceSellerFunnel,
  MarketplaceSellerOperations, MarketplaceSellerTrustMetrics
} from './types';

export interface AnalyticsRange{from:string;to:string;}

function pct(n:number,d:number):number|null{return d>0?Math.round((n/d)*10000)/100:null;}
function round2(n:number):number{return Math.round(n*100)/100;}
function moneyRows(rows:any[]):MarketplaceMoneyMetric[]{
  const map=new Map<string,{captured:number;refund:number;orders:Set<string>}>();
  for(const r of rows){
    const currency=String(r.currency),entry=map.get(currency)||{captured:0,refund:0,orders:new Set<string>()};
    const amount=Number(r.amount_minor||0);
    if(r.entry_type==='PAYMENT_CAPTURE'){entry.captured+=amount;entry.orders.add(String(r.order_id));}
    else if(r.entry_type==='REFUND_ADJUSTMENT')entry.refund+=Math.abs(amount);
    map.set(currency,entry);
  }
  return [...map.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([currency,v])=>({
    currency,captured_gross_minor:v.captured,refunded_minor:v.refund,
    net_seller_receivable_minor:v.captured-v.refund,captured_order_count:v.orders.size,
    truth:{source:'SETTLEMENT_LEDGER',receivable_is_payout:false,order_totals_are_not_revenue:true}
  }));
}

export class MarketplaceAnalyticsRepository{
  money(storeId:string|null,range:AnalyticsRange):MarketplaceMoneyMetric[]{
    const where=['created_at>=?','created_at<=?'];const params:any[]=[range.from,range.to];
    if(storeId){where.push('store_id=?');params.push(storeId);}
    const rows=getDatabase().prepare(
      'SELECT store_id,order_id,entry_type,amount_minor,currency,created_at FROM marketplace_settlement_ledger_entries WHERE '+where.join(' AND ')+' ORDER BY created_at'
    ).all(...params) as any[];
    return moneyRows(rows);
  }

  funnel(storeId:string,range:AnalyticsRange):MarketplaceSellerFunnel{
    const db=getDatabase();
    const carts=db.prepare('SELECT id,status FROM marketplace_carts WHERE store_id=? AND created_at>=? AND created_at<=?')
      .all(storeId,range.from,range.to) as any[];
    const cartIds=new Set(carts.map(x=>String(x.id)));
    const orders=db.prepare('SELECT id,cart_id,buyer_user_id,status FROM marketplace_orders WHERE store_id=? AND placed_at>=? AND placed_at<=?')
      .all(storeId,range.from,range.to) as any[];
    const capturedRows=db.prepare(`
      SELECT DISTINCT e.order_id,o.buyer_user_id
      FROM marketplace_settlement_ledger_entries e JOIN marketplace_orders o ON o.id=e.order_id
      WHERE e.store_id=? AND e.entry_type='PAYMENT_CAPTURE' AND o.placed_at>=? AND o.placed_at<=?
    `).all(storeId,range.from,range.to) as any[];
    const capturedIds=new Set(capturedRows.map(x=>String(x.order_id)));
    const completedRows=db.prepare(`
      SELECT DISTINCT f.order_id FROM marketplace_fulfillments f
      JOIN marketplace_orders o ON o.id=f.order_id
      WHERE f.store_id=? AND f.status IN ('COMPLETED','RETURN_IN_PROGRESS','RETURNED')
        AND o.placed_at>=? AND o.placed_at<=?
    `).all(storeId,range.from,range.to) as any[];
    const completedCaptured=completedRows.filter(x=>capturedIds.has(String(x.order_id))).length;
    const fulfillStarted=db.prepare(`
      SELECT COUNT(DISTINCT f.order_id) count FROM marketplace_fulfillments f
      JOIN marketplace_orders o ON o.id=f.order_id
      WHERE f.store_id=? AND o.placed_at>=? AND o.placed_at<=?
    `).get(storeId,range.from,range.to) as any;
    const buyerCounts=new Map<string,number>();
    for(const r of capturedRows)buyerCounts.set(String(r.buyer_user_id),(buyerCounts.get(String(r.buyer_user_id))||0)+1);
    return {
      carts_created:carts.length,carts_checked_out:carts.filter(x=>x.status==='CHECKED_OUT'||[...cartIds].some(()=>false)).length,
      orders_placed:orders.length,cancelled_pre_payment:orders.filter(x=>x.status==='CANCELLED'&&!capturedIds.has(String(x.id))).length,
      captured_orders:capturedIds.size,fulfillment_started:Number(fulfillStarted?.count||0),buyer_confirmed_completed:completedCaptured,
      distinct_paid_buyers:buyerCounts.size,repeat_paid_buyers:[...buyerCounts.values()].filter(x=>x>1).length,
      cohort_rates:{
        cart_to_order_percent:pct(orders.filter(o=>cartIds.has(String(o.cart_id))).length,carts.length),
        order_to_captured_percent:pct(capturedIds.size,orders.length),
        captured_to_completed_percent:pct(completedCaptured,capturedIds.size)
      }
    };
  }

  operations(storeId:string):MarketplaceSellerOperations{
    const db=getDatabase();
    const unpaid=db.prepare(`
      SELECT COUNT(*) count FROM marketplace_orders o
      WHERE o.store_id=? AND o.status='AWAITING_PAYMENT'
        AND NOT EXISTS(SELECT 1 FROM marketplace_settlement_ledger_entries e WHERE e.order_id=o.id AND e.entry_type='PAYMENT_CAPTURE')
    `).get(storeId) as any;
    const paidNoFulfillment=db.prepare(`
      SELECT COUNT(DISTINCT o.id) count FROM marketplace_orders o
      WHERE o.store_id=? AND EXISTS(SELECT 1 FROM marketplace_settlement_ledger_entries e WHERE e.order_id=o.id AND e.entry_type='PAYMENT_CAPTURE')
        AND NOT EXISTS(SELECT 1 FROM marketplace_fulfillments f WHERE f.order_id=o.id)
    `).get(storeId) as any;
    const inProgress=db.prepare(`
      SELECT COUNT(*) count FROM marketplace_fulfillments WHERE store_id=?
      AND status IN ('PREPARING','READY_FOR_HANDOFF','IN_TRANSIT')
    `).get(storeId) as any;
    const deliveryReported=db.prepare("SELECT COUNT(*) count FROM marketplace_fulfillments WHERE store_id=? AND status='DELIVERY_REPORTED'").get(storeId) as any;
    const returns=db.prepare("SELECT COUNT(*) count FROM marketplace_returns WHERE store_id=? AND status NOT IN ('REJECTED','COMPLETED')").get(storeId) as any;
    const disputes=db.prepare("SELECT COUNT(*) count FROM marketplace_disputes WHERE store_id=? AND status NOT IN ('RESOLVED','CLOSED')").get(storeId) as any;
    const listings=db.prepare(`
      SELECT
        SUM(CASE WHEN status='PUBLISHED' THEN 1 ELSE 0 END) published,
        SUM(CASE WHEN status='PUBLISHED' AND inventory_status='LOW_STOCK' THEN 1 ELSE 0 END) low_stock,
        SUM(CASE WHEN status='PUBLISHED' AND inventory_status='OUT_OF_STOCK' THEN 1 ELSE 0 END) out_stock
      FROM marketplace_listings WHERE store_id=?
    `).get(storeId) as any;
    const v={
      unpaid_awaiting_payment:Number(unpaid?.count||0),paid_without_fulfillment:Number(paidNoFulfillment?.count||0),
      fulfillment_in_progress:Number(inProgress?.count||0),delivery_reported_waiting_buyer:Number(deliveryReported?.count||0),
      open_return_requests:Number(returns?.count||0),open_disputes:Number(disputes?.count||0),
      low_stock_listings:Number(listings?.low_stock||0),out_of_stock_listings:Number(listings?.out_stock||0),
      active_published_listings:Number(listings?.published||0)
    };
    return {...v,attention_items:[
      {key:'PAID_WITHOUT_FULFILLMENT',count:v.paid_without_fulfillment,severity:v.paid_without_fulfillment?'ATTENTION':'INFO',explanation:'Captured orders without a fulfillment record.'},
      {key:'DELIVERY_REPORTED_WAITING_BUYER',count:v.delivery_reported_waiting_buyer,severity:v.delivery_reported_waiting_buyer?'ATTENTION':'INFO',explanation:'Seller delivery report is not buyer-confirmed receipt.'},
      {key:'OPEN_RETURNS',count:v.open_return_requests,severity:v.open_return_requests?'ATTENTION':'INFO',explanation:'Returns still require operational handling.'},
      {key:'OPEN_DISPUTES',count:v.open_disputes,severity:v.open_disputes?'ATTENTION':'INFO',explanation:'Disputes need handling but are not evidence of seller guilt.'},
      {key:'OUT_OF_STOCK',count:v.out_of_stock_listings,severity:v.out_of_stock_listings?'ATTENTION':'INFO',explanation:'Published listings currently out of stock.'},
    ]};
  }

  fulfillment(storeId:string,range:AnalyticsRange):MarketplaceSellerFulfillmentMetrics{
    const db=getDatabase();
    const completed=db.prepare(`
      SELECT f.order_id,f.completed_at,
        (SELECT MIN(e.created_at) FROM marketplace_settlement_ledger_entries e WHERE e.order_id=f.order_id AND e.entry_type='PAYMENT_CAPTURE') captured_at
      FROM marketplace_fulfillments f
      WHERE f.store_id=? AND f.completed_at IS NOT NULL AND f.completed_at>=? AND f.completed_at<=?
        AND f.status IN ('COMPLETED','RETURN_IN_PROGRESS','RETURNED')
    `).all(storeId,range.from,range.to) as any[];
    const hours=completed.filter(x=>x.captured_at&&Date.parse(x.completed_at)>=Date.parse(x.captured_at))
      .map(x=>(Date.parse(x.completed_at)-Date.parse(x.captured_at))/3600000);
    const returns=db.prepare(`
      SELECT
        COUNT(*) requests,
        SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) completed
      FROM marketplace_returns WHERE store_id=? AND requested_at>=? AND requested_at<=?
    `).get(storeId,range.from,range.to) as any;
    const units=db.prepare(`
      SELECT COALESCE(SUM(ri.received_quantity),0) received,COALESCE(SUM(ri.restock_quantity),0) restocked
      FROM marketplace_return_items ri JOIN marketplace_returns r ON r.id=ri.return_id
      WHERE r.store_id=? AND r.requested_at>=? AND r.requested_at<=?
    `).get(storeId,range.from,range.to) as any;
    return {completed_fulfillments:completed.length,average_capture_to_completion_hours:hours.length?round2(hours.reduce((a,b)=>a+b,0)/hours.length):null,
      return_requests:Number(returns?.requests||0),completed_returns:Number(returns?.completed||0),
      physically_received_return_units:Number(units?.received||0),restocked_return_units:Number(units?.restocked||0)};
  }

  trust(storeId:string,range:AnalyticsRange):MarketplaceSellerTrustMetrics{
    const db=getDatabase();
    const rows=db.prepare(`
      SELECT rating,COUNT(*) count FROM marketplace_reviews
      WHERE store_id=? AND status='PUBLISHED' AND verified_purchase=1 AND created_at>=? AND created_at<=?
      GROUP BY rating
    `).all(storeId,range.from,range.to) as any[];
    const dist:{'1':number;'2':number;'3':number;'4':number;'5':number}={'1':0,'2':0,'3':0,'4':0,'5':0};
    let count=0,total=0;for(const r of rows){const k=String(r.rating) as keyof typeof dist;dist[k]=Number(r.count);count+=Number(r.count);total+=Number(r.rating)*Number(r.count);}
    const disputes=db.prepare(`
      SELECT COUNT(*) total,SUM(CASE WHEN status NOT IN ('RESOLVED','CLOSED') THEN 1 ELSE 0 END) open_count
      FROM marketplace_disputes WHERE store_id=? AND opened_at>=? AND opened_at<=?
    `).get(storeId,range.from,range.to) as any;
    return {published_verified_review_count:count,average_published_verified_rating:count?round2(total/count):null,rating_distribution:dist,
      total_disputes:Number(disputes?.total||0),open_disputes:Number(disputes?.open_count||0),
      truth:{disputes_are_context_not_guilt:true,opaque_trust_score:false,reviews_verified_purchase_only:true}};
  }

  engagement(storeId:string):MarketplaceSellerEngagementMetrics{
    const db=getDatabase();
    const r=db.prepare(`
      SELECT COUNT(s.id) saved_instances,COUNT(DISTINCT s.listing_id) saved_listings
      FROM marketplace_saved_listings s JOIN marketplace_listings l ON l.id=s.listing_id WHERE l.store_id=?
    `).get(storeId) as any;
    return {current_saved_instances:Number(r?.saved_instances||0),saved_listing_count:Number(r?.saved_listings||0),
      truth:{aggregate_only:true,saver_identities_exposed:false,historical_save_events_available:false}};
  }

  topListings(storeId:string,range:AnalyticsRange,limit=10):MarketplaceListingPerformanceRow[]{
    const db=getDatabase();
    const rows=db.prepare(`
      SELECT l.id listing_id,l.product_id,p.title,p.seller_sku,l.status listing_status,l.inventory_status,
        (SELECT COUNT(*) FROM marketplace_saved_listings s WHERE s.listing_id=l.id) current_saved_count,
        COUNT(DISTINCT CASE WHEN cap.order_id IS NOT NULL THEN oi.order_id END) captured_order_count,
        COALESCE(SUM(CASE WHEN cap.order_id IS NOT NULL THEN oi.quantity ELSE 0 END),0) captured_units,
        (SELECT COUNT(*) FROM marketplace_reviews r WHERE r.product_id=p.id AND r.status='PUBLISHED' AND r.verified_purchase=1 AND r.created_at>=? AND r.created_at<=?) review_count,
        (SELECT AVG(r.rating) FROM marketplace_reviews r WHERE r.product_id=p.id AND r.status='PUBLISHED' AND r.verified_purchase=1 AND r.created_at>=? AND r.created_at<=?) avg_rating
      FROM marketplace_listings l JOIN marketplace_products p ON p.id=l.product_id
      LEFT JOIN marketplace_order_items oi ON oi.listing_id=l.id
      LEFT JOIN marketplace_orders o ON o.id=oi.order_id AND o.placed_at>=? AND o.placed_at<=?
      LEFT JOIN (SELECT DISTINCT order_id FROM marketplace_settlement_ledger_entries WHERE entry_type='PAYMENT_CAPTURE') cap ON cap.order_id=o.id
      WHERE l.store_id=?
      GROUP BY l.id,l.product_id,p.title,p.seller_sku,l.status,l.inventory_status
      ORDER BY captured_units DESC,current_saved_count DESC,p.title COLLATE NOCASE
      LIMIT ?
    `).all(range.from,range.to,range.from,range.to,range.from,range.to,storeId,limit) as any[];
    return rows.map(r=>{
      const grossRows=db.prepare(`
        SELECT o.currency,COALESCE(SUM(oi.line_total_minor),0) amount
        FROM marketplace_order_items oi JOIN marketplace_orders o ON o.id=oi.order_id
        WHERE oi.listing_id=? AND o.placed_at>=? AND o.placed_at<=?
          AND EXISTS(SELECT 1 FROM marketplace_settlement_ledger_entries e WHERE e.order_id=o.id AND e.entry_type='PAYMENT_CAPTURE')
        GROUP BY o.currency ORDER BY o.currency
      `).all(String(r.listing_id),range.from,range.to) as any[];
      return {listing_id:String(r.listing_id),product_id:String(r.product_id),title:String(r.title),seller_sku:String(r.seller_sku),
        listing_status:String(r.listing_status),inventory_status:String(r.inventory_status),current_saved_count:Number(r.current_saved_count||0),
        captured_order_count:Number(r.captured_order_count||0),captured_units:Number(r.captured_units||0),
        captured_order_gross:grossRows.map(g=>({currency:String(g.currency),amount_minor:Number(g.amount||0)})),
        published_verified_review_count:Number(r.review_count||0),
        average_published_verified_rating:r.avg_rating===null||r.avg_rating===undefined?null:round2(Number(r.avg_rating))};
    });
  }

  daily(storeId:string|null,range:AnalyticsRange):MarketplaceDailyOperationsPoint[]{
    const db=getDatabase(),map=new Map<string,MarketplaceDailyOperationsPoint>();
    const ensure=(date:string)=>{let p=map.get(date);if(!p){p={date,orders_placed:0,captured_orders:0,completed_fulfillments:0,return_requests:0,disputes_opened:0,captured_minor_by_currency:{},refunded_minor_by_currency:{}};map.set(date,p);}return p;};
    const storeClause=storeId?' AND store_id=?':'',sp=storeId?[storeId]:[];
    const orders=db.prepare('SELECT id,placed_at FROM marketplace_orders WHERE placed_at>=? AND placed_at<=?'+storeClause)
      .all(range.from,range.to,...sp) as any[];
    for(const r of orders)ensure(String(r.placed_at).slice(0,10)).orders_placed++;
    const ledger=db.prepare('SELECT order_id,entry_type,amount_minor,currency,created_at FROM marketplace_settlement_ledger_entries WHERE created_at>=? AND created_at<=?'+storeClause)
      .all(range.from,range.to,...sp) as any[];
    const seen=new Set<string>();
    for(const r of ledger){const p=ensure(String(r.created_at).slice(0,10)),cur=String(r.currency);
      if(r.entry_type==='PAYMENT_CAPTURE'){p.captured_minor_by_currency[cur]=(p.captured_minor_by_currency[cur]||0)+Number(r.amount_minor);const key=p.date+':'+r.order_id;if(!seen.has(key)){seen.add(key);p.captured_orders++;}}
      else p.refunded_minor_by_currency[cur]=(p.refunded_minor_by_currency[cur]||0)+Math.abs(Number(r.amount_minor));}
    const fs=db.prepare('SELECT completed_at FROM marketplace_fulfillments WHERE completed_at>=? AND completed_at<=?'+storeClause).all(range.from,range.to,...sp) as any[];
    for(const r of fs)ensure(String(r.completed_at).slice(0,10)).completed_fulfillments++;
    const rs=db.prepare('SELECT requested_at FROM marketplace_returns WHERE requested_at>=? AND requested_at<=?'+storeClause).all(range.from,range.to,...sp) as any[];
    for(const r of rs)ensure(String(r.requested_at).slice(0,10)).return_requests++;
    const ds=db.prepare('SELECT opened_at FROM marketplace_disputes WHERE opened_at>=? AND opened_at<=?'+storeClause).all(range.from,range.to,...sp) as any[];
    for(const r of ds)ensure(String(r.opened_at).slice(0,10)).disputes_opened++;
    return [...map.values()].sort((a,b)=>a.date.localeCompare(b.date));
  }

  platformStoreRows(range:AnalyticsRange){
    const db=getDatabase();
    const stores=db.prepare('SELECT id,display_name,status FROM marketplace_stores ORDER BY display_name COLLATE NOCASE').all() as any[];
    return stores.map(s=>{
      const orders=Number((db.prepare('SELECT COUNT(*) count FROM marketplace_orders WHERE store_id=? AND placed_at>=? AND placed_at<=?').get(s.id,range.from,range.to) as any)?.count||0);
      const captured=Number((db.prepare(`
        SELECT COUNT(DISTINCT e.order_id) count FROM marketplace_settlement_ledger_entries e
        JOIN marketplace_orders o ON o.id=e.order_id
        WHERE e.store_id=? AND e.entry_type='PAYMENT_CAPTURE' AND o.placed_at>=? AND o.placed_at<=?
      `).get(s.id,range.from,range.to) as any)?.count||0);
      const completed=Number((db.prepare("SELECT COUNT(*) count FROM marketplace_fulfillments WHERE store_id=? AND completed_at>=? AND completed_at<=?").get(s.id,range.from,range.to) as any)?.count||0);
      const openReturns=Number((db.prepare("SELECT COUNT(*) count FROM marketplace_returns WHERE store_id=? AND status NOT IN ('REJECTED','COMPLETED')").get(s.id) as any)?.count||0);
      const openDisputes=Number((db.prepare("SELECT COUNT(*) count FROM marketplace_disputes WHERE store_id=? AND status NOT IN ('RESOLVED','CLOSED')").get(s.id) as any)?.count||0);
      return {store_id:String(s.id),display_name:String(s.display_name),status:String(s.status),orders_placed:orders,captured_orders:captured,
        completed_fulfillments:completed,open_returns:openReturns,open_disputes:openDisputes,money:this.money(String(s.id),range)};
    });
  }

  platformCounts(range:AnalyticsRange){
    const db=getDatabase();
    return {
      stores_total:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_stores').get() as any)?.count||0),
      active_stores:Number((db.prepare("SELECT COUNT(*) count FROM marketplace_stores WHERE status='ACTIVE'").get() as any)?.count||0),
      orders_placed:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_orders WHERE placed_at>=? AND placed_at<=?').get(range.from,range.to) as any)?.count||0),
      captured_orders:Number((db.prepare(`
        SELECT COUNT(DISTINCT e.order_id) count FROM marketplace_settlement_ledger_entries e JOIN marketplace_orders o ON o.id=e.order_id
        WHERE e.entry_type='PAYMENT_CAPTURE' AND o.placed_at>=? AND o.placed_at<=?
      `).get(range.from,range.to) as any)?.count||0),
      completed_fulfillments:Number((db.prepare('SELECT COUNT(*) count FROM marketplace_fulfillments WHERE completed_at>=? AND completed_at<=?').get(range.from,range.to) as any)?.count||0),
      open_returns:Number((db.prepare("SELECT COUNT(*) count FROM marketplace_returns WHERE status NOT IN ('REJECTED','COMPLETED')").get() as any)?.count||0),
      open_disputes:Number((db.prepare("SELECT COUNT(*) count FROM marketplace_disputes WHERE status NOT IN ('RESOLVED','CLOSED')").get() as any)?.count||0),
      published_verified_reviews:Number((db.prepare("SELECT COUNT(*) count FROM marketplace_reviews WHERE status='PUBLISHED' AND verified_purchase=1 AND created_at>=? AND created_at<=?").get(range.from,range.to) as any)?.count||0),
    };
  }
}
export const marketplaceAnalyticsRepository=new MarketplaceAnalyticsRepository();
