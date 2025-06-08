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

// Helper to extract YouTube video ID from various URL formats
function getYouTubeVideoId(url) {
    if (!url) return null;
    let videoId = null;
    const patterns = [
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?(?:.*&)?v=([^&]+)/,    // https://www.youtube.com/watch?v=VIDEO_ID or https://www.youtube.com/watch?time_continue=1&v=VIDEO_ID
        /(?:https?:\/\/)?youtu\.be\/([^?]+)/,                               // https://youtu.be/VIDEO_ID
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([^?]+)/,           // https://www.youtube.com/embed/VIDEO_ID
        /(?:https?:\/\/)?(?:www\.)?youtube\.com\/shorts\/([^?]+)/           // https://www.youtube.com/shorts/VIDEO_ID
    ];
    for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match && match[1]) {
            videoId = match[1];
            if (videoId.includes('&')) {
                videoId = videoId.split('&')[0];
            }
            break;
        }
    }
    return videoId;
}

// Helper to generate YouTube embed code
function generateYouTubeEmbed(videoId) {
    return `<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
}

// Helper to extract Spotify embed path (e.g., album/ID, track/ID)
function getSpotifyEmbedPath(url) {
    if (!url) return null;
    const spotifyPattern = /https?:\/\/open\.spotify\.com\/(album|track|episode|show|playlist)\/([a-zA-Z0-9]+)/;
    const match = url.match(spotifyPattern);
    if (match && match[1] && match[2]) {
        return `${match[1]}/${match[2]}`;
    }
    return null;
}

// Helper to generate Spotify embed code
function generateSpotifyEmbed(embedPath) {
    let height = "152"; 
    if (embedPath.startsWith('album/') || embedPath.startsWith('playlist/') || embedPath.startsWith('show/')) {
        height = "352"; 
    }
    return `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/${embedPath}?utm_source=generator" width="100%" height="${height}" frameBorder="0" allowfullscreen="" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
}

// Check if a bookmark should be processed (has notes, highlights, or is a YouTube/Spotify link)
function shouldProcessBookmark(bookmark) {
    if (!bookmark) return false;
    const hasNote = !!bookmark.note?.trim();
    const hasHighlights = Array.isArray(bookmark.highlights) && bookmark.highlights.length > 0;
    const hasHighlightNotes = bookmark.highlights?.some(h => h.note?.trim());
    const isYouTubeLink = !!getYouTubeVideoId(bookmark.link);
    const isSpotifyLink = !!getSpotifyEmbedPath(bookmark.link);

    return hasNote || hasHighlights || hasHighlightNotes || isYouTubeLink || isSpotifyLink;
}

// Create HTML content with structured metadata and formatting
function formatGhostContent(bookmark) {
    const { _id, title, link, created, tags = [], note = '', highlights = [], excerpt = '' } = bookmark;
    const formattedDate = formatDate(created);
    const htmlParts = [];

    // Assuming escapeHtml and convertNoteToHtml are defined and in scope from elsewhere in the file.

    htmlParts.push(
        `<div class="link-item" ` +
        `raindrop-id="${_id}" ` +
        `raindrop-title="${escapeHtml(title || '')}" ` +
        `raindrop-link="${escapeHtml(link || '')}" ` +
        `raindrop-created="${formattedDate}" ` +
        `raindrop-tags="${(tags || []).join(',')}"` +
        `>`
    );

    let contentAdded = false;

    if (note && note.trim()) {
        htmlParts.push(convertNoteToHtml(note));
        contentAdded = true;
    }

    let embedCode = null;
    const youtubeVideoId = getYouTubeVideoId(link);
    let spotifyEmbedPath = null; // Declare spotifyEmbedPath here

    if (youtubeVideoId) {
        embedCode = generateYouTubeEmbed(youtubeVideoId);
    } else {
        spotifyEmbedPath = getSpotifyEmbedPath(link); // Assign, don't re-declare
        if (spotifyEmbedPath) {
            embedCode = generateSpotifyEmbed(spotifyEmbedPath);
        }
    }

    if (embedCode) {
        if (contentAdded) {
            htmlParts.push('<br>');
        }
        htmlParts.push(embedCode);
        contentAdded = true;
    }

    if (highlights && highlights.length > 0) {
        let firstHighlightProcessed = false;
        highlights.forEach(h => {
            if (h.text && h.text.trim()) {
                if (contentAdded && !firstHighlightProcessed) {
                    htmlParts.push('<br>');
                }
                firstHighlightProcessed = true;
                htmlParts.push(`<blockquote><p>${escapeHtml(h.text)}</p></blockquote>`);
                if (h.note && h.note.trim()) {
                    htmlParts.push(convertNoteToHtml(h.note));
                }
            }
        });
    }

    htmlParts.push(`</div>`);
    const htmlContent = `<!--kg-card-begin: html-->\n${htmlParts.join('\n')}\n<!--kg-card-end: html-->`;

    const newSystemTags = ['links'];
    if (youtubeVideoId) newSystemTags.push('youtube');
    if (spotifyEmbedPath && !youtubeVideoId) newSystemTags.push('spotify'); // Now spotifyEmbedPath is in scope
    const combinedTags = [...new Set([...newSystemTags, ...tags])];

    return {
        title: title || 'Untitled',
        html: htmlContent,
        tags: combinedTags,
        status: 'published',
        visibility: 'public',
        canonical_url: link,
        custom_excerpt: excerpt || '',
        meta_title: title || 'Untitled',
        meta_description: excerpt || ''
    };
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
    // Authorization check
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
