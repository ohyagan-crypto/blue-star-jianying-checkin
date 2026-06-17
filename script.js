const API_BASE = String(window.JY_API_BASE || "").replace(/\/$/, "");

const state = {
  roster: null,
  keyword: ""
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

async function postJson(path, payload) {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "送出失敗，請稍後再試");
  return data;
}

async function loadRoster() {
  const res = await fetch(api("/api/roster"), { cache: "no-store" });
  if (!res.ok) throw new Error("名單讀取失敗");
  state.roster = await res.json();
  renderRoster();
}

function renderRoster() {
  const data = state.roster;
  if (!data) return;
  document.getElementById("registeredCount").textContent = data.registeredCount;
  document.getElementById("remainingCount").textContent = data.remainingCount;
  document.getElementById("checkedInCount").textContent = data.checkedInCount;
  document.getElementById("exportLink").href = api("/api/export.csv");

  const keyword = state.keyword.trim();
  const rows = data.registrations.filter((item) => !keyword || item.name.includes(keyword));
  const body = document.getElementById("rosterBody");
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="5">目前沒有符合的名單</td></tr>`;
    return;
  }
  body.innerHTML = rows.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.phoneLast3 || "")}</td>
      <td><span class="pill ${item.checkedIn ? "done" : ""}">${item.checkedIn ? "已簽到" : "已報名"}</span></td>
      <td>${fmtTime(item.createdAt)}</td>
    </tr>
  `).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[char]));
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
    state.roster = data.roster || state.roster;
    if (state.roster) renderRoster();
    await loadRoster();
  } catch (error) {
    setMessage("registerMessage", error.message, false);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("checkinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true;
  setMessage("checkinMessage", "簽到中...");
  try {
    const data = await postJson("/api/checkin", formData(event.currentTarget));
    setMessage("checkinMessage", data.message || "簽到完成");
    event.currentTarget.reset();
    state.roster = data.roster || state.roster;
    if (state.roster) renderRoster();
    await loadRoster();
  } catch (error) {
    setMessage("checkinMessage", error.message, false);
  } finally {
    button.disabled = false;
  }
});

document.getElementById("searchInput").addEventListener("input", (event) => {
  state.keyword = event.target.value;
  renderRoster();
});

loadRoster().catch((error) => {
  document.getElementById("rosterBody").innerHTML = `<tr><td colspan="5">名單暫時無法讀取，請稍後重新整理</td></tr>`;
  setMessage("registerMessage", error.message, false);
});

setInterval(() => loadRoster().catch(() => {}), 15000);
