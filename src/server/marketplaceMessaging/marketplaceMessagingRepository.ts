import { getDatabase } from '../database/connection';
import {
  MarketplaceCommunicationPreferences, MarketplaceConversation, MarketplaceCrmRelationship,
  MarketplaceExternalDelivery, MarketplaceMessage, MarketplaceNotification
} from './types';

const b=(v:any)=>Boolean(v);

export class MarketplaceMessagingRepository{
  getPreferences(userId:string):MarketplaceCommunicationPreferences|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_communication_preferences WHERE user_id=?').get(userId) as any;
    return r?this.mapPreferences(r):null;
  }
  upsertPreferences(p:MarketplaceCommunicationPreferences){
    getDatabase().prepare(`
      INSERT INTO marketplace_communication_preferences
      (user_id,transactional_email_requested,transactional_sms_requested,transactional_push_requested,
       promotional_in_app_enabled,promotional_email_opt_in,promotional_sms_opt_in,promotional_push_opt_in,
       quiet_hours_start,quiet_hours_end,timezone,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET
       transactional_email_requested=excluded.transactional_email_requested,
       transactional_sms_requested=excluded.transactional_sms_requested,
       transactional_push_requested=excluded.transactional_push_requested,
       promotional_in_app_enabled=excluded.promotional_in_app_enabled,
       promotional_email_opt_in=excluded.promotional_email_opt_in,
       promotional_sms_opt_in=excluded.promotional_sms_opt_in,
       promotional_push_opt_in=excluded.promotional_push_opt_in,
       quiet_hours_start=excluded.quiet_hours_start,quiet_hours_end=excluded.quiet_hours_end,
       timezone=excluded.timezone,updated_at=excluded.updated_at
    `).run(p.user_id,+p.transactional_email_requested,+p.transactional_sms_requested,+p.transactional_push_requested,
      +p.promotional_in_app_enabled,+p.promotional_email_opt_in,+p.promotional_sms_opt_in,+p.promotional_push_opt_in,
      p.quiet_hours_start,p.quiet_hours_end,p.timezone,p.updated_at);
    return p;
  }

  createConversation(c:MarketplaceConversation){getDatabase().prepare(`
    INSERT INTO marketplace_conversations
    (id,store_id,buyer_user_id,context_type,listing_id,order_id,return_id,dispute_id,subject,status,created_by,created_at,updated_at,last_message_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(c.id,c.store_id,c.buyer_user_id,c.context_type,c.listing_id,c.order_id,c.return_id,c.dispute_id,c.subject,c.status,c.created_by,c.created_at,c.updated_at,c.last_message_at);return c;}
  getConversation(id:string):MarketplaceConversation|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_conversations WHERE id=?').get(id) as any;
    return r?this.mapConversation(r):null;
  }
  findOpenConversation(buyerId:string,contextType:string,contextId:string):MarketplaceConversation|null{
    const col=contextType==='LISTING_INQUIRY'?'listing_id':contextType==='ORDER'?'order_id':contextType==='RETURN'?'return_id':'dispute_id';
    const r=getDatabase().prepare(`SELECT * FROM marketplace_conversations WHERE buyer_user_id=? AND context_type=? AND ${col}=? AND status='OPEN' LIMIT 1`).get(buyerId,contextType,contextId) as any;
    return r?this.mapConversation(r):null;
  }
  listBuyerConversations(userId:string){return (getDatabase().prepare(
    'SELECT * FROM marketplace_conversations WHERE buyer_user_id=? ORDER BY COALESCE(last_message_at,created_at) DESC'
  ).all(userId) as any[]).map(r=>this.mapConversation(r));}
  listStoreConversations(storeId:string){return (getDatabase().prepare(
    'SELECT * FROM marketplace_conversations WHERE store_id=? ORDER BY COALESCE(last_message_at,created_at) DESC'
  ).all(storeId) as any[]).map(r=>this.mapConversation(r));}
  updateConversationState(id:string,status:string,updatedAt:string){
    getDatabase().prepare('UPDATE marketplace_conversations SET status=?,updated_at=? WHERE id=?').run(status,updatedAt,id);
  }
  touchConversation(id:string,at:string){getDatabase().prepare(
    'UPDATE marketplace_conversations SET last_message_at=?,updated_at=? WHERE id=?'
  ).run(at,at,id);}

  createMessage(m:MarketplaceMessage){getDatabase().prepare(`
    INSERT INTO marketplace_messages(id,conversation_id,sender_user_id,sender_role,classification,body,created_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(m.id,m.conversation_id,m.sender_user_id,m.sender_role,m.classification,m.body,m.created_at);return m;}
  listMessages(conversationId:string){return (getDatabase().prepare(
    'SELECT * FROM marketplace_messages WHERE conversation_id=? ORDER BY created_at,id'
  ).all(conversationId) as any[]).map(r=>this.mapMessage(r));}

  createNotification(n:MarketplaceNotification){getDatabase().prepare(`
    INSERT INTO marketplace_notifications
    (id,recipient_type,recipient_id,conversation_id,message_id,classification,title,body,state,created_at,read_at,dismissed_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(n.id,n.recipient_type,n.recipient_id,n.conversation_id,n.message_id,n.classification,n.title,n.body,n.state,n.created_at,n.read_at,n.dismissed_at);return n;}
  getNotification(id:string):MarketplaceNotification|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_notifications WHERE id=?').get(id) as any;
    return r?this.mapNotification(r):null;
  }
  listBuyerNotifications(userId:string){return (getDatabase().prepare(
    "SELECT * FROM marketplace_notifications WHERE recipient_type='BUYER_USER' AND recipient_id=? ORDER BY created_at DESC"
  ).all(userId) as any[]).map(r=>this.mapNotification(r));}
  listStoreNotifications(storeId:string){return (getDatabase().prepare(
    "SELECT * FROM marketplace_notifications WHERE recipient_type='SELLER_STORE' AND recipient_id=? ORDER BY created_at DESC"
  ).all(storeId) as any[]).map(r=>this.mapNotification(r));}
  updateNotification(n:MarketplaceNotification){getDatabase().prepare(
    'UPDATE marketplace_notifications SET state=?,read_at=?,dismissed_at=? WHERE id=?'
  ).run(n.state,n.read_at,n.dismissed_at,n.id);return n;}

  createDelivery(d:MarketplaceExternalDelivery){getDatabase().prepare(`
    INSERT INTO marketplace_external_deliveries
    (id,notification_id,channel,provider_key,provider_message_id,state,attempt_count,attempted_at,accepted_at,
     delivered_at,failed_at,bounced_at,failure_code,failure_message,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(d.id,d.notification_id,d.channel,d.provider_key,d.provider_message_id,d.state,d.attempt_count,d.attempted_at,
    d.accepted_at,d.delivered_at,d.failed_at,d.bounced_at,d.failure_code,d.failure_message,d.updated_at);return d;}
  updateDelivery(d:MarketplaceExternalDelivery){getDatabase().prepare(`
    UPDATE marketplace_external_deliveries SET provider_message_id=?,state=?,attempt_count=?,accepted_at=?,delivered_at=?,
    failed_at=?,bounced_at=?,failure_code=?,failure_message=?,updated_at=? WHERE id=?
  `).run(d.provider_message_id,d.state,d.attempt_count,d.accepted_at,d.delivered_at,d.failed_at,d.bounced_at,
    d.failure_code,d.failure_message,d.updated_at,d.id);return d;}
  getDelivery(id:string):MarketplaceExternalDelivery|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_external_deliveries WHERE id=?').get(id) as any;
    return r?this.mapDelivery(r):null;
  }
  findDelivery(providerKey:string,providerMessageId:string):MarketplaceExternalDelivery|null{
    const r=getDatabase().prepare('SELECT * FROM marketplace_external_deliveries WHERE provider_key=? AND provider_message_id=? LIMIT 1')
      .get(providerKey.toUpperCase(),providerMessageId) as any; return r?this.mapDelivery(r):null;
  }
  countDeliveries(){return Number((getDatabase().prepare('SELECT COUNT(*) count FROM marketplace_external_deliveries').get() as any).count);}
  hasDeliveryEvent(providerKey:string,eventId:string){return Boolean(getDatabase().prepare(
    'SELECT 1 ok FROM marketplace_external_delivery_events WHERE provider_key=? AND provider_event_id=?'
  ).get(providerKey.toUpperCase(),eventId));}
  createDeliveryEvent(v:{id:string;provider_key:string;provider_event_id:string;delivery_id:string;event_state:string;occurred_at:string;processed_at:string}){
    getDatabase().prepare(`
      INSERT INTO marketplace_external_delivery_events
      (id,provider_key,provider_event_id,delivery_id,event_state,signature_verified,occurred_at,processed_at)
      VALUES (?,?,?,?,?,1,?,?)
    `).run(v.id,v.provider_key.toUpperCase(),v.provider_event_id,v.delivery_id,v.event_state,v.occurred_at,v.processed_at);
  }
  countDeliveryEvents(){return Number((getDatabase().prepare('SELECT COUNT(*) count FROM marketplace_external_delivery_events').get() as any).count);}

  getListingContext(id:string){return getDatabase().prepare(`
    SELECT l.id,l.store_id,l.status,s.status store_status,p.title
    FROM marketplace_listings l JOIN marketplace_stores s ON s.id=l.store_id
    JOIN marketplace_products p ON p.id=l.product_id WHERE l.id=?
  `).get(id) as any||null;}
  getOrderContext(id:string){return getDatabase().prepare('SELECT id,store_id,buyer_user_id,order_number FROM marketplace_orders WHERE id=?').get(id) as any||null;}
  getReturnContext(id:string){return getDatabase().prepare('SELECT id,order_id,store_id,buyer_user_id,return_number FROM marketplace_returns WHERE id=?').get(id) as any||null;}
  getDisputeContext(id:string){return getDatabase().prepare('SELECT id,order_id,store_id,buyer_user_id,dispute_number FROM marketplace_disputes WHERE id=?').get(id) as any||null;}

  crm(storeId:string):MarketplaceCrmRelationship[]{
    const rows=getDatabase().prepare(`
      SELECT o.buyer_user_id,MIN(o.placed_at) first_order_at,MAX(o.placed_at) last_order_at,COUNT(*) order_count
      FROM marketplace_orders o WHERE o.store_id=? GROUP BY o.buyer_user_id ORDER BY last_order_at DESC
    `).all(storeId) as any[];
    return rows.map(r=>{
      const money=getDatabase().prepare(`
        SELECT currency,SUM(total_minor) amount_minor FROM marketplace_orders
        WHERE store_id=? AND buyer_user_id=? GROUP BY currency ORDER BY currency
      `).all(storeId,r.buyer_user_id) as any[];
      const conv=getDatabase().prepare(`
        SELECT SUM(CASE WHEN status='OPEN' THEN 1 ELSE 0 END) open_count,MAX(last_message_at) last_message_at
        FROM marketplace_conversations WHERE store_id=? AND buyer_user_id=?
      `).get(storeId,r.buyer_user_id) as any;
      return {buyer_user_id:String(r.buyer_user_id),first_order_at:String(r.first_order_at),last_order_at:String(r.last_order_at),
        order_count:Number(r.order_count),ordered_value_by_currency:money.map(x=>({currency:String(x.currency),amount_minor:Number(x.amount_minor)})),
        open_conversation_count:Number(conv?.open_count||0),last_message_at:conv?.last_message_at?String(conv.last_message_at):null};
    });
  }

  private mapConversation(r:any):MarketplaceConversation{return {id:String(r.id),store_id:String(r.store_id),buyer_user_id:String(r.buyer_user_id),
    context_type:r.context_type,listing_id:r.listing_id?String(r.listing_id):null,order_id:r.order_id?String(r.order_id):null,
    return_id:r.return_id?String(r.return_id):null,dispute_id:r.dispute_id?String(r.dispute_id):null,subject:String(r.subject),
    status:r.status,created_by:String(r.created_by),created_at:String(r.created_at),updated_at:String(r.updated_at),
    last_message_at:r.last_message_at?String(r.last_message_at):null};}
  private mapMessage(r:any):MarketplaceMessage{return {id:String(r.id),conversation_id:String(r.conversation_id),sender_user_id:String(r.sender_user_id),
    sender_role:r.sender_role,classification:r.classification,body:String(r.body),created_at:String(r.created_at)};}
  private mapPreferences(r:any):MarketplaceCommunicationPreferences{return {user_id:String(r.user_id),
    transactional_email_requested:b(r.transactional_email_requested),transactional_sms_requested:b(r.transactional_sms_requested),
    transactional_push_requested:b(r.transactional_push_requested),promotional_in_app_enabled:b(r.promotional_in_app_enabled),
    promotional_email_opt_in:b(r.promotional_email_opt_in),promotional_sms_opt_in:b(r.promotional_sms_opt_in),
    promotional_push_opt_in:b(r.promotional_push_opt_in),quiet_hours_start:r.quiet_hours_start?String(r.quiet_hours_start):null,
    quiet_hours_end:r.quiet_hours_end?String(r.quiet_hours_end):null,timezone:String(r.timezone),updated_at:String(r.updated_at)};}
  private mapNotification(r:any):MarketplaceNotification{return {id:String(r.id),recipient_type:r.recipient_type,recipient_id:String(r.recipient_id),
    conversation_id:String(r.conversation_id),message_id:String(r.message_id),classification:r.classification,title:String(r.title),
    body:String(r.body),state:r.state,created_at:String(r.created_at),read_at:r.read_at?String(r.read_at):null,
    dismissed_at:r.dismissed_at?String(r.dismissed_at):null};}
  private mapDelivery(r:any):MarketplaceExternalDelivery{return {id:String(r.id),notification_id:String(r.notification_id),channel:r.channel,
    provider_key:String(r.provider_key),provider_message_id:r.provider_message_id?String(r.provider_message_id):null,state:r.state,
    attempt_count:Number(r.attempt_count),attempted_at:String(r.attempted_at),accepted_at:r.accepted_at?String(r.accepted_at):null,
    delivered_at:r.delivered_at?String(r.delivered_at):null,failed_at:r.failed_at?String(r.failed_at):null,
    bounced_at:r.bounced_at?String(r.bounced_at):null,failure_code:r.failure_code?String(r.failure_code):null,
    failure_message:r.failure_message?String(r.failure_message):null,updated_at:String(r.updated_at)};}
}
export const marketplaceMessagingRepository=new MarketplaceMessagingRepository();
