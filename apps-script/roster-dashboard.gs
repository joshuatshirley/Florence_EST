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
 *
 * Filters (Recruiter / Min-Max AFQT / date range) are plain GET query
 * params read via a same-page <form method="get">, not client-side JS
 * -- reload with new params, doGet re-renders filtered. Whole doGet is
 * wrapped in try/catch: any failure renders an actual error message
 * on the page instead of Apps Script's generic raw error screen.
 */

var SHEET_ID = "1BftqXMNaw7WurUHmzGtQiUQvFmgnaGe-1Qm_CtW1Tjc";
var SHEET_NAME = "Results";

function doGet(e) {
  try {
    return HtmlService.createHtmlOutput(buildDashboard(e))
      .setTitle("Florence EST Roster")
      .addMetaTag("viewport", "width=device-width, initial-scale=1");
  } catch (err) {
    return HtmlService.createHtmlOutput(renderErrorPage(err))
      .setTitle("Florence EST Roster -- Error");
  }
}

function buildDashboard(e) {
  var params = (e && e.parameter) || {};
  var filters = parseFilters(params);

  var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("No sheet named \"" + SHEET_NAME + "\" was found in the spreadsheet.");

  var values = sheet.getDataRange().getValues();
  if (values.length < 1) throw new Error("The Results sheet appears to be empty (no header row).");

  var headers = values[0];
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });

  var allRecruiters = {};
  values.slice(1).forEach(function (row) {
    var r = row[col["Recruiter"]];
    if (r) allRecruiters[r] = true;
  });
  var recruiterList = Object.keys(allRecruiters).sort();

  var rows = values.slice(1).filter(function (row) { return rowMatchesFilters(row, col, filters); });

  var people = aggregateByPerson(rows, col);
  var groups = {};
  Object.keys(people).forEach(function (key) {
    var p = people[key];
    (groups[p.recruiter] = groups[p.recruiter] || []).push(p);
  });
  var recruiters = Object.keys(groups).sort();
  recruiters.forEach(function (r) {
    groups[r].sort(function (a, b) { return a.lastName.localeCompare(b.lastName); });
  });

  var summary = {
    testCount: rows.length,
    peopleCount: Object.keys(people).length,
    avgAfqt: rows.length ? Math.round(rows.reduce(function (sum, row) { return sum + (Number(row[col["AFQT"]]) || 0); }, 0) / rows.length) : null
  };

  return renderPage(recruiters, groups, summary, filters, recruiterList);
}

// Grouped by recruiter+name only (not phone) -- the phone field is
// free-typed on the kiosk with no format enforced, so the same person
// retested with "8641234567" one time and "(864) 123-4567" the next
// would otherwise fragment into two roster rows instead of one with
// Times Tested: 2. Latest test (by timestamp) wins for AFQT, next
// action, and notes; phone falls back to an earlier attempt if the
// latest one didn't provide it.
function aggregateByPerson(rows, col) {
  var people = {};
  rows.forEach(function (row) {
    var recruiter = row[col["Recruiter"]] || "(no recruiter)";
    var lastName = row[col["Last Name"]] || "";
    var firstName = row[col["First Name"]] || "";
    var phone = row[col["Phone"]] || "";
    var afqt = row[col["AFQT"]];
    var timestamp = row[col["Timestamp"]];
    var nextAction = col["Next Action"] !== undefined ? row[col["Next Action"]] : "";
    var notes = col["Notes"] !== undefined ? row[col["Notes"]] : "";

    var key = [recruiter, lastName, firstName].join("|");
    if (!people[key]) {
      people[key] = {
        recruiter: recruiter, lastName: lastName, firstName: firstName,
        phone: "", afqt: afqt, lastTested: timestamp, timesTested: 0,
        nextAction: nextAction || "", notes: notes || ""
      };
    }
    var p = people[key];
    p.timesTested++;
    var isNewer = new Date(timestamp) > new Date(p.lastTested);
    if (isNewer) {
      p.lastTested = timestamp;
      p.afqt = afqt;
      p.nextAction = nextAction || "";
      p.notes = notes || "";
      if (phone) p.phone = phone;
    } else if (!p.phone && phone) {
      p.phone = phone;
    }
  });
  return people;
}

