/**
 * BM25 Okapi Scorer for pattern search
 * Standalone implementation — zero external dependencies
 *
 * Based on Okapi BM25 with Robertson-Walker IDF smoothing.
 * References:
 *   - AWS rankBm25.ts (Apache-2.0)
 *   - mem0 bm25.ts (MIT)
 *   - Okapi BM25: https://en.wikipedia.org/wiki/Okapi_BM25
 */

export interface BM25Config {
  /** Term frequency saturation parameter (default: 1.2) */
  k1: number;
  /** Document length normalization parameter (default: 0.75) */
  b: number;
}

export interface BM25Document {
  id: string;
  text: string;
}

export interface BM25ScoreResult {
  id: string;
  score: number;
}

const DEFAULT_BM25_CONFIG: BM25Config = {
  k1: 1.2,
  b: 0.75,
};

/**
 * Function words excluded from both the index and the query.
 *
 * `tokenize` already drops words of 2 characters or fewer, which leaves "one",
 * "all", "need", "from", "this" and friends in the index. They carry almost no
 * IDF, so they barely move a BM25 score — but they DO satisfy the substring
 * checks in `generateKeywordReasons`, which is how a search for "prevent ONE
 * failing dependency" came back with `Prompt Chaining` at 85% and the rationale
 * `Pattern description mentions "one"`.
 *
 * Deliberately contains no design-pattern vocabulary: state, command, chain,
 * proxy, bridge, facade, builder, visitor, template, strategy, observer,
 * factory, adapter, single/singleton, block and composite are all absent, and
 * must stay absent.
 */
export const BM25_STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'not', 'you', 'all', 'any', 'are', 'was', 'were',
  'has', 'have', 'had', 'its', 'his', 'her', 'our', 'their', 'they', 'them',
  'this', 'that', 'these', 'those', 'with', 'from', 'into', 'onto', 'over',
  'under', 'then', 'than', 'when', 'where', 'what', 'which', 'who', 'whom',
  'why', 'how', 'can', 'could', 'will', 'would', 'should', 'shall', 'may',
  'might', 'must', 'does', 'did', 'done', 'being', 'been', 'get', 'got',
  'one', 'two', 'some', 'such', 'only', 'own', 'same', 'too', 'very', 'just',
  'also', 'about', 'after', 'before', 'again', 'once', 'here', 'there', 'out',
  'off', 'down', 'more', 'most', 'other', 'need', 'needs', 'want', 'wants',
  'make', 'makes', 'made', 'use', 'uses', 'used', 'using', 'way', 'ways',
  'thing', 'things', 'something', 'anything', 'everything', 'nothing',
  'without', 'within', 'between', 'through', 'during', 'above', 'below',
  'because', 'while', 'both', 'each', 'few', 'many', 'much', 'well', 'back',
  'even', 'still', 'like', 'want', 'lot', 'per', 'via', 'yet', 'now',
]);

export class BM25Scorer {
  private readonly k1: number;
  private readonly b: number;
  private readonly corpusSize: number;
  private readonly avgDocLength: number;
  private readonly idf: Map<string, number> = new Map();
  private readonly docLengths: number[] = [];
  private readonly documents: BM25Document[];
  private readonly tokenCache: Map<number, string[]> = new Map();

  constructor(
    documents: BM25Document[],
    config?: Partial<BM25Config>
  ) {
    this.k1 = config?.k1 ?? DEFAULT_BM25_CONFIG.k1;
    this.b = config?.b ?? DEFAULT_BM25_CONFIG.b;
    this.documents = documents;
    this.corpusSize = documents.length;

    // Compute document lengths
    for (let i = 0; i < documents.length; i++) {
      const tokens = this.tokenize(documents[i].text);
      this.tokenCache.set(i, tokens);
      this.docLengths.push(tokens.length);
    }

    // Average document length
    this.avgDocLength =
      this.docLengths.reduce((a, b) => a + b, 0) / (this.corpusSize || 1);

    // Compute document frequency for each term
    const docFreqs = new Map<string, number>();
    for (const docTokens of this.tokenCache.values()) {
      const uniqueTerms = new Set(docTokens);
      for (const term of uniqueTerms) {
        docFreqs.set(term, (docFreqs.get(term) ?? 0) + 1);
      }
    }

    // Compute IDF for each term (Robertson-Walker smoothing)
    for (const [term, df] of docFreqs) {
      this.idf.set(
        term,
        Math.log((this.corpusSize - df + 0.5) / (df + 0.5) + 1)
      );
    }
  }

