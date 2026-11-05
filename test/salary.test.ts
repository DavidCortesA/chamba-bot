import assert from "node:assert/strict";
import { test } from "node:test";
import { formatAnnualRange, parseSalaryArg, parseSalaryText, toAnnualUsd } from "../src/salary.js";

test("parseSalaryText: rangos con k y periodo", () => {
  assert.deepEqual(parseSalaryText("Pay: $80k - $100k per year"), {
    min: 80000,
    max: 100000,
    currency: "USD",
    period: "year",
  });
  assert.deepEqual(parseSalaryText("USD 5,000 – 7,000 per month"), {
    min: 5000,
    max: 7000,
    currency: "USD",
    period: "month",
  });
  assert.deepEqual(parseSalaryText("$80-100k"), { min: 80000, max: 100000, currency: "USD", period: "year" });
  assert.equal(parseSalaryText("€60.000 - 80.000")?.currency, "EUR");
  assert.equal(parseSalaryText("€60.000 - 80.000")?.min, 60000);
});

test("parseSalaryText: periodo explícito y sin periodo", () => {
  assert.equal(parseSalaryText("$50 - $70 /hr")?.period, "hour");
  assert.equal(parseSalaryText("$40/hour")?.min, 40);
  assert.equal(parseSalaryText("$3,000 - $5,000")?.period, "month"); // heurística
});

test("parseSalaryText: ignora falsos positivos", () => {
  assert.equal(parseSalaryText("3-5 years of experience"), null);
  assert.equal(parseSalaryText("raised $5-10M in funding"), null);
  assert.equal(parseSalaryText("Competitive salary"), null);
  assert.equal(parseSalaryText("we pay $500 stipend"), null);
});

test("toAnnualUsd normaliza periodos y monedas", () => {
  assert.deepEqual(toAnnualUsd({ min: 5000, max: 7000, currency: "USD", period: "month" }), {
    min: 60000,
    max: 84000,
  });
  assert.deepEqual(toAnnualUsd({ min: 50, max: 60, currency: "USD", period: "hour" }), {
    min: 104000,
    max: 124800,
  });
  assert.equal(toAnnualUsd({ min: 0, max: 0, currency: "USD", period: "year" }), null);
  assert.equal(toAnnualUsd({ min: 1, max: 2, currency: "USD", period: "year" }), null);
  assert.equal(toAnnualUsd({ min: 60000, max: null, currency: "XXX", period: "year" }), null);
});

test("parseSalaryArg: mensual por defecto, anual con palabra clave", () => {
  assert.deepEqual(parseSalaryArg("3000-6000")?.range, { minAnnual: 36000, maxAnnual: 72000 });
  assert.deepEqual(parseSalaryArg("3k-6k")?.range, { minAnnual: 36000, maxAnnual: 72000 });
  assert.deepEqual(parseSalaryArg("4000+")?.range, { minAnnual: 48000, maxAnnual: null });
  assert.deepEqual(parseSalaryArg("40k-80k anual")?.range, { minAnnual: 40000, maxAnnual: 80000 });
  assert.deepEqual(parseSalaryArg("6000-3000")?.range, { minAnnual: 36000, maxAnnual: 72000 });
  assert.equal(parseSalaryArg("3000"), null); // un número suelto no cuenta por defecto
  assert.deepEqual(parseSalaryArg("3000", { allowBare: true })?.range, { minAnnual: 36000, maxAnnual: null });
});

test("parseSalaryArg: separa el texto de búsqueda", () => {
  const r = parseSalaryArg("react 3000-6000 usd");
  assert.equal(r?.rest, "react");
  assert.equal(parseSalaryArg("react senior"), null);
});

test("formatAnnualRange", () => {
  assert.equal(formatAnnualRange(60000, 84000), "$5,000–$7,000 USD/mes (≈ $60k–$84k/año)");
  assert.equal(formatAnnualRange(48000, null), "desde $4,000 USD/mes (≈ desde $48k/año)");
  assert.equal(formatAnnualRange(null, null), "");
});
