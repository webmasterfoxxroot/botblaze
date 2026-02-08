class DoubleSignals {
    constructor(db, config) {
        this.db = db;
        this.minConfidence = config.signalConfidenceMin || 65;
        this.lastSignalId = null;
    }

    async generateSignal(analysisResult) {
        if (!analysisResult || !analysisResult.bestSignal) return null;

        const best = analysisResult.bestSignal;

        // So gera sinal se confianca minima atingida
        if (best.confidence < this.minConfidence) {
            console.log(`[Signals] Confianca baixa: ${best.confidence}% (min: ${this.minConfidence}%)`);
            return null;
        }

        // Evita sinal duplicado seguido
        const [lastSignal] = await this.db.execute(
            'SELECT * FROM signals WHERE game_type = "double" ORDER BY created_at DESC LIMIT 1'
        );

        if (lastSignal.length > 0) {
            const last = lastSignal[0];
            // Se o ultimo sinal foi ha menos de 30s e mesma cor, pula
            const timeDiff = Date.now() - new Date(last.created_at).getTime();
            if (timeDiff < 30000 && last.predicted_color === best.color) {
                return null;
            }
        }

        // Salva o sinal no banco
        const [result] = await this.db.execute(
            `INSERT INTO signals (game_type, predicted_color, confidence, strategy_used)
             VALUES ('double', ?, ?, ?)`,
            [best.color, best.confidence, best.strategies.join(', ')]
        );

        const signal = {
            id: result.insertId,
            game_type: 'double',
            predicted_color: best.color,
            color_name: this.colorName(best.color),
            confidence: best.confidence,
            strategies: best.strategies,
            reasons: best.reasons,
            created_at: new Date()
        };

        this.lastSignalId = signal.id;
        console.log(`[Signals] SINAL GERADO: ${signal.color_name} (${signal.confidence}%) via ${best.strategies.join(', ')}`);

        return signal;
    }

    async verifyLastSignals() {
        // Verifica sinais pendentes comparando com resultados reais
        const [pendingSignals] = await this.db.execute(
            `SELECT s.* FROM signals s
             WHERE s.result = 'pending' AND s.game_type = 'double'
             AND s.created_at < NOW() - INTERVAL 1 MINUTE
             ORDER BY s.created_at DESC LIMIT 20`
        );

        let verified = 0;
        for (const signal of pendingSignals) {
            // Busca o jogo que aconteceu logo apos o sinal
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
                verified++;
            }
        }

        if (verified > 0) {
            console.log(`[Signals] Verificou ${verified} sinais pendentes`);
        }
        return verified;
    }

    async getStats() {
        const [stats] = await this.db.execute(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
                SUM(CASE WHEN result = 'pending' THEN 1 ELSE 0 END) as pending,
                AVG(confidence) as avg_confidence
            FROM signals WHERE game_type = 'double'
        `);

        const s = stats[0];
        const decided = (Number(s.wins) || 0) + (Number(s.losses) || 0);
        const avgConf = Number(s.avg_confidence) || 0;
        return {
            total: Number(s.total) || 0,
            wins: Number(s.wins) || 0,
            losses: Number(s.losses) || 0,
            pending: Number(s.pending) || 0,
            winRate: decided > 0 ? ((Number(s.wins) / decided) * 100).toFixed(1) : 0,
            avgConfidence: avgConf > 0 ? avgConf.toFixed(1) : 0
        };
    }

    colorName(color) {
        const names = { 0: '⚪ Branco', 1: '🔴 Vermelho', 2: '⬛ Preto' };
        return names[color] || 'Desconhecido';
    }
}

module.exports = DoubleSignals;
