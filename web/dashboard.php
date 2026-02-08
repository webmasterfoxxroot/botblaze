<?php
require_once __DIR__ . '/includes/auth.php';
requireLogin();

$user = getCurrentUser();
$subscription = hasActiveSubscription();
$pageTitle = 'BotBlaze - Dashboard';

// Busca ultimos sinais
$db = getDB();
$signals = $db->query(
    "SELECT * FROM signals WHERE game_type = 'double' ORDER BY created_at DESC LIMIT 20"
)->fetchAll();

// Stats dos sinais
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

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorClasses = [0 => 'white', 1 => 'red', 2 => 'black'];
$colorEmojis = [0 => '⚪', 1 => '🔴', 2 => '⬛'];

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

    <div class="dashboard-grid">
        <!-- Sinais em Tempo Real -->
        <div class="panel">
            <div class="panel-header">
                <h2>Sinais Double</h2>
                <span class="badge badge-live" id="live-status">AO VIVO</span>
            </div>
            <div class="panel-body" id="signals-container">
                <?php if (!$subscription): ?>
                    <div class="locked-content">
                        <span class="lock-icon">🔒</span>
                        <p>Assine um plano para ver os sinais</p>
                    </div>
                <?php else: ?>
                    <?php if (empty($signals)): ?>
                        <p class="text-muted">Aguardando sinais... O bot esta analisando.</p>
                    <?php else: ?>
                        <?php foreach ($signals as $signal): ?>
                        <div class="signal-card <?= $signal['result'] ?>">
                            <div class="signal-color">
                                <span class="color-dot <?= $colorClasses[$signal['predicted_color']] ?>"></span>
                                <?= $colorEmojis[$signal['predicted_color']] ?>
                                <?= $colorNames[$signal['predicted_color']] ?>
                            </div>
                            <div class="signal-info">
                                <span class="confidence"><?= round($signal['confidence']) ?>%</span>
                                <span class="strategy"><?= htmlspecialchars($signal['strategy_used']) ?></span>
                            </div>
                            <div class="signal-result">
                                <?php if ($signal['result'] === 'win'): ?>
                                    <span class="badge badge-green">WIN</span>
                                <?php elseif ($signal['result'] === 'loss'): ?>
                                    <span class="badge badge-red">LOSS</span>
                                <?php else: ?>
                                    <span class="badge badge-yellow">PENDENTE</span>
                                <?php endif; ?>
                            </div>
                            <div class="signal-time">
                                <?= date('H:i:s', strtotime($signal['created_at'])) ?>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    <?php endif; ?>
                <?php endif; ?>
            </div>
        </div>

        <!-- Historico de Rodadas -->
        <div class="panel">
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
                        <span>🔴 Vermelho: <?= $colorCounts[1] ?></span>
                        <span>⬛ Preto: <?= $colorCounts[2] ?></span>
                        <span>⚪ Branco: <?= $colorCounts[0] ?></span>
                    </div>
                </div>
            </div>
        </div>
    </div>
</div>

<?php if ($subscription): ?>
<script>
const WS_PORT = <?= BOT_WS_PORT ?>;
const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
const colorEmojis = { 0: '⚪', 1: '🔴', 2: '⬛' };
const colorClasses = { 0: 'white', 1: 'red', 2: 'black' };

function refreshDashboard() {
    // Atualiza sinais
    fetch('/api/signals.php?type=double&limit=20')
        .then(r => r.json())
        .then(data => {
            // Atualiza stats
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

            // Atualiza lista de sinais
            const container = document.getElementById('signals-container');
            if (container && data.signals && data.signals.length > 0) {
                let html = '';
                data.signals.forEach(s => {
                    let resultBadge = '';
                    if (s.result === 'win') resultBadge = '<span class="badge badge-green">WIN</span>';
                    else if (s.result === 'loss') resultBadge = '<span class="badge badge-red">LOSS</span>';
                    else resultBadge = '<span class="badge badge-yellow">PENDENTE</span>';

                    const color = parseInt(s.predicted_color);
                    const time = new Date(s.created_at).toLocaleTimeString('pt-BR');

                    html += `<div class="signal-card ${s.result}">
                        <div class="signal-color">
                            <span class="color-dot ${colorClasses[color]}"></span>
                            ${colorEmojis[color]} ${colorNames[color]}
                        </div>
                        <div class="signal-info">
                            <span class="confidence">${Math.round(s.confidence)}%</span>
                            <span class="strategy">${s.strategy_used}</span>
                        </div>
                        <div class="signal-result">${resultBadge}</div>
                        <div class="signal-time">${time}</div>
                    </div>`;
                });
                container.innerHTML = html;
            }
        }).catch(e => console.error('Erro sinais:', e));

    // Atualiza historico de rodadas
    fetch('/api/history.php?limit=50')
        .then(r => r.json())
        .then(data => {
            updateVal('u-rodadas', data.total);
            updateVal('u-rodadas-count', data.total + ' rodadas');

            // Atualiza bolinhas
            const history = document.getElementById('color-history');
            if (history && data.games) {
                let html = '';
                data.games.forEach(g => {
                    const cls = colorClasses[g.color];
                    const time = new Date(g.played_at).toLocaleTimeString('pt-BR');
                    html += `<span class="history-dot ${cls}" title="Roll: ${g.roll} | ${time}">${g.roll}</span>`;
                });
                history.innerHTML = html;
            }

            // Atualiza barras de distribuicao
            if (data.distribution) {
                const d = data.distribution;
                const barRed = document.getElementById('bar-red');
                const barBlack = document.getElementById('bar-black');
                const barWhite = document.getElementById('bar-white');
                if (barRed) { barRed.style.width = d.red.pct + '%'; barRed.textContent = `${d.red.count} (${d.red.pct}%)`; }
                if (barBlack) { barBlack.style.width = d.black.pct + '%'; barBlack.textContent = `${d.black.count} (${d.black.pct}%)`; }
                if (barWhite) { barWhite.style.width = Math.max(d.white.pct, 3) + '%'; barWhite.textContent = d.white.count; }

                const legend = document.getElementById('color-legend');
                if (legend) {
                    legend.innerHTML = `<span>🔴 Vermelho: ${d.red.count}</span><span>⬛ Preto: ${d.black.count}</span><span>⚪ Branco: ${d.white.count}</span>`;
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

// Atualiza a cada 10 segundos
setInterval(refreshDashboard, 10000);
</script>
<?php endif; ?>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
