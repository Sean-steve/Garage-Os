import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { carCareService } from '../carCare/carCareService';
import { CanonicalAppError, ErrorCode } from '../../shared/errors';

export const carCareRouter = Router();
carCareRouter.use(authenticate());

carCareRouter.get('/car-care/articles', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const kind=typeof req.query.kind==='string'?req.query.kind:undefined;
    const category=typeof req.query.category==='string'?req.query.category:undefined;
    const query=typeof req.query.query==='string'?req.query.query:undefined;
    res.canonicalSuccess({articles:carCareService.listArticles({kind,category,query})});
  }catch(err){next(err);}
});

carCareRouter.get('/car-care/articles/:slug', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(carCareService.getArticle(req.params.slug));}
  catch(err){next(err);}
});

carCareRouter.get('/vehicles/:id/car-care/dashboard', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(carCareService.getDashboard(req.actor!,req.params.id));}
  catch(err){next(err);}
});

carCareRouter.get('/vehicles/:id/car-care/missions', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess({missions:carCareService.listMissions(req.actor!,req.params.id)});}
  catch(err){next(err);}
});

carCareRouter.post('/vehicles/:id/car-care/missions', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const mission=carCareService.startMission(req.actor!,req.params.id,String(req.body?.template_code||''));
    res.status(201).canonicalSuccess(mission);
  }catch(err){next(err);}
});

carCareRouter.get('/vehicles/:id/car-care/missions/:missionId', (req:Request,res:Response,next:NextFunction)=>{
  try{res.canonicalSuccess(carCareService.getMission(req.actor!,req.params.id,req.params.missionId));}
  catch(err){next(err);}
});

carCareRouter.post('/vehicles/:id/car-care/missions/:missionId/items/:itemId/progress', (req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(carCareService.updateMissionItem(
      req.actor!,req.params.id,req.params.missionId,req.params.itemId,
      req.body?.status,req.body?.note
    ));
  }catch(err){next(err);}
});


carCareRouter.get('/vehicles/:id/car-care/profile', (req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess({profile:carCareService.getCareProfile(req.actor!,req.params.id)});
  }catch(err){next(err);}
});

carCareRouter.patch('/vehicles/:id/car-care/profile', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const forbidden=['location','latitude','longitude','coordinates','gps','address','city'];
    const supplied=Object.keys(req.body||{}).filter(k=>forbidden.includes(k.toLowerCase()));
    if(supplied.length>0){
      throw new CanonicalAppError(ErrorCode.VALIDATION_ERROR,'Car Care profile does not accept precise location fields; use explicit exposure categories instead',400);
    }
    res.canonicalSuccess({profile:carCareService.updateCareProfile(req.actor!,req.params.id,req.body||{})});
  }catch(err){next(err);}
});

carCareRouter.get('/vehicles/:id/car-care/personalized', (req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(carCareService.getPersonalizedPlan(req.actor!,req.params.id,false));
  }catch(err){next(err);}
});

carCareRouter.post('/vehicles/:id/car-care/personalized/evaluate', (req:Request,res:Response,next:NextFunction)=>{
  try{
    res.canonicalSuccess(carCareService.getPersonalizedPlan(req.actor!,req.params.id,true));
  }catch(err){next(err);}
});

carCareRouter.get('/vehicles/:id/car-care/personalized/evaluations', (req:Request,res:Response,next:NextFunction)=>{
  try{
    const limit=Math.max(1,Math.min(50,Number(req.query.limit)||10));
    res.canonicalSuccess({evaluations:carCareService.listPersonalizationEvaluations(req.actor!,req.params.id,limit)});
  }catch(err){next(err);}
});
