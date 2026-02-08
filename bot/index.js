require('dotenv').config({ path: '../.env' });
const mysql = require('mysql2/promise');
const { WebSocketServer } = require('ws');

const DoubleCollector = require('./games/double/collector');
const DoubleAnalyzer = require('./games/double/analyzer');
const DoubleSignals = require('./games/double/signals');

class BotBlaze {
    constructor() {
        this.db = null;
        this.wss = null;
        this.collector = null;
        this.analyzer = null;
        this.signals = null;
        this.liveConfig = {};
        this.settingsTimer = null;
    }

    async start() {
        console.log('=================================');
        console.log('  BotBlaze Engine v4.0');
        console.log('  Double Game - Tempo Real');
        console.log('  WebSocket + HTTP Polling');
        console.log('  Config via Painel Admin');
        console.log('=================================\n');

        await this.connectDB();
        await this.migrateDB();

        // Carrega configuracoes do banco (admin ajusta em tempo real)
        await this.loadSettings();

        const config = {
            apiUrl: this.getSetting('blaze_api_url', '') || process.env.BLAZE_API_URL || 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1',
            analysisWindow: this.getSetting('analysis_window', 50),
            signalConfidenceMin: this.getSetting('confidence_min', 55)
        };

        console.log(`[Config] Intervalo: ${this.getSetting('collect_interval', 3)}s | Confianca: ${config.signalConfidenceMin}% | Janela: ${config.analysisWindow}`);

        this.collector = new DoubleCollector(this.db, config);
        this.analyzer = new DoubleAnalyzer(this.db, config);
        this.signals = new DoubleSignals(this.db, config);

        this.startWebSocket();

        // EVENTO: quando detecta jogo novo, analisa IMEDIATAMENTE
        this.collector.onNewGame = async (newGame) => {
            try {
                // 0. Envia evento de novo jogo IMEDIATAMENTE (para animacao no dashboard)
                this.broadcast({
                    type: 'new_game',
                    data: { game: newGame, timestamp: new Date().toISOString() }
                });

                // 1. Verifica sinais pendentes (marca WIN/LOSS do sinal anterior)
                await this.signals.verifyLastSignals();

                // Checa se geracao de sinais esta ativa
                if (this.getSetting('signals_active', 1) === 0 || this.getSetting('bot_status', 'running') === 'paused') {
                    console.log('[Bot] Sinais pausados pelo admin');
                    return;
                }

                // 2. Analisa e gera sinal pro PROXIMO jogo
                const analysis = await this.analyzer.analyze();
                if (!analysis) return;

                const newSignals = await this.signals.generateSignals(analysis);
                const stats = await this.signals.getStats();
                const strategyStats = await this.signals.getStatsByStrategy();

                // 3. Envia pros dashboards
                this.broadcast({
                    type: 'analysis',
                    data: { lastGame: analysis.lastGame, totalGames: analysis.totalGames, signals: newSignals, stats, strategyStats }
                });

                for (const signal of newSignals) {
                    this.broadcast({ type: 'signal', data: signal });
                }

                if (newSignals.length > 0) {
                    console.log(`[Bot] >>> SINAL ENVIADO - Aposte AGORA na proxima rodada! <<<`);
                }
            } catch (err) {
                console.error('[Bot] Erro:', err.message);
            }
        };

        // EVENTO: fase do jogo mudou (waiting/rolling/complete) - via WS da Blaze
        this.collector.onGamePhase = (event) => {
            this.broadcast({
                type: 'game_phase',
                data: {
                    phase: event.phase,
                    timestamp: event.timestamp.toISOString()
                }
            });
        };

        // Inicia conexao WebSocket com a Blaze (tempo real)
        const blazeWsUrl = this.getSetting('blaze_ws_url', '') || process.env.BLAZE_WS_URL || '';
        if (blazeWsUrl) {
            console.log(`[Bot] Conectando ao WebSocket da Blaze: ${blazeWsUrl}`);
            this.collector.startStream(blazeWsUrl);
        } else {
            console.log('[Bot] WS da Blaze nao configurado. Configure em Admin > Config > URL WebSocket Blaze');
        }

        // Inicia HTTP polling (sempre ativo como fallback)
        this.startCollector();

        // Verificacao backup a cada 10s
        setInterval(() => this.runVerification(), 10000);

        // Recarrega configuracoes do banco a cada 10s
        this.settingsTimer = setInterval(() => this.reloadSettings(), 10000);

        // Envia status do collector a cada 5s
        setInterval(() => this.broadcastCollectorStatus(), 5000);

        console.log('[Bot] Aguardando jogos...\n');
    }

