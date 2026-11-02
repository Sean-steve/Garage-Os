import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceAnalyticsService as service } from '../marketplaceAnalytics/marketplaceAnalyticsService';

export const marketplaceAnalyticsRouter=Router();
marketplaceAnalyticsRouter.use(authenticate());

marketplaceAnalyticsRouter.get('/marketplace/seller/stores/:storeId/analytics',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.seller(req.actor!,req.params.storeId,{from:req.query.from,to:req.query.to}));}catch(err){next(err);}
});

marketplaceAnalyticsRouter.get('/marketplace/admin/analytics',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.platform(req.actor!,{from:req.query.from,to:req.query.to}));}catch(err){next(err);}
});
