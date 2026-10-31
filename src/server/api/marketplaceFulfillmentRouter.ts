import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceFulfillmentService as service } from '../marketplaceFulfillment/marketplaceFulfillmentService';

export const marketplaceFulfillmentRouter=Router();
marketplaceFulfillmentRouter.use(authenticate());

// Buyer fulfillment and receipt truth.
marketplaceFulfillmentRouter.get('/marketplace/fulfillments',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({fulfillments:service.listBuyerFulfillments(req.actor!)});}catch(err){next(err);}
});
marketplaceFulfillmentRouter.get('/marketplace/orders/:orderId/fulfillment',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({fulfillment:service.getBuyerFulfillment(req.actor!,req.params.orderId)});}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/orders/:orderId/fulfillment/confirm-receipt',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.confirmReceipt(req.actor!,req.params.orderId,req.body||{}));}catch(err){next(err);}
});

// Buyer returns.
marketplaceFulfillmentRouter.post('/marketplace/orders/:orderId/returns',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.requestReturn(req.actor!,req.params.orderId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.get('/marketplace/returns/:returnId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getBuyerReturn(req.actor!,req.params.returnId));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/returns/:returnId/ship',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.markReturnShipped(req.actor!,req.params.returnId,req.body||{}));}catch(err){next(err);}
});

// Seller fulfillment operations.
marketplaceFulfillmentRouter.get('/marketplace/seller/stores/:storeId/fulfillments',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({fulfillments:service.listSellerFulfillments(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/orders/:orderId/fulfillment',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.startFulfillment(req.actor!,req.params.storeId,req.params.orderId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/ready',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.markReady(req.actor!,req.params.storeId,req.params.fulfillmentId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/dispatch',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.dispatch(req.actor!,req.params.storeId,req.params.fulfillmentId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/fulfillments/:fulfillmentId/report-delivery',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.reportDelivery(req.actor!,req.params.storeId,req.params.fulfillmentId,req.body||{}));}catch(err){next(err);}
});

// Seller returns and physical receipt inspection.
marketplaceFulfillmentRouter.get('/marketplace/seller/stores/:storeId/returns',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({returns:service.listSellerReturns(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/returns/:returnId/review',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.reviewReturn(req.actor!,req.params.storeId,req.params.returnId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/returns/:returnId/receive',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.receiveReturn(req.actor!,req.params.storeId,req.params.returnId,req.body||{}));}catch(err){next(err);}
});
marketplaceFulfillmentRouter.post('/marketplace/seller/stores/:storeId/returns/:returnId/request-refund',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(service.requestReturnRefund(req.actor!,req.params.storeId,req.params.returnId,req.header('idempotency-key')));
  }catch(err){next(err);}
});
