/**
 * BlazeStream - Conexao direta ao WebSocket da Blaze para receber jogos em tempo real.
 * Usa Socket.IO para conectar ao endpoint de replication da Blaze.
 * Se o WS falhar, o collector continua funcionando via HTTP polling.
 */
const { io } = require('socket.io-client');

class BlazeStream {
    constructor(config = {}) {
        this.wsUrl = config.wsUrl || 'https://api-v2.blaze.com';
        this.wsPath = config.wsPath || '/replication/';
        this.room = config.room || 'double_v2';
        this.socket = null;
        this.connected = false;
        this.reconnecting = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 50;
        this.onGameComplete = null;   // callback: jogo completou (resultado saiu)
        this.onGameStatus = null;     // callback: mudanca de status (waiting, rolling, complete)
        this.lastStatus = null;
    }

    connect() {
        if (this.socket) {
            try { this.socket.disconnect(); } catch (e) {}
        }

        console.log(`[BlazeStream] Conectando ao ${this.wsUrl}...`);

        try {
            this.socket = io(this.wsUrl, {
                transports: ['websocket'],
                path: this.wsPath,
                reconnection: true,
                reconnectionAttempts: this.maxReconnectAttempts,
                reconnectionDelay: 2000,
                reconnectionDelayMax: 15000,
                timeout: 10000,
                forceNew: true
            });

            this.socket.on('connect', () => {
                this.connected = true;
                this.reconnectAttempts = 0;
                console.log(`[BlazeStream] Conectado! Inscrevendo no room ${this.room}...`);

                // Inscreve no room do Double
                this.socket.emit('cmd', {
                    id: 'subscribe',
                    payload: { room: this.room }
                });
            });

            // Evento principal: dados do jogo
            this.socket.on('data', (data) => {
                this.handleData(data);
            });

            // Alguns servidores Blaze usam evento diferente
            this.socket.on('game_status', (data) => {
                this.handleData(data);
            });

            this.socket.on('disconnect', (reason) => {
                this.connected = false;
                console.log(`[BlazeStream] Desconectado: ${reason}`);
            });

            this.socket.on('connect_error', (err) => {
                this.reconnectAttempts++;
                if (this.reconnectAttempts <= 3) {
                    console.log(`[BlazeStream] Erro conexao (tentativa ${this.reconnectAttempts}): ${err.message}`);
                } else if (this.reconnectAttempts === 4) {
                    console.log(`[BlazeStream] WS indisponivel, usando apenas HTTP polling. Tentando reconectar em background...`);
                }
            });

            this.socket.on('reconnect', () => {
                console.log(`[BlazeStream] Reconectado!`);
                this.connected = true;
                this.reconnectAttempts = 0;
                this.socket.emit('cmd', {
                    id: 'subscribe',
                    payload: { room: this.room }
                });
            });

        } catch (err) {
            console.error(`[BlazeStream] Erro ao criar socket: ${err.message}`);
            this.connected = false;
        }
    }

    handleData(data) {
        if (!data) return;

        // Blaze envia diferentes formatos dependendo da versao da API
        // Formato 1: { id, status, roll, color, ... }
        // Formato 2: { payload: { id, status, roll, color, ... } }
        // Formato 3: { data: { id, status, roll, color, ... } }
        const game = data.payload || data.data || data;

        if (!game) return;

        const status = game.status;
        const prevStatus = this.lastStatus;
        this.lastStatus = status;

        // Notifica mudanca de status
        if (status && this.onGameStatus) {
            this.onGameStatus({
                status: status,
                game: game,
                timestamp: new Date()
            });
        }

        // Jogo completou - tem resultado
        if (status === 'complete' || status === 'finished') {
            if (game.id && (game.roll !== undefined || game.color !== undefined)) {
                console.log(`[BlazeStream] Jogo completo: Roll ${game.roll} Color ${game.color} (ID: ${game.id})`);

                if (this.onGameComplete) {
                    this.onGameComplete({
                        id: game.id,
                        color: parseInt(game.color),
                        roll: parseInt(game.roll),
                        server_seed: game.server_seed || null,
                        created_at: game.created_at || new Date().toISOString(),
                        source: 'websocket'
                    });
                }
            }
        }
    }

    updateUrl(wsUrl) {
        if (wsUrl && wsUrl !== this.wsUrl) {
            console.log(`[BlazeStream] URL atualizada: ${this.wsUrl} -> ${wsUrl}`);
            this.wsUrl = wsUrl;
            this.connect(); // Reconecta com nova URL
        }
    }

    disconnect() {
        if (this.socket) {
            try { this.socket.disconnect(); } catch (e) {}
            this.socket = null;
        }
        this.connected = false;
    }

    isConnected() {
        return this.connected && this.socket && this.socket.connected;
    }
}

module.exports = BlazeStream;
