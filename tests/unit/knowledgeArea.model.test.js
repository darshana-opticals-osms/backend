const KnowledgeArea = require('../../src/models/knowledgeArea.model');

describe('KnowledgeArea model (Unit tests)', () => {
  it('should validate a valid KnowledgeArea object', async () => {
    const ka = new KnowledgeArea({
      articleId: 'KA-STORE-001',
      category: 'STORE_INFO',
      contentTitle: 'Store Opening Hours',
      contentBody: 'Darshana Opticals is open Monday to Saturday from 9:00 AM to 7:00 PM.',
      keywords: ['hours', 'opening', 'time'],
      isActive: true,
    });

    await expect(ka.validate()).resolves.toBeUndefined();
    expect(ka.articleId).toBe('KA-STORE-001');
    expect(ka.category).toBe('STORE_INFO');
    expect(ka.contentTitle).toBe('Store Opening Hours');
    expect(ka.contentBody).toContain('Monday to Saturday');
    expect(ka.keywords).toEqual(['hours', 'opening', 'time']);
    expect(ka.isActive).toBe(true);
  });

  it('should default isActive to true and keywords to empty array', () => {
    const ka = new KnowledgeArea({
      articleId: 'KA-STORE-002',
      category: 'STORE_INFO',
      contentTitle: 'Branch Location',
      contentBody: 'Our main store is located in Colombo.',
    });

    expect(ka.isActive).toBe(true);
    expect(ka.keywords).toEqual([]);
  });

  it('should fail validation when articleId is missing', async () => {
    const ka = new KnowledgeArea({
      category: 'STORE_INFO',
      contentTitle: 'Title',
      contentBody: 'Body text',
    });

    await expect(ka.validate()).rejects.toThrow();
  });

  it('should fail validation when category is missing', async () => {
    const ka = new KnowledgeArea({
      articleId: 'KA-STORE-003',
      contentTitle: 'Title',
      contentBody: 'Body text',
    });

    await expect(ka.validate()).rejects.toThrow();
  });

  it('should fail validation when contentTitle is missing', async () => {
    const ka = new KnowledgeArea({
      articleId: 'KA-STORE-004',
      category: 'STORE_INFO',
      contentBody: 'Body text',
    });

    await expect(ka.validate()).rejects.toThrow();
  });

  it('should fail validation when contentBody is missing', async () => {
    const ka = new KnowledgeArea({
      articleId: 'KA-STORE-005',
      category: 'STORE_INFO',
      contentTitle: 'Title',
    });

    await expect(ka.validate()).rejects.toThrow();
  });

  it('should uppercase and trim articleId and category', () => {
    const ka = new KnowledgeArea({
      articleId: '  ka-policy-001  ',
      category: '  policy_warranty  ',
      contentTitle: 'Return Policy',
      contentBody: 'Items can be returned within 14 days.',
    });

    expect(ka.articleId).toBe('KA-POLICY-001');
    expect(ka.category).toBe('POLICY_WARRANTY');
  });
});
