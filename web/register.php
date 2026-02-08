<?php
require_once __DIR__ . '/includes/auth.php';

if (isLoggedIn()) {
    header('Location: /dashboard.php');
    exit;
}

$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $name = trim($_POST['name'] ?? '');
    $email = trim($_POST['email'] ?? '');
    $password = $_POST['password'] ?? '';
    $confirm = $_POST['confirm_password'] ?? '';

    if (empty($name) || empty($email) || empty($password)) {
        $error = 'Preencha todos os campos';
    } elseif (strlen($password) < 6) {
        $error = 'A senha deve ter no minimo 6 caracteres';
    } elseif ($password !== $confirm) {
        $error = 'As senhas nao coincidem';
    } else {
        $result = registerUser($name, $email, $password);
        if ($result['success']) {
            header('Location: /dashboard.php');
            exit;
        } else {
            $error = $result['error'];
        }
    }
}

$pageTitle = 'BotBlaze - Criar Conta';
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
                <p>Crie sua conta</p>
            </div>

            <?php if (!empty($error)): ?>
                <div class="alert alert-error"><?= htmlspecialchars($error) ?></div>
            <?php endif; ?>

            <form method="POST" class="auth-form">
                <div class="form-group">
                    <label>Nome</label>
                    <input type="text" name="name" required placeholder="Seu nome"
                           value="<?= htmlspecialchars($name ?? '') ?>">
                </div>
                <div class="form-group">
                    <label>Email</label>
                    <input type="email" name="email" required placeholder="seu@email.com"
                           value="<?= htmlspecialchars($email ?? '') ?>">
                </div>
                <div class="form-group">
                    <label>Senha</label>
                    <input type="password" name="password" required placeholder="Minimo 6 caracteres">
                </div>
                <div class="form-group">
                    <label>Confirmar Senha</label>
                    <input type="password" name="confirm_password" required placeholder="Repita a senha">
                </div>
                <button type="submit" class="btn btn-primary btn-full">Criar Conta</button>
            </form>

            <div class="auth-footer">
                <p>Ja tem conta? <a href="/index.php">Fazer login</a></p>
            </div>
        </div>
    </div>
</body>
</html>
