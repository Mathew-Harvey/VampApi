import { describe, it, expect } from 'vitest';
import { getPaginationParams, buildPaginatedResponse, PaginationParams } from '../../src/utils/pagination';

function mockRequest(query: Record<string, string> = {}) {
  return { query } as any;
}

describe('getPaginationParams', () => {
  it('returns sensible defaults when no query params provided', () => {
    const result = getPaginationParams(mockRequest());
    expect(result).toEqual({
      page: 1,
      limit: 20,
      skip: 0,
      sort: 'createdAt',
      order: 'desc',
      search: undefined,
    });
  });

  it('parses page and limit from query', () => {
    const result = getPaginationParams(mockRequest({ page: '3', limit: '10' }));
    expect(result.page).toBe(3);
    expect(result.limit).toBe(10);
    expect(result.skip).toBe(20);
  });

  it('clamps page to minimum of 1', () => {
    const result = getPaginationParams(mockRequest({ page: '-5' }));
    expect(result.page).toBe(1);
  });

  it('clamps limit to maximum of 100', () => {
    const result = getPaginationParams(mockRequest({ limit: '500' }));
    expect(result.limit).toBe(100);
  });

  it('falls back to default when limit is 0 (falsy)', () => {
    // parseInt('0') === 0, which is falsy, so `|| 20` kicks in → default 20
    const result = getPaginationParams(mockRequest({ limit: '0' }));
    expect(result.limit).toBe(20);
  });

  it('accepts sort and order params', () => {
    const result = getPaginationParams(mockRequest({ sort: 'name', order: 'asc' }));
    expect(result.sort).toBe('name');
    expect(result.order).toBe('asc');
  });

  it('defaults order to desc for invalid values', () => {
    const result = getPaginationParams(mockRequest({ order: 'invalid' }));
    expect(result.order).toBe('desc');
  });

  it('passes through search param', () => {
    const result = getPaginationParams(mockRequest({ search: 'test vessel' }));
    expect(result.search).toBe('test vessel');
  });
});

describe('buildPaginatedResponse', () => {
  const params: PaginationParams = {
    page: 2, limit: 10, skip: 10, sort: 'createdAt', order: 'desc',
  };

  it('builds correct response shape', () => {
    const items = [{ id: 1 }, { id: 2 }];
    const result = buildPaginatedResponse(items, 25, params);
    expect(result).toEqual({
      success: true,
      data: items,
      meta: { page: 2, limit: 10, total: 25, totalPages: 3 },
    });
  });

  it('handles zero results', () => {
    const result = buildPaginatedResponse([], 0, { ...params, page: 1, skip: 0 });
    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });

  it('calculates totalPages correctly with exact division', () => {
    const result = buildPaginatedResponse([], 30, params);
    expect(result.meta.totalPages).toBe(3);
  });

  it('calculates totalPages correctly with remainder', () => {
    const result = buildPaginatedResponse([], 31, params);
    expect(result.meta.totalPages).toBe(4);
  });
});
