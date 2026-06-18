(function () {
  "use strict";

  var DEFAULT_GITHUB = {
    owner: "nixuanzbl-svg",
    repo: "guzhenren-reader",
    branch: "main"
  };
  var GITHUB_CONFIG_KEY = "guzhenren-admin-github-config";
  var GITHUB_API_VERSION = "2022-11-28";

  var state = {
    authenticated: false,
    branch: DEFAULT_GITHUB.branch,
    chapters: [],
    mode: "detecting",
    owner: DEFAULT_GITHUB.owner,
    repo: DEFAULT_GITHUB.repo,
    toastTimer: null,
    token: ""
  };

  var el = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    collectElements();
    loadGitHubConfig();
    bindEvents();
    await detectAdminMode();
    renderAuthState();
    await refreshChapters();
  }

  function collectElements() {
    el.adminMeta = document.getElementById("adminMeta");
    el.loginPanel = document.getElementById("loginPanel");
    el.adminPanel = document.getElementById("adminPanel");
    el.loginTitle = document.getElementById("loginTitle");
    el.loginForm = document.getElementById("loginForm");
    el.githubConfigFields = document.getElementById("githubConfigFields");
    el.ownerInput = document.getElementById("ownerInput");
    el.repoInput = document.getElementById("repoInput");
    el.branchInput = document.getElementById("branchInput");
    el.passwordLabel = document.getElementById("passwordLabel");
    el.passwordInput = document.getElementById("passwordInput");
    el.loginButton = document.getElementById("loginButton");
    el.publishMeta = document.getElementById("publishMeta");
    el.uploadForm = document.getElementById("uploadForm");
    el.pdfInput = document.getElementById("pdfInput");
    el.uploadButton = document.getElementById("uploadButton");
    el.uploadBar = document.getElementById("uploadBar");
    el.uploadResult = document.getElementById("uploadResult");
    el.refreshAdminButton = document.getElementById("refreshAdminButton");
    el.chapterCountMeta = document.getElementById("chapterCountMeta");
    el.adminStorageMeta = document.getElementById("adminStorageMeta");
    el.adminChapterList = document.getElementById("adminChapterList");
    el.toast = document.getElementById("toast");
  }

  function bindEvents() {
    el.loginForm.addEventListener("submit", function (event) {
      event.preventDefault();
      login();
    });
    el.uploadForm.addEventListener("submit", function (event) {
      event.preventDefault();
      uploadPdfs();
    });
    el.refreshAdminButton.addEventListener("click", function () {
      refreshChapters(true);
    });
  }

  async function detectAdminMode() {
    if (shouldUseGitHubAdmin()) {
      state.mode = "github";
      syncGitHubInputs();
      if (!state.token) {
        state.authenticated = false;
        return;
      }
      try {
        await verifyGitHubAccess();
        state.authenticated = true;
      } catch (error) {
        console.warn("Saved GitHub token is unavailable", error);
        state.authenticated = false;
        toast("GitHub 登录已失效，请重新连接。");
      }
      return;
    }

    try {
      var response = await fetch("/api/admin/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      if (response.ok && contentTypeIsJson(response)) {
        var data = await response.json();
        state.mode = "local";
        state.authenticated = Boolean(data.authenticated);
        return;
      }
    } catch (error) {
      console.warn("Local admin API unavailable", error);
    }

    state.mode = "github";
    syncGitHubInputs();
    if (!state.token) {
      state.authenticated = false;
      return;
    }

    try {
      await verifyGitHubAccess();
      state.authenticated = true;
    } catch (error) {
      console.warn("Saved GitHub token is unavailable", error);
      state.authenticated = false;
      toast("GitHub 登录已失效，请重新连接。");
    }
  }

  function shouldUseGitHubAdmin() {
    var host = String(location.hostname || "").toLowerCase();
    return location.protocol === "file:" ||
      host === "appassets.androidplatform.net" ||
      /\.github\.io$/.test(host);
  }

  function contentTypeIsJson(response) {
    return String(response.headers.get("Content-Type") || "").toLowerCase().indexOf("application/json") !== -1;
  }

  async function login() {
    if (state.mode === "github") {
      await loginGitHub();
      return;
    }
    await loginLocal();
  }

  async function loginLocal() {
    var password = el.passwordInput.value;
    if (!password) return;
    try {
      var response = await fetch("/api/admin/login", {
        body: JSON.stringify({ password: password }),
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      var data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "登录失败。");
      }
      state.authenticated = true;
      el.passwordInput.value = "";
      renderAuthState();
      toast("已登录开发者模式。");
    } catch (error) {
      console.error(error);
      toast(error.message || "登录失败。");
    }
  }

  async function loginGitHub() {
    state.owner = cleanInput(el.ownerInput.value) || DEFAULT_GITHUB.owner;
    state.repo = cleanInput(el.repoInput.value) || DEFAULT_GITHUB.repo;
    state.branch = cleanInput(el.branchInput.value) || DEFAULT_GITHUB.branch;
    state.token = el.passwordInput.value.trim() || state.token;
    if (!state.token) {
      toast("请输入 GitHub Token。");
      return;
    }

    el.loginButton.disabled = true;
    try {
      await verifyGitHubAccess();
      saveGitHubConfig();
      state.authenticated = true;
      el.passwordInput.value = "";
      renderAuthState();
      await refreshChapters(false);
      toast("已连接 GitHub 发布仓库。");
    } catch (error) {
      console.error(error);
      state.authenticated = false;
      toast(error.message || "GitHub 连接失败。");
    } finally {
      el.loginButton.disabled = false;
    }
  }

  function renderAuthState() {
    var githubMode = state.mode === "github";
    el.loginPanel.hidden = state.authenticated;
    el.adminPanel.hidden = !state.authenticated;
    el.githubConfigFields.hidden = !githubMode;
    el.loginTitle.textContent = githubMode ? "GitHub 发布登录" : "开发者登录";
    el.passwordLabel.textContent = githubMode ? "GitHub Token" : "开发者口令";
    el.passwordInput.placeholder = githubMode && state.token ? "已保存，留空沿用" : "";
    el.passwordInput.required = !githubMode || !state.token;
    el.loginButton.textContent = githubMode ? "连接仓库" : "登录";
    el.adminMeta.textContent = adminMetaText();
    el.publishMeta.textContent = publishMetaText();
    if (githubMode) {
      syncGitHubInputs();
    }
  }

  function adminMetaText() {
    if (state.mode === "local") {
      return state.authenticated ? "已进入本机开发者模式" : "口令登录后可添加 PDF 章节";
    }
    if (state.authenticated) {
      return "已连接 " + state.owner + "/" + state.repo;
    }
    return "连接 GitHub 后可添加 PDF 章节";
  }

  function publishMetaText() {
    if (state.mode === "local") {
      return "本机模式：PDF 会保存到本机项目目录。";
    }
    return "发布仓库：" + state.owner + "/" + state.repo + " · 分支：" + state.branch + " · 普通版刷新后读取线上目录。";
  }

  async function refreshChapters(manual) {
    try {
      var catalog = state.mode === "github" ? await fetchGitHubPagesCatalog() : await fetchLocalCatalog();
      state.chapters = normalizeAdminCatalog(catalog).chapters || [];
      renderChapterList();
      if (manual) toast("章节清单已刷新。");
    } catch (error) {
      console.error(error);
      el.adminStorageMeta.textContent = "读取失败";
      el.adminChapterList.innerHTML = '<div class="empty-state visible"><div class="empty-cover">ERR</div><h2>章节读取失败</h2><p>请确认章节目录已经发布。</p></div>';
      toast("章节读取失败。");
    }
  }

  async function fetchLocalCatalog() {
    var response = await fetch("/api/chapters", {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("章节接口返回 " + response.status);
    }
    return response.json();
  }

  async function fetchGitHubPagesCatalog() {
    if (state.authenticated) {
      return (await loadGitHubCatalog()).catalog;
    }

    var url = pagesBaseUrl() + "data/chapters.json?t=" + Date.now();
    var response = await fetch(url, {
      cache: "no-store"
    });
    if (!response.ok) {
      throw new Error("线上章节目录返回 " + response.status);
    }
    return response.json();
  }

  function normalizeAdminCatalog(catalog) {
    if (!catalog || !Array.isArray(catalog.chapters)) {
      return { chapters: [] };
    }
    var baseUrl = state.mode === "github" ? pagesBaseUrl() : "";
    return Object.assign({}, catalog, {
      chapters: catalog.chapters.map(function (chapter) {
        var pdfUrl = chapter.pdfUrl || chapter.downloadUrl || "";
        return Object.assign({}, chapter, {
          pdfUrl: baseUrl ? resolveUrl(pdfUrl, baseUrl) : pdfUrl,
          title: chapter.title || titleFromFileName(chapter.fileName || "漫画.pdf")
        });
      })
    });
  }

  function renderChapterList() {
    var totalSize = state.chapters.reduce(function (sum, chapter) {
      return sum + (chapter.size || 0);
    }, 0);
    el.chapterCountMeta.textContent = state.chapters.length + " 章";
    el.adminStorageMeta.textContent = state.chapters.length + " 章 · " + formatSize(totalSize);
    el.adminChapterList.innerHTML = "";

    if (!state.chapters.length) {
      var empty = document.createElement("div");
      empty.className = "empty-state visible";
      empty.innerHTML = '<div class="empty-cover">PDF</div><h2>暂无章节</h2><p>上传 PDF 后会显示在这里。</p>';
      el.adminChapterList.appendChild(empty);
      return;
    }

    state.chapters.forEach(function (chapter) {
      var row = document.createElement("article");
      row.className = "admin-chapter-row";

      var main = document.createElement("div");
      main.className = "admin-chapter-main";
      var title = document.createElement("h3");
      title.textContent = chapter.title;
      var meta = document.createElement("p");
      meta.textContent = chapterLabel(chapter) + " · " + formatSize(chapter.size || 0) + " · " + formatDate(chapter.mtime);
      main.appendChild(title);
      main.appendChild(meta);

      var link = document.createElement("a");
      link.className = "ghost-button small link-button";
      link.href = chapter.pdfUrl;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "查看 PDF";

      row.appendChild(main);
      row.appendChild(link);
      el.adminChapterList.appendChild(row);
    });
  }

  function uploadPdfs() {
    if (!state.authenticated) {
      toast("请先登录。");
      return;
    }
    var files = selectedPdfFiles();
    if (!files.length) {
      toast("请选择 PDF 文件。");
      return;
    }
    if (state.mode === "github") {
      uploadGitHubPdfs(files);
      return;
    }
    uploadLocalPdfs(files);
  }

  function selectedPdfFiles() {
    return Array.prototype.slice.call(el.pdfInput.files || []).filter(function (file) {
      return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    });
  }

  function uploadLocalPdfs(files) {
    var formData = new FormData();
    files.forEach(function (file) {
      formData.append("files", file, file.name);
    });

    el.uploadButton.disabled = true;
    el.uploadBar.style.width = "0%";
    el.uploadResult.textContent = "正在上传 " + files.length + " 个 PDF。";

    var xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/pdfs");
    xhr.withCredentials = true;
    xhr.upload.onprogress = function (event) {
      if (event.lengthComputable) {
        el.uploadBar.style.width = Math.round((event.loaded / event.total) * 100) + "%";
      }
    };
    xhr.onload = async function () {
      el.uploadButton.disabled = false;
      try {
        var data = JSON.parse(xhr.responseText || "{}");
        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(data.error || "上传失败。");
        }
        renderUploadResult(data.results || []);
        el.pdfInput.value = "";
        el.uploadBar.style.width = "100%";
        await refreshChapters(false);
        toast("上传处理完成。");
      } catch (error) {
        console.error(error);
        el.uploadResult.textContent = error.message || "上传失败。";
        toast("上传失败。");
      }
    };
    xhr.onerror = function () {
      el.uploadButton.disabled = false;
      el.uploadResult.textContent = "上传请求失败。";
      toast("上传请求失败。");
    };
    xhr.send(formData);
  }

  async function uploadGitHubPdfs(files) {
    el.uploadButton.disabled = true;
    el.uploadBar.style.width = "0%";
    el.uploadResult.textContent = "正在连接 GitHub。";

    try {
      var catalogFile = await loadGitHubCatalog();
      var catalog = catalogFile.catalog;
      var records = Array.isArray(catalog.chapters) ? catalog.chapters.slice() : [];
      var existingNames = new Set(records.map(function (chapter) {
        return String(chapter.fileName || "").toLowerCase();
      }));
      var existingNumbers = new Set(records
        .map(function (chapter) { return chapter.chapterNumber; })
        .filter(function (number) { return Number.isFinite(number); }));
      var results = [];
      var uploadedRecords = [];

      for (var index = 0; index < files.length; index += 1) {
        var file = files[index];
        el.uploadBar.style.width = Math.round((index / files.length) * 88) + "%";
        el.uploadResult.textContent = "正在发布 " + (index + 1) + " / " + files.length + "：" + file.name;
        try {
          var fileName = safeFileName(file.name);
          var foldedName = fileName.toLowerCase();
          var chapterNumber = extractChapterNumber(fileName);
          if (existingNames.has(foldedName)) {
            throw new Error("已存在同名 PDF。");
          }
          if (Number.isFinite(chapterNumber) && existingNumbers.has(chapterNumber)) {
            throw new Error("第 " + chapterNumber + " 章已经存在。");
          }
          var remoteFile = await getGitHubFile("docs/pdf/" + fileName, true);
          if (remoteFile) {
            throw new Error("远程仓库已存在同名 PDF。");
          }

          var arrayBuffer = await file.arrayBuffer();
          if (!arrayBuffer.byteLength) {
            throw new Error("PDF 文件为空。");
          }
          await putGitHubFile(
            "docs/pdf/" + fileName,
            arrayBufferToBase64(arrayBuffer),
            "",
            "Add comic chapter " + fileName
          );

          var record = await createChapterRecord(fileName, file.size || arrayBuffer.byteLength, Date.now());
          records.push(record);
          uploadedRecords.push(record);
          existingNames.add(foldedName);
          if (Number.isFinite(chapterNumber)) existingNumbers.add(chapterNumber);
          results.push({
            fileName: fileName,
            size: file.size || arrayBuffer.byteLength,
            status: "uploaded"
          });
        } catch (error) {
          results.push({
            fileName: file.name,
            message: error.message || String(error),
            status: "error"
          });
        }
      }

      if (uploadedRecords.length) {
        el.uploadResult.textContent = "正在更新章节目录。";
        var nextCatalog = await buildCatalog(catalog, records);
        await putGitHubFile(
          "docs/data/chapters.json",
          textToBase64(JSON.stringify(nextCatalog, null, 2) + "\n"),
          catalogFile.sha,
          "Update comic chapter catalog"
        );
        state.chapters = normalizeAdminCatalog(nextCatalog).chapters;
        renderChapterList();
      }

      renderUploadResult(results);
      el.pdfInput.value = "";
      el.uploadBar.style.width = "100%";
      toast(uploadedRecords.length ? "已发布，普通版刷新后可见。" : "没有新增章节。");
    } catch (error) {
      console.error(error);
      el.uploadResult.textContent = error.message || "GitHub 发布失败。";
      toast("GitHub 发布失败。");
    } finally {
      el.uploadButton.disabled = false;
    }
  }

  function renderUploadResult(results) {
    if (!results.length) {
      el.uploadResult.textContent = "没有成功处理文件。";
      return;
    }
    var lines = results.map(function (result) {
      if (result.status === "uploaded") {
        return "已添加：" + result.fileName + "（" + formatSize(result.size || 0) + "）";
      }
      return "未添加：" + result.fileName + "，" + (result.message || "处理失败");
    });
    el.uploadResult.textContent = lines.join("\n");
  }

  async function verifyGitHubAccess() {
    await githubRequest("GET", "");
  }

  async function loadGitHubCatalog() {
    var file = await getGitHubFile("docs/data/chapters.json", true);
    if (!file) {
      return {
        catalog: emptyCatalog(),
        sha: ""
      };
    }
    return {
      catalog: JSON.parse(file.text),
      sha: file.sha || ""
    };
  }

  async function getGitHubFile(relativePath, optional) {
    try {
      var path = githubContentPath(relativePath) + "?ref=" + encodeURIComponent(state.branch);
      var data = await githubRequest("GET", path);
      if (!data || data.type !== "file") return null;
      return {
        content: data.content || "",
        sha: data.sha || "",
        size: data.size || 0,
        text: data.content ? base64ToText(data.content) : ""
      };
    } catch (error) {
      if (optional && error.status === 404) return null;
      throw error;
    }
  }

  async function putGitHubFile(relativePath, contentBase64, sha, message) {
    var body = {
      branch: state.branch,
      content: contentBase64,
      message: message
    };
    if (sha) body.sha = sha;
    return githubRequest("PUT", githubContentPath(relativePath), body);
  }

  async function githubRequest(method, apiPath, body) {
    var url = "https://api.github.com/repos/" + encodeURIComponent(state.owner) + "/" + encodeURIComponent(state.repo) + apiPath;
    var headers = {
      "Accept": "application/vnd.github+json",
      "Authorization": "Bearer " + state.token,
      "X-GitHub-Api-Version": GITHUB_API_VERSION
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json; charset=utf-8";
    }
    var response = await fetch(url, {
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      headers: headers,
      method: method
    });
    var text = await response.text();
    var data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (error) {
        data = { message: text };
      }
    }
    if (!response.ok) {
      var message = data && data.message ? data.message : "GitHub 请求失败";
      var requestError = new Error("GitHub " + response.status + "：" + message);
      requestError.status = response.status;
      throw requestError;
    }
    return data;
  }

  function githubContentPath(relativePath) {
    return "/contents/" + relativePath.split("/").map(function (part) {
      return encodeURIComponent(part);
    }).join("/");
  }

  async function buildCatalog(previous, records) {
    var chapters = records.slice().sort(compareRecords);
    var maxMtime = chapters.reduce(function (max, record) {
      return Math.max(max, record.mtime || 0);
    }, 0);
    var fingerprint = (await sha1Hex(JSON.stringify(chapters.map(function (record) {
      return [record.fileName, record.size, record.mtime];
    })))).slice(0, 12);

    return {
      schema: previous.schema || 1,
      source: previous.source || "github-pages-static",
      generatedAt: new Date().toISOString(),
      updatedAt: maxMtime ? new Date(maxMtime).toISOString() : "",
      version: chapters.length + "-" + maxMtime + "-" + fingerprint,
      totalPdfFiles: Math.max(Number(previous.totalPdfFiles) || 0, chapters.length),
      chapters: chapters,
      omittedDuplicateChapters: Array.isArray(previous.omittedDuplicateChapters) ? previous.omittedDuplicateChapters : []
    };
  }

  async function createChapterRecord(fileName, size, mtime) {
    var chapterNumber = extractChapterNumber(fileName);
    var fallbackId = "pdf-" + (await sha1Hex(fileName)).slice(0, 12);
    return {
      id: Number.isFinite(chapterNumber) ? "chapter-" + chapterNumber : fallbackId,
      chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
      title: titleFromFileName(fileName),
      fileName: fileName,
      size: size,
      mtime: mtime,
      pdfUrl: "./pdf/" + encodeURIComponent(fileName),
      downloadUrl: "./pdf/" + encodeURIComponent(fileName),
      checksum: await sha1Hex(fileName + "\0" + size + "\0" + mtime)
    };
  }

  function emptyCatalog() {
    return {
      schema: 1,
      source: "github-pages-static",
      generatedAt: new Date().toISOString(),
      updatedAt: "",
      version: "0-0",
      totalPdfFiles: 0,
      chapters: [],
      omittedDuplicateChapters: []
    };
  }

  function loadGitHubConfig() {
    try {
      var saved = JSON.parse(localStorage.getItem(GITHUB_CONFIG_KEY) || "{}");
      state.owner = cleanInput(saved.owner) || DEFAULT_GITHUB.owner;
      state.repo = cleanInput(saved.repo) || DEFAULT_GITHUB.repo;
      state.branch = cleanInput(saved.branch) || DEFAULT_GITHUB.branch;
      state.token = cleanInput(saved.token);
    } catch (error) {
      state.owner = DEFAULT_GITHUB.owner;
      state.repo = DEFAULT_GITHUB.repo;
      state.branch = DEFAULT_GITHUB.branch;
      state.token = "";
    }
  }

  function saveGitHubConfig() {
    try {
      localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify({
        owner: state.owner,
        repo: state.repo,
        branch: state.branch,
        token: state.token
      }));
    } catch (error) {
      console.warn("Unable to save GitHub config", error);
    }
  }

  function syncGitHubInputs() {
    el.ownerInput.value = state.owner;
    el.repoInput.value = state.repo;
    el.branchInput.value = state.branch;
  }

  function pagesBaseUrl() {
    return "https://" + state.owner + ".github.io/" + state.repo + "/";
  }

  function cleanInput(value) {
    return String(value || "").trim();
  }

  function safeFileName(name) {
    var fileName = String(name || "").split(/[\\/]/).pop().trim();
    if (!fileName) throw new Error("文件名为空。");
    if (/[\x00-\x1f]/.test(fileName)) throw new Error("文件名不能包含控制字符。");
    if (fileName === "." || fileName === "..") throw new Error("文件名非法。");
    if (!/\.pdf$/i.test(fileName)) throw new Error("只允许上传 PDF 文件。");
    return fileName;
  }

  function extractChapterNumber(fileName) {
    var arabic = fileName.match(/第\s*([0-9]+)\s*章/);
    if (arabic) return Number(arabic[1]);

    var chinese = fileName.match(/第\s*([零〇一二两三四五六七八九十百千万]+)\s*章/);
    if (chinese) return chineseToNumber(chinese[1]);

    var chapter = fileName.match(/(?:chapter|ch|第)\s*([0-9]+)/i);
    if (chapter) return Number(chapter[1]);

    return null;
  }

  function chineseToNumber(text) {
    var digits = {
      "零": 0,
      "〇": 0,
      "一": 1,
      "二": 2,
      "两": 2,
      "三": 3,
      "四": 4,
      "五": 5,
      "六": 6,
      "七": 7,
      "八": 8,
      "九": 9
    };
    var units = {
      "十": 10,
      "百": 100,
      "千": 1000,
      "万": 10000
    };
    var total = 0;
    var section = 0;
    var number = 0;

    for (var index = 0; index < text.length; index += 1) {
      var char = text[index];
      if (Object.prototype.hasOwnProperty.call(digits, char)) {
        number = digits[char];
      } else if (Object.prototype.hasOwnProperty.call(units, char)) {
        var unit = units[char];
        if (unit === 10000) {
          section = (section + number) * unit;
          total += section;
          section = 0;
        } else {
          section += (number || 1) * unit;
        }
        number = 0;
      }
    }

    return total + section + number;
  }

  function compareRecords(left, right) {
    var leftChapter = Number.isFinite(left.chapterNumber) ? left.chapterNumber : null;
    var rightChapter = Number.isFinite(right.chapterNumber) ? right.chapterNumber : null;

    if (leftChapter !== null && rightChapter !== null && leftChapter !== rightChapter) {
      return leftChapter - rightChapter;
    }
    if (leftChapter !== null && rightChapter === null) return -1;
    if (leftChapter === null && rightChapter !== null) return 1;
    return titleFromFileName(left.fileName || left.title || "").localeCompare(titleFromFileName(right.fileName || right.title || ""), "zh-Hans-CN");
  }

  function chapterLabel(chapter) {
    return Number.isFinite(chapter.chapterNumber) ? "第 " + chapter.chapterNumber + " 章" : "PDF";
  }

  function titleFromFileName(fileName) {
    return String(fileName || "")
      .replace(/\.pdf$/i, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "漫画";
  }

  function resolveUrl(value, baseUrl) {
    if (!value) return value;
    if (/^(https?:|blob:|data:)/i.test(value)) return value;
    try {
      return new URL(value, baseUrl).href;
    } catch (error) {
      return value;
    }
  }

  function formatSize(bytes) {
    if (!bytes) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var value = bytes;
    var unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit += 1;
    }
    return value.toFixed(value >= 10 || unit === 0 ? 0 : 1) + " " + units[unit];
  }

  function formatDate(timestamp) {
    if (!timestamp) return "时间未知";
    return new Date(timestamp).toLocaleString("zh-CN", {
      hour12: false
    });
  }

  function toast(message) {
    window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("visible");
    state.toastTimer = window.setTimeout(function () {
      el.toast.classList.remove("visible");
    }, 2600);
  }

  function arrayBufferToBase64(buffer) {
    var bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    var binary = "";
    var chunkSize = 0x8000;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  function textToBase64(text) {
    return arrayBufferToBase64(new TextEncoder().encode(text));
  }

  function base64ToText(base64) {
    var clean = String(base64 || "").replace(/\s/g, "");
    var binary = atob(clean);
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8").decode(bytes);
  }

  async function sha1Hex(value) {
    if (window.crypto && window.crypto.subtle && window.TextEncoder) {
      var buffer = await window.crypto.subtle.digest("SHA-1", new TextEncoder().encode(String(value)));
      return Array.prototype.map.call(new Uint8Array(buffer), function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
    }
    var hash = 2166136261;
    var input = String(value);
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }
})();
