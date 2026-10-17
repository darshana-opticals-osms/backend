const EventEmitter = require('events');

/**
 * In-process Domain Event Emitter (ADR-013, Section 8 - Option B).
 *
 * Decouples core business operations (e.g., Order status updates, PayHere IPN processing)
 * from asynchronous auxiliary workflows such as transactional customer email delivery.
 */
class DomainEventEmitter extends EventEmitter {}

const domainEvents = new DomainEventEmitter();
domainEvents.setMaxListeners(20);

const ORDER_EVENTS = Object.freeze({
  STATUS_CHANGED: 'order.status_changed',
});

module.exports = {
  domainEvents,
  ORDER_EVENTS,
};
