import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("extension/core.js"), "utf8");
const context = vm.createContext({ URL, globalThis: {} });
vm.runInContext(source, context);
const Core = context.globalThis.TuzaiCore;

test("normalizes X and legacy Twitter status links", () => {
  assert.equal(Core.normalizePostUrl("/maker/status/2087155564904370681/photo/1"), "https://x.com/maker/status/2087155564904370681");
  assert.equal(Core.normalizePostUrl("https://twitter.com/example/status/123?ref=home"), "https://x.com/example/status/123");
});

test("rejects non-status and non-X links", () => {
  assert.equal(Core.normalizePostUrl("https://example.com/person/status/123"), null);
  assert.equal(Core.normalizePostUrl("https://x.com/explore"), null);
});

test("recognizes X post detail routes so the timeline reader can stand down", () => {
  assert.equal(Core.isPostDetailUrl("https://x.com/author/status/123"), true);
  assert.equal(Core.isPostDetailUrl("https://x.com/author/status/123/photo/1"), true);
  assert.equal(Core.isPostDetailUrl("https://x.com/notifications"), false);
  assert.equal(Core.isPostDetailUrl("https://x.com/home"), false);
});

test("ends reply pagination when X returns no new comments or repeats a cursor", () => {
  assert.equal(Core.replyCursorAfterPage("cursor-1", "cursor-2", 3), "cursor-2");
  assert.equal(Core.replyCursorAfterPage("cursor-1", "cursor-2", 0), null);
  assert.equal(Core.replyCursorAfterPage("cursor-1", "cursor-1", 3), null);
  assert.equal(Core.replyCursorAfterPage("cursor-1", "", 3), null);
});

test("fails closed when TweetDetail omits the focal post and only returns injected recommendations", () => {
  const recommendation = {
    rest_id: "900",
    core: { user_results: { result: { rest_id: "u900", legacy: { name: "Recommended", screen_name: "recommended" } } } },
    legacy: {
      id_str: "900",
      full_text: "发现更多里的无关帖子",
      conversation_id_str: "900",
      entities: { urls: [], user_mentions: [], hashtags: [] }
    }
  };
  const parsed = Core.parseTweetDetail({
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ entries: [
          { entryId: "tweet-900", content: { itemContent: { tweet_results: { result: recommendation } } } },
          { entryId: "cursor-bottom", content: { cursorType: "Bottom", value: "discover-more" } }
        ] }]
      }
    }
  }, "100");

  assert.equal(parsed.focal, null);
  assert.deepEqual(Array.from(parsed.ancestors), []);
  assert.deepEqual(Array.from(parsed.replies), []);
  assert.equal(parsed.cursor, null);
});

test("keeps only tweets whose reply chain reaches the focal post", () => {
  const user = (id) => ({ rest_id: `u${id}`, legacy: { name: `User ${id}`, screen_name: `user${id}` } });
  const tweet = (id, conversationId, parent = "") => ({
    rest_id: id,
    core: { user_results: { result: user(id) } },
    legacy: {
      id_str: id,
      full_text: `tweet ${id}`,
      conversation_id_str: conversationId,
      in_reply_to_status_id_str: parent,
      entities: { urls: [], user_mentions: [], hashtags: [] }
    }
  });
  const focal = tweet("100", "100");
  const realReply = tweet("101", "100", "100");
  const nestedReply = tweet("102", "100", "101");
  const recommendation = tweet("900", "100");
  const entries = [focal, realReply, nestedReply, recommendation].map((result) => ({ tweet_results: { result } }));
  const parsed = Core.parseTweetDetail({ data: { entries } }, "100");

  assert.deepEqual(Array.from(parsed.replies, (reply) => reply.id), ["101", "102"]);
});

test("selects the source author's status link instead of a quoted status", () => {
  const hrefs = [
    "/quoted/status/100/photo/1",
    "/author/status/200",
    "/author/status/200/analytics"
  ];
  assert.equal(Core.selectOwnPostUrl(hrefs, "/author"), "https://x.com/author/status/200");
  assert.equal(Core.postIdFromUrl("https://x.com/author/status/200/photo/1"), "200");
});

test("extracts the quoted post target from its containing tweet payload", () => {
  const quoted = {
    rest_id: "300",
    core: { user_results: { result: { rest_id: "u300", legacy: { name: "Quoted", screen_name: "quoted_author" } } } },
    legacy: {
      id_str: "300",
      full_text: "引用帖正文",
      conversation_id_str: "300",
      entities: { urls: [], user_mentions: [], hashtags: [] }
    }
  };
  const outer = Core.tweetModel({
    rest_id: "200",
    core: { user_results: { result: { rest_id: "u200", legacy: { name: "Outer", screen_name: "outer_author" } } } },
    legacy: {
      id_str: "200",
      full_text: "外层帖子",
      conversation_id_str: "200",
      entities: { urls: [], user_mentions: [], hashtags: [] }
    },
    quoted_status_result: { result: quoted }
  });

  assert.equal(outer.quote.id, "300");
  assert.equal(outer.quote.url, "https://x.com/quoted_author/status/300");
});

