// BotBlaze - Extension Popup Script

document.addEventListener('DOMContentLoaded', async () => {
    const viewLogin = document.getElementById('view-login');
    const viewMain = document.getElementById('view-main');

    // Verifica estado atual
    const stateData = await sendMessage({ action: 'getState' });

    if (stateData.authenticated) {
        showMainView(stateData);
    } else {
        showLoginView();
    }

    // === LOGIN ===
    document.getElementById('btn-login').addEventListener('click', async () => {
        const email = document.getElementById('login-email').value.trim();
        const password = document.getElementById('login-password').value;
        const errorEl = document.getElementById('login-error');
        const btn = document.getElementById('btn-login');

        if (!email || !password) {
            errorEl.textContent = 'Preencha email e senha';
            errorEl.style.display = 'block';
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
            showMainView(newState);
        } else {
            errorEl.textContent = result.error || 'Erro ao fazer login';
            errorEl.style.display = 'block';
        }

        btn.disabled = false;
        btn.textContent = 'Entrar';
    });

    // Enter para login
    document.getElementById('login-password').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') document.getElementById('btn-login').click();
    });

    // === LOGOUT ===
    document.getElementById('btn-logout').addEventListener('click', async () => {
        await sendMessage({ action: 'logout' });
        showLoginView();
    });

    // === SAVE SETTINGS ===
    document.getElementById('btn-save-settings').addEventListener('click', async () => {
        const settings = {
            bet_amount: parseFloat(document.getElementById('cfg-bet-amount').value) || 2,
            strategy: document.getElementById('cfg-strategy').value,
            martingale_enabled: document.getElementById('cfg-martingale').checked ? 1 : 0,
            stop_loss: parseFloat(document.getElementById('cfg-stop-loss').value) || 50,
            stop_gain: parseFloat(document.getElementById('cfg-stop-gain').value) || 100,
            auto_bet: document.getElementById('toggle-bot').checked ? 1 : 0
        };

        const result = await sendMessage({ action: 'saveSettings', payload: settings });
        const msg = document.getElementById('save-msg');

        if (result.success) {
            msg.textContent = result.warning ? 'Salvo localmente' : 'Salvo!';
            msg.style.display = 'inline';
            setTimeout(() => msg.style.display = 'none', 2000);
        }
    });

    // === BOT TOGGLE ===
    document.getElementById('toggle-bot').addEventListener('change', async (e) => {
        // Comunica com content script via storage
        await chrome.storage.local.set({ bot_active: e.target.checked });

        // Tambem notifica a tab ativa
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'toggleBot',
                    active: e.target.checked
                });
            }
        } catch (err) {
            // Tab pode nao estar na Blaze
        }
    });

    // === DASHBOARD LINK ===
    document.getElementById('link-dashboard').addEventListener('click', async (e) => {
        e.preventDefault();
        const store = await chrome.storage.local.get(['api_url']);
        const apiUrl = store.api_url || 'http://localhost/api';
        const baseUrl = apiUrl.replace('/api', '');
        chrome.tabs.create({ url: baseUrl + '/web/dashboard.html' });
    });

    // === HELPERS ===

    function showLoginView() {
        viewLogin.style.display = 'block';
        viewMain.style.display = 'none';
    }

    function showMainView(data) {
        viewLogin.style.display = 'none';
        viewMain.style.display = 'block';

        // User info
        const userName = data.user ? (data.user.name || data.user.email || 'Usuario') : 'Usuario';
        document.getElementById('user-name').textContent = userName;

        // Subscription status
        const subEl = document.getElementById('sub-status');
        if (data.hasSubscription) {
            subEl.textContent = 'Ativo';
            subEl.className = 'badge badge-green';
        } else {
            subEl.textContent = 'Sem plano';
            subEl.className = 'badge badge-red';
        }

        // Load settings into form
        const s = data.settings || {};
        document.getElementById('cfg-bet-amount').value = s.bet_amount || 2;
        document.getElementById('cfg-strategy').value = s.strategy || 'color_frequency';
        document.getElementById('cfg-martingale').checked = s.martingale_enabled == 1;
        document.getElementById('cfg-stop-loss').value = s.stop_loss || 50;
        document.getElementById('cfg-stop-gain').value = s.stop_gain || 100;
        document.getElementById('toggle-bot').checked = s.auto_bet == 1;

        // Try to get live stats from content script
        loadLiveStats();
    }

    async function loadLiveStats() {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab && tab.url && tab.url.includes('blaze')) {
                chrome.tabs.sendMessage(tab.id, { action: 'getStats' }, (response) => {
                    if (response && response.success) {
                        document.getElementById('stat-profit').textContent = 'R$ ' + (response.profit || 0).toFixed(2);
                        document.getElementById('stat-bets').textContent = response.bets || 0;
                        document.getElementById('stat-wins').textContent = response.wins || 0;
                        document.getElementById('stat-losses').textContent = response.losses || 0;

                        const profitEl = document.getElementById('stat-profit');
                        profitEl.style.color = (response.profit || 0) >= 0 ? '#2ecc71' : '#e74c3c';
                    }
                });
            }
        } catch (err) {
            // Silently ignore - tab may not be on Blaze
        }
    }

    function sendMessage(msg) {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage(msg, (response) => {
                resolve(response || {});
            });
        });
    }
});