    // Carrega configs do banco de dados
    async loadSettings() {
        try {
            const [rows] = await this.db.execute('SELECT setting_key, setting_value FROM bot_settings');
            this.liveConfig = {};
            for (const row of rows) {
                this.liveConfig[row.setting_key] = row.setting_value;
            }
        } catch (err) {
            console.log('[Config] Usando defaults (tabela bot_settings nao encontrada)');
        }
    }

    // Recarrega e aplica mudancas do admin
    async reloadSettings() {
        const oldInterval = this.getSetting('collect_interval', 3);
        const oldConfidence = this.getSetting('confidence_min', 55);
        const oldAnalysisWindow = this.getSetting('analysis_window', 50);
        const oldHistoryLimit = this.getSetting('history_limit', 2000);
        const oldApiUrl = this.getSetting('blaze_api_url', '');
        const oldWsUrl = this.getSetting('blaze_ws_url', '');

        await this.loadSettings();

        const newInterval = this.getSetting('collect_interval', 3);
        const newConfidence = this.getSetting('confidence_min', 55);
        const newAnalysisWindow = this.getSetting('analysis_window', 50);
        const newHistoryLimit = this.getSetting('history_limit', 2000);
        const newApiUrl = this.getSetting('blaze_api_url', '');
        const newWsUrl = this.getSetting('blaze_ws_url', '');

        // Intervalo de coleta mudou?
        if (newInterval !== oldInterval) {
            console.log(`[Config] Intervalo alterado: ${oldInterval}s -> ${newInterval}s`);
            this.collector.stop();
            this.collector.pollInterval = newInterval;
            this.startCollector();
        }

        // Confianca mudou?
        if (newConfidence !== oldConfidence) {
            console.log(`[Config] Confianca alterada: ${oldConfidence}% -> ${newConfidence}%`);
            this.analyzer.minConfidence = newConfidence;
            this.signals.minConfidence = newConfidence;
        }

        // Janela de analise mudou?
        if (newAnalysisWindow !== oldAnalysisWindow) {
            console.log(`[Config] Janela analise: ${oldAnalysisWindow} -> ${newAnalysisWindow}`);
        }

        // Limite de historico mudou?
        if (newHistoryLimit !== oldHistoryLimit) {
            console.log(`[Config] Limite historico: ${oldHistoryLimit} -> ${newHistoryLimit}`);
        }

        // API URL mudou?
        if (newApiUrl && newApiUrl !== oldApiUrl) {
            console.log(`[Config] API URL alterada para: ${newApiUrl}`);
            this.collector.apiUrl = newApiUrl;
        }

        // WS URL mudou?
        if (newWsUrl !== oldWsUrl) {
            if (newWsUrl) {
                console.log(`[Config] WS URL alterada para: ${newWsUrl}`);
                if (this.collector.stream) {
                    this.collector.stream.updateUrl(newWsUrl);
                } else {
                    this.collector.startStream(newWsUrl);
                }
            } else if (this.collector.stream) {
                console.log(`[Config] WS URL removida, desconectando stream`);
                this.collector.stopStream();
            }
        }
    }

