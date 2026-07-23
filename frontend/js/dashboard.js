/**
 * The "Dashboard" landing page: a ticker bar, a currency picker, totals
 * (always current — not affected by the date range), a date range
 * control that drives both charts, and a flat ledger table at the bottom.
 */
import * as api from "./api.js";
import { el, formatMoney, formatSignedAmount, productLabel, LIABILITY_TYPES, localISODate } from "./utils.js";
import { renderNetWorthChart } from "./networth-chart.js";
import { renderCategoryChart } from "./category-chart.js";
import { renderTicker } from "./ticker.js";

let selectedCurrency = "USD";
let selectedRangePreset = "all";
let customStart = "";
let customEnd = "";
let selectedCategoryDirection = "outflow";

const RANGE_PRESETS = {
  all: { label: "All time" },
  "30d": { label: "Last 30 days", days: 30 },
  "3m": { label: "Last 3 months", days: 92 },
  "6m": { label: "Last 6 months", days: 183 },
  "12m": { label: "Last 12 months", days: 365 },
  custom: { label: "Custom range" },
};

function isoToday() {
  return localISODate();
}
function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return localISODate(d);
}

function getCurrentRange() {
  if (selectedRangePreset === "all") return { start: null, end: null };
  if (selectedRangePreset === "custom") return { start: customStart || null, end: customEnd || null };
  const preset = RANGE_PRESETS[selectedRangePreset];
  return { start: isoDaysAgo(preset.days), end: isoToday() };
}

function renderRangeBar(container, onChange) {
  container.innerHTML = "";
  container.className = "date-range-bar";

  const startInput = el("input", {
    type: "date",
    value: customStart,
    onchange: async (e) => {
      customStart = e.target.value;
      await onChange();
    },
  });
  const endInput = el("input", {
    type: "date",
    value: customEnd,
    onchange: async (e) => {
      customEnd = e.target.value;
      await onChange();
    },
  });
  const customWrap = el("div", { class: `date-range-custom ${selectedRangePreset === "custom" ? "" : "hidden"}` }, [
    startInput,
    document.createTextNode("to"),
    endInput,
  ]);

  const select = el(
    "select",
    {
      class: "currency-picker",
      onchange: async (e) => {
        selectedRangePreset = e.target.value;
        customWrap.classList.toggle("hidden", selectedRangePreset !== "custom");
        await onChange();
      },
    },
    Object.entries(RANGE_PRESETS).map(([key, def]) => {
      const opt = el("option", { value: key }, def.label);
      if (key === selectedRangePreset) opt.selected = true;
      return opt;
    })
  );

  container.appendChild(el("label", { class: "currency-picker-label" }, ["Chart range: ", select]));
  container.appendChild(customWrap);
}

