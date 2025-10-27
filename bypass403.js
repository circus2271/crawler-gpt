const axios = require('axios');
const fs = require('fs');
const path = require('path');

function getFilenameFromUrl(fileUrl) {
    try {
        const parsedUrl = new URL(fileUrl);
        let filename = path.basename(parsedUrl.pathname);

        // URL decode the filename
        filename = decodeURIComponent(filename);

        // Remove query parameters from filename if any
        filename = filename.split('?')[0];

        // If no valid filename, generate one with timestamp
        if (!filename || filename === '/' || filename === parsedUrl.pathname) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            return `download-${timestamp}.bin`;
        }

        return filename;
    } catch (error) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `download-${timestamp}.bin`;
    }
}

async function downloadFile(fileUrl, customFilename = null) {
    const outputFilename = customFilename || getFilenameFromUrl(fileUrl);

    try {
        const response = await axios({
            method: 'GET',
            url: fileUrl,
            responseType: 'stream',
            headers: {
                'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'accept-language': 'ru-RU,ru;q=0.9,en-CA;q=0.8,en;q=0.7,en-US;q=0.6',
                'cache-control': 'no-cache',
                'dnt': '1',
                'pragma': 'no-cache',
                'priority': 'u=0, i',
                'sec-ch-ua': '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                'sec-ch-ua-mobile': '?1',
                'sec-ch-ua-platform': '"Android"',
                'sec-fetch-dest': 'document',
                'sec-fetch-mode': 'navigate',
                'sec-fetch-site': 'none',
                'sec-fetch-user': '?1',
                'sec-gpc': '1',
                'upgrade-insecure-requests': '1',
                'user-agent': 'Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36'
            }
        });

        const writer = fs.createWriteStream(outputFilename);

        response.data.pipe(writer);

        return new Promise((resolve, reject) => {
            writer.on('finish', () => {
                const stats = fs.statSync(outputFilename);
                console.log(`✓ Downloaded: ${outputFilename} (${(stats.size / 1024).toFixed(2)} KB)`);
                resolve({
                    filename: outputFilename,
                    size: stats.size,
                    status: response.status,
                    url: fileUrl
                });
            });

            writer.on('error', (err) => {
                fs.unlink(outputFilename, () => {});
                reject(new Error(`Failed to write file: ${err.message}`));
            });
        });

    } catch (error) {
        console.error('✗ Download failed:', error.message);
        throw error;
    }
}

// Usage - just pass the URL, filename is auto-detected
async function main() {
    try {
        const result = await downloadFile(
            'https://cdn.prod.website-files.com/5df5719a35688c16780cc730/63f76f8b2ab6add4ba80e9c0_playbutton%20-%20white%20darker%2C%20no%20circle.svg'
        );
        console.log('Success:', result);
    } catch (error) {
        console.error('Failed:', error.message);
    }
}

// Export for use in other modules
module.exports = { downloadFile, getFilenameFromUrl };

main();