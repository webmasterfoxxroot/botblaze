<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Nao autorizado']);
    exit;
}

if (!hasActiveSubscription()) {
    http_response_code(403);
    echo json_encode(['error' => 'Sem assinatura ativa']);
    exit;
}

$db = getDB();
$type = $_GET['type'] ?? 'double';

// Stats geral
$stats = $db->prepare("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
    FROM signals WHERE game_type = ? AND result != 'pending'
");
$stats->execute([$type]);
$stats = $stats->fetch();

// Stats e sinais por estrategia
$strategies = ['sequences', 'frequency', 'martingale', 'ml-patterns'];
$strategyNames = [
    'sequences' => 'Sequencias',
    'frequency' => 'Frequencia',
    'martingale' => 'Martingale',
    'ml-patterns' => 'ML Patterns'
];

$strategyData = [];
foreach ($strategies as $strat) {
    $st = $db->prepare("
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses
        FROM signals WHERE game_type = ? AND strategy_used = ? AND result != 'pending'
    ");
    $st->execute([$type, $strat]);
    $st = $st->fetch();

    $signals = $db->prepare("
        SELECT * FROM signals WHERE game_type = ? AND strategy_used = ?
        ORDER BY created_at DESC LIMIT 8
    ");
    $signals->execute([$type, $strat]);
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

echo json_encode([
    'stats' => $stats,
    'strategies' => $strategyData
]);