    getSetting(key, defaultVal) {
        const val = this.liveConfig[key];
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof defaultVal === 'number') return parseInt(val) || defaultVal;
        return val;
    }

    startCollector() {
        const seconds = this.getSetting('collect_interval', 3);
        const intervalMs = seconds * 1000;
        this.collector.stop();
        console.log(`[Collector] Monitorando API a cada ${seconds}s...`);
        this.collector.collect();
        this.collector.timer = setInterval(() => this.collector.collect(), intervalMs);
    }

    broadcastCollectorStatus() {
        if (!this.collector) return;
        const status = this.collector.getStatus();
        this.broadcast({
            type: 'collector_status',
            data: status
        });
    }

    async connectDB() {
        try {
            this.db = await mysql.createPool({
                host: process.env.DB_HOST || 'localhost',
                port: parseInt(process.env.DB_PORT) || 3306,
                user: process.env.DB_USER || 'root',
                password: process.env.DB_PASS || '',
                database: process.env.DB_NAME || 'botblaze',
                waitForConnections: true,
                connectionLimit: 10,
                charset: 'utf8mb4'
            });
            await this.db.execute('SELECT 1');
            console.log('[DB] Conectado ao MySQL com sucesso');
        } catch (err) {
            console.error('[DB] Erro ao conectar:', err.message);
            process.exit(1);
        }
    }

    async migrateDB() {
        try {
            const [cols] = await this.db.execute(
                `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'signals' AND COLUMN_NAME = 'ref_game_db_id'`,
                [process.env.DB_NAME || 'botblaze']
            );
            if (cols.length === 0) {
                await this.db.execute('ALTER TABLE signals ADD COLUMN ref_game_db_id INT NULL');
                console.log('[DB] Coluna ref_game_db_id adicionada');
            }
        } catch (err) { }

        // Cria tabela de configuracoes se nao existir
        try {
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS bot_settings (
                    setting_key VARCHAR(50) PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB
            `);

            // Insere defaults se tabela vazia
            const [count] = await this.db.execute('SELECT COUNT(*) as c FROM bot_settings');
            if (count[0].c === 0) {
                const defaults = [
                    ['collect_interval', '3'], ['confidence_min', '55'],
                    ['strategy_sequences', '1'], ['strategy_frequency', '1'],
                    ['strategy_martingale', '1'], ['strategy_ml_patterns', '1'],
                    ['signals_active', '1'], ['max_signals_per_round', '4'],
                    ['analysis_window', '50'], ['history_limit', '2000'],
                    ['time_offset', '0'], ['bot_status', 'running'],
                    ['blaze_api_url', ''], ['blaze_ws_url', '']
                ];
                for (const [k, v] of defaults) {
                    await this.db.execute(
                        'INSERT IGNORE INTO bot_settings (setting_key, setting_value) VALUES (?, ?)', [k, v]
                    );
                }
                console.log('[DB] Configuracoes padrao criadas');
            }

            // Adiciona novas settings se nao existem
            const newSettings = [['blaze_api_url', ''], ['blaze_ws_url', '']];
            for (const [k, v] of newSettings) {
                await this.db.execute(
                    'INSERT IGNORE INTO bot_settings (setting_key, setting_value) VALUES (?, ?)', [k, v]
                );
            }
        } catch (err) { }

        console.log('[DB] Schema OK\n');
    }

    startWebSocket() {
        const port = parseInt(process.env.BOT_PORT) || 3001;
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', async (ws) => {
            ws.send(JSON.stringify({ type: 'connected', message: 'BotBlaze v4 conectado' }));

            // Envia ultimos jogos para o carousel do dashboard
            try {
                const [recentGames] = await this.db.execute(
                    'SELECT game_id, color, roll, played_at FROM game_history_double ORDER BY played_at DESC LIMIT 20'
                );
                ws.send(JSON.stringify({ type: 'recent_games', data: { games: recentGames } }));
            } catch (e) {}

            // Envia status do collector
            if (this.collector) {
                ws.send(JSON.stringify({ type: 'collector_status', data: this.collector.getStatus() }));
            }
        });
        console.log(`[WS] WebSocket porta ${port}\n`);
    }

    broadcast(data) {
        if (!this.wss) return;
        const msg = JSON.stringify(data);
        this.wss.clients.forEach(c => { if (c.readyState === 1) c.send(msg); });
    }

    async runVerification() {
        try {
            const verified = await this.signals.verifyLastSignals();
            if (verified > 0) {
                const stats = await this.signals.getStats();
                const strategyStats = await this.signals.getStatsByStrategy();
                this.broadcast({ type: 'stats_update', data: { stats, strategyStats } });
            }
        } catch (err) { }
    }
}

const bot = new BotBlaze();
bot.start().catch(err => {
    console.error('Erro fatal:', err);
    process.exit(1);
});
