export type PaginatedQueryInput = {
  dataSql: string;
  countSql: string;
  params?: unknown[];
  dataParams?: unknown[];
  countParams?: unknown[];
  page?: number;
  pageSize?: number;
  maxPageSize?: number;
};

export type PaginatedQueryResult<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

type QueryExecutor = <T = unknown>(sql: string, params?: unknown[]) => Promise<T>;

export async function executePaginatedQuery<T>(
  query: QueryExecutor,
  input: PaginatedQueryInput,
): Promise<PaginatedQueryResult<T>> {
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const maxPageSize = Math.max(1, Math.floor(Number(input.maxPageSize) || 100));
  const pageSize = Math.min(maxPageSize, Math.max(1, Math.floor(Number(input.pageSize) || 20)));
  const offset = (page - 1) * pageSize;
  const sharedParams = input.params || [];
  const countParams = input.countParams || sharedParams;
  const dataParams = input.dataParams || sharedParams;

  const countRows = await query<Array<{ total: number | string }>>(input.countSql, countParams);
  const items = await query<T[]>(input.dataSql, [
    ...dataParams,
    // MySQL 8.4 rejects numeric LIMIT/OFFSET parameters through
    // mysql2 prepared statements. Decimal strings retain prepared-statement
    // safety while remaining compatible with MySQL 5.7/8.x.
    String(pageSize),
    String(offset),
  ]);

  return {
    items,
    total: Number(countRows[0]?.total || 0),
    page,
    pageSize,
  };
}
