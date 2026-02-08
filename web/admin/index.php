<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$db = getDB();

// Acao de reset
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['action'])) {
    $action = $_POST['action'];

    if ($action === 'reset_signals') {
        $db->exec("DELETE FROM signals");
        $resetMsg = "Todos os sinais e estatisticas foram resetados!";
    } elseif ($action === 'reset_history') {
        $db->exec("DELETE FROM signals");
        $db->exec("DELETE FROM game_history_double");
        $resetMsg = "Sinais e historico de jogos foram resetados!";
    } elseif ($action === 'reset_all') {
        $db->exec("DELETE FROM user_bets");
        $db->exec("DELETE FROM transactions");
        $db->exec("DELETE FROM signals");
        $db->exec("DELETE FROM game_history_double");
        $resetMsg = "Tudo foi resetado (sinais, historico, apostas, transacoes)!";
    }

    if (isset($resetMsg)) {
        header('Location: /admin/?reset=ok&msg=' . urlencode($resetMsg));
        exit;
    }
}

$resetMsg = isset($_GET['reset']) ? $_GET['msg'] : null;

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

// Sinais ativos (pendentes)
$activeSignals = $db->query("
    SELECT id, predicted_color, confidence, strategy_used, created_at
    FROM signals
    WHERE game_type = 'double' AND result = 'pending'
    AND created_at >= DATE_SUB(NOW(), INTERVAL 2 MINUTE)
    ORDER BY confidence DESC
    LIMIT 4
")->fetchAll();

// Ultimas rodadas para o carousel
$lastGames = $db->query(
    "SELECT * FROM game_history_double ORDER BY played_at DESC LIMIT 25"
)->fetchAll();

// Ultimos usuarios
$recentUsers = $db->query("
    SELECT u.*,
           (SELECT COUNT(*) FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active') as has_sub
    FROM users u WHERE u.role = 'user'
    ORDER BY u.created_at DESC LIMIT 10
")->fetchAll();

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorClasses = [0 => 'white', 1 => 'red', 2 => 'black'];
$colorEmojis = [0 => '&#9898;', 1 => '&#128308;', 2 => '&#11035;'];

$pageTitle = 'BotBlaze - Admin';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-dashboard">
    <h1 class="page-title">Painel Admin <span class="badge badge-live" id="live-indicator">TEMPO REAL</span>
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('reset-modal').style.display='flex'" style="margin-left:16px;font-size:12px;">Resetar Dados</button>
    </h1>

    <?php if ($resetMsg): ?>
    <div class="alert alert-success"><?= htmlspecialchars($resetMsg) ?></div>
    <?php endif; ?>

    <!-- SINAL ATIVO - Banner Principal (Admin ve mesmo sem assinatura) -->
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

    <!-- ROLETA VISUAL - Animacao do Jogo -->
    <div class="roulette-container" id="roulette-container">
        <div class="roulette-status" id="roulette-status">
            <div class="roulette-status-bar" id="roulette-status-bar">
                <div class="roulette-progress" id="roulette-progress"></div>
                <span class="roulette-status-text" id="roulette-status-text">Aguardando...</span>
            </div>
        </div>
        <div class="roulette-viewport">
            <div class="roulette-pointer"></div>
            <div class="roulette-track" id="roulette-track"></div>
        </div>
        <div class="roulette-online">
            <span class="roulette-online-dot"></span> Online
        </div>
        <div class="roulette-history">
            <div class="roulette-history-label">GIROS ANTERIORES</div>
            <div class="roulette-history-dots" id="roulette-history-dots">
                <?php foreach (array_slice($lastGames, 0, 25) as $g):
                    $r = (int)$g['roll'];
                    $c = $r === 0 ? 'white' : ($r <= 7 ? 'red' : 'black');
                    $label = $r === 0 ? '&#10070;' : $r;
                ?>
                    <span class="rh-dot <?= $c ?>" title="<?= $r ?>"><?= $label ?></span>
                <?php endforeach; ?>
            </div>
        </div>
    </div>

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
    <!-- Modal Reset -->
    <div id="reset-modal" style="display:none;position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.7);align-items:center;justify-content:center;">
        <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:32px;max-width:480px;width:90%;">
            <h2 style="margin-bottom:8px;">Resetar Dados</h2>
            <p class="text-muted" style="margin-bottom:24px;font-size:14px;">Escolha o que deseja limpar. Esta acao nao pode ser desfeita.</p>

            <form method="POST" style="margin-bottom:12px;">
                <input type="hidden" name="action" value="reset_signals">
                <button type="submit" class="btn btn-primary btn-full" onclick="return confirm('Tem certeza? Vai apagar todos os sinais e estatisticas!')">
                    Resetar Sinais e Estatisticas
                </button>
                <p class="text-muted" style="font-size:11px;margin-top:4px;">Apaga todos os sinais (WIN/LOSS). Mantem historico de jogos.</p>
            </form>

            <form method="POST" style="margin-bottom:12px;">
                <input type="hidden" name="action" value="reset_history">
                <button type="submit" class="btn btn-danger btn-full" onclick="return confirm('Tem certeza? Vai apagar sinais E historico de jogos!')">
                    Resetar Sinais + Historico de Jogos
                </button>
                <p class="text-muted" style="font-size:11px;margin-top:4px;">Apaga sinais e historico. Bot vai recoletar do zero.</p>
            </form>

            <form method="POST" style="margin-bottom:16px;">
                <input type="hidden" name="action" value="reset_all">
                <button type="submit" class="btn btn-full" style="background:#8b0000;color:#fff;" onclick="return confirm('ATENCAO! Vai apagar TUDO: sinais, historico, apostas e transacoes. Tem certeza?')">
                    Resetar TUDO
                </button>
                <p class="text-muted" style="font-size:11px;margin-top:4px;">Apaga tudo exceto usuarios e planos.</p>
            </form>

            <button class="btn btn-outline btn-full" onclick="document.getElementById('reset-modal').style.display='none'">Cancelar</button>
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
/* ROLETA VISUAL */
.roulette-container { background: #1a1f2e; border: 1px solid var(--border); border-radius: 12px; margin-bottom: 20px; overflow: hidden; }
.roulette-status-bar { position: relative; height: 36px; background: #2a2f3e; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.roulette-progress { position: absolute; left: 0; top: 0; height: 100%; background: linear-gradient(90deg, #e63946 0%, #ff4d5a 100%); transition: width 1s linear; width: 0%; }
.roulette-status-bar.spinning .roulette-progress { width: 100% !important; }
.roulette-status-bar.result .roulette-progress { width: 0% !important; }
.roulette-status-text { position: relative; z-index: 2; font-size: 14px; font-weight: 700; color: #fff; text-shadow: 0 1px 3px rgba(0,0,0,0.5); }
.roulette-viewport { position: relative; height: 140px; overflow: hidden; display: flex; align-items: center; }
.roulette-pointer { position: absolute; left: 50%; top: 0; bottom: 0; width: 3px; background: #fff; z-index: 10; transform: translateX(-50%); box-shadow: 0 0 10px rgba(255,255,255,0.5); }
.roulette-pointer::before { content: ''; position: absolute; top: -6px; left: 50%; transform: translateX(-50%); border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 10px solid #fff; }
.roulette-track { display: flex; gap: 8px; padding: 0 20px; transition: transform 3s cubic-bezier(0.15, 0.85, 0.3, 1); will-change: transform; }
.roulette-track.no-transition { transition: none !important; }
.roulette-card { flex-shrink: 0; width: 90px; height: 110px; border-radius: 8px; display: flex; align-items: center; justify-content: center; }
.roulette-card-inner { width: 52px; height: 52px; border-radius: 50%; border: 3px solid rgba(255,255,255,0.3); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; color: #fff; }
.roulette-card.rc-red { background: linear-gradient(135deg, #b91c2c 0%, #8b1520 100%); box-shadow: inset 0 0 20px rgba(0,0,0,0.3); }
.roulette-card.rc-black { background: linear-gradient(135deg, #2d2d40 0%, #1a1a2e 100%); box-shadow: inset 0 0 20px rgba(0,0,0,0.3); }
.roulette-card.rc-white { background: linear-gradient(135deg, #ddd 0%, #aaa 100%); box-shadow: inset 0 0 20px rgba(0,0,0,0.15); }
.roulette-card.rc-white .roulette-card-inner { border-color: rgba(0,0,0,0.15); color: #333; }
.rc-icon { font-size: 22px; color: rgba(255,255,255,0.6); }
.roulette-card.rc-white .rc-icon { color: #333; }
.roulette-online { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 8px 16px; font-size: 13px; color: var(--green); font-weight: 600; }
.roulette-online-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); animation: pulse 2s infinite; }
.roulette-history { border-top: 1px solid var(--border); padding: 12px 16px; }
.roulette-history-label { font-size: 12px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px; letter-spacing: 0.5px; }
.roulette-history-dots { display: flex; flex-wrap: wrap; gap: 4px; }
.rh-dot { width: 36px; height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 700; cursor: default; border: 2px solid transparent; }
.rh-dot.red { background: #e63946; color: #fff; border-color: #c0313d; }
.rh-dot.black { background: #1a1a2e; color: #ccc; border-color: #3a3a4e; }
.rh-dot.white { background: #f0f0f0; color: #333; border-color: #ddd; font-size: 16px; }

@media (max-width: 768px) {
    .strategies-grid { grid-template-columns: 1fr; }
    .active-signal-name { font-size: 22px; }
    .active-signal-dot { width: 30px; height: 30px; }
    .active-signal-details { flex-direction: column; gap: 4px; }
    .roulette-card { width: 70px; height: 90px; }
    .roulette-card-inner { width: 40px; height: 40px; font-size: 14px; }
    .roulette-viewport { height: 110px; }
}
</style>

<script>
const colorNames = { 0: 'Branco', 1: 'Vermelho', 2: 'Preto' };
const colorClasses = { 0: 'white', 1: 'red', 2: 'black' };
const strategyNames = { 'sequences': 'Sequencias', 'frequency': 'Frequencia', 'martingale': 'Martingale', 'ml-patterns': 'ML Patterns' };

let lastSignalId = null;
let wsConnected = false;

// === SINCRONIZACAO COM A BLAZE ===
const rouletteGames = [];
let rouletteState = 'waiting'; // waiting, spinning, result
let countdownTimer = null;
let blazeCycleTime = 30;       // tempo do ciclo (auto-detectado pelo bot)
let blazeNextGame = null;      // timestamp estimado do proximo jogo
let lastSyncGameId = null;     // ID do ultimo jogo sincronizado

function colorFromRoll(roll) {
    roll = parseInt(roll);
    if (roll === 0) return 0;
    if (roll <= 7) return 1;
    return 2;
}
function getCardClass(color) {
    return { 0: 'rc-white', 1: 'rc-red', 2: 'rc-black' }[parseInt(color)] || 'rc-black';
}
function createCardHTML(game) {
    const roll = parseInt(game.roll);
    const color = colorFromRoll(roll);
    const cls = getCardClass(color);
    if (color === 0) return `<div class="roulette-card ${cls}"><div class="roulette-card-inner"><span class="rc-icon">&#10070;</span></div></div>`;
    return `<div class="roulette-card ${cls}"><div class="roulette-card-inner">${roll}</div></div>`;
}
function generateSpinCards(count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
        const roll = Math.floor(Math.random() * 15);
        cards.push({ roll, color: roll === 0 ? 0 : (roll <= 7 ? 1 : 2) });
    }
    return cards;
}

// === HANDLER PRINCIPAL: recebe blaze_sync do bot ===
function handleBlazeSync(data) {
    if (!data || !data.games || data.games.length === 0) return;

    // Atualiza timing
    if (data.cycleTime) blazeCycleTime = data.cycleTime;
    if (data.nextGameEstimate) blazeNextGame = data.nextGameEstimate;

    const newestId = data.games[0].id || data.games[0].game_id;

    // JOGO NOVO DETECTADO - anima!
    if (data.newGame && newestId !== lastSyncGameId && rouletteState !== 'spinning') {
        lastSyncGameId = newestId;
        spinRoulette(data.newGame);
        // Atualiza GIROS ANTERIORES com dados DIRETO da API (espelho perfeito)
        updateRouletteHistoryFull(data.games);
        return;
    }

    // Primeira carga ou update sem jogo novo
    if (lastSyncGameId === null) {
        lastSyncGameId = newestId;
        initRoulette(data.games);
    }

    // Atualiza countdown com timing do bot
    if (rouletteState === 'waiting' && data.secondsToNext !== null && data.secondsToNext !== undefined) {
        updateCountdown(data.secondsToNext);
    }
}

function initRoulette(games) {
    if (!games || games.length === 0) return;
    const chrono = [...games].reverse();
    rouletteGames.length = 0;
    chrono.forEach(g => rouletteGames.push(g));
    renderRouletteStatic();
    setRouletteStatus('waiting');
    updateRouletteHistoryFull(games);
}
function renderRouletteStatic() {
    const track = document.getElementById('roulette-track');
    if (!track) return;
    const viewport = track.parentElement;
    const vpWidth = viewport ? viewport.offsetWidth : 800;
    const cardWidth = window.innerWidth <= 768 ? 78 : 98;
    let html = '';
    rouletteGames.forEach(g => html += createCardHTML(g));
    track.classList.add('no-transition');
    track.innerHTML = html;
    const lastIndex = rouletteGames.length - 1;
    const offset = lastIndex * cardWidth - vpWidth / 2 + cardWidth / 2;
    track.style.transform = `translateX(-${Math.max(0, offset)}px)`;
    requestAnimationFrame(() => track.classList.remove('no-transition'));
}
function spinRoulette(newGame) {
    rouletteState = 'spinning';
    setRouletteStatus('spinning');
    const track = document.getElementById('roulette-track');
    if (!track) return;
    const viewport = track.parentElement;
    const vpWidth = viewport ? viewport.offsetWidth : 800;
    const cardWidth = window.innerWidth <= 768 ? 78 : 98;
    const realBefore = rouletteGames.slice(-5);
    const spinCards = generateSpinCards(25);
    let html = '';
    realBefore.forEach(g => html += createCardHTML(g));
    spinCards.forEach(g => html += createCardHTML(g));
    html += createCardHTML(newGame);
    track.classList.add('no-transition');
    track.innerHTML = html;
    track.style.transform = `translateX(0px)`;
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            track.classList.remove('no-transition');
            const targetIndex = realBefore.length + spinCards.length;
            const offset = targetIndex * cardWidth - vpWidth / 2 + cardWidth / 2;
            track.style.transform = `translateX(-${offset}px)`;
        });
    });
    setTimeout(() => {
        rouletteState = 'result';
        const roll = parseInt(newGame.roll);
        setRouletteStatus('result', `Blaze Girou ${roll}!`);
        rouletteGames.push(newGame);
        if (rouletteGames.length > 20) rouletteGames.shift();
        setTimeout(() => {
            rouletteState = 'waiting';
            setRouletteStatus('waiting');
            renderRouletteStatic();
        }, 4000);
    }, 3500);
}
function setRouletteStatus(state, text) {
    const bar = document.getElementById('roulette-status-bar');
    const statusText = document.getElementById('roulette-status-text');
    const progress = document.getElementById('roulette-progress');
    if (!bar || !statusText || !progress) return;
    bar.className = 'roulette-status-bar';
    if (state === 'waiting') {
        statusText.textContent = 'Aguardando proximo giro...';
        progress.style.width = '0%';
    } else if (state === 'spinning') {
        bar.classList.add('spinning');
        statusText.textContent = 'Girando...';
        progress.style.width = '100%';
        stopCountdown();
    } else if (state === 'result') {
        bar.classList.add('result');
        statusText.textContent = text || 'Resultado!';
        progress.style.width = '0%';
        stopCountdown();
    }
}
// Countdown SINCRONIZADO com o ciclo da Blaze (recebe segundos restantes do bot)
function updateCountdown(secondsToNext) {
    stopCountdown();
    if (secondsToNext <= 0 || rouletteState !== 'waiting') return;
    let remaining = secondsToNext;
    const total = blazeCycleTime;
    const statusText = document.getElementById('roulette-status-text');
    const progress = document.getElementById('roulette-progress');
    // Atualiza imediatamente
    if (statusText) statusText.textContent = `Girando Em 00:${remaining.toString().padStart(2,'0')}`;
    if (progress) progress.style.width = ((total - remaining) / total * 100) + '%';
    // Continua contando localmente ate proximo sync
    countdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) { stopCountdown(); return; }
        if (statusText && rouletteState === 'waiting') statusText.textContent = `Girando Em 00:${remaining.toString().padStart(2,'0')}`;
        if (progress && rouletteState === 'waiting') progress.style.width = ((total - remaining) / total * 100) + '%';
    }, 1000);
}
function stopCountdown() { if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; } }

function updateRouletteHistoryFull(games) {
    const dots = document.getElementById('roulette-history-dots');
    if (!dots || !games) return;
    let html = '';
    games.forEach(g => {
        const roll = parseInt(g.roll);
        const cls = colorClasses[colorFromRoll(roll)] || 'white';
        const label = roll === 0 ? '&#10070;' : roll;
        html += `<span class="rh-dot ${cls}" title="${roll}">${label}</span>`;
    });
    dots.innerHTML = html;
}

// === WebSocket: recebe TUDO do bot ===
function connectWebSocket() {
    try {
        const wsPort = <?= json_encode(getenv('BOT_PORT') ?: '3001') ?>;
        const wsUrl = 'ws://' + window.location.hostname + ':' + wsPort;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            wsConnected = true;
            const indicator = document.getElementById('live-indicator');
            if (indicator) { indicator.textContent = 'SINCRONIZADO'; indicator.className = 'badge badge-live'; }
        };

        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);

                // SYNC principal - dados da API Blaze em tempo real
                if (msg.type === 'blaze_sync') {
                    handleBlazeSync(msg.data);
                }

                if (msg.type === 'signal') {
                    showActiveSignal(msg.data);
                }

                if (msg.type === 'analysis') {
                    if (msg.data.stats) updateAdminSignalStats(msg.data.stats);
                    if (msg.data.signals && msg.data.signals.length > 0) {
                        showActiveSignals(msg.data.signals);
                    }
                    refreshStrategyPanels();
                }

                if (msg.type === 'stats_update') {
                    if (msg.data.stats) updateAdminSignalStats(msg.data.stats);
                    refreshStrategyPanels();
                }
            } catch (e) {
                console.error('[WS] Erro:', e);
            }
        };

        ws.onclose = () => {
            wsConnected = false;
            const indicator = document.getElementById('live-indicator');
            if (indicator) { indicator.textContent = 'RECONECTANDO'; indicator.className = 'badge badge-yellow'; }
            setTimeout(connectWebSocket, 3000);
        };

        ws.onerror = () => ws.close();
    } catch (e) {
        setTimeout(connectWebSocket, 5000);
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
    const sorted = [...signals].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    showActiveSignal(sorted[0]);
}

function updateAdminSignalStats(stats) {
    const wins = parseInt(stats.wins) || 0;
    const losses = parseInt(stats.losses) || 0;
    const decided = wins + losses;
    const winRate = decided > 0 ? (wins / decided * 100).toFixed(1) : '0';
    updateStat('s-winRate', winRate + '%');
}

// === Polling: sinais ativos a cada 3s, admin stats a cada 5s ===
function refreshActiveSignal() {
    fetch('/api/active-signal.php')
        .then(r => r.json())
        .then(data => {
            const container = document.getElementById('active-signal-container');
            if (!container) return;

            if (data.active && data.active.length > 0) {
                const best = data.active[0];
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

    refreshStrategyPanels();
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

function updateStat(id, value) {
    const el = document.getElementById(id);
    if (el && el.textContent != value) {
        el.textContent = value;
        el.style.transition = 'color 0.3s';
        el.style.color = '#ff6a00';
        setTimeout(() => el.style.color = '', 1000);
    }
}

// Inicia tudo - dados vem DIRETO do bot via WebSocket (sincronizado com API Blaze)
connectWebSocket();

// Polling de sinal ativo a cada 3s (fallback)
setInterval(refreshActiveSignal, 3000);

// Polling admin stats a cada 10s (apenas stats, nao jogos)
setInterval(refreshAdmin, 10000);
</script>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
