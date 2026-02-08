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
@media (max-width: 768px) {
    .strategies-grid { grid-template-columns: 1fr; }
}
</style>

<?php if ($subscription): ?>
<script>
const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
const colorClasses = { 0: 'white', 1: 'red', 2: 'black' };

function refreshDashboard() {
    // Atualiza sinais por estrategia
    fetch('/api/signals.php?type=double')
        .then(r => r.json())
        .then(data => {
            // Atualiza stats gerais
            if (data.stats) {
                const wins = parseInt(data.stats.wins) || 0;
                const losses = parseInt(data.stats.losses) || 0;
                const total = parseInt(data.stats.total) || 0;
                const decided = wins + losses;
                const winRate = decided > 0 ? (wins / decided * 100).toFixed(1) : '0';

                updateVal('u-sinais', total);
                updateVal('u-wins', wins);
                updateVal('u-losses', losses);
                updateVal('u-winrate', winRate + '%');
            }

            // Atualiza paineis de estrategia via reload parcial
            if (data.strategies) {
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

function updateVal(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent != value) {
        el.textContent = value;
        el.style.transition = 'color 0.3s';
        el.style.color = '#ff6a00';
        setTimeout(() => el.style.color = '', 1000);
    }
}

setInterval(refreshDashboard, 10000);
</script>
<?php endif; ?>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
