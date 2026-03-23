import { describe, it, expect, vi } from 'vitest';
import { asyncHandler } from '../../src/utils/async-handler';

describe('asyncHandler', () => {
  it('calls the wrapped function', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const req = {} as any;
    const res = {} as any;
    const next = vi.fn();

    await wrapped(req, res, next);
    expect(handler).toHaveBeenCalledWith(req, res, next);
  });

  it('calls next with error when handler throws', async () => {
    const error = new Error('test error');
    const handler = vi.fn().mockRejectedValue(error);
    const wrapped = asyncHandler(handler);
    const next = vi.fn();

    await wrapped({} as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(error);
  });

  it('does not call next when handler succeeds', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const wrapped = asyncHandler(handler);
    const next = vi.fn();

    await wrapped({} as any, {} as any, next);
    expect(next).not.toHaveBeenCalled();
  });
});