test("keeps quoted-post media out of the outer post media collection", () => {
  const quoted = {
    rest_id: "301",
    core: { user_results: { result: { rest_id: "u301", legacy: { name: "Quoted", screen_name: "quoted_author" } } } },
    legacy: {
      id_str: "301",
      full_text: "带图片的引用帖",
      conversation_id_str: "301",
      entities: { urls: [], user_mentions: [], hashtags: [] },
      extended_entities: {
        media: [{ id_str: "quoted-image", type: "photo", media_url_https: "https://img.example/quoted.jpg" }]
      }
    }
  };
  const outer = Core.tweetModel({
    rest_id: "201",
    core: { user_results: { result: { rest_id: "u201", legacy: { name: "Outer", screen_name: "outer_author" } } } },
    legacy: {
      id_str: "201",
      full_text: "没有图片的外层帖子",
      conversation_id_str: "201",
      entities: { urls: [], user_mentions: [], hashtags: [] }
    },
    quoted_status_result: { result: quoted }
  });

  assert.equal(outer.media.length, 0);
  assert.equal(outer.quote.media.length, 1);
  assert.equal(outer.quote.media[0].url, "https://img.example/quoted.jpg");
});

test("parses focal post, nested replies, media and the bottom cursor", () => {
  const user = (id, name, screenName) => ({
    rest_id: id,
    is_blue_verified: true,
    legacy: { name, screen_name: screenName, profile_image_url_https: `https://img.example/${id}_normal.jpg` }
  });
  const tweet = (id, author, text, parent = "", extra = {}) => ({
    rest_id: id,
    core: { user_results: { result: author } },
    views: { count: "1234" },
    legacy: {
      id_str: id,
      full_text: text,
      created_at: "Tue Aug 12 12:00:00 +0000 2026",
      conversation_id_str: "100",
      in_reply_to_status_id_str: parent,
      reply_count: 2,
      retweet_count: 3,
      favorite_count: 4,
      bookmark_count: 5,
      entities: { urls: [], user_mentions: [], hashtags: [] },
      ...extra
    }
  });
  const focal = tweet("100", user("u1", "作者", "author"), "原帖");
  const firstReply = tweet("101", user("u2", "甲", "one"), "一级评论", "100", {
    extended_entities: {
      media: [{
        id_str: "m1",
        type: "video",
        media_url_https: "https://img.example/poster.jpg",
        video_info: { variants: [
          { content_type: "video/mp4", bitrate: 256000, url: "https://video.example/low.mp4" },
          { content_type: "video/mp4", bitrate: 832000, url: "https://video.example/medium.mp4" },
          { content_type: "video/mp4", bitrate: 2176000, url: "https://video.example/high.mp4" }
        ] }
      }]
    }
  });
  const nestedReply = tweet("102", user("u3", "乙", "two"), "二级评论", "101");
  const json = {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [{ entries: [
          { entryId: "tweet-100", content: { itemContent: { tweet_results: { result: focal } } } },
          { entryId: "conversationthread-101", content: { items: [
            { item: { itemContent: { tweet_results: { result: firstReply } } } },
            { item: { itemContent: { tweet_results: { result: nestedReply } } } }
          ] } },
          { entryId: "cursor-bottom", content: { cursorType: "Bottom", value: "cursor-next" } }
        ] }]
      }
    }
  };
  const parsed = Core.parseTweetDetail(json, "100");
  assert.equal(parsed.focal.id, "100");
  assert.equal(parsed.focal.author.handle, "author");
  assert.equal(parsed.focal.counts.views, 1234);
  assert.deepEqual(Array.from(parsed.ancestors, (model) => model.id), []);
  assert.equal(parsed.replies.length, 2);
  assert.equal(parsed.replies[0].media[0].videoUrl, "https://video.example/medium.mp4");
  assert.equal(Core.selectVideoVariant(parsed.replies[0].media[0].videoVariants, 500000).url, "https://video.example/low.mp4");
  assert.equal(parsed.replies[1].depth, 1);
  assert.equal(parsed.cursor, "cursor-next");
});

test("returns the complete parent chain when the clicked notification post is a reply", () => {
  const author = (id, screenName) => ({
    rest_id: id,
    legacy: { name: screenName, screen_name: screenName, profile_image_url_https: `https://img.example/${id}_normal.jpg` }
  });
  const tweet = (id, parent, screenName) => ({
    rest_id: id,
    core: { user_results: { result: author(`u-${id}`, screenName) } },
    legacy: {
      id_str: id,
      full_text: `帖子 ${id}`,
      conversation_id_str: "500",
      in_reply_to_status_id_str: parent,
      entities: { urls: [], user_mentions: [], hashtags: [] }
    }
  });
  const root = tweet("500", "", "root");
  const parent = tweet("501", "500", "parent");
  const focalReply = tweet("502", "501", "focal");
  const childReply = tweet("503", "502", "child");
  const sibling = tweet("504", "501", "sibling");
  const json = { data: { thread: [
    { tweet_results: { result: childReply } },
    { tweet_results: { result: parent } },
    { tweet_results: { result: focalReply } },
    { tweet_results: { result: root } },
    { tweet_results: { result: sibling } }
  ] } };

  const parsed = Core.parseTweetDetail(json, "502");
  assert.equal(parsed.focal.id, "502");
  assert.deepEqual(Array.from(parsed.ancestors, (model) => model.id), ["500", "501"]);
  assert.deepEqual(Array.from(parsed.replies, (model) => model.id), ["503"]);
  assert.equal(parsed.replies[0].depth, 0);
});

test("keeps current X video variants when the MIME type has parameters or bitrate is absent", () => {
  const result = Core.tweetModel({
    rest_id: "150",
    legacy: {
      id_str: "150",
      full_text: "视频帖",
      conversation_id_str: "150",
      entities: { urls: [], user_mentions: [], hashtags: [] },
      extended_entities: {
        media: [{
          id_str: "video-150",
          type: "photo",
          media_url_https: "https://img.example/video-poster.jpg",
          video_info: {
            variants: [
              { content_type: "application/x-mpegURL", url: "https://video.example/master.m3u8" },
              { content_type: "video/mp4; codecs=avc1.4d001f", url: "https://video.example/fallback.mp4", bitrate: 2176000, width: 1280, height: 720, name: "720p" }
            ]
          }
        }]
      }
    }
  });

  assert.equal(result.media[0].type, "video");
  assert.equal(result.media[0].videoUrl, "https://video.example/fallback.mp4");
  assert.equal(result.media[0].videoVariants[0].bitrate, 2176000);
  assert.equal(result.media[0].videoVariants[0].width, 1280);
  assert.equal(result.media[0].videoVariants[0].height, 720);
  assert.equal(result.media[0].videoVariants[0].name, "720p");
  assert.equal(result.media[0].hlsUrl, "https://video.example/master.m3u8");
});

