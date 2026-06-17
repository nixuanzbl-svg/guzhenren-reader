(function () {
  "use strict";

  var state = {
    authenticated: false,
    chapters: [],
    toastTimer: null
  };

  var el = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    collectElements();
    bindEvents();
    await checkSession();
    await refreshChapters();
  }

  function collectElements() {
    el.adminMeta = document.getElementById("adminMeta");
    el.loginPanel = document.getElementById("loginPanel");
    el.adminPanel = document.getElementById("adminPanel");
    el.loginForm = document.getElementById("loginForm");
    el.passwordInput = document.getElementById("passwordInput");
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

  async function checkSession() {
    try {
      var response = await fetch("/api/admin/session", {
        cache: "no-store",
        credentials: "same-origin"
      });
      var data = await response.json();
      state.authenticated = Boolean(data.authenticated);
    } catch (error) {
      console.error(error);
      state.authenticated = false;
    }
    renderAuthState();
  }

  async function login() {
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

  function renderAuthState() {
    el.loginPanel.hidden = state.authenticated;
    el.adminPanel.hidden = !state.authenticated;
    el.adminMeta.textContent = state.authenticated ? "已进入开发者模式" : "口令登录后可添加 PDF 章节";
  }

  async function refreshChapters(manual) {
    try {
      var response = await fetch("/api/chapters", {
        cache: "no-store"
      });
      if (!response.ok) {
        throw new Error("章节接口返回 " + response.status);
      }
      var catalog = await response.json();
      state.chapters = catalog.chapters || [];
      renderChapterList();
      if (manual) toast("章节清单已刷新。");
    } catch (error) {
      console.error(error);
      el.adminStorageMeta.textContent = "读取失败";
      el.adminChapterList.innerHTML = '<div class="empty-state visible"><div class="empty-cover">ERR</div><h2>章节读取失败</h2><p>请确认阅读器服务正在运行。</p></div>';
      toast("章节读取失败。");
    }
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
    var files = Array.prototype.slice.call(el.pdfInput.files || []).filter(function (file) {
      return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    });
    if (!files.length) {
      toast("请选择 PDF 文件。");
      return;
    }

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

  function chapterLabel(chapter) {
    return Number.isFinite(chapter.chapterNumber) ? "第 " + chapter.chapterNumber + " 章" : "PDF";
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
})();