function parseFilters(params) {
  var minScore = parseFloat(params.minScore);
  var maxScore = parseFloat(params.maxScore);
  var dateFrom = parseDateOnly(params.dateFrom);
  var dateTo = parseDateOnly(params.dateTo);
  return {
    recruiter: params.recruiter || "",
    minScore: isNaN(minScore) ? null : minScore,
    maxScore: isNaN(maxScore) ? null : maxScore,
    dateFromRaw: params.dateFrom || "",
    dateToRaw: params.dateTo || "",
    dateFrom: dateFrom,
    dateTo: dateTo
  };
}

// "YYYY-MM-DD" (what <input type=date> sends) -> Date at local midnight,
// or null if blank/unparseable. Never throws on bad input -- an
// unparseable date is treated as "no filter" rather than an error.
function parseDateOnly(value) {
  if (!value) return null;
  var m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isNaN(d.getTime()) ? null : d;
}

function rowMatchesFilters(row, col, filters) {
  if (filters.recruiter && row[col["Recruiter"]] !== filters.recruiter) return false;

  if (filters.minScore !== null || filters.maxScore !== null) {
    var afqt = Number(row[col["AFQT"]]);
    if (isNaN(afqt)) return false;
    if (filters.minScore !== null && afqt < filters.minScore) return false;
    if (filters.maxScore !== null && afqt > filters.maxScore) return false;
  }

  if (filters.dateFrom || filters.dateTo) {
    var ts = new Date(row[col["Timestamp"]]);
    if (isNaN(ts.getTime())) return false;
    var dateOnly = new Date(ts.getFullYear(), ts.getMonth(), ts.getDate());
    if (filters.dateFrom && dateOnly < filters.dateFrom) return false;
    if (filters.dateTo && dateOnly > filters.dateTo) return false;
  }

  return true;
}

function renderPage(recruiters, groups, summary, filters, recruiterList) {
  var generated = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy MMM dd HH:mm").toUpperCase();
  var selfUrl = ScriptApp.getService().getUrl();

  var recruiterOptions = "<option value=\"\">All recruiters</option>" +
    recruiterList.map(function (r) {
      var selected = r === filters.recruiter ? " selected" : "";
      return "<option value=\"" + esc(r) + "\"" + selected + ">" + esc(r) + "</option>";
    }).join("");

  var filterForm = "" +
    "<form method=\"get\" class=\"filters\">" +
    "<div class=\"filter-field\"><label>Recruiter</label><select name=\"recruiter\">" + recruiterOptions + "</select></div>" +
    "<div class=\"filter-field\"><label>Min AFQT</label><input type=\"number\" name=\"minScore\" value=\"" + esc(filters.minScore === null ? "" : filters.minScore) + "\"></div>" +
    "<div class=\"filter-field\"><label>Max AFQT</label><input type=\"number\" name=\"maxScore\" value=\"" + esc(filters.maxScore === null ? "" : filters.maxScore) + "\"></div>" +
    "<div class=\"filter-field\"><label>From</label><input type=\"date\" name=\"dateFrom\" value=\"" + esc(filters.dateFromRaw) + "\"></div>" +
    "<div class=\"filter-field\"><label>To</label><input type=\"date\" name=\"dateTo\" value=\"" + esc(filters.dateToRaw) + "\"></div>" +
    "<div class=\"filter-actions\"><button type=\"submit\">Apply Filters</button> <a href=\"" + esc(selfUrl) + "\">Clear</a></div>" +
    "</form>";

  var summaryLine = summary.testCount +
    (summary.testCount === 1 ? " test" : " tests") + " &middot; " +
    summary.peopleCount + (summary.peopleCount === 1 ? " person" : " people") +
    (summary.avgAfqt !== null ? " &middot; avg AFQT " + summary.avgAfqt : "");

  var sections = recruiters.length ? recruiters.map(function (r) {
    var rows = groups[r].map(function (p) {
      return "<tr>" +
        "<td>" + esc(p.lastName) + "</td>" +
        "<td>" + esc(p.firstName) + "</td>" +
        "<td>" + esc(formatPhone(p.phone)) + "</td>" +
        "<td class=\"num\">" + esc(p.afqt) + "</td>" +
        "<td>" + esc(formatDate(p.lastTested)) + "</td>" +
        "<td class=\"num\">" + p.timesTested + "</td>" +
        "<td>" + esc(p.nextAction) + "</td>" +
        "<td class=\"notes\">" + esc(p.notes) + "</td>" +
        "</tr>";
    }).join("");

    return "<section class=\"card\">" +
      "<h2>" + esc(r) + " <span class=\"count\">(" + groups[r].length + ")</span></h2>" +
      "<div class=\"table-wrap\"><table>" +
      "<thead><tr><th>Last Name</th><th>First Name</th><th>Phone</th>" +
      "<th class=\"num\">AFQT</th><th>Last Tested</th><th class=\"num\">Times</th>" +
      "<th>Next Action</th><th>Notes</th></tr></thead>" +
      "<tbody>" + rows + "</tbody>" +
      "</table></div></section>";
  }).join("") : "<p class=\"empty\">No results match these filters.</p>";

  return "<!doctype html><html><head><meta charset=\"utf-8\"><style>" + CSS + "</style></head><body>" +
    "<h1>Florence EST Roster</h1>" +
    filterForm +
    "<p class=\"meta\">" + summaryLine + " &middot; generated " + generated + "</p>" +
    sections +
    "</body></html>";
}

