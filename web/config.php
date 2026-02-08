<?php
session_start();

// Database
define('DB_HOST', getenv('DB_HOST') ?: 'localhost');
define('DB_PORT', getenv('DB_PORT') ?: '3306');
define('DB_NAME', getenv('DB_NAME') ?: 'botblaze');
define('DB_USER', getenv('DB_USER') ?: 'root');
define('DB_PASS', getenv('DB_PASS') ?: 'Vidaloka2026@');

// App
define('APP_NAME', 'BotBlaze');
define('APP_VERSION', '1.0');
define('BOT_WS_PORT', getenv('BOT_PORT') ?: '3001');

// Planos
define('PLAN_DIARIO', 'diario');
define('PLAN_SEMANAL', 'semanal');
define('PLAN_MENSAL', 'mensal');
define('PLAN_VITALICIO', 'vitalicio');

// Timezone
date_default_timezone_set('America/Sao_Paulo');
