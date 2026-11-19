import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
const execute=promisify(execFile);
const jobs=new Map();
const packaged='D:/software/jianying/JianyingPro/11.2.0.14339/ffmpeg.exe';
async function makeGif(row,base,file){
  const url=new URL(row.video);
  if(url.origin!=='https://app.readynex.cc'||!url.pathname.startsWith('/exercises/'))throw Error('无视频源');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok||!response.headers.get('content-type')?.startsWith('video/'))throw Error('视频源暂时不可用');
  const temp=await fs.promises.mkdtemp(path.join(base,'tmp-'));
  try{
    const input=path.join(temp,'input.mp4'),output=path.join(temp,'preview.gif');
    let bytes=0;
    const limit=new Transform({transform(chunk,encoding,next){bytes+=chunk.length;next(bytes>80*1024*1024?Error('素材过大'):null,chunk)}});
    await pipeline(response.body,limit,fs.createWriteStream(input));
    const tool=process.env.FFMPEG_PATH||(fs.existsSync(packaged)?packaged:'ffmpeg');
    await execute(tool,['-nostdin','-loglevel','error','-threads','2','-i',input,'-t','5','-vf','fps=8,scale=320:-2','-loop','0',output],{timeout:45000,windowsHide:true});
    await fs.promises.rename(output,file);
  }finally{await fs.promises.rm(temp,{recursive:true,force:true})}
}
export async function serveGif(row,dir,res){
  if(!row?.video){res.writeHead(404);res.end();return}
  const base=path.join(dir,'exercise-previews');await fs.promises.mkdir(base,{recursive:true});
  const file=path.join(base,row.id+'.gif');
  if(!fs.existsSync(file)){
    if(!jobs.has(row.id)){
      if(jobs.size>=3){res.writeHead(503,{'Retry-After':'5'});res.end();return}
      jobs.set(row.id,makeGif(row,base,file).finally(()=>jobs.delete(row.id)));
    }
    try{await jobs.get(row.id)}catch{res.writeHead(502);res.end();return}
  }
  res.writeHead(200,{'Content-Type':'image/gif','Cache-Control':'public, max-age=86400'});
  await pipeline(fs.createReadStream(file),res);
}