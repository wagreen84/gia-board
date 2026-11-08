import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const puppeteer = (() => {
  try { return require("puppeteer-core"); }
  catch { return require("/tmp/gia-ui/node_modules/puppeteer-core"); }
})();
const P = require("../periods.js");
const ROOT = new URL("..", import.meta.url).pathname;
const live = JSON.parse(readFileSync(new URL("../data.json", import.meta.url)));
const legacy = JSON.parse(readFileSync(new URL("./legacy-public.json", import.meta.url)));
const EN = "\u2013";
const shots = "/opt/cursor/artifacts";

function blank(clients, revenue) {
  return { clients, products: clients, revenue, unpriced: 0, mix: { MAPD: 0, "Med Supp": 0, ACA: 0, Other: 0 } };
}
function fill(data, periods) {
  const copy = structuredClone(data);
  copy.periods = periods;
  for (const p of periods) {
    if (!copy.team[p.key]) {
      const agg = blank(p.group === "month" ? 11 : 4, p.group === "month" ? 1100 : 400);
      copy.team[p.key] = agg;
      for (const rep of copy.reps) copy.byRep[rep][p.key] = structuredClone(agg);
      copy.carriers[p.key] = [];
      copy.crossSell.team[p.key] = { clients: agg.clients, multi: 0, pct: 0 };
      for (const rep of copy.reps) copy.crossSell.byRep[rep][p.key] = { clients: 1, multi: 0, pct: 0 };
    }
  }
  return copy;
}

function server() {
  const child = spawn("python3", ["-m", "http.server", "8765", "--bind", "127.0.0.1"], { cwd: ROOT, stdio: "ignore" });
  return child;
}