  /**
   * Score a query against all documents.
   * Returns results sorted by score descending.
   */
  scoreQuery(query: string): BM25ScoreResult[] {
    const queryTokens = this.tokenize(query);
    const results: BM25ScoreResult[] = [];

    for (let i = 0; i < this.documents.length; i++) {
      const score = this.scoreDocumentTokens(queryTokens, i);
      results.push({ id: this.documents[i].id, score });
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /**
   * Score a query against a single document by index.
   */
  scoreDocumentByIndex(query: string, docIndex: number): number {
    const queryTokens = this.tokenize(query);
    return this.scoreDocumentTokens(queryTokens, docIndex);
  }

  /**
   * Normalize raw BM25 scores to 0-1 range using min-max per query.
   */
  normalizeScores(results: BM25ScoreResult[]): Array<{ id: string; normalized: number }> {
    if (results.length === 0) return [];

    const rawScores = results.map((r) => r.score);
    const min = Math.min(...rawScores);
    const max = Math.max(...rawScores);
    const range = max - min;

    // Single result or all identical scores: it's the best by definition
    if (range === 0) {
      return results.map((r) => ({
        id: r.id,
        normalized: 1.0,
      }));
    }

    return results.map((r) => ({
      id: r.id,
      normalized: (r.score - min) / range,
    }));
  }

  /**
   * The largest score this query could possibly achieve.
   *
   * A term's BM25 contribution is `idf * tfNorm`, and tfNorm saturates at
   * `k1 + 1` as tf grows. So the ceiling is `Σ idf(t) * (k1 + 1)` over the
   * query's distinct known terms. Unknown terms contribute nothing, which is
   * correct: a query of pure gibberish has a ceiling of 0 and cannot be
   * "matched well".
   */
  queryCeiling(query: string): number {
    const seen = new Set(this.tokenize(query));
    let ceiling = 0;
    for (const token of seen) {
      ceiling += (this.idf.get(token) ?? 0) * (this.k1 + 1);
    }
    return ceiling;
  }

  /**
   * Normalize raw BM25 scores against what this query could have scored,
   * rather than against the best result that happened to come back.
   *
   * WHY THIS EXISTS
   * ---------------
   * `normalizeScores` is min-max over the result set, and `scoreQuery` returns
   * every document in the corpus — so the minimum is ~0 and the maximum is
   * whatever ranked first. The top hit therefore normalizes to 1.0 for EVERY
   * query, however weak the underlying match. Downstream that value is used as
   * a confidence and blended against real cosine similarities (0.4-0.55), so
   * the lexical channel won every comparison by construction.
   *
   * Measured before this change, "prevent one failing downstream dependency
   * from exhausting all my threads" returned `Dependency Injection` at 99%
   * ("name contains dependency") while Bulkhead — the correct answer, and
   * present in the corpus — did not appear at all.
   *
   * Dividing by `queryCeiling` makes the number absolute and comparable across
   * queries: it answers "how much of what this query asked for did this
   * document actually contain, weighted by how informative each term was".
   * A weak best-match now scores like a weak match instead of like certainty.
   *
   * `normalizeScores` is left untouched — it is still the right tool where a
   * pure within-set ranking is wanted, and its tests pin that behaviour.
   */
  normalizeScoresAbsolute(
    results: BM25ScoreResult[],
    query: string
  ): Array<{ id: string; normalized: number }> {
    if (results.length === 0) return [];

    const ceiling = this.queryCeiling(query);
    if (ceiling <= 0) {
      return results.map((r) => ({ id: r.id, normalized: 0 }));
    }

    return results.map((r) => ({
      id: r.id,
      normalized: Math.min(Math.max(r.score / ceiling, 0), 1),
    }));
  }

  /**
   * Get corpus statistics for diagnostics.
   */
  getStats(): {
    corpusSize: number;
    avgDocLength: number;
    uniqueTerms: number;
  } {
    return {
      corpusSize: this.corpusSize,
      avgDocLength: this.avgDocLength,
      uniqueTerms: this.idf.size,
    };
  }

  // --- Private helpers ---

  private scoreDocumentTokens(queryTokens: string[], docIndex: number): number {
    const docTokens = this.tokenCache.get(docIndex) ?? [];
    const termFreqs = this.computeTF(docTokens);
    const docLen = this.docLengths[docIndex];
    let score = 0;

    for (const token of queryTokens) {
      const idf = this.idf.get(token) ?? 0;
      const tf = termFreqs.get(token) ?? 0;

      // BM25 TF normalization
      const tfNorm =
        (tf * (this.k1 + 1)) /
        (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength)));

      score += idf * tfNorm;
    }

    return score;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !BM25_STOPWORDS.has(w));
  }

  private computeTF(tokens: string[]): Map<string, number> {
    const freq = new Map<string, number>();
    for (const t of tokens) {
      freq.set(t, (freq.get(t) ?? 0) + 1);
    }
    return freq;
  }
}
