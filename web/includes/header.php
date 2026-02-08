<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title><?= $pageTitle ?? 'BotBlaze' ?></title>
    <link rel="stylesheet" href="/assets/css/style.css">
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
</head>
<body>
    <nav class="navbar">
        <div class="nav-brand">
            <span class="logo">🔥</span>
            <span class="brand-name">BotBlaze</span>
        </div>
        <?php if (isLoggedIn()): ?>
        <div class="nav-links">
            <?php if (isAdmin()): ?>
                <a href="/admin/" class="nav-link">Admin</a>
                <a href="/admin/users.php" class="nav-link">Usuarios</a>
                <a href="/admin/plans.php" class="nav-link">Planos</a>
            <?php endif; ?>
            <a href="/dashboard.php" class="nav-link">Dashboard</a>
            <div class="nav-user">
                <span class="user-name"><?= htmlspecialchars($_SESSION['user_name']) ?></span>
                <a href="/logout.php" class="btn btn-sm btn-outline">Sair</a>
            </div>
        </div>
        <?php endif; ?>
    </nav>
    <main class="container">
