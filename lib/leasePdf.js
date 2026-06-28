// lib/leasePdf.js
//
// Generates the final signed lease PDF: lease text (+ pet addendum if the
// booking has pets), the guest's drawn signature image, and a signing
// record (timestamp, IP address) for an audit trail. Runs entirely
// server-side using pdf-lib, which works in any JS environment including
// Vercel's serverless functions -- no external service or binary needed.

const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const LINE_HEIGHT = 14;
const FONT_SIZE = 10.5;

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
  // a pre-set typed/script-style signature rather than a hand-drawn image
  // -- there's no separate landlord-signing step in the flow.
  newPageIfNeeded(110);
  y -= 18;
  drawParagraphBlock("LANDLORD SIGNATURE", { bold: true, size: 12 });

  const landlordSignedAt = new Date().toISOString();
  newPageIfNeeded(40);
  page.drawText("Richelle Dy", { x: MARGIN, y, size: 22, font: italicFont, color: rgb(0, 0, 0) });
  y -= 26;

  drawParagraphBlock("Signed by: Richelle Dy (Landlord)");
  drawParagraphBlock(`Signed at: ${landlordSignedAt} (UTC)`);

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { generateSignedLeasePdf };
