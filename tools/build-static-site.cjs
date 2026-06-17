const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(appRoot, "..", "..");
const webRoot = path.join(appRoot, "web");
const pdfRoot = path.join(projectRoot, "pdf");
const docsRoot = path.join(appRoot, "docs");
const dataRoot = path.join(docsRoot, "data");
const docsPdfRoot = path.join(docsRoot, "pdf");

const STATIC_FILES = [
  "styles.css",
  "app.js",
  "manifest.webmanifest",
  "sw.js"
];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(relativePath) {
  const source = path.join(webRoot, relativePath);
  const target = path.join(docsRoot, relativePath);
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyIndexHtml() {
  const source = path.join(webRoot, "index.html");
  const target = path.join(docsRoot, "index.html");
  const html = fs.readFileSync(source, "utf8")
    .replace("window.GUZHENREN_STATIC_BUILD = false;", "window.GUZHENREN_STATIC_BUILD = true;");
  fs.writeFileSync(target, html, "utf8");
}

function copyDir(relativePath) {
  const source = path.join(webRoot, relativePath);
  const target = path.join(docsRoot, relativePath);
  ensureDir(path.dirname(target));
  fs.cpSync(source, target, { recursive: true });
}

function sha1(input) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function fileUrl(fileName) {
  return "./pdf/" + encodeURIComponent(fileName);
}

function chineseToNumber(text) {
  const digits = {
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
  const units = {
    "十": 10,
    "百": 100,
    "千": 1000,
    "万": 10000
  };

  let total = 0;
  let section = 0;
  let number = 0;
  let found = false;

  for (const char of text) {
    if (Object.prototype.hasOwnProperty.call(digits, char)) {
      number = digits[char];
      found = true;
    } else if (Object.prototype.hasOwnProperty.call(units, char)) {
      const unit = units[char];
      found = true;
      if (unit === 10000) {
        section = (section + number) * unit;
        total += section;
        section = 0;
      } else {
        section += (number || 1) * unit;
      }
      number = 0;
    } else {
      return null;
    }
  }

  return found ? total + section + number : null;
}

function extractChapterNumber(fileName) {
  const stem = path.parse(fileName).name;
  const arabic = stem.match(/第\s*([0-9]+)\s*章/);
  if (arabic) return Number(arabic[1]);

  const chinese = stem.match(/第\s*([零〇一二两三四五六七八九十百千万]+)\s*章/);
  if (chinese) return chineseToNumber(chinese[1]);

  const chapter = stem.match(/(?:chapter|ch)\s*([0-9]+)/i);
  if (chapter) return Number(chapter[1]);

  return null;
}

function titleFromFileName(fileName) {
  return path.parse(fileName).name.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "漫画";
}

function chapterRecord(fileName) {
  const filePath = path.join(pdfRoot, fileName);
  const stat = fs.statSync(filePath);
  const chapterNumber = extractChapterNumber(fileName);
  const fallbackId = "pdf-" + sha1(fileName).slice(0, 12);

  return {
    id: Number.isFinite(chapterNumber) ? "chapter-" + chapterNumber : fallbackId,
    chapterNumber: Number.isFinite(chapterNumber) ? chapterNumber : null,
    title: titleFromFileName(fileName),
    fileName,
    size: stat.size,
    mtime: Math.round(stat.mtimeMs),
    pdfUrl: fileUrl(fileName),
    downloadUrl: fileUrl(fileName),
    checksum: sha1(fileName + "\0" + stat.size + "\0" + Math.round(stat.mtimeMs))
  };
}

function compareRecords(left, right) {
  const leftChapter = Number.isFinite(left.chapterNumber) ? left.chapterNumber : null;
  const rightChapter = Number.isFinite(right.chapterNumber) ? right.chapterNumber : null;

  if (leftChapter !== null && rightChapter !== null && leftChapter !== rightChapter) {
    return leftChapter - rightChapter;
  }
  if (leftChapter !== null && rightChapter === null) return -1;
  if (leftChapter === null && rightChapter !== null) return 1;
  return left.title.localeCompare(right.title, "zh-Hans-CN");
}

function buildCatalog() {
  if (!fs.existsSync(pdfRoot)) {
    throw new Error("PDF 目录不存在：" + pdfRoot);
  }

  const pdfNames = fs.readdirSync(pdfRoot)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));
  const allRecords = pdfNames.map(chapterRecord);
  const selected = new Map();
  const duplicates = [];

  for (const record of allRecords) {
    const key = Number.isFinite(record.chapterNumber) ? "chapter-" + record.chapterNumber : record.id;
    const previous = selected.get(key);
    if (!previous) {
      selected.set(key, record);
      continue;
    }

    if ((record.mtime || 0) >= (previous.mtime || 0)) {
      duplicates.push(previous);
      selected.set(key, record);
    } else {
      duplicates.push(record);
    }
  }

  const chapters = Array.from(selected.values()).sort(compareRecords);
  const maxMtime = Math.max(0, ...allRecords.map((record) => record.mtime || 0));
  const fingerprint = sha1(JSON.stringify(allRecords.map((record) => [
    record.fileName,
    record.size,
    record.mtime
  ]))).slice(0, 12);

  return {
    schema: 1,
    source: "github-pages-static",
    generatedAt: new Date().toISOString(),
    updatedAt: maxMtime ? new Date(maxMtime).toISOString() : "",
    version: `${chapters.length}-${maxMtime}-${fingerprint}`,
    totalPdfFiles: allRecords.length,
    chapters,
    omittedDuplicateChapters: duplicates.sort(compareRecords).map((record) => ({
      chapterNumber: record.chapterNumber,
      title: record.title,
      fileName: record.fileName,
      mtime: record.mtime
    }))
  };
}

function copyPdfs() {
  ensureDir(docsPdfRoot);
  const pdfNames = fs.readdirSync(pdfRoot)
    .filter((name) => name.toLowerCase().endsWith(".pdf"))
    .sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  for (const fileName of pdfNames) {
    fs.copyFileSync(path.join(pdfRoot, fileName), path.join(docsPdfRoot, fileName));
  }

  return pdfNames.length;
}

function main() {
  ensureDir(docsRoot);
  ensureDir(dataRoot);

  copyIndexHtml();
  for (const file of STATIC_FILES) {
    copyFile(file);
  }
  copyDir("icons");
  copyDir(path.join("vendor", "pdfjs"));

  const copiedPdfs = copyPdfs();
  const catalog = buildCatalog();
  fs.writeFileSync(path.join(dataRoot, "chapters.json"), JSON.stringify(catalog, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(docsRoot, ".nojekyll"), "", "utf8");

  console.log(`Static app written to ${docsRoot}`);
  console.log(`Catalog chapters: ${catalog.chapters.length}; PDF files copied: ${copiedPdfs}`);
  if (catalog.omittedDuplicateChapters.length) {
    console.log(`Duplicate chapter PDFs omitted from shelf: ${catalog.omittedDuplicateChapters.length}`);
  }
}

main();
