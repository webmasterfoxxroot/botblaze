<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$pageTitle = 'BotBlaze - Configuracoes do Bot';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-dashboard">
    <h1 class="page-title">Configuracoes do Bot <span class="badge badge-gray" id="save-status">Carregando...</span></h1>
    <p class="text-muted" style="margin-bottom:24px;">Ajuste as configuracoes em tempo real. O bot aplica as mudancas automaticamente sem precisar reiniciar.</p>

    <div id="settings-container">
        <!-- Bot Status -->
        <div class="panel" style="margin-bottom:16px;">
            <div class="panel-header">
                <h2>Status do Bot</h2>
                <div class="toggle-group" id="bot-status-group">
                    <button class="toggle-btn active" data-value="running" id="btn-running">Rodando</button>
                    <button class="toggle-btn" data-value="paused" id="btn-paused">Pausado</button>
                </div>
            </div>
            <div class="panel-body">
                <p class="text-muted" style="font-size:13px;">Quando pausado, o bot continua coletando jogos mas nao gera sinais.</p>
            </div>
        </div>

        <div class="settings-grid">
            <!-- Sincronia e Velocidade -->
            <div class="panel">
                <div class="panel-header"><h2>Sincronia e Velocidade</h2></div>
                <div class="panel-body">
                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Intervalo de Coleta (ms)</span>
                            <span class="setting-value" id="val-collect_interval">3000</span>
                        </div>
                        <input type="range" class="setting-range" id="collect_interval" min="1000" max="15000" step="500" value="3000">
                        <div class="setting-range-labels"><span>1s (rapido)</span><span>15s (lento)</span></div>
                        <p class="setting-hint">Quanto menor, mais rapido detecta jogos novos. Valores baixos consomem mais recursos.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Correcao de Tempo (segundos)</span>
                            <span class="setting-value" id="val-time_offset">0</span>
                        </div>
                        <input type="range" class="setting-range" id="time_offset" min="-60" max="60" step="1" value="0">
                        <div class="setting-range-labels"><span>-60s (atrasar)</span><span>+60s (adiantar)</span></div>
                        <p class="setting-hint">Ajuste fino da sincronia. Se os sinais chegam atrasados, aumente. Se adiantados, diminua.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Janela de Analise (rodadas)</span>
                            <span class="setting-value" id="val-analysis_window">50</span>
                        </div>
                        <input type="range" class="setting-range" id="analysis_window" min="10" max="200" step="10" value="50">
                        <div class="setting-range-labels"><span>10 (rapido)</span><span>200 (profundo)</span></div>
                        <p class="setting-hint">Quantas rodadas recentes as estrategias analisam. Mais rodadas = analise mais lenta mas possivelmente mais precisa.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Limite de Historico (rows)</span>
                            <span class="setting-value" id="val-history_limit">2000</span>
                        </div>
                        <input type="range" class="setting-range" id="history_limit" min="500" max="10000" step="500" value="2000">
                        <div class="setting-range-labels"><span>500</span><span>10000</span></div>
                        <p class="setting-hint">Historico para ML e estatisticas. Mais dados = mais preciso, mas mais lento.</p>
                    </div>
                </div>
            </div>

            <!-- Sinais -->
            <div class="panel">
                <div class="panel-header"><h2>Sinais</h2></div>
                <div class="panel-body">
                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Gerar Sinais</span>
                            <label class="switch">
                                <input type="checkbox" id="signals_active" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <p class="setting-hint">Liga/desliga geracao de sinais. Se desligado, o bot apenas coleta dados.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Confianca Minima (%)</span>
                            <span class="setting-value" id="val-confidence_min">55</span>
                        </div>
                        <input type="range" class="setting-range" id="confidence_min" min="30" max="95" step="5" value="55">
                        <div class="setting-range-labels"><span>30% (mais sinais)</span><span>95% (menos sinais)</span></div>
                        <p class="setting-hint">Confianca minima para gerar um sinal. Menor = mais sinais mas menos precisos. Maior = menos sinais mas mais precisos.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Max Sinais por Rodada</span>
                            <span class="setting-value" id="val-max_signals_per_round">4</span>
                        </div>
                        <input type="range" class="setting-range" id="max_signals_per_round" min="1" max="10" step="1" value="4">
                        <div class="setting-range-labels"><span>1</span><span>10</span></div>
                        <p class="setting-hint">Maximo de sinais diferentes gerados por rodada (de estrategias diferentes).</p>
                    </div>
                </div>
            </div>

            <!-- Estrategias -->
            <div class="panel">
                <div class="panel-header"><h2>Estrategias Ativas</h2></div>
                <div class="panel-body">
                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Sequencias</span>
                            <label class="switch">
                                <input type="checkbox" id="strategy_sequences" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <p class="setting-hint">Detecta padroes de sequencias de cores e preve a proxima.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Frequencia</span>
                            <label class="switch">
                                <input type="checkbox" id="strategy_frequency" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <p class="setting-hint">Analisa frequencia de cores e detecta desvios estatisticos.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>Martingale</span>
                            <label class="switch">
                                <input type="checkbox" id="strategy_martingale" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <p class="setting-hint">Baseada na estrategia Martingale - aposta na inversao apos sequencia longa.</p>
                    </div>

                    <div class="setting-item">
                        <div class="setting-label">
                            <span>ML Patterns</span>
                            <label class="switch">
                                <input type="checkbox" id="strategy_ml_patterns" checked>
                                <span class="slider"></span>
                            </label>
                        </div>
                        <p class="setting-hint">Machine Learning - detecta padroes complexos no historico de jogos.</p>
                    </div>
                </div>
            </div>

            <!-- Status em Tempo Real -->
            <div class="panel">
                <div class="panel-header"><h2>Status em Tempo Real</h2></div>
                <div class="panel-body">
                    <div class="status-grid">
                        <div class="status-item">
                            <span class="status-label">WebSocket</span>
                            <span class="status-val" id="ws-status">Desconectado</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Ultimo Jogo</span>
                            <span class="status-val" id="last-game-time">--</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Ultimo Sinal</span>
                            <span class="status-val" id="last-signal-time">--</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Jogos Coletados</span>
                            <span class="status-val" id="total-games">--</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Sinais Hoje</span>
                            <span class="status-val" id="signals-today">--</span>
                        </div>
                        <div class="status-item">
                            <span class="status-label">Win Rate</span>
                            <span class="status-val" id="win-rate">--</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.settings-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.setting-item {
    padding: 16px 0;
    border-bottom: 1px solid var(--border);
}
.setting-item:last-child { border-bottom: none; }
.setting-label {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
    font-weight: 600;
    font-size: 14px;
}
.setting-value {
    background: var(--accent);
    color: #000;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 13px;
    font-weight: 700;
    min-width: 50px;
    text-align: center;
}
.setting-range {
    width: 100%;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
}
.setting-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.setting-range::-moz-range-thumb {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: 2px solid #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3);
}
.setting-range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: var(--text-muted);
    margin-top: 4px;
}
.setting-hint {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 8px;
    line-height: 1.4;
}

