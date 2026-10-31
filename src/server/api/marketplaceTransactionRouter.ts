import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceTransactionService as service } from '../marketplaceTransactions/marketplaceTransactionService';

export const marketplaceTransactionRouter=Router();
marketplaceTransactionRouter.use(authenticate());

marketplaceTransactionRouter.get('/marketplace/carts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({carts:service.listMyCarts(req.actor!)});}catch(err){next(err);}
});
marketplaceTransactionRouter.post('/marketplace/carts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.getOrCreateCart(req.actor!,String(req.body?.store_id||''),req.body?.vehicle_id??null));}catch(err){next(err);}
});
marketplaceTransactionRouter.get('/marketplace/carts/:cartId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getCart(req.actor!,req.params.cartId));}catch(err){next(err);}
});
marketplaceTransactionRouter.patch('/marketplace/carts/:cartId/vehicle',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.setCartVehicle(req.actor!,req.params.cartId,req.body?.vehicle_id?String(req.body.vehicle_id):null));}catch(err){next(err);}
});
marketplaceTransactionRouter.post('/marketplace/carts/:cartId/items',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.addItem(req.actor!,req.params.cartId,String(req.body?.listing_id||''),req.body?.quantity));}catch(err){next(err);}
});
marketplaceTransactionRouter.patch('/marketplace/carts/:cartId/items/:itemId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateItemQuantity(req.actor!,req.params.cartId,req.params.itemId,req.body?.quantity));}catch(err){next(err);}
});
marketplaceTransactionRouter.delete('/marketplace/carts/:cartId/items/:itemId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.removeItem(req.actor!,req.params.cartId,req.params.itemId));}catch(err){next(err);}
});
marketplaceTransactionRouter.post('/marketplace/carts/:cartId/validate-checkout',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.validateCheckout(req.actor!,req.params.cartId));}catch(err){next(err);}
});
marketplaceTransactionRouter.post('/marketplace/carts/:cartId/place-order',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.placeOrder(req.actor!,req.params.cartId,req.body||{}));}catch(err){next(err);}
});
marketplaceTransactionRouter.get('/marketplace/orders',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({orders:service.listMyOrders(req.actor!)});}catch(err){next(err);}
});
marketplaceTransactionRouter.get('/marketplace/orders/:orderId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getMyOrder(req.actor!,req.params.orderId));}catch(err){next(err);}
});
marketplaceTransactionRouter.post('/marketplace/orders/:orderId/cancel',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.cancelMyOrder(req.actor!,req.params.orderId,req.body?.reason));}catch(err){next(err);}
});
marketplaceTransactionRouter.get('/marketplace/seller/stores/:storeId/orders',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({orders:service.listSellerOrders(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceTransactionRouter.get('/marketplace/seller/stores/:storeId/orders/:orderId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getSellerOrder(req.actor!,req.params.storeId,req.params.orderId));}catch(err){next(err);}
});