function renderErrorPage(err) {
  return "<!doctype html><html><head><meta charset=\"utf-8\"><style>" + CSS + "</style></head><body>" +
    "<h1>Florence EST Roster</h1>" +
    "<section class=\"card\"><h2 style=\"color:#d03b3b;\">Something went wrong</h2>" +
    "<p>" + esc(err && err.message ? err.message : String(err)) + "</p>" +
    "<p class=\"meta\">If this keeps happening, check that the Results sheet still has a \"Recruiter\", \"AFQT\", and \"Timestamp\" column, and that this script still has permission to open the spreadsheet.</p>" +
    "</section></body></html>";
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

// Applicant-typed strings (names, notes) land here unsanitized from the
// kiosk, so every value is escaped before going into the HTML string
// this page serves back to a real, signed-in browser.
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
  ".empty{color:#555;}",
  ".filters{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:16px 20px;margin:16px 0;max-width:900px;display:flex;flex-wrap:wrap;gap:14px;align-items:flex-end;}",
  ".filter-field{display:flex;flex-direction:column;gap:4px;font-size:0.85rem;}",
  ".filter-field label{color:#555;}",
  ".filter-field input,.filter-field select{padding:6px 8px;border:1px solid #999;border-radius:4px;font-size:0.9rem;font-family:inherit;}",
  ".filter-actions{display:flex;gap:12px;align-items:center;}",
  ".filter-actions button{background:#1e4d8c;color:#fff;border:none;border-radius:6px;padding:8px 16px;font-size:0.9rem;cursor:pointer;}",
  ".filter-actions a{color:#555;font-size:0.85rem;}",
  ".card{background:#fff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,0.1);padding:16px 20px;margin-bottom:20px;max-width:1100px;}",
  ".card h2{margin:0 0 12px;font-size:1.2rem;}",
  ".count{color:#777;font-weight:400;font-size:0.9rem;}",
  ".table-wrap{overflow-x:auto;}",
  "table{border-collapse:collapse;width:100%;font-size:0.95rem;}",
  "th,td{text-align:left;padding:8px 12px;border-bottom:1px solid #eee;white-space:nowrap;}",
  "td.notes{white-space:normal;min-width:180px;}",
  "th{background:#f7f7f7;font-weight:700;}",
  "td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;}"
].join("");
