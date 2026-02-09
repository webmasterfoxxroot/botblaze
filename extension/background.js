// ============================================================
// BotBlaze - Background Service Worker (Manifest V3)
// ============================================================
// Gerencia autenticacao, configuracoes e comunicacao com a API.
// Persiste dados via chrome.storage.local.
// ============================================================

const DEFAULT_API = 'http://localhost/api';

// --------------- helpers de storage ---------------

function storageGet(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.get(keys, (data) => resolve(data));
    });
}

function storageSet(obj) {
    return new Promise((resolve) => {
        chrome.storage.local.set(obj, () => resolve());
    });
}

function storageRemove(keys) {
    return new Promise((resolve) => {
        chrome.storage.local.remove(keys, () => resolve());
    });
}

// --------------- chamada generica a API ---------------

async function apiCall(endpoint, method, body, token) {
    const store = await storageGet(['api_url']);
    const baseUrl = store.api_url || DEFAULT_API;
    const url = baseUrl + endpoint;

    const opts = {
        method: method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    };

    if (token) {
        opts.headers['Authorization'] = 'Bearer ' + token;
    }

    if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
        opts.body = JSON.stringify(body);
    }

    try {
        const res = await fetch(url, opts);
        const data = await res.json();

        if (!res.ok) {
            return {
                success: false,
                status: res.status,
                error: data.message || data.error || 'Erro na requisicao'
            };
        }

        return { success: true, status: res.status, ...data };
    } catch (err) {
        console.error('[BotBlaze BG] apiCall error:', err);
        return { success: false, error: err.message || 'Erro de conexao com a API' };
    }
}

// --------------- handlers ---------------

/**
 * Login: envia credenciais para a API, armazena token e dados do usuario.
 */
async function handleLogin({ email, password }) {
    const data = await apiCall('/auth.php', 'POST', { action: 'login', email, password });

    if (!data.success) {
        return { success: false, error: data.error || 'Credenciais invalidas' };
    }

    const token = data.api_token || data.token || data.access_token;
    const user = data.user || {};
    const subscription = data.subscription || null;

    await storageSet({
        api_token: token,
        user: user,
        subscription: subscription,
        is_authenticated: true
    });

    return {
        success: true,
        user: user,
        subscription: subscription,
        hasSubscription: !!(subscription && (subscription.status === 'active' || subscription.active === true))
    };
}

/**
 * Verifica se o token ainda e valido e se a assinatura esta ativa.
 */
async function handleCheckAuth() {
    const store = await storageGet(['api_token', 'user', 'subscription']);

    if (!store.api_token) {
        return { success: false, authenticated: false, error: 'Token nao encontrado' };
    }

    try {
        const data = await apiCall('/auth.php', 'POST', { action: 'validate' }, store.api_token);

        if (!data.success) {
            // Token expirado ou invalido
            if (data.status === 401) {
                await storageRemove(['api_token', 'is_authenticated', 'user', 'subscription']);
            }
            return { success: false, authenticated: false, error: data.error || 'Sessao expirada' };
        }

        const user = data.user || store.user || {};
        const subscription = data.subscription || store.subscription || null;
        const hasSubscription = !!(
            subscription &&
            (subscription.status === 'active' || subscription.active === true)
        );

        await storageSet({
            user: user,
            subscription: subscription
        });

        return {
            success: true,
            authenticated: true,
            user: user,
            subscription: subscription,
            hasSubscription: hasSubscription
        };
    } catch (err) {
        // Em caso de erro de rede, usa dados em cache
        const hasSubscription = !!(
            store.subscription &&
            (store.subscription.status === 'active' || store.subscription.active === true)
        );
        return {
            success: true,
            authenticated: true,
            user: store.user || {},
            subscription: store.subscription,
            hasSubscription: hasSubscription,
            fromCache: true
        };
    }
}

/**
 * Busca configuracoes do usuario na API.
 * Retorna do cache local se a API falhar.
 */
