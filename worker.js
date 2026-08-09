/**
 * 鏄撹揪鏍?App 鍏嶈垂鍚庣 (Cloudflare Workers)
 * 鍔熻兘锛氳处鍙锋敞鍐?鐧诲綍銆佺敤鎴疯祫鏂?澶村儚/濮撳悕/骞寸骇)銆佸湪绾块棶璇婃秷鎭€佹牎鍖绘矡閫? * 瀛樺偍锛歐orkers KV
 *
 * 閮ㄧ讲锛歸rangler deploy
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
      } else if (route === '/' || route === '') {
        res = { body: '<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>鏄撹揪鏍囧悗绔湇鍔?/title></head><body style="font-family:sans-serif;text-align:center;padding:40px 16px;color:#333"><h1>鏄撹揪鏍?鍚庣鏈嶅姟</h1><p style="color:#666">鏈嶅姟杩愯涓紝璇峰湪銆屾槗杈炬爣銆岮pp 鍐呯櫥褰?娉ㄥ唽銆?/p><p style="color:#999;font-size:13px">鎺ュ彛鍓嶇紑锛?api/register 路 /api/login 路 /api/me 路 /api/consult 路 /api/messages 路 /api/doctors</p></body></html>', status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
      } else {
        res = json({ error: 'not found' }, 404);
      }
      const bodyStr = typeof res.body === 'string' ? res.body : JSON.stringify(res.body);
      const contentType = (res.headers && res.headers['Content-Type']) || 'application/json';
      return new Response(bodyStr, { status: res.status, headers: { ...corsHeaders, 'Content-Type': contentType } });
    } catch (e) {
      return new Response(JSON.stringify({ error: 'server error: ' + e.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }
};

function json(body, status = 200) { return { body, status }; }

/** 瀵嗙爜鍝堝笇锛歅BKDF2-SHA256 + 闅忔満鐩?*/
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

/** @returns user 瀵硅薄鎴?null */
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
  try { body = await request.json(); } catch (e) { return json({ error: '璇锋眰鏍煎紡閿欒' }, 400); }
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const name = String(body.name || '').trim();
  const grade = String(body.grade || '').trim();
  if (!username || !password) return json({ error: '鐢ㄦ埛鍚嶅拰瀵嗙爜涓嶈兘涓虹┖' }, 400);
  if (username.length < 2 || username.length > 20) return json({ error: '鐢ㄦ埛鍚嶉暱搴﹂渶 2~20 涓瓧绗? }, 400);
  if (password.length < 6) return json({ error: '瀵嗙爜鑷冲皯 6 浣? }, 400);
  if (await findUser(env, username)) return json({ error: '璇ョ敤鎴峰悕宸茶娉ㄥ唽' }, 409);

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
  const key = 'user:' + user.username;
  await env.YDB.put(key, JSON.stringify({ ...user, salt, hash: pwdHash }));
  return json({ ok: true, user: publicUser(user) });
}

async function login(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '璇锋眰鏍煎紡閿欒' }, 400); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  const user = await findUser(env, username);
  if (!user) return json({ error: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒' }, 401);
  const h = await hashPassword(password, user.salt);
  if (h !== user.hash) return json({ error: '鐢ㄦ埛鍚嶆垨瀵嗙爜閿欒' }, 401);

  const token = randHex(32);
  await env.YDB.put('token:' + token, JSON.stringify({ username: user.username, expires: Date.now() + 7 * 24 * 3600 * 1000 }), { expirationTtl: 7 * 24 * 3600 });
  return json({ ok: true, token, user: publicUser(user) });
}

async function getMe(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
  return json({ ok: true, user: publicUser(user) });
}

async function updateMe(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '璇锋眰鏍煎紡閿欒' }, 400); }
  if (body.name !== undefined) user.name = String(body.name).trim() || user.name;
  if (body.studentId !== undefined) user.studentId = String(body.studentId).trim();
  if (body.grade !== undefined) user.grade = String(body.grade).trim();
  if (body.avatar !== undefined) {
    const av = String(body.avatar || '');
    // 澶村儚浠呭厑璁?http(s) URL锛堥伩鍏嶉潪娉曟暟鎹紱鍥剧墖鏈韩鍙瓨 KV 鎴栧閮ㄥ浘搴婏級
    if (av && !/^https?:\/\//.test(av)) return json({ error: '澶村儚蹇呴』鏄?URL' }, 400);
    user.avatar = av;
  }
  const raw = await env.YDB.get('user:' + user.username);
  const stored = JSON.parse(raw);
  await env.YDB.put('user:' + user.username, JSON.stringify({ ...stored, name: user.name, studentId: user.studentId, grade: user.grade, avatar: user.avatar }));
  return json({ ok: true, user: publicUser(user) });
}

/** 鍦ㄧ嚎闂瘖锛氭彁浜ょ棁鐘舵弿杩帮紙杩涘叆鏍″尰鍙鐨勫挩璇㈠垪琛級 */
async function sendConsult(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '璇锋眰鏍煎紡閿欒' }, 400); }
  const content = String(body.content || '').trim();
  if (!content) return json({ error: '闂瘖鍐呭涓嶈兘涓虹┖' }, 400);
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

/** 鎷夊彇闂瘖璁板綍锛氳嚜宸辩殑鍏ㄩ儴 + 鏍″尰瀵瑰畠鐨勫洖澶嶏紙绠€鍖栵細鍏紑鍒楄〃妯″紡锛?*/
async function getConsults(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
  const listRaw = await env.YDB.get('consults');
  const list = listRaw ? JSON.parse(listRaw) : [];
  // 瀛︾敓鐪嬭嚜宸辩殑锛涙牎鍖?role=doctor)鐪嬪叏閮紙doctor 璐﹀彿鐢辩鐞嗗悗鍙伴璁撅紝瑙?README锛?  let mine;
  if (user.doctor) mine = list;
  else mine = list.filter(m => m.from === user.username);
  return json({ ok: true, consults: mine.slice(0, 50) });
}

/** 涓€瀵逛竴鑱婂ぉ锛氬彂缁欐寚瀹氭牎鍖绘垨瀛︾敓 */
async function sendMessage(request, env) {
  const user = await getUserByToken(env, request);
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '璇锋眰鏍煎紡閿欒' }, 400); }
  const to = String(body.to || '').trim().toLowerCase();
  const content = String(body.content || '').trim();
  if (!to || !content) return json({ error: '缂哄皯鎺ユ敹浜烘垨鍐呭' }, 400);
  const theOther = await findUser(env, to);
  if (!theOther) return json({ error: '鎺ユ敹浜轰笉瀛樺湪' }, 404);
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
  if (!user) return json({ error: '鏈櫥褰曟垨鐧诲綍宸茶繃鏈? }, 401);
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