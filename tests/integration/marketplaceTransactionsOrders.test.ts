/**
 * Sprint 24 — Marketplace Transactions & Orders
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabaseInstance } from '../../src/server/database/connection';
import { runMigrations } from '../../src/server/database/migrations';
import { marketplaceService } from '../../src/server/marketplace/marketplaceService';
import { marketplaceTransactionService } from '../../src/server/marketplaceTransactions/marketplaceTransactionService';
import { fitmentService } from '../../src/server/fitment/fitmentService';
import { vehicleService } from '../../src/server/vehicle/vehicleService';
import { CanonicalAppError, ErrorCode } from '../../src/shared/errors';

function actor(userId:string,email:string,memberships:any[]=[]){
  return {
    id:userId,user_id:userId,email,account_status:'ACTIVE',platform_roles:[],memberships,
    profile:{user_id:userId,display_name:email.split('@')[0],preferred_language:'en',timezone:'Africa/Nairobi',country:'KE',
      created_at:'2026-10-31T00:00:00.000Z',updated_at:'2026-10-31T00:00:00.000Z'},
    session_id:'ses_'+userId,
  } as any;
}
function sellerMembership(userId:string,orgId:string,orgName:string){
  return {membership_id:'mem_'+userId,organization_id:orgId,organization_name:orgName,
    organization_type:'MARKETPLACE_SELLER',organization_status:'ACTIVE',role:'OWNER',status:'ACTIVE'};
}

describe('Marketplace Transactions & Orders (Sprint 24)',()=>{
  let db:any;
  const sellerOrg='org_tx_seller',otherOrg='org_tx_other';
  const seller=actor('usr_tx_seller','seller@tx.test',[sellerMembership('usr_tx_seller',sellerOrg,'Parts Seller')]);
  const buyer=actor('usr_tx_buyer','buyer@tx.test',[]);
  const otherSeller=actor('usr_tx_other','other@tx.test',[sellerMembership('usr_tx_other',otherOrg,'Other Seller')]);
  let storeId:string,productId:string,listingId:string,vehicleId:string;

  beforeEach(()=>{
    resetDatabaseInstance();db=getDatabase({memory:true});runMigrations(db);
    const user=db.prepare(`
      INSERT INTO users (id,email,full_name,role,status,account_status,phone,created_at,updated_at)
      VALUES (?,?,?,'VEHICLE_OWNER','ACTIVE','ACTIVE',?,?,?)
    `);
    user.run(seller.user_id,seller.email,'Seller','+254700500001','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(buyer.user_id,buyer.email,'Buyer','+254700500002','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    user.run(otherSeller.user_id,otherSeller.email,'Other Seller','+254700500003','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    const org=db.prepare(`
      INSERT INTO organizations (id,organization_type,name,status,created_at,updated_at)
      VALUES (?,'MARKETPLACE_SELLER',?,'ACTIVE',?,?)
    `);
    org.run(sellerOrg,'Parts Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    org.run(otherOrg,'Other Seller','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    const mem=db.prepare(`
      INSERT INTO organization_memberships
      (id,user_id,organization_id,role,status,accepted_at,created_at,updated_at)
      VALUES (?,?,?,'OWNER','ACTIVE',?,?,?)
    `);
    mem.run('mem_'+seller.user_id,seller.user_id,sellerOrg,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');
    mem.run('mem_'+otherSeller.user_id,otherSeller.user_id,otherOrg,'2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z','2026-10-31T00:00:00.000Z');

    vehicleId=vehicleService.createVehicle(buyer,{
      make:'Toyota',model:'Corolla',model_year:2018,trim:'GLi',registration_number:'KDB 456B',initial_odometer_value:50000
    }).vehicle.id;

    storeId=marketplaceService.createStore(seller,{organization_id:sellerOrg,slug:'tx-parts',display_name:'TX Parts'}).id;
    marketplaceService.updateStore(seller,storeId,{status:'ACTIVE'});
    productId=marketplaceService.createProduct(seller,storeId,{
      category_id:'mcat_filters',product_type:'PART',seller_sku:'TX-FILTER-01',title:'Engine oil filter',
      description:'Replacement oil filter.',brand:'Example',manufacturer_part_number:'EX-OF-1',condition:'NEW'
    }).id;
    listingId=marketplaceService.createListing(seller,storeId,productId,{
      price_minor:250000,currency:'KES',inventory_tracking:'QUANTITY',stock_quantity:5,
      fulfillment_modes:['PICKUP','LOCAL_DELIVERY']
    }).id;
    marketplaceService.publishListing(seller,storeId,listingId);
  });

  it('creates normalized cart/order/reservation schema and advances listing transaction truth',()=>{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r:any)=>r.name);
    for(const table of ['marketplace_carts','marketplace_cart_items','marketplace_orders','marketplace_order_items','marketplace_inventory_reservations','marketplace_order_status_history']){
      assert.ok(tables.includes(table),table+' must exist');
    }
    const detail=marketplaceService.getListingDetail(listingId);
    assert.equal(detail.truth.checkout_available,true);
    assert.equal(detail.truth.order_creation_available,true);
    assert.equal(detail.truth.payment_available,false);
  });

  it('creates one active store-scoped cart and snapshots listing commercial facts',()=>{
    const first=marketplaceTransactionService.getOrCreateCart(buyer,storeId,vehicleId);
    const second=marketplaceTransactionService.getOrCreateCart(buyer,storeId,vehicleId);
    assert.equal(first.cart.id,second.cart.id);
    const detail=marketplaceTransactionService.addItem(buyer,first.cart.id,listingId,2);
    assert.equal(detail.items.length,1);
    assert.equal(detail.items[0].unit_price_minor_snapshot,250000);
    assert.equal(detail.items[0].quantity,2);
    assert.equal(detail.subtotal_minor,500000);
    assert.equal(detail.currency,'KES');
  });

  it('requires fitment acknowledgement for vehicle-context checkout when compatibility is not confirmed',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,vehicleId);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    const validation=marketplaceTransactionService.validateCheckout(buyer,cart.cart.id);
    assert.equal(validation.valid,true);
    assert.equal(validation.item_results[0].fitment_status,'UNKNOWN');
    assert.equal(validation.requires_fitment_acknowledgement,true);
    assert.throws(
      ()=>marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
  });

  it('places an awaiting-payment order atomically and reserves quantity inventory',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,vehicleId);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,2);
    const placed=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{
      fulfillment_mode:'PICKUP',fitment_acknowledged:true,
      fitment_acknowledgement_text:'I will verify the part number before installation.'
    });
    assert.equal(placed.order.status,'AWAITING_PAYMENT');
    assert.equal(placed.order.payment_status,'NOT_STARTED');
    assert.equal(placed.truth.payment_captured,false);
    assert.equal(placed.truth.seller_fulfillment_available,false);
    assert.equal(placed.items.length,1);
    assert.equal(placed.items[0].seller_sku,'TX-FILTER-01');
    assert.equal(placed.items[0].title,'Engine oil filter');
    assert.equal(placed.items[0].unit_price_minor,250000);
    assert.equal(placed.items[0].line_total_minor,500000);
    assert.equal(placed.items[0].fitment_status,'UNKNOWN');
    assert.equal(placed.reservations.length,1);
    assert.equal(placed.reservations[0].status,'HELD');

    const listing=db.prepare('SELECT stock_quantity,inventory_status FROM marketplace_listings WHERE id=?').get(listingId) as any;
    assert.equal(listing.stock_quantity,3);
    assert.equal(listing.inventory_status,'LOW_STOCK');
    assert.equal((db.prepare('SELECT status FROM marketplace_carts WHERE id=?').get(cart.cart.id) as any).status,'CHECKED_OUT');
  });

  it('blocks checkout when listing price/version changed after cart snapshot',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    marketplaceService.updateListing(seller,storeId,listingId,{price_minor:275000});
    const validation=marketplaceTransactionService.validateCheckout(buyer,cart.cart.id);
    assert.equal(validation.valid,false);
    assert.equal(validation.item_results[0].price_changed,true);
    assert.match(validation.blocking_reasons.join(' '),/changed/i);
  });

  it('blocks explicitly incompatible or conflicted fitment states',()=>{
    fitmentService.createSellerRule(seller,storeId,productId,{
      rule_kind:'EXCLUDE',vehicle_make:'Toyota',vehicle_model:'Corolla',year_from:2018,year_to:2018
    });
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,vehicleId);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    const validation=marketplaceTransactionService.validateCheckout(buyer,cart.cart.id);
    assert.equal(validation.valid,false);
    assert.equal(validation.item_results[0].fitment_status,'NOT_COMPATIBLE');
    assert.match(validation.blocking_reasons.join(' '),/not compatible/i);
  });

  it('requires delivery details for non-pickup fulfillment and enforces listing fulfillment support',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    assert.throws(
      ()=>marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'LOCAL_DELIVERY'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.VALIDATION_ERROR
    );
    assert.throws(
      ()=>marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'SHIPPING',delivery_name:'Buyer',delivery_phone:'+254700500002',delivery_address:{city:'Nairobi'}}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.BUSINESS_RULE_VIOLATION
    );
  });

  it('cancels only awaiting-payment orders and restores held inventory',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,2);
    const placed=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'});
    const cancelled=marketplaceTransactionService.cancelMyOrder(buyer,placed.order.id,'Changed my mind before payment');
    assert.equal(cancelled.order.status,'CANCELLED');
    assert.equal(cancelled.reservations[0].status,'RELEASED');
    const listing=db.prepare('SELECT stock_quantity,inventory_status FROM marketplace_listings WHERE id=?').get(listingId) as any;
    assert.equal(listing.stock_quantity,5);
    assert.equal(listing.inventory_status,'IN_STOCK');
    assert.throws(()=>marketplaceTransactionService.cancelMyOrder(buyer,placed.order.id,'Again'));
  });

  it('seller can read its incoming order but another seller is isolated',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    const placed=marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'});
    const sellerOrders=marketplaceTransactionService.listSellerOrders(seller,storeId);
    assert.equal(sellerOrders.length,1);
    assert.equal(sellerOrders[0].order.id,placed.order.id);
    assert.throws(
      ()=>marketplaceTransactionService.listSellerOrders(otherSeller,storeId),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_AUTHORIZED
    );
  });

  it('prevents duplicate order creation from the same checked-out cart',()=>{
    const cart=marketplaceTransactionService.getOrCreateCart(buyer,storeId,null);
    marketplaceTransactionService.addItem(buyer,cart.cart.id,listingId,1);
    marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'});
    assert.throws(
      ()=>marketplaceTransactionService.placeOrder(buyer,cart.cart.id,{fulfillment_mode:'PICKUP'}),
      (err:any)=>err instanceof CanonicalAppError&&err.code===ErrorCode.NOT_FOUND_OR_NOT_ACCESSIBLE
    );
    assert.equal((db.prepare('SELECT COUNT(*) AS count FROM marketplace_orders').get() as any).count,1);
  });
});
