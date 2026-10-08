const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const KnowledgeArea = require('../../src/models/knowledgeArea.model');
const KnowledgeRetrievalService = require('../../src/services/knowledgeRetrieval.service');

describe('KnowledgeRetrievalService (Unit tests)', () => {
  let mongoServer;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    await KnowledgeArea.deleteMany({});

    await KnowledgeArea.create([
      {
        articleId: 'KA-STORE-001',
        category: 'STORE_INFO',
        contentTitle: 'Store Opening Hours',
        contentBody: 'Darshana Opticals stores are open Monday to Saturday from 9:00 AM to 7:00 PM.',
        keywords: ['hours', 'opening', 'time', 'colombo'],
        isActive: true,
      },
      {
        articleId: 'KA-SERV-001',
        category: 'SERVICES',
        contentTitle: 'Eye Examination Services',
        contentBody: 'We provide comprehensive eye health examinations by qualified optometrists.',
        keywords: ['eye test', 'optometrist', 'appointment'],
        isActive: true,
      },
      {
        articleId: 'KA-INACTIVE-001',
        category: 'STORE_INFO',
        contentTitle: 'Old Store Location',
        contentBody: 'Old address details.',
        keywords: ['old', 'closed'],
        isActive: false, // Inactive article
      },
    ]);
  });

  it('should retrieve matching active knowledge articles for keyword queries', async () => {
    const results = await KnowledgeRetrievalService.findRelevantKnowledge({
      query: 'What are your store opening hours in Colombo?',
    });

    expect(results).toHaveLength(1);
    expect(results[0].articleId).toBe('KA-STORE-001');
    expect(results[0].contentTitle).toBe('Store Opening Hours');
    expect(results[0].contentBody).toContain('Monday to Saturday');
  });

  it('should filter out inactive knowledge articles', async () => {
    const results = await KnowledgeRetrievalService.findRelevantKnowledge({
      query: 'old closed address',
    });

    expect(results).toHaveLength(0);
  });

  it('should filter by category when category is provided', async () => {
    const results = await KnowledgeRetrievalService.findRelevantKnowledge({
      category: 'SERVICES',
    });

    expect(results).toHaveLength(1);
    expect(results[0].articleId).toBe('KA-SERV-001');
    expect(results[0].category).toBe('SERVICES');
  });

  it('should return empty array when no knowledge matches the query', async () => {
    const results = await KnowledgeRetrievalService.findRelevantKnowledge({
      query: 'unrelated quantum mechanics spacecraft topic',
    });

    expect(results).toEqual([]);
  });
});
