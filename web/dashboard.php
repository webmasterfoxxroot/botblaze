<?php
require_once __DIR__ . '/includes/auth.php';
requireLogin();

$user = getCurrentUser();
$subscription = hasActiveSubscription();
$pageTitle = 'BotBlaze - Dashboard';

$db = getDB();

// Stats geral dos sinais
$stats = $db->query("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
    FROM signals WHERE game_type = 'double' AND result != 'pending'
")->fetch();

// Ultimas rodadas
$lastGames = $db->query(
    "SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 50"
)->fetchAll();

// Estrategias
$strategies = ['sequences', 'frequency', 'martingale', 'ml-patterns'];
$strategyNames = [
    'sequences' => 'Sequencias',
    'frequency' => 'Frequencia',
    'martingale' => 'Martingale',
    'ml-patterns' => 'ML Patterns'
];

$strategyData = [];
if ($subscription) {
    foreach ($strategies as $strat) {
        $st = $db->prepare("
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
                SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
            FROM signals WHERE game_type = 'double' AND strategy_used = ? AND result != 'pending'
        ");
        $st->execute([$strat]);
        $st = $st->fetch();

        $signals = $db->prepare("
            SELECT * FROM signals WHERE game_type = 'double' AND strategy_used = ?
            ORDER BY created_at DESC LIMIT 8
        ");
        $signals->execute([$strat]);
        $signals = $signals->fetchAll();

        $d = ($st['wins'] ?? 0) + ($st['losses'] ?? 0);
        $strategyData[$strat] = [
            'name' => $strategyNames[$strat],
            'total' => (int)($st['total'] ?? 0),
            'wins' => (int)($st['wins'] ?? 0),
            'losses' => (int)($st['losses'] ?? 0),
            'winRate' => $d > 0 ? round(($st['wins'] / $d) * 100, 1) : 0,
            'signals' => $signals
        ];
    }
}

// Sinais ativos (pendentes)
$activeSignals = [];
if ($subscription) {
    $activeSignals = $db->query("
        SELECT id, predicted_color, confidence, strategy_used, created_at
        FROM signals
        WHERE game_type = 'double' AND result = 'pending'
        AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
        ORDER BY confidence DESC
        LIMIT 4
    ")->fetchAll();
}

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorClasses = [0 => 'white', 1 => 'red', 2 => 'black'];
$colorEmojis = [0 => '&#9898;', 1 => '&#128308;', 2 => '&#11035;'];

require_once __DIR__ . '/includes/header.php';
?>

<div class="dashboard">
    <!-- Status da Assinatura -->
    <?php if (!$subscription): ?>
    <div class="alert alert-warning">
        <strong>Sem assinatura ativa!</strong> Adquira um plano para ver os sinais em tempo real.
        <a href="/plans.php" class="btn btn-sm btn-primary" style="margin-left:10px;">Ver Planos</a>
    </div>
    <?php endif; ?>

    <?php if ($subscription): ?>
    <!-- SINAL ATIVO - Banner Principal -->
    <div id="active-signal-container">
        <?php if (!empty($activeSignals)): ?>
            <?php $best = $activeSignals[0]; ?>
            <div class="active-signal-banner active-signal-<?= $colorClasses[$best['predicted_color']] ?>">
                <div class="active-signal-pulse"></div>
                <div class="active-signal-content">
                    <div class="active-signal-label">SINAL ATIVO - APOSTE AGORA!</div>
                    <div class="active-signal-color">
                        <span class="active-signal-dot <?= $colorClasses[$best['predicted_color']] ?>"></span>
                        <span class="active-signal-name"><?= $colorNames[$best['predicted_color']] ?></span>
                    </div>
                    <div class="active-signal-details">
                        <span class="active-signal-conf"><?= round($best['confidence']) ?>% confianca</span>
                        <span class="active-signal-strategy"><?= htmlspecialchars($strategyNames[$best['strategy_used']] ?? $best['strategy_used']) ?></span>
                        <span class="active-signal-time"><?= date('H:i:s', strtotime($best['created_at'])) ?></span>
                    </div>
                    <?php if (count($activeSignals) > 1): ?>
                    <div class="active-signal-others">
                        <?php for ($i = 1; $i < count($activeSignals); $i++): $s = $activeSignals[$i]; ?>
                            <span class="active-signal-mini">
                                <span class="color-dot <?= $colorClasses[$s['predicted_color']] ?>"></span>
                                <?= $colorNames[$s['predicted_color']] ?> <?= round($s['confidence']) ?>%
                            </span>
                        <?php endfor; ?>
                    </div>
                    <?php endif; ?>
                </div>
            </div>
        <?php else: ?>
            <div class="active-signal-banner active-signal-waiting">
                <div class="active-signal-content">
                    <div class="active-signal-label">AGUARDANDO SINAL</div>
                    <div class="active-signal-color">
                        <span class="active-signal-name" style="font-size:18px;">Analisando proxima rodada...</span>
                    </div>
                </div>
            </div>
        <?php endif; ?>
    </div>

    <!-- Ultimo Resultado -->
    <div id="last-result-container"></div>
    <?php endif; ?>

    <!-- Cards de Estatisticas -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" id="u-rodadas"><?= count($lastGames) ?></div>
            <div class="stat-label">Rodadas Coletadas</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="u-sinais"><?= $stats['total'] ?? 0 ?></div>
            <div class="stat-label">Sinais Gerados</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value" id="u-wins"><?= $stats['wins'] ?? 0 ?></div>
            <div class="stat-label">Acertos</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value" id="u-losses"><?= $stats['losses'] ?? 0 ?></div>
            <div class="stat-label">Erros</div>
        </div>
        <div class="stat-card stat-gold">
            <div class="stat-value" id="u-winrate">
                <?php
                $decided = ($stats['wins'] ?? 0) + ($stats['losses'] ?? 0);
                echo $decided > 0 ? round(($stats['wins'] / $decided) * 100, 1) . '%' : '0%';
                ?>
            </div>
            <div class="stat-label">Taxa de Acerto</div>
        </div>
    </div>

    <?php if (!$subscription): ?>
    <div class="locked-content">
        <span class="lock-icon">&#128274;</span>
        <p>Assine um plano para ver os sinais em tempo real</p>
        <a href="/plans.php" class="btn btn-primary" style="margin-top:16px;">Ver Planos</a>
    </div>
    <?php else: ?>

    <!-- 4 Paineis de Estrategia -->
    <h2 style="margin-bottom:16px;">Sinais por Estrategia <span class="badge badge-live" id="live-status">AO VIVO</span></h2>
    <div class="strategies-grid" id="strategies-container">
        <?php foreach ($strategyData as $key => $data): ?>
        <div class="panel strategy-panel">
            <div class="panel-header">
                <h2><?= $data['name'] ?></h2>
                <div>
                    <?php $wrClass = $data['winRate'] >= 50 ? 'badge-green' : ($data['winRate'] > 0 ? 'badge-red' : 'badge-gray'); ?>
                    <span class="badge <?= $wrClass ?>"><?= $data['winRate'] ?>% WR</span>
                    <span class="badge badge-gray"><?= $data['wins'] ?>W / <?= $data['losses'] ?>L</span>
                </div>
            </div>
            <div class="panel-body">
                <?php if (empty($data['signals'])): ?>
                    <p class="text-muted">Aguardando sinais...</p>
                <?php else: ?>
                    <?php foreach ($data['signals'] as $s): ?>
                    <div class="signal-row">
                        <span class="signal-row-color">
                            <span class="color-dot <?= $colorClasses[$s['predicted_color']] ?>"></span>
                            <?= $colorNames[$s['predicted_color']] ?>
                        </span>
                        <span class="signal-row-conf"><?= round($s['confidence']) ?>%</span>
                        <span>
                            <?php if ($s['result'] === 'win'): ?>
                                <span class="badge badge-green">WIN</span>
                            <?php elseif ($s['result'] === 'loss'): ?>
                                <span class="badge badge-red">LOSS</span>
                            <?php else: ?>
                                <span class="badge badge-yellow">...</span>
                            <?php endif; ?>
                        </span>
                        <span class="signal-row-time"><?= date('H:i', strtotime($s['created_at'])) ?></span>
                    </div>
                    <?php endforeach; ?>
                <?php endif; ?>
            </div>
        </div>
        <?php endforeach; ?>
    </div>

    <!-- Historico de Rodadas -->
    <div class="panel" style="margin-top:16px;">
        <div class="panel-header">
            <h2>Ultimas Rodadas</h2>
            <span class="text-muted" id="u-rodadas-count"><?= count($lastGames) ?> rodadas</span>
        </div>
        <div class="panel-body">
            <div class="color-history" id="color-history">
                <?php foreach ($lastGames as $game): ?>
                    <span class="history-dot <?= $colorClasses[$game['color']] ?>"
                          title="Roll: <?= $game['roll'] ?> | <?= date('H:i:s', strtotime($game['played_at'])) ?>">
                        <?= $game['roll'] ?>
                    </span>
                <?php endforeach; ?>
            </div>

            <!-- Distribuicao de Cores -->
            <div class="color-stats">
                <?php
                $colorCounts = [0 => 0, 1 => 0, 2 => 0];
                foreach ($lastGames as $g) $colorCounts[$g['color']]++;
                $total = count($lastGames) ?: 1;
                ?>
                <div class="color-bar" id="color-bar">
                    <div class="bar-segment red" id="bar-red" style="width: <?= ($colorCounts[1]/$total)*100 ?>%">
                        <?= $colorCounts[1] ?> (<?= round(($colorCounts[1]/$total)*100, 1) ?>%)
                    </div>
                    <div class="bar-segment black" id="bar-black" style="width: <?= ($colorCounts[2]/$total)*100 ?>%">
                        <?= $colorCounts[2] ?> (<?= round(($colorCounts[2]/$total)*100, 1) ?>%)
                    </div>
                    <div class="bar-segment white" id="bar-white" style="width: <?= max(($colorCounts[0]/$total)*100, 3) ?>%">
                        <?= $colorCounts[0] ?>
                    </div>
                </div>
                <div class="color-legend" id="color-legend">
                    <span>Vermelho: <?= $colorCounts[1] ?></span>
                    <span>Preto: <?= $colorCounts[2] ?></span>
                    <span>Branco: <?= $colorCounts[0] ?></span>
                </div>
            </div>
        </div>
    </div>
    <?php endif; ?>
</div>

<style>
.strategies-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
}
.signal-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 0;
    border-bottom: 1px solid var(--border);
    font-size: 13px;
}
.signal-row:last-child { border-bottom: none; }
.signal-row-color {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 90px;
    font-weight: 500;
}
.signal-row-conf { color: var(--accent); font-weight: 700; }
.signal-row-time { color: var(--text-muted); font-size: 12px; }

/* SINAL ATIVO - Banner */
.active-signal-banner {
    position: relative;
    border-radius: 12px;
    padding: 24px;
    margin-bottom: 20px;
    text-align: center;
    overflow: hidden;
    border: 2px solid;
    animation: signalAppear 0.5s ease;
}
@keyframes signalAppear {
    from { transform: scale(0.95); opacity: 0; }
    to { transform: scale(1); opacity: 1; }
}
.active-signal-red {
    background: linear-gradient(135deg, rgba(239,68,68,0.15) 0%, rgba(239,68,68,0.05) 100%);
    border-color: var(--red-dot);
    box-shadow: 0 0 30px rgba(239,68,68,0.2);
}
.active-signal-black {
    background: linear-gradient(135deg, rgba(26,26,46,0.4) 0%, rgba(26,26,46,0.15) 100%);
    border-color: #444;
    box-shadow: 0 0 30px rgba(100,100,100,0.15);
}
.active-signal-white {
    background: linear-gradient(135deg, rgba(232,232,232,0.15) 0%, rgba(232,232,232,0.05) 100%);
    border-color: var(--white-dot);
    box-shadow: 0 0 30px rgba(232,232,232,0.15);
}
.active-signal-waiting {
    background: var(--bg-card);
    border-color: var(--border);
    opacity: 0.7;
}
.active-signal-pulse {
    position: absolute;
    top: 12px;
    right: 16px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--green);
    animation: signalPulse 1.5s infinite;
}
@keyframes signalPulse {
    0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(63,185,80,0.6); }
    70% { transform: scale(1); box-shadow: 0 0 0 10px rgba(63,185,80,0); }
    100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(63,185,80,0); }
}
.active-signal-label {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: var(--green);
    margin-bottom: 12px;
}
.active-signal-waiting .active-signal-label { color: var(--text-muted); }
.active-signal-color {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin-bottom: 10px;
}
.active-signal-dot {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: inline-block;
}
.active-signal-dot.red { background: var(--red-dot); box-shadow: 0 0 20px rgba(239,68,68,0.5); }
.active-signal-dot.black { background: var(--black-dot); border: 2px solid var(--border); box-shadow: 0 0 20px rgba(100,100,100,0.3); }
.active-signal-dot.white { background: var(--white-dot); box-shadow: 0 0 20px rgba(232,232,232,0.4); }
.active-signal-name {
    font-size: 28px;
    font-weight: 800;
    text-transform: uppercase;
}
.active-signal-red .active-signal-name { color: var(--red-dot); }
.active-signal-black .active-signal-name { color: #aaa; }
.active-signal-white .active-signal-name { color: var(--white-dot); }
.active-signal-details {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    font-size: 14px;
    color: var(--text-secondary);
}
.active-signal-conf { font-weight: 700; color: var(--accent); font-size: 16px; }
.active-signal-others {
    margin-top: 12px;
    display: flex;
    justify-content: center;
    gap: 16px;
    padding-top: 12px;
    border-top: 1px solid var(--border);
}
.active-signal-mini {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 13px;
    color: var(--text-secondary);
}

/* Ultimo resultado feedback */
.last-result-banner {
    border-radius: 8px;
    padding: 10px 16px;
    margin-bottom: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 600;
    animation: resultSlide 0.3s ease;
}
@keyframes resultSlide {
    from { transform: translateY(-10px); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
}
.last-result-win {
    background: rgba(63,185,80,0.15);
    border: 1px solid var(--green);
    color: var(--green);
}
.last-result-loss {
    background: rgba(248,81,73,0.15);
    border: 1px solid var(--red);
    color: var(--red);
}

@media (max-width: 768px) {
    .strategies-grid { grid-template-columns: 1fr; }
    .active-signal-name { font-size: 22px; }
    .active-signal-dot { width: 30px; height: 30px; }
    .active-signal-details { flex-direction: column; gap: 4px; }
    .active-signal-others { flex-direction: column; align-items: center; }
}
</style>

<?php if ($subscription): ?>
<script>
const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
const colorClasses = { 0: 'white', 1: 'red', 2: 'black' };
const strategyNames = { 'sequences': 'Sequencias', 'frequency': 'Frequencia', 'martingale': 'Martingale', 'ml-patterns': 'ML Patterns' };

let lastSignalId = null;
let wsConnected = false;

// === WebSocket para receber sinais em tempo real do bot ===
function connectWebSocket() {
    try {
        const wsPort = <?= json_encode(getenv('BOT_PORT') ?: '3001') ?>;
        const wsUrl = 'ws://' + window.location.hostname + ':' + wsPort;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            wsConnected = true;
            console.log('[WS] Conectado ao bot');
            const indicator = document.getElementById('live-status');
            if (indicator) { indicator.textContent = 'AO VIVO'; indicator.className = 'badge badge-live'; }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'signal') {
                    // Sinal novo recebido via WebSocket - atualiza banner IMEDIATAMENTE
                    showActiveSignal(msg.data);
                }

                if (msg.type === 'analysis') {
                    // Atualiza stats
                    if (msg.data.stats) updateStatsFromData(msg.data.stats);
                    // Atualiza sinais ativos
                    if (msg.data.signals && msg.data.signals.length > 0) {
                        showActiveSignals(msg.data.signals);
                    }
                }

                if (msg.type === 'stats_update') {
                    if (msg.data.stats) updateStatsFromData(msg.data.stats);
                    // Recarrega paineis de estrategia
                    refreshStrategyPanels();
                }
            } catch (e) {
                console.error('[WS] Erro parse:', e);
            }
        };

        ws.onclose = () => {
            wsConnected = false;
            console.log('[WS] Desconectado. Reconectando em 5s...');
            const indicator = document.getElementById('live-status');
            if (indicator) { indicator.textContent = 'RECONECTANDO'; indicator.className = 'badge badge-yellow'; }
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = () => {
            ws.close();
        };
    } catch (e) {
        console.log('[WS] Sem WebSocket, usando polling');
        setTimeout(connectWebSocket, 10000);
    }
}

