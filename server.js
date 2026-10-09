"use strict";
const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function createPool(url) {
  return new Pool({
    connectionString: url,
    // Render's external URL needs SSL; the internal URL does not. Set DATABASE_SSL=true for external.
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
}

function createApp(pool, allowedOrigins) {
  const app = express();
  app.set("trust proxy", 1); // Render sits behind a proxy; needed for rate limiting only (IPs are never stored)
  app.disable("x-powered-by");
  app.use(helmet());

  app.use(
    cors({
      origin(origin, cb) {
        // Allow listed origins; requests with no Origin (curl, health checks) are allowed through.
        if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ["GET", "POST"],
      maxAge: 86400,
    })
  );

  app.use(express.json({ limit: "1kb" }));

  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: true,
    legacyHeaders: false,
  });
  const visitLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
  });

  const counts = async () => {
    const r = (await pool.query(
      `SELECT COUNT(*) AS total,
              COUNT(*) FILTER (WHERE last_seen > now() - interval '24 hours') AS d1,
              COUNT(*) FILTER (WHERE last_seen > now() - interval '7 days') AS d7
       FROM visitors`
    )).rows[0];
    return { uniqueVisits: Number(r.total), last24Hours: Number(r.d1), last7Days: Number(r.d7) };
  };

  app.get("/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res.status(503).json({ status: "unavailable" });
    }
  });

  app.post("/api/visit", visitLimiter, async (req, res) => {
    const id = req.body && req.body.visitorId;
    if (typeof id !== "string" || !UUID_RE.test(id)) {
      return res.status(400).json({ error: "Invalid visitorId" });
    }
    try {
      // Primary key guarantees uniqueness even under concurrent requests.
      const r = await pool.query(
        "INSERT INTO visitors (visitor_id) VALUES ($1) ON CONFLICT (visitor_id) DO UPDATE SET last_seen = now() RETURNING (xmax = 0) AS inserted",
        [id.toLowerCase()]
      );
      res.json({ ...(await counts()), isNew: r.rows[0].inserted });
    } catch (e) {
      console.error("visit error:", e.message);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.get("/api/visits", limiter, async (_req, res) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await counts());
    } catch (e) {
      console.error("visits error:", e.message);
      res.status(500).json({ error: "Server error" });
    }
  });

  app.use((_req, res) => res.status(404).json({ error: "Not found" }));
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.too.large") return res.status(413).json({ error: "Too large" });
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Bad JSON" });
    res.status(500).json({ error: "Server error" });
  });

  return app;
}

async function initSchema(pool) {
  await pool.query(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
}

async function main() {
  require("dotenv").config();
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const origins = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (!origins.length) throw new Error("ALLOWED_ORIGINS is required");

  const pool = createPool(process.env.DATABASE_URL);
  await initSchema(pool);
  const port = process.env.PORT || 3000;
  createApp(pool, origins).listen(port, () => console.log(`Listening on ${port}`));
}

module.exports = { createApp, createPool, initSchema };

if (require.main === module) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
