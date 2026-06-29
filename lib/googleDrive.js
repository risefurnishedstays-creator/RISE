// lib/googleDrive.js
//
// Uploads signed lease PDFs (and guest-uploaded government ID photos) to
// a Google Drive folder, authenticating as the real risefurnishedstays@gmail.com
// account via OAuth2 -- NOT a service account.
//
// WHY NOT A SERVICE ACCOUNT (this code used to use one -- if you're
// reading this after migrating, here's why that approach was abandoned):
// service accounts have ZERO storage quota of their own, by Google's own
// design. Even with Editor access to a folder shared by a real account,
// a service account creating a NEW file in that folder gets rejected with
// "Service Accounts do not have storage quota" (a 403,
// reason: "storageQuotaExceeded") -- sharing permissions and storage
// ownership are two separate systems, and the service account has no
// quota to charge the new file against. The two normal fixes are (a) a
// Shared Drive, whose storage belongs to the Shared Drive itself rather
// than any one member -- but Shared Drives require a paid Google
// Workspace account, not available on a free personal Gmail account like
// this one -- or (b) authenticate as a real user via OAuth2, so uploads
// count against that real account's normal 15GB quota. This file does (b).
//
// SETUP REQUIRED (one-time -- not code):
//   1. console.cloud.google.com -> create a project (or use an existing one).
//   2. APIs & Services -> Library -> search "Google Drive API" -> Enable.
//   3. APIs & Services -> OAuth consent screen -> configure it (User type:
//      External is fine for this; it only ever needs to authorize YOUR
//      own account, not the public). Add risefurnishedstays@gmail.com as
//      a test user if prompted -- this avoids needing Google's full app
//      verification review, which isn't needed since no one else will
//      ever see this consent screen.
//   4. APIs & Services -> Credentials -> Create Credentials -> OAuth
//      client ID -> Application type: "Desktop app" (this type doesn't
//      need a registered redirect URL, simplest for a one-time local
//      script). Note the Client ID and Client Secret it gives you.
//   5. Run scripts/get-google-drive-refresh-token.js LOCALLY on your own
//      computer (not on Vercel) -- see that file for exact instructions.
//      It opens a Google sign-in/consent page in your browser; sign in as
//      risefurnishedstays@gmail.com and approve access. The script then
//      prints a refresh token -- a long-lived credential that lets this
//      code request fresh access on your behalf indefinitely, without
//      you ever signing in again.
//   6. In Google Drive (as risefurnishedstays@gmail.com), create a folder
//      for signed leases -- no sharing step needed this time, since
//      you're uploading as yourself, not sharing with anyone else. Copy
//      the folder's ID from its URL (the string after /folders/).
//   7. Set these in Vercel env vars:
//        GOOGLE_OAUTH_CLIENT_ID      -- from step 4
//        GOOGLE_OAUTH_CLIENT_SECRET  -- from step 4
//        GOOGLE_OAUTH_REFRESH_TOKEN  -- from step 5
//        GOOGLE_DRIVE_LEASES_FOLDER_ID -- the folder ID from step 6
//
// Until all four are set, uploadSignedLease() throws a clear
// configuration error rather than silently failing.

const { google } = require("googleapis");

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_OAUTH_CLIENT_ID &&
    process.env.GOOGLE_OAUTH_CLIENT_SECRET &&
    process.env.GOOGLE_OAUTH_REFRESH_TOKEN &&
    process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID
  );
}

function getAuth() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET
    // No redirect URI needed here -- that's only used during the
    // one-time interactive authorization in the setup script, not when
    // exchanging a refresh token for a fresh access token.
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN });
  // No manual token-refresh logic needed beyond this: the googleapis
  // client automatically calls Google to mint a new short-lived access
  // token from the refresh token whenever the current one is missing or
  // expired, on every cold start as well as long-running invocations --
  // refresh tokens themselves don't expire under normal use (they only
  // stop working if revoked, unused for 6+ months, or the OAuth consent
  // screen is still in "Testing" status with its default 7-day token
  // expiry -- if uploads mysteriously stop working again after about a
  // week, check that the consent screen has been moved to "In production"
  // in Google Cloud Console, even though it's only ever used by one person).
  return oauth2Client;
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
      "Google Drive is not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, " +
      "GOOGLE_OAUTH_REFRESH_TOKEN, and GOOGLE_DRIVE_LEASES_FOLDER_ID in Vercel env vars. See " +
      "comments at the top of lib/googleDrive.js for setup steps."
    );
  }

  const auth = getAuth();
  const drive = google.drive({ version: "v3", auth });
  const folderId = sanitizeFolderId(process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID);

  let res;
  try {
    res = await drive.files.create({
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
  } catch (e) {
    // A couple of OAuth-specific failure signatures are worth calling out
    // by name rather than leaving the caller to puzzle through Google's
    // generic error -- both stem from the refresh token itself being
    // unusable, not from anything about this specific upload.
    const msg = (e && e.message) || "";
    if (msg.includes("invalid_grant")) {
      throw new Error(
        "Google OAuth refresh token was rejected (invalid_grant). This usually means it was " +
        "revoked, or the OAuth consent screen is still in \"Testing\" mode in Google Cloud " +
        "Console -- test-mode tokens expire after 7 days and need re-authorizing via " +
        "scripts/get-google-drive-refresh-token.js. Move the consent screen to \"In production\" " +
        "to avoid this recurring. Original error: " + msg
      );
    }
    throw e;
  }

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
