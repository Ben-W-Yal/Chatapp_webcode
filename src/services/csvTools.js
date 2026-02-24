// ── Tool declarations (sent to Gemini so it knows what functions exist) ───────

// IMPORTANT NOTE embedded in every description:
// The user message always begins with "[CSV columns: col1, col2, ...]".
// Always copy column names character-for-character from that list.
// Never guess, abbreviate, or change capitalisation.

const COL_NOTE = 'Use the exact column name as it appears in the [CSV columns: ...] header at the top of the message — copy it character-for-character, preserving spaces and capitalisation.';

export const CSV_TOOL_DECLARATIONS = [
  {
    name: 'compute_column_stats',
    description:
      'Compute descriptive statistics (mean, median, std, min, max, count) for a numeric column. ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact column name copied from [CSV columns: ...]. Example: if the header says "Favorite Count" pass "Favorite Count", not "favorite_count".',
        },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_value_counts',
    description:
      'Count occurrences of each unique value in a column (for categorical data). ' + COL_NOTE,
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact column name copied from [CSV columns: ...]. ' + COL_NOTE,
        },
        top_n: { type: 'NUMBER', description: 'How many top values to return (default 10)' },
      },
      required: ['column'],
    },
  },
  {
    name: 'get_top_tweets',
    description:
      'Return the top or bottom N tweets sorted by any metric, including the computed "engagement" column ' +
      '(Favorite Count / View Count). Returns tweet text + all key metrics in a readable format. ' +
      'Use this when someone asks for the best/worst/most/least performing tweets, ' +
      'e.g. "show me the 10 most engaging tweets" or "what are the least viewed tweets". ' +
      'The "engagement" column is always available once a CSV is loaded.',
    parameters: {
      type: 'OBJECT',
      properties: {
        sort_column: {
          type: 'STRING',
          description: 'Metric to sort by. Use "engagement" for engagement ratio, or any exact column name from [CSV columns: ...].',
        },
        n: { type: 'NUMBER', description: 'Number of tweets to return (default 10).' },
        ascending: {
          type: 'BOOLEAN',
          description: 'false = highest first (top performers), true = lowest first (worst performers). Default false.',
        },
      },
      required: ['sort_column'],
    },
  },
  {
    name: 'compute_stats_json',
    description:
      'Compute mean, median, standard deviation, min, and max for any numeric field in the channel JSON. ' +
      'Use when the user asks for statistics, average, or distribution of a numeric column. ' +
      'Common fields: view_count, like_count, comment_count, duration_seconds.',
    parameters: {
      type: 'OBJECT',
      properties: {
        column: {
          type: 'STRING',
          description: 'Exact field name from the JSON (e.g. view_count, like_count, comment_count, duration_seconds).',
        },
      },
      required: ['column'],
    },
  },
  {
    name: 'plot_metric_vs_time',
    description:
      'Plot any numeric field (views, likes, comments, etc.) vs time for channel videos. ' +
      'Returns a chart. Use when the user asks to visualize a metric over time.',
    parameters: {
      type: 'OBJECT',
      properties: {
        metric: {
          type: 'STRING',
          description: 'Numeric field to plot (e.g. view_count, like_count, comment_count).',
        },
      },
      required: ['metric'],
    },
  },
  {
    name: 'play_video',
    description:
      'Play or open a YouTube video from the loaded channel data. ' +
      'User can specify by title (e.g. "play the asbestos video"), ordinal (e.g. "play the first video"), or "most viewed". ' +
      'Returns a clickable card with title and thumbnail that opens the video in a new tab.',
    parameters: {
      type: 'OBJECT',
      properties: {
        selector: {
          type: 'STRING',
          description: 'How to pick the video: "first", "last", "most viewed", "least viewed", or a partial title match.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: 'generateImage',
    description:
      'Generate an image from a text prompt and an optional anchor/reference image. ' +
      'Use when the user wants to create or edit an image. The anchor image provides style or context.',
    parameters: {
      type: 'OBJECT',
      properties: {
        prompt: {
          type: 'STRING',
          description: 'Text description of the image to generate.',
        },
        anchorImageBase64: {
          type: 'STRING',
          description: 'Optional base64-encoded reference image for style/context.',
        },
      },
      required: ['prompt'],
    },
  },
];

// ── Parse a CSV line, respecting quoted fields ────────────────────────────────

const parseLine = (line) => {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
};

// ── Parse a full CSV text into an array of row objects ────────────────────────

export const parseCsvToRows = (text) => {
  const lines = text.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = parseLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const vals = parseLine(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (vals[i] || '').replace(/^"|"$/g, '');
    });
    return obj;
  });
  return { headers, rows };
};

