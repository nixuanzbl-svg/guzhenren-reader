const PALETTE = [
  ['#202225', '#626a70'],
  ['#2d3326', '#78815b'],
  ['#342a22', '#9a6b48'],
  ['#243032', '#668982'],
  ['#352833', '#916d7e'],
  ['#2e2b24', '#a49264']
];

function pad(value) {
  return value < 10 ? `0${value}` : `${value}`;
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())}`;
}

function cleanPdfTitle(name) {
  return String(name || '未命名漫画').replace(/\.pdf$/i, '').trim() || '未命名漫画';
}

function chapterLabel(title) {
  const match = String(title || '').match(/第(.+?)章/);
  return match ? `第${match[1]}章` : 'PDF';
}

function hashText(text) {
  const value = String(text || '');
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function coverStyle(title) {
  const pair = PALETTE[hashText(title) % PALETTE.length];
  return `background: linear-gradient(145deg, ${pair[0]}, ${pair[1]});`;
}

function percent(value) {
  const next = Math.max(0, Math.min(100, Math.round(value || 0)));
  return `${next}%`;
}

module.exports = {
  chapterLabel,
  cleanPdfTitle,
  coverStyle,
  formatDate,
  formatSize,
  percent
};
