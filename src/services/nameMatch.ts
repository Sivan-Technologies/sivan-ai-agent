export type NameMatchLevel = "strong" | "medium" | "weak" | "failed";

export interface NameMatchDecision {
  score: number;
  level: NameMatchLevel;
  acceptable: boolean;
}

const COMMON_TITLES = new Set(["mr", "mrs", "miss", "ms", "dr", "prof", "chief", "alhaji", "hajia"]);

function normalizeName(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !COMMON_TITLES.has(token));
}

function levenshtein(a: string, b: string) {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
}

function tokenSimilarity(a: string, b: string) {
  if (a === b) return 1;
  if (a.length === 1 && b.startsWith(a)) return 0.86;
  if (b.length === 1 && a.startsWith(b)) return 0.86;
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 0;
  return Math.max(0, 1 - levenshtein(a, b) / maxLength);
}

function levelForScore(score: number): NameMatchLevel {
  if (score >= 95) return "strong";
  if (score >= 80) return "medium";
  if (score >= 55) return "weak";
  return "failed";
}

export function scoreAccountName(profileName: string, resolvedAccountName: string): NameMatchDecision {
  const profileTokens = normalizeName(profileName);
  const resolvedTokens = normalizeName(resolvedAccountName);

  if (profileTokens.length === 0 || resolvedTokens.length === 0) {
    return { score: 0, level: "failed", acceptable: false };
  }

  const exactProfile = profileTokens.join(" ");
  const exactResolved = resolvedTokens.join(" ");
  if (exactProfile === exactResolved) {
    return { score: 100, level: "strong", acceptable: true };
  }

  const perTokenScores = profileTokens.map((profileToken) => {
    return Math.max(...resolvedTokens.map((resolvedToken) => tokenSimilarity(profileToken, resolvedToken)));
  });
  const average = perTokenScores.reduce((sum, score) => sum + score, 0) / perTokenScores.length;
  const allProfileTokensPresent = profileTokens.every((token) => resolvedTokens.includes(token));
  const hasExtraResolvedTokens = resolvedTokens.length > profileTokens.length;

  let score = Math.round(average * 100);
  if (allProfileTokensPresent && hasExtraResolvedTokens) score = Math.max(score, 88);
  if (allProfileTokensPresent && !hasExtraResolvedTokens) score = Math.max(score, 95);

  const level = levelForScore(score);
  return { score, level, acceptable: level === "strong" || level === "medium" };
}
