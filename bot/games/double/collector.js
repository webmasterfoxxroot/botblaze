const axios = require('axios');

class DoubleCollector {
    constructor(db, config) {
        this.db = db;
        this.apiUrl = config.apiUrl;
        this.timer = null;
        this.lastGameId = null;
        this.onNewGame = null; // callback quando detecta jogo novo
        this.collecting = false; // evita coletas sobrepostas
    }

    async fetchRecent() {
        try {
            // Cache-busting: adiciona timestamp para evitar cache da API
            const separator = this.apiUrl.includes('?') ? '&' : '?';
            const url = `${this.apiUrl}${separator}_t=${Date.now()}`;

            const response = await axios.get(url, {
                timeout: 5000, // 5s timeout (era 8s)
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

    async saveGames(games) {
        if (!games.length) return 0;

        let saved = 0;
        const query = `
            INSERT IGNORE INTO game_history_double (game_id, color, roll, server_seed, played_at)
            VALUES (?, ?, ?, ?, ?)
        `;

        for (const game of games) {
            try {
                const [result] = await this.db.execute(query, [
                    game.id,
                    game.color,
                    game.roll,
                    game.server_seed,
                    new Date(game.created_at)
                ]);
                if (result.affectedRows > 0) saved++;
            } catch (err) {
                if (err.code !== 'ER_DUP_ENTRY') {
                    console.error('[Collector] Erro ao salvar:', err.message);
                }
            }
        }
        return saved;
    }

    async getTotalGames() {
        const [rows] = await this.db.execute(
            'SELECT COUNT(*) as total FROM game_history_double'
        );
        return rows[0].total;
    }

    async collect() {
        // Evita coletas sobrepostas
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

            // JOGO NOVO DETECTADO!
            const colorNames = { 0: 'BRANCO', 1: 'VERMELHO', 2: 'PRETO' };
            const newest = games[0];

            // Calcula atraso: quanto tempo entre o jogo ter sido criado e nos detectarmos
            const gameTime = new Date(newest.created_at).getTime();
            const delay = ((Date.now() - gameTime) / 1000).toFixed(1);

            console.log(`\n[NOVO JOGO] Roll ${newest.roll} = ${colorNames[newest.color]} (ID: ${newestId})`);
            console.log(`[Timing] API: ${fetchTime}ms | Atraso desde jogo: ${delay}s`);

            this.lastGameId = newestId;
            const saved = await this.saveGames(games);
            const total = await this.getTotalGames();
            console.log(`[Collector] Salvou ${saved} novos | Total: ${total}`);

            // Dispara callback IMEDIATAMENTE
            if (this.onNewGame) {
                const callbackStart = Date.now();
                await this.onNewGame(newest);
                console.log(`[Timing] Callback completo em ${Date.now() - callbackStart}ms`);
            }

            this.collecting = false;
            return true;
        } catch (err) {
            console.error('[Collector] Erro collect:', err.message);
            this.collecting = false;
            return false;
        }
    }

    start() {
        // Polling RAPIDO: checa a cada 3 segundos se tem jogo novo
        console.log('[Collector] Monitorando API a cada 3s...');
        this.collect();
        this.timer = setInterval(() => this.collect(), 3000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = DoubleCollector;
