const {
  PayHereRetrievalAdapter,
  normalizeSearch,
} = require('../../src/services/adapters/PayHereRetrievalAdapter');

const config = {
  nodeEnv: 'test',
  payhereMode: 'sandbox',
  payhereMerchantId: 'test-merchant',
  payhereApiAppId: 'test-api-app',
  payhereApiAppSecret: 'test-api-secret',
  payhereRetrievalTimeoutMs: 1000,
};
const token = () =>
  new Response(
    JSON.stringify({
      access_token: 'test-access-token',
      token_type: 'bearer',
      expires_in: 599,
      scope: 'SANDBOX',
    })
  );
const row = (extra = {}) => ({
  payment_id: 320025071278,
  order_id: 'PAY-test',
  status: 'RECEIVED',
  amount: 37000,
  currency: 'LKR',
  ...extra,
});
const result = (extra = {}) => new Response(JSON.stringify({ status: 1, data: [row()], ...extra }));

describe('PayHere read-only Retrieval API adapter', () => {
  it('requires an object recovery body even for a default dry-run', () => {
    const { validatePaymentRecovery } = require('../../src/validations/paymentRecovery.validation');
    for (const body of [null, [], 'invalid']) {
      expect(
        validatePaymentRecovery({ params: { paymentId: '507f1f77bcf86cd799439011' }, body })
      ).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'body' })]));
    }
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  it('uses distinct OAuth credentials, canonical search identity and strips sensitive fields', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(
        result({
          data: [
            row({
              customer: { email: 'private@example.test' },
              payment_method: { card_no: 'private-card' },
              arbitrary: 'not-retained',
            }),
          ],
        })
      );
    const adapter = new PayHereRetrievalAdapter(config, { fetchImpl });
    const observed = await adapter.searchPayments('PAY-test');
    expect(fetchImpl.mock.calls[0][0]).toBe('https://sandbox.payhere.lk/merchant/v1/oauth/token');
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      body: 'grant_type=client_credentials',
      redirect: 'error',
      headers: {
        Authorization: `Basic ${Buffer.from('test-api-app:test-api-secret').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    expect(fetchImpl.mock.calls[1]).toEqual([
      expect.stringContaining('payment/search?order_id=PAY-test'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'error',
        headers: { Authorization: 'Bearer test-access-token', Accept: 'application/json' },
      }),
    ]);
    expect(observed).toEqual({
      outcome: 'records',
      providerCode: 1,
      records: [
        {
          providerTransactionId: '320025071278',
          providerOrderId: 'PAY-test',
          status: 'RECEIVED',
          amount: '37000.00',
          currency: 'LKR',
        },
      ],
    });
    expect(JSON.stringify(observed)).not.toMatch(/private|token|secret|arbitrary/);
  });
  it.each([
    [0, 'pending'],
    [-1, 'not_found'],
    [-2, 'declined_or_error'],
  ])('keeps provider envelope %s conservative', (status, outcome) => {
    expect(normalizeSearch({ status, data: null, msg: 'untrusted provider text' })).toEqual({
      outcome,
      providerCode: status,
      records: [],
    });
  });
  it.each(['RECEIVED', 'REFUND REQUESTED', 'REFUND PROCESSING', 'REFUNDED', 'CHARGEBACKED'])(
    'retains documented record status %s without mapping it to OSMS state',
    (status) => {
      expect(normalizeSearch({ status: 1, data: [row({ status })] }).records[0].status).toBe(
        status
      );
    }
  );
  it('retains multiple distinct transactions, deduplicates identical rows and rejects contradictory identity', () => {
    const body = { status: 1, data: [row(), row(), row({ payment_id: 320025071279 })] };
    expect(normalizeSearch(body).records).toHaveLength(2);
    expect(() => normalizeSearch({ status: 1, data: [row(), row({ amount: 1 })] })).toThrow();
  });
  it.each([
    null,
    {},
    { status: '1', data: [] },
    { status: 1, data: {} },
    { status: 0, data: [row()] },
    { status: 1, data: Array.from({ length: 101 }, () => row()) },
    ...[
      { status: 'Authorized' },
      { status: 'PENDING' },
      { amount: -1 },
      { amount: 1.234 },
      { amount: '1e3' },
      { amount: '900719925474099.00' },
      { payment_id: Number.MAX_SAFE_INTEGER + 1 },
      { payment_id: '' },
      { order_id: ['PAY-test'] },
      { currency: 'lkr' },
    ].map((extra) => ({ status: 1, data: [row(extra)] })),
  ])('rejects malformed or undocumented provider responses %#', (body) => {
    expect(() => normalizeSearch(body)).toThrow(
      expect.objectContaining({ errorCode: 'PAYHERE_RETRIEVAL_UNAVAILABLE' })
    );
  });
  it('canonicalizes exact decimal strings without floating point', () => {
    expect(normalizeSearch({ status: 1, data: [row({ amount: '37.1' })] }).records[0].amount).toBe(
      '37.10'
    );
  });
  it('reuses a token and refreshes before expiration', async () => {
    let now = 10000;
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (url) => (url.endsWith('/oauth/token') ? token() : result()));
    const adapter = new PayHereRetrievalAdapter(config, { fetchImpl, now: () => now });
    await adapter.searchPayments('PAY-test');
    await adapter.searchPayments('PAY-test');
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
    now += 600000;
    await adapter.searchPayments('PAY-test');
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(2);
  });
  it('shares token refresh among concurrent requests', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (url) => (url.endsWith('/oauth/token') ? token() : result()));
    const adapter = new PayHereRetrievalAdapter(config, { fetchImpl });
    await Promise.all([adapter.searchPayments('PAY-test'), adapter.searchPayments('PAY-test')]);
    expect(fetchImpl.mock.calls.filter(([url]) => url.endsWith('/oauth/token'))).toHaveLength(1);
  });
  it.each([401, 200])('refreshes an invalid token only once (response %s)', async (status) => {
    const invalid = () =>
      new Response(
        JSON.stringify({
          error: 'invalid_token',
          error_description: 'sensitive token not propagated',
        }),
        { status }
      );
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(result());
    await expect(
      new PayHereRetrievalAdapter(config, { fetchImpl }).searchPayments('PAY-test')
    ).resolves.toMatchObject({ outcome: 'records' });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });
  it.each([401, 403, 500])('sanitizes OAuth HTTP %s errors', async (status) => {
    const fetchImpl = jest.fn().mockResolvedValue(new Response('upstream secret', { status }));
    await expect(
      new PayHereRetrievalAdapter(config, { fetchImpl }).searchPayments('PAY-test')
    ).rejects.toMatchObject({
      statusCode: 503,
      message: 'Provider payment verification is unavailable.',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it.each([{ expires_in: 1 }, { token_type: 'Basic' }, { scope: 'LIVE' }, { access_token: '' }])(
    'rejects invalid OAuth token metadata %#',
    async (extra) => {
      const fetchImpl = jest.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: 'test-token',
            token_type: 'bearer',
            expires_in: 599,
            scope: 'SANDBOX',
            ...extra,
          })
        )
      );
      await expect(
        new PayHereRetrievalAdapter(config, { fetchImpl }).searchPayments('PAY-test')
      ).rejects.toMatchObject({ errorCode: 'PAYHERE_RETRIEVAL_AUTH_FAILED' });
    }
  );
  it('honors upstream Retry-After without retrying a blocked request', async () => {
    let now = 10000;
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(token())
      .mockResolvedValueOnce(result());
    const adapter = new PayHereRetrievalAdapter(config, { fetchImpl, now: () => now });
    await expect(adapter.searchPayments('PAY-test')).rejects.toMatchObject({
      errorCode: 'PAYHERE_RETRIEVAL_RATE_LIMITED',
      details: { retryAfterSeconds: 2 },
    });
    await expect(adapter.searchPayments('PAY-test')).rejects.toMatchObject({
      errorCode: 'PAYHERE_RETRIEVAL_RATE_LIMITED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 2001;
    await expect(adapter.searchPayments('PAY-test')).resolves.toMatchObject({ outcome: 'records' });
  });
  it('bounds the per-process request budget below the documented provider limit', async () => {
    const fetchImpl = jest
      .fn()
      .mockImplementation(async (url) => (url.endsWith('/oauth/token') ? token() : result()));
    const adapter = new PayHereRetrievalAdapter(config, { fetchImpl, now: () => 10000 });
    for (let i = 0; i < 17; i += 1) await adapter.searchPayments('PAY-test');
    await expect(adapter.searchPayments('PAY-test')).rejects.toMatchObject({
      errorCode: 'PAYHERE_RETRIEVAL_RATE_LIMITED',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(18);
  });
  it('aborts a stalled provider request and exposes no network details', async () => {
    jest.useFakeTimers();
    const fetchImpl = jest.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(new Error('private-network-detail')))
        )
    );
    const pending = expect(
      new PayHereRetrievalAdapter(config, { fetchImpl }).searchPayments('PAY-test')
    ).rejects.toMatchObject({ errorCode: 'PAYHERE_RETRIEVAL_TIMEOUT' });
    await jest.advanceTimersByTimeAsync(1001);
    await pending;
  });
  it.each(['not json', 'x'.repeat(256 * 1024 + 1)])(
    'rejects malformed or oversized HTTP bodies %#',
    async (body) => {
      const fetchImpl = jest.fn().mockResolvedValue(new Response(body));
      await expect(
        new PayHereRetrievalAdapter(config, { fetchImpl }).searchPayments('PAY-test')
      ).rejects.toMatchObject({ statusCode: 503 });
    }
  );
  it('does not make requests when credentials are absent or live mode is unsafe', async () => {
    const fetchImpl = jest.fn();
    for (const override of [
      { payhereApiAppSecret: '' },
      { payhereMode: 'live' },
      { payhereMode: 'other' },
    ]) {
      await expect(
        new PayHereRetrievalAdapter({ ...config, ...override }, { fetchImpl }).searchPayments(
          'PAY-test'
        )
      ).rejects.toMatchObject({ errorCode: 'PAYHERE_RETRIEVAL_NOT_CONFIGURED' });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('uses only the live host in production and rejects a sandbox-scoped token', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(token());
    await expect(
      new PayHereRetrievalAdapter(
        { ...config, nodeEnv: 'production', payhereMode: 'live' },
        { fetchImpl }
      ).searchPayments('PAY-test')
    ).rejects.toMatchObject({ errorCode: 'PAYHERE_RETRIEVAL_AUTH_FAILED' });
    expect(fetchImpl.mock.calls[0][0]).toBe('https://www.payhere.lk/merchant/v1/oauth/token');
  });
});
