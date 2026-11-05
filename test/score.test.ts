import assert from "node:assert/strict";
import { test } from "node:test";
import { BLOCKED_SCORE, DEFAULT_CONTEXT, score, storedScore } from "../src/score.js";
import { DEFAULT_STACK, detectTech, inUserStack, patternFromTerms } from "../src/stack.js";

test("stack por defecto puntúa y el título suma extra", () => {
  const inTitle = score("React Developer", "We use typescript and tailwind. Remote worldwide.");
  const inDesc = score("Developer", "We use react, typescript and tailwind. Remote worldwide.");
  assert.ok(inTitle.total > inDesc.total);
  assert.ok(inTitle.hits.some((h) => h.includes("react (título)")));
  assert.equal(inTitle.eligible, true);
});

test("senior solo penaliza en el título", () => {
  assert.ok(score("Senior React Engineer", "").hits.some((h) => h.includes("senior+")));
  assert.ok(
    !score("React Engineer", "You will work with senior engineers").hits.some((h) =>
      h.includes("senior+"),
    ),
  );
});

test("otro stack penaliza una sola vez y no confunde JavaScript con Java", () => {
  const r = score("Developer", "PHP, Java and Ruby");
  assert.equal(r.hits.filter((h) => h.includes("otro stack")).length, 1);
  assert.ok(!score("Developer", "We love JavaScript").hits.some((h) => h.includes("otro stack")));
});

test("US only queda bloqueada y se guarda con score -99", () => {
  const r = score("React Developer", "Remote, US only. React next.js typescript");
  assert.equal(r.eligible, false);
  assert.equal(r.status, "rejected");
  assert.equal(storedScore(r), BLOCKED_SCORE);
});

test("ubicación estructurada: restringida bloquea, abierta no, y se puede apagar", () => {
  const loc = (l: string, ctx = DEFAULT_CONTEXT) => score("React Dev", "react", ctx, l).eligible;
  assert.equal(loc("United States"), false);
  assert.equal(loc("Germany, France"), false);
  assert.equal(loc("Worldwide"), true);
  assert.equal(loc("Anywhere in the World"), true);
  assert.equal(loc("Americas"), true);
  assert.equal(loc(""), true);
  assert.equal(loc("United States", { ...DEFAULT_CONTEXT, strictLocation: false }), true);
});

test("stack personalizado con alias", () => {
  const ctx = {
    ...DEFAULT_CONTEXT,
    stack: [
      ...DEFAULT_STACK,
      { name: "nestjs", weight: 3, pattern: patternFromTerms(["nestjs", "nest.js"]) },
    ],
  };
  assert.ok(score("Backend", "We use Nest.js daily", ctx).hits.some((h) => h.includes("nestjs")));
  assert.ok(score("Backend", "We use NestJS daily", ctx).hits.some((h) => h.includes("nestjs")));
  assert.ok(!score("Backend", "We use NestJS daily").hits.some((h) => h.includes("nestjs")));
});

test("evitar con alias y términos especiales", () => {
  const ctx = { ...DEFAULT_CONTEXT, avoid: ["c++", "vue|vuejs"] };
  assert.ok(score("Dev", "Strong C++ skills", ctx).hits.some((h) => h.includes("c++")));
  assert.ok(score("Dev", "Vue.js experience", ctx).hits.some((h) => h.includes("vue")));
  assert.ok(!score("Dev", "experience with react", ctx).hits.some((h) => h.includes("otro stack")));
});

test("detectTech ordena título primero y marca tu stack", () => {
  const tech = detectTech("React Engineer", "Node.js, AWS, Docker, PostgreSQL. Also react.");
  assert.equal(tech[0], "React");
  assert.ok(tech.includes("Node.js") && tech.includes("AWS") && tech.includes("PostgreSQL"));
  assert.ok(!detectTech("Dev", "the rest of the team").includes("REST"));
  assert.equal(inUserStack("React", DEFAULT_STACK), true);
  assert.equal(inUserStack("Next.js", DEFAULT_STACK), true);
  assert.equal(inUserStack("Python", DEFAULT_STACK), false);
});

test("detectTech: sin falsos positivos típicos", () => {
  assert.ok(!detectTech("Dev", "We are the financial rails of healthcare").includes("Rails"));
  assert.ok(detectTech("Dev", "Ruby on Rails and React").includes("Rails"));
  assert.ok(!detectTech("Dev", "logo at cdn.imgix.net/a.gif").includes(".NET"));
  assert.ok(detectTech("Dev", "C#/.NET and ASP.NET Core").includes(".NET"));
  assert.ok(detectTech("Dev", "Strong Go (golang) skills").includes("Go"));
});

test("evitar .NET por defecto cubre ASP.NET y dotnet", () => {
  assert.ok(score("Dev", "We build with ASP.NET Core").hits.some((h) => h.includes("otro stack")));
  assert.ok(score("Dev", "dotnet shop").hits.some((h) => h.includes("otro stack")));
  assert.ok(!score("Dev", "see imgix.net logos").hits.some((h) => h.includes("otro stack")));
});
