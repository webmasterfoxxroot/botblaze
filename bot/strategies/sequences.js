/**
 * Estrategia: Matriz de Transicao
 * Dado o padrao das ultimas N cores, qual a proxima cor mais provavel?
 * Usa dados REAIS do historico, nao teoria.
 */

class SequenceStrategy {
    constructor() {
        this.name = 'sequences';
    }

    analyze(games, allHistory) {
        if (games.length < 20) return null;

        // Converte pra ordem cronologica (index 0 = mais antigo)
        const recent = games.map(g => g.color).reverse();
        const history = (allHistory || games).map(g => g.color).reverse();

        const predictions = [];

        // Analise com profundidade 4 (mais especifico, menos amostras)
        const pred4 = this.analyzeDepth(recent, history, 4);
        if (pred4) predictions.push(pred4);

        // Analise com profundidade 3
        if (!predictions.length) {
            const pred3 = this.analyzeDepth(recent, history, 3);
            if (pred3) predictions.push(pred3);
        }

        // Analise com profundidade 2 (mais amostras, menos especifico)
        if (!predictions.length) {
            const pred2 = this.analyzeDepth(recent, history, 2);
            if (pred2) predictions.push(pred2);
        }

        return {
            strategy: this.name,
            predictions
        };
    }

    analyzeDepth(recent, history, depth) {
        if (recent.length < depth) return null;

        // Padrao atual (ultimas N cores)
        const pattern = recent.slice(-depth);
        const patternKey = pattern.join(',');

        // Conta o que veio depois desse padrao no historico
        const nextCounts = { 0: 0, 1: 0, 2: 0 };
        let total = 0;

        for (let i = 0; i <= history.length - depth - 1; i++) {
            let match = true;
            for (let j = 0; j < depth; j++) {
                if (history[i + j] !== pattern[j]) {
                    match = false;
                    break;
                }
            }
            if (match) {
                const nextColor = history[i + depth];
                if (nextColor !== undefined) {
                    nextCounts[nextColor]++;
                    total++;
                }
            }
        }

        // Precisa de amostras suficientes
        const minSamples = depth >= 4 ? 3 : (depth >= 3 ? 5 : 8);
        if (total < minSamples) return null;

        // Encontra a cor com maior probabilidade
        let bestColor = -1, bestPct = 0;
        for (const c of [0, 1, 2]) {
            const pct = (nextCounts[c] / total) * 100;
            if (pct > bestPct) {
                bestPct = pct;
                bestColor = c;
            }
        }

        // So sinaliza se probabilidade > 55%
        if (bestPct < 55 || bestColor < 0) return null;

        const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
        const patternStr = pattern.map(c => colorNames[c]?.[0] || '?').join('');

        return {
            color: bestColor,
            confidence: Math.min(Math.round(bestPct), 90),
            reason: `Padrao [${patternStr}] → ${colorNames[bestColor]} ${bestPct.toFixed(0)}% (${total} amostras, prof ${depth})`
        };
    }
}

module.exports = SequenceStrategy;
