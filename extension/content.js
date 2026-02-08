// BotBlaze - Content Script (injected into blaze.bet.br/pt/games/double)
// Este script le o DOM da Blaze, analisa padroes e faz apostas automaticas

(function() {
    'use strict';

    // === STATE ===
    const state = {
        authenticated: false,
        hasSubscription: false,
        settings: null,
        botActive: false,
        gamePhase: 'unknown', // betting, spinning, result
        lastGameId: null,
        gameHistory: [],      // ultimos resultados [{color, roll}]
        sessionProfit: 0,
        sessionBets: 0,
        sessionWins: 0,
        sessionLosses: 0,
        todayBets: 0,
        currentBetColor: null,
        currentBetAmount: 0,
        martingaleLevel: 0,
        waitingResult: false,
        lastBetTime: 0
    };

    // === INIT ===
    async function init() {
        console.log('[BotBlaze] Extensao carregada na Blaze Double');

        // Verifica autenticacao
        const authData = await sendMessage({ action: 'checkAuth' });
        if (!authData.authenticated) {
            console.log('[BotBlaze] Nao autenticado. Faca login na extensao.');
            createOverlay(false);
            return;
        }

        state.authenticated = true;
        state.hasSubscription = authData.hasSubscription;

        if (!state.hasSubscription) {
            console.log('[BotBlaze] Sem assinatura ativa.');
            createOverlay(false);
            return;
        }

        // Carrega configuracoes
        const settingsData = await sendMessage({ action: 'getSettings' });
        if (settingsData.settings) {
            state.settings = settingsData.settings;
            state.botActive = state.settings.auto_bet == 1;
        }

        createOverlay(true);
        startObserver();
        readInitialHistory();

        console.log('[BotBlaze] Bot pronto! Auto-bet:', state.botActive);
    }

    // === DOM READING ===

    // Le o historico de cores da barra superior da Blaze
    function readInitialHistory() {
        // TODO: ajustar seletor se necessario
        const historyItems = document.querySelectorAll('[class*="entries"] [class*="entry"], .roulette-previous .entry, .sm-box');
        state.gameHistory = [];

        historyItems.forEach(el => {
            const color = getColorFromElement(el);
            if (color !== null) {
                state.gameHistory.push({ color });
            }
        });

        if (state.gameHistory.length === 0) {
            // Fallback: tenta outro seletor
            const circles = document.querySelectorAll('[class*="double-history"] div, [class*="roulette"] [class*="past"]');
            circles.forEach(el => {
                const color = getColorFromElement(el);
                if (color !== null) {
                    state.gameHistory.push({ color });
                }
            });
        }

        console.log('[BotBlaze] Historico lido:', state.gameHistory.length, 'jogos');
        updateOverlay();
    }

    // Determina a cor de um elemento do historico
    function getColorFromElement(el) {
        const classes = el.className || '';
        const bg = el.style.backgroundColor || '';
        const text = el.textContent || '';

        // Vermelho
        if (classes.includes('red') || bg.includes('rgb(255') || bg.includes('#e63946') || bg.includes('#ff')) return 1;
        // Preto
        if (classes.includes('black') || classes.includes('dark') || bg.includes('rgb(0') || bg.includes('#1a1a') || bg.includes('#2d2d')) return 2;
        // Branco
        if (classes.includes('white') || bg.includes('rgb(255, 255') || bg.includes('#fff') || bg.includes('#eee')) return 0;

        // Tenta pelo data-attribute
        const color = el.getAttribute('data-color') || el.getAttribute('data-value');
        if (color === '1' || color === 'red') return 1;
        if (color === '2' || color === 'black') return 2;
        if (color === '0' || color === 'white') return 0;

        return null;
    }

    // Detecta a fase atual do jogo
    function detectGamePhase() {
        const pageText = document.body.innerText || '';

        // TODO: ajustar seletores se necessario
        const statusEl = document.querySelector('[class*="status"], [class*="timer"], [class*="waiting"]');
        const statusText = statusEl ? statusEl.textContent.toLowerCase() : pageText.toLowerCase();

        if (statusText.includes('esperando') || statusText.includes('faça sua aposta') || statusText.includes('aposte')) {
            return 'betting';
        }
        if (statusText.includes('girando') || statusText.includes('rolling') || statusText.includes('spinning')) {
            return 'spinning';
        }

        // Detecta pelo botao de aposta (se visivel = fase de apostas)
        const betButton = document.querySelector('button[class*="bet"], button[class*="place"], [class*="bet-button"]');
        if (betButton && !betButton.disabled && betButton.offsetParent !== null) {
            return 'betting';
        }

        return 'unknown';
    }

    // Le o saldo do usuario na Blaze
    function readBalance() {
        // TODO: ajustar seletor se necessario
        const balanceEl = document.querySelector('[class*="balance"], [class*="wallet"], [class*="amount"]');
        if (balanceEl) {
            const text = balanceEl.textContent.replace(/[^\d.,]/g, '').replace(',', '.');
            return parseFloat(text) || 0;
        }
        return 0;
    }

    // === BETTING LOGIC ===

    // Analisa historico e decide a cor para apostar
    function analyzeAndDecide() {
        if (!state.settings) return null;

        const strategy = state.settings.strategy || 'color_frequency';
        const history = state.gameHistory.slice(0, 20); // ultimos 20

        if (history.length < 3) return null;

        switch (strategy) {
            case 'color_frequency':
                return strategyFrequency(history);
            case 'pattern':
                return strategyPattern(history);
            case 'martingale':
                // No martingale puro, repete a mesma cor
                if (state.currentBetColor !== null && state.martingaleLevel > 0) {
                    return state.currentBetColor;
                }
                return strategyFrequency(history);
            default:
                return null; // manual
        }
    }

    // Estrategia: aposta na cor que menos apareceu (deve "equilibrar")
    function strategyFrequency(history) {
        const counts = { 1: 0, 2: 0 }; // so vermelho e preto
        history.forEach(h => {
            if (h.color === 1) counts[1]++;
            if (h.color === 2) counts[2]++;
        });

        // Aposta na cor que menos apareceu
        return counts[1] <= counts[2] ? 1 : 2;
    }

    // Estrategia: detecta sequencias e aposta na cor oposta
    function strategyPattern(history) {
        if (history.length < 3) return null;

        // Se ultimas 3 sao da mesma cor, aposta na oposta
        const last3 = history.slice(0, 3).map(h => h.color);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
            if (last3[0] === 1) return 2; // 3 vermelhos -> aposta preto
            if (last3[0] === 2) return 1; // 3 pretos -> aposta vermelho
        }

        // Fallback: frequencia
        return strategyFrequency(history);
    }

    // Calcula o valor da aposta (com martingale se ativo)
    function calculateBetAmount() {
        const base = parseFloat(state.settings.bet_amount) || 2;

        if (state.settings.martingale_enabled == 1 && state.martingaleLevel > 0) {
            const mult = parseFloat(state.settings.martingale_multiplier) || 2.0;
            const maxLevel = parseInt(state.settings.martingale_max) || 3;
            const level = Math.min(state.martingaleLevel, maxLevel);
            return base * Math.pow(mult, level);
        }

        return base;
    }

    // Verifica limites (stop loss, stop gain, max bets)
    function checkLimits() {
        if (!state.settings) return false;

        const stopLoss = parseFloat(state.settings.stop_loss) || 50;
        const stopGain = parseFloat(state.settings.stop_gain) || 100;
        const maxBets = parseInt(state.settings.max_bets_per_day) || 50;

        if (state.sessionProfit <= -stopLoss) {
            console.log('[BotBlaze] STOP LOSS atingido:', state.sessionProfit);
            return false;
        }
        if (state.sessionProfit >= stopGain) {
            console.log('[BotBlaze] STOP GAIN atingido:', state.sessionProfit);
            return false;
        }
        if (state.todayBets >= maxBets) {
            console.log('[BotBlaze] MAX APOSTAS atingido:', state.todayBets);
            return false;
        }

        return true;
    }

    // === PLACE BET (DOM interaction) ===

    function placeBet(color, amount) {
        console.log('[BotBlaze] Apostando:', colorName(color), 'R$', amount.toFixed(2));

        // 1. Define o valor da aposta
        // TODO: ajustar seletor se necessario
        const amountInput = document.querySelector('input[class*="amount"], input[class*="bet-input"], input[type="number"]');
        if (amountInput) {
            setInputValue(amountInput, amount.toFixed(2));
        } else {
            console.warn('[BotBlaze] Input de valor nao encontrado');
            return false;
        }

        // 2. Clica no botao da cor
        let colorButton = null;

        // Tenta encontrar os botoes de cor
        // TODO: ajustar seletores se necessario
        const buttons = document.querySelectorAll('button, [role="button"], [class*="color-button"], [class*="bet-color"]');

        buttons.forEach(btn => {
            const text = btn.textContent.toLowerCase();
            const cls = btn.className || '';

            if (color === 1 && (cls.includes('red') || text.includes('x2') && !cls.includes('black'))) {
                if (!colorButton) colorButton = btn;
            }
            if (color === 2 && (cls.includes('black') || cls.includes('dark'))) {
                if (!colorButton) colorButton = btn;
            }
            if (color === 0 && (cls.includes('white') || text.includes('x14'))) {
                colorButton = btn;
            }
        });

        if (colorButton) {
            colorButton.click();
            console.log('[BotBlaze] Botao clicado:', colorName(color));

            // 3. Clica no botao de confirmar aposta (se existir)
            setTimeout(() => {
                const confirmBtn = document.querySelector('button[class*="confirm"], button[class*="place-bet"], button[class*="apostar"]');
                if (confirmBtn) confirmBtn.click();
            }, 500);

            state.currentBetColor = color;
            state.currentBetAmount = amount;
            state.waitingResult = true;
            state.lastBetTime = Date.now();
            state.sessionBets++;
            state.todayBets++;
            updateOverlay();
            return true;
        } else {
            console.warn('[BotBlaze] Botao de cor nao encontrado para:', colorName(color));
            return false;
        }
    }

    // Simula digitacao no input
    function setInputValue(input, value) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        nativeInputValueSetter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // === GAME LOOP ===

    function onNewResult(color) {
        // Adiciona ao historico
        state.gameHistory.unshift({ color });
        if (state.gameHistory.length > 50) state.gameHistory.pop();

        // Processa resultado da aposta
        if (state.waitingResult && state.currentBetColor !== null) {
            const won = state.currentBetColor === color;
            const multiplier = color === 0 ? 14 : 2;
            const profit = won ? state.currentBetAmount * (multiplier - 1) : -state.currentBetAmount;

            state.sessionProfit += profit;
            if (won) {
                state.sessionWins++;
                state.martingaleLevel = 0; // reset martingale
                console.log('[BotBlaze] WIN! +R$', profit.toFixed(2));
            } else {
                state.sessionLosses++;
                if (state.settings.martingale_enabled == 1) {
                    const maxLevel = parseInt(state.settings.martingale_max) || 3;
                    if (state.martingaleLevel < maxLevel) {
                        state.martingaleLevel++;
                        console.log('[BotBlaze] LOSS. Martingale nivel:', state.martingaleLevel);
                    } else {
                        state.martingaleLevel = 0;
                        console.log('[BotBlaze] LOSS. Martingale MAX atingido, resetando.');
                    }
                }
                console.log('[BotBlaze] LOSS. -R$', Math.abs(profit).toFixed(2));
            }

            // Registra no backend
            sendMessage({
                action: 'recordBet',
                bet: {
                    game_id: 'blaze_' + Date.now(),
                    color_bet: state.currentBetColor,
                    amount: state.currentBetAmount,
                    result: won ? 'win' : 'loss',
                    profit: profit,
                    roll_result: color,
                    was_martingale: state.martingaleLevel > 0 ? 1 : 0,
                    martingale_level: state.martingaleLevel
                }
            });

            state.waitingResult = false;
            state.currentBetColor = null;
        }

        updateOverlay();
    }

    function onBettingPhase() {
        if (!state.botActive || !state.hasSubscription || !state.settings) return;
        if (state.waitingResult) return;
        if (Date.now() - state.lastBetTime < 5000) return; // debounce 5s

        if (!checkLimits()) {
            state.botActive = false;
            updateOverlay();
            return;
        }

        const color = analyzeAndDecide();
        if (color === null) return;

        const amount = calculateBetAmount();

        // Delay aleatorio para parecer mais natural
        const delay = 2000 + Math.random() * 3000;
        setTimeout(() => {
            if (state.botActive && detectGamePhase() === 'betting') {
                placeBet(color, amount);
            }
        }, delay);
    }

    // === DOM OBSERVER ===

    function startObserver() {
        // Observa mudancas no DOM para detectar novos resultados e fases
        const observer = new MutationObserver((mutations) => {
            const newPhase = detectGamePhase();

            if (newPhase !== state.gamePhase) {
                console.log('[BotBlaze] Fase:', state.gamePhase, '->', newPhase);
                state.gamePhase = newPhase;

                if (newPhase === 'betting') {
                    onBettingPhase();
                }
            }

            // Detecta novos resultados no historico
            checkForNewResults();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style']
        });

        // Poll backup a cada 3s
        setInterval(() => {
            const phase = detectGamePhase();
            if (phase !== state.gamePhase) {
                state.gamePhase = phase;
                if (phase === 'betting') onBettingPhase();
            }
            updateOverlay();
        }, 3000);
    }

    let lastHistoryCount = 0;
    function checkForNewResults() {
        const items = document.querySelectorAll('[class*="entries"] [class*="entry"], .roulette-previous .entry, .sm-box');
        if (items.length > 0 && items.length !== lastHistoryCount) {
            const newest = items[0];
            const color = getColorFromElement(newest);
            if (color !== null && lastHistoryCount > 0) {
                onNewResult(color);
            }
            lastHistoryCount = items.length;
        }
    }

    // === OVERLAY UI ===

    function createOverlay(active) {
        // Remove overlay existente
        const existing = document.getElementById('botblaze-overlay');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'botblaze-overlay';
        overlay.innerHTML = `
            <div class="bb-header" id="bb-header">
                <span class="bb-logo">BotBlaze</span>
                <span class="bb-toggle-area">
                    <label class="bb-switch">
                        <input type="checkbox" id="bb-toggle" ${state.botActive ? 'checked' : ''} ${!active ? 'disabled' : ''}>
                        <span class="bb-slider"></span>
                    </label>
                    <button class="bb-minimize" id="bb-minimize">_</button>
                </span>
            </div>
            <div class="bb-body" id="bb-body">
                ${!state.authenticated ? '<p class="bb-msg">Faca login na extensao BotBlaze</p>' :
                  !state.hasSubscription ? '<p class="bb-msg">Assine um plano para usar o bot</p>' : `
                    <div class="bb-stat-row">
                        <span>Status</span>
                        <span id="bb-status" class="${state.botActive ? 'bb-on' : 'bb-off'}">${state.botActive ? 'ATIVO' : 'PARADO'}</span>
                    </div>
                    <div class="bb-stat-row">
                        <span>Lucro Sessao</span>
                        <span id="bb-profit" class="${state.sessionProfit >= 0 ? 'bb-green' : 'bb-red'}">R$ ${state.sessionProfit.toFixed(2)}</span>
                    </div>
                    <div class="bb-stat-row">
                        <span>Apostas</span>
                        <span id="bb-bets">${state.sessionBets}</span>
                    </div>
                    <div class="bb-stat-row">
                        <span>Win/Loss</span>
                        <span><span class="bb-green">${state.sessionWins}</span> / <span class="bb-red">${state.sessionLosses}</span></span>
                    </div>
                    <div class="bb-stat-row">
                        <span>Martingale</span>
                        <span id="bb-mg">${state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel : 'Off'}</span>
                    </div>
                    <div class="bb-stat-row">
                        <span>Fase</span>
                        <span id="bb-phase">${state.gamePhase}</span>
                    </div>
                `}
            </div>
        `;

        document.body.appendChild(overlay);

        // Toggle bot
        const toggle = document.getElementById('bb-toggle');
        if (toggle) {
            toggle.addEventListener('change', () => {
                state.botActive = toggle.checked;
                updateOverlay();
                if (state.botActive && state.gamePhase === 'betting') {
                    onBettingPhase();
                }
            });
        }

        // Minimize
        const minBtn = document.getElementById('bb-minimize');
        const body = document.getElementById('bb-body');
        if (minBtn && body) {
            minBtn.addEventListener('click', () => {
                body.style.display = body.style.display === 'none' ? 'block' : 'none';
                minBtn.textContent = body.style.display === 'none' ? '+' : '_';
            });
        }

        // Draggable
        makeDraggable(overlay, document.getElementById('bb-header'));
    }

    function updateOverlay() {
        const statusEl = document.getElementById('bb-status');
        const profitEl = document.getElementById('bb-profit');
        const betsEl = document.getElementById('bb-bets');
        const phaseEl = document.getElementById('bb-phase');
        const mgEl = document.getElementById('bb-mg');

        if (statusEl) {
            statusEl.textContent = state.botActive ? 'ATIVO' : 'PARADO';
            statusEl.className = state.botActive ? 'bb-on' : 'bb-off';
        }
        if (profitEl) {
            profitEl.textContent = 'R$ ' + state.sessionProfit.toFixed(2);
            profitEl.className = state.sessionProfit >= 0 ? 'bb-green' : 'bb-red';
        }
        if (betsEl) betsEl.textContent = state.sessionBets;
        if (phaseEl) phaseEl.textContent = state.gamePhase;
        if (mgEl) mgEl.textContent = state.martingaleLevel > 0 ? 'Nv ' + state.martingaleLevel : 'Off';
    }

    function makeDraggable(el, handle) {
        let offsetX = 0, offsetY = 0, isDragging = false;
        handle.addEventListener('mousedown', (e) => {
            isDragging = true;
            offsetX = e.clientX - el.offsetLeft;
            offsetY = e.clientY - el.offsetTop;
            e.preventDefault();
        });
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            el.style.left = (e.clientX - offsetX) + 'px';
            el.style.top = (e.clientY - offsetY) + 'px';
            el.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => isDragging = false);
    }

    // === HELPERS ===

    function colorName(c) {
        return { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' }[c] || '?';
    }

    function sendMessage(msg) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(msg, (response) => {
                resolve(response || {});
            });
        });
    }

    // === MESSAGE LISTENER (from popup) ===
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'getStats') {
            sendResponse({
                success: true,
                profit: state.sessionProfit,
                bets: state.sessionBets,
                wins: state.sessionWins,
                losses: state.sessionLosses,
                botActive: state.botActive,
                phase: state.gamePhase
            });
        }
        if (msg.action === 'toggleBot') {
            state.botActive = !!msg.active;
            const toggle = document.getElementById('bb-toggle');
            if (toggle) toggle.checked = state.botActive;
            updateOverlay();
            if (state.botActive && state.gamePhase === 'betting') {
                onBettingPhase();
            }
            sendResponse({ success: true });
        }
    });

    // === START ===
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 2000));
    } else {
        setTimeout(init, 2000);
    }
})();