test("infers automatic video quality from X dimensions, names, URLs or bitrate", () => {
  assert.equal(Core.inferVideoQuality(1280, 720), 720);
  assert.equal(Core.inferVideoQuality(0, 0, "https://video.twimg.com/vid/avc1/720x1280/clip.mp4"), 720);
  assert.equal(Core.inferVideoQuality(0, 0, "", 0, "1080p"), 1080);
  assert.equal(Core.inferVideoQuality(0, 0, "", 2176000), 720);
  assert.equal(Core.inferVideoQuality(0, 0, "", 832000), 480);
});

test("preserves an HLS-only item as video instead of silently treating its poster as a photo", () => {
  const result = Core.tweetModel({
    rest_id: "151",
    legacy: {
      id_str: "151",
      full_text: "HLS 视频帖",
      conversation_id_str: "151",
      entities: { urls: [], user_mentions: [], hashtags: [] },
      extended_entities: {
        media: [{
          media_key: "video-151",
          type: "video",
          media_url_https: "https://img.example/hls-poster.jpg",
          video_info: { variants: [{ content_type: "application/vnd.apple.mpegurl", url: "https://video.example/only.m3u8" }] }
        }]
      }
    }
  });

  assert.equal(result.media[0].type, "video");
  assert.equal(result.media[0].videoUrl, "");
  assert.equal(result.media[0].hlsUrl, "https://video.example/only.m3u8");
});

test("parses X website cards instead of leaving only their short link", () => {
  const result = Core.tweetModel({
    rest_id: "160",
    legacy: {
      id_str: "160",
      full_text: "项目地址 https://t.co/card123",
      conversation_id_str: "160",
      entities: {
        urls: [{
          indices: [5, 25],
          url: "https://t.co/card123",
          expanded_url: "https://github.com/example/project",
          display_url: "github.com/example/project"
        }],
        user_mentions: [],
        hashtags: []
      }
    },
    card: {
      legacy: {
        url: "https://t.co/card123",
        binding_values: [
          { key: "domain", value: { string_value: "github.com" } },
          { key: "title", value: { string_value: "GitHub - example/project" } },
          { key: "description", value: { string_value: "项目说明" } },
          { key: "summary_photo_image_original", value: { image_value: { url: "https://img.example/card.jpg", width: 1200, height: 600 } } }
        ]
      }
    }
  });

  assert.equal(result.attachment.type, "website");
  assert.equal(result.attachment.url, "https://github.com/example/project");
  assert.equal(result.attachment.domain, "github.com");
  assert.equal(result.attachment.title, "GitHub - example/project");
  assert.equal(result.attachment.image, "https://img.example/card.jpg");
  assert.equal(result.attachment.imageWidth, 1200);
});

test("parses X articles with their cover, title, preview and rich body", () => {
  const result = Core.tweetModel({
    rest_id: "161",
    legacy: {
      id_str: "161",
      full_text: "一篇长文 https://t.co/article123",
      conversation_id_str: "161",
      entities: {
        urls: [{
          indices: [5, 28],
          url: "https://t.co/article123",
          expanded_url: "https://x.com/i/article/2087740235509809601",
          display_url: "x.com/i/article/2087…"
        }],
        user_mentions: [],
        hashtags: []
      }
    },
    article: {
      article_results: {
        result: {
          title: "轮回的真相",
          preview_text: "禅修超过 1000 小时后，我对死亡有了新的认识。",
          cover_media: {
            media_info: {
              original_img_url: "https://img.example/article.jpg",
              original_img_width: 1200,
              original_img_height: 480
            }
          },
          content_state: {
            blocks: [
              { key: "title", type: "header-one", text: "禅修 1000+ 小时后", depth: 0, inlineStyleRanges: [], entityRanges: [] },
              { key: "body", type: "unstyled", text: "死亡不是终点。", depth: 0, inlineStyleRanges: [{ offset: 0, length: 7, style: "BOLD" }], entityRanges: [] }
            ],
            entityMap: {}
          }
        }
      }
    }
  });

  assert.equal(result.attachment.type, "article");
  assert.equal(result.attachment.url, "https://x.com/i/article/2087740235509809601");
  assert.equal(result.attachment.title, "轮回的真相");
  assert.equal(result.attachment.description, "禅修超过 1000 小时后，我对死亡有了新的认识。");
  assert.equal(result.attachment.image, "https://img.example/article.jpg");
  assert.equal(result.attachment.imageHeight, 480);
  assert.equal(result.attachment.content.blocks.length, 2);
  assert.equal(result.attachment.content.blocks[0].type, "header-one");
  assert.equal(result.attachment.content.blocks[1].inlineStyles[0].style, "BOLD");
});

test("finds a hydrated X article body even when it is not wrapped as a tweet model", () => {
  const attachment = Core.articleAttachmentFromPayload({
    data: {
      tweetResult: {
        result: {
          article: {
            article_results: {
              result: {
                title: "完整长文",
                content_state: {
                  blocks: [{ key: "one", type: "unstyled", text: "正文第一段", inlineStyleRanges: [], entityRanges: [] }],
                  entityMap: {}
                }
              }
            }
          }
        }
      }
    }
  });
  assert.equal(attachment.title, "完整长文");
  assert.equal(attachment.content.blocks[0].text, "正文第一段");
});