/* Toggle buttons */
.toggle-group {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
}
.toggle-btn {
    padding: 6px 16px;
    font-size: 13px;
    font-weight: 600;
    background: transparent;
    color: var(--text-secondary);
    border: none;
    cursor: pointer;
    transition: all 0.2s;
}
.toggle-btn.active {
    background: var(--green);
    color: #fff;
}
.toggle-btn[data-value="paused"].active {
    background: var(--red);
}

/* Switch toggle */
.switch {
    position: relative;
    display: inline-block;
    width: 48px;
    height: 26px;
}
.switch input { opacity: 0; width: 0; height: 0; }
.slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background: #444;
    border-radius: 26px;
    transition: 0.3s;
}
.slider::before {
    content: '';
    position: absolute;
    height: 20px;
    width: 20px;
    left: 3px;
    bottom: 3px;
    background: #fff;
    border-radius: 50%;
    transition: 0.3s;
}
.switch input:checked + .slider { background: var(--green); }
.switch input:checked + .slider::before { transform: translateX(22px); }

/* Status grid */
.status-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
}
.status-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    background: rgba(255,255,255,0.03);
    border-radius: 8px;
    border: 1px solid var(--border);
}
.status-label {
    font-size: 11px;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.5px;
}
.status-val {
    font-size: 15px;
    font-weight: 700;
    color: var(--text-primary);
}

/* Save indicator */
.saving-indicator {
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: var(--green);
    color: #fff;
    padding: 10px 20px;
    border-radius: 8px;
    font-weight: 600;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    z-index: 1000;
    animation: slideUp 0.3s ease;
}
@keyframes slideUp {
    from { transform: translateY(20px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}

@media (max-width: 768px) {
    .settings-grid { grid-template-columns: 1fr; }
    .status-grid { grid-template-columns: 1fr; }
}
</style>

<script>
let saveTimeout = null;
let settings = {};

// Carrega configuracoes
async function loadSettings() {
    try {
        const r = await fetch('/api/bot-settings.php');
        const data = await r.json();
        if (data.settings) {
            settings = data.settings;
            applyToUI(settings);
            document.getElementById('save-status').textContent = 'Sincronizado';
            document.getElementById('save-status').className = 'badge badge-green';
        }
    } catch (e) {
        document.getElementById('save-status').textContent = 'Erro ao carregar';
        document.getElementById('save-status').className = 'badge badge-red';
    }
}

function applyToUI(s) {
    // Ranges
    ['collect_interval', 'confidence_min', 'max_signals_per_round', 'analysis_window', 'history_limit', 'time_offset'].forEach(key => {
        const el = document.getElementById(key);
        const val = document.getElementById('val-' + key);
        if (el && s[key] !== undefined) {
            el.value = s[key];
            if (val) {
                if (key === 'collect_interval') val.textContent = (parseInt(s[key]) / 1000).toFixed(1) + 's';
                else if (key === 'time_offset') val.textContent = (parseInt(s[key]) >= 0 ? '+' : '') + s[key] + 's';
                else val.textContent = s[key];
            }
        }
    });

    // Checkboxes
    ['signals_active', 'strategy_sequences', 'strategy_frequency', 'strategy_martingale', 'strategy_ml_patterns'].forEach(key => {
        const el = document.getElementById(key);
        if (el && s[key] !== undefined) el.checked = s[key] === '1';
    });

    // Bot status
    if (s.bot_status) {
        document.querySelectorAll('#bot-status-group .toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.value === s.bot_status);
        });
    }
}

// Salva mudancas (debounced)
function saveSettings(changedSettings) {
    Object.assign(settings, changedSettings);

    document.getElementById('save-status').textContent = 'Salvando...';
    document.getElementById('save-status').className = 'badge badge-yellow';

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
        try {
            const r = await fetch('/api/bot-settings.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(changedSettings)
            });
            const data = await r.json();
            if (data.ok) {
                document.getElementById('save-status').textContent = 'Salvo!';
                document.getElementById('save-status').className = 'badge badge-green';
                showSaveToast();
            }
        } catch (e) {
            document.getElementById('save-status').textContent = 'Erro ao salvar';
            document.getElementById('save-status').className = 'badge badge-red';
        }
    }, 400);
}

