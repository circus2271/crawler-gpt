const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const { URL } = require('url');

class SiteDownloader {
    constructor(baseUrl, outputDir = './public') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.outputDir = outputDir;
        this.assetsDir = path.join(outputDir, 'assets');
        this.fontsDir = path.join(this.assetsDir, 'fonts'); // New fonts directory
        this.visitedUrls = new Set();
        this.assetMap = new Map();
        this.pendingDownloads = new Set();
        this.failedDownloads = new Set();
        this.successfulDownloads = new Set();
        this.htmlPages = new Map();

        // Statistics
        this.stats = {
            startTime: null,
            endTime: null,
            totalPages: 0,
            totalAssets: 0,
            successful: {
                pages: 0,
                assets: 0,
                byType: {}
            },
            failed: {
                pages: 0,
                assets: 0,
                byType: {}
            },
            urls: {
                successful: [],
                failed: []
            }
        };

        // Configuration
        this.config = {
            maxRetries: 3,
            timeout: 15000,
            concurrency: 5,
            maxFileSize: 50 * 1024 * 1024,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            delayBetweenRequests: 100,
            skipLargeFiles: true
        };

        // Create axios instance with better defaults
        this.axios = axios.create({
            timeout: this.config.timeout,
            headers: {
                'User-Agent': this.config.userAgent,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
            },
            maxRedirects: 5,
            validateStatus: function (status) {
                return status >= 200 && status < 400;
            }
        });
    }

    async init() {
        // Clean public folder
        await this.cleanPublicFolder();

        // Create directories
        await fs.ensureDir(this.outputDir);
        await fs.ensureDir(this.assetsDir);
        await fs.ensureDir(this.fontsDir); // Ensure fonts directory exists

        this.stats.startTime = new Date().toISOString();

        console.log(`Starting download from: ${this.baseUrl}`);
        console.log(`Output directory: ${this.outputDir}`);
        console.log(`Fonts directory: ${this.fontsDir}`);
    }

    async cleanPublicFolder() {
        try {
            if (await fs.pathExists(this.outputDir)) {
                console.log(`🧹 Cleaning public folder: ${this.outputDir}`);
                const items = await fs.readdir(this.outputDir);

                for (const item of items) {
                    const itemPath = path.join(this.outputDir, item);
                    const stat = await fs.stat(itemPath);

                    // Don't delete statistic files
                    if (item.startsWith('download-statistics-') && item.endsWith('.json')) {
                        console.log(`📊 Keeping statistics file: ${item}`);
                        continue;
                    }

                    if (stat.isDirectory()) {
                        await fs.remove(itemPath);
                        console.log(`🗑️ Deleted directory: ${item}`);
                    } else {
                        await fs.remove(itemPath);
                        console.log(`🗑️ Deleted file: ${item}`);
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning public folder:', error.message);
        }
    }

    async downloadSite() {
        try {
            await this.init();
            await this.downloadPage(this.baseUrl, 'index.html');

            // Retry failed downloads
            await this.retryFailedDownloads();

            this.stats.endTime = new Date().toISOString();
            await this.generateStatistics();

            console.log('\n=== Download Summary ===');
            console.log(`Successfully downloaded: ${this.successfulDownloads.size} items`);
            console.log(`Failed downloads: ${this.failedDownloads.size}`);
            console.log(`Assets saved in: ${this.assetsDir}`);
            console.log(`Fonts saved in: ${this.fontsDir}`);

            if (this.failedDownloads.size > 0) {
                console.log('\nFailed URLs:');
                this.failedDownloads.forEach(url => console.log(`- ${url}`));
            }

        } catch (error) {
            console.error('Error downloading site:', error);
        }
    }

    // ... (previous methods like downloadPage, processStylesheets, processScripts, etc. remain the same)

    async processFonts($, baseUrl) {
        const fontLinks = $('link[rel*="font"], link[type*="font"]');
        console.log(`🔤 Processing ${fontLinks.length} font links`);

        for (let i = 0; i < fontLinks.length; i++) {
            const font = $(fontLinks[i]);
            const href = font.attr('href');

            if (href && !href.startsWith('data:') && !href.startsWith('assets/')) {
                await this.processAsset(href, baseUrl, 'fonts', (localPath) => {
                    // Update href to point to fonts directory
                    font.attr('href', `assets/fonts/${localPath}`);
                });
            }
        }

        // Also process @font-face rules in CSS
        await this.processFontFaceInStyles($, baseUrl);
    }

    async processFontFaceInStyles($, baseUrl) {
        // Process inline styles for @font-face rules
        $('style').each(async (i, elem) => {
            const styleContent = $(elem).html();
            const modifiedContent = await this.rewriteFontFaceUrls(styleContent, baseUrl);
            $(elem).html(modifiedContent);
        });
    }

    async rewriteFontFaceUrls(cssContent, baseUrl) {
        // Process @font-face rules to download and rewrite font URLs
        const fontFaceRegex = /(@font-face\s*\{[^}]+\})/gi;

        let modifiedCss = cssContent;
        let match;

        while ((match = fontFaceRegex.exec(cssContent)) !== null) {
            const fontFaceBlock = match[1];
            const modifiedBlock = await this.processFontFaceBlock(fontFaceBlock, baseUrl);
            modifiedCss = modifiedCss.replace(fontFaceBlock, modifiedBlock);
        }

        return modifiedCss;
    }

    async processFontFaceBlock(fontFaceBlock, baseUrl) {
        // Extract and process font URLs from src property
        const srcRegex = /src:\s*([^;]+);/gi;
        const urlRegex = /url\(['"]?([^'")]+)['"]?\)/gi;

        let modifiedBlock = fontFaceBlock;
        let srcMatch;

        while ((srcMatch = srcRegex.exec(fontFaceBlock)) !== null) {
            const srcValue = srcMatch[1];
            let modifiedSrcValue = srcValue;
            let urlMatch;

            while ((urlMatch = urlRegex.exec(srcValue)) !== null) {
                const originalUrl = urlMatch[1];
                if (!originalUrl.startsWith('data:') && !originalUrl.startsWith('assets/')) {
                    try {
                        const fontUrl = new URL(originalUrl, baseUrl).href;
                        const localFontPath = await this.downloadFontAsset(fontUrl);

                        if (localFontPath) {
                            modifiedSrcValue = modifiedSrcValue.replace(
                                originalUrl,
                                `assets/fonts/${localFontPath}`
                            );
                        }
                    } catch (error) {
                        console.error(`Error processing font URL ${originalUrl}:`, error.message);
                    }
                }
            }

            modifiedBlock = modifiedBlock.replace(srcValue, modifiedSrcValue);
        }

        return modifiedBlock;
    }

    async downloadFontAsset(fontUrl) {
        if (this.assetMap.has(fontUrl)) {
            return this.assetMap.get(fontUrl);
        }

        try {
            console.log(`🔤 Downloading font: ${fontUrl}`);

            const response = await this.retryRequest(() =>
                this.axios.get(fontUrl, {
                    responseType: 'arraybuffer',
                    maxContentLength: this.config.maxFileSize
                })
            );

            // Check file size
            const contentLength = response.headers['content-length'];
            if (this.config.skipLargeFiles && contentLength && contentLength > this.config.maxFileSize) {
                console.log(`⚠️ Skipping large font file: ${fontUrl} (${contentLength} bytes)`);
                return null;
            }

            const extension = this.getFontExtension(fontUrl, response.headers['content-type']);
            const filename = this.generateFontFilename(fontUrl, extension);
            const outputPath = path.join(this.fontsDir, filename);

            await fs.outputFile(outputPath, response.data);

            this.assetMap.set(fontUrl, filename);
            this.successfulDownloads.add(fontUrl);

            // Update statistics
            if (!this.stats.successful.byType.fonts) {
                this.stats.successful.byType.fonts = 0;
            }
            this.stats.successful.byType.fonts++;
            this.stats.successful.assets++;

            this.stats.urls.successful.push({
                url: fontUrl,
                localPath: outputPath,
                type: 'fonts'
            });

            console.log(`✅ Downloaded font: ${filename}`);

            await this.delay(this.config.delayBetweenRequests);

            return filename;

        } catch (error) {
            console.error(`❌ Failed to download font ${fontUrl}:`, error.message);
            this.failedDownloads.add(fontUrl);
            this.stats.urls.failed.push({
                url: fontUrl,
                error: error.message,
                type: 'fonts'
            });

            if (!this.stats.failed.byType.fonts) {
                this.stats.failed.byType.fonts = 0;
            }
            this.stats.failed.byType.fonts++;
            this.stats.failed.assets++;

            return null;
        }
    }

    getFontExtension(url, contentType = '') {
        // First try to get extension from URL
        const urlExt = path.extname(new URL(url).pathname).toLowerCase().replace('.', '');
        if (urlExt && ['woff', 'woff2', 'ttf', 'otf', 'eot'].includes(urlExt)) {
            return urlExt;
        }

        // Fall back to Content-Type
        if (contentType) {
            const typeMap = {
                'font/woff': 'woff',
                'font/woff2': 'woff2',
                'font/ttf': 'ttf',
                'font/otf': 'otf',
                'application/font-woff': 'woff',
                'application/font-woff2': 'woff2',
                'application/x-font-ttf': 'ttf',
                'application/x-font-otf': 'otf',
                'application/vnd.ms-fontobject': 'eot'
            };
            return typeMap[contentType] || 'woff'; // Default to woff if unknown
        }

        // Default extension based on common patterns
        if (url.includes('.woff2')) return 'woff2';
        if (url.includes('.woff')) return 'woff';
        if (url.includes('.ttf')) return 'ttf';
        if (url.includes('.otf')) return 'otf';
        if (url.includes('.eot')) return 'eot';

        return 'woff'; // Final fallback
    }

    generateFontFilename(url, extension) {
        const urlObj = new URL(url);
        let name = urlObj.pathname.split('/').pop() || `font-${Date.now()}`;

        name = name.split('?')[0];
        name = name.split('#')[0];

        // Ensure the file has the correct extension
        if (!path.extname(name) || !['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(path.extname(name).toLowerCase())) {
            name = `${name}.${extension}`;
        }

        // Sanitize filename
        name = name.replace(/[^a-zA-Z0-9.\-_]/g, '_');

        // Ensure unique filename
        let counter = 1;
        let finalName = name;
        const baseName = path.basename(finalName, path.extname(finalName));
        const ext = path.extname(finalName);

        while (this.assetMap.has(url) && this.assetMap.get(url) !== finalName) {
            finalName = `${baseName}-${counter}${ext}`;
            counter++;
        }

        return finalName;
    }

    async processAsset(url, baseUrl, type, callback) {
        if (this.pendingDownloads.has(url)) {
            return;
        }

        this.pendingDownloads.add(url);

        try {
            const assetUrl = new URL(url, baseUrl).href;
            let localPath;

            // Special handling for fonts
            if (type === 'fonts') {
                localPath = await this.downloadFontAsset(assetUrl);
            } else {
                localPath = await this.downloadAsset(assetUrl, type);
            }

            if (localPath) {
                callback(localPath);
            }
        } catch (error) {
            console.error(`❌ Error processing ${type} asset ${url}:`, error.message);
            this.failedDownloads.add(url);
            this.stats.urls.failed.push({
                url: url,
                error: error.message,
                type: type
            });

            if (!this.stats.failed.byType[type]) {
                this.stats.failed.byType[type] = 0;
            }
            this.stats.failed.byType[type]++;
            this.stats.failed.assets++;
        } finally {
            this.pendingDownloads.delete(url);
        }
    }

    async downloadAsset(assetUrl, type) {
        if (this.assetMap.has(assetUrl)) {
            return this.assetMap.get(assetUrl);
        }

        try {
            console.log(`⬇️ Downloading ${type}: ${assetUrl}`);

            const response = await this.retryRequest(() =>
                this.axios.get(assetUrl, {
                    responseType: 'arraybuffer',
                    maxContentLength: this.config.maxFileSize
                })
            );

            // Check file size
            const contentLength = response.headers['content-length'];
            if (this.config.skipLargeFiles && contentLength && contentLength > this.config.maxFileSize) {
                console.log(`⚠️ Skipping large file: ${assetUrl} (${contentLength} bytes)`);
                return null;
            }

            let extension = this.getFileExtension(assetUrl, response.headers['content-type']);

            // If no extension and it's likely an HTML page, handle it differently
            if (!extension && this.isLikelyHtmlPage(assetUrl, response.headers['content-type'])) {
                console.log(`🌐 Detected HTML page without extension: ${assetUrl}`);
                const pagePath = this.getPageOutputPath(assetUrl, 'index.html');
                await fs.outputFile(pagePath, response.data);

                this.successfulDownloads.add(assetUrl);
                this.stats.urls.successful.push({
                    url: assetUrl,
                    localPath: pagePath,
                    type: 'page'
                });
                this.stats.successful.pages++;

                return null;
            }

            const filename = this.generateFilename(assetUrl, type, extension);
            const outputPath = path.join(this.assetsDir, filename);

            await fs.outputFile(outputPath, response.data);

            this.assetMap.set(assetUrl, filename);
            this.successfulDownloads.add(assetUrl);

            // Update successful statistics by type
            if (!this.stats.successful.byType[type]) {
                this.stats.successful.byType[type] = 0;
            }
            this.stats.successful.byType[type]++;
            this.stats.successful.assets++;

            this.stats.urls.successful.push({
                url: assetUrl,
                localPath: outputPath,
                type: type
            });

            console.log(`✅ Downloaded: ${filename}`);

            // Process CSS files to rewrite internal URLs (including fonts)
            if (extension === 'css') {
                await this.processCssFile(outputPath, assetUrl);
            }

            await this.delay(this.config.delayBetweenRequests);

            return filename;

        } catch (error) {
            console.error(`❌ Failed to download ${type} ${assetUrl}:`, error.message);
            this.failedDownloads.add(assetUrl);
            this.stats.urls.failed.push({
                url: assetUrl,
                error: error.message,
                type: type
            });

            if (!this.stats.failed.byType[type]) {
                this.stats.failed.byType[type] = 0;
            }
            this.stats.failed.byType[type]++;
            this.stats.failed.assets++;

            return null;
        }
    }

    async processCssFile(filePath, baseUrl) {
        try {
            let cssContent = await fs.readFile(filePath, 'utf8');

            // First process font-face rules
            cssContent = await this.rewriteFontFaceUrls(cssContent, baseUrl);
            // Then process regular URLs
            cssContent = this.rewriteCssUrls(cssContent, baseUrl);

            await fs.writeFile(filePath, cssContent);
            console.log(`✅ Processed CSS: ${path.basename(filePath)}`);
        } catch (error) {
            console.error(`Error processing CSS file ${filePath}:`, error.message);
        }
    }

    rewriteCssUrls(cssContent, baseUrl) {
        return cssContent.replace(/url\(['"]?([^'")]+)['"]?\)/gi, (match, url) => {
            if (url.startsWith('data:') || url.startsWith('#') || url.startsWith('assets/')) {
                return match;
            }

            try {
                const assetUrl = new URL(url, baseUrl).href;
                const localPath = this.assetMap.get(assetUrl);

                if (localPath) {
                    // Check if this is a font file and adjust path accordingly
                    if (this.isFontFile(url)) {
                        return `url(assets/fonts/${localPath})`;
                    }
                    return `url(assets/${localPath})`;
                }
            } catch (error) {
                // If URL parsing fails, keep original
            }

            return match;
        });
    }

    isFontFile(url) {
        return url.match(/\.(woff|woff2|ttf|otf|eot)(\?.*)?$/i) !== null;
    }

    // ... (keep all other existing methods the same)

    getPageOutputPath(url, filename) {
        const urlObj = new URL(url);
        let pathname = urlObj.pathname;

        pathname = pathname.replace(/^\/|\/$/g, '');

        if (!pathname || pathname === '/' || pathname === 'index.html') {
            return path.join(this.outputDir, 'index.html');
        }

        if (path.extname(pathname)) {
            return path.join(this.outputDir, pathname);
        }

        const dirPath = path.join(this.outputDir, pathname);
        return path.join(dirPath, 'index.html');
    }

    isLikelyHtmlPage(url, contentType) {
        if (contentType && contentType.includes('text/html')) {
            return true;
        }

        const urlObj = new URL(url);
        const pathname = urlObj.pathname;

        if (!path.extname(pathname) && !pathname.endsWith('/')) {
            return true;
        }

        if (pathname.match(/\/(page|article|post|blog|news)\/\d+$/)) {
            return true;
        }

        return false;
    }

    async generateStatistics() {
        const stats = {
            metadata: {
                baseUrl: this.baseUrl,
                startTime: this.stats.startTime,
                endTime: this.stats.endTime,
                duration: new Date(this.stats.endTime) - new Date(this.stats.startTime)
            },
            summary: {
                totalDownloads: this.successfulDownloads.size + this.failedDownloads.size,
                successful: this.successfulDownloads.size,
                failed: this.failedDownloads.size,
                successRate: ((this.successfulDownloads.size / (this.successfulDownloads.size + this.failedDownloads.size)) * 100).toFixed(2) + '%'
            },
            detailed: {
                successful: {
                    total: this.stats.successful.pages + this.stats.successful.assets,
                    pages: this.stats.successful.pages,
                    assets: this.stats.successful.assets,
                    byType: this.stats.successful.byType
                },
                failed: {
                    total: this.stats.failed.pages + this.stats.failed.assets,
                    pages: this.stats.failed.pages,
                    assets: this.stats.failed.assets,
                    byType: this.stats.failed.byType
                }
            },
            urls: {
                successful: this.stats.urls.successful,
                failed: this.stats.urls.failed
            }
        };

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const statsFilename = `download-statistics-${timestamp}.json`;
        const statsPath = path.join(process.cwd(), statsFilename);

        await fs.writeJson(statsPath, stats, { spaces: 2 });
        console.log(`📊 Statistics saved: ${statsPath}`);

        return stats;
    }

    // ... (other existing methods like retryRequest, delay, etc.)

    async retryRequest(requestFn, retries = this.config.maxRetries) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await requestFn();
            } catch (error) {
                if (attempt === retries) {
                    throw error;
                }
                console.log(`🔄 Retry ${attempt}/${retries} for failed request`);
                await this.delay(1000 * attempt);
            }
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ... (other methods remain the same)
}

// Usage
const [,, url] = process.argv;

if (!url) {
    console.log('Usage: node download-site.js <URL>');
    console.log('Example: node download-site.js https://example.com');
    process.exit(1);
}

const downloader = new SiteDownloader(url);
downloader.downloadSite();