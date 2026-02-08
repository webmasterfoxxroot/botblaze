<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$db = getDB();

// Acoes
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';
    $userId = intval($_POST['user_id'] ?? 0);

    if ($userId > 0) {
        switch ($action) {
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
            case 'delete':
                $db->prepare("DELETE FROM users WHERE id = ? AND role != 'admin'")
                   ->execute([$userId]);
                $msg = 'Usuario removido.';
                break;
            case 'add_balance':
                $amount = floatval($_POST['amount'] ?? 0);
                if ($amount != 0) {
                    $db->prepare("UPDATE users SET balance = balance + ? WHERE id = ?")
                       ->execute([$amount, $userId]);
                    $type = $amount > 0 ? 'deposit' : 'withdraw';
                    $db->prepare("INSERT INTO transactions (user_id, type, amount, description) VALUES (?, ?, ?, ?)")
                       ->execute([$userId, $type, abs($amount), 'Ajuste manual pelo admin']);
                    $msg = 'Saldo atualizado.';
                }
                break;
            case 'activate_plan':
                $planId = intval($_POST['plan_id'] ?? 0);
                if ($planId > 0) {
                    $plan = $db->prepare("SELECT * FROM plans WHERE id = ?")->execute([$planId]);
                    $plan = $db->prepare("SELECT * FROM plans WHERE id = ?");
                    $plan->execute([$planId]);
                    $plan = $plan->fetch();

                    if ($plan) {
                        // Cancela assinatura anterior
                        $db->prepare("UPDATE subscriptions SET status = 'cancelled' WHERE user_id = ? AND status = 'active'")
                           ->execute([$userId]);

                        // Cria nova assinatura
                        $expiresAt = null;
                        if ($plan['duration_days'] > 0) {
                            $expiresAt = date('Y-m-d H:i:s', strtotime("+{$plan['duration_days']} days"));
                        }

                        $stmt = $db->prepare(
                            "INSERT INTO subscriptions (user_id, plan_id, expires_at) VALUES (?, ?, ?)"
                        );
                        $stmt->execute([$userId, $planId, $expiresAt]);
                        $msg = 'Plano ativado com sucesso!';
                    }
                }
                break;
        }
    }
}

// Busca
$search = trim($_GET['search'] ?? '');
$filter = $_GET['filter'] ?? 'all';

$where = "WHERE u.role = 'user'";
$params = [];

if ($search) {
    $where .= " AND (u.name LIKE ? OR u.email LIKE ?)";
    $params[] = "%$search%";
    $params[] = "%$search%";
}
if ($filter === 'active') $where .= " AND u.status = 'active'";
if ($filter === 'blocked') $where .= " AND u.status = 'blocked'";
if ($filter === 'subscribed') {
    $where .= " AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW()))";
}

