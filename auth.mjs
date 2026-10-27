import { randomBytes, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const derive = promisify(scrypt);
const reject = (message, status = 400) => { const e = new Error(message); e.status = status; throw e; };
const fingerprint = value => createHash('sha256').update(value).digest('hex');
const sessionAge = 7 * 24 * 60 * 60 * 1000;

export async function createAuth(db, users, env = process.env) {
  const production = env.NODE_ENV === 'production';
  const enabled = env.SKYTILE_AUTH === 'required' || production;
  if (production && env.SKYTILE_AUTH === 'demo') throw new Error('O modo de demonstração não pode ser publicado em produção.');
  let origin = env.SKYTILE_PUBLIC_ORIGIN || '';
  if (origin) {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('SKYTILE_PUBLIC_ORIGIN deve conter somente a origem do site, sem barra final.');
    if (production && parsed.protocol !== 'https:') throw new Error('A publicação exige uma origem HTTPS.');
  } else if (production) throw new Error('Configure SKYTILE_PUBLIC_ORIGIN com o endereço HTTPS da aplicação.');
  if (!enabled) return { enabled: false, origin };
  db.exec(`CREATE TABLE IF NOT EXISTS credentials (user_id TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);`);
  const limits = new Map();
  const passwordHash = async password => {
    if (typeof password !== 'string' || password.length < 12 || password.length > 128) reject('Use uma senha de 12 a 128 caracteres.');
    const salt = randomBytes(16).toString('hex');
    return { salt, digest: (await derive(password, salt, 64)).toString('hex') };
  };
  const setPassword = async (userId, password) => {
    const value = await passwordHash(password);
    db.prepare('INSERT INTO credentials VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET salt=excluded.salt,digest=excluded.digest').run(userId, value.salt, value.digest);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(userId);
  };
  if (!db.prepare('SELECT 1 FROM credentials LIMIT 1').get()) {
    if (!users.some(u => u.id === 'thiago' && u.role === 'admin' && u.active !== false)) throw new Error('O administrador inicial não foi encontrado.');
    if (!env.SKYTILE_BOOTSTRAP_PASSWORD) throw new Error('Defina SKYTILE_BOOTSTRAP_PASSWORD nas configurações seguras da hospedagem para o primeiro acesso.');
    await setPassword('thiago', env.SKYTILE_BOOTSTRAP_PASSWORD);
  }
  const dummySalt = randomBytes(16).toString('hex');
  const dummyDigest = await derive(randomBytes(32).toString('hex'), dummySalt, 64);
  const cookieName = origin.startsWith('https:') ? '__Host-skytile' : 'skytile-session';
  const cookie = (token, maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${origin.startsWith('https:') ? '; Secure' : ''}`;
  const tokenFrom = req => {
    const values = String(req.headers.cookie || '').split(';').map(v => v.trim()).filter(v => v.startsWith(cookieName + '='));
    if (values.length !== 1) return '';
    const value = values[0].slice(cookieName.length + 1);
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  };
  function checkOrigin(req) {
    if (['GET', 'HEAD'].includes(req.method)) return;
    const expected = origin || `http://${req.headers.host}`;
    if (req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site') reject('Abra esta ação pelo endereço da Skytile.', 403);
    if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) reject('Envie os dados em JSON.', 415);
  }
  function account(req, activeUsers) {
    const token = tokenFrom(req);
    if (!token) return null;
    const session = db.prepare('SELECT user_id,expires FROM sessions WHERE token_hash=?').get(fingerprint(token));
    if (!session || session.expires <= Date.now()) return null;
    return activeUsers.find(u => u.id === session.user_id && u.active !== false) || null;
  }
  function throttle(key, max) {
    const time = Date.now();
    for (const [k, value] of limits) if (value.until <= time) limits.delete(k);
    if (!limits.has(key) && limits.size >= 4096) reject('Muitas tentativas de acesso. Aguarde alguns minutos.', 429);
    const value = limits.get(key) || { count: 0, until: time + 15 * 60 * 1000 };
    if (value.count >= max) reject('Muitas tentativas de acesso. Aguarde 15 minutos.', 429);
    value.count++; limits.set(key, value);
  }
  return {
    enabled, origin, checkOrigin, account, setPassword,
    async login(req, res, input, activeUsers) {
      const login = typeof input.login === 'string' ? input.login.trim().toLowerCase().slice(0, 120) : '';
      // Only the socket address is trusted. Forwarded IP headers can be forged.
      throttle('ip:' + req.socket.remoteAddress, 50);
      throttle('login:' + login, 10);
      const user = activeUsers.find(u => u.active !== false && (u.id.toLowerCase() === login || u.code?.toLowerCase() === login));
      const saved = user && db.prepare('SELECT salt,digest FROM credentials WHERE user_id=?').get(user.id);
      const password = typeof input.password === 'string' && input.password.length <= 128 ? input.password : '';
      const value = await derive(password, saved?.salt || dummySalt, 64);
      if (!saved || !timingSafeEqual(value, saved ? Buffer.from(saved.digest, 'hex') : dummyDigest)) reject('ID ou senha inválidos.', 401);
      if (db.prepare('SELECT digest FROM credentials WHERE user_id=?').get(user.id)?.digest !== saved.digest) reject('A senha foi alterada. Entre novamente.', 401);
      limits.delete('login:' + login);
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
      const token = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(fingerprint(token), user.id, Date.now() + sessionAge);
      res.setHeader('Set-Cookie', cookie(token, sessionAge / 1000));
      return { ok: true, userId: user.id };
    },
    logout(req, res) {
      db.prepare('DELETE FROM sessions WHERE token_hash=?').run(fingerprint(tokenFrom(req)));
      res.setHeader('Set-Cookie', cookie('', 0));
    },
  };
}
