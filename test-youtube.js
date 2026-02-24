#!/usr/bin/env node
/**
 * Quick test for YouTube channel download.
 * Run: node test-youtube.js
 */
const { fetchChannelVideos } = require('./server/youtube');

const url = 'https://www.youtube.com/watch?v=LdHqHzP3huk';
console.log('Testing YouTube fetch with video URL:', url);
console.log('Fetching 2 videos...\n');

fetchChannelVideos(url, 2)
  .then((videos) => {
    console.log('SUCCESS! Downloaded', videos.length, 'video(s):');
    videos.forEach((v, i) => console.log(' ', i + 1 + '.', v.title));
    process.exit(0);
  })
  .catch((err) => {
    console.error('ERROR:', err.message);
    process.exit(1);
  });
