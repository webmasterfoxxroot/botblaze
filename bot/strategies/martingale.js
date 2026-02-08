/**
 * Estrategia Martingale
 * Analisa sequencias de perda e sugere quando entrar/dobrar
 */

class MartingaleStrategy {
    constructor() {
        this.name = 'martingale';
        this.maxLosses = 5; // maximo de perdas seguidas antes de parar
    }

    analyze(games) {
        if (games.length < 10) return null;

        const colors = games.map(g => g.color);
        const result = {
            strategy: this.name,
            predictions: [],
            analysis: {}
        };

        // Analisa para Vermelho
        const redAnalysis = this.analyzeColor(colors, 1);
        result.analysis.red = redAnalysis;

        // Analisa para Preto
        const blackAnalysis = this.analyzeColor(colors, 2);
        result.analysis.black = blackAnalysis;

        // Gera predicoes baseadas em Martingale
        // Se uma cor nao aparece ha muitas rodadas, pode ser bom entrar
        if (redAnalysis.roundsSinceLast >= 3) {
            const confidence = Math.min(50 + (redAnalysis.roundsSinceLast * 6), 75);
            result.predictions.push({
                color: 1,
                confidence,
                reason: `Martingale: Vermelho ausente ha ${redAnalysis.roundsSinceLast} rodadas`,
                martingaleLevel: redAnalysis.roundsSinceLast,
                suggestedMultiplier: Math.pow(2, redAnalysis.roundsSinceLast - 1)
            });
        }

        if (blackAnalysis.roundsSinceLast >= 3) {
            const confidence = Math.min(50 + (blackAnalysis.roundsSinceLast * 6), 75);
            result.predictions.push({
                color: 2,
                confidence,
                reason: `Martingale: Preto ausente ha ${blackAnalysis.roundsSinceLast} rodadas`,
                martingaleLevel: blackAnalysis.roundsSinceLast,
                suggestedMultiplier: Math.pow(2, blackAnalysis.roundsSinceLast - 1)
            });
        }

        // Alerta de risco alto
        for (const pred of result.predictions) {
            if (pred.martingaleLevel >= this.maxLosses) {
                pred.warning = 'RISCO ALTO: Muitas rodadas sem aparecer. Cuidado com Martingale profundo!';
                pred.confidence = Math.max(pred.confidence - 15, 40);
            }
        }

        return result;
    }

    analyzeColor(colors, targetColor) {
        let roundsSinceLast = 0;
        for (let i = 0; i < colors.length; i++) {
            if (colors[i] === targetColor) break;
            roundsSinceLast++;
        }

        // Maior sequencia sem a cor nas ultimas 50
        let maxAbsence = 0;
        let currentAbsence = 0;
        for (const c of colors) {
            if (c !== targetColor) {
                currentAbsence++;
                maxAbsence = Math.max(maxAbsence, currentAbsence);
            } else {
                currentAbsence = 0;
            }
        }

        // Contagem de vezes que a cor apareceu apos X ausencias
        const recoveryAfter = {};
        let absence = 0;
        for (let i = colors.length - 1; i >= 0; i--) {
            if (colors[i] !== targetColor) {
                absence++;
            } else {
                if (absence > 0) {
                    recoveryAfter[absence] = (recoveryAfter[absence] || 0) + 1;
                }
                absence = 0;
            }
        }

        return {
            roundsSinceLast,
            maxAbsence,
            recoveryAfter,
            totalAppearances: colors.filter(c => c === targetColor).length
        };
    }
}

module.exports = MartingaleStrategy;
