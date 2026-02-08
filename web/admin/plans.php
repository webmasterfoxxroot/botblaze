<?php
require_once __DIR__ . '/../includes/auth.php';
requireAdmin();

$db = getDB();

// Acoes
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    switch ($action) {
        case 'create':
            $name = trim($_POST['name'] ?? '');
            $slug = strtolower(preg_replace('/[^a-z0-9]/', '-', $name));
            $days = intval($_POST['duration_days'] ?? 30);
            $price = floatval($_POST['price'] ?? 0);

            if ($name && $price > 0) {
                $db->prepare("INSERT INTO plans (name, slug, duration_days, price) VALUES (?, ?, ?, ?)")
                   ->execute([$name, $slug, $days, $price]);
                $msg = 'Plano criado!';
            }
            break;

        case 'update':
            $planId = intval($_POST['plan_id'] ?? 0);
            $name = trim($_POST['name'] ?? '');
            $days = intval($_POST['duration_days'] ?? 30);
            $price = floatval($_POST['price'] ?? 0);
            $status = $_POST['status'] ?? 'active';

            if ($planId && $name && $price > 0) {
                $db->prepare("UPDATE plans SET name = ?, duration_days = ?, price = ?, status = ? WHERE id = ?")
                   ->execute([$name, $days, $price, $status, $planId]);
                $msg = 'Plano atualizado!';
            }
            break;

        case 'delete':
            $planId = intval($_POST['plan_id'] ?? 0);
            if ($planId) {
                // Verifica se tem assinantes
                $hasSubs = $db->prepare("SELECT COUNT(*) as c FROM subscriptions WHERE plan_id = ? AND status = 'active'");
                $hasSubs->execute([$planId]);
                if ($hasSubs->fetch()['c'] > 0) {
                    $error = 'Nao pode deletar: plano tem assinantes ativos.';
                } else {
                    $db->prepare("DELETE FROM plans WHERE id = ?")->execute([$planId]);
                    $msg = 'Plano removido.';
                }
            }
            break;
    }
}

$plans = $db->query("SELECT p.*, (SELECT COUNT(*) FROM subscriptions s WHERE s.plan_id = p.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > NOW())) as active_subs FROM plans p ORDER BY p.price")->fetchAll();

$pageTitle = 'Admin - Planos';
require_once __DIR__ . '/../includes/header.php';
?>

<div class="admin-plans">
    <div class="page-header">
        <h1 class="page-title">Gerenciar Planos</h1>
    </div>

    <?php if (!empty($msg)): ?>
        <div class="alert alert-success"><?= htmlspecialchars($msg) ?></div>
    <?php endif; ?>
    <?php if (!empty($error)): ?>
        <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
    <?php endif; ?>

    <div class="dashboard-grid">
        <!-- Lista de Planos -->
        <div class="panel">
            <div class="panel-header"><h2>Planos Existentes</h2></div>
            <div class="panel-body">
                <?php foreach ($plans as $plan): ?>
                <form method="POST" class="plan-edit-form">
                    <input type="hidden" name="action" value="update">
                    <input type="hidden" name="plan_id" value="<?= $plan['id'] ?>">
                    <div class="plan-edit-row">
                        <div class="form-group">
                            <label>Nome</label>
                            <input type="text" name="name" class="input" value="<?= htmlspecialchars($plan['name']) ?>">
                        </div>
                        <div class="form-group">
                            <label>Dias (0=vitalicio)</label>
                            <input type="number" name="duration_days" class="input" value="<?= $plan['duration_days'] ?>">
                        </div>
                        <div class="form-group">
                            <label>Preco (R$)</label>
                            <input type="number" name="price" step="0.01" class="input" value="<?= $plan['price'] ?>">
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select name="status" class="input">
                                <option value="active" <?= $plan['status'] === 'active' ? 'selected' : '' ?>>Ativo</option>
                                <option value="inactive" <?= $plan['status'] === 'inactive' ? 'selected' : '' ?>>Inativo</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Assinantes</label>
                            <span class="badge badge-blue"><?= $plan['active_subs'] ?></span>
                        </div>
                        <div class="form-group form-actions">
                            <button type="submit" class="btn btn-sm btn-primary">Salvar</button>
                        </div>
                    </div>
                </form>
                <form method="POST" style="display:inline">
                    <input type="hidden" name="action" value="delete">
                    <input type="hidden" name="plan_id" value="<?= $plan['id'] ?>">
                    <button type="submit" class="btn btn-sm btn-danger"
                            onclick="return confirm('Deletar este plano?')">Deletar</button>
                </form>
                <hr class="divider">
                <?php endforeach; ?>
            </div>
        </div>

        <!-- Novo Plano -->
        <div class="panel">
            <div class="panel-header"><h2>Criar Novo Plano</h2></div>
            <div class="panel-body">
                <form method="POST" class="action-form">
                    <input type="hidden" name="action" value="create">
                    <div class="form-group">
                        <label>Nome do Plano</label>
                        <input type="text" name="name" class="input" placeholder="Ex: Quinzenal" required>
                    </div>
                    <div class="form-group">
                        <label>Duracao em dias (0 = Vitalicio)</label>
                        <input type="number" name="duration_days" class="input" value="30" required>
                    </div>
                    <div class="form-group">
                        <label>Preco (R$)</label>
                        <input type="number" name="price" step="0.01" class="input" placeholder="49.90" required>
                    </div>
                    <button type="submit" class="btn btn-primary btn-full">Criar Plano</button>
                </form>
            </div>
        </div>
    </div>
</div>

<?php require_once __DIR__ . '/../includes/footer.php'; ?>
