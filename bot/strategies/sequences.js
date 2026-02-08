/**
 * Estrategia de Sequencias
 * Analisa padroes de cores consecutivas para prever a proxima
 */

class SequenceStrategy {
    constructor() {
        this.name = 'sequences';
    }

    analyze(games) {
        if (games.length < 10) return null;

        const colors = games.map(g => g.color);
        const result = {
            strategy: this.name,
            predictions: [],
            patterns: {}
        };

        // Sequencia atual (quantas da mesma cor seguidas)
        const currentStreak = this.getCurrentStreak(colors);
        result.patterns.currentStreak = currentStreak;

        // Apos 3+ da mesma cor, tendencia de inverter
        if (currentStreak.count >= 3 && currentStreak.color !== 0) {
            const oppositeColor = currentStreak.color === 1 ? 2 : 1;
            const confidence = Math.min(50 + (currentStreak.count * 8), 85);
            result.predictions.push({
                color: oppositeColor,
                confidence,
                reason: `${currentStreak.count}x ${this.colorName(currentStreak.color)} seguidos - tendencia de inversao`
            });
        }

        // Padrao de alternancia (ex: vermelho, preto, vermelho, preto)
        const alternating = this.checkAlternating(colors);
        if (alternating.isAlternating && alternating.length >= 4) {
            const nextColor = colors[0] === 1 ? 2 : 1;
            result.predictions.push({
                color: nextColor,
                confidence: 55 + (alternating.length * 3),
                reason: `Padrao alternante detectado (${alternating.length} rodadas)`
            });
        }

        // Padrao de duplas (ex: 2 verm, 2 preto, 2 verm)
        const doubles = this.checkDoubles(colors);
        if (doubles.detected) {
            result.predictions.push({
                color: doubles.nextColor,
                confidence: 55,
                reason: `Padrao de duplas detectado`
            });
        }

        // Branco: se nao apareceu nas ultimas 25+, aumenta probabilidade
        const lastWhite = colors.indexOf(0);
        if (lastWhite === -1 || lastWhite > 25) {
            const roundsSince = lastWhite === -1 ? colors.length : lastWhite;
            result.predictions.push({
                color: 0,
                confidence: Math.min(30 + (roundsSince * 1.5), 60),
                reason: `Branco ausente ha ${roundsSince} rodadas`
            });
        }

        return result;
    }

    getCurrentStreak(colors) {
        let count = 1;
        const color = colors[0];
        for (let i = 1; i < colors.length; i++) {
            if (colors[i] === color) count++;
            else break;
        }
        return { color, count };
    }

    checkAlternating(colors) {
        let length = 1;
        for (let i = 1; i < colors.length; i++) {
            if (colors[i] !== colors[i - 1] && colors[i] !== 0 && colors[i - 1] !== 0) {
                length++;
            } else break;
        }
        return { isAlternating: length >= 4, length };
    }

    checkDoubles(colors) {
        const filtered = colors.filter(c => c !== 0).slice(0, 12);
        if (filtered.length < 6) return { detected: false };

        let isDoubles = true;
        for (let i = 0; i < 6; i += 2) {
            if (filtered[i] !== filtered[i + 1]) {
                isDoubles = false;
                break;
            }
        }

        if (isDoubles) {
            const lastPairColor = filtered[0];
            return {
                detected: true,
                nextColor: lastPairColor === 1 ? 2 : 1
            };
        }
        return { detected: false };
    }

    colorName(color) {
        const names = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
        return names[color] || 'Desconhecido';
    }
}

module.exports = SequenceStrategy;
