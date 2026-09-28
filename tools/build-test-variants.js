#!/usr/bin/env node
/**
 * Merges question-bank/{wk,ar,pc,mk}_bank.json into
 * est-kiosk-standalone.html's window.__EST_STANDALONE__.testVariants.
 *
 * Test 1 (index 0) is always kept as whatever's currently embedded in
 * the HTML (the hand-curated original set) -- this script only APPENDS
 * new variants built from the bank files, using each bank's "tests"
 * array in order. It does not touch test 1's content.
 *
 * Each bank's questions carry their own "n" numbering already (see the
 * schema each generation agent was given); this script trusts that and
 * doesn't renumber.
 *
 * Usage: node tools/build-test-variants.js [count]
 *   count: how many additional variants to add from the banks (default 4,
 *          i.e. tests 2-5). Banks may contain more than this many test
 *          arrays (spares); only the first `count` are used from each.
 *
 * After running: re-check est-kiosk-standalone.html's script syntax,
 * bump sw.js's CACHE_NAME (this changes a precached file), and review
 * a sample of the new content before committing.
 */

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
var HTML_PATH = path.join(ROOT, "est-kiosk-standalone.html");
var BANK_DIR = path.join(ROOT, "question-bank");

var COUNT = parseInt(process.argv[2], 10) || 4;

// Each section's fixed metadata (title/minutes/instructions/code) is
// identical across all variants by design -- only the questions differ.
// Pulled from test 1 so it never has to be retyped/duplicated here.
var SECTION_ORDER = ["WK", "AR", "PC", "MK"];
var BANK_FILES = { WK: "wk_bank.json", AR: "ar_bank.json", PC: "pc_bank.json", MK: "mk_bank.json" };

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  var html = fs.readFileSync(HTML_PATH, "utf8");
  var m = html.match(/window\.__EST_STANDALONE__ = (\{[\s\S]*?\n\};)/);
  if (!m) throw new Error("Could not find window.__EST_STANDALONE__ blob in " + HTML_PATH);

  var data;
  eval("data = " + m[1].replace(/;\s*$/, ""));

  var test1 = data.testVariants[0];
  var metaByCode = {};
  test1.sections.forEach(function (s) { metaByCode[s.code] = s; });
  SECTION_ORDER.forEach(function (code) {
    if (!metaByCode[code]) throw new Error("Test 1 is missing a section with code " + code);
  });

  var banks = {};
  SECTION_ORDER.forEach(function (code) {
    var p = path.join(BANK_DIR, BANK_FILES[code]);
    var bank = readJson(p);
    if (!Array.isArray(bank.tests) || bank.tests.length < COUNT) {
      throw new Error(BANK_FILES[code] + " has only " + (bank.tests || []).length + " test arrays, need " + COUNT);
    }
    banks[code] = bank.tests;
  });

  var newVariants = [test1];
  for (var i = 0; i < COUNT; i++) {
    var sections = SECTION_ORDER.map(function (code) {
      var meta = metaByCode[code];
      var questions = banks[code][i];
      if (!Array.isArray(questions) || !questions.length) {
        throw new Error("Bank " + code + " test index " + i + " is empty");
      }
      return {
        code: meta.code,
        title: meta.title,
        minutes: meta.minutes,
        instructions: meta.instructions,
        questions: questions
      };
    });
    newVariants.push({ sections: sections });
  }

  data.testVariants = newVariants;

  var newBlob = "window.__EST_STANDALONE__ = {\n" +
    "  testVariants: " + JSON.stringify(data.testVariants) + ",\n" +
    "  scoring: " + JSON.stringify(data.scoring) + "\n" +
    "};";

  var newHtml = html.slice(0, m.index) + newBlob + html.slice(m.index + m[0].length);
  fs.writeFileSync(HTML_PATH, newHtml, "utf8");

  console.log("Wrote " + newVariants.length + " test variants (1 original + " + COUNT + " generated) to " + HTML_PATH);
  newVariants.forEach(function (v, idx) {
    var counts = v.sections.map(function (s) { return s.code + ":" + s.questions.length; }).join(" ");
    console.log("  Test " + (idx + 1) + " -- " + counts);
  });
}

main();
