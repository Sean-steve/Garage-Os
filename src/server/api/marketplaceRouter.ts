import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { marketplaceService } from '../marketplace/marketplaceService';

export const marketplaceRouter=Router();
marketplaceRouter.use(authenticate());

marketplaceRouter.get('/marketplace/categories',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({categories:marketplaceService.listCategories()});}
  catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/search',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(marketplaceService.search({
      query:typeof req.query.query==='string'?req.query.query:undefined,
      category:typeof req.query.category==='string'?req.query.category:undefined,
      product_type:typeof req.query.product_type==='string'?req.query.product_type as any:undefined,
      condition:typeof req.query.condition==='string'?req.query.condition as any:undefined,
      brand:typeof req.query.brand==='string'?req.query.brand:undefined,
      currency:typeof req.query.currency==='string'?req.query.currency:undefined,
      min_price_minor:req.query.min_price_minor===undefined?undefined:Number(req.query.min_price_minor),
      max_price_minor:req.query.max_price_minor===undefined?undefined:Number(req.query.max_price_minor),
      in_stock_only:String(req.query.in_stock_only||'').toLowerCase()==='true',
      store_slug:typeof req.query.store_slug==='string'?req.query.store_slug:undefined,
      limit:req.query.limit===undefined?undefined:Number(req.query.limit),
      offset:req.query.offset===undefined?undefined:Number(req.query.offset),
    }));
  }catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/listings/:id',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.getListingDetail(req.params.id));}
  catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/stores/:slug',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.getStorefront(req.params.slug));}
  catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/seller/stores',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const organizationId=String(req.query.organization_id||'');
    res.canonicalSuccess({stores:marketplaceService.listSellerStores(req.actor!,organizationId)});
  }catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(marketplaceService.createStore(req.actor!,req.body||{}));}
  catch(err){next(err);}
});

marketplaceRouter.patch('/marketplace/seller/stores/:storeId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.updateStore(req.actor!,req.params.storeId,req.body||{}));}
  catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/seller/stores/:storeId/products',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({products:marketplaceService.listSellerProducts(req.actor!,req.params.storeId)});}
  catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores/:storeId/products',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const forbidden=['fitment','fitment_status','compatible_vehicle','compatible_vehicles','vehicle_make','vehicle_model','model_year'];
    const supplied=Object.keys(req.body||{}).filter(k=>forbidden.includes(k.toLowerCase()));
    if(supplied.length){
      throw new Error('Vehicle fitment/compatibility fields are not accepted in Sprint 22');
    }
    res.status(201).canonicalSuccess(marketplaceService.createProduct(req.actor!,req.params.storeId,req.body||{}));
  }catch(err){next(err);}
});

marketplaceRouter.patch('/marketplace/seller/stores/:storeId/products/:productId',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const forbidden=['fitment','fitment_status','compatible_vehicle','compatible_vehicles','vehicle_make','vehicle_model','model_year'];
    const supplied=Object.keys(req.body||{}).filter(k=>forbidden.includes(k.toLowerCase()));
    if(supplied.length){
      throw new Error('Vehicle fitment/compatibility fields are not accepted in Sprint 22');
    }
    res.canonicalSuccess(marketplaceService.updateProduct(req.actor!,req.params.storeId,req.params.productId,req.body||{}));
  }catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores/:storeId/products/:productId/listing',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(marketplaceService.createListing(req.actor!,req.params.storeId,req.params.productId,req.body||{}));}
  catch(err){next(err);}
});

marketplaceRouter.get('/marketplace/seller/stores/:storeId/listings/:listingId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.getSellerListing(req.actor!,req.params.storeId,req.params.listingId));}
  catch(err){next(err);}
});

marketplaceRouter.patch('/marketplace/seller/stores/:storeId/listings/:listingId',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.updateListing(req.actor!,req.params.storeId,req.params.listingId,req.body||{}));}
  catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores/:storeId/listings/:listingId/publish',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.publishListing(req.actor!,req.params.storeId,req.params.listingId));}
  catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores/:storeId/listings/:listingId/pause',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(marketplaceService.pauseListing(req.actor!,req.params.storeId,req.params.listingId));}
  catch(err){next(err);}
});

marketplaceRouter.post('/marketplace/seller/stores/:storeId/listings/:listingId/media',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(marketplaceService.addListingMedia(req.actor!,req.params.storeId,req.params.listingId,req.body||{}));}
  catch(err){next(err);}
});
