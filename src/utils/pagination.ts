import { Request } from 'express';

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
  sort: string;
  order: 'asc' | 'desc';
  search?: string;
}

export interface PaginatedResponse<T> {
  success: true;
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function getPaginationParams(req: Request): PaginationParams {
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
  const sort = (req.query.sort as string) || 'createdAt';
  const order = ((req.query.order as string) || 'desc') === 'asc' ? 'asc' : 'desc';
  const search = req.query.search as string | undefined;

  return { page, limit, skip: (page - 1) * limit, sort, order, search };
}

export function buildPaginatedResponse<T>(data: T[], total: number, params: PaginationParams): PaginatedResponse<T> {
  return {
    success: true,
    data,
    meta: {
      page: params.page,
      limit: params.limit,
      total,
      totalPages: Math.ceil(total / params.limit),
    },
  };
}
