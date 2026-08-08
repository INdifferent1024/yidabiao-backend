# 易达标 App 免费后端

Cloudflare Workers + KV 实现的免费后端，用于：

- 账号注册 / 登录（PBKDF2 密码哈希 + Bearer Token）
- 用户资料存储（头像 URL、姓名、学号、年级）
- 在线问诊（学生提交症状 → 校医可见）
- 校医一对一沟通

## 本地开发

```bash
npm install -g wrangler
wrangler login
```

## 创建 KV 命名空间并部署

```bash
# 1. 创建 KV 命名空间（免费额度：每天 10 万次读取、1000 次写入）
wrangler kv namespace create YDB

# 2. 把输出里的 id 填到 wrangler.toml 的 [[kv_namespaces]] id

# 3. 部署
wrangler deploy
```

部署后 Worker 地址形如 `https://yidabiao-backend.你的子域.workers.dev`。

## 管理账号（校医）

用 wrangler CLI 直接写入 KV 创建校医账号（需要为校医设置 `doctor: true`）：

```bash
wrangler kv key put users:doctor1 --namespace-id <YDB_ID> --path user-doctor.json
```

`user-doctor.json` 示例：

```json
{
  "id": "doc01",
  "username": "doctor1",
  "name": "校医李老师",
  "grade": "",
  "avatar": "",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "salt": "16位随机十六进制盐",
  "hash": "PBKDF2-SHA256 哈希（可用后端 /api/register 先注册再改 role）"
}
```

> 简便方法：先用 `/api/register` 注册一个普通账号，再用 KV 改 `users:<username>` 加 `"doctor": true`。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/register | 注册 `{username, password, name, grade}` |
| POST | /api/login | 登录 → `{token, user}` |
| GET | /api/me | 获取当前用户（Bearer Token） |
| PUT | /api/me | 更新 `{name, studentId, grade, avatar}` |
| POST | /api/consult | 提交问诊 `{content}` |
| GET | /api/consult | 拉取问诊列表 |
| POST | /api/messages | 发私信 `{to, content}` |
| GET | /api/messages?with=xx | 拉取与某人的私信 |
| GET | /api/doctors | 校医列表 |

## 前端接入

App 端把 `worker.js` 部署后的地址配置在代码里，如：

```js
const API_BASE = 'https://yidabiao-backend.<你的子域>.workers.dev';
```

免费额度：每天 10 万请求 / 1000 KV 写入，个人使用完全足够。
