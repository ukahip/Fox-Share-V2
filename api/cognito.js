module.exports = async function (req, res) {
  var allowed = (process.env.ALLOWED_ORIGIN || "").trim();
  var origin  = req.headers["origin"] || "";
  var corsOrigin = (allowed && origin === allowed) ? allowed : (allowed || "null");

  res.setHeader("Access-Control-Allow-Origin",  corsOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Vary", "Origin");
  // Security headers (Vercel header rules don't apply to serverless responses)
  res.setHeader("X-Content-Type-Options",   "nosniff");
  res.setHeader("X-Frame-Options",           "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("Cache-Control",             "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  var POOL_ID   = (process.env.POOL_ID   || "").trim();
  var CLIENT_ID = (process.env.CLIENT_ID || "").trim();

  if (!POOL_ID || !CLIENT_ID) {
    res.status(500).json({ error: "Missing environment variables" });
    return;
  }

  var region = POOL_ID.split("_")[0];

  var parsed = req.body;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); }
    catch (e) { res.status(400).json({ error: "Invalid JSON body" }); return; }
  }

  if (!parsed || !parsed.target) {
    res.status(400).json({ error: "Missing target in request body" });
    return;
  }

  var target    = parsed.target;
  var body      = parsed.body || {};
  body.ClientId = CLIENT_ID;

  try {
    var response = await fetch(
      "https://cognito-idp." + region + ".amazonaws.com/",
      {
        method:  "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": target
        },
        body: JSON.stringify(body)
      }
    );
    var data = await response.json();
    res.status(response.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "Fetch failed: " + e.message });
  }
};
