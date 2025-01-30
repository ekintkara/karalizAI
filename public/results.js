document.addEventListener('DOMContentLoaded', () => {
    const resultsOverlay = document.getElementById('resultsOverlay');
    const openaiResponseText = document.getElementById('openaiResponseResultsText');
    const scrapedResultsText = document.getElementById('scrapedResultsText');
    const closeResultsBtn = document.getElementById('closeResults');

    function displayResults(openaiResponse, scrapedResults) {
        console.log('Displaying results:', { openaiResponse, scrapedResults });

        openaiResponseText.innerHTML = '';
        scrapedResultsText.textContent = '';

        let responseText = '';
        try {
            if (typeof openaiResponse === 'string') {
                responseText = openaiResponse;
            } else if (openaiResponse && openaiResponse.summary) {
                responseText = openaiResponse.summary;
            } else if (openaiResponse && openaiResponse.text) {
                responseText = openaiResponse.text;
            } else {
                responseText = JSON.stringify(openaiResponse, null, 2);
            }

            openaiResponseText.innerHTML = responseText 
                ? responseText.replace(/\n/g, '<br>')
                : 'No analysis available';

            console.log('OpenAI Response Processing:', {
                responseType: typeof openaiResponse,
                responseLength: responseText.length,
                displayedText: openaiResponseText.innerHTML
            });
        } catch (error) {
            console.error('Error processing OpenAI response:', error);
            openaiResponseText.innerHTML = 'Error displaying analysis';
        }

        scrapedResultsText.textContent = JSON.stringify(scrapedResults, null, 2);

        resultsOverlay.classList.remove('hidden');

        console.log('Displayed OpenAI Response Text:', openaiResponseText.innerHTML);
    }

    closeResultsBtn.addEventListener('click', () => {
        resultsOverlay.classList.add('hidden');
    });

    window.displayAnalysisResults = displayResults;
});
