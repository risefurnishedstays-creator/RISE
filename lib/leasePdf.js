// lib/leasePdf.js
//
// Generates the final signed lease PDF: lease text (+ pet addendum if the
// booking has pets), the guest's drawn signature image, and a signing
// record (timestamp, IP address) for an audit trail. Runs entirely
// server-side using pdf-lib, which works in any JS environment including
// Vercel's serverless functions -- no external service or binary needed.

const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10.5;

// The owner's actual signature image (a transparent-background PNG cropped
// tight to the strokes themselves -- see assets/owner-signature.png).
// Loaded once at module load rather than per-request, since the file
// never changes during a single deployment and re-reading it from disk on
// every signed lease would be wasted work.
const OWNER_SIGNATURE_PATH = path.join(__dirname, "..", "assets", "owner-signature.png");

/**
 * Wraps a long string of text into lines that fit within maxWidth, using
 * the given font/size for measurement. pdf-lib has no built-in text
 * wrapping, so this does it manually, word by word.
 */
function wrapText(text, font, fontSize, maxWidth) {
  const paragraphs = text.split("\n");
  const lines = [];
  for (const paragraph of paragraphs) {
    if (paragraph.trim() === "") { lines.push(""); continue; }
    const words = paragraph.split(" ");
    let current = "";
    for (const word of words) {
      const test = current ? current + " " + word : word;
      const width = font.widthOfTextAtSize(test, fontSize);
      if (width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

/**
 * Generates the complete signed lease PDF.
 *
 * @param {Object} params
 * @param {string} params.leaseText - the full lease body text (plain text, \n for line breaks).
 * @param {string} [params.petAddendumText] - included only if the booking has pets.
 * @param {Buffer} params.signatureImageBytes - PNG bytes of the drawn signature.
 * @param {Object} params.signingInfo - { guestName, confirmationCode, signedAt (ISO string), ipAddress }
 * @returns {Promise<Buffer>}
 */
async function generateSignedLeasePdf({ leaseText, petAddendumText, signatureImageBytes, signingInfo }) {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const italicFont = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const maxTextWidth = PAGE_WIDTH - MARGIN * 2;

  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPageIfNeeded(neededHeight) {
    if (y - neededHeight < MARGIN) {
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function drawParagraphBlock(text, opts) {
    opts = opts || {};
    const useFont = opts.bold ? boldFont : font;
    const size = opts.size || FONT_SIZE;
    const lines = wrapText(text, useFont, size, maxTextWidth);
    for (const line of lines) {
      newPageIfNeeded(LINE_HEIGHT);
      page.drawText(line, { x: MARGIN, y, size, font: useFont, color: rgb(0, 0, 0) });
      y -= LINE_HEIGHT;
    }
    y -= 4; // small gap after each block
  }

  // ---- Lease body ----
  drawParagraphBlock(leaseText);

  // ---- Pet addendum, if applicable ----
  if (petAddendumText) {
    newPageIfNeeded(LINE_HEIGHT * 3);
    y -= 10;
    drawParagraphBlock("PET ADDENDUM", { bold: true, size: 12 });
    drawParagraphBlock(petAddendumText);
  }

  // ---- Signature block ----
  newPageIfNeeded(150);
  y -= 14;
  drawParagraphBlock("TENANT SIGNATURE", { bold: true, size: 12 });

  let signatureImage;
  try {
    signatureImage = await pdfDoc.embedPng(signatureImageBytes);
  } catch (e) {
    throw new Error("Could not embed signature image -- expected a valid PNG buffer. " + e.message);
  }
  const sigDrawWidth = 220;
  const sigScale = sigDrawWidth / signatureImage.width;
  const sigDrawHeight = signatureImage.height * sigScale;
  newPageIfNeeded(sigDrawHeight + 10);
  page.drawImage(signatureImage, { x: MARGIN, y: y - sigDrawHeight, width: sigDrawWidth, height: sigDrawHeight });
  y -= sigDrawHeight + 16;

  // ---- Signing audit record ----
  drawParagraphBlock(
    `Signed by: ${signingInfo.guestName || "(name not provided)"}`,
  );
  drawParagraphBlock(`Confirmation code: ${signingInfo.confirmationCode || ""}`);
  drawParagraphBlock(`Signed at: ${signingInfo.signedAt || new Date().toISOString()} (UTC)`);
  drawParagraphBlock(`IP address at signing: ${signingInfo.ipAddress || "(not recorded)"}`);

  // ---- Landlord signature block ----
  // Tenant always signs first (this PDF can't be generated until they do,
  // since sign-lease.js is the only thing that calls this function). The
  // Landlord's signature is applied immediately after, server-side, using
  // a pre-saved signature image -- there's no separate landlord-signing
  // step in the flow.
  newPageIfNeeded(110);
  y -= 18;
  drawParagraphBlock("LANDLORD SIGNATURE", { bold: true, size: 12 });

  const landlordSignedAt = new Date().toISOString();

  let ownerSignatureImage = null;
  try {
    const ownerSigBytes = fs.readFileSync(OWNER_SIGNATURE_PATH);
    ownerSignatureImage = await pdfDoc.embedPng(ownerSigBytes);
  } catch (e) {
    // Don't fail the whole lease PDF over a missing/corrupt signature
    // asset -- fall back to typed text so the lease still gets generated
    // and archived; log loudly so the missing asset gets noticed and fixed.
    console.error("CRITICAL: could not embed owner signature image from", OWNER_SIGNATURE_PATH, ":", e.message);
  }

  if (ownerSignatureImage) {
    // Sized noticeably smaller than the tenant's signature (220pt wide)
    // since this is a fixed, pre-saved image rather than a hand-drawn
    // canvas capture -- a smaller size reads as a clean, deliberate
    // signature stamp rather than competing for visual weight with the
    // tenant's own signature above it.
    const ownerSigDrawWidth = 130;
    const ownerSigScale = ownerSigDrawWidth / ownerSignatureImage.width;
    const ownerSigDrawHeight = ownerSignatureImage.height * ownerSigScale;
    newPageIfNeeded(ownerSigDrawHeight + 10);
    page.drawImage(ownerSignatureImage, { x: MARGIN, y: y - ownerSigDrawHeight, width: ownerSigDrawWidth, height: ownerSigDrawHeight });
    // Typed name beside the image, vertically centered against it rather
    // than baseline-aligned to the top, so it doesn't look like it's
    // floating above the signature.
    const nameFontSize = 13;
    const nameX = MARGIN + ownerSigDrawWidth + 14;
    const nameY = y - ownerSigDrawHeight / 2 - nameFontSize / 2.8;
    page.drawText("Richelle Dy", { x: nameX, y: nameY, size: nameFontSize, font: boldFont, color: rgb(0, 0, 0) });
    y -= ownerSigDrawHeight + 16;
  } else {
    // Fallback if the image asset couldn't be loaded -- same italic typed
    // treatment this used before the real signature image was available.
    newPageIfNeeded(40);
    page.drawText("Richelle Dy", { x: MARGIN, y, size: 22, font: italicFont, color: rgb(0, 0, 0) });
    y -= 26;
  }

  drawParagraphBlock("Signed by: Richelle Dy (Landlord)");
  drawParagraphBlock(`Signed at: ${landlordSignedAt} (UTC)`);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateSignedLeasePdf };
