class DoubleSignals {
    constructor(db, config) {
        this.db = db;
        this.minConfidence = config.signalConfidenceMin || 55;
    }

    async generateSignals(analysisResult) {
        if (!analysisResult || !analysisResult.allPredictions) return [];

        // Pega o ID do ultimo jogo salvo (referencia para verificacao)
        const [lastGameRow] = await this.db.execute(
            'SELECT id FROM game_history_double ORDER BY id DESC LIMIT 1'
        );
        const refGameId = lastGameRow.length > 0 ? lastGameRow[0].id : null;

        const signals = [];

        for (const prediction of analysisResult.allPredictions) {
            if (prediction.confidence < this.minConfidence) continue;

            // Evita duplicado: mesma estrategia + mesma cor nos ultimos 30s
            const [lastSignal] = await this.db.execute(
                `SELECT id, created_at FROM signals WHERE game_type = 'double'
                 AND strategy_used = ? AND predicted_color = ?
                 ORDER BY created_at DESC LIMIT 1`,
                [prediction.strategy, prediction.color]
            );

            if (lastSignal.length > 0) {
                const timeDiff = Date.now() - new Date(lastSignal[0].created_at).getTime();
                if (timeDiff < 30000) continue;
            }

            try {
                const [result] = await this.db.execute(
                    `INSERT INTO signals (game_type, predicted_color, confidence, strategy_used, ref_game_db_id)
                     VALUES ('double', ?, ?, ?, ?)`,
                    [prediction.color, prediction.confidence, prediction.strategy, refGameId]
                );

                signals.push({
                    id: result.insertId,
                    game_type: 'double',
                    predicted_color: prediction.color,
                    color_name: this.colorName(prediction.color),
                    confidence: prediction.confidence,
                    strategy: prediction.strategy,
                    reason: prediction.reason,
                    created_at: new Date()
                });

                console.log(`  >> ${prediction.strategy}: ${this.colorName(prediction.color)} (${prediction.confidence}%) [ref:${refGameId}]`);
            } catch (insertErr) {
                // Se ref_game_db_id nao existe, tenta sem
                const [result] = await this.db.execute(
                    `INSERT INTO signals (game_type, predicted_color, confidence, strategy_used)
                     VALUES ('double', ?, ?, ?)`,
                    [prediction.color, prediction.confidence, prediction.strategy]
                );
                signals.push({
                    id: result.insertId,
                    game_type: 'double',
                    predicted_color: prediction.color,
                    color_name: this.colorName(prediction.color),
                    confidence: prediction.confidence,
                    strategy: prediction.strategy,
                    reason: prediction.reason,
                    created_at: new Date()
                });
                console.log(`  >> ${prediction.strategy}: ${this.colorName(prediction.color)} (${prediction.confidence}%)`);
            }
        }

        if (signals.length > 0) {
            console.log(`[Signals] ${signals.length} sinais gerados`);
        }

        return signals;
    }

    async verifyLastSignals() {
        const [pendingSignals] = await this.db.execute(
            `SELECT * FROM signals
             WHERE result = 'pending' AND game_type = 'double'
             ORDER BY created_at DESC LIMIT 50`
        );

        if (pendingSignals.length === 0) return 0;

        console.log(`[Verify] Checando ${pendingSignals.length} sinais pendentes...`);

        let wins = 0, losses = 0;
        for (const signal of pendingSignals) {
            let nextGame = null;

            // Metodo 1: Usa ref_game_db_id (mais confiavel, sem problema de timezone)
            if (signal.ref_game_db_id) {
                const [rows] = await this.db.execute(
                    `SELECT * FROM game_history_double WHERE id > ? ORDER BY id ASC LIMIT 1`,
                    [signal.ref_game_db_id]
                );
                if (rows.length > 0) nextGame = rows[0];
            }

            // Metodo 2: Fallback - pega o jogo mais recente adicionado ao DB depois do sinal
            if (!nextGame) {
                const [rows] = await this.db.execute(
                    `SELECT * FROM game_history_double
                     WHERE id > (
                         SELECT COALESCE(MAX(gh.id), 0) FROM game_history_double gh
                         WHERE gh.created_at <= ?
                     )
                     ORDER BY id ASC LIMIT 1`,
                    [signal.created_at]
                );
                if (rows.length > 0) nextGame = rows[0];
            }

            // Metodo 3: Ultimo fallback - compara played_at direto
            if (!nextGame) {
                const [rows] = await this.db.execute(
                    `SELECT * FROM game_history_double
                     WHERE played_at > DATE_SUB(?, INTERVAL 3 HOUR)
                     AND played_at > ?
                     ORDER BY played_at ASC LIMIT 1`,
                    [signal.created_at, signal.created_at]
                );
                if (rows.length > 0) nextGame = rows[0];
            }

            if (nextGame) {
                const isWin = Number(nextGame.color) === Number(signal.predicted_color);

                await this.db.execute(
                    `UPDATE signals SET result = ?, actual_color = ? WHERE id = ?`,
                    [isWin ? 'win' : 'loss', nextGame.color, signal.id]
                );

                const colorName = this.colorName(signal.predicted_color);
                const actualName = this.colorName(nextGame.color);
                console.log(`  [${isWin ? 'WIN' : 'LOSS'}] Sinal #${signal.id} ${signal.strategy_used}: previu ${colorName}, saiu ${actualName}`);

                if (isWin) wins++; else losses++;
            }
        }

        if (wins + losses > 0) {
            console.log(`[Verify] Resultado: ${wins} WIN / ${losses} LOSS`);
        } else if (pendingSignals.length > 0) {
            console.log(`[Verify] Aguardando proxima rodada para verificar...`);
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
        return names[color] || names[Number(color)] || '?';
    }
}

module.exports = DoubleSignals;
