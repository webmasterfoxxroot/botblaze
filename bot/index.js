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
    }

    async start() {
        console.log('=================================');
        console.log('  BotBlaze Engine v2.0');
        console.log('  Double Game - Tempo Real');
        console.log('=================================\n');

        await this.connectDB();
        await this.migrateDB();

        const config = {
            apiUrl: process.env.BLAZE_API_URL || 'https://blaze.bet.br/api/singleplayer-originals/originals/roulette_games/recent/1',
            analysisWindow: parseInt(process.env.ANALYSIS_WINDOW) || 50,
            signalConfidenceMin: parseInt(process.env.SIGNAL_CONFIDENCE_MIN) || 65
        };

        this.collector = new DoubleCollector(this.db, config);
        this.analyzer = new DoubleAnalyzer(this.db, config);
        this.signals = new DoubleSignals(this.db, config);

        this.startWebSocket();

        // EVENTO: quando detecta jogo novo, analisa IMEDIATAMENTE
        this.collector.onNewGame = async (newGame) => {
            try {
                // 1. Verifica sinais pendentes (marca WIN/LOSS do sinal anterior)
                await this.signals.verifyLastSignals();

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

        // Inicia monitoramento da API (polling a cada 5s)
        this.collector.start();

        // Verificacao backup a cada 10s (caso o evento nao pegue)
        setInterval(() => this.runVerification(), 10000);

        console.log('[Bot] Aguardando jogos...\n');
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
        console.log('[DB] Schema OK\n');
    }

    startWebSocket() {
        const port = parseInt(process.env.BOT_PORT) || 3001;
        this.wss = new WebSocketServer({ port });
        this.wss.on('connection', (ws) => {
            ws.send(JSON.stringify({ type: 'connected', message: 'BotBlaze v2 conectado' }));
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
