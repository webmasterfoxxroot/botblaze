/**
 * Estrategia: Momentum e Tendencia
 * Detecta qual cor esta "quente" ou "fria" no momento
 * Compara distribuicao recente vs historica pra detectar tendencias
 */

class FrequencyStrategy {
    constructor() {
        this.name = 'frequency';
    }

    analyze(games, allHistory) {
        if (games.length < 20) return null;

        const colors = games.map(g => g.color);
        const histColors = (allHistory || games).map(g => g.color);

        const predictions = [];

        // 1. Distribuicao historica real (base real, nao teorica)
        const histDist = this.getDistribution(histColors);

        // 2. Distribuicao recente (ultimas 10)
        const recent10 = this.getDistribution(colors.slice(0, 10));

        // 3. Distribuicao recente (ultimas 20)
        const recent20 = this.getDistribution(colors.slice(0, 20));

        // 4. Detecta momentum: cor que esta dominando AGORA
        // Se uma cor esta acima da media historica nas ultimas 10, ela esta quente
        for (const c of [1, 2]) {
            const recentPct = recent10.pct[c];
            const histPct = histDist.pct[c];
            const diff = recentPct - histPct;

            // Cor quente (momentum positivo) - ta saindo muito, pode continuar
            if (diff > 15 && recent10.counts[c] >= 6) {
                predictions.push({
                    color: c,
                    confidence: Math.min(60 + Math.round(diff / 2), 78),
                    reason: `Momentum ${this.colorName(c)}: ${recentPct.toFixed(0)}% ultimas 10 (media ${histPct.toFixed(0)}%)`
                });
            }

            // Cor fria (momentum negativo) - ta ausente, pode voltar
            if (diff < -20 && recent10.counts[c] <= 2) {
                // Verifica se historicamente ela volta apos estar fria
                const recoveryPct = this.checkRecovery(histColors, c, 10);
                if (recoveryPct > 50) {
                    predictions.push({
                        color: c,
                        confidence: Math.min(55 + Math.round(recoveryPct - 50), 75),
                        reason: `Recuperacao ${this.colorName(c)}: so ${recentPct.toFixed(0)}% ult 10 (media ${histPct.toFixed(0)}%). Recupera ${recoveryPct.toFixed(0)}% das vezes`
                    });
                }
            }
        }

        // 5. Analise de tendencia: ultimas 20 vs historico
        if (!predictions.length) {
            for (const c of [1, 2]) {
                const r20 = recent20.pct[c];
                const h = histDist.pct[c];
                const diff20 = r20 - h;

                // Tendencia forte nas ultimas 20
                if (Math.abs(diff20) > 12) {
                    // Se esta acima da media, momentum; se abaixo, correcao
                    if (diff20 > 12 && recent10.pct[c] > r20) {
                        // Acelerando - cor quente ficando mais quente
                        predictions.push({
                            color: c,
                            confidence: Math.min(62 + Math.round(diff20 / 3), 76),
                            reason: `Tendencia forte ${this.colorName(c)}: ${r20.toFixed(0)}% ult 20, acelerando`
                        });
                    }
                }
            }
        }

        return {
            strategy: this.name,
            predictions,
            stats: { histDist, recent10, recent20 }
        };
    }

    getDistribution(colors) {
        const counts = { 0: 0, 1: 0, 2: 0 };
        colors.forEach(c => counts[c]++);
        const total = colors.length || 1;
        return {
            counts,
            total,
            pct: {
                0: (counts[0] / total) * 100,
                1: (counts[1] / total) * 100,
                2: (counts[2] / total) * 100
            }
        };
    }

    // Verifica: apos a cor aparecer <=2x em 10 rodadas, ela volta na proxima?
    checkRecovery(history, targetColor, windowSize) {
        let recoveries = 0, opportunities = 0;
        const chrono = [...history].reverse();

        for (let i = windowSize; i < chrono.length - 1; i++) {
            const window = chrono.slice(i - windowSize, i);
            const count = window.filter(c => c === targetColor).length;
            if (count <= 2) {
                opportunities++;
                if (chrono[i] === targetColor) recoveries++;
            }
        }

        return opportunities > 5 ? (recoveries / opportunities) * 100 : 0;
    }

    colorName(c) {
        return { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' }[c] || '?';
    }
}

module.exports = FrequencyStrategy;
