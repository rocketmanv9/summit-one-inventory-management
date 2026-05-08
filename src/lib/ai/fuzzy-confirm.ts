/**
 * Fuzzy Confirmation — tolerant yes/no matching for AI chat flows.
 * Handles typos, casual phrasing, and Levenshtein distance=1 from "yes"/"confirm".
 */

const CONFIRM_SET = new Set([
  'yes', 'y', 'yep', 'yeah', 'yea', 'ya', 'sure', 'ok', 'confirm',
  'confirmed', 'go', 'proceed', 'do it', 'go ahead', 'correct',
  'approved', 'please', 'sounds good',
]);

const CANCEL_SET = new Set([
  'no', 'n', 'cancel', 'abort', 'stop', 'nevermind', 'never mind',
  'nope', 'nah', 'dont', "don't",
]);

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[m][n];
}

export function isFuzzyConfirm(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  if (CONFIRM_SET.has(normalized)) return true;
  // Levenshtein distance=1 from common confirm words
  for (const word of ['yes', 'confirm']) {
    if (levenshtein(normalized, word) <= 1) return true;
  }
  return false;
}

export function isFuzzyCancel(input: string): boolean {
  const normalized = input.toLowerCase().trim();
  return CANCEL_SET.has(normalized);
}
