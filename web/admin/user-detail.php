<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$db = getDB();
$userId = intval($_GET['id'] ?? 0);

if (!$userId) {
    header('Location: /admin/users.php');
    exit;
}

// Acoes POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    switch ($action) {
        case 'add_balance':
            $amount = floatval($_POST['amount'] ?? 0);
            $desc = trim($_POST['description'] ?? 'Ajuste admin');
            if ($amount != 0) {
                $db->prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
                   ->execute([$amount, $userId]);
                $type = $amount > 0 ? 'deposit' : 'withdraw';
                $db->prepare("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)")
                   ->execute([$userId, $type, abs($amount), $desc]);
                $msg = "Saldo atualizado: " . ($amount > 0 ? '+' : '') . "R$ " . number_format($amount, 2, ',', '.');
            }
            break;

        case 'add_bet':
            $betAmount = floatval($_POST['bet_amount'] ?? 0);
            $betResult = $_POST['bet_result'] ?? 'pending';
            $betProfit = floatval($_POST['bet_profit'] ?? 0);
            if ($betAmount > 0) {
                $db->prepare("INSERT INTO user_bets (user_id, game_type, amount, result, profit) VALUES (?, 'double', ?, ?, ?)")
                   ->execute([$userId, $betAmount, $betResult, $betProfit]);
                $msg = 'Aposta registrada.';
            }
            break;

        case 'block':
            $db->prepare("UPDATE users SET status = 'blocked' WHERE id = ? AND role != 'admin'")
               ->execute([$userId]);
            $msg = 'Usuario bloqueado.';
            break;

        case 'unblock':
            $db->prepare("UPDATE users SET status = 'active' WHERE id = ?")
               ->execute([$userId]);
            $msg = 'Usuario desbloqueado.';
            break;
    }
}

// Dados do usuario
$user = $db->prepare("SELECT * FROM users WHERE id = ?");
$user->execute([$userId]);
$user = $user->fetch();

if (!$user) {
    header('Location: /admin/users.php');
    exit;
}

// Assinatura
$subscription = hasActiveSubscription($userId);

