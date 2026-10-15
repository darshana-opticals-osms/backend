const mongoose = require('mongoose');
const Usage = require('../../src/models/chatbotUsage.model');
const Service = require('../../src/services/chatbotUsage.service');

describe('Chatbot usage admission failure and race handling', () => {
  const customerId = new mongoose.Types.ObjectId();
  beforeEach(() => {
    jest.spyOn(Usage, 'findOneAndUpdate').mockResolvedValue(null);
    jest.spyOn(Usage, 'aggregate').mockResolvedValue([]);
    jest.spyOn(Usage, 'updateOne').mockResolvedValue({});
  });
  afterEach(() => jest.restoreAllMocks());

  it('retries initialization after a duplicate Customer key race', async () => {
    Usage.findOneAndUpdate.mockResolvedValueOnce(null).mockResolvedValueOnce({ messageCount: 2 });
    Usage.updateOne.mockRejectedValueOnce({ code: 11000 });
    await Service.reserve(customerId);
    expect(Usage.findOneAndUpdate).toHaveBeenCalledTimes(2);
  });

  it('fails closed after repeated TTL deletion contention', async () => {
    await expect(Service.reserve(customerId)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'CHATBOT_USAGE_UNAVAILABLE',
    });
    expect(Usage.findOneAndUpdate).toHaveBeenCalledTimes(3);
  });

  it.each(['updateOne', 'aggregate', 'findOneAndUpdate'])(
    'fails closed on %s storage errors',
    async (method) => {
      Usage[method].mockRejectedValueOnce(new Error('Database private details'));
      await expect(Service.reserve(customerId)).rejects.toMatchObject({
        statusCode: 503,
        message: 'Chatbot is temporarily unavailable. Please try again later.',
      });
    }
  );

  it('normalizes exhaustion Retry-After to at least one second', async () => {
    Usage.aggregate.mockResolvedValueOnce([{ retryAfter: 0 }]);
    await expect(Service.reserve(customerId)).rejects.toMatchObject({
      statusCode: 429,
      errorCode: 'CHATBOT_SESSION_EXHAUSTED',
      retryAfter: 1,
    });
    expect(Usage.updateOne).not.toHaveBeenCalled();
  });
});