// ── Column lookup (case-insensitive + whitespace-tolerant) ───────────────────
// Gemini often passes column names in a slightly different case than the CSV header.
// This finds the actual header key so the lookup always works.

const resolveCol = (rows, name) => {
  if (!rows.length || !name) return name;
  const keys = Object.keys(rows[0]);
  // 1. exact match
  if (keys.includes(name)) return name;
  const norm = (s) => s.toLowerCase().replace(/[\s_-]+/g, '');
  const target = norm(name);
  // 2. normalised match
  return keys.find((k) => norm(k) === target) || name;
};

// ── Math helpers ──────────────────────────────────────────────────────────────

const numericValues = (rows, col) =>
  rows.map((r) => parseFloat(r[col])).filter((v) => !isNaN(v));

const median = (sorted) =>
  sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];

const fmt = (n) => +n.toFixed(4);

// ── Build a slim CSV with only the key analytical columns ────────────────────
// Extracts text, language, type, engagement metrics, and the computed engagement
// ratio. Returns a plain CSV string Gemini can read directly in its context —
// no base64 or Python needed. ~6-10k tokens for a 250-row tweet dataset.

const SLIM_PATTERNS = [
  /^text$/i,
  /^language$/i,
  /^type$/i,
  /^view.?count$/i,
  /^reply.?count$/i,
  /^retweet.?count$/i,
  /^quote.?count$/i,
  /^favorite.?count$/i,
  /^(created.?at|timestamp|date)$/i,
  /^engagement$/i,            // computed column added by enrichWithEngagement
];

export const buildSlimCsv = (rows, headers) => {
  if (!rows.length || !headers.length) return '';

  // Pick columns that match any slim pattern, preserving header order
  const slimHeaders = headers.filter((h) => SLIM_PATTERNS.some((re) => re.test(h)));
  if (!slimHeaders.length) return '';

  const escapeCell = (v) => {
    const s = String(v ?? '');
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };

  const lines = [
    slimHeaders.join(','),
    ...rows.map((r) => slimHeaders.map((h) => escapeCell(r[h])).join(',')),
  ];
  return lines.join('\n');
};

// ── Enrich rows with computed engagement column ───────────────────────────────
// Adds engagement = Favorite Count / View Count to every row.
// Returns { rows: enrichedRows, headers: updatedHeaders }.
// Safe to call even if the columns aren't present (skips gracefully).

export const enrichWithEngagement = (rows, headers) => {
  if (!rows.length) return { rows, headers };

  // Auto-detect favorite and view columns
  const favCol =
    headers.find((h) => /favorite.?count/i.test(h)) ||
    headers.find((h) => /^likes?$/i.test(h));
  const viewCol =
    headers.find((h) => /view.?count/i.test(h)) ||
    headers.find((h) => /^views?$/i.test(h));

  if (!favCol || !viewCol) return { rows, headers };
  if (headers.includes('engagement')) return { rows, headers }; // already added

  const enriched = rows.map((r) => {
    const fav  = parseFloat(r[favCol]);
    const view = parseFloat(r[viewCol]);
    const eng  = !isNaN(fav) && !isNaN(view) && view > 0
      ? +(fav / view).toFixed(6)
      : null;
    return { ...r, engagement: eng };
  });

  return { rows: enriched, headers: [...headers, 'engagement'] };
};

// ── Dataset summary (auto-computed when CSV is loaded) ───────────────────────
// Returns a compact markdown string describing every column so Gemini always
// has exact column names, types, and value distributions in its context.

