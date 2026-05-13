export const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mira Task Agent</title>
  <style>${css()}</style>
</head>
<body>
  <main class="shell">
    <section class="chat">
      <header class="topbar">
        <div>
          <h1>Mira Task Agent</h1>
          <p id="identity">正在读取工作空间...</p>
        </div>
        <button id="refresh" title="刷新工作空间">↻</button>
      </header>
      <div id="messages" class="messages"></div>
      <form id="composer" class="composer">
        <textarea id="input" rows="2" placeholder="用自然语言创建任务、检索文件、发起深度研究..."></textarea>
        <button type="submit">发送</button>
      </form>
    </section>
    <aside class="workspace">
      <section>
        <div class="section-title">
          <h2>任务</h2>
          <span id="task-count">0</span>
        </div>
        <div id="tasks" class="list"></div>
      </section>
      <section>
        <div class="section-title">
          <h2>文件</h2>
          <label class="upload">
            <input id="file" type="file" />
            上传
          </label>
        </div>
        <div id="upload-state" class="hint"></div>
        <div id="files" class="list"></div>
      </section>
      <section>
        <div class="section-title"><h2>快捷研究</h2></div>
        <button class="wide" data-prompt="深度研究：AI Agent 任务管理助手的产品形态、技术架构和差异化机会">生成研究报告</button>
      </section>
    </aside>
  </main>
  <script type="module">${js()}</script>
</body>
</html>`;

function css() {
  return `
*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f6f4ef;color:#1f2428}button,input,textarea{font:inherit}.shell{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr) 360px}.chat{display:grid;grid-template-rows:auto 1fr auto;min-width:0;border-right:1px solid #d9d5c9}.topbar{height:82px;display:flex;align-items:center;justify-content:space-between;padding:0 24px;background:#fffaf0;border-bottom:1px solid #ded8ca}.topbar h1{margin:0;font-size:22px;letter-spacing:0}.topbar p{margin:6px 0 0;color:#62665f;font-size:14px}.topbar button{width:40px;height:40px;border:1px solid #c9c2b3;background:#fff;border-radius:8px;cursor:pointer}.messages{padding:24px;overflow:auto;display:flex;flex-direction:column;gap:14px}.msg{max-width:860px;padding:14px 16px;border-radius:8px;line-height:1.6;white-space:pre-wrap}.msg.user{align-self:flex-end;background:#1f6f68;color:white}.msg.assistant{align-self:flex-start;background:white;border:1px solid #dfdbd0}.composer{display:grid;grid-template-columns:1fr 96px;gap:12px;padding:18px 24px;background:#fff;border-top:1px solid #ded8ca}.composer textarea{resize:none;border:1px solid #c9c2b3;border-radius:8px;padding:12px;line-height:1.5}.composer button,.wide{border:0;border-radius:8px;background:#22272b;color:white;cursor:pointer;font-weight:700}.workspace{padding:20px;background:#fbfaf6;overflow:auto;display:flex;flex-direction:column;gap:22px}.workspace section{border-bottom:1px solid #dfdbd0;padding-bottom:18px}.section-title{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.section-title h2{font-size:15px;margin:0;color:#333}.section-title span,.hint{font-size:12px;color:#74776f}.upload{border:1px solid #bcb6a9;background:white;border-radius:8px;padding:7px 10px;cursor:pointer}.upload input{display:none}.list{display:flex;flex-direction:column;gap:8px}.item{background:white;border:1px solid #e0ddd4;border-radius:8px;padding:10px}.item strong{display:block;font-size:14px}.item p{margin:6px 0 0;color:#62665f;font-size:12px;line-height:1.45}.badge{display:inline-block;padding:2px 7px;border-radius:999px;background:#e9f0ec;color:#24534d;font-size:11px;margin-top:8px}.file-row{display:grid;grid-template-columns:1fr auto;gap:8px}.file-row button{border:1px solid #ddd3c3;background:#fff;border-radius:7px;cursor:pointer}.wide{width:100%;padding:10px 12px;background:#594a2e}@media(max-width:860px){.shell{grid-template-columns:1fr}.workspace{border-top:1px solid #ded8ca}.composer{grid-template-columns:1fr}.composer button{height:44px}}`;
}

function js() {
  return `
let state = { user: null, tasks: [], files: [] };
const $ = (id) => document.getElementById(id);
const messages = $("messages");

function sessionHeaders(){ const sid = localStorage.getItem("task_agent_session"); return sid ? {"x-session-id": sid} : {}; }
async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { ...sessionHeaders(), ...(options.headers || {}) } });
  const sid = res.headers.get("x-session-id"); if (sid) localStorage.setItem("task_agent_session", sid);
  return res;
}
function addMessage(role, text = "") {
  const el = document.createElement("div"); el.className = "msg " + role; el.textContent = text; messages.appendChild(el); messages.scrollTop = messages.scrollHeight; return el;
}
async function refresh() {
  const res = await api("/api/me"); state = await res.json();
  const u = state.user; $("identity").textContent = u.name ? (u.ai_nickname || "Mira") + " 正在协助 " + u.name : "还不知道你的姓名和邮箱，直接告诉我即可";
  $("task-count").textContent = state.tasks.length;
  $("tasks").innerHTML = state.tasks.map(t => '<div class="item"><strong>'+escapeHtml(t.title)+'</strong><p>'+(t.requirements||[]).map(r=>escapeHtml(r.body)).join("；")+'</p><span class="badge">'+t.status+'</span></div>').join("") || '<div class="hint">暂无任务</div>';
  $("files").innerHTML = state.files.map(f => '<div class="item file-row"><div><strong>'+escapeHtml(f.name)+'</strong><p>'+escapeHtml(f.summary || f.mime_type)+'</p></div><button data-del="'+f.id+'">删</button></div>').join("") || '<div class="hint">暂无文件</div>';
}
async function send(text) {
  addMessage("user", text); const out = addMessage("assistant", "");
  const res = await api("/api/chat", { method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({ message:text }) });
  if (!res.body) { out.textContent = await res.text(); return; }
  const reader = res.body.getReader(); const decoder = new TextDecoder();
  while (true) { const { done, value } = await reader.read(); if (done) break; out.textContent += decoder.decode(value, { stream:true }); messages.scrollTop = messages.scrollHeight; }
  await refresh();
}
$("composer").addEventListener("submit", async (e) => { e.preventDefault(); const input = $("input"); const text = input.value.trim(); if (!text) return; input.value = ""; await send(text); });
$("refresh").addEventListener("click", refresh);
$("file").addEventListener("change", async (e) => { const file = e.target.files[0]; if (!file) return; $("upload-state").textContent = "上传并向量化中..."; const fd = new FormData(); fd.append("file", file); await api("/api/files", { method:"POST", body:fd }); $("upload-state").textContent = "已完成"; await refresh(); });
$("files").addEventListener("click", async (e) => { const id = e.target?.dataset?.del; if (!id) return; await api("/api/files/"+id, { method:"DELETE" }); await refresh(); });
document.querySelectorAll("[data-prompt]").forEach(btn => btn.addEventListener("click", () => send(btn.dataset.prompt)));
function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
addMessage("assistant", "你好，我是 Mira。告诉我你的姓名和邮箱后，我会记住你；也可以直接说“新增任务：准备面试作品，需求：部署到 Cloudflare；写 README”。");
refresh();
`;
}
