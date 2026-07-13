import { describe, expect, it } from 'vitest';
import { queryValue, stringifyQuery } from './query';

describe('query utilities', () => {
  it('serializes Chinese text and skips empty values', () => {
    expect(stringifyQuery({ category: 'M1 航空概论', page: 2, keyword: '' })).toBe(
      '?category=M1%20%E8%88%AA%E7%A9%BA%E6%A6%82%E8%AE%BA&page=2',
    );
  });

  it('reads encoded values without browser URLSearchParams', () => {
    expect(queryValue('?platform=app&apiBase=https%3A%2F%2Fexample.com%2Fapi', 'apiBase')).toBe(
      'https://example.com/api',
    );
  });
});
