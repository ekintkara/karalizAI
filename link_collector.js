const axios = require('axios');
const cheerio = require('cheerio');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const initCycleTLS = require('cycletls');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

// HTML temizleme fonksiyonu
function cleanHtml(html) {
    // Escape karakterlerini düzelt
    let cleanedHtml = html
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r');

    // Script taglerini temizle
    cleanedHtml = cleanedHtml.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

    // Gereksiz HTML commentlerini temizle
    cleanedHtml = cleanedHtml.replace(/<!--\[if[^>]*>(.*?)<!\[endif\]-->/gi, '');
    
    // Boş satırları temizle
    cleanedHtml = cleanedHtml.replace(/^\s*[\r\n]/gm, '');

    return cleanedHtml;
}

async function resolveShortenedUrl(url) {
    try {
        // İlk adım: shbd.io URL'sini çözümle
        const firstResponse = await axios.get(url, { 
            maxRedirects: 0,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });

        let nextUrl = firstResponse.headers.location;
        if (!nextUrl) return url;

        // URL'yi düzelt
        if (!nextUrl.startsWith('http')) {
            nextUrl = `https://${nextUrl}`;
        }

        console.log('İlk yönlendirme URL:', nextUrl);

        // Puppeteer ile gerçek URL'yi bul
        const browser = await puppeteer.launch({
            headless: "new",
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--disable-gpu',
                '--window-size=1920x1080'
            ]
        });

        try {
            const page = await browser.newPage();
            
            // Navigasyon öncesi request interception'ı etkinleştir
            await page.setRequestInterception(true);
            
            // İstenmeyen kaynakları engelle
            page.on('request', (request) => {
                const resourceType = request.resourceType();
                if (resourceType === 'image' || resourceType === 'stylesheet' || resourceType === 'font') {
                    request.abort();
                } else {
                    request.continue();
                }
            });

            // Yönlendirmeleri takip et
            let finalUrl = nextUrl;
            page.on('response', async (response) => {
                const status = response.status();
                if (status >= 300 && status <= 399) {
                    const location = response.headers()['location'];
                    if (location) {
                        finalUrl = location.startsWith('http') ? location : `https://www.sahibinden.com${location}`;
                        console.log('Yönlendirme tespit edildi:', finalUrl);
                    }
                }
            });

            // Sayfaya git ve yüklenmeyi bekle
            await page.goto(nextUrl, {
                waitUntil: 'networkidle0',
                timeout: 30000
            });

            // Son URL'yi al
            const currentUrl = await page.url();
            console.log('Puppeteer final URL:', currentUrl);

            // Eğer favori-ilanlar içeriyorsa bu URL'yi kullan
            if (currentUrl.includes('favori-ilanlar')) {
                finalUrl = currentUrl;
            }

            return finalUrl;
        } finally {
            await browser.close();
        }
    } catch (error) {
        console.error(`Error resolving shortened URL: ${error.message}`);
        return url;
    }
}

