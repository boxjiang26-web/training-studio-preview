export function messageSchema(pg=false){return `CREATE TABLE IF NOT EXISTS messages(
 id ${pg?'SERIAL':'INTEGER'} PRIMARY KEY,student INTEGER NOT NULL REFERENCES students(id),
 sender TEXT NOT NULL,request_id TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,
 seen INTEGER NOT NULL DEFAULT 0, UNIQUE(student,sender,request_id));
 CREATE INDEX IF NOT EXISTS messages_thread ON messages(student,id);
 CREATE INDEX IF NOT EXISTS messages_unread ON messages(sender,seen,student);`}
function check(ok,message,status=400){if(!ok)throw Object.assign(Error(message),{status})}
export async function messages({one,all,run},url,b,owner,post){
 const sender=owner===0?'coach':'student',incoming=owner===0?'student':'coach';
 const route=url.pathname;
 if(route==='/api/messages/unread'&&!post){
   const scope=owner===0?[]:[owner];
   return {counts:await all('SELECT student,COUNT(*) AS count FROM messages WHERE sender=? AND seen=0'+(scope.length?' AND student=?':'')+' GROUP BY student',incoming,...scope)};
 }
 const student=Number(post?(b.student??owner):(url.searchParams.get('student')??owner));
 check(owner===0||student===owner,'无权访问该对话',403);
 check(Number.isSafeInteger(student)&&await one('SELECT id FROM students WHERE id=?',student),'学员不存在',404);
 if(route==='/api/messages/thread'&&!post){
   const before=Number(url.searchParams.get('before')||0);check(Number.isSafeInteger(before)&&before>=0,'分页位置无效');
   const rows=await all('SELECT id,sender,body,created,seen FROM messages WHERE student=?'+(before?' AND id<?':'')+' ORDER BY id DESC LIMIT 51',student,...(before?[before]:[]));
   return {older:rows.length>50,rows:rows.slice(0,50).reverse()};
 }
 if(route==='/api/messages/send'&&post){
   check(typeof b.body==='string'&&b.body.trim()&&b.body.trim().length<=2000,'请输入 1–2000 字的消息');
   check(typeof b.requestId==='string'&&/^[a-zA-Z0-9-]{8,80}$/.test(b.requestId),'发送标识无效');
   await run('INSERT INTO messages(student,sender,request_id,body,created) VALUES(?,?,?,?,?) ON CONFLICT(student,sender,request_id) DO NOTHING',student,sender,b.requestId,b.body.trim(),new Date().toISOString());
   const row=await one('SELECT id,body FROM messages WHERE student=? AND sender=? AND request_id=?',student,sender,b.requestId);
   check(row.body===b.body.trim(),'消息已改变，请重新发送',409);return {id:row.id};
 }
 if(route==='/api/messages/read'&&post){
   check(Array.isArray(b.ids)&&b.ids.length>0&&b.ids.length<=50&&b.ids.every(Number.isSafeInteger),'消息标识无效');
   await run('UPDATE messages SET seen=1 WHERE student=? AND sender=? AND id IN ('+b.ids.map(()=>'?').join(',')+')',student,incoming,...b.ids);return {};
 }
 check(false,'页面不存在',404);
}