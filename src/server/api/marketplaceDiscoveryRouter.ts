import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceDiscoveryService as service } from '../marketplaceDiscovery/marketplaceDiscoveryService';

export const marketplaceDiscoveryRouter=Router();
marketplaceDiscoveryRouter.use(authenticate());

marketplaceDiscoveryRouter.get('/marketplace/recommendations/vehicle/:vehicleId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.recommendationsForVehicle(req.actor!,req.params.vehicleId,{
    query:typeof req.query.query==='string'?req.query.query:undefined,
    category:typeof req.query.category==='string'?req.query.category:undefined,
    brand:typeof req.query.brand==='string'?req.query.brand:undefined,
    in_stock_only:String(req.query.in_stock_only||'true').toLowerCase()!=='false',
    limit:req.query.limit===undefined?undefined:Number(req.query.limit)
  }));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.get('/marketplace/recommendations/listings/:listingId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.relatedToListing(req.actor!,req.params.listingId,
    typeof req.query.vehicle_id==='string'?req.query.vehicle_id:null,
    req.query.limit===undefined?12:Number(req.query.limit)));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.get('/marketplace/merchandising',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.listPublicCollections(
    String(req.query.surface||'HOME').toUpperCase() as any,
    typeof req.query.store_id==='string'?req.query.store_id:null,
    typeof req.query.category==='string'?req.query.category:null
  ));}catch(err){next(err);}
});

marketplaceDiscoveryRouter.get('/marketplace/seller/stores/:storeId/merchandising',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({collections:service.listSellerCollections(req.actor!,req.params.storeId)});}catch(err){next(err);}
});
marketplaceDiscoveryRouter.post('/marketplace/seller/stores/:storeId/merchandising',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createSellerCollection(req.actor!,req.params.storeId,req.body||{}));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.patch('/marketplace/seller/stores/:storeId/merchandising/:collectionId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updateSellerCollection(req.actor!,req.params.storeId,req.params.collectionId,req.body||{}));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.put('/marketplace/seller/stores/:storeId/merchandising/:collectionId/items',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.replaceSellerCollectionItems(req.actor!,req.params.storeId,req.params.collectionId,req.body||{}));}catch(err){next(err);}
});

marketplaceDiscoveryRouter.get('/marketplace/admin/merchandising',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({collections:service.listPlatformCollections(req.actor!)});}catch(err){next(err);}
});
marketplaceDiscoveryRouter.post('/marketplace/admin/merchandising',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(service.createPlatformCollection(req.actor!,req.body||{}));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.patch('/marketplace/admin/merchandising/:collectionId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.updatePlatformCollection(req.actor!,req.params.collectionId,req.body||{}));}catch(err){next(err);}
});
marketplaceDiscoveryRouter.put('/marketplace/admin/merchandising/:collectionId/items',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(service.replacePlatformCollectionItems(req.actor!,req.params.collectionId,req.body||{}));}catch(err){next(err);}
});
