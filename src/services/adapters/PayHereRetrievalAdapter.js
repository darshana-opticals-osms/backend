const { ServiceUnavailableError } = require('../../errors/AppError');
const { RETRIEVAL_STATUSES } = require('../../constants/paymentRetrieval');
const { formatAmount } = require('./PayHerePaymentAdapter');

const MAX_RESPONSE_BYTES = 256 * 1024;
const validReference = (value) =>
  typeof value === 'string' && /^[A-Za-z0-9._:-]{1,120}$/.test(value);
const unavailable = (code = 'PAYHERE_RETRIEVAL_UNAVAILABLE', details = null) =>
  new ServiceUnavailableError('Provider payment verification is unavailable.', details, code);

function canonicalAmount(value) {
  if (typeof value === 'number') {
    try {
      return formatAmount(value);
    } catch {
      throw unavailable();
    }
  }
  if (typeof value !== 'string' || !/^\d{1,13}(\.\d{1,2})?$/.test(value)) throw unavailable();
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw unavailable();
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

function normalizeSearch(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw unavailable();
  if (body.status !== 1) {
    if (![0, -1, -2].includes(body.status) || body.data != null) throw unavailable();
    return {
      // The docs also use -2 for authentication errors. It cannot prove a decline.
      outcome: { 0: 'pending', '-1': 'not_found', '-2': 'declined_or_error' }[body.status],
      providerCode: body.status,
      records: [],
    };
  }
  if (!Array.isArray(body.data) || body.data.length > 100) throw unavailable();
  const records = new Map();
  for (const row of body.data) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw unavailable();
    const reference =
      typeof row.payment_id === 'number' &&
      Number.isSafeInteger(row.payment_id) &&
      row.payment_id > 0
        ? String(row.payment_id)
        : row.payment_id;
    if (
      !validReference(reference) ||
      !validReference(row.order_id) ||
      !RETRIEVAL_STATUSES.includes(row.status) ||
      typeof row.currency !== 'string' ||
      !/^[A-Z]{3}$/.test(row.currency)
    )
      throw unavailable();
    const record = {
      providerTransactionId: reference,
      providerOrderId: row.order_id,
      status: row.status,
      amount: canonicalAmount(row.amount),
      currency: row.currency,
    };
    const previous = records.get(reference);
    if (previous && JSON.stringify(previous) !== JSON.stringify(record)) throw unavailable();
    records.set(reference, record);
  }
  return {
    outcome: records.size ? 'records' : 'not_found',
    providerCode: 1,
    records: [...records.values()].sort((a, b) =>
      a.providerTransactionId.localeCompare(b.providerTransactionId)
    ),
  };
}

class PayHereRetrievalAdapter {
  constructor(config, { fetchImpl = global.fetch, now = Date.now } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.now = now;
    this.token = null;
    this.tokenPromise = null;
    this.requestTimes = [];
    this.blockedUntil = 0;
  }

  assertConfigured() {
    const c = this.config;
    if (
      !['sandbox', 'live'].includes(c.payhereMode) ||
      (c.payhereMode === 'live' && c.nodeEnv !== 'production') ||
      !c.payhereMerchantId ||
      !c.payhereApiAppId ||
      !c.payhereApiAppSecret ||
      typeof this.fetch !== 'function'
    )
      throw unavailable('PAYHERE_RETRIEVAL_NOT_CONFIGURED');
  }

  async request(endpoint, options) {
    this.assertConfigured();
    const now = this.now();
    this.requestTimes = this.requestTimes.filter((time) => time > now - 10000);
    if (now < this.blockedUntil || this.requestTimes.length >= 18) {
      throw unavailable('PAYHERE_RETRIEVAL_RATE_LIMITED', {
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((this.blockedUntil - now) / 1000),
          this.requestTimes.length >= 18
            ? Math.ceil((this.requestTimes[0] + 10000 - now) / 1000)
            : 0
        ),
      });
    }
    this.requestTimes.push(now);
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.config.payhereRetrievalTimeoutMs || 8000
    );
    try {
      const host = this.config.payhereMode === 'sandbox' ? 'sandbox.payhere.lk' : 'www.payhere.lk';
      const response = await this.fetch(`https://${host}/merchant/v1/${endpoint}`, {
        ...options,
        signal: controller.signal,
        redirect: 'error',
      });
      // Release rejected HTTP bodies without parsing or retaining provider details.
      if (!response.ok) await response.body?.cancel();
      if (response.status === 429) {
        const header = response.headers.get('retry-after');
        const seconds = /^\d+$/.test(header || '')
          ? Number(header)
          : (Date.parse(header) - now) / 1000;
        this.blockedUntil =
          now + (Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 10000);
        throw unavailable('PAYHERE_RETRIEVAL_RATE_LIMITED', {
          retryAfterSeconds: Math.max(1, Math.ceil((this.blockedUntil - now) / 1000)),
        });
      }
      if (response.status === 401) throw unavailable('PAYHERE_RETRIEVAL_AUTH_FAILED');
      if (!response.ok) throw unavailable();
      const chunks = [];
      let bytes = 0;
      for await (const chunk of response.body) {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) {
          controller.abort();
          throw unavailable();
        }
        chunks.push(Buffer.from(chunk));
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof ServiceUnavailableError) throw error;
      // Never propagate upstream bodies, tokens, request headers or network errors.
      throw unavailable(controller.signal.aborted ? 'PAYHERE_RETRIEVAL_TIMEOUT' : undefined);
    } finally {
      clearTimeout(timeout);
    }
  }

  async getToken() {
    if (this.token && this.token.expiresAt > this.now() + 5000) return this.token.value;
    if (!this.tokenPromise) {
      this.tokenPromise = (async () => {
        const started = this.now();
        const body = await this.request('oauth/token', {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.config.payhereApiAppId}:${this.config.payhereApiAppSecret}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: 'grant_type=client_credentials',
        });
        if (
          typeof body?.access_token !== 'string' ||
          !/^[\x21-\x7e]{1,4096}$/.test(body.access_token) ||
          typeof body.token_type !== 'string' ||
          body.token_type.toLowerCase() !== 'bearer' ||
          !Number.isInteger(body.expires_in) ||
          body.expires_in <= 5 ||
          body.expires_in > 86400 ||
          (this.config.payhereMode === 'sandbox' && body.scope !== 'SANDBOX') ||
          (this.config.payhereMode === 'live' && body.scope === 'SANDBOX')
        )
          throw unavailable('PAYHERE_RETRIEVAL_AUTH_FAILED');
        this.token = { value: body.access_token, expiresAt: started + body.expires_in * 1000 };
        return body.access_token;
      })().finally(() => {
        this.tokenPromise = null;
      });
    }
    return this.tokenPromise;
  }

  async searchPayments(providerOrderId) {
    this.assertConfigured();
    if (!validReference(providerOrderId)) throw unavailable();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await this.getToken();
      try {
        const body = await this.request(
          `payment/search?order_id=${encodeURIComponent(providerOrderId)}`,
          {
            method: 'GET',
            headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          }
        );
        if (body?.error === 'invalid_token') throw unavailable('PAYHERE_RETRIEVAL_AUTH_FAILED');
        return normalizeSearch(body);
      } catch (error) {
        if (error.errorCode !== 'PAYHERE_RETRIEVAL_AUTH_FAILED' || attempt) throw error;
        // Do not invalidate a newer token obtained by a concurrent caller.
        if (this.token?.value === token) this.token = null;
      }
    }
    throw unavailable();
  }
}

module.exports = { PayHereRetrievalAdapter, normalizeSearch };