async function collectLinks(sharedUrl) {
    try {
        const resolvedUrl = await resolveShortenedUrl(sharedUrl);
        console.log('Çözümlenen URL:', resolvedUrl);
        
        const links = [];
        let hasNextPage = true;
        let currentPage = 1;
        let currentUrl = resolvedUrl;

        while (hasNextPage) {
            console.log(`Sayfa ${currentPage} işleniyor...`);
            console.log('İşlenen URL:', currentUrl);

            let session;
            let retries = 3;
            let useSourceMode = currentPage === 1; // İlk sayfa için source mode kullan

            while (retries > 0) {
                try {
                    console.log(`\n[CF-CLEARANCE-SCRAPER] İstek gönderiliyor... (Mode: ${useSourceMode ? 'source' : 'waf-session'})`);
                    const response = await fetch("http://localhost:3000/cf-clearance-scraper", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            url: currentUrl,
                            mode: useSourceMode ? "source" : "waf-session"
                        }),
                    });
                    
                    const rawResponse = await response.text();
                    
                    try {
                        session = JSON.parse(rawResponse);
                    } catch (parseError) {
                        console.error('\n[CF-CLEARANCE-SCRAPER] JSON parse hatası:', parseError.message);
                        throw new Error(`Invalid JSON response: ${rawResponse}`);
                    }

                    if (!session || session.code !== 200) {
                        throw new Error(`Session could not be retrieved: ${JSON.stringify(session)}`);
                    }
                    break;
                } catch (err) {
                    console.error(`\n[CF-CLEARANCE-SCRAPER] Hata:`, err.message);
                    retries--;
                    if (retries > 0) {
                        console.log(`Yeniden deneniyor... (${3 - retries}/3)`);
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                    } else {
                        throw new Error(`cf-clearance-scraper error: ${err.message}`);
                    }
                }
            }

            // cycleTLS ile sayfayı getir
            const cycleTLS = await initCycleTLS();
            console.log('\n[CYCLETLS] İstek gönderiliyor:', currentUrl);

            // Session içeriğini kontrol et ve logla
            console.log('\n[CYCLETLS] Session içeriği kontrol ediliyor...');
            if (session.source) {
                console.log('Source içeriği mevcut');
                
                // HTML içeriğini temizle ve parse et
                const cleanedHtml = cleanHtml(session.source);
                const tempDoc = cheerio.load(cleanedHtml, {
                    decodeEntities: true,
                    xmlMode: false,
                    withDomLvl1: true
                });
                
                const favoritesContainer = tempDoc('.favorites-container');
                
                if (favoritesContainer.length > 0) {
                    console.log('Favorites container bulundu');
                    
                    // Source mode'dan gelen içeriği kullan
                    const $ = cheerio.load(cleanedHtml, {
                        decodeEntities: true,
                        xmlMode: false,
                        withDomLvl1: true
                    });
                    
                    // Aktif ilanları bul
                    $('.favorite-classified-row.classified-row').each((_, element) => {
                        if ($(element).hasClass('active-classified')) {
                            const link = $(element).find('a.classified-title').attr('href');
                            if (link) {
                                const fullUrl = link.startsWith('http') ? link : `https://www.sahibinden.com${link}`;
                                links.push(fullUrl);
                                console.log('İlan linki bulundu:', fullUrl);
                            }
                        }
                    });
                    
                    // HTML dosyasına kaydet
                    const outputDir = path.join(__dirname, 'html_responses');
                    if (!fs.existsSync(outputDir)) {
                        fs.mkdirSync(outputDir);
                    }
                    
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const fileName = `response_page${currentPage}_${timestamp}.html`;
                    const filePath = path.join(outputDir, fileName);
                    
                    // Temizlenmiş HTML'i kaydet
                    fs.writeFileSync(filePath, cleanedHtml);
                    console.log(`\n[CYCLETLS] Temizlenmiş HTML yanıtı kaydedildi: ${filePath}`);
                    
                    // Sonraki sayfa kontrolü
                    const nextButton = $('.pagination .next a');
                    hasNextPage = nextButton.length > 0;
                    
                    if (hasNextPage) {
                        const offset = nextButton.attr('data-offset');
                        currentUrl = `${resolvedUrl}?offset=${offset}`;
                        currentPage++;
                        console.log('Sonraki sayfa bulundu:', currentUrl);
                    }
                    
                    await cycleTLS.exit();
                    continue;
                } else {
                    console.log('Favorites container bulunamadı, normal akışa devam ediliyor...');
                }
            }

            // Session kontrolü
            if (!session.headers || !session.cookies || !Array.isArray(session.cookies)) {
                console.error('\n[CYCLETLS] Hata: Session bilgileri eksik veya hatalı');
                console.log('Headers:', session.headers ? 'Mevcut' : 'Eksik');
                console.log('Cookies:', session.cookies ? 'Mevcut' : 'Eksik');
                console.log('Cookies Array:', Array.isArray(session.cookies) ? 'Geçerli' : 'Geçersiz');
                
                // Source mode'a geç ve tekrar dene
                if (!useSourceMode) {
                    console.log('\n[CYCLETLS] Source mode ile tekrar deneniyor...');
                    await cycleTLS.exit();
                    useSourceMode = true;
                    continue;
                } else {
                    throw new Error('Session bilgileri alınamadı');
                }
            }

            const cookieString = session.cookies
                .filter(c => c && c.name && c.value) // Geçerli cookie'leri filtrele
                .map(c => `${c.name}=${c.value}`)
                .join("; ");

            console.log('[CYCLETLS] Headers:', {
                ...session.headers,
                cookie: cookieString
            });

            const response = await cycleTLS(
                currentUrl,
                {
                    body: "",
                    ja3: "772,4865-4866-4867-49195-49199-49196-49200-52393-52392-49171-49172-156-157-47-53,23-27-65037-43-51-45-16-11-13-17513-5-18-65281-0-10-35,25497-29-23-24,0",
                    userAgent: session.headers["user-agent"],
                    headers: {
                        ...session.headers,
                        cookie: cookieString
                    },
                },
                "get"
            );

            console.log('\n[CYCLETLS] Yanıt alındı:');
            console.log('Status:', response.status);
            console.log('Response Headers:', JSON.stringify(response.headers, null, 2));
            
            // Response body'yi HTML dosyasına kaydet
            const outputDir = path.join(__dirname, 'html_responses');
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir);
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = `response_page${currentPage}_${timestamp}.html`;
            const filePath = path.join(outputDir, fileName);
            
            fs.writeFileSync(filePath, response.body);
            console.log(`\n[CYCLETLS] HTML yanıtı kaydedildi: ${filePath}`);

            if (!response || response.status !== 200 || !response.body) {
                throw new Error(`Response error. Status: ${response?.status}`);
            }

            const $ = cheerio.load(response.body);

            // İçerik kontrolü
            const favoritesContainer = $('.favorites-container');
            const hasContent = favoritesContainer.length > 0 && 
                             favoritesContainer.find('.favorite-classified-row').length > 0;

            // İçerik boşsa ve source mode kullanılmadıysa, source mode ile tekrar dene
            if (!hasContent && !useSourceMode) {
                console.log('\n[CYCLETLS] İçerik boş geldi, source mode ile tekrar deneniyor...');
                await cycleTLS.exit();
                useSourceMode = true;
                continue;
            }

            // Aktif ilanları bul
            $('.favorite-classified-row.classified-row').each((_, element) => {
                if ($(element).hasClass('active-classified')) {
                    const link = $(element).find('a.classified-title').attr('href');
                    if (link) {
                        const fullUrl = link.startsWith('http') ? link : `https://www.sahibinden.com${link}`;
                        links.push(fullUrl);
                    }
                }
            });

            // Sonraki sayfa kontrolü
            const nextButton = $('.pagination .next a');
            hasNextPage = nextButton.length > 0;

            if (hasNextPage) {
                const offset = nextButton.attr('data-offset');
                currentUrl = `${resolvedUrl}?offset=${offset}`;
                currentPage++;
            }

            await cycleTLS.exit();
        }

        console.log(`Toplam ${links.length} aktif ilan linki toplandı.`);
        return links;
    } catch (error) {
        console.error('Link toplama hatası:', error.message);
        throw error;
    }
}

module.exports = collectLinks;