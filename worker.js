const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function base64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "").replace(/\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500
  }));
  const unsigned = `${header}.${claim}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${base64url(new Uint8Array(signature))}`;

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error("Google authorization failed: " + JSON.stringify(data));
  }
  return data.access_token;
}

async function appendToSheet(env, row) {
  const token = await getGoogleAccessToken(env);
  const range = encodeURIComponent(env.GOOGLE_SHEET_RANGE || "Bookings!A:K");
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${env.GOOGLE_SHEET_ID}/values/${range}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ values: [row] })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("Google Sheets write failed: " + JSON.stringify(data));
  return data;
}

async function sendWhatsAppTemplate(env, recipient, booking) {
  const phone = normalizePhone(recipient);
  if (!phone) return { sent: false, reason: "No recipient configured" };

  const components = [{
    type: "body",
    parameters: [
      { type: "text", text: booking.reference },
      { type: "text", text: booking.branch },
      { type: "text", text: booking.fullName },
      { type: "text", text: booking.phone },
      { type: "text", text: booking.service },
      { type: "text", text: booking.details.slice(0, 900) }
    ]
  }];

  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION || "v23.0"}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: env.WHATSAPP_TEMPLATE_NAME || "new_booking_alert",
        language: { code: env.WHATSAPP_TEMPLATE_LANGUAGE || "en" },
        components
      }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("WhatsApp send failed: " + JSON.stringify(data));
  return { sent: true, messageId: data.messages?.[0]?.id || null };
}

function getBranches(env) {
  let config;
  try {
    config = JSON.parse(env.BRANCHES_JSON || "[]");
  } catch {
    throw new Error("BRANCHES_JSON must contain valid JSON.");
  }
  if (!Array.isArray(config)) throw new Error("BRANCHES_JSON must be a JSON array.");
  return config.filter(b => b && typeof b.name === "string" && b.name.trim())
    .map(b => ({ name: b.name.trim(), whatsapp: normalizePhone(b.whatsapp) }));
}

function requiredEnv(env, keys) {
  const missing = keys.filter(k => !env[k]);
  if (missing.length) throw new Error("Server configuration missing: " + missing.join(", "));
}

async function handleBooking(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: "Invalid request body." }, 400); }

  // Honeypot: quietly reject obvious bot submissions.
  if (String(body.website || "").trim()) return json({ ok: true, reference: "received" });

  const fullName = String(body.fullName || "").trim();
  const phone = String(body.phone || "").trim();
  const branch = String(body.branch || "").trim();
  const service = String(body.service || "").trim();
  const details = String(body.details || "").trim();
  const contactPreference = String(body.contactPreference || "WhatsApp").trim();

  if (!fullName || !phone || !branch || !service || !details) {
    return json({ ok: false, error: "Please complete all required fields." }, 400);
  }
  if (fullName.length > 100 || phone.length > 30 || details.length > 1500) {
    return json({ ok: false, error: "One or more fields are too long." }, 400);
  }
  if (!/^[+\d()\-\s.]{7,30}$/.test(phone)) {
    return json({ ok: false, error: "Please enter a valid phone number." }, 400);
  }

  let branchConfig;
  try {
    branchConfig = JSON.parse(env.BRANCHES_JSON || "[]");
  } catch {
    return json({ ok: false, error: "Branch configuration is invalid." }, 500);
  }
  const selected = Array.isArray(branchConfig)
    ? branchConfig.find(b => b && String(b.name || "").trim() === branch)
    : null;
  if (!selected) return json({ ok: false, error: "Please select a valid branch." }, 400);

  try {
    requiredEnv(env, [
      "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY",
      "GOOGLE_SHEET_ID", "WHATSAPP_PHONE_NUMBER_ID",
      "WHATSAPP_ACCESS_TOKEN", "CENTRAL_WHATSAPP_NUMBER"
    ]);

    const reference = "BMS-" + new Date().toISOString().slice(0,10).replace(/-/g,"") +
      "-" + crypto.randomUUID().slice(0,8).toUpperCase();
    const createdAt = new Date().toISOString();

    // Save the booking first. A notification failure must not lose the enquiry.
    await appendToSheet(env, [
      createdAt, reference, branch, fullName, phone, service, details,
      contactPreference, "New", "Pending", "Pending"
    ]);

    const booking = { reference, branch, fullName, phone, service, details };
    const notificationResults = [];
    const recipients = [
      { label: "branch", phone: selected.whatsapp }
    ];
    if (env.CENTRAL_WHATSAPP_NUMBER) {
      recipients.push({ label: "central", phone: env.CENTRAL_WHATSAPP_NUMBER });
    }

    for (const recipient of recipients) {
      if (!recipient.phone) {
        notificationResults.push({ destination: recipient.label, sent: false, reason: "Number not configured" });
        continue;
      }
      try {
        const result = await sendWhatsAppTemplate(env, recipient.phone, booking);
        notificationResults.push({ destination: recipient.label, ...result });
      } catch (error) {
        console.error(`WhatsApp ${recipient.label} notification failed:`, error.message);
        notificationResults.push({ destination: recipient.label, sent: false, reason: "Notification failed" });
      }
    }

    // A booking is successful once stored, even if a notification is temporarily unavailable.
    return json({
      ok: true,
      reference,
      notifications: notificationResults.map(n => ({
        destination: n.destination, sent: Boolean(n.sent)
      }))
    }, 201);
  } catch (error) {
    console.error("Booking request failed:", error.message);
    return json({
      ok: false,
      error: "We couldn't save your request right now. Please try again later."
    }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "Bonnie Mobile Spares booking API" });
    }

    if (url.pathname === "/api/branches" && request.method === "GET") {
      try {
        return json({ branches: getBranches(env) });
      } catch (error) {
        console.error(error.message);
        return json({ error: "Branch configuration is unavailable." }, 500);
      }
    }

    if (url.pathname === "/api/bookings" && request.method === "POST") {
      return handleBooking(request, env);
    }

    return json({ error: "Not found" }, 404);
  }
};
