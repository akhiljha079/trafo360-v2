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
const upload = multer({
  storage,
  limits: { fileSize: maxMb * 1024 * 1024 }
});

module.exports = upload;
