import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const P = require("../periods.js");
const EN = "\u2013";

function blank(clients = 0, revenue = 0) {
  return { clients, products: clients, revenue, unpriced: 0, mix: { MAPD: 0, "Med Supp": 0, ACA: 0, Other: 0 } };
}
function withTeam(periods, asOf, extra = {}) {
  const team = { today: blank(0, 0) };
  for (const p of periods) team[p.key] = blank(1, 100);
  return { asOf, history: { since: "2026-10-01" }, periods, team, ...extra };
}

test("November 8 catalog matches the page periods", () => {
  const spec = P.buildCatalogSpec("2026-11-08", { closedMonths: ["2026-01", "2026-09", "2026-10"] });
  const keys = spec.map((p) => p.key);
  assert.deepEqual(keys, ["m2026-10", "w2026-11-01", "w2026-11-02", "month", "aep"]);
  assert.equal(spec[0].label, "October");
  assert.equal(spec[0].short, "Oct");
  assert.equal(spec[1].short, "Nov 1");
  assert.equal(spec[1].final, true);
  assert.equal(spec[2].label, `Week of Nov 2${EN}8`);
  assert.equal(spec[2].final, false);
  assert.equal(spec[3].label, "November so far");
  assert.equal(spec[3].short, "Nov total");
  assert.equal(spec[4].label, `AEP 2026 (Oct 15${EN}Dec 7)`);
  assert.equal(spec[4].short, "AEP 2026");
  assert.equal(spec[4].final, false);
  assert.ok(!keys.some((k) => /^m2026-0[1-9]$/.test(k)));
});

test("published snapshot keeps October and does not add Jan-Sep", () => {
  const raw = JSON.parse(readFileSync(new URL("./legacy-public.json", import.meta.url)));
  const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
  assert.equal(data.team.lastMonth.clients, 137);
  assert.equal(data.team.lastMonth.revenue, 64236);
  assert.equal(data.team.lastMonth.products, 146);
  assert.equal(data.team.lastMonth.unpriced, 9);
  assert.deepEqual(data.team["m2026-10"], data.team.lastMonth);
  assert.deepEqual(data.team.month, raw.team.month);
  assert.deepEqual(data.team.week, raw.team.week);
  assert.deepEqual(data.team.aep, raw.team.aep);
  assert.deepEqual(data.team.today, raw.team.today);
  assert.deepEqual(data.feed, raw.feed);
  assert.deepEqual(data.ghl.pipeline, raw.ghl.pipeline);
  assert.equal(data.byRep.Bill.lastMonth.revenue, 29259);
  assert.equal(data.byRep.Jen.lastMonth.clients, 42);
  assert.equal(data.byRep.Ashley.lastMonth.revenue, 14541);
  for (const key of ["today", "week", "month", "lastMonth", "aep", "m2026-10", "w2026-11-02"]) {
    let clients = 0, revenue = 0, products = 0;
    for (const rep of data.reps) {
      clients += data.byRep[rep][key].clients;
      revenue += data.byRep[rep][key].revenue;
      products += data.byRep[rep][key].products;
    }
    assert.equal(clients, data.team[key].clients, key);
    assert.equal(revenue, data.team[key].revenue, key);
    assert.equal(products, data.team[key].products, key);
  }
  assert.equal(data.team["w2026-11-01"].clients, 0);
  assert.equal(data.team["w2026-11-01"].revenue, 0);
  assert.equal(data.team["w2026-11-02"].revenue, data.team.week.revenue);
  for (let m = 1; m <= 9; m++) assert.equal(data.team["m2026-" + String(m).padStart(2, "0")], undefined);
  const menu = P.menu(data, 2026);
  assert.deepEqual(menu.map((p) => p.short), ["Oct", "Nov 1", `Nov 2${EN}8 (this wk)`, "Nov total", "AEP 2026", "Today"]);
  assert.deepEqual(menu.map((p) => p.label), [
    "October (final)", "Week of Nov 1", `Week of Nov 2${EN}8`, "November so far",
    `AEP 2026 (Oct 15${EN}Dec 7) to date`, "Today",
  ]);
  assert.deepEqual(P.years(data), [2026]);
  assert.equal(P.defaultPeriod(menu), "w2026-11-02");
  assert.ok(!JSON.stringify(data).includes("m2026-01"));
});

test("legacy payload still has a month, an in-month week, AEP, and Today", () => {
  const data = JSON.parse(readFileSync(new URL("./legacy-public.json", import.meta.url)));
  const menu = P.menu(data, 2026);
  assert.deepEqual(menu.map((p) => p.key), ["lastMonth", "week", "month", "aep", "today"]);
  assert.equal(menu[0].short, "Oct");
  assert.equal(menu[0].label, "October (final)");
  assert.equal(menu[1].short, `Nov 2${EN}8 (this wk)`);
  assert.equal(menu[3].short, "AEP 2026");
  assert.ok(menu.every((p) => !/2026$/.test(p.short) || p.group === "aep"));
  assert.ok(!menu.some((p) => /Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep/.test(p.short)));
});

