const EventEmitter = require('events');

/*
 * The application's event bus: one place to announce that something happened, so the code
 * that reacts never has to be wired into the code that acts.
 *
 * require() caches modules, so every file that pulls this in gets the SAME instance - that
 * shared instance is what makes it a bus rather than a private emitter.
 */
const appEvents = new EventEmitter();

// 'error' is special: emitting it with no listener makes node throw and kill the process.
// console.error, not log(), so SHOW_LOG=false can never hide it
appEvents.on('error', (error) => console.error('[events] error event:', error));

module.exports = appEvents;
