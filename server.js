import {createServer} from 'node:http';
import {createHmac, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const db = new DatabaseSync(process.env.DATABASE_PATH || 'study.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, title TEXT, kind TEXT, date TEXT, capacity INTEGER);
CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, class_id TEXT REFERENCES classes(id));`);
if (!db.prepare('PRAGMA table_info(classes)').all().some(column => column.name === 'category')) {
  db.exec("ALTER TABLE classes ADD COLUMN category TEXT NOT NULL DEFAULT 'Otras'");
}
const assets = {'/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css'], '/como-funciona.mp4':['como-funciona.mp4','video/mp4']};
const {LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, INSTRUCTOR_KEY} = process.env;
const send = (res, status, data) => {
  res.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
};
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function roomToken(room, name) {
  const now = Math.floor(Date.now()/1000);
  const payload = {iss:LIVEKIT_API_KEY, sub:randomUUID(), name, nbf:now-5, exp:now+600,
    video:{roomJoin:true, room, canPublish:true, canSubscribe:true}};
  const body = encode({alg:'HS256',typ:'JWT'})+'.'+encode(payload);
  return body+'.'+createHmac('sha256',LIVEKIT_API_SECRET).update(body).digest('base64url');
}

createServer(async (req,res) => {
  try {
    const path = new URL(req.url,'http://localhost').pathname;
    if (req.method === 'GET' && assets[path]) {
      const [file,type] = assets[path];
      res.writeHead(200, {'Content-Type':type.startsWith('text/') ? type+'; charset=utf-8' : type});
      return res.end(readFileSync(new URL('./public/'+file, import.meta.url)));
    }
    if (req.method === 'GET' && path === '/api/classes') {
      return send(res,200,db.prepare(`SELECT classes.*, capacity-(SELECT count(*) FROM bookings WHERE class_id=classes.id) AS available FROM classes ORDER BY date`).all());
    }
    if (req.method !== 'POST') return send(res,404,{error:'Página inexistente.'});
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return send(res,413,{error:'Solicitud demasiado grande.'});
    }
    let input;
    try { input = JSON.parse(raw); } catch { return send(res,400,{error:'Datos inválidos.'}); }
    const instructor = Boolean(INSTRUCTOR_KEY && input.key === INSTRUCTOR_KEY);
    if (path === '/api/classes') {
      if (!instructor) return send(res,403,{error:'Clave de instructor incorrecta.'});
      const {title,kind,date} = input;
      const category = ['Idiomas','Diseño','Tecnología'].includes(input.category) ? input.category : 'Otras';
      const capacity = kind === 'individual' ? 1 : Number(input.capacity);
      if (typeof title !== 'string' || !title.trim() || title.length > 100 ||
          !['individual','taller'].includes(kind) || !Number.isFinite(Date.parse(date)) ||
          Date.parse(date) <= Date.now() || !Number.isInteger(capacity) || capacity < 1 || capacity > 12) {
        return send(res,400,{error:'Revisa el título, horario y cupos.'});
      }
      const id = randomUUID();
      db.prepare('INSERT INTO classes (id,title,kind,date,capacity,category) VALUES (?,?,?,?,?,?)').run(id,title.trim(),kind,new Date(date).toISOString(),capacity,category);
      return send(res,201,{id});
    }
    const session = typeof input.id === 'string' && db.prepare('SELECT * FROM classes WHERE id=?').get(input.id);
    if (!session) return send(res,404,{error:'Clase inexistente.'});
    if (path === '/api/book') {
      if (Date.parse(session.date) <= Date.now()) return send(res,409,{error:'La inscripción ya cerró.'});
      const booking = randomUUID();
      const result = db.prepare(`INSERT INTO bookings SELECT ?,id FROM classes WHERE id=? AND
        (SELECT count(*) FROM bookings WHERE class_id=classes.id)<capacity`).run(booking,session.id);
      return result.changes ? send(res,201,{booking}) : send(res,409,{error:'No quedan cupos.'});
    }
    if (path === '/api/join') {
      const booking = typeof input.booking === 'string' && db.prepare('SELECT id FROM bookings WHERE id=? AND class_id=?').get(input.booking,session.id);
      if (!instructor && !booking) return send(res,403,{error:'Necesitas una reserva para entrar.'});
      const minutes = (Date.now()-Date.parse(session.date))/60000;
      if (minutes < -15 || minutes > 120) return send(res,409,{error:'La sala abre 15 minutos antes de la clase y cierra dos horas después.'});
      if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return send(res,503,{error:'El video aún no está configurado.'});
      return send(res,200,{url:LIVEKIT_URL,token:roomToken('study-'+session.id,instructor?'Instructor':'Alumno')});
    }
    send(res,404,{error:'Acción inexistente.'});
  } catch {
    send(res,500,{error:'Ocurrió un error. Vuelve a intentarlo.'});
  }
}).listen(process.env.PORT || 3000,'0.0.0.0');
