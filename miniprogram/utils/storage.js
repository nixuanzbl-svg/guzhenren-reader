const KEYS = {
  books: 'gzr:books',
  positions: 'gzr:positions',
  settings: 'gzr:settings'
};

const DEFAULT_SETTINGS = {
  autoScroll: false,
  autoSpeed: 24,
  brightness: 86,
  eyeCare: false,
  fitMode: 'width',
  night: false,
  pageGap: 16,
  pageWidth: 100,
  theme: 'paper'
};

function safeGet(key, fallback) {
  try {
    const value = wx.getStorageSync(key);
    return value || fallback;
  } catch (error) {
    return fallback;
  }
}

function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (error) {
    wx.showToast({
      icon: 'none',
      title: '本地存储失败'
    });
  }
}

function getBooks() {
  const books = safeGet(KEYS.books, []);
  return Array.isArray(books) ? books : [];
}

function saveBooks(books) {
  safeSet(KEYS.books, books);
}

function getBook(id) {
  return getBooks().find((book) => book.id === id);
}

function upsertBook(book) {
  const books = getBooks();
  const index = books.findIndex((item) => item.id === book.id);
  if (index >= 0) {
    books[index] = Object.assign({}, books[index], book, { updatedAt: Date.now() });
  } else {
    books.unshift(Object.assign({}, book, { importedAt: Date.now(), updatedAt: Date.now() }));
  }
  saveBooks(books);
  return books[index >= 0 ? index : 0];
}

function getPositions() {
  const positions = safeGet(KEYS.positions, {});
  return positions && typeof positions === 'object' ? positions : {};
}

function getPosition(bookId) {
  return getPositions()[bookId] || {
    pageNumber: 1,
    progress: 0,
    scrollTop: 0,
    updatedAt: 0
  };
}

function savePosition(bookId, position) {
  const positions = getPositions();
  positions[bookId] = Object.assign({}, positions[bookId], position, { updatedAt: Date.now() });
  safeSet(KEYS.positions, positions);
}

function getSettings() {
  const value = safeGet(KEYS.settings, {});
  return Object.assign({}, DEFAULT_SETTINGS, value || {});
}

function saveSettings(partial) {
  const settings = Object.assign({}, getSettings(), partial || {});
  safeSet(KEYS.settings, settings);
  return settings;
}

function ensureDefaultSettings() {
  const current = safeGet(KEYS.settings, null);
  if (!current) {
    safeSet(KEYS.settings, DEFAULT_SETTINGS);
  }
}

module.exports = {
  DEFAULT_SETTINGS,
  ensureDefaultSettings,
  getBook,
  getBooks,
  getPosition,
  getPositions,
  getSettings,
  saveBooks,
  savePosition,
  saveSettings,
  upsertBook
};
