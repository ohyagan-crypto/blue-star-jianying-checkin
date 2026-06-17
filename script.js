const API_BASE = String(window.JY_API_BASE || "").replace(/\/$/, "");

const state = {
  roster: null,
  keyword: "",
  session: ""
};

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

function fillSessionControls(sessions) {
  const options = sessions.map((session) => `<option value="${escapeHtml(session)}">${escapeHtml(session)}</option>`).join("");
  document.querySelectorAll('select[name="session"]').forEach((select) => {
    if (!select.options.length) select.innerHTML = options;
  });

  const filter = document.getElementById("sessionFilter");
  if (!filter.options.length) {
    filter.innerHTML = `<option value="">全部場次</option>${options}`;
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
  const capacity = data.capacity || 30;

  document.getElementById("registeredCount").textContent = active.length;
  document.getElementById("remainingCount").textContent = Math.max(0, (data.sessions || []).length * capacity - active.length);
  document.getElementById("exportLink").href = api("/api/export.csv");

  const keyword = state.keyword.trim();
  const rows = active
    .filter((item) => !state.session || item.session === state.session)
    .filter((item) => !keyword || item.name.includes(keyword));

  const body = document.getElementById("rosterBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5">目前沒有符合的名單</td></tr>`;
    return;
  }

  body.innerHTML = rows.map((item, index) => {
    return `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(item.session)}</td>
        <td>${escapeHtml(item.name)}</td>
        <td>${escapeHtml(item.phoneLast3 || "")}</td>
        <td>${fmtTime(item.createdAt)}</td>
      </tr>
    `;
  }).join("");
}

document.getElementById("registerForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  setMessage("registerMessage", "送出中...");
  try {
    const data = await postJson("/api/register", formData(event.currentTarget));
    setMessage("registerMessage", data.message || "報名成功");
    event.currentTarget.reset();
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
  document.getElementById("rosterBody").innerHTML = `<tr><td colspan="5">名單暫時無法讀取，請稍後重新整理</td></tr>`;
  setMessage("registerMessage", error.message, false);
});

setInterval(() => loadRoster().catch(() => {}), 15000);
