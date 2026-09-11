const ROLE_VALUES = Object.freeze({
  CUSTOMER: 'customer',
  SYSTEM_ADMIN: 'system_admin',
  BRANCH_MANAGER: 'branch_manager',
  INVENTORY_MANAGER: 'inventory_manager',
  OPTOMETRIST: 'optometrist',
  MANAGEMENT: 'management',
});

const CUSTOMER_ROLE_VALUES = Object.freeze([ROLE_VALUES.CUSTOMER]);
const STAFF_ROLE_VALUES = Object.freeze([
  ROLE_VALUES.BRANCH_MANAGER,
  ROLE_VALUES.INVENTORY_MANAGER,
  ROLE_VALUES.OPTOMETRIST,
  ROLE_VALUES.MANAGEMENT,
]);
const ADMIN_ROLE_VALUES = Object.freeze([ROLE_VALUES.SYSTEM_ADMIN]);

module.exports = {
  ROLE_VALUES,
  CUSTOMER_ROLE_VALUES,
  STAFF_ROLE_VALUES,
  ADMIN_ROLE_VALUES,
};
