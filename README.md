# Sales board

Static TV leaderboard. `data.json` is the public payload. `index.html` renders it.

Period tabs follow `data.periods` when that list is present: closed months in the selected year (month name only), the current month as Monday–Sunday ranges clipped to the month (started weeks only) plus a month total, AEP labelled by season year (Oct 15–Dec 7), and Today. Payloads that only have `today`, `week`, `month`, `lastMonth`, and `aep` still render. Months before `history.since` (October 2026) are not shown and are not filled with zeros.

The box exporter that publishes this file is `exporter/gen_site.py`. It whitelists aggregates and the sanitized feed. It does not read Google Sheets. Copy that script onto the box in place of the previous `gen_site.py`; this repo does not deploy it.

Year-over-year history will come from Google Sheets later. Until `archive.status` is `connected`, the board only shows periods that are already in `data.json`.
