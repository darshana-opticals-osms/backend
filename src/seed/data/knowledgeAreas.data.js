/**
 * Initial Knowledge Area Seed Data (ADR-010 Section 8 & 9.2)
 */

const SEED_KNOWLEDGE_AREAS = [
  {
    articleId: 'KA-STORE-001',
    category: 'STORE_INFO',
    contentTitle: 'Store Opening Hours',
    contentBody:
      'Darshana Opticals stores are open Monday through Saturday from 9:00 AM to 7:00 PM. Stores are closed on Sundays and public holidays.',
    keywords: ['hours', 'opening', 'time', 'days', 'schedule', 'open', 'close', 'sunday'],
    isActive: true,
  },
  {
    articleId: 'KA-STORE-002',
    category: 'STORE_INFO',
    contentTitle: 'Branch Locations and Store Addresses',
    contentBody:
      'Our primary branch is located at 123 Main Street, Colombo, and our second branch is located at 45 Temple Road, Kandy.',
    keywords: ['location', 'branch', 'address', 'colombo', 'kandy', 'where', 'located', 'place'],
    isActive: true,
  },

  {
    articleId: 'KA-SERV-001',
    category: 'SERVICES',
    contentTitle: 'Eye Examination and Optometrist Services',
    contentBody:
      'Darshana Opticals provides comprehensive eye health examinations, vision testing, and frame fitting by qualified optometrists. Customers can book eye testing appointments online through the OSMS portal or by calling our store directly at 077 776 2494.',
    keywords: ['eye test', 'examination', 'optometrist', 'appointment', 'booking', 'checkup', 'services'],
    isActive: true,
  },
  {
    articleId: 'KA-POL-001',
    category: 'POLICY_WARRANTY',
    contentTitle: 'Product Returns, Exchange and Warranty Policy',
    contentBody:
      'Unused optical frames and non-custom eyewear accessories can be returned or exchanged within 14 days of purchase with the original receipt. Custom prescription lenses cannot be refunded once manufacturing has begun. All frames include a 1-year manufacturer warranty against defects.',
    keywords: ['return', 'refund', 'exchange', 'warranty', 'policy', 'receipt', 'guarantee'],
    isActive: true,
  },
  {
    articleId: 'KA-ORD-001',
    category: 'ORDER_STATUS_GUIDANCE',
    contentTitle: 'Order Tracking and Status Guidance',
    contentBody:
      'Customers can track the real-time status of their optical orders by logging into their OSMS account and navigating to My Orders. Status stages include PROCESSING, READY_FOR_PICKUP, and DELIVERED.',
    keywords: ['order', 'track', 'status', 'ready', 'pickup', 'delivery', 'my orders'],
    isActive: true,
  },
];

module.exports = {
  SEED_KNOWLEDGE_AREAS,
};
