const axios = require('axios');

class DoubleCollector {
    constructor(db, config) {
        this.db = db;
        this.apiUrl = config.apiUrl;
        this.timer = null;
        this.lastGameId = null;
        this.onNewGame = null; // callback quando detecta jogo novo
    }

    async fetchRecent() {
        try {
            const response = await axios.get(this.apiUrl, {
                timeout: 8000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://blaze.bet.br/'
                }
            });
            return response.data || [];
        } catch (error) {
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
        const games = await this.fetchRecent();
        if (!games.length) return false;

        const newestId = games[0]?.id;

        // Primeira execucao: salva tudo e memoriza
        if (this.lastGameId === null) {
            this.lastGameId = newestId;
            const saved = await this.saveGames(games);
            const total = await this.getTotalGames();
            console.log(`[Collector] Inicial: Salvou ${saved} | Total: ${total}`);
            return saved > 0;
        }

        // Sem jogo novo
        if (newestId === this.lastGameId) return false;

        // JOGO NOVO DETECTADO!
        const colorNames = { 0: 'BRANCO', 1: 'VERMELHO', 2: 'PRETO' };
        const newest = games[0];
        console.log(`\n[NOVO JOGO] Roll ${newest.roll} = ${colorNames[newest.color]} (ID: ${newestId})`);

        this.lastGameId = newestId;
        const saved = await this.saveGames(games);
        const total = await this.getTotalGames();
        console.log(`[Collector] Salvou ${saved} novos | Total: ${total}`);

        // Dispara callback IMEDIATAMENTE
        if (this.onNewGame) {
            await this.onNewGame(newest);
        }

        return true;
    }

    start() {
        // Polling rapido: checa a cada 5 segundos se tem jogo novo
        console.log('[Collector] Monitorando API a cada 5s...');
        this.collect();
        this.timer = setInterval(() => this.collect(), 5000);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
}

module.exports = DoubleCollector;
