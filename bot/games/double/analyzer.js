const SequenceStrategy = require('../../strategies/sequences');
const FrequencyStrategy = require('../../strategies/frequency');
const MartingaleStrategy = require('../../strategies/martingale');
const MLPatternsStrategy = require('../../strategies/ml-patterns');

class DoubleAnalyzer {
    constructor(db, config) {
        this.db = db;
        this.minConfidence = config.signalConfidenceMin || 65;

        this.strategies = [
            new SequenceStrategy(),
            new FrequencyStrategy(),
            new MartingaleStrategy(),
            new MLPatternsStrategy()
        ];
    }

    async analyze() {
        // Ultimas 50 rodadas para analise
        const [recent50] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 50'
        );

        if (recent50.length < 20) {
            return null;
        }

        // Historico completo pra ML e estatisticas (ate 10000)
        const [allHistory] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 10000'
        );

        const allPredictions = [];

        // TODAS as estrategias recebem o historico completo
        for (const strategy of this.strategies) {
            try {
                const result = strategy.analyze(recent50, allHistory);

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

        return {
            timestamp: new Date(),
            totalGames: recent50.length,
            lastGame: recent50[0],
            allPredictions
        };
    }
}

module.exports = DoubleAnalyzer;