$stmt = $db->prepare("
    SELECT u.*,
        (SELECT p.name FROM subscriptions s JOIN plans p ON s.plan_id = p.id
         WHERE s.user_id = u.id AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.created_at DESC LIMIT 1) as plan_name,
        (SELECT s.expires_at FROM subscriptions s
         WHERE s.user_id = u.id AND s.status = 'active'
         AND (s.expires_at IS NULL OR s.expires_at > NOW())
         ORDER BY s.created_at DESC LIMIT 1) as plan_expires,
        (SELECT COALESCE(SUM(CASE WHEN ub.result = 'win' THEN ub.profit ELSE -ub.amount END), 0)
         FROM user_bets ub WHERE ub.user_id = u.id) as total_profit
    FROM users u
    $where
    ORDER BY u.created_at DESC
");
$stmt->execute($params);
$users = $stmt->fetchAll();

$plans = $db->query("SELECT * FROM plans WHERE status = 'active' ORDER BY price")->fetchAll();

$pageTitle = 'Admin - Usuarios';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-users">
    <div class="page-header">
        <h1 class="page-title">Gerenciar Usuarios</h1>
        <span class="text-muted"><?= count($users) ?> usuarios</span>
    </div>

    <?php if (!empty($msg)): ?>
        <div class="alert alert-success"><?= htmlspecialchars($msg) ?></div>
    <?php endif; ?>

    <!-- Filtros -->
    <div class="filters">
        <form method="GET" class="filter-form">
            <input type="text" name="search" placeholder="Buscar por nome ou email..."
                   value="<?= htmlspecialchars($search) ?>" class="input">
            <select name="filter" class="input">
                <option value="all" <?= $filter === 'all' ? 'selected' : '' ?>>Todos</option>
                <option value="active" <?= $filter === 'active' ? 'selected' : '' ?>>Ativos</option>
                <option value="blocked" <?= $filter === 'blocked' ? 'selected' : '' ?>>Bloqueados</option>
                <option value="subscribed" <?= $filter === 'subscribed' ? 'selected' : '' ?>>Com Plano</option>
            </select>
            <button type="submit" class="btn btn-primary">Filtrar</button>
        </form>
    </div>

    <!-- Tabela -->
    <div class="panel">
        <div class="panel-body">
            <table class="table">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Nome</th>
                        <th>Email</th>
                        <th>Status</th>
                        <th>Plano</th>
                        <th>Saldo</th>
                        <th>Lucro/Perda</th>
                        <th>Cadastro</th>
                        <th>Acoes</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($users as $u): ?>
                    <tr>
                        <td>#<?= $u['id'] ?></td>
                        <td><strong><?= htmlspecialchars($u['name']) ?></strong></td>
                        <td><?= htmlspecialchars($u['email']) ?></td>
                        <td>
                            <span class="badge <?= $u['status'] === 'active' ? 'badge-green' : 'badge-red' ?>">
                                <?= $u['status'] === 'active' ? 'Ativo' : 'Bloqueado' ?>
                            </span>
                        </td>
                        <td>
                            <?php if ($u['plan_name']): ?>
                                <span class="badge badge-blue"><?= htmlspecialchars($u['plan_name']) ?></span>
                                <?php if ($u['plan_expires']): ?>
                                    <br><small>Ate <?= date('d/m/Y', strtotime($u['plan_expires'])) ?></small>
                                <?php else: ?>
                                    <br><small>Vitalicio</small>
                                <?php endif; ?>
                            <?php else: ?>
                                <span class="badge badge-gray">Sem plano</span>
                            <?php endif; ?>
                        </td>
                        <td>R$ <?= number_format($u['balance'], 2, ',', '.') ?></td>
                        <td class="<?= $u['total_profit'] >= 0 ? 'text-green' : 'text-red' ?>">
                            R$ <?= number_format($u['total_profit'], 2, ',', '.') ?>
                        </td>
                        <td><?= date('d/m/Y', strtotime($u['created_at'])) ?></td>
                        <td class="actions">
                            <a href="/admin/user-detail.php?id=<?= $u['id'] ?>" class="btn btn-sm btn-outline">Ver</a>

                            <!-- Bloquear/Desbloquear -->
                            <form method="POST" style="display:inline">
                                <input type="hidden" name="user_id" value="<?= $u['id'] ?>">
                                <?php if ($u['status'] === 'active'): ?>
                                    <input type="hidden" name="action" value="block">
                                    <button type="submit" class="btn btn-sm btn-danger"
                                            onclick="return confirm('Bloquear este usuario?')">Bloquear</button>
                                <?php else: ?>
                                    <input type="hidden" name="action" value="unblock">
                                    <button type="submit" class="btn btn-sm btn-success">Desbloquear</button>
                                <?php endif; ?>
                            </form>

                            <!-- Ativar Plano -->
                            <form method="POST" style="display:inline" class="inline-form">
                                <input type="hidden" name="user_id" value="<?= $u['id'] ?>">
                                <input type="hidden" name="action" value="activate_plan">
                                <select name="plan_id" class="input input-sm">
                                    <option value="">Plano...</option>
                                    <?php foreach ($plans as $p): ?>
                                        <option value="<?= $p['id'] ?>"><?= $p['name'] ?> - R$<?= number_format($p['price'], 2, ',', '.') ?></option>
                                    <?php endforeach; ?>
                                </select>
                                <button type="submit" class="btn btn-sm btn-primary">Ativar</button>
                            </form>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
