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
        console.log('  BotBlaze Engine v5.0');
        console.log('  Sincronizado com Blaze API');
        console.log('  Auto-detect ciclo de jogo');
        console.log('=================================\n');

        await this.connectDB();
        await this.migrateDB();
        await this.loadSettings();

        const config = {
            apiUrl: this.getSetting('blaze_api_url', '') || process.env.BLAZE_API_URL || 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1',
            analysisWindow: this.getSetting('analysis_window', 50),
            signalConfidenceMin: this.getSetting('confidence_min', 55)
        };

        console.log(`[Config] API: ${config.apiUrl}`);
        console.log(`[Config] Intervalo: ${this.getSetting('collect_interval', 1)}s | Confianca: ${config.signalConfidenceMin}%\n`);

        this.collector = new DoubleCollector(this.db, config);
        this.analyzer = new DoubleAnalyzer(this.db, config);
        this.signals = new DoubleSignals(this.db, config);

        this.startWebSocket();

        // === SYNC: recebe estado completo do collector e envia para todos os dashboards ===
        this.collector.onSyncUpdate = (syncState) => {
            // Envia sync completo para todos os clientes
            this.broadcast({
                type: 'blaze_sync',
                data: syncState
            });
        };

        // === NOVO JOGO: analisa e gera sinal para o PROXIMO jogo ===
        this.collector.onNewGame = async (newGame) => {
            try {
                // 1. Verifica sinais pendentes (marca WIN/LOSS do sinal anterior)
                await this.signals.verifyLastSignals();

                // Checa se sinais estao ativos
                if (this.getSetting('signals_active', 1) === 0 || this.getSetting('bot_status', 'running') === 'paused') {
                    console.log('[Bot] Sinais pausados pelo admin');
                    return;
                }

                // 2. Analisa e gera sinal pro PROXIMO jogo
                //    O sinal e enviado AGORA (durante a fase de apostas do proximo jogo)
                const analysis = await this.analyzer.analyze();
                if (!analysis) return;

                const newSignals = await this.signals.generateSignals(analysis);
                const stats = await this.signals.getStats();
                const strategyStats = await this.signals.getStatsByStrategy();

                // 3. Envia sinais pros dashboards (chega ANTES do giro!)
                this.broadcast({
                    type: 'analysis',
                    data: { lastGame: analysis.lastGame, totalGames: analysis.totalGames, signals: newSignals, stats, strategyStats }
                });

                for (const signal of newSignals) {
                    this.broadcast({ type: 'signal', data: signal });
                }

                if (newSignals.length > 0) {
                    const secsToNext = this.collector.getSecondsToNext();
                    console.log(`[Bot] >>> SINAL ENVIADO! Aposte nos proximos ~${secsToNext}s antes do giro! <<<`);
                }
            } catch (err) {
                console.error('[Bot] Erro:', err.message);
            }
        };

        // Inicia coleta (le API, aprende ritmo, sincroniza)
        this.startCollector();

        // Verificacao backup a cada 10s
        setInterval(() => this.runVerification(), 10000);

        // Recarrega configuracoes do banco a cada 10s
        this.settingsTimer = setInterval(() => this.reloadSettings(), 10000);

        console.log('[Bot] Lendo API da Blaze e aprendendo o ritmo...\n');
    }

    async loadSettings() {
        try {
            const [rows] = await this.db.execute('SELECT setting_key, setting_value FROM bot_settings');
            this.liveConfig = {};
            for (const row of rows) {
                this.liveConfig[row.setting_key] = row.setting_value;
            }
        } catch (err) {
            console.log('[Config] Usando defaults');
        }
    }

    async reloadSettings() {
        const oldInterval = this.getSetting('collect_interval', 1);
        const oldApiUrl = this.getSetting('blaze_api_url', '');

        await this.loadSettings();

        const newInterval = this.getSetting('collect_interval', 1);
        const newApiUrl = this.getSetting('blaze_api_url', '');

        if (newInterval !== oldInterval) {
            console.log(`[Config] Intervalo: ${oldInterval}s -> ${newInterval}s`);
            this.collector.stop();
            this.collector.pollInterval = newInterval;
            this.startCollector();
        }

        if (newApiUrl && newApiUrl !== oldApiUrl) {
            console.log(`[Config] API URL: ${newApiUrl}`);
            this.collector.apiUrl = newApiUrl;
        }
    }

    getSetting(key, defaultVal) {
        const val = this.liveConfig[key];
        if (val === undefined || val === null || val === '') return defaultVal;
        if (typeof defaultVal === 'number') return parseInt(val) || defaultVal;
        return val;
    }

    startCollector() {
        const seconds = this.getSetting('collect_interval', 1);
        this.collector.stop();
        this.collector.pollInterval = seconds;
        console.log(`[Collector] Monitorando API a cada ${seconds}s...`);
        this.collector.collect();
        this.collector.timer = setInterval(() => this.collector.collect(), seconds * 1000);
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
            console.log('[DB] Conectado ao MySQL');
        } catch (err) {
            console.error('[DB] Erro:', err.message);
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
            }
        } catch (err) { }

        try {
            await this.db.execute(`
                CREATE TABLE IF NOT EXISTS bot_settings (
                    setting_key VARCHAR(50) PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                ) ENGINE=InnoDB
            `);

            const defaults = [
                ['collect_interval', '1'], ['confidence_min', '55'],
                ['strategy_sequences', '1'], ['strategy_frequency', '1'],
                ['strategy_martingale', '1'], ['strategy_ml_patterns', '1'],
                ['signals_active', '1'], ['max_signals_per_round', '4'],
                ['analysis_window', '50'], ['history_limit', '2000'],
                ['time_offset', '0'], ['bot_status', 'running'],
                ['blaze_api_url', '']
            ];
            for (const [k, v] of defaults) {
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
            ws.send(JSON.stringify({ type: 'connected', message: 'BotBlaze v5 sincronizado' }));

            // Envia estado atual imediatamente para novo cliente
            if (this.collector && this.collector.blazeGames.length > 0) {
                ws.send(JSON.stringify({
                    type: 'blaze_sync',
                    data: this.collector.buildSyncState(null)
                }));
            }
        });
        console.log(`[WS] Porta ${port}\n`);
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
