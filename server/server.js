/* =====================================================================
   Timón · servidor con usuarios y datos compartidos
   Node 18+ sin dependencias. Guarda todo en archivos JSON dentro de DATA_DIR
   (en Render: un disco persistente). Sirve public/index.html en modo servidor.
   ===================================================================== */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = path.resolve(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const EMP_DIR = path.join(DATA_DIR, 'empresas');
const BAK_DIR = path.join(DATA_DIR, 'respaldos');
const SESSION_DAYS = 30;
const MAX_BODY = 25 * 1024 * 1024;
const RESPALDOS_DIAS = 60;

for (const d of [DATA_DIR, EMP_DIR, BAK_DIR]) fs.mkdirSync(d, { recursive: true });

/* ---------- almacenamiento ---------- */
function escribirAtomico(file, texto) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, texto);
  fs.renameSync(tmp, file);
}
function leerJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return def; throw e; }
}
let db = leerJSON(DB_FILE, null) || { usuarios: [], empresas: [], permisos: [], sesiones: {} };
for (const k of ['usuarios', 'empresas', 'permisos']) if (!Array.isArray(db[k])) db[k] = [];
if (!db.sesiones || typeof db.sesiones !== 'object') db.sesiones = {};
const guardarDB = () => escribirAtomico(DB_FILE, JSON.stringify(db, null, 1));
const nuevoId = (p) => `${p}_${crypto.randomBytes(9).toString('base64url')}`;
const empFile = (id) => path.join(EMP_DIR, `${id.replace(/[^\w-]/g, '')}.json`);

function leerEmpresa(id) { return leerJSON(empFile(id), { version: 0, actualizado: null, actualizadoPor: null, datos: null }); }
function guardarEmpresa(id, reg) {
  const texto = JSON.stringify(reg);
  escribirAtomico(empFile(id), texto);
  // Respaldo diario: una copia por empresa y por día (se conservan RESPALDOS_DIAS días).
  const dia = new Date().toISOString().slice(0, 10);
  try {
    escribirAtomico(path.join(BAK_DIR, `${path.basename(empFile(id), '.json')}-${dia}.json`), texto);
    const limite = new Date(Date.now() - RESPALDOS_DIAS * 86400000).toISOString().slice(0, 10);
    for (const f of fs.readdirSync(BAK_DIR)) { const m = /-(\d{4}-\d{2}-\d{2})\.json$/.exec(f); if (m && m[1] < limite) fs.unlinkSync(path.join(BAK_DIR, f)); }
  } catch (e) { console.error('respaldo', e.message); }
}

