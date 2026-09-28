/**
 * Backend for the Florence EST kiosk's results webhook.
 *
 * Source of truth for the Apps Script deployed at
 * https://script.google.com/ (Extensions > Apps Script, from a Google
 * Sheet). This file is not run from here -- it's kept in the repo so
 * the deployed script has a version-controlled copy to diff against
 * and redeploy from.
 *
 * Setup (one-time):
 *   1. Create a new Google Sheet (e.g. "Florence EST Results").
 *   2. Extensions > Apps Script. Delete the boilerplate, paste this file.
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Authorize when prompted, then copy the resulting web app URL
 *      (ends in /exec) into RESULTS_WEBHOOK_URL in
 *      est-kiosk-standalone.html.
 *
 * The kiosk POSTs JSON as Content-Type: text/plain (not
 * application/json) specifically to avoid a CORS preflight -- Apps
 * Script's web app endpoint issues a redirect for POST requests that
 * a preflighted request can choke on. This script parses the body as
 * JSON regardless of the declared content type.
 *
 * Redeploying after an edit: Deploy > Manage deployments > pick the
 * existing deployment > Edit (pencil) > New version > Deploy. This
 * keeps the same /exec URL, so the kiosk doesn't need updating.
 *
 * Note on HEADER_ROW: it's only written once, when the sheet is empty
 * (see getOrCreateSheet). If you add a field to a sheet that already
 * has rows, add the matching header cell yourself in row 1 -- new
 * columns are appended at the END of appendResultRow specifically so
 * this is a one-cell addition, not a reorder of existing columns.
 *
 * Optional "Roster" tab (each recruiter's tested applicants + phone
 * numbers, grouped by recruiter then last name): add a new sheet tab
 * named "Roster" and paste this into cell A1. It's a live formula, not
 * script output -- no redeploy needed if it ever needs re-adding.
 *
 *   =QUERY(Results!A2:W, "select C, V, W, U, max(A), count(A) group by
 *   C, V, W, U order by C, V, W label C 'Recruiter', V 'Last Name',
 *   W 'First Name', U 'Phone', max(A) 'Last Tested', count(A)
 *   'Times Tested'", 0)
 *
 * Column letters (C=Recruiter, V=Last Name, W=First Name, U=Phone,
 * A=Timestamp) assume HEADER_ROW's current column order below -- if
 * that order changes, update the letters in the formula to match.
 */

var SHEET_NAME = "Results";

var HEADER_ROW = [
  "Timestamp", "Name", "Recruiter", "AFQT", "VE Score", "AR Score", "MK Score", "Std Sum",
  "WK Correct", "WK Total", "WK Unanswered",
  "AR Correct", "AR Total", "AR Unanswered",
  "PC Correct", "PC Total", "PC Unanswered",
  "MK Correct", "MK Total", "MK Unanswered",
  "Phone",
  "Last Name", "First Name"
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    appendResultRow(data);
    return jsonResponse({ ok: true });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function appendResultRow(data) {
  var sheet = getOrCreateSheet();
  var sections = data.sections || {};

  function field(code, key) {
    var s = sections[code];
    return s && s[key] !== undefined ? s[key] : "";
  }

  // The kiosk sends last_name/first_name separately (so this sheet can sort
  // and group by last name); the "Name" column is still populated here, as
  // a combined "First Last" display string, for continuity with rows saved
  // before that split.
  var displayName = ((data.first_name || "") + " " + (data.last_name || "")).trim();

  sheet.appendRow([
    data.timestamp || new Date().toISOString(),
    displayName,
    data.recruiter || "",
    data.afqt,
    data.ve_score,
    data.ar_score,
    data.mk_score,
    data.std_sum,
    field("WK", "correct"), field("WK", "total"), field("WK", "unanswered"),
    field("AR", "correct"), field("AR", "total"), field("AR", "unanswered"),
    field("PC", "correct"), field("PC", "total"), field("PC", "unanswered"),
    field("MK", "correct"), field("MK", "total"), field("MK", "unanswered"),
    data.phone || "",
    data.last_name || "",
    data.first_name || ""
  ]);
}

function getOrCreateSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER_ROW);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
