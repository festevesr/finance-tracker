/**
 * The "Transfer money" dialog — moving money between two of the user's
 * own products (paying a card from savings, funding a time deposit,
 * any account-to-account move). Creates a linked pair of transactions
 * via the backend's /api/transfers endpoint (see services/transfers.py),
 * tagged so they're excluded from the spending-by-category breakdown.
 */
import * as api from "./api.js";
import { el, localISODate, LINKED_PRODUCT_TYPES } from "./utils.js";

const dialog = document.getElementById("transfer-dialog");
const form = document.getElementById("transfer-form");
const sourceSelect = document.getElementById("transfer-source-select");
const destinationSelect = document.getElementById("transfer-destination-select");
const dateInput = document.getElementById("transfer-date-input");
const nameInput = document.getElementById("transfer-name-input");
const amountInput = document.getElementById("transfer-amount-input");
const amountHint = document.getElementById("transfer-amount-hint");
const rateGroup = document.getElementById("transfer-rate-field-group");
const rateInput = document.getElementById("transfer-rate-input");
const rateHint = document.getElementById("transfer-rate-hint");
const cancelBtn = document.getElementById("transfer-cancel-btn");

let callbacks = { onSaved: () => {} };
let allProducts = [];
let allBanksById = {};

// For a product whose balance actually lives on a linked product
// (debit card -> savings, additional card -> primary card), show the
// currency/owner the money will actually move against, so the picker
// isn't confusing.
function ownerCurrencyOf(product) {
  if (LINKED_PRODUCT_TYPES.has(product.type) && product.linked_product_id) {
    const owner = allProducts.find((p) => p.id === product.linked_product_id);
    return owner ? owner.currency : product.currency;
  }
  return product.currency;
}

function productOptionLabel(product) {
  const bankName = allBanksById[product.bank_id] ?? "";
  return `${bankName} — ${product.nickname} (${ownerCurrencyOf(product)})`;
}

function populateSelect(selectEl, excludeId) {
  selectEl.innerHTML = "";
  for (const p of allProducts) {
    if (p.id === excludeId) continue;
    if (p.type === "additional_credit_card") continue; // payments go to the primary card only
    selectEl.appendChild(el("option", { value: p.id }, productOptionLabel(p)));
  }
}

function updateRateVisibility() {
  const source = allProducts.find((p) => p.id === Number(sourceSelect.value));
  const destination = allProducts.find((p) => p.id === Number(destinationSelect.value));
  if (!source || !destination) return;

  const sourceCurrency = ownerCurrencyOf(source);
  const destinationCurrency = ownerCurrencyOf(destination);
  const same = sourceCurrency === destinationCurrency;

  amountHint.textContent = `(in ${sourceCurrency})`;
  rateGroup.classList.toggle("hidden", same);
  rateInput.required = !same;
  rateHint.textContent = same ? "" : `(1 ${sourceCurrency} = how many ${destinationCurrency}?)`;
}

export function initTransferDialog(cb) {
  callbacks = cb;
  cancelBtn.addEventListener("click", () => dialog.close());
  sourceSelect.addEventListener("change", () => {
    const excludeId = Number(sourceSelect.value);
    const previousDestination = destinationSelect.value;
    populateSelect(destinationSelect, excludeId);
    if (previousDestination && previousDestination !== sourceSelect.value) {
      destinationSelect.value = previousDestination;
    }
    rateInput.value = "";
    updateRateVisibility();
  });
  destinationSelect.addEventListener("change", () => {
    rateInput.value = "";
    updateRateVisibility();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveTransfer();
  });
}

export async function openTransferDialog(currentProductId) {
  const [products, banks] = await Promise.all([api.getProducts(), api.getBanks()]);
  allProducts = products;
  allBanksById = Object.fromEntries(banks.map((b) => [b.id, b.name]));

  const eligible = allProducts.filter((p) => p.type !== "additional_credit_card");
  if (eligible.length < 2) {
    alert("You need at least two non-additional-card products to make a transfer.");
    return;
  }

  sourceSelect.innerHTML = "";
  for (const p of allProducts) {
    if (p.type === "additional_credit_card") continue;
    const opt = el("option", { value: p.id }, productOptionLabel(p));
    if (p.id === currentProductId) opt.selected = true;
    sourceSelect.appendChild(opt);
  }

  // Populate destination excluding the currently-selected source.
  const initialSourceId = Number(sourceSelect.value);
  populateSelect(destinationSelect, initialSourceId);

  dateInput.value = localISODate();
  nameInput.value = "";
  amountInput.value = "";
  rateInput.value = "";

  // Now both selects have values — safe to compute visibility.
  updateRateVisibility();
  dialog.showModal();
}

async function saveTransfer() {
  const sourceId = Number(sourceSelect.value);
  const destinationId = Number(destinationSelect.value);
  if (sourceId === destinationId) {
    alert("Source and destination must be different products.");
    return;
  }

  const source = allProducts.find((p) => p.id === sourceId);
  const destination = allProducts.find((p) => p.id === destinationId);
  const sameCurrency = ownerCurrencyOf(source) === ownerCurrencyOf(destination);

  const payload = {
    date: dateInput.value,
    source_product_id: sourceId,
    destination_product_id: destinationId,
    name: nameInput.value.trim() || "Transfer",
    amount: parseFloat(amountInput.value),
  };
  if (!sameCurrency) {
    if (!rateInput.value) {
      alert("Please enter the exchange rate for this transfer.");
      return;
    }
    payload.destination_exchange_rate = parseFloat(rateInput.value);
  }

  try {
    await api.createTransfer(payload);
    dialog.close();
    callbacks.onSaved(sourceId);
  } catch (err) {
    alert(err.message);
  }
}
