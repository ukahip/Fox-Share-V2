module.exports = async function (req, res) {
  var allowed = (process.env.ALLOWED_ORIGIN || "").trim();
  var origin  = req.headers["origin"] || "";
  var corsOrigin = (allowed && origin === allowed) ? allowed : (allowed || "null");

  res.setHeader("Access-Control-Allow-Origin",  corsOrigin);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Vary", "Origin");
  // Security headers (Vercel header rules don't apply to serverless responses)
  res.setHeader("X-Content-Type-Options",   "nosniff");
  res.setHeader("X-Frame-Options",           "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  res.setHeader("Cache-Control",             "no-store, no-cache, must-revalidate");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  var API_URL = (process.env.API_URL || "").trim();
  if (!API_URL) {
    res.status(500).json({ error: "Missing env var: API_URL" });
    return;
  }

  var url    = req.url || "";
  var params = new URLSearchParams(url.includes("?") ? url.split("?")[1] : "");
  var path   = params.get("path") || "/files";
  var key    = params.get("key")  || "";
  var qs     = params.get("qs")   || "";

  var targetUrl = API_URL + path;
  if (key)      targetUrl += "?s3_key=" + encodeURIComponent(key);
  else if (qs)  targetUrl += "?" + qs;

  var headers = {
    "Content-Type":  "application/json",
    "Authorization": req.headers["authorization"] || ""
  };

  var fetchOpts = { method: req.method, headers: headers };

  if (req.method !== "GET" && req.method !== "DELETE") {
    var body = req.body;
    if (typeof body !== "string") body = JSON.stringify(body);
    fetchOpts.body = body;
  }

  try {
    var response    = await fetch(targetUrl, fetchOpts);
    var status      = response.status;
    var contentType = response.headers.get("content-type") || "";
    var buffer      = await response.arrayBuffer();
    var bytes       = Buffer.from(buffer);

    if (path.includes("/download") && status >= 200 && status < 300) {
      res.status(status);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.setHeader("Content-Disposition",
        response.headers.get("content-disposition") || "attachment");
      res.end(bytes);
      return;
    }

    var text = bytes.toString("utf8");
    if (text.trimStart().startsWith("{") || text.trimStart().startsWith("[")) {
      try {
        res.status(status).json(JSON.parse(text));
      } catch(e) {
        res.status(status).json({ error: text });
      }
    } else if (status >= 200 && status < 300) {
      res.status(status);
      res.setHeader("Content-Type", contentType || "application/octet-stream");
      res.end(bytes);
    } else {
      res.status(status).json({ error: text || ("HTTP " + status) });
    }

  } catch (e) {
    res.status(500).json({ error: "Proxy fetch failed: " + e.message });
  }
};
