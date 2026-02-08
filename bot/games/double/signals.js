class DoubleSignals {
    constructor(db, config) {
        this.db = db;
        this.minConfidence = config.signalConfidenceMin || 65;
    }

    // Gera um sinal SEPARADO para cada estrategia
    async generateSignals(analysisResult) {
        if (!analysisResult || !analysisResult.allPredictions) return [];

        const signals = [];

        for (const prediction of analysisResult.allPredictions) {
            if (prediction.confidence < this.minConfidence) continue;

            // Evita duplicado: mesma estrategia + mesma cor nos ultimos 30s
            const [lastSignal] = await this.db.execute(
                `SELECT * FROM signals WHERE game_type = 'double'
                 AND strategy_used = ? AND predicted_color = ?
                 ORDER BY created_at DESC LIMIT 1`,
                [prediction.strategy, prediction.color]
            );

            if (lastSignal.length > 0) {
                const timeDiff = Date.now() - new Date(lastSignal[0].created_at).getTime();
                if (timeDiff < 30000) continue;
            }

            // Salva sinal individual
            const [result] = await this.db.execute(
                `INSERT INTO signals (game_type, predicted_color, confidence, strategy_used)
                 VALUES ('double', ?, ?, ?)`,
                [prediction.color, prediction.confidence, prediction.strategy]
            );

            const signal = {
                id: result.insertId,
                game_type: 'double',
                predicted_color: prediction.color,
                color_name: this.colorName(prediction.color),
                confidence: prediction.confidence,
                strategy: prediction.strategy,
                reason: prediction.reason,
                created_at: new Date()
            };

            signals.push(signal);
            console.log(`  >> ${signal.strategy}: ${signal.color_name} (${signal.confidence}%)`);
        }

        if (signals.length > 0) {
            console.log(`[Signals] ${signals.length} sinais gerados`);
        }

        return signals;
    }

    async verifyLastSignals() {
        const [pendingSignals] = await this.db.execute(
            `SELECT s.* FROM signals s
             WHERE s.result = 'pending' AND s.game_type = 'double'
             AND s.created_at < NOW() - INTERVAL 1 MINUTE
             ORDER BY s.created_at DESC LIMIT 50`
        );

        let wins = 0, losses = 0;
        for (const signal of pendingSignals) {
            const [nextGame] = await this.db.execute(
                `SELECT * FROM game_history_double
                 WHERE played_at > ?
                 ORDER BY played_at ASC LIMIT 1`,
                [signal.created_at]
            );

            if (nextGame.length > 0) {
                const game = nextGame[0];
                const isWin = game.color === signal.predicted_color;

                await this.db.execute(
                    `UPDATE signals SET result = ?, actual_color = ? WHERE id = ?`,
                    [isWin ? 'win' : 'loss', game.color, signal.id]
                );
                if (isWin) wins++; else losses++;
            }
        }

        if (wins + losses > 0) {
            console.log(`[Signals] Verificou ${wins + losses} sinais: ${wins} WIN / ${losses} LOSS`);
        }
        return wins + losses;
    }

    async getStats() {
        const [stats] = await this.db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending
            FROM signals WHERE game_type = 'double'
        `);

        const s = stats[0];
        const decided = (Number(s.wins) || 0) + (Number(s.losses) || 0);
        return {
            total: Number(s.total) || 0,
            wins: Number(s.wins) || 0,
            losses: Number(s.losses) || 0,
            pending: Number(s.pending) || 0,
            winRate: decided > 0 ? ((Number(s.wins) / decided) * 100).toFixed(1) : 0
        };
    }

    async getStatsByStrategy() {
        const [rows] = await this.db.execute(`
            SELECT
                strategy_used,
                COUNT(*) as total,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
            FROM signals WHERE game_type = 'double'
            GROUP BY strategy_used
            ORDER BY strategy_used
        `);

        return rows.map(r => {
            const decided = (Number(r.wins) || 0) + (Number(r.losses) || 0);
            return {
                strategy: r.strategy_used,
                total: Number(r.total) || 0,
                wins: Number(r.wins) || 0,
                losses: Number(r.losses) || 0,
                winRate: decided > 0 ? ((Number(r.wins) / decided) * 100).toFixed(1) : '0'
            };
        });
    }

    colorName(color) {
        const names = { 0: 'BRANCO', 1: 'VERMELHO', 2: 'PRETO' };
        return names[color] || '?';
    }
}

module.exports = DoubleSignals;
