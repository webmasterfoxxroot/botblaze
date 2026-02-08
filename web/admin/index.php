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

// Sinais stats
$signalStats = $db->query("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
    FROM signals WHERE game_type = 'double'
")->fetch();

$totalGames = $db->query("SELECT COUNT(*) as c FROM game_history_double")->fetch()['c'];

// Ultimos usuarios
$recentUsers = $db->query("
    SELECT u.*,
           (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') as has_sub
    FROM users u WHERE u.role = 'user'
    ORDER BY u.created_at DESC LIMIT 10
")->fetchAll();

// Ultimos sinais
$recentSignals = $db->query("
    SELECT * FROM signals WHERE game_type = 'double'
    ORDER BY created_at DESC LIMIT 10
")->fetchAll();

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorEmojis = [0 => '⚪', 1 => '🔴', 2 => '⬛'];

$pageTitle = 'BotBlaze - Admin';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-dashboard">
    <h1 class="page-title">Painel Admin <span class="badge badge-live" id="live-indicator">TEMPO REAL</span></h1>

    <!-- Stats Cards -->
    <div class="stats-grid stats-grid-6">
        <div class="stat-card">
            <div class="stat-value" id="s-totalUsers"><?= $totalUsers ?></div>
            <div class="stat-label">Usuarios Total</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value" id="s-activeUsers"><?= $activeUsers ?></div>
            <div class="stat-label">Usuarios Ativos</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value" id="s-blockedUsers"><?= $blockedUsers ?></div>
            <div class="stat-label">Bloqueados</div>
        </div>
        <div class="stat-card stat-blue">
            <div class="stat-value" id="s-activeSubs"><?= $activeSubs ?></div>
            <div class="stat-label">Assinaturas Ativas</div>
        </div>
        <div class="stat-card stat-gold">
            <div class="stat-value" id="s-revenue">R$ <?= number_format($revenue, 2, ',', '.') ?></div>
            <div class="stat-label">Receita Total</div>
        </div>
        <div class="stat-card">
            <div class="stat-value" id="s-totalGames"><?= $totalGames ?></div>
            <div class="stat-label">Rodadas Coletadas</div>
        </div>
    </div>

    <!-- Sinais Performance -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value" id="s-signalsTotal"><?= $signalStats['total'] ?></div>
            <div class="stat-label">Sinais Gerados</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value" id="s-wins"><?= $signalStats['wins'] ?></div>
            <div class="stat-label">Wins</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value" id="s-losses"><?= $signalStats['losses'] ?></div>
            <div class="stat-label">Losses</div>
        </div>
        <div class="stat-card stat-gold">
            <?php
            $decided = $signalStats['wins'] + $signalStats['losses'];
            $winRate = $decided > 0 ? round(($signalStats['wins'] / $decided) * 100, 1) : 0;
            ?>
            <div class="stat-value" id="s-winRate"><?= $winRate ?>%</div>
            <div class="stat-label">Win Rate</div>
        </div>
    </div>

    <!-- Performance por Estrategia -->
    <?php
    $strategyStats = $db->query("
        SELECT strategy_used,
            COUNT(*) as total,
            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
        FROM signals WHERE game_type = 'double'
        GROUP BY strategy_used ORDER BY strategy_used
    ")->fetchAll();
    ?>
    <div class="panel" style="margin-bottom:16px">
        <div class="panel-header"><h2>Performance por Estrategia</h2></div>
        <div class="panel-body">
            <div class="stats-grid" id="strategy-stats">
                <?php foreach ($strategyStats as $st):
                    $d = $st['wins'] + $st['losses'];
                    $wr = $d > 0 ? round(($st['wins'] / $d) * 100, 1) : 0;
                    $wrClass = $wr >= 50 ? 'text-green' : 'text-red';
                ?>
                <div class="stat-card">
                    <div class="stat-label" style="text-transform:capitalize;font-size:14px;margin-bottom:8px">
                        <?= htmlspecialchars($st['strategy_used']) ?>
                    </div>
                    <div class="stat-value <?= $wrClass ?>"><?= $wr ?>%</div>
                    <div class="stat-label">
                        <span style="color:var(--green)"><?= $st['wins'] ?>W</span> /
                        <span style="color:var(--red)"><?= $st['losses'] ?>L</span>
                        (<?= $st['total'] ?> total)
                    </div>
                </div>
                <?php endforeach; ?>
                <?php if (empty($strategyStats)): ?>
                    <p class="text-muted">Aguardando dados...</p>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <div class="dashboard-grid">
        <!-- Ultimos Usuarios -->
        <div class="panel">
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

        <!-- Ultimos Sinais -->
        <div class="panel">
            <div class="panel-header">
                <h2>Ultimos Sinais</h2>
            </div>
            <div class="panel-body" id="signals-table-body">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Cor</th>
                            <th>Confianca</th>
                            <th>Estrategia</th>
                            <th>Resultado</th>
                            <th>Hora</th>
                        </tr>
                    </thead>
                    <tbody id="signals-tbody">
                        <?php foreach ($recentSignals as $s): ?>
                        <tr>
                            <td><?= $colorEmojis[$s['predicted_color']] ?> <?= $colorNames[$s['predicted_color']] ?></td>
                            <td><?= round($s['confidence']) ?>%</td>
                            <td><small><?= htmlspecialchars($s['strategy_used']) ?></small></td>
                            <td>
                                <?php if ($s['result'] === 'win'): ?>
                                    <span class="badge badge-green">WIN</span>
                                <?php elseif ($s['result'] === 'loss'): ?>
                                    <span class="badge badge-red">LOSS</span>
                                <?php else: ?>
                                    <span class="badge badge-yellow">...</span>
                                <?php endif; ?>
                            </td>
                            <td><?= date('H:i:s', strtotime($s['created_at'])) ?></td>
                        </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<script>
// Auto-refresh a cada 10 segundos
function refreshAdmin() {
    fetch('/api/admin-stats.php')
        .then(r => r.json())
        .then(data => {
            // Atualiza stats com animacao
            updateStat('s-totalUsers', data.stats.totalUsers);
            updateStat('s-activeUsers', data.stats.activeUsers);
            updateStat('s-blockedUsers', data.stats.blockedUsers);
            updateStat('s-activeSubs', data.stats.activeSubs);
            updateStat('s-revenue', 'R$ ' + data.stats.revenue);
            updateStat('s-totalGames', data.stats.totalGames);
            updateStat('s-signalsTotal', data.stats.signalsTotal);
            updateStat('s-wins', data.stats.wins);
            updateStat('s-losses', data.stats.losses);
            updateStat('s-winRate', data.stats.winRate + '%');

            // Atualiza tabela de sinais
            const tbody = document.getElementById('signals-tbody');
            if (tbody && data.signals) {
                let html = '';
                data.signals.forEach(s => {
                    let badge = '';
                    if (s.result === 'win') badge = '<span class="badge badge-green">WIN</span>';
                    else if (s.result === 'loss') badge = '<span class="badge badge-red">LOSS</span>';
                    else badge = '<span class="badge badge-yellow">...</span>';

                    html += `<tr>
                        <td>${s.color_emoji} ${s.color_name}</td>
                        <td>${s.confidence}%</td>
                        <td><small>${s.strategy}</small></td>
                        <td>${badge}</td>
                        <td>${s.time}</td>
                    </tr>`;
                });
                tbody.innerHTML = html;
            }

            // Atualiza stats por estrategia
            const stratDiv = document.getElementById('strategy-stats');
            if (stratDiv && data.strategies) {
                let html = '';
                data.strategies.forEach(st => {
                    const wrClass = st.winRate >= 50 ? 'text-green' : 'text-red';
                    html += `<div class="stat-card">
                        <div class="stat-label" style="text-transform:capitalize;font-size:14px;margin-bottom:8px">${st.strategy}</div>
                        <div class="stat-value ${wrClass}">${st.winRate}%</div>
                        <div class="stat-label">
                            <span style="color:var(--green)">${st.wins}W</span> /
                            <span style="color:var(--red)">${st.losses}L</span>
                            (${st.total} total)
                        </div>
                    </div>`;
                });
                stratDiv.innerHTML = html;
            }
        })
        .catch(e => console.error('Erro no refresh:', e));
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

// Atualiza a cada 10 segundos
setInterval(refreshAdmin, 10000);
</script>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
