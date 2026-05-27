:root {
  --paper: #f4efe5;
  --surface: #fcfaf5;
  --ink: #1b1714;
  --muted: #837a6d;
  --faint: #a89f90;
  --line: #e4dccd;
  --line-strong: #d3c9b6;
  --accent: #e8431b;
  --accent-soft: #fbe5dc;
  --good: #2e7d52;
  --good-soft: #e3f0e8;
  --over: #c0492b;
  --over-soft: #f7e2dc;
  --under: #b07410;
  --under-soft: #f6ecd6;
  --display: 'Bricolage Grotesque', Georgia, serif;
  --body: 'IBM Plex Sans', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, monospace;
}

* { box-sizing: border-box; }
html, body { margin: 0; }
body {
  background: var(--paper);
  color: var(--ink);
  font-family: var(--body);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}
.num { font-family: var(--mono); font-feature-settings: 'tnum' 1; }

.wrap { max-width: 1080px; margin: 0 auto; padding: 0 20px 80px; }

/* Header */
.masthead { border-bottom: 3px solid var(--ink); padding: 34px 0 18px; margin-bottom: 26px; }
.eyebrow {
  font-family: var(--mono); font-size: 12px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--accent); margin: 0 0 6px;
}
.masthead h1 {
  font-family: var(--display); font-weight: 800; font-size: clamp(34px, 6vw, 60px);
  line-height: 0.98; letter-spacing: -0.02em; margin: 0; text-transform: uppercase;
}
.meta-strip {
  display: flex; flex-wrap: wrap; gap: 26px; margin-top: 16px;
  font-size: 13px; color: var(--muted);
}
.meta-strip b { display: block; font-family: var(--mono); font-size: 16px; color: var(--ink); font-weight: 500; }
.weekflag {
  margin-left: auto; align-self: flex-end; text-align: right;
}
.weekflag .big { font-family: var(--display); font-weight: 700; font-size: 22px; }

/* Banners */
.banner {
  border: 1px solid var(--line-strong); background: var(--surface);
  border-left: 4px solid var(--accent); border-radius: 0 10px 10px 0;
  padding: 14px 18px; margin-bottom: 24px; font-size: 14px;
}
.banner code { font-family: var(--mono); background: var(--accent-soft); padding: 1px 6px; border-radius: 4px; }
.banner a { color: var(--accent); font-weight: 600; }

/* KPI cards */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 26px; }
.kpi { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
.kpi .label { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin: 0 0 8px; }
.kpi .val { font-family: var(--display); font-weight: 700; font-size: 30px; line-height: 1; }
.kpi .val small { font-family: var(--mono); font-weight: 400; font-size: 14px; color: var(--faint); }
.kpi .sub { font-size: 12.5px; color: var(--muted); margin-top: 6px; }

/* Section headings */
.sec-h {
  font-family: var(--display); font-weight: 700; font-size: 17px; text-transform: uppercase;
  letter-spacing: 0.02em; margin: 0 0 12px; display: flex; align-items: center; gap: 10px;
}
.sec-h::after { content: ''; flex: 1; height: 1px; background: var(--line); }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 18px 20px; }
.grid-2 { display: grid; grid-template-columns: 1.55fr 1fr; gap: 18px; margin-bottom: 26px; }
.block { margin-bottom: 26px; }

