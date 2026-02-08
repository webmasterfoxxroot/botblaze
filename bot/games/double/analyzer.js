const SequenceStrategy = require('../../strategies/sequences');
const FrequencyStrategy = require('../../strategies/frequency');
const MartingaleStrategy = require('../../strategies/martingale');
const MLPatternsStrategy = require('../../strategies/ml-patterns');

class DoubleAnalyzer {
    constructor(db, config) {
        this.db = db;
        this.minConfidence = config.signalConfidenceMin || 55;

        this.strategies = [
            new SequenceStrategy(),
            new FrequencyStrategy(),
            new MartingaleStrategy(),
            new MLPatternsStrategy()
        ];
    }

    async analyze() {
        const start = Date.now();

        // Carrega configs do banco para analise window, history limit e estrategias ativas
        let analysisWindow = 50;
        let historyLimit = 2000;
        let activeStrategies = null;

        try {
            const [settings] = await this.db.execute('SELECT setting_key, setting_value FROM bot_settings');
            const cfg = {};
            for (const r of settings) cfg[r.setting_key] = r.setting_value;

            analysisWindow = parseInt(cfg.analysis_window) || 50;
            historyLimit = parseInt(cfg.history_limit) || 2000;

            activeStrategies = {
                'sequences': cfg.strategy_sequences !== '0',
                'frequency': cfg.strategy_frequency !== '0',
                'martingale': cfg.strategy_martingale !== '0',
                'ml-patterns': cfg.strategy_ml_patterns !== '0'
            };
        } catch (e) {}

        const [recentN] = await this.db.execute(
            `SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT ${parseInt(analysisWindow)}`
        );

        if (recentN.length < 10) {
            return null;
        }

        const [allHistory] = await this.db.execute(
            `SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT ${parseInt(historyLimit)}`
        );

        const queryTime = Date.now() - start;
        const allPredictions = [];

        for (const strategy of this.strategies) {
            // Checa se esta estrategia esta ativa no painel admin
            if (activeStrategies && activeStrategies[strategy.name] === false) {
                continue;
            }

            try {
                const result = strategy.analyze(recentN, allHistory);

                if (result && result.predictions && result.predictions.length > 0) {
                    allPredictions.push(...result.predictions.map(p => ({
                        ...p,
                        strategy: strategy.name
                    })));
                }
            } catch (err) {
                console.error(`[Analyzer] Erro ${strategy.name}:`, err.message);
            }
        }

        const totalTime = Date.now() - start;
        const activeCount = activeStrategies ? Object.values(activeStrategies).filter(v => v).length : 4;
        console.log(`[Analyzer] ${allPredictions.length} previsoes (${activeCount} estrategias) | Query: ${queryTime}ms | Total: ${totalTime}ms`);

        return {
            timestamp: new Date(),
            totalGames: recentN.length,
            lastGame: recentN[0],
            allPredictions
        };
    }
}

module.exports = DoubleAnalyzer;
