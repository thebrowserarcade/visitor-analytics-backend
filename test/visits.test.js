"use strict";
// Needs a real Postgres. Set TEST_DATABASE_URL (use a throwaway database; the visitors table is emptied).
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { randomUUID } = require("node:crypto");
const { createApp, createPool, initSchema } = require("../server");

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : "TEST_DATABASE_URL not set" };
const ORIGIN = "https://thebrowserarcade.github.io";
let pool, server, base;

before(async () => {
  if (!url) return;
  pool = createPool(url);
  await initSchema(pool);
  await pool.query("TRUNCATE visitors");
  server = createApp(pool, [ORIGIN]).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) server.close();
  if (pool) await pool.end();
});

const post = (body) =>
  fetch(base + "/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const total = async () => (await (await fetch(base + "/api/visits")).json()).uniqueVisits;

test("duplicate visits do not inflate the count", opts, async () => {
  const id = randomUUID();
  const first = await (await post({ visitorId: id })).json();
  const second = await (await post({ visitorId: id })).json();
  assert.strictEqual(first.isNew, true);
  assert.strictEqual(second.isNew, false);
  assert.strictEqual(await total(), 1);
});

test("concurrent requests with the same ID count once", opts, async () => {
  const id = randomUUID();
  await Promise.all(Array.from({ length: 5 }, () => post({ visitorId: id })));
  assert.strictEqual(await total(), 2);
});

test("invalid IDs are rejected", opts, async () => {
  assert.strictEqual((await post({ visitorId: "nope" })).status, 400);
  assert.strictEqual((await post({})).status, 400);
});

test("health works", opts, async () => {
  assert.strictEqual((await fetch(base + "/health")).status, 200);
});
