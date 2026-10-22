const form = document.querySelector("#booking-form");
const branchSelect = document.querySelector("#branch");
const submitButton = document.querySelector("#submit-button");
const resultBox = document.querySelector("#result");
const branchWhatsAppWrap = document.querySelector("#branch-whatsapp-wrap");
const branchWhatsAppLink = document.querySelector("#branch-whatsapp-link");
let branches = [];

document.querySelector("#year").textContent = new Date().getFullYear();

function showResult(message, kind) {
  resultBox.hidden = false;
  resultBox.className = `result ${kind}`;
  resultBox.textContent = message;
}

function updateBranchWhatsApp() {
  const selected = branches.find((branch) => branch.name === branchSelect.value);
  const phone = String(selected?.whatsapp || "").replace(/\D/g, "");
  if (!selected || !/^254\d{9}$/.test(phone)) {
    branchWhatsAppWrap.hidden = true;
    branchWhatsAppLink.removeAttribute("href");
    return;
  }
  const message = `Hello Bonnie Mobile Spares, I would like to contact the ${selected.name}.`;
  branchWhatsAppLink.href = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  branchWhatsAppLink.textContent = `Chat with ${selected.name} on WhatsApp`;
  branchWhatsAppWrap.hidden = false;
}

branchSelect.addEventListener("change", updateBranchWhatsApp);

async function loadBranches() {
  try {
    const response = await fetch("/api/branches");
    if (!response.ok) throw new Error("Branch list is not available.");
    const data = await response.json();
    branches = data.branches || [];
    branchSelect.replaceChildren(new Option("Choose your preferred branch", ""));
    for (const branch of branches) {
      branchSelect.add(new Option(branch.name, branch.name));
    }
    updateBranchWhatsApp();
    if (branches.length === 0) {
      branchSelect.replaceChildren(new Option("Branches are being configured", ""));
      branchSelect.disabled = true;
    }
  } catch (error) {
    branchSelect.replaceChildren(new Option("Unable to load branches — refresh the page", ""));
    branchSelect.disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  resultBox.hidden = true;

  if (!form.reportValidity()) return;

  const payload = {
    branch: branchSelect.value,
    fullName: document.querySelector("#fullName").value.trim(),
    phone: document.querySelector("#phone").value.trim(),
    service: document.querySelector("#service").value,
    details: document.querySelector("#details").value.trim(),
    contactPreference: document.querySelector("#contactPreference").value,
    website: document.querySelector("#website").value
  };

  submitButton.disabled = true;
  submitButton.querySelector("span").textContent = "Submitting…";

  try {
    const response = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || "We couldn't submit your request. Please try again.");
    }
    form.reset();
    showResult(
      `Thank you. Your enquiry has been recorded. Reference: ${data.reference}. The selected branch will follow up with you.`,
      "success"
    );
    window.scrollTo({ top: resultBox.getBoundingClientRect().top + window.scrollY - 100, behavior: "smooth" });
  } catch (error) {
    showResult(error.message || "Something went wrong. Please try again.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.querySelector("span").textContent = "Submit enquiry";
  }
});

loadBranches();
