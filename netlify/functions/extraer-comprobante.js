// Netlify Function: lee un comprobante (imagen o PDF en base64) con Google Gemini
// y devuelve fecha, importe, proveedor y numero de factura en JSON.
//
// Requiere la variable de entorno GEMINI_API_KEY configurada en
// Netlify -> Site configuration -> Environment variables.
// Conseguila gratis (sin tarjeta) en https://aistudio.google.com/apikey

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Falta configurar GEMINI_API_KEY en Netlify" }) };
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Body invalido" }) };
  }

  const { dataUrl } = payload; // "data:image/jpeg;base64,...." o "data:application/pdf;base64,...."
  if (!dataUrl || !dataUrl.startsWith("data:")) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Falta dataUrl del comprobante" }) };
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "dataUrl mal formado" }) };
  }
  const mediaType = match[1];
  const base64Data = match[2];

  const prompt = `Mira este comprobante de gasto (factura, ticket o recibo) y extrae estos datos exactos:
- fecha: fecha del comprobante en formato YYYY-MM-DD (si no se ve el anio, asumi el anio actual)
- importe: el importe TOTAL final pagado, como numero (sin simbolo de moneda, con punto decimal, ej: 12500.50)
- proveedor: el nombre del comercio o proveedor que emitio el comprobante
- numeroFactura: el numero de factura, ticket o comprobante si figura (formato tal cual aparece, ej: 0001-00012345)

Si algun dato no se puede leer con confianza, pone null en ese campo (no inventes datos).
Responde UNICAMENTE con un JSON valido, sin texto adicional, sin markdown, con esta forma exacta:
{"fecha": "YYYY-MM-DD" o null, "importe": numero o null, "proveedor": "texto" o null, "numeroFactura": "texto" o null}`;

  try {
    const model = "gemini-2.0-flash";
    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { inline_data: { mime_type: mediaType, data: base64Data } },
                { text: prompt },
              ],
            },
          ],
          generationConfig: { response_mime_type: "application/json" },
        }),
      }
    );

    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Error de la IA", detalle: data }) };
    }

    let texto = "";
    try {
      texto = data.candidates[0].content.parts.map((p) => p.text || "").join("").trim();
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "Respuesta inesperada de la IA", raw: data }) };
    }
    texto = texto.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```\s*$/, "").trim();

    let extraido;
    try {
      extraido = JSON.parse(texto);
    } catch (e) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: "No se pudo interpretar la respuesta de la IA", raw: texto }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify(extraido) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: "Error interno", detalle: String(e) }) };
  }
};