test("parses the current X user shape when legacy profile fields are absent", () => {
  const modernUser = {
    __typename: "User",
    core: { name: "新版作者", screen_name: "modern_author" },
    avatar: { image_url: "https://img.example/u-modern_normal.jpg" },
    verification: { is_blue_verified: true },
    profile_bio: { description: "新版账号简介" },
    relationship_counts: { followers_count: 5526, following_count: 3546 },
    relationship_perspectives: { following: true, followed_by: true }
  };
  const result = Core.tweetModel({
    rest_id: "200",
    core: { user_results: { result: modernUser } },
    legacy: {
      id_str: "200",
      full_text: "新版用户结构",
      conversation_id_str: "200",
      entities: { urls: [], user_mentions: [], hashtags: [] }
    }
  });

  assert.equal(result.author.name, "新版作者");
  assert.equal(result.author.handle, "modern_author");
  assert.equal(result.author.avatar, "https://img.example/u-modern_200x200.jpg");
  assert.equal(result.author.verified, true);
  assert.equal(result.author.description, "新版账号简介");
  assert.equal(result.author.followers, 5526);
  assert.equal(result.author.followingCount, 3546);
  assert.equal(result.author.viewerFollowing, true);
  assert.equal(result.author.followsViewer, true);
});

test("fills only missing author and media fields from the clicked X DOM snapshot", () => {
  const merged = Core.mergeModelFallback({
    id: "300",
    url: "https://x.com/source/status/300",
    text: "GraphQL 正文",
    createdAt: "",
    author: { id: "", name: "X 用户", handle: "", avatar: "", verified: false },
    media: [{ type: "photo", url: "https://img.example/poster.jpg", videoUrl: "", videoVariants: [], hlsUrl: "", expandedUrl: "" }]
  }, {
    id: "300",
    url: "https://x.com/source/status/300",
    text: "DOM 正文",
    createdAt: "2026-08-13T01:00:00.000Z",
    author: { id: "", name: "真实作者", handle: "source", avatar: "https://img.example/source.jpg", verified: true },
    media: [{ type: "video", url: "https://img.example/dom-poster.jpg", videoUrl: "", videoVariants: [], hlsUrl: "", expandedUrl: "https://x.com/source/status/300", playbackWidth: 1280, playbackHeight: 720 }]
  });

  assert.equal(merged.text, "GraphQL 正文");
  assert.equal(merged.createdAt, "2026-08-13T01:00:00.000Z");
  assert.equal(merged.author.name, "真实作者");
  assert.equal(merged.author.handle, "source");
  assert.equal(merged.author.avatar, "https://img.example/source.jpg");
  assert.equal(merged.author.verified, true);
  assert.equal(merged.media[0].type, "video");
  assert.equal(merged.media[0].url, "https://img.example/poster.jpg");
  assert.equal(merged.media[0].expandedUrl, "https://x.com/source/status/300");
  assert.equal(merged.media[0].playbackWidth, 1280);
  assert.equal(merged.media[0].playbackHeight, 720);
});

test("manifest keeps permissions limited to local state and X hosts", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("extension/manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://x.com/*", "https://twitter.com/*"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(JSON.stringify(manifest).includes("tabs"), false);
  assert.equal(JSON.stringify(manifest).includes("declarativeNetRequest"), false);
  assert.deepEqual(manifest.content_scripts[0].js, ["page-bridge.js"]);
  assert.equal(manifest.content_scripts[0].world, "MAIN");
  assert.equal(manifest.content_scripts[0].run_at, "document_start");
  assert.deepEqual(manifest.content_scripts[1].css, ["content.css"]);
  assert.deepEqual(manifest.content_scripts[1].js, ["vendor/phosphor/icons.js", "vendor/brand/icon.js", "vendor/hls/hls.min.js", "core.js", "content.js"]);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.version, "0.8.10");
});

