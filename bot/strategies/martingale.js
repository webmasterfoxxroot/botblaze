/**
 * Estrategia: Analise Estatistica de Recuperacao
 * Analisa: apos N rodadas sem uma cor, qual a chance real dela voltar?
 * Usa dados historicos reais pra calcular probabilidade de recuperacao.
 */

class MartingaleStrategy {
    constructor() {
        this.name = 'martingale';
    }

    analyze(games, allHistory) {
        if (games.length < 20) return null;

        const colors = games.map(g => g.color);
        const histColors = (allHistory || games).map(g => g.color);

        const predictions = [];

        // Analisa cada cor
        for (const targetColor of [1, 2]) {
            // Quantas rodadas desde a ultima aparicao
            let roundsSince = 0;
            for (let i = 0; i < colors.length; i++) {
                if (colors[i] === targetColor) break;
                roundsSince++;
            }

            if (roundsSince < 3) continue; // Menos de 3 ausencias = normal

            // Verifica no historico: apos N ausencias, qual % a cor aparece?
            const recoveryRate = this.getRecoveryRate(histColors, targetColor, roundsSince);

            if (recoveryRate.pct > 52 && recoveryRate.samples >= 5) {
                const conf = Math.min(Math.round(recoveryRate.pct), 82);
                predictions.push({
                    color: targetColor,
                    confidence: conf,
                    reason: `${this.colorName(targetColor)} ausente ${roundsSince}x. Historico: volta ${recoveryRate.pct.toFixed(0)}% apos ${roundsSince}+ ausencias (${recoveryRate.samples} amostras)`
                });
            }
        }

        // Branco: analise separada (muito mais raro)
        const whiteAbsence = colors.indexOf(0);
        if (whiteAbsence === -1 || whiteAbsence > 30) {
            const roundsSinceWhite = whiteAbsence === -1 ? colors.length : whiteAbsence;
            const whiteRecovery = this.getRecoveryRate(histColors, 0, roundsSinceWhite);
            if (whiteRecovery.pct > 15 && roundsSinceWhite > 30) {
                predictions.push({
                    color: 0,
                    confidence: Math.min(Math.round(whiteRecovery.pct * 3), 65),
                    reason: `Branco ausente ${roundsSinceWhite}x. Probabilidade aumentando.`
                });
            }
        }

        return {
            strategy: this.name,
            predictions
        };
    }

    // Calcula: no historico, apos a cor ficar ausente por >= N rodadas,
    // qual % ela aparece na rodada seguinte?
    getRecoveryRate(histColors, targetColor, minAbsence) {
        const chrono = [...histColors].reverse(); // Ordem cronologica
        let appearances = 0, opportunities = 0;
        let currentAbsence = 0;

        for (let i = 0; i < chrono.length; i++) {
            if (chrono[i] === targetColor) {
                currentAbsence = 0;
            } else {
                currentAbsence++;
                // Quando atinge o minimo de ausencia, vemos se a proxima e a cor alvo
                if (currentAbsence >= minAbsence && i + 1 < chrono.length) {
                    opportunities++;
                    if (chrono[i + 1] === targetColor) appearances++;
                }
            }
        }

        return {
            pct: opportunities > 0 ? (appearances / opportunities) * 100 : 0,
            samples: opportunities
        };
    }

    colorName(c) {
        return { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' }[c] || '?';
    }
}

module.exports = MartingaleStrategy;