async function open() {
  const browser = await puppeteer.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  let payload = null;
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    if (payload && req.url().includes("data.json")) {
      req.respond({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    } else req.continue();
  });
  async function show(data) {
    payload = data;
    await page.goto("http://127.0.0.1:8765/index.html", { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.dataset.period);
  }
  return { browser, page, show };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch("http://127.0.0.1:8765/index.html");
      if (r.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("board server did not start");
}

test("desktop and mobile period switching", async () => {
  const child = server();
  await waitForServer();
  const { browser, page, show } = await open();
  try {
    await page.setViewport({ width: 1440, height: 900 });
    await show(live);
    const tabs = async () => page.$$eval("#tabs button", (els) => els.map((e) => e.textContent));
    assert.deepEqual(await tabs(), ["Oct", "Nov 1", `Nov 2${EN}8 (this wk)`, "Nov total", "AEP 2026", "Today"]);
    assert.equal(await page.$eval("#year", (el) => el.value), "2026");
    assert.equal(await page.$eval("body", (el) => el.dataset.period), "w2026-11-02");
    assert.match(await page.$eval("#pipeh", (el) => el.textContent), /not refreshed/);
    assert.doesNotMatch(await page.$eval("#pipeh", (el) => el.textContent), /this week/);
    assert.match(await page.$eval("#foot", (el) => el.textContent), /2026-10-01/);
    assert.match(await page.$eval("#foot", (el) => el.textContent), /Google Sheets/);

    await page.click('#tabs button[data-p="m2026-10"]');
    await page.waitForFunction(() => document.body.dataset.period === "m2026-10");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$64,236");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "137");
    assert.match(await page.$eval("#lbh", (el) => el.textContent), /October \(final\)/);
    assert.deepEqual(await page.$$eval(".name", (els) => els.map((e) => e.textContent)), ["Bill", "Jen", "Ashley"]);
    const html = await page.content();
    for (const secret of ["Pledger", "Stensrud", "Karanja", "xox", "U0"]) assert.equal(html.includes(secret), false);
    await page.screenshot({ path: shots + "/tv-desktop-october.png", fullPage: true });

    await page.click('#tabs button[data-p="aep"]');
    await page.waitForFunction(() => document.body.dataset.period === "aep");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "143");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$63,141");
    assert.match(await page.$eval("#lbh", (el) => el.textContent), /AEP 2026/);

    await page.click('#tabs button[data-p="w2026-11-01"]');
    await page.waitForFunction(() => document.body.dataset.period === "w2026-11-01");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "0");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$0");

    await page.click('#tabs button[data-p="today"]');
    await page.waitForFunction(() => document.body.dataset.period === "today");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "0");

    await page.click('#tabs button[data-p="month"]');
    await page.waitForFunction(() => document.body.dataset.period === "month");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "38");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$16,569");

    await page.setViewport({ width: 390, height: 844 });
    await page.click('#tabs button[data-p="w2026-11-02"]');
    await page.waitForFunction(() => document.body.dataset.period === "w2026-11-02");
    const box = await page.$eval("#tabs", (el) => {
      const r = el.getBoundingClientRect();
      return { width: r.width, top: r.top, buttons: el.querySelectorAll("button").length };
    });
    assert.equal(box.buttons, 6);
    assert.ok(box.width <= 390);
    assert.ok(box.top >= 0);
    await page.screenshot({ path: shots + "/tv-mobile-periods.png", fullPage: false });

    const early = structuredClone(live);
    early.periods = [{ key: "m2026-01", group: "month", label: "January", short: "Jan", start: "2026-01-01", end: "2026-01-31", final: true, year: 2026 }, ...early.periods];
    early.team["m2026-01"] = blank(0, 0);
    for (const rep of early.reps) early.byRep[rep]["m2026-01"] = blank(0, 0);
    await show(early);
    assert.ok(!(await tabs()).includes("Jan"));
    await page.click('#tabs button[data-p="m2026-10"]');
    await page.waitForFunction(() => document.body.dataset.period === "m2026-10");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$64,236");

    await show(legacy);
    assert.deepEqual(await tabs(), ["Oct", `Nov 2${EN}8 (this wk)`, "Nov total", "AEP 2026", "Today"]);
    await page.click('#tabs button[data-p="lastMonth"]');
    await page.waitForFunction(() => document.body.dataset.period === "lastMonth");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "137");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$64,236");
    assert.match(await page.$eval("#pipeh", (el) => el.textContent), /not refreshed/);

    const janSpec = P.buildCatalogSpec("2027-01-04", { closedMonths: ["2026-10", "2026-11", "2026-12"] });
    const jan = fill(live, janSpec);
    jan.asOf = "2027-01-04 08:00";
    jan.team.month = blank(7, 2100);
    for (const rep of jan.reps) jan.byRep[rep].month = blank(rep === "Bill" ? 3 : 2, 700);
    await page.setViewport({ width: 1440, height: 900 });
    await show(jan);
    assert.deepEqual(await page.$$eval("#year option", (els) => els.map((e) => e.value)), ["2026", "2027"]);
    assert.deepEqual(await tabs(), [`Jan 1${EN}3`, `Jan 4${EN}10 (this wk)`, "Jan total", "Today"]);
    await page.select("#year", "2026");
    await page.waitForFunction(() => document.body.dataset.year === "2026");
    assert.deepEqual(await tabs(), ["Oct", "Nov", "Dec", "AEP 2026"]);
    await page.click('#tabs button[data-p="m2026-10"]');
    await page.waitForFunction(() => document.body.dataset.period === "m2026-10");
    assert.equal(await page.$eval('[data-k="revenue"] .v', (el) => el.textContent), "$64,236");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "137");
    await page.select("#year", "2027");
    await page.waitForFunction(() => document.body.dataset.year === "2027");
    assert.ok(!(await tabs()).some((t) => t.startsWith("AEP") || t === "Oct"));
    await page.click('#tabs button[data-p="month"]');
    await page.waitForFunction(() => document.body.dataset.period === "month");
    assert.equal(await page.$eval('[data-k="clients"] .v', (el) => el.textContent), "7");
    assert.match(await page.$eval("#lbh", (el) => el.textContent), /January so far/);
  } finally {
    await browser.close();
    child.kill();
  }
});
