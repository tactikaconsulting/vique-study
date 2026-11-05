import {createServer} from 'node:http';
import {createHmac, randomUUID, scryptSync, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const db = new DatabaseSync(process.env.DATABASE_PATH || 'study.sqlite');
db.exec(`CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, title TEXT, kind TEXT, date TEXT, capacity INTEGER);
CREATE TABLE IF NOT EXISTS bookings(id TEXT PRIMARY KEY, class_id TEXT REFERENCES classes(id));`);
if (!db.prepare('PRAGMA table_info(classes)').all().some(column => column.name === 'category')) {
  db.exec("ALTER TABLE classes ADD COLUMN category TEXT NOT NULL DEFAULT 'Otras'");
}
db.exec(`CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS logins(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires INTEGER NOT NULL);`);
for (const [table, column] of [['classes','tutor_id'],['bookings','student_id'],['classes','description']]) {
  if (!db.prepare('PRAGMA table_info('+table+')').all().some(field => field.name === column)) {
    db.exec('ALTER TABLE '+table+' ADD COLUMN '+column+' TEXT');
  }
}
db.exec(`CREATE TABLE IF NOT EXISTS profiles(account_id TEXT PRIMARY KEY, specialty TEXT NOT NULL, bio TEXT NOT NULL, training TEXT NOT NULL, experience TEXT NOT NULL);`);
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS booking_student ON bookings(class_id, student_id)');
const cookie = (value, age) => 'study_session='+value+'; Path=/; HttpOnly; SameSite=Lax; Max-Age='+age+
  (process.env.RAILWAY_ENVIRONMENT ? '; Secure' : '');
function accountFor(req) {
  const id = req.headers.cookie?.match(/(?:^|; )study_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
  return id && db.prepare('SELECT accounts.id, name, role FROM accounts JOIN logins ON accounts.id=account_id WHERE logins.id=? AND expires>?').get(id,Date.now());
}
const attempts = new Map();
function allowAuth(req) {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress;
  const now = Date.now();
  for (const [key,value] of attempts) if (value.until <= now) attempts.delete(key);
  const entry = attempts.get(ip) || {count:0,until:now+600000};
  if (entry.count >= 12 || (!attempts.has(ip) && attempts.size >= 5000)) return false;
  entry.count++;
  attempts.set(ip,entry);
  return true;
}
const assets = {'/':['index.html','text/html'], '/estudiantes':['index.html','text/html'], '/tutores':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/servicios/app.js':['app.js','text/javascript'], '/servicios/style.css':['style.css','text/css'], '/style.css':['style.css','text/css'], '/como-funciona.mp4':['como-funciona.mp4','video/mp4']};
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
    const asset = assets[path] || (/^\/servicios\/[a-f0-9-]{36}$/.test(path) ? assets['/'] : null);
    if (req.method === 'GET' && asset) {
      const [file,type] = asset;
      const content = readFileSync(new URL('./public/'+file, import.meta.url));
      res.writeHead(200, {'Content-Type':type.startsWith('text/') ? type+'; charset=utf-8' : type});
      return res.end(content);
    }
    const user = accountFor(req);
    if (req.method === 'GET' && path === '/api/account') {
      const profile = user && db.prepare('SELECT specialty,bio,training,experience FROM profiles WHERE account_id=?').get(user.id);
      return send(res,200,{user:user || null,profile:profile || null});
    }
    if (req.method === 'GET' && path === '/api/classes') {
      return send(res,200,db.prepare(`SELECT classes.*, accounts.name AS tutor_name,
        profiles.specialty, profiles.bio, profiles.training, profiles.experience,
        capacity-(SELECT count(*) FROM bookings WHERE class_id=classes.id) AS available,
        CASE WHEN tutor_id=? THEN 1 ELSE 0 END AS mine,
        EXISTS(SELECT 1 FROM bookings WHERE class_id=classes.id AND student_id=?) AS reserved
        FROM classes LEFT JOIN accounts ON accounts.id=classes.tutor_id
        LEFT JOIN profiles ON profiles.account_id=classes.tutor_id ORDER BY date`).all(user?.id ?? null,user?.id ?? null));
    }
    if (req.method !== 'POST') return send(res,404,{error:'Página inexistente.'});
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 4096) return send(res,413,{error:'Solicitud demasiado grande.'});
    }
    let input;
    try { input = JSON.parse(raw); } catch { return send(res,400,{error:'Datos inválidos.'}); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return send(res,400,{error:'Datos inválidos.'});
    if (path === '/api/logout') {
      const id = req.headers.cookie?.match(/(?:^|; )study_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
      if (id) db.prepare('DELETE FROM logins WHERE id=?').run(id);
      res.setHeader('Set-Cookie',cookie('',0));
      return send(res,200,{});
    }
    if (path === '/api/register' || path === '/api/login') {
      if (!allowAuth(req)) return send(res,429,{error:'Demasiados intentos. Intenta de nuevo en unos minutos.'});
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const password = typeof input.password === 'string' ? input.password : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length>254 || password.length<10 || password.length>128) {
        return send(res,400,{error:'Ingresa un correo válido y una contraseña de 10 a 128 caracteres.'});
      }
      let account = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
      if (path === '/api/register') {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (!name || name.length>80 || !['student','tutor'].includes(input.role)) return send(res,400,{error:'Revisa el nombre y el tipo de cuenta.'});
        if (input.role === 'tutor' && (!INSTRUCTOR_KEY || input.invite !== INSTRUCTOR_KEY)) return send(res,403,{error:'Código de invitación de tutor incorrecto.'});
        if (account) return send(res,409,{error:'Ya existe una cuenta con ese correo.'});
        const salt = randomUUID();
        account = {id:randomUUID(),name,role:input.role};
        db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?,?)').run(account.id,name,email,scryptSync(password,salt,64).toString('hex'),salt,input.role);
      } else {
        const derived = scryptSync(password,account?.salt ?? 'vique-study-login',64);
        if (!account || !timingSafeEqual(derived,Buffer.from(account.password,'hex'))) return send(res,401,{error:'Correo o contraseña incorrectos.'});
      }
      const sessionId = randomUUID();
      const age = 7*86400;
      db.prepare('DELETE FROM logins WHERE expires<=?').run(Date.now());
      db.prepare('INSERT INTO logins VALUES (?,?,?)').run(sessionId,account.id,Date.now()+age*1000);
      res.setHeader('Set-Cookie',cookie(sessionId,age));
      return send(res,200,{user:{id:account.id,name:account.name,role:account.role}});
    }
    const instructor = user?.role === 'tutor';
    if (path === '/api/profile') {
      if (!user) return send(res,401,{error:'Inicia sesión para editar tu perfil.'});
      const name = typeof input.name === 'string' ? input.name.trim() : '';
      const limits = {specialty:80,bio:700,training:240,experience:300};
      const profile = Object.fromEntries(Object.keys(limits).map(field => [field,typeof input[field] === 'string' ? input[field].trim() : '']));
      if (!name || name.length>80 || Object.keys(limits).some(field => profile[field].length>limits[field])) return send(res,400,{error:'Revisa el nombre y la extensión de tu perfil.'});
      if (instructor && (!profile.specialty || !profile.bio || !profile.training || !profile.experience)) return send(res,400,{error:'Completa especialidad, presentación, formación y experiencia.'});
      db.prepare('UPDATE accounts SET name=? WHERE id=?').run(name,user.id);
      if (instructor) db.prepare('INSERT OR REPLACE INTO profiles VALUES (?,?,?,?,?)').run(user.id,profile.specialty,profile.bio,profile.training,profile.experience);
      return send(res,200,{user:{...user,name},profile:instructor ? profile : null});
    }
    if (path === '/api/classes') {
      if (!instructor) return send(res,403,{error:'Ingresa con tu cuenta de tutor.'});
      const {title,kind,date} = input;
      const description = typeof input.description === 'string' ? input.description.trim() : '';
      if (description.length>1200) return send(res,400,{error:'La descripción es demasiado extensa.'});
      const category = ['Idiomas','Diseño','Tecnología'].includes(input.category) ? input.category : 'Otras';
      const capacity = kind === 'individual' ? 1 : Number(input.capacity);
      if (typeof title !== 'string' || !title.trim() || title.length > 100 ||
          !['individual','taller'].includes(kind) || !Number.isFinite(Date.parse(date)) ||
          Date.parse(date) <= Date.now() || !Number.isInteger(capacity) || capacity < 1 || capacity > 12) {
        return send(res,400,{error:'Revisa el título, horario y cupos.'});
      }
      const id = randomUUID();
      db.prepare('INSERT INTO classes (id,title,kind,date,capacity,category,tutor_id,description) VALUES (?,?,?,?,?,?,?,?)').run(id,title.trim(),kind,new Date(date).toISOString(),capacity,category,user.id,description);
      return send(res,201,{id});
    }
    const session = typeof input.id === 'string' && db.prepare('SELECT * FROM classes WHERE id=?').get(input.id);
    if (!session) return send(res,404,{error:'Clase inexistente.'});
    if (path === '/api/book') {
      if (user?.role !== 'student') return send(res,403,{error:'Ingresa con tu cuenta de estudiante.'});
      const existing = db.prepare('SELECT id FROM bookings WHERE class_id=? AND student_id=?').get(session.id,user.id);
      if (existing) return send(res,200,{booking:existing.id});
      if (Date.parse(session.date) <= Date.now()) return send(res,409,{error:'La inscripción ya cerró.'});
      const booking = randomUUID();
      const result = db.prepare(`INSERT INTO bookings (id,class_id,student_id) SELECT ?,id,? FROM classes WHERE id=? AND
        (SELECT count(*) FROM bookings WHERE class_id=classes.id)<capacity`).run(booking,user.id,session.id);
      return result.changes ? send(res,201,{booking}) : send(res,409,{error:'No quedan cupos.'});
    }
    if (path === '/api/join') {
      const booking = typeof input.booking === 'string' && db.prepare('SELECT id FROM bookings WHERE id=? AND class_id=?').get(input.booking,session.id);
      const ownBooking = user?.role === 'student' && db.prepare('SELECT id FROM bookings WHERE class_id=? AND student_id=?').get(session.id,user.id);
      const ownClass = instructor && session.tutor_id === user.id;
      const legacyTutor = !session.tutor_id && INSTRUCTOR_KEY && input.key === INSTRUCTOR_KEY;
      if (!ownClass && !ownBooking && !legacyTutor && !booking) return send(res,403,{error:'Necesitas una reserva para entrar.'});
      const minutes = (Date.now()-Date.parse(session.date))/60000;
      if (minutes < -15 || minutes > 120) return send(res,409,{error:'La sala abre 15 minutos antes de la clase y cierra dos horas después.'});
      if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) return send(res,503,{error:'El video aún no está configurado.'});
      return send(res,200,{url:LIVEKIT_URL,token:roomToken('study-'+session.id,user?.name ?? (legacyTutor?'Tutor':'Alumno'))});
    }
    send(res,404,{error:'Acción inexistente.'});
  } catch (error) {
    console.error(error.message);
    if (res.headersSent) return res.destroy();
    send(res,500,{error:'Ocurrió un error. Vuelve a intentarlo.'});
  }
}).listen(process.env.PORT || 3000,'0.0.0.0');