export const computeDatasetSummary = (rows, headers) => {
  if (!rows.length || !headers.length) return '';

  const lines = [`**Dataset: ${rows.length} rows × ${headers.length} columns**\n`];
  const numericCols = [];
  const categoricalCols = [];

  headers.forEach((h) => {
    const vals = rows.map((r) => r[h]).filter((v) => v !== '' && v !== undefined && v !== null);
    const numVals = vals.map((v) => parseFloat(v)).filter((v) => !isNaN(v));
    const numericRatio = numVals.length / (vals.length || 1);

    if (numericRatio >= 0.8 && numVals.length > 0) {
      const mean = numVals.reduce((a, b) => a + b, 0) / numVals.length;
      numericCols.push({
        name: h,
        count: numVals.length,
        mean: +mean.toFixed(2),
        min: Math.min(...numVals),
        max: Math.max(...numVals),
      });
    } else {
      const counts = {};
      vals.forEach((v) => { counts[v] = (counts[v] || 0) + 1; });
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([v, n]) => `${v} (${n})`)
        .join(', ');
      categoricalCols.push({ name: h, unique: Object.keys(counts).length, top });
    }
  });

  if (numericCols.length) {
    lines.push('**Numeric columns** (exact names — use these verbatim in tool calls):');
    numericCols.forEach((c) => {
      lines.push(`  • "${c.name}": mean=${c.mean}, min=${c.min}, max=${c.max}, n=${c.count}`);
    });
  }

  if (categoricalCols.length) {
    lines.push('\n**Categorical columns** (exact names — use these verbatim in tool calls):');
    categoricalCols.forEach((c) => {
      lines.push(`  • "${c.name}": ${c.unique} unique values — top: ${c.top}`);
    });
  }

  return lines.join('\n');
};

const getApi = () => (typeof process !== 'undefined' && process.env?.REACT_APP_API_URL) || '';

