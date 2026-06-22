const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dbPath = path.join(dataDir, "db.json");
const port = Number(process.env.PORT || 8097);
const capacity = 30;
const sessions = ["6/24 剪映實戰班", "7/1 剪映實戰班"];
let writeQueue = Promise.resolve();

const initialDb = {
  registrations: [],
  cancellations: []
};

function now() {
  return new Date().toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour12: false
  });
}

function ensureDb() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dbPath)) fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2), "utf8");
}

function readDb() {
  ensureDb();
  try {
    const db = JSON.parse(fs.readFileSync(dbPath, "utf8"));
    return {
      registrations: Array.isArray(db.registrations) ? db.registrations : [],
      cancellations: Array.isArray(db.cancellations) ? db.cancellations : []
    };
  } catch {
    return { ...initialDb };
  }
}

function writeDb(db) {
  ensureDb();
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2), "utf8");
}

function withDbWrite(handler) {
  const task = writeQueue.then(async () => {
    const db = readDb();
    const result = await handler(db);
    writeDb(db);
    return result;
  });
  writeQueue = task.catch(() => {});
  return task;
}

function clean(value) {
  return String(value || "").trim();
}

function normalizeSession(value) {
  const session = clean(value);
  return sessions.includes(session) ? session : "";
}

function isCanceled(reg) {
  return reg.status === "cancelled" || reg.cancelled === true || Boolean(reg.cancelledAt);
}

function publicDb(db) {
  const registrations = db.registrations.filter((item) => sessions.includes(item.session));
  const cancellations = db.cancellations.filter((item) => sessions.includes(item.session));
  const active = registrations.filter((item) => !isCanceled(item));
  return {
    sessions,
    capacity,
    registeredCount: active.length,
    remainingCount: Math.max(0, sessions.length * capacity - active.length),
    registrations,
    cancellations
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function csvEscape(value) {
  const text = String(value || "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function sendCsv(res, filename, rows) {
  const csv = "\uFEFF" + rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  res.end(csv);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function upsertRegistration(db, entry) {
  const existing = db.registrations.find((item) =>
    item.session === entry.session &&
    item.name === entry.name
  );
  if (existing) {
    existing.name = entry.name || existing.name;
    existing.status = "active";
    existing.cancelled = false;
    existing.updatedAt = now();
    delete existing.cancelledAt;
    delete existing.cancelReason;
    return existing;
  }

  const record = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    createdAt: now(),
    status: "active",
    ...entry
  };
  db.registrations.push(record);
  return record;
}

async function handleApi(req, res, pathname) {
  if (req.method === "OPTIONS") return sendJson(res, 200, { ok: true });

  if (req.method === "GET" && pathname === "/api/health") {
    return sendJson(res, 200, { ok: true, service: "jianying-course-site", time: now() });
  }

  if (req.method === "GET" && pathname === "/api/roster") {
    return sendJson(res, 200, publicDb(readDb()));
  }

  if (req.method === "POST" && pathname === "/api/register") {
    const body = await readBody(req);
    const session = normalizeSession(body.session);
    const name = clean(body.name);
    if (!session) return sendJson(res, 400, { success: false, message: "請選擇場次" });
    if (!name) return sendJson(res, 400, { success: false, message: "請輸入姓名" });

    const { record, roster } = await withDbWrite((db) => {
      const activeCount = db.registrations.filter((item) => item.session === session && !isCanceled(item)).length;
      const existing = db.registrations.find((item) =>
        item.session === session &&
        item.name === name
      );
      if (!existing && activeCount >= capacity) {
        const error = new Error("此場次已額滿，請聯絡工作人員");
        error.status = 409;
        throw error;
      }
      const record = upsertRegistration(db, { session, name });
      return { record, roster: publicDb(db) };
    });

    return sendJson(res, 200, {
      success: true,
      message: `${record.name} 已完成 ${record.session} 報名`,
      roster
    });
  }

  if (req.method === "POST" && pathname === "/api/cancel") {
    const body = await readBody(req);
    const session = normalizeSession(body.session);
    const name = clean(body.name);
    const reason = clean(body.reason);
    if (!session) return sendJson(res, 400, { success: false, message: "請選擇場次" });
    if (!name) return sendJson(res, 400, { success: false, message: "請輸入姓名" });

    const roster = await withDbWrite((db) => {
      const registration = db.registrations.find((item) => item.session === session && item.name === name && !isCanceled(item));
      if (!registration) {
        const error = new Error("找不到此報名資料");
        error.status = 404;
        throw error;
      }
      registration.status = "cancelled";
      registration.cancelled = true;
      registration.cancelledAt = now();
      registration.cancelReason = reason;
      db.cancellations.push({
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        createdAt: now(),
        session,
        name,
        reason
      });
      return publicDb(db);
    });

    return sendJson(res, 200, { success: true, message: `${name} 已取消報名`, roster });
  }

  if (req.method === "GET" && pathname === "/api/export.csv") {
    const db = publicDb(readDb());
    const rows = [];
    sessions.forEach((session, sessionIndex) => {
      const sessionRows = db.registrations.filter((reg) => reg.session === session);
      if (sessionIndex > 0) rows.push([]);
      rows.push([session]);
      rows.push(["序號", "場次", "姓名", "狀態", "報名時間"]);

      if (!sessionRows.length) {
        rows.push(["", session, "目前沒有名單", "", ""]);
        return;
      }

      sessionRows.forEach((reg, index) => rows.push([
        index + 1,
        reg.session,
        reg.name,
        isCanceled(reg) ? "已取消" : "有效報名",
        reg.createdAt || ""
      ]));
    });
    return sendCsv(res, "jianying-course-roster.csv", rows);
  }

  return sendJson(res, 404, { success: false, message: "找不到 API" });
}

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname.startsWith("/api/")) {
    try {
      return await handleApi(req, res, url.pathname);
    } catch (error) {
      return sendJson(res, error.status || 500, {
        success: false,
        message: error.message || "系統暫時忙碌，請稍後再試"
      });
    }
  }

  let filePath = path.join(root, decodeURIComponent(url.pathname));
  if (url.pathname === "/" || !path.extname(filePath)) filePath = path.join(root, "index.html");
  if (!filePath.startsWith(root)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`剪映實戰班報名網站已啟動：http://localhost:${port}`);
});
