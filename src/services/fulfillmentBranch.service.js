const Branch = require('../models/branch.model');
const { ONLINE_FULFILLMENT_BRANCH_CODE } = require('../constants/fulfillment.constants');

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Resolves the authoritative online fulfillment branch.
 * Fails closed: Returns null if no branch matching the configured codeName exists.
 * Does NOT fall back to arbitrary branches.
 *
 * @param {import('mongoose').ClientSession|null} [session=null]
 * @returns {Promise<object|null>}
 */
const getOnlineFulfillmentBranch = async (session = null) => {
  const codeName = process.env.ONLINE_FULFILLMENT_BRANCH_CODE || ONLINE_FULFILLMENT_BRANCH_CODE;

  const query = Branch.findOne({
    codeName: new RegExp(`^${escapeRegex(codeName)}$`, 'i'),
  }).select('_id codeName address');

  if (session) {
    query.session(session);
  }

  return query.lean();
};

module.exports = {
  getOnlineFulfillmentBranch,
};