// ── Client-side tool executor ─────────────────────────────────────────────────
// userImages: optional array of { data, mimeType } from the current message (for generateImage anchor)
export const executeTool = async (toolName, args, rows, userImages = []) => {
  const availableHeaders = rows.length ? Object.keys(rows[0]) : [];
  console.group(`[CSV Tool] ${toolName}`);
  console.log('args:', args);
  console.log('rows loaded:', rows.length);
  console.log('available headers:', availableHeaders);
  console.groupEnd();

  switch (toolName) {
    case 'compute_column_stats': {
      const col = resolveCol(rows, args.column);
      console.log(`[compute_column_stats] resolved column: "${args.column}" → "${col}"`);
      const vals = numericValues(rows, col);
      if (!vals.length)
        return { error: `No numeric values found in column "${col}". Available columns: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        column: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'get_value_counts': {
      const col = resolveCol(rows, args.column);
      console.log(`[get_value_counts] resolved column: "${args.column}" → "${col}"`);
      const topN = args.top_n || 10;
      const counts = {};
      rows.forEach((r) => {
        const v = r[col];
        if (v !== undefined && v !== '') counts[v] = (counts[v] || 0) + 1;
      });
      const sorted = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN);
      return {
        column: col,
        total_rows: rows.length,
        value_counts: Object.fromEntries(sorted),
      };
    }

    case 'get_top_tweets': {
      const sortCol = resolveCol(rows, args.sort_column) || args.sort_column;
      console.log(`[get_top_tweets] sort="${sortCol}" n=${args.n} asc=${args.ascending}`);
      const n   = args.n || 10;
      const asc = args.ascending ?? false;

      // Detect text column for display
      const textCol =
        availableHeaders.find((h) => /^text$/i.test(h)) ||
        availableHeaders.find((h) => /text|content|tweet|body/i.test(h));

      // Detect key metric columns
      const favCol  = availableHeaders.find((h) => /favorite.?count/i.test(h));
      const viewCol = availableHeaders.find((h) => /view.?count/i.test(h));
      const engCol  = availableHeaders.includes('engagement') ? 'engagement' : null;

      const sorted = [...rows].sort((a, b) => {
        const av = parseFloat(a[sortCol]);
        const bv = parseFloat(b[sortCol]);
        if (!isNaN(av) && !isNaN(bv)) return asc ? av - bv : bv - av;
        return 0;
      });

      const topRows = sorted.slice(0, n).map((r, i) => {
        const out = { rank: i + 1 };
        if (textCol) out.text = String(r[textCol] || '').slice(0, 150);
        if (favCol)  out[favCol]  = r[favCol];
        if (viewCol) out[viewCol] = r[viewCol];
        if (engCol)  out.engagement = r.engagement;
        return out;
      });

      if (!topRows.length)
        return { error: `No rows found. Column "${sortCol}" may not exist. Available: ${availableHeaders.join(', ')}` };

      return {
        sort_column: sortCol,
        direction: asc ? 'ascending (lowest first)' : 'descending (highest first)',
        count: topRows.length,
        tweets: topRows,
      };
    }

    case 'compute_stats_json': {
      const col = resolveCol(rows, args.column);
      const vals = numericValues(rows, col);
      if (!vals.length)
        return { error: `No numeric values in "${col}". Available: ${availableHeaders.join(', ')}` };
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      const sorted = [...vals].sort((a, b) => a - b);
      const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
      return {
        column: col,
        count: vals.length,
        mean: fmt(mean),
        median: fmt(median(sorted)),
        std: fmt(Math.sqrt(variance)),
        min: Math.min(...vals),
        max: Math.max(...vals),
      };
    }

    case 'plot_metric_vs_time': {
      const metric = resolveCol(rows, args.metric) || args.metric;
      // Prefer published_at (ISO) for proper time ordering; fallback to release_date
      const dateCol = availableHeaders.find((h) => /^published_at$/i.test(h))
        || availableHeaders.find((h) => /release_date|date|published/i.test(h))
        || 'published_at';
      const chartData = rows
        .map((r) => ({
          date: r[dateCol] || r.published_at || r.release_date || '',
          value: parseFloat(r[metric]),
          name: (r.title || r.name || '').slice(0, 30),
        }))
        .filter((d) => !isNaN(d.value) && d.date)
        .sort((a, b) => new Date(a.date) - new Date(b.date));
      if (!chartData.length)
        return { error: `No valid data for ${metric} vs time. Check field names.` };
      return {
        _chartType: 'metricVsTime',
        data: chartData,
        metricColumn: metric,
      };
    }

    case 'play_video': {
      const sel = String(args.selector || '').toLowerCase();
      let video = null;
      const hasUrl = (r) => r.video_url || r.url;
      const getViews = (r) => parseFloat(r.view_count || r.views || 0) || 0;
      if (sel === 'first' || sel === '1') {
        video = rows[0];
      } else if (sel === 'last' || sel === 'most recent') {
        video = rows[rows.length - 1];
      } else if (sel === 'most viewed' || sel === 'most views') {
        video = [...rows].sort((a, b) => getViews(b) - getViews(a))[0];
      } else if (sel === 'least viewed') {
        video = [...rows].sort((a, b) => getViews(a) - getViews(b))[0];
      } else {
        video = rows.find((r) => (r.title || '').toLowerCase().includes(sel));
      }
      if (!video || !hasUrl(video))
        return { error: `Video not found for "${args.selector}". Try "first", "most viewed", or a title keyword.` };
      return {
        _videoCard: true,
        title: video.title || 'Video',
        thumbnail: video.thumbnail || '',
        url: video.video_url || video.url,
      };
    }

    case 'generateImage': {
      try {
        // Use user's image as anchor if they attached one (AI can't pass base64 in function args)
        const anchorBase64 = args.anchorImageBase64 || userImages[0]?.data || null;
        const res = await fetch(`${getApi()}/api/generate-image`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: args.prompt,
            anchorImageBase64: anchorBase64,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Image generation failed');
        return { _generatedImage: true, data: data.imageBase64, mimeType: data.mimeType || 'image/png' };
      } catch (err) {
        return { error: err.message || 'Image generation failed' };
      }
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
};
