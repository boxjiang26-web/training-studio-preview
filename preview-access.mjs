import {createHash,timingSafeEqual} from 'node:crypto';
const hasPasswordAuth=Boolean(process.env.COACH_PASSWORD);
const enabled=(process.env.PREVIEW_PRIVATE==='1'||process.env.RENDER==='true')&&(!hasPasswordAuth||process.env.FORCE_PREVIEW_BASIC==='1');
const digest=s=>createHash('sha256').update(s).digest();
if(enabled && !process.env.PREVIEW_PASSWORD)throw Error('Private preview requires PREVIEW_PASSWORD');
const expected=enabled?digest('studio:'+process.env.PREVIEW_PASSWORD):null;
export function allowPreview(req,res){
  if(!enabled)return true;
  const header=req.headers.authorization||'';
  if(header.startsWith('Basic ') && timingSafeEqual(expected,digest(Buffer.from(header.slice(6),'base64'))))return true;
  res.writeHead(401,{'WWW-Authenticate':'Basic realm="Training Studio", charset="UTF-8"','Cache-Control':'no-store'});
  res.end();return false;
}
