/**
 * Estrategia de Frequencia
 * Analisa distribuicao de cores e detecta desvios estatisticos
 */

class FrequencyStrategy {
    constructor() {
        this.name = 'frequency';
        // Probabilidades teoricas do Double
        // Vermelho: 7/15, Preto: 7/15, Branco: 1/15
        this.expectedRatios = {
            0: 1 / 15,  // ~6.67% branco
            1: 7 / 15,  // ~46.67% vermelho
            2: 7 / 15   // ~46.67% preto
        };
    }

    analyze(games) {
        if (games.length < 20) return null;

        const colors = games.map(g => g.color);
        const total = colors.length;

        // Contagem de cada cor
        const counts = { 0: 0, 1: 0, 2: 0 };
        colors.forEach(c => counts[c]++);

        // Porcentagens reais
        const ratios = {
            0: counts[0] / total,
            1: counts[1] / total,
            2: counts[2] / total
        };

        // Desvios da media esperada
        const deviations = {
            0: ratios[0] - this.expectedRatios[0],
            1: ratios[1] - this.expectedRatios[1],
            2: ratios[2] - this.expectedRatios[2]
        };

        const result = {
            strategy: this.name,
            predictions: [],
            stats: { counts, ratios, deviations, total }
        };

        // Se uma cor esta muito abaixo da media, tende a aparecer mais
        // Se esta muito acima, tende a diminuir (regressao a media)
        const threshold = 0.08; // 8% de desvio

        if (deviations[1] < -threshold) {
            // Vermelho abaixo da media
            const confidence = Math.min(55 + Math.abs(deviations[1]) * 200, 80);
            result.predictions.push({
                color: 1,
                confidence,
                reason: `Vermelho abaixo da media: ${(ratios[1] * 100).toFixed(1)}% (esperado ~46.7%)`
            });
        }

        if (deviations[2] < -threshold) {
            // Preto abaixo da media
            const confidence = Math.min(55 + Math.abs(deviations[2]) * 200, 80);
            result.predictions.push({
                color: 2,
                confidence,
                reason: `Preto abaixo da media: ${(ratios[2] * 100).toFixed(1)}% (esperado ~46.7%)`
            });
        }

        if (deviations[0] < -0.04) {
            // Branco muito ausente
            const confidence = Math.min(35 + Math.abs(deviations[0]) * 300, 55);
            result.predictions.push({
                color: 0,
                confidence,
                reason: `Branco abaixo da media: ${(ratios[0] * 100).toFixed(1)}% (esperado ~6.7%)`
            });
        }

        // Analise das ultimas 10 rodadas vs ultimas 50
        const recent10 = colors.slice(0, 10);
        const recent10Counts = { 0: 0, 1: 0, 2: 0 };
        recent10.forEach(c => recent10Counts[c]++);

        // Se nas ultimas 10 uma cor dominou muito
        for (const color of [1, 2]) {
            if (recent10Counts[color] >= 7) {
                const opposite = color === 1 ? 2 : 1;
                result.predictions.push({
                    color: opposite,
                    confidence: 60,
                    reason: `${this.colorName(color)} dominou ultimas 10 rodadas (${recent10Counts[color]}/10)`
                });
            }
        }

        return result;
    }

    colorName(color) {
        const names = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
        return names[color] || 'Desconhecido';
    }
}

module.exports = FrequencyStrategy;
