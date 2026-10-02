/**
 * Tests for Search Handlers
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { HybridSearchCombiner, DynamicAlphaTuner } from '../../src/handlers/hybrid-search-combiner.js';
import type { MatchResult, DynamicAlphaResult } from '../../src/types/search-types.js';

describe('DynamicAlphaTuner', () => {
  let tuner: DynamicAlphaTuner;

  beforeEach(() => {
    tuner = new DynamicAlphaTuner();
  });

  describe('calculateAlpha', () => {
    it('should return balanced weights for generic queries', () => {
      const result = tuner.calculateAlpha('find patterns');
      expect(result.semanticAlpha).toBeGreaterThan(0);
      expect(result.keywordAlpha).toBeGreaterThan(0);
      expect(result.semanticAlpha + result.keywordAlpha).toBeCloseTo(1, 1);
    });

    it('should favor keyword search for short specific queries', () => {
      const result = tuner.calculateAlpha('implement factory');
      expect(result.queryType).toBe('specific');
      expect(result.keywordAlpha).toBeGreaterThanOrEqual(result.semanticAlpha);
    });

    it('should favor semantic search for long exploratory queries', () => {
      const result = tuner.calculateAlpha(
        'how can I best understand the strategy pattern for my application'
      );
      expect(result.queryType).toBe('exploratory');
      expect(result.semanticAlpha).toBeGreaterThanOrEqual(result.keywordAlpha);
    });

    it('should detect technical terms', () => {
      const result = tuner.calculateAlpha('factory pattern singleton design');
      expect(result.analysis.technicalTermCount).toBeGreaterThan(0);
    });

    it('should detect code snippets', () => {
      const result = tuner.calculateAlpha('pattern with `interface{}` syntax');
      expect(result.analysis.hasCodeSnippet).toBe(true);
    });

    it('should adjust for very long queries', () => {
      const longQuery =
        'I need to understand how design patterns can help me structure my application ' +
        'in a way that promotes maintainability and testability while also being flexible ' +
        'enough to adapt to changing requirements over time';
      const result = tuner.calculateAlpha(longQuery);
      expect(result.semanticAlpha).toBeGreaterThan(0.5);
    });

    it('should adjust for very short queries', () => {
      const result = tuner.calculateAlpha('factory');
      expect(result.keywordAlpha).toBeGreaterThanOrEqual(0.5);
    });

    it('should return confidence level', () => {
      const result = tuner.calculateAlpha('strategy pattern');
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('should include analysis metadata', () => {
      const result = tuner.calculateAlpha('test query');
      expect(result.analysis).toBeDefined();
      expect(result.analysis.queryLength).toBe(10);
      expect(result.analysis.wordCount).toBe(2);
    });
  });
});

describe('HybridSearchCombiner', () => {
  let combiner: HybridSearchCombiner;

  beforeEach(() => {
    combiner = new HybridSearchCombiner();
  });

  describe('calculateAlpha', () => {
    it('should delegate to DynamicAlphaTuner', () => {
      const result = combiner.calculateAlpha('test query');
      expect(result).toHaveProperty('semanticAlpha');
      expect(result).toHaveProperty('keywordAlpha');
      expect(result).toHaveProperty('queryType');
    });
  });

  describe('applySemanticWeight', () => {
    it('should apply weight to semantic matches', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 0.8,
          matchType: 'semantic',
          reasons: ['Test reason'],
          metadata: { semanticScore: 0.8, finalScore: 0.8 },
        },
      ];

      const weighted = combiner.applySemanticWeight(matches, 0.7);

      expect(weighted[0].confidence).toBeCloseTo(0.56, 2);
      expect(weighted[0].metadata.finalScore).toBeCloseTo(0.56, 2);
    });
  });

  describe('applyKeywordWeight', () => {
    it('should apply weight to keyword matches', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 0.6,
          matchType: 'keyword',
          reasons: ['Test reason'],
          metadata: { keywordScore: 6, finalScore: 0.6 },
        },
      ];

      const weighted = combiner.applyKeywordWeight(matches, 0.3);

      expect(weighted[0].confidence).toBeCloseTo(0.18, 2);
    });
  });

  describe('combineMatches', () => {
    it('should combine semantic and keyword matches for the same pattern', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Factory', category: 'Creational', description: 'Desc' },
          confidence: 0.8,
          matchType: 'semantic',
          reasons: ['Semantic match'],
          metadata: { semanticScore: 0.8, finalScore: 0.8 },
        },
        {
          pattern: { id: '1', name: 'Factory', category: 'Creational', description: 'Desc' },
          confidence: 0.6,
          matchType: 'keyword',
          reasons: ['Keyword match'],
          metadata: { keywordScore: 6, finalScore: 0.6 },
        },
      ];

      const alphaResult: DynamicAlphaResult = {
        semanticAlpha: 0.7,
        keywordAlpha: 0.3,
        queryType: 'balanced',
        confidence: 0.6,
        analysis: {
          queryLength: 10,
          wordCount: 2,
          technicalTermCount: 0,
          exploratoryScore: 0,
          specificityScore: 0,
          hasCodeSnippet: false,
          entropy: 0.5,
        },
      };

      const combined = combiner.combineMatches(matches, alphaResult);

      expect(combined).toHaveLength(1);
      expect(combined[0].matchType).toBe('hybrid');
      expect(combined[0].pattern.id).toBe('1');
      expect(combined[0].reasons).toContain('Semantic match');
      expect(combined[0].reasons).toContain('Keyword match');
    });

    it('should keep separate patterns separate', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Factory', category: 'Creational', description: 'Desc' },
          confidence: 0.8,
          matchType: 'semantic',
          reasons: ['Match 1'],
          metadata: { semanticScore: 0.8, finalScore: 0.8 },
        },
        {
          pattern: { id: '2', name: 'Builder', category: 'Creational', description: 'Desc' },
          confidence: 0.6,
          matchType: 'semantic',
          reasons: ['Match 2'],
          metadata: { semanticScore: 0.6, finalScore: 0.6 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined).toHaveLength(2);
    });

    it('should handle empty matches', () => {
      const combined = combiner.combineMatches([]);
      expect(combined).toHaveLength(0);
    });

    it('should use default weights when no alpha result provided', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 0.8,
          matchType: 'semantic',
          reasons: ['Match'],
          metadata: { semanticScore: 0.8, finalScore: 0.8 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined).toHaveLength(1);
      expect(combined[0].confidence).toBeGreaterThan(0);
    });

    it('should handle patterns with only semantic match', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 0.8,
          matchType: 'semantic',
          reasons: ['Semantic only'],
          metadata: { semanticScore: 0.8, finalScore: 0.8 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined[0].metadata.semanticScore).toBe(0.8);
      expect(combined[0].metadata.keywordScore).toBe(0);
    });

    it('should handle patterns with only keyword match', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 0.6,
          matchType: 'keyword',
          reasons: ['Keyword only'],
          metadata: { keywordScore: 0.6, finalScore: 0.6 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined[0].metadata.keywordScore).toBeCloseTo(0.6, 1);
      expect(combined[0].metadata.semanticScore).toBe(0);
    });

    it('should cap final score at 1', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: 1.5,
          matchType: 'semantic',
          reasons: ['High score'],
          metadata: { semanticScore: 1.5, finalScore: 1.5 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined[0].confidence).toBeLessThanOrEqual(1);
    });

    it('should floor final score at 0', () => {
      const matches: MatchResult[] = [
        {
          pattern: { id: '1', name: 'Test', category: 'Test', description: 'Desc' },
          confidence: -0.5,
          matchType: 'semantic',
          reasons: ['Negative score'],
          metadata: { semanticScore: -0.5, finalScore: -0.5 },
        },
      ];

      const combined = combiner.combineMatches(matches);

      expect(combined[0].confidence).toBeGreaterThanOrEqual(0);
    });
  });

  describe('combineMatches — corroboration between channels', () => {
    const pat = (id: string) => ({
      id,
      name: id,
      category: 'Test',
      description: 'Desc',
    });

    const semantic = (id: string, score: number): MatchResult => ({
      pattern: pat(id),
      confidence: score,
      matchType: 'semantic',
      reasons: [`semantic ${id}`],
      metadata: { semanticScore: score, finalScore: score },
    });

    const keyword = (id: string, score: number): MatchResult => ({
      pattern: pat(id),
      confidence: score,
      matchType: 'keyword',
      reasons: [`keyword ${id}`],
      metadata: { keywordScore: score, finalScore: score },
    });

    it('should rank a two-channel match above a single-channel match that scored higher in one channel', () => {
      // THE REGRESSION THIS GUARDS
      // --------------------------
      // Previously a single-channel match passed through at its full score
      // while a two-channel match got the weighted average — and an average
      // never exceeds its larger input. So `agreed` below scored
      // 0.7*0.55 + 0.3*0.50 = 0.535 and lost to `soloSemantic` at a flat 0.60,
      // even though both channels independently ranked `agreed` well and only
      // one channel had ever seen `soloSemantic`.
      //
      // Measured on a 10-query set, this made the keyword channel completely
      // inert: every result in every top-8 came from the single-channel
      // branch, because matching on keywords could only ever lower a score.
      const combined = combiner.combineMatches([
        semantic('agreed', 0.55),
        keyword('agreed', 0.5),
        semantic('soloSemantic', 0.6),
        keyword('filler', 0.05),
      ]);

      const byId = new Map(combined.map((m) => [m.pattern.id, m.confidence]));
      expect(byId.get('agreed')).toBeGreaterThan(byId.get('soloSemantic')!);
    });

    it('should impute a missing channel as that channel\'s weakest observed score, not zero', () => {
      // `solo` is absent from the keyword list, so it is treated as having
      // scored no better than the worst keyword result that did make the
      // cut (0.10) — a bounded estimate rather than a punitive 0.
      const combined = combiner.combineMatches([
        semantic('solo', 0.8),
        semantic('other', 0.4),
        keyword('other', 0.1),
      ]);

      const solo = combined.find((m) => m.pattern.id === 'solo')!;

      // With the default 0.7/0.3 split: 0.7*0.8 + 0.3*0.10 = 0.59.
      // A punitive zero would give 0.56; full passthrough would give 0.80.
      expect(solo.confidence).toBeCloseTo(0.59, 2);
      expect(solo.confidence).toBeLessThan(0.8);
    });

    it('should not impute when a channel produced no results at all', () => {
      // Single-strategy search: the keyword channel never ran, so it must be
      // dropped from the blend entirely rather than imputed. Inventing a
      // keyword floor here would dilute every score by the keyword weight.
      const combined = combiner.combineMatches([
        semantic('a', 0.8),
        semantic('b', 0.4),
      ]);

      const byId = new Map(combined.map((m) => [m.pattern.id, m.confidence]));
      expect(byId.get('a')).toBeCloseTo(0.8, 5);
      expect(byId.get('b')).toBeCloseTo(0.4, 5);
    });

    it('should report as-observed scores in metadata even when imputing for the blend', () => {
      // The imputed floor is a ranking device. `metadata` must keep describing
      // what each channel actually returned, or downstream consumers (the
      // fuzzy decomposition, the MCP rationale text) will report a keyword
      // match that never happened.
      const combined = combiner.combineMatches([
        semantic('solo', 0.8),
        keyword('other', 0.1),
      ]);

      const solo = combined.find((m) => m.pattern.id === 'solo')!;
      expect(solo.metadata.keywordScore).toBe(0);
      expect(solo.metadata.semanticScore).toBe(0.8);
    });

    it('should preserve ordering stability when both channels agree on ranking', () => {
      const combined = combiner.combineMatches([
        semantic('best', 0.9),
        keyword('best', 0.9),
        semantic('mid', 0.5),
        keyword('mid', 0.5),
        semantic('worst', 0.2),
        keyword('worst', 0.2),
      ]);

      const sorted = [...combined].sort((a, b) => b.confidence - a.confidence);
      expect(sorted.map((m) => m.pattern.id)).toEqual(['best', 'mid', 'worst']);
    });
  });
});
