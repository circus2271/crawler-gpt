require('dotenv').config();

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const url = require('url');

const baseURL = process.env.BASE_URL;
const visited = new Set();
const downloadDir = path.join(__dirname, 'public');
const assetsDir = path.join(downloadDir, 'assets');

// Function to clear previous downloads
function clearPreviousDownloads() {
    if (fs.existsSync(downloadDir)) {
        fs.rmSync(downloadDir, { recursive: true, force: true });
        console.log('Removed previous download content.');
    }
}

// Download the main page and its assets
async function downloadPage(pageURL) {
    if (visited.has(pageURL)) return;
    visited.add(pageURL);

    try {
        const response = await axios.get(pageURL);
        const html = response.data;

        const relativePath = pageURL.replace(baseURL, '').replace(/\/$/, '');
        const filename = path.join(downloadDir, sanitizePath(relativePath) || 'index', 'index.html');
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, updateAssetLinks(html));

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

// Download CSS and assets
async function downloadCSS(cssURL, pageURL) {
    try {
        const fullURL = url.resolve(pageURL, cssURL);
        const response = await axios.get(fullURL);

        const assetPath = path.join(assetsDir, path.basename(fullURL));
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded CSS: ${fullURL}`);

        // Check for HTTPS links in the CSS and download them
        await downloadCdnResources(response.data, fullURL);
    } catch (error) {
        console.error(`Failed to download CSS ${cssURL}: ${error.message}`);
    }
}

async function downloadJS(jsURL, pageURL) {
    try {
        const fullURL = url.resolve(pageURL, jsURL);
        const response = await axios.get(fullURL);

        const assetPath = path.join(assetsDir, path.basename(fullURL));
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

        const assetPath = path.join(assetsDir, path.basename(fullURL));
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded asset: ${fullURL}`);
    } catch (error) {
        console.error(`Failed to download asset ${assetURL}: ${error.message}`);
    }
}

async function downloadCdnResources(cssContent, cssURL) {
    const cdnRegex = /https:\/\/cdn\.prod\.website-files\.com\/[^\s]+/g; // Adjust this regex for your CDN

    const matches = cssContent.match(cdnRegex);
    if (matches) {
        const downloadPromises = matches.map(async (cdnResource) => {
            await downloadCdnResource(cdnResource);
        });
        await Promise.all(downloadPromises);
    }
}

async function downloadCdnResource(cdnResource) {
    try {
        const response = await axios.get(cdnResource, { responseType: 'arraybuffer' });
        const assetPath = path.join(assetsDir, path.basename(cdnResource));
        fs.mkdirSync(path.dirname(assetPath), { recursive: true });
        fs.writeFileSync(assetPath, response.data);
        console.log(`Downloaded CDN resource: ${cdnResource}`);
    } catch (error) {
        console.error(`Failed to download CDN resource ${cdnResource}: ${error.message}`);
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
