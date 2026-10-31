import { getDatabase } from '../database/connection';
import {
  CarCareArticle, CareMissionItem, CareMissionItemProgress, CareMissionTemplate,
  VehicleCareMission, CareMissionItemStatus
} from './types';

const parseJson=(value:unknown):string[]=>{
  try{return Array.isArray(value)?value as string[]:JSON.parse(String(value||'[]')) as string[];}catch{return [];}
};

export class CarCareRepository {
  listArticles(filters:{kind?:string;category?:string;query?:string}={}):CarCareArticle[]{
    const db=getDatabase(); const where=["status='PUBLISHED'"]; const params:any[]=[];
    if(filters.kind){where.push('content_kind=?');params.push(filters.kind);}
    if(filters.category){where.push('category=?');params.push(filters.category);}
    if(filters.query){where.push('(LOWER(title) LIKE ? OR LOWER(summary) LIKE ? OR LOWER(explanation) LIKE ?)');const q='%'+filters.query.toLowerCase()+'%';params.push(q,q,q);}
    const rows=db.prepare('SELECT * FROM car_care_articles WHERE '+where.join(' AND ')+' ORDER BY CASE risk_level WHEN \'URGENT\' THEN 1 WHEN \'CAUTION\' THEN 2 ELSE 3 END, title').all(...params) as any[];
    return rows.map(this.mapArticle);
  }
  getArticleBySlug(slug:string):CarCareArticle|null{
    const row=getDatabase().prepare("SELECT * FROM car_care_articles WHERE slug=? AND status='PUBLISHED' LIMIT 1").get(slug) as any;
    return row?this.mapArticle(row):null;
  }
  listTemplates():CareMissionTemplate[]{
    return getDatabase().prepare("SELECT * FROM car_care_mission_templates WHERE status='ACTIVE' ORDER BY title").all() as unknown as CareMissionTemplate[];
  }
  getTemplateByCode(code:string):CareMissionTemplate|null{
    return (getDatabase().prepare("SELECT * FROM car_care_mission_templates WHERE code=? AND status='ACTIVE' LIMIT 1").get(code) as CareMissionTemplate|undefined)||null;
  }
  getTemplateById(id:string):CareMissionTemplate|null{
    return (getDatabase().prepare('SELECT * FROM car_care_mission_templates WHERE id=? LIMIT 1').get(id) as CareMissionTemplate|undefined)||null;
  }
  listTemplateItems(templateId:string):CareMissionItem[]{
    return getDatabase().prepare('SELECT * FROM car_care_mission_items WHERE template_id=? ORDER BY display_order').all(templateId) as unknown as CareMissionItem[];
  }
  createMission(m:VehicleCareMission):void{
    getDatabase().prepare(`
      INSERT INTO vehicle_care_missions (id,user_id,vehicle_id,template_id,status,started_at,completed_at,cancelled_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(m.id,m.user_id,m.vehicle_id,m.template_id,m.status,m.started_at,m.completed_at,m.cancelled_at,m.created_at,m.updated_at);
  }
  getMission(userId:string,vehicleId:string,id:string):VehicleCareMission|null{
    return (getDatabase().prepare('SELECT * FROM vehicle_care_missions WHERE id=? AND user_id=? AND vehicle_id=? LIMIT 1').get(id,userId,vehicleId) as VehicleCareMission|undefined)||null;
  }
  getActiveMissionForTemplate(userId:string,vehicleId:string,templateId:string):VehicleCareMission|null{
    return (getDatabase().prepare("SELECT * FROM vehicle_care_missions WHERE user_id=? AND vehicle_id=? AND template_id=? AND status='ACTIVE' LIMIT 1").get(userId,vehicleId,templateId) as VehicleCareMission|undefined)||null;
  }
  listMissions(userId:string,vehicleId:string):VehicleCareMission[]{
    return getDatabase().prepare('SELECT * FROM vehicle_care_missions WHERE user_id=? AND vehicle_id=? ORDER BY started_at DESC').all(userId,vehicleId) as unknown as VehicleCareMission[];
  }
  createProgress(p:CareMissionItemProgress):void{
    getDatabase().prepare(`
      INSERT INTO vehicle_care_mission_item_progress (id,mission_id,item_id,status,note,updated_by,completed_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(p.id,p.mission_id,p.item_id,p.status,p.note,p.updated_by,p.completed_at,p.created_at,p.updated_at);
  }
  listProgress(missionId:string):CareMissionItemProgress[]{
    return getDatabase().prepare('SELECT * FROM vehicle_care_mission_item_progress WHERE mission_id=?').all(missionId) as unknown as CareMissionItemProgress[];
  }
  updateProgress(missionId:string,itemId:string,status:CareMissionItemStatus,note:string|null,userId:string,now:string):boolean{
    const r=getDatabase().prepare(`
      UPDATE vehicle_care_mission_item_progress
      SET status=?,note=?,updated_by=?,completed_at=?,updated_at=?
      WHERE mission_id=? AND item_id=?
    `).run(status,note,userId,status==='PENDING'?null:now,now,missionId,itemId);
    return Number(r.changes||0)===1;
  }
  completeMission(id:string,userId:string,vehicleId:string,now:string):boolean{
    const r=getDatabase().prepare(`
      UPDATE vehicle_care_missions SET status='COMPLETED',completed_at=?,updated_at=?
      WHERE id=? AND user_id=? AND vehicle_id=? AND status='ACTIVE'
    `).run(now,now,id,userId,vehicleId);
    return Number(r.changes||0)===1;
  }

  private mapArticle=(r:any):CarCareArticle=>({
    id:String(r.id),slug:String(r.slug),content_kind:r.content_kind,category:String(r.category),
    title:String(r.title),summary:String(r.summary),explanation:String(r.explanation),
    owner_actions:parseJson(r.owner_actions_json),seek_help_when:parseJson(r.seek_help_when_json),
    risk_level:r.risk_level,professional_inspection_required:Boolean(r.professional_inspection_required),
    roadside_recommended:Boolean(r.roadside_recommended),booking_recommended:Boolean(r.booking_recommended),
    source_label:String(r.source_label),content_version:Number(r.content_version),status:r.status,
    created_at:String(r.created_at),updated_at:String(r.updated_at)
  });
}
export const carCareRepository=new CarCareRepository();
