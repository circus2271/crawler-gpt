require('dotenv').config(); // Load environment variables from .env file

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const url = require('url');

const baseURL = process.env.BASE_URL; // Load base URL from .env file
if (!baseURL) {
    console.error('Error: BASE_URL is not defined in the .env file');
    process.exit(1);
}

const visited = new Set();
const downloadDir = path.join(__dirname, 'public'); // Base directory for HTML files
const assetsDir = path.join(downloadDir, 'assets'); // Directory for assets

// Function to remove the existing 'public' directory
function clearPreviousDownloads() {
    if (fs.existsSync(downloadDir)) {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        console.log('Removed previous download content.');
    }
}

async function downloadPage(pageURL) {
    if (visited.has(pageURL)) return;
    visited.add(pageURL);

    try {
        const response = await axios.get(pageURL);
        const html = response.data;

        // Save HTML to a file
        const relativePath = pageURL.replace(baseURL, '').replace(/\/$/, '');
        const filename = path.join(downloadDir, sanitizePath(relativePath) || 'index', 'index.html');
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, updateAssetLinks(html));

        // Use Cheerio to parse the HTML and find assets
        const $ = cheerio.load(html);

        const assetPromises = [];

        // Download images
        $('img').each((i, elem) => {
            const src = $(elem).attr('src');
            if (src) assetPromises.push(downloadAsset(src, pageURL));
        });

        // Download stylesheets
        $('link[rel="stylesheet"]').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) assetPromises.push(downloadCSS(href, pageURL));
        });

        // Download scripts
        $('script').each((i, elem) => {
            const src = $(elem).attr('src');
            if (src) assetPromises.push(downloadJS(src, pageURL));
        });

        await Promise.all(assetPromises);

        // Recursively download subpages
        $('a').each((i, elem) => {
            const href = $(elem).attr('href');
            if (href) {
                const nextPageURL = url.resolve(pageURL, href);
                if (nextPageURL.startsWith(baseURL)) {
                    downloadPage(nextPageURL);
                }
            }
        });
    } catch (error) {
        console.error(`Failed to download ${pageURL}: ${error.message}`);
    }
}

async function downloadCSS(cssURL, pageURL) {
    try {
        const fullURL = url.resolve(pageURL, cssURL);
        const response = await axios.get(fullURL);

        const assetPath = path.join(assetsDir, path.basename(fullURL)); // Keep original filename
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded CSS: ${fullURL}`);
    } catch (error) {
        console.error(`Failed to download CSS ${cssURL}: ${error.message}`);
    }
}

async function downloadJS(jsURL, pageURL) {
    try {
        const fullURL = url.resolve(pageURL, jsURL);
        const response = await axios.get(fullURL);

        const assetPath = path.join(assetsDir, path.basename(fullURL)); // Keep original filename
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded JS: ${fullURL}`);
    } catch (error) {
        console.error(`Failed to download JS ${jsURL}: ${error.message}`);
    }
}

async function downloadAsset(assetURL, pageURL) {
    try {
        const fullURL = url.resolve(pageURL, assetURL);
        const response = await axios.get(fullURL, { responseType: 'arraybuffer' });

        const assetPath = path.join(assetsDir, path.basename(fullURL)); // Keep original filename
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded asset: ${fullURL}`);
    } catch (error) {
        console.error(`Failed to download asset ${assetURL}: ${error.message}`);
    }
}

function updateAssetLinks(html) {
    const $ = cheerio.load(html);

    // Update links for stylesheets
    $('link[rel="stylesheet"]').each((i, elem) => {
        const href = $(elem).attr('href');
        if (href) {
            const assetPath = `/assets/${path.basename(url.resolve(baseURL, href))}`;
            $(elem).attr('href', assetPath);
        }
    });

    // Update links for scripts
    $('script').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src) {
            const assetPath = `/assets/${path.basename(url.resolve(baseURL, src))}`;
            $(elem).attr('src', assetPath);
        }
    });

    // Update links for images
    $('img').each((i, elem) => {
        const src = $(elem).attr('src');
        if (src) {
            const assetPath = `/assets/${path.basename(url.resolve(baseURL, src))}`;
            $(elem).attr('src', assetPath);
        }
    });

    return $.html(); // Return the updated HTML
}

function sanitizePath(filePath) {
    return filePath.replace(/[^a-z0-9/]/gi, '_').toLowerCase();
}

// Clear previous downloads
clearPreviousDownloads();
// Start the download process
downloadPage(baseURL);
