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
function shouldProcessBookmark(bookmark) {
    const hasNote = !!bookmark.note?.trim();
    const hasHighlights = Array.isArray(bookmark.highlights) && bookmark.highlights.length > 0;
    const hasHighlightNotes = bookmark.highlights?.some(h => h.note?.trim());
    return hasNote || hasHighlights || hasHighlightNotes;
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

    // Add bookmark note first
    if (note.trim()) {
        htmlParts.push(`<p>${escapeHtml(note)}</p>`);
    }

    // Add each highlight + optional note
    highlights.forEach(h => {
        if (h.text?.trim()) {
            htmlParts.push(`<blockquote><p>${escapeHtml(h.text)}</p></blockquote>`);
            if (h.note?.trim()) {
                htmlParts.push(`<p>${escapeHtml(h.note)}</p>`);
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
