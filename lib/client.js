var EventEmitter = require('events').EventEmitter;
var pool = require('./object-pool');
var debug = true;

function Client(settings) {
    var self = this;
    this.chunkCache = {};
    this.settings = settings;
    this.server = settings.server;
    // These will be set later
    this.id = null;
    this.player = null;
    this.players = null;
    this.game = null;
    this.connected = false;
    this.emitter = new EventEmitter();
    this.receivedChunks = [];

    this.worker = new Worker('/client-worker.js');

    this.bindEvents();
    this.otherSetup();

    this.worker.postMessage(['connect'])
}

// Listen for certain events/data from the server
Client.prototype.bindEvents = function() {
    var self = this;

    this.worker.onmessage = function(e) {
        var message = e.data;
        var type = message.shift();

        var handlers = {
            open: function() {
                self.connected = true;
                if (debug) {
                    console.log('connection opened');
                }
                self.emitter.emit('open');
            },
            close: function() {
                self.connected = false;
                if (debug) {
                    console.log('connection closed');
                }
                self.emitter.emit('close');
            },
            error: function(message) {
                console.log(message);
            },
            settings: function(settings, id) {
                // merge settings from server into those from the client side
                // TODO: fix this for new engine setup
                //self.settings = extend(self.settings, settings) // server settings squash client settings
                if (debug) {
                    console.log('Got settings');
                    console.log(settings);
                }
                if ('initialPosition' in settings) {
                    self.settings.initialPosition = settings.initialPosition;
                }
                self.id = id;
                //self.player.avatarImage = avatarImage
                if (debug) {
                    console.log('got id ' + id);
                }
                // setup complete, do we need to do additional engine setup?
                self.emitter.emit('ready');
            },

            chunk: function(chunk) {
                if (debug) {
                    console.log('Received chunk', chunk);
                }
                self.game.cacheAndDrawChunk(chunk);
            },
            // Chunk was re-meshed
            chunkMesh: function(chunkID, mesh) {
                if (chunkID in self.chunkCache) {
                    var chunk = self.chunkCache[chunkID];
                    var oldMesh = chunk.mesh;
                    chunk.mesh = mesh;
                    self.game.cacheAndDrawChunk(chunk);

                    // Release old mesh
                    var transferList = [];
                    for (var textureValue in oldMesh) {
                        var texture = oldMesh[textureValue];
                        // Go past the Growable, to the underlying ArrayBuffer
                        transferList.push(texture.position.buffer);
                        transferList.push(texture.texcoord.buffer);
                        transferList.push(texture.normal.buffer);
                    }
                    // specially list the ArrayBuffer object we want to transfer
                    self.worker.postMessage(
                        ['freeMesh', mesh],
                        transferList
                    );
                }
            },
            // First batch of chunks processed and ready for drawing, turn on WebGL and Physics
            chunksProcessed: function() {
                self.emitter.emit('hasChunks');
            },

            // Worker relays voxel changes from the server to us
            chunkVoxelIndexValue: function(changes) {
                self.updateVoxelCache(changes);
            },

            chat: function(message) {
                var messages = document.getElementById('messages');
                var el = document.createElement('dt');
                el.innerText = message.user;
                messages.appendChild(el);
                el = document.createElement('dd');
                el.innerText = message.text;
                messages.appendChild(el);
                messages.scrollTop = messages.scrollHeight;
            },

            // Got batch of player position updates
            players: function(players) {
                delete players[self.id];
                self.emitter.emit('players', players);
                return;
                Object.keys(players).map(function(player) {
                    var update = updates.positions[player];
                    if (player === self.playerID) {
                        return;
                    }
                    // TODO: is this a new player? modify our players data structure
                    // TODO: prune players that have left: we didn't get have updates from
                    // TODO: where is this method?
                    // TODO: use update.position (which now includes X and Y rotations)
                    self.setPlayerTargetPosition(player, update);
                });
            }
        };

        handlers[type].apply(self, message);
    };
    
};

Client.prototype.otherSetup = function() {
    var self = this;

    // TODO: send position to web worker
    setInterval(function() {
        if (!self.player) return;
        self.worker.postMessage(
            ['playerPosition', self.player.getPosition(), self.player.getYaw(), self.player.getPitch() ]
        );
    }, 1000 / 10);
};

// Called internally when voxels change
Client.prototype.updateVoxelCache = function(changes) {
    var self = this;
    for (var chunkID in changes) {
        if (chunkID in self.chunkCache) {
            var chunk = self.chunkCache[chunkID];
            var details = changes[chunkID];
            for (var i = 0; i < details.length; i += 2) {
                var index = details[i];
                var val = details[i + 1];
                chunk.voxels[index] = val;
            }
        }
    }
};

Client.prototype.on = function(name, callback) {
    this.emitter.on(name, callback);
};

module.exports = Client;