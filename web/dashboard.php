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
            <div class="stat-value"><?= count($lastGames) ?></div>
            <div class="stat-label">Rodadas Coletadas</div>
        </div>
        <div class="stat-card">
            <div class="stat-value"><?= $stats['total'] ?? 0 ?></div>
            <div class="stat-label">Sinais Gerados</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value"><?= $stats['wins'] ?? 0 ?></div>
            <div class="stat-label">Acertos</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value"><?= $stats['losses'] ?? 0 ?></div>
            <div class="stat-label">Erros</div>
        </div>
        <div class="stat-card stat-gold">
            <div class="stat-value">
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
                <span class="text-muted"><?= count($lastGames) ?> rodadas</span>
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
                    <div class="color-bar">
                        <div class="bar-segment red" style="width: <?= ($colorCounts[1]/$total)*100 ?>%">
                            <?= $colorCounts[1] ?> (<?= round(($colorCounts[1]/$total)*100, 1) ?>%)
                        </div>
                        <div class="bar-segment black" style="width: <?= ($colorCounts[2]/$total)*100 ?>%">
                            <?= $colorCounts[2] ?> (<?= round(($colorCounts[2]/$total)*100, 1) ?>%)
                        </div>
                        <div class="bar-segment white" style="width: <?= max(($colorCounts[0]/$total)*100, 3) ?>%">
                            <?= $colorCounts[0] ?>
                        </div>
                    </div>
                    <div class="color-legend">
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
</script>
<script src="/assets/js/dashboard.js"></script>
<?php endif; ?>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