test("reader uses the page data bridge without frames, hidden tabs or cloned X DOM", async () => {
  const content = await readFile(path.resolve("extension/content.js"), "utf8");
  const bridge = await readFile(path.resolve("extension/page-bridge.js"), "utf8");
  const styles = await readFile(path.resolve("extension/content.css"), "utf8");
  const popup = await readFile(path.resolve("extension/popup/popup.html"), "utf8");
  assert.match(content, /READ_THREAD/);
  assert.match(content, /READ_ARTICLE/);
  assert.match(content, /CREATE_REPLY/);
  assert.match(content, /TOGGLE_ACTION/);
  assert.match(content, /TRANSLATE_TWEET/);
  assert.match(content, /autoTranslate/);
  assert.match(content, /MAX_TRANSLATION_CONCURRENCY = 2/);
  assert.match(content, /显示原文/);
  assert.match(content, /显示翻译/);
  assert.match(content, /renderedTranslationModels/);
  assert.match(content, /translatedTextBlock\(model\.quote, "tuzai-quote-text"/);
  assert.match(content, /startsWith\("reply"\)/);
  assert.match(content, /autoTranslate: true/);
  assert.match(content, /priority === "focal" \? "auto" : "metadata"/);
  assert.doesNotMatch(content, /preload = "none"/);
  assert.match(content, /selectVideoVariant/);
  assert.match(content, /targetVideoBitrate/);
  assert.match(content, /sharedVideoBandwidthEstimate/);
  assert.match(content, /playbackHeight/);
  assert.match(content, /desiredAutoVideoHeight/);
  assert.match(content, /desktopFocalFloor/);
  assert.match(content, /Math\.max\(desktopFocalFloor, xPlayerHint\)/);
  assert.match(content, /Core\.inferVideoQuality/);
  assert.match(content, /hlsLevelOptions/);
  assert.match(content, /\[data-testid="article-cover-image"\]/);
  assert.doesNotMatch(content, /attachVideoQualityControls|tuzai-video-quality|preferredVideoQuality|视频质量/);
  assert.doesNotMatch(styles, /\.tuzai-video-quality/);
  assert.match(content, /observeVideoWarmup/);
  assert.match(content, /rootMargin: "360px 0px"/);
  assert.match(content, /testBandwidth: true/);
  assert.match(content, /const hlsJsSupported = Boolean\(media\.hlsUrl && HlsPlayer\?\.isSupported\?\.\(\)\)/);
  assert.match(content, /&& !hlsJsSupported/);
  assert.ok(content.indexOf("const hlsJsSupported") < content.indexOf("const nativeHls"));
  assert.match(content, /enableWorker: Boolean\(workerPath\)/);
  assert.match(content, /extensionUrl\("vendor\/hls\/hls\.worker\.js"\)/);
  assert.match(content, /abrEwmaDefaultEstimateMax: 12000000/);
  assert.match(content, /snapshotArticle/);
  assert.match(content, /findClickedQuoteScope/);
  assert.match(content, /isQuotedPostLink/);
  assert.match(content, /\[role="link"\]\[tabindex="0"\]/);
  assert.match(content, /findClickedQuotedPostUrl/);
  assert.match(content, /Core\.isPostDetailUrl\(location\.href\) && !quoteScope/);
  assert.match(content, /const url = quotedUrl/);
  assert.match(content, /resolveQuotedModel/);
  assert.match(content, /requestPage\("READ_ARTICLE", \{ tweetId: outerId \}\)/);
  assert.match(content, /outer\.quote/);
  assert.match(content, /closeTranslationSettingsFromOutside/);
  assert.match(content, /\.tuzai-translation-settings, \.tuzai-translation-gear/);
  assert.match(content, /renderThreadAncestor/);
  assert.match(content, /focusFocalPostOnce/);
  assert.match(content, /resetPostScrollOnce/);
  assert.match(content, /resetPostScrollOnRender/);
  assert.match(styles, /\.tuzai-post-body\[data-has-context="false"\]\s*\{[^}]*overflow-anchor:\s*none/);
  assert.match(content, /postBody\.scrollTop = Math\.max/);
  assert.match(content, /HlsPlayer/);
  assert.match(content, /hls-adaptive/);
  assert.match(content, /tuzai-video-play/);
  assert.match(content, /pageScrollY = window\.scrollY/);
  assert.match(content, /window\.scrollTo\(pageScrollX, pageScrollY\)/);
  assert.match(content, /tuzai-media-single-video/);
  assert.match(content, /item\.style\.aspectRatio/);
  assert.match(content, /const quote = element\("section", "tuzai-quote-card"\)/);
  assert.doesNotMatch(content, /const quote = element\("a", "tuzai-quote-card"\)/);
  assert.doesNotMatch(content, /document\.body\.style\.overflow\s*=\s*"hidden"/);
  assert.doesNotMatch(content, /document\.documentElement\.style\.overflow\s*=\s*"hidden"/);
  assert.match(bridge, /TweetDetail/);
  assert.match(bridge, /TweetResultByRestId/);
  assert.match(bridge, /FavoriteTweet/);
  assert.match(bridge, /CreateRetweet/);
  assert.match(bridge, /CreateBookmark/);
  assert.match(bridge, /CreateTweet/);
  assert.match(bridge, /translation\/service\/translateTweet/);
  assert.match(bridge, /translationSource=Some\(Google\)/);
  assert.match(bridge, /webpackChunk/);
  assert.match(bridge, /x-client-transaction-id/);
  assert.doesNotMatch(content, /<iframe|createNativeFrame|tuzaiPane/);
  assert.doesNotMatch(content, /cloneNode/);
  assert.doesNotMatch(content, /TUZAI_OPEN_POST/);
  assert.doesNotMatch(content, /TUZAI_PERFORM_ACTION/);
  assert.match(styles, /\.tuzai-post-text[^}]*font-size:\s*15px[^}]*line-height:\s*20px/);
  assert.match(styles, /\.tuzai-thread-text\s*\{[^}]*font-size:\s*15px[^}]*line-height:\s*20px/);
  assert.match(content, /<strong>Peek<\/strong>/);
  assert.match(content, /globalThis\.TuzaiBrandIconDataUrl \|\| extensionUrl\("icons\/icon48\.png"\)/);
  assert.match(content, /tuzai-sort-group/);
  assert.match(content, /条回复/);
  assert.match(content, /composerExpanded/);
  assert.match(content, /composer\.dataset\.expanded/);
  assert.match(content, /Math\.min\(Math\.max\(textarea\.scrollHeight, 28\), maxHeight\)/);
  assert.doesNotMatch(content, /textarea\.maxLength\s*=\s*280|tuzai-composer-count|\/280/);
  assert.doesNotMatch(bridge, /replyText\.length\s*>\s*280|1 到 280 个字符/);
  assert.match(content, /IntersectionObserver/);
  assert.match(content, /tuzai-reply-load-sentinel/);
  assert.doesNotMatch(content, /element\("button", "tuzai-load-more"/);
  assert.match(content, /const previousScrollTop = currentReplyList\?\.scrollTop \|\| 0/);
  assert.match(content, /nextReplyList\.scrollTop = previousScrollTop/);
  assert.match(content, /const added = mergeReplies\(parsed\.replies\)/);
  assert.match(content, /state\.cursor = Core\.replyCursorAfterPage\(previousCursor, parsed\.cursor, added\)/);
  assert.doesNotMatch(content, /element\("span", "", "正在加载更多评论"\)/);
  assert.match(content, /tuzai-profile-card/);
  assert.match(content, /bindProfileHover/);
  assert.match(content, /bindProfileHover\(handle, model\.author, avatarLink\.href\)/);
  assert.doesNotMatch(content, /bindProfileHover\(secondary, model\.author, avatarLink\.href\)/);
  assert.match(content, /PROFILE_CARD_HIDE_DELAY = 650/);
  assert.match(content, /activeProfileCardKey === profileKey/);
  assert.match(content, /TOGGLE_FOLLOW/);
  assert.match(bridge, /friendships/);
  assert.doesNotMatch(bridge, /graphql\(active \? "CreateFriendship"/);
  assert.match(styles, /width:\s*min\(300px,/);
  assert.match(styles, /\.tuzai-avatar-link[^}]*width:\s*fit-content[^}]*height:\s*fit-content/);
  assert.match(styles, /\.tuzai-author-secondary[^}]*width:\s*fit-content/);
  assert.match(styles, /\.tuzai-reply-card \.tuzai-author-secondary\s*\{[^}]*flex:\s*0 1 auto/);
  assert.match(content, /tuzai-action-surface/);
  assert.match(styles, /grid-template-rows:\s*56px minmax\(0, 1fr\)/);
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1\.04fr\) minmax\(390px, 0\.96fr\)/);
  assert.match(styles, /\.tuzai-article-content[^}]*font-size:\s*15px[^}]*line-height:\s*20px/);
  assert.match(styles, /\.tuzai-article-heading h1[^}]*font-size:\s*20px/);
  assert.match(styles, /\.tuzai-action:hover \.tuzai-action-surface/);
  assert.match(styles, /\.tuzai-action-surface[^}]*height:\s*40px[^}]*border-radius:\s*999px/);
  assert.doesNotMatch(styles, /\.tuzai-action:hover\s*\{[^}]*background:/);
  assert.match(styles, /\.tuzai-composer\[data-expanded="false"\]/);
  assert.match(styles, /\.tuzai-composer\[data-expanded="true"\]/);
  assert.doesNotMatch(styles, /\.tuzai-composer\s*\{[^}]*min-height:\s*148px/);
  assert.match(content, /composerMedia/);
  assert.match(content, /addMediaFiles/);
  assert.match(bridge, /uploadMedia/);
  assert.match(bridge, /CREATE_REPLY[\s\S]*createReply\(tweetId,\s*message\.text,\s*message\.media,\s*message\.deadline\)/);
  assert.match(styles, /\.tuzai-composer-media-grid/);
  assert.match(styles, /\.tuzai-composer-upload-btn/);
  assert.match(styles, /\.tuzai-composer-media-remove/);
  assert.match(styles, /\.tuzai-composer\.tuzai-drag-over/);
  assert.doesNotMatch(content, /tuzai-pane-header/);
  assert.doesNotMatch(content, /tuzai-footer/);
  assert.doesNotMatch(bridge, /Bearer A{5,}/);
  assert.doesNotMatch(bridge, /chrome\.storage/);
  assert.match(popup, /id="auto-translate"[^>]*checked/);
  assert.match(popup, /自动翻译外语帖子/);
  assert.match(styles, /\.tuzai-translation-row/);
});

