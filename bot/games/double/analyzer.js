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
        // Busca ultimas 50 rodadas para analise
        const [recent50] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 50'
        );

        if (recent50.length < 10) {
            console.log(`[Analyzer] Dados insuficientes: ${recent50.length}/10 minimo`);
            return null;
        }

        // Busca historico completo para ML
        const [allHistory] = await this.db.execute(
            'SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 5000'
        );

        const allPredictions = [];
        const strategyResults = {};

        // Roda todas as estrategias
        for (const strategy of this.strategies) {
            try {
                let result;
                if (strategy.name === 'ml-patterns') {
                    result = strategy.analyze(recent50, allHistory);
                } else {
                    result = strategy.analyze(recent50);
                }

                if (result && result.predictions.length > 0) {
                    strategyResults[strategy.name] = result;
                    allPredictions.push(...result.predictions.map(p => ({
                        ...p,
                        strategy: strategy.name
                    })));
                }
            } catch (err) {
                console.error(`[Analyzer] Erro na estrategia ${strategy.name}:`, err.message);
            }
        }

        // Combina predicoes: agrupa por cor e calcula confianca combinada
        const combined = this.combinePredictions(allPredictions);

        return {
            timestamp: new Date(),
            totalGames: recent50.length,
            lastGame: recent50[0],
            strategyResults,
            allPredictions,
            combined,
            bestSignal: combined.length > 0 ? combined[0] : null
        };
    }

    combinePredictions(predictions) {
        const byColor = { 0: [], 1: [], 2: [] };

        predictions.forEach(p => {
            byColor[p.color].push(p);
        });

        const combined = [];
        for (const [color, preds] of Object.entries(byColor)) {
            if (preds.length === 0) continue;

            // Confianca combinada: media ponderada + bonus por multiplas estrategias concordando
            const avgConfidence = preds.reduce((sum, p) => sum + p.confidence, 0) / preds.length;
            const strategyBonus = Math.min((preds.length - 1) * 5, 15);
            const finalConfidence = Math.min(avgConfidence + strategyBonus, 95);

            const strategies = [...new Set(preds.map(p => p.strategy))];
            const reasons = preds.map(p => p.reason);

            combined.push({
                color: parseInt(color),
                confidence: Math.round(finalConfidence),
                strategiesCount: strategies.length,
                strategies,
                reasons,
                predictions: preds
            });
        }

        // Ordena por confianca (maior primeiro)
        combined.sort((a, b) => b.confidence - a.confidence);
        return combined;
    }
}

module.exports = DoubleAnalyzer;
