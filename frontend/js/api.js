/**
 * All HTTP calls to the backend live here. If the API URL/prefix ever
 * changes, or you need to add a new endpoint, this is the only file
 * to touch — every other module calls these functions, never `fetch`
 * directly.
 */

const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      if (Array.isArray(body.detail)) {
        // FastAPI/Pydantic validation errors: a list of {loc, msg, ...}
        detail = body.detail
          .map((d) => (d && d.msg ? `${(d.loc || []).slice(-1)[0] ?? "field"}: ${d.msg}` : JSON.stringify(d)))
          .join("; ");
      } else if (typeof body.detail === "string") {
        detail = body.detail;
      } else if (body.detail) {
        detail = JSON.stringify(body.detail);
      }
    } catch (_) {}
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

// ---- Banks ----
export const getBanks = () => request("/banks");
export const createBank = (name) => request("/banks", { method: "POST", body: JSON.stringify({ name }) });
export const updateBank = (id, name) => request(`/banks/${id}`, { method: "PUT", body: JSON.stringify({ name }) });
export const deleteBank = (id) => request(`/banks/${id}`, { method: "DELETE" });
export const getBankTotals = (id, currency) => request(`/banks/${id}/totals${currency ? `?currency=${currency}` : ""}`);

// ---- Products ----
export const getProducts = (bankId, linkedTo) => {
  const params = new URLSearchParams();
  if (bankId !== undefined && bankId !== null) params.set("bank_id", bankId);
  if (linkedTo !== undefined && linkedTo !== null) params.set("linked_to", linkedTo);
  const qs = params.toString();
  return request(`/products${qs ? `?${qs}` : ""}`);
};
export const getProduct = (id) => request(`/products/${id}`);
export const createProduct = (payload) => request("/products", { method: "POST", body: JSON.stringify(payload) });
export const updateProduct = (id, payload) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) });
export const deleteProduct = (id) => request(`/products/${id}`, { method: "DELETE" });
export const settleCreditCardCycle = (id, settleDate) => {
  const qs = settleDate ? `?settle_date=${settleDate}` : "";
  return request(`/products/${id}/settle-cycle${qs}`, { method: "POST" });
};

// ---- Transactions ----
export const getTransactions = (productId) => request(`/products/${productId}/transactions`);
export const createTransaction = (productId, payload) =>
  request(`/products/${productId}/transactions`, { method: "POST", body: JSON.stringify(payload) });
export const updateTransaction = (id, payload) => request(`/transactions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
export const deleteTransaction = (id) => request(`/transactions/${id}`, { method: "DELETE" });

// ---- Transaction templates (quick-entry shortcuts) ----
export const getTemplates = (productId) => request(`/products/${productId}/templates`);
export const createTemplate = (productId, payload) =>
  request(`/products/${productId}/templates`, { method: "POST", body: JSON.stringify(payload) });
export const deleteTemplate = (id) => request(`/templates/${id}`, { method: "DELETE" });

// ---- Dashboard ----
// Exchange rates are fetched automatically on the backend (see
// services/fx.py) — there's no manual rates page or endpoint call here.
function buildQuery(params) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") usp.set(key, value);
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export const getDashboard = (currency) => request(`/dashboard${buildQuery({ currency })}`);
export const getNetWorthHistory = (currency, startDate, endDate) =>
  request(`/dashboard/history${buildQuery({ currency, start_date: startDate, end_date: endDate })}`);
export const getCategoryBreakdown = (currency, startDate, endDate, direction) =>
  request(`/dashboard/categories${buildQuery({ currency, start_date: startDate, end_date: endDate, direction })}`);
export const getTicker = () => request("/dashboard/ticker");

// ---- Transfers (moving money between two of the user's own products) ----
export const createTransfer = (payload) => request("/transfers", { method: "POST", body: JSON.stringify(payload) });