test("extension build embeds official Phosphor SVG paths without a web font", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("dist-extension/manifest.json"), "utf8"));
  const icons = await readFile(path.resolve("dist-extension/vendor/phosphor/icons.js"), "utf8");
  assert.deepEqual(manifest.content_scripts[1].css, ["content.css"]);
  assert.equal(JSON.stringify(manifest).includes("Phosphor.woff"), false);
  assert.match(icons, /chat-circle/);
  assert.match(icons, /shield-check/);
  assert.match(icons, /"image":/);
  assert.match(icons, /<path/);
});

test("extension build embeds the brand image so extension reloads cannot drop the toolbar logo", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("dist-extension/manifest.json"), "utf8"));
  const brandIcon = await readFile(path.resolve("dist-extension/vendor/brand/icon.js"), "utf8");
  assert.equal(manifest.content_scripts[1].js[1], "vendor/brand/icon.js");
  assert.match(brandIcon, /globalThis\.TuzaiBrandIconDataUrl = "data:image\/png;base64,/);
  assert.ok(brandIcon.length > 1000);
});

test("extension build bundles hls.js locally before the reader content script", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("dist-extension/manifest.json"), "utf8"));
  const hls = await readFile(path.resolve("dist-extension/vendor/hls/hls.min.js"), "utf8");
  const worker = await readFile(path.resolve("dist-extension/vendor/hls/hls.worker.js"), "utf8");
  const license = await readFile(path.resolve("dist-extension/vendor/hls/LICENSE"), "utf8");
  assert.equal(manifest.content_scripts[1].js[2], "vendor/hls/hls.min.js");
  assert.equal(manifest.web_accessible_resources[0].resources.includes("vendor/hls/hls.worker.js"), true);
  assert.match(hls, /Hls/);
  assert.ok(worker.length > 100000);
  assert.match(license, /Apache License/);
});

