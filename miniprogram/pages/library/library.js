const storage = require('../../utils/storage');
const format = require('../../utils/format');

function decorateBook(book) {
  const position = storage.getPosition(book.id);
  const progress = Math.max(0, Math.min(100, position.progress || 0));
  return Object.assign({}, book, {
    chapterLabel: format.chapterLabel(book.title),
    coverStyle: format.coverStyle(book.title),
    dateText: format.formatDate(book.importedAt),
    lastPage: position.pageNumber || 1,
    progressText: format.percent(progress),
    sizeText: format.formatSize(book.size)
  });
}

function makeBookId(file) {
  const seed = `${file.name || 'comic'}:${file.size || 0}:${Date.now()}`;
  return `book_${Math.abs(seed.split('').reduce((sum, char) => ((sum * 33) + char.charCodeAt(0)) | 0, 5381))}`;
}

Page({
  data: {
    books: [],
    recentBook: null,
    stats: {
      count: 0,
      totalSize: '0 MB'
    }
  },

  onShow() {
    this.refreshLibrary();
  },

  onShareAppMessage() {
    return {
      title: '墨卷漫画阅读器',
      path: '/pages/library/library'
    };
  },

  refreshLibrary() {
    const books = storage.getBooks().map(decorateBook);
    const positions = storage.getPositions();
    const recentBook = books
      .slice()
      .sort((a, b) => {
        const left = positions[a.id] ? positions[a.id].updatedAt || 0 : a.updatedAt || 0;
        const right = positions[b.id] ? positions[b.id].updatedAt || 0 : b.updatedAt || 0;
        return right - left;
      })[0] || null;
    const totalBytes = books.reduce((sum, book) => sum + (book.size || 0), 0);

    this.setData({
      books,
      recentBook,
      stats: {
        count: books.length,
        totalSize: format.formatSize(totalBytes)
      }
    });
  },

  handleImportPdf() {
    wx.chooseMessageFile({
      count: 1,
      extension: ['pdf'],
      type: 'file',
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file) return;

        if (!/\.pdf$/i.test(file.name || '')) {
          wx.showToast({
            icon: 'none',
            title: '请选择 PDF 文件'
          });
          return;
        }

        wx.showLoading({
          title: '正在缓存'
        });

        wx.getFileSystemManager().saveFile({
          tempFilePath: file.path,
          success: (saveResult) => {
            const title = format.cleanPdfTitle(file.name);
            const book = storage.upsertBook({
              filePath: saveResult.savedFilePath,
              id: makeBookId(file),
              originName: file.name,
              renderer: 'pdf',
              size: file.size || 0,
              title,
              type: 'pdf'
            });

            wx.hideLoading();
            this.refreshLibrary();
            wx.navigateTo({
              url: `/pages/reader/reader?id=${encodeURIComponent(book.id)}`
            });
          },
          fail: () => {
            wx.hideLoading();
            wx.showToast({
              icon: 'none',
              title: '缓存失败'
            });
          }
        });
      }
    });
  },

  openBook(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({
      url: `/pages/reader/reader?id=${encodeURIComponent(id)}`
    });
  },

  openSystemPdf(event) {
    const id = event.currentTarget.dataset.id;
    const book = storage.getBook(id);
    if (!book) return;

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
  }
});
