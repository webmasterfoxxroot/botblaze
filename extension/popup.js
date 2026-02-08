// ============================================================
// BotBlaze - Extension Popup Script
// ============================================================
// Gerencia login, configuracoes e exibicao de estatisticas
// no popup da extensao.
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {

    // === REFERENCIAS AOS ELEMENTOS ===

    const viewLogin  = document.getElementById('view-login');
    const viewNoSub  = document.getElementById('view-no-sub');
    const viewMain   = document.getElementById('view-main');

    // === VERIFICA ESTADO ATUAL ===

    const stateData = await sendMessage({ action: 'getState' });

    if (stateData.authenticated && stateData.hasSubscription) {
        showMainView(stateData);
    } else if (stateData.authenticated && !stateData.hasSubscription) {
        showNoSubView(stateData);
    } else {
        showLoginView();
    }

    // === LOGIN ===

    document.getElementById('btn-login').addEventListener('click', async () => {
        const email    = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl  = document.getElementById('login-error');
        const btn      = document.getElementById('btn-login');

        if (!email || !password) {
            showError(errorEl, 'Preencha email e senha.');
            return;
        }

        // Salva URL da API se configurada
        const apiUrl = document.getElementById('api-url').value.trim();
        if (apiUrl) {
            await sendMessage({ action: 'setApiUrl', payload: { api_url: apiUrl } });
        }

        btn.disabled = true;
        btn.textContent = 'Entrando...';
        errorEl.style.display = 'none';

        const result = await sendMessage({
            action: 'login',
            payload: { email, password }
        });

        if (result.success) {
            const newState = await sendMessage({ action: 'getState' });

            if (newState.hasSubscription) {
                showMainView(newState);
            } else {
                showNoSubView(newState);
            }
        } else {
            showError(errorEl, result.error || 'Erro ao fazer login. Verifique suas credenciais.');
        }

        btn.disabled = false;
        btn.textContent = 'Entrar';
    });

    // Enter no campo de senha faz login
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-login').click();
    });

    // Enter no campo de email pula para senha
    document.getElementById('login-email').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('login-password').focus();
    });

    // === LOGOUT (tela principal) ===

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await sendMessage({ action: 'logout' });
        showLoginView();
    });

    // === LOGOUT (tela sem assinatura) ===

    document.getElementById('btn-logout-nosub').addEventListener('click', async () => {
        await sendMessage({ action: 'logout' });
        showLoginView();
    });

    // === ASSINAR (tela sem assinatura) ===

    document.getElementById('btn-subscribe').addEventListener('click', async () => {
        const store = await chrome.storage.local.get(['api_url']);
        const apiUrl = store.api_url || 'http://localhost/api';
        const baseUrl = apiUrl.replace('/api', '');
        chrome.tabs.create({ url: baseUrl + '/web/pricing.html' });
    });

    // === VERIFICAR NOVAMENTE (tela sem assinatura) ===

    document.getElementById('btn-retry-sub').addEventListener('click', async () => {
        const btn = document.getElementById('btn-retry-sub');
        btn.disabled = true;
        btn.textContent = 'Verificando...';

        const authResult = await sendMessage({ action: 'checkAuth' });

        if (authResult.authenticated && authResult.hasSubscription) {
            const newState = await sendMessage({ action: 'getState' });
            showMainView(newState);
        } else if (authResult.authenticated) {
            btn.textContent = 'Assinatura nao encontrada';
            setTimeout(() => {
                btn.textContent = 'Verificar Novamente';
                btn.disabled = false;
            }, 2000);
        } else {
            showLoginView();
        }
    });

    // === SALVAR CONFIGURACOES ===

    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        const btn = document.getElementById('btn-save-settings');
        const msgEl = document.getElementById('save-msg');

        const settings = {
            bet_amount:           parseFloat(document.getElementById('cfg-bet-amount').value) || 2,
            strategy:             document.getElementById('cfg-strategy').value,
            martingale_enabled:   document.getElementById('cfg-martingale').checked ? 1 : 0,
            martingale_max:       parseInt(document.getElementById('cfg-mg-max').value) || 3,
            martingale_multiplier: parseFloat(document.getElementById('cfg-mg-mult').value) || 2.0,
            stop_loss:            parseFloat(document.getElementById('cfg-stop-loss').value) || 50,
            stop_gain:            parseFloat(document.getElementById('cfg-stop-gain').value) || 50,
            max_bets_per_day:     parseInt(document.getElementById('cfg-max-bets').value) || 100,
            auto_bet:             document.getElementById('toggle-bot').checked ? 1 : 0
        };

        btn.disabled = true;
        btn.textContent = 'Salvando...';

        const result = await sendMessage({ action: 'saveSettings', payload: settings });

        if (result.success) {
            msgEl.textContent = result.warning ? 'Salvo localmente!' : 'Salvo!';
            msgEl.className = 'save-msg save-success';
            msgEl.style.display = 'inline';
            setTimeout(() => { msgEl.style.display = 'none'; }, 2500);

            // Notifica o content script para atualizar as settings em tempo real
            notifyContentScript({ action: 'updateSettings', settings: settings });
        } else {
            msgEl.textContent = 'Erro ao salvar';
            msgEl.className = 'save-msg save-error';
            msgEl.style.display = 'inline';
            setTimeout(() => { msgEl.style.display = 'none'; }, 2500);
        }

        btn.disabled = false;
        btn.textContent = 'Salvar Configuracoes';
    });

    // === BOT TOGGLE ===

    document.getElementById('toggle-bot').addEventListener('change', async (e) => {
        const isActive = e.target.checked;

        // Salva no storage
        await chrome.storage.local.set({ bot_active: isActive });

        // Notifica o content script
        notifyContentScript({ action: 'toggleBot', active: isActive });
    });

    // === MARTINGALE TOGGLE ===

    document.getElementById('cfg-martingale').addEventListener('change', (e) => {
        const mgOptions = document.getElementById('martingale-options');
        mgOptions.style.display = e.target.checked ? 'block' : 'none';
    });

    // === LINKS ===

    document.getElementById('link-history').addEventListener('click', async (e) => {
        e.preventDefault();
        const store = await chrome.storage.local.get(['api_url']);
        const apiUrl = store.api_url || 'http://localhost/api';
        const baseUrl = apiUrl.replace('/api', '');
        chrome.tabs.create({ url: baseUrl + '/web/history.html' });
    });

    document.getElementById('link-dashboard').addEventListener('click', async (e) => {
        e.preventDefault();
        const store = await chrome.storage.local.get(['api_url']);
        const apiUrl = store.api_url || 'http://localhost/api';
        const baseUrl = apiUrl.replace('/api', '');
        chrome.tabs.create({ url: baseUrl + '/web/dashboard.html' });
    });

    // ===================== HELPERS =====================

    /**
     * Mostra a tela de login.
     */
    function showLoginView() {
        viewLogin.style.display = 'block';
        viewNoSub.style.display = 'none';
        viewMain.style.display  = 'none';
    }

    /**
     * Mostra a tela "sem assinatura".
     */
    function showNoSubView(data) {
        viewLogin.style.display = 'none';
        viewNoSub.style.display = 'block';
        viewMain.style.display  = 'none';
    }

    /**
     * Mostra a tela principal com configuracoes e estatisticas.
     */
    function showMainView(data) {
        viewLogin.style.display = 'none';
        viewNoSub.style.display = 'none';
        viewMain.style.display  = 'block';

        // Info do usuario
        const userName = data.user
            ? (data.user.name || data.user.email || 'Usuario')
            : 'Usuario';
        document.getElementById('user-name').textContent = userName;

        // Status da assinatura
        const subEl = document.getElementById('sub-status');
        if (data.hasSubscription) {
            subEl.textContent = 'Ativo';
            subEl.className = 'badge badge-green';
        } else {
            subEl.textContent = 'Inativo';
            subEl.className = 'badge badge-red';
        }

        // Carrega configuracoes no formulario
        const s = data.settings || {};
        document.getElementById('cfg-bet-amount').value = s.bet_amount || 2;
        document.getElementById('cfg-strategy').value = s.strategy || 'frequency';
        document.getElementById('cfg-martingale').checked = (s.martingale_enabled == 1 || s.martingale_enabled === true);
        document.getElementById('cfg-mg-max').value = s.martingale_max || 3;
        document.getElementById('cfg-mg-mult').value = s.martingale_multiplier || 2.0;
        document.getElementById('cfg-stop-loss').value = s.stop_loss || 50;
        document.getElementById('cfg-stop-gain').value = s.stop_gain || 50;
        document.getElementById('cfg-max-bets').value = s.max_bets_per_day || 100;
        document.getElementById('toggle-bot').checked = (s.auto_bet == 1 || s.auto_bet === true);

        // Mostra/esconde opcoes de martingale
        const mgOptions = document.getElementById('martingale-options');
        mgOptions.style.display = (s.martingale_enabled == 1 || s.martingale_enabled === true) ? 'block' : 'none';

        // Carrega estatisticas ao vivo do content script
        loadLiveStats();
    }

    /**
     * Busca estatisticas em tempo real do content script (se a tab ativa for a Blaze).
     */
    async function loadLiveStats() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.includes('blaze.bet') || tab.url.includes('blaze-4.com'))) {
                chrome.tabs.sendMessage(tab.id, { action: 'getBotState' }, (response) => {
                    if (chrome.runtime.lastError) return; // Tab nao tem content script
                    if (response && response.success) {
                        updateStats(response);
                    }
                });
            }
        } catch (err) {
            // Tab pode nao estar na Blaze - silencioso
        }
    }

    /**
     * Atualiza os cards de estatisticas com dados do content script.
     */
    function updateStats(data) {
        const profit = data.sessionProfit || data.profit || 0;
        const bets   = data.sessionBets || data.bets || 0;
        const wins   = data.sessionWins || data.wins || 0;
        const losses = data.sessionLosses || data.losses || 0;

        const profitEl = document.getElementById('stat-profit');
        profitEl.textContent = 'R$ ' + profit.toFixed(2);
        profitEl.style.color = profit >= 0 ? '#2ecc71' : '#e74c3c';

        document.getElementById('stat-bets').textContent = bets;
        document.getElementById('stat-wins').textContent = wins;
        document.getElementById('stat-losses').textContent = losses;

        // Atualiza o toggle se necessario
        if (data.botActive !== undefined) {
            document.getElementById('toggle-bot').checked = data.botActive;
        }
    }

    /**
     * Envia mensagem para o content script na tab ativa.
     */
    async function notifyContentScript(msg) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && (tab.url.includes('blaze.bet') || tab.url.includes('blaze-4.com'))) {
                chrome.tabs.sendMessage(tab.id, msg, () => {
                    if (chrome.runtime.lastError) {
                        // Tab pode nao ter content script carregado
                    }
                });
            }
        } catch (err) {
            // Silencioso
        }
    }

    /**
     * Mostra mensagem de erro.
     */
    function showError(el, message) {
        el.textContent = message;
        el.style.display = 'block';
    }

    /**
     * Envia mensagem para o background script.
     */
    function sendMessage(msg) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(msg, (response) => {
                if (chrome.runtime.lastError) {
                    console.warn('[BotBlaze Popup] Erro:', chrome.runtime.lastError.message);
                    resolve({});
                    return;
                }
                resolve(response || {});
            });
        });
    }

    // === REFRESH PERIODICO ===
    // Atualiza stats a cada 5 segundos enquanto o popup esta aberto
    setInterval(loadLiveStats, 5000);
});
