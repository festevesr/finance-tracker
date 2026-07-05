/**
 * Shared helpers used across the frontend. If you want to change how
 * money is formatted everywhere, or add a new product type's label,
 * this is the only file to touch.
 */

export const PRODUCT_TYPES = {
  savings_account: { label: "Savings account", hasBalance: true, hasAccountNumber: true, hasExpiry: false, hasInterestRate: true },
  debit_card: {
    label: "Debit card", hasBalance: false, hasAccountNumber: false, hasExpiry: true,
    hasCurrencyInput: false, needsLink: true, linkType: "savings_account",
    linkLabel: "Linked savings account",
    linkHint: "Debit cards have no balance of their own — purchases will move money in and out of this account.",
  },
  credit_card: {
    label: "Credit card", hasBalance: true, hasAccountNumber: false, hasExpiry: true,
    hasCreditLine: true, creditLineLabel: "Credit line", hasInterestRate: true,
  },
  additional_credit_card: {
    label: "Additional credit card", hasBalance: false, hasAccountNumber: false, hasExpiry: true,
    hasCurrencyInput: false, needsLink: true, linkType: "credit_card",
    linkLabel: "Primary credit card",
    linkHint: "Additional cards share the primary card's balance and credit line — charges here affect the primary card too.",
    hasCreditLine: true, creditLineLabel: "Assigned credit limit (optional)",
  },
  loan: { label: "Loan", hasBalance: true, hasAccountNumber: false, hasExpiry: false, hasInterestRate: true },
  mortgage: { label: "Mortgage", hasBalance: true, hasAccountNumber: false, hasExpiry: false, hasInterestRate: true },
  time_deposit: { label: "Time deposit", hasBalance: true, hasAccountNumber: false, hasExpiry: false, hasInterestRate: true },
  mutual_fund: { label: "Mutual fund", hasBalance: true, hasAccountNumber: false, hasExpiry: false },
  investment: { label: "Investment", hasBalance: true, hasAccountNumber: false, hasExpiry: false },
};

export const LIABILITY_TYPES = new Set(["credit_card", "loan", "mortgage"]);

// Types whose balance/transactions are mirrored onto a linked product
// (debit_card -> savings_account, additional_credit_card -> credit_card).
export const LINKED_PRODUCT_TYPES = new Set(["debit_card", "additional_credit_card"]);

export function productLabel(type) {
  return PRODUCT_TYPES[type]?.label ?? type;
}

export function formatMoney(amount, currency) {
  const n = Number(amount ?? 0);
  const formatted = n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${formatted} ${currency}`;
}

export function formatSignedAmount(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  const sign = amount < 0 ? "-" : "";
  const formatted = Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${sign}${formatted} ${currency}`;
}

export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

// `new Date().toISOString()` always returns the UTC date, which is the
// wrong calendar day for part of the day in timezones behind UTC (e.g.
// Peru, UTC-5). Use this instead anywhere "today" needs to match what
// the user's own clock says.
export function localISODate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "html") node.innerHTML = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function openDialog(dialog) {
  dialog.showModal();
}

export function closeDialog(dialog) {
  dialog.close();
}

export function showError(message) {
  const banner = document.getElementById("error-banner");
  banner.textContent = message;
  banner.classList.remove("hidden");
  setTimeout(() => banner.classList.add("hidden"), 5000);
}

// Positions a floating tooltip element near the mouse, clamped so it
// never overflows its relatively-positioned container. Used by both
// chart modules (networth-chart.js, category-chart.js) on hover.
export function positionTooltip(tooltipEl, containerEl, clientX, clientY) {
  const containerRect = containerEl.getBoundingClientRect();
  let left = clientX - containerRect.left + 14;
  let top = clientY - containerRect.top - 12;

  // Measure after content is set so offsetWidth/Height are accurate.
  const tooltipWidth = tooltipEl.offsetWidth || 120;
  const tooltipHeight = tooltipEl.offsetHeight || 40;

  if (left + tooltipWidth > containerRect.width) left = clientX - containerRect.left - tooltipWidth - 14;
  if (top < 0) top = clientY - containerRect.top + 14;
  if (top + tooltipHeight > containerRect.height) top = containerRect.height - tooltipHeight - 4;

  tooltipEl.style.left = `${Math.max(0, left)}px`;
  tooltipEl.style.top = `${Math.max(0, top)}px`;
}
