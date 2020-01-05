const util = require('util');
const EventEmitter = require('events');


var uniqueCounter = 0;


class IPC extends EventEmitter {
    constructor (transport) {
        super();
        this.__messageHandler = this._messageHandler.bind(this);
        this.__errorHandler = this._errorHandler.bind(this);
        this.__disconnectHandler = this._disconnectHandler.bind(this);

        this._functions = {};
        this._callbacks = {};
        this._responses = {};
        this.transport = transport;
        this.closed = false;

        this.rpc = new Proxy({}, {
            get: (obj, prop) => {
                return this.call.bind(this, prop);
            },
            set: (obj, prop, value) => {
                this.func(prop, value); return true;
            }
        });

        transport.on('message', this.__messageHandler);
        transport.on('error', this.__errorHandler);
        transport.on('disconnect', this.__disconnectHandler);
    }

    _send (message) {
        if (this.transport !== null) {
            this.transport.send(message)
        }
        return message
    }

    _errorHandler (err) {
        this._emit('error', err);
        this.destroy(err);
    }

    _disconnectHandler (packet) {
        this._emit('disconnect');
        this.destroy(new Error('ERR_IPC_CHANNEL_CLOSED'));
    }

    async _emit (name, ...args) {
        super.emit(name, ...args)
    }

    async _exec (name, args) {
        if (!Object.prototype.hasOwnProperty.call(this._functions, name)) {
            throw new ReferenceError(`${name} is not defined`);
        }
        const func = this._functions[name];
        return new Promise((resolve, reject) => {
            try { setImmediate(() => resolve(func.apply(this, args))) }
            catch (e) { reject(e) }
        })
    }

    _messageHandler (packet) {
        // console.log('got packet', packet)
        if (packet.type === 'event') {
            if (!this.closed) {
                this._emit(packet.event, ...packet.args)
            }
        } else if (packet.type === 'call') {
            if (this.closed) {
                this._send({ type: 'response', id, error: new Error('ERR_IPC_CHANNEL_CLOSED') });
                return;
            }
            const id = packet.id;
            const rid = uniqueCounter++;
            this._responses[rid] = this._exec(packet.name, packet.args)
                .then(result => ({ type: 'response', id, result }))
                .catch(error => ({ type: 'response', id, error: {
                    code: error.code,
                    message: error.message,
                    stack: error.stack,
                }}))
                .then(message => this._send(message))
                .then(() => delete this._responses[rid])
        } else if (packet.type === 'response') {
            const id = packet.id;
            if (Object.prototype.hasOwnProperty.call(this._callbacks, id)) {
                const callback = this._callbacks[id];
                delete this._callbacks[id];
                if (packet.error) {
                    const error = new Error(packet.error.message);
                    if (packet.error.code) error.code = packet.error.code;
                    error.stack = packet.error.stack;
                    callback.reject(error);
                }
                else callback.resolve(packet.result);
            } else {
                console.log(`Warning: Unknown response packet`, packet)
            }
        }
    }

    emit (event, ...args) {
        if (this.closed) throw new Error('ERR_IPC_CHANNEL_CLOSED')
        return this._send({ type: 'event', event, args });
    }

    once (event, listener) {
        if (listener) return super.once(event, listener)
        return new Promise((resolve, reject) => {
            const handlers = {
                error: reject,
                disconnect: () => reject(new Error('ERR_IPC_CHANNEL_CLOSED')),
            }
            handlers[event] = resolve
            Object.keys(handlers).forEach(event => {
                const func = handlers[event];
                handlers[event] = (...args) => {
                    for (let e in handlers) {
                        this.removeListener(e, handlers[e])
                    }
                    func.apply(null, args)
                }
            })
            Object.keys(handlers).forEach(event => {
                this.once(event, handlers[event])
            })
        })
    }

    send (message) {
        return this.emit('message', message);
    }

    async call (name, ...args) {
        const id = uniqueCounter++;
        if (this.closed) throw new Error('ERR_IPC_CHANNEL_CLOSED')
        let resolve, reject;
        const promise = new Promise((_resolve, _reject) => {
            resolve = _resolve;
            reject = _reject;
        });
        this._callbacks[id] = { promise, resolve, reject }
        this._send({ type: 'call', id, name, args })
        return promise;
    }

    func (name, func) {
        if (Object.prototype.hasOwnProperty.call(this._functions, name)) {
            throw new SyntaxError(`Function '${name}' has already been declared`)
        }
        this._functions[name] = func;
    }

    async close () {
        if (this.closed) return;
        this.closed = true;
        const promises = []
        for (let id in this._callbacks) {
            if (!Object.prototype.hasOwnProperty.call(this._callbacks, id)) {
                continue
            }
            promises.push(this._callbacks[id].promise)
        }
        for (let id in this._responses) {
            if (!Object.prototype.hasOwnProperty.call(this._responses, id)) {
                continue
            }
            promises.push(this._responses[id])
        }
        await Promise.allSettled(promises);
        this.destroy();
    }

    destroy (reason) {
        reason = reason || new Error('Cancelled');
        if (this.transport === null) return;
        for (let id in this._callbacks) {
            if (!Object.prototype.hasOwnProperty.call(this._callbacks, id)) {
                continue
            }
            this._callbacks[id].reject(reason)
        }
        this._callbacks = {}
        this._responses = {}
        this.removeAllListeners();
        this.transport.removeListener('message', this.__messageHandler);
        this.transport.removeListener('error', this.__errorHandler);
        this.transport.removeListener('disconnect', this.__disconnectHandler);
        this.transport = null;
    }
}


exports.IPC = IPC;
