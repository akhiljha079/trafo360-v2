// Multer file upload config - documents are stored OUTSIDE the public folder
// so confidential files can never be accessed by guessing a URL; they are
// only served through the authenticated /documents/:id/download route.
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});

const maxMb = Number(process.env.MAX_UPLOAD_MB || 25);

// Allowlist of extensions this system ever needs to accept for manufacturing/
// QA documents (drawings, reports, certificates, images of nameplates, etc).
// Executable/script extensions are deliberately excluded even though uploads
// are stored outside the public web root and never executed by the app -
// this is defense in depth against the file later being served by something
// else (a misconfigured reverse proxy, a future feature, etc).
const ALLOWED_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt',
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tif', '.tiff', '.webp',
  '.dwg', '.dxf', '.zip'
]);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`File type "${ext || '(none)'}" is not allowed.`));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 },
  fileFilter
});

module.exports = upload;
