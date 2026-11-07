/**
 * Sprint 33 — Buyer–Seller Messaging, Notifications & Seller CRM Foundation
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceTransactionService } from '../../src/server/marketplaceTransactions/marketplaceTransactionService';
import { marketplaceMessagingService } from '../../src/server/marketplaceMessaging/marketplaceMessagingService';
import { marketplaceMessagingRepository } from '../../src/server/marketplaceMessaging/marketplaceMessagingRepository';
import { marketplaceNotificationAdapterRegistry, MarketplaceNotificationAdapter } from '../../src/server/marketplaceMessaging/notificationAdapter';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string,memberships:any[]=[]){
  return {id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-11-07T00:00:00.000Z',updated_at:'2026-11-07T00:00:00.000Z'},session_id:'ses_'+userId} as any;
}
function membership(userId:string,orgId:string,name:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:name,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Buyer–Seller Messaging, Notifications & Seller CRM Foundation (Sprint 33)',()=>{
  let db:any,storeId:string,otherStoreId:string,listingId:string,orderId:string;
  const orgId='org_msg_seller',otherOrgId='org_msg_other';
  const seller=actor('usr_msg_seller','seller@msg.test',[membership('usr_msg_seller',orgId,'Messaging Seller')]);
  const otherSeller=actor('usr_msg_other','other@msg.test',[membership('usr_msg_other',otherOrgId,'Other Seller')]);
  const buyer=actor('usr_msg_buyer','buyer@msg.test');

  beforeEach(()=>{
    marketplaceNotificationAdapterRegistry.clear();
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    for(const [id,email,name,phone] of [
      [seller.user_id,seller.email,'Seller','+254700100001'],
      [otherSeller.user_id,otherSeller.email,'Other Seller','+254700100002'],
      [buyer.user_id,buyer.email,'Buyer','+254700100003'],
    ])user.run(id,email,name,phone,'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(orgId,'Messaging Seller','2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z');
    org.run(otherOrgId,'Other Seller','2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,orgId,'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrgId,'2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z','2026-11-07T00:00:00.000Z');

    storeId=marketplaceService.createStore(seller,{organization_id:orgId,slug:'message-parts',display_name:'Message Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});
    otherStoreId=marketplaceService.createStore(otherSeller,{organization_id:otherOrgId,slug:'other-message-parts',display_name:'Other Message Parts'}).id;
    marketplaceService.updateStore(otherSeller,otherStoreId,{status:'ACTIVE'});

    const product=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'MSG-001',title:'Messaging test filter',
      description:'Sprint 33 messaging certification product.',brand:'Example',condition:'NEW'
    });
    const listing=marketplaceService.createListing(seller,storeId,product.id,{
      price_minor:250000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:5,fulfillment_modes:['PICKUP']
    });
    marketplaceService.publishListing(seller,storeId,listing.id);listingId=listing.id;
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    orderId=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'}).order.id;
  });

  it('creates normalized communication schema without fake providers or delivery claims',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const t of ['marketplace_conversations','marketplace_messages','marketplace_communication_preferences',
      'marketplace_notification_templates','marketplace_notifications','marketplace_external_deliveries','marketplace_external_delivery_events'])
      assert.ok(tables.includes(t),t+' must exist');
    assert.equal(marketplaceMessagingRepository.countDeliveries(),0);
    assert.equal(marketplaceMessagingRepository.countDeliveryEvents(),0);
    assert.deepEqual(marketplaceMessagingService.adapterCapabilities().registered_adapters,[]);
  });

  it('supports listing inquiries and transaction conversations with strict seller tenant isolation',()=>{
    const inquiry=marketplaceMessagingService.createConversation(buyer,{context_type:'LISTING_INQUIRY',context_id:listingId});
    assert.equal(inquiry.conversation.context_type,'LISTING_INQUIRY');
    const order=marketplaceMessagingService.createConversation(buyer,{context_type:'ORDER',context_id:orderId});
    assert.equal(order.conversation.buyer_user_id,buyer.user_id);
    assert.equal(marketplaceMessagingService.listSellerConversations(seller,storeId).length,2);
    assert.throws(()=>marketplaceMessagingService.listSellerConversations(otherSeller,storeId),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.NOT_AUTHORIZED);
    assert.throws(()=>marketplaceMessagingService.getConversation(otherSeller,order.conversation.id),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.NOT_AUTHORIZED);
  });

  it('persists in-app message truth and lets recipients manage their own notifications',()=>{
    const c=marketplaceMessagingService.createConversation(buyer,{context_type:'ORDER',context_id:orderId}).conversation;
    const buyerSent=marketplaceMessagingService.sendMessage(buyer,c.id,{body:'Is pickup available this afternoon?'});
    assert.equal(buyerSent.message.classification,'TRANSACTIONAL');
    assert.equal(buyerSent.notification.recipient_type,'SELLER_STORE');
    assert.equal(buyerSent.truth.external_delivery_attempted,false);
    const sellerNotes=marketplaceMessagingService.listSellerNotifications(seller,storeId);
    assert.equal(sellerNotes.length,1);
    marketplaceMessagingService.updateSellerNotification(seller,storeId,sellerNotes[0].id,'READ');
    assert.equal(marketplaceMessagingService.listSellerNotifications(seller,storeId)[0].state,'READ');

    const sellerSent=marketplaceMessagingService.sendMessage(seller,c.id,{classification:'TRANSACTIONAL',body:'Yes. Your order is ready for pickup.'});
    assert.equal(sellerSent.notification.recipient_type,'BUYER_USER');
    const buyerNotes=marketplaceMessagingService.listBuyerNotifications(buyer);
    assert.equal(buyerNotes.length,1);
    marketplaceMessagingService.updateBuyerNotification(buyer,buyerNotes[0].id,'DISMISSED');
    assert.equal(marketplaceMessagingService.listBuyerNotifications(buyer)[0].state,'DISMISSED');
  });

  it('requires explicit promotional consent, transaction relationship and quiet-hour compliance',()=>{
    const inquiry=marketplaceMessagingService.createConversation(buyer,{context_type:'LISTING_INQUIRY',context_id:listingId}).conversation;
    assert.throws(()=>marketplaceMessagingService.sendMessage(seller,inquiry.id,{classification:'PROMOTIONAL',body:'Buy two today'}),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.BUSINESS_RULE_VIOLATION);

    const order=marketplaceMessagingService.createConversation(buyer,{context_type:'ORDER',context_id:orderId}).conversation;
    assert.throws(()=>marketplaceMessagingService.sendMessage(seller,order.id,{classification:'PROMOTIONAL',body:'A related item is available'}),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.BUSINESS_RULE_VIOLATION);
    assert.throws(()=>marketplaceMessagingService.sendMessage(buyer,order.id,{classification:'PROMOTIONAL',body:'promo'}),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.BUSINESS_RULE_VIOLATION);

    marketplaceMessagingService.updatePreferences(buyer,{promotional_in_app_enabled:true});
    const allowed=marketplaceMessagingService.sendMessage(seller,order.id,{classification:'PROMOTIONAL',body:'You opted in to seller offers.'});
    assert.equal(allowed.message.classification,'PROMOTIONAL');

    marketplaceMessagingService.updatePreferences(buyer,{quiet_hours_start:'00:00',quiet_hours_end:'00:00'});
    assert.throws(()=>marketplaceMessagingService.sendMessage(seller,order.id,{classification:'PROMOTIONAL',body:'This must wait'}),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.BUSINESS_RULE_VIOLATION);
  });

  it('projects seller CRM from legitimate orders without hidden profiles, contacts or opaque scores',()=>{
    const c=marketplaceMessagingService.createConversation(buyer,{context_type:'ORDER',context_id:orderId}).conversation;
    marketplaceMessagingService.sendMessage(buyer,c.id,{body:'Order question'});
    const crm=marketplaceMessagingService.sellerCrm(seller,storeId);
    assert.equal(crm.relationships.length,1);
    assert.equal(crm.relationships[0].buyer_user_id,buyer.user_id);
    assert.equal(crm.relationships[0].order_count,1);
    assert.equal(crm.relationships[0].ordered_value_by_currency[0].currency,'KES');
    assert.equal(crm.truth.hidden_browsing_or_search_profile_used,false);
    assert.equal(crm.truth.opaque_customer_score_present,false);
    assert.equal(crm.truth.buyer_contact_details_exposed,false);
    const json=JSON.stringify(crm);
    assert.equal(json.includes(buyer.email),false);
    assert.equal(json.includes('+254700100003'),false);
    assert.equal(Object.keys(crm.relationships[0]).some(k=>k.toLowerCase().includes('score')),false);
  });

  it('separates requested, attempted, accepted and provider-confirmed delivered states',()=>{
    const c=marketplaceMessagingService.createConversation(buyer,{context_type:'ORDER',context_id:orderId}).conversation;
    const sent=marketplaceMessagingService.sendMessage(seller,c.id,{body:'Order status updated.'});
    marketplaceMessagingService.updatePreferences(buyer,{transactional_email_requested:true});

    const absent=marketplaceMessagingService.dispatchExternalNotificationInternal(sent.notification.id,'EMAIL','TESTMAIL',buyer.email);
    assert.equal(absent.attempted,false);assert.equal(absent.reason,'ADAPTER_NOT_CONFIGURED');
    assert.equal(marketplaceMessagingRepository.countDeliveries(),0);

    const adapter:MarketplaceNotificationAdapter={
      providerKey:'TESTMAIL',channel:'EMAIL',
      attempt:()=>({accepted:true,provider_message_id:'provider-message-33'}),
      verifyEvent:(signature,payload:any)=>({verified:signature==='valid-signature',provider_event_id:String(payload.provider_event_id),
        provider_message_id:String(payload.provider_message_id),state:payload.state,occurred_at:String(payload.occurred_at)})
    };
    marketplaceNotificationAdapterRegistry.register(adapter);
    const attempt=marketplaceMessagingService.dispatchExternalNotificationInternal(sent.notification.id,'EMAIL','TESTMAIL',buyer.email);
    assert.equal(attempt.attempted,true);assert.equal(attempt.delivery.state,'ACCEPTED');
    assert.equal(attempt.truth.accepted_is_not_delivered,true);
    assert.equal(JSON.stringify(attempt.delivery).includes(buyer.email),false);

    const event={provider_event_id:'evt-33-1',provider_message_id:'provider-message-33',state:'DELIVERED',occurred_at:'2026-11-07T10:00:00.000Z'};
    assert.throws(()=>marketplaceMessagingService.processVerifiedProviderEventInternal('TESTMAIL','EMAIL','bad-signature',event),
      (e:any)=>e instanceof CanonicalAppError&&e.code===ErrorCode.NOT_AUTHORIZED);
    assert.equal(marketplaceMessagingRepository.countDeliveryEvents(),0);
    const delivered=marketplaceMessagingService.processVerifiedProviderEventInternal('TESTMAIL','EMAIL','valid-signature',event);
    assert.equal(delivered.delivery.state,'DELIVERED');
    assert.equal(delivered.truth.provider_event_authoritative,true);
    assert.equal(marketplaceMessagingRepository.countDeliveryEvents(),1);
    const duplicate=marketplaceMessagingService.processVerifiedProviderEventInternal('TESTMAIL','EMAIL','valid-signature',event);
    assert.equal(duplicate.duplicate,true);
  });
});
