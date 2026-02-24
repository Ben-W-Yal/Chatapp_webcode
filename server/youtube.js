// YouTube channel data fetcher
// Option 1: YOUTUBE_API_KEY in env (official API) — get at https://console.cloud.google.com/
// Option 2: No key — uses youtubei package (unofficial, no key required)

const API_KEY = (process.env.YOUTUBE_API_KEY || process.env.REACT_APP_YOUTUBE_API_KEY || '').trim();
const BASE = 'https://www.googleapis.com/youtube/v3';

function api(path, params = {}) {
  const q = new URLSearchParams({ key: API_KEY, ...params });
  return fetch(`${BASE}${path}?${q}`).then((r) => r.json());
}

// Strip invisible Unicode chars that can appear when pasting (zero-width space, etc.)
// Also decode URL-encoded chars (e.g. %40 -> @) so pasted URLs are recognized
function sanitizeUrl(url) {
  let s = String(url || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '') // zero-width space, BOM, soft hyphen
    .trim()
    .replace(/\s/g, '');
  try {
    s = decodeURIComponent(s).trim();
  } catch {
    // leave as-is if decoding fails (e.g. malformed %)
  }
  return s;
}

// Parse channel URL or video URL; returns { type, value } or null
// Handles: @handle, /channel/UCxxx, /c/name, /user/name, video URLs
function parseChannelOrVideoUrl(url) {
  const trimmed = sanitizeUrl(url);
  if (!trimmed) return null;

  // Video URLs: youtube.com/watch?v=xxx, youtu.be/xxx, youtube.com/shorts/xxx
  const watchMatch = trimmed.match(
    /(?:youtube\.com\/watch\?.*v=|youtube\.com\/shorts\/|youtu\.be\/)([\w-]{11})/i
  );
  if (watchMatch) return { type: 'videoId', value: watchMatch[1] };

  // @handle: youtube.com/@handle (with optional /videos, /featured, /streams, etc.)
  // Use [^/\s?#&]+ to support handles with various chars (incl. unicode)
  const handleMatch = trimmed.match(/youtube\.com\/@([^/\s?#&]+)/i);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // Channel ID: youtube.com/channel/UCxxxx (UC + 22 base64url chars)
  const channelMatch = trimmed.match(/youtube\.com\/channel\/([\w-]+)/i);
  if (channelMatch) return { type: 'channelId', value: channelMatch[1] };

  // Custom / legacy: youtube.com/c/Name or youtube.com/user/username
  const customMatch = trimmed.match(/youtube\.com\/(?:c|user)\/([^/\s?#&]+)/i);
  if (customMatch) return { type: 'handle', value: customMatch[1] };

  // m.youtube.com variants (mobile)
  const mHandleMatch = trimmed.match(/m\.youtube\.com\/@([^/\s?#&]+)/i);
  if (mHandleMatch) return { type: 'handle', value: mHandleMatch[1] };

  const mChannelMatch = trimmed.match(/m\.youtube\.com\/channel\/([\w-]+)/i);
  if (mChannelMatch) return { type: 'channelId', value: mChannelMatch[1] };

  // Just @handle or handle (no URL)
  const atMatch = trimmed.match(/^@?([\w.-]+)$/);
  if (atMatch) return { type: 'handle', value: atMatch[1] };

  // Fallback: @handle in a youtube-like URL (catches unusual formats)
  const atInUrl = trimmed.match(/youtube[^/]*\/@([^/\s?#&]+)/i);
  if (atInUrl) return { type: 'handle', value: atInUrl[1] };

  return null;
}

// Alias for backward compatibility
function parseChannelUrl(url) {
  const parsed = parseChannelOrVideoUrl(url);
  return parsed && parsed.type !== 'videoId' ? parsed : null;
}

// Resolve handle or channel ID to channel ID
async function getChannelId(parsed) {
  if (!parsed) return null;
  if (parsed.type === 'channelId') return parsed.value;
  const res = await api('/channels', { part: 'id', forHandle: parsed.value });
  const channel = res.items?.[0];
  return channel?.id || null;
}

// Get uploads playlist ID for a channel
async function getUploadsPlaylistId(channelId) {
  const res = await api('/channels', { part: 'contentDetails', id: channelId });
  return res.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
}

// Get video IDs from playlist
async function getPlaylistVideoIds(playlistId, maxResults = 10) {
  const ids = [];
  let nextPageToken = null;
  while (ids.length < maxResults) {
    const res = await api('/playlistItems', {
      part: 'contentDetails',
      playlistId,
      maxResults: Math.min(50, maxResults - ids.length),
      pageToken: nextPageToken || undefined,
    });
    const items = res.items || [];
    for (const item of items) {
      if (item.contentDetails?.videoId) ids.push(item.contentDetails.videoId);
    }
    nextPageToken = res.nextPageToken;
    if (!nextPageToken || ids.length >= maxResults) break;
  }
  return ids.slice(0, maxResults);
}

// Get video details (snippet, contentDetails, statistics)
async function getVideoDetails(videoIds) {
  if (!videoIds.length) return [];
  const res = await api('/videos', {
    part: 'snippet,contentDetails,statistics',
    id: videoIds.join(','),
  });
  return res.items || [];
}

// Parse ISO 8601 duration (PT1H2M3S) to seconds
function parseDuration(duration) {
  if (!duration) return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const h = parseInt(match[1] || 0, 10);
  const m = parseInt(match[2] || 0, 10);
  const s = parseInt(match[3] || 0, 10);
  return h * 3600 + m * 60 + s;
}

function formatDuration(seconds) {
  if (seconds == null) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// Fetch transcript (optional) — uses youtube-transcript
async function getTranscript(videoId) {
  try {
    const { YoutubeTranscript } = require('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    return transcript ? transcript.map((t) => t.text).join(' ') : null;
  } catch {
    return null;
  }
}

// ── Fallback: youtubei (no API key) ───────────────────────────────────────────

async function fetchWithYoutubei(inputUrl, maxVideos, onProgress) {
  const { Client } = require('youtubei');
  const yt = new Client();

  const parsed = parseChannelOrVideoUrl(inputUrl);
  if (!parsed) throw new Error('Invalid YouTube URL. Use a channel URL (e.g. youtube.com/@channelname) or a video URL (e.g. youtube.com/watch?v=xxx)');

  onProgress?.({ step: 'Searching for channel', progress: 10 });

  let channel;
  if (parsed.type === 'videoId') {
    const video = await yt.getVideo(parsed.value);
    if (!video?.channel?.id) throw new Error('Could not get channel from video');
    channel = await yt.getChannel(video.channel.id);
  } else if (parsed.type === 'channelId') {
    channel = await yt.getChannel(parsed.value);
  } else {
    const search = await yt.search(parsed.value, { type: 'channel' });
    channel = search?.items?.[0];
  }
  if (!channel) throw new Error('Channel not found');

  onProgress?.({ step: 'Fetching videos', progress: 30 });

  const allVideos = [];
  let hasMore = true;
  while (hasMore && allVideos.length < maxVideos) {
    const page = await channel.videos.next();
    const items = Array.isArray(page) ? page : page?.items || [];
    for (const v of items) {
      if (allVideos.length >= maxVideos) break;
      allVideos.push(v);
    }
    hasMore = items.length > 0 && allVideos.length < maxVideos && channel.videos?.continuation;
  }

  const videos = allVideos.slice(0, maxVideos);
  const results = [];
  const total = videos.length;

  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    const progress = 40 + Math.round((i / total) * 55);
    onProgress?.({ step: `Processing ${v.title || 'video'}`, progress });

    let transcript = null;
    try {
      const { YoutubeTranscript } = require('youtube-transcript');
      const t = await YoutubeTranscript.fetchTranscript(v.id);
      transcript = t ? t.map((x) => x.text).join(' ') : null;
    } catch {
      // transcript optional
    }

    const thumbObj = Array.isArray(v.thumbnails) ? v.thumbnails[0] : v.thumbnails;
    const thumb = thumbObj?.url || null;

    results.push({
      video_id: v.id,
      video_url: `https://www.youtube.com/watch?v=${v.id}`,
      title: v.title || '',
      description: v.description || '',
      transcript,
      duration: v.duration ? `${Math.floor(v.duration / 60)}m ${v.duration % 60}s` : null,
      duration_seconds: v.duration || null,
      release_date: v.uploadDate || null,
      view_count: v.viewCount || 0,
      like_count: v.likeCount || 0,
      comment_count: v.commentCount || 0,
      thumbnail: thumb,
    });
  }

  onProgress?.({ step: 'Done', progress: 100 });
  return results;
}

// Main export: fetch channel videos with metadata
// Uses youtubei — no API key required.
// Accepts channel URLs (youtube.com/@handle, youtube.com/channel/UCxxx) or video URLs (youtube.com/watch?v=xxx)
async function fetchChannelVideos(inputUrl, maxVideos = 10, onProgress) {
  const parsed = parseChannelOrVideoUrl(inputUrl);
  if (!parsed) throw new Error('Invalid YouTube URL. Use a channel or video URL.');

  return fetchWithYoutubei(inputUrl, maxVideos, onProgress);
}

module.exports = { fetchChannelVideos };
