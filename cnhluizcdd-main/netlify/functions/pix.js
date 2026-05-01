const BLACKCAT_CREATE_URL = "https://api.blackcatpagamentos.online/api/sales/create-sale";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

function normalizeAmount(rawAmount) {
  if (rawAmount == null) return { amountCents: 100, amountNum: 1 };
  if (typeof rawAmount === "string") {
    const cleaned = rawAmount.replace(/[^\d,.-]/g, "").replace(",", ".");
    const n = parseFloat(cleaned);
    if (!Number.isFinite(n)) return { amountCents: 100, amountNum: 1 };
    return { amountCents: Math.max(1, Math.round(n * 100)), amountNum: n };
  }
  const n = Number(rawAmount);
  if (!Number.isFinite(n)) return { amountCents: 100, amountNum: 1 };
  if (Number.isInteger(n) && n >= 1000) {
    const num = n / 100;
    return { amountCents: Math.max(1, Math.round(num * 100)), amountNum: num };
  }
  return { amountCents: Math.max(1, Math.round(n * 100)), amountNum: n };
}

function isPaidStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "paid" || normalized === "approved";
}

function getBlackCatHeaders(includeContentType = false) {
  const companyId = process.env.BLACKCAT_COMPANY_ID;
  const secretKey = process.env.BLACKCAT_SECRET_KEY;
  const apiKey = process.env.BLACKCAT_API_KEY || process.env.BLACKCAT_SECRET_KEY;

  if (!(secretKey || apiKey)) {
    return null;
  }

  const headers = {};
  const resolvedApiKey = apiKey || secretKey;
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }

  if (companyId) {
    headers["X-Company-Id"] = companyId;
    headers.company_id = companyId;
  }

  if (secretKey) {
    headers["X-Secret-Key"] = secretKey;
    headers.secret_key = secretKey;
  }

  headers["X-API-Key"] = resolvedApiKey;
  headers.Authorization = `Bearer ${resolvedApiKey}`;

  return headers;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      },
      body: "",
    };
  }

  const headers = getBlackCatHeaders(true);
  if (!headers) {
    return jsonResponse(500, {
      success: false,
      error: "Configure BLACKCAT_SECRET_KEY nas variaveis do Netlify",
    });
  }

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const randDigits = (len) => Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
  const randId = randDigits(6);
  const rawAmount = body.amount ?? 89.50;
  const { amountCents, amountNum } = normalizeAmount(rawAmount);
  const customerName = (body.nome || body.name || body.customer_name || `Cliente ${randId}`).toString();
  const customerEmail = (body.email || body.customer_email || `cliente${randId}@example.com`).toString();
  const customerPhone = (body.phone || body.customer_phone || `11${randDigits(9)}`).toString().replace(/\D/g, "");
  const cpfRaw = (body.cpf || body.document || body.customer_cpf || randDigits(11)).toString().replace(/\D/g, "");
  const customerCpf = cpfRaw.padEnd(11, "0").slice(0, 11);
  const tracking = (body.tracking || body.rastreio || body.codigo || `pedido-${randId}`).toString();
  const description = "Assinatura Avisaai";

  const payload = {
    amount: amountCents,
    currency: "BRL",
    paymentMethod: "pix",
    items: [
      {
        title: description,
        unitPrice: amountCents,
        quantity: 1,
        tangible: false,
      },
    ],
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
      document: {
        number: customerCpf,
        type: "cpf",
      },
    },
    pix: {
      expiresInDays: 1,
    },
    externalRef: tracking,
    metadata: `tracking:${tracking}`,
  };
  if (process.env.POSTBACK_URL) payload.postbackUrl = process.env.POSTBACK_URL;

  const blackcatResp = await fetch(BLACKCAT_CREATE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await blackcatResp.text();
  if (!blackcatResp.ok) {
    return jsonResponse(blackcatResp.status, { success: false, error: text || "Erro ao criar PIX" });
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }
  if (data?.success === false) {
    return jsonResponse(400, { success: false, error: data?.error || data?.message || "Erro ao criar PIX" });
  }

  const transactionData = data?.data || data;
  const pixData = transactionData?.paymentData || transactionData?.pix || {};
  const brcode =
    pixData?.copyPaste ||
    pixData?.qrCodeText ||
    pixData?.payload ||
    pixData?.brcode ||
    pixData?.qr_code ||
    pixData?.qrcode ||
    transactionData?.qrCodeText ||
    transactionData?.copyPaste ||
    transactionData?.brcode ||
    transactionData?.payload ||
    transactionData?.qrcode ||
    null;
  const qrcodeFinal =
    pixData?.qrCodeBase64 || pixData?.qrCode || pixData?.qrcode || pixData?.qr_code || pixData?.payload || brcode;
  const paymentId = transactionData?.transactionId || transactionData?.paymentId || transactionData?.id || null;
  const status = String(transactionData?.status || "PENDING").toLowerCase();
  const amountRaw = Number(transactionData?.amount);
  const amountInReais = Number.isFinite(amountRaw) ? amountRaw / 100 : amountNum;

  return jsonResponse(200, {
    success: true,
    status,
    pix_code: brcode,
    transaction_id: paymentId,
    deposit_id: paymentId,
    qrcode: qrcodeFinal,
    amount: amountInReais,
    amount_cents: Number.isFinite(amountRaw) ? amountRaw : amountCents,
    key: null,
    brcode,
    payload: brcode,
    pixCode: brcode,
    paid: isPaidStatus(status),
    pix: {
      key: null,
      brcode,
      qrcode: qrcodeFinal,
      payload: brcode,
      expiresAt: pixData?.expiresAt || transactionData?.expiresAt || data?.expiresAt || null,
    },
    raw: transactionData,
    raw_response: data,
  });
};
