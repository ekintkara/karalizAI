document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('analysisForm');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const logContainer = document.getElementById('logContainer');
    const logMessages = document.getElementById('logMessages');
    const openaiResponseContainer = document.getElementById('openaiResponseContainer');
    const openaiResponseLoadingText = document.getElementById('openaiResponseLoadingText');
    const cancelButton = document.getElementById('cancelAnalysis');
    const loadingStatus = document.createElement('div');
    loadingStatus.classList.add('loading-status');
    
    let eventSource;

    function updateLoadingStatus(message) {
        loadingStatus.textContent = message;
        if (!loadingStatus.parentElement) {
            document.querySelector('.loading-container').insertBefore(loadingStatus, document.querySelector('.spinner'));
        }
    }

    function clearLoadingStatus() {
        if (loadingStatus.parentElement) {
            loadingStatus.parentElement.removeChild(loadingStatus);
        }
    }

    function addLogMessage(message, type = 'default') {
        const logEntry = document.createElement('div');
        logEntry.classList.add('log-entry', `log-${type}`);
        
        try {
            const parsedMessage = typeof message === 'string' 
                ? JSON.parse(message) 
                : message;
            
            logEntry.textContent = typeof parsedMessage === 'object'
                ? JSON.stringify(parsedMessage, null, 2)
                : parsedMessage;
        } catch {
            logEntry.textContent = message;
        }

        logContainer.classList.remove('hidden');
        logMessages.appendChild(logEntry);
        
        logMessages.scrollTop = logMessages.scrollHeight;
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();

        loadingOverlay.classList.remove('hidden');
        
        logMessages.innerHTML = ''; 
        logContainer.classList.add('hidden');
        
        openaiResponseContainer.classList.add('hidden');
        clearLoadingStatus();

        updateLoadingStatus('Starting vehicle analysis...');

        const formData = new FormData(form);

        const apiKey = formData.get('apiKey');
        const links = formData.get('links');
        const llmType = formData.get('llmType');
        function createEventSource() {
            console.log('Attempting to create EventSource');
            
            eventSource = new EventSource(`/analyze-stream?apiKey=${encodeURIComponent(apiKey)}&links=${encodeURIComponent(links)}&llmType=${encodeURIComponent(llmType)}`, {
                withCredentials: false
              });

            eventSource.onopen = (event) => {
                console.log('EventSource connection opened successfully');
                addLogMessage('Analysis connection established', 'success');
            };

            eventSource.addEventListener('log', (event) => {
                console.log('Received log event');
                try {
                    const logEntry = JSON.parse(event.data);
                    console.log('Log entry:', logEntry);
                    
                    const logType = logEntry.level || 
                        (logEntry.message && logEntry.message.includes('error') ? 'error' : 
                        (logEntry.message && logEntry.message.includes('warning') ? 'warning' : 'default'));
                    
                    addLogMessage(logEntry.message || logEntry, logType);
                } catch (parseError) {
                    console.error('Error parsing log entry:', parseError);
                    addLogMessage(event.data, 'error');
                }
            });

            eventSource.addEventListener('analysis_stage', (event) => {
                console.log('Received analysis stage event');
                try {
                    const stageData = JSON.parse(event.data);
                    console.log('Stage data:', stageData);
                    updateLoadingStatus(stageData.message);
                    addLogMessage(stageData.message, 'info');
                } catch (parseError) {
                    console.error('Error parsing stage data:', parseError);
                }
            });

            eventSource.addEventListener('heartbeat', (event) => {
                console.log('Received heartbeat:', event.data);
                addLogMessage('Heartbeat received', 'info');
            });

            eventSource.addEventListener('complete', (event) => {
                console.log('Received complete event');
                eventSource.close();
                loadingOverlay.classList.add('hidden');
                addLogMessage('Analysis completed', 'success');
            });

            eventSource.addEventListener('results', (event) => {
                try {
                    const scrapedResults = JSON.parse(event.data);
                    console.log('Parsed Scraped Results:', JSON.stringify(scrapedResults, null, 2));
                    window.scrapedResults = scrapedResults;
                } catch (parseError) {
                    console.error('Error parsing results:', parseError);
                }
            });

            eventSource.addEventListener('openai_response', (event) => {
                try {
                    const openaiResponse = JSON.parse(event.data);
                    console.log('Parsed OpenAI Response:', JSON.stringify(openaiResponse, null, 2));
                    window.openaiResponse = openaiResponse;
                } catch (parseError) {
                    console.error('Error parsing OpenAI response:', parseError);
                }
            });

            eventSource.addEventListener('openai_results', (event) => {
                try {
                    const { results, openaiResponse } = JSON.parse(event.data);
                    console.log('Parsed OpenAI Results:', JSON.stringify({ results, openaiResponse }, null, 2));
                    
                    window.scrapedResults = results;
                    window.openaiResponse = openaiResponse;

                    if (window.displayAnalysisResults) {
                        const summary = openaiResponse.summary || 
                                        openaiResponse.text || 
                                        JSON.stringify(openaiResponse);
                        
                        console.log('OpenAI Response Details:', {
                            fullResponse: openaiResponse,
                            summaryType: typeof summary,
                            summaryLength: summary ? summary.length : 0
                        });

                        window.displayAnalysisResults(summary, results);
                    }
                } catch (parseError) {
                    console.error('Error parsing OpenAI results:', parseError);
                }
            });

            eventSource.addEventListener('error', (event) => {
                console.error('EventSource failed with full error object:', event);
                
                console.error('Error details:', {
                    type: event.type,
                    target: event.target,
                    isTrusted: event.isTrusted,
                    bubbles: event.bubbles,
                    cancelable: event.cancelable
                });

                eventSource.close();
                loadingOverlay.classList.add('hidden');
                
                updateLoadingStatus('An error occurred during analysis');
                addLogMessage('Analysis failed', 'error');

                setTimeout(createEventSource, 5000);
            });

            return eventSource;
        }

        createEventSource();
    });

    cancelButton.addEventListener('click', () => {
        if (eventSource) {
            eventSource.close();
        }
        loadingOverlay.classList.add('hidden');
    });
});