function showActiveSignal(signal) {
    const container = document.getElementById('active-signal-container');
    if (!container) return;

    const color = parseInt(signal.predicted_color);
    const cls = colorClasses[color] || 'white';
    const name = colorNames[color] || '?';
    const conf = Math.round(signal.confidence);
    const strategy = strategyNames[signal.strategy] || signal.strategy || '';
    const time = signal.created_at ? new Date(signal.created_at).toLocaleTimeString('pt-BR') : new Date().toLocaleTimeString('pt-BR');

    container.innerHTML = `
        <div class="active-signal-banner active-signal-${cls}">
            <div class="active-signal-pulse"></div>
            <div class="active-signal-content">
                <div class="active-signal-label">SINAL ATIVO - APOSTE AGORA!</div>
                <div class="active-signal-color">
                    <span class="active-signal-dot ${cls}"></span>
                    <span class="active-signal-name">${name}</span>
                </div>
                <div class="active-signal-details">
                    <span class="active-signal-conf">${conf}% confianca</span>
                    <span class="active-signal-strategy">${strategy}</span>
                    <span class="active-signal-time">${time}</span>
                </div>
            </div>
        </div>
    `;

    lastSignalId = signal.id;
}

function showActiveSignals(signals) {
    if (!signals || signals.length === 0) return;
    // Mostra o sinal de maior confianca
    const sorted = [...signals].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    showActiveSignal(sorted[0]);
}

