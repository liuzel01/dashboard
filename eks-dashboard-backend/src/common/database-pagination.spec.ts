import { executePaginatedQuery } from './database-pagination';

describe('executePaginatedQuery', () => {
  it('uses decimal strings for MySQL LIMIT and OFFSET parameters', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: '42' }])
      .mockResolvedValueOnce([{ id: 1 }]);

    const result = await executePaginatedQuery<{ id: number }>(query, {
      countSql: 'SELECT COUNT(*) AS total FROM example WHERE status = ?',
      dataSql: 'SELECT * FROM example WHERE status = ? LIMIT ? OFFSET ?',
      params: ['ACTIVE'],
      page: 3,
      pageSize: 20,
    });

    expect(query).toHaveBeenNthCalledWith(1, 'SELECT COUNT(*) AS total FROM example WHERE status = ?', ['ACTIVE']);
    expect(query).toHaveBeenNthCalledWith(2, 'SELECT * FROM example WHERE status = ? LIMIT ? OFFSET ?', ['ACTIVE', '20', '40']);
    expect(result).toEqual({ items: [{ id: 1 }], total: 42, page: 3, pageSize: 20 });
  });

  it('normalizes page bounds and supports distinct count/data parameters', async () => {
    const query = jest.fn()
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([]);

    const result = await executePaginatedQuery(query, {
      countSql: 'count',
      dataSql: 'data LIMIT ? OFFSET ?',
      countParams: ['count-param'],
      dataParams: ['data-param'],
      page: -2,
      pageSize: 500,
      maxPageSize: 100,
    });

    expect(query).toHaveBeenNthCalledWith(1, 'count', ['count-param']);
    expect(query).toHaveBeenNthCalledWith(2, 'data LIMIT ? OFFSET ?', ['data-param', '100', '0']);
    expect(result).toEqual({ items: [], total: 1, page: 1, pageSize: 100 });
  });
});
