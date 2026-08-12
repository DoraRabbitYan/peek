(function attachTuzaiCore(root) {
  "use strict";

  const STATUS_PATTERN = /^\/(?:i\/web\/)?([^/?#]+)\/status\/(\d+)/i;
  const PROFILE_PATTERN = /^\/([A-Za-z0-9_]+)\/?$/;

  function normalizePostUrl(href, baseUrl = "https://x.com/") {
    if (!href || typeof href !== "string") return null;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return null;
    }

    if (!/^(?:x|twitter)\.com$/i.test(url.hostname.replace(/^www\./, ""))) return null;
    const match = url.pathname.match(STATUS_PATTERN);
    if (!match) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }

  function postIdFromUrl(href) {
    const normalized = normalizePostUrl(href);
    return normalized ? normalized.match(/\/status\/(\d+)$/)?.[1] ?? null : null;
  }

  function profileHandle(profileHref) {
    return String(profileHref || "").match(PROFILE_PATTERN)?.[1]?.toLowerCase() || null;
  }

  function selectOwnPostUrl(hrefs, profileHref, baseUrl = "https://x.com/") {
    const normalized = [...new Set((hrefs || []).map((href) => normalizePostUrl(href, baseUrl)).filter(Boolean))];
    const handle = profileHandle(profileHref);
    if (!handle) return normalized[0] || null;
    return normalized.find((url) => new URL(url).pathname.split("/")[1]?.toLowerCase() === handle) || normalized[0] || null;
  }

  function objectValue(value) {
    return value && typeof value === "object" ? value : null;
  }

  function unwrapResult(value) {
    let current = objectValue(value);
    for (let index = 0; current && index < 6; index += 1) {
      if (current.legacy && current.rest_id) return current;
      if (objectValue(current.tweet)) {
        current = current.tweet;
        continue;
      }
      if (objectValue(current.result)) {
        current = current.result;
        continue;
      }
      break;
    }
    return current?.legacy && current?.rest_id ? current : null;
  }

  function unwrapUser(value) {
    let current = objectValue(value);
    for (let index = 0; current && index < 4; index += 1) {
      const hasProfile = current.legacy?.screen_name || current.core?.screen_name || current.avatar?.image_url;
      if (hasProfile || current.__typename === "User") return current;
      if (objectValue(current.result)) {
        current = current.result;
        continue;
      }
      break;
    }
    return current?.legacy || current?.core ? current : null;
  }

  function numberValue(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function selectVideoVariant(variants, targetBitrate = 1200000) {
    const candidates = (variants || [])
      .filter((variant) => variant?.url)
      .map((variant) => ({ url: String(variant.url), bitrate: numberValue(variant.bitrate) }))
      .sort((left, right) => {
        if (left.bitrate > 0 && right.bitrate <= 0) return -1;
        if (left.bitrate <= 0 && right.bitrate > 0) return 1;
        return left.bitrate - right.bitrate;
      });
    if (!candidates.length) return null;
    const measured = candidates.filter((variant) => variant.bitrate > 0);
    if (!measured.length) return candidates[0];
    const withinTarget = measured.filter((variant) => variant.bitrate <= targetBitrate);
    return withinTarget.at(-1) || measured[0];
  }

  function entityRanges(entitySet) {
    const source = objectValue(entitySet) || {};
    const ranges = [];
    for (const item of source.urls || []) {
      if (!Array.isArray(item.indices)) continue;
      ranges.push({
        start: item.indices[0],
        end: item.indices[1],
        kind: "url",
        label: item.display_url || item.expanded_url || item.url,
        url: item.expanded_url || item.url
      });
    }
    for (const item of source.user_mentions || []) {
      if (!Array.isArray(item.indices)) continue;
      ranges.push({
        start: item.indices[0],
        end: item.indices[1],
        kind: "mention",
        label: `@${item.screen_name}`,
        url: `https://x.com/${item.screen_name}`
      });
    }
    for (const item of source.hashtags || []) {
      if (!Array.isArray(item.indices)) continue;
      ranges.push({
        start: item.indices[0],
        end: item.indices[1],
        kind: "hashtag",
        label: `#${item.text}`,
        url: `https://x.com/hashtag/${encodeURIComponent(item.text || "")}`
      });
    }
    for (const item of source.media || []) {
      if (!Array.isArray(item.indices)) continue;
      ranges.push({
        start: item.indices[0],
        end: item.indices[1],
        kind: "media",
        label: "",
        url: ""
      });
    }
    return ranges
      .filter((item) => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  }

  function mediaItems(legacy, tweet) {
    const modernMedia = Array.isArray(tweet?.media)
      ? tweet.media
      : tweet?.media?.all || tweet?.media?.media || [];
    const media = legacy?.extended_entities?.media || legacy?.entities?.media || modernMedia;
    return media.map((item) => {
      const variantGroups = [
        item.video_info?.variants,
        item.videoInfo?.variants,
        item.media_info?.variants,
        item.media_info?.video_info?.variants,
        item.video_config?.variants
      ].filter(Array.isArray);
      const rawVariants = variantGroups.flat();
      const seenVariantUrls = new Set();
      const uniqueVariants = rawVariants.filter((variant) => {
        const url = String(variant?.url || "");
        if (!url || seenVariantUrls.has(url)) return false;
        seenVariantUrls.add(url);
        return true;
      });
      const variants = uniqueVariants
        .filter((variant) => {
          const contentType = String(variant.content_type || variant.contentType || "").toLowerCase();
          const url = String(variant.url || "");
          return contentType.startsWith("video/mp4") || /\.mp4(?:\?|$)/i.test(url);
        })
        .map((variant) => ({ url: String(variant.url), bitrate: numberValue(variant.bitrate) }))
        .sort((left, right) => left.bitrate - right.bitrate);
      const hlsVariant = uniqueVariants.find((variant) => {
        const contentType = String(variant.content_type || variant.contentType || "").toLowerCase();
        const url = String(variant.url || "");
        return contentType.includes("mpegurl") || /\.m3u8(?:\?|$)/i.test(url);
      });
      const preferredVariant = selectVideoVariant(variants);
      const rawType = String(item.type || item.media_type || item.__typename || "").toLowerCase();
      const hasVideoData = rawVariants.length > 0 || Boolean(item.video_info || item.videoInfo || item.video_config);
      const type = rawType.includes("animated") || rawType === "gif"
        ? "animated_gif"
        : rawType.includes("video") || hasVideoData
          ? "video"
          : rawType || "photo";
      return {
        id: item.id_str || item.media_key || item.media_url_https,
        type,
        url: item.media_url_https || item.media_url || "",
        videoUrl: preferredVariant?.url || "",
        videoVariants: variants,
        hlsUrl: String(hlsVariant?.url || ""),
        expandedUrl: item.expanded_url || "",
        width: numberValue(item.original_info?.width || item.sizes?.large?.w),
        height: numberValue(item.original_info?.height || item.sizes?.large?.h)
      };
    }).filter((item) => item.url || item.videoUrl || item.hlsUrl);
  }

  function tweetModel(value, depth = 0) {
    const tweet = unwrapResult(value);
    if (!tweet) return null;
    const legacy = tweet.legacy || {};
    const user = unwrapUser(tweet.core?.user_results) || unwrapUser(tweet.user_results);
    const userLegacy = user?.legacy || {};
    const userCore = user?.core || {};
    const note = tweet.note_tweet?.note_tweet_results?.result;
    const text = typeof note?.text === "string" ? note.text : String(legacy.full_text || legacy.text || "");
    const entities = note?.entity_set || legacy.entities || {};
    const handle = userLegacy.screen_name || userCore.screen_name || "";
    const id = String(tweet.rest_id || legacy.id_str || "");
    const quoted = depth < 1 ? tweetModel(tweet.quoted_status_result, depth + 1) : null;
    return {
      id,
      url: handle && id ? `https://x.com/${handle}/status/${id}` : id ? `https://x.com/i/status/${id}` : "",
      text,
      entities: entityRanges(entities),
      author: {
        id: String(user?.rest_id || userLegacy.id_str || ""),
        name: userLegacy.name || userCore.name || handle || "X 用户",
        handle,
        avatar: String(userLegacy.profile_image_url_https || user?.avatar?.image_url || "").replace("_normal.", "_200x200."),
        verified: Boolean(user?.is_blue_verified || userLegacy.verified || user?.verification?.verified || user?.verification?.is_blue_verified)
      },
      createdAt: legacy.created_at || "",
      conversationId: String(legacy.conversation_id_str || ""),
      inReplyToId: String(legacy.in_reply_to_status_id_str || ""),
      counts: {
        replies: numberValue(legacy.reply_count),
        reposts: numberValue(legacy.retweet_count),
        likes: numberValue(legacy.favorite_count),
        bookmarks: numberValue(legacy.bookmark_count),
        quotes: numberValue(legacy.quote_count),
        views: numberValue(tweet.views?.count)
      },
      flags: {
        liked: Boolean(legacy.favorited),
        reposted: Boolean(legacy.retweeted || legacy.current_user_retweet?.id_str),
        bookmarked: Boolean(legacy.bookmarked)
      },
      media: mediaItems(legacy, tweet),
      quote: quoted
    };
  }

  function mergeModelFallback(model, fallback) {
    if (!model) return fallback || null;
    if (!fallback) return model;
    const fallbackAuthor = fallback.author || {};
    const author = model.author || {};
    const placeholderName = !author.name || /^(?:X 用户|X User)$/i.test(author.name);
    const primaryMedia = Array.isArray(model.media) ? model.media : [];
    const fallbackMedia = Array.isArray(fallback.media) ? fallback.media : [];
    const media = primaryMedia.length
      ? primaryMedia.map((item, index) => {
        const supplement = fallbackMedia[index];
        if (!supplement) return item;
        const primaryHasPlayableVideo = Boolean(item.videoUrl || item.hlsUrl);
        const fallbackSaysVideo = supplement.type === "video" || supplement.type === "animated_gif";
        return {
          ...item,
          type: fallbackSaysVideo && !primaryHasPlayableVideo ? supplement.type : item.type,
          url: item.url || supplement.url || "",
          videoUrl: item.videoUrl || supplement.videoUrl || "",
          videoVariants: item.videoVariants?.length ? item.videoVariants : supplement.videoVariants || [],
          hlsUrl: item.hlsUrl || supplement.hlsUrl || "",
          expandedUrl: item.expandedUrl || supplement.expandedUrl || fallback.url || model.url || "",
          width: item.width || supplement.width || 0,
          height: item.height || supplement.height || 0
        };
      })
      : fallbackMedia;
    return {
      ...model,
      text: model.text || fallback.text || "",
      createdAt: model.createdAt || fallback.createdAt || "",
      author: {
        ...author,
        name: placeholderName ? fallbackAuthor.name || author.name : author.name,
        handle: author.handle || fallbackAuthor.handle || "",
        avatar: author.avatar || fallbackAuthor.avatar || "",
        verified: Boolean(author.verified || fallbackAuthor.verified)
      },
      media
    };
  }

  function collectTweetModels(value) {
    const models = [];
    const seenNodes = new Set();
    const seenTweets = new Set();

    function visit(node) {
      if (!node || typeof node !== "object" || seenNodes.has(node)) return;
      seenNodes.add(node);
      const result = node.tweet_results?.result;
      if (result) {
        const model = tweetModel(result);
        if (model?.id && !seenTweets.has(model.id)) {
          seenTweets.add(model.id);
          models.push(model);
        }
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      for (const child of Object.values(node)) visit(child);
    }

    visit(value);
    return models;
  }

  function bottomCursor(value) {
    let cursor = null;
    let fallback = null;
    const seen = new Set();
    function visit(node) {
      if (cursor || !node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (/^Bottom$/i.test(String(node.cursorType || "")) && typeof node.value === "string") {
        cursor = node.value;
        return;
      }
      if (/^(?:ShowMoreThreads|ShowMoreThread)$/i.test(String(node.cursorType || "")) && typeof node.value === "string" && !fallback) fallback = node.value;
      if (Array.isArray(node)) node.forEach(visit);
      else for (const child of Object.values(node)) visit(child);
    }
    visit(value);
    return cursor || fallback;
  }

  function parseTweetDetail(json, focalTweetId) {
    const focalId = String(focalTweetId || "");
    const models = collectTweetModels(json?.data || json);
    const byId = new Map(models.map((model) => [model.id, model]));
    const focal = byId.get(focalId) || null;

    function descendsFromFocal(model) {
      if (!focal || !model || model.id === focalId) return false;
      if (model.inReplyToId === focalId) return true;
      const visited = new Set([model.id]);
      let parentId = model.inReplyToId;
      while (parentId && !visited.has(parentId)) {
        if (parentId === focalId) return true;
        visited.add(parentId);
        parentId = byId.get(parentId)?.inReplyToId || "";
      }
      return model.conversationId === focalId;
    }

    const replies = models.filter((model) => focal ? descendsFromFocal(model) : model.id !== focalId);
    for (const reply of replies) {
      let depth = 0;
      let parentId = reply.inReplyToId;
      const visited = new Set([reply.id]);
      while (parentId && parentId !== focalId && byId.has(parentId) && !visited.has(parentId)) {
        depth += 1;
        visited.add(parentId);
        parentId = byId.get(parentId)?.inReplyToId || "";
      }
      reply.depth = Math.min(depth, 3);
    }

    return { focal, replies, cursor: bottomCursor(json) };
  }

  root.TuzaiCore = Object.freeze({
    normalizePostUrl,
    postIdFromUrl,
    profileHandle,
    selectOwnPostUrl,
    selectVideoVariant,
    tweetModel,
    mergeModelFallback,
    collectTweetModels,
    parseTweetDetail
  });
})(typeof globalThis === "object" ? globalThis : self);
