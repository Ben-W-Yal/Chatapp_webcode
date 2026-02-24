// YouTube channel data fetcher — uses YouTube Data API v3
// Requires YOUTUBE_API_KEY in env. Get one at https://console.cloud.google.com/

const API_KEY = process.env.YOUTUBE_API_KEY || process.env.REACT_APP_YOUTUBE_API_KEY;
const BASE = 'https://www.googleapis.com/youtube/v3';

function api(path, params = {}) {
  const q = new URLSearchParams({ key: API_KEY, ...params });
  return fetch(`${BASE}${path}?${q}`).then((r) => r.json());
}

// Parse channel URL to get handle or channel ID
function parseChannelUrl(url) {
  const trimmed = String(url || '').trim();
  // https://www.youtube.com/@veritasium or youtube.com/@handle
  const handleMatch = trimmed.match(/youtube\.com\/@([\w-]+)/i);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };
  // https://www.youtube.com/channel/UCxxxx
  const channelMatch = trimmed.match(/youtube\.com\/channel\/([\w-]+)/i);
  if (channelMatch) return { type: 'channelId', value: channelMatch[1] };
  // Just @handle
  const atMatch = trimmed.match(/^@?([\w-]+)$/);
  if (atMatch) return { type: 'handle', value: atMatch[1] };
  return null;
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

// Main export: fetch channel videos with metadata
async function fetchChannelVideos(channelUrl, maxVideos = 10, onProgress) {
  if (!API_KEY) throw new Error('YOUTUBE_API_KEY not set in environment');

  const parsed = parseChannelUrl(channelUrl);
  if (!parsed) throw new Error('Invalid YouTube channel URL');

  onProgress?.({ step: 'Resolving channel', progress: 0 });

  const channelId = await getChannelId(parsed);
  if (!channelId) throw new Error('Channel not found');

  onProgress?.({ step: 'Getting uploads', progress: 10 });

  const uploadsId = await getUploadsPlaylistId(channelId);
  if (!uploadsId) throw new Error('Could not get uploads playlist');

  onProgress?.({ step: 'Fetching video list', progress: 20 });

  const videoIds = await getPlaylistVideoIds(uploadsId, maxVideos);
  if (!videoIds.length) throw new Error('No videos found');

  onProgress?.({ step: 'Fetching video details', progress: 30 });

  const details = await getVideoDetails(videoIds);
  const total = details.length;
  const results = [];

  for (let i = 0; i < details.length; i++) {
    const d = details[i];
    const progress = 30 + Math.round((i / total) * 60);
    onProgress?.({ step: `Processing ${d.snippet?.title || 'video'}`, progress });

    let transcript = null;
    try {
      transcript = await getTranscript(d.id);
    } catch {
      // transcript optional
    }

    results.push({
      video_id: d.id,
      video_url: `https://www.youtube.com/watch?v=${d.id}`,
      title: d.snippet?.title || '',
      description: d.snippet?.description || '',
      transcript: transcript || null,
      duration: formatDuration(parseDuration(d.contentDetails?.duration)),
      duration_seconds: parseDuration(d.contentDetails?.duration),
      release_date: d.snippet?.publishedAt || null,
      view_count: parseInt(d.statistics?.viewCount || 0, 10),
      like_count: parseInt(d.statistics?.likeCount || 0, 10),
      comment_count: parseInt(d.statistics?.commentCount || 0, 10),
      thumbnail: d.snippet?.thumbnails?.medium?.url || d.snippet?.thumbnails?.default?.url || null,
    });
  }

  onProgress?.({ step: 'Done', progress: 100 });

  return results;
}

module.exports = { fetchChannelVideos };
