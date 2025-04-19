const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const validator = require('validator');
const fs = require('fs');
const { EventEmitter } = require('events');

const app = express();

// Set the view engine to EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(bodyParser.urlencoded({ 
    extended: true,
    limit: '50mb',
    parameterLimit: 1000000
}));
app.use(bodyParser.json({
    limit: '50mb'
}));
app.use('/karalizai/', express.static(path.join(__dirname, 'public')));
// Logging function
function logTransaction(type, details) {
    const logEntry = { 
        type,
        ...details
    };

    console.log(JSON.stringify(logEntry, null, 2));

    // Write to a log file
    try {
        const logFilePath = path.join(__dirname, 'transaction.log');
        fs.appendFileSync(logFilePath, JSON.stringify(logEntry) + '\n', 'utf8');
    } catch (error) {
        console.error('Error writing to log file:', error);
    }

    return logEntry;
}

// Routes
app.get('/', (req, res) => {
    logTransaction('page_view', { 
        page: 'index', 
        ip: req.ip 
    });
    res.render('index');
});

app.get('/analyze-stream', (req, res) => {
    console.log("Request Query:", req.query);
    
    const { apiKey, sharedUrl, llmType } = req.query;

    if (!sharedUrl) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Paylaşılan URL parametresi eksik" })}\n\n`);
        res.end();
        return;
    }
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-open'
    });

    const logEmitter = new EventEmitter();

    const originalLogTransaction = logTransaction;
    global.logTransaction = (type, details) => {
        const logEntry = originalLogTransaction(type, details);
        logEmitter.emit('log', logEntry);
        return logEntry;
    };

    // Capture OpenAI response
    const originalConsoleLog = console.log;
    console.log = (message) => {
        try {
            const parsedMessage = JSON.parse(message);
            if (parsedMessage.type === 'openai_response') {
                res.write(`event: openai_response\ndata: ${JSON.stringify(parsedMessage)}\n\n`);
            } else if (parsedMessage.type === 'analysis_log') {
                const logMessage = Object.values(parsedMessage).join('');
                res.write(`event: log\ndata: ${JSON.stringify({ type: 'log', data: logMessage })}\n\n`);
            }
        } catch (error) {
            originalConsoleLog(message);
        }
    };

    // Listen for log events and send them to the client
    logEmitter.on('log', (logEntry) => {
        res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
    });

    // Validate URL
    if (!validator.isURL(sharedUrl, {
        protocols: ['http', 'https'],
        require_protocol: true
    })) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Geçersiz URL formatı' })}\n\n`);
        res.end();
        return;
    }

    // Start analysis in a separate process
    const { fork } = require('child_process');
    const analysisProcess = fork(path.join(__dirname, 'success.js'), [apiKey, llmType, sharedUrl]);

    analysisProcess.on('message', (message) => {
        if (message.type === 'log') {
            res.write(`event: log\ndata: ${JSON.stringify(message.data)}\n\n`);
        } else if (message.type === 'openai_response') {
            res.write(`event: openai_response\ndata: ${JSON.stringify(message.data)}\n\n`);
        }
    });

    analysisProcess.on('close', (code) => {
        res.write(`event: complete\ndata: ${JSON.stringify({ status: code === 0 ? 'success' : 'error' })}\n\n`);
        res.end();

        // Restore original logging
        global.logTransaction = originalLogTransaction;
        console.log = originalConsoleLog;
    });

    // Handle client disconnect
    req.on('close', () => {
        analysisProcess.kill();
    });
});

app.get('/results.json', (req, res) => {
    const resultsFilePath = path.join(__dirname, 'results.json');
    
    try {
        const results = fs.readFileSync(resultsFilePath, 'utf8');
        res.json(JSON.parse(results));
    } catch (error) {
        logTransaction('results_json_error', {
            error: error.message
        });
        res.status(404).json({ error: 'Results not found' });
    }
});

app.post('/analyze', (req, res) => {
    console.log('Request Body:', req.body);

    const apiKey = req.body.apiKey ? req.body.apiKey.trim() : '';
    const sharedUrl = req.body.sharedUrl ? req.body.sharedUrl.trim() : '';
    const llmType = req.body.llmType || 'gpt-4o';
    
    logTransaction('analyze_request', { 
        apiKeyProvided: !!apiKey, 
        sharedUrlProvided: !!sharedUrl,
        llmType,
        clientIp: req.ip 
    });
    
    if (!apiKey || !sharedUrl) {
        logTransaction('validation_error', { 
            error: 'Missing required parameters', 
            missingApiKey: !apiKey,
            missingSharedUrl: !sharedUrl,
            clientIp: req.ip 
        });
        return res.status(400).render('index', { 
            error: 'Lütfen API Key ve Paylaşılan URL bilgilerini giriniz.' 
        });
    }

    if (!validator.isURL(sharedUrl, {
        protocols: ['http', 'https'],
        require_protocol: true
    })) {
        logTransaction('validation_error', { 
            error: 'Invalid URL', 
            invalidUrl: sharedUrl,
            clientIp: req.ip 
        });
        return res.status(400).render('index', { 
            error: 'Geçersiz URL formatı' 
        });
    }

    const { fork } = require('child_process');
    const analysisProcess = fork(path.join(__dirname, 'success.js'), [apiKey, llmType, sharedUrl]);

    analysisProcess.on('message', (message) => {
        if (message.type === 'log') {
            logTransaction('analysis_log', message.data);
        } else if (message.type === 'openai_response') {
            logTransaction('openai_response', message.data);
        }
    });

    analysisProcess.on('close', (code) => {
        logTransaction('analysis_complete', { status: code === 0 ? 'success' : 'error' });
    });

    res.send('Analiz başlatıldı. Konsolu kontrol ediniz.');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log("Server is running on port ${PORT}");
    logTransaction('server_start', { port: PORT });
});