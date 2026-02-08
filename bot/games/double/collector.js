const axios = require('axios');

class DoubleCollector {
    constructor(db, config) {
        this.db = db;
        this.apiUrl = config.apiUrl;
        this.interval = config.collectInterval || 30000;
        this.timer = null;
        this.lastGameId = null;
    }

    async fetchRecent() {
        try {
            const response = await axios.get(this.apiUrl, {
                timeout: 10000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': 'application/json',
                    'Referer': 'https://blaze.bet.br/'
                }
            });
            return response.data || [];
        } catch (error) {
            console.error('[Collector] Erro ao buscar dados:', error.message);
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

    async getLast50() {
        const [rows] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 50'
        );
        return rows;
    }

    async getTotalGames() {
        const [rows] = await this.db.execute(
            'SELECT COUNT(*) as total FROM game_history_double'
        );
        return rows[0].total;
    }

    async collect() {
        const games = await this.fetchRecent();
        if (!games.length) return { fetched: 0, saved: 0 };

        const newFirst = games[0]?.id;
        if (newFirst === this.lastGameId) {
            return { fetched: games.length, saved: 0, message: 'Sem rodadas novas' };
        }

        this.lastGameId = newFirst;
        const saved = await this.saveGames(games);
        const total = await this.getTotalGames();

        console.log(`[Collector] Buscou ${games.length} | Salvou ${saved} novos | Total: ${total}`);
        return { fetched: games.length, saved, total };
    }

    start() {
        console.log(`[Collector] Iniciando coleta a cada ${this.interval / 1000}s...`);
        this.collect();
        this.timer = setInterval(() => this.collect(), this.interval);
    }

    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
            console.log('[Collector] Coleta parada.');
        }
    }
}

module.exports = DoubleCollector;
