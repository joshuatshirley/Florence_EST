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
 *
 * Notification on each save: MailApp.sendEmail to NOTIFY_EMAIL, as an
 * HTML report (with a plain-text fallback body for clients that don't
 * render HTML) -- a per-section breakdown table, not just the AFQT
 * number, so a section that went poorly is visible without opening
 * the Sheet, and the email itself is presentable enough to forward
 * straight to a recruiter. (This started as a T-Mobile email-to-SMS
 * gateway address -- carriers routinely filter or kill those, and
 * this one stopped delivering, so it now goes to a real inbox
 * instead.) Adding this to an already-deployed script requires a
 * fresh authorization the first time (it now sends email, a new
 * scope) -- expect a consent prompt on the next "New version" deploy.
 * Set NOTIFY_EMAIL to "" to disable.
 */

var SHEET_NAME = "Results";
var NOTIFY_EMAIL = "joshua.t.shirley@army.mil";
var SHEET_URL = "https://docs.google.com/spreadsheets/d/1BftqXMNaw7WurUHmzGtQiUQvFmgnaGe-1Qm_CtW1Tjc/edit";

var SECTION_NAMES = {
  WK: "Word Knowledge",
  AR: "Arithmetic Reasoning",
  PC: "Paragraph Comprehension",
  MK: "Mathematics Knowledge"
};
// Section order + thresholds match the kiosk's own statusBand() in
// est-kiosk-standalone.html -- keep these in sync if that ever changes.
var SECTION_ORDER = ["WK", "AR", "PC", "MK"];

var HEADER_ROW = [
  "Timestamp", "Name", "Recruiter", "AFQT", "VE Score", "AR Score", "MK Score", "Std Sum",
  "WK Correct", "WK Total", "WK Unanswered",
  "AR Correct", "AR Total", "AR Unanswered",
  "PC Correct", "PC Total", "PC Unanswered",
  "MK Correct", "MK Total", "MK Unanswered",
  "Phone",
  "Last Name", "First Name",
  "Test Number"
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
    data.first_name || "",
    data.test_number || 1
  ]);

  notifyResult(data);
}

// Best-effort: the row is already saved by the time this runs, so a
// notify failure (e.g. MailApp's daily quota) must not surface as a
// save failure back to the kiosk.
function notifyResult(data) {
  if (!NOTIFY_EMAIL) return;
  try {
    var when = Utilities.formatDate(
      data.timestamp ? new Date(data.timestamp) : new Date(),
      SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(),
      "yyyy MMM dd HH:mm"
    ).toUpperCase();
    var lastName = data.last_name || "";
    var firstName = data.first_name || "";
    var recruiter = data.recruiter || "";
    var afqt = data.afqt;
    var phone = formatPhone(data.phone);
    var testNumber = data.test_number || 1;
    var sections = data.sections || {};

    var subject = "EST " + recruiter + " " + lastName + " " + firstName +
      " AFQT " + afqt + " " + phone;

    var plainLines = [when, lastName + ", " + firstName, "AFQT: " + afqt, phone, recruiter];
    if (testNumber > 1) plainLines.push("Test " + testNumber);
    SECTION_ORDER.forEach(function (code) {
      var s = sections[code];
      if (!s) return;
      plainLines.push(SECTION_NAMES[code] + ": " + s.correct + "/" + s.total + " (" + statusBand(s).label + ")");
    });
    plainLines.push(SHEET_URL);
    var body = plainLines.join("\n");

    MailApp.sendEmail(NOTIFY_EMAIL, subject, body, { htmlBody: buildHtmlReport(data, when, testNumber) });
  } catch (err) {
    Logger.log("notifyResult failed: " + err);
  }
}

// Same 70%/40% thresholds as the kiosk's own statusBand() in
// est-kiosk-standalone.html, so this email reads the same as what the
// recruiter saw live on the device.
function statusBand(section) {
  var pct = section.total ? (100 * section.correct) / section.total : 0;
  if (pct >= 70) return { color: "#0ca30c", label: "Strong" };
  if (pct >= 40) return { color: "#fab219", label: "Needs review" };
  return { color: "#d03b3b", label: "Keep practicing" };
}

function buildHtmlReport(data, when, testNumber) {
  var lastName = esc(data.last_name || "");
  var firstName = esc(data.first_name || "");
  var recruiter = esc(data.recruiter || "");
  var phone = esc(formatPhone(data.phone));
  var sections = data.sections || {};

  var rows = SECTION_ORDER.map(function (code) {
    var s = sections[code];
    if (!s) return "";
    var band = statusBand(s);
    return "<tr>" +
      "<td style=\"padding:6px 12px;border-bottom:1px solid #eee;\">" + esc(SECTION_NAMES[code]) + "</td>" +
      "<td style=\"padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-variant-numeric:tabular-nums;\">" + s.correct + " / " + s.total + "</td>" +
      "<td style=\"padding:6px 12px;border-bottom:1px solid #eee;color:" + band.color + ";font-weight:600;\">" + band.label + "</td>" +
      "</tr>";
  }).join("");

  return "<div style=\"font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;max-width:480px;\">" +
    "<p style=\"color:#555;margin:0 0 12px;\">" + esc(when) + (testNumber > 1 ? " &middot; Test " + testNumber : "") + "</p>" +
    "<h2 style=\"margin:0 0 4px;\">" + lastName + ", " + firstName + "</h2>" +
    "<p style=\"color:#555;margin:0 0 16px;\">" + recruiter + (phone ? " &middot; " + phone : "") + "</p>" +
    "<div style=\"text-align:center;margin:0 0 20px;\">" +
    "<div style=\"font-size:2.5rem;font-weight:700;color:#1e4d8c;\">" + data.afqt + "</div>" +
    "<div style=\"font-size:0.8rem;color:#555;text-transform:uppercase;letter-spacing:1px;\">Projected AFQT</div>" +
    "</div>" +
    "<table style=\"width:100%;border-collapse:collapse;font-size:0.95rem;\">" + rows + "</table>" +
    "<p style=\"margin:20px 0 0;\"><a href=\"" + SHEET_URL + "\">View full results sheet &#8599;</a></p>" +
    "</div>";
}

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Formats a 10-digit US number as "(XXX) XXX-XXXX"; a leading country
// code "1" on an 11-digit number is dropped first. Anything that isn't
// a standard 10-digit number (blank, partial, international) is
// returned as typed rather than guessed at.
function formatPhone(phone) {
  if (!phone) return "";
  var digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return phone;
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
