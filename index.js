const functions = require('@google-cloud/functions-framework');
const axios = require('axios');
const GhostAdminAPI = require('@tryghost/admin-api');

// Initialize Ghost Admin API client 
const ghost = new GhostAdminAPI({
    url: process.env.GHOST_API_URL,
    key: process.env.GHOST_ADMIN_API_KEY,
    version: 'v5.0'
});

// Format ISO date string into readable form
function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/Los_Angeles'
    });
}

// Get the latest Raindrop bookmark that actually includes tag "1" 
async function getLatestRaindropBookmark() {
    const response = await axios.get('https://api.raindrop.io/rest/v1/raindrops/0', {
        headers: {
            'Authorization': `Bearer ${process.env.RAINDROP_API_KEY}`
        },
        params: {
            tag: '1',
            sort: '-created',
            perpage: 10
        }
    });

    if (response.data.items && response.data.items.length > 0) {
        const match = response.data.items.find(item => Array.isArray(item.tags) && item.tags.includes('1'));
        return match || null;
    }
    return null;
}

// Check if a bookmark has a note or highlight or note on a highlight
function getYouTubeVideoId(url) {
    try {
        const parsed = new URL(url);
        const { hostname, pathname, searchParams } = parsed;

        if (hostname === 'youtu.be') {
            return pathname.slice(1);
        }

        if (hostname === 'youtube.com' || hostname === 'www.youtube.com' || hostname === 'm.youtube.com') {
            if (pathname === '/watch') {
                return searchParams.get('v');
            }
            const shortsMatch = pathname.match(/^\/shorts\/([\w-]+)/);
            if (shortsMatch) {
                return shortsMatch[1];
            }
            const embedMatch = pathname.match(/^\/embed\/([\w-]+)/);
            if (embedMatch) {
                return embedMatch[1];
            }
        }
    } catch (e) {
        return null;
    }
    return null;
}

// Check if a bookmark has a note, highlight, highlight note, or is a YouTube link
function shouldProcessBookmark(bookmark) {
    const hasNote = !!bookmark.note?.trim();
    const hasHighlights = Array.isArray(bookmark.highlights) && bookmark.highlights.length > 0;
    const hasHighlightNotes = bookmark.highlights?.some(h => h.note?.trim());
    const isYouTube = !!getYouTubeVideoId(bookmark.link);
    return hasNote || hasHighlights || hasHighlightNotes || isYouTube;
}

// Escape HTML to avoid malformed posts
function escapeHtml(str) {
    return str?.replace(/[&<>"']/g, function (m) {
        return ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        })[m];
    }) || '';
}

// Allow basic formatting tags like <b>, <strong>, <i>, <em>, and safe <a href="..."> links
function sanitizeBasicHtml(str) {
    const escaped = escapeHtml(str);
    return escaped
        .replace(/&lt;(\/?(?:b|strong|i|em))&gt;/gi, '<$1>')
        .replace(/&lt;a href="([^"]+)"&gt;/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">')
        .replace(/&lt;\/a&gt;/gi, '</a>');
}

