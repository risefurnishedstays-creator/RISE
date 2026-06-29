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

// ===========================================================================
// Bold-run detection -- mirrors lease.html's formatLeaseHtml() rules exactly,
// so the PDF bolds the same headings/labels/amounts the on-screen lease
// preview does, instead of inventing a second, possibly-drifting set of
// rules. Operates on plain text and returns {text, bold} segments per line,
// rather than HTML, since this feeds pdf-lib's word-by-word drawing instead
// of innerHTML.
// ===========================================================================

// Splits a single line into ordered {text, bold} segments based on the
// same structural patterns formatLeaseHtml() bolds in the browser:
// numbered clause headings, lettered/roman sub-clause markers, "Label:"
// lines, the document title/witness lines, and dollar amounts. Multiple
// rules can apply to one line (e.g. a "(A)" marker AND a dollar amount in
// the same sentence), so this layers them in the same priority order the
// browser version does, then keeps subdividing whichever segments are
// still plain text as each further rule is applied.
function getBoldSegmentsForLine(line, state) {
  // Payment Schedule block: every line from "Payment Schedule:" through
  // the "Total:" line (inclusive) is bolded in full -- tracked via
  // `state.inSchedule`, carried across calls the same way
  // formatLeaseHtml()'s closured `inSchedule` variable is.
  if (/^Payment Schedule:/.test(line)) {
    state.inSchedule = true;
    return [{ text: line, bold: true }];
  }
  if (state.inSchedule) {
    if (!/^Total:/.test(line)) {
      return [{ text: line, bold: true }];
    }
    state.inSchedule = false;
    return [{ text: line, bold: true }];
  }

  let segments = [{ text: line, bold: false }];

  // Applies a regex with exactly one capture group (the part to bold) to
  // every still-plain segment, splitting it into before/match/after. Plain
  // segments are re-checked on each call so multiple rules can each find
  // their own match within whatever plain text remains.
  function boldFirstMatchIn(segs, regex) {
    const result = [];
    let matchedAny = false;
    for (const seg of segs) {
      if (seg.bold || matchedAny) { result.push(seg); continue; }
      const m = seg.text.match(regex);
      if (!m) { result.push(seg); continue; }
      matchedAny = true;
      const start = m.index;
      const matched = m[1];
      const end = start + matched.length;
      if (start > 0) result.push({ text: seg.text.slice(0, start), bold: false });
      result.push({ text: matched, bold: true });
      if (end < seg.text.length) result.push({ text: seg.text.slice(end), bold: false });
    }
    return result;
  }

  // Numbered clause headings, e.g. "1. Parties and Premises." or
  // "5. Utility Bills/Service Contracts:" -- bolds just the heading
  // phrase up to the first period or colon.
  const headingMatch = line.match(/^(\d{1,2}\.\s[^\n]*?[.:])(\s|$)/);
  let matchedNumberedHeading = false;
  if (headingMatch) {
    matchedNumberedHeading = true;
    segments = boldFirstMatchIn(segments, /^(\d{1,2}\.\s[^\n]*?[.:])(\s|$)/);
  }

  // Lettered/roman sub-clause markers, e.g. "(A) " or "(i) ".
  segments = boldFirstMatchIn(segments, /^(\([A-Za-z]+\))(\s)/);

  // "Label:" lines, e.g. "Within 5 days of booking:" -- skipped if a
  // numbered heading already matched (same reasoning as the browser
  // version: avoids bolding past the heading's own colon into the
  // paragraph that follows).
  if (!matchedNumberedHeading) {
    segments = boldFirstMatchIn(segments, /^([A-Za-z0-9][^\n:]{0,90}:)(\s)/);
  }

  // Document title and witness lines, bolded in full.
  if (/^RESIDENTIAL LEASE AGREEMENT$/.test(line) || /^IN WITNESS WHEREOF/.test(line)) {
    return [{ text: line, bold: true }];
  }

  // Dollar amounts anywhere in the line -- applied last and to ALL
  // remaining plain-text segments (not just the first match), since a
  // single line can contain more than one dollar amount (e.g. the early
  // termination clause mentions both $2,550 and a per-night credit).
  const withAmounts = [];
  for (const seg of segments) {
    if (seg.bold) { withAmounts.push(seg); continue; }
    let rest = seg.text;
    let match;
    const amountRe = /\$[\d,]+(?:\.\d{2})?/g;
    let lastIndex = 0;
    let found = false;
    while ((match = amountRe.exec(rest))) {
      found = true;
      if (match.index > lastIndex) withAmounts.push({ text: rest.slice(lastIndex, match.index), bold: false });
      withAmounts.push({ text: match[0], bold: true });
      lastIndex = match.index + match[0].length;
    }
    if (!found) {
      withAmounts.push(seg);
    } else if (lastIndex < rest.length) {
      withAmounts.push({ text: rest.slice(lastIndex), bold: false });
    }
  }

  return withAmounts;
}

