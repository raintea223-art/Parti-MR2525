const { randomBytes, scryptSync, timingSafeEqual, createHmac } = require("crypto");

const SESSION_COOKIE = "tpl_session";
const SESSION_DAYS = 7;

const ROLES = {
  admin: {
    label: "管理员",
    canManagePrices: true,
    canManageUsers: true,
    canWrite: true,
    canExport: true
  },
  editor: {
    label: "编辑",
    canManagePrices: false,
    canManageUsers: false,
    canWrite: true,
    canExport: true
  },
  viewer: {
    label: "只读",
    canManagePrices: false,
    canManageUsers: false,
    canWrite: false,
    canExport: false
  }
};

function getSessionSecret() {
  return process.env.SESSION_SECRET || "mr2525-dev-secret-change-me";
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !password) return false;
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const test = scryptSync(password, salt, 64).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(test, "hex"));
  } catch {
    return false;
  }
}

function signSession(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expected = createHmac("sha256", getSessionSecret()).update(body).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.uid || !payload?.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function createSessionToken(userId) {
  return signSession({
    uid: userId,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000
  });
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function initUsersSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'editor' CHECK(role IN ('admin', 'editor', 'viewer')),
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function seedAdminUser(db) {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD || "admin123456";
  db.prepare(
    `INSERT INTO users (username, password_hash, display_name, role, enabled)
     VALUES (?, ?, ?, 'admin', 1)`
  ).run(username, hashPassword(password), "管理员");

  console.log(`[auth] 已创建初始管理员账号: ${username}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.log("[auth] 默认密码: admin123456 — 请尽快在「用户管理」中修改");
  }
}

function mapUser(row) {
  if (!row) return null;
  const role = ROLES[row.role] ? row.role : "viewer";
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name || row.username,
    role,
    roleLabel: ROLES[role].label,
    enabled: row.enabled !== 0,
    permissions: ROLES[role],
    created_at: row.created_at
  };
}

function getUserById(db, id) {
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ? AND enabled = 1").get(id));
}

function getUserByUsername(db, username) {
  return db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE").get(username);
}

function listUsers(db) {
  return db
    .prepare("SELECT * FROM users ORDER BY role ASC, username ASC")
    .all()
    .map((row) => mapUser(row));
}

function createUser(db, { username, password, display_name, role }) {
  if (!ROLES[role]) throw new Error("无效角色");
  const result = db
    .prepare(
      `INSERT INTO users (username, password_hash, display_name, role, enabled)
       VALUES (?, ?, ?, ?, 1)`
    )
    .run(username.trim(), hashPassword(password), display_name?.trim() || username.trim(), role);
  return getUserById(db, result.lastInsertRowid);
}

function updateUser(db, id, data) {
  const existing = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!existing) return null;

  const sets = ["updated_at = datetime('now')"];
  const values = [];

  if ("display_name" in data) {
    sets.push("display_name = ?");
    values.push(data.display_name?.trim() || existing.username);
  }
  if ("role" in data) {
    if (!ROLES[data.role]) throw new Error("无效角色");
    sets.push("role = ?");
    values.push(data.role);
  }
  if ("enabled" in data) {
    sets.push("enabled = ?");
    values.push(data.enabled ? 1 : 0);
  }
  if ("password" in data && data.password) {
    sets.push("password_hash = ?");
    values.push(hashPassword(data.password));
  }

  values.push(id);
  db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  return mapUser(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function deleteUser(db, id) {
  const admins = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin' AND enabled = 1").get().c;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) return false;
  if (user.role === "admin" && admins <= 1) {
    throw new Error("至少保留一名启用的管理员");
  }
  return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
}

function attachUser(db) {
  return (req, _res, next) => {
    const cookies = parseCookies(req.headers.cookie);
    const payload = verifySession(cookies[SESSION_COOKIE]);
    req.user = payload ? getUserById(db, payload.uid) : null;
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "请先登录" });
  next();
}

function requirePermission(key) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "请先登录" });
    if (!req.user.permissions?.[key]) {
      return res.status(403).json({ error: "当前账号无此操作权限" });
    }
    next();
  };
}

function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

module.exports = {
  SESSION_COOKIE,
  ROLES,
  initUsersSchema,
  seedAdminUser,
  hashPassword,
  verifyPassword,
  createSessionToken,
  attachUser,
  requireAuth,
  requirePermission,
  setSessionCookie,
  clearSessionCookie,
  getUserByUsername,
  getUserById,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  mapUser
};
