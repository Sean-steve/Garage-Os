import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplacePaymentService as service } from '../marketplacePayments/marketplacePaymentService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export const marketplacePaymentRouter=Router();

// External provider webhook: authentication is the provider HMAC signature, not a Garage OS user session.
marketplacePaymentRouter.post('/marketplace/payments/webhooks/:providerKey',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const signature=String(req.header('x-provider-signature')||'');
    if(!signature)throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'x-provider-signature is required',401);
    res.canonicalSuccess(service.processWebhook(req.params.providerKey,signature,req.body||{}));
  }catch(err){next(err);}
});

marketplacePaymentRouter.use(authenticate());

marketplacePaymentRouter.get('/marketplace/payments/providers',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({providers:service.listActiveProviders()});}catch(err){next(err);}
});
marketplacePaymentRouter.post('/marketplace/orders/:orderId/payments/intents',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(service.createIntent(
      req.actor!,req.params.orderId,req.body?.provider_key,req.header('idempotency-key')
    ));
  }catch(err){next(err);}
});
marketplacePaymentRouter.get('/marketplace/orders/:orderId/finance',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getBuyerOrderFinance(req.actor!,req.params.orderId));}catch(err){next(err);}
});
marketplacePaymentRouter.post('/marketplace/orders/:orderId/refunds',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(service.requestRefund(
      req.actor!,req.params.orderId,req.body||{},req.header('idempotency-key')
    ));
  }catch(err){next(err);}
});

marketplacePaymentRouter.get('/marketplace/seller/stores/:storeId/settlement',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.sellerSettlement(req.actor!,req.params.storeId));}catch(err){next(err);}
});

marketplacePaymentRouter.get('/marketplace/admin/payments/providers',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({providers:service.listProviders(req.actor!)});}catch(err){next(err);}
});
marketplacePaymentRouter.post('/marketplace/admin/payments/providers',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createProvider(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplacePaymentRouter.patch('/marketplace/admin/payments/providers/:providerId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateProvider(req.actor!,req.params.providerId,req.body||{}));}catch(err){next(err);}
});
marketplacePaymentRouter.get('/marketplace/admin/payments/reconciliation',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.reconciliation(req.actor!));}catch(err){next(err);}
});
