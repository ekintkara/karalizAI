document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('analysisForm');
    const apiKeyInput = document.getElementById('apiKey');
    const linksInput = document.getElementById('links');
    const apiKeyError = document.getElementById('apiKeyError');
    const linksError = document.getElementById('linksError');

    // // API Key validation
    // apiKeyInput.addEventListener('input', () => {
    //     const apiKeyPattern = /^sk-/;
    //     if (!apiKeyPattern.test(apiKeyInput.value)) {
    //         apiKeyError.textContent = 'Invalid API Key. Must start with "sk-".';
    //         apiKeyInput.setCustomValidity('Invalid API Key');
    //     } else {
    //         apiKeyError.textContent = '';
    //         apiKeyInput.setCustomValidity('');
    //     }
    // });

    linksInput.addEventListener('input', () => {
        const links = linksInput.value.split(',').map(link => link.trim());
        const urlPattern = /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
        
        const invalidLinks = links.filter(link => !urlPattern.test(link));
        
        if (invalidLinks.length > 0) {
            linksError.textContent = `Invalid URL(s): ${invalidLinks.join(', ')}`;
            linksInput.setCustomValidity('Invalid URLs');
        } else {
            linksError.textContent = '';
            linksInput.setCustomValidity('');
        }
    });

    form.addEventListener('submit', (event) => {
        if (!apiKeyInput.checkValidity() || !linksInput.checkValidity()) {
            event.preventDefault();
            return;
        }

        event.preventDefault();

        const formData = new FormData(form);
        const apiKey = formData.get('apiKey');
        const links = formData.get('links');

        console.log('Submitting form with:', { apiKey, links });

        fetch('/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'text/event-stream'
            },
            body: JSON.stringify({
                apiKey: apiKey,
                links: links
            })
        })
        .then(response => {
            if (!response.ok) {
                return response.text().then(text => {
                    throw new Error(text);
                });
            }
            return response.text();
        })
        .then(result => {
            console.log('Analysis started:', result);
        })
        .catch(error => {
            console.error('Analysis submission error:', error);
            alert('Error starting analysis: ' + error.message);
        });
    });
});
