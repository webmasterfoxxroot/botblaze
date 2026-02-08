<?php
// BotBlaze API - Bet history (list + record bets from Chrome extension)
require_once __DIR__ . '/config.php';

$user = validateToken();
$db = getDB();

// Require active subscription
$subscription = hasActiveSubscription($user['id']);
if (!$subscription) {
    jsonResponse(['error' => 'Assinatura ativa necessaria para acessar historico'], 403);
}

// ── GET: Return bet history + stats ──────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Last 100 bets
    $stmt = $db->prepare("
        SELECT id, game_id, color_bet, amount, result, profit, roll_result,
               was_martingale, martingale_level, created_at
        FROM bet_history
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 100
    ");
    $stmt->execute([$user['id']]);
    $bets = $stmt->fetchAll();

    // Format numeric fields
    foreach ($bets as &$bet) {
        $bet['id']               = (int) $bet['id'];
        $bet['color_bet']        = (int) $bet['color_bet'];
        $bet['amount']           = (float) $bet['amount'];
        $bet['profit']           = (float) $bet['profit'];
        $bet['roll_result']      = $bet['roll_result'] !== null ? (int) $bet['roll_result'] : null;
        $bet['was_martingale']   = (bool) $bet['was_martingale'];
        $bet['martingale_level'] = (int) $bet['martingale_level'];
    }
    unset($bet);

    // Aggregate stats (all time)
    $stmt = $db->prepare("
        SELECT
            COUNT(*)                                      AS total_bets,
            SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
            COALESCE(SUM(profit), 0)                      AS profit
        FROM bet_history
        WHERE user_id = ?
    ");
    $stmt->execute([$user['id']]);
    $stats = $stmt->fetch();

    // Today's stats
    $stmt = $db->prepare("
        SELECT
            COUNT(*)                                      AS total_bets,
            SUM(CASE WHEN result = 'win'  THEN 1 ELSE 0 END) AS wins,
            SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) AS losses,
            COALESCE(SUM(profit), 0)                      AS profit
        FROM bet_history
        WHERE user_id = ? AND DATE(created_at) = CURDATE()
    ");
    $stmt->execute([$user['id']]);
    $todayStats = $stmt->fetch();

    jsonResponse([
        'success' => true,
        'bets'    => $bets,
        'stats'   => [
            'total_bets' => (int) $stats['total_bets'],
            'wins'       => (int) $stats['wins'],
            'losses'     => (int) $stats['losses'],
            'profit'     => (float) $stats['profit'],
            'win_rate'   => $stats['total_bets'] > 0
                ? round(($stats['wins'] / $stats['total_bets']) * 100, 2)
                : 0,
        ],
        'today' => [
            'total_bets' => (int) $todayStats['total_bets'],
            'wins'       => (int) $todayStats['wins'],
            'losses'     => (int) $todayStats['losses'],
            'profit'     => (float) $todayStats['profit'],
        ],
    ]);
}

// ── POST: Record a new bet ───────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = getInput();

    // Required fields
    $gameId   = trim($input['game_id'] ?? '');
    $colorBet = $input['color_bet'] ?? null;
    $amount   = $input['amount'] ?? null;
    $result   = $input['result'] ?? '';
    $profit   = $input['profit'] ?? 0;

    // Optional fields
    $rollResult      = $input['roll_result'] ?? null;
    $wasMartingale   = !empty($input['was_martingale']) ? 1 : 0;
    $martingaleLevel = (int) ($input['martingale_level'] ?? 0);

    // Validation
    $errors = [];

    if (!$gameId) {
        $errors[] = 'game_id e obrigatorio';
    }

    if ($colorBet === null || !in_array((int) $colorBet, [0, 1, 2], true)) {
        $errors[] = 'color_bet deve ser 0 (branco), 1 (vermelho) ou 2 (preto)';
    }

    if ($amount === null || (float) $amount <= 0) {
        $errors[] = 'amount deve ser maior que 0';
    }

    if (!in_array($result, ['win', 'loss', 'pending'])) {
        $errors[] = 'result deve ser: win, loss ou pending';
    }

    if ($rollResult !== null && ((int) $rollResult < 0 || (int) $rollResult > 14)) {
        $errors[] = 'roll_result deve ser entre 0 e 14';
    }

    if ($martingaleLevel < 0 || $martingaleLevel > 10) {
        $errors[] = 'martingale_level deve ser entre 0 e 10';
    }

    if (!empty($errors)) {
        jsonResponse(['error' => 'Erros de validacao', 'details' => $errors], 400);
    }

    // Check daily bet limit
    $stmt = $db->prepare("
        SELECT us.max_bets_per_day, COUNT(bh.id) AS bets_today
        FROM user_settings us
        LEFT JOIN bet_history bh ON bh.user_id = us.user_id AND DATE(bh.created_at) = CURDATE()
        WHERE us.user_id = ?
        GROUP BY us.user_id
    ");
    $stmt->execute([$user['id']]);
    $limitCheck = $stmt->fetch();

    if ($limitCheck && $limitCheck['bets_today'] >= $limitCheck['max_bets_per_day']) {
        jsonResponse([
            'error'   => 'Limite diario de apostas atingido',
            'limit'   => (int) $limitCheck['max_bets_per_day'],
            'current' => (int) $limitCheck['bets_today'],
        ], 429);
    }

    // Insert bet
    $stmt = $db->prepare("
        INSERT INTO bet_history (user_id, game_id, color_bet, amount, result, profit, roll_result, was_martingale, martingale_level)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $user['id'],
        $gameId,
        (int) $colorBet,
        (float) $amount,
        $result,
        (float) $profit,
        $rollResult !== null ? (int) $rollResult : null,
        $wasMartingale,
        $martingaleLevel,
    ]);

    $betId = $db->lastInsertId();

    jsonResponse([
        'success' => true,
        'message' => 'Aposta registrada com sucesso',
        'bet' => [
            'id'               => (int) $betId,
            'game_id'          => $gameId,
            'color_bet'        => (int) $colorBet,
            'amount'           => (float) $amount,
            'result'           => $result,
            'profit'           => (float) $profit,
            'roll_result'      => $rollResult !== null ? (int) $rollResult : null,
            'was_martingale'   => (bool) $wasMartingale,
            'martingale_level' => $martingaleLevel,
        ],
    ], 201);
}

// Any other method
jsonResponse(['error' => 'Metodo nao permitido'], 405);