function updateStatsFromData(stats) {
    const wins = parseInt(stats.wins) || 0;
    const losses = parseInt(stats.losses) || 0;
    const total = parseInt(stats.total) || 0;
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided * 100).toFixed(1) : '0';

    updateVal('u-sinais', total);
    updateVal('u-wins', wins);
    updateVal('u-losses', losses);
    updateVal('u-winrate', winRate + '%');
}

// === Polling como fallback (a cada 3s para sinais ativos, 5s para o resto) ===
function refreshActiveSignal() {
    fetch('/api/active-signal.php')
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('active-signal-container');
            if (!container) return;

            if (data.active && data.active.length > 0) {
                const best = data.active[0];
                // Verifica se e um sinal novo
                if (best.id !== lastSignalId) {
                    const color = parseInt(best.predicted_color);
                    const cls = colorClasses[color] || 'white';
                    const name = colorNames[color] || '?';
                    const conf = Math.round(best.confidence);
                    const strategy = strategyNames[best.strategy_used] || best.strategy_used || '';
                    const time = new Date(best.created_at).toLocaleTimeString('pt-BR');

                    let othersHtml = '';
                    if (data.active.length > 1) {
                        othersHtml = '<div class="active-signal-others">';
                        for (let i = 1; i < data.active.length; i++) {
                            const s = data.active[i];
                            const sc = colorClasses[parseInt(s.predicted_color)] || 'white';
                            const sn = colorNames[parseInt(s.predicted_color)] || '?';
                            othersHtml += `<span class="active-signal-mini"><span class="color-dot ${sc}"></span>${sn} ${Math.round(s.confidence)}%</span>`;
                        }
                        othersHtml += '</div>';
                    }

                    container.innerHTML = `
                        <div class="active-signal-banner active-signal-${cls}">
                            <div class="active-signal-pulse"></div>
                            <div class="active-signal-content">
                                <div class="active-signal-label">SINAL ATIVO - APOSTE AGORA!</div>
                                <div class="active-signal-color">
                                    <span class="active-signal-dot ${cls}"></span>
                                    <span class="active-signal-name">${name}</span>
                                </div>
                                <div class="active-signal-details">
                                    <span class="active-signal-conf">${conf}% confianca</span>
                                    <span class="active-signal-strategy">${strategy}</span>
                                    <span class="active-signal-time">${time}</span>
                                </div>
                                ${othersHtml}
                            </div>
                        </div>
                    `;
                    lastSignalId = best.id;
                }
            } else {
                // Sem sinal ativo
                if (lastSignalId !== null) {
                    container.innerHTML = `
                        <div class="active-signal-banner active-signal-waiting">
                            <div class="active-signal-content">
                                <div class="active-signal-label">AGUARDANDO SINAL</div>
                                <div class="active-signal-color">
                                    <span class="active-signal-name" style="font-size:18px;">Analisando proxima rodada...</span>
                                </div>
                            </div>
                        </div>
                    `;
                    lastSignalId = null;
                }
            }

            // Mostra ultimo resultado
            if (data.lastResolved) {
                showLastResult(data.lastResolved);
            }
        })
        .catch(() => {});
}

