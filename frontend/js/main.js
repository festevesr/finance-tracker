/**
 * App entrypoint: owns the tiny view-routing state and wires every
 * module's dialogs/buttons together. To add a whole new view, add a
 * case in render() and a nav button in index.html — nothing else here
 * should need to change.
 */
import { showError } from "./utils.js";
import { renderDashboard } from "./dashboard.js";
import { renderBankView, initBankDialog, openAddBankDialog, refreshSidebar } from "./banks.js";
import { renderProductView, initProductDialog } from "./products.js";
import { initTransactionDialog } from "./transactions.js";
import { initTransferDialog } from "./transfer-dialog.js";

const state = { view: "dashboard", bankId: null, productId: null };

const mainEl = document.getElementById("main-content");
const bankListEl = document.getElementById("bank-list");
const navDashboardBtn = document.getElementById("nav-dashboard");

export function navigate(view, params = {}) {
  state.view = view;
  if ("bankId" in params) state.bankId = params.bankId;
  if (view === "dashboard") state.bankId = null;
  state.productId = params.productId ?? null;
  render();
}

async function render() {
  navDashboardBtn.classList.toggle("is-active", state.view === "dashboard");
  bankListEl.querySelectorAll(".bank-list-item").forEach((item) => {
    item.classList.toggle("is-active", Number(item.dataset.bankId) === state.bankId);
  });

  mainEl.innerHTML = "";
  try {
    if (state.view === "dashboard") await renderDashboard(mainEl, navigate);
    else if (state.view === "bank") await renderBankView(mainEl, state.bankId, navigate);
    else if (state.view === "product") await renderProductView(mainEl, state.productId, navigate);
  } catch (err) {
    showError(err.message);
  }
}

navDashboardBtn.addEventListener("click", () => navigate("dashboard"));
document.getElementById("add-bank-btn").addEventListener("click", () => openAddBankDialog());

initBankDialog({
  onSaved: async () => {
    await refreshSidebar(navigate);
    render();
  },
  onDeleted: async () => {
    await refreshSidebar(navigate);
    navigate("dashboard");
  },
});

initProductDialog({
  onSaved: (bankId) => navigate("bank", { bankId }),
  onDeleted: (bankId) => navigate("bank", { bankId }),
});

initTransactionDialog({
  onSaved: (productId) => navigate("product", { productId }),
  onDeleted: (productId) => navigate("product", { productId }),
});

initTransferDialog({
  onSaved: (sourceProductId) => navigate("product", { productId: sourceProductId }),
});

refreshSidebar(navigate).then(() => navigate("dashboard"));
