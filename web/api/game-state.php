<?php
require_once __DIR__ . '/../includes/auth.php';
header('Content-Type: application/json');

if (!isLoggedIn()) {
    http_response_code(401);
    echo json_encode(['error' => 'Nao autorizado']);
    exit;
}

$db = getDB();

// Carrega time_offset do admin
$timeOffset = 0;
try {
    $row = $db->prepare("SELECT setting_value FROM bot_settings WHERE setting_key = 'time_offset'");
    $row->execute();
    $r = $row->fetch();
    if ($r) $timeOffset = (int)$r['setting_value'];
} catch (Exception $e) {}

// Ultimos 20 jogos para o carousel
$games = $db->query("
    SELECT game_id, color, roll, played_at
    FROM game_history_double
    ORDER BY played_at DESC
    LIMIT 20
")->fetchAll();

// Ultimo jogo (para detectar se e novo)
$lastGame = !empty($games) ? $games[0] : null;

// Tempo desde ultimo jogo (com offset)
$secondsSince = null;
if ($lastGame) {
    $playedAt = new DateTime($lastGame['played_at']);
    $now = new DateTime();
    $secondsSince = $now->getTimestamp() - $playedAt->getTimestamp() + $timeOffset;
    if ($secondsSince < 0) $secondsSince = 0;
}

// Estimar estado do jogo baseado no tempo
// Blaze Double ciclo: ~25s aposta + ~10s girando + resultado
$state = 'waiting';
if ($secondsSince !== null) {
    $cycle = 35; // ciclo total aproximado em segundos
    $posInCycle = $secondsSince % $cycle;

    if ($posInCycle < 5) {
        $state = 'result';
    } elseif ($posInCycle > 25) {
        $state = 'spinning';
    } else {
        $state = 'waiting';
    }
}

echo json_encode([
    'games' => $games,
    'lastGame' => $lastGame,
    'secondsSince' => $secondsSince,
    'state' => $state,
    'timeOffset' => $timeOffset,
    'timestamp' => date('Y-m-d H:i:s')
]);
