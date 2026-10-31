import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from './authMiddleware';
import { carCareService } from '../carCare/carCareService';

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