test("AEP boundaries and December / January rollover", () => {
  const oct14 = P.buildCatalogSpec("2026-10-14", { closedMonths: ["2026-09", "2026-10"] });
  assert.ok(!oct14.some((p) => p.group === "aep" || p.key === "m2026-09" || p.key === "m2026-10"));
  assert.ok(oct14.every((p) => !p.start || p.start >= "2026-10-01"));
  assert.ok(oct14.filter((p) => p.group === "week").every((p) => p.start <= "2026-10-14"));

  const oct15 = P.buildCatalogSpec("2026-10-15", { closedMonths: [] });
  const aepStart = oct15.find((p) => p.key === "aep");
  assert.equal(aepStart.final, false);
  assert.equal(aepStart.start, "2026-10-15");

  const dec7 = P.menu(withTeam(P.buildCatalogSpec("2026-12-07", { closedMonths: ["2026-10", "2026-11"] }), "2026-12-07 18:00"), 2026);
  assert.equal(dec7.find((p) => p.key === "aep").final, false);
  assert.match(dec7.find((p) => p.key === "aep").label, /to date$/);
  assert.ok(dec7.some((p) => p.short.startsWith("Dec 7")));
  assert.ok(!dec7.some((p) => p.start > "2026-12-07"));

  const dec8 = P.menu(withTeam(P.buildCatalogSpec("2026-12-08", { closedMonths: ["2026-10", "2026-11"] }), "2026-12-08 09:00"), 2026);
  const aepDone = dec8.find((p) => p.key === "aep");
  assert.equal(aepDone.final, true);
  assert.equal(aepDone.label, `AEP 2026 (Oct 15${EN}Dec 7)`);
  assert.ok(!/to date/.test(aepDone.label));

  const dec31spec = P.buildCatalogSpec("2026-12-31", { closedMonths: ["2026-10", "2026-11", "2026-12"] });
  assert.deepEqual(dec31spec.filter((p) => p.group === "week").map((p) => p.short), [
    `Dec 1${EN}6`, `Dec 7${EN}13`, `Dec 14${EN}20`, `Dec 21${EN}27`, `Dec 28${EN}31`,
  ]);
  assert.ok(!dec31spec.some((p) => p.key === "m2026-12"));
  const dec31 = P.menu(withTeam(dec31spec, "2026-12-31 23:00"), 2026);
  assert.deepEqual(dec31.filter((p) => p.group === "month").map((p) => p.short), ["Oct", "Nov"]);
  assert.ok(dec31.some((p) => p.short === "Dec total"));
  assert.ok(!dec31.some((p) => /Jan/.test(p.short)));

  const janSpec = P.buildCatalogSpec("2027-01-04", { closedMonths: ["2026-01", "2026-10", "2026-11", "2026-12", "2027-01"] });
  assert.deepEqual(janSpec.filter((p) => p.group === "week").map((p) => [p.short, p.final]), [
    [`Jan 1${EN}3`, true], [`Jan 4${EN}10`, false],
  ]);
  assert.deepEqual(janSpec.filter((p) => p.group === "month").map((p) => p.key), ["m2026-10", "m2026-11", "m2026-12"]);
  const janData = withTeam(janSpec, "2027-01-04 08:00");
  const y2027 = P.menu(janData, 2027);
  const y2026 = P.menu(janData, 2026);
  assert.deepEqual(y2027.map((p) => p.short), [`Jan 1${EN}3`, `Jan 4${EN}10 (this wk)`, "Jan total", "Today"]);
  assert.deepEqual(y2026.map((p) => p.short), ["Oct", "Nov", "Dec", "AEP 2026"]);
  assert.equal(y2026.find((p) => p.key === "aep").label, `AEP 2026 (Oct 15${EN}Dec 7)`);
  assert.ok(!y2027.some((p) => p.group === "aep" || p.group === "month"));
  assert.ok(!y2026.some((p) => p.group === "week" || p.key === "today"));
  assert.deepEqual(P.years(janData), [2026, 2027]);
});

test("missing history is omitted instead of shown as zero", () => {
  const data = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
  data.periods.unshift({ key: "m2026-03", group: "month", label: "March", short: "Mar", start: "2026-03-01", end: "2026-03-31", final: true, year: 2026 });
  data.team["m2026-03"] = blank(0, 0);
  for (const rep of data.reps) data.byRep[rep]["m2026-03"] = blank(0, 0);
  const menu = P.menu(data, 2026);
  assert.ok(!menu.some((p) => p.key === "m2026-03" || p.short === "Mar"));
  assert.equal(menu.find((p) => p.key === "m2026-10").label, "October (final)");
  delete data.team["m2026-11"];
  data.periods.push({ key: "m2026-11", group: "month", label: "November", short: "Nov", start: "2026-11-01", end: "2026-11-30", final: true, year: 2026 });
  assert.ok(!P.menu(data, 2026).some((p) => p.key === "m2026-11"));
});

test("a week that crosses the month boundary is not labelled as a clipped slice on legacy data", () => {
  const data = JSON.parse(readFileSync(new URL("./legacy-public.json", import.meta.url)));
  data.asOf = "2027-01-04 08:00";
  data.weekStart = "2026-12-28";
  data.updated = "Mon Jan 4, 2027";
  const menu = P.menu(data, 2027);
  assert.deepEqual(menu.map((p) => p.key), ["month", "today"]);
  assert.equal(menu[0].label, "January so far");
  const prior = P.menu(data, 2026);
  assert.deepEqual(prior.map((p) => p.key), ["lastMonth", "aep"]);
  assert.equal(prior[0].label, "December (final)");
  assert.equal(prior[1].short, "AEP 2026");
});
