const {
  validateSalesReportQuery,
  validateSalesOrdersQuery,
  validateInventoryReportQuery,
  validateInventoryItemsQuery,
  validateSalesExportQuery,
  validateInventoryExportQuery,
} = require('../../src/validations/report.validation');

describe('report.validation (ADR-014 §12 & §15.5)', () => {
  const validBranchId = '507f1f77bcf86cd799439011';

  describe('validateSalesReportQuery', () => {
    it('accepts valid sales report query parameters', () => {
      const req = {
        query: {
          preset: 'last_7_days',
          branchId: validBranchId,
          groupBy: 'day',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors).toEqual([]);
    });

    it('accepts custom date range', () => {
      const req = {
        query: {
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors).toEqual([]);
    });

    it('rejects unsupported query parameter', () => {
      const req = {
        query: {
          unsupportedParam: 'exploit',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'unsupportedParam')).toBe(true);
    });

    it('rejects invalid preset', () => {
      const req = {
        query: {
          preset: 'all_time_invalid',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'preset')).toBe(true);
    });

    it('rejects reversed date range', () => {
      const req = {
        query: {
          startDate: '2026-02-15',
          endDate: '2026-02-01',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'startDate')).toBe(true);
    });

    it('rejects custom range exceeding 365 days', () => {
      const req = {
        query: {
          startDate: '2024-01-01',
          endDate: '2026-01-01',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'dateRange')).toBe(true);
    });

    it('rejects malformed branchId', () => {
      const req = {
        query: {
          branchId: 'invalid-hex-id',
        },
        body: {},
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'branchId')).toBe(true);
    });

    it('rejects non-empty body in GET request', () => {
      const req = {
        query: {},
        body: { inject: true },
      };

      const errors = validateSalesReportQuery(req);
      expect(errors.some((e) => e.field === 'body')).toBe(true);
    });
  });

  describe('validateSalesOrdersQuery', () => {
    it('accepts valid pagination and sort parameters', () => {
      const req = {
        query: {
          page: '2',
          limit: '50',
          sortBy: 'paidAt',
          sortOrder: 'asc',
        },
        body: {},
      };

      const errors = validateSalesOrdersQuery(req);
      expect(errors).toEqual([]);
    });

    it('rejects invalid limit exceeding 100', () => {
      const req = {
        query: {
          limit: '101',
        },
        body: {},
      };

      const errors = validateSalesOrdersQuery(req);
      expect(errors.some((e) => e.field === 'limit')).toBe(true);
    });

    it('rejects invalid sortBy field', () => {
      const req = {
        query: {
          sortBy: 'passwordHash',
        },
        body: {},
      };

      const errors = validateSalesOrdersQuery(req);
      expect(errors.some((e) => e.field === 'sortBy')).toBe(true);
    });
  });

  describe('validateInventoryReportQuery and validateInventoryItemsQuery', () => {
    it('accepts valid inventory parameters', () => {
      const req = {
        query: {
          branchId: validBranchId,
          reorderStatus: 'LOW_STOCK',
          groupBy: 'category',
        },
        body: {},
      };

      const errors = validateInventoryReportQuery(req);
      expect(errors).toEqual([]);
    });

    it('rejects invalid reorderStatus', () => {
      const req = {
        query: {
          reorderStatus: 'INVALID_STATUS',
        },
        body: {},
      };

      const errors = validateInventoryReportQuery(req);
      expect(errors.some((e) => e.field === 'reorderStatus')).toBe(true);
    });

    it('accepts valid inventory items query', () => {
      const req = {
        query: {
          page: '1',
          limit: '20',
          sortBy: 'quantity',
          sortOrder: 'desc',
        },
        body: {},
      };

      const errors = validateInventoryItemsQuery(req);
      expect(errors).toEqual([]);
    });
  });

  describe('validateSalesExportQuery and validateInventoryExportQuery', () => {
    it('accepts format=csv and valid filters', () => {
      const req = {
        query: {
          preset: 'today',
          format: 'csv',
        },
        body: {},
      };

      const errors = validateSalesExportQuery(req);
      expect(errors).toEqual([]);
    });

    it('accepts format=xlsx for sales export query', () => {
      const req = {
        query: {
          preset: 'today',
          format: 'xlsx',
        },
        body: {},
      };

      const errors = validateSalesExportQuery(req);
      expect(errors).toEqual([]);
    });

    it('rejects unsupported format like pdf or docx', () => {
      const req = {
        query: {
          format: 'pdf',
        },
        body: {},
      };

      const errors = validateSalesExportQuery(req);
      expect(errors.some((e) => e.field === 'format')).toBe(true);
    });

    it('accepts valid inventory export query with format csv or xlsx', () => {
      const reqCsv = {
        query: {
          category: 'Frames',
          format: 'csv',
        },
        body: {},
      };
      expect(validateInventoryExportQuery(reqCsv)).toEqual([]);

      const reqXlsx = {
        query: {
          category: 'Frames',
          format: 'xlsx',
        },
        body: {},
      };
      expect(validateInventoryExportQuery(reqXlsx)).toEqual([]);
    });

    it('rejects unsupported format in inventory export query', () => {
      const req = {
        query: {
          format: 'xml',
        },
        body: {},
      };

      const errors = validateInventoryExportQuery(req);
      expect(errors.some((e) => e.field === 'format')).toBe(true);
    });
  });
});
