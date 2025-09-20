const express = require("express");
const { Pool } = require("pg");
const helmet = require("helmet");
const cors = require("cors");
const https = require("https");
const fs = require("fs");
require("dotenv").config();

const app = express();
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  })
);

// CORS middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Credentials", "false");
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, x-ingest-token, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});
app.use(express.json({ limit: "10mb" }));

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  max: 10,
});

function authMiddleware(req, res, next) {
  const token = req.header("x-ingest-token");
  if (!process.env.INGEST_TOKEN || token === process.env.INGEST_TOKEN)
    return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.post("/rrweb/events", authMiddleware, async (req, res) => {
  try {
    const body = req.body || {};
    const sessionId = body.sessionId;
    const metadata = body.metadata || {};
    const events = Array.isArray(body.events) ? body.events : [];
    if (!sessionId || events.length === 0) {
      return res
        .status(400)
        .json({ error: "sessionId and non-empty events[] are required" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const ua = metadata.userAgent || req.headers["user-agent"] || null;
      const ref =
        metadata.referrer ||
        req.headers["referer"] ||
        req.headers["referrer"] ||
        null;
      const ipHdr = req.headers["x-forwarded-for"];
      const ip =
        (ipHdr
          ? String(ipHdr).split(",")[0]
          : req.socket.remoteAddress || ""
        ).trim() || null;

      const upsertSessionSql =
        "insert into sessions (external_id, user_agent, referrer, ip)\n" +
        "values ($1, $2, $3, $4)\n" +
        "on conflict (external_id) do update set user_agent = coalesce(excluded.user_agent, sessions.user_agent)\n" +
        "returning id";

      const sess = await client.query(upsertSessionSql, [
        sessionId,
        ua,
        ref,
        ip,
      ]);
      const sessionDbId = sess.rows[0].id;

      const insertOne =
        "insert into events (session_id, event_index, ts_ms, type, data, created_at)\n" +
        "values ($1, $2, $3, $4, $5::jsonb, NOW())\n" +
        "on conflict (session_id, event_index) do nothing";

      let stored = 0;
      for (let i = 0; i < events.length; i++) {
        const ev = events[i];
        const ts = typeof ev.timestamp === "number" ? ev.timestamp : Date.now();
        const idx = typeof ev.__idx === "number" ? ev.__idx : i;
        const type = Number.isFinite(ev.type) ? Number(ev.type) : 0;
        const r = await client.query(insertOne, [
          sessionDbId,
          idx,
          ts,
          type,
          JSON.stringify(ev),
        ]);
        stored += r.rowCount || 0;
      }

      await client.query("COMMIT");
      return res.status(201).json({ stored });
    } catch (e) {
      await client.query("ROLLBACK");
      console.error(e);
      return res.status(500).json({ error: "insert_failed" });
    } finally {
      client.release();
    }
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "server_error" });
  }
});

app.get("/rrweb/sessions/:externalId/events", async (req, res) => {
  const externalId = req.params.externalId;
  const limit = Math.min(parseInt(req.query.limit || "1000", 10), 5000);
  const q =
    "select e.ts_ms, e.type, e.data, e.created_at\n" +
    "from sessions s\n" +
    "join events e on e.session_id = s.id\n" +
    "where s.external_id = $1\n" +
    "order by e.ts_ms asc\n" +
    "limit $2";
  const { rows } = await pool.query(q, [externalId, limit]);
  res.json(rows);
});

const port = process.env.PORT || 3000;
const httpsPort = process.env.HTTPS_PORT || 3443;

// Function to start HTTPS server
function startHttpsServer() {
  try {
    // Try to load SSL certificates
    const privateKey = fs.readFileSync(
      process.env.SSL_KEY_PATH || "/etc/ssl/private/server.key",
      "utf8"
    );
    const certificate = fs.readFileSync(
      process.env.SSL_CERT_PATH || "/etc/ssl/certs/server.crt",
      "utf8"
    );

    const credentials = {
      key: privateKey,
      cert: certificate,
      // Modern TLS configuration
      secureProtocol: "TLSv1_2_method",
      ciphers: [
        "ECDHE-RSA-AES128-GCM-SHA256",
        "ECDHE-RSA-AES256-GCM-SHA384",
        "ECDHE-RSA-AES128-SHA256",
        "ECDHE-RSA-AES256-SHA384",
        "!aNULL",
        "!eNULL",
        "!EXPORT",
        "!DES",
        "!RC4",
        "!MD5",
        "!PSK",
        "!SRP",
        "!CAMELLIA",
      ].join(":"),
      honorCipherOrder: true,
    };

    const httpsServer = https.createServer(credentials, app);

    httpsServer.listen(httpsPort, () => {
      console.log(`HTTPS Server listening on port ${httpsPort}`);
      console.log(`SSL/TLS enabled with modern cipher suites`);
    });

    httpsServer.on("error", (err) => {
      console.error("HTTPS Server error:", err);
    });
  } catch (error) {
    console.warn(
      "SSL certificates not found, starting HTTP server only:",
      error.message
    );
    startHttpServer();
  }
}

// Function to start HTTP server
function startHttpServer() {
  app.listen(port, () => {
    console.log(`HTTP Server listening on port ${port}`);
  });
}

// Start servers based on environment
if (
  process.env.NODE_ENV === "production" &&
  process.env.ENABLE_HTTPS !== "false"
) {
  startHttpsServer();
  // Also start HTTP server for fallback
  startHttpServer();
} else {
  startHttpServer();
}