// Historico de assinaturas
$subHistory = $db->prepare("
    SELECT s.*, p.name as plan_name, p.price
    FROM subscriptions s JOIN plans p ON s.plan_id = p.id
    WHERE s.user_id = ? ORDER BY s.created_at DESC
");
$subHistory->execute([$userId]);
$subHistory = $subHistory->fetchAll();

// Apostas/Resultados
$bets = $db->prepare("
    SELECT ub.*, s.predicted_color, s.confidence
    FROM user_bets ub
    LEFT JOIN signals s ON ub.signal_id = s.id
    WHERE ub.user_id = ? ORDER BY ub.created_at DESC LIMIT 50
");
$bets->execute([$userId]);
$bets = $bets->fetchAll();

// Resumo financeiro
$betStats = $db->prepare("
    SELECT
        COUNT(*) as total_bets,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN result = 'loss' THEN 1 ELSE 0 END) as losses,
        COALESCE(SUM(CASE WHEN result = 'win' THEN profit ELSE 0 END), 0) as total_wins,
        COALESCE(SUM(CASE WHEN result = 'loss' THEN amount ELSE 0 END), 0) as total_losses,
        COALESCE(SUM(profit), 0) as net_profit
    FROM user_bets WHERE user_id = ?
");
$betStats->execute([$userId]);
$betStats = $betStats->fetch();

// Transacoes
$transactions = $db->prepare("SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT 20");
$transactions->execute([$userId]);
$transactions = $transactions->fetchAll();

$pageTitle = "Admin - " . $user['name'];
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-user-detail">
    <div class="page-header">
        <a href="/admin/users.php" class="btn btn-sm btn-outline">&larr; Voltar</a>
        <h1 class="page-title"><?= htmlspecialchars($user['name']) ?></h1>
    </div>

    <?php if (!empty($msg)): ?>
        <div class="alert alert-success"><?= htmlspecialchars($msg) ?></div>
    <?php endif; ?>

    <!-- Info do Usuario -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-label">Email</div>
            <div class="stat-value-sm"><?= htmlspecialchars($user['email']) ?></div>
        </div>
        <div class="stat-card <?= $user['status'] === 'active' ? 'stat-green' : 'stat-red' ?>">
            <div class="stat-label">Status</div>
            <div class="stat-value"><?= $user['status'] === 'active' ? 'ATIVO' : 'BLOQUEADO' ?></div>
        </div>
        <div class="stat-card stat-gold">
            <div class="stat-label">Saldo</div>
            <div class="stat-value">R$ <?= number_format($user['balance'], 2, ',', '.') ?></div>
        </div>
        <div class="stat-card <?= $subscription ? 'stat-blue' : 'stat-red' ?>">
            <div class="stat-label">Plano</div>
            <div class="stat-value-sm">
                <?= $subscription ? htmlspecialchars($subscription['plan_name']) : 'Sem plano' ?>
            </div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Cadastro</div>
            <div class="stat-value-sm"><?= date('d/m/Y H:i', strtotime($user['created_at'])) ?></div>
        </div>
    </div>

    <!-- Performance -->
    <div class="stats-grid">
        <div class="stat-card">
            <div class="stat-value"><?= $betStats['total_bets'] ?></div>
            <div class="stat-label">Total Apostas</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value"><?= $betStats['wins'] ?></div>
            <div class="stat-label">Wins</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value"><?= $betStats['losses'] ?></div>
            <div class="stat-label">Losses</div>
        </div>
        <div class="stat-card stat-green">
            <div class="stat-value">R$ <?= number_format($betStats['total_wins'], 2, ',', '.') ?></div>
            <div class="stat-label">Ganhos</div>
        </div>
        <div class="stat-card stat-red">
            <div class="stat-value">R$ <?= number_format($betStats['total_losses'], 2, ',', '.') ?></div>
            <div class="stat-label">Perdas</div>
        </div>
        <div class="stat-card <?= $betStats['net_profit'] >= 0 ? 'stat-green' : 'stat-red' ?>">
            <div class="stat-value">R$ <?= number_format($betStats['net_profit'], 2, ',', '.') ?></div>
            <div class="stat-label">Lucro Liquido</div>
        </div>
    </div>

    <div class="dashboard-grid">
        <!-- Acoes -->
        <div class="panel">
            <div class="panel-header"><h2>Acoes</h2></div>
            <div class="panel-body">
                <!-- Bloquear/Desbloquear -->
                <form method="POST" class="action-form">
                    <?php if ($user['status'] === 'active'): ?>
                        <input type="hidden" name="action" value="block">
                        <button type="submit" class="btn btn-danger btn-full"
                                onclick="return confirm('Bloquear este usuario?')">Bloquear Usuario</button>
                    <?php else: ?>
                        <input type="hidden" name="action" value="unblock">
                        <button type="submit" class="btn btn-success btn-full">Desbloquear Usuario</button>
                    <?php endif; ?>
                </form>

                <hr class="divider">

                <!-- Ajustar Saldo -->
                <h3>Ajustar Saldo</h3>
                <form method="POST" class="action-form">
                    <input type="hidden" name="action" value="add_balance">
                    <div class="form-group">
                        <label>Valor (negativo = remover)</label>
                        <input type="number" name="amount" step="0.01" class="input" placeholder="Ex: 50.00 ou -20.00" required>
                    </div>
                    <div class="form-group">
                        <label>Descricao</label>
                        <input type="text" name="description" class="input" placeholder="Motivo do ajuste" value="Ajuste admin">
                    </div>
                    <button type="submit" class="btn btn-primary btn-full">Atualizar Saldo</button>
                </form>

                <hr class="divider">

                <!-- Registrar Aposta -->
                <h3>Registrar Aposta</h3>
                <form method="POST" class="action-form">
                    <input type="hidden" name="action" value="add_bet">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Valor</label>
                            <input type="number" name="bet_amount" step="0.01" class="input" required>
                        </div>
                        <div class="form-group">
                            <label>Resultado</label>
                            <select name="bet_result" class="input">
                                <option value="win">Win</option>
                                <option value="loss">Loss</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Lucro/Perda</label>
                            <input type="number" name="bet_profit" step="0.01" class="input">
                        </div>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full">Registrar</button>
                </form>
            </div>
        </div>

        <!-- Historico -->
        <div class="panel">
            <div class="panel-header"><h2>Historico de Assinaturas</h2></div>
            <div class="panel-body">
                <table class="table">
                    <thead>
                        <tr><th>Plano</th><th>Preco</th><th>Status</th><th>Inicio</th><th>Expira</th></tr>
                    </thead>
                    <tbody>
                        <?php foreach ($subHistory as $sub): ?>
                        <tr>
                            <td><?= htmlspecialchars($sub['plan_name']) ?></td>
                            <td>R$ <?= number_format($sub['price'], 2, ',', '.') ?></td>
                            <td>
                                <span class="badge <?= $sub['status'] === 'active' ? 'badge-green' : 'badge-gray' ?>">
                                    <?= ucfirst($sub['status']) ?>
                                </span>
                            </td>
                            <td><?= date('d/m/Y', strtotime($sub['starts_at'])) ?></td>
                            <td><?= $sub['expires_at'] ? date('d/m/Y', strtotime($sub['expires_at'])) : 'Vitalicio' ?></td>
                        </tr>
                        <?php endforeach; ?>
                        <?php if (empty($subHistory)): ?>
                            <tr><td colspan="5" class="text-muted">Nenhuma assinatura</td></tr>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>

            <div class="panel-header"><h2>Transacoes</h2></div>
            <div class="panel-body">
                <table class="table">
                    <thead>
                        <tr><th>Tipo</th><th>Valor</th><th>Descricao</th><th>Data</th></tr>
                    </thead>
                    <tbody>
                        <?php foreach ($transactions as $t): ?>
                        <tr>
                            <td>
                                <span class="badge <?= in_array($t['type'], ['deposit', 'bonus']) ? 'badge-green' : 'badge-red' ?>">
                                    <?= ucfirst($t['type']) ?>
                                </span>
                            </td>
                            <td>R$ <?= number_format($t['amount'], 2, ',', '.') ?></td>
                            <td><?= htmlspecialchars($t['description'] ?? '') ?></td>
                            <td><?= date('d/m/Y H:i', strtotime($t['created_at'])) ?></td>
                        </tr>
                        <?php endforeach; ?>
                        <?php if (empty($transactions)): ?>
                            <tr><td colspan="4" class="text-muted">Nenhuma transacao</td></tr>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
