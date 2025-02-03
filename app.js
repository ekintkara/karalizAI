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
    
    const { apiKey, links, llmType } = req.query;

    if (!links) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: "Links parameter is missing" })}\n\n`);
        res.end();
        return;
    }

    const parsedLinks = links.split(',').map(link => link.trim());

    // Set headers for Server-Sent Events
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-open'
    });

    // Create a custom event emitter for logging
    const logEmitter = new EventEmitter();

    // Capture and forward logs
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
            }
        } catch (error) {
            originalConsoleLog(message);
        }
    };

    // Listen for log events and send them to the client
    logEmitter.on('log', (logEntry) => {
        res.write(`event: log\ndata: ${JSON.stringify(logEntry)}\n\n`);
    });

    // Validate inputs
    const invalidLinks = parsedLinks.filter(link => !validator.isURL(link, {
        protocols: ['http', 'https'],
        require_protocol: true
    }));

    if (invalidLinks.length > 0) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'Invalid URLs', invalidLinks })}\n\n`);
        res.end();
        return;
    }

    // Start analysis in a separate process
    const { fork } = require('child_process');
    const analysisProcess = fork(path.join(__dirname, 'success.js'), [apiKey, llmType, ...parsedLinks]);

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
    // Log entire request body for debugging
    console.log('Request Body:', req.body);

    const apiKey = req.body.apiKey ? req.body.apiKey.trim() : '';
    const linksInput = req.body.links || '';
    const llmType = req.body.llmType || 'gpt-4o'; // Default to 'gpt-4o' if not provided
    
    // Log incoming request
    logTransaction('analyze_request', { 
        apiKeyProvided: !!apiKey, 
        linksProvided: !!linksInput,
        llmType,
        clientIp: req.ip 
    });
    
    // Validate inputs
    if (!apiKey || !linksInput) {
        logTransaction('validation_error', { 
            error: 'Missing required parameters', 
            missingApiKey: !apiKey,
            missingLinks: !linksInput,
            clientIp: req.ip 
        });
        return res.status(400).render('index', { 
            error: 'Please provide API Key, Vehicle Links, and LLM Type.' 
        });
    }

    // Split and clean links
    const links = linksInput.split(',').map(link => link.trim()).filter(link => link);
    
    // Validate Links
    const invalidLinks = links.filter(link => !validator.isURL(link, {
        protocols: ['http', 'https'],
        require_protocol: true
    }));

    if (invalidLinks.length > 0) {
        logTransaction('validation_error', { 
            error: 'Invalid URLs', 
            invalidLinks,
            clientIp: req.ip 
        });
        return res.status(400).render('index', { 
            error: `Invalid URL(s): ${invalidLinks.join(', ')}` 
        });
    }

    // Start analysis in a separate process
    const { fork } = require('child_process');
    const analysisProcess = fork(path.join(__dirname, 'success.js'), [apiKey, llmType, ...links]);

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

    res.send('Analysis started. Check the console for updates.');
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log("Server is running on port ${PORT}");
    logTransaction('server_start', { port: PORT });
});