(function () {
  "use strict";

  var DB_NAME = "guzhenren-static-comic-reader";
  var DB_VERSION = 2;
  var BOOK_STORE = "books";
  var POSITION_STORE = "positions";
  var RENDERED_PAGE_STORE = "renderedPages";
  var CHAPTER_CACHE_STORE = "chapterCacheMeta";
  var SETTINGS_STORE = "settings";
  var SETTINGS_KEY = "reader";
  var API_CATALOG_URL = "/api/chapters";
  var STATIC_CATALOG_URL = "./data/chapters.json";
  var ANDROID_ASSET_HOST = "appassets.androidplatform.net";
  var PDF_OPTIONS_BASE = {
    disableAutoFetch: false,
    disableFontFace: false,
    disableRange: true,
    disableStream: true,
    isEvalSupported: false,
    useSystemFonts: true
  };
  var DEFAULT_SETTINGS = {
    brightness: 92,
    eyeCare: false,
    libraryViewMode: "icon",
    night: false,
    pageGap: 18,
    pageWidth: 100,
    theme: "paper"
  };
  var PROCESS_LOG_LIMIT = 90;

  var state = {
    books: [],
    autoAppendInFlight: false,
    autoPrependInFlight: false,
    cacheAbortController: null,
    cacheCancelRequested: false,
    cacheInFlight: false,
    cacheMeta: {},
    cacheSelection: new Set(),
    catalogVersion: "",
    chapterSequence: [],
    currentBook: null,
    currentPdf: null,
    currentVisibleBookId: "",
    db: null,
    lastSaveAt: 0,
    lastPositionLogAt: 0,
    loadedBookIds: new Set(),
    loadedChapters: [],
    observer: null,
    pages: [],
    positions: {},
    processEvents: [],
    processIdSeed: 0,
    processPanelOpen: false,
    processStats: {
      cache: "等待缓存",
      import: "空闲",
      render: "尚未阅读"
    },
    pendingScrollMode: "restore",
    renderedPages: new Set(),
    renderingPages: new Set(),
    readerSession: 0,
    saveInFlight: false,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    touchBoundaryPull: 0,
    touchLastY: 0,
    touchTracking: false,
    toastTimer: null
  };

  var el = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    collectElements();
    bindEvents();
    registerServiceWorker();

    if (!window.pdfjsLib) {
      toast("缺少 pdf.js 文件，请检查 vendor/pdfjs 目录。");
      return;
    }

    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "./vendor/pdfjs/pdf.worker.min.js";

    try {
      state.db = await openDatabase();
      state.settings = await loadSettings();
      applySettings();
      await refreshLibrary();
      handleRoute();
      window.addEventListener("hashchange", handleRoute);
      addProcessEvent("done", "阅读器启动", "缓存、书架和 PDF 渲染器已准备。");
    } catch (error) {
      console.error(error);
      toast("浏览器缓存初始化失败。");
    }
  }

  function collectElements() {
    el.refreshButton = document.getElementById("refreshButton");
    el.selectAllPanelButton = document.getElementById("selectAllPanelButton");
    el.cachePanelButton = document.getElementById("cachePanelButton");
    el.clearCurrentCacheButton = document.getElementById("clearCurrentCacheButton");
    el.resumeButton = document.getElementById("resumeButton");
    el.libraryView = document.getElementById("libraryView");
    el.readerView = document.getElementById("readerView");
    el.shelfMeta = document.getElementById("shelfMeta");
    el.storageMeta = document.getElementById("storageMeta");
    el.bookGrid = document.getElementById("bookGrid");
    el.emptyState = document.getElementById("emptyState");
    el.viewModeButton = document.getElementById("viewModeButton");
    el.viewModeMenu = document.getElementById("viewModeMenu");
    el.viewModeOptions = Array.prototype.slice.call(document.querySelectorAll("[data-view-mode]"));
    el.continueSection = document.getElementById("continueSection");
    el.continueCard = document.getElementById("continueCard");
    el.backToShelfButton = document.getElementById("backToShelfButton");
    el.readerTitle = document.getElementById("readerTitle");
    el.readerMeta = document.getElementById("readerMeta");
    el.readerProgressBar = document.getElementById("readerProgressBar");
    el.readerScroll = document.getElementById("readerScroll");
    el.readerLoading = document.getElementById("readerLoading");
    el.pagesContainer = document.getElementById("pagesContainer");
    el.settingsButton = document.getElementById("settingsButton");
    el.chapterSelectButton = document.getElementById("chapterSelectButton");
    el.prevChapterButton = document.getElementById("prevChapterButton");
    el.nextChapterButton = document.getElementById("nextChapterButton");
    el.chapterBackdrop = document.getElementById("chapterBackdrop");
    el.chapterPanel = document.getElementById("chapterPanel");
    el.closeChapterButton = document.getElementById("closeChapterButton");
    el.chapterList = document.getElementById("chapterList");
    el.settingsPanel = document.getElementById("settingsPanel");
    el.settingsBackdrop = document.getElementById("settingsBackdrop");
    el.closeSettingsButton = document.getElementById("closeSettingsButton");
    el.brightnessRange = document.getElementById("brightnessRange");
    el.pageWidthRange = document.getElementById("pageWidthRange");
    el.eyeCareToggle = document.getElementById("eyeCareToggle");
    el.nightToggle = document.getElementById("nightToggle");
    el.jumpStartButton = document.getElementById("jumpStartButton");
    el.jumpEndButton = document.getElementById("jumpEndButton");
    el.brightnessLayer = document.getElementById("brightnessLayer");
    el.importOverlay = document.getElementById("importOverlay");
    el.importText = document.getElementById("importText");
    el.importBar = document.getElementById("importBar");
    el.processButton = document.getElementById("processButton");
    el.processBadge = document.getElementById("processBadge");
    el.processBackdrop = document.getElementById("processBackdrop");
    el.processPanel = document.getElementById("processPanel");
    el.closeProcessButton = document.getElementById("closeProcessButton");
    el.clearProcessButton = document.getElementById("clearProcessButton");
    el.processCurrentTitle = document.getElementById("processCurrentTitle");
    el.processCurrentDetail = document.getElementById("processCurrentDetail");
    el.processImportStat = document.getElementById("processImportStat");
    el.processRenderStat = document.getElementById("processRenderStat");
    el.processCacheStat = document.getElementById("processCacheStat");
    el.processSummary = document.getElementById("processSummary");
    el.processTimeline = document.getElementById("processTimeline");
    el.processEmpty = document.getElementById("processEmpty");
    el.toast = document.getElementById("toast");
  }

  function bindEvents() {
    if (el.refreshButton) {
      el.refreshButton.addEventListener("click", function () {
        refreshLibrary(true);
      });
    }
    if (el.selectAllPanelButton) {
      el.selectAllPanelButton.addEventListener("click", toggleAllCacheSelection);
    }
    if (el.cachePanelButton) {
      el.cachePanelButton.addEventListener("click", handleCachePanelButtonClick);
    }
    if (el.clearCurrentCacheButton) {
      el.clearCurrentCacheButton.addEventListener("click", clearCurrentChapterCache);
    }
    if (el.viewModeButton) {
      el.viewModeButton.addEventListener("click", function (event) {
        event.stopPropagation();
        showViewModeMenu(el.viewModeMenu && el.viewModeMenu.hidden);
      });
    }
    if (el.viewModeMenu) {
      el.viewModeMenu.addEventListener("click", function (event) {
        event.stopPropagation();
      });
    }
    if (el.viewModeOptions) {
      el.viewModeOptions.forEach(function (button) {
        button.addEventListener("click", function () {
          setLibraryViewMode(button.dataset.viewMode || "icon");
        });
      });
    }
    el.backToShelfButton.addEventListener("click", function () {
      location.hash = "";
    });
    el.readerScroll.addEventListener("scroll", onReaderScroll, { passive: true });
    el.readerView.addEventListener("wheel", handleReaderWheel, { passive: false });
    el.readerView.addEventListener("touchstart", handleReaderTouchStart, { passive: true });
    el.readerView.addEventListener("touchmove", handleReaderTouchMove, { passive: false });
    el.readerView.addEventListener("touchend", resetReaderTouch, { passive: true });
    el.readerView.addEventListener("touchcancel", resetReaderTouch, { passive: true });
    el.settingsButton.addEventListener("click", function () {
      showSettings(true);
    });
    el.chapterSelectButton.addEventListener("click", function () {
      renderChapterList();
      showChapterPanel(true);
    });
    el.prevChapterButton.addEventListener("click", function () {
      navigateRelativeChapter(-1);
    });
    el.nextChapterButton.addEventListener("click", function () {
      navigateRelativeChapter(1);
    });
    el.chapterBackdrop.addEventListener("click", function () {
      showChapterPanel(false);
    });
    el.closeChapterButton.addEventListener("click", function () {
      showChapterPanel(false);
    });
    el.settingsBackdrop.addEventListener("click", function () {
      showSettings(false);
    });
    el.closeSettingsButton.addEventListener("click", function () {
      showSettings(false);
    });
    el.processButton.addEventListener("click", function () {
      showProcessPanel(true);
    });
    el.processBackdrop.addEventListener("click", function () {
      showProcessPanel(false);
    });
    el.closeProcessButton.addEventListener("click", function () {
      showProcessPanel(false);
    });
    el.clearProcessButton.addEventListener("click", function () {
      clearProcessEvents();
    });
    el.jumpStartButton.addEventListener("click", function () {
      jumpToScrollTop(0);
    });
    el.jumpEndButton.addEventListener("click", function () {
      jumpToScrollTop(Math.max(0, el.readerScroll.scrollHeight - el.readerScroll.clientHeight));
    });
    el.brightnessRange.addEventListener("input", function () {
      updateSettings({ brightness: Number(el.brightnessRange.value) });
    });
    el.pageWidthRange.addEventListener("input", function () {
      updateSettings({ pageWidth: Number(el.pageWidthRange.value) }, true);
    });
    el.eyeCareToggle.addEventListener("click", function () {
      updateSettings({ eyeCare: !state.settings.eyeCare });
    });
    el.nightToggle.addEventListener("click", function () {
      updateSettings({ night: !state.settings.night });
    });
    document.querySelectorAll(".swatch").forEach(function (button) {
      button.addEventListener("click", function () {
        updateSettings({ theme: button.dataset.theme || "paper" });
      });
    });
    document.querySelectorAll(".segment-group button").forEach(function (button) {
      button.addEventListener("click", function () {
        updateSettings({ pageGap: Number(button.dataset.gap || 18) }, true);
      });
    });
    window.addEventListener("resize", debounce(function () {
      if (state.pages.length) {
        reflowReaderPages(true);
      }
    }, 160));
    window.addEventListener("pagehide", function () {
      persistPosition(true);
    });
    document.addEventListener("click", function () {
      showViewModeMenu(false);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && el.viewModeMenu && !el.viewModeMenu.hidden) {
        showViewModeMenu(false);
      } else if (event.key === "Escape" && !el.chapterPanel.hidden) {
        showChapterPanel(false);
      } else if (event.key === "Escape" && !el.processPanel.hidden) {
        showProcessPanel(false);
      } else if (event.key === "Escape" && !el.settingsPanel.hidden) {
        showSettings(false);
      }
    });
  }

  function chooseFiles() {
    el.fileInput.value = "";
    el.fileInput.click();
  }

  async function handleFileSelection(event) {
    var files = Array.prototype.slice.call(event.target.files || []);
    var pdfFiles = files.filter(function (file) {
      return /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    });

    if (!pdfFiles.length) {
      addProcessEvent("error", "文件选择失败", "请选择 PDF 文件。");
      toast("请选择 PDF 文件。");
      return;
    }

    await importPdfFiles(pdfFiles);
  }

  async function importPdfFiles(files) {
    var imported = 0;
    var failed = 0;
    var batchTask = startProcessEvent("导入队列", "准备导入 " + files.length + " 个 PDF。");
    setProcessStats({
      import: "0 / " + files.length,
      cache: "准备写入"
    });
    showImportOverlay(true, "准备导入", 0);

    for (var index = 0; index < files.length; index += 1) {
      var file = files[index];
      var fileTask = addProcessEvent("queued", "等待导入", (index + 1) + " / " + files.length + " · " + file.name);
      updateProcessEvent(fileTask, {
        detail: "正在处理 " + file.name,
        status: "running"
      });
      setProcessStats({
        import: (index + 1) + " / " + files.length
      });
      showImportOverlay(true, "正在导入 " + (index + 1) + " / " + files.length + "：" + file.name, (index / files.length) * 100);

      try {
        await importOnePdf(file);
        imported += 1;
        finishProcessEvent(fileTask, "已缓存 " + file.name);
      } catch (error) {
        console.error(error);
        failed += 1;
        failProcessEvent(fileTask, error, "导入失败：" + file.name);
      }

      showImportOverlay(true, "正在导入 " + (index + 1) + " / " + files.length, ((index + 1) / files.length) * 100);
    }

    showImportOverlay(false);
    await refreshLibrary();
    setProcessStats({
      import: imported + " 成功" + (failed ? " · " + failed + " 失败" : ""),
      cache: imported ? "已写入缓存" : "未写入"
    });

    if (imported) {
      finishProcessEvent(batchTask, "完成 " + imported + " 本漫画" + (failed ? "，" + failed + " 本失败" : ""));
      toast("已导入 " + imported + " 本漫画" + (failed ? "，" + failed + " 本失败" : ""));
    } else {
      failProcessEvent(batchTask, new Error("导入失败"), "没有成功导入 PDF。");
      toast("导入失败，请确认 PDF 文件可读取。");
    }
  }

  async function importOnePdf(file) {
    var id = "pdf_" + hashString([file.name, file.size, file.lastModified || 0].join("|"));
    var existing = await getByKey(BOOK_STORE, id);
    var arrayBuffer;
    var pdfDoc;
    var readTask = startProcessEvent("读取文件", file.name + " · " + formatSize(file.size || 0));
    try {
      arrayBuffer = await file.arrayBuffer();
      finishProcessEvent(readTask, "读取完成：" + formatSize(arrayBuffer.byteLength || file.size || 0));
    } catch (error) {
      failProcessEvent(readTask, error, "无法读取文件。");
      throw error;
    }

    var parseTask = startProcessEvent("解析 PDF", file.name);
    try {
      pdfDoc = await openPdfFromArrayBuffer(arrayBuffer);
      finishProcessEvent(parseTask, "解析完成，共 " + (pdfDoc.numPages || 0) + " 页。");
    } catch (error) {
      failProcessEvent(parseTask, error, "PDF 解析失败。");
      throw error;
    }
    var thumbnail = "";
    var coverTask = startProcessEvent("生成封面", file.name);

    try {
      thumbnail = await renderThumbnail(pdfDoc);
      finishProcessEvent(coverTask, "已生成首屏缩略封面。");
    } catch (error) {
      console.warn("封面生成失败", error);
      failProcessEvent(coverTask, error, "封面生成失败，继续导入 PDF。");
      thumbnail = existing ? existing.thumbnail || "" : "";
    }

    var title = cleanPdfTitle(file.name);
    var now = Date.now();
    var book = {
      blob: file.slice(0, file.size, "application/pdf"),
      chapterNumber: extractChapterNumber(file.name),
      fileName: file.name,
      id: id,
      importedAt: existing ? existing.importedAt : now,
      lastModified: file.lastModified || 0,
      pageCount: pdfDoc.numPages || 0,
      size: file.size || 0,
      thumbnail: thumbnail,
      title: title,
      updatedAt: now
    };

    var cacheTask = startProcessEvent("写入缓存", title);
    try {
      await putValue(BOOK_STORE, book);
      finishProcessEvent(cacheTask, "PDF 已保存到浏览器缓存。");
      setProcessStats({
        cache: "已缓存：" + title
      });
    } catch (error) {
      failProcessEvent(cacheTask, error, "缓存写入失败。");
      throw error;
    }

    if (pdfDoc.destroy) {
      await pdfDoc.destroy();
    }
  }

  async function refreshLibrary(manual) {
    var positions = await getAll(POSITION_STORE);
    var cacheRecords = await getAll(CHAPTER_CACHE_STORE);
    var positionMap = {};
    var cacheMap = {};

    positions.forEach(function (position) {
      positionMap[position.bookId] = position;
    });
    cacheRecords.forEach(function (record) {
      cacheMap[record.bookId] = record;
    });

    state.positions = positionMap;
    state.cacheMeta = cacheMap;

    try {
      var catalog = await fetchChapterCatalog();
      var books = catalog.chapters.map(function (chapter) {
        var cacheMeta = cacheMap[chapter.id];
        return Object.assign({}, chapter, {
          importedAt: chapter.mtime || Date.now(),
          pageCount: cacheMeta && cacheMeta.pageCount ? cacheMeta.pageCount : chapter.pageCount || 0,
          updatedAt: chapter.mtime || Date.now()
        });
      });
      books.sort(compareBooks);
      state.catalogVersion = catalog.version || "";
      state.books = books;
      state.chapterSequence = books.slice();
      pruneCacheSelection();
      renderLibrary();
      renderChapterList();
      updateChapterControls();
      if (manual) {
        addProcessEvent("done", "刷新章节", "已同步 " + books.length + " 个章节。");
        toast("已刷新章节。");
      }
    } catch (error) {
      console.error(error);
      addProcessEvent("error", "刷新章节失败", errorMessage(error));
      if (!state.books.length) {
        renderLibrary();
      }
      toast("章节同步失败，请确认已生成静态目录或阅读器服务正在运行。");
    }
  }

  async function fetchChapterCatalog() {
    var urls = catalogCandidateUrls();
    var errors = [];

    for (var index = 0; index < urls.length; index += 1) {
      var url = urls[index];
      try {
        var response = await fetch(url, {
          cache: "no-store"
        });
        if (!response.ok) {
          errors.push(url + " 返回 " + response.status);
          continue;
        }
        return normalizeCatalog(await response.json(), url);
      } catch (error) {
        errors.push(url + " " + errorMessage(error));
      }
    }

    throw new Error(errors.join("；") || "章节目录不可用");
  }

  function catalogCandidateUrls() {
    var remoteUrl = getRemoteCatalogUrl();
    var urls;
    if (isAndroidAssetHost() && remoteUrl) {
      urls = [remoteUrl, STATIC_CATALOG_URL];
    } else if (shouldPreferStaticCatalog()) {
      urls = remoteUrl ? [STATIC_CATALOG_URL, remoteUrl, API_CATALOG_URL] : [STATIC_CATALOG_URL, API_CATALOG_URL];
    } else {
      urls = remoteUrl ? [API_CATALOG_URL, STATIC_CATALOG_URL, remoteUrl] : [API_CATALOG_URL, STATIC_CATALOG_URL];
    }
    return uniqueUrls(urls);
  }

  function uniqueUrls(urls) {
    var seen = new Set();
    return urls.filter(function (url) {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
  }

  function getRemoteCatalogUrl() {
    return String(window.GUZHENREN_REMOTE_CATALOG_URL || "").trim();
  }

  function isAndroidAssetHost() {
    return location.hostname === ANDROID_ASSET_HOST;
  }

  function shouldPreferStaticCatalog() {
    var host = location.hostname;
    return Boolean(window.GUZHENREN_STATIC_BUILD) ||
      location.protocol === "file:" ||
      (host && host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]");
  }

  function normalizeCatalog(catalog, catalogUrl) {
    if (!catalog || !Array.isArray(catalog.chapters)) {
      throw new Error("章节目录格式不正确");
    }
    catalog.chapters = catalog.chapters.map(function (chapter) {
      return Object.assign({}, chapter, {
        downloadUrl: resolveCatalogResourceUrl(catalogUrl, chapter.downloadUrl || chapter.pdfUrl || ""),
        pdfUrl: resolveCatalogResourceUrl(catalogUrl, chapter.pdfUrl || chapter.downloadUrl || ""),
        title: chapter.title || cleanPdfTitle(chapter.fileName || "漫画.pdf")
      });
    });
    return catalog;
  }

  function resolveCatalogResourceUrl(catalogUrl, value) {
    if (!value || !isAbsoluteHttpUrl(catalogUrl) || isAbsoluteResourceUrl(value) || value.charAt(0) === "/") {
      return value;
    }
    var baseUrl = catalogSiteBaseUrl(catalogUrl);
    if (!baseUrl) return value;
    try {
      return new URL(value, baseUrl).href;
    } catch (error) {
      return value;
    }
  }

  function catalogSiteBaseUrl(catalogUrl) {
    var cleaned = String(catalogUrl || "").replace(/[?#].*$/, "");
    if (/\/data\/chapters\.json$/i.test(cleaned)) {
      return cleaned.replace(/\/data\/chapters\.json$/i, "/");
    }
    try {
      return new URL("./", catalogUrl).href;
    } catch (error) {
      return "";
    }
  }

  function isAbsoluteHttpUrl(value) {
    return /^https?:\/\//i.test(String(value || ""));
  }

  function isAbsoluteResourceUrl(value) {
    return /^(https?:|blob:|data:)/i.test(String(value || ""));
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    var host = location.hostname;
    var canRegister = location.protocol === "https:" ||
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]";
    if (!canRegister) return;
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("./sw.js").catch(function (error) {
        console.warn("Service worker registration failed", error);
      });
    });
  }

  function renderLibrary() {
    var totalSize = state.books.reduce(function (sum, book) {
      return sum + (book.size || 0);
    }, 0);
    var recent = getRecentBook();
    var viewMode = normalizedLibraryViewMode(state.settings.libraryViewMode);

    el.shelfMeta.textContent = state.books.length ? "已同步 " + state.books.length + " 章 · " + formatSize(totalSize) : "等待同步章节";
    el.storageMeta.textContent = state.books.length + " 章 · " + formatSize(totalSize);
    el.bookGrid.innerHTML = "";
    updateViewModeControls();
    el.emptyState.classList.toggle("visible", state.books.length === 0);
    el.resumeButton.hidden = !recent;

    if (recent) {
      el.resumeButton.onclick = function () {
        goToReader(recent.id);
      };
      el.continueSection.hidden = false;
      renderContinueCard(recent);
    } else {
      el.continueSection.hidden = true;
      el.continueCard.innerHTML = "";
    }

    state.books.forEach(function (book) {
      el.bookGrid.appendChild(viewMode === "list" ? createBookListItem(book) : createBookCard(book));
    });
    updateCacheActionState();
  }

  function normalizedLibraryViewMode(mode) {
    return mode === "list" ? "list" : "icon";
  }

  async function setLibraryViewMode(mode) {
    var nextMode = normalizedLibraryViewMode(mode);
    var currentMode = normalizedLibraryViewMode(state.settings.libraryViewMode);

    showViewModeMenu(false);
    if (nextMode === currentMode) {
      updateViewModeControls();
      return;
    }

    await updateSettings({ libraryViewMode: nextMode });
    renderLibrary();
  }

  function showViewModeMenu(show) {
    if (!el.viewModeButton || !el.viewModeMenu) return;
    el.viewModeMenu.hidden = !show;
    el.viewModeButton.classList.toggle("active", Boolean(show));
    el.viewModeButton.setAttribute("aria-expanded", String(Boolean(show)));
  }

  function updateViewModeControls() {
    var mode = normalizedLibraryViewMode(state.settings.libraryViewMode);

    if (el.bookGrid) {
      el.bookGrid.classList.toggle("icon-mode", mode === "icon");
      el.bookGrid.classList.toggle("list-mode", mode === "list");
    }
    if (el.viewModeButton) {
      el.viewModeButton.title = mode === "list" ? "当前为列表模式" : "当前为图标模式";
      el.viewModeButton.setAttribute("aria-label", mode === "list" ? "当前为列表模式，点击切换" : "当前为图标模式，点击切换");
    }
    if (el.viewModeOptions) {
      el.viewModeOptions.forEach(function (button) {
        var active = normalizedLibraryViewMode(button.dataset.viewMode) === mode;
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
      });
    }
  }

  function getRecentBook() {
    if (!state.books.length) return null;
    return state.books
      .slice()
      .sort(function (left, right) {
        var leftPosition = state.positions[left.id];
        var rightPosition = state.positions[right.id];
        var leftTime = leftPosition ? leftPosition.updatedAt || 0 : left.updatedAt || 0;
        var rightTime = rightPosition ? rightPosition.updatedAt || 0 : right.updatedAt || 0;
        return rightTime - leftTime;
      })[0];
  }

  function renderContinueCard(book) {
    var position = normalizedPosition(book.id);
    var displayProgress = displayProgressForPosition(position);
    el.continueCard.innerHTML = "";
    el.continueCard.appendChild(createCover(book, "continue-cover"));

    var info = document.createElement("div");
    info.className = "continue-info";

    var title = document.createElement("h2");
    title.textContent = book.title;

    var meta = document.createElement("p");
    meta.textContent = "第 " + (position.pageNumber || 1) + " 页 · " + formatPercent(displayProgress) + " · " + cacheStatusLabel(book.id);

    var track = document.createElement("div");
    track.className = "progress-track";
    var value = document.createElement("div");
    value.className = "progress-value";
    value.style.width = formatPercent(displayProgress);
    track.appendChild(value);

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(track);
    el.continueCard.appendChild(info);
    el.continueCard.onclick = function () {
      goToReader(book.id);
    };
  }

  function createBookCard(book) {
    var position = normalizedPosition(book.id);
    var displayProgress = displayProgressForPosition(position);
    var card = document.createElement("button");
    card.className = "book-card";
    card.type = "button";
    card.dataset.id = book.id;
    card.appendChild(createCover(book, "book-cover"));

    var info = document.createElement("div");
    info.className = "book-info";

    var title = document.createElement("h3");
    title.textContent = book.title;

    var meta = document.createElement("div");
    meta.className = "book-meta";
    meta.textContent = chapterLabel(book) + " · " + pageCountLabel(book) + " · " + formatSize(book.size || 0);

    var progress = document.createElement("div");
    progress.className = "book-progress";
    var progressValue = document.createElement("div");
    progressValue.className = "progress-value";
    progressValue.style.width = formatPercent(displayProgress);
    progress.appendChild(progressValue);

    var progressText = document.createElement("div");
    progressText.className = "book-progress-text";
    progressText.textContent = formatPercent(displayProgress) + " · 上次第 " + (position.pageNumber || 1) + " 页 · " + cacheStatusLabel(book.id);

    info.appendChild(title);
    info.appendChild(meta);
    info.appendChild(progress);
    info.appendChild(progressText);
    card.appendChild(info);
    card.addEventListener("click", function () {
      goToReader(book.id);
    });

    return card;
  }

  function createBookListItem(book) {
    var card = document.createElement("button");
    card.className = "book-list-item";
    card.type = "button";
    card.dataset.id = book.id;

    var title = document.createElement("h3");
    title.className = "book-list-title";
    title.textContent = book.title;

    var meta = document.createElement("div");
    meta.className = "book-list-meta";
    meta.textContent = chapterLabel(book) + " · " + formatSize(book.size || 0) + " · " + formatDateTime(book.mtime || book.updatedAt || book.importedAt);

    card.appendChild(title);
    card.appendChild(meta);
    card.addEventListener("click", function () {
      goToReader(book.id);
    });

    return card;
  }

  function createCover(book, className) {
    var cover = document.createElement("div");
    cover.className = className;

    if (book.thumbnail) {
      var img = document.createElement("img");
      img.alt = book.title + " 封面";
      img.loading = "lazy";
      img.src = book.thumbnail;
      cover.appendChild(img);
    } else {
      var fallback = document.createElement("div");
      fallback.className = "cover-fallback";
      fallback.textContent = chapterLabel(book);
      cover.appendChild(fallback);
    }

    return cover;
  }

  function goToReader(bookId, scrollMode) {
    state.pendingScrollMode = scrollMode || "restore";
    var nextHash = "#reader=" + encodeURIComponent(bookId);
    if (location.hash === nextHash) {
      openReader(bookId);
    } else {
      location.hash = nextHash;
    }
  }

  function replaceReaderHash(bookId) {
    var nextHash = "#reader=" + encodeURIComponent(bookId);
    if (location.hash !== nextHash) {
      history.replaceState(null, "", nextHash);
    }
  }

  function handleRoute() {
    var match = location.hash.match(/^#reader=(.+)$/);
    if (match) {
      openReader(decodeURIComponent(match[1]));
    } else {
      showLibrary();
    }
  }

  async function openReader(bookId) {
    await cleanupReader(false);
    var session = state.readerSession + 1;
    state.readerSession = session;
    var openTask = startProcessEvent("进入阅读", "正在读取书架缓存。");

    var book = getBookById(bookId);
    if (!book) {
      failProcessEvent(openTask, new Error("Not found"), "没有找到这本漫画。");
      toast("没有找到这本漫画。");
      location.hash = "";
      return;
    }

    state.currentBook = book;
    state.lastSaveAt = 0;
    state.lastPositionLogAt = 0;
    state.renderedPages = new Set();
    state.renderingPages = new Set();
    updateProcessEvent(openTask, {
      detail: "正在打开 " + book.title,
      status: "running"
    });
    setProcessStats({
      render: "等待渲染"
    });
    el.readerTitle.textContent = book.title;
    el.readerMeta.textContent = "正在打开";
    el.readerProgressBar.style.width = "0%";
    el.readerLoading.classList.remove("hidden");
    el.readerLoading.querySelector("p").textContent = "正在打开漫画";
    el.pagesContainer.innerHTML = "";
    showReader();

    try {
      await openReaderContinuous(book, session, openTask);
      return;

      var cacheReadTask = startProcessEvent("读取缓存", book.title);
      var arrayBuffer = await book.blob.arrayBuffer();
      finishProcessEvent(cacheReadTask, "已从浏览器缓存读取 PDF。");

      var pdfOpenTask = startProcessEvent("解析 PDF", book.title);
      var pdfDoc = await openPdfFromArrayBuffer(arrayBuffer);
      finishProcessEvent(pdfOpenTask, "解析完成，共 " + (pdfDoc.numPages || 0) + " 页。");
      if (session !== state.readerSession) {
        if (pdfDoc.destroy) await pdfDoc.destroy();
        finishProcessEvent(openTask, "已切换到新的阅读任务。");
        return;
      }

      state.currentPdf = pdfDoc;
      var layoutTask = startProcessEvent("页面排版", book.title);
      state.pages = await preparePageModels(pdfDoc);
      finishProcessEvent(layoutTask, "已建立 " + state.pages.length + " 个页面占位。");
      setProcessStats({
        render: "0 / " + state.pages.length
      });
      if (!book.pageCount || book.pageCount !== pdfDoc.numPages) {
        book.pageCount = pdfDoc.numPages;
        await putValue(BOOK_STORE, book);
      }

      buildReaderPages();
      el.readerLoading.classList.add("hidden");
      setupPageObserver();
      restoreReaderPosition(bookId);
      updateReaderProgress();
      renderVisiblePages();
      finishProcessEvent(openTask, "阅读页已准备完成。");
    } catch (error) {
      console.error(error);
      failProcessEvent(openTask, error, "PDF 打开失败，请重新导入。");
      el.readerLoading.querySelector("p").textContent = "PDF 打开失败";
      toast("PDF 打开失败，请重新导入。");
    }
  }

  async function openReaderContinuous(book, session, openTask) {
    var scrollMode = state.pendingScrollMode || "restore";
    state.pendingScrollMode = "restore";
    state.autoAppendInFlight = false;
    state.autoPrependInFlight = false;
    state.currentBook = book;
    state.currentVisibleBookId = book.id;
    state.currentPdf = null;
    state.loadedChapters = [];
    state.loadedBookIds = new Set();
    state.pages = [];
    state.renderedPages = new Set();
    state.renderingPages = new Set();
    el.pagesContainer.innerHTML = "";

    await appendChapterToStream(book, {
      reason: "open",
      session: session
    });

    if (session !== state.readerSession) return;

    el.readerLoading.classList.add("hidden");
    setupPageObserver();
    updateChapterControls();
    renderChapterList();

    if (scrollMode === "start") {
      jumpToChapter(book.id, 0, true);
    } else if (scrollMode === "end") {
      jumpToChapterEnd(book.id, true);
    } else {
      restoreReaderPosition(book.id);
    }

    updateReaderProgress();
    renderVisiblePages();
    finishProcessEvent(openTask, "阅读页已准备完成。");
  }

  async function appendChapterToStream(book, options) {
    var settings = options || {};
    if (!book || state.loadedBookIds.has(book.id)) {
      return getLoadedChapter(book && book.id);
    }

    var taskTitle = settings.reason === "auto" ? "自动衔接下一章" : "加载章节";
    var task = startProcessEvent(taskTitle, book.title);
    var preserveScrollTop = settings.reason === "auto"
      ? Math.max(0, Math.round(settings.preserveScrollTop != null ? settings.preserveScrollTop : el.readerScroll.scrollTop || 0))
      : null;

    try {
      var cachedPages = await prepareCachedPageModels(book);
      if (cachedPages) {
        var cachedChapter = {
          book: book,
          pdfDoc: null,
          pages: cachedPages
        };
        state.loadedChapters.push(cachedChapter);
        state.loadedBookIds.add(book.id);
        state.pages = state.pages.concat(cachedPages);
        appendChapterElements(cachedChapter);
        if (preserveScrollTop !== null) {
          el.readerScroll.scrollTop = preserveScrollTop;
        }
        observeChapterPages(cachedChapter);
        finishProcessEvent(task, "已从页面缓存接入 " + cachedPages.length + " 页。");
        setProcessStats({
          cache: "使用缓存：" + book.title,
          render: state.renderedPages.size + " / " + state.pages.length
        });
        updateChapterControls();
        renderChapterList();
        return cachedChapter;
      }

      var arrayBuffer = await fetchPdfArrayBuffer(book);
      var pdfDoc = await openPdfFromArrayBuffer(arrayBuffer);

      if (settings.session && settings.session !== state.readerSession) {
        if (pdfDoc.destroy) await pdfDoc.destroy();
        return null;
      }

      var pages = await preparePageModels(pdfDoc, book);
      var chapter = {
        book: book,
        pdfDoc: pdfDoc,
        pages: pages
      };

      if (!book.pageCount || book.pageCount !== pdfDoc.numPages) {
        book.pageCount = pdfDoc.numPages;
      }

      state.loadedChapters.push(chapter);
      state.loadedBookIds.add(book.id);
      state.pages = state.pages.concat(pages);
      if (!state.currentPdf) state.currentPdf = pdfDoc;

      appendChapterElements(chapter);
      if (preserveScrollTop !== null) {
        el.readerScroll.scrollTop = preserveScrollTop;
        window.requestAnimationFrame(function () {
          if (!settings.session || settings.session === state.readerSession) {
            el.readerScroll.scrollTop = preserveScrollTop;
          }
        });
      }
      observeChapterPages(chapter);
      finishProcessEvent(task, "已接入 " + pages.length + " 页。");
      setProcessStats({
        render: state.renderedPages.size + " / " + state.pages.length
      });
      updateChapterControls();
      renderChapterList();
      return chapter;
    } catch (error) {
      failProcessEvent(task, error, "章节加载失败：" + book.title);
      throw error;
    }
  }

  async function prependChapterToStream(book, options) {
    var settings = options || {};
    if (!book || state.loadedBookIds.has(book.id)) {
      return getLoadedChapter(book && book.id);
    }

    var taskTitle = settings.reason === "auto" ? "自动衔接上一章" : "加载章节";
    var task = startProcessEvent(taskTitle, book.title);
    var nextChapter = state.loadedChapters[0] || null;
    var beforeHeight = el.readerScroll.scrollHeight;
    var beforeTop = Math.max(0, Math.round(el.readerScroll.scrollTop || 0));
    var wheelDelta = Math.round(Number(settings.wheelDelta || 0));

    function preserveViewportAfterPrepend() {
      var addedHeight = Math.max(0, el.readerScroll.scrollHeight - beforeHeight);
      var maxScrollTop = Math.max(0, el.readerScroll.scrollHeight - el.readerScroll.clientHeight);
      var targetTop = beforeTop + addedHeight + wheelDelta;
      el.readerScroll.scrollTop = clamp(Math.round(targetTop), 0, maxScrollTop);
    }

    try {
      var cachedPages = await prepareCachedPageModels(book);
      if (cachedPages) {
        var cachedChapter = {
          book: book,
          pdfDoc: null,
          pages: cachedPages
        };
        state.loadedChapters.unshift(cachedChapter);
        state.loadedBookIds.add(book.id);
        state.pages = cachedPages.concat(state.pages);
        prependChapterElements(cachedChapter, nextChapter && nextChapter.book);
        preserveViewportAfterPrepend();
        window.requestAnimationFrame(function () {
          if (!settings.session || settings.session === state.readerSession) {
            preserveViewportAfterPrepend();
            syncReaderViewport();
          }
        });
        observeChapterPages(cachedChapter);
        finishProcessEvent(task, "已从页面缓存接入 " + cachedPages.length + " 页。");
        setProcessStats({
          cache: "使用缓存：" + book.title,
          render: state.renderedPages.size + " / " + state.pages.length
        });
        updateChapterControls();
        renderChapterList();
        return cachedChapter;
      }

      var arrayBuffer = await fetchPdfArrayBuffer(book);
      var pdfDoc = await openPdfFromArrayBuffer(arrayBuffer);

      if (settings.session && settings.session !== state.readerSession) {
        if (pdfDoc.destroy) await pdfDoc.destroy();
        return null;
      }

      var pages = await preparePageModels(pdfDoc, book);
      var chapter = {
        book: book,
        pdfDoc: pdfDoc,
        pages: pages
      };

      if (!book.pageCount || book.pageCount !== pdfDoc.numPages) {
        book.pageCount = pdfDoc.numPages;
      }

      state.loadedChapters.unshift(chapter);
      state.loadedBookIds.add(book.id);
      state.pages = pages.concat(state.pages);
      if (!state.currentPdf) state.currentPdf = pdfDoc;

      prependChapterElements(chapter, nextChapter && nextChapter.book);
      preserveViewportAfterPrepend();
      window.requestAnimationFrame(function () {
        if (!settings.session || settings.session === state.readerSession) {
          preserveViewportAfterPrepend();
          syncReaderViewport();
        }
      });
      observeChapterPages(chapter);
      finishProcessEvent(task, "已接入 " + pages.length + " 页。");
      setProcessStats({
        render: state.renderedPages.size + " / " + state.pages.length
      });
      updateChapterControls();
      renderChapterList();
      return chapter;
    } catch (error) {
      failProcessEvent(task, error, "章节加载失败：" + book.title);
      throw error;
    }
  }

  function appendChapterElements(chapter) {
    var fragment = document.createDocumentFragment();
    var displayWidth = getDisplayWidth();
    var isFirstChapter = state.loadedChapters.length === 1;

    if (!isFirstChapter) {
      fragment.appendChild(createChapterDivider(chapter.book));
    }

    appendPageShells(fragment, chapter.pages, displayWidth);
    el.pagesContainer.appendChild(fragment);
  }

  function prependChapterElements(chapter, nextBook) {
    var fragment = document.createDocumentFragment();
    var displayWidth = getDisplayWidth();

    appendPageShells(fragment, chapter.pages, displayWidth);
    if (nextBook) {
      fragment.appendChild(createChapterDivider(nextBook));
    }

    el.pagesContainer.insertBefore(fragment, el.pagesContainer.firstChild);
  }

  function appendPageShells(fragment, pages, displayWidth) {
    pages.forEach(function (page) {
      fragment.appendChild(createPageShell(page, displayWidth));
    });
  }

  function createPageShell(page, displayWidth) {
    page.displayWidth = displayWidth;
    page.displayHeight = Math.round(displayWidth * page.naturalHeight / page.naturalWidth);
    page.status = "pending";

    var shell = document.createElement("div");
    shell.className = "page-shell";
    shell.dataset.pageKey = page.pageKey;
    shell.dataset.bookId = page.bookId;
    shell.dataset.pageNumber = String(page.pageNumber);
    shell.style.width = page.displayWidth + "px";
    shell.style.height = page.displayHeight + "px";
    shell.style.marginBottom = state.settings.pageGap + "px";

    var canvas = document.createElement("canvas");
    canvas.className = "pdf-canvas";
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.width = page.displayWidth + "px";
    canvas.style.height = page.displayHeight + "px";

    var status = document.createElement("div");
    status.className = "page-state";
    status.textContent = "第 " + page.pageNumber + " 页";

    shell.appendChild(canvas);
    shell.appendChild(status);
    return shell;
  }

  function createChapterDivider(book) {
    var divider = document.createElement("div");
    divider.className = "chapter-divider";
    divider.dataset.bookId = book.id;

    var title = document.createElement("div");
    title.className = "chapter-divider-title";
    title.textContent = book.title;

    var meta = document.createElement("div");
    meta.className = "chapter-divider-meta";
    meta.textContent = chapterLabel(book) + " · 继续阅读";

    divider.appendChild(title);
    divider.appendChild(meta);
    return divider;
  }

  function observeChapterPages(chapter) {
    if (!state.observer || !chapter) return;
    chapter.pages.forEach(function (page) {
      var shell = pageShell(page.pageKey);
      if (shell) state.observer.observe(shell);
    });
  }

  function getLoadedChapter(bookId) {
    return state.loadedChapters.find(function (chapter) {
      return chapter.book.id === bookId;
    }) || null;
  }

  function getBookById(bookId) {
    return state.chapterSequence.find(function (book) {
      return book.id === bookId;
    }) || state.books.find(function (book) {
      return book.id === bookId;
    }) || null;
  }

  function getChapterIndex(bookId) {
    return state.chapterSequence.findIndex(function (book) {
      return book.id === bookId;
    });
  }

  function getAdjacentBook(bookId, direction) {
    var index = getChapterIndex(bookId);
    if (index < 0) return null;
    return state.chapterSequence[index + direction] || null;
  }

  function navigateRelativeChapter(direction) {
    var baseId = state.currentVisibleBookId || (state.currentBook && state.currentBook.id);
    var target = getAdjacentBook(baseId, direction);
    if (!target) return;
    addProcessEvent("done", direction > 0 ? "切换下一章" : "切换上一章", target.title);
    goToReader(target.id, direction > 0 ? "start" : "end");
  }

  function showChapterPanel(show) {
    el.chapterPanel.hidden = false;
    el.chapterBackdrop.hidden = !show;
    el.chapterPanel.classList.toggle("visible", show);
    el.chapterPanel.setAttribute("aria-hidden", String(!show));

    if (!show) {
      window.setTimeout(function () {
        if (!el.chapterPanel.classList.contains("visible")) {
          el.chapterPanel.hidden = true;
        }
      }, 200);
    }
  }

  function renderChapterList() {
    if (!el.chapterList) return;
    el.chapterList.innerHTML = "";

    if (!state.chapterSequence.length) {
      var empty = document.createElement("div");
      empty.className = "process-empty";
      empty.textContent = "还没有导入章节。";
      el.chapterList.appendChild(empty);
      return;
    }

    state.chapterSequence.forEach(function (book) {
      var position = normalizedPosition(book.id);
      var displayProgress = displayProgressForPosition(position);
      var option = document.createElement("div");
      option.className = "chapter-option";
      option.classList.toggle("active", book.id === state.currentVisibleBookId || (state.currentBook && book.id === state.currentBook.id));
      option.classList.toggle("selected", state.cacheSelection.has(book.id));

      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "chapter-cache-check";
      checkbox.checked = state.cacheSelection.has(book.id);
      checkbox.setAttribute("aria-label", "选择缓存 " + book.title);
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) {
          state.cacheSelection.add(book.id);
        } else {
          state.cacheSelection.delete(book.id);
        }
        renderChapterList();
        renderLibrary();
        updateCacheActionState();
      });

      var main = document.createElement("button");
      main.type = "button";
      main.className = "chapter-option-main";
      var title = document.createElement("div");
      title.className = "chapter-option-title";
      title.textContent = book.title;
      var meta = document.createElement("div");
      meta.className = "chapter-option-meta";
      meta.textContent = chapterLabel(book) + " · 第 " + (position.pageNumber || 1) + " 页 · " + cacheStatusLabel(book.id);

      var status = document.createElement("div");
      status.className = "chapter-option-status";
      status.textContent = formatPercent(displayProgress);

      main.appendChild(title);
      main.appendChild(meta);
      main.addEventListener("click", function () {
        addProcessEvent("done", "选择章节", book.title);
        showChapterPanel(false);
        goToReader(book.id, "restore");
      });
      option.appendChild(checkbox);
      option.appendChild(main);
      option.appendChild(status);

      el.chapterList.appendChild(option);
    });
    updateCacheActionState();
  }

  function updateChapterControls() {
    if (!el.prevChapterButton || !el.nextChapterButton) return;
    var baseId = state.currentVisibleBookId || (state.currentBook && state.currentBook.id);
    var previous = getAdjacentBook(baseId, -1);
    var next = getAdjacentBook(baseId, 1);
    el.prevChapterButton.disabled = !previous;
    el.nextChapterButton.disabled = !next;
    el.prevChapterButton.title = previous ? previous.title : "没有上一章";
    el.nextChapterButton.title = next ? next.title : "没有下一章";
  }

  function isAutoChapterLoadInFlight() {
    return state.autoAppendInFlight || state.autoPrependInFlight;
  }

  function maybeAutoAppendNextChapter() {
    if (isAutoChapterLoadInFlight() || !state.loadedChapters.length) return;
    var distanceToEnd = el.readerScroll.scrollHeight - (el.readerScroll.scrollTop + el.readerScroll.clientHeight);
    if (distanceToEnd > Math.max(700, el.readerScroll.clientHeight * 0.75)) return;

    var lastChapter = state.loadedChapters[state.loadedChapters.length - 1];
    var next = getAdjacentBook(lastChapter.book.id, 1);
    if (!next || state.loadedBookIds.has(next.id)) return;

    state.autoAppendInFlight = true;
    var preserveScrollTop = el.readerScroll.scrollTop;
    appendChapterToStream(next, {
      preserveScrollTop: preserveScrollTop,
      reason: "auto",
      session: state.readerSession
    }).then(function () {
      addProcessEvent("done", "已自动衔接", next.title);
      renderVisiblePages();
    }).catch(function (error) {
      console.error(error);
      addProcessEvent("error", "自动衔接失败", errorMessage(error));
    }).finally(function () {
      state.autoAppendInFlight = false;
    });
  }

  function maybeAutoPrependPreviousChapter(wheelDelta) {
    if (isAutoChapterLoadInFlight() || !state.loadedChapters.length) return;
    if (el.readerScroll.scrollTop > 2) return;

    var firstChapter = state.loadedChapters[0];
    var previous = getAdjacentBook(firstChapter.book.id, -1);
    if (!previous || state.loadedBookIds.has(previous.id)) return;

    state.autoPrependInFlight = true;
    prependChapterToStream(previous, {
      reason: "auto",
      session: state.readerSession,
      wheelDelta: wheelDelta || 0
    }).then(function () {
      addProcessEvent("done", "已自动衔接上一章", previous.title);
      renderVisiblePages();
    }).catch(function (error) {
      console.error(error);
      addProcessEvent("error", "自动衔接上一章失败", errorMessage(error));
    }).finally(function () {
      state.autoPrependInFlight = false;
    });
  }

  function showReader() {
    el.libraryView.hidden = true;
    el.readerView.hidden = false;
    document.body.classList.add("reader-mode");
    applySettings();
  }

  async function showLibrary() {
    await cleanupReader(true);
    el.readerView.hidden = true;
    el.libraryView.hidden = false;
    document.body.classList.remove("reader-mode");
    showSettings(false);
    await refreshLibrary();
  }

  async function cleanupReader(saveFirst) {
    if (saveFirst) {
      await persistPosition(true);
    }
    state.readerSession += 1;
    if (state.observer) {
      state.observer.disconnect();
      state.observer = null;
    }
    if (state.currentPdf && state.currentPdf.destroy) {
      try {
        await state.currentPdf.destroy();
      } catch (error) {
        console.warn(error);
      }
    }
    for (var index = 0; index < state.loadedChapters.length; index += 1) {
      var chapter = state.loadedChapters[index];
      if (chapter.pdfDoc && chapter.pdfDoc !== state.currentPdf && chapter.pdfDoc.destroy) {
        try {
          await chapter.pdfDoc.destroy();
        } catch (error) {
          console.warn(error);
        }
      }
    }
    state.currentPdf = null;
    state.currentBook = null;
    state.currentVisibleBookId = "";
    state.autoAppendInFlight = false;
    state.autoPrependInFlight = false;
    state.loadedChapters = [];
    state.loadedBookIds = new Set();
    state.pages = [];
    state.renderedPages = new Set();
    state.renderingPages = new Set();
    el.pagesContainer.innerHTML = "";
  }

  async function openPdfFromArrayBuffer(arrayBuffer) {
    var options = Object.assign({}, PDF_OPTIONS_BASE, {
      data: new Uint8Array(arrayBuffer),
      disableWorker: location.protocol === "file:"
    });
    return window.pdfjsLib.getDocument(options).promise;
  }

  async function preparePageModels(pdfDoc, book) {
    var pages = [];
    var owner = book || state.currentBook || {
      id: "single",
      title: "漫画"
    };
    for (var pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      var page = await pdfDoc.getPage(pageNumber);
      var viewport = page.getViewport({ scale: 1 });
      pages.push({
        bookId: owner.id,
        bookTitle: owner.title,
        displayHeight: 0,
        displayWidth: 0,
        naturalHeight: viewport.height,
        naturalWidth: viewport.width,
        pageKey: owner.id + "__" + pageNumber,
        pageNumber: pageNumber,
        status: "pending"
      });
      if (page.cleanup) page.cleanup();
    }
    return pages;
  }

  function buildReaderPages() {
    var fragment = document.createDocumentFragment();
    var displayWidth = getDisplayWidth();
    var previousBookId = "";

    state.pages.forEach(function (page) {
      if (previousBookId && previousBookId !== page.bookId) {
        var dividerBook = getBookById(page.bookId);
        if (dividerBook) fragment.appendChild(createChapterDivider(dividerBook));
      }
      previousBookId = page.bookId;

      fragment.appendChild(createPageShell(page, displayWidth));
    });

    el.pagesContainer.innerHTML = "";
    el.pagesContainer.appendChild(fragment);
  }

  function setupPageObserver() {
    if (state.observer) {
      state.observer.disconnect();
    }

    state.observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          renderPage(entry.target.dataset.pageKey);
        }
      });
    }, {
      root: el.readerScroll,
      rootMargin: "900px 0px",
      threshold: 0.01
    });

    el.pagesContainer.querySelectorAll(".page-shell").forEach(function (shell) {
      state.observer.observe(shell);
    });
  }

  async function renderPage(pageKey) {
    if (!pageKey || state.renderedPages.has(pageKey) || state.renderingPages.has(pageKey)) return;

    var pageInfo = state.pages.find(function (page) {
      return page.pageKey === pageKey;
    });
    var shell = pageShell(pageKey);
    if (!pageInfo || !shell) return;
    var chapter = getLoadedChapter(pageInfo.bookId);
    var pdfDoc = chapter ? chapter.pdfDoc : state.currentPdf;

    var canvas = shell.querySelector("canvas");
    var status = shell.querySelector(".page-state");
    state.renderingPages.add(pageKey);
    pageInfo.status = "rendering";
    status.textContent = "正在渲染";
    var renderTask = startProcessEvent("渲染页面", pageInfo.bookTitle + " · 第 " + pageInfo.pageNumber + " 页");

    try {
      var cacheHit = await drawCachedPage(pageInfo, canvas);
      if (cacheHit) {
        state.renderedPages.add(pageKey);
        pageInfo.status = "rendered";
        status.remove();
        finishProcessEvent(renderTask, "已读取页面缓存。");
        setProcessStats({
          render: state.renderedPages.size + " / " + state.pages.length
        });
        return;
      }
      if (!pdfDoc) {
        throw new Error("没有可用的 PDF 或页面缓存。");
      }
      var page = await pdfDoc.getPage(pageInfo.pageNumber);
      var scale = pageInfo.displayWidth / pageInfo.naturalWidth;
      var viewport = page.getViewport({ scale: scale });
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      var context = canvas.getContext("2d", { alpha: false });

      canvas.width = Math.max(1, Math.floor(pageInfo.displayWidth * dpr));
      canvas.height = Math.max(1, Math.floor(pageInfo.displayHeight * dpr));
      canvas.style.width = pageInfo.displayWidth + "px";
      canvas.style.height = pageInfo.displayHeight + "px";

      if (context.setTransform) {
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
      } else {
        context.scale(dpr, dpr);
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, pageInfo.displayWidth, pageInfo.displayHeight);

      await page.render({
        canvasContext: context,
        viewport: viewport
      }).promise;

      state.renderedPages.add(pageKey);
      pageInfo.status = "rendered";
      status.remove();
      finishProcessEvent(renderTask, "已渲染 " + state.renderedPages.size + " / " + state.pages.length + " 页。");
      setProcessStats({
        render: state.renderedPages.size + " / " + state.pages.length
      });
      if (page.cleanup) page.cleanup();
    } catch (error) {
      console.error(error);
      pageInfo.status = "error";
      status.classList.add("error");
      status.textContent = "本页渲染失败";
      failProcessEvent(renderTask, error, "第 " + pageInfo.pageNumber + " 页渲染失败。");
    } finally {
      state.renderingPages.delete(pageKey);
    }
  }

  function renderVisiblePages() {
    var scrollTop = el.readerScroll.scrollTop;
    var viewTop = scrollTop - el.readerScroll.clientHeight * 0.4;
    var viewBottom = scrollTop + el.readerScroll.clientHeight * 1.8;

    state.pages.forEach(function (page) {
      var shell = pageShell(page.pageKey);
      if (!shell) return;
      var top = shell.offsetTop;
      var bottom = top + shell.offsetHeight;
      if (bottom >= viewTop && top <= viewBottom) {
        renderPage(page.pageKey);
      }
    });
  }

  function restoreReaderPosition(bookId) {
    var position = normalizedPosition(bookId);
    requestAnimationFrame(function () {
      jumpToChapter(bookId, position.scrollTop || 0, true);
      requestAnimationFrame(function () {
        jumpToChapter(bookId, position.scrollTop || 0, true);
      });
    });
  }

  function onReaderScroll() {
    syncReaderViewport();
    maybeAutoAppendNextChapter();
  }

  function syncReaderViewport() {
    updateReaderProgress();
    renderVisiblePages();
    persistPosition(false);
  }

  function handleReaderWheel(event) {
    if (!state.currentBook || !state.pages.length || !el.readerScroll || el.readerView.hidden) return;
    if (event.ctrlKey || shouldIgnoreReaderGesture(event.target)) return;

    var deltaY = normalizedWheelDelta(event);
    if (!deltaY) return;

    var scroll = el.readerScroll;
    var maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    var requestedTop = scroll.scrollTop + deltaY;
    var isInsideReaderScroll = scroll.contains(event.target);

    if (!isInsideReaderScroll) {
      event.preventDefault();
      scroll.scrollTop = clamp(requestedTop, 0, maxScrollTop);
      syncReaderViewport();

      if (deltaY < 0 && requestedTop <= 0) {
        maybeAutoPrependPreviousChapter(deltaY);
      } else if (deltaY > 0 && requestedTop >= maxScrollTop) {
        maybeAutoAppendNextChapter();
      }
      return;
    }

    if (deltaY < 0 && scroll.scrollTop <= 2) {
      event.preventDefault();
      maybeAutoPrependPreviousChapter(deltaY);
    } else if (deltaY > 0 && scroll.scrollTop >= maxScrollTop - 2) {
      maybeAutoAppendNextChapter();
    }
  }

  function handleReaderTouchStart(event) {
    if (!state.currentBook || !state.pages.length || !el.readerScroll || el.readerView.hidden) return;
    if (event.touches.length !== 1 || shouldIgnoreReaderGesture(event.target)) {
      resetReaderTouch();
      return;
    }

    state.touchTracking = true;
    state.touchBoundaryPull = 0;
    state.touchLastY = event.touches[0].clientY;
  }

  function handleReaderTouchMove(event) {
    if (!state.touchTracking || !state.currentBook || !state.pages.length || !el.readerScroll || el.readerView.hidden) return;
    if (event.touches.length !== 1 || shouldIgnoreReaderGesture(event.target)) {
      resetReaderTouch();
      return;
    }

    var currentY = event.touches[0].clientY;
    var movementY = currentY - state.touchLastY;
    state.touchLastY = currentY;
    if (!movementY) return;

    var scroll = el.readerScroll;
    var maxScrollTop = Math.max(0, scroll.scrollHeight - scroll.clientHeight);
    var requestedTop = scroll.scrollTop - movementY;
    var isInsideReaderScroll = scroll.contains(event.target);

    if (!isInsideReaderScroll) {
      event.preventDefault();
      scroll.scrollTop = clamp(requestedTop, 0, maxScrollTop);
      syncReaderViewport();
      handleReaderTouchBoundary(movementY, requestedTop, maxScrollTop);
      return;
    }

    if (scroll.scrollTop <= 2 && movementY > 0) {
      event.preventDefault();
      handleReaderTouchBoundary(movementY, requestedTop, maxScrollTop);
    } else if (scroll.scrollTop >= maxScrollTop - 2 && movementY < 0) {
      event.preventDefault();
      handleReaderTouchBoundary(movementY, requestedTop, maxScrollTop);
    } else {
      state.touchBoundaryPull = 0;
    }
  }

  function handleReaderTouchBoundary(movementY, requestedTop, maxScrollTop) {
    var pull = Math.abs(movementY);
    if (movementY > 0 && requestedTop <= 0) {
      state.touchBoundaryPull += pull;
      if (state.touchBoundaryPull >= 42) {
        maybeAutoPrependPreviousChapter(-state.touchBoundaryPull);
        state.touchBoundaryPull = 0;
      }
    } else if (movementY < 0 && requestedTop >= maxScrollTop) {
      state.touchBoundaryPull += pull;
      if (state.touchBoundaryPull >= 42) {
        maybeAutoAppendNextChapter();
        state.touchBoundaryPull = 0;
      }
    } else {
      state.touchBoundaryPull = 0;
    }
  }

  function resetReaderTouch() {
    state.touchTracking = false;
    state.touchBoundaryPull = 0;
    state.touchLastY = 0;
  }

  function shouldIgnoreReaderGesture(target) {
    if (el.settingsPanel && el.settingsPanel.classList.contains("visible")) return true;
    if (el.chapterPanel && el.chapterPanel.classList.contains("visible")) return true;
    if (el.processPanel && el.processPanel.classList.contains("visible") && el.processPanel.contains(target)) return true;
    if (!target || !target.closest) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
  }

  function normalizedWheelDelta(event) {
    var deltaY = Number(event.deltaY || 0);
    if (!deltaY || Math.abs(deltaY) < Math.abs(Number(event.deltaX || 0))) return 0;
    if (event.deltaMode === 1) {
      deltaY *= 32;
    } else if (event.deltaMode === 2) {
      deltaY *= Math.max(1, el.readerScroll.clientHeight);
    }
    return deltaY;
  }

  function updateReaderProgress() {
    if (!state.currentBook) return;

    var scrollTop = el.readerScroll.scrollTop;
    var pageInfo = pageInfoFromScroll(scrollTop);
    var currentBook = pageInfo ? getBookById(pageInfo.bookId) : state.currentBook;
    var metrics = currentBook ? chapterScrollMetrics(currentBook.id) : null;
    var progress = metrics ? chapterProgressFromScroll(scrollTop, metrics) : 0;
    var displayProgress = currentBook ? rememberMaxProgress(currentBook.id, progress) : progress;
    var pageNumber = pageInfo ? pageInfo.pageNumber : 1;
    var totalPages = Math.max(1, currentBook ? currentBook.pageCount || countPagesForBook(currentBook.id) : 1);

    if (currentBook && currentBook.id !== state.currentVisibleBookId) {
      state.currentVisibleBookId = currentBook.id;
      state.currentBook = currentBook;
      state.lastSaveAt = 0;
      el.readerTitle.textContent = currentBook.title;
      replaceReaderHash(currentBook.id);
      updateChapterControls();
      renderChapterList();
    }

    el.readerMeta.textContent = "第 " + pageNumber + " / " + totalPages + " 页 · " + formatPercent(displayProgress);
    el.readerProgressBar.style.width = formatPercent(displayProgress);
  }

  function pageNumberFromScroll(scrollTop) {
    var pageInfo = pageInfoFromScroll(scrollTop);
    return pageInfo ? pageInfo.pageNumber : 1;
  }

  function pageInfoFromScroll(scrollTop) {
    if (!state.pages.length) return null;
    var target = scrollTop + Math.max(96, el.readerScroll.clientHeight * 0.28);
    var current = state.pages[0];

    for (var index = 0; index < state.pages.length; index += 1) {
      var shell = pageShell(state.pages[index].pageKey);
      if (!shell) continue;
      if (target >= shell.offsetTop) {
        current = state.pages[index];
      } else {
        break;
      }
    }

    return current;
  }

  async function persistPosition(force) {
    if (!state.currentBook) return;

    var now = Date.now();
    if (!force && now - state.lastSaveAt < 700) return;
    state.lastSaveAt = now;

    var scrollTop = Math.round(el.readerScroll.scrollTop || 0);
    var pageInfo = pageInfoFromScroll(scrollTop);
    var book = pageInfo ? getBookById(pageInfo.bookId) : state.currentBook;
    if (!book) return;
    var metrics = chapterScrollMetrics(book.id);
    var localScrollTop = metrics ? Math.max(0, Math.round(scrollTop - metrics.top)) : scrollTop;
    var progress = metrics ? chapterProgressFromScroll(scrollTop, metrics) : 0;
    var maxProgress = Math.max(displayProgressForPosition(state.positions[book.id]), progress);
    var position = {
      bookId: book.id,
      pageNumber: pageInfo ? pageInfo.pageNumber : pageNumberFromScroll(scrollTop),
      progress: progress,
      maxProgress: maxProgress,
      scrollTop: localScrollTop,
      updatedAt: now
    };

    state.positions[book.id] = position;
    state.currentBook = book;
    state.currentVisibleBookId = book.id;

    try {
      await putValue(POSITION_STORE, position);
      if (force || now - state.lastPositionLogAt > 4500) {
        state.lastPositionLogAt = now;
        addProcessEvent("done", "保存阅读位置", "第 " + position.pageNumber + " 页 · " + formatPercent(displayProgressForPosition(position)));
      }
    } catch (error) {
      console.warn(error);
      addProcessEvent("error", "保存阅读位置失败", errorMessage(error));
    }
  }

  function countPagesForBook(bookId) {
    return state.pages.filter(function (page) {
      return page.bookId === bookId;
    }).length;
  }

  function chapterScrollMetrics(bookId) {
    var chapterPages = state.pages.filter(function (page) {
      return page.bookId === bookId;
    });
    if (!chapterPages.length) return null;

    var firstShell = pageShell(chapterPages[0].pageKey);
    var lastShell = pageShell(chapterPages[chapterPages.length - 1].pageKey);
    if (!firstShell || !lastShell) return null;

    var top = firstShell.offsetTop;
    var bottom = lastShell.offsetTop + lastShell.offsetHeight;
    var height = Math.max(1, bottom - top);
    var scrollable = Math.max(1, height - el.readerScroll.clientHeight);
    return {
      bottom: bottom,
      height: height,
      scrollable: scrollable,
      top: top
    };
  }

  function chapterProgressFromScroll(scrollTop, metrics) {
    if (!metrics) return 0;
    return clamp(((scrollTop - metrics.top) / metrics.scrollable) * 100, 0, 100);
  }

  function jumpToChapter(bookId, localScrollTop, instant) {
    var metrics = chapterScrollMetrics(bookId);
    var target = metrics ? metrics.top + Math.max(0, localScrollTop || 0) : 0;
    jumpToScrollTop(target, instant);
  }

  function jumpToChapterEnd(bookId, instant) {
    var metrics = chapterScrollMetrics(bookId);
    if (!metrics) {
      jumpToScrollTop(Math.max(0, el.readerScroll.scrollHeight - el.readerScroll.clientHeight), instant);
      return;
    }
    jumpToChapter(bookId, Math.max(0, metrics.height - el.readerScroll.clientHeight), instant);
  }

  function jumpToScrollTop(scrollTop, instant) {
    el.readerScroll.scrollTo({
      behavior: instant ? "auto" : "smooth",
      top: Math.max(0, Math.round(scrollTop))
    });
    updateReaderProgress();
    renderVisiblePages();
  }

  function reflowReaderPages(keepRatio) {
    if (!state.pages.length) return;

    var ratio = 0;
    var maxBefore = Math.max(1, el.readerScroll.scrollHeight - el.readerScroll.clientHeight);
    if (keepRatio) {
      ratio = clamp(el.readerScroll.scrollTop / maxBefore, 0, 1);
    }

    state.renderedPages = new Set();
    state.renderingPages = new Set();
    buildReaderPages();
    setupPageObserver();

    requestAnimationFrame(function () {
      var maxAfter = Math.max(0, el.readerScroll.scrollHeight - el.readerScroll.clientHeight);
      if (keepRatio) {
        el.readerScroll.scrollTop = Math.round(maxAfter * ratio);
      }
      updateReaderProgress();
      renderVisiblePages();
    });
  }

  async function renderThumbnail(pdfDoc) {
    var page = await pdfDoc.getPage(1);
    var viewport = page.getViewport({ scale: 1 });
    var width = 220;
    var scale = width / viewport.width;
    var scaledViewport = page.getViewport({ scale: scale });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var canvas = document.createElement("canvas");
    var context = canvas.getContext("2d", { alpha: false });

    canvas.width = Math.max(1, Math.floor(scaledViewport.width * dpr));
    canvas.height = Math.max(1, Math.floor(scaledViewport.height * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, scaledViewport.width, scaledViewport.height);

    await page.render({
      canvasContext: context,
      viewport: scaledViewport
    }).promise;

    if (page.cleanup) page.cleanup();
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  function getDisplayWidth() {
    var viewportWidth = Math.max(280, el.readerScroll.clientWidth || window.innerWidth);
    var gutter = viewportWidth < 520 ? 24 : 56;
    var maxPageWidth = Math.min(980, viewportWidth - gutter);
    return Math.max(260, Math.round(maxPageWidth * clamp(state.settings.pageWidth, 78, 100) / 100));
  }

  function pageShell(pageKey) {
    return el.pagesContainer.querySelector('.page-shell[data-page-key="' + pageKey + '"]');
  }

  async function loadSettings() {
    var record = await getByKey(SETTINGS_STORE, SETTINGS_KEY);
    return Object.assign({}, DEFAULT_SETTINGS, record && record.value ? record.value : {});
  }

  async function updateSettings(partial, reflow) {
    state.settings = Object.assign({}, state.settings, partial || {});
    applySettings();

    try {
      await putValue(SETTINGS_STORE, {
        key: SETTINGS_KEY,
        value: state.settings
      });
    } catch (error) {
      console.warn(error);
    }

    if (reflow && state.pages.length) {
      reflowReaderPages(true);
    }
  }

  function applySettings() {
    var settings = state.settings;
    var brightness = clamp(settings.brightness || 92, 55, 100);
    var dim = ((100 - brightness) / 100) * 0.5;

    updateViewModeControls();

    if (el.readerView) {
      el.readerView.classList.remove("theme-paper", "theme-white", "theme-green", "theme-dark");
      el.readerView.classList.add("theme-" + (settings.theme || "paper"));
      el.readerView.classList.toggle("night", Boolean(settings.night));
      el.readerView.classList.toggle("eye-care", Boolean(settings.eyeCare));
    }

    el.brightnessLayer.style.background = "rgba(0, 0, 0, " + dim.toFixed(3) + ")";
    el.brightnessRange.value = String(brightness);
    el.pageWidthRange.value = String(clamp(settings.pageWidth || 100, 78, 100));
    el.eyeCareToggle.classList.toggle("active", Boolean(settings.eyeCare));
    el.nightToggle.classList.toggle("active", Boolean(settings.night));
    el.eyeCareToggle.setAttribute("aria-pressed", String(Boolean(settings.eyeCare)));
    el.nightToggle.setAttribute("aria-pressed", String(Boolean(settings.night)));

    document.querySelectorAll(".swatch").forEach(function (button) {
      var active = button.dataset.theme === (settings.theme || "paper");
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    document.querySelectorAll(".segment-group button").forEach(function (button) {
      var active = Number(button.dataset.gap) === Number(settings.pageGap || 18);
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    if (state.pages.length) {
      state.pages.forEach(function (page) {
        var shell = pageShell(page.pageKey);
        if (shell) {
          shell.style.marginBottom = (settings.pageGap || 18) + "px";
        }
      });
    }
  }

  function showSettings(show) {
    el.settingsPanel.hidden = false;
    el.settingsBackdrop.hidden = !show;
    el.settingsPanel.classList.toggle("visible", show);
    el.settingsPanel.setAttribute("aria-hidden", String(!show));

    if (!show) {
      window.setTimeout(function () {
        if (!el.settingsPanel.classList.contains("visible")) {
          el.settingsPanel.hidden = true;
        }
      }, 200);
    }
  }

  function showProcessPanel(show) {
    state.processPanelOpen = Boolean(show);
    el.processPanel.hidden = false;
    el.processBackdrop.hidden = !show;
    el.processPanel.classList.toggle("visible", show);
    el.processPanel.setAttribute("aria-hidden", String(!show));

    if (!show) {
      window.setTimeout(function () {
        if (!el.processPanel.classList.contains("visible")) {
          el.processPanel.hidden = true;
        }
      }, 200);
    }
  }

  function clearProcessEvents() {
    state.processEvents = [];
    state.processStats = {
      cache: "等待缓存",
      import: "空闲",
      render: state.currentBook ? "等待渲染" : "尚未阅读"
    };
    renderProcessPanel();
    addProcessEvent("done", "记录已清空", "只清空过程面板，不影响 PDF 缓存。");
  }

  function addProcessEvent(status, title, detail) {
    var event = {
      detail: detail || "",
      duration: 0,
      endedAt: status === "running" || status === "queued" ? 0 : Date.now(),
      id: "process_" + (++state.processIdSeed),
      startedAt: Date.now(),
      status: status || "done",
      title: title || "过程"
    };

    state.processEvents.unshift(event);
    trimProcessEvents();
    renderProcessPanel();
    return event.id;
  }

  function startProcessEvent(title, detail) {
    return addProcessEvent("running", title, detail);
  }

  function updateProcessEvent(id, patch) {
    var event = findProcessEvent(id);
    if (!event) return;
    Object.assign(event, patch || {});
    if (patch && patch.status && patch.status !== "running" && patch.status !== "queued") {
      event.endedAt = event.endedAt || Date.now();
      event.duration = Math.max(0, event.endedAt - event.startedAt);
    }
    renderProcessPanel();
  }

  function finishProcessEvent(id, detail) {
    var event = findProcessEvent(id);
    if (!event) return;
    event.status = "done";
    event.detail = detail || event.detail;
    event.endedAt = Date.now();
    event.duration = Math.max(0, event.endedAt - event.startedAt);
    renderProcessPanel();
  }

  function failProcessEvent(id, error, fallback) {
    var event = findProcessEvent(id);
    if (!event) return;
    event.status = "error";
    event.detail = fallback || errorMessage(error);
    event.endedAt = Date.now();
    event.duration = Math.max(0, event.endedAt - event.startedAt);
    renderProcessPanel();
  }

  function findProcessEvent(id) {
    return state.processEvents.find(function (event) {
      return event.id === id;
    });
  }

  function trimProcessEvents() {
    if (state.processEvents.length > PROCESS_LOG_LIMIT) {
      state.processEvents.length = PROCESS_LOG_LIMIT;
    }
  }

  function setProcessStats(patch) {
    state.processStats = Object.assign({}, state.processStats, patch || {});
    renderProcessPanel();
  }

  function renderProcessPanel() {
    if (!el.processTimeline) return;

    var running = state.processEvents.filter(function (event) {
      return event.status === "running";
    });
    var latest = running[0] || state.processEvents[0] || null;
    var errors = state.processEvents.filter(function (event) {
      return event.status === "error";
    }).length;

    el.processButton.classList.toggle("has-running", running.length > 0);
    el.processButton.classList.toggle("has-error", errors > 0 && running.length === 0);
    el.processBadge.hidden = state.processEvents.length === 0;
    el.processBadge.textContent = String(Math.min(state.processEvents.length, 99));

    if (latest) {
      el.processCurrentTitle.textContent = latest.title;
      el.processCurrentDetail.textContent = latest.detail || processStatusLabel(latest.status);
    } else {
      el.processCurrentTitle.textContent = "等待操作";
      el.processCurrentDetail.textContent = "导入或打开漫画后会显示实时步骤。";
    }

    el.processImportStat.textContent = state.processStats.import;
    el.processRenderStat.textContent = state.processStats.render;
    el.processCacheStat.textContent = state.processStats.cache;
    el.processSummary.textContent = state.processEvents.length + " 条记录";
    el.processEmpty.hidden = state.processEvents.length > 0;
    el.processTimeline.hidden = state.processEvents.length === 0;
    el.processTimeline.innerHTML = "";

    state.processEvents.forEach(function (event) {
      var item = document.createElement("li");
      item.className = "process-item " + event.status;

      var dot = document.createElement("div");
      dot.className = "process-dot";
      dot.setAttribute("aria-hidden", "true");

      var body = document.createElement("div");
      var title = document.createElement("div");
      title.className = "process-item-title";
      title.textContent = event.title;

      var detail = document.createElement("div");
      detail.className = "process-item-detail";
      detail.textContent = event.detail || processStatusLabel(event.status);

      var meta = document.createElement("div");
      meta.className = "process-item-meta";
      meta.textContent = processStatusLabel(event.status) + " · " + formatClock(event.startedAt) + formatDurationSuffix(event);

      body.appendChild(title);
      body.appendChild(detail);
      body.appendChild(meta);
      item.appendChild(dot);
      item.appendChild(body);
      el.processTimeline.appendChild(item);
    });
  }

  function processStatusLabel(status) {
    if (status === "queued") return "等待";
    if (status === "running") return "进行中";
    if (status === "error") return "失败";
    return "完成";
  }

  function formatClock(timestamp) {
    var date = new Date(timestamp || Date.now());
    return [
      String(date.getHours()).padStart(2, "0"),
      String(date.getMinutes()).padStart(2, "0"),
      String(date.getSeconds()).padStart(2, "0")
    ].join(":");
  }

  function formatDurationSuffix(event) {
    if (!event.duration) return "";
    return " · " + formatDuration(event.duration);
  }

  function formatDuration(ms) {
    if (ms < 1000) return ms + "ms";
    return (ms / 1000).toFixed(ms < 10000 ? 1 : 0) + "s";
  }

  function showImportOverlay(show, text, progress) {
    el.importOverlay.hidden = !show;
    if (show) {
      el.importText.textContent = text || "正在导入";
      el.importBar.style.width = formatPercent(progress || 0);
    }
  }

  function toast(message) {
    window.clearTimeout(state.toastTimer);
    el.toast.textContent = message;
    el.toast.classList.add("visible");
    state.toastTimer = window.setTimeout(function () {
      el.toast.classList.remove("visible");
    }, 2600);
  }

  function openDatabase() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(BOOK_STORE)) {
          var books = db.createObjectStore(BOOK_STORE, { keyPath: "id" });
          books.createIndex("chapterNumber", "chapterNumber", { unique: false });
          books.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(POSITION_STORE)) {
          db.createObjectStore(POSITION_STORE, { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains(RENDERED_PAGE_STORE)) {
          var renderedPages = db.createObjectStore(RENDERED_PAGE_STORE, { keyPath: "key" });
          renderedPages.createIndex("bookId", "bookId", { unique: false });
        }
        if (!db.objectStoreNames.contains(CHAPTER_CACHE_STORE)) {
          db.createObjectStore(CHAPTER_CACHE_STORE, { keyPath: "bookId" });
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }
      };

      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error || new Error("IndexedDB open failed"));
      };
      request.onblocked = function () {
        toast("请关闭其他阅读器标签页后重试。");
      };
    });
  }

  function getAll(storeName) {
    return new Promise(function (resolve, reject) {
      var transaction = state.db.transaction(storeName, "readonly");
      var request = transaction.objectStore(storeName).getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(request.error || transaction.error);
      };
    });
  }

  function getByKey(storeName, key) {
    return new Promise(function (resolve, reject) {
      var transaction = state.db.transaction(storeName, "readonly");
      var request = transaction.objectStore(storeName).get(key);
      request.onsuccess = function () {
        resolve(request.result || null);
      };
      request.onerror = function () {
        reject(request.error || transaction.error);
      };
    });
  }

  function putValue(storeName, value) {
    return new Promise(function (resolve, reject) {
      var transaction = state.db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = function () {
        resolve(value);
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error("IndexedDB write failed"));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("IndexedDB transaction aborted"));
      };
    });
  }

  function deleteByKey(storeName, key) {
    return new Promise(function (resolve, reject) {
      var transaction = state.db.transaction(storeName, "readwrite");
      transaction.objectStore(storeName).delete(key);
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error("IndexedDB delete failed"));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("IndexedDB transaction aborted"));
      };
    });
  }

  function deleteRenderedPagesForBook(bookId) {
    return new Promise(function (resolve, reject) {
      var transaction = state.db.transaction(RENDERED_PAGE_STORE, "readwrite");
      var store = transaction.objectStore(RENDERED_PAGE_STORE);
      var index = store.index("bookId");
      var request = index.openCursor(IDBKeyRange.only(bookId));
      request.onsuccess = function () {
        var cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      transaction.oncomplete = function () {
        resolve();
      };
      transaction.onerror = function () {
        reject(transaction.error || new Error("IndexedDB cursor delete failed"));
      };
      transaction.onabort = function () {
        reject(transaction.error || new Error("IndexedDB transaction aborted"));
      };
    });
  }

  function renderedPageKey(bookId, pageNumber, version) {
    return [bookId, version || "", pageNumber].join("__");
  }

  function cacheVersion(book) {
    return String(book && book.mtime ? book.mtime : state.catalogVersion || "unknown");
  }

  async function getRenderedPageRecord(bookId, pageNumber, version) {
    return getByKey(RENDERED_PAGE_STORE, renderedPageKey(bookId, pageNumber, version));
  }

  async function putRenderedPageRecord(book, pageNumber, canvas) {
    var blob = await canvasToBlob(canvas);
    var record = {
      blob: blob,
      bookId: book.id,
      height: canvas.height,
      key: renderedPageKey(book.id, pageNumber, cacheVersion(book)),
      pageNumber: pageNumber,
      size: blob.size || 0,
      updatedAt: Date.now(),
      version: cacheVersion(book),
      width: canvas.width
    };
    await putValue(RENDERED_PAGE_STORE, record);
    return record;
  }

  function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        if (blob) {
          resolve(blob);
          return;
        }
        canvas.toBlob(function (fallback) {
          resolve(fallback || dataUrlToBlob(canvas.toDataURL("image/png")));
        }, "image/png");
      }, "image/webp", 0.86);
    });
  }

  function dataUrlToBlob(dataUrl) {
    var parts = dataUrl.split(",");
    var meta = parts[0] || "";
    var bytes = atob(parts[1] || "");
    var mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/png";
    var array = new Uint8Array(bytes.length);
    for (var index = 0; index < bytes.length; index += 1) {
      array[index] = bytes.charCodeAt(index);
    }
    return new Blob([array], { type: mime });
  }

  async function fetchPdfArrayBuffer(book, signal) {
    var response = await fetch(book.pdfUrl, {
      cache: "no-store",
      signal: signal
    });
    if (!response.ok) {
      throw new Error("PDF 下载失败：" + response.status);
    }
    return response.arrayBuffer();
  }

  async function prepareCachedPageModels(book) {
    var meta = state.cacheMeta[book.id] || await getByKey(CHAPTER_CACHE_STORE, book.id);
    if (!meta || meta.status !== "complete" || meta.version !== cacheVersion(book) || !meta.pageCount) {
      return null;
    }
    var pages = [];
    for (var pageNumber = 1; pageNumber <= meta.pageCount; pageNumber += 1) {
      var record = await getRenderedPageRecord(book.id, pageNumber, meta.version);
      if (!record || !record.blob) {
        return null;
      }
      pages.push({
        bookId: book.id,
        bookTitle: book.title,
        displayHeight: 0,
        displayWidth: 0,
        fromCache: true,
        naturalHeight: record.height || 1400,
        naturalWidth: record.width || 980,
        pageKey: book.id + "__" + pageNumber,
        pageNumber: pageNumber,
        status: "pending"
      });
    }
    book.pageCount = meta.pageCount;
    return pages;
  }

  async function drawCachedPage(pageInfo, canvas) {
    var book = getBookById(pageInfo.bookId);
    if (!book) return false;
    var record = await getRenderedPageRecord(book.id, pageInfo.pageNumber, cacheVersion(book));
    if (!record || !record.blob) return false;

    var bitmap = await imageFromBlob(record.blob);
    var context = canvas.getContext("2d", { alpha: false });
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(pageInfo.displayWidth * dpr));
    canvas.height = Math.max(1, Math.floor(pageInfo.displayHeight * dpr));
    canvas.style.width = pageInfo.displayWidth + "px";
    canvas.style.height = pageInfo.displayHeight + "px";
    if (context.setTransform) {
      context.setTransform(1, 0, 0, 1, 0, 0);
    }
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    if (bitmap.close) bitmap.close();
    return true;
  }

  function imageFromBlob(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob);
    }
    return new Promise(function (resolve, reject) {
      var image = new Image();
      var url = URL.createObjectURL(blob);
      image.onload = function () {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error("缓存图片读取失败。"));
      };
      image.src = url;
    });
  }

  async function cacheSelectedChapters() {
    if (state.cacheInFlight) {
      requestCacheCancel();
      return;
    }
    if (!state.cacheSelection.size) return;
    var selectedBooks = Array.from(state.cacheSelection)
      .map(getBookById)
      .filter(Boolean);
    if (!selectedBooks.length) return;

    var books = [];
    var skippedCachedCount = 0;
    for (var scanIndex = 0; scanIndex < selectedBooks.length; scanIndex += 1) {
      var selectedBook = selectedBooks[scanIndex];
      if (await isChapterFullyCached(selectedBook)) {
        skippedCachedCount += 1;
        state.cacheSelection.delete(selectedBook.id);
      } else {
        books.push(selectedBook);
      }
    }

    if (skippedCachedCount) {
      addProcessEvent("done", "\u8df3\u8fc7\u5df2\u7f13\u5b58", "\u5df2\u8df3\u8fc7 " + skippedCachedCount + " \u7ae0\u5b8c\u6574\u7f13\u5b58\u7684\u7ae0\u8282\u3002");
    }

    if (!books.length) {
      renderChapterList();
      renderLibrary();
      updateCacheActionState();
      toast("\u6240\u9009\u7ae0\u8282\u5df2\u7f13\u5b58\uff0c\u65e0\u9700\u91cd\u590d\u7f13\u5b58\u3002");
      return;
    }

    state.cacheInFlight = true;
    state.cacheCancelRequested = false;
    state.cacheAbortController = window.AbortController ? new AbortController() : null;
    updateCacheActionState();
    var batchTask = startProcessEvent("缓存章节", "准备缓存 " + books.length + " 章。");
    try {
      for (var index = 0; index < books.length; index += 1) {
        checkCacheCancelled();
        await cacheBookRenderedPages(books[index], index + 1, books.length, state.cacheAbortController ? state.cacheAbortController.signal : null);
        state.cacheSelection.delete(books[index].id);
        renderChapterList();
        renderLibrary();
        updateCacheActionState();
      }
      state.cacheSelection.clear();
      finishProcessEvent(batchTask, "已完成所选章节缓存。");
      toast("所选章节已缓存。");
    } catch (error) {
      if (isCacheCancelError(error)) {
        finishProcessEvent(batchTask, "缓存已停止，已保留完成进度。");
        toast("已停止缓存。");
      } else {
        console.error(error);
        failProcessEvent(batchTask, error, "缓存任务中断。");
        toast("缓存失败，请查看过程记录。");
      }
    } finally {
      state.cacheInFlight = false;
      state.cacheCancelRequested = false;
      state.cacheAbortController = null;
      await refreshLibrary(false);
      updateCacheActionState();
      renderChapterList();
    }
  }

  function handleCachePanelButtonClick() {
    if (state.cacheInFlight) {
      requestCacheCancel();
      return;
    }
    cacheSelectedChapters();
  }

  function requestCacheCancel() {
    if (!state.cacheInFlight || state.cacheCancelRequested) return;
    state.cacheCancelRequested = true;
    if (state.cacheAbortController) {
      state.cacheAbortController.abort();
    }
    setProcessStats({
      cache: "正在停止缓存"
    });
    updateCacheActionState();
    toast("正在停止缓存。");
  }

  function checkCacheCancelled() {
    if (!state.cacheCancelRequested) return;
    var error = new Error("缓存已停止。");
    error.name = "CacheCancelled";
    throw error;
  }

  function isCacheCancelError(error) {
    return Boolean(error && (error.name === "CacheCancelled" || (state.cacheCancelRequested && error.name === "AbortError")));
  }

  function toggleAllCacheSelection() {
    if (state.cacheInFlight || !state.chapterSequence.length) return;
    if (isAllCacheSelected()) {
      state.cacheSelection.clear();
      toast("已取消全选。");
    } else {
      state.chapterSequence.forEach(function (book) {
        state.cacheSelection.add(book.id);
      });
      toast("已全选 " + state.chapterSequence.length + " 章。");
    }
    renderChapterList();
    renderLibrary();
    updateCacheActionState();
  }

  function isAllCacheSelected() {
    return state.chapterSequence.length > 0 && state.chapterSequence.every(function (book) {
      return state.cacheSelection.has(book.id);
    });
  }

  function pruneCacheSelection() {
    var validIds = new Set(state.chapterSequence.map(function (book) {
      return book.id;
    }));
    Array.from(state.cacheSelection).forEach(function (bookId) {
      if (!validIds.has(bookId)) {
        state.cacheSelection.delete(bookId);
      }
    });
  }

  async function isChapterFullyCached(book) {
    if (!book || !book.id) return false;
    var meta = state.cacheMeta[book.id] || await getByKey(CHAPTER_CACHE_STORE, book.id);
    if (!meta) return false;

    var version = cacheVersion(book);
    var pageCount = Number(meta.pageCount) || 0;
    var cachedPages = Number(meta.cachedPages) || 0;
    if (meta.status !== "complete" || meta.version !== version || pageCount <= 0 || cachedPages < pageCount) {
      return false;
    }

    for (var pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      var record = await getRenderedPageRecord(book.id, pageNumber, version);
      if (!record || !record.blob) return false;
    }

    state.cacheMeta[book.id] = Object.assign({}, meta);
    book.pageCount = pageCount;
    return true;
  }

  async function cacheBookRenderedPages(book, position, total, signal) {
    checkCacheCancelled();
    if (await isChapterFullyCached(book)) {
      addProcessEvent("done", "\u8df3\u8fc7\u5df2\u7f13\u5b58", book.title + "\u5df2\u5b8c\u6574\u7f13\u5b58\uff0c\u672a\u91cd\u590d\u5199\u5165\u3002");
      return { skipped: true };
    }
    var version = cacheVersion(book);
    var task = startProcessEvent("缓存页面", position + " / " + total + " · " + book.title);
    var meta = {
      bookId: book.id,
      cachedPages: 0,
      pageCount: 0,
      status: "caching",
      updatedAt: Date.now(),
      version: version
    };
    state.cacheMeta[book.id] = meta;
    await deleteRenderedPagesForBook(book.id);
    await putValue(CHAPTER_CACHE_STORE, meta);
    renderLibrary();
    renderChapterList();
    setProcessStats({
      cache: "缓存中：" + book.title
    });

    var pdfDoc = null;
    try {
      var arrayBuffer = await fetchPdfArrayBuffer(book, signal);
      checkCacheCancelled();
      pdfDoc = await openPdfFromArrayBuffer(arrayBuffer);
      checkCacheCancelled();
      meta.pageCount = pdfDoc.numPages || 0;
      book.pageCount = meta.pageCount;
      await putValue(CHAPTER_CACHE_STORE, meta);

      for (var pageNumber = 1; pageNumber <= meta.pageCount; pageNumber += 1) {
        checkCacheCancelled();
        var page = null;
        try {
          page = await pdfDoc.getPage(pageNumber);
          checkCacheCancelled();
          var viewport = page.getViewport({ scale: 1 });
          var width = Math.min(1100, Math.max(720, viewport.width));
          var scale = width / viewport.width;
          var scaledViewport = page.getViewport({ scale: scale });
          var canvas = document.createElement("canvas");
          var context = canvas.getContext("2d", { alpha: false });

          canvas.width = Math.max(1, Math.floor(scaledViewport.width));
          canvas.height = Math.max(1, Math.floor(scaledViewport.height));
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, canvas.width, canvas.height);

          await page.render({
            canvasContext: context,
            viewport: scaledViewport
          }).promise;
          checkCacheCancelled();

          await putRenderedPageRecord(book, pageNumber, canvas);
        } finally {
          if (page && page.cleanup) page.cleanup();
        }
        meta.cachedPages = pageNumber;
        meta.updatedAt = Date.now();
        await putValue(CHAPTER_CACHE_STORE, meta);
        state.cacheMeta[book.id] = Object.assign({}, meta);
        updateProcessEvent(task, {
          detail: "已缓存 " + pageNumber + " / " + meta.pageCount + " 页。",
          status: "running"
        });
        setProcessStats({
          cache: "缓存 " + pageNumber + " / " + meta.pageCount
        });
        checkCacheCancelled();
      }

      meta.status = "complete";
      meta.updatedAt = Date.now();
      await putValue(CHAPTER_CACHE_STORE, meta);
      state.cacheMeta[book.id] = Object.assign({}, meta);
      finishProcessEvent(task, "已缓存 " + meta.pageCount + " 页。");
    } catch (error) {
      meta.status = meta.pageCount && meta.cachedPages >= meta.pageCount ? "complete" : "partial";
      meta.updatedAt = Date.now();
      await putValue(CHAPTER_CACHE_STORE, meta);
      state.cacheMeta[book.id] = Object.assign({}, meta);
      if (isCacheCancelError(error)) {
        if (meta.status === "complete") {
          finishProcessEvent(task, "已缓存 " + meta.pageCount + " 页。");
          return;
        }
        finishProcessEvent(task, "缓存已停止：" + meta.cachedPages + " / " + Math.max(meta.pageCount, 1) + " 页。");
      } else {
        failProcessEvent(task, error, "缓存不完整：" + meta.cachedPages + " / " + Math.max(meta.pageCount, 1) + " 页。");
      }
      throw error;
    } finally {
      if (pdfDoc && pdfDoc.destroy) {
        await pdfDoc.destroy();
      }
    }
  }

  async function clearCurrentChapterCache() {
    var book = getBookById(state.currentVisibleBookId || (state.currentBook && state.currentBook.id));
    if (!book) {
      toast("当前没有可清理的章节。");
      return;
    }
    var task = startProcessEvent("清理页面缓存", book.title);
    try {
      await deleteRenderedPagesForBook(book.id);
      await deleteByKey(CHAPTER_CACHE_STORE, book.id);
      delete state.cacheMeta[book.id];
      state.renderedPages = new Set();
      finishProcessEvent(task, "已清理本章浏览器页面缓存。");
      toast("已清理本章缓存。");
      renderLibrary();
      renderChapterList();
      updateCacheActionState();
    } catch (error) {
      failProcessEvent(task, error, "缓存清理失败。");
      toast("缓存清理失败。");
    }
  }

  function cacheStatusLabel(bookId) {
    var meta = state.cacheMeta[bookId];
    if (!meta) return "未缓存";
    if (meta.status === "complete") return "已缓存";
    if (meta.status === "caching") return "缓存中 " + (meta.cachedPages || 0) + "/" + Math.max(1, meta.pageCount || 1);
    return "缓存不完整 " + (meta.cachedPages || 0) + "/" + Math.max(1, meta.pageCount || 1);
  }

  function pageCountLabel(book) {
    var count = book && book.pageCount ? book.pageCount : 0;
    return count ? count + " 页" : "页数待解析";
  }

  function updateCacheActionState() {
    var count = state.cacheSelection.size;
    var allSelected = isAllCacheSelected();
    if (el.selectAllPanelButton) {
      el.selectAllPanelButton.disabled = state.cacheInFlight || state.chapterSequence.length === 0;
      el.selectAllPanelButton.textContent = allSelected ? "取消全选" : "全选";
    }
    if (el.cachePanelButton) {
      el.cachePanelButton.disabled = !state.cacheInFlight && count === 0;
      el.cachePanelButton.textContent = state.cacheInFlight ? "缓存中" : (count ? "缓存所选 " + count : "缓存所选");
      el.cachePanelButton.classList.toggle("is-cancel-action", state.cacheInFlight);
    }
  }

  function normalizedPosition(bookId) {
    return state.positions[bookId] || {
      bookId: bookId,
      maxProgress: 0,
      pageNumber: 1,
      progress: 0,
      scrollTop: 0,
      updatedAt: 0
    };
  }

  function displayProgressForPosition(position) {
    if (!position) return 0;
    return clamp(Math.max(Number(position.progress) || 0, Number(position.maxProgress) || 0), 0, 100);
  }

  function rememberMaxProgress(bookId, progress) {
    var currentProgress = clamp(Number(progress) || 0, 0, 100);
    if (!bookId) return currentProgress;

    var position = state.positions[bookId];
    if (!position) {
      position = normalizedPosition(bookId);
      state.positions[bookId] = position;
    }

    var maxProgress = Math.max(displayProgressForPosition(position), currentProgress);
    position.maxProgress = maxProgress;
    return maxProgress;
  }

  function compareBooks(left, right) {
    var leftChapter = Number.isFinite(left.chapterNumber) ? left.chapterNumber : null;
    var rightChapter = Number.isFinite(right.chapterNumber) ? right.chapterNumber : null;

    if (leftChapter !== null && rightChapter !== null && leftChapter !== rightChapter) {
      return leftChapter - rightChapter;
    }
    if (leftChapter !== null && rightChapter === null) return -1;
    if (leftChapter === null && rightChapter !== null) return 1;
    return left.title.localeCompare(right.title, "zh-Hans-CN");
  }

  function chapterLabel(book) {
    return Number.isFinite(book.chapterNumber) ? "第 " + book.chapterNumber + " 章" : "PDF";
  }

  function cleanPdfTitle(fileName) {
    return fileName
      .replace(/\.pdf$/i, "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim() || "漫画";
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

  function formatSize(bytes) {
    if (!bytes) return "0 MB";
    var units = ["B", "KB", "MB", "GB"];
    var value = bytes;
    var unitIndex = 0;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }

    return (unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)) + " " + units[unitIndex];
  }

  function formatDateTime(timestamp) {
    if (!timestamp) return "时间未知";
    var date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "时间未知";
    return [
      date.getFullYear() + "/" + (date.getMonth() + 1) + "/" + date.getDate(),
      [
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0"),
        String(date.getSeconds()).padStart(2, "0")
      ].join(":")
    ].join(" ");
  }

  function formatPercent(value) {
    return clamp(value || 0, 0, 100).toFixed(0) + "%";
  }

  function errorMessage(error) {
    if (!error) return "未知错误";
    if (error.message) return error.message;
    return String(error);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, Number(value) || 0));
  }

  function hashString(input) {
    var hash = 2166136261;
    for (var index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return (hash >>> 0).toString(36);
  }

  function debounce(fn, delay) {
    var timer = 0;
    return function () {
      var args = arguments;
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        fn.apply(null, args);
      }, delay);
    };
  }
})();
