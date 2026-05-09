const STORAGE_KEY = "local-password-vault-v1";
const SYNC_KEY = "local-password-vault-sync-v1";
const ITERATIONS = 250000;

const state = {
  key: null,
  salt: null,
  entries: [],
  vaultExists: Boolean(localStorage.getItem(STORAGE_KEY)),
  sync: loadSyncConfig(),
};

const $ = (selector) => document.querySelector(selector);
const lockedView = $("#lockedView");
const vaultView = $("#vaultView");
const authTitle = $("#authTitle");
const authHint = $("#authHint");
const authMessage = $("#authMessage");
const masterPassword = $("#masterPassword");
const entryDialog = $("#entryDialog");
const generatorDialog = $("#generatorDialog");
const syncDialog = $("#syncDialog");

function loadSyncConfig() {
  try {
    return JSON.parse(localStorage.getItem(SYNC_KEY)) ?? {};
  } catch {
    return {};
  }
}

function saveSyncConfig(config) {
  state.sync = config;
  localStorage.setItem(SYNC_KEY, JSON.stringify(config));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function base64ToBytes(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

function randomBytes(length) {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function deriveKey(password, salt) {
  const encoded = new TextEncoder().encode(password);
  const material = await crypto.subtle.importKey("raw", encoded, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptVault(entries) {
  const iv = randomBytes(12);
  const plainText = new TextEncoder().encode(JSON.stringify({ entries }));
  const cipherText = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.key, plainText);
  return {
    version: 1,
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: bytesToBase64(state.salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(cipherText),
    updatedAt: new Date().toISOString(),
  };
}

async function decryptVault(vault, key) {
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(vault.iv) },
    key,
    base64ToBytes(vault.data),
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

async function saveVault() {
  const encrypted = await encryptVault(state.entries);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
  state.vaultExists = true;
  if (state.sync.autoSync && state.sync.token) {
    pushVaultToCloud({ silent: true }).catch(() => showToast("自动同步失败，请检查同步设置"));
  }
}

function configureAuth() {
  if (state.vaultExists) {
    authTitle.textContent = "解锁金库";
    authHint.textContent = "输入主密码后进入你的本地金库。";
    $("#resetVaultBtn").classList.remove("hidden");
  } else {
    authTitle.textContent = "创建金库";
    authHint.textContent = "设置一个至少 6 位的主密码。忘记后无法找回。";
    $("#resetVaultBtn").classList.add("hidden");
  }
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const temp = document.createElement("textarea");
    temp.value = text;
    document.body.appendChild(temp);
    temp.select();
    document.execCommand("copy");
    temp.remove();
  }
  showToast(`${label}已复制`);
}

function normalizeTags(text) {
  return text
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderEntries() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const filtered = state.entries.filter((entry) => {
    const haystack = [entry.name, entry.url, entry.username, entry.tags.join(" "), entry.notes]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });

  $("#entryCount").textContent = state.entries.length;
  $("#emptyState").classList.toggle("hidden", state.entries.length > 0);
  $("#entryList").classList.toggle("hidden", state.entries.length === 0);

  $("#entryList").innerHTML = filtered
    .map((entry) => {
      const tags = entry.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("");
      const host = entry.url ? new URL(entry.url).host : "未填写网址";
      return `
        <article class="entry-card" data-id="${entry.id}">
          <div class="entry-head">
            <div>
              <h3>${escapeHtml(entry.name)}</h3>
              <div class="entry-url">${escapeHtml(host)}</div>
            </div>
            <button class="small-btn" data-action="edit">编辑</button>
          </div>
          <div class="tag-row">${tags}</div>
          <div class="entry-actions">
            <button class="small-btn" data-action="copy-user">复制账号</button>
            <button class="small-btn" data-action="copy-pass">复制密码</button>
            <button class="small-btn" data-action="open-site">打开网站</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function getVaultText() {
  return localStorage.getItem(STORAGE_KEY);
}

function requireSyncConfig() {
  if (!state.sync.token) {
    showToast("请先填写 GitHub Token");
    openSyncDialog();
    return false;
  }
  return true;
}

async function githubRequest(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.sync.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `GitHub request failed: ${response.status}`);
  }
  return response.json();
}

async function pushVaultToCloud(options = {}) {
  if (!requireSyncConfig()) return;
  const vaultText = getVaultText();
  if (!vaultText) {
    showToast("没有可同步的金库");
    return;
  }
  const filename = state.sync.filename || "password-vault.json";
  const content = `${vaultText}\n`;
  if (state.sync.gistId) {
    await githubRequest(`/gists/${state.sync.gistId}`, {
      method: "PATCH",
      body: JSON.stringify({ files: { [filename]: { content } } }),
    });
  } else {
    const gist = await githubRequest("/gists", {
      method: "POST",
      body: JSON.stringify({
        description: "Encrypted local password vault backup",
        public: false,
        files: { [filename]: { content } },
      }),
    });
    saveSyncConfig({ ...state.sync, gistId: gist.id, filename });
  }
  if (!options.silent) showToast("已同步到云端");
  updateSyncStatus();
}

async function pullVaultFromCloud() {
  if (!requireSyncConfig()) return;
  if (!state.sync.gistId) {
    showToast("请先填写 Gist ID，或先同步到云端创建一个");
    openSyncDialog();
    return;
  }
  const filename = state.sync.filename || "password-vault.json";
  const gist = await githubRequest(`/gists/${state.sync.gistId}`, { method: "GET" });
  const file = gist.files?.[filename];
  if (!file?.content) throw new Error("Gist 中没有找到金库文件");
  const imported = JSON.parse(file.content);
  if (!imported.salt || !imported.iv || !imported.data) throw new Error("云端金库格式不正确");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
  state.vaultExists = true;
  state.key = null;
  state.entries = [];
  vaultView.classList.add("hidden");
  lockedView.classList.remove("hidden");
  configureAuth();
  showToast("已从云端同步，请重新输入主密码");
}

function updateSyncStatus() {
  const status = $("#syncStatus");
  if (!status) return;
  if (!state.sync.token) {
    status.textContent = "未启用同步";
    return;
  }
  status.textContent = state.sync.gistId
    ? `已配置 Gist：${state.sync.gistId}`
    : "已保存 token，下次同步到云端会自动创建私密 Gist";
}

function openSyncDialog() {
  $("#syncToken").value = state.sync.token ?? "";
  $("#syncGistId").value = state.sync.gistId ?? "";
  $("#syncFilename").value = state.sync.filename ?? "password-vault.json";
  $("#syncAuto").checked = Boolean(state.sync.autoSync);
  updateSyncStatus();
  syncDialog.showModal();
}

function openEntryDialog(entry = null) {
  $("#dialogTitle").textContent = entry ? "编辑条目" : "添加条目";
  $("#entryId").value = entry?.id ?? "";
  $("#entryName").value = entry?.name ?? "";
  $("#entryUrl").value = entry?.url ?? "";
  $("#entryUsername").value = entry?.username ?? "";
  $("#entryPassword").value = entry?.password ?? "";
  $("#entryPassword").type = "password";
  $("#togglePasswordBtn").textContent = "显示";
  $("#entryTags").value = entry?.tags?.join(", ") ?? "";
  $("#entryNotes").value = entry?.notes ?? "";
  $("#deleteEntryBtn").classList.toggle("hidden", !entry);
  entryDialog.showModal();
}

function generatePassword() {
  const length = Number($("#passwordLength").value);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_-+=";
  const bytes = randomBytes(length);
  const password = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  $("#generatedPassword").value = password;
  $("#lengthOutput").textContent = `${length} 位`;
}

function download(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

$("#unlockForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  authMessage.textContent = "";
  try {
    if (state.vaultExists) {
      const vault = JSON.parse(localStorage.getItem(STORAGE_KEY));
      const salt = base64ToBytes(vault.salt);
      const key = await deriveKey(masterPassword.value, salt);
      const decrypted = await decryptVault(vault, key);
      state.key = key;
      state.salt = salt;
      state.entries = decrypted.entries ?? [];
    } else {
      state.salt = randomBytes(16);
      state.key = await deriveKey(masterPassword.value, state.salt);
      state.entries = [];
      await saveVault();
    }
    masterPassword.value = "";
    lockedView.classList.add("hidden");
    vaultView.classList.remove("hidden");
    renderEntries();
  } catch {
    authMessage.textContent = "主密码不正确，或金库数据已损坏。";
  }
});

$("#resetVaultBtn").addEventListener("click", () => {
  const confirmed = confirm("这会删除浏览器里的本地金库。确认继续？");
  if (!confirmed) return;
  localStorage.removeItem(STORAGE_KEY);
  state.vaultExists = false;
  state.entries = [];
  configureAuth();
  showToast("已清空本地金库");
});

$("#lockBtn").addEventListener("click", () => {
  state.key = null;
  state.entries = [];
  vaultView.classList.add("hidden");
  lockedView.classList.remove("hidden");
  configureAuth();
});

$("#addEntryBtn").addEventListener("click", () => openEntryDialog());
$("#emptyAddBtn").addEventListener("click", () => openEntryDialog());
$("#closeDialogBtn").addEventListener("click", () => entryDialog.close());
$("#searchInput").addEventListener("input", renderEntries);

$("#entryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#entryId").value || crypto.randomUUID();
  const entry = {
    id,
    name: $("#entryName").value.trim(),
    url: $("#entryUrl").value.trim(),
    username: $("#entryUsername").value.trim(),
    password: $("#entryPassword").value,
    tags: normalizeTags($("#entryTags").value),
    notes: $("#entryNotes").value.trim(),
    updatedAt: new Date().toISOString(),
  };
  const index = state.entries.findIndex((item) => item.id === id);
  if (index >= 0) state.entries[index] = entry;
  else state.entries.unshift(entry);
  await saveVault();
  entryDialog.close();
  renderEntries();
  showToast("已保存");
});

$("#deleteEntryBtn").addEventListener("click", async () => {
  const id = $("#entryId").value;
  if (!confirm("确定删除这条记录？")) return;
  state.entries = state.entries.filter((entry) => entry.id !== id);
  await saveVault();
  entryDialog.close();
  renderEntries();
  showToast("已删除");
});

$("#togglePasswordBtn").addEventListener("click", () => {
  const input = $("#entryPassword");
  input.type = input.type === "password" ? "text" : "password";
  $("#togglePasswordBtn").textContent = input.type === "password" ? "显示" : "隐藏";
});

$("#entryList").addEventListener("click", (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".entry-card");
  if (!button || !card) return;
  const entry = state.entries.find((item) => item.id === card.dataset.id);
  if (!entry) return;
  const action = button.dataset.action;
  if (action === "edit") openEntryDialog(entry);
  if (action === "copy-user") copyText(entry.username, "账号");
  if (action === "copy-pass") copyText(entry.password, "密码");
  if (action === "open-site" && entry.url) window.open(entry.url, "_blank", "noopener,noreferrer");
  if (action === "open-site" && !entry.url) showToast("这条记录没有登录地址");
});

$("#generateBtn").addEventListener("click", () => {
  generatePassword();
  generatorDialog.showModal();
});
$("#closeGeneratorBtn").addEventListener("click", () => generatorDialog.close());
$("#refreshPasswordBtn").addEventListener("click", generatePassword);
$("#passwordLength").addEventListener("input", generatePassword);
$("#copyGeneratedBtn").addEventListener("click", () => copyText($("#generatedPassword").value, "生成的密码"));

$("#syncSettingsBtn").addEventListener("click", openSyncDialog);
$("#closeSyncBtn").addEventListener("click", () => syncDialog.close());
$("#syncForm").addEventListener("submit", (event) => {
  event.preventDefault();
  saveSyncConfig({
    token: $("#syncToken").value.trim(),
    gistId: $("#syncGistId").value.trim(),
    filename: $("#syncFilename").value.trim() || "password-vault.json",
    autoSync: $("#syncAuto").checked,
  });
  syncDialog.close();
  showToast("同步设置已保存");
});
$("#clearSyncBtn").addEventListener("click", () => {
  if (!confirm("清除本机保存的同步设置？不会删除云端 Gist。")) return;
  localStorage.removeItem(SYNC_KEY);
  state.sync = {};
  syncDialog.close();
  showToast("已清除同步设置");
});
$("#syncPushBtn").addEventListener("click", () => {
  pushVaultToCloud().catch((error) => showToast(`同步失败：${error.message.slice(0, 80)}`));
});
$("#syncPullBtn").addEventListener("click", () => {
  const confirmed = confirm("从云端同步会覆盖本机浏览器里的加密金库。确认继续？");
  if (!confirmed) return;
  pullVaultFromCloud().catch((error) => showToast(`同步失败：${error.message.slice(0, 80)}`));
});

$("#exportBtn").addEventListener("click", () => {
  const vault = localStorage.getItem(STORAGE_KEY);
  if (!vault) return showToast("没有可导出的金库");
  download(`password-vault-${new Date().toISOString().slice(0, 10)}.json`, vault);
});

$("#importInput").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const imported = JSON.parse(text);
    if (!imported.salt || !imported.iv || !imported.data) throw new Error("Invalid vault");
    localStorage.setItem(STORAGE_KEY, JSON.stringify(imported));
    showToast("已导入，请用备份的主密码重新解锁");
    location.reload();
  } catch {
    showToast("导入失败，文件格式不正确");
  } finally {
    event.target.value = "";
  }
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("./service-worker.js").catch(() => {});
}

configureAuth();
