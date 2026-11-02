import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceGrowthService as service } from '../marketplaceGrowth/marketplaceGrowthService';

export const marketplaceGrowthRouter=Router();
marketplaceGrowthRouter.use(authenticate());

marketplaceGrowthRouter.get('/marketplace/seller/stores/:storeId/growth',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.seller(req.actor!,req.params.storeId,{from:req.query.from,to:req.query.to}));}catch(err){next(err);}
});

marketplaceGrowthRouter.get('/marketplace/admin/growth',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.platform(req.actor!,{from:req.query.from,to:req.query.to}));}catch(err){next(err);}
});