export async function renderDashboard(container, navigate) {
  const tickerBar = el("div", { class: "ticker-bar hidden" });
  container.appendChild(tickerBar);
  renderTicker(tickerBar); // fire-and-forget — decorative, never blocks the rest of the page

  const data = await api.getDashboard(selectedCurrency);
  selectedCurrency = data.currency; // in case the previously-selected currency is no longer valid

  const currencySelect = el(
    "select",
    {
      class: "currency-picker",
      onchange: async (e) => {
        selectedCurrency = e.target.value;
        container.innerHTML = "";
        await renderDashboard(container, navigate);
      },
    },
    data.available_currencies.map((c) => {
      const opt = el("option", { value: c }, c);
      if (c === selectedCurrency) opt.selected = true;
      return opt;
    })
  );

  container.appendChild(
    el("div", { class: "page-header" }, [
      el("div", {}, [
        el("h2", { class: "page-title" }, "Dashboard"),
        el("div", { class: "page-subtitle" }, "Everything you own and owe, in one currency."),
      ]),
      el("label", { class: "currency-picker-label" }, ["Show in: ", currencySelect]),
    ])
  );

  if (data.missing_rates.length > 0) {
    container.appendChild(
      el(
        "div",
        { class: "missing-rates-note" },
        `Couldn't fetch a rate for: ${data.missing_rates.join(", ")} — those balances are excluded from the totals below. This needs an internet connection at least once.`
      )
    );
  }

  container.appendChild(
    el("div", { class: "net-worth-hero" }, [
      el("div", { class: "net-worth-cell assets" }, [
        el("div", { class: "label" }, "Total assets"),
        el("div", { class: "value" }, formatSignedAmount(data.total_assets, data.currency)),
      ]),
      el("div", { class: "net-worth-cell liabilities" }, [
        el("div", { class: "label" }, "Total liabilities"),
        el("div", { class: "value" }, formatSignedAmount(data.total_liabilities, data.currency)),
      ]),
      el("div", { class: "net-worth-cell net" }, [
        el("div", { class: "label" }, "Net worth"),
        el("div", { class: "value" }, formatSignedAmount(data.net_worth, data.currency)),
      ]),
    ])
  );

  const rangeBar = el("div");
  const chartsRow = el("div", { class: "charts-row" });
  container.appendChild(rangeBar);
  container.appendChild(chartsRow);

  async function refreshCharts() {
    chartsRow.innerHTML = "";
    const range = getCurrentRange();
    const [history, breakdown] = await Promise.all([
      api.getNetWorthHistory(selectedCurrency, range.start, range.end),
      api.getCategoryBreakdown(selectedCurrency, range.start, range.end, selectedCategoryDirection),
    ]);

    const lineCard = el("div", { class: "chart-card" }, el("div", { class: "chart-card-title" }, "Net worth over time"));
    renderNetWorthChart(lineCard, history.points, history.currency);

    const categoryTitleRow = el("div", { class: "category-title-row" }, [
      el("div", { class: "chart-card-title" }, "By category"),
      el(
        "select",
        {
          class: "category-direction-select",
          onchange: async (e) => {
            selectedCategoryDirection = e.target.value;
            await refreshCharts();
          },
        },
        [
          el("option", { value: "outflow", ...(selectedCategoryDirection === "outflow" ? { selected: true } : {}) }, "Spending (outflow)"),
          el("option", { value: "inflow", ...(selectedCategoryDirection === "inflow" ? { selected: true } : {}) }, "Income (inflow)"),
          el("option", { value: "net", ...(selectedCategoryDirection === "net" ? { selected: true } : {}) }, "Net flow"),
        ]
      ),
    ]);
    const pieCard = el("div", { class: "chart-card" }, [categoryTitleRow]);
    renderCategoryChart(pieCard, breakdown.items, breakdown.currency);

    chartsRow.appendChild(lineCard);
    chartsRow.appendChild(pieCard);
  }

  renderRangeBar(rangeBar, refreshCharts);
  await refreshCharts();

  if (data.products.length === 0) {
    container.appendChild(el("div", { class: "empty-state" }, "No products yet. Add a bank from the sidebar to get started."));
    return;
  }

  const table = el("table", { class: "ledger-table" });
  table.appendChild(
    el(
      "thead",
      {},
      el("tr", {}, [
        el("th", {}, "Bank"),
        el("th", {}, "Product"),
        el("th", {}, "Type"),
        el("th", { class: "num" }, "Balance"),
        el("th", { class: "num" }, `In ${data.currency}`),
      ])
    )
  );
  const tbody = el("tbody");
  for (const p of data.products) {
    const isLiability = LIABILITY_TYPES.has(p.type);
    tbody.appendChild(
      el("tr", { onclick: () => navigate("product", { productId: p.id }) }, [
        el("td", {}, p.bank_name),
        el("td", {}, p.nickname),
        el("td", {}, el("span", { class: "tag" }, productLabel(p.type))),
        el("td", { class: "num" }, formatMoney(p.display_balance, p.currency)),
        el(
          "td",
          { class: `amount ${isLiability ? "negative" : "positive"}` },
          p.converted_value === null ? "—" : formatSignedAmount(p.converted_value, data.currency)
        ),
      ])
    );
  }
  table.appendChild(tbody);
  container.appendChild(table);
}