function showLastResult(signal) {
    const container = document.getElementById('last-result-container');
    if (!container) return;

    const isWin = signal.result === 'win';
    const predictedName = colorNames[parseInt(signal.predicted_color)] || '?';
    const actualName = colorNames[parseInt(signal.actual_color)] || '?';

    container.innerHTML = `
        <div class="last-result-banner ${isWin ? 'last-result-win' : 'last-result-loss'}">
            ${isWin ? 'WIN' : 'LOSS'} - Previu ${predictedName}, saiu ${actualName}
            (${signal.strategy_used} - ${new Date(signal.created_at).toLocaleTimeString('pt-BR')})
        </div>
    `;
}

function refreshDashboard() {
    // Atualiza sinais por estrategia
    fetch('/api/signals.php?type=double')
        .then(r => r.json())
        .then(data => {
            // Atualiza stats gerais
            if (data.stats) updateStatsFromData(data.stats);

            // Atualiza paineis de estrategia via reload parcial
            if (data.strategies) refreshStrategyPanels();
        }).catch(e => console.error('Erro sinais:', e));

    // Atualiza historico de rodadas
    fetch('/api/history.php?limit=50')
        .then(r => r.json())
        .then(data => {
            updateVal('u-rodadas', data.total);
            updateVal('u-rodadas-count', data.total + ' rodadas');

            const history = document.getElementById('color-history');
            if (history && data.games) {
                let html = '';
                data.games.forEach(g => {
                    const cls = colorClasses[g.color];
                    const time = new Date(g.played_at).toLocaleTimeString('pt-BR');
                    html += '<span class="history-dot ' + cls + '" title="Roll: ' + g.roll + ' | ' + time + '">' + g.roll + '</span>';
                });
                history.innerHTML = html;
            }

            if (data.distribution) {
                const d = data.distribution;
                const barRed = document.getElementById('bar-red');
                const barBlack = document.getElementById('bar-black');
                const barWhite = document.getElementById('bar-white');
                if (barRed) { barRed.style.width = d.red.pct + '%'; barRed.textContent = d.red.count + ' (' + d.red.pct + '%)'; }
                if (barBlack) { barBlack.style.width = d.black.pct + '%'; barBlack.textContent = d.black.count + ' (' + d.black.pct + '%)'; }
                if (barWhite) { barWhite.style.width = Math.max(d.white.pct, 3) + '%'; barWhite.textContent = d.white.count; }

                const legend = document.getElementById('color-legend');
                if (legend) {
                    legend.innerHTML = '<span>Vermelho: ' + d.red.count + '</span><span>Preto: ' + d.black.count + '</span><span>Branco: ' + d.white.count + '</span>';
                }
            }
        }).catch(e => console.error('Erro historico:', e));
}

function refreshStrategyPanels() {
    fetch(window.location.href)
        .then(r => r.text())
        .then(html => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const newStrategies = doc.getElementById('strategies-container');
            const current = document.getElementById('strategies-container');
            if (newStrategies && current) {
                current.innerHTML = newStrategies.innerHTML;
            }
        }).catch(() => {});
}

function updateVal(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent != value) {
        el.textContent = value;
        el.style.transition = 'color 0.3s';
        el.style.color = '#ff6a00';
        setTimeout(() => el.style.color = '', 1000);
    }
}

// Inicia WebSocket
connectWebSocket();

// Polling de sinal ativo a cada 3s (rapido!)
setInterval(refreshActiveSignal, 3000);

// Polling completo a cada 5s (stats, estrategias, historico)
setInterval(refreshDashboard, 5000);
</script>
<?php endif; ?>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
