var WebSocket = require('ws');
var EventEmitter = require('events').EventEmitter;
var slice = Array.prototype.slice;
var debug = false;

/*
TODO

* Outline events on the client and server sides. Can remap node events to something that makes more sense given the context

*/
function WebSocketEmitter(webSocket, emitter) {
    this.webSocket = webSocket;
    this.emitter = emitter;
    var self = this;
    // NOTE: I don't want to expose access to the socket
    var browserify = 'binaryType' in webSocket;

    var onOpen = function() {
        if (debug) {
            console.log('onOpen');
        }
        emitter.emit('open');
    };

    var onMessage = function(data, flags) {
        if (debug) {
            console.log('onMessage');
        }
        var decoded;
        // flags.binary will be set if a binary data is received.
        // flags.masked will be set if the data was masked.
        if (!data) {
            console.log('WebSocketEmitter received empty data');
            return;
        }
        try {
            decoded = JSON.parse(data);
        } catch (err) {
            console.log('WebSocketEmitter error while decoding JSON');
            //console.log(data)
            return;
        }
        emitter.emit.apply(emitter, decoded);
    };

    var onError = function(message) {
        if (debug) {
            console.log('onError');
        }
        emitter.emit('error', message);
    };

    var onClose = function() {
        if (debug) {
            console.log('onClose');
        }
        self.webSocket = null;
        emitter.emit('close');
    };

    if (debug) {
        console.log('browserify', browserify);
    }

    if (browserify) {
        // handle browserify WebSocket version
        webSocket.onerror = onError;
        // Yes, this will only get used for client connections, but setting this for an incoming server connection shouldn't hurt
        webSocket.onopen = onOpen;
        webSocket.onclose = onClose;
        webSocket.onmessage = function(event, flags) {
            if (debug) {
                console.log('onmessage');
            }
            if (event.data instanceof Blob) {
                var reader = new FileReader();
                reader.addEventListener('loadend', function() {
                    onMessage.call(null, reader.result, flags);
                });
                reader.readAsText(event.data);
            } else {
                console.log('Unexpected data type');
            }
        };

    } else {
        webSocket.on('error', onError);
        // Yes, this will only get used for client connections, but setting this for an incoming server connection shouldn't hurt
        webSocket.on('open', onOpen);
        webSocket.on('close', onClose);
        webSocket.on('message', onMessage);
    }
}

WebSocketEmitter.prototype.emit = function(name, callback) {
    var self = this;

    if (debug) {
        console.log('emit');
    }

    if (!name) {
        throw new Exception('name required');
    }

    if (!this.webSocket) {
        self.emitter.emit('error', 'Cannot emit, connection is not open');
        return;
    }

    // hah, right! http needs newline to terminate data
    var str = JSON.stringify(slice.apply(arguments)) + "\n";
    this.webSocket.send(
        str,
        {
            binary: true,
            mask: false
        },
        function(error) {
            if (error) {
                self.emitter.emit('error', 'Emit error: ' + error);
                return;
            }
            if (debug) {
                console.log('WebSocketEmitter sent data: ' + str);
            }
        }
    );
};

WebSocketEmitter.prototype.on = function(name, callback) {
    this.emitter.on(name, callback);
};

WebSocketEmitter.prototype.close = function() {
    this.webSocket.close();
};

function Client() {
    this.emitter = new EventEmitter();
    this.wse = null;
}

// TODO: hoist onError, onMessage helper methods up so server can use them too
Client.prototype.connect = function(url) {
    var self = this;
    // Don't need to specify URL if we did previously
    this.url = url || this.url;
    var ws = new WebSocket(this.url);
    this.wse = new WebSocketEmitter(ws, this.emitter);
};

Client.prototype.on = function(name, callback) {
    this.emitter.on(name, callback);
};

Client.prototype.emit = function() {
    if (this.wse) {
        this.wse.emit.apply(this.wse, arguments);
    } else {
        console.log('Premature emit. Not connected yet');
    }
};

Client.prototype.close = function() {
    if (this.wse) {
        this.wse.close();
    } else {
        console.log('Premature close. Not connected yet');
    }
};

// Same opts you'd pass to ws module
function Server(opts) {
    var self = this;
    var wss = this.ws = new WebSocket.Server(opts || {
        port: 10005
    });
    var browserify = 'onconnection' in wss;

    this.emitter = new EventEmitter();

    var onError = function(message) {
        if (debug) {
            console.log('onError');
        }
        emitter.emit('error', message);
    };

    var onConnection = function(ws) {
        if (debug) {
            console.log('onConnection');
        }
        //var location = url.parse(ws.upgradeReq.url, true);
        var emitter = new EventEmitter();
        var wse = new WebSocketEmitter(ws, emitter);
        self.emitter.emit('connection', wse);
    };

    console.log('browserify', browserify);
    
    if (browserify) {
        wss.onconnection = onConnection;
        wss.onerror = onError;
    } else {
        wss.on('connection', onConnection);
        wss.on('error', onError);
    }
}

Server.prototype.on = function(name, callback) {
    this.emitter.on(name, callback);
};

module.exports = {
    client: Client,
    server: Server
};