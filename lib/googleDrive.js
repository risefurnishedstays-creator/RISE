// lib/googleDrive.js
//
// Uploads signed lease PDFs to a Google Drive folder using a service
// account -- no human OAuth click needed at upload time, since this runs
// server-side on every signed lease.
//
// SETUP REQUIRED (one-time, in Google Cloud Console -- not code):
//   1. Go to console.cloud.google.com, create a project (or use an
//      existing one).
//   2. APIs & Services -> Library -> search "Google Drive API" -> Enable.
//   3. APIs & Services -> Credentials -> Create Credentials -> Service account.
//      Give it any name (e.g. "rise-lease-uploader").
//   4. Click into the new service account -> Keys -> Add Key -> Create new key
//      -> JSON. This downloads a .json file -- treat it like a password.
//   5. In Google Drive (as risefurnishedstays@gmail.com), create a folder
//      for signed leases. Right-click it -> Share -> paste the service
//      account's email (looks like xxx@xxx.iam.gserviceaccount.com, found
//      inside the JSON key file as "client_email") -> give it Editor access.
//      Copy the folder's ID from its URL (the long string after
//      /folders/ in the address bar).
//   6. Set these in Vercel env vars:
//        GOOGLE_SERVICE_ACCOUNT_KEY  -- the ENTIRE contents of the JSON
//                                       key file, pasted as one value
//                                       (Vercel handles multi-line values
//                                       fine in the env var editor)
//        GOOGLE_DRIVE_LEASES_FOLDER_ID -- the folder ID from step 5
//
// Until both are set, uploadSignedLease() throws a clear configuration
// error rather than silently failing.
//
// WHY THE "drive" SCOPE BELOW, NOT "drive.file": this code shares a
// pre-existing folder (created in step 5 by your own Google account) with
// the service account afterward. The narrower drive.file scope ONLY
// grants access to files/folders the service account created itself (or
// that a user picked through Google's file-picker UI) -- it does not
// recognize the normal "Share" dialog at all, even granting Editor
// access, for anything it didn't create. With drive.file, every step
// above can be followed exactly and uploads will still silently fail
// with a permissions error, because the scope itself is the wrong fit
// for "share an existing folder with a service account." The "drive"
// scope grants the same access any shared-with user would have -- gated
// by Drive's normal sharing permissions, which step 5 already sets up.

const { google } = require("googleapis");

function isConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID);
}

