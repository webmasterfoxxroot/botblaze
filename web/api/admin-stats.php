<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isAdmin()) {
    http_response_code(403);
    echo json_encode(['error' => 'Acesso negado']);
    exit;
}

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

// Sinais
$signalStats = $db->query("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
    FROM signals WHERE game_type = 'double'
")->fetch();

$decided = $signalStats['wins'] + $signalStats['losses'];
$winRate = $decided > 0 ? round(($signalStats['wins'] / $decided) * 100, 1) : 0;

// Ultimos sinais
$signals = $db->query("
    SELECT * FROM signals WHERE game_type = 'double'
    ORDER BY created_at DESC LIMIT 10
")->fetchAll();

$colorNames = [0 => 'Branco', 1 => 'Vermelho', 2 => 'Preto'];
$colorEmojis = [0 => '⚪', 1 => '🔴', 2 => '⬛'];

$signalList = [];
foreach ($signals as $s) {
    $signalList[] = [
        'color' => $s['predicted_color'],
        'color_name' => $colorNames[$s['predicted_color']] ?? '?',
        'color_emoji' => $colorEmojis[$s['predicted_color']] ?? '?',
        'confidence' => round($s['confidence']),
        'strategy' => $s['strategy_used'],
        'result' => $s['result'],
        'time' => date('H:i:s', strtotime($s['created_at']))
    ];
}

echo json_encode([
    'stats' => [
        'totalUsers' => (int)$totalUsers,
        'activeUsers' => (int)$activeUsers,
        'blockedUsers' => (int)$blockedUsers,
        'activeSubs' => (int)$activeSubs,
        'revenue' => number_format($revenue, 2, ',', '.'),
        'totalGames' => (int)$totalGames,
        'signalsTotal' => (int)$signalStats['total'],
        'wins' => (int)$signalStats['wins'],
        'losses' => (int)$signalStats['losses'],
        'winRate' => $winRate
    ],
    'signals' => $signalList
]);
