import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceTrustService as service } from '../marketplaceTrust/marketplaceTrustService';

export const marketplaceTrustRouter=Router();
marketplaceTrustRouter.use(authenticate());

// Trust facts and verified-purchase reviews.
marketplaceTrustRouter.get('/marketplace/stores/:storeId/trust',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getStoreTrust(req.params.storeId));}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/reviews/me',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({reviews:service.listMyReviews(req.actor!)});}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/orders/:orderId/reviews',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createReview(req.actor!,req.params.orderId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.patch('/marketplace/reviews/:reviewId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateMyReview(req.actor!,req.params.reviewId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/seller/stores/:storeId/reviews/:reviewId/respond',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.respondToReview(req.actor!,req.params.storeId,req.params.reviewId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/seller/stores/:storeId/reviews/:reviewId/report',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.reportReview(req.actor!,req.params.storeId,req.params.reviewId,req.body||{}));}catch(err){next(err);}
});

// Buyer/seller disputes.
marketplaceTrustRouter.post('/marketplace/orders/:orderId/disputes',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.openDispute(req.actor!,req.params.orderId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/disputes/me',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({disputes:service.listMyDisputes(req.actor!)});}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/disputes/:disputeId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getMyDispute(req.actor!,req.params.disputeId));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/disputes/:disputeId/messages',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.addBuyerMessage(req.actor!,req.params.disputeId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/seller/stores/:storeId/disputes',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({disputes:service.listSellerDisputes(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/seller/stores/:storeId/disputes/:disputeId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getSellerDispute(req.actor!,req.params.storeId,req.params.disputeId));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/seller/stores/:storeId/disputes/:disputeId/messages',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.addSellerMessage(req.actor!,req.params.storeId,req.params.disputeId,req.body||{}));}catch(err){next(err);}
});

// Trust & Safety moderation and dispute operations.
marketplaceTrustRouter.get('/marketplace/admin/trust/review-reports',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.listReviewModeration(req.actor!));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/admin/trust/reviews/:reviewId/moderate',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.moderateReview(req.actor!,req.params.reviewId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.get('/marketplace/admin/trust/disputes',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({disputes:service.listOpsDisputes(req.actor!)});}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/admin/trust/disputes/:disputeId/take',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.takeDispute(req.actor!,req.params.disputeId));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/admin/trust/disputes/:disputeId/messages',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.addOpsMessage(req.actor!,req.params.disputeId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/admin/trust/disputes/:disputeId/resolve',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.resolveDispute(req.actor!,req.params.disputeId,req.body||{}));}catch(err){next(err);}
});
marketplaceTrustRouter.post('/marketplace/admin/trust/disputes/:disputeId/close',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.closeDispute(req.actor!,req.params.disputeId));}catch(err){next(err);}
});
