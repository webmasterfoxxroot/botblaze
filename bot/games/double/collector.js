const axios = require('axios');

class DoubleCollector {
    constructor(db, config) {
        this.db = db;
        this.apiUrl = config.apiUrl;
        this.timer = null;
        this.lastGameId = null;
        this.onNewGame = null;          // callback: jogo novo detectado
        this.onSyncUpdate = null;       // callback: envia estado completo pro frontend
        this.collecting = false;
        this.pollInterval = 1;          // segundos

        // Sincronizacao com a Blaze
        this.blazeGames = [];           // lista completa da API (espelho)
        this.cycleTime = 30;            // tempo medio entre jogos (calculado automaticamente)
        this.lastGameTime = null;       // timestamp do ultimo jogo detectado
        this.nextGameEstimate = null;   // quando o proximo jogo deve aparecer
        this.cycleHistory = [];         // historico de ciclos para media movel
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

    // Calcula o ritmo da Blaze a partir dos timestamps dos jogos
    calculateCycleTime(games) {
        if (!games || games.length < 3) return;

        const intervals = [];
        for (let i = 0; i < Math.min(games.length - 1, 10); i++) {
            const t1 = new Date(games[i].created_at).getTime();
            const t2 = new Date(games[i + 1].created_at).getTime();
            const diff = (t1 - t2) / 1000; // segundos
            if (diff > 10 && diff < 120) {  // so aceita intervalos razoaveis
                intervals.push(diff);
            }
        }

        if (intervals.length === 0) return;

        // Media dos intervalos = tempo do ciclo
        const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
        this.cycleTime = Math.round(avg);

        console.log(`[Sync] Ciclo Blaze: ${this.cycleTime}s (calculado de ${intervals.length} intervalos: ${intervals.map(i => i.toFixed(0) + 's').join(', ')})`);
    }

    // Estima quando o proximo jogo vai aparecer na API
    estimateNextGame() {
        if (!this.lastGameTime) return null;
        this.nextGameEstimate = this.lastGameTime + (this.cycleTime * 1000);
        return this.nextGameEstimate;
    }

    // Retorna quantos segundos faltam para o proximo jogo
    getSecondsToNext() {
        if (!this.nextGameEstimate) return null;
        const remaining = (this.nextGameEstimate - Date.now()) / 1000;
        return Math.max(0, Math.round(remaining));
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

    // Monta o estado completo para enviar ao frontend
    buildSyncState(newGame) {
        return {
            games: this.blazeGames,         // lista completa da API (espelho)
            newGame: newGame || null,        // jogo novo (se acabou de detectar)
            cycleTime: this.cycleTime,       // tempo do ciclo em segundos
            lastGameTime: this.lastGameTime, // timestamp do ultimo jogo
            nextGameEstimate: this.nextGameEstimate,
            secondsToNext: this.getSecondsToNext(),
            timestamp: Date.now()
        };
    }

    // Envia estado completo para o frontend
    broadcastSync(newGame) {
        if (this.onSyncUpdate) {
            this.onSyncUpdate(this.buildSyncState(newGame));
        }
    }

    // Polling principal - le a API e detecta mudancas
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

            // Atualiza espelho da API
            this.blazeGames = games;

            const newestId = games[0]?.id;

            // === PRIMEIRA EXECUCAO: aprende o ritmo ===
            if (this.lastGameId === null) {
                this.lastGameId = newestId;
                this.lastGameTime = new Date(games[0].created_at).getTime();

                // Calcula ciclo a partir do historico da API
                this.calculateCycleTime(games);
                this.estimateNextGame();

                const saved = await this.saveGames(games);
                const total = await this.getTotalGames();
                console.log(`[Collector] Inicial: ${saved} salvos | Total: ${total} | API: ${fetchTime}ms`);
                console.log(`[Sync] Proximo jogo estimado em ~${this.getSecondsToNext()}s`);

                // Envia estado inicial para dashboards
                this.broadcastSync(null);

                this.collecting = false;
                return saved > 0;
            }

            // === SEM JOGO NOVO: atualiza countdown ===
            if (newestId === this.lastGameId) {
                // Envia update de timing (countdown atualizado)
                this.broadcastSync(null);
                this.collecting = false;
                return false;
            }

            // === JOGO NOVO DETECTADO! ===
            const newest = games[0];
            const colorNames = { 0: 'BRANCO', 1: 'VERMELHO', 2: 'PRETO' };

            // Calcula atraso real
            const newGameTime = new Date(newest.created_at).getTime();
            const delay = ((Date.now() - newGameTime) / 1000).toFixed(1);

            // Atualiza ciclo real (diferenca entre este jogo e o anterior)
            if (this.lastGameTime) {
                const realCycle = (newGameTime - this.lastGameTime) / 1000;
                if (realCycle > 10 && realCycle < 120) {
                    this.cycleHistory.push(realCycle);
                    if (this.cycleHistory.length > 20) this.cycleHistory.shift();

                    // Media movel dos ultimos ciclos reais
                    const avg = this.cycleHistory.reduce((a, b) => a + b, 0) / this.cycleHistory.length;
                    this.cycleTime = Math.round(avg);
                }
            }

            console.log(`\n[NOVO JOGO] Roll ${newest.roll} = ${colorNames[newest.color]} (ID: ${newestId})`);
            console.log(`[Timing] API: ${fetchTime}ms | Atraso: ${delay}s | Ciclo: ${this.cycleTime}s`);

            this.lastGameId = newestId;
            this.lastGameTime = newGameTime;

            // Estima proximo jogo
            this.estimateNextGame();
            console.log(`[Sync] Proximo jogo em ~${this.getSecondsToNext()}s`);

            // Salva no banco
            await this.saveGames(games);
            const total = await this.getTotalGames();
            console.log(`[Collector] Total: ${total}`);

            // Envia estado completo com jogo novo para dashboards
            this.broadcastSync(newest);

            // Dispara callback para analise/sinais
            if (this.onNewGame) {
                const callbackStart = Date.now();
                await this.onNewGame(newest);
                console.log(`[Timing] Analise completa em ${Date.now() - callbackStart}ms`);
            }

            this.collecting = false;
            return true;
        } catch (err) {
            console.error('[Collector] Erro collect:', err.message);
            this.collecting = false;
            return false;
        }
    }

    getStatus() {
        return {
            lastGameId: this.lastGameId,
            cycleTime: this.cycleTime,
            secondsToNext: this.getSecondsToNext(),
            pollInterval: this.pollInterval,
            totalGamesApi: this.blazeGames.length
        };
    }

    start() {
        console.log(`[Collector] Monitorando Blaze API a cada ${this.pollInterval}s...`);
        this.collect();
        this.timer = setInterval(() => this.collect(), this.pollInterval * 1000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = DoubleCollector;
