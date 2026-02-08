<?php
require_once __DIR__ . '/includes/auth.php';
requireLogin();

$db = getDB();
$plans = $db->query("SELECT * FROM plans WHERE status = 'active' ORDER BY price ASC")->fetchAll();
$subscription = hasActiveSubscription();

$pageTitle = 'BotBlaze - Planos';
require_once __DIR__ . '/includes/header.php';
?>

<div class="plans-page">
    <h1 class="page-title">Escolha seu Plano</h1>
    <p class="page-subtitle">Acesso aos sinais inteligentes do BotBlaze</p>

    <?php if ($subscription): ?>
    <div class="alert alert-success">
        Voce tem o plano <strong><?= htmlspecialchars($subscription['plan_name']) ?></strong> ativo
        <?php if ($subscription['expires_at']): ?>
            ate <strong><?= date('d/m/Y H:i', strtotime($subscription['expires_at'])) ?></strong>
        <?php else: ?>
            (Vitalicio)
        <?php endif; ?>
    </div>
    <?php endif; ?>

    <div class="plans-grid">
        <?php foreach ($plans as $plan): ?>
        <div class="plan-card <?= $plan['slug'] === 'vitalicio' ? 'plan-featured' : '' ?>">
            <?php if ($plan['slug'] === 'vitalicio'): ?>
                <div class="plan-badge">MELHOR CUSTO</div>
            <?php endif; ?>
            <h3 class="plan-name"><?= htmlspecialchars($plan['name']) ?></h3>
            <div class="plan-price">
                <span class="currency">R$</span>
                <span class="amount"><?= number_format($plan['price'], 2, ',', '.') ?></span>
            </div>
            <div class="plan-duration">
                <?php
                switch ($plan['duration_days']) {
                    case 1: echo 'Acesso por 24 horas'; break;
                    case 7: echo 'Acesso por 7 dias'; break;
                    case 30: echo 'Acesso por 30 dias'; break;
                    case 0: echo 'Acesso para sempre'; break;
                    default: echo "Acesso por {$plan['duration_days']} dias";
                }
                ?>
            </div>
            <ul class="plan-features">
                <li>Sinais em tempo real</li>
                <li>Todas as estrategias</li>
                <li>Historico completo</li>
                <?php if ($plan['slug'] === 'vitalicio'): ?>
                    <li>Atualizacoes futuras</li>
                    <li>Suporte prioritario</li>
                <?php endif; ?>
            </ul>
            <button class="btn btn-primary btn-full"
                    onclick="alert('Contate o admin para ativar seu plano.\nPagamento via PIX ou Mercado Pago.')">
                Assinar
            </button>
        </div>
        <?php endforeach; ?>
    </div>
</div>

<?php require_once __DIR__ . '/includes/footer.php'; ?>
