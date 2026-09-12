import { Button, Modal, Typography } from "antd";

const PDF_MIME = "application/pdf";
const IMAGE_MIMES = new Set(["image/jpeg", "image/png"]);

/** Inline preview for PDF/JPEG/PNG (spec §68) - anything else (Office
 * formats, CAD files, archives) has no safe in-browser renderer, so it
 * falls back to a download link rather than trying to display raw bytes.
 * `previewUrl` must point at the same authenticated download endpoint with
 * `?inline=1` so the server sends Content-Disposition: inline instead of
 * attachment - the browser won't render a PDF/image in an <embed>/<img> at
 * all if the response forces a save dialog. */
export function FilePreviewModal({
  open,
  onClose,
  title,
  mimeType,
  previewUrl,
  downloadUrl,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  mimeType: string;
  previewUrl: string;
  downloadUrl: string;
}) {
  const isPdf = mimeType === PDF_MIME;
  const isImage = IMAGE_MIMES.has(mimeType);

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onClose}
      footer={null}
      width={isPdf ? 900 : 640}
      styles={{ body: { padding: isPdf || isImage ? 0 : 24 } }}
    >
      {isPdf && (
        <embed src={previewUrl} type="application/pdf" style={{ width: "100%", height: "80vh", border: "none", display: "block" }} />
      )}
      {isImage && (
        <img src={previewUrl} alt={title} style={{ maxWidth: "100%", maxHeight: "80vh", display: "block", margin: "0 auto" }} />
      )}
      {!isPdf && !isImage && (
        <div style={{ textAlign: "center" }}>
          <Typography.Paragraph type="secondary">
            Preview isn't available for this file type - download it to view the contents.
          </Typography.Paragraph>
          <Button type="primary" href={downloadUrl} target="_blank" rel="noreferrer">
            Download
          </Button>
        </div>
      )}
    </Modal>
  );
}