/* ---------- contraseñas y sesiones ---------- */
function hashClave(clave, salt = crypto.randomBytes(16).toString('hex')) {
  const h = crypto.scryptSync(String(clave), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
  return { salt, hash: h };
}
function claveOk(u, clave) {
  const { hash } = hashClave(clave, u.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(u.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
function crearSesion(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.sesiones[sha(token)] = { userId, exp: Date.now() + SESSION_DAYS * 86400000 };
  for (const [k, s] of Object.entries(db.sesiones)) if (s.exp < Date.now()) delete db.sesiones[k];
  guardarDB();
  return token;
}
function leerCookie(req, nombre) {
  const c = req.headers.cookie || '';
  for (const parte of c.split(';')) { const [k, ...v] = parte.trim().split('='); if (k === nombre) return decodeURIComponent(v.join('=')); }
  return null;
}
function usuarioDe(req) {
  const t = leerCookie(req, 'timon_sid');
  if (!t) return null;
  const s = db.sesiones[sha(t)];
  if (!s || s.exp < Date.now()) return null;
  return db.usuarios.find((u) => u.id === s.userId && u.activo !== false) || null;
}
const esHttps = (req) => (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' || process.env.COOKIE_SECURE === '1';
function cookieSesion(req, token, maxAge) {
  return `timon_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${esHttps(req) ? '; Secure' : ''}`;
}

/* Intentos de ingreso: 8 fallidos cada 15 minutos por IP y por correo. */
const intentos = new Map();
function bloqueado(clave) { const x = intentos.get(clave); return x && x.n >= 8 && Date.now() - x.t < 15 * 60000; }
function fallo(clave) { const x = intentos.get(clave); if (!x || Date.now() - x.t > 15 * 60000) intentos.set(clave, { n: 1, t: Date.now() }); else x.n++; }

/* ---------- permisos ---------- */
const ROLES = ['lector', 'editor'];
function rolEn(u, empresaId) {
  if (u.admin) return 'admin';
  const p = db.permisos.find((x) => x.userId === u.id && x.empresaId === empresaId);
  return p ? p.rol : null;
}
function empresasDe(u) {
  return db.empresas.filter((e) => rolEn(u, e.id)).map((e) => ({ id: e.id, nombre: e.nombre, rol: rolEn(u, e.id) })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
const usuarioPublico = (u) => ({ id: u.id, email: u.email, nombre: u.nombre, admin: !!u.admin, activo: u.activo !== false });

/* Usuario administrador inicial desde variables de entorno. */
(function bootstrap() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const clave = process.env.ADMIN_PASSWORD || '';
  // ADMIN_RESET=1 vuelve a poner la contraseña de ADMIN_EMAIL (para recuperar el acceso); después conviene quitarla.
  if (process.env.ADMIN_RESET === '1' && email && clave.length >= 8) {
    let u = db.usuarios.find((x) => x.email === email);
    if (!u) { u = { id: nuevoId('u'), email, nombre: 'Administrador', creado: new Date().toISOString() }; db.usuarios.push(u); }
    Object.assign(u, hashClave(clave), { admin: true, activo: true });
    for (const [k, s] of Object.entries(db.sesiones)) if (s.userId === u.id) delete db.sesiones[k];
    guardarDB();
    console.log(`Contraseña del administrador ${email} restablecida.`);
    return;
  }
  if (!db.usuarios.some((u) => u.admin)) {
    if (!email || clave.length < 8) {
      console.warn('No hay administrador. Definí ADMIN_EMAIL y ADMIN_PASSWORD (8 caracteres o más) y reiniciá el servicio.');
      return;
    }
    const { salt, hash } = hashClave(clave);
    db.usuarios.push({ id: nuevoId('u'), email, nombre: 'Administrador', salt, hash, admin: true, activo: true, creado: new Date().toISOString() });
    guardarDB();
    console.log(`Administrador creado: ${email}`);
  }
})();

/* ---------- utilidades HTTP ---------- */
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
function enviar(res, status, obj, extra = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEGURIDAD, ...extra });
  res.end(body);
}
const error = (res, status, mensaje) => enviar(res, status, { error: mensaje });
function leerCuerpo(req) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const partes = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('Los datos superan el tamaño máximo.'), { status: 413 })); req.destroy(); return; } partes.push(c); });
    req.on('end', () => {
      if (!n) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('JSON inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const emailValido = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- respaldo total ---------- */
function respaldoTotal() {
  return {
    tipo: 'timon-respaldo-total', formato: 1, fecha: new Date().toISOString(),
    usuarios: db.usuarios.map((x) => ({ id: x.id, email: x.email, nombre: x.nombre, salt: x.salt, hash: x.hash, admin: !!x.admin, activo: x.activo !== false, creado: x.creado })),
    permisos: db.permisos.map((p) => ({ userId: p.userId, empresaId: p.empresaId, rol: p.rol })),
    empresas: db.empresas.map((e) => { const reg = leerEmpresa(e.id); return { id: e.id, nombre: e.nombre, creado: e.creado, version: reg.version, actualizado: reg.actualizado, actualizadoPor: reg.actualizadoPor, datos: reg.datos }; }),
  };
}
function validarRespaldo(b) {
  if (!b || b.tipo !== 'timon-respaldo-total' || !Array.isArray(b.usuarios) || !Array.isArray(b.empresas) || !Array.isArray(b.permisos)) return 'El archivo no es un respaldo total de Timón.';
  const ids = new Set(), emails = new Set();
  for (const x of b.usuarios) {
    if (!x || typeof x.id !== 'string' || !/^[\w-]+$/.test(x.id) || !emailValido(String(x.email || '').toLowerCase()) || typeof x.salt !== 'string' || !/^[0-9a-f]{128}$/.test(String(x.hash || ''))) return 'El respaldo tiene un usuario con datos incompletos.';
    if (ids.has(x.id) || emails.has(String(x.email).toLowerCase())) return 'El respaldo tiene usuarios repetidos.';
    ids.add(x.id); emails.add(String(x.email).toLowerCase());
  }
  if (!b.usuarios.some((x) => x.admin && x.activo !== false)) return 'El respaldo no tiene ningún administrador activo: no se podría entrar.';
  const eids = new Set();
  for (const e of b.empresas) {
    if (!e || typeof e.id !== 'string' || !/^[\w-]+$/.test(e.id) || !String(e.nombre || '').trim() || eids.has(e.id)) return 'El respaldo tiene una empresa con datos incompletos.';
    if (e.datos != null && (typeof e.datos !== 'object' || !e.datos.empresa)) return `Los datos de «${e.nombre}» no son válidos.`;
    eids.add(e.id);
  }
  return '';
}

let indexCache = null;
function paginaPrincipal() {
  if (!indexCache || process.env.NODE_ENV !== 'production') {
    const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
    indexCache = html.replace('<script>', '<script>window.TIMON_SERVIDOR = true;</script>\n<script>');
  }
  return indexCache;
}

/* ---------- API ---------- */
async function api(req, res, url) {
  const ruta = url.pathname.replace(/\/+$/, '');
  const metodo = req.method;
  // Las escrituras exigen el encabezado X-Timon (un formulario de otro sitio no puede enviarlo).
  if (metodo !== 'GET' && req.headers['x-timon'] !== '1') return error(res, 403, 'Solicitud rechazada.');

  if (ruta === '/api/login' && metodo === 'POST') {
    const b = await leerCuerpo(req);
    const email = String(b.email || '').trim().toLowerCase();
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (bloqueado(`ip:${ip}`) || bloqueado(`em:${email}`)) return error(res, 429, 'Demasiados intentos. Probá de nuevo en 15 minutos.');
    const u = db.usuarios.find((x) => x.email === email && x.activo !== false);
    if (!u || !claveOk(u, b.password || '')) { fallo(`ip:${ip}`); fallo(`em:${email}`); return error(res, 401, 'Correo o contraseña incorrectos.'); }
    intentos.delete(`em:${email}`);
    const token = crearSesion(u.id);
    return enviar(res, 200, { usuario: usuarioPublico(u), empresas: empresasDe(u) }, { 'Set-Cookie': cookieSesion(req, token, SESSION_DAYS * 86400) });
  }
  if (ruta === '/api/logout' && metodo === 'POST') {
    const t = leerCookie(req, 'timon_sid');
    if (t) { delete db.sesiones[sha(t)]; guardarDB(); }
    return enviar(res, 200, { ok: true }, { 'Set-Cookie': cookieSesion(req, '', 0) });
  }

  const u = usuarioDe(req);
  if (!u) return error(res, 401, 'Tenés que ingresar.');

  if (ruta === '/api/sesion' && metodo === 'GET') return enviar(res, 200, { usuario: usuarioPublico(u), empresas: empresasDe(u) });
  if (ruta === '/api/clave' && metodo === 'POST') {
    const b = await leerCuerpo(req);
    if (!claveOk(u, b.actual || '')) return error(res, 400, 'La contraseña actual no es correcta.');
    if (String(b.nueva || '').length < 8) return error(res, 400, 'La contraseña nueva tiene que tener 8 caracteres o más.');
    Object.assign(u, hashClave(b.nueva));
    const actual = sha(leerCookie(req, 'timon_sid'));
    for (const [k, s] of Object.entries(db.sesiones)) if (s.userId === u.id && k !== actual) delete db.sesiones[k];
    guardarDB();
    return enviar(res, 200, { ok: true });
  }

  // Empresas
  // Cambiar el nombre de una empresa (solo administradores). Actualiza también el nombre dentro de sus datos.
  let m = /^\/api\/empresas\/([\w-]+)\/nombre$/.exec(ruta);
  if (m && metodo === 'PUT') {
    if (!u.admin) return error(res, 403, 'Solo un administrador puede cambiar el nombre de una empresa.');
    const emp = db.empresas.find((e) => e.id === m[1]);
    if (!emp) return error(res, 404, 'Empresa no encontrada.');
    const b = await leerCuerpo(req);
    const nombre = String(b.nombre || '').trim().slice(0, 120);
    if (!nombre) return error(res, 400, 'Escribí el nombre de la empresa.');
    emp.nombre = nombre;
    guardarDB();
    const reg = leerEmpresa(emp.id);
    if (reg.datos && reg.datos.empresa) {
      reg.datos.empresa.nombre = nombre;
      Object.assign(reg, { version: reg.version + 1, actualizado: new Date().toISOString(), actualizadoPor: u.nombre || u.email });
      guardarEmpresa(emp.id, reg);
    }
    return enviar(res, 200, { id: emp.id, nombre, version: reg.version });
  }

  // Respaldo total (solo administradores): todas las empresas con sus datos, usuarios (contraseñas cifradas) y permisos.
  if (ruta === '/api/respaldo' && metodo === 'GET') {
    if (!u.admin) return error(res, 403, 'Solo un administrador puede descargar el respaldo total.');
    return enviar(res, 200, respaldoTotal(), { 'Content-Disposition': `attachment; filename="timon-respaldo-total-${new Date().toISOString().slice(0, 10)}.json"` });
  }
  if (ruta === '/api/respaldo' && metodo === 'POST') {
    if (!u.admin) return error(res, 403, 'Solo un administrador puede restaurar el respaldo total.');
    const b = await leerCuerpo(req);
    const v = validarRespaldo(b);
    if (v) return error(res, 400, v);
    // Copia de seguridad de lo que hay antes de reemplazarlo.
    escribirAtomico(path.join(BAK_DIR, `antes-de-restaurar-${Date.now()}.json`), JSON.stringify(respaldoTotal()));
    const ahora = new Date().toISOString();
    const nuevasIds = new Set(b.empresas.map((e) => e.id));
    for (const e of db.empresas) if (!nuevasIds.has(e.id)) { try { fs.renameSync(empFile(e.id), path.join(BAK_DIR, `${e.id}-reemplazada-${Date.now()}.json`)); } catch (err) { /* sin datos */ } }
    db.empresas = b.empresas.map((e) => ({ id: e.id, nombre: String(e.nombre).slice(0, 120), creado: e.creado || ahora }));
    for (const e of b.empresas) {
      const actual = leerEmpresa(e.id);
      // La versión siempre sube: así las pantallas abiertas detectan el cambio y recargan.
      guardarEmpresa(e.id, { version: Math.max(Number(e.version) || 0, actual.version) + 1, actualizado: ahora, actualizadoPor: `Restaurado por ${u.nombre || u.email}`, datos: e.datos || null });
    }
    db.usuarios = b.usuarios.map((x) => ({ id: x.id, email: String(x.email).trim().toLowerCase(), nombre: x.nombre || x.email, salt: x.salt, hash: x.hash, admin: !!x.admin, activo: x.activo !== false, creado: x.creado || ahora }));
    db.permisos = b.permisos.filter((p) => ROLES.includes(p.rol) && nuevasIds.has(p.empresaId) && db.usuarios.some((x) => x.id === p.userId)).map((p) => ({ userId: p.userId, empresaId: p.empresaId, rol: p.rol }));
    for (const [k, ses] of Object.entries(db.sesiones)) if (!db.usuarios.some((x) => x.id === ses.userId && x.activo)) delete db.sesiones[k];
    guardarDB();
    const sigue = db.usuarios.some((x) => x.id === u.id && x.activo);
    return enviar(res, 200, { ok: true, empresas: db.empresas.length, usuarios: db.usuarios.length, reingresar: !sigue });
  }

  m = /^\/api\/empresas\/([\w-]+)(\/version)?$/.exec(ruta);
  if (m) {
    const id = m[1];
    const emp = db.empresas.find((e) => e.id === id);
    const rol = emp ? rolEn(u, id) : null;
    if (!emp || !rol) return error(res, 404, 'Empresa no encontrada.');
    const reg = leerEmpresa(id);
    if (m[2] && metodo === 'GET') return enviar(res, 200, { version: reg.version, actualizado: reg.actualizado, actualizadoPor: reg.actualizadoPor });
    if (metodo === 'GET') return enviar(res, 200, { ...reg, rol });
    if (metodo === 'PUT') {
      if (rol === 'lector') return error(res, 403, 'Tu usuario es de solo lectura en esta empresa.');
      const b = await leerCuerpo(req);
      if (!b.datos || typeof b.datos !== 'object' || !b.datos.empresa) return error(res, 400, 'Datos inválidos.');
      if (Number(b.version) !== reg.version) return enviar(res, 409, { error: 'Otra persona guardó cambios antes.', version: reg.version, actualizado: reg.actualizado, actualizadoPor: reg.actualizadoPor });
      const nuevo = { version: reg.version + 1, actualizado: new Date().toISOString(), actualizadoPor: u.nombre || u.email, datos: b.datos };
      guardarEmpresa(id, nuevo);
      const nombre = String(b.datos.empresa.nombre || '').trim();
      if (nombre && nombre !== emp.nombre) { emp.nombre = nombre.slice(0, 120); guardarDB(); }
      return enviar(res, 200, { version: nuevo.version, actualizado: nuevo.actualizado, actualizadoPor: nuevo.actualizadoPor });
    }
    if (metodo === 'DELETE') {
      if (!u.admin) return error(res, 403, 'Solo un administrador puede eliminar empresas.');
      db.empresas = db.empresas.filter((e) => e.id !== id);
      db.permisos = db.permisos.filter((p) => p.empresaId !== id);
      guardarDB();
      try { fs.renameSync(empFile(id), path.join(BAK_DIR, `${id}-eliminada-${Date.now()}.json`)); } catch (e) { /* sin datos */ }
      return enviar(res, 200, { ok: true });
    }
  }
  if (ruta === '/api/empresas' && metodo === 'POST') {
    if (!u.admin) return error(res, 403, 'Solo un administrador puede crear empresas.');
    const b = await leerCuerpo(req);
    const nombre = String(b.nombre || '').trim().slice(0, 120);
    if (!nombre) return error(res, 400, 'Escribí el nombre de la empresa.');
    const emp = { id: nuevoId('e'), nombre, creado: new Date().toISOString() };
    db.empresas.push(emp);
    guardarDB();
    if (b.datos && typeof b.datos === 'object') guardarEmpresa(emp.id, { version: 1, actualizado: emp.creado, actualizadoPor: u.nombre || u.email, datos: b.datos });
    return enviar(res, 201, { id: emp.id, nombre: emp.nombre, rol: 'admin' });
  }

  // Usuarios (solo administradores)
  if (ruta.startsWith('/api/usuarios')) {
    if (!u.admin) return error(res, 403, 'Solo un administrador puede gestionar usuarios.');
    const lista = () => db.usuarios.map((x) => ({ ...usuarioPublico(x), permisos: db.permisos.filter((p) => p.userId === x.id).map((p) => ({ empresaId: p.empresaId, rol: p.rol })) }));
    const aplicarPermisos = (userId, permisos) => {
      if (!Array.isArray(permisos)) return;
      db.permisos = db.permisos.filter((p) => p.userId !== userId);
      for (const p of permisos) if (ROLES.includes(p.rol) && db.empresas.some((e) => e.id === p.empresaId)) db.permisos.push({ userId, empresaId: p.empresaId, rol: p.rol });
    };
    if (ruta === '/api/usuarios' && metodo === 'GET') return enviar(res, 200, { usuarios: lista(), empresas: db.empresas.map((e) => ({ id: e.id, nombre: e.nombre })) });
    if (ruta === '/api/usuarios' && metodo === 'POST') {
      const b = await leerCuerpo(req);
      const email = String(b.email || '').trim().toLowerCase();
      if (!emailValido(email)) return error(res, 400, 'Correo inválido.');
      if (db.usuarios.some((x) => x.email === email)) return error(res, 400, 'Ya existe un usuario con ese correo.');
      if (String(b.password || '').length < 8) return error(res, 400, 'La contraseña tiene que tener 8 caracteres o más.');
      const nu = { id: nuevoId('u'), email, nombre: String(b.nombre || '').trim().slice(0, 80) || email, ...hashClave(b.password), admin: !!b.admin, activo: true, creado: new Date().toISOString() };
      db.usuarios.push(nu);
      aplicarPermisos(nu.id, b.permisos);
      guardarDB();
      return enviar(res, 201, { usuarios: lista() });
    }
    m = /^\/api\/usuarios\/([\w-]+)$/.exec(ruta);
    const x = m && db.usuarios.find((y) => y.id === m[1]);
    if (!x) return error(res, 404, 'Usuario no encontrado.');
    if (metodo === 'PUT') {
      const b = await leerCuerpo(req);
      if (x.id === u.id && (b.admin === false || b.activo === false)) return error(res, 400, 'No podés quitarte el acceso de administrador a vos mismo.');
      if (b.email != null) {
        const email = String(b.email).trim().toLowerCase();
        if (!emailValido(email)) return error(res, 400, 'Correo inválido.');
        if (db.usuarios.some((y) => y.id !== x.id && y.email === email)) return error(res, 400, 'Ya existe otro usuario con ese correo.');
        x.email = email;
      }
      if (b.nombre != null) x.nombre = String(b.nombre).trim().slice(0, 80) || x.email;
      if (b.admin != null) x.admin = !!b.admin;
      if (b.activo != null) { x.activo = !!b.activo; if (!x.activo) for (const [k, s] of Object.entries(db.sesiones)) if (s.userId === x.id) delete db.sesiones[k]; }
      if (b.password) {
        if (String(b.password).length < 8) return error(res, 400, 'La contraseña tiene que tener 8 caracteres o más.');
        Object.assign(x, hashClave(b.password));
        for (const [k, s] of Object.entries(db.sesiones)) if (s.userId === x.id && x.id !== u.id) delete db.sesiones[k];
      }
      aplicarPermisos(x.id, b.permisos);
      guardarDB();
      return enviar(res, 200, { usuarios: lista() });
    }
    if (metodo === 'DELETE') {
      if (x.id === u.id) return error(res, 400, 'No podés eliminar tu propio usuario.');
      db.usuarios = db.usuarios.filter((y) => y.id !== x.id);
      db.permisos = db.permisos.filter((p) => p.userId !== x.id);
      for (const [k, s] of Object.entries(db.sesiones)) if (s.userId === x.id) delete db.sesiones[k];
      guardarDB();
      return enviar(res, 200, { usuarios: lista() });
    }
  }
  return error(res, 404, 'No encontrado.');
}

/* ---------- servidor ---------- */
const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { res.writeHead(400); res.end(); return; }
  try {
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (url.pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SEGURIDAD });
      res.end(req.method === 'HEAD' ? undefined : paginaPrincipal());
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEGURIDAD });
    res.end('No encontrado');
  } catch (e) {
    if (e.status) return error(res, e.status, e.message);
    console.error(e);
    if (!res.headersSent) error(res, 500, 'Error interno del servidor.');
  }
});
server.listen(PORT, () => console.log(`Timón escuchando en el puerto ${PORT} · datos en ${DATA_DIR}`));
