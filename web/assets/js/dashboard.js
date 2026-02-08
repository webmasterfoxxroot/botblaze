// BotBlaze Dashboard - Real-time signals via WebSocket + polling fallback

const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
const colorEmojis = { 0: '⚪', 1: '🔴', 2: '⬛' };
const colorClasses = { 0: 'white', 1: 'red', 2: 'black' };

let ws = null;
let wsRetries = 0;
const maxRetries = 10;

// Tenta conectar no WebSocket do bot
function connectWebSocket() {
    const host = window.location.hostname;
    const port = typeof WS_PORT !== 'undefined' ? WS_PORT : 3001;

    try {
        ws = new WebSocket(`ws://${host}:${port}`);

        ws.onopen = () => {
            console.log('[BotBlaze] WebSocket conectado');
            wsRetries = 0;
            updateStatus('online');
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleMessage(data);
            } catch (e) {
                console.error('Erro ao processar mensagem:', e);
            }
        };

        ws.onclose = () => {
            updateStatus('offline');
            if (wsRetries < maxRetries) {
                wsRetries++;
                setTimeout(connectWebSocket, 3000 * wsRetries);
            }
        };

        ws.onerror = () => {
            ws.close();
        };
    } catch (e) {
        console.log('[BotBlaze] WebSocket nao disponivel, usando polling');
        startPolling();
    }
}

function handleMessage(data) {
    switch (data.type) {
        case 'signal':
            addSignal(data.data);
            playNotification();
            break;
        case 'analysis':
            updateAnalysis(data.data);
            break;
        case 'connected':
            console.log(data.message);
            break;
    }
}

function addSignal(signal) {
    const container = document.getElementById('signals-container');
    if (!container) return;

    // Remove mensagem "aguardando"
    const muted = container.querySelector('.text-muted');
    if (muted) muted.remove();

    const div = document.createElement('div');
    div.className = 'signal-card pending new-signal';
    div.innerHTML = `
        <div class="signal-color">
            <span class="color-dot ${colorClasses[signal.predicted_color]}"></span>
            ${colorEmojis[signal.predicted_color]}
            ${colorNames[signal.predicted_color]}
        </div>
        <div class="signal-info">
            <span class="confidence">${signal.confidence}%</span>
            <span class="strategy">${signal.strategies ? signal.strategies.join(', ') : signal.strategy_used}</span>
        </div>
        <div class="signal-result">
            <span class="badge badge-yellow">NOVO</span>
        </div>
        <div class="signal-time">
            ${new Date(signal.created_at).toLocaleTimeString('pt-BR')}
        </div>
    `;

    container.insertBefore(div, container.firstChild);

    // Limita a 20 sinais vissiveis
    while (container.children.length > 20) {
        container.removeChild(container.lastChild);
    }

    // Remove animacao apos 3s
    setTimeout(() => div.classList.remove('new-signal'), 3000);
}

function updateAnalysis(data) {
    // Atualiza stats se existirem
    if (data.stats) {
        const statValues = document.querySelectorAll('.stat-value');
        // Atualiza dinamicamente se IDs estiverem presentes
    }
}

function updateStatus(status) {
    const el = document.getElementById('live-status');
    if (!el) return;

    if (status === 'online') {
        el.textContent = 'AO VIVO';
        el.className = 'badge badge-live';
    } else {
        el.textContent = 'OFFLINE';
        el.className = 'badge badge-red';
    }
}

function playNotification() {
    // Som de notificacao
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 800;
        gain.gain.value = 0.1;
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
}

// Polling fallback (atualiza a cada 15s)
let pollTimer = null;

function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
        try {
            const res = await fetch('/api/signals.php?type=double&limit=5');
            if (res.ok) {
                const data = await res.json();
                // Verifica se tem sinais novos
                if (data.signals && data.signals.length > 0) {
                    const latest = data.signals[0];
                    const lastTime = document.querySelector('.signal-time');
                    if (lastTime && lastTime.textContent.trim() !== new Date(latest.created_at).toLocaleTimeString('pt-BR')) {
                        addSignal(latest);
                    }
                }
            }
        } catch (e) {
            console.error('Polling error:', e);
        }
    }, 15000);
}

// Inicializa
document.addEventListener('DOMContentLoaded', () => {
    connectWebSocket();
    // Polling como backup apos 10s
    setTimeout(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            startPolling();
        }
    }, 10000);
});
