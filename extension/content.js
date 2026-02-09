// ============================================================
// BotBlaze - Content Script (injetado em blaze.bet.br/pt/games/double)
// ============================================================
// Este script le o DOM da Blaze, analisa padroes e realiza apostas
// automaticas com base nas configuracoes do usuario.
//
// Cores: 0 = Branco (x14), 1 = Vermelho (x2), 2 = Preto (x2)
// ============================================================

(function () {
    'use strict';

    // ===================== CONSTANTES =====================

    const COLOR_WHITE = 0;
    const COLOR_RED   = 1;
    const COLOR_BLACK = 2;

    const COLOR_NAMES = {
        [COLOR_WHITE]: 'Branco',
        [COLOR_RED]:   'Vermelho',
        [COLOR_BLACK]: 'Preto'
    };

    const COLOR_MULTIPLIERS = {
        [COLOR_WHITE]: 14,
        [COLOR_RED]:   2,
        [COLOR_BLACK]: 2
    };

    // Traduz fase interna para exibicao em portugues (como na Blaze)
    const PHASE_NAMES = {
        'betting':  'Esperando Apostas',
        'spinning': 'Girando',
        'result':   'Resultado',
        'unknown':  'Aguardando'
    };

    // Blaze Double: converte numero do resultado em cor
    // 0 = Branco (x14), 1-7 = Vermelho (x2), 8-14 = Preto (x2)
    function numberToColor(num) {
        num = parseInt(num);
        if (isNaN(num) || num < 0 || num > 14) return null;
        if (num === 0) return COLOR_WHITE;
        if (num >= 1 && num <= 7) return COLOR_RED;
        return COLOR_BLACK; // 8-14
    }

    // Intervalo minimo entre apostas (ms)
    const MIN_BET_INTERVAL = 5000;

    // ===================== ESTADO DO BOT =====================

    const state = {
        // Autenticacao
        authenticated: false,
        hasSubscription: false,

        // Configuracoes (vem do storage / API)
        settings: null,

        // Controle do bot
        botActive: false,
        gamePhase: 'unknown',    // 'betting' | 'spinning' | 'result' | 'unknown'
        lastGamePhase: 'unknown',

        // Historico de resultados (mais recente primeiro)
        gameHistory: [],

        // Sessao atual
        sessionProfit: 0,
        sessionBets: 0,
        sessionWins: 0,
        sessionLosses: 0,
        todayBets: 0,

        // Aposta atual
        currentBetColor: null,
        currentBetAmount: 0,
        waitingResult: false,
        lastBetTime: 0,

        // Martingale
        martingaleLevel: 0,

        // Controle de deteccao de novos resultados
        lastHistorySignature: '',

        // Saldo lido da pagina
        balance: 0,

        // Contador de retries do historico
        _historyRetryCount: 0
    };

    // ===================== ESTADO DA ANALISE =====================

    const analysis = {
        // Rastreamento de intervalos do branco
        roundsSinceWhite: 0,
        whiteIntervals: [],
        avgWhiteInterval: 25,

        // Rastreamento de numeros (0-14)
        numberCounts: new Array(15).fill(0),

        // Sinais da ultima analise
        lastSignals: [],
        lastDecision: null,
        lastConfidence: 0,

        // Contadores
        roundsSkipped: 0,
        totalRoundsAnalyzed: 0,

        // Limite de confianca (%)
        minConfidence: 60
    };

    // ===================== INICIALIZACAO =====================

    async function init() {
        console.log('[BotBlaze] Content script carregado na Blaze Double');

        // Verifica autenticacao com o background
        const authData = await sendMessage({ action: 'checkAuth' });

        if (!authData || !authData.authenticated) {
            console.log('[BotBlaze] Usuario nao autenticado. Faca login pela extensao.');
            state.authenticated = false;
            state.hasSubscription = false;
            createOverlay();
            return;
        }

        state.authenticated = true;
        state.hasSubscription = !!authData.hasSubscription;

        if (!state.hasSubscription) {
            console.log('[BotBlaze] Assinatura nao ativa.');
            createOverlay();
            return;
        }

        // Carrega configuracoes
        const settingsData = await sendMessage({ action: 'getSettings' });
        if (settingsData && settingsData.settings) {
            state.settings = settingsData.settings;
            state.botActive = (
                state.settings.auto_bet === true ||
                state.settings.auto_bet == 1
            );
            // Aplica configuracoes de analise inteligente
            if (state.settings.min_confidence) {
                analysis.minConfidence = parseInt(state.settings.min_confidence);
            }
            // Nivel de agressividade override
            if (state.settings.strategy === 'conservador') {
                analysis.minConfidence = Math.max(analysis.minConfidence, 75);
            } else if (state.settings.strategy === 'agressivo') {
                analysis.minConfidence = Math.min(analysis.minConfidence, 45);
            }
            console.log('[BotBlaze] Nivel: ' + (state.settings.strategy || 'moderado') +
                ' | Confianca min: ' + analysis.minConfidence + '%' +
                ' | Branco: ' + (state.settings.bet_white !== 0 ? 'Sim' : 'Nao'));
        } else {
            state.settings = getDefaultSettings();
        }

        // Restaura estatisticas da sessao (sobrevive a recarregamentos)
        const savedStats = await sendMessage({ action: 'getSessionStats' });
        if (savedStats && savedStats.stats) {
            const s = savedStats.stats;
            state.sessionProfit = s.sessionProfit || 0;
            state.sessionBets = s.sessionBets || 0;
            state.sessionWins = s.sessionWins || 0;
            state.sessionLosses = s.sessionLosses || 0;
            state.todayBets = s.todayBets || 0;
            state.martingaleLevel = s.martingaleLevel || 0;
            if (s.waitingResult && s.currentBetColor !== null) {
                state.currentBetColor = s.currentBetColor;
                state.currentBetAmount = s.currentBetAmount || 0;
                state.waitingResult = true;
            }
            console.log('[BotBlaze] Estatisticas restauradas: ' +
                state.sessionBets + ' apostas, R$' + state.sessionProfit.toFixed(2) + ' lucro');
        }

        createOverlay();
        readInitialHistory();
        startObserver();
        startPolling();

        console.log('[BotBlaze] Bot inicializado. Auto-bet:', state.botActive);
    }

    function getDefaultSettings() {
        return {
            bet_amount: 2.00,
            strategy: 'moderado',
            min_confidence: 60,
            bet_white: 1,
            martingale_enabled: false,
            martingale_max: 3,
            martingale_multiplier: 2.0,
            stop_loss: 50.00,
            stop_gain: 50.00,
            max_bets_per_day: 100,
            auto_bet: false
        };
    }

    // ===================== LEITURA DO DOM =====================

    /**
     * Le o historico de resultados da barra de historico da Blaze.
     * Usa 3 estrategias: seletores CSS, leitura de numeros, e scan do GIROS ANTERIORES.
     */
    function readInitialHistory() {
        state.gameHistory = [];

        // === Estrategia 1: Seletores CSS tradicionais ===
        const selectorSets = [
            '[class*="entries"] [class*="entry"]',
            '.roulette-previous .entry',
            '.sm-box',
            '#roulette-past .entry',
            '#roulette-past > div',
            '[class*="double-history"] div',
            '[class*="roulette"] [class*="past"]',
            '[class*="history"] [class*="item"]',
            '[class*="recent"] [class*="circle"]',
            '[class*="past"] [class*="box"]',
            '[class*="previous"] [class*="entry"]',
            '[data-role="history-item"]'
        ];

        let items = [];
        for (const selector of selectorSets) {
            try {
                items = document.querySelectorAll(selector);
                if (items.length >= 3) break;
            } catch (e) {}
        }

        items.forEach((el) => {
            const color = getColorFromElement(el);
            if (color !== null) {
                state.gameHistory.push({ color, timestamp: Date.now() });
            }
        });

        if (state.gameHistory.length >= 3) {
            console.log('[BotBlaze] Historico via seletores CSS:', state.gameHistory.length);
        }

        // === Estrategia 2: Scan de circulos numerados (0-14) ===
        if (state.gameHistory.length < 3) {
            const numbered = scanNumberedElements();
            if (numbered.length > state.gameHistory.length) {
                state.gameHistory = numbered;
                console.log('[BotBlaze] Historico via numeros:', state.gameHistory.length);
            }
        }

        // === Estrategia 3: Scan da secao GIROS ANTERIORES ===
        if (state.gameHistory.length < 3) {
            const giros = scanGirosAnteriores();
            if (giros.length > state.gameHistory.length) {
                state.gameHistory = giros;
                console.log('[BotBlaze] Historico via GIROS ANTERIORES:', state.gameHistory.length);
            }
        }

        state.lastHistorySignature = computeHistorySignature();
        console.log('[BotBlaze] Historico inicial lido:', state.gameHistory.length, 'resultados');
        updateOverlay();

        // Retry se insuficiente (max 5 tentativas, a cada 4s)
        if (state.gameHistory.length < 3 && state._historyRetryCount < 5) {
            state._historyRetryCount++;
            console.log('[BotBlaze] Historico insuficiente. Retry #' + state._historyRetryCount + ' em 4s...');
            setTimeout(readInitialHistory, 4000);
        }
    }

    /**
     * Busca elementos na pagina que contem numeros 0-14 (resultados da roleta).
     * Agrupa por posicao vertical e retorna o maior grupo como historico.
     */
    function scanNumberedElements() {
        const results = [];
        const candidates = [];

        // Busca todos os elementos com conteudo numerico 0-14
        const allEls = document.querySelectorAll('div, span, a, p, td, li, button');

        allEls.forEach((el) => {
            // Pega apenas texto direto do elemento (nao dos filhos)
            let directText = '';
            for (const node of el.childNodes) {
                if (node.nodeType === Node.TEXT_NODE) {
                    directText += node.textContent.trim();
                }
            }

            // Tambem tenta textContent se for folha (sem filhos de elementos)
            if (!directText && el.children.length === 0) {
                directText = (el.textContent || '').trim();
            }

            if (/^\d{1,2}$/.test(directText)) {
                const num = parseInt(directText);
                if (num >= 0 && num <= 14) {
                    const rect = el.getBoundingClientRect();
                    // Deve ser visivel e ter tamanho de circulo (20-120px)
                    if (rect.width >= 20 && rect.width <= 120 &&
                        rect.height >= 20 && rect.height <= 120 &&
                        rect.top > 0 && rect.top < window.innerHeight) {
                        candidates.push({ el, num, x: rect.left, y: Math.round(rect.top / 40) * 40, rect });
                    }
                }
            }
        });

        if (candidates.length < 3) return results;

        // Agrupa por Y aproximado (mesma fileira)
        const yGroups = {};
        candidates.forEach((c) => {
            if (!yGroups[c.y]) yGroups[c.y] = [];
            yGroups[c.y].push(c);
        });

        // Pega o maior grupo (mais provavel ser a strip de historico)
        let bestGroup = [];
        for (const y in yGroups) {
            if (yGroups[y].length > bestGroup.length) {
                bestGroup = yGroups[y];
            }
        }

        if (bestGroup.length < 2) return results;

        // Ordena por X (esquerda = mais recente tipicamente)
        bestGroup.sort((a, b) => a.x - b.x);

        console.log('[BotBlaze] Circulos numerados encontrados:', bestGroup.length,
            '| Numeros:', bestGroup.map(c => c.num).join(', '));

        bestGroup.forEach((c) => {
            const color = numberToColor(c.num);
            if (color !== null) {
                results.push({ color, number: c.num, timestamp: Date.now() });
            }
        });

        return results;
    }

    /**
     * Procura a secao "GIROS ANTERIORES" e le os circulos coloridos dentro dela.
     */
    function scanGirosAnteriores() {
        const results = [];

        // Busca o texto "GIROS ANTERIORES" na pagina
        const allEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6, div, span, p, section');
        let container = null;

        for (const el of allEls) {
            const text = (el.textContent || '').trim();
            if (text === 'GIROS ANTERIORES' || text === 'Giros Anteriores') {
                // O container dos circulos e o proximo irmao ou o pai
                container = el.nextElementSibling || el.parentElement;
                break;
            }
        }

        if (!container) return results;

        // Le todos os filhos do container
        const children = container.querySelectorAll('div, span, a');
        let found = 0;

        children.forEach((child) => {
            if (found > 50) return; // Limita

            const color = getColorFromElement(child);
            if (color !== null) {
                results.push({ color, timestamp: Date.now() });
                found++;
            }
        });

        if (results.length > 0) {
            console.log('[BotBlaze] GIROS ANTERIORES: ' + results.length + ' resultados');
        }

        return results;
    }

    /**
     * Determina a cor de um elemento do historico baseado em classes, styles, atributos e numeros.
     * Retorna COLOR_WHITE (0), COLOR_RED (1), COLOR_BLACK (2), ou null.
     */
    function getColorFromElement(el) {
        if (!el) return null;

        const classes = (el.className || '').toLowerCase();
        const text = (el.textContent || '').trim().toLowerCase();
        const dataColor = el.getAttribute('data-color') || el.getAttribute('data-value') || '';

        // --- Via data-attribute (mais confiavel) ---
        if (dataColor === '0' || dataColor === 'white' || dataColor === 'branco') return COLOR_WHITE;
        if (dataColor === '1' || dataColor === 'red' || dataColor === 'vermelho')  return COLOR_RED;
        if (dataColor === '2' || dataColor === 'black' || dataColor === 'preto')   return COLOR_BLACK;
        // data-color pode ser o numero do resultado (0-14)
        if (/^\d{1,2}$/.test(dataColor)) {
            const fromNum = numberToColor(parseInt(dataColor));
            if (fromNum !== null) return fromNum;
        }

        // --- Via classes CSS ---
        if (classes.includes('white') || classes.includes('branco')) return COLOR_WHITE;
        if (classes.includes('red') || classes.includes('vermelho'))   return COLOR_RED;
        if (classes.includes('black') || classes.includes('preto') || classes.includes('dark')) return COLOR_BLACK;

        // --- Via numero no texto (Blaze Double: 0=branco, 1-7=vermelho, 8-14=preto) ---
        if (/^\d{1,2}$/.test(text)) {
            const num = parseInt(text);
            if (num >= 0 && num <= 14) {
                return numberToColor(num);
            }
        }

        // --- Via computed background-color ---
        let bg = '';
        try {
            const computed = window.getComputedStyle(el);
            bg = (computed.backgroundColor || '').toLowerCase();
        } catch (e) {}
        // Fallback: inline style
        if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
            bg = (el.style && el.style.backgroundColor) ? el.style.backgroundColor.toLowerCase() : '';
        }

        if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            // Converte rgb para analise
            const rgbMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (rgbMatch) {
                const r = parseInt(rgbMatch[1]);
                const g = parseInt(rgbMatch[2]);
                const b = parseInt(rgbMatch[3]);

                // Branco: RGB alto em todos
                if (r > 200 && g > 200 && b > 200) return COLOR_WHITE;
                // Vermelho: R alto, G e B baixos
                if (r > 150 && g < 100 && b < 100) return COLOR_RED;
                // Preto/escuro: tudo baixo
                if (r < 60 && g < 60 && b < 60) return COLOR_BLACK;
            }
        }

        // --- Via texto descritivo ---
        if (text.includes('branco')) return COLOR_WHITE;
        if (text.includes('vermelho')) return COLOR_RED;
        if (text.includes('preto')) return COLOR_BLACK;

        return null;
    }

    /**
     * Detecta a fase atual do jogo lendo elementos de status na pagina.
     * Busca por texto "Esperando", "Girando", "Girou" em toda a area do jogo.
     */
    function detectGamePhase() {
        // Estrategia 1: Busca em seletores especificos de status
        const statusSelectors = [
            '[class*="status"]',
            '[class*="timer"]',
            '[class*="waiting"]',
            '[class*="game-info"]',
            '[class*="roulette-status"]',
            '[class*="roulette"] [class*="message"]',
            '[class*="double"] [class*="info"]',
            '[class*="crash-title"]',
            '[class*="game-message"]'
        ];

        for (const sel of statusSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    if (!el.textContent) continue;
                    const text = el.textContent.toLowerCase().trim();
                    if (text.includes('esperando') || text.includes('aguardando') ||
                        text.includes('aposte agora') || text.includes('waiting')) {
                        return 'betting';
                    }
                    // "Girando Em X:XX" = countdown = still BETTING phase
                    // "Girando" alone (without "em") = actually spinning
                    if (text.includes('girando') || text.includes('rolling') ||
                        text.includes('spinning')) {
                        if (/girando\s+em\s+\d/i.test(text) || /comecar/i.test(text)) {
                            return 'betting';
                        }
                        return 'spinning';
                    }
                    if (text.includes('girou') || text.includes('resultado')) {
                        return 'result';
                    }
                }
            } catch (e) {}
        }

        // Estrategia 2: Busca texto em TODOS os botoes e elementos visiveis
        // (a Blaze mostra "Esperando" em um botao rosa)
        const allButtons = document.querySelectorAll('button, [role="button"], [class*="bet"]');
        for (const btn of allButtons) {
            if (!btn.offsetParent) continue;
            const text = (btn.textContent || '').toLowerCase().trim();
            if (text.includes('esperando') || text.includes('aguardando') ||
                text.includes('aposte agora') || text === 'apostar' ||
                text.includes('place your bet') || text.includes('comecar o jogo') ||
                text.includes('começar o jogo')) {
                return 'betting';
            }
        }

        // Estrategia 3: Busca texto generico na area principal do jogo
        // Limita a area central para nao pegar texto do menu/sidebar
        const gameAreaSelectors = [
            'main', '#game', '#main', '[class*="game"]', '[class*="roulette"]',
            '[class*="double"]', '[class*="content"]', '[role="main"]'
        ];

        for (const sel of gameAreaSelectors) {
            try {
                const area = document.querySelector(sel);
                if (!area) continue;
                const text = (area.textContent || '').toLowerCase();

                if (text.includes('esperando') || text.includes('aguardando apostas') ||
                    text.includes('aposte agora') || text.includes('waiting for bets') ||
                    text.includes('comecar o jogo') || text.includes('começar o jogo')) {
                    return 'betting';
                }
                // "girando em X:XX" = countdown = betting phase still
                if (/girando\s+em\s+\d/i.test(text)) {
                    return 'betting';
                }
                if (text.includes('girando...') || text.includes('rolling') ||
                    text.includes('spinning')) {
                    return 'spinning';
                }
                if (text.includes('girou')) {
                    return 'result';
                }
            } catch (e) {}
        }

        // Estrategia 4: Scan amplo (toda a pagina, limitado a 10KB)
        const bodyText = (document.body.innerText || '').toLowerCase().substring(0, 10000);

        if (bodyText.includes('esperando') || bodyText.includes('aguardando') ||
            bodyText.includes('comecar o jogo')) {
            return 'betting';
        }
        // "girando em X:XX" countdown = still betting
        if (/girando\s+em\s+\d/.test(bodyText)) {
            return 'betting';
        }
        if (bodyText.includes('girando...')) {
            return 'spinning';
        }
        if (/blaze girou \d+/.test(bodyText)) {
            return 'result';
        }

        // Estrategia 5: Verifica se botoes de cor estao clicaveis (indica fase de apostas)
        const colorBtnSelectors = [
            'button[class*="red"]', 'button[class*="black"]', 'button[class*="white"]',
            '[class*="bet-color"]', '[class*="color-button"]'
        ];
        for (const sel of colorBtnSelectors) {
            try {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled && btn.offsetParent !== null) {
                    return 'betting';
                }
            } catch (e) {}
        }

        return 'unknown';
    }

    /**
     * Le o saldo do usuario exibido na pagina da Blaze.
     */
    function readBalance() {
        const balanceSelectors = [
            '[class*="balance"]',
            '[class*="wallet"]',
            '[class*="saldo"]',
            '[class*="money"]',
            '[class*="currency"]',
            '[class*="amount"]'
        ];

        for (const sel of balanceSelectors) {
            try {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    if (!el.textContent) continue;
                    const text = el.textContent.trim();
                    // Procura por padroes como "R$ 0,00" ou "R$ 100.50" ou "0,00"
                    const match = text.match(/R?\$?\s*([\d.,]+)/);
                    if (match) {
                        // Trata formato brasileiro (1.234,56) e americano (1,234.56)
                        let numStr = match[1];
                        // Se tem virgula como separador decimal (formato BR)
                        if (numStr.includes(',') && numStr.indexOf(',') > numStr.lastIndexOf('.')) {
                            numStr = numStr.replace(/\./g, '').replace(',', '.');
                        } else if (numStr.includes(',') && !numStr.includes('.')) {
                            numStr = numStr.replace(',', '.');
                        }
                        const val = parseFloat(numStr);
                        if (!isNaN(val)) return val;
                    }
                }
            } catch (e) {}
        }

        // Fallback: procura texto "R$ X,XX" no header da pagina
        const headerEls = document.querySelectorAll('header *, nav *, [class*="header"] *');
        for (const el of headerEls) {
            if (!el.children.length && el.textContent) {
                const text = el.textContent.trim();
                const match = text.match(/R\$\s*([\d.,]+)/);
                if (match) {
                    let numStr = match[1].replace(/\./g, '').replace(',', '.');
                    const val = parseFloat(numStr);
                    if (!isNaN(val)) return val;
                }
            }
        }

        return 0;
    }

    /**
     * Le o tempo restante (countdown) da fase de apostas.
     */
    function readCountdown() {
        const timerSelectors = [
            '[class*="timer"] span',
            '[class*="countdown"]',
            '[class*="time-left"]',
            '[class*="clock"]'
        ];

        for (const sel of timerSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el && el.textContent) {
                    const match = el.textContent.trim().match(/([\d.]+)/);
                    if (match) return parseFloat(match[1]);
                }
            } catch (e) { /* seletor invalido */ }
        }

        return -1;
    }

    // ===================== SISTEMA INTELIGENTE DE SINAIS =====================

    /**
     * Motor principal de analise. Executa 7 analisadores independentes,
     * combina os sinais por peso e so aposta quando a confianca e alta.
     * Retorna a cor para apostar ou null para pular a rodada.
     */
    function analyzeAndDecide() {
        if (!state.settings) return null;

        const history = state.gameHistory;

        if (history.length < 5) {
            console.log('[BotBlaze] Historico insuficiente (' + history.length + '/5 minimo)');
            return null;
        }

        // Martingale override: se perdeu e martingale esta ativo, repete mesma cor
        const mgEnabled = state.settings &&
            (state.settings.martingale_enabled === true || state.settings.martingale_enabled == 1);
        if (mgEnabled && state.martingaleLevel > 0 && state.currentBetColor !== null) {
            console.log('[BotBlaze] Martingale nv ' + state.martingaleLevel + ': repetindo ' + COLOR_NAMES[state.currentBetColor]);
            return state.currentBetColor;
        }

        analysis.totalRoundsAnalyzed++;

        // === Executa todos os analisadores ===
        const signals = [
            analyzeStreak(history),
            analyzeAlternation(history),
            analyzeFrequencyGap(history),
            analyzeDuoPattern(history),
            analyzeWhitePrediction(history),
            analyzeColorGap(history),
            analyzeRecentTrend(history)
        ].filter(s => s !== null && s.confidence > 0);

        analysis.lastSignals = signals;

        if (signals.length === 0) {
            analysis.roundsSkipped++;
            analysis.lastDecision = null;
            analysis.lastConfidence = 0;
            console.log('[BotBlaze] Nenhum sinal. Pulando rodada. (total puladas: ' + analysis.roundsSkipped + ')');
            updateOverlay();
            return null;
        }

        // Log de todos os sinais
        signals.forEach(s => {
            console.log('[BotBlaze] Sinal: ' + s.name + ' -> ' + COLOR_NAMES[s.color] +
                ' (' + s.confidence + '%) | ' + s.reason);
        });

        // === Combina sinais por voto ponderado ===
        const votes = { [COLOR_RED]: 0, [COLOR_BLACK]: 0, [COLOR_WHITE]: 0 };
        const counts = { [COLOR_RED]: 0, [COLOR_BLACK]: 0, [COLOR_WHITE]: 0 };

        signals.forEach(s => {
            votes[s.color] += s.confidence;
            counts[s.color]++;
        });

        // Encontra a cor com mais votos ponderados (empate = aleatorio)
        const maxVotes = Math.max(votes[COLOR_RED], votes[COLOR_BLACK], votes[COLOR_WHITE]);
        let bestVotes = maxVotes;
        let bestColor = null;

        if (maxVotes > 0) {
            const winners = [COLOR_RED, COLOR_BLACK, COLOR_WHITE].filter(c => votes[c] === maxVotes);
            bestColor = winners.length === 1 ? winners[0] : winners[Math.floor(Math.random() * winners.length)];
        }

        if (bestColor === null) {
            analysis.roundsSkipped++;
            analysis.lastDecision = null;
            analysis.lastConfidence = 0;
            updateOverlay();
            return null;
        }

        // Calcula confianca media dos sinais que concordam
        const agreeCount = counts[bestColor];
        const avgConfidence = agreeCount > 0 ? Math.round(bestVotes / agreeCount) : 0;

        // Calcula dominancia (% dos votos totais)
        const totalVotes = votes[COLOR_RED] + votes[COLOR_BLACK] + votes[COLOR_WHITE];
        const dominance = totalVotes > 0 ? Math.round(bestVotes / totalVotes * 100) : 0;

        // Conta sinais que discordam com confianca alta
        const disagreeStrong = signals.filter(s => s.color !== bestColor && s.confidence >= 50).length;

        // === Decisao de confianca ===
        const threshold = bestColor === COLOR_WHITE
            ? analysis.minConfidence + 15   // Branco: precisa confianca maior (x14 mas raro)
            : analysis.minConfidence;

        // Rejeita se confianca baixa
        if (avgConfidence < threshold) {
            analysis.roundsSkipped++;
            analysis.lastDecision = null;
            analysis.lastConfidence = avgConfidence;
            console.log('[BotBlaze] Confianca baixa: ' + avgConfidence + '% (min: ' + threshold + '%). Pulando.');
            updateOverlay();
            return null;
        }

        // Rejeita se dominancia fraca (sinais muito divididos)
        if (dominance < 55) {
            analysis.roundsSkipped++;
            analysis.lastDecision = null;
            analysis.lastConfidence = avgConfidence;
            console.log('[BotBlaze] Dominancia fraca: ' + dominance + '% (min: 55%). Sinais divididos. Pulando.');
            updateOverlay();
            return null;
        }

        // Rejeita se ha mais sinais fortes contra do que a favor
        if (disagreeStrong >= agreeCount) {
            analysis.roundsSkipped++;
            analysis.lastDecision = null;
            analysis.lastConfidence = avgConfidence;
            console.log('[BotBlaze] Sinais conflitantes (' + agreeCount + ' a favor, ' + disagreeStrong + ' contra). Pulando.');
            updateOverlay();
            return null;
        }

        // === DECISAO FINAL ===
        analysis.lastDecision = bestColor;
        analysis.lastConfidence = avgConfidence;
        analysis.roundsSkipped = 0;

        console.log('[BotBlaze] >>> DECISAO: ' + COLOR_NAMES[bestColor] +
            ' | Confianca: ' + avgConfidence + '%' +
            ' | Dominancia: ' + dominance + '%' +
            ' | Sinais: ' + agreeCount + '/' + signals.length);

        updateOverlay();
        return bestColor;
    }

    // ----- Analisador 1: Sequencia (Streak) -----
    // Se uma cor aparece 3+ vezes seguidas, aposta na oposta.
    function analyzeStreak(history) {
        if (history.length < 3) return null;

        const streakColor = history[0].color;
        if (streakColor === COLOR_WHITE) return null; // Ignora streaks de branco

        let len = 1;
        for (let i = 1; i < history.length; i++) {
            if (history[i].color === streakColor) len++;
            else break;
        }

        if (len < 3) return null;

        // Confianca: 3=55%, 4=65%, 5=72%, 6+=78%
        const conf = Math.min(78, 40 + len * 12);
        const opposite = streakColor === COLOR_RED ? COLOR_BLACK : COLOR_RED;

        return {
            name: 'Sequencia',
            color: opposite,
            confidence: conf,
            reason: len + 'x ' + COLOR_NAMES[streakColor] + ' seguidos'
        };
    }

    // ----- Analisador 2: Alternancia -----
    // Detecta padroes R-B-R-B e continua a sequencia.
    function analyzeAlternation(history) {
        if (history.length < 5) return null;

        let altCount = 0;
        for (let i = 0; i < Math.min(history.length - 1, 10); i++) {
            if (history[i].color !== COLOR_WHITE &&
                history[i + 1].color !== COLOR_WHITE &&
                history[i].color !== history[i + 1].color) {
                altCount++;
            } else break;
        }

        if (altCount < 3) return null;

        const lastColor = history[0].color;
        const nextColor = lastColor === COLOR_RED ? COLOR_BLACK : COLOR_RED;
        // Confianca: 3=50%, 4=58%, 5=64%, 6+=70%
        const conf = Math.min(70, 38 + altCount * 8);

        return {
            name: 'Alternancia',
            color: nextColor,
            confidence: conf,
            reason: altCount + ' alternacoes consecutivas'
        };
    }

    // ----- Analisador 3: Desequilibrio de Frequencia -----
    // Quando uma cor esta muito sub-representada nos ultimos 20 jogos.
    function analyzeFrequencyGap(history) {
        const sample = history.slice(0, 20);
        if (sample.length < 10) return null;

        let redCount = 0, blackCount = 0;
        sample.forEach(h => {
            if (h.color === COLOR_RED) redCount++;
            if (h.color === COLOR_BLACK) blackCount++;
        });

        const total = redCount + blackCount;
        if (total < 8) return null;

        const imbalance = Math.abs(redCount - blackCount) / total;
        if (imbalance < 0.25) return null; // Menos de 25% diferenca = equilibrado

        const underColor = redCount < blackCount ? COLOR_RED : COLOR_BLACK;
        const underCount = Math.min(redCount, blackCount);
        const overCount = Math.max(redCount, blackCount);

        // Confianca baseada no desequilibrio
        const conf = Math.min(68, 35 + Math.round(imbalance * 80));

        return {
            name: 'Frequencia',
            color: underColor,
            confidence: conf,
            reason: COLOR_NAMES[underColor] + ' ' + underCount + 'x vs ' + overCount + 'x em ' + sample.length + ' jogos'
        };
    }

    // ----- Analisador 4: Padrao de Pares/Trios -----
    // Detecta padroes como RR-BB-RR (pares alternados) ou RRR -> muda.
    function analyzeDuoPattern(history) {
        if (history.length < 6) return null;

        // Verifica se os ultimos 2 sao da mesma cor (par formado)
        if (history[0].color === COLOR_WHITE || history[1].color === COLOR_WHITE) return null;
        if (history[0].color !== history[1].color) return null;

        const pairColor = history[0].color;

        // Verifica historico de pares: quando 2+ da mesma cor vieram, o que veio depois?
        let pairsFound = 0;
        let changedAfterPair = 0;

        for (let i = 2; i < history.length - 2; i++) {
            if (history[i].color !== COLOR_WHITE &&
                history[i].color === history[i + 1].color) {
                pairsFound++;
                // O que veio antes desse par? (lembrar: history[0] e o mais recente)
                if (i >= 1 && history[i - 1].color !== history[i].color) {
                    changedAfterPair++;
                }
            }
        }

        if (pairsFound < 2) return null;

        const changeRate = changedAfterPair / pairsFound;

        if (changeRate >= 0.6) {
            // Pares tendem a ser seguidos por cor oposta
            const opposite = pairColor === COLOR_RED ? COLOR_BLACK : COLOR_RED;
            const conf = Math.min(65, 35 + Math.round(changeRate * 35));

            return {
                name: 'Pares',
                color: opposite,
                confidence: conf,
                reason: '2x ' + COLOR_NAMES[pairColor] + ' (pares mudam ' + Math.round(changeRate * 100) + '% das vezes)'
            };
        }

        return null;
    }

    // ----- Analisador 5: Previsao de Branco -----
    // Rastreia intervalos entre brancos e preve quando esta "atrasado".
    function analyzeWhitePrediction(history) {
        // Verifica se apostas no branco estao habilitadas
        if (state.settings && state.settings.bet_white === 0) return null;

        // Conta rodadas desde o ultimo branco
        let gap = 0;
        for (let i = 0; i < history.length; i++) {
            if (history[i].color === COLOR_WHITE) break;
            gap++;
        }

        // Usa media calculada ou padrao
        const avg = analysis.whiteIntervals.length >= 3
            ? analysis.whiteIntervals.reduce((a, b) => a + b, 0) / analysis.whiteIntervals.length
            : analysis.avgWhiteInterval;

        // So preve branco quando o gap e muito grande (2x a media ou 35+ rodadas)
        const threshold = Math.max(30, Math.round(avg * 2));

        if (gap < threshold) return null;

        // Confianca aumenta com o gap
        const excess = gap - threshold;
        const conf = Math.min(72, 48 + excess * 3);

        return {
            name: 'Branco',
            color: COLOR_WHITE,
            confidence: conf,
            reason: gap + ' rodadas sem branco (media: ' + Math.round(avg) + ', limite: ' + threshold + ')'
        };
    }

    // ----- Analisador 6: Ausencia de Cor -----
    // Se uma cor nao aparece ha muitas rodadas, ela esta "atrasada".
    function analyzeColorGap(history) {
        if (history.length < 8) return null;

        let redGap = -1, blackGap = -1;

        for (let i = 0; i < history.length; i++) {
            if (history[i].color === COLOR_RED && redGap === -1) redGap = i;
            if (history[i].color === COLOR_BLACK && blackGap === -1) blackGap = i;
            if (redGap !== -1 && blackGap !== -1) break;
        }

        // Se nao encontrou, gap = tamanho do historico
        if (redGap === -1) redGap = history.length;
        if (blackGap === -1) blackGap = history.length;

        const maxGap = Math.max(redGap, blackGap);
        if (maxGap < 5) return null;

        const overdueColor = redGap > blackGap ? COLOR_RED : COLOR_BLACK;
        // Confianca: 5=60%, 6=66%, 7=70%, 8+=74%
        const conf = Math.min(74, 35 + maxGap * 6);

        return {
            name: 'Ausencia',
            color: overdueColor,
            confidence: conf,
            reason: COLOR_NAMES[overdueColor] + ' ausente ha ' + maxGap + ' rodadas'
        };
    }

    // ----- Analisador 7: Tendencia Recente -----
    // Compara ultimos 5 jogos com os 5 anteriores para detectar mudancas de tendencia.
    function analyzeRecentTrend(history) {
        if (history.length < 10) return null;

        const recent = history.slice(0, 5);
        const prev = history.slice(5, 10);

        const rRed = recent.filter(h => h.color === COLOR_RED).length;
        const rBlack = recent.filter(h => h.color === COLOR_BLACK).length;
        const pRed = prev.filter(h => h.color === COLOR_RED).length;
        const pBlack = prev.filter(h => h.color === COLOR_BLACK).length;

        // Reversao: uma cor dominou os anteriores (4+) mas caiu nos recentes (<=2)
        if (pRed >= 4 && rRed <= 2) {
            return {
                name: 'Tendencia',
                color: COLOR_BLACK,
                confidence: 55,
                reason: 'Vermelho dominava (' + pRed + '/5) mas caiu (' + rRed + '/5)'
            };
        }
        if (pBlack >= 4 && rBlack <= 2) {
            return {
                name: 'Tendencia',
                color: COLOR_RED,
                confidence: 55,
                reason: 'Preto dominava (' + pBlack + '/5) mas caiu (' + rBlack + '/5)'
            };
        }

        // Momentum: uma cor esta crescendo (mais no recente que no anterior)
        if (rRed >= 4 && pRed <= 1) {
            return {
                name: 'Tendencia',
                color: COLOR_RED,
                confidence: 50,
                reason: 'Vermelho em alta (' + pRed + '/5 -> ' + rRed + '/5)'
            };
        }
        if (rBlack >= 4 && pBlack <= 1) {
            return {
                name: 'Tendencia',
                color: COLOR_BLACK,
                confidence: 50,
                reason: 'Preto em alta (' + pBlack + '/5 -> ' + rBlack + '/5)'
            };
        }

        return null;
    }

    /**
     * Calcula o valor da aposta (com martingale se habilitado).
     */
    function calculateBetAmount() {
        if (!state.settings) return 2.0;

        const base = parseFloat(state.settings.bet_amount) || 2.0;

        const mgEnabled = (
            state.settings.martingale_enabled === true ||
            state.settings.martingale_enabled == 1
        );

        if (mgEnabled && state.martingaleLevel > 0) {
            const mult = parseFloat(state.settings.martingale_multiplier) || 2.0;
            const maxLevel = parseInt(state.settings.martingale_max) || 3;
            const level = Math.min(state.martingaleLevel, maxLevel);
            const amount = base * Math.pow(mult, level);

            console.log('[BotBlaze] Martingale nv ' + level + ': R$' + base.toFixed(2) + ' -> R$' + amount.toFixed(2));
            return amount;
        }

        return base;
    }

    /**
     * Verifica limites de stop loss, stop gain e max apostas.
     * Retorna true se PODE apostar.
     */
    function checkLimits() {
        if (!state.settings) return false;

        const stopLoss = parseFloat(state.settings.stop_loss) || 50;
        const stopGain = parseFloat(state.settings.stop_gain) || 50;
        const maxBets  = parseInt(state.settings.max_bets_per_day) || 100;

        if (state.sessionProfit <= -stopLoss) {
            console.log('[BotBlaze] STOP LOSS atingido: R$' + Math.abs(state.sessionProfit).toFixed(2));
            return false;
        }
        if (state.sessionProfit >= stopGain) {
            console.log('[BotBlaze] STOP GAIN atingido: R$' + state.sessionProfit.toFixed(2));
            return false;
        }
        if (state.todayBets >= maxBets) {
            console.log('[BotBlaze] MAX APOSTAS/DIA atingido: ' + state.todayBets + '/' + maxBets);
            return false;
        }

        return true;
    }

    // ===================== INTERACAO COM O DOM (APOSTAR) =====================

    /**
     * Realiza uma aposta na Blaze interagindo com o DOM.
     */
    function placeBet(color, amount) {
        console.log('[BotBlaze] Apostando: ' + COLOR_NAMES[color] + ' R$' + amount.toFixed(2));

        // 1. Define o valor da aposta
        const amountInput = findBetAmountInput();
        if (!amountInput) {
            console.warn('[BotBlaze] Input de valor nao encontrado!');
            return false;
        }

        setInputValue(amountInput, amount.toFixed(2));

        // 2. Clica no botao da cor
        const colorButton = findColorButton(color);
        if (!colorButton) {
            console.warn('[BotBlaze] Botao de cor nao encontrado: ' + COLOR_NAMES[color]);
            return false;
        }

        // Delay entre definir valor e clicar na cor
        setTimeout(() => {
            simulateClick(colorButton);
            console.log('[BotBlaze] Cor selecionada: ' + COLOR_NAMES[color]);

            // 3. Clica em "Apostar" / "Confirmar" se existir
            setTimeout(() => {
                const confirmBtn = findConfirmButton();
                if (confirmBtn) {
                    simulateClick(confirmBtn);
                    console.log('[BotBlaze] Aposta confirmada!');
                }
            }, 300);
        }, 200);

        // Atualiza estado
        state.currentBetColor = color;
        state.currentBetAmount = amount;
        state.waitingResult = true;
        state.lastBetTime = Date.now();
        state.sessionBets++;
        state.todayBets++;

        // Persiste estatisticas (aposta em andamento)
        saveSessionStats();

        updateOverlay();
        return true;
    }

    /**
     * Encontra o input de valor de aposta.
     */
    function findBetAmountInput() {
        const selectors = [
            'input[class*="amount"]',
            'input[class*="bet-input"]',
            'input[class*="input-bet"]',
            'input[class*="stake"]',
            'input[type="number"][class*="bet"]',
            'input[type="number"]',
            'input[class*="valor"]',
            'input[placeholder*="valor"]',
            'input[placeholder*="amount"]'
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) return el;
            } catch (e) { /* seletor invalido */ }
        }

        // Fallback: qualquer input numerico visivel
        const inputs = document.querySelectorAll('input');
        for (const input of inputs) {
            if (
                (input.type === 'number' || input.type === 'text' || input.inputMode === 'numeric' || input.inputMode === 'decimal') &&
                input.offsetParent !== null
            ) {
                return input;
            }
        }

        return null;
    }

    /**
     * Encontra o botao para selecionar uma cor.
     * Usa sistema de pontuacao para encontrar o melhor match.
     */
    function findColorButton(color) {
        const allButtons = document.querySelectorAll(
            'button, [role="button"], [class*="color-button"], [class*="bet-color"], ' +
            '[class*="roulette-bet"], [class*="double-bet"]'
        );

        let candidates = [];

        allButtons.forEach((btn) => {
            if (!btn.offsetParent) return; // nao visivel

            const text = (btn.textContent || '').toLowerCase().trim();
            const cls  = (btn.className || '').toLowerCase();
            const dc = btn.getAttribute('data-color') || btn.getAttribute('data-value') || '';

            let score = 0;

            if (color === COLOR_RED) {
                if (dc === '1' || dc === 'red') score += 10;
                if (cls.includes('red') || cls.includes('vermelho')) score += 5;
                if (text.includes('vermelho')) score += 3;
                if (text.includes('x2') && (cls.includes('red') || !cls.includes('black'))) score += 1;
            }

            if (color === COLOR_BLACK) {
                if (dc === '2' || dc === 'black') score += 10;
                if (cls.includes('black') || cls.includes('preto') || cls.includes('dark')) score += 5;
                if (text.includes('preto')) score += 3;
                if (text.includes('x2') && cls.includes('black')) score += 1;
            }

            if (color === COLOR_WHITE) {
                if (dc === '0' || dc === 'white') score += 10;
                if (cls.includes('white') || cls.includes('branco')) score += 5;
                if (text.includes('branco') || text.includes('x14')) score += 3;
            }

            if (score > 0) {
                candidates.push({ el: btn, score: score });
            }
        });

        candidates.sort((a, b) => b.score - a.score);
        return candidates.length > 0 ? candidates[0].el : null;
    }

    /**
     * Encontra o botao de confirmar aposta.
     */
    function findConfirmButton() {
        const selectors = [
            'button[class*="confirm"]',
            'button[class*="place-bet"]',
            'button[class*="apostar"]',
            'button[class*="submit-bet"]',
            'button[class*="make-bet"]',
            'button[class*="bet-button"]'
        ];

        for (const sel of selectors) {
            try {
                const el = document.querySelector(sel);
                if (el && !el.disabled && el.offsetParent !== null) return el;
            } catch (e) { /* seletor invalido */ }
        }

        // Fallback: procura botoes com texto relevante
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
            const text = (btn.textContent || '').toLowerCase().trim();
            if (
                (text.includes('apostar') || text.includes('confirmar') || text.includes('bet') || text === 'ok') &&
                !btn.disabled && btn.offsetParent !== null
            ) {
                return btn;
            }
        }

        return null;
    }

    /**
     * Define o valor de um input simulando interacao do usuario.
     * Usa o setter nativo para bypass de frameworks (React, Vue, etc.).
     */
    function setInputValue(input, value) {
        try {
            const nativeSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
            ).set;
            nativeSetter.call(input, value);

            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('blur', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
        } catch (e) {
            input.value = value;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /**
     * Simula um clique real (mousedown + mouseup + click).
     */
    function simulateClick(element) {
        try {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;

            const opts = {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: x,
                clientY: y
            };

            element.dispatchEvent(new MouseEvent('mousedown', opts));
            element.dispatchEvent(new MouseEvent('mouseup', opts));
            element.dispatchEvent(new MouseEvent('click', opts));
        } catch (e) {
            element.click();
        }
    }

    // ===================== GAME LOOP =====================

    /**
     * Chamado quando um novo resultado e detectado.
     */
    function onNewResult(color) {
        console.log('[BotBlaze] Novo resultado: ' + COLOR_NAMES[color]);

        // Adiciona ao historico
        state.gameHistory.unshift({ color, timestamp: Date.now() });
        if (state.gameHistory.length > 100) state.gameHistory.pop();

        // Rastreia intervalos do branco
        if (color === COLOR_WHITE) {
            if (analysis.roundsSinceWhite > 0) {
                analysis.whiteIntervals.push(analysis.roundsSinceWhite);
                if (analysis.whiteIntervals.length > 15) analysis.whiteIntervals.shift();
                // Recalcula media
                analysis.avgWhiteInterval = analysis.whiteIntervals.reduce((a, b) => a + b, 0) / analysis.whiteIntervals.length;
                console.log('[BotBlaze] Branco apareceu! Intervalo: ' + analysis.roundsSinceWhite + ' | Media: ' + Math.round(analysis.avgWhiteInterval));
            }
            analysis.roundsSinceWhite = 0;
        } else {
            analysis.roundsSinceWhite++;
        }

        // Processa aposta pendente
        if (state.waitingResult && state.currentBetColor !== null) {
            const won = (state.currentBetColor === color);
            const multiplier = COLOR_MULTIPLIERS[color] || 2;
            const profit = won
                ? state.currentBetAmount * (multiplier - 1)
                : -state.currentBetAmount;

            state.sessionProfit += profit;

            if (won) {
                state.sessionWins++;
                state.martingaleLevel = 0;
                console.log('[BotBlaze] VITORIA! +R$' + profit.toFixed(2) + ' | Total: R$' + state.sessionProfit.toFixed(2));
            } else {
                state.sessionLosses++;

                const mgEnabled = (
                    state.settings &&
                    (state.settings.martingale_enabled === true || state.settings.martingale_enabled == 1)
                );

                if (mgEnabled) {
                    const maxLevel = parseInt(state.settings.martingale_max) || 3;
                    if (state.martingaleLevel < maxLevel) {
                        state.martingaleLevel++;
                        console.log('[BotBlaze] DERROTA. Martingale -> nv ' + state.martingaleLevel);
                    } else {
                        state.martingaleLevel = 0;
                        console.log('[BotBlaze] DERROTA. Martingale MAX - resetando');
                    }
                } else {
                    console.log('[BotBlaze] DERROTA. -R$' + Math.abs(profit).toFixed(2) + ' | Total: R$' + state.sessionProfit.toFixed(2));
                }
            }

            // Registra no backend
            sendMessage({
                action: 'recordBet',
                payload: {
                    game_id: 'blaze_double_' + Date.now(),
                    color_bet: state.currentBetColor,
                    color_bet_name: COLOR_NAMES[state.currentBetColor],
                    amount: state.currentBetAmount,
                    result: won ? 'win' : 'loss',
                    profit: profit,
                    roll_result: color,
                    roll_result_name: COLOR_NAMES[color],
                    was_martingale: state.martingaleLevel > 0 ? 1 : 0,
                    martingale_level: state.martingaleLevel,
                    session_profit: state.sessionProfit,
                    timestamp: new Date().toISOString()
                }
            });

            state.waitingResult = false;
            state.currentBetColor = null;
            state.currentBetAmount = 0;

            // Persiste estatisticas para sobreviver a recarregamentos
            saveSessionStats();
        }

        updateOverlay();
    }

    /**
     * Chamado quando a fase de apostas comeca.
     */
    function onBettingPhase() {
        if (!state.botActive) return;
        if (!state.hasSubscription) return;
        if (!state.settings) return;
        if (state.waitingResult) return;
        if (Date.now() - state.lastBetTime < MIN_BET_INTERVAL) return;

        if (!checkLimits()) {
            console.log('[BotBlaze] Limites atingidos. Desligando bot.');
            state.botActive = false;
            updateOverlay();
            return;
        }

        const color = analyzeAndDecide();
        if (color === null) {
            console.log('[BotBlaze] Sem decisao. Pulando rodada.');
            return;
        }

        const amount = calculateBetAmount();

        // Verifica saldo
        const balance = readBalance();
        if (balance > 0 && amount > balance) {
            console.warn('[BotBlaze] Saldo insuficiente. Saldo: R$' + balance.toFixed(2) + ' | Aposta: R$' + amount.toFixed(2));
            state.botActive = false;
            updateOverlay();
            return;
        }

        // Delay aleatorio curto para apostar rapido durante o countdown (0.5-1.5s)
        const delay = 500 + Math.random() * 1000;
        console.log('[BotBlaze] Apostando em ' + (delay / 1000).toFixed(1) + 's: ' + COLOR_NAMES[color] + ' R$' + amount.toFixed(2));

        setTimeout(() => {
            if (state.botActive && detectGamePhase() === 'betting') {
                placeBet(color, amount);
            } else {
                console.log('[BotBlaze] Fase mudou antes da aposta. Cancelando.');
            }
        }, delay);
    }

    // ===================== OBSERVADORES DO DOM =====================

    /**
     * Inicia MutationObserver para monitorar mudancas no DOM.
     */
    function startObserver() {
        const observer = new MutationObserver(() => {
            try {
                const newPhase = detectGamePhase();
                if (newPhase !== state.gamePhase && newPhase !== 'unknown') {
                    console.log('[BotBlaze] Fase: ' + state.gamePhase + ' -> ' + newPhase);
                    state.lastGamePhase = state.gamePhase;
                    state.gamePhase = newPhase;

                    if (newPhase === 'betting') {
                        onBettingPhase();
                    }
                }

                checkForNewResults();
            } catch (e) {
                console.error('[BotBlaze] Erro no MutationObserver:', e);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'data-color', 'data-value']
        });

        console.log('[BotBlaze] MutationObserver iniciado.');
    }

    /**
     * Polling de backup a cada 3 segundos.
     */
    function startPolling() {
        setInterval(() => {
            try {
                state.balance = readBalance();

                const phase = detectGamePhase();
                if (phase !== state.gamePhase && phase !== 'unknown') {
                    console.log('[BotBlaze] [Poll] Fase: ' + state.gamePhase + ' -> ' + phase);
                    state.lastGamePhase = state.gamePhase;
                    state.gamePhase = phase;

                    if (phase === 'betting') {
                        onBettingPhase();
                    }
                }

                checkForNewResults();
                updateOverlay();
            } catch (e) {
                console.error('[BotBlaze] Erro no polling:', e);
            }
        }, 3000);
    }

    /**
     * Computa assinatura do historico para detectar mudancas.
     * Usa multiplas estrategias (seletores, numeros, GIROS ANTERIORES).
     */
    function computeHistorySignature() {
        // Metodo 1: Seletores CSS
        const selectorSets = [
            '[class*="entries"] [class*="entry"]',
            '.roulette-previous .entry',
            '.sm-box',
            '#roulette-past .entry',
            '#roulette-past > div',
            '[class*="double-history"] div',
            '[class*="roulette"] [class*="past"]',
            '[class*="history"] [class*="item"]',
            '[class*="past"] [class*="box"]',
            '[class*="previous"] [class*="entry"]'
        ];

        for (const selector of selectorSets) {
            try {
                const items = document.querySelectorAll(selector);
                if (items.length >= 3) {
                    const first = items[0];
                    return 'sel:' + items.length + ':' + (first.className || '') + ':' + (first.textContent || '').trim().substring(0, 10);
                }
            } catch (e) {}
        }

        // Metodo 2: Circulos numerados
        const numbered = scanNumberedElements();
        if (numbered.length >= 2) {
            const nums = numbered.slice(0, 5).map(r => r.number !== undefined ? r.number : r.color);
            return 'num:' + numbered.length + ':' + nums.join(',');
        }

        // Metodo 3: Texto "Blaze Girou X!"
        const bodyText = (document.body.innerText || '').substring(0, 5000);
        const girouMatch = bodyText.match(/[Bb]laze [Gg]irou (\d+)/);
        if (girouMatch) {
            return 'girou:' + girouMatch[1];
        }

        return '';
    }

    /**
     * Verifica se ha novos resultados no historico da pagina.
     */
    function checkForNewResults() {
        const newSig = computeHistorySignature();

        if (!newSig || newSig === state.lastHistorySignature) return;

        state.lastHistorySignature = newSig;

        // Tenta detectar o resultado mais recente
        let newestColor = null;

        // Metodo 1: Texto "Blaze Girou X!"
        const bodyText = (document.body.innerText || '').substring(0, 5000);
        const girouMatch = bodyText.match(/[Bb]laze [Gg]irou (\d+)/);
        if (girouMatch) {
            newestColor = numberToColor(parseInt(girouMatch[1]));
            if (newestColor !== null) {
                console.log('[BotBlaze] Detectado via "Blaze Girou ' + girouMatch[1] + '": ' + COLOR_NAMES[newestColor]);
                onNewResult(newestColor);
                return;
            }
        }

        // Metodo 2: Seletores CSS (primeiro item = mais recente)
        const selectorSets = [
            '[class*="entries"] [class*="entry"]',
            '.roulette-previous .entry',
            '.sm-box',
            '#roulette-past .entry',
            '#roulette-past > div',
            '[class*="double-history"] div',
            '[class*="roulette"] [class*="past"]',
            '[class*="history"] [class*="item"]',
            '[class*="past"] [class*="box"]'
        ];

        for (const selector of selectorSets) {
            try {
                const items = document.querySelectorAll(selector);
                if (items.length >= 3) {
                    const newest = items[0];
                    newestColor = getColorFromElement(newest);
                    if (newestColor !== null) {
                        onNewResult(newestColor);
                        return;
                    }
                }
            } catch (e) {}
        }

        // Metodo 3: Circulos numerados (primeiro = mais recente)
        const numbered = scanNumberedElements();
        if (numbered.length >= 2) {
            newestColor = numbered[0].color;
            if (newestColor !== null) {
                onNewResult(newestColor);
                return;
            }
        }

        // Se temos poucos resultados no historico, tenta recarregar o historico completo
        if (state.gameHistory.length < 3) {
            readInitialHistory();
        }
    }

    // ===================== LISTENER PARA MENSAGENS DO POPUP =====================

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === 'toggleBot') {
            state.botActive = !!message.active;
            console.log('[BotBlaze] Bot ' + (state.botActive ? 'ATIVADO' : 'DESATIVADO') + ' pelo popup');

            const toggle = document.getElementById('bb-toggle');
            if (toggle) toggle.checked = state.botActive;

            updateOverlay();

            if (state.botActive && state.gamePhase === 'betting') {
                onBettingPhase();
            }

            sendResponse({ success: true, botActive: state.botActive });
            return false;
        }

        if (message.action === 'updateSettings') {
            state.settings = message.settings;
            console.log('[BotBlaze] Configuracoes atualizadas pelo popup');
            updateOverlay();
            sendResponse({ success: true });
            return false;
        }

        if (message.action === 'getBotState' || message.action === 'getStats') {
            sendResponse({
                success: true,
                botActive: state.botActive,
                gamePhase: state.gamePhase,
                sessionProfit: state.sessionProfit,
                profit: state.sessionProfit,
                sessionBets: state.sessionBets,
                bets: state.sessionBets,
                sessionWins: state.sessionWins,
                wins: state.sessionWins,
                sessionLosses: state.sessionLosses,
                losses: state.sessionLosses,
                martingaleLevel: state.martingaleLevel,
                balance: state.balance,
                historyLength: state.gameHistory.length,
                phase: state.gamePhase
            });
            return false;
        }

        return false;
    });

    // ===================== OVERLAY UI =====================

    /**
     * Cria o painel overlay flutuante na pagina da Blaze.
     */
    function createOverlay() {
        const existing = document.getElementById('botblaze-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'botblaze-overlay';

        let bodyContent = '';

        if (!state.authenticated) {
            bodyContent = '<p class="bb-msg">Faca login na extensao BotBlaze para comecar.<br><small style="color:#666;">Baixe a extensao configurada no seu painel.</small></p>';
        } else if (!state.hasSubscription) {
            bodyContent = '<p class="bb-msg">Seu plano nao esta ativo.<br><small style="color:#666;">Assine um plano no painel e baixe a extensao configurada.</small></p>';
        } else {
            bodyContent = `
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Status</span>
                    <span id="bb-status" class="${state.botActive ? 'bb-on' : 'bb-off'}">${state.botActive ? 'ATIVO' : 'PARADO'}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Saldo</span>
                    <span id="bb-balance">R$ ${state.balance.toFixed(2)}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Lucro Sessao</span>
                    <span id="bb-profit" class="${state.sessionProfit >= 0 ? 'bb-green' : 'bb-red'}">R$ ${state.sessionProfit.toFixed(2)}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Apostas</span>
                    <span id="bb-bets">${state.sessionBets}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Vitorias / Derrotas</span>
                    <span>
                        <span class="bb-green" id="bb-wins">${state.sessionWins}</span>
                        /
                        <span class="bb-red" id="bb-losses">${state.sessionLosses}</span>
                    </span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Martingale</span>
                    <span id="bb-mg">${(() => {
                        const mgOn = state.settings && (state.settings.martingale_enabled === true || state.settings.martingale_enabled == 1);
                        if (!mgOn) return 'Desligado';
                        const maxMg = (state.settings && state.settings.martingale_max) || 3;
                        return state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel + '/' + maxMg : 'Ativado (max ' + maxMg + ')';
                    })()}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Ultima Aposta</span>
                    <span id="bb-last-bet">${state.currentBetColor !== null ? COLOR_NAMES[state.currentBetColor] + ' R$' + state.currentBetAmount.toFixed(2) : '-'}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Fase</span>
                    <span id="bb-phase">${PHASE_NAMES[state.gamePhase] || state.gamePhase}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Historico</span>
                    <span id="bb-history">${state.gameHistory.length} jogos</span>
                </div>
                <div style="border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;padding-top:4px;">
                    <div class="bb-stat-row">
                        <span class="bb-stat-label">Sinal</span>
                        <span id="bb-signal" style="font-weight:bold">Analisando...</span>
                    </div>
                    <div class="bb-stat-row">
                        <span class="bb-stat-label">Confianca</span>
                        <span id="bb-confidence">-</span>
                    </div>
                    <div class="bb-stat-row">
                        <span class="bb-stat-label">Puladas</span>
                        <span id="bb-skipped">0</span>
                    </div>
                    <div class="bb-stat-row">
                        <span class="bb-stat-label">Branco em</span>
                        <span id="bb-white-gap">-</span>
                    </div>
                </div>
            `;
        }

        overlay.innerHTML = `
            <div class="bb-header" id="bb-header">
                <span class="bb-logo">BotBlaze</span>
                <span class="bb-header-controls">
                    ${state.authenticated && state.hasSubscription ? `
                        <label class="bb-switch" title="${state.botActive ? 'Desligar bot' : 'Ligar bot'}">
                            <input type="checkbox" id="bb-toggle" ${state.botActive ? 'checked' : ''}>
                            <span class="bb-slider"></span>
                        </label>
                    ` : ''}
                    <button class="bb-minimize-btn" id="bb-minimize" title="Minimizar">&#8722;</button>
                </span>
            </div>
            <div class="bb-body" id="bb-body">
                ${bodyContent}
            </div>
        `;

        document.body.appendChild(overlay);

        // Toggle do bot ON/OFF
        const toggle = document.getElementById('bb-toggle');
        if (toggle) {
            toggle.addEventListener('change', () => {
                state.botActive = toggle.checked;
                console.log('[BotBlaze] Bot ' + (state.botActive ? 'LIGADO' : 'DESLIGADO') + ' pelo overlay');
                updateOverlay();
                if (state.botActive && state.gamePhase === 'betting') {
                    onBettingPhase();
                }
            });
        }

        // Minimizar painel
        const minBtn = document.getElementById('bb-minimize');
        const body = document.getElementById('bb-body');
        if (minBtn && body) {
            minBtn.addEventListener('click', () => {
                const isHidden = body.style.display === 'none';
                body.style.display = isHidden ? 'block' : 'none';
                minBtn.innerHTML = isHidden ? '&#8722;' : '&#43;';
                minBtn.title = isHidden ? 'Minimizar' : 'Expandir';
            });
        }

        // Arrastar painel
        makeDraggable(overlay, document.getElementById('bb-header'));
    }

    /**
     * Atualiza valores do overlay sem recriar o DOM.
     */
    function updateOverlay() {
        const ids = {
            status:     document.getElementById('bb-status'),
            balance:    document.getElementById('bb-balance'),
            profit:     document.getElementById('bb-profit'),
            bets:       document.getElementById('bb-bets'),
            wins:       document.getElementById('bb-wins'),
            losses:     document.getElementById('bb-losses'),
            phase:      document.getElementById('bb-phase'),
            mg:         document.getElementById('bb-mg'),
            lastBet:    document.getElementById('bb-last-bet'),
            history:    document.getElementById('bb-history'),
            toggle:     document.getElementById('bb-toggle'),
            signal:     document.getElementById('bb-signal'),
            confidence: document.getElementById('bb-confidence'),
            skipped:    document.getElementById('bb-skipped'),
            whiteGap:   document.getElementById('bb-white-gap')
        };

        if (ids.status) {
            ids.status.textContent = state.botActive ? 'ATIVO' : 'PARADO';
            ids.status.className = state.botActive ? 'bb-on' : 'bb-off';
        }
        if (ids.balance) {
            ids.balance.textContent = 'R$ ' + state.balance.toFixed(2);
        }
        if (ids.profit) {
            ids.profit.textContent = 'R$ ' + state.sessionProfit.toFixed(2);
            ids.profit.className = state.sessionProfit >= 0 ? 'bb-green' : 'bb-red';
        }
        if (ids.bets) {
            ids.bets.textContent = state.sessionBets;
        }
        if (ids.wins) {
            ids.wins.textContent = state.sessionWins;
        }
        if (ids.losses) {
            ids.losses.textContent = state.sessionLosses;
        }
        if (ids.phase) {
            ids.phase.textContent = PHASE_NAMES[state.gamePhase] || state.gamePhase;
        }
        if (ids.mg) {
            const mgOn = state.settings && (state.settings.martingale_enabled === true || state.settings.martingale_enabled == 1);
            if (!mgOn) {
                ids.mg.textContent = 'Desligado';
            } else {
                const maxMg = (state.settings && state.settings.martingale_max) || 3;
                ids.mg.textContent = state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel + '/' + maxMg : 'Ativado (max ' + maxMg + ')';
            }
        }
        if (ids.lastBet) {
            if (state.waitingResult && state.currentBetColor !== null) {
                ids.lastBet.textContent = COLOR_NAMES[state.currentBetColor] + ' R$' + state.currentBetAmount.toFixed(2) + ' (aguardando)';
            } else if (state.sessionBets > 0) {
                const lastWon = state.sessionWins > 0 && (state.sessionProfit >= 0);
                ids.lastBet.textContent = lastWon ? 'Ultima: Vitoria' : 'Ultima: Derrota';
            } else {
                ids.lastBet.textContent = '-';
            }
        }
        if (ids.history) {
            ids.history.textContent = state.gameHistory.length + ' jogos';
        }
        if (ids.toggle) {
            ids.toggle.checked = state.botActive;
        }

        // --- Campos de analise inteligente ---
        if (ids.signal) {
            if (analysis.lastDecision !== null) {
                const colorEmoji = analysis.lastDecision === COLOR_RED ? '\u25CF' :
                    analysis.lastDecision === COLOR_BLACK ? '\u25CF' : '\u25CB';
                const colorStyle = analysis.lastDecision === COLOR_RED ? 'color:#ef4444' :
                    analysis.lastDecision === COLOR_BLACK ? 'color:#6b7280' : 'color:#fbbf24';
                ids.signal.innerHTML = '<span style="' + colorStyle + '">' + colorEmoji + '</span> ' + COLOR_NAMES[analysis.lastDecision];
            } else if (analysis.lastSignals.length > 0) {
                ids.signal.textContent = 'Sem confianca';
                ids.signal.style.color = '#fbbf24';
            } else {
                ids.signal.textContent = 'Sem sinal';
                ids.signal.style.color = '#9ca3af';
            }
        }
        if (ids.confidence) {
            const conf = analysis.lastConfidence;
            if (conf > 0) {
                const confColor = conf >= 70 ? '#22c55e' : conf >= 55 ? '#fbbf24' : '#ef4444';
                ids.confidence.innerHTML = '<span style="color:' + confColor + '">' + conf + '%</span>';
            } else {
                ids.confidence.textContent = '-';
            }
        }
        if (ids.skipped) {
            ids.skipped.textContent = analysis.roundsSkipped;
        }
        if (ids.whiteGap) {
            const gap = analysis.roundsSinceWhite;
            const avg = Math.round(analysis.avgWhiteInterval);
            const ratio = avg > 0 ? gap / avg : 0;
            const gapColor = ratio >= 1.5 ? '#ef4444' : ratio >= 1.0 ? '#fbbf24' : '#9ca3af';
            ids.whiteGap.innerHTML = '<span style="color:' + gapColor + '">' + gap + '</span> <small>(media ' + avg + ')</small>';
        }
    }

    /**
     * Torna um elemento arrastavel.
     */
    function makeDraggable(el, handle) {
        let offsetX = 0;
        let offsetY = 0;
        let isDragging = false;

        handle.style.cursor = 'grab';

        handle.addEventListener('mousedown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.closest('.bb-switch')) {
                return;
            }
            isDragging = true;
            offsetX = e.clientX - el.getBoundingClientRect().left;
            offsetY = e.clientY - el.getBoundingClientRect().top;
            handle.style.cursor = 'grabbing';
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            let newX = e.clientX - offsetX;
            let newY = e.clientY - offsetY;

            const maxX = window.innerWidth - el.offsetWidth;
            const maxY = window.innerHeight - el.offsetHeight;
            newX = Math.max(0, Math.min(newX, maxX));
            newY = Math.max(0, Math.min(newY, maxY));

            el.style.left = newX + 'px';
            el.style.top = newY + 'px';
            el.style.right = 'auto';
        });

        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                handle.style.cursor = 'grab';
            }
        });
    }

    // ===================== HELPERS =====================

    /**
     * Salva estatisticas da sessao no storage via background.
     * Chamado apos cada resultado de aposta para persistir dados.
     */
    function saveSessionStats() {
        sendMessage({
            action: 'saveSessionStats',
            payload: {
                sessionProfit: state.sessionProfit,
                sessionBets: state.sessionBets,
                sessionWins: state.sessionWins,
                sessionLosses: state.sessionLosses,
                todayBets: state.todayBets,
                martingaleLevel: state.martingaleLevel,
                currentBetColor: state.currentBetColor,
                currentBetAmount: state.currentBetAmount,
                waitingResult: state.waitingResult
            }
        });
    }

    function sendMessage(msg) {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage(msg, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[BotBlaze] Erro ao enviar mensagem:', chrome.runtime.lastError.message);
                        resolve({});
                        return;
                    }
                    resolve(response || {});
                });
            } catch (e) {
                console.warn('[BotBlaze] Erro ao enviar mensagem:', e);
                resolve({});
            }
        });
    }

    // ===================== INICIAR =====================

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2500));
    } else {
        setTimeout(init, 2500);
    }

    console.log('[BotBlaze] Content script injetado. Aguardando carregamento...');

})();