test("profileHandle tolerates query params, trailing slashes and @ prefixes", () => {
  assert.equal(Core.profileHandle("/ianneo_ai"), "ianneo_ai");
  assert.equal(Core.profileHandle("/@ianneo_ai"), "ianneo_ai");
  assert.equal(Core.profileHandle("/ianneo_ai/"), "ianneo_ai");
  assert.equal(Core.profileHandle("/ianneo_ai?lang=zh"), "ianneo_ai");
  assert.equal(Core.profileHandle("https://x.com/The_AlexLiu"), "the_alexliu");
  assert.equal(Core.profileHandle("https://x.com/@The_AlexLiu?s=20"), "the_alexliu");
});

test("decodeHtml safely decodes HTML entities in text and author names", () => {
  assert.equal(Core.decodeHtml("Alex &amp; Friends"), "Alex & Friends");
  assert.equal(Core.decodeHtml("Tom &lt; Jerry &gt; &#39;Spike&#39; &quot;Tyke&quot;"), "Tom < Jerry > 'Spike' \"Tyke\"");
  assert.equal(Core.decodeHtml("AI &#x1F680; 时代 &amp; 𝕏"), "AI 🚀 时代 & 𝕏");
  assert.equal(Core.decodeHtml("&#119912;&#119949;&#119942;&#119961;"), "𝑨𝒍𝒆𝒙");
});

test("tweetModel handles special characters, unicode math fonts, emojis and html entities", () => {
  const model = Core.tweetModel({
    rest_id: "888",
    legacy: {
      full_text: "探索 AI 时代 &amp; 𝕏 的未来 &lt;3",
      created_at: "Wed Sep 23 09:55:00 +0000 2026",
      id_str: "888"
    },
    core: {
      user_results: {
        result: {
          rest_id: "999",
          legacy: {
            screen_name: "dashaloveu",
            name: "𝑨𝒍𝒆𝒙𝑭𝒂𝒂𝒂𝒂𝒏𝒈",
            description: "Builder &amp; Creator"
          }
        }
      }
    }
  });

  assert.equal(model.id, "888");
  assert.equal(model.text, "探索 AI 时代 & 𝕏 的未来 <3");
  assert.equal(model.author.handle, "dashaloveu");
  assert.equal(model.author.name, "𝑨𝒍𝒆𝒙𝑭𝒂𝒂𝒂𝒂𝒏𝒈");
  assert.equal(model.author.description, "Builder & Creator");
});

test("stripLeadingMentions removes leading reply mentions and updates entity offsets", () => {
  const input = "@Dora_Rabbit_ 已经用上了，必须支持。";
  const result = Core.stripLeadingMentions(input, [], { displayTextRange: [14, input.length] });
  assert.equal(result.text, "已经用上了，必须支持。");

  // If Twitter display_text_range includes multiple auto-injected thread recipients, strip them
  const threadResult = Core.stripLeadingMentions("@user1 @user2 Hello world!", [], { displayTextRange: [14, "@user1 @user2 Hello world!".length] });
  assert.equal(threadResult.text, "Hello world!");

  // If user actively types @grok in a reply, only the reply target is stripped, @grok is preserved
  const activeMentionResult = Core.stripLeadingMentions("@jefflijun @grok 为什么这么说", [
    { start: 0, end: 10, kind: "mention", label: "@jefflijun", url: "https://x.com/jefflijun" },
    { start: 11, end: 16, kind: "mention", label: "@grok", url: "https://x.com/grok" }
  ], { displayTextRange: [11, 23], replyToHandle: "jefflijun" });
  assert.equal(activeMentionResult.text, "@grok 为什么这么说");
  assert.equal(activeMentionResult.entities.length, 1);
  assert.equal(activeMentionResult.entities[0].label, "@grok");
  assert.equal(activeMentionResult.entities[0].start, 0);
  assert.equal(activeMentionResult.entities[0].end, 5);

  // A reply target alone does not prove a mention is outside visible text.
  const handleFallback = Core.stripLeadingMentions("@jefflijun @grok 为什么这么说", [], { replyToHandle: "jefflijun" });
  assert.equal(handleFallback.text, "@jefflijun @grok 为什么这么说");

  // Missing metadata preserves the full original text.
  const noOptionFallback = Core.stripLeadingMentions("@user1 @user2 Hello world!");
  assert.equal(noOptionFallback.text, "@user1 @user2 Hello world!");

  const withEntities = Core.stripLeadingMentions("@Dora_Rabbit_ check https://t.co/abc #test", [
    { start: 0, end: 13, kind: "mention", label: "@Dora_Rabbit_", url: "https://x.com/Dora_Rabbit_" },
    { start: 20, end: 36, kind: "url", label: "https://t.co/abc", url: "https://t.co/abc" },
    { start: 37, end: 42, kind: "hashtag", label: "#test", url: "https://x.com/hashtag/test" }
  ], { displayTextRange: [14, 42] });
  assert.equal(withEntities.text, "check https://t.co/abc #test");
  assert.equal(withEntities.entities.length, 2);
  assert.equal(withEntities.entities[0].start, 6);
  assert.equal(withEntities.entities[0].end, 22);
  assert.equal(withEntities.text.slice(withEntities.entities[0].start, withEntities.entities[0].end), "https://t.co/abc");
  assert.equal(withEntities.entities[1].start, 23);
  assert.equal(withEntities.entities[1].end, 28);
  assert.equal(withEntities.text.slice(withEntities.entities[1].start, withEntities.entities[1].end), "#test");

  // Pure mention without other text is preserved safely
  const pureMention = Core.stripLeadingMentions("@only_mention");
  assert.equal(pureMention.text, "@only_mention");
});

