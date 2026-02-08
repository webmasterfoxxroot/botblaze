const axios = require('axios');
const BlazeStream = require('./blaze-stream');

class DoubleCollector {
    constructor(db, config) {
        this.db = db;
        this.apiUrl = config.apiUrl;
        this.timer = null;
        this.lastGameId = null;
        this.onNewGame = null;       // callback quando detecta jogo novo (resultado)
        this.onGamePhase = null;     // callback para fase do jogo (waiting/rolling/complete)
        this.collecting = false;
        this.pollInterval = 3;       // segundos (atualizado pelo bot)

        // Blaze WebSocket stream (tempo real)
        this.stream = null;
        this.wsEnabled = true;
        this.gamePhase = 'waiting';  // waiting, rolling, complete
        this.lastPhaseTime = Date.now();
    }

    // Inicia WebSocket da Blaze (chamado pelo bot apos carregar settings)
    startStream(wsUrl) {
        if (!wsUrl) {
            console.log('[Collector] WS URL nao configurada, usando apenas HTTP polling');
            return;
        }

        this.stream = new BlazeStream({ wsUrl });

        // Quando recebe resultado do jogo via WebSocket
        this.stream.onGameComplete = async (game) => {
            console.log(`[Collector] WS: Jogo recebido Roll ${game.roll} Color ${game.color}`);
            await this.processNewGame(game);
        };

        // Quando o status do jogo muda (para animacao no frontend)
        this.stream.onGameStatus = (event) => {
            const status = event.status;
            let phase = 'waiting';
            if (status === 'rolling' || status === 'spinning') phase = 'rolling';
            else if (status === 'complete' || status === 'finished') phase = 'complete';
            else if (status === 'waiting' || status === 'betting') phase = 'waiting';

            if (phase !== this.gamePhase) {
                this.gamePhase = phase;
                this.lastPhaseTime = Date.now();
                if (this.onGamePhase) {
                    this.onGamePhase({ phase, game: event.game, timestamp: new Date() });
                }
            }
        };

        this.stream.connect();
    }

    stopStream() {
        if (this.stream) {
            this.stream.disconnect();
            this.stream = null;
        }
    }

    async fetchRecent() {
        try {
            const separator = this.apiUrl.includes('?') ? '&' : '?';
            const url = `${this.apiUrl}${separator}_t=${Date.now()}`;

            const response = await axios.get(url, {
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://blaze.bet.br/',
                    'Cache-Control': 'no-cache, no-store',
                    'Pragma': 'no-cache'
                }
            });
            return response.data || [];
        } catch (error) {
            console.error('[Collector] Erro fetch:', error.message);
            return [];
        }
    }

    async saveGame(game) {
        const query = `
            INSERT IGNORE INTO game_history_double (game_id, color, roll, server_seed, played_at)
            VALUES (?, ?, ?, ?, ?)
        `;
        try {
            const [result] = await this.db.execute(query, [
                game.id,
                game.color,
                game.roll,
                game.server_seed,
                new Date(game.created_at)
            ]);
            return result.affectedRows > 0;
        } catch (err) {
            if (err.code !== 'ER_DUP_ENTRY') {
                console.error('[Collector] Erro ao salvar:', err.message);
            }
            return false;
        }
    }

    async saveGames(games) {
        if (!games.length) return 0;
        let saved = 0;
        for (const game of games) {
            if (await this.saveGame(game)) saved++;
        }
        return saved;
    }

    async getTotalGames() {
        const [rows] = await this.db.execute(
            'SELECT COUNT(*) as total FROM game_history_double'
        );
        return rows[0].total;
    }

    // Processa um jogo novo (chamado pelo WS ou HTTP polling)
    async processNewGame(game) {
        if (!game || !game.id) return false;

        // Ja processamos esse jogo?
        if (game.id === this.lastGameId) return false;

        const colorNames = { 0: 'BRANCO', 1: 'VERMELHO', 2: 'PRETO' };
        const source = game.source || 'http';

        console.log(`\n[NOVO JOGO] Roll ${game.roll} = ${colorNames[game.color]} (ID: ${game.id}) via ${source.toUpperCase()}`);

        // Calcula atraso
        if (game.created_at) {
            const gameTime = new Date(game.created_at).getTime();
            const delay = ((Date.now() - gameTime) / 1000).toFixed(1);
            console.log(`[Timing] Atraso desde jogo: ${delay}s`);
        }

        this.lastGameId = game.id;

        // Salva no banco
        const saved = await this.saveGame(game);
        const total = await this.getTotalGames();
        console.log(`[Collector] ${saved ? 'Salvo' : 'Ja existia'} | Total: ${total}`);

        // Dispara callback
        if (this.onNewGame) {
            const callbackStart = Date.now();
            await this.onNewGame(game);
            console.log(`[Timing] Callback completo em ${Date.now() - callbackStart}ms`);
        }

        return true;
    }

    // HTTP polling - fallback quando WS nao esta disponivel
    async collect() {
        if (this.collecting) return false;
        this.collecting = true;

        try {
            const fetchStart = Date.now();
            const games = await this.fetchRecent();
            const fetchTime = Date.now() - fetchStart;

            if (!games.length) {
                this.collecting = false;
                return false;
            }

            const newestId = games[0]?.id;

            // Primeira execucao: salva tudo e memoriza
            if (this.lastGameId === null) {
                this.lastGameId = newestId;
                const saved = await this.saveGames(games);
                const total = await this.getTotalGames();
                console.log(`[Collector] Inicial: Salvou ${saved} | Total: ${total} | API: ${fetchTime}ms`);
                this.collecting = false;
                return saved > 0;
            }

            // Sem jogo novo
            if (newestId === this.lastGameId) {
                this.collecting = false;
                return false;
            }

            // JOGO NOVO via HTTP!
            const newest = games[0];
            newest.source = 'http';

            // Salva todos os jogos que vieram (podem ter pulado algum)
            await this.saveGames(games);

            await this.processNewGame(newest);

            this.collecting = false;
            return true;
        } catch (err) {
            console.error('[Collector] Erro collect:', err.message);
            this.collecting = false;
            return false;
        }
    }

    // Retorna info de status para o frontend
    getStatus() {
        return {
            wsConnected: this.stream ? this.stream.isConnected() : false,
            lastGameId: this.lastGameId,
            gamePhase: this.gamePhase,
            lastPhaseTime: this.lastPhaseTime,
            pollInterval: this.pollInterval
        };
    }

    start() {
        console.log(`[Collector] Monitorando API a cada ${this.pollInterval}s...`);
        this.collect();
        this.timer = setInterval(() => this.collect(), this.pollInterval * 1000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }

    stopAll() {
        this.stop();
        this.stopStream();
    }
}

module.exports = DoubleCollector;
