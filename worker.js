/**
 * 易达标 App 免费后端 (Cloudflare Workers)
 * 功能：账号注册/登录、用户资料(头像/姓名/年级)、在线问诊消息、校医沟通
 * 存储：Workers KV
 *
 * 部署：wrangler deploy
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }
    try {
      const route = url.pathname;
      let res;
      if (route === '/api/register' && request.method === 'POST') {
        res = await register(request, env);
      } else if (route === '/api/login' && request.method === 'POST') {
        res = await login(request, env);
      } else if (route === '/api/me' && request.method === 'GET') {
        res = await getMe(request, env);
      } else if (route === '/api/me' && request.method === 'PUT') {
        res = await updateMe(request, env);
      } else if (route === '/api/consult' && request.method === 'POST') {
        res = await sendConsult(request, env);
      } else if (route === '/api/consult' && request.method === 'GET') {
        res = await getConsults(request, env);
      } else if (route === '/api/messages' && request.method === 'POST') {
        res = await sendMessage(request, env);
      } else if (route === '/api/messages' && request.method === 'GET') {
        res = await getMessages(request, env);
      } else if (route === '/api/doctors' && request.method === 'GET') {
        res = await getDoctors(env);
      } else {
        res = json({ error: 'not found' }, 404);
      }
      return new Response(JSON.stringify(res.body), { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'server error: ' + e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};

function json(body, status = 200) { return { body, status }; }

/** 密码哈希：PBKDF2-SHA256 + 随机盐 */
async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 60000, hash: 'SHA-256' },
    key, 256
  );
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function randHex(len) {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** @returns user 对象或 null */
async function findUser(env, username) {
  const key = 'user:' + String(username || '').toLowerCase().trim();
  const raw = await env.YDB.get(key);
  return raw ? JSON.parse(raw) : null;
}

async function getUserByToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const raw = await env.YDB.get('token:' + token);
  if (!raw) return null;
  const t = JSON.parse(raw);
  if (t.expires < Date.now()) return null;
  return findUser(env, t.username);
}

async function register(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const grade = String(body.grade || '').trim();
  if (!username || !password) return json({ error: '用户名和密码不能为空' }, 400);
  if (username.length < 2 || username.length > 20) return json({ error: '用户名长度需 2~20 个字符' }, 400);
  if (password.length < 6) return json({ error: '密码至少 6 位' }, 400);
  if (await findUser(env, username)) return json({ error: '该用户名已被注册' }, 409);

  const salt = randHex(16);
  const pwdHash = await hashPassword(password, salt);
  const user = {
    id: randHex(8),
    username: username.toLowerCase(),
    name: name || username,
    grade,
    avatar: '',
    createdAt: new Date().toISOString()
  };
  const key = 'users:' + user.username;
  await env.YDB.put(key, JSON.stringify({ ...user, salt, hash: pwdHash }), { expirationTtl: 0 });
  return json({ ok: true, user: publicUser(user) });
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await findUser(env, username);
  if (!user) return json({ error: '用户名或密码错误' }, 401);
  const h = await hashPassword(password, user.salt);
  if (h !== user.hash) return json({ error: '用户名或密码错误' }, 401);

  const token = randHex(32);
  await env.YDB.put('token:' + token, JSON.stringify({ username: user.username, expires: Date.now() + 7 * 24 * 3600 * 1000 }), { expirationTtl: 7 * 24 * 3600 });
  return json({ ok: true, token, user: publicUser(user) });
}

async function getMe(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  return json({ ok: true, user: publicUser(user) });
}

async function updateMe(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  if (body.name !== undefined) user.name = String(body.name).trim() || user.name;
  if (body.studentId !== undefined) user.studentId = String(body.studentId).trim();
  if (body.grade !== undefined) user.grade = String(body.grade).trim();
  if (body.avatar !== undefined) {
    const av = String(body.avatar || '');
    // 头像仅允许 http(s) URL（避免非法数据；图片本身可存 KV 或外部图床）
    if (av && !/^https?:\/\//.test(av)) return json({ error: '头像必须是 URL' }, 400);
    user.avatar = av;
  }
  const raw = await env.YDB.get('users:' + user.username);
  const stored = JSON.parse(raw);
  await env.YDB.put('users:' + user.username, JSON.stringify({ ...stored, name: user.name, studentId: user.studentId, grade: user.grade, avatar: user.avatar }));
  return json({ ok: true, user: publicUser(user) });
}

/** 在线问诊：提交症状描述（进入校医可见的咨询列表） */
async function sendConsult(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  const content = String(body.content || '').trim();
  if (!content) return json({ error: '问诊内容不能为空' }, 400);
  const id = Date.now().toString(36) + randHex(4);
  const msg = {
    id,
    from: user.username,
    fromName: user.name,
    content,
    ts: new Date().toISOString()
  };
  const listKey = 'consults';
  const listRaw = await env.YDB.get(listKey);
  const list = listRaw ? JSON.parse(listRaw) : [];
  list.push(msg);
  await env.YDB.put(listKey, JSON.stringify(list.slice(-200)));
  return json({ ok: true, msg });
}

/** 拉取问诊记录：自己的全部 + 校医对它的回复（简化：公开列表模式） */
async function getConsults(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  const listRaw = await env.YDB.get('awaiting');
  const list = listRaw ? JSON.parse(listRaw) : [];
  // 学生看自己的；校医(role=doctor)看全部（doctor 账号由管理后台预设，见 README）
  let mine;
  if (user.doctor) mine = list;
  else mine = list.filter(m => m.from === user.username);
  return json({ ok: true, consults: mine.slice(0, 50) });
}

/** 一对一聊天：发给指定校医或学生 */
async function sendMessage(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '请求格式错误' }, 400); }
  const to = String(body.to || '').trim().toLowerCase();
  const content = String(body.content || '').trim();
  if (!to || !content) return json({ error: '缺少接收人或内容' }, 400);
  const theOther = await findUser(env, to);
  if (!theOther) return json({ error: '接收人不存在' }, 404);
  const pair = [user.username, to].sort().join('|');
  const msg = { id: Date.now().toString(36) + randHex(4), from: user.username, to, content, ts: new Date().toISOString() };
  const key = 'chat:' + pair;
  const raw = await env.YDB.get(key);
  const arr = raw ? JSON.parse(raw) : [];
  arr.push(msg);
  await env.YDB.put(key, JSON.stringify(arr.slice(-200)));
  return json({ ok: true, msg });
}

async function getMessages(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '未登录或登录已过期' }, 401);
  const withWho = new URL(request.url).searchParams.get('with') || request.headers.get('X-Chat-With');
  if (!withWho) return json({ ok: true, messages: [] });
  const pair = [user.username, String(withWho).toLowerCase()].sort().join('|');
  const raw = await env.YDB.get('chat:' + pair);
  return json({ ok: true, messages: raw ? JSON.parse(raw) : [] });
}

async function getDoctors(env) {
  const listRaw = await env.YDB.get('doctors');
  const list = listRaw ? JSON.parse(listRaw) : [];
  return json({ ok: true, doctors: list });
}

function publicUser(u) {
  return { id: u.id, username: u.username, name: u.name, studentId: u.studentId, grade: u.grade, avatar: u.avatar, doctor: !!u.doctor };
}