async function handleGetSettings() {
    const store = await storageGet(['api_token', 'bot_settings']);

    if (!store.api_token) {
        return { success: false, error: 'Nao autenticado' };
    }

    const data = await apiCall('/settings.php', 'GET', null, store.api_token);

    if (data.success) {
        const settings = data.settings || data;
        await storageSet({ bot_settings: settings });
        return { success: true, settings: settings };
    }

    // Fallback: retorna settings do cache local
    if (store.bot_settings) {
        return { success: true, settings: store.bot_settings, fromCache: true };
    }

    // Retorna configuracoes padrao
    return { success: true, settings: getDefaultSettings(), isDefault: true };
}

/**
 * Salva configuracoes do usuario na API e localmente.
 */
async function handleSaveSettings(settings) {
    const store = await storageGet(['api_token']);

    if (!store.api_token) {
        return { success: false, error: 'Nao autenticado' };
    }

    // Salva localmente primeiro para uso imediato pelo content script
    await storageSet({ bot_settings: settings });

    const data = await apiCall('/settings.php', 'POST', settings, store.api_token);

    if (data.success) {
        return { success: true };
    }

    // Mesmo com erro na API, settings ficam salvos localmente
    return {
        success: true,
        warning: 'Salvo localmente. Erro ao sincronizar com o servidor: ' + (data.error || '')
    };
}

/**
 * Registra o resultado de uma aposta na API.
 */
async function handleRecordBet(bet) {
    const store = await storageGet(['api_token']);

    if (!store.api_token) {
        return { success: false, error: 'Nao autenticado' };
    }

    const data = await apiCall('/history.php', 'POST', bet, store.api_token);
    return data;
}

/**
 * Logout: limpa todos os dados armazenados.
 */
async function handleLogout() {
    const store = await storageGet(['api_token']);

    // Tenta invalidar o token na API (nao bloqueia se falhar)
    if (store.api_token) {
        apiCall('/auth.php', 'POST', { action: 'logout' }, store.api_token).catch(() => {});
    }

    await storageRemove([
        'api_token',
        'is_authenticated',
        'user',
        'subscription',
        'bot_settings'
    ]);

    return { success: true };
}

/**
 * Retorna estado geral da extensao (para popup e content script).
 */
async function handleGetState() {
    const store = await storageGet([
        'api_token', 'user', 'subscription', 'api_url', 'bot_settings'
    ]);

    const hasSubscription = !!(
        store.subscription &&
        (store.subscription.status === 'active' || store.subscription.active === true)
    );

    return {
        success: true,
        authenticated: !!store.api_token,
        user: store.user || null,
        subscription: store.subscription || null,
        hasSubscription: hasSubscription,
        api_url: store.api_url || DEFAULT_API,
        settings: store.bot_settings || getDefaultSettings()
    };
}

/**
 * Retorna configuracoes padrao.
 */
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

// --------------- listener de mensagens ---------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    // Mapa de handlers
    const handlers = {
        login:        () => handleLogin(payload || message),
        checkAuth:    () => handleCheckAuth(),
        getSettings:  () => handleGetSettings(),
        saveSettings: () => handleSaveSettings(payload || message.settings),
        recordBet:    () => handleRecordBet(payload || message.bet),
        logout:       () => handleLogout(),
        getState:     () => handleGetState(),
        setApiUrl:    async () => {
            const url = (payload && payload.api_url) || message.api_url;
            await storageSet({ api_url: url });
            return { success: true };
        }
    };

    if (handlers[action]) {
        handlers[action]()
            .then((result) => sendResponse(result))
            .catch((err) => {
                console.error(`[BotBlaze BG] Erro no handler "${action}":`, err);
                sendResponse({ success: false, error: err.message || 'Erro interno' });
            });
        return true; // indica que sendResponse sera chamado de forma assincrona
    }

    console.warn(`[BotBlaze BG] Acao desconhecida: ${action}`);
    sendResponse({ success: false, error: `Acao desconhecida: ${action}` });
    return false;
});

// --------------- install / update ---------------

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === 'install') {
        console.log('[BotBlaze] Extensao instalada com sucesso.');

        // Configura valores padrao
        await storageSet({
            api_url: DEFAULT_API,
            bot_settings: getDefaultSettings()
        });
    }

    if (details.reason === 'update') {
        console.log('[BotBlaze] Extensao atualizada para v' + chrome.runtime.getManifest().version);
    }
});

console.log('[BotBlaze] Background service worker carregado.');
