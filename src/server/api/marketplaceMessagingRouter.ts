import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceMessagingService as service } from '../marketplaceMessaging/marketplaceMessagingService';

export const marketplaceMessagingRouter=Router();
marketplaceMessagingRouter.use(authenticate());

marketplaceMessagingRouter.get('/marketplace/communications/adapters',(_req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.adapterCapabilities());}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/communications/preferences',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getPreferences(req.actor!));}catch(err){next(err);}
});
marketplaceMessagingRouter.patch('/marketplace/communications/preferences',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updatePreferences(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/communications/conversations',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({conversations:service.listBuyerConversations(req.actor!)});}catch(err){next(err);}
});
marketplaceMessagingRouter.post('/marketplace/communications/conversations',(req:Request,res:Response,next:NextFunction)=>{
  try{const out=service.createConversation(req.actor!,req.body||{});res.status(out.created?201:200).canonicalSuccess(out);}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/communications/conversations/:conversationId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getConversation(req.actor!,req.params.conversationId));}catch(err){next(err);}
});
marketplaceMessagingRouter.patch('/marketplace/communications/conversations/:conversationId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateConversation(req.actor!,req.params.conversationId,req.body||{}));}catch(err){next(err);}
});
marketplaceMessagingRouter.post('/marketplace/communications/conversations/:conversationId/messages',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.sendMessage(req.actor!,req.params.conversationId,req.body||{}));}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/communications/notifications',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({notifications:service.listBuyerNotifications(req.actor!)});}catch(err){next(err);}
});
marketplaceMessagingRouter.patch('/marketplace/communications/notifications/:notificationId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateBuyerNotification(req.actor!,req.params.notificationId,String(req.body?.state||'').toUpperCase() as any));}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/seller/stores/:storeId/communications/conversations',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({conversations:service.listSellerConversations(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/seller/stores/:storeId/communications/notifications',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({notifications:service.listSellerNotifications(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceMessagingRouter.patch('/marketplace/seller/stores/:storeId/communications/notifications/:notificationId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateSellerNotification(req.actor!,req.params.storeId,req.params.notificationId,String(req.body?.state||'').toUpperCase() as any));}catch(err){next(err);}
});
marketplaceMessagingRouter.get('/marketplace/seller/stores/:storeId/crm',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.sellerCrm(req.actor!,req.params.storeId));}catch(err){next(err);}
});