// Convert simple newline and bullet formatting into HTML
function convertNoteToHtml(text) {
    const lines = text.split(/\r?\n/);
    let html = '';
    let bullets = [];
    let inCodeBlock = false;
    let codeLanguage = '';
    let codeLines = [];

    const flushBullets = () => {
        if (bullets.length) {
            html += '<ul>' + bullets.map(b => `<li>${sanitizeBasicHtml(b)}</li>`).join('') + '</ul>';
            bullets = [];
        }
    };

    const flushCodeBlock = () => {
        if (codeLines.length) {
            const codeContent = escapeHtml(codeLines.join('\n'));
            html += `<pre><code${codeLanguage ? ` class="language-${codeLanguage}"` : ''}>${codeContent}</code></pre>`;
            codeLines = [];
        }
    };

    lines.forEach(line => {
        const trimmed = line.trim();

        // Handle fenced code blocks: ```lang
        const codeBlockStart = trimmed.match(/^```(\w*)$/);
        if (codeBlockStart) {
            flushBullets();
            inCodeBlock = true;
            codeLanguage = codeBlockStart[1];
            return;
        }

        if (trimmed === '```' && inCodeBlock) {
            inCodeBlock = false;
            flushCodeBlock();
            return;
        }

        if (inCodeBlock) {
            codeLines.push(line);
            return;
        }

        // Handle bullets
        if (/^[-*]\s+/.test(trimmed)) {
            bullets.push(trimmed.replace(/^[-*]\s+/, ''));
        } else if (trimmed) {
            flushBullets();
            // Handle inline code: `text`
            const inlineCode = trimmed.replace(/`([^`]+)`/g, (_, code) => `<code>${escapeHtml(code)}</code>`);
            html += `<p>${sanitizeBasicHtml(inlineCode)}</p>`;
        } else {
            flushBullets();
        }
    });

    flushBullets();
    flushCodeBlock();
    return html;
}

// Create HTML content with structured metadata and formatting
function formatGhostContent(bookmark) {
    const { _id, title, link, created, tags, note = '', highlights = [] } = bookmark;
    const formattedDate = formatDate(created);
    const htmlParts = [];

    // Add opening div with metadata attributes
    htmlParts.push(
        `<div class="link-item" ` +
        `raindrop-id="${_id}" ` +
        `raindrop-title="${escapeHtml(title)}" ` +
        `raindrop-link="${escapeHtml(link)}" ` +
        `raindrop-created="${formattedDate}" ` +
        `raindrop-tags="${(tags || []).join(',')}">`
    );

    // If bookmark link is a YouTube URL, embed the video player
    const videoId = getYouTubeVideoId(link);
    if (videoId) {
        htmlParts.push(
            `<div class="youtube-embed"><iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
        );
    }

    // Add bookmark note with structured formatting
    if (note.trim()) {
        htmlParts.push(convertNoteToHtml(note));
    }

    // Add each highlight + optional note
    highlights.forEach(h => {
        if (h.text?.trim()) {
            htmlParts.push(`<blockquote><p>${escapeHtml(h.text)}</p></blockquote>`);
            if (h.note?.trim()) {
                htmlParts.push(convertNoteToHtml(h.note));
            }
        }
    });

    // Close div and wrap in Ghost HTML card
    htmlParts.push(`</div>`);
    const htmlContent = `<!--kg-card-begin: html-->\n${htmlParts.join('\n')}\n<!--kg-card-end: html-->`;

    return {
        title: title || 'Untitled',
        html: htmlContent,
        tags: ['links'],
        status: 'published',
        visibility: 'public',
        canonical_url: link,
        custom_excerpt: bookmark.excerpt || '',
        meta_title: title || 'Untitled',
        meta_description: bookmark.excerpt || ''
    };
}

// Check if post already exists in Ghost
async function findExistingPost(raindropId) {
    const posts = await ghost.posts.browse({
        filter: 'tag:links',
        formats: ['html']
    });

    return posts.find(post => post.html?.includes(`raindrop-id="${raindropId}"`));
}

// Main function
functions.http('raindropToGhostSync', async (req, res) => {
    const authHeader = req.headers['authorization'];
    if (authHeader !== `Bearer ${process.env.SYNC_SECRET}`) {
        console.warn('Unauthorized request - invalid secret');
        return res.status(401).send('Unauthorized');
    }

    try {
        console.log('Starting sync process...');
        const bookmark = await getLatestRaindropBookmark();

        if (!bookmark) {
            console.log('No bookmarks with tag "1" found');
            return res.status(200).send('No bookmarks to process');
        }

        console.log(`Found bookmark: ${bookmark.title} (ID: ${bookmark._id})`);
        console.log('Bookmark tags:', bookmark.tags);

        if (!shouldProcessBookmark(bookmark)) {
            console.log('Bookmark has no notes or highlights, skipping');
            return res.status(200).send('Bookmark skipped - no content to process');
        }

        const existingPost = await findExistingPost(bookmark._id);
        const ghostContent = formatGhostContent(bookmark);

        if (existingPost) {
            console.log(`Updating existing post: ${existingPost.id}`);
            await ghost.posts.edit({
                id: existingPost.id,
                updated_at: existingPost.updated_at,
                ...ghostContent
            }, { source: 'html' });
            return res.status(200).send(`Updated post ${existingPost.id}`);
        } else {
            console.log('Creating new post');
            const newPost = await ghost.posts.add(ghostContent, { source: 'html' });
            return res.status(200).send(`Created new post ${newPost.id}`);
        }

    } catch (error) {
        console.error('Error:', error);
        return res.status(500).send(error.message);
    }
});
