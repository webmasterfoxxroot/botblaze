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
    const data = await apiCall('/auth.php', 'POST', { action: 'login', email, password, device_type: 'extension' });

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
            // Token desta sessao expirou ou foi invalidado
            if (data.status === 401) {
                await storageRemove(['api_token', 'is_authenticated', 'user', 'subscription', 'bot_settings']);
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

    // Invalida apenas ESTA sessao na API (nao afeta sessoes web/admin)
    if (store.api_token) {
        try {
            await apiCall('/auth.php', 'POST', { action: 'logout' }, store.api_token);
        } catch (e) {
            // Silencioso - logout local prossegue mesmo se API falhar
        }
    }

    await storageRemove([
        'api_token',
        'is_authenticated',
        'user',
        'subscription',
        'bot_settings',
        'session_stats'
    ]);

    return { success: true };
}

/**
 * Retorna estado geral da extensao (para popup e content script).
 * Sempre verifica assinatura no servidor para garantir dados atualizados.
 */
async function handleGetState() {
    const store = await storageGet([
        'api_token', 'user', 'subscription', 'api_url', 'bot_settings'
    ]);

    // Se tem token, verifica assinatura no servidor
    let hasSubscription = false;
    let user = store.user || null;
    let subscription = store.subscription || null;

    if (store.api_token) {
        try {
            const authResult = await handleCheckAuth();
            if (authResult.authenticated) {
                hasSubscription = !!authResult.hasSubscription;
                user = authResult.user || user;
                subscription = authResult.subscription || subscription;
            }
        } catch (e) {
            // Fallback para dados em cache se o servidor nao responder
            hasSubscription = !!(
                store.subscription &&
                (store.subscription.status === 'active' || store.subscription.active === true)
            );
        }
    }

    return {
        success: true,
        authenticated: !!store.api_token,
        user: user,
        subscription: subscription,
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
        strategy: 'moderado',
        min_confidence: 60,
        bet_white: 1,
        martingale_enabled: false,
        martingale_max: 3,
        martingale_multiplier: 2.0,
        stop_loss: 50.00,
        stop_gain: 100.00,
        max_bets_per_day: 50,
        auto_bet: false
    };
}

// --------------- handlers de estatisticas da sessao ---------------

/**
 * Salva estatisticas da sessao no chrome.storage.local.
 * Persiste entre recarregamentos de pagina.
 */
async function handleSaveSessionStats(stats) {
    await storageSet({
        session_stats: {
            sessionProfit: stats.sessionProfit || 0,
            sessionBets: stats.sessionBets || 0,
            sessionWins: stats.sessionWins || 0,
            sessionLosses: stats.sessionLosses || 0,
            todayBets: stats.todayBets || 0,
            martingaleLevel: stats.martingaleLevel || 0,
            currentBetColor: stats.currentBetColor !== undefined ? stats.currentBetColor : null,
            currentBetAmount: stats.currentBetAmount || 0,
            waitingResult: stats.waitingResult || false,
            savedAt: Date.now()
        }
    });
    return { success: true };
}

/**
 * Recupera estatisticas da sessao salvas.
 * Retorna null se nao houver dados ou se forem de um dia anterior.
 */
async function handleGetSessionStats() {
    const store = await storageGet(['session_stats']);
    if (!store.session_stats) {
        return { success: true, stats: null };
    }

    // Verifica se os dados sao do mesmo dia (reseta diariamente)
    const saved = new Date(store.session_stats.savedAt);
    const now = new Date();
    if (saved.getDate() !== now.getDate() ||
        saved.getMonth() !== now.getMonth() ||
        saved.getFullYear() !== now.getFullYear()) {
        // Dados de outro dia - limpa
        await storageRemove(['session_stats']);
        return { success: true, stats: null };
    }

    return { success: true, stats: store.session_stats };
}

// --------------- listener de mensagens ---------------

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    // Mapa de handlers
    const handlers = {
        login:            () => handleLogin(payload || message),
        checkAuth:        () => handleCheckAuth(),
        getSettings:      () => handleGetSettings(),
        saveSettings:     () => handleSaveSettings(payload || message.settings),
        recordBet:        () => handleRecordBet(payload || message.bet),
        logout:           () => handleLogout(),
        getState:         () => handleGetState(),
        saveSessionStats: () => handleSaveSessionStats(payload || {}),
        getSessionStats:  () => handleGetSessionStats(),
        setApiUrl:        async () => {
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

        // Tenta auto-configurar a partir do config.json embutido no pacote
        try {
            const res = await fetch(chrome.runtime.getURL('config.json'));
            if (res.ok) {
                const config = await res.json();
                if (config.api_token && config.user) {
                    await storageSet({
                        api_url: config.api_url || DEFAULT_API,
                        api_token: config.api_token,
                        user: config.user,
                        subscription: config.subscription || null,
                        is_authenticated: true
                    });
                    console.log('[BotBlaze] Auto-configurado com sucesso! Usuario: ' + config.user.name);
                    return;
                }
            }
        } catch (e) {
            // config.json nao encontrado - instalacao manual, usa defaults
            console.log('[BotBlaze] Sem config.json embutido. Configuracao manual necessaria.');
        }

        // Fallback: apenas define a URL da API (settings vem do banco de dados)
        const existing = await storageGet(['api_url']);
        if (!existing.api_url) {
            await storageSet({ api_url: DEFAULT_API });
        }
    }

    if (details.reason === 'update') {
        console.log('[BotBlaze] Extensao atualizada para v' + chrome.runtime.getManifest().version);
    }
});

console.log('[BotBlaze] Background service worker carregado.');
