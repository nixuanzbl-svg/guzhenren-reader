const storage = require('../../utils/storage');
const format = require('../../utils/format');
const pdfRenderer = require('../../utils/pdf-renderer');

const RENDER_AHEAD = 1;
const SAVE_INTERVAL = 900;
const AUTO_SCROLL_INTERVAL = 120;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

Page({
  data: {
    book: {
      title: '漫画'
    },
    bottomInset: 130,
    brightnessMask: 0.14,
    chromeVisible: true,
    currentPage: 1,
    loadingText: '正在解析 PDF',
    pageCount: 0,
    pages: [],
    progressText: '0%',
    rendererError: '',
    rendererReady: false,
    settings: storage.DEFAULT_SETTINGS,
    settingsVisible: false,
    targetScrollTop: 0,
    topInset: 176
  },

  onLoad(options) {
    const system = wx.getSystemInfoSync();
    this.dpr = system.pixelRatio || 1;
    this.windowHeight = system.windowHeight || 667;
    this.windowWidth = system.windowWidth || 375;
    this.contentWidth = Math.min(this.windowWidth - 24, 560);
    this.bookId = decodeURIComponent(options.id || '');
    this.renderedPages = {};
    this.renderingPages = {};
    this.lastSaveAt = 0;
    this.scrollTop = 0;

    const settings = storage.getSettings();
    this.setData({
      bottomInset: 150,
      brightnessMask: this.getBrightnessMask(settings),
      settings,
      topInset: 176
    });

    this.loadBook();
  },

  onUnload() {
    this.persistPosition(true);
    this.stopAutoScroll();
  },

  loadBook() {
    const book = storage.getBook(this.bookId);
    if (!book) {
      this.setData({
        loadingText: '没有找到这本漫画',
        rendererError: '请回到书架重新导入 PDF。'
      });
      return;
    }

    this.setData({ book });
    this.loadPdf(book);
  },

  loadPdf(book) {
    wx.getFileSystemManager().readFile({
      filePath: book.filePath,
      success: (result) => {
        let documentTask;
        try {
          documentTask = pdfRenderer.openDocument(result.data);
        } catch (error) {
          this.showRenderError(error);
          return;
        }

        documentTask
          .then((pdfDoc) => {
            this.pdfDoc = pdfDoc;
            this.setData({
              loadingText: '正在排版页面',
              pageCount: pdfDoc.numPages
            });
            return this.preparePages(pdfDoc);
          })
          .then((pages) => {
            const position = storage.getPosition(this.bookId);
            const targetScrollTop = position.scrollTop || 0;
            this.setData({
              currentPage: position.pageNumber || 1,
              loadingText: '',
              pages,
              progressText: format.percent(position.progress || 0),
              rendererReady: true,
              targetScrollTop
            }, () => {
              this.scrollTop = targetScrollTop;
              this.renderVisiblePages(targetScrollTop);
              this.applyAutoScrollState();
            });
          })
          .catch((error) => {
            this.showRenderError(error);
          });
      },
      fail: () => {
        this.setData({
          loadingText: 'PDF 读取失败',
          rendererError: '本地缓存文件不可用，请回到书架重新导入。'
        });
      }
    });
  },

  preparePages(pdfDoc) {
    const jobs = [];
    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      jobs.push(
        pdfDoc.getPage(pageNumber).then((page) => {
          const viewport = page.getViewport({ scale: 1 });
          const displayWidth = this.getDisplayWidth();
          const displayHeight = Math.round(displayWidth * viewport.height / viewport.width);
          return {
            displayHeight,
            displayWidth,
            naturalHeight: viewport.height,
            naturalWidth: viewport.width,
            pageNumber,
            status: 'pending'
          };
        })
      );
    }
    return Promise.all(jobs);
  },

  showRenderError(error) {
    this.setData({
      loadingText: '需要构建 PDF 渲染依赖',
      rendererError: error && error.message ? error.message : 'PDF 渲染初始化失败。',
      rendererReady: false
    });
  },

  handleScroll(event) {
    const scrollTop = event.detail.scrollTop || 0;
    this.scrollTop = scrollTop;
    const pageNumber = this.pageFromScroll(scrollTop + 12);
    const progress = this.progressFromPage(pageNumber, scrollTop);

    this.setData({
      currentPage: pageNumber,
      progressText: format.percent(progress)
    });

    this.renderVisiblePages(scrollTop);
    this.persistPosition(false, pageNumber, progress, scrollTop);
  },

  renderVisiblePages(scrollTop) {
    if (!this.pdfDoc || !this.data.pages.length) return;
    const visible = this.visibleRange(scrollTop);
    for (let pageNumber = visible.start; pageNumber <= visible.end; pageNumber += 1) {
      this.renderPage(pageNumber);
    }
  },

  visibleRange(scrollTop) {
    const pages = this.data.pages;
    const startY = Math.max(0, scrollTop - this.windowHeight * 0.35);
    const endY = scrollTop + this.windowHeight * 1.6;
    let cursor = this.data.topInset;
    let start = 1;
    let end = Math.min(pages.length, 1 + RENDER_AHEAD);

    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const pageTop = cursor;
      const pageBottom = pageTop + page.displayHeight;
      if (pageBottom >= startY && pageTop <= endY) {
        start = Math.max(1, page.pageNumber - RENDER_AHEAD);
        end = Math.min(pages.length, page.pageNumber + RENDER_AHEAD);
        break;
      }
      cursor = pageBottom + this.data.settings.pageGap;
    }

    return { end, start };
  },

  renderPage(pageNumber) {
    if (this.renderedPages[pageNumber] || this.renderingPages[pageNumber]) return;
    const pageInfo = this.data.pages[pageNumber - 1];
    if (!pageInfo) return;

    this.renderingPages[pageNumber] = true;
    this.patchPage(pageNumber, { status: 'rendering' });

    this.pdfDoc.getPage(pageNumber)
      .then((page) => new Promise((resolve, reject) => {
        wx.createSelectorQuery()
          .in(this)
          .select(`#pdfCanvas${pageNumber}`)
          .fields({ node: true, size: true })
          .exec((result) => {
            const canvas = result && result[0] && result[0].node;
            if (!canvas) {
              reject(new Error('Canvas 节点未就绪'));
              return;
            }

            const context = canvas.getContext('2d');
            const scale = pageInfo.displayWidth / pageInfo.naturalWidth;
            const viewport = page.getViewport({ scale });
            const width = Math.floor(pageInfo.displayWidth * this.dpr);
            const height = Math.floor(pageInfo.displayHeight * this.dpr);

            canvas.width = width;
            canvas.height = height;
            if (context.setTransform) {
              context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
            } else if (context.scale) {
              context.scale(this.dpr, this.dpr);
            }
            if (context.clearRect) {
              context.clearRect(0, 0, pageInfo.displayWidth, pageInfo.displayHeight);
            }

            page.render({
              canvasContext: context,
              viewport
            }).promise.then(resolve).catch(reject);
          });
      }))
      .then(() => {
        this.renderedPages[pageNumber] = true;
        this.patchPage(pageNumber, { status: 'rendered' });
      })
      .catch(() => {
        this.patchPage(pageNumber, { status: 'error' });
      })
      .finally(() => {
        delete this.renderingPages[pageNumber];
      });
  },

  patchPage(pageNumber, patch) {
    const pages = this.data.pages.slice();
    const index = pageNumber - 1;
    if (!pages[index]) return;
    pages[index] = Object.assign({}, pages[index], patch);
    this.setData({ pages });
  },

  pageFromScroll(scrollTop) {
    const pages = this.data.pages;
    let cursor = this.data.topInset;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const bottom = cursor + page.displayHeight + this.data.settings.pageGap;
      if (scrollTop < bottom) return page.pageNumber;
      cursor = bottom;
    }
    return Math.max(1, pages.length);
  },

  progressFromPage(pageNumber, scrollTop) {
    const total = this.totalContentHeight();
    if (total <= this.windowHeight) {
      return pageNumber >= this.data.pageCount ? 100 : 0;
    }
    return clamp((scrollTop / (total - this.windowHeight)) * 100, 0, 100);
  },

  totalContentHeight() {
    return this.data.pages.reduce((sum, page) => sum + page.displayHeight + this.data.settings.pageGap, this.data.topInset + this.data.bottomInset);
  },

  getDisplayWidth(settings) {
    const nextSettings = settings || this.data.settings || storage.DEFAULT_SETTINGS;
    const pageWidth = clamp(nextSettings.pageWidth || 100, 88, 100);
    return Math.round(this.contentWidth * pageWidth / 100);
  },

  reflowPages(settings) {
    if (!this.data.pages.length) return;
    const displayWidth = this.getDisplayWidth(settings);
    const pages = this.data.pages.map((page) => {
      const displayHeight = Math.round(displayWidth * page.naturalHeight / page.naturalWidth);
      return Object.assign({}, page, {
        displayHeight,
        displayWidth,
        status: 'pending'
      });
    });

    this.renderedPages = {};
    this.renderingPages = {};
    this.setData({
      pages
    }, () => {
      const maxScrollTop = Math.max(0, this.totalContentHeight() - this.windowHeight);
      this.jumpToScrollTop(clamp(this.scrollTop || 0, 0, maxScrollTop));
    });
  },

  persistPosition(force, pageNumber, progress, scrollTop) {
    const now = Date.now();
    if (!force && now - this.lastSaveAt < SAVE_INTERVAL) return;
    this.lastSaveAt = now;
    storage.savePosition(this.bookId, {
      pageNumber: pageNumber || this.data.currentPage,
      progress: progress || Number(this.data.progressText.replace('%', '')) || 0,
      scrollTop: scrollTop || this.scrollTop || 0
    });
  },

  toggleChrome() {
    if (this.data.settingsVisible) return;
    this.setData({
      chromeVisible: !this.data.chromeVisible
    });
  },

  toggleSettings() {
    this.setData({
      chromeVisible: true,
      settingsVisible: !this.data.settingsVisible
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.redirectTo({ url: '/pages/library/library' })
    });
  },

  openSystemPdf() {
    const book = this.data.book;
    if (!book || !book.filePath) return;
    this.persistPosition(true);
    wx.openDocument({
      filePath: book.filePath,
      fileType: 'pdf',
      showMenu: true,
      fail: () => {
        wx.showToast({
          icon: 'none',
          title: 'PDF 打开失败'
        });
      }
    });
  },

  showCatalog() {
    wx.showActionSheet({
      itemList: ['回到开头', '继续当前位置', '跳到最后'],
      success: (result) => {
        if (result.tapIndex === 0) {
          this.jumpToScrollTop(0);
        }
        if (result.tapIndex === 2) {
          this.jumpToScrollTop(Math.max(0, this.totalContentHeight() - this.windowHeight));
        }
      }
    });
  },

  jumpToScrollTop(scrollTop) {
    const next = Math.max(0, Math.round(scrollTop));
    this.setData({
      targetScrollTop: next
    });
    this.scrollTop = next;
    this.renderVisiblePages(next);
  },

  changeBrightness(event) {
    const brightness = Number(event.detail.value || 86);
    this.saveSettings({
      brightness
    });
  },

  toggleEyeCare() {
    this.saveSettings({
      eyeCare: !this.data.settings.eyeCare
    });
  },

  toggleNight() {
    this.saveSettings({
      night: !this.data.settings.night
    });
  },

  setTheme(event) {
    const theme = event.currentTarget.dataset.theme || 'paper';
    this.saveSettings({
      theme: theme === 'system' ? 'paper' : theme
    });
  },

  changePageWidth(event) {
    const step = Number(event.currentTarget.dataset.step || 0);
    const pageWidth = clamp((this.data.settings.pageWidth || 100) + step, 88, 100);
    const settings = this.saveSettings({
      pageWidth
    });
    this.reflowPages(settings);
  },

  fitToWidth() {
    const settings = this.saveSettings({
      pageWidth: 100
    });
    this.reflowPages(settings);
  },

  setGapPreset(event) {
    const pageGap = Number(event.currentTarget.dataset.gap || 16);
    this.saveSettings({
      pageGap
    });
    this.renderVisiblePages(this.scrollTop || 0);
  },

  changeAutoSpeed(event) {
    this.saveSettings({
      autoSpeed: Number(event.detail.value || 24)
    });
  },

  toggleAutoScroll() {
    this.saveSettings({
      autoScroll: !this.data.settings.autoScroll
    });
    this.applyAutoScrollState();
  },

  saveSettings(partial) {
    const settings = storage.saveSettings(partial);
    this.setData({
      brightnessMask: this.getBrightnessMask(settings),
      settings
    });
    this.applyAutoScrollState(settings);
    return settings;
  },

  getBrightnessMask(settings) {
    return Number(((100 - clamp(settings.brightness || 86, 45, 100)) / 100).toFixed(2));
  },

  applyAutoScrollState(settings) {
    const current = settings || this.data.settings;
    if (current.autoScroll && this.data.rendererReady) {
      this.startAutoScroll();
    } else {
      this.stopAutoScroll();
    }
  },

  startAutoScroll() {
    if (this.autoTimer) return;
    this.autoTimer = setInterval(() => {
      const maxScrollTop = Math.max(0, this.totalContentHeight() - this.windowHeight);
      const step = (this.data.settings.autoSpeed || 24) / 10;
      const next = clamp((this.scrollTop || 0) + step, 0, maxScrollTop);
      this.jumpToScrollTop(next);
      if (next >= maxScrollTop) {
        this.saveSettings({ autoScroll: false });
      }
    }, AUTO_SCROLL_INTERVAL);
  },

  stopAutoScroll() {
    if (!this.autoTimer) return;
    clearInterval(this.autoTimer);
    this.autoTimer = null;
  }
});
