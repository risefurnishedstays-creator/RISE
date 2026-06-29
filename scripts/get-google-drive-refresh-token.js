#!/usr/bin/env node
/* ============================================================
   scripts/get-google-drive-refresh-token.js

   ONE-TIME SETUP SCRIPT -- run this on your own computer, NOT on
   Vercel. It gets you a Google OAuth refresh token so the live site
   can upload signed leases and ID photos to Drive AS YOU
   (risefurnishedstays@gmail.com), using your account's real 15GB
   storage quota.

   WHY THIS EXISTS: the original setup used a Google "service account,"
   which turned out not to work for this use case at all -- service
   accounts have NO storage quota of their own (a deliberate Google
   restriction), so they can't create new files even in a folder
   that's been shared with them. The fix is to authenticate as your
   real Google account instead. Real accounts need an actual human to
   click "Allow" on a consent screen at least once -- that's what
   this script is for. After this one-time step, the live site never
   needs you to click anything again; it reuses the refresh token this
   prints, indefinitely.

   ----------------------------------------------------------------
   BEFORE RUNNING THIS SCRIPT:
   ----------------------------------------------------------------
   1. Go to console.cloud.google.com (create a project if you don't
      have one yet).
   2. APIs & Services -> Library -> search "Google Drive API" -> Enable.
   3. APIs & Services -> OAuth consent screen -> configure it minimally:
      User type "External" is fine (you're not publishing this to
      anyone). Add risefurnishedstays@gmail.com under "Test users" if
      it asks -- this lets you use it without Google's full app-review
      process, since no one but you will ever see this screen.
      IMPORTANT: while the consent screen is in "Testing" status,
      Google expires refresh tokens after 7 days of the app being
      untouched -- before going live, switch it to "In production"
      (a button on that same settings page) so the token lasts
      indefinitely. It's still only ever used by your own account.
   4. APIs & Services -> Credentials -> Create Credentials -> OAuth
      client ID -> Application type: "Desktop app" -> give it any
      name. Click through and you'll get a Client ID and Client
      Secret -- copy both.

   ----------------------------------------------------------------
   HOW TO RUN THIS SCRIPT:
   ----------------------------------------------------------------
   From a terminal, inside this repo's folder:

     npm install            (only if you haven't already, to get the
                              "googleapis" package this script needs)

     node scripts/get-google-drive-refresh-token.js "YOUR_CLIENT_ID" "YOUR_CLIENT_SECRET"

   Replace the two quoted values with what Google gave you in step 4
   above. The script will:
     a. Print a Google sign-in URL.
     b. Open that URL in your default browser automatically (or copy
        it and open it manually if that doesn't happen).
     c. You sign in as risefurnishedstays@gmail.com and click "Allow."
     d. Google redirects your browser back to a localhost address this
        script is listening on, which captures an authorization code.
     e. The script exchanges that code for tokens and prints your
        REFRESH TOKEN to the terminal.

   Copy that refresh token, then set these THREE values in Vercel's
   environment variables (Project Settings -> Environment Variables):
     GOOGLE_OAUTH_CLIENT_ID      = the client ID you passed in
     GOOGLE_OAUTH_CLIENT_SECRET  = the client secret you passed in
     GOOGLE_OAUTH_REFRESH_TOKEN  = the refresh token this script prints

   (GOOGLE_DRIVE_LEASES_FOLDER_ID is unrelated to this script -- that's
   just the destination folder's ID, set the same way as before.)

   This script never sends your credentials anywhere except Google's
   own servers, and doesn't save anything to disk -- the refresh token
   only ever appears in your terminal output, for you to copy yourself.
   ============================================================ */

const { google } = require("googleapis");
const http = require("http");
const { URL } = require("url");

const REDIRECT_PORT = 53682; // arbitrary unused local port
const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;
const SCOPES = ["https://www.googleapis.com/auth/drive"];

const [, , clientId, clientSecret] = process.argv;

if (!clientId || !clientSecret) {
  console.error(
    "\nUsage: node scripts/get-google-drive-refresh-token.js \"CLIENT_ID\" \"CLIENT_SECRET\"\n\n" +
    "Get those two values from Google Cloud Console -> APIs & Services -> Credentials\n" +
    "(see the comment block at the top of this file for the full setup steps).\n"
  );
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline", // REQUIRED to get a refresh token, not just a short-lived access token
  prompt: "consent",      // forces the consent screen even if you've authorized this app before,
                           // which guarantees Google actually issues a refresh token this time
                           // (it sometimes skips re-issuing one on a repeat authorization otherwise)
  scope: SCOPES,
});

console.log("\n=================================================================");
console.log("Open this URL in your browser and sign in as risefurnishedstays@gmail.com:");
console.log("=================================================================\n");
console.log(authUrl);
console.log("\n(Waiting for you to approve access in the browser...)\n");

// Best-effort: try to open the URL automatically. If this fails on your
// OS/setup, no problem -- just copy the URL printed above into a browser
// by hand.
try {
  const { exec } = require("child_process");
  const opener = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
  exec(`${opener} "${authUrl}"`);
} catch (e) {
  // Silent -- the printed URL above is the real fallback either way.
}

const server = http.createServer(async (req, res) => {
  try {
    const reqUrl = new URL(req.url, REDIRECT_URI);
    if (reqUrl.pathname !== "/oauth2callback") {
      res.writeHead(404);
      res.end();
      return;
    }

    const code = reqUrl.searchParams.get("code");
    const error = reqUrl.searchParams.get("error");

    if (error) {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<h2>Authorization failed</h2><p>${error}</p><p>You can close this tab.</p>`);
      console.error("\nAuthorization was denied or failed:", error);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { "Content-Type": "text/html" });
      res.end("<h2>No authorization code received.</h2>");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Success!</h2><p>You can close this tab and go back to your terminal.</p>");

    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      console.error(
        "\nGoogle did not return a refresh token. This usually happens if you've already " +
        "authorized this exact app before and Google decided not to re-issue one. Try " +
        "revoking this app's access at https://myaccount.google.com/permissions, then run " +
        "this script again.\n"
      );
      server.close();
      process.exit(1);
    }

    console.log("\n=================================================================");
    console.log("SUCCESS. Copy this refresh token into Vercel as GOOGLE_OAUTH_REFRESH_TOKEN:");
    console.log("=================================================================\n");
    console.log(tokens.refresh_token);
    console.log("\n=================================================================");
    console.log("Also set these two in Vercel, using the values you passed to this script:");
    console.log("  GOOGLE_OAUTH_CLIENT_ID =", clientId);
    console.log("  GOOGLE_OAUTH_CLIENT_SECRET =", clientSecret);
    console.log("=================================================================\n");

    server.close();
    process.exit(0);
  } catch (e) {
    console.error("\nSomething went wrong exchanging the authorization code:", e.message);
    res.writeHead(500, { "Content-Type": "text/html" });
    res.end("<h2>Something went wrong. Check your terminal.</h2>");
    server.close();
    process.exit(1);
  }
});

server.listen(REDIRECT_PORT, () => {
  // Intentionally quiet here -- the auth URL printed above is the
  // actionable output; this is just confirming the local listener is up.
});
