<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$db = getDB();

// Stats gerais
$totalUsers = $db->query("SELECT COUNT(*) as c FROM users WHERE role = 'user'")->fetch()['c'];
$activeUsers = $db->query("SELECT COUNT(*) as c FROM users WHERE role = 'user' AND status = 'active'")->fetch()['c'];
$blockedUsers = $db->query("SELECT COUNT(*) as c FROM users WHERE status = 'blocked'")->fetch()['c'];

$activeSubs = $db->query("
    SELECT COUNT(*) as c FROM subscriptions
    WHERE status = 'active' AND (expires_at IS NULL OR expires_at > NOW())
")->fetch()['c'];

$revenue = $db->query("
    SELECT COALESCE(SUM(p.price), 0) as total FROM subscriptions s
    JOIN plans p ON s.plan_id = p.id
")->fetch()['total'];

$totalGames = $db->query("SELECT COUNT(*) as c FROM game_history_double")->fetch()['c'];

// Sinais stats geral
$signalStats = $db->query("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
    FROM signals WHERE game_type = 'double'
")->fetch();

// As 4 estrategias
$strategies = ['sequences', 'frequency', 'martingale', 'ml-patterns'];
$strategyNames = [
    'sequences' => 'Sequencias',
    'frequency' => 'Frequencia',
    'martingale' => 'Martingale',
    'ml-patterns' => 'ML Patterns'
];

// Stats e sinais por estrategia
$strategyData = [];
foreach ($strategies as $strat) {
    $stats = $db->prepare("
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
        FROM signals WHERE game_type = 'double' AND strategy_used = ?
    ");
    $stats->execute([$strat]);
    $stats = $stats->fetch();

    $signals = $db->prepare("
        SELECT * FROM signals WHERE game_type = 'double' AND strategy_used = ?
        ORDER BY created_at DESC LIMIT 8
    ");
    $signals->execute([$strat]);
    $signals = $signals->fetchAll();

    $d = $stats['wins'] + $stats['losses'];
    $strategyData[$strat] = [
        'name' => $strategyNames[$strat],
        'total' => (int)$stats['total'],
        'wins' => (int)$stats['wins'],
        'losses' => (int)$stats['losses'],
        'winRate' => $d > 0 ? round(($stats['wins'] / $d) * 100, 1) : 0,
        'signals' => $signals
    ];
}

// Ultimos usuarios
$recentUsers = $db->query("
    SELECT u.*,
           (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') as has_sub
    FROM users u WHERE u.role = 'user'
    ORDER BY u.created_at DESC LIMIT 10
")->fetchAll();

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorEmojis = [0 => '⚪', 1 => '🔴', 2 => '⬛'];

$pageTitle = 'BotBlaze - Admin';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-dashboard">
    <h1 class="page-title">Painel Admin <span class="badge badge-live" id="live-indicator">TEMPO REAL</span></h1>

    <!-- Stats Gerais -->
    <div class="stats-grid stats-grid-6">
        <div class="stat-card">
            <div class="stat-value" id="s-totalUsers"><?= $totalUsers ?></div>
            <div class="stat-label">Usuarios</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value" id="s-activeUsers"><?= $activeUsers ?></div>
            <div class="stat-label">Ativos</div>
        </div>
        <div class="stat-card stat-blue">
            <div class="stat-value" id="s-activeSubs"><?= $activeSubs ?></div>
            <div class="stat-label">Assinantes</div>
        </div>
        <div class="stat-card stat-gold">
            <div class="stat-value" id="s-revenue">R$ <?= number_format($revenue, 2, ',', '.') ?></div>
            <div class="stat-label">Receita</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="s-totalGames"><?= $totalGames ?></div>
            <div class="stat-label">Rodadas</div>
        </div>
        <div class="stat-card stat-gold">
            <?php
            $decided = $signalStats['wins'] + $signalStats['losses'];
            $winRate = $decided > 0 ? round(($signalStats['wins'] / $decided) * 100, 1) : 0;
            ?>
            <div class="stat-value" id="s-winRate"><?= $winRate ?>%</div>
            <div class="stat-label">Win Rate Geral</div>
        </div>
    </div>

    <!-- 4 Paineis de Estrategia -->
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
                    <p class="text-muted">Sem sinais ainda...</p>
                <?php else: ?>
                    <?php foreach ($data['signals'] as $s): ?>
                    <div class="signal-row">
                        <span class="signal-row-color">
                            <span class="color-dot <?= ['white','red','black'][$s['predicted_color']] ?>"></span>
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

    <!-- Usuarios -->
    <div class="panel" style="margin-top:16px">
        <div class="panel-header">
            <h2>Ultimos Usuarios</h2>
            <a href="/admin/users.php" class="btn btn-sm btn-outline">Ver Todos</a>
        </div>
        <div class="panel-body">
            <table class="table">
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Plano</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($recentUsers as $u): ?>
                    <tr>
                        <td><?= htmlspecialchars($u['name']) ?></td>
                        <td><?= htmlspecialchars($u['email']) ?></td>
                        <td>
                            <span class="badge <?= $u['status'] === 'active' ? 'badge-green' : 'badge-red' ?>">
                                <?= $u['status'] === 'active' ? 'Ativo' : 'Bloqueado' ?>
                            </span>
                        </td>
                        <td>
                            <?= $u['has_sub'] > 0 ? '<span class="badge badge-blue">Assinante</span>' : '<span class="badge badge-gray">Sem plano</span>' ?>
                        </td>
                        <td><?= date('d/m/Y', strtotime($u['created_at'])) ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
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

<script>
function refreshAdmin() {
    fetch('/api/admin-stats.php')
        .then(r => r.json())
        .then(data => {
            updateStat('s-totalUsers', data.stats.totalUsers);
            updateStat('s-activeUsers', data.stats.activeUsers);
            updateStat('s-activeSubs', data.stats.activeSubs);
            updateStat('s-revenue', 'R$ ' + data.stats.revenue);
            updateStat('s-totalGames', data.stats.totalGames);
            updateStat('s-winRate', data.stats.winRate + '%');
        })
        .catch(e => console.error('Erro:', e));

    // Recarrega os paineis de estrategia via reload parcial
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

function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent != value) {
        el.textContent = value;
        el.style.transition = 'color 0.3s';
        el.style.color = '#ff6a00';
        setTimeout(() => el.style.color = '', 1000);
    }
}

setInterval(refreshAdmin, 10000);
</script>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