function showSaveToast() {
    const existing = document.querySelector('.saving-indicator');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'saving-indicator';
    toast.textContent = 'Configuracao salva! Bot atualiza automaticamente.';
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
}

// Event listeners para ranges
['collect_interval', 'confidence_min', 'max_signals_per_round', 'analysis_window', 'history_limit', 'time_offset'].forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    el.addEventListener('input', () => {
        const val = el.value;
        const display = document.getElementById('val-' + key);
        if (display) {
            if (key === 'collect_interval') display.textContent = (parseInt(val) / 1000).toFixed(1) + 's';
            else if (key === 'time_offset') display.textContent = (parseInt(val) >= 0 ? '+' : '') + val + 's';
            else display.textContent = val;
        }
    });
    el.addEventListener('change', () => {
        saveSettings({ [key]: el.value });
    });
});

// Event listeners para checkboxes
['signals_active', 'strategy_sequences', 'strategy_frequency', 'strategy_martingale', 'strategy_ml_patterns'].forEach(key => {
    const el = document.getElementById(key);
    if (!el) return;
    el.addEventListener('change', () => {
        saveSettings({ [key]: el.checked ? '1' : '0' });
    });
});

// Event listeners para bot status
document.querySelectorAll('#bot-status-group .toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#bot-status-group .toggle-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        saveSettings({ bot_status: btn.dataset.value });
    });
});

// Status em tempo real via WebSocket
function connectWS() {
    try {
        const wsPort = <?= json_encode(getenv('BOT_PORT') ?: '3001') ?>;
        const ws = new WebSocket('ws://' + window.location.hostname + ':' + wsPort);

        ws.onopen = () => {
            document.getElementById('ws-status').textContent = 'Conectado';
            document.getElementById('ws-status').style.color = 'var(--green)';
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'new_game' && msg.data.game) {
                    const g = msg.data.game;
                    document.getElementById('last-game-time').textContent =
                        new Date().toLocaleTimeString('pt-BR') + ' (Roll ' + g.roll + ')';
                }

                if (msg.type === 'signal') {
                    document.getElementById('last-signal-time').textContent =
                        new Date().toLocaleTimeString('pt-BR');
                }

                if (msg.type === 'analysis' && msg.data.stats) {
                    const s = msg.data.stats;
                    document.getElementById('total-games').textContent = s.total || '--';
                    document.getElementById('win-rate').textContent = (s.winRate || '0') + '%';
                }

                if (msg.type === 'bot_settings_updated') {
                    loadSettings(); // Recarrega configs se outro admin alterou
                }
            } catch (e) {}
        };

        ws.onclose = () => {
            document.getElementById('ws-status').textContent = 'Desconectado';
            document.getElementById('ws-status').style.color = 'var(--red)';
            setTimeout(connectWS, 5000);
        };

        ws.onerror = () => ws.close();
    } catch (e) {
        setTimeout(connectWS, 10000);
    }
}

// Carrega stats iniciais
async function loadStats() {
    try {
        const r = await fetch('/api/admin-stats.php');
        const data = await r.json();
        if (data.stats) {
            document.getElementById('total-games').textContent = data.stats.totalGames || '--';
            document.getElementById('win-rate').textContent = (data.stats.winRate || '0') + '%';
        }
    } catch (e) {}

    try {
        const r = await fetch('/api/game-state.php');
        const data = await r.json();
        if (data.lastGame) {
            document.getElementById('last-game-time').textContent =
                new Date(data.lastGame.played_at).toLocaleTimeString('pt-BR') + ' (Roll ' + data.lastGame.roll + ')';
        }
    } catch (e) {}
}

// Init
loadSettings();
loadStats();
connectWS();
setInterval(loadStats, 10000);
</script>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
