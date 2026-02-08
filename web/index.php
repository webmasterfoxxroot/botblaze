<?php
require_once __DIR__ . '/includes/auth.php';

// Se ja esta logado, redireciona
if (isLoggedIn()) {
    header('Location: ' . (isAdmin() ? '/admin/' : '/dashboard.php'));
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';

    if (empty($email) || empty($password)) {
        $error = 'Preencha todos os campos';
    } else {
        $result = loginUser($email, $password);
        if ($result['success']) {
            header('Location: ' . (isAdmin() ? '/admin/' : '/dashboard.php'));
            exit;
        } else {
            $error = $result['error'];
        }
    }
}

if (isset($_GET['error'])) {
    if ($_GET['error'] === 'blocked') $error = 'Sua conta foi bloqueada.';
}
if (isset($_GET['registered'])) {
    $success = 'Conta criada com sucesso! Faca login.';
}
if (isset($_GET['logout'])) {
    $success = 'Voce saiu da conta.';
}

$pageTitle = 'BotBlaze - Login';
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $pageTitle ?></title>
    <link rel="stylesheet" href="/assets/css/style.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body class="auth-page">
    <div class="auth-container">
        <div class="auth-box">
            <div class="auth-header">
                <span class="logo-big">🔥</span>
                <h1>BotBlaze</h1>
                <p>Sistema de Sinais Inteligente</p>
            </div>

            <?php if (!empty($error)): ?>
                <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>
            <?php if (!empty($success)): ?>
                <div class="alert alert-success"><?= htmlspecialchars($success) ?></div>
            <?php endif; ?>

            <form method="POST" class="auth-form">
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="email" required placeholder="seu@email.com"
                           value="<?= htmlspecialchars($email ?? '') ?>">
                </div>
                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" name="password" required placeholder="Sua senha">
                </div>
                <button type="submit" class="btn btn-primary btn-full">Entrar</button>
            </form>

            <div class="auth-footer">
                <p>Nao tem conta? <a href="/register.php">Criar conta</a></p>
            </div>
        </div>
    </div>
</body>
</html>
