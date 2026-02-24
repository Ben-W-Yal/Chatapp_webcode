import { useState } from 'react';
import './YouTubeDownload.css';

const API = process.env.REACT_APP_API_URL || '';

export default function YouTubeDownload() {
  const [url, setUrl] = useState('');
  const [maxVideos, setMaxVideos] = useState(10);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [videos, setVideos] = useState(null);

  const handleDownload = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError('Enter a YouTube channel URL');
      return;
    }
    setError('');
    setLoading(true);
    setProgress(0);
    setVideos(null);

    // Simulate progress while waiting (real progress would need SSE)
    const progressInterval = setInterval(() => {
      setProgress((p) => Math.min(p + 5, 90));
    }, 500);

    try {
      const isVeritasium = /veritasium/i.test(trimmed);
      const data = await fetch(`${API}/api/youtube/channel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: trimmed,
          maxVideos: Math.min(Math.max(maxVideos, 1), 100),
          saveToPublic: isVeritasium && maxVideos === 10,
        }),
      });
      const json = await data.json();
      if (!data.ok) throw new Error(json.error || 'Download failed');
      setVideos(json.videos);
      setProgress(100);
    } catch (err) {
      setError(err.message || 'Failed to download channel data');
    } finally {
      clearInterval(progressInterval);
      setLoading(false);
    }
  };

  const handleDownloadJson = () => {
    if (!videos?.length) return;
    const blob = new Blob([JSON.stringify(videos, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'youtube-channel-data.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="youtube-download">
      <div className="youtube-download-card">
        <h1>YouTube Channel Download</h1>
        <p className="youtube-subtitle">
          Enter a YouTube channel URL to download video metadata (title, description, stats, transcript if available).
        </p>

        <div className="youtube-form">
          <input
            type="url"
            placeholder="https://www.youtube.com/@veritasium"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            className="youtube-url-input"
          />
          <div className="youtube-row">
            <label>
              Max videos:{' '}
              <input
                type="number"
                min={1}
                max={100}
                value={maxVideos}
                onChange={(e) => setMaxVideos(Math.min(100, Math.max(1, parseInt(e.target.value, 10) || 10)))}
                disabled={loading}
                className="youtube-max-input"
              />
            </label>
            <button
              onClick={handleDownload}
              disabled={loading}
              className="youtube-download-btn"
            >
              {loading ? 'Downloading…' : 'Download Channel Data'}
            </button>
          </div>
        </div>

        {loading && (
          <div className="youtube-progress">
            <div className="youtube-progress-bar" style={{ width: `${progress}%` }} />
            <span className="youtube-progress-text">{progress}%</span>
          </div>
        )}

        {error && <p className="youtube-error">{error}</p>}

        {videos && videos.length > 0 && (
          <div className="youtube-results">
            <div className="youtube-results-header">
              <h2>Downloaded {videos.length} video{videos.length !== 1 ? 's' : ''}</h2>
              <button onClick={handleDownloadJson} className="youtube-json-btn">
                Download JSON
              </button>
            </div>
            <ul className="youtube-video-list">
              {videos.map((v) => (
                <li key={v.video_id} className="youtube-video-item">
                  <img src={v.thumbnail} alt="" className="youtube-thumb" />
                  <div className="youtube-video-info">
                    <a href={v.video_url} target="_blank" rel="noreferrer" className="youtube-video-title">
                      {v.title}
                    </a>
                    <span className="youtube-video-meta">
                      {v.view_count?.toLocaleString()} views · {v.like_count?.toLocaleString()} likes · {v.duration || '—'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