/**
 * Word-wraps a line's bold/plain segments into drawable lines, each line
 * being an array of {text, font, size} word-runs in left-to-right order.
 * This is the mixed-font equivalent of wrapText() above -- needed because
 * a single visual line can now contain both bold and regular runs (e.g. a
 * heading followed by plain paragraph text), which plain wrapText() has no
 * way to represent.
 */
function wrapSegmentsToLines(segments, font, boldFont, fontSize, maxWidth) {
  // Flatten segments into a single ordered list of words, each tagged
  // with which font it uses, preserving the bold/plain boundaries.
  const words = [];
  for (const seg of segments) {
    const useFont = seg.bold ? boldFont : font;
    if (seg.text === "") continue;
    const parts = seg.text.split(" ");
    parts.forEach((w, i) => {
      if (w === "" && i !== 0 && i !== parts.length - 1) return; // collapse doubled spaces from segment joins
      words.push({ text: w, font: useFont });
    });
  }

  const lines = [];
  let current = [];
  let currentWidth = 0;
  const spaceWidth = font.widthOfTextAtSize(" ", fontSize);

  for (const word of words) {
    if (word.text === "") {
      // Represents a boundary space between two segments -- treat as a
      // single space rather than a real "word" so it doesn't introduce
      // doubled spacing at segment joins.
      continue;
    }
    const wordWidth = word.font.widthOfTextAtSize(word.text, fontSize);
    const addedWidth = current.length > 0 ? spaceWidth + wordWidth : wordWidth;
    if (currentWidth + addedWidth > maxWidth && current.length > 0) {
      lines.push(current);
      current = [word];
      currentWidth = wordWidth;
    } else {
      current.push(word);
      currentWidth += addedWidth;
    }
  }
  if (current.length > 0) lines.push(current);
  if (lines.length === 0) lines.push([]); // preserve blank lines (e.g. paragraph spacing)

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

  // Draws a multi-line block of text with the same automatic bolding
  // rules as the on-screen lease preview (lease.html's formatLeaseHtml):
  // numbered clause headings, lettered/roman sub-markers, "Label:" lines,
  // the document title/witness lines, the whole Payment Schedule block,
  // and dollar amounts -- all bolded inline within otherwise-regular
  // paragraph text, not just whole-line bold/plain like drawParagraphBlock.
  function drawFormattedTextBlock(text) {
    const rawLines = text.split("\n");
    const boldState = { inSchedule: false };
    for (const rawLine of rawLines) {
      if (rawLine.trim() === "") {
        newPageIfNeeded(LINE_HEIGHT);
        y -= LINE_HEIGHT;
        continue;
      }
      const segments = getBoldSegmentsForLine(rawLine, boldState);
      const wrappedLines = wrapSegmentsToLines(segments, font, boldFont, FONT_SIZE, maxTextWidth);
      for (const wordRun of wrappedLines) {
        newPageIfNeeded(LINE_HEIGHT);
        let x = MARGIN;
        for (let i = 0; i < wordRun.length; i++) {
          const word = wordRun[i];
          page.drawText(word.text, { x, y, size: FONT_SIZE, font: word.font, color: rgb(0, 0, 0) });
          x += word.font.widthOfTextAtSize(word.text, FONT_SIZE);
          if (i < wordRun.length - 1) x += font.widthOfTextAtSize(" ", FONT_SIZE);
        }
        y -= LINE_HEIGHT;
      }
    }
    y -= 4; // small gap after each block, matching drawParagraphBlock
  }

  // ---- Lease body ----
  drawFormattedTextBlock(leaseText);

  // ---- Pet addendum, if applicable ----
  if (petAddendumText) {
    newPageIfNeeded(LINE_HEIGHT * 3);
    y -= 10;
    drawParagraphBlock("PET ADDENDUM", { bold: true, size: 12 });
    drawFormattedTextBlock(petAddendumText);
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
