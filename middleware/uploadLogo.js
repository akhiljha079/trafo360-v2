// Separate multer instance just for the company logo. Unlike
// middleware/upload.js (which stores confidential documents OUTSIDE the
// public web root, only reachable through an authenticated route), the
// logo is meant to be publicly visible - it appears on customer-facing
// generated documents - so it's stored inside public/ and served directly
// by express.static, and restricted to raster image types only (no .svg,
// to avoid stored-XSS via an embedded <script> in an SVG file).
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'public', 'branding');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  }
});

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return cb(new Error(`Logo must be an image file (jpg, png, gif, or webp).`));
  }
  cb(null, true);
}

const uploadLogo = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB is generous for a letterhead logo
  fileFilter
});

module.exports = uploadLogo;
