const INSTALL_HINT = '请先安装 pdfjs-dist 并在微信开发者工具里构建 npm。';

let pdfjsLib = null;

function installPolyfills() {
  const root = typeof globalThis !== 'undefined' ? globalThis : {};
  if (!root.window) root.window = root;
  if (!root.navigator) root.navigator = { userAgent: 'wechat-miniprogram' };
}

function getPdfLib() {
  if (pdfjsLib) return pdfjsLib;
  installPolyfills();

  try {
    pdfjsLib = require('pdfjs-dist/legacy/build/pdf');
  } catch (error) {
    const next = new Error(INSTALL_HINT);
    next.cause = error;
    throw next;
  }

  if (pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';
  }

  return pdfjsLib;
}

function openDocument(arrayBuffer) {
  const pdf = getPdfLib();
  return pdf.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: true
  }).promise;
}

module.exports = {
  INSTALL_HINT,
  getPdfLib,
  openDocument
};
