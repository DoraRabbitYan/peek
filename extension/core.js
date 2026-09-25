(function attachTuzaiCore(root) {
  "use strict";

  const STATUS_PATTERN = /^\/(?:i\/web\/)?([^/?#]+)\/status\/(\d+)/i;
  const PROFILE_PATTERN = /^\/@?([A-Za-z0-9_]+)(?:[/?#]|$)/;

  function decodeHtml(text) {
    if (!text || typeof text !== "string" || !text.includes("&")) return text || "";
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#x2F;/g, "/")
      .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)));
  }

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

  function isPostDetailUrl(href, baseUrl = "https://x.com/") {
    return Boolean(normalizePostUrl(href, baseUrl));
  }

  function profileHandle(profileHref) {
    if (!profileHref || typeof profileHref !== "string") return null;
    let path = profileHref;
    if (path.startsWith("http://") || path.startsWith("https://")) {
      try { path = new URL(profileHref).pathname; } catch { path = profileHref; }
    }
    return String(path).match(PROFILE_PATTERN)?.[1]?.toLowerCase() || null;
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
      .map((variant) => ({ ...variant, url: String(variant.url), bitrate: numberValue(variant.bitrate) }))
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

  function inferVideoQuality(width, height, url = "", bitrate = 0, name = "") {
    const parsedWidth = numberValue(width);
    const parsedHeight = numberValue(height);
    if (parsedWidth > 0 && parsedHeight > 0) return Math.min(parsedWidth, parsedHeight);
    let decodedUrl = String(url || "");
    try { decodedUrl = decodeURIComponent(decodedUrl); } catch { /* The raw URL is still searchable. */ }
    const sizeMatch = decodedUrl.match(/(\d{2,5})x(\d{2,5})/i);
    if (sizeMatch) return Math.min(Number(sizeMatch[1]), Number(sizeMatch[2]));
    const namedQuality = String(name || "").match(/(?:^|\D)(\d{3,4})p(?:\D|$)/i);
    if (namedQuality) return Number(namedQuality[1]);
    const measuredBitrate = numberValue(bitrate);
    if (!measuredBitrate) return 0;
    if (measuredBitrate <= 450000) return 320;
    if (measuredBitrate <= 1200000) return 480;
    if (measuredBitrate <= 3500000) return 720;
    return 1080;
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

  function stripLeadingMentions(text, entities = [], options = {}) {
    if (!text || typeof text !== "string") return { text: "", entities: [] };
    const currentEntities = entities || [];

    // Only hide recipients explicitly outside X's visible text range.
    // Reply targets alone cannot distinguish automatic and intentional mentions.
    const range = options?.displayTextRange;
    if (!Array.isArray(range) || range.length !== 2 ||
        !Number.isInteger(range[0]) || !Number.isInteger(range[1]) ||
        range[0] <= 0 || range[1] < range[0] || range[1] > text.length) {
      return { text, entities: currentEntities };
    }
    const prefixLength = range[0];
    const prefix = text.slice(0, prefixLength);
    // Require complete mentions and whitespace; never cut through a handle.
    if (!/^(@[A-Za-z0-9_]+\s+)+$/.test(prefix)) {
      return { text, entities: currentEntities };
    }
    if (currentEntities.some(e => e.start < prefixLength && e.end > prefixLength)) {
      return { text, entities: currentEntities };
    }

    const remainingText = text.slice(prefixLength);
    // Safety: if tweet was literally only the mention(s), keep it so we don't render a blank card
    if (!remainingText.trim()) return { text, entities: currentEntities };

    const updatedEntities = currentEntities
      .filter((e) => e.end > prefixLength)
      .map((e) => ({
        ...e,
        start: Math.max(0, e.start - prefixLength),
        end: Math.max(0, e.end - prefixLength)
      }));

    return { text: remainingText, entities: updatedEntities };
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
        .map((variant) => ({
          url: String(variant.url),
          bitrate: numberValue(variant.bitrate),
          width: numberValue(variant.width ?? variant.resolution?.width),
          height: numberValue(variant.height ?? variant.resolution?.height),
          name: String(variant.name || variant.quality || variant.resolution?.name || "")
        }))
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

  function bindingValueMap(card) {
    const values = card?.legacy?.binding_values || card?.binding_values || {};
    if (Array.isArray(values)) {
      return Object.fromEntries(values
        .filter((item) => item?.key)
        .map((item) => [item.key, item.value || {}]));
    }
    return objectValue(values) || {};
  }

  function bindingString(bindings, ...keys) {
    for (const key of keys) {
      const value = bindings[key];
      const text = value?.string_value ?? value?.stringValue ?? (typeof value === "string" ? value : "");
      if (text) return String(text);
    }
    return "";
  }

  function bindingImage(bindings, ...keys) {
    for (const key of keys) {
      const value = bindings[key]?.image_value || bindings[key]?.imageValue || bindings[key];
      const url = value?.url || value?.image_url || value?.imageUrl || "";
      if (!url) continue;
      return {
        url: String(url),
        width: numberValue(value?.width),
        height: numberValue(value?.height)
      };
    }
    return null;
  }

  function findNamedValue(root, names, maxDepth = 7) {
    const wanted = new Set(names);
    const seen = new Set();
    function visit(value, depth) {
      if (!value || typeof value !== "object" || seen.has(value) || depth > maxDepth) return null;
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        if (wanted.has(key) && child !== null && child !== undefined && child !== "") return child;
      }
      for (const child of Object.values(value)) {
        const found = visit(child, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }
    return visit(root, 0);
  }

  function articleResult(tweet) {
    let current = objectValue(tweet?.article?.article_results?.result)
      || objectValue(tweet?.article?.result)
      || objectValue(tweet?.article_results?.result)
      || objectValue(tweet?.article);
    for (let index = 0; current && index < 5; index += 1) {
      if (current.title || current.preview_text || current.cover_media || current.cover_image) return current;
      if (objectValue(current.result)) current = current.result;
      else if (objectValue(current.article)) current = current.article;
      else break;
    }
    return current;
  }

  function articleContent(article) {
    const contentState = objectValue(article?.content_state)
      || objectValue(article?.contentState)
      || objectValue(findNamedValue(article, ["content_state", "contentState"], 5));
    const rawBlocks = Array.isArray(contentState?.blocks) ? contentState.blocks : [];
    const rawEntityMap = objectValue(contentState?.entityMap)
      || objectValue(contentState?.entity_map)
      || objectValue(contentState?.entities)
      || {};

    const entities = Object.fromEntries(Object.entries(rawEntityMap).map(([key, value]) => {
      const data = objectValue(value?.data) || objectValue(value) || {};
      return [String(key), {
        type: String(value?.type || data?.type || ""),
        url: String(findNamedValue(data, ["expanded_url", "url", "href"], 4) || ""),
        image: String(findNamedValue(data, ["media_url_https", "original_img_url", "image_url", "src"], 5) || ""),
        width: numberValue(findNamedValue(data, ["original_img_width", "width"], 5)),
        height: numberValue(findNamedValue(data, ["original_img_height", "height"], 5)),
        alt: String(findNamedValue(data, ["alt_text", "alt", "description"], 4) || "")
      }];
    }));

    const blocks = rawBlocks.map((block, index) => ({
      key: String(block?.key || index),
      type: String(block?.type || "unstyled"),
      text: String(block?.text || ""),
      depth: numberValue(block?.depth),
      inlineStyles: (Array.isArray(block?.inlineStyleRanges) ? block.inlineStyleRanges : []).map((range) => ({
        offset: numberValue(range?.offset),
        length: numberValue(range?.length),
        style: String(range?.style || "")
      })).filter((range) => range.length > 0 && range.style),
      entityRanges: (Array.isArray(block?.entityRanges) ? block.entityRanges : []).map((range) => ({
        offset: numberValue(range?.offset),
        length: numberValue(range?.length),
        key: String(range?.key ?? "")
      })).filter((range) => range.length > 0 && range.key)
    }));

    const plainText = String(article?.plain_text || article?.plainText || "");
    if (!blocks.length && plainText) {
      for (const [index, text] of plainText.split(/\n{2,}/).entries()) {
        if (text.trim()) blocks.push({ key: `plain-${index}`, type: "unstyled", text: text.trim(), depth: 0, inlineStyles: [], entityRanges: [] });
      }
    }
    return blocks.length ? { blocks, entities } : null;
  }

  function firstEntityUrl(legacy, predicate = () => true) {
    const item = (legacy?.entities?.urls || []).find((entry) => {
      const url = String(entry?.expanded_url || entry?.url || "");
      return url && predicate(url, entry);
    });
    return item ? String(item.expanded_url || item.url || "") : "";
  }

  function domainFromUrl(value) {
    try {
      return new URL(value).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }

  function richAttachment(legacy, tweet) {
    const article = articleResult(tweet);
    const articleUrl = firstEntityUrl(legacy, (url) => /(?:x|twitter)\.com\/i\/article\//i.test(url));
    if (article || articleUrl) {
      const cover = objectValue(findNamedValue(article, ["cover_media", "cover_image", "preview_image"])) || article;
      const image = String(findNamedValue(cover, ["original_img_url", "media_url_https", "image_url", "url"], 5) || "");
      return {
        type: "article",
        url: articleUrl || String(findNamedValue(article, ["article_url", "url"], 4) || ""),
        sourceUrl: String(legacy?.entities?.urls?.find((entry) => /(?:x|twitter)\.com\/i\/article\//i.test(String(entry?.expanded_url || "")))?.url || ""),
        domain: "x.com",
        title: String(findNamedValue(article, ["title"], 4) || ""),
        description: String(findNamedValue(article, ["preview_text", "description", "summary"], 5) || ""),
        image,
        imageWidth: numberValue(findNamedValue(cover, ["original_img_width", "width"], 5)),
        imageHeight: numberValue(findNamedValue(cover, ["original_img_height", "height"], 5)),
        content: articleContent(article)
      };
    }

    const card = objectValue(tweet?.card);
    if (!card) return null;
    const cardName = String(card?.name || card?.legacy?.name || "");
    const bindings = bindingValueMap(card);

    const isPoll = /^(\d+:)?poll/i.test(cardName) || (Boolean(bindings["choice1_label"]) && Boolean(bindings["choice2_label"]));
    if (isPoll) {
      const options = [];
      const mediaList = Array.isArray(legacy?.extended_entities?.media) ? legacy.extended_entities.media : [];
      for (let i = 1; i <= 4; i++) {
        const label = bindingString(bindings, `choice${i}_label`);
        if (!label) break;
        const countStr = bindingString(bindings, `choice${i}_count`);
        const count = Number.parseInt(countStr || "0", 10) || 0;
        const imageBinding = bindingImage(bindings, `choice${i}_image`, `choice${i}_image_original`, `choice${i}_image_small`, `choice${i}_image_large`);
        const image = imageBinding?.url || mediaList[i - 1]?.media_url_https || "";
        options.push({
          index: i,
          label: decodeHtml(label),
          count,
          image
        });
      }
      if (options.length >= 2) {
        const totalVotes = options.reduce((sum, opt) => sum + opt.count, 0);
        const maxVotes = Math.max(...options.map((o) => o.count), 0);
        const finalVal = bindings["counts_are_final"]?.boolean_value ?? bindings["counts_are_final"]?.booleanValue ?? bindings["counts_are_final"];
        const isFinal = Boolean(finalVal === true || finalVal === "true");
        options.forEach((opt) => {
          opt.percentage = totalVotes > 0 ? ((opt.count / totalVotes) * 100).toFixed(1) : "0.0";
          opt.isWinner = totalVotes > 0 && opt.count === maxVotes;
        });
        return {
          type: "poll",
          totalVotes,
          isFinal,
          options
        };
      }
    }

    const sourceUrl = String(card?.legacy?.url || card?.url || bindingString(bindings, "card_url") || "");
    const expandedUrl = firstEntityUrl(legacy, (_url, entry) => !sourceUrl || entry?.url === sourceUrl)
      || bindingString(bindings, "vanity_url", "card_url")
      || sourceUrl;
    const image = bindingImage(bindings,
      "summary_photo_image_original",
      "player_image_original",
      "thumbnail_image_original",
      "photo_image_full_size_original",
      "thumbnail_image",
      "photo_image_full_size");
    const title = bindingString(bindings, "title");
    const description = bindingString(bindings, "description");
    const domain = bindingString(bindings, "domain") || domainFromUrl(expandedUrl);
    if (!title && !description && !image?.url) return null;
    return {
      type: "website",
      url: expandedUrl,
      sourceUrl,
      domain,
      title,
      description,
      image: image?.url || "",
      imageWidth: image?.width || 0,
      imageHeight: image?.height || 0
    };
  }

  function articleAttachmentFromPayload(value) {
    const seen = new Set();
    let article = null;
    function visit(node, depth = 0) {
      if (article || !node || typeof node !== "object" || seen.has(node) || depth > 12) return;
      seen.add(node);
      const candidate = articleResult(node);
      if (candidate?.content_state?.blocks?.length || candidate?.plain_text) {
        article = candidate;
        return;
      }
      if (Array.isArray(node)) node.forEach((child) => visit(child, depth + 1));
      else for (const child of Object.values(node)) visit(child, depth + 1);
    }
    visit(value);
    if (!article) return null;
    const cover = objectValue(findNamedValue(article, ["cover_media", "cover_image", "preview_image"])) || article;
    return {
      type: "article",
      url: String(findNamedValue(article, ["article_url", "url"], 4) || ""),
      sourceUrl: "",
      domain: "x.com",
      title: String(findNamedValue(article, ["title"], 4) || ""),
      description: String(findNamedValue(article, ["preview_text", "description", "summary"], 5) || ""),
      image: String(findNamedValue(cover, ["original_img_url", "media_url_https", "image_url", "url"], 5) || ""),
      imageWidth: numberValue(findNamedValue(cover, ["original_img_width", "width"], 5)),
      imageHeight: numberValue(findNamedValue(cover, ["original_img_height", "height"], 5)),
      content: articleContent(article)
    };
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
    const inReplyToId = String(legacy.in_reply_to_status_id_str || "");
    const inReplyToHandle = String(legacy.in_reply_to_screen_name || "");
    const displayTextRange = Array.isArray(legacy.display_text_range) ? legacy.display_text_range : null;
    const quoted = depth < 1 ? tweetModel(tweet.quoted_status_result, depth + 1) : null;
    const rawAuthorName = userLegacy.name || userCore.name || user?.name || user?.profile?.name;
    const authorName = (rawAuthorName && String(rawAuthorName).trim()) ? decodeHtml(String(rawAuthorName).trim()) : (handle || "X 用户");
    const decodedText = decodeHtml(text);
    const parsedEntities = entityRanges(entities);
    const textInfo = inReplyToId
      ? stripLeadingMentions(decodedText, parsedEntities, { displayTextRange, replyToHandle: inReplyToHandle })
      : { text: decodedText, entities: parsedEntities };
    const attachment = richAttachment(legacy, tweet);
    const media = attachment?.type === "poll" ? [] : mediaItems(legacy, tweet);
    return {
      id,
      url: handle && id ? `https://x.com/${handle}/status/${id}` : id ? `https://x.com/i/status/${id}` : "",
      text: textInfo.text,
      rawText: decodedText,
      entities: textInfo.entities,
      author: {
        id: String(user?.rest_id || userLegacy.id_str || ""),
        name: authorName,
        handle,
        avatar: String(userLegacy.profile_image_url_https || user?.avatar?.image_url || "").replace("_normal.", "_200x200."),
        verified: Boolean(user?.is_blue_verified || userLegacy.verified || user?.verification?.verified || user?.verification?.is_blue_verified),
        description: decodeHtml(String(userLegacy.description || userCore.description || user?.profile_bio?.description || "")),
        followers: numberValue(userLegacy.followers_count ?? user?.relationship_counts?.followers_count ?? user?.relationship_counts?.followers),
        followingCount: numberValue(userLegacy.friends_count ?? user?.relationship_counts?.following_count ?? user?.relationship_counts?.following),
        viewerFollowing: Boolean(userLegacy.following || user?.relationship_perspectives?.following),
        followRequestSent: Boolean(userLegacy.follow_request_sent || user?.relationship_perspectives?.follow_request_sent),
        followsViewer: Boolean(userLegacy.followed_by || user?.relationship_perspectives?.followed_by)
      },
      createdAt: legacy.created_at || "",
      conversationId: String(legacy.conversation_id_str || ""),
      inReplyToId: String(legacy.in_reply_to_status_id_str || ""),
      inReplyToHandle,
      displayTextRange,
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
      media,
      attachment,
      quote: quoted
    };
  }

  function mergeModelFallback(model, fallback) {
    if (!model) return fallback || null;
    if (!fallback) return model;
    const fallbackAuthor = fallback.author || {};
    const author = model.author || {};
    const placeholderName = !author.name || !String(author.name).trim() || /^(?:X 用户|X User)$/i.test(String(author.name).trim());
    const isPoll = model.attachment?.type === "poll" || fallback.attachment?.type === "poll";
    const primaryMedia = isPoll ? [] : (Array.isArray(model.media) ? model.media : []);
    const fallbackMedia = isPoll ? [] : (Array.isArray(fallback.media) ? fallback.media : []);
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
          height: item.height || supplement.height || 0,
          playbackWidth: supplement.playbackWidth || item.playbackWidth || 0,
          playbackHeight: supplement.playbackHeight || item.playbackHeight || 0
        };
      })
      : fallbackMedia;
    let attachment = null;
    if (model.attachment?.type === "poll") {
      attachment = model.attachment;
    } else if (fallback.attachment?.type === "poll") {
      attachment = fallback.attachment;
    } else if (model.attachment && fallback.attachment) {
      attachment = {
        ...fallback.attachment,
        ...model.attachment,
        type: model.attachment.type || fallback.attachment.type,
        url: model.attachment.url || fallback.attachment.url || model.url || "",
        sourceUrl: model.attachment.sourceUrl || fallback.attachment.sourceUrl || "",
        domain: model.attachment.domain || fallback.attachment.domain || "",
        title: model.attachment.title || fallback.attachment.title || "",
        description: model.attachment.description || fallback.attachment.description || "",
        image: model.attachment.image || fallback.attachment.image || "",
        imageWidth: model.attachment.imageWidth || fallback.attachment.imageWidth || 0,
        imageHeight: model.attachment.imageHeight || fallback.attachment.imageHeight || 0,
        content: model.attachment.content || fallback.attachment.content || null
      };
    } else {
      attachment = model.attachment || fallback.attachment || null;
    }
    return {
      ...model,
      text: model.text || fallback.text || "",
      createdAt: model.createdAt || fallback.createdAt || "",
      author: {
        ...author,
        name: placeholderName ? fallbackAuthor.name || author.name : author.name,
        handle: author.handle || fallbackAuthor.handle || "",
        avatar: author.avatar || fallbackAuthor.avatar || "",
        verified: Boolean(author.verified || fallbackAuthor.verified),
        description: author.description || fallbackAuthor.description || "",
        followers: author.followers || fallbackAuthor.followers || 0,
        followingCount: author.followingCount || fallbackAuthor.followingCount || 0,
        viewerFollowing: Boolean(author.viewerFollowing || fallbackAuthor.viewerFollowing),
        followRequestSent: Boolean(author.followRequestSent || fallbackAuthor.followRequestSent),
        followsViewer: Boolean(author.followsViewer || fallbackAuthor.followsViewer)
      },
      media,
      attachment
    };
  }

  function collectTweetModels(value) {
    const models = [];
    const seenNodes = new Set();
    const seenTweets = new Set();

    function visit(node) {
      if (!node || typeof node !== "object" || seenNodes.has(node)) return;
      seenNodes.add(node);
      const result = node.tweet_results?.result || node.tweetResult?.result;
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

  function replyCursorAfterPage(previousCursor, nextCursor, addedCount) {
    const next = String(nextCursor || "");
    return Number(addedCount) > 0 && next && next !== String(previousCursor || "") ? next : null;
  }

  function parseTweetDetail(json, focalTweetId) {
    const focalId = String(focalTweetId || "");
    const models = collectTweetModels(json?.data || json);
    const byId = new Map(models.map((model) => [model.id, model]));
    const focal = byId.get(focalId) || null;

    // TweetDetail responses may append a “Discover more” recommendation module.
    // If X omitted the requested focal tweet, there is no trustworthy conversation
    // boundary, so fail closed instead of treating every injected tweet as a reply.
    if (!focal) return { focal: null, ancestors: [], replies: [], cursor: null };

    const ancestors = [];
    const visited = new Set([focalId]);
    let parentId = focal.inReplyToId;
    while (parentId && byId.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      const parent = byId.get(parentId);
      ancestors.unshift(parent);
      parentId = parent.inReplyToId;
    }
    const conversationRoot = byId.get(focal.conversationId);
    if (conversationRoot && conversationRoot.id !== focalId && !ancestors.some((model) => model.id === conversationRoot.id)) {
      ancestors.unshift(conversationRoot);
    }

    function descendsFromFocal(model) {
      if (!model || model.id === focalId) return false;
      if (model.inReplyToId === focalId) return true;
      const visited = new Set([model.id]);
      let parentId = model.inReplyToId;
      while (parentId && !visited.has(parentId)) {
        if (parentId === focalId) return true;
        visited.add(parentId);
        parentId = byId.get(parentId)?.inReplyToId || "";
      }
      return false;
    }

    const replies = models.filter(descendsFromFocal);
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

    return { focal, ancestors, replies, cursor: bottomCursor(json) };
  }

  root.TuzaiCore = Object.freeze({
    decodeHtml,
    normalizePostUrl,
    postIdFromUrl,
    isPostDetailUrl,
    profileHandle,
    selectOwnPostUrl,
    selectVideoVariant,
    inferVideoQuality,
    tweetModel,
    mergeModelFallback,
    collectTweetModels,
    articleAttachmentFromPayload,
    replyCursorAfterPage,
    stripLeadingMentions,
    parseTweetDetail
  });
})(typeof globalThis === "object" ? globalThis : self);
