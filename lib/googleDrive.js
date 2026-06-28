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

const { google } = require("googleapis");

function isConfigured() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_KEY && process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID);
}

function getAuth() {
  let credentials;
  try {
    credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } catch (e) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON. It should be the entire contents " +
      "of the service account's downloaded key file, pasted as-is."
    );
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/drive.file"],
  });
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

  const res = await drive.files.create({
    requestBody: {
      name: filename,
      parents: [process.env.GOOGLE_DRIVE_LEASES_FOLDER_ID],
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
