const API_BASE = String(window.JY_API_BASE || "").replace(/\/$/, "");

const state = {
  roster: null,
  keyword: "",
  session: ""
};

const defaultSessions = ["6/24 剪映實戰班", "7/1 剪映實戰班"];

function api(path) {
  return `${API_BASE}${path}`;
}

function fmtTime(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setMessage(id, text, ok = true) {
  const node = document.getElementById(id);
  node.textContent = text || "";
  node.dataset.ok = ok ? "true" : "false";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
}

function activeRegistrations(data) {
  return (data?.registrations || []).filter((item) => item.status !== "cancelled" && !item.cancelled);
}

function renderSessionStats(sessions, active, capacity) {
  const stats = document.getElementById("sessionStats");
  if (!stats) return;

  stats.innerHTML = sessions.map((session) => {
    const registered = active.filter((item) => item.session === session).length;
    const remaining = Math.max(0, capacity - registered);

    return `
      <article class="session-stat-card">
        <span class="session-stat-title">${escapeHtml(session)}</span>
        <div class="session-stat-values">
          <p>
            <span class="label">已報名人數</span>
            <strong>${registered}</strong>
          </p>
          <p>
            <span class="label">剩餘名額</span>
            <strong>${remaining}</strong>
          </p>
          <p>
            <span class="label">上限</span>
            <strong>每場 ${capacity} 位</strong>
          </p>
        </div>
      </article>
    `;
  }).join("");
}

function fillSessionControls(sessions) {
  const source = Array.isArray(sessions) && sessions.length ? sessions : defaultSessions;
  const options = source.map((session) => `<option value="${escapeHtml(session)}">${escapeHtml(session)}</option>`).join("");

  document.querySelectorAll('select[name="session"]').forEach((select) => {
    if (!select.options.length || select.dataset.fallback === "true") {
      const previous = select.value;
      select.innerHTML = options;
      select.value = source.includes(previous) ? previous : source[0];
      select.dataset.fallback = String(!sessions?.length);
    }
  });

  const filter = document.getElementById("sessionFilter");
  if (!filter.options.length || filter.dataset.fallback === "true") {
    const previous = filter.value;
    filter.innerHTML = `<option value="">全部場次</option>${options}`;
    filter.value = source.includes(previous) ? previous : "";
    filter.dataset.fallback = String(!sessions?.length);
  }
}

async function postJson(path, payload) {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "送出失敗，請稍後再試");
  return data;
}

async function loadRoster() {
  const res = await fetch(api("/api/roster"), { cache: "no-store" });
  if (!res.ok) throw new Error("名單讀取失敗");
  state.roster = await res.json();
  fillSessionControls(state.roster.sessions || []);
  renderRoster();
}

function renderRoster() {
  const data = state.roster;
  if (!data) return;

  const active = activeRegistrations(data);
  const sessions = Array.isArray(data.sessions) && data.sessions.length ? data.sessions : defaultSessions;
  const capacity = data.capacity || 30;

  renderSessionStats(sessions, active, capacity);
  document.getElementById("exportLink").href = api("/api/export.csv");

  const keyword = state.keyword.trim();
  const rows = active
    .filter((item) => !state.session || item.session === state.session)
    .filter((item) => !keyword || item.name.includes(keyword));

  const body = document.getElementById("rosterBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">目前沒有符合的名單</td></tr>`;
    return;
  }

  if (state.session) {
    body.innerHTML = renderRows(rows);
    return;
  }

  body.innerHTML = sessions.map((session) => {
    const sessionRows = rows.filter((item) => item.session === session);
    const list = sessionRows.length
      ? renderRows(sessionRows)
      : `<tr><td colspan="4" class="empty-session">此場次目前沒有符合的名單</td></tr>`;

    return `
      <tr class="session-divider">
        <td colspan="4">${escapeHtml(session)}｜${sessionRows.length} 人</td>
      </tr>
      ${list}
    `;
  }).join("");
}

function renderRows(rows) {
  return rows.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.session)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${fmtTime(item.createdAt)}</td>
    </tr>
  `).join("");
}

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  setMessage("registerMessage", "送出中...");
  try {
    const data = await postJson("/api/register", formData(form));
    setMessage("registerMessage", data.message || "報名成功");
    form.reset();
    await loadRoster();
  } catch (error) {
    setMessage("registerMessage", error.message, false);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("searchInput").addEventListener("input", (event) => {
  state.keyword = event.target.value;
  renderRoster();
});

document.getElementById("sessionFilter").addEventListener("change", (event) => {
  state.session = event.target.value;
  renderRoster();
});

loadRoster().catch((error) => {
  fillSessionControls(defaultSessions);
  document.getElementById("rosterBody").innerHTML = `<tr><td colspan="4">名單暫時無法讀取，請稍後重新整理</td></tr>`;
  setMessage("registerMessage", error.message, false);
});

fillSessionControls(defaultSessions);
setInterval(() => loadRoster().catch(() => {}), 15000);
