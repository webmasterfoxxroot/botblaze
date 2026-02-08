/**
 * Estrategia ML Patterns
 * Machine Learning basico: reconhecimento de padroes usando historico
 * Usa sliding window para encontrar padroes similares no passado
 */

class MLPatternsStrategy {
    constructor() {
        this.name = 'ml-patterns';
        this.windowSize = 5; // tamanho do padrao a buscar
    }

    analyze(games, allHistory) {
        if (games.length < 10) return null;

        const colors = games.map(g => g.color);
        const historyColors = (allHistory || games).map(g => g.color);

        const result = {
            strategy: this.name,
            predictions: [],
            patterns: {}
        };

        // Pega o padrao atual (ultimas N rodadas)
        const currentPattern = colors.slice(0, this.windowSize);
        result.patterns.current = currentPattern;

        // Busca este padrao no historico completo
        const matches = this.findPatternInHistory(currentPattern, historyColors);
        result.patterns.matchesFound = matches.length;

        if (matches.length >= 3) {
            // Contabiliza o que veio DEPOIS de cada match
            const nextColors = { 0: 0, 1: 0, 2: 0 };
            let totalNext = 0;

            for (const match of matches) {
                if (match.nextColor !== undefined) {
                    nextColors[match.nextColor]++;
                    totalNext++;
                }
            }

            if (totalNext > 0) {
                // Encontra a cor mais provavel
                let bestColor = 1;
                let bestCount = 0;
                for (const [color, count] of Object.entries(nextColors)) {
                    if (count > bestCount) {
                        bestCount = count;
                        bestColor = parseInt(color);
                    }
                }

                const probability = bestCount / totalNext;
                if (probability > 0.45) {
                    result.predictions.push({
                        color: bestColor,
                        confidence: Math.min(Math.round(probability * 100), 85),
                        reason: `ML: Padrao [${currentPattern.map(c => this.colorName(c)).join(',')}] encontrado ${matches.length}x no historico. Proxima cor mais provavel: ${this.colorName(bestColor)} (${(probability * 100).toFixed(1)}%)`,
                        sampleSize: totalNext
                    });
                }
            }
        }

        // Analise de transicao: probabilidade de ir de cor X para cor Y
        const transitions = this.buildTransitionMatrix(historyColors);
        result.patterns.transitions = transitions;

        const lastColor = colors[0];
        if (lastColor !== undefined && transitions[lastColor]) {
            const trans = transitions[lastColor];
            let bestNext = 1;
            let bestProb = 0;

            for (const [color, prob] of Object.entries(trans)) {
                if (prob > bestProb) {
                    bestProb = prob;
                    bestNext = parseInt(color);
                }
            }

            if (bestProb > 0.52) {
                result.predictions.push({
                    color: bestNext,
                    confidence: Math.min(Math.round(bestProb * 100), 75),
                    reason: `ML Transicao: Apos ${this.colorName(lastColor)}, ${this.colorName(bestNext)} aparece ${(bestProb * 100).toFixed(1)}% das vezes`
                });
            }
        }

        return result;
    }

    findPatternInHistory(pattern, history) {
        const matches = [];
        const patternLen = pattern.length;

        // Comeca depois do padrao atual para nao contar ele mesmo
        for (let i = patternLen; i < history.length - patternLen; i++) {
            let isMatch = true;
            for (let j = 0; j < patternLen; j++) {
                if (history[i + j] !== pattern[j]) {
                    isMatch = false;
                    break;
                }
            }
            if (isMatch && i > 0) {
                matches.push({
                    position: i,
                    nextColor: history[i - 1]
                });
            }
        }

        return matches;
    }

    buildTransitionMatrix(colors) {
        const transitions = { 0: {}, 1: {}, 2: {} };
        const counts = { 0: 0, 1: 0, 2: 0 };

        for (let i = 1; i < colors.length; i++) {
            const from = colors[i];
            const to = colors[i - 1];
            transitions[from][to] = (transitions[from][to] || 0) + 1;
            counts[from]++;
        }

        // Normaliza para probabilidades
        for (const from of [0, 1, 2]) {
            if (counts[from] > 0) {
                for (const to of [0, 1, 2]) {
                    transitions[from][to] = (transitions[from][to] || 0) / counts[from];
                }
            }
        }

        return transitions;
    }

    colorName(color) {
        const names = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
        return names[color] || '?';
    }
}

module.exports = MLPatternsStrategy;
