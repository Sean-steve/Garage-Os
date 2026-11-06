import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplacePayoutService as service } from '../marketplacePayouts/marketplacePayoutService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export const marketplacePayoutRouter=Router();

// External payout provider webhook. HMAC signature is the authentication boundary.
marketplacePayoutRouter.post('/marketplace/payouts/webhooks/:providerKey',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const signature=String(req.header('x-provider-signature')||'');
    if(!signature)throw new CanonicalAppError(ErrorCode.NOT_AUTHORIZED,'x-provider-signature is required',401);
    res.canonicalSuccess(service.processWebhook(req.params.providerKey,signature,req.body||{}));
  }catch(err){next(err);}
});

marketplacePayoutRouter.use(authenticate());

marketplacePayoutRouter.get('/marketplace/payouts/providers',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({providers:service.listActiveProviders()});}catch(err){next(err);}
});

marketplacePayoutRouter.get('/marketplace/seller/stores/:storeId/payouts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.sellerDashboard(req.actor!,req.params.storeId));}catch(err){next(err);}
});
marketplacePayoutRouter.post('/marketplace/seller/stores/:storeId/payout-accounts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.registerAccount(req.actor!,req.params.storeId,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.post('/marketplace/seller/stores/:storeId/payouts',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(service.requestPayout(req.actor!,req.params.storeId,req.body||{},req.header('idempotency-key')));
  }catch(err){next(err);}
});

marketplacePayoutRouter.get('/marketplace/admin/payouts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.adminOverview(req.actor!));}catch(err){next(err);}
});
marketplacePayoutRouter.post('/marketplace/admin/payouts/providers',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createProvider(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.patch('/marketplace/admin/payouts/providers/:providerId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateProvider(req.actor!,req.params.providerId,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.put('/marketplace/admin/payouts/providers/:providerId/policy',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.setPolicy(req.actor!,req.params.providerId,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.patch('/marketplace/admin/payouts/accounts/:accountId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.reviewAccount(req.actor!,req.params.accountId,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.post('/marketplace/admin/payouts/batches',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createBatch(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplacePayoutRouter.post('/marketplace/admin/payouts/batches/:batchId/handoff',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.initiateBatchHandoff(req.actor!,req.params.batchId));}catch(err){next(err);}
});