function getAuth() {
  const credentials = parseServiceAccountKey(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "");
  return new google.auth.GoogleAuth({
    credentials,
    // IMPORTANT: drive.file is NOT sufficient for this setup, and using it
    // is the most likely reason uploads fail with the folder correctly
    // shared and the env vars correctly set. drive.file only grants access
    // to files/folders the service account ITSELF created (or that a user
    // explicitly picked via Google's file-picker UI) -- it does NOT
    // recognize folders that were shared with the service account through
    // the normal "Share" dialog, even with Editor access. Since step 5
    // above has you create the folder yourself and share it with the
    // service account afterward, drive.file silently can't see that
    // folder at all: Drive's sharing permissions and OAuth scopes are two
    // independent systems, and drive.file deliberately ignores
    // sharing-based access for anything it didn't create. The broader
    // "drive" scope (full access to all of Drive, gated by the service
    // account's own sharing permissions like any other "user") is what
    // this workflow actually needs.
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
}

// Accepts GOOGLE_SERVICE_ACCOUNT_KEY in EITHER of two formats:
//   1. The raw JSON key file contents, pasted as-is (the originally
//      documented format -- tried first).
//   2. That same JSON, base64-encoded, as ONE single-line string with no
//      special characters at all. This is the more foolproof option: the
//      raw-JSON path is fragile against newline/quote mangling introduced
//      by clipboard managers, terminals, or the env var editor itself
//      along the way, and base64 has no characters that any of those
//      tools have a reason to "helpfully" transform. To generate it:
//        macOS/Linux:  base64 -i service-account-key.json | tr -d '\n'
//        Windows (PowerShell): [Convert]::ToBase64String([IO.File]::ReadAllBytes("service-account-key.json"))
//      Paste the single resulting line as the env var value.
function parseServiceAccountKey(raw) {
  // Attempt 1: raw JSON, exactly as documented originally.
  try {
    return JSON.parse(raw);
  } catch (jsonError) {
    // Attempt 2: base64-encoded JSON. atob/Buffer.from with base64 is
    // lenient about whitespace, so this also tolerates a key that got
    // accidentally wrapped across multiple lines by the env var editor.
    try {
      const decoded = Buffer.from(raw, "base64").toString("utf8");
      const parsed = JSON.parse(decoded);
      // Buffer.from(..., "base64") doesn't throw on non-base64 input --
      // it silently drops invalid characters and decodes whatever's left,
      // which can "succeed" into garbage that happens to parse. Guard
      // against that by confirming the decoded result actually looks like
      // a service account key, not just any valid JSON value.
      if (parsed && typeof parsed === "object" && parsed.type === "service_account" && parsed.private_key && parsed.client_email) {
        return parsed;
      }
      throw new Error("decoded base64 was valid JSON but didn't look like a service account key");
    } catch (base64Error) {
      logServiceAccountKeyDiagnostics(raw, jsonError, base64Error);
      throw new Error(
        "GOOGLE_SERVICE_ACCOUNT_KEY is not valid as either raw JSON or base64-encoded JSON. " +
        "It should be the entire contents of the service account's downloaded key file -- " +
        "either pasted as-is, or base64-encoded as one line (see comments in lib/googleDrive.js " +
        "for how to generate that). See the console.error diagnostics line just above this " +
        "error in the logs for specifics -- none of which reveal the actual secret."
      );
    }
  }
}

// Diagnoses WITHOUT ever logging the actual secret value -- only safe,
// structural facts about it (length, first/last character, whether it
// looks like it's wrapped in an extra layer of quotes, etc.) so a parse
// failure can be pinpointed from Vercel logs alone, rather than every
// failure just saying "not valid JSON" with no way to tell which of
// several very different root causes it actually is:
//   - pasted with an extra layer of quotes around the whole value
//   - truncated (missing the opening { or closing })
//   - the multi-line private_key field's literal \n escapes got mangled
//     into real newlines (or vice versa) by the clipboard, terminal, or
//     env var editor along the way
//   - the env var is empty, whitespace-only, or wasn't saved at all
//   - the wrong thing was pasted entirely (e.g. just the file path, or
//     only the private_key field instead of the whole JSON file)
//   - it looks like valid base64 but decodes to something that isn't a
//     service account key at all (wrong file entirely)
function logServiceAccountKeyDiagnostics(raw, jsonError, base64Error) {
  const diagnostics = {
    length: raw.length,
    isEmpty: raw.trim().length === 0,
    firstChar: raw.length ? JSON.stringify(raw[0]) : null,
    lastChar: raw.length ? JSON.stringify(raw[raw.length - 1]) : null,
    startsWithBrace: raw.trimStart().startsWith("{"),
    endsWithBrace: raw.trimEnd().endsWith("}"),
    // A value wrapped in an extra layer of quotes (e.g. the whole file
    // pasted as "{...}" instead of {...}) is a common paste mistake --
    // detectable without revealing any actual key content.
    looksDoubleQuoted: raw.trimStart().startsWith('"') && raw.trimEnd().endsWith('"'),
    containsLiteralNewline: raw.includes("\n"),
    containsEscapedNewline: raw.includes("\\n"),
    looksLikeFilePathNotContents: /\.json$/i.test(raw.trim()) && raw.trim().length < 200,
    // A real base64-encoded JSON key is typically several KB long (RSA
    // private keys aren't short) and contains only base64 alphabet
    // characters -- if the value is short or has characters outside that
    // alphabet, it was never valid base64 either, which helps rule that
    // path in or out.
    looksLikeBase64Alphabet: /^[A-Za-z0-9+/=\s]+$/.test(raw),
    jsonParseErrorMessage: jsonError.message,
    base64AttemptErrorMessage: base64Error.message,
  };
  console.error("GOOGLE_SERVICE_ACCOUNT_KEY failed to parse as JSON or base64 -- diagnostics (no secret content logged):", JSON.stringify(diagnostics));
}

// Accepts GOOGLE_DRIVE_LEASES_FOLDER_ID as EITHER the bare folder ID, or
// the full Drive URL someone pastes when copying a folder's "Share" link
// (which commonly looks like
// https://drive.google.com/drive/folders/1KCWmZE.../?usp=drive_link --
// note the trailing "?usp=drive_link" or "?usp=sharing" tracking
// parameter, which is NOT part of the actual ID but is very easy to
// accidentally include since it's right there in what gets copied).
// Pasting the full URL (with or without that suffix) used to fail with a
// confusing "File not found" error from Google -- not because the folder
// doesn't exist, but because the "ID" being sent wasn't really an ID at
// all. This extracts just the actual ID regardless of which form was pasted.
function sanitizeFolderId(raw) {
  const trimmed = (raw || "").trim();
  const urlMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  // Even if it wasn't a /folders/ URL, still strip any trailing
  // ?query or #fragment in case just the ID-plus-suffix was pasted
  // (e.g. "1KCWmZE...?usp=drive_link" with no URL prefix at all).
  return trimmed.split(/[?#]/)[0];
}

/**
 * Uploads a file buffer to the configured Google Drive folder.
 *
 * Despite the name, this is used for any file headed to the Signed Leases
 * folder -- originally just the signed lease PDF, now also guest-uploaded
 * government ID photos (see api/sign-lease.js's action=upload-id branch).
 * Kept as one function rather than splitting it, since the upload logic
 * itself doesn't differ -- only the bytes, filename, and mimeType do.
 *
 * @param {Buffer} fileBytes - the file content.
 * @param {string} filename - e.g. "Lease - ABC1234567 - Jane Smith.pdf"
 * @param {string} [mimeType] - defaults to "application/pdf" for backward compatibility.
 * @returns {Promise<{fileId: string, fileUrl: string}>}
 */
async function uploadSignedLease(fileBytes, filename, mimeType) {
  if (!isConfigured()) {
    throw new Error(
      "Google Drive is not configured. Set GOOGLE_SERVICE_ACCOUNT_KEY and " +
      "GOOGLE_DRIVE_LEASES_FOLDER_ID in Vercel env vars. See comments at the " +
      "top of lib/googleDrive.js for setup steps."
    );
  }

  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });
  const folderId = sanitizeFolderId(process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID);

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [folderId],
    },
    media: {
      mimeType: mimeType || "application/pdf",
      body: bufferToStream(fileBytes),
    },
    fields: "id, webViewLink",
  });

  return {
    fileId: res.data.id,
    fileUrl: res.data.webViewLink || `https://drive.google.com/file/d/${res.data.id}/view`,
  };
}

// googleapis expects a readable stream for media.body, not a raw Buffer.
const { Readable } = require("stream");
function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer);
  stream.push(null);
  return stream;
}

module.exports = { uploadSignedLease, isConfigured };
