import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { fitmentService } from '../fitment/fitmentService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export const fitmentRouter=Router();
fitmentRouter.use(authenticate());

function searchQuery(req:Request){
  return {
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
  };
}

// My Car → Compatible Parts
fitmentRouter.get('/marketplace/fitment/vehicles/:vehicleId/search',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(fitmentService.searchForVehicle(
      req.actor!,req.params.vehicleId,searchQuery(req),
      String(req.query.include_unknown||'').toLowerCase()==='true'
    ));
  }catch(err){next(err);}
});

// Listing × selected vehicle compatibility decision.
fitmentRouter.get('/marketplace/listings/:listingId/fitment',(req:Request,res:Response,next:NextFunction)=>{
  try{
    const vehicleId=String(req.query.vehicle_id||'');
    if(!vehicleId)throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'vehicle_id is required',400);
    res.canonicalSuccess(fitmentService.evaluateListing(req.actor!,req.params.listingId,vehicleId,true));
  }catch(err){next(err);}
});

// Seller fitment claims are structured and can never be self-marked VERIFIED.
fitmentRouter.get('/marketplace/seller/stores/:storeId/products/:productId/fitment/rules',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess({rules:fitmentService.listSellerRules(req.actor!,req.params.storeId,req.params.productId)});
  }catch(err){next(err);}
});

fitmentRouter.post('/marketplace/seller/stores/:storeId/products/:productId/fitment/rules',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(
      fitmentService.createSellerRule(req.actor!,req.params.storeId,req.params.productId,req.body||{})
    );
  }catch(err){next(err);}
});

fitmentRouter.post('/marketplace/seller/stores/:storeId/products/:productId/fitment/rules/:ruleId/revoke',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(
      fitmentService.revokeSellerRule(req.actor!,req.params.storeId,req.params.productId,req.params.ruleId)
    );
  }catch(err){next(err);}
});

// Platform-governed source/provider registry for future catalog integrations.
fitmentRouter.get('/marketplace/admin/fitment/sources',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({sources:fitmentService.listSources(req.actor!)});}
  catch(err){next(err);}
});

fitmentRouter.post('/marketplace/admin/fitment/sources',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(fitmentService.createSource(req.actor!,req.body||{}));}
  catch(err){next(err);}
});

fitmentRouter.post('/marketplace/admin/fitment/rules',(req:Request,res:Response,next:NextFunction)=>{
  try{res.status(201).canonicalSuccess(fitmentService.createAuthoritativeRule(req.actor!,req.body||{}));}
  catch(err){next(err);}
});

// Installation linkage records what was installed and the fitment state known at that time.
// It does not retroactively certify the product.
fitmentRouter.get('/marketplace/fitment/vehicles/:vehicleId/installations',(req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({installations:fitmentService.listInstallations(req.actor!,req.params.vehicleId)});}
  catch(err){next(err);}
});

fitmentRouter.post('/marketplace/fitment/vehicles/:vehicleId/installations',(req:Request,res:Response,next:NextFunction)=>{
  try{
    res.status(201).canonicalSuccess(fitmentService.recordInstallation(req.actor!,req.params.vehicleId,req.body||{}));
  }catch(err){next(err);}
});