test("tweetModel cleans leading mentions when tweet is a reply and preserves active @grok", () => {
  const replyModel = Core.tweetModel({
    rest_id: "777",
    legacy: {
      id_str: "777",
      full_text: "@dashaloveu 好的！最近在迭代计划中咯",
      in_reply_to_status_id_str: "2102624917732958332",
      in_reply_to_screen_name: "dashaloveu",
      display_text_range: [12, 24],
      entities: { urls: [], user_mentions: [{ indices: [0, 10], screen_name: "dashaloveu" }], hashtags: [] }
    },
    core: { user_results: { result: { rest_id: "1", legacy: { screen_name: "Dora_Rabbit_", name: "兔崽 Dora" } } } }
  });
  assert.equal(replyModel.text, "好的！最近在迭代计划中咯");
  assert.equal(replyModel.rawText, "@dashaloveu 好的！最近在迭代计划中咯");

  // Active @grok mention in reply
  const grokReplyModel = Core.tweetModel({
    rest_id: "888",
    legacy: {
      id_str: "888",
      full_text: "@jefflijun @grok 为什么这么说，和银行有什么关系",
      in_reply_to_status_id_str: "100",
      in_reply_to_screen_name: "jefflijun",
      display_text_range: [11, 32],
      entities: {
        urls: [],
        user_mentions: [
          { indices: [0, 10], screen_name: "jefflijun" },
          { indices: [11, 16], screen_name: "grok" }
        ],
        hashtags: []
      }
    },
    core: { user_results: { result: { rest_id: "2", legacy: { screen_name: "pangyusio", name: "Pangyu 胖鱼" } } } }
  });
  assert.equal(grokReplyModel.text, "@grok 为什么这么说，和银行有什么关系");
  assert.equal(grokReplyModel.entities.length, 1);
  assert.equal(grokReplyModel.entities[0].label, "@grok");
  assert.equal(grokReplyModel.entities[0].url, "https://x.com/grok");
  assert.equal(grokReplyModel.entities[0].start, 0);
  assert.equal(grokReplyModel.entities[0].end, 5);
});

test("extension content.css includes TwitterChirp and font inherit rules", async () => {
  const css = await readFile(path.resolve("extension/content.css"), "utf8");
  assert.match(css, /TwitterChirp/);
  assert.match(css, /#tuzai-x-popover-root button/);
  assert.match(css, /tuzai-subreplies-toggle-btn/);
  assert.match(css, /tuzai-subreplies-more-btn/);
  assert.match(css, /\.tuzai-subreply-card \.tuzai-subreplies-container/);
});

test("extension build embeds moon, sun and caret Phosphor SVG icons", async () => {
  const icons = await readFile(path.resolve("dist-extension/vendor/phosphor/icons.js"), "utf8");
  assert.match(icons, /"moon":/);
  assert.match(icons, /"sun":/);
  assert.match(icons, /"caret-down":/);
  assert.match(icons, /"caret-up":/);
});

test("parses X poll card into rich attachment, calculates percentages, and suppresses media gallery", () => {
  const pollTweet = {
    rest_id: "2090000000000000000",
    core: {
      user_results: {
        result: {
          rest_id: "u123",
          legacy: { name: "赵赶驴", screen_name: "Gunny0412" }
        }
      }
    },
    legacy: {
      id_str: "2090000000000000000",
      full_text: "如果要从罗永浩和贾国龙两个人中间选择一个做朋友，你会选择谁？",
      conversation_id_str: "2090000000000000000",
      entities: { urls: [], user_mentions: [], hashtags: [] },
      extended_entities: {
        media: [
          {
            id_str: "m1",
            media_url_https: "https://pbs.twimg.com/media/luoyonghao.jpg",
            type: "photo",
            original_info: { width: 400, height: 400 }
          },
          {
            id_str: "m2",
            media_url_https: "https://pbs.twimg.com/media/jiaguolong.jpg",
            type: "photo",
            original_info: { width: 400, height: 400 }
          }
        ]
      }
    },
    card: {
      name: "2087155564904370681:poll2choice_image",
      legacy: {
        binding_values: [
          { key: "choice1_label", value: { type: "STRING", string_value: "罗永浩" } },
          { key: "choice1_count", value: { type: "STRING", string_value: "209" } },
          { key: "choice2_label", value: { type: "STRING", string_value: "贾国龙" } },
          { key: "choice2_count", value: { type: "STRING", string_value: "127" } },
          { key: "counts_are_final", value: { type: "BOOLEAN", boolean_value: true } }
        ]
      }
    }
  };

  const model = Core.tweetModel(pollTweet);
  assert.ok(model);
  // Poll choice images must not contaminate tweet media gallery
  assert.equal(model.media.length, 0);
  assert.ok(model.attachment);
  assert.equal(model.attachment.type, "poll");
  assert.equal(model.attachment.totalVotes, 336);
  assert.equal(model.attachment.isFinal, true);
  assert.equal(model.attachment.options.length, 2);

  const [opt1, opt2] = model.attachment.options;
  assert.equal(opt1.label, "罗永浩");
  assert.equal(opt1.count, 209);
  assert.equal(opt1.percentage, "62.2");
  assert.equal(opt1.isWinner, true);
  assert.equal(opt1.image, "https://pbs.twimg.com/media/luoyonghao.jpg");

  assert.equal(opt2.label, "贾国龙");
  assert.equal(opt2.count, 127);
  assert.equal(opt2.percentage, "37.8");
  assert.equal(opt2.isWinner, false);
  assert.equal(opt2.image, "https://pbs.twimg.com/media/jiaguolong.jpg");
});

test("extension content.css includes poll card styles", async () => {
  const css = await readFile(path.resolve("extension/content.css"), "utf8");
  assert.match(css, /\.tuzai-poll-card/);
  assert.match(css, /\.tuzai-poll-track/);
  assert.match(css, /\.tuzai-poll-fill/);
  assert.match(css, /\.tuzai-poll-option-row\.is-winner/);
});
