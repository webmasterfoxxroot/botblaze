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
$limit = min(intval($_GET['limit'] ?? 20), 100);

// Ultimos sinais
$stmt = $db->prepare("
    SELECT * FROM signals
    WHERE game_type = ?
    ORDER BY created_at DESC
    LIMIT ?
");
$stmt->bindValue(1, $type, PDO::PARAM_STR);
$stmt->bindValue(2, $limit, PDO::PARAM_INT);
$stmt->execute();
$signals = $stmt->fetchAll();

// Stats
$stats = $db->prepare("
    SELECT
        COUNT(*) as total,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
        AVG(confidence) as avg_confidence
    FROM signals WHERE game_type = ? AND result != 'pending'
");
$stats->execute([$type]);
$stats = $stats->fetch();

echo json_encode([
    'signals' => $signals,
    'stats' => $stats
]);
