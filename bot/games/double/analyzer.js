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

        // Ultimas 50 rodadas para analise rapida
        const [recent50] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 50'
        );

        if (recent50.length < 10) {
            return null;
        }

        // Historico para ML e estatisticas (2000 ao inves de 10000 - mais rapido)
        const [allHistory] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 2000'
        );

        const queryTime = Date.now() - start;

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

        const totalTime = Date.now() - start;
        console.log(`[Analyzer] ${allPredictions.length} previsoes | Query: ${queryTime}ms | Total: ${totalTime}ms`);

        return {
            timestamp: new Date(),
            totalGames: recent50.length,
            lastGame: recent50[0],
            allPredictions
        };
    }
}

module.exports = DoubleAnalyzer;
