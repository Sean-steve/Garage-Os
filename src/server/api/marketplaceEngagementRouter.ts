import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceEngagementService as service } from '../marketplaceEngagement/marketplaceEngagementService';
import { jobEngine } from '../jobs/jobEngine';
import { MARKETPLACE_ALERT_EVALUATION_JOB } from '../jobs/marketplaceEngagementJob';

export const marketplaceEngagementRouter=Router();
marketplaceEngagementRouter.use(authenticate());

marketplaceEngagementRouter.get('/marketplace/engagement/summary',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.summary(req.actor!));}catch(err){next(err);}
});

marketplaceEngagementRouter.get('/marketplace/saved-listings',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({saved_listings:service.listSavedListings(req.actor!)});}catch(err){next(err);}
});
marketplaceEngagementRouter.post('/marketplace/listings/:listingId/save',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.saveListing(req.actor!,req.params.listingId,req.body||{}));}catch(err){next(err);}
});
marketplaceEngagementRouter.patch('/marketplace/saved-listings/:savedId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateSavedListing(req.actor!,req.params.savedId,req.body||{}));}catch(err){next(err);}
});
marketplaceEngagementRouter.delete('/marketplace/saved-listings/:savedId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.removeSavedListing(req.actor!,req.params.savedId));}catch(err){next(err);}
});

marketplaceEngagementRouter.get('/marketplace/saved-searches',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({saved_searches:service.listSavedSearches(req.actor!)});}catch(err){next(err);}
});
marketplaceEngagementRouter.post('/marketplace/saved-searches',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createSavedSearch(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplaceEngagementRouter.patch('/marketplace/saved-searches/:searchId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateSavedSearch(req.actor!,req.params.searchId,req.body||{}));}catch(err){next(err);}
});
marketplaceEngagementRouter.delete('/marketplace/saved-searches/:searchId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.removeSavedSearch(req.actor!,req.params.searchId));}catch(err){next(err);}
});

marketplaceEngagementRouter.get('/marketplace/alerts/preferences',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.getPreferences(req.actor!));}catch(err){next(err);}
});
marketplaceEngagementRouter.patch('/marketplace/alerts/preferences',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updatePreferences(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplaceEngagementRouter.get('/marketplace/alerts',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({alerts:service.listAlerts(req.actor!,typeof req.query.state==='string'?req.query.state:undefined)});}catch(err){next(err);}
});
marketplaceEngagementRouter.patch('/marketplace/alerts/:alertId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateAlertState(req.actor!,req.params.alertId,String(req.body?.state||'') as any));}catch(err){next(err);}
});
marketplaceEngagementRouter.post('/marketplace/alerts/evaluate',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const job_id=jobEngine.enqueue(MARKETPLACE_ALERT_EVALUATION_JOB,{user_id:req.actor!.user_id},{correlationId:req.actor!.user_id});
    res.status(202).canonicalSuccess({job_id,status:'QUEUED',delivery:'IN_APP_ONLY'});
  }catch(err){next(err);}
});
marketplaceEngagementRouter.post('/marketplace/alerts/evaluate-now',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.evaluateForUser(req.actor!));}catch(err){next(err);}
});

marketplaceEngagementRouter.get('/marketplace/seller/stores/:storeId/engagement',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.sellerEngagement(req.actor!,req.params.storeId));}catch(err){next(err);}
});
