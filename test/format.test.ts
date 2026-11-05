import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildJobMessage,
  buildKeyboard,
  extractExperience,
  extractRequirements,
  extractSummary,
  timeAgo,
} from "../src/format.js";
import { fixMojibake, stripHtml } from "../src/sources/types.js";
import { DEFAULT_STACK } from "../src/stack.js";
import type { JobRow } from "../src/types.js";

const html = `<p>Acme builds tools for remote teams across the world. We are growing fast and love open source.</p>
<h3>Requirements</h3><ul><li>3+ years of experience with React &amp; TypeScript</li><li>Strong Node.js skills</li><li>Good English</li></ul>
<h3>Benefits</h3><ul><li>Unlimited PTO</li></ul>`;

const job: JobRow = {
  id: 7,
  source: "Himalayas",
  url: "https://x.test/job?a=1&b=2",
  title: "React <Engineer>",
  company: "Acme & Co",
  description: stripHtml(html),
  score: 14,
  reason: "+4 react (título), +2 remote",
  notified: false,
  status: "new",
  location: "Worldwide",
  seniority: "Mid-level",
  employment_type: "Full Time",
  tags: ["frontend"],
  posted_at: new Date(Date.now() - 3 * 3600_000).toISOString(),
  created_at: new Date().toISOString(),
  salary_text: "USD 60,000–84,000 /year",
  salary_min_usd: 60000,
  salary_max_usd: 84000,
};

test("stripHtml conserva viñetas y decodifica entidades", () => {
  const t = stripHtml(html);
  assert.ok(t.includes("• 3+ years of experience with React & TypeScript"));
  assert.ok(t.split("\n").length > 4);
});

test("extractRequirements toma solo la sección de requisitos", () => {
  const reqs = extractRequirements(stripHtml(html));
  assert.equal(reqs.length, 3);
  assert.ok(reqs[0].startsWith("3+ years"));
  assert.ok(!reqs.join(" ").includes("PTO"));
});

test("extractSummary no incluye encabezados y respeta el máximo", () => {
  const s = extractSummary(stripHtml(html));
  assert.ok(s.startsWith("Acme builds"));
  assert.ok(extractSummary("Lorem ipsum dolor sit amet. ".repeat(40), 100).length <= 101);
});

test("extractExperience", () => {
  assert.equal(extractExperience("3+ years of experience with React"), "3+ años");
  assert.equal(extractExperience("no mention"), "");
});

test("timeAgo", () => {
  const now = Date.now();
  assert.equal(timeAgo(new Date(now - 5 * 60_000).toISOString(), now), "hace 5 min");
  assert.equal(timeAgo(new Date(now - 3 * 3600_000).toISOString(), now), "hace 3 h");
  assert.equal(timeAgo(new Date(now - 5 * 86400_000).toISOString(), now), "hace 5 d");
  assert.equal(timeAgo(null), "");
});

test("buildJobMessage: contenido completo, HTML escapado y < 4096", () => {
  const msg = buildJobMessage(job, DEFAULT_STACK);
  console.log("\n" + msg + "\n");
  assert.ok(msg.includes("React &lt;Engineer&gt;"));
  assert.ok(msg.includes("Acme &amp; Co"));
  assert.ok(msg.includes("$5,000–$7,000 USD/mes"));
  assert.ok(msg.includes("✅ React"));
  assert.ok(msg.includes("📋 <b>Requisitos:</b>"));
  assert.ok(msg.includes("🎓 3+ años"));
  assert.ok(msg.length < 4096);
});

test("buildJobMessage: sin sueldo ni datos extra no revienta", () => {
  const bare: JobRow = {
    ...job,
    salary_min_usd: null,
    salary_max_usd: null,
    salary_text: null,
    location: null,
    seniority: null,
    employment_type: null,
    tags: null,
    posted_at: null,
    description: "",
    reason: "",
  };
  assert.ok(buildJobMessage(bare, DEFAULT_STACK).includes("Sueldo no publicado"));
});

test("buildKeyboard marca el estado actual", () => {
  const kb = buildKeyboard({ id: 7, url: "https://x.test", status: "saved" });
  assert.equal(kb.inline_keyboard[1][0].text, "⭐ Guardada ✓");
  assert.deepEqual(kb.inline_keyboard[1][1], { text: "✅ Apliqué", callback_data: "a:7" });
});

test("stripHtml: HTML doble-codificado (WWR) y URLs fuera", () => {
  const t = stripHtml(
    "&lt;p&gt;&lt;strong&gt;Headquarters:&lt;/strong&gt; Spain&lt;/p&gt;&lt;img src=&quot;https://cdn.imgix.net/logo.gif&quot;&gt;&lt;p&gt;Build things&lt;/p&gt;",
  );
  assert.ok(!t.includes("<") && !t.includes("&lt;"), t);
  assert.ok(!t.includes("imgix"), t);
  assert.ok(t.includes("Headquarters: Spain"));
  assert.equal(stripHtml("Tom &amp; Jerry &#39;s &quot;x&quot;"), "Tom & Jerry 's \"x\"");
});

test("fixMojibake repara UTF-8 mal leído y no toca texto sano", () => {
  const broken = Buffer.from("Ciudad de México – ñandú", "utf8").toString("latin1");
  assert.equal(fixMojibake(broken), "Ciudad de México – ñandú");
  assert.equal(fixMojibake("Ciudad de México"), "Ciudad de México");
  assert.equal(fixMojibake("Plain ASCII text"), "Plain ASCII text");
  assert.equal(fixMojibake("Já é €5"), "Já é €5"); // trae chars > 0xFF: no se toca
});
