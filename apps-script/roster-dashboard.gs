/**
 * Private roster dashboard for the Florence EST kiosk's results.
 *
 * DELIBERATELY a separate Apps Script project from results-webhook.gs,
 * not a second deployment of it. results-webhook.gs's web app has to
 * stay "Anyone can access" -- the kiosk (an anonymous recruiter's
 * iPad) POSTs to it with no sign-in. If this dashboard's doGet lived
 * in that same project, its deployment's access level would apply to
 * BOTH verbs, and "Anyone" would mean anyone with the URL could read
 * every applicant's name and phone number. Keeping this in its own
 * project lets its deployment be locked to "Only myself" -- enforced
 * by actual Google sign-in, not a link anyone could guess or leak.
 *
 * Setup (one-time):
 *   1. script.google.com -> New project (NOT "Extensions > Apps
 *      Script" from the Sheet -- that binds it to the sheet's own
 *      project, which is results-webhook.gs's project).
 *   2. Paste this file's contents in.
 *   3. Deploy > New deployment > type "Web app".
 *        Execute as: Me
 *        Who has access: Only myself
 *   4. Authorize when prompted. Visit the resulting URL (ends in
 *      /exec) directly in your browser, signed into the same Google
 *      account -- it renders the roster HTML immediately, no separate
 *      client-side fetch/CORS involved.
 *
 * Redeploying after an edit: Deploy > Manage deployments > pick the
 * existing deployment > Edit (pencil) > New version > Deploy. Keeps
 * the same URL.
 *
 * Reads the same "Florence EST Results" sheet as results-webhook.gs
 * by ID (SpreadsheetApp.openById), not by binding, since this is an
 * independent project.
 */

var SHEET_ID = "1BftqXMNaw7WurUHmzGtQiUQvFmgnaGe-1Qm_CtW1Tjc";
var SHEET_NAME = "Results";

function doGet(e) {
  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  var values = sheet.getDataRange().getValues();
  var headers = values[0];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  // Grouped by recruiter+name only (not phone) -- the phone field is
  // free-typed on the kiosk with no format enforced, so the same
  // person retested with "8641234567" one time and "(864) 123-4567"
  // the next would otherwise fragment into two roster rows instead of
  // one with Times Tested: 2.
  var people = {}; // key: recruiter|lastName|firstName -> aggregate
  values.slice(1).forEach(function (row) {
    var recruiter = row[col["Recruiter"]] || "(no recruiter)";
    var lastName = row[col["Last Name"]] || "";
    var firstName = row[col["First Name"]] || "";
    var phone = row[col["Phone"]] || "";
    var afqt = row[col["AFQT"]];
    var timestamp = row[col["Timestamp"]];

    var key = [recruiter, lastName, firstName].join("|");
    if (!people[key]) {
      people[key] = {
        recruiter: recruiter, lastName: lastName, firstName: firstName,
        phone: "", afqt: afqt, lastTested: timestamp, timesTested: 0
      };
    }
    var p = people[key];
    p.timesTested++;
    var isNewer = new Date(timestamp) > new Date(p.lastTested);
    if (isNewer) {
      p.lastTested = timestamp;
      p.afqt = afqt;
      if (phone) p.phone = phone; // most recent attempt's phone wins if given
    } else if (!p.phone && phone) {
      p.phone = phone; // otherwise fall back to an earlier attempt's phone
    }
  });

  var groups = {};
  Object.keys(people).forEach(function (key) {
    var p = people[key];
    (groups[p.recruiter] = groups[p.recruiter] || []).push(p);
  });
  var recruiters = Object.keys(groups).sort();
  recruiters.forEach(function (r) {
    groups[r].sort(function (a, b) { return a.lastName.localeCompare(b.lastName); });
  });

  var html = renderPage(recruiters, groups, Object.keys(people).length);
  return HtmlService.createHtmlOutput(html)
    .setTitle("Florence EST Roster")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function renderPage(recruiters, groups, totalPeople) {
  var generated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy MMM dd HH:mm").toUpperCase();

  var sections = recruiters.map(function (r) {
    var rows = groups[r].map(function (p) {
      return "<tr>" +
        "<td>" + esc(p.lastName) + "</td>" +
        "<td>" + esc(p.firstName) + "</td>" +
        "<td>" + esc(formatPhone(p.phone)) + "</td>" +
        "<td class=\"num\">" + esc(p.afqt) + "</td>" +
        "<td>" + esc(formatDate(p.lastTested)) + "</td>" +
        "<td class=\"num\">" + p.timesTested + "</td>" +
        "</tr>";
    }).join("");

    return "<section class=\"card\">" +
      "<h2>" + esc(r) + " <span class=\"count\">(" + groups[r].length + ")</span></h2>" +
      "<div class=\"table-wrap\"><table>" +
      "<thead><tr><th>Last Name</th><th>First Name</th><th>Phone</th>" +
      "<th class=\"num\">AFQT</th><th>Last Tested</th><th class=\"num\">Times</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table></div></section>";
  }).join("");

  return "<!doctype html><html><head><style>" + CSS + "</style></head><body>" +
    "<h1>Florence EST Roster</h1>" +
    "<p class=\"meta\">" + totalPeople + " people across " + recruiters.length + " recruiters &middot; generated " + generated + "</p>" +
    sections +
    "</body></html>";
}

function formatDate(timestamp) {
  if (!timestamp) return "";
  var d = new Date(timestamp);
  if (isNaN(d.getTime())) return String(timestamp);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy MMM dd HH:mm").toUpperCase();
}

// Same 10-digit US formatting as results-webhook.gs's notifyResult, kept
// here too since this is an independent project (no shared library).
function formatPhone(phone) {
  if (!phone) return "";
  var digits = String(phone).replace(/\D/g, "");
  if (digits.length === 11 && digits.charAt(0) === "1") digits = digits.slice(1);
  if (digits.length === 10) {
    return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
  }
  return phone;
}

// Applicant-typed strings (names) land here unsanitized from the kiosk,
// so every value is escaped before going into the HTML string this page
// serves back to a real, signed-in browser.
function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var CSS = [
  "body{font-family:Arial,Helvetica,sans-serif;background:#f2f2f2;color:#1a1a1a;margin:0;padding:24px 16px 48px;}",
  "h1{margin:0 0 4px;}",
  ".meta{color:#555;margin:0 0 24px;font-size:0.9rem;}",
  ".card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:16px 20px;margin-bottom:20px;max-width:900px;}",
  ".card h2{margin:0 0 12px;font-size:1.2rem;}",
  ".count{color:#777;font-weight:400;font-size:0.9rem;}",
  ".table-wrap{overflow-x:auto;}",
  "table{border-collapse:collapse;width:100%;font-size:0.95rem;}",
  "th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;}",
  "th{background:#f7f7f7;font-weight:700;}",
  "td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}"
].join("");
