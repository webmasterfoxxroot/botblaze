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
        balance: 0
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
        } else {
            state.settings = getDefaultSettings();
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
            strategy: 'frequency',
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
     * Tenta multiplos seletores para ser robusto a mudancas de layout.
     */
    function readInitialHistory() {
        state.gameHistory = [];

        // Seletores possiveis para os itens de historico (circulos coloridos)
        // TODO: ajustar seletor se necessario
        const selectorSets = [
            '[class*="entries"] [class*="entry"]',
            '.roulette-previous .entry',
            '.sm-box',
            '[class*="double-history"] div',
            '[class*="roulette"] [class*="past"]',
            '[class*="history"] [class*="item"]',
            '[class*="recent"] [class*="circle"]',
            '[data-role="history-item"]'
        ];

        let items = [];
        for (const selector of selectorSets) {
            try {
                items = document.querySelectorAll(selector);
                if (items.length > 0) break;
            } catch (e) {
                // Seletor invalido, pula
            }
        }

        items.forEach((el) => {
            const color = getColorFromElement(el);
            if (color !== null) {
                state.gameHistory.push({ color, timestamp: Date.now() });
            }
        });

        state.lastHistorySignature = computeHistorySignature();

        console.log('[BotBlaze] Historico inicial lido:', state.gameHistory.length, 'resultados');
        updateOverlay();
    }

    /**
     * Determina a cor de um elemento do historico baseado em classes, styles e atributos.
     * Retorna COLOR_WHITE (0), COLOR_RED (1), COLOR_BLACK (2), ou null.
     */
    function getColorFromElement(el) {
        if (!el) return null;

        const classes = (el.className || '').toLowerCase();
        const bg = (el.style && el.style.backgroundColor) ? el.style.backgroundColor.toLowerCase() : '';
        const text = (el.textContent || '').trim().toLowerCase();
        const dataColor = el.getAttribute('data-color') || el.getAttribute('data-value') || '';

        // --- Via data-attribute (mais confiavel) ---
        if (dataColor === '0' || dataColor === 'white' || dataColor === 'branco') return COLOR_WHITE;
        if (dataColor === '1' || dataColor === 'red' || dataColor === 'vermelho')  return COLOR_RED;
        if (dataColor === '2' || dataColor === 'black' || dataColor === 'preto')   return COLOR_BLACK;

        // --- Via classes CSS ---
        // Branco precisa vir antes, porque 'white' pode ser confundido com background generico
        if (classes.includes('white') || classes.includes('branco')) return COLOR_WHITE;
        if (classes.includes('red') || classes.includes('vermelho'))   return COLOR_RED;
        if (classes.includes('black') || classes.includes('preto') || classes.includes('dark')) return COLOR_BLACK;

        // --- Via background-color ---
        if (bg) {
            // Branco
            if (bg.includes('rgb(255, 255, 255') || bg.includes('#fff') || bg.includes('#ffffff') || bg.includes('#eee') || bg.includes('#ebebeb')) {
                return COLOR_WHITE;
            }
            // Vermelho
            if (bg.includes('#e63946') || bg.includes('#d32f2f') || bg.includes('#f44336') || bg.includes('rgb(255, 0') || bg.includes('rgb(230,')) {
                if (!bg.includes('rgb(255, 255')) return COLOR_RED;
            }
            // Preto
            if (bg.includes('rgb(0, 0, 0') || bg.includes('#000') || bg.includes('#1a1a') || bg.includes('#2d2d') || bg.includes('#333') || bg.includes('#212121')) {
                return COLOR_BLACK;
            }
        }

        // --- Via texto do elemento ---
        if (text === '0' || text.includes('branco')) return COLOR_WHITE;
        if (text === '1' || text.includes('vermelho')) return COLOR_RED;
        if (text === '2' || text.includes('preto')) return COLOR_BLACK;

        return null;
    }

    /**
     * Detecta a fase atual do jogo lendo elementos de status na pagina.
     */
    function detectGamePhase() {
        // TODO: ajustar seletores se necessario
        const statusSelectors = [
            '[class*="status"]',
            '[class*="timer"]',
            '[class*="waiting"]',
            '[class*="game-info"]',
            '[class*="roulette-status"]'
        ];

        let statusText = '';

        for (const sel of statusSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el && el.textContent) {
                    statusText = el.textContent.toLowerCase();
                    break;
                }
            } catch (e) {
                // Seletor invalido
            }
        }

        // Fallback: texto geral (limitado para performance)
        if (!statusText) {
            statusText = (document.body.innerText || '').toLowerCase().substring(0, 2000);
        }

        // Fase de apostas
        if (
            statusText.includes('esperando') ||
            statusText.includes('aguardando') ||
            statusText.includes('faca sua aposta') ||
            statusText.includes('aposte agora') ||
            statusText.includes('waiting') ||
            statusText.includes('place your bet')
        ) {
            return 'betting';
        }

        // Roleta girando
        if (
            statusText.includes('girando') ||
            statusText.includes('girar') ||
            statusText.includes('rolling') ||
            statusText.includes('spinning')
        ) {
            return 'spinning';
        }

        // Fallback: verifica se o botao de apostar esta visivel
        const betBtnSelectors = [
            'button[class*="bet"]',
            'button[class*="place"]',
            '[class*="bet-button"]',
            'button[class*="apostar"]'
        ];

        for (const sel of betBtnSelectors) {
            try {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled && btn.offsetParent !== null) {
                    return 'betting';
                }
            } catch (e) { /* seletor invalido */ }
        }

        return 'unknown';
    }

    /**
     * Le o saldo do usuario exibido na pagina da Blaze.
     */
    function readBalance() {
        // TODO: ajustar seletor se necessario
        const balanceSelectors = [
            '[class*="balance"]',
            '[class*="wallet"]',
            '[class*="saldo"]',
            '[class*="money"]'
        ];

        for (const sel of balanceSelectors) {
            try {
                const el = document.querySelector(sel);
                if (el && el.textContent) {
                    const text = el.textContent.replace(/[^\d.,]/g, '').replace(',', '.');
                    const val = parseFloat(text);
                    if (!isNaN(val) && val > 0) return val;
                }
            } catch (e) { /* seletor invalido */ }
        }

        return 0;
    }

    /**
     * Le o tempo restante (countdown) da fase de apostas.
     */
    function readCountdown() {
        // TODO: ajustar seletor se necessario
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

    // ===================== ESTRATEGIAS DE APOSTA =====================

    /**
     * Analisa o historico e retorna a cor para apostar.
     */
    function analyzeAndDecide() {
        if (!state.settings) return null;

        const strategy = state.settings.strategy || 'frequency';
        const history = state.gameHistory.slice(0, 20);

        if (history.length < 3) {
            console.log('[BotBlaze] Historico insuficiente (' + history.length + ' resultados)');
            return null;
        }

        switch (strategy) {
            case 'frequency':
            case 'color_frequency':
                return strategyFrequency(history);

            case 'pattern':
                return strategyPattern(history);

            case 'martingale':
                // No martingale puro: se perdeu, repete mesma cor
                if (state.currentBetColor !== null && state.martingaleLevel > 0) {
                    return state.currentBetColor;
                }
                return strategyFrequency(history);

            default:
                console.warn('[BotBlaze] Estrategia desconhecida:', strategy);
                return strategyFrequency(history);
        }
    }

    /**
     * Estrategia de Frequencia de Cor:
     * Aposta na cor que menos apareceu nos ultimos N resultados.
     */
    function strategyFrequency(history) {
        const counts = { [COLOR_RED]: 0, [COLOR_BLACK]: 0, [COLOR_WHITE]: 0 };

        history.forEach((h) => {
            if (h.color in counts) counts[h.color]++;
        });

        // Aposta na cor (vermelho ou preto) que menos apareceu
        if (counts[COLOR_RED] <= counts[COLOR_BLACK]) {
            return COLOR_RED;
        } else {
            return COLOR_BLACK;
        }
    }

    /**
     * Estrategia de Padrao (Pattern):
     * Detecta sequencias e aposta na cor oposta.
     */
    function strategyPattern(history) {
        if (history.length < 3) return null;

        // Conta sequencia atual (mesma cor consecutiva)
        const streakColor = history[0].color;
        let streakCount = 0;

        for (let i = 0; i < history.length; i++) {
            if (history[i].color === streakColor) {
                streakCount++;
            } else {
                break;
            }
        }

        // Se ha sequencia de 3+ da mesma cor, aposta na oposta
        if (streakCount >= 3) {
            if (streakColor === COLOR_RED) {
                console.log('[BotBlaze] Sequencia de ' + streakCount + ' vermelhos -> apostando preto');
                return COLOR_BLACK;
            }
            if (streakColor === COLOR_BLACK) {
                console.log('[BotBlaze] Sequencia de ' + streakCount + ' pretos -> apostando vermelho');
                return COLOR_RED;
            }
        }

        // Detecta alternancia (vermelho, preto, vermelho, preto...)
        if (history.length >= 4) {
            const alt = (
                history[0].color !== history[1].color &&
                history[1].color !== history[2].color &&
                history[2].color !== history[3].color
            );
            if (alt) {
                return history[0].color === COLOR_RED ? COLOR_BLACK : COLOR_RED;
            }
        }

        // Fallback
        return strategyFrequency(history);
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

        updateOverlay();
        return true;
    }

    /**
     * Encontra o input de valor de aposta.
     */
    function findBetAmountInput() {
        // TODO: ajustar seletor se necessario
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
        // TODO: ajustar seletores se necessario
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
        // TODO: ajustar seletor se necessario
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
        if (state.gameHistory.length > 50) state.gameHistory.pop();

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

        // Delay aleatorio para parecer natural (1.5-4.5s)
        const delay = 1500 + Math.random() * 3000;
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
     */
    function computeHistorySignature() {
        const selectorSets = [
            '[class*="entries"] [class*="entry"]',
            '.roulette-previous .entry',
            '.sm-box',
            '[class*="double-history"] div',
            '[class*="roulette"] [class*="past"]',
            '[class*="history"] [class*="item"]'
        ];

        for (const selector of selectorSets) {
            try {
                const items = document.querySelectorAll(selector);
                if (items.length > 0) {
                    const first = items[0];
                    return items.length + ':' + (first.className || '') + ':' + (first.textContent || '').trim().substring(0, 10);
                }
            } catch (e) { /* seletor invalido */ }
        }

        return '';
    }

    /**
     * Verifica se ha novos resultados no historico da pagina.
     */
    function checkForNewResults() {
        const newSig = computeHistorySignature();

        if (newSig && newSig !== state.lastHistorySignature) {
            state.lastHistorySignature = newSig;

            const selectorSets = [
                '[class*="entries"] [class*="entry"]',
                '.roulette-previous .entry',
                '.sm-box',
                '[class*="double-history"] div',
                '[class*="roulette"] [class*="past"]',
                '[class*="history"] [class*="item"]'
            ];

            for (const selector of selectorSets) {
                try {
                    const items = document.querySelectorAll(selector);
                    if (items.length > 0) {
                        const newest = items[0];
                        const color = getColorFromElement(newest);
                        if (color !== null) {
                            onNewResult(color);
                        }
                        break;
                    }
                } catch (e) { /* seletor invalido */ }
            }
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
                    <span class="bb-stat-label">Win / Loss</span>
                    <span>
                        <span class="bb-green" id="bb-wins">${state.sessionWins}</span>
                        /
                        <span class="bb-red" id="bb-losses">${state.sessionLosses}</span>
                    </span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Martingale</span>
                    <span id="bb-mg">${state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel : 'Off'}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Ultima Aposta</span>
                    <span id="bb-last-bet">${state.currentBetColor !== null ? COLOR_NAMES[state.currentBetColor] + ' R$' + state.currentBetAmount.toFixed(2) : '-'}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Fase</span>
                    <span id="bb-phase">${state.gamePhase}</span>
                </div>
                <div class="bb-stat-row">
                    <span class="bb-stat-label">Historico</span>
                    <span id="bb-history">${state.gameHistory.length} jogos</span>
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
            status:  document.getElementById('bb-status'),
            balance: document.getElementById('bb-balance'),
            profit:  document.getElementById('bb-profit'),
            bets:    document.getElementById('bb-bets'),
            wins:    document.getElementById('bb-wins'),
            losses:  document.getElementById('bb-losses'),
            phase:   document.getElementById('bb-phase'),
            mg:      document.getElementById('bb-mg'),
            lastBet: document.getElementById('bb-last-bet'),
            history: document.getElementById('bb-history'),
            toggle:  document.getElementById('bb-toggle')
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
            ids.phase.textContent = state.gamePhase;
        }
        if (ids.mg) {
            ids.mg.textContent = state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel : 'Off';
        }
        if (ids.lastBet) {
            if (state.waitingResult && state.currentBetColor !== null) {
                ids.lastBet.textContent = COLOR_NAMES[state.currentBetColor] + ' R$' + state.currentBetAmount.toFixed(2) + ' (aguardando)';
            } else if (state.sessionBets > 0) {
                const lastWon = state.sessionWins > 0 && (state.sessionProfit >= 0);
                ids.lastBet.textContent = lastWon ? 'Ultima: Win' : 'Ultima: Loss';
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
