/* Period menu for the TV board.
   The public payload lists periods. This file only chooses which of those
   periods to show. It does not invent months or zero-fill missing history.
   Sales history starts 2026-10-01 unless the payload says otherwise.
   buildCatalogSpec() is the shape build_data.py already emits; the board
   displays data.periods and does not replace missing aggregates with it. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.GIAPeriods = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var HISTORY_FLOOR = "2026-10-01";
  var RANK = { month: 0, week: 1, monthToDate: 2, aep: 3, today: 4 };
  var EN = "\u2013";

  function pad(n) { return String(n).padStart(2, "0"); }
  function isDate(s) { return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10)) && s.slice(0, 10) === dateOnly(s); }
  function dateOnly(s) { return String(s || "").slice(0, 10); }
  function parts(iso) {
    var p = dateOnly(iso).split("-").map(function (x) { return parseInt(x, 10); });
    return { y: p[0], m: p[1], d: p[2] };
  }
  function ymd(dt) {
    return dt.getFullYear() + "-" + pad(dt.getMonth() + 1) + "-" + pad(dt.getDate());
  }
  function fromParts(y, m, d) { return new Date(y, m - 1, d); }
  function lastDay(y, m) { return new Date(y, m, 0).getDate(); }
  function historySince(data) {
    var s = data && data.history && data.history.since;
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : HISTORY_FLOOR;
  }
  function asOfDate(data) {
    var s = dateOnly(data && data.asOf);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  function hasAgg(team, key) {
    var a = team && team[key];
    return !!(a && typeof a.clients === "number" && typeof a.revenue === "number" && a.mix);
  }
  function mentionsMonth(text, month) {
    if (!text) return false;
    return String(text).indexOf(MONTHS[month - 1]) >= 0 || String(text).indexOf(SHORT[month - 1]) >= 0;
  }
  function rangeShort(start, end) {
    var a = parts(start), b = parts(end);
    if (start === end) return SHORT[a.m - 1] + " " + a.d;
    if (a.y === b.y && a.m === b.m) return SHORT[a.m - 1] + " " + a.d + EN + b.d;
    return SHORT[a.m - 1] + " " + a.d + EN + SHORT[b.m - 1] + " " + b.d;
  }
  function impliedStart(p) {
    var m = /^m(\d{4})-(\d{2})$/.exec(p.key || "");
    if (m) return m[1] + "-" + m[2] + "-01";
    var w = /^w(\d{4}-\d{2}-\d{2})$/.exec(p.key || "");
    if (w) return w[1];
    return p.start || null;
  }
  function periodYear(p, data) {
    if (typeof p.year === "number" && p.year > 1900) return p.year;
    if (p.group === "aep") {
      var hit = /AEP\s+(\d{4})/.exec((p.label || "") + " " + (p.short || ""));
      if (hit) return +hit[1];
    }
    var start = impliedStart(p) || p.start;
    if (start && /^\d{4}/.test(start)) return +start.slice(0, 4);
    var asOf = asOfDate(data);
    return asOf ? +asOf.slice(0, 4) : null;
  }
  function beforeHistory(p, since) {
    if (!p || p.group === "today" || p.key === "today") return false;
    var start = impliedStart(p) || p.start;
    if (p.group === "aep") return !!(p.end && p.end < since);
    if (start && start < since) return true;
    return false;
  }
  function monthWeeks(year, month, asOf) {
    var first = fromParts(year, month, 1);
    var lastN = lastDay(year, month);
    var last = fromParts(year, month, lastN);
    var cursor = new Date(first.getTime());
    var dow = cursor.getDay();
    var back = dow === 0 ? 6 : dow - 1;
    cursor.setDate(cursor.getDate() - back);
    var out = [];
    while (cursor <= last) {
      var monday = new Date(cursor.getTime());
      var sunday = new Date(cursor.getTime());
      sunday.setDate(monday.getDate() + 6);
      var clipStart = monday < first ? first : monday;
      var clipEnd = sunday > last ? last : sunday;
      var start = ymd(clipStart);
      var end = ymd(clipEnd);
      if (asOf && start > asOf) break;
      out.push({
        key: "w" + start,
        group: "week",
        label: "Week of " + rangeShort(start, end),
        short: rangeShort(start, end),
        start: start,
        end: end,
        final: !!(asOf && end < asOf),
        year: +start.slice(0, 4)
      });
      cursor.setDate(cursor.getDate() + 7);
    }
    return out;
  }
  function aepSeason(asOf, since) {
    if (!asOf) return null;
    var y = +asOf.slice(0, 4);
    function season(year, final) {
      var end = year + "-12-07";
      if (end < since) return null;
      return {
        key: "aep", group: "aep",
        label: "AEP " + year + " (Oct 15" + EN + "Dec 7)",
        short: "AEP " + year,
        start: year + "-10-15", end: end, final: final, year: year
      };
    }
    if (asOf >= y + "-10-15" && asOf <= y + "-12-07") return season(y, false);
    if (asOf > y + "-12-07") return season(y, true);
    return season(y - 1, true);
  }
  function buildCatalogSpec(asOf, opts) {
    opts = opts || {};
    var day = dateOnly(asOf);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    var since = opts.since || HISTORY_FLOOR;
    var y = +day.slice(0, 4), m = +day.slice(5, 7);
    var current = day.slice(0, 7);
    var closed = (opts.closedMonths || []).filter(function (ym) {
      return /^\d{4}-\d{2}$/.test(ym) && (ym + "-01") >= since && ym < current;
    });
    closed.sort();
    var periods = closed.map(function (ym) {
      var yy = +ym.slice(0, 4), mm = +ym.slice(5, 7);
      return {
        key: "m" + ym, group: "month", label: MONTHS[mm - 1], short: SHORT[mm - 1],
        start: ym + "-01", end: ym + "-" + pad(lastDay(yy, mm)), final: true, year: yy
      };
    });
    periods = periods.concat(monthWeeks(y, m, day));
    periods.push({
      key: "month", group: "monthToDate",
      label: MONTHS[m - 1] + " so far", short: SHORT[m - 1] + " total",
      start: current + "-01", end: day, final: false, year: y
    });
    var aep = aepSeason(day, since);
    if (aep && aep.start <= day) periods.push(aep);
    return periods.filter(function (p) { return !beforeHistory(p, since); });
  }
  function legacyCatalog(data) {
    var asOf = asOfDate(data);
    if (!asOf || !data.team) return [];
    var since = historySince(data);
    var labels = data.periodLabels || {};
    var y = +asOf.slice(0, 4), m = +asOf.slice(5, 7);
    var out = [];
    if (hasAgg(data.team, "lastMonth")) {
      var py = m === 1 ? y - 1 : y;
      var pm = m === 1 ? 12 : m - 1;
      var start = py + "-" + pad(pm) + "-01";
      var provided = labels.lastMonth;
      var name = mentionsMonth(provided, pm) && !/\d{4}/.test(provided) ? provided : MONTHS[pm - 1];
      var shortName = mentionsMonth(labels.lastMonthShort, pm) && !/\d{4}/.test(labels.lastMonthShort || "") ? labels.lastMonthShort : SHORT[pm - 1];
      if (start >= since) {
        out.push({
          key: "lastMonth", group: "month", label: name, short: shortName,
          start: start, end: py + "-" + pad(pm) + "-" + pad(lastDay(py, pm)),
          final: true, year: py
        });
      }
    }
    if (hasAgg(data.team, "week") && /^\d{4}-\d{2}-\d{2}$/.test(data.weekStart || "")) {
      var ws = data.weekStart.slice(0, 10);
      var a = parts(ws);
      var startDt = fromParts(a.y, a.m, a.d);
      var dow = startDt.getDay();
      var add = dow === 0 ? 0 : 7 - dow;
      var endDt = new Date(startDt.getTime());
      endDt.setDate(startDt.getDate() + add);
      var end = ymd(endDt);
      var sameMonth = ws.slice(0, 7) === end.slice(0, 7);
      if (sameMonth && ws <= asOf && ws >= since) {
        var short = rangeShort(ws, end);
        out.push({
          key: "week", group: "week", label: "Week of " + short, short: short,
          start: ws, end: end, final: end < asOf, year: y
        });
      }
    }
    if (hasAgg(data.team, "month")) {
      var startM = asOf.slice(0, 7) + "-01";
      if (startM >= since) {
        var shortM = (mentionsMonth(labels.monthShort, m) && !/\d{4}/.test(labels.monthShort) ? labels.monthShort : SHORT[m - 1]) + " total";
        out.push({
          key: "month", group: "monthToDate",
          label: mentionsMonth(labels.month, m) && !/\d{4}/.test(labels.month) ? labels.month : (MONTHS[m - 1] + " so far"),
          short: shortM, start: startM, end: asOf, final: false, year: y
        });
      }
    }
    if (hasAgg(data.team, "aep")) {
      var aep = aepSeason(asOf, since);
      if (aep && aep.start <= asOf) out.push(aep);
    }
    return out;
  }
  function sourcePeriods(data) {
    if (data && Array.isArray(data.periods) && data.periods.length) return data.periods;
    return legacyCatalog(data || {});
  }
  function decorate(p, asOf) {
    var ended = !!(asOf && p.end && asOf > p.end);
    var final = !!(p.final || ended);
    var inProgress = p.group === "week" && !final && (!asOf || !p.start || p.start <= asOf);
    var short = p.short || p.label || p.key;
    var label = p.label || short;
    if (p.group === "month") label = (p.label || short).replace(/\s*\(final\)\s*$/, "") + (final ? " (final)" : "");
    if (p.group === "aep") {
      var base = (p.label || short || "AEP").replace(/\s+to date$/, "");
      label = final ? base : base + " to date";
      short = String(p.short || "AEP").replace(/\s+to date$/, "");
    }
    if (p.key === "today" || p.group === "today") { label = "Today"; short = "Today"; inProgress = false; }
    if (inProgress && !/\(this wk\)/.test(short)) short = short + " (this wk)";
    return {
      key: p.key, group: p.group || "month", label: label, short: short,
      start: p.start || null, end: p.end || null, final: final, inProgress: inProgress,
      year: typeof p.year === "number" ? p.year : null
    };
  }
  function menu(data, year) {
    data = data || {};
    var asOf = asOfDate(data);
    var since = historySince(data);
    var currentYear = asOf ? +asOf.slice(0, 4) : year;
    var out = [];
    sourcePeriods(data).forEach(function (p) {
      if (!p || !p.key || !hasAgg(data.team, p.key)) return;
      if (beforeHistory(p, since)) return;
      var y = periodYear(p, data);
      if (year != null && y !== year) return;
      if (p.group === "week") {
        if (year !== currentYear) return;
        if (asOf && p.start && p.start > asOf) return;
      } else if (p.group === "month") {
        if (asOf && p.start && p.start.slice(0, 7) === asOf.slice(0, 7) && year === currentYear) return;
      } else if (p.group === "monthToDate" || p.key === "today" || p.group === "today") {
        if (year !== currentYear) return;
      } else if (p.group === "aep") {
        if (asOf && p.start && p.start > asOf) return;
      }
      if (out.some(function (x) { return x.key === p.key; })) return;
      var copy = {};
      for (var k in p) copy[k] = p[k];
      copy.year = y;
      out.push(decorate(copy, asOf));
    });
    if (year === currentYear && hasAgg(data.team, "today") && !out.some(function (p) { return p.key === "today"; })) {
      out.push(decorate({ key: "today", group: "today", label: "Today", short: "Today", start: asOf, end: asOf, year: currentYear }, asOf));
    }
    out.sort(function (a, b) {
      var ra = RANK[a.group] == null ? 9 : RANK[a.group];
      var rb = RANK[b.group] == null ? 9 : RANK[b.group];
      if (ra !== rb) return ra - rb;
      return String(a.start || "").localeCompare(String(b.start || ""));
    });
    return out;
  }
  function years(data) {
    var found = {};
    sourcePeriods(data || {}).forEach(function (p) {
      var y = periodYear(p, data);
      if (y) found[y] = true;
    });
    var asOf = asOfDate(data);
    if (asOf) found[+asOf.slice(0, 4)] = true;
    return Object.keys(found).map(function (y) { return +y; }).filter(function (y) {
      return menu(data, y).length > 0;
    }).sort(function (a, b) { return a - b; });
  }
  function defaultYear(data) {
    var ys = years(data);
    var asOf = asOfDate(data);
    if (asOf && ys.indexOf(+asOf.slice(0, 4)) >= 0) return +asOf.slice(0, 4);
    return ys.length ? ys[ys.length - 1] : (asOf ? +asOf.slice(0, 4) : 2026);
  }
  function defaultPeriod(items) {
    items = items || [];
    var wk = items.filter(function (p) { return p.group === "week" && p.inProgress; })[0];
    if (wk) return wk.key;
    var mtd = items.filter(function (p) { return p.group === "monthToDate"; })[0];
    if (mtd) return mtd.key;
    var aep = items.filter(function (p) { return p.group === "aep"; })[0];
    if (aep) return aep.key;
    return items.length ? items[0].key : null;
  }

  return {
    HISTORY_FLOOR: HISTORY_FLOOR,
    monthWeeks: monthWeeks,
    aepSeason: aepSeason,
    buildCatalogSpec: buildCatalogSpec,
    legacyCatalog: legacyCatalog,
    menu: menu,
    years: years,
    defaultYear: defaultYear,
    defaultPeriod: defaultPeriod,
    rangeShort: rangeShort
  };
});
