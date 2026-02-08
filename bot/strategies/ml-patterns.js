/**
 * Estrategia: Pattern Mining + Numero (Roll)
 * Analisa padroes por NUMERO (roll 0-14) e tambem cor
 * Tipo "tip miner" - memoriza quais numeros saem apos outros
 */

class MLPatternsStrategy {
    constructor() {
        this.name = 'ml-patterns';
    }

    analyze(games, allHistory) {
        if (games.length < 20) return null;

        const history = allHistory || games;
        const predictions = [];

        // 1. Pattern Mining por cor com janela deslizante (3,4,5)
        const colorPred = this.patternMine(
            games.map(g => g.color),
            history.map(g => g.color),
            [5, 4, 3]
        );
        if (colorPred) predictions.push(colorPred);

        // 2. Analise por NUMERO (roll) - qual numero sai apos qual
        const rollPred = this.rollAnalysis(games, history);
        if (rollPred) predictions.push(rollPred);

        // 3. Analise de horario (qual cor mais sai nesta hora)
        const hourPred = this.hourAnalysis(games, history);
        if (hourPred && !predictions.length) predictions.push(hourPred);

        return {
            strategy: this.name,
            predictions
        };
    }

    patternMine(recentColors, historyColors, windowSizes) {
        // Converte pra cronologico
        const recent = [...recentColors].reverse();
        const hist = [...historyColors].reverse();

        for (const ws of windowSizes) {
            if (recent.length < ws) continue;

            const pattern = recent.slice(-ws);
            const nextCounts = { 0: 0, 1: 0, 2: 0 };
            let total = 0;

            // Busca padrao no historico
            for (let i = 0; i <= hist.length - ws - 1; i++) {
                let match = true;
                for (let j = 0; j < ws; j++) {
                    if (hist[i + j] !== pattern[j]) {
                        match = false;
                        break;
                    }
                }
                if (match && hist[i + ws] !== undefined) {
                    nextCounts[hist[i + ws]]++;
                    total++;
                }
            }

            const minSamples = ws >= 5 ? 2 : (ws >= 4 ? 3 : 5);
            if (total < minSamples) continue;

            let bestColor = -1, bestPct = 0;
            for (const c of [0, 1, 2]) {
                const pct = (nextCounts[c] / total) * 100;
                if (pct > bestPct) {
                    bestPct = pct;
                    bestColor = c;
                }
            }

            if (bestPct >= 58 && bestColor >= 0) {
                const patternStr = pattern.map(c => 'BVP'[c] || '?').join('');
                return {
                    color: bestColor,
                    confidence: Math.min(Math.round(bestPct), 88),
                    reason: `ML: Padrao [${patternStr}] → ${this.colorName(bestColor)} ${bestPct.toFixed(0)}% (${total}x encontrado, janela ${ws})`
                };
            }
        }
        return null;
    }

    rollAnalysis(games, history) {
        if (history.length < 100) return null;

        // Qual cor sai apos cada numero (roll)?
        const lastRoll = games[0].roll; // Ultimo numero que saiu
        const rollToColor = {};

        // Ordem cronologica
        const chrono = [...history].reverse();
        for (let i = 0; i < chrono.length - 1; i++) {
            const roll = chrono[i].roll;
            const nextColor = chrono[i + 1].color;

            if (!rollToColor[roll]) rollToColor[roll] = { 0: 0, 1: 0, 2: 0, total: 0 };
            rollToColor[roll][nextColor]++;
            rollToColor[roll].total++;
        }

        const data = rollToColor[lastRoll];
        if (!data || data.total < 10) return null;

        let bestColor = -1, bestPct = 0;
        for (const c of [0, 1, 2]) {
            const pct = (data[c] / data.total) * 100;
            if (pct > bestPct) {
                bestPct = pct;
                bestColor = c;
            }
        }

        if (bestPct >= 55 && bestColor >= 0) {
            return {
                color: bestColor,
                confidence: Math.min(Math.round(bestPct), 80),
                reason: `Apos roll ${lastRoll} → ${this.colorName(bestColor)} ${bestPct.toFixed(0)}% (${data.total} amostras)`
            };
        }
        return null;
    }

    hourAnalysis(games, history) {
        if (history.length < 200) return null;

        const now = new Date();
        const currentHour = now.getHours();

        // Distribuicao de cores nesta hora (historico)
        const hourCounts = { 0: 0, 1: 0, 2: 0 };
        let hourTotal = 0;

        for (const g of history) {
            const gameHour = new Date(g.played_at).getHours();
            if (gameHour === currentHour) {
                hourCounts[g.color]++;
                hourTotal++;
            }
        }

        if (hourTotal < 30) return null;

        // Distribuicao geral
        const totalCounts = { 0: 0, 1: 0, 2: 0 };
        history.forEach(g => totalCounts[g.color]++);
        const totalAll = history.length || 1;

        // Compara: alguma cor sai significativamente mais nesta hora?
        for (const c of [1, 2]) {
            const hourPct = (hourCounts[c] / hourTotal) * 100;
            const generalPct = (totalCounts[c] / totalAll) * 100;
            const diff = hourPct - generalPct;

            if (diff > 8 && hourPct > 50) {
                return {
                    color: c,
                    confidence: Math.min(Math.round(hourPct), 75),
                    reason: `Hora ${currentHour}h: ${this.colorName(c)} sai ${hourPct.toFixed(0)}% (geral ${generalPct.toFixed(0)}%). ${hourTotal} jogos nesta hora`
                };
            }
        }

        return null;
    }

    colorName(c) {
        return { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' }[c] || '?';
    }
}

module.exports = MLPatternsStrategy;