/* Week nav */
.weeknav { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
.weeknav button {
  font-family: var(--mono); font-size: 13px; border: 1px solid var(--line-strong); background: var(--surface);
  color: var(--ink); border-radius: 8px; padding: 6px 12px; cursor: pointer;
}
.weeknav button:hover { background: var(--paper); }
.weeknav button:disabled { opacity: 0.35; cursor: default; }
.weeknav .wk-title { font-family: var(--display); font-weight: 700; font-size: 18px; }
.weeknav .wk-sub { font-size: 12.5px; color: var(--muted); }
.tag { font-family: var(--mono); font-size: 11px; padding: 2px 7px; border-radius: 5px; background: var(--accent-soft); color: var(--accent); text-transform: uppercase; letter-spacing: 0.05em; }

/* Session rows */
.rows { display: flex; flex-direction: column; gap: 8px; }
.row {
  display: grid; grid-template-columns: 64px 1fr 150px 132px 92px; align-items: center; gap: 12px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 10px; padding: 11px 14px;
}
.row.support { opacity: 0.72; }
.row .day { font-family: var(--mono); font-size: 13px; color: var(--muted); }
.row .day b { display: block; font-size: 15px; color: var(--ink); }
.row .what { font-weight: 500; }
.row .what .ty { font-family: var(--mono); font-size: 11.5px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.04em; }
.row .col { font-size: 13px; }
.row .col .k { font-size: 11px; color: var(--faint); text-transform: uppercase; letter-spacing: 0.04em; }
.row .col .v { font-family: var(--mono); }
.pill { justify-self: end; font-family: var(--mono); font-size: 11.5px; font-weight: 500; padding: 4px 9px; border-radius: 20px; white-space: nowrap; }
.pill.done { background: var(--good-soft); color: var(--good); }
.pill.upcoming { background: var(--paper); color: var(--muted); border: 1px solid var(--line-strong); }
.pill.missed { background: var(--over-soft); color: var(--over); }
.pill.support { background: var(--paper); color: var(--faint); border: 1px solid var(--line); }
.hrdot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: 0; }
.hr-in { color: var(--good); } .hr-in .hrdot { background: var(--good); }
.hr-over { color: var(--over); } .hr-over .hrdot { background: var(--over); }
.hr-under { color: var(--under); } .hr-under .hrdot { background: var(--under); }

/* Table */
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th { text-align: left; font-family: var(--mono); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); font-weight: 500; padding: 8px 10px; border-bottom: 1px solid var(--line-strong); }
td { padding: 9px 10px; border-bottom: 1px solid var(--line); }
td.num, th.num { font-family: var(--mono); }

.legend { display: flex; flex-direction: column; gap: 10px; margin-top: 6px; }
.legend .li { display: flex; align-items: center; gap: 9px; font-size: 13.5px; }
.legend .sw { width: 12px; height: 12px; border-radius: 3px; }
.legend .n { margin-left: auto; font-family: var(--mono); }

.foot { margin-top: 30px; font-size: 12px; color: var(--faint); text-align: center; }

@media (max-width: 780px) {
  .kpis { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
  .row { grid-template-columns: 52px 1fr 96px; }
  .row .col.pace, .row .pill.inline { display: none; }
  .weekflag { display: none; }
}

/* Injury-risk gauge + big-stat panels */
.bigstat { display: flex; align-items: baseline; gap: 10px; }
.bigstat .v { font-family: var(--display); font-weight: 800; font-size: 40px; line-height: 1; }
.bigstat .u { font-family: var(--mono); font-size: 14px; color: var(--muted); }
.statline { display: flex; gap: 22px; margin-top: 14px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
.statline b { display: block; font-family: var(--mono); font-size: 15px; color: var(--ink); font-weight: 500; }
.verdict-line { font-size: 13.5px; margin-top: 12px; font-weight: 500; }
.gauge { position: relative; height: 12px; border-radius: 6px; background: var(--line); margin: 16px 0 6px; }
.gauge .sweet { position: absolute; top: 0; bottom: 0; background: var(--good-soft); border-left: 2px solid var(--good); border-right: 2px solid var(--good); }
.gauge .marker { position: absolute; top: -6px; width: 3px; height: 24px; background: var(--ink); border-radius: 2px; transform: translateX(-50%); }
.gauge-scale { display: flex; justify-content: space-between; font-family: var(--mono); font-size: 10px; color: var(--faint); }
.s-ok { color: var(--good); } .s-caution { color: var(--under); } .s-high { color: var(--over); } .s-detrain { color: var(--muted); } .s-baseline { color: var(--muted); }
