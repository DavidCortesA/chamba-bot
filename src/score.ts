const RULES: [RegExp, number, string][] = [
  [/\breact\b/i, 3, "react"],
  [/next\.?js/i, 3, "next.js"],
  [/typescript/i, 2, "typescript"],
  [/react native|expo/i, 2, "react native"],
  [/front-?end/i, 2, "frontend"],
  [/tailwind/i, 1, "tailwind"],
  [/supabase|graphql/i, 1, "supabase/graphql"],
  [/remote|latam|latin america|worldwide|anywhere/i, 2, "remote/latam"],
  // restas
  [/\b(senior|sr\.?|lead|staff|principal|head)\b/i, -2, "senior+"],
  [/\b(php|java|\.net|ruby|django|angular|vue|wordpress|salesforce)\b/i, -3, "otro stack"],
  [/us only|usa only|u\.s\. only|us citizens|must reside in the us|united states only/i, -5, "solo US"],
];

export function score(title: string, desc = "") {
  // El título pesa doble
  const text = `${title} ${title} ${desc}`;
  let total = 0;
  const hits: string[] = [];
  for (const [re, pts, label] of RULES) {
    if (re.test(text)) {
      total += pts;
      hits.push(`${pts > 0 ? "+" : ""}${pts} ${label}`);
    }
  }
  return { total, reason: hits.join(", ") };
}