const BLACKCAT_API_BASE = "https://api.blackcatpagamentos.online/api";

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

function getBlackCatHeaders() {
  const companyId = process.env.BLACKCAT_COMPANY_ID;
  const secretKey = process.env.BLACKCAT_SECRET_KEY;
  const apiKey = process.env.BLACKCAT_API_KEY || process.env.BLACKCAT_SECRET_KEY;

  if (!(secretKey || apiKey)) {
    return null;
  }

  const headers = {};
  const resolvedApiKey = apiKey || secretKey;

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

  const headers = getBlackCatHeaders();
  if (!headers) {
    return jsonResponse(500, {
      success: false,
      error: "Configure BLACKCAT_SECRET_KEY nas variaveis do Netlify",
    });
  }

  let id = event.queryStringParameters?.id;
  if (event.httpMethod === "POST") {
    try {
      const body = event.body ? JSON.parse(event.body) : {};
      id = body?.id || body?.paymentId || id;
    } catch {}
  }

  if (!id) {
    return jsonResponse(400, { success: false, error: "Informe o id" });
  }

  const statusResp = await fetch(`${BLACKCAT_API_BASE}/sales/${encodeURIComponent(id)}/status`, {
    method: "GET",
    headers,
  });

  const text = await statusResp.text();
  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (!statusResp.ok || data?.success === false) {
    return jsonResponse(statusResp.status, {
      success: false,
      error: data?.error || data?.message || text || "Erro ao consultar pagamento",
    });
  }

  const transactionData = data?.data || data;
  const status = String(transactionData?.status || "PENDING").toLowerCase();
  return jsonResponse(200, {
    success: true,
    id,
    status,
    paid: status === "paid" || status === "approved",
    raw: transactionData,
    raw_response: data,
  });
};
